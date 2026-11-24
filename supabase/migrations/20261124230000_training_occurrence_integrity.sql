-- Guard the shared save without granting browser access to collections.
create function public.check_training_collection_save(
  p_session uuid, p_instance uuid, p_token uuid, p_manifest jsonb, p_legacy boolean
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.activate_training_session_lease(p_session,p_instance,p_token);
  if exists (
    select 1 from public.training_player_collections c
    join public.training_exercise_occurrences o on (o.session_id,o.id)=(c.session_id,c.occurrence_id)
    join public.exercises e on e.id=o.exercise_id
    where c.session_id=p_session and (p_legacy or c.measurement_type is distinct from e.measurement_type or not exists (
      select 1 from jsonb_array_elements(p_manifest) d where (d->>'id')::uuid=o.id
        and (d->>'exercise_id')::uuid=o.exercise_id and (d->>'collects_stats')::boolean
    ))
  ) then raise exception 'Une collecte existe pour cette occurrence. Recharge la séance ou conserve son exercice.' using errcode='23514'; end if;
end $$;
revoke all on function public.check_training_collection_save(uuid,uuid,uuid,jsonb,boolean) from public,anon;
grant execute on function public.check_training_collection_save(uuid,uuid,uuid,jsonb,boolean) to authenticated;

-- One implementation for both browser generations. All writes execute with RLS
-- and the C2 lease; only the collection guard above needs elevated reads.
create function public.save_training_session_core(
  p_session_id uuid,p_expected_version integer,p_editor_instance_id uuid,p_lease_token uuid,
  p_workspace_id uuid,p_group_id uuid,p_team_id uuid,p_trained_on date,p_label text,p_theme text,
  p_duration_minutes integer,p_notes text,p_attendance jsonb,p_exercises jsonb,p_results jsonb,
  p_force boolean,p_occurrences jsonb,p_legacy boolean
) returns table(status text,session_id uuid,version integer,updated_at timestamptz,
  remote_version integer,lease_token uuid,lease_expires_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_sid uuid:=p_session_id; v_ws uuid:=p_workspace_id; v_group uuid;
  v_version integer; v_updated timestamptz; v_token uuid:=p_lease_token; v_expires timestamptz;
  v_new_ids uuid[]; v_item record; v_row public.training_results; v_expected uuid;
begin
  if v_uid is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  if p_editor_instance_id is null or p_group_id is null or p_team_id is null or p_legacy is null
     or p_duration_minutes<0 then raise exception 'Paramètres de séance invalides' using errcode='22023'; end if;
  if jsonb_typeof(p_attendance) is distinct from 'array' or jsonb_typeof(p_exercises) is distinct from 'array'
     or jsonb_typeof(p_results) is distinct from 'array'
     or ((not p_legacy or p_occurrences is not null) and jsonb_typeof(p_occurrences) is distinct from 'array') then
    raise exception 'Tableaux de séance invalides' using errcode='22023';
  end if;

  if v_sid is not null then
    perform public.activate_training_session_lease(v_sid,p_editor_instance_id,v_token);
    select s.workspace_id,s.group_id,s.version,s.updated_at into v_ws,v_group,v_version,v_updated
      from public.training_sessions s where s.id=v_sid for update;
    if not found then raise exception 'Séance introuvable' using errcode='P0002'; end if;
    if v_group is distinct from p_group_id then raise exception 'Séance hors du groupe' using errcode='22023'; end if;
    if not coalesce(p_force,false) and v_version is distinct from p_expected_version then
      return query select 'conflict'::text,v_sid,null::integer,v_updated,v_version,null::uuid,null::timestamptz;
      return;
    end if;
    if p_legacy and (
      exists (select 1 from public.training_results r where r.session_id=v_sid and r.occurrence_id is not null)
      or (p_occurrences is null and exists (select 1 from public.training_tactical_diagrams d where d.session_id=v_sid))
    ) then raise exception 'Mise à niveau requise : recharge la page avant de sauvegarder cette séance' using errcode='55000'; end if;
    perform public.check_training_collection_save(v_sid,p_editor_instance_id,v_token,p_occurrences,p_legacy);
  end if;

  if v_ws is null then raise exception 'Workspace requis' using errcode='22023'; end if;
  if not exists (select 1 from public.teams t where t.id=p_team_id and t.workspace_id=v_ws) then
    raise exception 'Équipe hors du workspace de la séance' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_attendance) e where not exists
      (select 1 from public.coaching_group_players gp where gp.group_id=p_group_id and gp.player_id=(e->>'player_id')::uuid)
      and not exists (select 1 from public.training_attendance a where a.session_id=v_sid and a.player_id=(e->>'player_id')::uuid)) then
    raise exception 'Joueur non autorisé' using errcode='23503';
  end if;
  if exists (select 1 from jsonb_array_elements(p_exercises) e where not exists
      (select 1 from public.exercises x where x.id=(e->>'exercise_id')::uuid)) then
    raise exception 'Exercice introuvable' using errcode='23503';
  end if;
  if exists (select 1 from jsonb_array_elements(p_results) r where not exists
      (select 1 from jsonb_array_elements(p_exercises) e where (e->>'exercise_id')::uuid=(r->>'exercise_id')::uuid)
      or not exists (select 1 from jsonb_array_elements(p_attendance) a
        where (a->>'player_id')::uuid=(r->>'player_id')::uuid and (a->>'present')::boolean)
      or (not p_legacy and not exists (select 1 from jsonb_array_elements(p_occurrences) o
        where (o->>'id')::uuid=(r->>'occurrence_id')::uuid and (o->>'exercise_id')::uuid=(r->>'exercise_id')::uuid
          and (o->>'collects_stats')::boolean))) then raise exception 'Résultat incohérent' using errcode='23514'; end if;
  if not p_legacy and exists (select 1 from jsonb_array_elements(p_results) r
    group by (r->>'occurrence_id')::uuid,(r->>'player_id')::uuid having count(*)>1) then
    raise exception 'Résultat dupliqué pour une occurrence' using errcode='23505';
  end if;

  if p_occurrences is not null then
    if exists (select 1 from jsonb_array_elements(p_occurrences) e where
      coalesce(e->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(e->>'kind','') not in ('plan_block','manual_stat')
      or jsonb_typeof(e->'collects_stats') is distinct from 'boolean'
      or coalesce(e->>'position','') !~ '^[0-9]+$'
      or ((e->>'collects_stats')::boolean and (e->>'exercise_id' is null or coalesce(e->>'stats_position','') !~ '^[0-9]+$'))
      or (not (e->>'collects_stats')::boolean and (e->>'stats_position' is not null or e->>'kind'='manual_stat'))
      or ((e->>'copy_diagrams_from_session_id' is null) <> (e->>'copy_diagrams_from_occurrence_id' is null))) then
      raise exception 'Occurrence invalide' using errcode='22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_occurrences) e where e->>'exercise_id' is not null and not exists
      (select 1 from public.exercises x where x.id=(e->>'exercise_id')::uuid)) then
      raise exception 'Exercice d occurrence introuvable' using errcode='23503';
    end if;
    if exists (select 1 from jsonb_array_elements(p_occurrences) e group by (e->>'id')::uuid having count(*)>1)
       or exists (select 1 from jsonb_array_elements(p_occurrences) e group by (e->>'position')::int having count(*)>1)
       or exists (select 1 from jsonb_array_elements(p_occurrences) e where (e->>'collects_stats')::boolean group by (e->>'stats_position')::int having count(*)>1) then
      raise exception 'Identifiant ou position d occurrence dupliqué' using errcode='23505';
    end if;
    if exists (
      (select (e->>'exercise_id')::uuid,(e->>'position')::int from jsonb_array_elements(p_exercises) e
       except all select (o->>'exercise_id')::uuid,(o->>'stats_position')::int from jsonb_array_elements(p_occurrences) o where (o->>'collects_stats')::boolean)
      union all
      (select (o->>'exercise_id')::uuid,(o->>'stats_position')::int from jsonb_array_elements(p_occurrences) o where (o->>'collects_stats')::boolean
       except all select (e->>'exercise_id')::uuid,(e->>'position')::int from jsonb_array_elements(p_exercises) e)
    ) then raise exception 'Les occurrences statistiques doivent correspondre exactement au plan' using errcode='23514'; end if;
    if exists (select 1 from jsonb_array_elements(p_occurrences) e where e->>'copy_diagrams_from_session_id' is not null and not exists
      (select 1 from public.training_exercise_occurrences src where src.session_id=(e->>'copy_diagrams_from_session_id')::uuid
        and src.id=(e->>'copy_diagrams_from_occurrence_id')::uuid)) then
      raise exception 'Occurrence source introuvable ou inaccessible' using errcode='42501';
    end if;
    if exists (select 1 from public.training_results r where r.session_id=v_sid and r.occurrence_id is not null and not exists
      (select 1 from jsonb_array_elements(p_occurrences) e where (e->>'id')::uuid=r.occurrence_id
        and (e->>'exercise_id')::uuid=r.exercise_id and (e->>'collects_stats')::boolean)) then
      raise exception 'Une occurrence avec des résultats ne peut pas être retirée ou réaffectée' using errcode='23514';
    end if;
  end if;

  if v_sid is null then
    insert into public.training_sessions as s(workspace_id,group_id,team_id,trained_on,label,theme,duration_minutes,notes)
    values(v_ws,p_group_id,p_team_id,coalesce(p_trained_on,current_date),coalesce(nullif(btrim(p_label),''),'Entraînement'),
      nullif(btrim(p_theme),''),p_duration_minutes,p_notes) returning s.id,s.version,s.updated_at into v_sid,v_version,v_updated;
    select a.lease_token,a.expires_at into v_token,v_expires
      from public.acquire_training_session_lease(v_sid,p_editor_instance_id) a where a.status='acquired';
    if v_token is null then raise exception 'Bail d édition impossible après création' using errcode='55000'; end if;
    perform public.activate_training_session_lease(v_sid,p_editor_instance_id,v_token);
  else
    update public.training_sessions s set team_id=p_team_id,trained_on=coalesce(p_trained_on,s.trained_on),
      label=coalesce(nullif(btrim(p_label),''),'Entraînement'),theme=nullif(btrim(p_theme),''),duration_minutes=p_duration_minutes,notes=p_notes
      where s.id=v_sid returning s.version,s.updated_at into v_version,v_updated;
    if not found then raise exception 'Mise à jour refusée' using errcode='42501'; end if;
  end if;

  delete from public.training_attendance a where a.session_id=v_sid and not exists
    (select 1 from jsonb_array_elements(p_attendance) e where (e->>'player_id')::uuid=a.player_id);
  update public.training_attendance a set present=(e->>'present')::boolean from jsonb_array_elements(p_attendance) e
    where a.session_id=v_sid and a.player_id=(e->>'player_id')::uuid;
  insert into public.training_attendance(session_id,player_id,present)
    select v_sid,(e->>'player_id')::uuid,(e->>'present')::boolean from jsonb_array_elements(p_attendance) e where not exists
      (select 1 from public.training_attendance a where a.session_id=v_sid and a.player_id=(e->>'player_id')::uuid);

  if p_occurrences is not null then
    with inserted as (
      insert into public.training_exercise_occurrences(id,session_id,kind,exercise_id,collects_stats,position,stats_position,active,copied_from_occurrence_id)
      select (e->>'id')::uuid,v_sid,e->>'kind',(e->>'exercise_id')::uuid,(e->>'collects_stats')::boolean,
        (e->>'position')::int,(e->>'stats_position')::int,true,(e->>'copy_diagrams_from_occurrence_id')::uuid
      from jsonb_array_elements(p_occurrences) e where not exists
        (select 1 from public.training_exercise_occurrences o where o.session_id=v_sid and o.id=(e->>'id')::uuid)
      returning id
    ) select coalesce(array_agg(id),'{}'::uuid[]) into v_new_ids from inserted;
    update public.training_exercise_occurrences o set kind=e->>'kind',exercise_id=(e->>'exercise_id')::uuid,
      collects_stats=(e->>'collects_stats')::boolean,position=(e->>'position')::int,stats_position=(e->>'stats_position')::int,active=true
      from jsonb_array_elements(p_occurrences) e where o.session_id=v_sid and o.id=(e->>'id')::uuid and not (o.id=any(v_new_ids));
    update public.training_exercise_occurrences o set active=false where o.session_id=v_sid and o.active and not exists
      (select 1 from jsonb_array_elements(p_occurrences) e where (e->>'id')::uuid=o.id);
    insert into public.training_tactical_diagrams(session_id,occurrence_id,document,position)
    select v_sid,(e->>'id')::uuid,
      jsonb_set(jsonb_set(jsonb_set(d.document,'{id}',to_jsonb('diagram-'||gen_random_uuid()::text),true),
        '{createdAt}',to_jsonb(to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),true),
        '{updatedAt}',to_jsonb(to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),true),d.position
    from jsonb_array_elements(p_occurrences) e join public.training_tactical_diagrams d
      on d.session_id=(e->>'copy_diagrams_from_session_id')::uuid and d.occurrence_id=(e->>'copy_diagrams_from_occurrence_id')::uuid
    where (e->>'id')::uuid=any(v_new_ids);
  end if;

  delete from public.training_session_exercises e where e.session_id=v_sid;
  insert into public.training_session_exercises(session_id,exercise_id,position,variant,target,focus,occurrence_id)
  select v_sid,(e->>'exercise_id')::uuid,(e->>'position')::int,nullif(e->>'variant',''),nullif(e->>'target',''),nullif(e->>'focus',''),
    (o.item->>'id')::uuid from jsonb_array_elements(p_exercises) e
    left join lateral (select item from jsonb_array_elements(p_occurrences) item where (item->>'collects_stats')::boolean
      and (item->>'stats_position')::int=(e->>'position')::int) o on true;

  if p_legacy then
    delete from public.training_results r where r.session_id=v_sid and r.variant is null and r.occurrence_id is null;
    insert into public.training_results(session_id,exercise_id,player_id,successes,attempts,numeric_value,note)
    select v_sid,(e->>'exercise_id')::uuid,(e->>'player_id')::uuid,(e->>'successes')::int,(e->>'attempts')::int,
      (e->>'numeric_value')::numeric,nullif(e->>'note','') from jsonb_array_elements(p_results) e;
  else
    for v_item in select * from jsonb_to_recordset(p_results) as r(occurrence_id uuid,exercise_id uuid,player_id uuid,
      successes integer,attempts integer,numeric_value numeric,note text,delete_result boolean,
      expected_result_id uuid,expected_result_version integer)
    loop
      v_expected:=v_item.expected_result_id;
      select r.* into v_row from public.training_results r where r.session_id=v_sid and r.player_id=v_item.player_id
        and r.occurrence_id=v_item.occurrence_id and r.variant is null for update;
      if not found and v_expected is not null then
        -- A legacy row is promoted only by its exact ID, for an unambiguous exercise.
        select r.* into v_row from public.training_results r where r.id=v_expected and r.session_id=v_sid
          and r.player_id=v_item.player_id and r.exercise_id=v_item.exercise_id and r.occurrence_id is null and r.variant is null
          and (select count(*) from public.training_session_exercises e where e.session_id=v_sid and e.exercise_id=r.exercise_id)=1
          for update;
      end if;
      if v_row.id is distinct from v_expected or v_row.result_version is distinct from v_item.expected_result_version then
        raise exception 'Un résultat a changé. Recharge la séance avant de l’enregistrer.' using errcode='40001';
      end if;
      if coalesce(v_item.delete_result,false) then
        -- Retrieved declarations retain their official row for arbitration and history.
        if exists (select 1 from public.get_training_player_result_protection(v_sid,p_editor_instance_id,v_token,v_item.occurrence_id,v_item.player_id)) then
          raise exception 'Un résultat récupéré ne peut pas être supprimé' using errcode='23514';
        end if;
        delete from public.training_results r where r.id=v_row.id;
      elsif v_row.id is null then
        insert into public.training_results(session_id,occurrence_id,exercise_id,player_id,successes,attempts,numeric_value,note)
        values(v_sid,v_item.occurrence_id,v_item.exercise_id,v_item.player_id,v_item.successes,v_item.attempts,v_item.numeric_value,nullif(v_item.note,''));
      elsif (v_row.occurrence_id,v_row.successes,v_row.attempts,v_row.numeric_value,v_row.note) is distinct from
            (v_item.occurrence_id,v_item.successes,v_item.attempts,v_item.numeric_value,nullif(v_item.note,'')) then
        update public.training_results r set occurrence_id=v_item.occurrence_id,successes=v_item.successes,
          attempts=v_item.attempts,numeric_value=v_item.numeric_value,note=nullif(v_item.note,'') where r.id=v_row.id;
      end if;
    end loop;
  end if;
  return query select 'saved'::text,v_sid,v_version,v_updated,null::integer,v_token,v_expires;
end $$;

create function public.get_training_player_result_protection(p_session uuid,p_instance uuid,p_token uuid,p_occurrence uuid,p_player uuid)
returns setof boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.activate_training_session_lease(p_session,p_instance,p_token);
  return query select true from public.training_player_declarations d where d.session_id=p_session
    and d.occurrence_id=p_occurrence and d.player_id=p_player and d.resolution_state<>'open';
end $$;
revoke all on function public.get_training_player_result_protection(uuid,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.get_training_player_result_protection(uuid,uuid,uuid,uuid,uuid) to authenticated;

revoke all on function public.save_training_session_core(uuid,integer,uuid,uuid,uuid,uuid,uuid,date,text,text,integer,text,jsonb,jsonb,jsonb,boolean,jsonb,boolean) from public,anon;
grant execute on function public.save_training_session_core(uuid,integer,uuid,uuid,uuid,uuid,uuid,date,text,text,integer,text,jsonb,jsonb,jsonb,boolean,jsonb,boolean) to authenticated;

create or replace function public.save_training_session_with_occurrences(
  p_session_id uuid,p_expected_version integer,p_editor_instance_id uuid,p_lease_token uuid,
  p_workspace_id uuid,p_group_id uuid,p_team_id uuid,p_trained_on date,p_label text,p_theme text,
  p_duration_minutes integer,p_notes text,p_attendance jsonb,p_exercises jsonb,p_results jsonb,
  p_force boolean,p_occurrences jsonb
) returns table(status text,session_id uuid,version integer,updated_at timestamptz,remote_version integer,lease_token uuid,lease_expires_at timestamptz)
language sql security invoker set search_path='' as $$
  select * from public.save_training_session_core($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true)
$$;

create or replace function public.save_training_session_player_results(
  p_session_id uuid,p_expected_version integer,p_editor_instance_id uuid,p_lease_token uuid,
  p_workspace_id uuid,p_group_id uuid,p_team_id uuid,p_trained_on date,p_label text,p_theme text,
  p_duration_minutes integer,p_notes text,p_attendance jsonb,p_exercises jsonb,p_results jsonb,
  p_force boolean,p_occurrences jsonb
) returns table(status text,session_id uuid,version integer,updated_at timestamptz,remote_version integer,lease_token uuid,lease_expires_at timestamptz)
language sql security invoker set search_path='' as $$
  select * from public.save_training_session_core($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,false)
$$;

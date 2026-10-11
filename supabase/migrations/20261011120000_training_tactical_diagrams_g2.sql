-- G2.1 - Occurrences d'exercices et schemas tactiques persistants.
-- Cette migration depend des fonctions d'autorisation et de bail livrees par C2.
-- Leurs signatures et policies doivent etre confirmees sur la base cible avant application.
--
-- Contrainte de securite heritee (voir 20261010140000_save_training_session_rls_only.sql) :
-- le role authenticated ne doit PAS avoir USAGE sur le schema private. Les RPC publiques
-- restent donc SECURITY INVOKER et ne font AUCUN appel au schema private : elles s'appuient
-- uniquement sur les policies RLS (les expressions de policy, elles, n'exigent que les
-- EXECUTE deja accordes, sans USAGE de schema). Aucun GRANT sur le schema private n'est ajoute.

create table public.training_exercise_occurrences (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  kind text not null,
  exercise_id uuid references public.exercises(id) on delete restrict,
  collects_stats boolean not null default false,
  position integer not null check (position >= 0),
  stats_position integer,
  active boolean not null default true,
  copied_from_occurrence_id uuid,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_exercise_occurrences_stats_check check (
    (collects_stats and exercise_id is not null and stats_position is not null and stats_position >= 0)
    or (not collects_stats and stats_position is null)
  ),
  constraint training_exercise_occurrences_kind_check check (
    kind in ('plan_block', 'manual_stat')
    and (kind <> 'manual_stat' or collects_stats)
  ),
  constraint training_exercise_occurrences_session_id_id_key unique (session_id, id)
);

create index training_exercise_occurrences_exercise_idx
  on public.training_exercise_occurrences(exercise_id);

create table public.training_tactical_diagrams (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  occurrence_id uuid not null,
  document jsonb not null,
  position integer not null check (position >= 0),
  version integer not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_tactical_diagrams_document_check check (
    jsonb_typeof(document) = 'object'
    and document ->> 'schema' is not distinct from 'kinball-coach-tactical-diagram'
    and document -> 'schemaVersion' is not distinct from '1'::jsonb
    and octet_length(document::text) <= 2000000
  ),
  constraint training_tactical_diagrams_occurrence_fk
    foreign key (session_id, occurrence_id)
    references public.training_exercise_occurrences(session_id, id)
    on delete cascade deferrable initially deferred,
  constraint training_tactical_diagrams_position_key unique (session_id, occurrence_id, position)
);

alter table public.training_session_exercises add column occurrence_id uuid;
alter table public.training_session_exercises
  add constraint training_session_exercises_occurrence_fk
  foreign key (session_id, occurrence_id)
  references public.training_exercise_occurrences(session_id, id)
  on delete no action deferrable initially deferred;
create index training_session_exercises_occurrence_idx
  on public.training_session_exercises(session_id, occurrence_id);

create or replace function private.touch_training_g2_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.session_id is distinct from old.session_id
       or new.copied_from_occurrence_id is distinct from old.copied_from_occurrence_id then
      raise exception 'L identité et la provenance d une occurrence sont immuables' using errcode='22023';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create or replace function private.touch_training_tactical_diagram()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.session_id is distinct from old.session_id
       or new.occurrence_id is distinct from old.occurrence_id then
      raise exception 'L identité et l occurrence d un schéma tactique sont immuables' using errcode='22023';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.version := old.version + 1;
  else
    new.created_by := auth.uid();
    new.created_at := now();
    new.version := 1;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

revoke all on function private.touch_training_g2_row() from public, anon, authenticated;
revoke all on function private.touch_training_tactical_diagram() from public, anon, authenticated;

create trigger trg_training_exercise_occurrences_audit
before insert or update on public.training_exercise_occurrences
for each row execute function private.touch_training_g2_row();
create trigger trg_training_tactical_diagrams_audit
before insert or update on public.training_tactical_diagrams
for each row execute function private.touch_training_tactical_diagram();

alter table public.training_exercise_occurrences enable row level security;
alter table public.training_tactical_diagrams enable row level security;

create policy training_exercise_occurrences_select on public.training_exercise_occurrences
for select to authenticated using (exists (
  select 1 from public.training_sessions s
  where s.id = training_exercise_occurrences.session_id
));
create policy training_exercise_occurrences_insert on public.training_exercise_occurrences
for insert to authenticated with check (exists (
  select 1 from public.training_sessions s
  where s.id = training_exercise_occurrences.session_id
    and (private.is_group_coach(s.group_id) or private.can_edit_workspace(s.workspace_id))
));
create policy training_exercise_occurrences_update on public.training_exercise_occurrences
for update to authenticated using (exists (
  select 1 from public.training_sessions s
  where s.id = training_exercise_occurrences.session_id
    and (private.is_group_coach(s.group_id) or private.can_edit_workspace(s.workspace_id))
)) with check (exists (
  select 1 from public.training_sessions s
  where s.id = training_exercise_occurrences.session_id
    and (private.is_group_coach(s.group_id) or private.can_edit_workspace(s.workspace_id))
));
create policy training_exercise_occurrences_delete on public.training_exercise_occurrences
for delete to authenticated using (exists (
  select 1 from public.training_sessions s
  where s.id = training_exercise_occurrences.session_id
    and (private.is_group_coach(s.group_id) or private.can_edit_workspace(s.workspace_id))
));

create policy training_tactical_diagrams_select on public.training_tactical_diagrams
for select to authenticated using (exists (
  select 1 from public.training_sessions s where s.id = training_tactical_diagrams.session_id
));
create policy training_tactical_diagrams_insert on public.training_tactical_diagrams
for insert to authenticated with check (exists (
  select 1 from public.training_sessions s
  where s.id = training_tactical_diagrams.session_id
    and (private.is_group_coach(s.group_id) or private.can_edit_workspace(s.workspace_id))
));
create policy training_tactical_diagrams_update on public.training_tactical_diagrams
for update to authenticated using (exists (
  select 1 from public.training_sessions s
  where s.id = training_tactical_diagrams.session_id
    and (private.is_group_coach(s.group_id) or private.can_edit_workspace(s.workspace_id))
)) with check (exists (
  select 1 from public.training_sessions s
  where s.id = training_tactical_diagrams.session_id
    and (private.is_group_coach(s.group_id) or private.can_edit_workspace(s.workspace_id))
));
create policy training_tactical_diagrams_delete on public.training_tactical_diagrams
for delete to authenticated using (exists (
  select 1 from public.training_sessions s
  where s.id = training_tactical_diagrams.session_id
    and (private.is_group_coach(s.group_id) or private.can_edit_workspace(s.workspace_id))
));

-- Aucun droit n'est accorde sur le schema private : authenticated ne doit pas y avoir USAGE.
-- Les nouvelles policies RLS ne s'appuient que sur les EXECUTE deja accordes par les
-- migrations anterieures (is_group_coach / can_edit_workspace), sans elargir le schema.
grant select, insert, update, delete on public.training_exercise_occurrences to authenticated;
grant select, insert, update, delete on public.training_tactical_diagrams to authenticated;

create trigger trg_training_exercise_occurrences_edit_lease_lock
before insert or update or delete on public.training_exercise_occurrences
for each statement execute function private.lock_live_training_session_lease();
create trigger trg_training_exercise_occurrences_edit_lease
before insert or update or delete on public.training_exercise_occurrences
for each row execute function private.guard_training_session_lease();
create trigger trg_training_tactical_diagrams_edit_lease_lock
before insert or update or delete on public.training_tactical_diagrams
for each statement execute function private.lock_live_training_session_lease();
create trigger trg_training_tactical_diagrams_edit_lease
before insert or update or delete on public.training_tactical_diagrams
for each row execute function private.guard_training_session_lease();

create or replace function public.save_training_session_with_occurrences(
  p_session_id uuid, p_expected_version integer, p_editor_instance_id uuid, p_lease_token uuid,
  p_workspace_id uuid, p_group_id uuid, p_team_id uuid, p_trained_on date, p_label text, p_theme text,
  p_duration_minutes integer, p_notes text, p_attendance jsonb, p_exercises jsonb, p_results jsonb,
  p_force boolean, p_occurrences jsonb
)
returns table(status text, session_id uuid, version integer, updated_at timestamptz,
  remote_version integer, lease_token uuid, lease_expires_at timestamptz)
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_ws uuid; v_group uuid; v_version integer;
  v_updated timestamptz; v_sid uuid; v_token uuid := p_lease_token;
  v_lease_expires timestamptz; v_new_ids uuid[] := '{}'::uuid[];
begin
  if v_uid is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if p_editor_instance_id is null then raise exception 'Instance d édition requise' using errcode = '22023'; end if;
  if p_group_id is null then raise exception 'Groupe requis' using errcode = '22023'; end if;
  if p_team_id is null then raise exception 'Équipe requise' using errcode = '22023'; end if;
  if p_duration_minutes is not null and p_duration_minutes < 0 then raise exception 'Durée invalide' using errcode = '22023'; end if;
  if jsonb_typeof(p_attendance) is distinct from 'array' or jsonb_typeof(p_exercises) is distinct from 'array'
     or jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'Présences, exercices et résultats doivent être des tableaux JSON' using errcode = '22023';
  end if;
  if p_occurrences is not null and jsonb_typeof(p_occurrences) <> 'array' then
    raise exception 'Les occurrences doivent être un tableau JSON' using errcode = '22023';
  end if;

  if p_session_id is null then
    if p_workspace_id is null then raise exception 'Workspace requis' using errcode = '22023'; end if;
    if not exists (select 1 from public.teams t where t.id=p_team_id and t.workspace_id=p_workspace_id) then
      raise exception 'Équipe hors du workspace' using errcode = '22023';
    end if;
    v_ws := p_workspace_id;
    insert into public.training_sessions as s
      (workspace_id,group_id,team_id,trained_on,label,theme,duration_minutes,notes)
    values (v_ws,p_group_id,p_team_id,coalesce(p_trained_on,current_date),
      coalesce(nullif(btrim(p_label),''),'Entraînement'),nullif(btrim(p_theme),''),p_duration_minutes,p_notes)
    returning s.id,s.version,s.updated_at into v_sid,v_version,v_updated;
    select a.lease_token,a.expires_at into v_token,v_lease_expires
      from public.acquire_training_session_lease(v_sid,p_editor_instance_id) a where a.status='acquired';
    if v_token is null then raise exception 'Bail d edition impossible apres creation' using errcode='55000'; end if;
    perform public.activate_training_session_lease(v_sid,p_editor_instance_id,v_token);
  else
    perform public.activate_training_session_lease(p_session_id,p_editor_instance_id,p_lease_token);
    select s.workspace_id,s.group_id,s.version,s.updated_at into v_ws,v_group,v_version,v_updated
      from public.training_sessions s where s.id=p_session_id for update;
    if not found then raise exception 'Séance introuvable' using errcode='P0002'; end if;
    if p_occurrences is null and exists (
      select 1 from public.training_tactical_diagrams d where d.session_id=p_session_id
    ) then
      raise exception 'Mise à niveau requise : utilisez save_training_session_with_occurrences pour une séance contenant des schémas tactiques'
        using errcode='55000';
    end if;
    if v_group is distinct from p_group_id then raise exception 'Séance hors du groupe' using errcode='22023'; end if;
    if not exists (select 1 from public.teams t where t.id=p_team_id and t.workspace_id=v_ws) then
      raise exception 'Équipe hors du workspace de la séance' using errcode='22023';
    end if;
    if not p_force and (p_expected_version is null or v_version<>p_expected_version) then
      return query select 'conflict'::text,p_session_id,null::integer,v_updated,v_version,null::uuid,null::timestamptz;
      return;
    end if;
    update public.training_sessions s set team_id=p_team_id,
      trained_on=coalesce(p_trained_on,s.trained_on),label=coalesce(nullif(btrim(p_label),''),'Entraînement'),
      theme=nullif(btrim(p_theme),''),duration_minutes=p_duration_minutes,notes=p_notes
      where s.id=p_session_id returning s.version,s.updated_at into v_version,v_updated;
    if not found then raise exception 'Mise à jour refusée' using errcode='42501'; end if;
    v_sid:=p_session_id;
  end if;

  if exists (select 1 from jsonb_array_elements(p_attendance) e
    where not exists (select 1 from public.coaching_group_players gp
      where gp.group_id=p_group_id and gp.player_id=(e->>'player_id')::uuid)
    and (p_session_id is null or not exists (select 1 from public.training_attendance a
      where a.session_id=v_sid and a.player_id=(e->>'player_id')::uuid))) then
    raise exception 'Joueur non autorisé' using errcode='23503';
  end if;
  if exists (select 1 from jsonb_array_elements(p_exercises) e where not exists
    (select 1 from public.exercises x where x.id=(e->>'exercise_id')::uuid)) then
    raise exception 'Exercice introuvable' using errcode='23503';
  end if;
  if exists (select 1 from jsonb_array_elements(p_results) e where not exists
    (select 1 from jsonb_array_elements(p_exercises) x where (x->>'exercise_id')::uuid=(e->>'exercise_id')::uuid)
    or not exists (select 1 from jsonb_array_elements(p_attendance) a
      where (a->>'player_id')::uuid=(e->>'player_id')::uuid and (a->>'present')::boolean)) then
    raise exception 'Résultat incohérent' using errcode='23514';
  end if;

  if p_occurrences is not null then
    if exists (select 1 from jsonb_array_elements(p_occurrences) e where
      coalesce(e->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or e->>'kind' is null or e->>'kind' not in ('plan_block','manual_stat')
      or jsonb_typeof(e->'collects_stats') is distinct from 'boolean'
      or coalesce(e->>'position','') !~ '^[0-9]+$'
      or (e->>'exercise_id' is not null and e->>'exercise_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or ((e->>'collects_stats')::boolean and (e->>'exercise_id' is null or coalesce(e->>'stats_position','') !~ '^[0-9]+$'))
      or (not (e->>'collects_stats')::boolean and e->>'stats_position' is not null)
      or (e->>'kind'='manual_stat' and not (e->>'collects_stats')::boolean)
      or ((e->>'copy_diagrams_from_session_id' is null) <> (e->>'copy_diagrams_from_occurrence_id' is null))
      or (e->>'copy_diagrams_from_session_id' is not null and
          (e->>'copy_diagrams_from_session_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           or e->>'copy_diagrams_from_occurrence_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))) then
      raise exception 'Occurrence invalide' using errcode='22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_occurrences) e
      where e->>'exercise_id' is not null and not exists
        (select 1 from public.exercises x where x.id=(e->>'exercise_id')::uuid)) then
      raise exception 'Exercice d occurrence introuvable' using errcode='23503';
    end if;
    if exists (select 1 from jsonb_array_elements(p_occurrences) e group by e->>'id' having count(*)>1)
       or exists (select 1 from jsonb_array_elements(p_occurrences) e group by (e->>'position')::int having count(*)>1)
       or exists (select 1 from jsonb_array_elements(p_occurrences) e where (e->>'collects_stats')::boolean
         group by (e->>'stats_position')::int having count(*)>1) then
      raise exception 'Identifiant ou position d occurrence dupliqué' using errcode='23505';
    end if;
    if exists (select 1 from jsonb_array_elements(p_exercises) x where not exists
      (select 1 from jsonb_array_elements(p_occurrences) e where (e->>'collects_stats')::boolean
       and (e->>'stats_position')::int=(x->>'position')::int
       and (e->>'exercise_id')::uuid=(x->>'exercise_id')::uuid))
      or exists (select 1 from jsonb_array_elements(p_occurrences) e where (e->>'collects_stats')::boolean
       and not exists (select 1 from jsonb_array_elements(p_exercises) x
         where (x->>'position')::int=(e->>'stats_position')::int
         and (x->>'exercise_id')::uuid=(e->>'exercise_id')::uuid)) then
      raise exception 'Les occurrences statistiques doivent correspondre exactement au plan' using errcode='23514';
    end if;
    if exists (select 1 from jsonb_array_elements(p_occurrences) e
      where e->>'copy_diagrams_from_session_id' is not null and not exists (
        select 1 from public.training_exercise_occurrences src
        where src.session_id=(e->>'copy_diagrams_from_session_id')::uuid
          and src.id=(e->>'copy_diagrams_from_occurrence_id')::uuid)) then
      raise exception 'Occurrence source introuvable ou inaccessible' using errcode='42501';
    end if;
  end if;

  delete from public.training_attendance a where a.session_id=v_sid and not exists
    (select 1 from jsonb_array_elements(p_attendance) e where (e->>'player_id')::uuid=a.player_id);
  update public.training_attendance a set present=x.present from
    (select (e->>'player_id')::uuid player_id,(e->>'present')::boolean present from jsonb_array_elements(p_attendance)e)x
    where a.session_id=v_sid and a.player_id=x.player_id;
  insert into public.training_attendance(session_id,player_id,present)
    select v_sid,(e->>'player_id')::uuid,(e->>'present')::boolean from jsonb_array_elements(p_attendance)e
    where not exists(select 1 from public.training_attendance a where a.session_id=v_sid and a.player_id=(e->>'player_id')::uuid);

  delete from public.training_session_exercises e where e.session_id=v_sid;
  insert into public.training_session_exercises(session_id,exercise_id,position,variant,target,focus)
    select v_sid,(e->>'exercise_id')::uuid,(e->>'position')::int,nullif(e->>'variant',''),
      nullif(e->>'target',''),nullif(e->>'focus','') from jsonb_array_elements(p_exercises)e;
  delete from public.training_results r where r.session_id=v_sid and r.variant is null;
  insert into public.training_results(session_id,exercise_id,player_id,successes,attempts,numeric_value,note)
    select v_sid,(e->>'exercise_id')::uuid,(e->>'player_id')::uuid,nullif(e->>'successes','')::int,
      nullif(e->>'attempts','')::int,nullif(e->>'numeric_value','')::numeric,nullif(e->>'note','')
      from jsonb_array_elements(p_results)e;

  if p_occurrences is not null then
    with desired as (
      select (e->>'id')::uuid id,e from jsonb_array_elements(p_occurrences)e
    ), inserted as (
      insert into public.training_exercise_occurrences
        (id,session_id,kind,exercise_id,collects_stats,position,stats_position,active,copied_from_occurrence_id)
      select d.id,v_sid,d.e->>'kind',nullif(d.e->>'exercise_id','')::uuid,
        (d.e->>'collects_stats')::boolean,(d.e->>'position')::int,nullif(d.e->>'stats_position','')::int,true,
        nullif(d.e->>'copy_diagrams_from_occurrence_id','')::uuid
      from desired d where not exists (select 1 from public.training_exercise_occurrences o where o.session_id=v_sid and o.id=d.id)
      returning id
    ) select coalesce(array_agg(id),'{}'::uuid[]) into v_new_ids from inserted;

    update public.training_exercise_occurrences o set kind=e->>'kind',
      exercise_id=nullif(e->>'exercise_id','')::uuid,collects_stats=(e->>'collects_stats')::boolean,
      position=(e->>'position')::int,stats_position=nullif(e->>'stats_position','')::int,active=true
    from jsonb_array_elements(p_occurrences)e
    where o.session_id=v_sid and o.id=(e->>'id')::uuid and not (o.id=any(v_new_ids));
    update public.training_exercise_occurrences o set active=false
    where o.session_id=v_sid and o.active and not exists
      (select 1 from jsonb_array_elements(p_occurrences)e where (e->>'id')::uuid=o.id);

    update public.training_session_exercises x set occurrence_id=o.id
    from public.training_exercise_occurrences o
    where x.session_id=v_sid and o.session_id=v_sid and o.active and o.collects_stats
      and x.position=o.stats_position and x.exercise_id=o.exercise_id;

    insert into public.training_tactical_diagrams(session_id,occurrence_id,document,position)
    select v_sid,(e->>'id')::uuid,
      jsonb_set(jsonb_set(jsonb_set(d.document,'{id}',to_jsonb('diagram-'||gen_random_uuid()::text),true),
        '{createdAt}',to_jsonb(to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),true),
        '{updatedAt}',to_jsonb(to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),true),
      d.position
    from jsonb_array_elements(p_occurrences)e
    join public.training_tactical_diagrams d
      on d.session_id=(e->>'copy_diagrams_from_session_id')::uuid
     and d.occurrence_id=(e->>'copy_diagrams_from_occurrence_id')::uuid
    where (e->>'id')::uuid=any(v_new_ids) and e->>'copy_diagrams_from_session_id' is not null;
  end if;

  return query select 'saved'::text,v_sid,v_version,v_updated,null::integer,v_token,v_lease_expires;
end $$;

revoke all on function public.save_training_session_with_occurrences(uuid,integer,uuid,uuid,uuid,uuid,uuid,date,text,text,integer,text,jsonb,jsonb,jsonb,boolean,jsonb) from public,anon;
grant execute on function public.save_training_session_with_occurrences(uuid,integer,uuid,uuid,uuid,uuid,uuid,date,text,text,integer,text,jsonb,jsonb,jsonb,boolean,jsonb) to authenticated;

-- Contrat historique inchange (16 parametres) : occurrences nulles = aucune occurrence ecrite,
-- mais le refus si la seance contient deja des schemas tactiques est conserve. SECURITY INVOKER
-- + RLS, aucun appel au schema private (le corps G2 vit en public, seule implementation).
create or replace function public.save_training_session(
  p_session_id uuid,p_expected_version integer,p_editor_instance_id uuid,p_lease_token uuid default null,
  p_workspace_id uuid default null,p_group_id uuid default null,p_team_id uuid default null,p_trained_on date default null,
  p_label text default null,p_theme text default null,p_duration_minutes integer default null,p_notes text default null,
  p_attendance jsonb default '[]'::jsonb,p_exercises jsonb default '[]'::jsonb,p_results jsonb default '[]'::jsonb,
  p_force boolean default false)
returns table(status text,session_id uuid,version integer,updated_at timestamptz,remote_version integer,lease_token uuid,lease_expires_at timestamptz)
language sql security invoker set search_path=public,pg_temp as $$
  select * from public.save_training_session_with_occurrences(p_session_id,p_expected_version,p_editor_instance_id,p_lease_token,
    p_workspace_id,p_group_id,p_team_id,p_trained_on,p_label,p_theme,p_duration_minutes,p_notes,
    p_attendance,p_exercises,p_results,p_force,null)
$$;
revoke all on function public.save_training_session(uuid,integer,uuid,uuid,uuid,uuid,uuid,date,text,text,integer,text,jsonb,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.save_training_session(uuid,integer,uuid,uuid,uuid,uuid,uuid,date,text,text,integer,text,jsonb,jsonb,jsonb,boolean) to authenticated;

create function public.save_training_tactical_diagram(
  p_session_id uuid,p_occurrence_id uuid,p_diagram_id uuid,p_expected_version integer,
  p_document jsonb,p_position integer,p_editor_instance_id uuid,p_lease_token uuid)
returns table(status text,diagram_id uuid,version integer,updated_at timestamptz,remote_version integer)
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id uuid; v_version integer; v_updated timestamptz;
begin
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object'
     or p_document->>'schema' is distinct from 'kinball-coach-tactical-diagram'
     or p_document->'schemaVersion' is distinct from '1'::jsonb
     or octet_length(p_document::text)>2000000 then
    raise exception 'Document tactique invalide ou supérieur à 2 Mo' using errcode='22023';
  end if;
  if p_position is null or p_position<0 then raise exception 'Position de schéma invalide' using errcode='22023'; end if;
  perform public.activate_training_session_lease(p_session_id,p_editor_instance_id,p_lease_token);
  if not exists(select 1 from public.training_exercise_occurrences o where o.session_id=p_session_id and o.id=p_occurrence_id and o.active) then
    raise exception 'Occurrence active introuvable' using errcode='23503';
  end if;
  if p_diagram_id is null then
    insert into public.training_tactical_diagrams(session_id,occurrence_id,document,position)
      values(p_session_id,p_occurrence_id,p_document,p_position)
      returning id,training_tactical_diagrams.version,training_tactical_diagrams.updated_at into v_id,v_version,v_updated;
  else
    select d.version,d.updated_at into v_version,v_updated from public.training_tactical_diagrams d
      where d.id=p_diagram_id and d.session_id=p_session_id and d.occurrence_id=p_occurrence_id for update;
    if not found then raise exception 'Schéma tactique introuvable' using errcode='P0002'; end if;
    if p_expected_version is null or p_expected_version<>v_version then
      return query select 'conflict'::text,p_diagram_id,null::integer,v_updated,v_version; return;
    end if;
    update public.training_tactical_diagrams d set document=p_document,position=p_position where d.id=p_diagram_id
      returning d.id,d.version,d.updated_at into v_id,v_version,v_updated;
  end if;
  return query select 'saved'::text,v_id,v_version,v_updated,null::integer;
end $$;

create function public.delete_training_tactical_diagram(
  p_session_id uuid,p_diagram_id uuid,p_expected_version integer,p_editor_instance_id uuid,p_lease_token uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_version integer; v_deleted integer;
begin
  perform public.activate_training_session_lease(p_session_id,p_editor_instance_id,p_lease_token);
  select d.version into v_version from public.training_tactical_diagrams d
    where d.id=p_diagram_id and d.session_id=p_session_id for update;
  if not found then raise exception 'Schéma tactique introuvable' using errcode='P0002'; end if;
  if p_expected_version is null or p_expected_version<>v_version then
    raise exception 'Conflit de version du schéma tactique' using errcode='40001';
  end if;
  delete from public.training_tactical_diagrams d where d.id=p_diagram_id;
  get diagnostics v_deleted=row_count; return v_deleted=1;
end $$;

revoke all on function public.save_training_tactical_diagram(uuid,uuid,uuid,integer,jsonb,integer,uuid,uuid) from public,anon;
grant execute on function public.save_training_tactical_diagram(uuid,uuid,uuid,integer,jsonb,integer,uuid,uuid) to authenticated;
revoke all on function public.delete_training_tactical_diagram(uuid,uuid,integer,uuid,uuid) from public,anon;
grant execute on function public.delete_training_tactical_diagram(uuid,uuid,integer,uuid,uuid) to authenticated;

create or replace function public.get_exercise_usage(p_exercise_id uuid)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'used',exists(select 1 from public.training_session_exercises x where x.exercise_id=p_exercise_id)
      or exists(select 1 from public.training_results r where r.exercise_id=p_exercise_id)
      or exists(select 1 from public.training_exercise_occurrences o where o.exercise_id=p_exercise_id and o.active),
    'has_results',exists(select 1 from public.training_results r where r.exercise_id=p_exercise_id),
    'session_count',(select count(distinct session_id) from (
      select x.session_id from public.training_session_exercises x where x.exercise_id=p_exercise_id
      union select o.session_id from public.training_exercise_occurrences o where o.exercise_id=p_exercise_id and o.active) u),
    'result_count',(select count(*) from public.training_results r where r.exercise_id=p_exercise_id),
    'occurrence_count',(select count(*) from public.training_exercise_occurrences o where o.exercise_id=p_exercise_id and o.active),
    'has_history',exists(select 1 from public.training_session_exercises x where x.exercise_id=p_exercise_id)
      or exists(select 1 from public.training_results r where r.exercise_id=p_exercise_id)
      or exists(select 1 from public.training_exercise_occurrences o where o.exercise_id=p_exercise_id)
  )
$$;

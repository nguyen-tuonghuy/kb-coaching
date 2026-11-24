-- Saisie mobile des resultats d'exercices, rattachee a une occurrence durable.
-- Les declarations restent separees des resultats statistiques et sont figees
-- atomiquement lors de la recuperation par un coach du groupe.

alter table public.training_results
  add column if not exists occurrence_id uuid,
  add column if not exists result_version integer not null default 1,
  add column if not exists updated_at timestamptz not null default now();

alter table public.training_results
  add constraint training_results_occurrence_fk
  foreign key (session_id, occurrence_id)
  references public.training_exercise_occurrences(session_id, id)
  on delete no action deferrable initially deferred;

-- Les anciennes lignes ne sont rattachees que lorsque la correspondance est certaine.
with unambiguous as (
  select tse.session_id,tse.exercise_id,(array_agg(tse.occurrence_id))[1] occurrence_id
  from public.training_session_exercises tse
  where tse.occurrence_id is not null
  group by tse.session_id,tse.exercise_id
  having count(*)=1
), single_result as (
  select tr.session_id,tr.exercise_id,tr.player_id,(array_agg(tr.id))[1] id
  from public.training_results tr
  where tr.variant is null and tr.occurrence_id is null
  group by tr.session_id,tr.exercise_id,tr.player_id
  having count(*)=1
)
update public.training_results tr set occurrence_id=u.occurrence_id
from unambiguous u join single_result sr
  on sr.session_id=u.session_id and sr.exercise_id=u.exercise_id
where tr.id=sr.id;

create unique index if not exists training_results_occurrence_player_uidx
  on public.training_results(session_id,occurrence_id,player_id)
  where occurrence_id is not null and variant is null;
create index if not exists training_results_occurrence_idx
  on public.training_results(session_id,occurrence_id);

create or replace function public.touch_training_result()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' then new.result_version:=old.result_version+1; end if;
  new.updated_at:=now();
  return new;
end $$;
drop trigger if exists trg_training_results_touch on public.training_results;
create trigger trg_training_results_touch before insert or update on public.training_results
for each row execute function public.touch_training_result();

create table public.training_player_collections (
  session_id uuid not null,
  occurrence_id uuid not null,
  measurement_type text not null check (measurement_type in
    ('success_attempts','count','time_seconds','distance','score','rating_5','rating_10')),
  state text not null default 'open' check (state in ('open','locked')),
  opened_by uuid not null references auth.users(id),
  opened_at timestamptz not null default now(),
  locked_by uuid references auth.users(id),
  locked_at timestamptz,
  retrieval_operation_id uuid,
  primary key (session_id,occurrence_id),
  foreign key (session_id,occurrence_id)
    references public.training_exercise_occurrences(session_id,id) on delete cascade
);

create table public.training_player_declarations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  occurrence_id uuid not null,
  player_id uuid not null references public.players(id),
  submitted_by uuid not null references auth.users(id),
  client_request_id uuid not null,
  successes integer check (successes is null or successes>=0),
  attempts integer check (attempts is null or attempts>=0),
  numeric_value numeric,
  note text,
  version integer not null default 1 check (version>0),
  resolution_state text not null default 'open' check (resolution_state in
    ('open','integrated','matched','pending','coach','player')),
  coach_value_snapshot jsonb,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id,occurrence_id,player_id),
  unique (submitted_by,client_request_id),
  foreign key (session_id,occurrence_id)
    references public.training_player_collections(session_id,occurrence_id) on delete cascade
);

create table public.training_player_collection_players (
  session_id uuid not null,
  occurrence_id uuid not null,
  player_id uuid not null references public.players(id),
  user_id uuid references auth.users(id),
  primary key (session_id,occurrence_id,player_id),
  foreign key (session_id,occurrence_id)
    references public.training_player_collections(session_id,occurrence_id) on delete cascade
);

create index training_player_declarations_occurrence_idx
  on public.training_player_declarations(session_id,occurrence_id);

create or replace function public.touch_training_player_declaration()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' then new.version:=old.version+1; end if;
  new.updated_at:=now();
  return new;
end $$;
create trigger trg_training_player_declarations_touch
before insert or update on public.training_player_declarations
for each row execute function public.touch_training_player_declaration();

alter table public.training_player_collections enable row level security;
alter table public.training_player_declarations enable row level security;
alter table public.training_player_collection_players enable row level security;
revoke all on public.training_player_collections,public.training_player_declarations,public.training_player_collection_players from public,anon,authenticated;

create policy "group coaches read result collections"
on public.training_player_collections for select to authenticated using (
  exists (
    select 1 from public.training_sessions s
    join public.coaching_group_coaches c on c.group_id=s.group_id
    where s.id=training_player_collections.session_id and c.user_id=auth.uid()
  )
);
create policy "players read own result collections"
on public.training_player_collections for select to authenticated using (
  exists (
    select 1 from public.training_sessions s
    join public.coaching_player_accounts a on a.group_id=s.group_id and a.user_id=auth.uid()
    join public.training_attendance ta on ta.session_id=s.id and ta.player_id=a.player_id and ta.present
    where s.id=training_player_collections.session_id
  )
);
create policy "group coaches read player declarations"
on public.training_player_declarations for select to authenticated using (
  exists (
    select 1 from public.training_sessions s
    join public.coaching_group_coaches c on c.group_id=s.group_id
    where s.id=training_player_declarations.session_id and c.user_id=auth.uid()
  )
);
create policy "players read own declarations"
on public.training_player_declarations for select to authenticated using (
  submitted_by=auth.uid() and exists (
    select 1 from public.training_sessions s
    join public.coaching_player_accounts a on a.group_id=s.group_id
      and a.user_id=auth.uid() and a.player_id=training_player_declarations.player_id
    where s.id=training_player_declarations.session_id
  )
);

create or replace function public.open_training_player_collection(
  p_session_id uuid,p_occurrence_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_measure text;v_state text;
begin
  if v_uid is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  if not exists (
    select 1 from public.training_sessions s
    join public.coaching_group_coaches c on c.group_id=s.group_id and c.user_id=v_uid
    where s.id=p_session_id
  ) then raise exception 'Acces entraineur requis' using errcode='42501'; end if;
  select e.measurement_type into v_measure
  from public.training_exercise_occurrences o
  join public.exercises e on e.id=o.exercise_id
  join public.training_session_exercises tse
    on tse.session_id=o.session_id and tse.occurrence_id=o.id and tse.exercise_id=o.exercise_id
  where o.session_id=p_session_id and o.id=p_occurrence_id and o.active and o.collects_stats;
  if not found then raise exception 'Occurrence statistique introuvable' using errcode='P0002'; end if;
  insert into public.training_player_collections(session_id,occurrence_id,measurement_type,opened_by)
  values (p_session_id,p_occurrence_id,v_measure,v_uid)
  on conflict (session_id,occurrence_id) do nothing;
  insert into public.training_player_collection_players(session_id,occurrence_id,player_id,user_id)
  select p_session_id,p_occurrence_id,ta.player_id,case when gp.player_id is not null then a.user_id end
  from public.training_attendance ta
  join public.training_sessions s on s.id=ta.session_id
  left join public.coaching_player_accounts a on a.group_id=s.group_id and a.player_id=ta.player_id
  left join public.coaching_group_players gp on gp.group_id=s.group_id and gp.player_id=ta.player_id and gp.active
  where ta.session_id=p_session_id and ta.present
  on conflict (session_id,occurrence_id,player_id) do nothing;
  select state into v_state from public.training_player_collections
  where session_id=p_session_id and occurrence_id=p_occurrence_id;
  return jsonb_build_object('state',v_state,'measurement_type',v_measure);
end $$;

create or replace function public.get_training_player_collection_details(p_session_id uuid)
returns table(
  occurrence_id uuid,exercise_id uuid,exercise_name text,measurement_type text,collection_state text,
  opened_at timestamptz,locked_at timestamptz,player_id uuid,player_name text,account_linked boolean,
  declaration_id uuid,declaration_version integer,resolution_state text,
  player_successes integer,player_attempts integer,player_numeric_value numeric,player_note text,
  result_id uuid,result_version integer,coach_successes integer,coach_attempts integer,
  coach_numeric_value numeric,coach_note text
) language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.training_sessions s
    join public.coaching_group_coaches c on c.group_id=s.group_id and c.user_id=auth.uid()
    where s.id=p_session_id
  ) then raise exception 'Acces entraineur requis' using errcode='42501'; end if;
  return query
  select c.occurrence_id,o.exercise_id,e.name,c.measurement_type,c.state,c.opened_at,c.locked_at,
    cp.player_id,p.display_name,cp.user_id is not null,d.id,d.version,d.resolution_state,
    d.successes,d.attempts,d.numeric_value,d.note,
    r.id,r.result_version,r.successes,r.attempts,r.numeric_value,r.note
  from public.training_player_collections c
  join public.training_exercise_occurrences o on o.session_id=c.session_id and o.id=c.occurrence_id
  join public.exercises e on e.id=o.exercise_id
  join public.training_player_collection_players cp on cp.session_id=c.session_id and cp.occurrence_id=c.occurrence_id
  join public.players p on p.id=cp.player_id
  left join public.training_player_declarations d on d.session_id=c.session_id
    and d.occurrence_id=c.occurrence_id and d.player_id=cp.player_id
  left join public.training_results r on r.session_id=c.session_id and r.occurrence_id=c.occurrence_id
    and r.player_id=cp.player_id and r.variant is null
  where c.session_id=p_session_id
  order by o.stats_position,p.display_name;
end $$;

create or replace function public.get_my_training_result_tasks(p_group_id uuid)
returns table(
  session_id uuid,occurrence_id uuid,exercise_id uuid,exercise_name text,measurement_type text,
  session_label text,trained_on date,collection_state text,declaration_id uuid,declaration_version integer,
  successes integer,attempts integer,numeric_value numeric,note text,updated_at timestamptz
) language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  return query
  select s.id,c.occurrence_id,o.exercise_id,e.name,c.measurement_type,s.label,s.trained_on,c.state,
    d.id,d.version,d.successes,d.attempts,d.numeric_value,d.note,d.updated_at
  from public.training_sessions s
  join public.coaching_player_accounts a on a.group_id=s.group_id and a.user_id=auth.uid()
  join public.coaching_group_players gp on gp.group_id=s.group_id and gp.player_id=a.player_id and gp.active
  join public.training_player_collections c on c.session_id=s.id
  join public.training_player_collection_players cp on cp.session_id=c.session_id
    and cp.occurrence_id=c.occurrence_id and cp.player_id=a.player_id and cp.user_id=auth.uid()
  join public.training_exercise_occurrences o on o.session_id=c.session_id and o.id=c.occurrence_id
  join public.exercises e on e.id=o.exercise_id
  left join public.training_player_declarations d on d.session_id=s.id
    and d.occurrence_id=c.occurrence_id and d.player_id=a.player_id and d.submitted_by=auth.uid()
  where s.group_id=p_group_id and o.active and (c.state='open' or d.id is not null)
  order by c.opened_at desc;
end $$;

create or replace function public.submit_my_training_result(
  p_occurrence_id uuid,p_successes integer,p_attempts integer,p_numeric_value numeric,
  p_note text,p_client_request_id uuid,p_expected_version integer
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_session uuid;v_player uuid;v_group uuid;v_measure text;v_row public.training_player_declarations;
begin
  if v_uid is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  if p_client_request_id is null then raise exception 'Identifiant de requete requis' using errcode='22023'; end if;
  select d.* into v_row from public.training_player_declarations d
  where d.submitted_by=v_uid and d.client_request_id=p_client_request_id;
  if found then
    return jsonb_build_object('id',v_row.id,'version',v_row.version,'state','saved');
  end if;
  select c.session_id,s.group_id,c.measurement_type into v_session,v_group,v_measure
  from public.training_player_collections c
  join public.training_sessions s on s.id=c.session_id
  join public.training_exercise_occurrences o on o.session_id=c.session_id and o.id=c.occurrence_id and o.active
  join public.exercises e on e.id=o.exercise_id and e.measurement_type=c.measurement_type
  where c.occurrence_id=p_occurrence_id
  for update of c;
  if not found then raise exception 'Saisie introuvable' using errcode='P0002'; end if;
  if (select state from public.training_player_collections where session_id=v_session and occurrence_id=p_occurrence_id)<>'open' then
    raise exception 'La saisie est fermée' using errcode='55000';
  end if;
  select cp.player_id into v_player
  from public.training_player_collection_players cp
  join public.coaching_group_players gp on gp.group_id=v_group and gp.player_id=cp.player_id and gp.active
  where cp.session_id=v_session and cp.occurrence_id=p_occurrence_id and cp.user_id=v_uid;
  if not found then raise exception 'Joueur present non identifie' using errcode='42501'; end if;
  select * into v_row from public.training_player_declarations d
  where d.session_id=v_session and d.occurrence_id=p_occurrence_id and d.player_id=v_player for update;
  if found then
    if p_expected_version is null or p_expected_version<>v_row.version then
      return jsonb_build_object('status','conflict','version',v_row.version);
    end if;
  elsif p_expected_version is not null then
    return jsonb_build_object('status','conflict','version',null);
  end if;
  if p_successes is not null and p_successes<0 or p_attempts is not null and p_attempts<0 then
    raise exception 'Valeur invalide' using errcode='22023';
  end if;
  if v_measure='success_attempts' then
    if p_numeric_value is not null or (p_successes is null and p_attempts is null) then
      raise exception 'Reussites ou tentatives requises' using errcode='22023';
    end if;
  else
    if p_successes is not null or p_attempts is not null or p_numeric_value is null then
      raise exception 'Valeur numerique requise' using errcode='22023';
    end if;
    if p_numeric_value<0
      or (v_measure='rating_5' and p_numeric_value>5)
      or (v_measure='rating_10' and p_numeric_value>10) then
      raise exception 'Valeur hors limites' using errcode='22023';
    end if;
  end if;
  insert into public.training_player_declarations as d
    (session_id,occurrence_id,player_id,submitted_by,client_request_id,successes,attempts,numeric_value,note)
  values (v_session,p_occurrence_id,v_player,v_uid,p_client_request_id,p_successes,p_attempts,p_numeric_value,nullif(btrim(p_note),''))
  on conflict (session_id,occurrence_id,player_id) do update set
    client_request_id=excluded.client_request_id,successes=excluded.successes,attempts=excluded.attempts,
    numeric_value=excluded.numeric_value,note=excluded.note,resolution_state='open',coach_value_snapshot=null,
    resolved_by=null,resolved_at=null
  returning d.* into v_row;
  return jsonb_build_object('id',v_row.id,'version',v_row.version,'state','saved');
end $$;

create or replace function public.retrieve_training_player_results(
  p_session_id uuid,p_occurrence_id uuid,p_operation_id uuid,
  p_editor_instance_id uuid,p_lease_token uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_state text;v_measure text;v_exercise uuid;v_d record;v_r public.training_results;v_pending integer;v_submitted integer;v_present integer;
begin
  if v_uid is null or not exists (
    select 1 from public.training_sessions s join public.coaching_group_coaches c
      on c.group_id=s.group_id and c.user_id=v_uid where s.id=p_session_id
  ) then raise exception 'Acces entraineur requis' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'Identifiant d operation requis' using errcode='22023'; end if;
  perform public.activate_training_session_lease(p_session_id,p_editor_instance_id,p_lease_token);
  select c.state,c.measurement_type,o.exercise_id into v_state,v_measure,v_exercise
  from public.training_player_collections c
  join public.training_exercise_occurrences o on o.session_id=c.session_id and o.id=c.occurrence_id
  where c.session_id=p_session_id and c.occurrence_id=p_occurrence_id
  for update of c;
  if not found then raise exception 'Saisie introuvable' using errcode='P0002'; end if;
  if not exists (select 1 from public.exercises e where e.id=v_exercise and e.measurement_type=v_measure) then
    raise exception 'Le type de mesure de l occurrence a change' using errcode='55000';
  end if;
  if v_state='open' then
    update public.training_player_collections set state='locked',locked_by=v_uid,locked_at=now(),retrieval_operation_id=p_operation_id
    where session_id=p_session_id and occurrence_id=p_occurrence_id;
    for v_d in select * from public.training_player_declarations d
      where d.session_id=p_session_id and d.occurrence_id=p_occurrence_id for update
    loop
      select * into v_r from public.training_results r
      where r.session_id=p_session_id and r.occurrence_id=p_occurrence_id
        and r.player_id=v_d.player_id and r.variant is null for update;
      if not found then
        insert into public.training_results(session_id,occurrence_id,exercise_id,player_id,successes,attempts,numeric_value,note)
        values (p_session_id,p_occurrence_id,v_exercise,v_d.player_id,v_d.successes,v_d.attempts,v_d.numeric_value,v_d.note);
        update public.training_player_declarations set resolution_state='integrated'
        where id=v_d.id;
      elsif (v_measure='success_attempts' and v_r.successes is not distinct from v_d.successes
             and v_r.attempts is not distinct from v_d.attempts)
         or (v_measure<>'success_attempts' and v_r.numeric_value is not distinct from v_d.numeric_value) then
        if v_r.note is null and v_d.note is not null then
          update public.training_results set note=v_d.note where id=v_r.id;
        end if;
        update public.training_player_declarations set resolution_state='matched',
          coach_value_snapshot=jsonb_build_object('result_id',v_r.id,'result_version',v_r.result_version,
            'successes',v_r.successes,'attempts',v_r.attempts,'numeric_value',v_r.numeric_value,'note',v_r.note)
        where id=v_d.id;
      else
        update public.training_player_declarations set resolution_state='pending',
          coach_value_snapshot=jsonb_build_object('result_id',v_r.id,'result_version',v_r.result_version,
            'successes',v_r.successes,'attempts',v_r.attempts,'numeric_value',v_r.numeric_value,'note',v_r.note)
        where id=v_d.id;
      end if;
    end loop;
    -- Toute recuperation invalide les snapshots de seance ouverts par un autre coach.
    update public.training_sessions set updated_at=updated_at where id=p_session_id;
  end if;
  select count(*) into v_present from public.training_player_collection_players
    where session_id=p_session_id and occurrence_id=p_occurrence_id;
  select count(*) into v_submitted from public.training_player_declarations where session_id=p_session_id and occurrence_id=p_occurrence_id;
  select count(*) into v_pending from public.training_player_declarations where session_id=p_session_id and occurrence_id=p_occurrence_id and resolution_state='pending';
  return jsonb_build_object('state','locked','present_count',v_present,'submitted_count',v_submitted,
    'missing_count',v_present-v_submitted,'discrepancy_count',v_pending);
end $$;

create or replace function public.arbitrate_training_player_result(
  p_declaration_id uuid,p_choice text,p_expected_result_id uuid,p_expected_result_version integer,
  p_editor_instance_id uuid,p_lease_token uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_d public.training_player_declarations;v_r public.training_results;v_exercise uuid;
begin
  if p_choice not in ('coach','player') then raise exception 'Choix invalide' using errcode='22023'; end if;
  select * into v_d from public.training_player_declarations where id=p_declaration_id;
  if not found then raise exception 'Declaration introuvable' using errcode='P0002'; end if;
  if not exists (
    select 1 from public.training_sessions s join public.coaching_group_coaches c
      on c.group_id=s.group_id and c.user_id=v_uid where s.id=v_d.session_id
  ) then raise exception 'Acces entraineur requis' using errcode='42501'; end if;
  perform public.activate_training_session_lease(v_d.session_id,p_editor_instance_id,p_lease_token);
  select * into v_d from public.training_player_declarations where id=p_declaration_id for update;
  if v_d.resolution_state<>'pending' then
    return jsonb_build_object('status','resolved','resolution_state',v_d.resolution_state);
  end if;
  select * into v_r from public.training_results r
  where r.session_id=v_d.session_id and r.occurrence_id=v_d.occurrence_id
    and r.player_id=v_d.player_id and r.variant is null for update;
  if not found or v_r.id is distinct from p_expected_result_id or v_r.result_version is distinct from p_expected_result_version then
    return jsonb_build_object('status','conflict','result_id',v_r.id,'result_version',v_r.result_version,
      'successes',v_r.successes,'attempts',v_r.attempts,'numeric_value',v_r.numeric_value,'note',v_r.note);
  end if;
  if p_choice='player' then
    update public.training_results set successes=v_d.successes,attempts=v_d.attempts,
      numeric_value=v_d.numeric_value,note=v_d.note where id=v_r.id;
  end if;
  update public.training_player_declarations set resolution_state=p_choice,resolved_by=v_uid,resolved_at=now()
  where id=v_d.id;
  update public.training_sessions set updated_at=updated_at where id=v_d.session_id;
  return jsonb_build_object('status','saved','resolution_state',p_choice);
end $$;

-- Version occurrence-aware de la sauvegarde generale. La RPC G2 conserve toute sa
-- validation, son bail et son verrou optimiste ; cette enveloppe remplace ensuite les
-- lignes ordinaires avec leur occurrence dans la meme transaction.
create or replace function public.save_training_session_player_results(
  p_session_id uuid,p_expected_version integer,p_editor_instance_id uuid,p_lease_token uuid,
  p_workspace_id uuid,p_group_id uuid,p_team_id uuid,p_trained_on date,p_label text,p_theme text,
  p_duration_minutes integer,p_notes text,p_attendance jsonb,p_exercises jsonb,p_results jsonb,
  p_force boolean,p_occurrences jsonb
) returns table(status text,session_id uuid,version integer,updated_at timestamptz,
  remote_version integer,lease_token uuid,lease_expires_at timestamptz)
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_saved record;
begin
  if p_session_id is not null then
    perform public.activate_training_session_lease(p_session_id,p_editor_instance_id,p_lease_token);
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_results) r
    where nullif(r->>'occurrence_id','') is null
      or not exists (select 1 from jsonb_array_elements(p_occurrences) o
        where o->>'id'=r->>'occurrence_id' and o->>'exercise_id'=r->>'exercise_id'
          and (o->>'collects_stats')::boolean)
  ) then raise exception 'Occurrence de resultat invalide' using errcode='23514'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_results) r
    group by r->>'occurrence_id',r->>'player_id' having count(*)>1
  ) then raise exception 'Resultat duplique pour une occurrence' using errcode='23505'; end if;
  if p_session_id is not null and exists (
    select 1 from public.training_player_collections c
    join public.training_exercise_occurrences current_occurrence
      on current_occurrence.session_id=c.session_id and current_occurrence.id=c.occurrence_id
    join public.exercises current_exercise on current_exercise.id=current_occurrence.exercise_id
    where c.session_id=p_session_id and (
      c.measurement_type<>current_exercise.measurement_type or not exists (
        select 1 from jsonb_array_elements(p_occurrences) desired
        where (desired->>'id')::uuid=c.occurrence_id
          and nullif(desired->>'exercise_id','')::uuid=current_occurrence.exercise_id
          and (desired->>'collects_stats')::boolean
      )
    )
  ) then raise exception 'Une occurrence ouverte ne peut pas etre modifiee ou retiree' using errcode='55000'; end if;
  if p_session_id is not null and exists (
    select 1 from public.training_results current_result
    join public.training_player_collections c on c.session_id=current_result.session_id
      and c.occurrence_id=current_result.occurrence_id and c.state='locked'
    where current_result.session_id=p_session_id and current_result.variant is null
      and not exists (
        select 1 from jsonb_array_elements(p_results) desired_result
        where (desired_result->>'occurrence_id')::uuid=current_result.occurrence_id
          and (desired_result->>'player_id')::uuid=current_result.player_id
          and nullif(desired_result->>'expected_result_id','')::uuid=current_result.id
          and nullif(desired_result->>'expected_result_version','')::integer=current_result.result_version
          and coalesce((desired_result->>'delete_result')::boolean,false)=false
      )
  ) then raise exception 'Des resultats recuperes ont change. Recharge la seance avant de les enregistrer.' using errcode='40001'; end if;

  select * into v_saved from public.save_training_session_with_occurrences(
    p_session_id,p_expected_version,p_editor_instance_id,p_lease_token,p_workspace_id,p_group_id,p_team_id,
    p_trained_on,p_label,p_theme,p_duration_minutes,p_notes,p_attendance,p_exercises,p_results,p_force,p_occurrences);
  if v_saved.status='conflict' then return query select v_saved.*;return;end if;

  delete from public.training_results r where r.session_id=v_saved.session_id and r.variant is null;
  insert into public.training_results(session_id,occurrence_id,exercise_id,player_id,successes,attempts,numeric_value,note)
  select v_saved.session_id,(r->>'occurrence_id')::uuid,(r->>'exercise_id')::uuid,(r->>'player_id')::uuid,
    nullif(r->>'successes','')::integer,nullif(r->>'attempts','')::integer,
    nullif(r->>'numeric_value','')::numeric,nullif(r->>'note','')
  from jsonb_array_elements(p_results) r
  where coalesce((r->>'delete_result')::boolean,false)=false;
  return query select v_saved.*;
end $$;

revoke all on function public.open_training_player_collection(uuid,uuid) from public,anon;
revoke all on function public.get_training_player_collection_details(uuid) from public,anon;
revoke all on function public.get_my_training_result_tasks(uuid) from public,anon;
revoke all on function public.submit_my_training_result(uuid,integer,integer,numeric,text,uuid,integer) from public,anon;
revoke all on function public.retrieve_training_player_results(uuid,uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.arbitrate_training_player_result(uuid,text,uuid,integer,uuid,uuid) from public,anon;
revoke all on function public.save_training_session_player_results(uuid,integer,uuid,uuid,uuid,uuid,uuid,date,text,text,integer,text,jsonb,jsonb,jsonb,boolean,jsonb) from public,anon;
grant execute on function public.open_training_player_collection(uuid,uuid) to authenticated;
grant execute on function public.get_training_player_collection_details(uuid) to authenticated;
grant execute on function public.get_my_training_result_tasks(uuid) to authenticated;
grant execute on function public.submit_my_training_result(uuid,integer,integer,numeric,text,uuid,integer) to authenticated;
grant execute on function public.retrieve_training_player_results(uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.arbitrate_training_player_result(uuid,text,uuid,integer,uuid,uuid) to authenticated;
grant execute on function public.save_training_session_player_results(uuid,integer,uuid,uuid,uuid,uuid,uuid,date,text,text,integer,text,jsonb,jsonb,jsonb,boolean,jsonb) to authenticated;

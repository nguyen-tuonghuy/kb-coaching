-- Lot C2 - Bail d'edition exclusif des seances d'entrainement.
--
-- Le bail est l'autorite serveur. Une ecriture protegee doit presenter :
--   * l'utilisateur authentifie (auth.uid()) ;
--   * l'instance d'edition (un UUID propre a l'onglet) ;
--   * un jeton UUID non predictible emis par PostgreSQL.
--
-- La table reste inaccessible aux clients. Les RPC SECURITY DEFINER ont un
-- search_path vide et qualifient explicitement tous les objets. La grande RPC
-- save_training_session reste SECURITY INVOKER afin de conserver les RLS.
--
-- Exclusivité : activate_training_session_lease prend un verrou FOR UPDATE sur la
-- ligne du bail (bail avant seance, ordre constant) ; acquire doit donc attendre la
-- fin de toute edition en cours. L'autorisation du bail délègue aux fonctions
-- d'autorisation des policies RLS (is_group_coach / can_edit_workspace).
--
-- Ecritures directes (collecte live) : elles ne passent pas par activate. Un declencheur
-- BEFORE STATEMENT (private.lock_live_training_session_lease) verrouille la ligne du bail
-- AVANT tout verrou de ligne, par (user, instance, jeton), si bien que acquire ne peut pas
-- reattribuer le bail pendant une ecriture live en cours. L'ordre bail -> lignes est
-- identique au chemin save (activate), d'ou l'absence de cycle de verrouillage.
--
-- Suppression : le bail porte une FK NO ACTION DEFERRABLE INITIALLY DEFERRED vers la seance
-- (pas CASCADE, car PostgreSQL execute les actions referentielles meme differees). Le bail
-- est supprime explicitement, dans le bon ordre de transaction, par
-- delete_training_session_with_lease.

create table public.training_session_leases (
  session_id uuid primary key,
  user_id uuid not null,
  instance_id uuid not null,
  lease_token uuid not null default gen_random_uuid(),
  acquired_at timestamptz not null default statement_timestamp(),
  heartbeat_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  constraint training_session_leases_expiry_check check (expires_at > acquired_at),
  -- NO ACTION DEFERRABLE volontaire, PAS un ON DELETE CASCADE : PostgreSQL execute les
  -- actions referentielles (CASCADE) immediatement, meme pour une contrainte differee
  -- (doc CREATE TABLE : « Referential actions are executed as part of the data changing
  -- command, even if the constraint is deferred »). Un CASCADE supprimerait donc le bail
  -- pendant la suppression de la seance, dans un ordre non garanti vis-a-vis des triggers
  -- de garde des lignes enfants (echec 55000 possible). NO ACTION differe ne declenche
  -- aucune action : la suppression explicite du bail (delete_training_session_with_lease)
  -- reste ordonnee par le code, apres la suppression de la seance, puis la verification FK
  -- differee passe au commit. Garantie : aucun bail orphelin ne peut survivre a la
  -- suppression de sa seance (une suppression hors RPC echouerait au commit).
  constraint training_session_leases_session_fk foreign key (session_id)
    references public.training_sessions(id)
    on delete no action deferrable initially deferred
);

comment on table public.training_session_leases is
  'Bail exclusif d edition d une seance. Aucun acces table client : lecture et mutation par RPC uniquement.';

create index training_session_leases_expires_at_idx
  on public.training_session_leases(expires_at);

-- Le jeton identifie une ligne de bail de facon unique : necessaire au verrouillage
-- BEFORE STATEMENT par jeton (private.lock_live_training_session_lease).
create unique index training_session_leases_token_idx
  on public.training_session_leases(lease_token);

alter table public.training_session_leases enable row level security;
revoke all on table public.training_session_leases from public, anon, authenticated;

-- Autorisation du bail déléguée aux fonctions d'autorisation canoniques, celles-là
-- mêmes que les policies RLS de public.training_sessions. Dupliquer le prédicat
-- (is_group_coach OU can_edit_workspace) ferait diverger le verrouillage des RLS si
-- les policies évoluaient ; la délégation garantit une autorisation identique à
-- l'édition réelle, y compris pour un entraîneur du groupe rattaché à un autre
-- workspace. SECURITY DEFINER + search_path vide : l'appel aux fonctions du schéma
-- private reste interne, le rôle authenticated n'a toujours pas besoin d'USAGE.
create or replace function private.training_session_user_authorized(
  p_session_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
      select 1
      from public.training_sessions s
      where s.id = p_session_id
        and (
          private.is_group_coach(s.group_id)
          or private.can_edit_workspace(s.workspace_id)
        )
    )
$$;

revoke all on function private.training_session_user_authorized(uuid, uuid)
  from public, anon, authenticated;

create or replace function private.assert_training_session_lease(
  p_session_id uuid,
  p_user_id uuid,
  p_instance_id uuid,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null
     or p_session_id is null
     or p_instance_id is null
     or p_lease_token is null
     or not exists (
       select 1
       from public.training_session_leases l
       where l.session_id = p_session_id
         and l.user_id = p_user_id
         and l.instance_id = p_instance_id
         and l.lease_token = p_lease_token
         and l.expires_at > statement_timestamp()
     )
  then
    raise exception 'Bail d edition absent, expire ou detenu par une autre instance'
      using errcode = '55000';
  end if;
end
$$;

revoke all on function private.assert_training_session_lease(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

-- Variante verrouillante utilisée uniquement par activate_training_session_lease.
-- Elle prend un SELECT ... FOR UPDATE sur la ligne du bail : toute acquisition
-- concurrente (acquire) doit attendre la fin de la transaction d'édition
-- (save_training_session / delete_training_session_with_lease). Une sauvegarde ne
-- peut donc plus committer après l'expiration ET la réattribution de son bail.
-- ORDRE DE VERROUILLAGE : activate est toujours la première instruction de l'écriture,
-- on verrouille donc le bail AVANT la séance et ses enfants. Les triggers de ligne du
-- garde-fou n'appellent que assert_training_session_lease (lecture sans verrou) ; le
-- verrou des ecritures live est pose en amont par private.lock_live_training_session_lease
-- (BEFORE STATEMENT, donc avant tout verrou de ligne). Tout chemin de verrouillage prend
-- le bail en premier : aucune inversion bail/lignes, donc pas de cycle de verrouillage.
create or replace function private.lock_training_session_lease(
  p_session_id uuid,
  p_user_id uuid,
  p_instance_id uuid,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if p_user_id is null
     or p_session_id is null
     or p_instance_id is null
     or p_lease_token is null then
    raise exception 'Bail d edition absent, expiré ou détenu par une autre instance'
      using errcode = '55000';
  end if;

  select true into v_ok
    from public.training_session_leases l
    where l.session_id = p_session_id
      and l.user_id = p_user_id
      and l.instance_id = p_instance_id
      and l.lease_token = p_lease_token
      and l.expires_at > statement_timestamp()
    for update;

  if v_ok is not true then
    raise exception 'Bail d edition absent, expiré ou détenu par une autre instance'
      using errcode = '55000';
  end if;
end
$$;

revoke all on function private.lock_training_session_lease(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.acquire_training_session_lease(
  p_session_id uuid,
  p_instance_id uuid
)
returns table(
  status text,
  holder_user_id uuid,
  holder_name text,
  lease_token uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token uuid;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if p_session_id is null or p_instance_id is null then
    raise exception 'Séance et instance requises' using errcode = '22023';
  end if;
  if not private.training_session_user_authorized(p_session_id, v_uid) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  insert into public.training_session_leases as l
    (session_id, user_id, instance_id, lease_token, acquired_at, heartbeat_at, expires_at)
  values
    (p_session_id, v_uid, p_instance_id, gen_random_uuid(), statement_timestamp(),
     statement_timestamp(), statement_timestamp() + interval '90 seconds')
  on conflict (session_id) do update set
    user_id = excluded.user_id,
    instance_id = excluded.instance_id,
    lease_token = excluded.lease_token,
    acquired_at = excluded.acquired_at,
    heartbeat_at = excluded.heartbeat_at,
    expires_at = excluded.expires_at
  where l.expires_at <= statement_timestamp()
  returning l.lease_token, l.expires_at into v_token, v_expires;

  if v_token is not null then
    return query select 'acquired'::text, v_uid,
      (select p.first_name from public.user_profiles p where p.user_id = v_uid),
      v_token, v_expires;
    return;
  end if;

  return query
    select 'held'::text, l.user_id, p.first_name, null::uuid, l.expires_at
    from public.training_session_leases l
    left join public.user_profiles p on p.user_id = l.user_id
    where l.session_id = p_session_id
      and l.expires_at > statement_timestamp();
end
$$;

revoke all on function public.acquire_training_session_lease(uuid, uuid) from public, anon;
grant execute on function public.acquire_training_session_lease(uuid, uuid) to authenticated;

create or replace function public.renew_training_session_lease(
  p_session_id uuid,
  p_instance_id uuid,
  p_lease_token uuid
)
returns table(status text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  update public.training_session_leases l set
    heartbeat_at = statement_timestamp(),
    expires_at = statement_timestamp() + interval '90 seconds'
  where l.session_id = p_session_id
    and l.user_id = v_uid
    and l.instance_id = p_instance_id
    and l.lease_token = p_lease_token
    and l.expires_at > statement_timestamp()
  returning l.expires_at into v_expires;

  if v_expires is null then
    return query select 'lost'::text, null::timestamptz;
  else
    return query select 'renewed'::text, v_expires;
  end if;
end
$$;

revoke all on function public.renew_training_session_lease(uuid, uuid, uuid) from public, anon;
grant execute on function public.renew_training_session_lease(uuid, uuid, uuid) to authenticated;

create or replace function public.release_training_session_lease(
  p_session_id uuid,
  p_instance_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted integer;
begin
  if v_uid is null then
    return false;
  end if;

  delete from public.training_session_leases l
  where l.session_id = p_session_id
    and l.user_id = v_uid
    and l.instance_id = p_instance_id
    and l.lease_token = p_lease_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end
$$;

revoke all on function public.release_training_session_lease(uuid, uuid, uuid) from public, anon;
grant execute on function public.release_training_session_lease(uuid, uuid, uuid) to authenticated;

create or replace function public.get_training_session_lease(p_session_id uuid)
returns table(
  status text,
  holder_user_id uuid,
  holder_name text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if not private.training_session_user_authorized(p_session_id, v_uid) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  return query
    select 'held'::text, l.user_id, p.first_name, l.expires_at
    from public.training_session_leases l
    left join public.user_profiles p on p.user_id = l.user_id
    where l.session_id = p_session_id
      and l.expires_at > statement_timestamp();
  if found then return; end if;
  return query select 'free'::text, null::uuid, null::text, null::timestamptz;
end
$$;

revoke all on function public.get_training_session_lease(uuid) from public, anon;
grant execute on function public.get_training_session_lease(uuid) to authenticated;

-- Cette fonction ne cree aucun droit persistant. Les variables sont locales a la
-- transaction PostgREST courante ; un client ne peut donc pas l'appeler dans une
-- requete puis reutiliser ce contexte dans une autre requete.
-- Elle verrouille la ligne du bail (SELECT ... FOR UPDATE) pour sérialiser avec acquire :
-- une écriture en cours interdit toute réattribution tant qu'elle n'est pas terminée.
create or replace function public.activate_training_session_lease(
  p_session_id uuid,
  p_instance_id uuid,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  perform private.lock_training_session_lease(
    p_session_id, v_uid, p_instance_id, p_lease_token
  );
  perform pg_catalog.set_config('kinball.training_session_id', p_session_id::text, true);
  perform pg_catalog.set_config('kinball.editor_instance_id', p_instance_id::text, true);
  perform pg_catalog.set_config('kinball.lease_token', p_lease_token::text, true);
end
$$;

revoke all on function public.activate_training_session_lease(uuid, uuid, uuid) from public, anon;
grant execute on function public.activate_training_session_lease(uuid, uuid, uuid) to authenticated;

create or replace function private.guard_training_session_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_context_session text;
  v_instance_text text;
  v_token_text text;
  v_headers jsonb := '{}'::jsonb;
  v_instance_id uuid;
  v_lease_token uuid;
begin
  if tg_op = 'DELETE' then
    v_session_id := old.session_id;
  else
    v_session_id := new.session_id;
  end if;

  if tg_op = 'UPDATE' and new.session_id is distinct from old.session_id then
    raise exception 'La seance d une ligne protegee ne peut pas etre modifiee'
      using errcode = '22023';
  end if;

  v_context_session := nullif(pg_catalog.current_setting('kinball.training_session_id', true), '');
  v_instance_text := nullif(pg_catalog.current_setting('kinball.editor_instance_id', true), '');
  v_token_text := nullif(pg_catalog.current_setting('kinball.lease_token', true), '');

  if v_instance_text is null or v_token_text is null then
    begin
      v_headers := coalesce(
        nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb,
        '{}'::jsonb
      );
      v_instance_text := nullif(v_headers ->> 'x-kb-editor-instance-id', '');
      v_token_text := nullif(v_headers ->> 'x-kb-lease-token', '');
    exception when others then
      raise exception 'Informations de bail invalides' using errcode = '55000';
    end;
  end if;

  begin
    v_instance_id := v_instance_text::uuid;
    v_lease_token := v_token_text::uuid;
  exception when invalid_text_representation then
    raise exception 'Informations de bail invalides' using errcode = '55000';
  end;

  if v_context_session is not null and v_context_session::uuid is distinct from v_session_id then
    raise exception 'Bail actif pour une autre seance' using errcode = '55000';
  end if;

  perform private.assert_training_session_lease(
    v_session_id, auth.uid(), v_instance_id, v_lease_token
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

revoke all on function private.guard_training_session_lease()
  from public, anon, authenticated;

create or replace function private.guard_training_session_parent_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance_id uuid;
  v_lease_token uuid;
begin
  begin
    v_instance_id := nullif(pg_catalog.current_setting('kinball.editor_instance_id', true), '')::uuid;
    v_lease_token := nullif(pg_catalog.current_setting('kinball.lease_token', true), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Informations de bail invalides' using errcode = '55000';
  end;
  perform private.assert_training_session_lease(
    old.id, auth.uid(), v_instance_id, v_lease_token
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

revoke all on function private.guard_training_session_parent_lease()
  from public, anon, authenticated;

-- Verrouillage BEFORE STATEMENT des ecritures directes (chemin live). Contrairement au
-- trigger de ligne (qui s'execute apres le verrou de la ligne modifiee), un trigger
-- STATEMENT s'execute avant tout verrou de ligne : on verrouille donc la ligne du bail
-- AVANT les lignes metier, ce qui preserve l'ordre constant bail -> lignes et evite tout
-- deadlock avec activate/acquire/renew/release (qui ne verrouillent que le bail).
-- Le verrou porte sur user + instance + jeton, jamais sur le seul session_id : un client ne
-- peut pas s'approprier un bail en devinant une seance. La validation autoritaire du
-- session_id reel de la ligne reste faite par private.guard_training_session_lease.
-- Sans jeton exploitable (config absente et en-tetes absents/invalides), la fonction ne
-- verrouille rien et laisse le trigger de ligne refuser l'ecriture (aucune ecriture sans bail).
create or replace function private.lock_live_training_session_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance_text text;
  v_token_text text;
  v_headers jsonb := '{}'::jsonb;
  v_instance_id uuid;
  v_lease_token uuid;
begin
  v_instance_text := nullif(pg_catalog.current_setting('kinball.editor_instance_id', true), '');
  v_token_text := nullif(pg_catalog.current_setting('kinball.lease_token', true), '');

  if v_instance_text is null or v_token_text is null then
    begin
      v_headers := coalesce(
        nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb,
        '{}'::jsonb
      );
      v_instance_text := nullif(v_headers ->> 'x-kb-editor-instance-id', '');
      v_token_text := nullif(v_headers ->> 'x-kb-lease-token', '');
    exception when others then
      raise exception 'Informations de bail invalides' using errcode = '55000';
    end;
  end if;

  -- Aucun jeton exploitable : le trigger de ligne reste l'autorite et refusera l'ecriture.
  if v_instance_text is null or v_token_text is null then
    return null;
  end if;

  begin
    v_instance_id := v_instance_text::uuid;
    v_lease_token := v_token_text::uuid;
  exception when invalid_text_representation then
    raise exception 'Informations de bail invalides' using errcode = '55000';
  end;

  -- Verrou AVANT tout verrou de ligne metier : ordre bail -> lignes. Si le jeton ne
  -- correspond a aucun bail valide, aucune ligne n'est verrouillee ; le trigger de ligne
  -- refusera ensuite l'ecriture.
  perform 1
    from public.training_session_leases l
    where l.user_id = auth.uid()
      and l.instance_id = v_instance_id
      and l.lease_token = v_lease_token
      and l.expires_at > statement_timestamp()
    for update;

  return null;
end
$$;

revoke all on function private.lock_live_training_session_lease()
  from public, anon, authenticated;

drop trigger if exists trg_training_sessions_edit_lease on public.training_sessions;
create trigger trg_training_sessions_edit_lease
before update or delete on public.training_sessions
for each row execute function private.guard_training_session_parent_lease();

drop trigger if exists trg_training_attendance_edit_lease on public.training_attendance;
create trigger trg_training_attendance_edit_lease
before insert or update or delete on public.training_attendance
for each row execute function private.guard_training_session_lease();

drop trigger if exists trg_training_session_exercises_edit_lease on public.training_session_exercises;
create trigger trg_training_session_exercises_edit_lease
before insert or update or delete on public.training_session_exercises
for each row execute function private.guard_training_session_lease();

drop trigger if exists trg_training_results_edit_lease on public.training_results;
create trigger trg_training_results_edit_lease
before insert or update or delete on public.training_results
for each row execute function private.guard_training_session_lease();

-- Les tables live existent sur la base publiee mais leur historique SQL n'est pas
-- complet dans ce depot. Le branchement conditionnel conserve donc la reproductibilite
-- du depot sans masquer l'absence eventuelle des tables sur une base cible.
do $$
begin
  if to_regclass('public.training_live_periods') is not null then
    execute 'drop trigger if exists trg_training_live_periods_edit_lease on public.training_live_periods';
    execute 'create trigger trg_training_live_periods_edit_lease before insert or update or delete on public.training_live_periods for each row execute function private.guard_training_session_lease()';
  end if;
  if to_regclass('public.training_live_events') is not null then
    execute 'drop trigger if exists trg_training_live_events_edit_lease on public.training_live_events';
    execute 'create trigger trg_training_live_events_edit_lease before insert or update or delete on public.training_live_events for each row execute function private.guard_training_session_lease()';
  end if;
end
$$;

-- Verrouillage BEFORE STATEMENT des memes tables que le garde-fou de ligne. Il pose le
-- verrou du bail AVANT tout verrou de ligne (ordre bail -> lignes). Le garde-fou de ligne
-- reste l'autorite : il verifie le session_id reel de chaque ligne modifiee.
drop trigger if exists trg_training_attendance_edit_lease_lock on public.training_attendance;
create trigger trg_training_attendance_edit_lease_lock
before insert or update or delete on public.training_attendance
for each statement execute function private.lock_live_training_session_lease();

drop trigger if exists trg_training_session_exercises_edit_lease_lock on public.training_session_exercises;
create trigger trg_training_session_exercises_edit_lease_lock
before insert or update or delete on public.training_session_exercises
for each statement execute function private.lock_live_training_session_lease();

drop trigger if exists trg_training_results_edit_lease_lock on public.training_results;
create trigger trg_training_results_edit_lease_lock
before insert or update or delete on public.training_results
for each statement execute function private.lock_live_training_session_lease();

do $$
begin
  if to_regclass('public.training_live_periods') is not null then
    execute 'drop trigger if exists trg_training_live_periods_edit_lease_lock on public.training_live_periods';
    execute 'create trigger trg_training_live_periods_edit_lease_lock before insert or update or delete on public.training_live_periods for each statement execute function private.lock_live_training_session_lease()';
  end if;
  if to_regclass('public.training_live_events') is not null then
    execute 'drop trigger if exists trg_training_live_events_edit_lease_lock on public.training_live_events';
    execute 'create trigger trg_training_live_events_edit_lease_lock before insert or update or delete on public.training_live_events for each statement execute function private.lock_live_training_session_lease()';
  end if;
end
$$;

-- Supprimer explicitement l'ancienne signature : la laisser en surcharge offrirait
-- un contournement complet du bail aux clients mis en cache.
revoke all on function public.save_training_session(
  uuid, integer, uuid, uuid, uuid, date, text, text, integer, text,
  jsonb, jsonb, jsonb, boolean
) from public, anon, authenticated;
drop function public.save_training_session(
  uuid, integer, uuid, uuid, uuid, date, text, text, integer, text,
  jsonb, jsonb, jsonb, boolean
);

create function public.save_training_session(
  p_session_id uuid,
  p_expected_version integer,
  p_editor_instance_id uuid,
  p_lease_token uuid default null,
  p_workspace_id uuid default null,
  p_group_id uuid default null,
  p_team_id uuid default null,
  p_trained_on date default null,
  p_label text default null,
  p_theme text default null,
  p_duration_minutes integer default null,
  p_notes text default null,
  p_attendance jsonb default '[]'::jsonb,
  p_exercises jsonb default '[]'::jsonb,
  p_results jsonb default '[]'::jsonb,
  p_force boolean default false
)
returns table(
  status text,
  session_id uuid,
  version integer,
  updated_at timestamptz,
  remote_version integer,
  lease_token uuid,
  lease_expires_at timestamptz
)
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_group uuid;
  v_version integer;
  v_updated timestamptz;
  v_sid uuid;
  v_token uuid := p_lease_token;
  v_lease_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if p_editor_instance_id is null then
    raise exception 'Instance d édition requise' using errcode = '22023';
  end if;
  if p_group_id is null then
    raise exception 'Groupe requis' using errcode = '22023';
  end if;
  if p_team_id is null then
    raise exception 'Équipe requise' using errcode = '22023';
  end if;
  if p_duration_minutes is not null and p_duration_minutes < 0 then
    raise exception 'Durée invalide' using errcode = '22023';
  end if;

  if p_session_id is null then
    if p_workspace_id is null then
      raise exception 'Workspace requis' using errcode = '22023';
    end if;
    if not exists (select 1 from public.teams t
                   where t.id = p_team_id and t.workspace_id = p_workspace_id) then
      raise exception 'Équipe hors du workspace' using errcode = '22023';
    end if;
    v_ws := p_workspace_id;

    insert into public.training_sessions as s
      (workspace_id, group_id, team_id, trained_on, label, theme, duration_minutes, notes)
    values
      (v_ws, p_group_id, p_team_id, coalesce(p_trained_on, current_date),
       coalesce(nullif(btrim(p_label), ''), 'Entraînement'), nullif(btrim(p_theme), ''),
       p_duration_minutes, p_notes)
    returning s.id, s.version, s.updated_at into v_sid, v_version, v_updated;

    select a.lease_token, a.expires_at
      into v_token, v_lease_expires
      from public.acquire_training_session_lease(v_sid, p_editor_instance_id) a
      where a.status = 'acquired';
    if v_token is null then
      raise exception 'Bail d edition impossible apres creation' using errcode = '55000';
    end if;
    perform public.activate_training_session_lease(v_sid, p_editor_instance_id, v_token);
  else
    perform public.activate_training_session_lease(
      p_session_id, p_editor_instance_id, p_lease_token
    );

    select s.workspace_id, s.group_id, s.version, s.updated_at
      into v_ws, v_group, v_version, v_updated
      from public.training_sessions s
      where s.id = p_session_id
      for update;
    if not found then
      raise exception 'Séance introuvable' using errcode = 'P0002';
    end if;
    if v_group is distinct from p_group_id then
      raise exception 'Séance hors du groupe' using errcode = '22023';
    end if;
    if not exists (select 1 from public.teams t
                   where t.id = p_team_id and t.workspace_id = v_ws) then
      raise exception 'Équipe hors du workspace de la séance' using errcode = '22023';
    end if;

    if not p_force and (p_expected_version is null or v_version <> p_expected_version) then
      return query select 'conflict'::text, p_session_id, null::integer,
        v_updated, v_version, null::uuid, null::timestamptz;
      return;
    end if;

    update public.training_sessions s set
      team_id = p_team_id,
      trained_on = coalesce(p_trained_on, s.trained_on),
      label = coalesce(nullif(btrim(p_label), ''), 'Entraînement'),
      theme = nullif(btrim(p_theme), ''),
      duration_minutes = p_duration_minutes,
      notes = p_notes
      where s.id = p_session_id
      returning s.version, s.updated_at into v_version, v_updated;
    if not found then
      raise exception 'Mise à jour refusée' using errcode = '42501';
    end if;
    v_sid := p_session_id;
  end if;

  if exists (select 1 from jsonb_array_elements(p_attendance) e
             where not exists (select 1 from public.coaching_group_players gp
                               where gp.group_id = p_group_id
                                 and gp.player_id = (e->>'player_id')::uuid)
               and (p_session_id is null
                    or not exists (select 1 from public.training_attendance olda
                                   where olda.session_id = v_sid
                                     and olda.player_id = (e->>'player_id')::uuid)))
  then
    raise exception 'Joueur non autorisé' using errcode = '23503';
  end if;

  if exists (select 1 from jsonb_array_elements(p_exercises) e
             where not exists (select 1 from public.exercises ex
                               where ex.id = (e->>'exercise_id')::uuid))
  then
    raise exception 'Exercice introuvable' using errcode = '23503';
  end if;

  if exists (select 1 from jsonb_array_elements(p_results) e
             where not exists (select 1 from jsonb_array_elements(p_exercises) x
                               where (x->>'exercise_id')::uuid = (e->>'exercise_id')::uuid)
                or not exists (select 1 from jsonb_array_elements(p_attendance) a
                               where (a->>'player_id')::uuid = (e->>'player_id')::uuid
                                 and (a->>'present')::boolean))
  then
    raise exception 'Résultat incohérent' using errcode = '23514';
  end if;

  delete from public.training_attendance ta
    where ta.session_id = v_sid
      and not exists (select 1 from jsonb_array_elements(p_attendance) a
                      where (a->>'player_id')::uuid = ta.player_id);

  update public.training_attendance ta
    set present = s.present
    from (select (e->>'player_id')::uuid as player_id, (e->>'present')::boolean as present
          from jsonb_array_elements(p_attendance) e) s
    where ta.session_id = v_sid and ta.player_id = s.player_id;

  insert into public.training_attendance(session_id, player_id, present)
    select v_sid, s.player_id, s.present
    from (select (e->>'player_id')::uuid as player_id, (e->>'present')::boolean as present
          from jsonb_array_elements(p_attendance) e) s
    where not exists (select 1 from public.training_attendance ta
                      where ta.session_id = v_sid and ta.player_id = s.player_id);

  delete from public.training_session_exercises tse where tse.session_id = v_sid;
  insert into public.training_session_exercises(session_id, exercise_id, position, variant, target, focus)
    select v_sid, (e->>'exercise_id')::uuid, (e->>'position')::int,
           nullif(e->>'variant', ''), nullif(e->>'target', ''), nullif(e->>'focus', '')
    from jsonb_array_elements(p_exercises) e;

  delete from public.training_results tr
    where tr.session_id = v_sid and tr.variant is null;
  insert into public.training_results(session_id, exercise_id, player_id, successes, attempts, numeric_value, note)
    select v_sid, (e->>'exercise_id')::uuid, (e->>'player_id')::uuid,
           nullif(e->>'successes', '')::int, nullif(e->>'attempts', '')::int,
           nullif(e->>'numeric_value', '')::numeric, nullif(e->>'note', '')
    from jsonb_array_elements(p_results) e;

  return query select 'saved'::text, v_sid, v_version, v_updated, null::integer,
    v_token, v_lease_expires;
end
$$;

revoke all on function public.save_training_session(
  uuid, integer, uuid, uuid, uuid, uuid, uuid, date, text, text, integer,
  text, jsonb, jsonb, jsonb, boolean
) from public, anon;
grant execute on function public.save_training_session(
  uuid, integer, uuid, uuid, uuid, uuid, uuid, date, text, text, integer,
  text, jsonb, jsonb, jsonb, boolean
) to authenticated;

create or replace function public.delete_training_session_with_lease(
  p_session_id uuid,
  p_instance_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  perform public.activate_training_session_lease(
    p_session_id, p_instance_id, p_lease_token
  );
  delete from public.training_sessions s where s.id = p_session_id;
  get diagnostics v_deleted = row_count;
  -- Suppression du bail explicite et inconditionnelle, apres la suppression de la seance
  -- et de ses enfants (ordre maitrise par le code, pas par les cascades referentielles).
  -- Aucun bail orphelin ne subsiste, meme si la seance etait deja absente. Comme le bail
  -- porte une FK differee NO ACTION, un bail residuel ferait echouer le commit : la
  -- suppression est donc garantie d'etre atomique avec le nettoyage du bail.
  perform public.release_training_session_lease(
    p_session_id, p_instance_id, p_lease_token
  );
  return v_deleted > 0;
end
$$;

revoke all on function public.delete_training_session_with_lease(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.delete_training_session_with_lease(uuid, uuid, uuid)
  to authenticated;

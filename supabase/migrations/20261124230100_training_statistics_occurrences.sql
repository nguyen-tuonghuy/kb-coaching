-- Keep the two existing views and aliases. Occurrence references are scoped to
-- this payload, like its session and result references, and never expose UUIDs.
create or replace function public.get_training_statistics_dataset(p_group_id uuid,p_view text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_view text:=lower(btrim(coalesce(p_view,'')));
  v_self uuid; v_self_name text; v_dataset jsonb;
begin
  if v_uid is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  if v_view not in ('player','staff') then raise exception 'Vue de statistiques invalide' using errcode='22023'; end if;
  if v_view='staff' then
    if not exists (select 1 from public.coaching_group_coaches c where c.group_id=p_group_id and c.user_id=v_uid) then
      raise exception 'Acces entraineur aux statistiques refuse' using errcode='42501';
    end if;
  else
    select a.player_id,p.display_name into v_self,v_self_name
    from public.coaching_player_accounts a
    join public.coaching_group_players gp on (gp.group_id,gp.player_id)=(a.group_id,a.player_id)
    join public.players p on p.id=a.player_id
    where a.group_id=p_group_id and a.user_id=v_uid and gp.active and gp.stats_access='group';
    if v_self is null then raise exception 'Acces aux statistiques du groupe refuse' using errcode='42501'; end if;
  end if;
  if not exists (select 1 from public.coaching_groups g where g.id=p_group_id) then
    raise exception 'Groupe introuvable' using errcode='P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_id::text,0));

  with candidates as (
    select gp.player_id from public.coaching_group_players gp where gp.group_id=p_group_id and gp.active
    union select a.player_id from public.training_attendance a join public.training_sessions s on s.id=a.session_id where s.group_id=p_group_id
    union select r.player_id from public.training_results r join public.training_sessions s on s.id=r.session_id where s.group_id=p_group_id
  ), missing as (
    select c.player_id,row_number() over(order by c.player_id) offset_number from candidates c
    where not exists (select 1 from private.training_stats_player_aliases a where a.group_id=p_group_id and a.player_id=c.player_id)
  ), current_max as (
    select coalesce(max(a.alias_number),0) value from private.training_stats_player_aliases a where a.group_id=p_group_id
  )
  insert into private.training_stats_player_aliases(group_id,player_id,alias_number)
  select p_group_id,m.player_id,cm.value+m.offset_number from missing m cross join current_max cm
  on conflict (group_id,player_id) do nothing;

  with sessions as (
    select s.id,s.trained_on,'session-'||row_number() over(order by s.trained_on,s.id) public_id
    from public.training_sessions s where s.group_id=p_group_id
  ), results as (
    select r.*,row_number() over(order by r.id) public_number from public.training_results r join sessions s on s.id=r.session_id
  ), candidates as (
    select gp.player_id from public.coaching_group_players gp where gp.group_id=p_group_id and gp.active
    union select a.player_id from public.training_attendance a join sessions s on s.id=a.session_id
    union select r.player_id from results r
  ), participants as (
    select a.player_id,a.alias_number,'participant-'||a.alias_number public_id,
      case when v_view='staff' then p.display_name when a.player_id=v_self then v_self_name
        else private.training_stats_alias_label(a.alias_number) end display_name,
      a.player_id=v_self is_me
    from private.training_stats_player_aliases a join candidates c on c.player_id=a.player_id
    join public.players p on p.id=a.player_id where a.group_id=p_group_id
  ), occurrence_ids as (
    select x.session_id,x.occurrence_id from public.training_session_exercises x join sessions s on s.id=x.session_id where x.occurrence_id is not null
    union select r.session_id,r.occurrence_id from results r where r.occurrence_id is not null
  ), occurrences as (
    select o.*,'occurrence-'||row_number() over(order by o.session_id,o.occurrence_id) public_id from occurrence_ids o
  )
  select jsonb_build_object(
    'viewer_role',v_view,
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.public_id,'trained_on',s.trained_on) order by s.trained_on,s.public_id) from sessions s),'[]'::jsonb),
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.public_id,'display_name',p.display_name,
      'is_me',p.is_me,'ranking_order',p.alias_number) order by p.alias_number) from participants p),'[]'::jsonb),
    'attendance',coalesce((select jsonb_agg(jsonb_build_object('session_id',s.public_id,'player_id',p.public_id,
      'present',a.present) order by s.public_id,p.alias_number)
      from public.training_attendance a join sessions s on s.id=a.session_id join participants p on p.player_id=a.player_id),'[]'::jsonb),
    'session_exercises',coalesce((select jsonb_agg(jsonb_build_object('session_id',s.public_id,'occurrence_id',o.public_id,
      'exercise_id',e.id,'focus',x.focus,'position',x.position,'exercise',jsonb_build_object('id',e.id,'name',e.name,
        'category',e.category,'category_id',e.category_id,'copied_from_exercise_id',e.copied_from_exercise_id,
        'measurement_type',e.measurement_type)) order by s.public_id,x.position)
      from public.training_session_exercises x join sessions s on s.id=x.session_id join public.exercises e on e.id=x.exercise_id
      left join occurrences o on (o.session_id,o.occurrence_id)=(x.session_id,x.occurrence_id)),'[]'::jsonb),
    'results',coalesce((select jsonb_agg(jsonb_build_object('id','result-'||r.public_number,'session_id',s.public_id,
      'occurrence_id',o.public_id,'exercise_id',r.exercise_id,'player_id',p.public_id,'successes',r.successes,
      'attempts',r.attempts,'numeric_value',r.numeric_value,'created_at',null) order by r.public_number)
      from results r join sessions s on s.id=r.session_id join participants p on p.player_id=r.player_id
      left join occurrences o on (o.session_id,o.occurrence_id)=(r.session_id,r.occurrence_id)),'[]'::jsonb)
  ) into v_dataset;
  return v_dataset;
end $$;

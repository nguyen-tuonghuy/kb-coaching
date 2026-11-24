const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

const root=path.resolve(__dirname,'..');
const readMigration=file=>fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');
const trainingMigration=readMigration('20261124173651_player_training_statistics.sql');
const viewMigration=readMigration('20261124180256_training_statistics_view_mode.sql');
const matchMigration=readMigration('20261124191500_group_match_stats_access.sql');

const COACH='11111111-1111-4111-8111-111111111111';
const COACH_ONLY='17171717-1717-4717-8717-171717171717';
const ALICE_USER='22222222-2222-4222-8222-222222222222';
const BOB_USER='33333333-3333-4333-8333-333333333333';
const CHARLIE_USER='44444444-4444-4444-8444-444444444444';
const OUTSIDER='55555555-5555-4555-8555-555555555555';
const GROUP='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GROUP_2='a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
const WORKSPACE='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORKSPACE_2='b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const TEAM='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OPPONENT_1='c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const OPPONENT_2='c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const TEAM_2='c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';
const OPPONENT_2_GROUP='c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4';
const ALICE='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BOB='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CHARLIE='ffffffff-ffff-4fff-8fff-ffffffffffff';
const DANA='14141414-1414-4414-8414-141414141414';
const ERIN='15151515-1515-4515-8515-151515151515';
const SESSION='12121212-1212-4212-8212-121212121212';
const EXERCISE='13131313-1313-4313-8313-131313131313';
const MATCH='21212121-2121-4212-8212-121212121212';
const MATCH_2='21212121-2121-4212-8212-121212121213';
const EVENT_1='31313131-3131-4313-8313-131313131313';
const EVENT_2='41414141-4141-4414-8414-141414141414';

const fixture=`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create schema private;
create table public.workspaces(id uuid primary key);
create table public.workspace_members(user_id uuid,workspace_id uuid,role text,primary key(user_id,workspace_id));
create table public.teams(id uuid primary key,workspace_id uuid,name text);
create table public.coaching_groups(id uuid primary key,name text);
create table public.players(id uuid primary key,display_name text,workspace_id uuid);
create table public.coaching_group_coaches(group_id uuid,user_id uuid,role text,primary key(group_id,user_id));
create table public.coaching_group_players(
  group_id uuid,player_id uuid,active boolean not null default true,
  stats_access text not null default 'personal',primary key(group_id,player_id));
create table public.coaching_player_accounts(group_id uuid,player_id uuid,user_id uuid,primary key(group_id,player_id));
create table public.exercises(
  id uuid primary key,name text,category text,category_id uuid,copied_from_exercise_id uuid,measurement_type text);
create table public.training_sessions(
  id uuid primary key,workspace_id uuid,group_id uuid,team_id uuid,trained_on date,label text,theme text);
create table public.training_attendance(session_id uuid,player_id uuid,present boolean,primary key(session_id,player_id));
create table public.training_session_exercises(
  id uuid primary key default gen_random_uuid(),session_id uuid,exercise_id uuid,focus text,position integer);
create table public.training_results(
  id uuid primary key default gen_random_uuid(),session_id uuid,exercise_id uuid,player_id uuid,
  successes integer,attempts integer,numeric_value numeric,note text,variant text);
create table public.match_types(id uuid primary key,name text);
create table public.matches(
  id uuid primary key,workspace_id uuid,group_id uuid,match_type_id uuid,team_id uuid,
  opponent_team_1_id uuid,opponent_team_2_id uuid,label text,played_on date);
create table public.match_players(match_id uuid,player_id uuid,primary key(match_id,player_id));
create table public.match_events(
  id uuid primary key,match_id uuid,player_id uuid,sequence_no integer,
  action_type text,result text,fault_type text,family text,zone text,restart_location text);
create table public.match_event_attributions(event_id uuid,player_id uuid,primary key(event_id,player_id));
create table public.match_event_lineup(event_id uuid,player_id uuid,primary key(event_id,player_id));

create function private.is_group_coach(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.coaching_group_coaches c
    where c.group_id = p_group_id and c.user_id = auth.uid()
  );
$$;
create function private.can_view_group_stats(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_group_coach(p_group_id) or exists (
    select 1
    from public.coaching_group_players gp
    join public.coaching_player_accounts a
      on a.group_id = gp.group_id and a.player_id = gp.player_id
    where gp.group_id = p_group_id and gp.active = true
      and gp.stats_access = 'group' and a.user_id = auth.uid()
  );
$$;
create function private.match_group_id(p_match_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select group_id from public.matches where id = p_match_id;
$$;
create function private.match_event_group_id(p_event_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.group_id from public.match_events e
  join public.matches m on m.id = e.match_id
  where e.id = p_event_id;
$$;
create function private.production_can_view_team_raw(p_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members wm
    join public.teams t on t.workspace_id = wm.workspace_id
    where t.id = p_team_id and wm.user_id = auth.uid()
  ) or exists (
    select 1 from public.matches m
    where (m.team_id = p_team_id
       or m.opponent_team_1_id = p_team_id
       or m.opponent_team_2_id = p_team_id)
      and private.can_view_group_stats(m.group_id)
  );
$$;
create function private.production_can_view_player_raw(p_player_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.coaching_group_players gp
    join public.coaching_group_coaches c on c.group_id = gp.group_id
    where gp.player_id = p_player_id and c.user_id = auth.uid()
  ) or exists (
    select 1 from public.players p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = p_player_id and wm.user_id = auth.uid()
  ) or exists (
    select 1 from public.coaching_player_accounts a
    where a.player_id = p_player_id and a.user_id = auth.uid()
  ) or exists (
    select 1
    from public.coaching_group_players gp
    join public.coaching_player_accounts a
      on a.group_id = gp.group_id and a.player_id = gp.player_id
    where gp.player_id = p_player_id and gp.active = true
      and gp.stats_access = 'group' and a.user_id = auth.uid()
  );
$$;
create function private.production_can_view_group_player_raw(p_group_id uuid, p_player_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_view_group_stats(p_group_id) or exists (
    select 1 from public.coaching_player_accounts a
    where a.group_id = p_group_id and a.player_id = p_player_id and a.user_id = auth.uid()
  );
$$;

grant usage on schema public to authenticated;
grant usage on schema private to authenticated;
grant select on all tables in schema public to authenticated;
grant execute on function private.is_group_coach(uuid) to authenticated;
grant execute on function private.can_view_group_stats(uuid) to authenticated;
grant execute on function private.match_group_id(uuid) to authenticated;
grant execute on function private.match_event_group_id(uuid) to authenticated;
grant execute on function private.production_can_view_team_raw(uuid) to authenticated;
grant execute on function private.production_can_view_player_raw(uuid) to authenticated;
grant execute on function private.production_can_view_group_player_raw(uuid, uuid) to authenticated;

alter table public.training_sessions enable row level security;
alter table public.training_attendance enable row level security;
alter table public.training_session_exercises enable row level security;
alter table public.training_results enable row level security;
alter table public.coaching_group_players enable row level security;
alter table public.players enable row level security;
alter table public.teams enable row level security;
alter table public.matches enable row level security;
alter table public.match_events enable row level security;
alter table public.match_players enable row level security;
alter table public.match_event_attributions enable row level security;
alter table public.match_event_lineup enable row level security;
create policy existing_training_sessions_read on public.training_sessions for select to authenticated using (true);
create policy existing_training_attendance_read on public.training_attendance for select to authenticated using (true);
create policy existing_training_exercises_read on public.training_session_exercises for select to authenticated using (true);
create policy existing_training_results_read on public.training_results for select to authenticated using (true);
create policy "coaches and group stats viewers read group players" on public.coaching_group_players for select to authenticated
  using (private.production_can_view_group_player_raw(group_id, player_id));
create policy "coaches and group stats viewers read players" on public.players for select to authenticated
  using (private.production_can_view_player_raw(id));
create policy "workspace members and group stats viewers read teams" on public.teams for select to authenticated
  using (private.production_can_view_team_raw(id));
create policy "coaches and group stats viewers read matches" on public.matches for select to authenticated
  using (private.can_view_group_stats(group_id));
create policy "coaches and group stats viewers read match events" on public.match_events for select to authenticated
  using (private.can_view_group_stats(private.match_group_id(match_id)));
create policy "coaches and group stats viewers read match players" on public.match_players for select to authenticated
  using (private.can_view_group_stats(private.match_group_id(match_id)));
create policy "coaches and group stats viewers read match attributions" on public.match_event_attributions for select to authenticated
  using (private.can_view_group_stats(private.match_event_group_id(event_id)));
create policy "coaches and group stats viewers read match lineup" on public.match_event_lineup for select to authenticated
  using (private.can_view_group_stats(private.match_event_group_id(event_id)));

insert into public.workspaces values ('${WORKSPACE}'),('${WORKSPACE_2}');
insert into public.teams values
  ('${TEAM}','${WORKSPACE}','Equipe'),
  ('${OPPONENT_1}','${WORKSPACE}','Adversaire A'),
  ('${OPPONENT_2}','${WORKSPACE}','Adversaire B'),
  ('${TEAM_2}','${WORKSPACE_2}','Equipe B'),
  ('${OPPONENT_2_GROUP}','${WORKSPACE_2}','Adversaire C');
insert into public.coaching_groups values ('${GROUP}','Groupe test'),('${GROUP_2}','Groupe B');
insert into public.players values
  ('${ALICE}','Alice','${WORKSPACE}'),
  ('${BOB}','Bob','${WORKSPACE}'),
  ('${CHARLIE}','Charlie','${WORKSPACE}'),
  ('${DANA}','Dana','${WORKSPACE}'),
  ('${ERIN}','Erin','${WORKSPACE_2}');
insert into public.coaching_group_coaches values
  ('${GROUP}','${COACH}','coach'),('${GROUP}','${COACH_ONLY}','coach'),('${GROUP_2}','${COACH}','coach');
insert into public.coaching_group_players values
  ('${GROUP}','${ALICE}',true,'group'),
  ('${GROUP}','${BOB}',true,'group'),
  ('${GROUP}','${CHARLIE}',true,'personal'),
  ('${GROUP}','${DANA}',true,'group'),
  ('${GROUP_2}','${DANA}',true,'personal'),
  ('${GROUP_2}','${ERIN}',true,'personal');
insert into public.coaching_player_accounts values
  ('${GROUP}','${ALICE}','${ALICE_USER}'),
  ('${GROUP}','${BOB}','${BOB_USER}'),
  ('${GROUP}','${CHARLIE}','${CHARLIE_USER}'),
  ('${GROUP}','${DANA}','${COACH}');
insert into public.exercises values ('${EXERCISE}','Passes',null,null,null,'success_attempts');
insert into public.training_sessions values
  ('${SESSION}','${WORKSPACE}','${GROUP}','${TEAM}','2026-11-20','Entrainement',null);
insert into public.training_attendance values ('${SESSION}','${ALICE}',true),('${SESSION}','${BOB}',true);
insert into public.training_session_exercises(session_id,exercise_id,focus,position)
  values ('${SESSION}','${EXERCISE}',null,1);
insert into public.training_results(session_id,exercise_id,player_id,successes,attempts)
  values ('${SESSION}','${EXERCISE}','${ALICE}',8,10),('${SESSION}','${EXERCISE}','${BOB}',6,10);
insert into public.match_types values ('33333333-3333-4333-8333-333333333333','Match amical');
insert into public.matches values
  ('${MATCH}','${WORKSPACE}','${GROUP}','33333333-3333-4333-8333-333333333333','${TEAM}','${OPPONENT_1}','${OPPONENT_2}','Match test','2026-11-21'),
  ('${MATCH_2}','${WORKSPACE_2}','${GROUP_2}','33333333-3333-4333-8333-333333333333','${TEAM_2}','${OPPONENT_2_GROUP}',null,'Match B','2026-11-22');
insert into public.match_players values
  ('${MATCH}','${ALICE}'),('${MATCH}','${BOB}'),('${MATCH}','${CHARLIE}'),('${MATCH}','${DANA}'),
  ('${MATCH_2}','${DANA}'),('${MATCH_2}','${ERIN}');
insert into public.match_events values
  ('${EVENT_1}','${MATCH}','${ALICE}',1,'point','Point marqué',null,null,'centre','all'),
  ('${EVENT_2}','${MATCH}','${BOB}',2,'defense','Ballon défendu',null,null,'ligne','all');
insert into public.match_event_attributions values ('${EVENT_1}','${ALICE}'),('${EVENT_1}','${BOB}');
insert into public.match_event_lineup values ('${EVENT_2}','${CHARLIE}'),('${EVENT_2}','${DANA}');
`;

async function makeDB(){
  const db=new PGlite();
  await db.exec(fixture);
  await db.exec(trainingMigration);
  await db.exec(viewMigration);
  await db.exec(matchMigration);
  return db;
}

async function asUser(db,userId){
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${userId}'`);
}

async function setMatchAccess(db,playerId,enabled){
  await db.exec(`reset role; update public.coaching_group_players set match_stats_access=${enabled} where player_id='${playerId}'`);
}

async function rows(db,sql){
  return (await db.query(sql)).rows;
}

async function trainingDataset(db,view){
  const result=await db.query(
    'select public.get_training_statistics_dataset($1::uuid,$2::text) as value',
    [GROUP,view]
  );
  return result.rows[0].value;
}

test('the new right is false by default and an explicitly authorized player can read match analyses',async()=>{
  const db=await makeDB();
  try{
    const initial=await rows(db,`select match_stats_access from public.coaching_group_players where player_id='${ALICE}'`);
    assert.equal(initial[0].match_stats_access,false);
    await setMatchAccess(db,ALICE,true);
    await asUser(db,ALICE_USER);
    assert.equal((await rows(db,'select id from public.matches')).length,1);
    assert.equal((await rows(db,'select id from public.match_events')).length,2);
    assert.equal((await rows(db,'select player_id from public.match_players')).length,4);
    assert.equal((await rows(db,'select player_id from public.match_event_attributions')).length,2);
    assert.equal((await rows(db,'select player_id from public.match_event_lineup')).length,2);
    assert.deepEqual((await rows(db,'select group_id,enabled from public.get_my_player_match_stats_access()')),[{group_id:GROUP,enabled:true}]);
    assert.deepEqual((await rows(db,'select display_name from public.players order by display_name')).map(x=>x.display_name),['Alice','Bob','Charlie','Dana']);
    assert.equal((await rows(db,'select player_id from public.coaching_group_players')).length,4);
    assert.equal((await rows(db,'select * from public.training_results')).length,0);
  }finally{await db.close()}
});

test('a personal-only active player with the match right can read the full match analysis dataset',async()=>{
  const db=await makeDB();
  try{
    const initial=(await rows(db,`select stats_access,match_stats_access,active from public.coaching_group_players where player_id='${CHARLIE}'`))[0];
    assert.deepEqual(initial,{stats_access:'personal',match_stats_access:false,active:true});
    assert.equal((await rows(db,`select private.can_view_group_stats('${GROUP}'::uuid) as value`))[0].value,false);
    await setMatchAccess(db,CHARLIE,true);
    await asUser(db,CHARLIE_USER);
    assert.equal((await rows(db,`select private.can_view_group_stats('${GROUP}'::uuid) as value`))[0].value,false);
    assert.equal((await rows(db,'select id from public.matches')).length,1);
    assert.equal((await rows(db,'select id from public.match_events')).length,2);
    assert.equal((await rows(db,'select player_id from public.match_players')).length,4);
    assert.equal((await rows(db,'select event_id from public.match_event_attributions')).length,2);
    assert.equal((await rows(db,'select event_id from public.match_event_lineup')).length,2);
    assert.deepEqual((await rows(db,'select display_name from public.players order by display_name')).map(x=>x.display_name),['Alice','Bob','Charlie','Dana']);
    assert.equal((await rows(db,'select player_id from public.coaching_group_players')).length,4);
    assert.deepEqual((await rows(db,'select group_id,enabled from public.get_my_player_match_stats_access()')),[{group_id:GROUP,enabled:true}]);
  }finally{await db.close()}
});

test('the match right is scoped to the authorized group even for a shared player',async()=>{
  const db=await makeDB();
  try{
    await setMatchAccess(db,CHARLIE,true);
    await asUser(db,CHARLIE_USER);
    assert.deepEqual((await rows(db,'select name from public.teams order by name')).map(x=>x.name),['Adversaire A','Adversaire B','Equipe']);
    assert.equal((await rows(db,`select id from public.matches where group_id='${GROUP}'::uuid`)).length,1);
    assert.equal((await rows(db,`select id from public.matches where group_id='${GROUP_2}'::uuid`)).length,0);
    assert.deepEqual((await rows(db,'select display_name from public.players order by display_name')).map(x=>x.display_name),['Alice','Bob','Charlie','Dana']);
    assert.deepEqual((await rows(db,'select distinct group_id from public.coaching_group_players order by group_id')).map(x=>x.group_id),[GROUP]);
    assert.equal((await rows(db,`select player_id from public.coaching_group_players where group_id='${GROUP_2}'::uuid`)).length,0);
    assert.equal((await rows(db,`select player_id from public.coaching_group_players where player_id='${DANA}'::uuid`)).length,1);
    assert.equal((await rows(db,`select player_id from public.match_players where match_id='${MATCH_2}'::uuid`)).length,0);
    assert.equal((await rows(db,`select id from public.teams where name in ('Equipe B','Adversaire C')`)).length,0);
  }finally{await db.close()}
});

test('a player without the new right keeps training access but cannot read matches',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,BOB_USER);
    assert.equal((await rows(db,`select private.can_view_group_stats('${GROUP}'::uuid) as value`))[0].value,true);
    assert.equal((await rows(db,'select id from public.matches')).length,0);
    assert.equal((await rows(db,'select id from public.match_events')).length,0);
    assert.equal((await rows(db,'select player_id from public.match_players')).length,0);
    assert.equal((await rows(db,'select player_id from public.match_event_attributions')).length,0);
    assert.equal((await rows(db,'select player_id from public.match_event_lineup')).length,0);
    assert.deepEqual((await rows(db,'select group_id,enabled from public.get_my_player_match_stats_access()')),[{group_id:GROUP,enabled:false}]);
    assert.deepEqual((await rows(db,'select display_name from public.players')).map(x=>x.display_name),['Bob']);
    const dataset=await trainingDataset(db,'player');
    assert.equal(dataset.players.find(player=>player.is_me).display_name,'Bob');
    assert.equal(JSON.stringify(dataset).includes('Alice'),false);
  }finally{await db.close()}
});

test('coaches keep full match and staff training access',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,COACH);
    assert.equal((await rows(db,'select id from public.matches')).length,2);
    assert.equal((await rows(db,'select id from public.match_events')).length,2);
    assert.deepEqual((await rows(db,'select display_name from public.players order by display_name')).map(x=>x.display_name),['Alice','Bob','Charlie','Dana','Erin']);
    assert.equal((await rows(db,'select id from public.teams')).length,5);
    assert.equal((await rows(db,'select player_id from public.coaching_group_players')).length,6);
    const dataset=await trainingDataset(db,'staff');
    assert.deepEqual(dataset.players.map(player=>player.display_name).sort(),['Alice','Bob','Charlie','Dana']);
    await asUser(db,COACH_ONLY);
    assert.equal((await rows(db,'select id from public.matches')).length,1);
    assert.deepEqual((await rows(db,'select display_name from public.players order by display_name')).map(x=>x.display_name),['Alice','Bob','Charlie','Dana']);
  }finally{await db.close()}
});

test('revoking the right removes match access but keeps training and personal identity',async()=>{
  const db=await makeDB();
  try{
    await setMatchAccess(db,ALICE,true);
    await asUser(db,ALICE_USER);
    assert.equal((await rows(db,'select id from public.matches')).length,1);
    await setMatchAccess(db,ALICE,false);
    await asUser(db,ALICE_USER);
    assert.equal((await rows(db,'select id from public.matches')).length,0);
    assert.equal((await rows(db,'select id from public.match_events')).length,0);
    assert.deepEqual((await rows(db,'select group_id,enabled from public.get_my_player_match_stats_access()')),[{group_id:GROUP,enabled:false}]);
    assert.deepEqual((await rows(db,'select display_name from public.players')).map(x=>x.display_name),['Alice']);
    const dataset=await trainingDataset(db,'player');
    assert.equal(dataset.players.find(player=>player.is_me).display_name,'Alice');
    assert.equal(JSON.stringify(dataset).includes('Bob'),false);
  }finally{await db.close()}
});

test('an outside account has no match right',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,OUTSIDER);
    assert.equal((await rows(db,'select id from public.matches')).length,0);
    assert.deepEqual(await rows(db,'select group_id,enabled from public.get_my_player_match_stats_access()'),[]);
  }finally{await db.close()}
});

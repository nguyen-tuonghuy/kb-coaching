const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261124120000_player_training_statistics.sql'),'utf8');

const COACH='11111111-1111-4111-8111-111111111111';
const ALICE_USER='22222222-2222-4222-8222-222222222222';
const BOB_USER='33333333-3333-4333-8333-333333333333';
const PERSONAL_USER='44444444-4444-4444-8444-444444444444';
const OUTSIDER='55555555-5555-4555-8555-555555555555';
const GROUP='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEAM='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ALICE='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BOB='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PERSONAL='ffffffff-ffff-4fff-8fff-ffffffffffff';
const SESSION='12121212-1212-4212-8212-121212121212';
const EXERCISE='13131313-1313-4313-8313-131313131313';

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

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;

alter table public.training_sessions enable row level security;
alter table public.training_attendance enable row level security;
alter table public.training_session_exercises enable row level security;
alter table public.training_results enable row level security;
alter table public.coaching_group_players enable row level security;
alter table public.players enable row level security;
create policy existing_training_sessions_read on public.training_sessions for select to authenticated using (true);
create policy existing_training_attendance_read on public.training_attendance for select to authenticated using (true);
create policy existing_training_exercises_read on public.training_session_exercises for select to authenticated using (true);
create policy existing_training_results_read on public.training_results for select to authenticated using (true);
create policy existing_group_players_read on public.coaching_group_players for select to authenticated using (true);
create policy existing_players_read on public.players for select to authenticated using (true);

insert into public.workspaces values ('${WORKSPACE}');
insert into public.teams values ('${TEAM}','${WORKSPACE}','Equipe');
insert into public.coaching_groups values ('${GROUP}','Groupe test');
insert into public.players values
  ('${ALICE}','Alice','${WORKSPACE}'),
  ('${BOB}','Bob','${WORKSPACE}'),
  ('${PERSONAL}','Charlie','${WORKSPACE}');
insert into public.coaching_group_coaches values ('${GROUP}','${COACH}','coach');
insert into public.coaching_group_players values
  ('${GROUP}','${ALICE}',true,'group'),
  ('${GROUP}','${BOB}',true,'group'),
  ('${GROUP}','${PERSONAL}',true,'personal');
insert into public.coaching_player_accounts values
  ('${GROUP}','${ALICE}','${ALICE_USER}'),
  ('${GROUP}','${BOB}','${BOB_USER}'),
  ('${GROUP}','${PERSONAL}','${PERSONAL_USER}');
insert into public.exercises values ('${EXERCISE}','Passes',null,null,null,'success_attempts');
insert into public.training_sessions values
  ('${SESSION}','${WORKSPACE}','${GROUP}','${TEAM}','2026-11-20','Entrainement',null);
insert into public.training_attendance values ('${SESSION}','${ALICE}',true),('${SESSION}','${BOB}',true);
insert into public.training_session_exercises(session_id,exercise_id,focus,position)
  values ('${SESSION}','${EXERCISE}',null,1);
insert into public.training_results(session_id,exercise_id,player_id,successes,attempts)
  values ('${SESSION}','${EXERCISE}','${ALICE}',8,10),('${SESSION}','${EXERCISE}','${BOB}',6,10);
`;

async function makeDB(){
  const db=new PGlite();
  await db.exec(fixture);
  await db.exec(migration);
  return db;
}

async function asUser(db,userId){
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${userId}'`);
}

async function dataset(db){
  const result=await db.query('select public.get_training_statistics_dataset($1::uuid) as value',[GROUP]);
  return result.rows[0].value;
}

test('two players receive identical results with caller-specific names and stable aliases',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,ALICE_USER);
    const aliceFirst=await dataset(db);
    const aliceSecond=await dataset(db);
    await asUser(db,BOB_USER);
    const bob=await dataset(db);

    assert.deepEqual(aliceFirst.players,aliceSecond.players);
    assert.equal(aliceFirst.players.find(player=>player.is_me).display_name,'Alice');
    assert.equal(bob.players.find(player=>player.is_me).display_name,'Bob');
    assert.equal(JSON.stringify(aliceFirst).includes('Bob'),false);
    assert.equal(JSON.stringify(bob).includes('Alice'),false);
    for(const identifier of [ALICE,BOB,SESSION]){
      assert.equal(JSON.stringify(aliceFirst).includes(identifier),false);
      assert.equal(JSON.stringify(bob).includes(identifier),false);
    }
    assert.deepEqual(aliceFirst.results,bob.results);
    assert.deepEqual(aliceFirst.players.map(player=>player.id),bob.players.map(player=>player.id));
  }finally{await db.close()}
});

test('personal and outside accounts are rejected while coaches retain identities',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,PERSONAL_USER);
    await assert.rejects(dataset(db),/Acces aux statistiques du groupe refuse/);
    await asUser(db,OUTSIDER);
    await assert.rejects(dataset(db),/Acces aux statistiques du groupe refuse/);
    await asUser(db,COACH);
    const coach=await dataset(db);
    assert.deepEqual(coach.players.map(player=>player.display_name),['Alice','Bob','Charlie']);
  }finally{await db.close()}
});

test('players cannot bypass anonymization through raw tables',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,ALICE_USER);
    assert.equal((await db.query('select * from public.training_results')).rows.length,0);
    assert.deepEqual((await db.query('select player_id from public.coaching_group_players')).rows,[{player_id:ALICE}]);
    assert.deepEqual((await db.query('select id,display_name from public.players')).rows,[{id:ALICE,display_name:'Alice'}]);
    await asUser(db,COACH);
    assert.equal((await db.query('select * from public.training_results')).rows.length,2);
  }finally{await db.close()}
});

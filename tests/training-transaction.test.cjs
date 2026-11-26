// Lots B/C2/G2 — Harnais SQL des RPC transactionnelles d'entraînement.
// Exécute la chaîne de migrations ciblée sur une base PGlite synthétique puis vérifie
// atomicité, conflits de version, droits (miroir des policies RLS réelles), préservation
// team_color / variant et compatibilité avec les séances historiques.
// Prérequis : @electric-sql/pglite (absent du poste local, comme pour categories.test.cjs).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

const migrationDir=path.join(__dirname,'../supabase/migrations');
const migrationFile=path.join(migrationDir,'20261010120000_training_session_atomic_save.sql');
if(!fs.existsSync(migrationFile))throw new Error(`Missing test prerequisite: ${migrationFile}`);
const migration=fs.readFileSync(migrationFile,'utf8');
// Migration corrective appliquée sur la base distante (RLS-only) : elle remplace la fonction
// publique sans réintroduire les appels au schéma private. Le harnais applique les deux dans
// l'ordre réel pour valider la version effectivement en production.
const migrationFixFile=path.join(migrationDir,'20261010140000_save_training_session_rls_only.sql');
if(!fs.existsSync(migrationFixFile))throw new Error(`Missing test prerequisite: ${migrationFixFile}`);
const migrationFix=fs.readFileSync(migrationFixFile,'utf8');
const migrationLeaseFile=path.join(migrationDir,'20261010160000_training_session_edit_lease.sql');
if(!fs.existsSync(migrationLeaseFile))throw new Error(`Missing test prerequisite: ${migrationLeaseFile}`);
const migrationLease=fs.readFileSync(migrationLeaseFile,'utf8');
const migrationG2File=path.join(migrationDir,'20261011120000_training_tactical_diagrams_g2.sql');
if(!fs.existsSync(migrationG2File))throw new Error(`Missing test prerequisite: ${migrationG2File}`);
const migrationG2=fs.readFileSync(migrationG2File,'utf8');
const migrationPlayerResultsFile=path.join(migrationDir,'20261124231719_player_training_results.sql');
if(!fs.existsSync(migrationPlayerResultsFile))throw new Error(`Missing test prerequisite: ${migrationPlayerResultsFile}`);
const migrationPlayerResults=fs.readFileSync(migrationPlayerResultsFile,'utf8');
const occurrenceIntegrity=fs.readFileSync(path.join(migrationDir,'20261124231728_training_occurrence_integrity.sql'),'utf8');

const U_COACH='11111111-1111-4111-8111-111111111111';
const U_EDITOR='22222222-2222-4222-8222-222222222222';
const U_NONE='33333333-3333-4333-8333-333333333333';
const WS_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WS_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const G1='99999999-9999-4999-8999-999999999999';
const G2='88888888-8888-4888-8888-888888888888';
const TEAM_A='10000000-0000-4000-8000-000000000001';
const TEAM_B='10000000-0000-4000-8000-000000000002';
const P_A='20000000-0000-4000-8000-000000000001';
const P_B='20000000-0000-4000-8000-000000000002';
const P_C='20000000-0000-4000-8000-000000000003';
const P_REMOVED='20000000-0000-4000-8000-000000000004';
const P_BOGUS='20000000-0000-4000-8000-000000000005';
const EX1='30000000-0000-4000-8000-000000000001';
const EX_ARCH='30000000-0000-4000-8000-000000000002';
const S1='40000000-0000-4000-8000-000000000001';
const S2='40000000-0000-4000-8000-000000000002';
const INSTANCE_A='50000000-0000-4000-8000-000000000001';
const INSTANCE_B='50000000-0000-4000-8000-000000000002';
const O1='60000000-0000-4000-8000-000000000001';
const O2='60000000-0000-4000-8000-000000000002';
const O3='60000000-0000-4000-8000-000000000003';
const O_SRC='60000000-0000-4000-8000-000000000004';
const O_NEW='60000000-0000-4000-8000-000000000005';
const U_OTHER='44444444-4444-4444-8444-444444444444';

// Base synthétique. Les tables catalogue (workspaces, teams, players, exercises, groups)
// n'ont volontairement PAS de RLS : le harnais isole le contrat de la RPC et la RLS du parent
// training_sessions. Les policies enfants sont permissives : l'autorisation d'écriture est
// portée par le parent et les vérifications explicites de la RPC.
const fixture=`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users values ('${U_COACH}'),('${U_EDITOR}'),('${U_NONE}'),('${U_OTHER}');
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;

create table public.workspaces(id uuid primary key);
create table public.workspace_members(
  user_id uuid, workspace_id uuid references public.workspaces(id),
  role text not null, primary key (user_id, workspace_id));
create table public.teams(
  id uuid primary key, workspace_id uuid references public.workspaces(id),
  name text not null);
create table public.players(
  id uuid primary key, display_name text,
  workspace_id uuid references public.workspaces(id));
create table public.coaching_groups(id uuid primary key, name text not null);
create table public.user_profiles(user_id uuid primary key, first_name text);
create table public.coaching_group_coaches(
  group_id uuid references public.coaching_groups(id),
  user_id uuid, role text not null default 'coach', joined_at timestamptz not null default now(),
  primary key (group_id, user_id));
create table public.coaching_group_players(
  group_id uuid references public.coaching_groups(id),
  player_id uuid references public.players(id),
  active boolean not null default true,
  primary key (group_id, player_id));
create table public.coaching_player_accounts(
  group_id uuid references public.coaching_groups(id),
  player_id uuid references public.players(id),
  user_id uuid not null,
  primary key (group_id,player_id),
  unique (group_id,user_id));
create table public.exercises (
  id uuid primary key default gen_random_uuid(), name text not null,
  measurement_type text not null, active boolean not null default true,
  created_by uuid default auth.uid(), updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.training_sessions(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  group_id uuid not null references public.coaching_groups(id),
  team_id uuid not null references public.teams(id),
  trained_on date not null default current_date,
  label text not null, theme text, duration_minutes integer, notes text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.training_attendance(
  session_id uuid references public.training_sessions(id) on delete cascade,
  player_id uuid references public.players(id),
  present boolean not null default true,
  team_color text,
  primary key (session_id, player_id));
create table public.training_session_exercises(
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.training_sessions(id) on delete cascade,
  exercise_id uuid references public.exercises(id),
  position integer not null, variant text, target text, focus text,
  unique (session_id, exercise_id, position));
create table public.training_results(
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.training_sessions(id) on delete cascade,
  exercise_id uuid references public.exercises(id),
  player_id uuid references public.players(id),
  successes integer, attempts integer, numeric_value numeric, note text, variant text);
create table public.training_live_periods(
  id uuid primary key default gen_random_uuid(), session_id uuid not null,
  group_id uuid, exercise_id uuid, period_number integer, label text,
  team_assignments jsonb, started_at timestamptz default now(), ended_at timestamptz,
  created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.training_live_events(
  id uuid primary key default gen_random_uuid(), period_id uuid,
  session_id uuid not null, group_id uuid, player_id uuid,
  attribution_type text, team_color text, attack_context text, result text,
  fault_type text, occurred_at timestamptz default now(), created_by uuid,
  created_at timestamptz default now());

-- Fonctions d'autorisation : créées APRÈS leurs tables (check_function_bodies actif).
create schema private;
create or replace function private.is_group_coach(p_group_id uuid)
returns boolean language sql stable as $$
 select exists(select 1 from public.coaching_group_coaches c
               where c.group_id = p_group_id and c.user_id = auth.uid());
$$;
create or replace function private.can_edit_workspace(p_workspace_id uuid)
returns boolean language sql stable as $$
 select exists(select 1 from public.workspace_members wm
               where wm.workspace_id = p_workspace_id
                 and wm.user_id = auth.uid()
                 and wm.role in ('owner','admin','coach'));
$$;
-- Miroir de la production : authenticated n'a PAS USAGE sur le schema private. Les policies
-- RLS n'ont besoin que des EXECUTE ci-dessous (sans USAGE de schema) ; toute RPC publique qui
-- appellerait directement private.* echouerait donc ici, comme en production.
grant execute on function private.is_group_coach(uuid), private.can_edit_workspace(uuid) to authenticated;

-- Audit mimé : set_audit_user_fields + trg_training_sessions_audit. La migration ajoute
-- son propre trigger de version ; les deux coexistent, avec des responsabilités disjointes.
create or replace function public.set_audit_user_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.updated_by := auth.uid();
  new.created_at := coalesce(new.created_at, now());
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_training_sessions_audit on public.training_sessions;
create trigger trg_training_sessions_audit
before insert or update on public.training_sessions
for each row execute function public.set_audit_user_fields();

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Policies parentes : miroir des policies réelles (permissives, combinées par OR).
alter table public.training_sessions enable row level security;
create policy ts_select on public.training_sessions for select to authenticated
  using ((group_id is not null and private.is_group_coach(group_id))
         or private.can_edit_workspace(workspace_id));
create policy ts_insert on public.training_sessions for insert to authenticated
  with check ((group_id is not null and private.is_group_coach(group_id))
              or private.can_edit_workspace(workspace_id));
create policy ts_update on public.training_sessions for update to authenticated
  using ((group_id is not null and private.is_group_coach(group_id))
         or private.can_edit_workspace(workspace_id))
  with check ((group_id is not null and private.is_group_coach(group_id))
              or private.can_edit_workspace(workspace_id));
create policy ts_delete on public.training_sessions for delete to authenticated
  using ((group_id is not null and private.is_group_coach(group_id))
         or private.can_edit_workspace(workspace_id));

insert into public.workspaces values ('${WS_A}'),('${WS_B}');
insert into public.workspace_members values ('${U_EDITOR}','${WS_A}','owner');
insert into public.teams(id,workspace_id,name) values
 ('${TEAM_A}','${WS_A}','Équipe 1'),('${TEAM_B}','${WS_B}','Équipe B');
insert into public.players(id,display_name,workspace_id) values
 ('${P_A}','Alice','${WS_A}'),('${P_B}','Bob','${WS_A}'),('${P_C}','Chloé','${WS_A}'),
 ('${P_REMOVED}','Retiré','${WS_A}');
insert into public.coaching_groups values ('${G1}','Équipe 1'),('${G2}','Équipe 2');
insert into public.user_profiles values ('${U_COACH}','Coach'),('${U_EDITOR}','Editeur'),('${U_NONE}','Sans accès');
insert into public.coaching_group_coaches(group_id,user_id,role) values ('${G1}','${U_COACH}','coach');
insert into public.coaching_group_players(group_id,player_id,active) values
  ('${G1}','${P_A}',true),('${G1}','${P_B}',true),('${G1}','${P_C}',false);
insert into public.coaching_player_accounts(group_id,player_id,user_id) values
  ('${G1}','${P_A}','${U_NONE}'),('${G1}','${P_B}','${U_OTHER}');
insert into public.exercises(id,name,measurement_type,active) values
 ('${EX1}','Attaque originale','count',true),('${EX_ARCH}','Cible','count',false);
insert into public.training_sessions(id,workspace_id,group_id,team_id,label,trained_on)
 values ('${S1}','${WS_A}','${G1}','${TEAM_A}','Séance 1','2026-09-30'),
        ('${S2}','${WS_B}','${G2}','${TEAM_B}','Séance 2','2026-10-01');
insert into public.training_attendance(session_id,player_id,present,team_color) values
 ('${S1}','${P_A}',true,'blue'),('${S1}','${P_B}',true,null),('${S1}','${P_REMOVED}',true,'gray'),
 ('${S2}','${P_A}',true,null);
insert into public.training_session_exercises(session_id,exercise_id,position) values
 ('${S1}','${EX1}',1);
insert into public.training_results(session_id,exercise_id,player_id,successes,attempts,variant) values
 ('${S1}','${EX1}','${P_A}',1,2,null),('${S1}','${EX1}','${P_B}',5,5,'speed');
`;

async function makeDB({beforeFix=false}={}){const db=new PGlite();await db.exec(fixture);await db.exec(migration);await db.exec(migrationFix);await db.exec(migrationLease);await db.exec(migrationG2);await db.exec(migrationPlayerResults);if(!beforeFix)await db.exec(occurrenceIntegrity);return db}
async function asUser(db,id){await db.exec(`set role authenticated;set request.jwt.claim.sub='${id}'`) }
async function rows(db,sql,params=[]){return (await db.query(sql,params)).rows}
async function one(db,sql,params=[]){return (await rows(db,sql,params))[0]}
const json=value=>JSON.stringify(value);
const leaseCache=new WeakMap();

async function acquireLease(db,sessionId,instance=INSTANCE_A){
  return one(db,`select * from public.acquire_training_session_lease($1::uuid,$2::uuid)`,[sessionId,instance]);
}

async function saveRPC(db,{sessionId=null,expected=null,workspace=WS_A,group=G1,team=TEAM_A,
  trainedOn=null,label='Entraînement',theme=null,duration=null,notes=null,attendance=[],exercises=[],results=[],force=false,
  instance=INSTANCE_A,token=undefined}={}){
  let leaseToken=token;
  let cache=leaseCache.get(db);if(!cache){cache=new Map();leaseCache.set(db,cache)}
  const key=`${sessionId}:${instance}`;
  if(sessionId&&leaseToken===undefined){
    leaseToken=cache.get(key);
    if(!leaseToken){const lease=await acquireLease(db,sessionId,instance);if(lease.status!=='acquired')throw new Error('lease not acquired');leaseToken=lease.lease_token;cache.set(key,leaseToken)}
  }
  const sql=`select * from public.save_training_session(
    p_session_id => $1::uuid, p_expected_version => $2::integer,
    p_editor_instance_id => $3::uuid, p_lease_token => $4::uuid,
    p_workspace_id => $5::uuid, p_group_id => $6::uuid, p_team_id => $7::uuid,
    p_trained_on => $8::date, p_label => $9::text, p_theme => $10::text,
    p_duration_minutes => $11::integer, p_notes => $12::text,
    p_attendance => $13::jsonb, p_exercises => $14::jsonb, p_results => $15::jsonb,
    p_force => $16::boolean)`;
  const result=await one(db,sql,[sessionId,expected,instance,leaseToken??null,workspace,group,team,trainedOn,label,theme,duration,notes,
    json(attendance),json(exercises),json(results),force]);
  if(!sessionId&&result?.lease_token)cache.set(`${result.session_id}:${instance}`,result.lease_token);
  return result;
}

async function saveG2(db,{occurrences=[],playerResults=false,...options}={}){
  const args={sessionId:null,expected:null,workspace:WS_A,group:G1,team:TEAM_A,trainedOn:null,
    label:'Entraînement',theme:null,duration:null,notes:null,attendance:[],exercises:[],results:[],force:false,
    instance:INSTANCE_A,token:undefined,...options};
  let cache=leaseCache.get(db);if(!cache){cache=new Map();leaseCache.set(db,cache)}
  const key=`${args.sessionId}:${args.instance}`;
  let leaseToken=args.token;
  if(args.sessionId&&leaseToken===undefined){
    leaseToken=cache.get(key);
    if(!leaseToken){const lease=await acquireLease(db,args.sessionId,args.instance);if(lease.status!=='acquired')throw new Error('lease not acquired');leaseToken=lease.lease_token;cache.set(key,leaseToken)}
  }
  const result=await one(db,`select * from public.${playerResults?'save_training_session_player_results':'save_training_session_with_occurrences'}(
    p_session_id=>$1::uuid,p_expected_version=>$2::integer,p_editor_instance_id=>$3::uuid,p_lease_token=>$4::uuid,
    p_workspace_id=>$5::uuid,p_group_id=>$6::uuid,p_team_id=>$7::uuid,p_trained_on=>$8::date,
    p_label=>$9::text,p_theme=>$10::text,p_duration_minutes=>$11::integer,p_notes=>$12::text,
    p_attendance=>$13::jsonb,p_exercises=>$14::jsonb,p_results=>$15::jsonb,p_force=>$16::boolean,
    p_occurrences=>$17::jsonb)`,[args.sessionId,args.expected,args.instance,leaseToken??null,args.workspace,args.group,args.team,
      args.trainedOn,args.label,args.theme,args.duration,args.notes,json(args.attendance),json(args.exercises),json(args.results),
      args.force,json(occurrences)]);
  if(!args.sessionId&&result?.lease_token)cache.set(`${result.session_id}:${args.instance}`,result.lease_token);
  return result;
}

test('the coach saves an existing session through the browser RPC without a collection',async()=>{
  const db=await makeDB({beforeFix:true});
  try{
    await asUser(db,U_COACH);
    const args={playerResults:true,sessionId:S1,expected:1,label:'Brouillon coach',attendance:[{player_id:P_A,present:true}]};
    await assert.rejects(saveG2(db,args),{code:'42501',message:/training_player_collections/});
    await db.exec('reset role');
    await db.exec(occurrenceIntegrity);
    await asUser(db,U_COACH);
    const result=await saveG2(db,args);
    assert.equal(result.status,'saved');
    assert.equal((await one(db,'select label from public.training_sessions where id=$1',[S1])).label,'Brouillon coach');
    assert.equal((await saveG2(db,args)).status,'conflict');
    await assert.rejects(saveG2(db,{...args,expected:result.version,token:O2}),{code:'55000'});
    await assert.rejects(saveG2(db,{...args,sessionId:S2,group:G2,team:TEAM_B,token:result.lease_token}),{code:'55000'});
    await assert.rejects(rows(db,'select * from public.training_player_collections'),{code:'42501'});
    assert.deepEqual((await rows(db,'select variant from public.training_results where session_id=$1 order by variant nulls first',[S1])).map(r=>r.variant),[null,'speed']);
  }finally{await db.close()}
});

test('browser RPCs preserve official rows, reject stale tabs and arbitrate a declaration once',async()=>{
  const db=await makeDB();
  const rpc=async(name,params)=> (await one(db,`select public.${name}(${params.map((_,i)=>`$${i+1}`).join(',')}) value`,params)).value;
  const manifest=[{id:O1,kind:'manual_stat',exercise_id:EX1,collects_stats:true,position:1,stats_position:1}];
  const options={playerResults:true,sessionId:S1,expected:1,occurrences:manifest,
    attendance:[{player_id:P_A,present:true},{player_id:P_B,present:true}],exercises:[{exercise_id:EX1,position:1,focus:'attack'}]};
  try{
    await asUser(db,U_COACH);
    const initial=await saveG2(db,{...options,results:[{occurrence_id:O1,exercise_id:EX1,player_id:P_A,numeric_value:4}]});
    const token=initial.lease_token;
    const getOfficial=()=>rows(db,'select id,player_id,result_version,numeric_value from public.training_results where session_id=$1 and occurrence_id=$2 order by player_id',[S1,O1]);
    const [before]=await getOfficial();
    const old={...options,playerResults:false,expected:initial.version,force:true};
    await assert.rejects(saveG2(db,old),{code:'55000'});
    await assert.rejects(saveRPC(db,old),{code:'55000'});
    assert.deepEqual(await getOfficial(),[before]);
    await rpc('open_training_player_collection',[S1,O1]);
    await asUser(db,U_NONE);
    assert.deepEqual((await rows(db,'select occurrence_id,declaration_id from public.get_my_training_result_tasks($1)',[G1])),[{occurrence_id:O1,declaration_id:null}]);
    await rpc('submit_my_training_result',[O1,null,null,7,'joueur',O2,null]);
    await assert.rejects(rpc('open_training_player_collection',[S1,O1]),{code:'42501'});
    await asUser(db,U_OTHER);
    assert.equal((await rows(db,'select declaration_id from public.get_my_training_result_tasks($1)',[G1]))[0].declaration_id,null);
    await rpc('submit_my_training_result',[O1,null,null,9,null,O3,null]);
    await asUser(db,U_COACH);
    const retrieve=op=>rpc('retrieve_training_player_results',[S1,O1,op,INSTANCE_A,token]);
    const retrieved=await retrieve(O2);
    assert.equal(retrieved.discrepancy_count,1);
    const official=await getOfficial();
    assert.deepEqual(official.map(r=>Number(r.numeric_value)),[4,9]);
    assert.deepEqual(await retrieve(O3),retrieved);
    assert.deepEqual(await getOfficial(),official);
    await asUser(db,U_NONE);
    await assert.rejects(rpc('submit_my_training_result',[O1,null,null,8,null,O3,1]),/saisie est fermée/);
    await asUser(db,U_COACH);
    const [pending]=await rows(db,"select * from public.get_training_player_collection_details($1) where resolution_state='pending'",[S1]);
    assert.equal(pending.player_id,P_A);
    assert.equal(Number(pending.coach_numeric_value),4);
    assert.equal(Number(pending.player_numeric_value),7);
    const arbitrate=version=>rpc('arbitrate_training_player_result',[pending.declaration_id,'player',pending.result_id,version,INSTANCE_A,token]);
    assert.equal((await arbitrate(pending.result_version+1)).status,'conflict');
    assert.equal((await arbitrate(pending.result_version)).status,'saved');
    const after=await getOfficial();
    assert.equal(after[0].id,before.id);
    assert.deepEqual(after.map(r=>Number(r.numeric_value)),[7,9]);
    assert.deepEqual((await saveG2(db,{...options,force:true,results:[]})).status,'saved');
    assert.deepEqual(await getOfficial(),after,'omitting results leaves official rows unchanged');
    const update={occurrence_id:O1,exercise_id:EX1,player_id:P_A,numeric_value:7,expected_result_id:after[0].id,expected_result_version:after[0].result_version};
    await saveG2(db,{...options,force:true,results:[{...update,note:'joueur'}]});
    assert.deepEqual(await getOfficial(),after,'unchanged results keep IDs and versions');
    await assert.rejects(saveG2(db,{...options,force:true,results:[{...update,delete_result:true}]}),{code:'23514'});
    await assert.rejects(saveG2(db,{...options,force:true,results:[{...update,expected_result_version:before.result_version}]}),{code:'40001'});
    assert.equal((await one(db,'select count(*)::int n from public.training_results where session_id=$1 and occurrence_id is null',[S1])).n,2);
  }finally{await db.close()}
});

test('migration joueur : rattache les résultats existants et rétablit la vérification du bail', async()=>{
  const db=new PGlite();
  try{
    for(const sql of [fixture,migration,migrationFix,migrationLease,migrationG2])await db.exec(sql);
    await asUser(db,U_COACH);
    await saveG2(db,{sessionId:S1,expected:1,attendance:[{player_id:P_A,present:true}],
      exercises:[{exercise_id:EX1,position:1}],results:[{exercise_id:EX1,player_id:P_A,numeric_value:8}],
      occurrences:[{id:O1,kind:'manual_stat',exercise_id:EX1,position:0,stats_position:1,collects_stats:true}]});
    await db.exec('reset role');
    const before=await one(db,'select id,numeric_value from public.training_results where session_id=$1 and variant is null',[S1]);
    await db.exec(migrationPlayerResults);
    const after=await one(db,'select id,numeric_value,occurrence_id from public.training_results where session_id=$1 and variant is null',[S1]);
    assert.deepEqual(after,{...before,occurrence_id:O1});
    const trigger=await one(db,"select tgenabled from pg_trigger where tgrelid='public.training_results'::regclass and tgname='trg_training_results_edit_lease'");
    assert.equal(trigger.tgenabled,'O');
    await asUser(db,U_COACH);
    await assert.rejects(db.query('update public.training_results set numeric_value=9 where id=$1',[before.id]),/bail/i);
  }finally{await db.close()}
});

function diagram(id='diagram-test'){
  const stamp='2026-10-11T12:00:00.000Z';
  return {schema:'kinball-coach-tactical-diagram',schemaVersion:1,id,title:'Test',createdAt:stamp,updatedAt:stamp,
    canvas:{width:1000,height:1000},court:{width:20,height:20,unit:'m',proportion:'square',basis:'working-default'},objects:[]};
}

test('RPC: création atomique par coach sans membership workspace, version 1, enfants valides',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    const rpc=await saveRPC(db,{attendance:[{player_id:P_A,present:true},{player_id:P_C,present:true}],
      exercises:[{exercise_id:EX1,position:1}],results:[{exercise_id:EX1,player_id:P_A,successes:3,attempts:4}]});
    assert.equal(rpc.status,'saved');assert.equal(rpc.version,1);
    assert.ok(rpc.lease_token,'creation atomically returns the lease token');
    const sid=rpc.session_id;
    const s=await one(db,'select * from training_sessions where id=$1',[sid]);
    assert.equal(s.workspace_id,WS_A);assert.equal(s.group_id,G1);assert.equal(s.team_id,TEAM_A);
    assert.equal(s.version,1);assert.ok(s.created_at);
    // Deux chemins d'autorisation : U_COACH est coach du groupe mais n'est PAS membre du workspace.
    // P_C est membre du groupe mais inactif : accepté (aucun filtre active).
    const att=await rows(db,'select player_id,present,team_color from training_attendance where session_id=$1 order by player_id',[sid]);
    assert.deepEqual(att.map(r=>({p:r.player_id,pr:r.present,tc:r.team_color})),[{p:P_A,pr:true,tc:null},{p:P_C,pr:true,tc:null}]);
    const exs=await one(db,'select * from training_session_exercises where session_id=$1',[sid]);
    assert.equal(exs.exercise_id,EX1);assert.equal(exs.position,1);assert.equal(exs.variant,null);
    const res=await one(db,'select * from training_results where session_id=$1',[sid]);
    assert.equal(res.exercise_id,EX1);assert.equal(res.player_id,P_A);assert.equal(res.successes,3);
    assert.equal(res.attempts,4);assert.equal(res.variant,null);
  }finally{await db.close()}
});

test('RPC: mise à jour atomique préservant team_color et variant non NULL, joueur retiré, exercice archivé',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    // Joueur retiré du groupe (P_REMOVED, plus aucune ligne coaching_group_players) encore
    // présent dans les présences de la séance : resauvegardable. Exercice archivé : accepté.
    const rpc=await saveRPC(db,{sessionId:S1,expected:1,
      attendance:[{player_id:P_A,present:true},{player_id:P_C,present:true},{player_id:P_REMOVED,present:true}],
      exercises:[{exercise_id:EX_ARCH,position:1}],
      results:[{exercise_id:EX_ARCH,player_id:P_A,successes:7,attempts:8,note:'ok'}]});
    assert.equal(rpc.status,'saved');assert.equal(rpc.version,2);
    // P_A conserve team_color 'blue', P_REMOVED son 'gray' (upsert sans toucher aux couleurs),
    // P_C ajouté, P_B retiré.
    const att=await rows(db,'select player_id,present,team_color from training_attendance where session_id=$1 order by player_id',[S1]);
    assert.deepEqual(att.map(r=>({p:r.player_id,pr:r.present,tc:r.team_color})),[
      {p:P_A,pr:true,tc:'blue'},{p:P_C,pr:true,tc:null},{p:P_REMOVED,pr:true,tc:'gray'}]);
    const exs=await one(db,'select * from training_session_exercises where session_id=$1',[S1]);
    assert.equal(exs.exercise_id,EX_ARCH);assert.equal(exs.position,1);
    const res=await rows(db,'select * from training_results where session_id=$1 order by variant nulls first',[S1]);
    assert.equal(res.length,2);
    // Ligne éditeur (variant NULL) remplacée par le nouveau jeu ; ligne variant='speed' intacte.
    const editorRow=res.find(r=>r.variant===null);
    assert.equal(editorRow.exercise_id,EX_ARCH);assert.equal(editorRow.player_id,P_A);
    assert.equal(editorRow.successes,7);assert.equal(editorRow.attempts,8);assert.equal(editorRow.note,'ok');
    const preserved=res.find(r=>r.variant==='speed');
    assert.equal(preserved.exercise_id,EX1);assert.equal(preserved.player_id,P_B);
    assert.equal(preserved.successes,5);
  }finally{await db.close()}
});

test('RPC: rollback intégral sur joueur inconnu',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    await assert.rejects(
      saveRPC(db,{sessionId:S1,expected:1,label:'corrompu',
        attendance:[{player_id:P_A,present:true},{player_id:P_BOGUS,present:true}],exercises:[{exercise_id:EX1,position:1}]}),
      /Joueur non autorisé/);
    const s=await one(db,'select version,label from training_sessions where id=$1',[S1]);
    assert.equal(s.version,1);assert.equal(s.label,'Séance 1');
    assert.equal((await rows(db,'select * from training_attendance where session_id=$1',[S1])).length,3);
    assert.equal((await rows(db,'select * from training_results where session_id=$1',[S1])).length,2);
    assert.equal((await rows(db,'select * from training_session_exercises where session_id=$1',[S1])).length,1);
  }finally{await db.close()}
});

test('RPC: retour arrière complet après plusieurs écritures réussies puis échec de contrainte',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    // Les présences (suppression + insertion) réussissent, puis le plan contient deux
    // positions identiques : la contrainte UNIQUE (session_id, exercise_id, position)
    // échoue APRÈS des écritures déjà exécutées. Tout doit être annulé, version incluse.
    await assert.rejects(
      saveRPC(db,{sessionId:S1,expected:1,label:'Doit être annulé',
        attendance:[{player_id:P_A,present:true},{player_id:P_C,present:true}],
        exercises:[{exercise_id:EX1,position:1},{exercise_id:EX1,position:1}]}),
      /duplicate key/);
    const s=await one(db,'select version,label from training_sessions where id=$1',[S1]);
    assert.equal(s.version,1);assert.equal(s.label,'Séance 1');
    // Présences d'origine intactes (P_A bleu, P_B, P_REMOVED) : la réussite partielle
    // « suppression de P_B/P_REMOVED + ajout de P_C » a été annulée.
    const att=await rows(db,'select player_id,present,team_color from training_attendance where session_id=$1 order by player_id',[S1]);
    assert.deepEqual(att.map(r=>({p:r.player_id,pr:r.present,tc:r.team_color})),[
      {p:P_A,pr:true,tc:'blue'},{p:P_B,pr:true,tc:null},{p:P_REMOVED,pr:true,tc:'gray'}]);
    // Résultats et plan d'origine intacts (dont ligne variant non NULL).
    assert.equal((await rows(db,'select * from training_results where session_id=$1',[S1])).length,2);
    const plan=await rows(db,'select * from training_session_exercises where session_id=$1',[S1]);
    assert.equal(plan.length,1);assert.equal(plan[0].exercise_id,EX1);
  }finally{await db.close()}
});

test('RPC: conflit de version puis forçage explicite',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    const first=await saveRPC(db,{sessionId:S1,expected:1,label:'Premier',attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]});
    assert.equal(first.status,'saved');assert.equal(first.version,2);
    const conflict=await saveRPC(db,{sessionId:S1,expected:1,label:'Concurrent',attendance:[{player_id:P_C,present:true}],exercises:[{exercise_id:EX1,position:1}]});
    assert.equal(conflict.status,'conflict');assert.equal(conflict.remote_version,2);assert.equal(conflict.version,null);
    // Aucune écriture pendant le conflit.
    const s=await one(db,'select label,version from training_sessions where id=$1',[S1]);
    assert.equal(s.label,'Premier');assert.equal(s.version,2);
    assert.deepEqual((await rows(db,'select player_id from training_attendance where session_id=$1',[S1])).map(r=>r.player_id),[P_A]);
    // p_force écrase malgré la version périmée, mais reste soumis aux contrôles.
    const forced=await saveRPC(db,{sessionId:S1,expected:1,force:true,label:'Forcé',attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]});
    assert.equal(forced.status,'saved');assert.equal(forced.version,3);
    assert.equal((await one(db,'select label from training_sessions where id=$1',[S1])).label,'Forcé');
    await assert.rejects(
      saveRPC(db,{sessionId:S1,expected:99,force:true,team:TEAM_B,label:'Équipe étrangère',
        attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]}),
      /Équipe hors du workspace de la séance/);
  }finally{await db.close()}
});

test('RPC: droits et isolation de contexte',async()=>{
  const db=await makeDB();
  try{
    // anon : la fonction n'est pas exécutable pour ce rôle (revoke public,anon).
    await db.exec('set role anon');
    await assert.rejects(saveRPC(db,{attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]}),/permission denied/);
    await db.exec('reset role');
    // Utilisateur sans aucun accès : la RPC ne vérifie plus elle-même les droits (plus
    // d'appel à private.*) ; c'est la policy RLS d'INSERT du parent qui refuse la création.
    await asUser(db,U_NONE);
    await assert.rejects(saveRPC(db,{attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]}),/row-level security|violates/);
    // Éditeur workspace (owner) : modifie une séance sans être coach du groupe.
    await asUser(db,U_EDITOR);
    const edited=await saveRPC(db,{sessionId:S1,expected:1,label:'Par éditeur',
      attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]});
    assert.equal(edited.status,'saved');assert.equal(edited.version,2);
    // L'éditeur ne peut pas changer le groupe de la séance.
    await assert.rejects(
      saveRPC(db,{sessionId:S1,expected:2,group:G2,label:'Détourné',
        attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]}),
      /Séance hors du groupe/);
  }finally{await db.close()}

  const iso=await makeDB();
  try{
    // Séance d'un autre groupe, sans accès au groupe ni au workspace : introuvable.
    await asUser(iso,U_COACH);
    await assert.rejects(
      saveRPC(iso,{sessionId:S2,expected:1,group:G2,team:TEAM_B,attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]}),
      /Accès refusé|Séance introuvable/);
    // Création : équipe d'un autre workspace refusée.
    await assert.rejects(
      saveRPC(iso,{workspace:WS_A,team:TEAM_B,attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]}),
      /Équipe hors du workspace/);
  }finally{await iso.close()}
});

test('RPC: un ancien client ne peut plus modifier directement une séance',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    await assert.rejects(
      rows(db,"update public.training_sessions set label='Direct', theme='Live' where id=$1",[S1]),
      /Bail d edition absent/);
    const raw=await one(db,'select version,label from training_sessions where id=$1',[S1]);
    assert.equal(raw.version,1);assert.equal(raw.label,'Séance 1');
    const saved=await saveRPC(db,{sessionId:S1,expected:1,label:'RPC protégée',attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]});
    assert.equal(saved.status,'saved');assert.equal(saved.version,2);
  }finally{await db.close()}
});

test('Bail: deux instances du même utilisateur restent exclusives',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    const first=await acquireLease(db,S1,INSTANCE_A);
    assert.equal(first.status,'acquired');assert.ok(first.lease_token);
    const second=await acquireLease(db,S1,INSTANCE_B);
    assert.equal(second.status,'held');assert.equal(second.lease_token,null);
    await assert.rejects(
      saveRPC(db,{sessionId:S1,expected:1,instance:INSTANCE_B,token:first.lease_token,
        attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]}),
      /Bail d edition absent/);
    const renewed=await one(db,'select * from public.renew_training_session_lease($1,$2,$3)',[S1,INSTANCE_A,first.lease_token]);
    assert.equal(renewed.status,'renewed');
  }finally{await db.close()}
});

test('Bail: expiration, reprise et ancien jeton inopérant',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    const first=await acquireLease(db,S1,INSTANCE_A);
    await db.exec('reset role');
    await db.query("update public.training_session_leases set acquired_at=statement_timestamp()-interval '2 minutes', expires_at=statement_timestamp()-interval '1 minute' where session_id=$1",[S1]);
    await asUser(db,U_COACH);
    const second=await acquireLease(db,S1,INSTANCE_B);
    assert.equal(second.status,'acquired');assert.notEqual(second.lease_token,first.lease_token);
    const stale=await one(db,'select * from public.renew_training_session_lease($1,$2,$3)',[S1,INSTANCE_A,first.lease_token]);
    assert.equal(stale.status,'lost');
    const staleRelease=await one(db,'select public.release_training_session_lease($1,$2,$3) as released',[S1,INSTANCE_A,first.lease_token]);
    assert.equal(staleRelease.released,false);
  }finally{await db.close()}
});

test('Bail: training_attendance et les tables live vérifient user, instance et jeton',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    await assert.rejects(
      rows(db,'update public.training_attendance set present=false where session_id=$1 and player_id=$2',[S1,P_A]),
      /Bail d edition absent/);
    const lease=await acquireLease(db,S1,INSTANCE_A);
    const validHeaders=JSON.stringify({'x-kb-editor-instance-id':INSTANCE_A,'x-kb-lease-token':lease.lease_token});
    await db.query("select set_config('request.headers',$1,false)",[validHeaders]);
    await rows(db,'update public.training_attendance set present=false where session_id=$1 and player_id=$2',[S1,P_A]);
    assert.equal((await one(db,'select present from public.training_attendance where session_id=$1 and player_id=$2',[S1,P_A])).present,false);
    const period=await one(db,`insert into public.training_live_periods(session_id,group_id,period_number,label)
      values($1,$2,1,'Période') returning id`,[S1,G1]);
    await rows(db,`insert into public.training_live_events(period_id,session_id,group_id,result)
      values($1,$2,$3,'point')`,[period.id,S1,G1]);

    const wrongHeaders=JSON.stringify({'x-kb-editor-instance-id':INSTANCE_B,'x-kb-lease-token':lease.lease_token});
    await db.query("select set_config('request.headers',$1,false)",[wrongHeaders]);
    await assert.rejects(
      rows(db,'update public.training_attendance set present=true where session_id=$1 and player_id=$2',[S1,P_A]),
      /Bail d edition absent/);
    await assert.rejects(
      rows(db,"update public.training_live_periods set label='Concurrent' where id=$1",[period.id]),
      /Bail d edition absent/);
    await assert.rejects(
      rows(db,'delete from public.training_session_exercises where session_id=$1',[S1]),
      /Bail d edition absent/);
    await assert.rejects(
      rows(db,"update public.training_results set note='Concurrent' where session_id=$1",[S1]),
      /Bail d edition absent/);
  }finally{await db.close()}
});

test('Bail: ancienne signature 14 args abandonnée au profit de la signature 16 args',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    // Le contrat public reste unique : une seule surcharge save_training_session,
    // la version 16 args héritée de C2 (bail d'édition + occurrences optionnelles),
    // jamais l'ancienne signature pré-C2 à 14 arguments.
    const overloads=await rows(db,`select pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='save_training_session' order by pronargs`);
    assert.deepEqual(overloads.map(r=>Number(r.pronargs)),[16]);
    assert.equal(overloads.some(r=>Number(r.pronargs)===14),false,'la signature pré-C2 ne doit plus exister');
  }finally{await db.close()}
});

test('Point 1: une sauvegarde ne repart pas après expiration puis réattribution du bail',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    const first=await acquireLease(db,S1,INSTANCE_A);
    assert.equal(first.status,'acquired');
    // Simuler une séance d'édition qui dure au-delà de l'expiration du bail.
    await db.exec('reset role');
    await db.query("update public.training_session_leases set acquired_at=statement_timestamp()-interval '2 minutes', expires_at=statement_timestamp()-interval '1 minute' where session_id=$1",[S1]);
    await asUser(db,U_COACH);
    const second=await acquireLease(db,S1,INSTANCE_B);
    assert.equal(second.status,'acquired');
    assert.notEqual(second.lease_token,first.lease_token);
    // L'ancienne instance rejoue son enregistrement avec son ancien jeton : refusé,
    // aucune écriture n'est validée sous un bail désormais détenu par une autre instance.
    await assert.rejects(
      saveRPC(db,{sessionId:S1,expected:1,instance:INSTANCE_A,token:first.lease_token,
        attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]}),
      /Bail d edition absent/);
    const s=await one(db,'select version,label from training_sessions where id=$1',[S1]);
    assert.equal(s.version,1);assert.equal(s.label,'Séance 1');
  }finally{await db.close()}
});

test('Point 2: l autorisation du bail délègue aux fonctions RLS et suit leurs évolutions',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    // Baseline : U_COACH est coach du groupe, le bail est accordé.
    const ok=await acquireLease(db,S1,INSTANCE_A);
    assert.equal(ok.status,'acquired');
    // Les fonctions d'autorisation canoniques des policies RLS deviennent restrictives :
    // le bail doit immédiatement en tenir compte (pas de prédicat dupliqué qui divergerait).
    await db.exec('reset role');
    await db.exec(`create or replace function private.is_group_coach(p_group_id uuid)
      returns boolean language sql stable as $$ select false $$;
      create or replace function private.can_edit_workspace(p_workspace_id uuid)
      returns boolean language sql stable as $$ select false $$;`);
    await asUser(db,U_COACH);
    await assert.rejects(acquireLease(db,S1,INSTANCE_B),/Accès refusé/);
  }finally{await db.close()}
});

test('Point 4: aucune instance ne peut activer le bail d une autre et get ne divulgue pas le jeton',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    const lease=await acquireLease(db,S1,INSTANCE_A);
    assert.equal(lease.status,'acquired');
    // Instance B présente le jeton de A : refus (instance distincte).
    await assert.rejects(
      one(db,'select public.activate_training_session_lease($1,$2,$3)',[S1,INSTANCE_B,lease.lease_token]),
      /Bail d edition absent/);
    // Même instance avec un jeton forgé : refus.
    await assert.rejects(
      one(db,'select public.activate_training_session_lease($1,$2,$3)',[S1,INSTANCE_A,'00000000-0000-4000-8000-000000000000']),
      /Bail d edition absent/);
    // get_training_session_lease expose l'état mais jamais le jeton.
    const held=await one(db,'select * from public.get_training_session_lease($1)',[S1]);
    assert.equal(held.status,'held');assert.equal(held.lease_token,undefined);
    await one(db,'select public.release_training_session_lease($1,$2,$3) as released',[S1,INSTANCE_A,lease.lease_token]);
    const free=await one(db,'select * from public.get_training_session_lease($1)',[S1]);
    assert.equal(free.status,'free');
  }finally{await db.close()}
});

test('Point 1: verrou BEFORE STATEMENT present sur les tables garanties et live',async()=>{
  const db=await makeDB();
  try{
    const trigs=await rows(db,`
      select c.relname, t.tgname, (t.tgtype & 1)::int as is_row
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal
        and t.tgname like 'trg_%_edit_lease_lock'
      order by c.relname`);
    assert.deepEqual(
      trigs.map(r=>r.relname),
      ['training_attendance','training_exercise_occurrences','training_live_events','training_live_periods','training_results','training_session_exercises','training_tactical_diagrams']);
    assert.ok(trigs.every(r=>r.is_row===0),'les verrous de bail doivent etre BEFORE STATEMENT');
  }finally{await db.close()}
});

test('Point 1: ecriture live acceptee avec jeton valide, refusee sans jeton valide',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    await assert.rejects(
      rows(db,'update public.training_attendance set present=false where session_id=$1 and player_id=$2',[S1,P_A]),
      /Bail d edition absent/);
    const lease=await acquireLease(db,S1,INSTANCE_A);
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-kb-editor-instance-id':INSTANCE_A,'x-kb-lease-token':'00000000-0000-4000-8000-000000000000'})]);
    await assert.rejects(
      rows(db,'update public.training_attendance set present=false where session_id=$1 and player_id=$2',[S1,P_A]),
      /Bail d edition absent/);
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-kb-editor-instance-id':INSTANCE_B,'x-kb-lease-token':lease.lease_token})]);
    await assert.rejects(
      rows(db,'update public.training_attendance set present=false where session_id=$1 and player_id=$2',[S1,P_A]),
      /Bail d edition absent/);
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-kb-editor-instance-id':INSTANCE_A,'x-kb-lease-token':lease.lease_token})]);
    await rows(db,'update public.training_attendance set present=false where session_id=$1 and player_id=$2',[S1,P_A]);
    assert.equal((await one(db,'select present from public.training_attendance where session_id=$1 and player_id=$2',[S1,P_A])).present,false);
  }finally{await db.close()}
});

test('Point 1: ecriture multi-seances refusee, le session_id reel est verifie',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    const lease=await acquireLease(db,S1,INSTANCE_A);
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-kb-editor-instance-id':INSTANCE_A,'x-kb-lease-token':lease.lease_token})]);
    await assert.rejects(
      rows(db,'update public.training_attendance set present=false where session_id in ($1,$2)',[S1,S2]),
      /Bail d edition absent/);
    assert.equal((await one(db,'select present from public.training_attendance where session_id=$1 and player_id=$2',[S1,P_A])).present,true);
  }finally{await db.close()}
});

test('Point 1: une operation a zero ligne ne modifie rien et reste valide',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    await rows(db,'delete from public.training_attendance where session_id=$1 and player_id=$2',[S1,P_BOGUS]);
    const lease=await acquireLease(db,S1,INSTANCE_A);
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-kb-editor-instance-id':INSTANCE_A,'x-kb-lease-token':lease.lease_token})]);
    await rows(db,'update public.training_attendance set present=present where session_id=$1 and player_id=$2',[S1,P_BOGUS]);
    assert.equal((await one(db,'select count(*)::int as n from public.training_attendance where session_id=$1',[S1])).n,3);
  }finally{await db.close()}
});

test('Point 2: delete_training_session_with_lease supprime seance, enfants et bail sans orphelin',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    const lease=await acquireLease(db,S1,INSTANCE_A);
    const deleted=await one(db,'select public.delete_training_session_with_lease($1,$2,$3) as ok',[S1,INSTANCE_A,lease.lease_token]);
    assert.equal(deleted.ok,true);
    assert.equal((await one(db,'select count(*)::int as n from public.training_sessions where id=$1',[S1])).n,0);
    assert.equal((await one(db,'select count(*)::int as n from public.training_attendance where session_id=$1',[S1])).n,0);
    assert.equal((await one(db,'select count(*)::int as n from public.training_session_exercises where session_id=$1',[S1])).n,0);
    assert.equal((await one(db,'select count(*)::int as n from public.training_results where session_id=$1',[S1])).n,0);
    await db.exec('reset role');
    assert.equal((await one(db,'select count(*)::int as n from public.training_session_leases where session_id=$1',[S1])).n,0);
  }finally{await db.close()}
});

test('Point 2: une suppression directe sans bail est refusee',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    await assert.rejects(
      rows(db,'delete from public.training_sessions where id=$1',[S1]),
      /Bail d edition absent/);
    assert.equal((await one(db,'select count(*)::int as n from public.training_sessions where id=$1',[S1])).n,1);
  }finally{await db.close()}
});

test('Point 2: la FK differee interdit un bail orphelin (session inexistante)',async()=>{
  const db=await makeDB();
  try{
    await db.exec('reset role');
    await assert.rejects(
      db.query(`insert into public.training_session_leases(session_id,user_id,instance_id,expires_at)
                values($1,$2,$3,statement_timestamp()+interval '90 seconds')`,
        ['70000000-0000-4000-8000-0000000000ff',U_COACH,INSTANCE_A]),
      /foreign key|violates/i);
  }finally{await db.close()}
});

test('G2: ancien contrat intact et synchronisation atomique des occurrences libres, manuelles et statistiques',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    const legacy=await saveRPC(db,{sessionId:S1,expected:1,label:'Ancien contrat',
      attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]});
    assert.equal(legacy.status,'saved');assert.equal(legacy.version,2);
    assert.equal((await one(db,'select count(*)::int n from training_exercise_occurrences where session_id=$1',[S1])).n,0);

    const saved=await saveG2(db,{sessionId:S1,expected:2,label:'Occurrences',
      attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}],
      occurrences:[
        {id:O1,kind:'plan_block',exercise_id:null,position:0,stats_position:null,collects_stats:false,copy_diagrams_from_session_id:null,copy_diagrams_from_occurrence_id:null},
        {id:O2,kind:'manual_stat',exercise_id:EX1,position:1,stats_position:1,collects_stats:true,copy_diagrams_from_session_id:null,copy_diagrams_from_occurrence_id:null},
        {id:O3,kind:'plan_block',exercise_id:EX_ARCH,position:2,stats_position:null,collects_stats:false,copy_diagrams_from_session_id:null,copy_diagrams_from_occurrence_id:null}
      ]});
    assert.equal(saved.status,'saved');assert.equal(saved.version,3);
    const occurrences=await rows(db,'select id,kind,exercise_id,collects_stats,active from training_exercise_occurrences where session_id=$1 order by position',[S1]);
    assert.deepEqual(occurrences.map(o=>[o.id,o.kind,o.exercise_id,o.collects_stats,o.active]),[
       [O1,'plan_block',null,false,true],[O2,'manual_stat',EX1,true,true],[O3,'plan_block',EX_ARCH,false,true]]);
    assert.equal((await one(db,'select occurrence_id from training_session_exercises where session_id=$1',[S1])).occurrence_id,O2);
    const usage=(await one(db,'select public.get_exercise_usage($1) usage',[EX_ARCH])).usage;
    assert.equal(usage.used,true);assert.equal(usage.occurrence_count,1);assert.equal(usage.has_history,true);

    // Retrait du bloc lié à EX_ARCH : l'occurrence devient inactive. L'usage visible
    // (used, compteurs) retombe à zéro mais la référence historique demeure : la
    // suppression physique reste interdite, conformément à la FK on delete restrict.
    await saveG2(db,{sessionId:S1,expected:3,label:'Sans bloc archive',
      attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}],
      occurrences:[
        {id:O2,kind:'manual_stat',exercise_id:EX1,position:1,stats_position:1,collects_stats:true,copy_diagrams_from_session_id:null,copy_diagrams_from_occurrence_id:null}
      ]});
    assert.equal((await one(db,'select active from public.training_exercise_occurrences where session_id=$1 and id=$2',[S1,O3])).active,false);
    const afterDeactivation=(await one(db,'select public.get_exercise_usage($1) usage',[EX_ARCH])).usage;
    assert.equal(afterDeactivation.used,false);
    assert.equal(afterDeactivation.occurrence_count,0);
    assert.equal(afterDeactivation.session_count,0);
    assert.equal(afterDeactivation.has_history,true,'une occurrence inactive reste une référence historique');
    await assert.rejects(rows(db,'delete from public.exercises where id=$1',[EX_ARCH]),/foreign key|violates/i);
  }finally{await db.close()}
});

test('G2: UUID stable, omission inactive et réactivation sans purge',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    const base={sessionId:S1,attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}]};
    const stat={id:O2,kind:'plan_block',exercise_id:EX1,position:1,stats_position:1,collects_stats:true,copy_diagrams_from_session_id:null,copy_diagrams_from_occurrence_id:null};
    const free={id:O1,kind:'plan_block',exercise_id:null,position:0,stats_position:null,collects_stats:false,copy_diagrams_from_session_id:null,copy_diagrams_from_occurrence_id:null};
    await saveG2(db,{...base,expected:1,occurrences:[free,stat]});
    await saveG2(db,{...base,expected:2,occurrences:[stat]});
    assert.equal((await one(db,'select active from training_exercise_occurrences where session_id=$1 and id=$2',[S1,O1])).active,false);
    await saveG2(db,{...base,expected:3,occurrences:[free,stat]});
    const restored=await one(db,'select id,active from training_exercise_occurrences where session_id=$1 and id=$2',[S1,O1]);
    assert.equal(restored.id,O1);assert.equal(restored.active,true);
    assert.equal((await one(db,'select count(*)::int n from training_exercise_occurrences where session_id=$1',[S1])).n,2);
  }finally{await db.close()}
});

test('G2: schéma manuel versionné, conflit optimiste et refus C2 sans bail',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    await saveG2(db,{sessionId:S1,expected:1,attendance:[{player_id:P_A,present:true}],exercises:[],
      occurrences:[{id:O1,kind:'plan_block',exercise_id:null,position:0,stats_position:null,collects_stats:false,copy_diagrams_from_session_id:null,copy_diagrams_from_occurrence_id:null}]});
    const cache=leaseCache.get(db);const token=cache.get(`${S1}:${INSTANCE_A}`);
    const created=await one(db,`select * from public.save_training_tactical_diagram($1,$2,null,null,$3::jsonb,0,$4,$5)`,
      [S1,O1,json(diagram()),INSTANCE_A,token]);
    assert.equal(created.status,'saved');assert.equal(created.version,1);
    const changed={...diagram(),title:'Version 2'};
    const updated=await one(db,`select * from public.save_training_tactical_diagram($1,$2,$3,1,$4::jsonb,0,$5,$6)`,
      [S1,O1,created.diagram_id,json(changed),INSTANCE_A,token]);
    assert.equal(updated.status,'saved');assert.equal(updated.version,2);
    const conflict=await one(db,`select * from public.save_training_tactical_diagram($1,$2,$3,1,$4::jsonb,0,$5,$6)`,
      [S1,O1,created.diagram_id,json(diagram()),INSTANCE_A,token]);
    assert.equal(conflict.status,'conflict');assert.equal(conflict.remote_version,2);
    await db.query("select set_config('request.headers','{}',false)");
    await assert.rejects(rows(db,'update training_tactical_diagrams set position=1 where id=$1',[created.diagram_id]),/Bail d edition absent/);
    await assert.rejects(one(db,'select public.delete_training_tactical_diagram($1,$2,1,$3,$4) ok',
      [S1,created.diagram_id,INSTANCE_A,token]),/Conflit de version/);
    assert.equal((await one(db,'select public.delete_training_tactical_diagram($1,$2,2,$3,$4) ok',
      [S1,created.diagram_id,INSTANCE_A,token])).ok,true);
  }finally{await db.close()}
});

test('G2: copie indépendante et idempotente au rejeu, puis blocage du wrapper historique',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    await saveG2(db,{sessionId:S1,expected:1,attendance:[{player_id:P_A,present:true}],exercises:[],
      occurrences:[{id:O1,kind:'plan_block',exercise_id:null,position:0,stats_position:null,collects_stats:false,copy_diagrams_from_session_id:null,copy_diagrams_from_occurrence_id:null}]});
    let token=leaseCache.get(db).get(`${S1}:${INSTANCE_A}`);
    const source=await one(db,'select * from public.save_training_tactical_diagram($1,$2,null,null,$3::jsonb,4,$4,$5)',
      [S1,O1,json(diagram('diagram-source')),INSTANCE_A,token]);
    const target=await saveG2(db,{attendance:[{player_id:P_A,present:true}],exercises:[],occurrences:[
      {id:O2,kind:'plan_block',exercise_id:null,position:0,stats_position:null,collects_stats:false,copy_diagrams_from_session_id:S1,copy_diagrams_from_occurrence_id:O1}
    ]});
    const copied=await one(db,'select * from training_tactical_diagrams where session_id=$1',[target.session_id]);
    assert.notEqual(copied.id,source.diagram_id);assert.notEqual(copied.document.id,'diagram-source');
    assert.equal(copied.position,4);assert.equal(copied.document.title,'Test');
    await one(db,'select * from public.save_training_tactical_diagram($1,$2,$3,1,$4::jsonb,4,$5,$6)',
      [S1,O1,source.diagram_id,json({...diagram('diagram-source'),title:'Source modifiée'}),INSTANCE_A,token]);
    assert.equal((await one(db,'select document from training_tactical_diagrams where id=$1',[copied.id])).document.title,'Test');
    await saveG2(db,{sessionId:target.session_id,expected:1,attendance:[{player_id:P_A,present:true}],exercises:[],occurrences:[
      {id:O2,kind:'plan_block',exercise_id:null,position:0,stats_position:null,collects_stats:false,copy_diagrams_from_session_id:S1,copy_diagrams_from_occurrence_id:O1}
    ]});
    assert.equal((await one(db,'select count(*)::int n from training_tactical_diagrams where session_id=$1',[target.session_id])).n,1);
    await assert.rejects(saveRPC(db,{sessionId:target.session_id,expected:2,attendance:[{player_id:P_A,present:true}],exercises:[]}),/Mise à niveau requise/);
  }finally{await db.close()}
});

test('G2: copie refusée depuis une occurrence d un workspace non autorisé',async()=>{
  const db=await makeDB();
  try{
    // Autre séance (S2, workspace WS_B/G2) : U_OTHER en est le coach et y crée une occurrence
    // source. U_COACH / U_EDITOR n'ont aucun droit sur ce workspace.
    await db.exec(`insert into public.user_profiles values ('${U_OTHER}','Autre');
      insert into public.coaching_group_coaches(group_id,user_id,role) values ('${G2}','${U_OTHER}','coach');`);
    await asUser(db,U_OTHER);
    await saveG2(db,{sessionId:S2,expected:1,workspace:WS_B,group:G2,team:TEAM_B,attendance:[],exercises:[],
      occurrences:[{id:O_SRC,kind:'plan_block',exercise_id:null,position:0,stats_position:null,collects_stats:false,
        copy_diagrams_from_session_id:null,copy_diagrams_from_occurrence_id:null}]});
    const otherToken=leaseCache.get(db).get(`${S2}:${INSTANCE_A}`);
    await one(db,'select * from public.save_training_tactical_diagram($1,$2,null,null,$3::jsonb,0,$4,$5)',
      [S2,O_SRC,json(diagram()),INSTANCE_A,otherToken]);
    assert.equal((await one(db,'select count(*)::int n from training_tactical_diagrams where session_id=$1',[S2])).n,1);

    // U_COACH tente de copier ce schéma dans sa propre séance : la source n'est pas lisible
    // (RLS via la séance parente) → refus explicite, cible intacte.
    await asUser(db,U_COACH);
    await assert.rejects(saveG2(db,{sessionId:S1,expected:1,attendance:[{player_id:P_A,present:true}],exercises:[],
      occurrences:[{id:O_NEW,kind:'plan_block',exercise_id:null,position:0,stats_position:null,collects_stats:false,
        copy_diagrams_from_session_id:S2,copy_diagrams_from_occurrence_id:O_SRC}]}),
      /source introuvable ou inaccessible/i);
    assert.equal((await one(db,'select count(*)::int n from training_exercise_occurrences where session_id=$1 and id=$2',[S1,O_NEW])).n,0);
    assert.equal((await one(db,'select count(*)::int n from training_tactical_diagrams where session_id=$1',[S1])).n,0);
    assert.equal((await one(db,'select version from training_sessions where id=$1',[S1])).version,1,'la cible reste intacte');
  }finally{await db.close()}
});

test('G2: suppression de séance en cascade et rollback des écritures de base sur occurrence invalide',async()=>{
  const db=await makeDB();
  try{
    await asUser(db,U_COACH);
    await assert.rejects(saveG2(db,{sessionId:S1,expected:1,label:'Ne doit pas rester',
      attendance:[{player_id:P_A,present:true}],exercises:[{exercise_id:EX1,position:1}],occurrences:[]}),
      /correspondre exactement/);
    const unchanged=await one(db,'select label,version from training_sessions where id=$1',[S1]);
    assert.equal(unchanged.label,'Séance 1');assert.equal(unchanged.version,1);
    assert.equal((await one(db,'select count(*)::int n from training_attendance where session_id=$1',[S1])).n,3);

    await saveG2(db,{sessionId:S1,expected:1,attendance:[{player_id:P_A,present:true}],exercises:[],occurrences:[
      {id:O1,kind:'plan_block',exercise_id:null,position:0,stats_position:null,collects_stats:false,copy_diagrams_from_session_id:null,copy_diagrams_from_occurrence_id:null}
    ]});
    const token=leaseCache.get(db).get(`${S1}:${INSTANCE_A}`);
    await one(db,'select * from public.save_training_tactical_diagram($1,$2,null,null,$3::jsonb,0,$4,$5)',
      [S1,O1,json(diagram()),INSTANCE_A,token]);
    assert.equal((await one(db,'select public.delete_training_session_with_lease($1,$2,$3) ok',[S1,INSTANCE_A,token])).ok,true);
    assert.equal((await one(db,'select count(*)::int n from training_exercise_occurrences where session_id=$1',[S1])).n,0);
    assert.equal((await one(db,'select count(*)::int n from training_tactical_diagrams where session_id=$1',[S1])).n,0);
  }finally{await db.close()}
});

const attendanceMigration=fs.readdirSync(migrationDir).find(name=>name.endsWith('_training_attendance_polls.sql'));

test('attendance polls enforce roles, deadlines, uniqueness, and one-time leased initialization',async()=>{
  const db=await makeDB();
  try{
    await db.exec(fs.readFileSync(path.join(migrationDir,attendanceMigration),'utf8'));
    const rpc=(name,parameters)=>one(db,`select public.${name}(${parameters.map((_,i)=>'$'+(i+1)).join(',')}) as value`,parameters);
    await asUser(db,U_COACH);
    const saved=await saveG2(db,{playerResults:true,attendance:[{player_id:P_A,present:false}]});
    assert.equal(saved.status,'saved');
    const id=saved.session_id;
    const manage=(open,deadline=null)=>rpc('manage_training_attendance_poll',[id,open,deadline]);
    const poll=async()=> (await rpc('get_training_attendance_poll',[id])).value;
    const answer=(availability,target=null)=>rpc('answer_training_attendance_poll',[id,availability,target]);
    const initialize=(version,token=saved.lease_token)=>rpc('initialize_training_attendance_poll',[id,INSTANCE_A,token,version]);
    const myPoll=group=>rows(db,'select * from public.list_my_training_attendance_polls($1,$2)',[group,id]);

    assert.equal(await poll(),null);
    await manage(true);
    assert.deepEqual((await poll()).players.map(p=>p.availability),[null,null]);
    await assert.rejects(rpc('manage_training_attendance_poll',[S2,true,null]),{code:'42501'});
    await assert.rejects(answer('present',P_C),{code:'42501'});
    await asUser(db,U_NONE);
    assert.equal((await myPoll(G1))[0].availability,null);
    assert.deepEqual(await myPoll(G2),[]);
    await assert.rejects(answer('present',P_B),{code:'42501'});
    await assert.rejects(manage(false),{code:'42501'});
    await assert.rejects(poll(),{code:'42501'});
    await assert.rejects(initialize(saved.version),{code:'42501'});
    await assert.rejects(db.query('insert into training_attendance(session_id,player_id,present) values($1,$2,true)',[id,P_B]),{code:'55000'});
    await assert.rejects(db.query('select * from training_attendance_responses'),{code:'42501'});
    await answer('unsure');
    await answer('present');
    await answer('present');
    assert.equal((await myPoll(G1))[0].availability,'present');
    await asUser(db,U_OTHER);
    assert.equal((await myPoll(G1))[0].availability,null);
    await answer('absent');
    await asUser(db,U_COACH);
    assert.deepEqual((await poll()).players.map(p=>p.availability),['present','absent']);
    await manage(false);
    await asUser(db,U_NONE);
    await assert.rejects(answer('absent'),{code:'55000'});
    await asUser(db,U_COACH);
    await assert.rejects(initialize(saved.version,O1),{code:'55000'});
    await assert.rejects(initialize(0),{code:'40001'});
    const initialized=(await initialize(saved.version)).value;
    assert.deepEqual(initialized.present,[P_A]);
    assert.equal(initialized.version,saved.version+1);
    assert.ok((await poll()).initialized_at);
    await manage(true,new Date(Date.now()+60_000).toISOString());
    await asUser(db,U_NONE);
    await answer('absent');
    await asUser(db,U_COACH);
    assert.equal((await poll()).players[0].late,true);
    assert.deepEqual((await initialize(initialized.version)).value.present,[P_A]);
    const corrected=await saveG2(db,{playerResults:true,sessionId:id,expected:initialized.version,
      attendance:[{player_id:P_A,present:false}]});
    assert.equal(corrected.status,'saved');
    await answer('present',P_A);
    assert.deepEqual((await initialize(corrected.version)).value.present,[]);
    await answer(null,P_A);
    assert.equal((await poll()).players[0].availability,null);
    await db.exec('reset role');
    await db.query("update training_attendance_polls set deadline=clock_timestamp()-interval '1 second' where session_id=$1",[id]);
    assert.equal((await one(db,'select count(*)::int as n from training_attendance_responses where session_id=$1 and player_id=$2',[id,P_A])).n,1);
    await asUser(db,U_NONE);
    await assert.rejects(answer('present'),{code:'55000'});
    assert.equal((await myPoll(G1))[0].is_open,false);
  }finally{await db.close()}
});

test('empty initialization persists, historical statistics survive and Discord reservations cannot duplicate',async()=>{
  const db=await makeDB();
  try{
    await db.exec(fs.readFileSync(path.join(migrationDir,attendanceMigration),'utf8'));
    await asUser(db,U_COACH);
    const empty=await saveG2(db,{playerResults:true});
    const manage=id=>db.query('select manage_training_attendance_poll($1,true,null)',[id]);
    await manage(empty.session_id);
    const initialized=await one(db,'select initialize_training_attendance_poll($1,$2,$3,$4) as result',
      [empty.session_id,INSTANCE_A,empty.lease_token,empty.version]);
    assert.deepEqual(initialized.result.present,[]);
    assert.ok((await one(db,"select get_training_attendance_poll($1)->>'initialized_at' as marker",[empty.session_id])).marker);

    const history=()=>rows(db,'select id,player_id,successes,attempts,variant from training_results where session_id=$1 order by id',[S1]);
    const before=await history();
    await manage(S1);
    const lease=await acquireLease(db,S1);
    const historical=await one(db,'select initialize_training_attendance_poll($1,$2,$3,1) as result',[S1,INSTANCE_A,lease.lease_token]);
    assert.deepEqual([...historical.result.present].sort(),[P_A,P_B,P_REMOVED].sort());
    assert.deepEqual(await history(),before);

    const reserve=(user=U_COACH,reminder=false,configured=true)=>one(db,
      'select reserve_training_attendance_discord($1,$2,$3,$4,$5) as result',[empty.session_id,G1,user,reminder,configured]);
    await assert.rejects(reserve(),{code:'42501'});
    await db.exec('set role service_role');
    await assert.rejects(reserve(U_NONE),{code:'42501'});
    await assert.rejects(reserve(U_COACH,false,false),{code:'55000'});
    await assert.rejects(reserve(U_COACH,true),{code:'55000'});
    const first=(await reserve()).result;
    assert.ok(first.id);
    assert.equal((await reserve()).result,null);
    await db.query("select finish_training_attendance_discord($1,'sent')",[first.id]);
    assert.equal((await reserve()).result,null);
    const reminder=(await reserve(U_COACH,true)).result;
    assert.ok(reminder.id);
    await db.query("select finish_training_attendance_discord($1,'unknown')",[reminder.id]);
    assert.equal((await reserve(U_COACH,true)).result,null);
  }finally{await db.close()}
});

const attendanceReviewMigration=fs.readdirSync(migrationDir).find(name=>name.endsWith('_training_attendance_review.sql'));

const attendanceFinalMigration=fs.readdirSync(migrationDir).find(name=>name.endsWith('_finalize_training_attendance_poll.sql'));

async function installAttendanceReview(db){
  const stats=fs.readFileSync(path.join(migrationDir,'20261124173651_player_training_statistics.sql'),'utf8');
  await db.exec(stats.slice(stats.indexOf('create table private.training_stats_player_aliases'),stats.indexOf('create or replace function private.can_read_training')));
  await db.exec(`
    alter table coaching_group_players add column stats_access text default 'group';
    alter table exercises add column category text, add column category_id uuid, add column copied_from_exercise_id uuid;
  `);
  for(const file of [attendanceMigration,attendanceReviewMigration,attendanceFinalMigration]){
    await db.exec(fs.readFileSync(path.join(migrationDir,file),'utf8'));
  }
}

test('attendance review: planning stays outside statistics until start, with historical and future date coverage',async()=>{
  const db=await makeDB();
  try{
    await installAttendanceReview(db);
    await asUser(db,U_COACH);
    const args={p_editor_instance_id:INSTANCE_A,p_workspace_id:WS_A,p_group_id:G1,p_team_id:TEAM_A,
      p_trained_on:'2026-01-15',p_attendance:[{player_id:P_A,present:false}],p_exercises:[],p_results:[],p_occurrences:[]};
    const planned=await one(db,'select * from save_planned_training_session($1)',[json(args)]);
    assert.equal(planned.status,'saved');assert.equal(planned.version,2);
    const future=await one(db,'select * from save_planned_training_session($1)',[json({...args,p_trained_on:'2099-01-15'})]);
    assert.equal((await saveG2(db,{playerResults:true,trainedOn:'2099-01-16',
      attendance:[{player_id:P_A,present:true}]})).status,'saved','ordinary future rows are also excluded');
    const stats=async(view='staff')=>(await one(db,'select get_training_statistics_dataset($1,$2) as dataset',[G1,view])).dataset;
    assert.deepEqual((await stats()).sessions.map(row=>row.trained_on),['2026-09-30']);
    assert.equal((await stats()).results.length,2);
    await assert.rejects(one(db,'select start_training_attendance_session($1,$2,$3,$4)',[future.session_id,INSTANCE_A,future.lease_token,future.version]),{code:'22023'});
    await assert.rejects(one(db,'select start_training_attendance_session($1,$2,$3,$4)',[planned.session_id,INSTANCE_A,planned.lease_token,1]),{code:'40001'});
    await assert.rejects(one(db,'select start_training_attendance_session($1,$2,$3,$4)',[planned.session_id,INSTANCE_A,O1,planned.version]),{code:'55000'});
    await asUser(db,U_NONE);
    await assert.rejects(one(db,'select start_training_attendance_session($1,$2,$3,$4)',[planned.session_id,INSTANCE_A,planned.lease_token,planned.version]),{code:'42501'});
    assert.equal((await stats('player')).sessions.length,1);
    await asUser(db,U_COACH);
    await db.query('select manage_training_attendance_poll($1,true,null)',[planned.session_id]);
    for(const [availability,player] of [['unsure',P_A],['absent',P_B]]){
      await db.query('select answer_training_attendance_poll($1,$2,$3)',[planned.session_id,availability,player]);
    }
    const {started}=await one(db,'select start_training_attendance_session($1,$2,$3,$4) as started',[planned.session_id,INSTANCE_A,planned.lease_token,planned.version]);
    assert.ok(started.started_at);assert.deepEqual(started.present,[]);
    const zero=(await one(db,'select get_training_attendance_poll($1) as poll',[planned.session_id])).poll;
    assert.equal(zero.is_open,false);assert.equal(zero.initialized_at,zero.started_at);
    assert.deepEqual(zero.players.map(player=>player.availability),['unsure','absent']);
    const result=await stats();
    assert.deepEqual(result.sessions.map(row=>row.trained_on),['2026-01-15','2026-09-30']);
    assert.equal(result.attendance.length,4);assert.equal(result.results.length,2);
    assert.equal((await one(db,'select start_training_attendance_session($1,$2,$3,$4) as started',[planned.session_id,INSTANCE_A,planned.lease_token,started.version])).started.version,started.version);
  }finally{await db.close()}
});

test('attendance final: first start copies forecasts, closes the poll and preserves later coach corrections on replay',async()=>{
  const db=await makeDB();
  try{
    await installAttendanceReview(db);
    await asUser(db,U_COACH);
    const args={p_editor_instance_id:INSTANCE_A,p_workspace_id:WS_A,p_group_id:G1,p_team_id:TEAM_A,p_trained_on:'2026-01-16',
      p_attendance:[{player_id:P_A,present:true},{player_id:P_B,present:false}],p_exercises:[],p_results:[],p_occurrences:[]};
    let saved=await one(db,'select * from save_planned_training_session($1)',[json(args)]);
    const id=saved.session_id;
    const rpc=(name,params)=>one(db,`select ${name}(${params.map((_,index)=>'$'+(index+1)).join(',')}) as value`,params);
    const poll=async()=> (await rpc('get_training_attendance_poll',[id])).value;
    const manage=open=>rpc('manage_training_attendance_poll',[id,open,null]);
    const answer=(availability,target=null)=>rpc('answer_training_attendance_poll',[id,availability,target]);
    const saveActual=attendance=>saveG2(db,{playerResults:true,sessionId:id,expected:saved.version,token:saved.lease_token,attendance});
    const token=saved.lease_token;
    saved=await saveActual([{player_id:P_A,present:false},{player_id:P_B,present:false}]);
    await manage(true);
    await answer('present',P_A);
    await answer('present',P_B);
    assert.equal((await poll()).initialized_at,null,'consultation does not initialize');
    const started=(await rpc('start_training_attendance_session',[id,INSTANCE_A,token,saved.version])).value;
    assert.deepEqual(started.present,[P_B],'only the uncorrected positive answer is copied');
    const frozen=await poll();
    assert.equal(frozen.is_open,false);
    assert.equal(frozen.started_at,started.started_at);
    assert.deepEqual(frozen.players.map(p=>p.availability),['present','present']);

    await asUser(db,U_NONE);
    await assert.rejects(answer('absent'),{code:'55000'});
    assert.equal((await one(db,'select is_open from list_my_training_attendance_polls($1,$2)',[G1,id])).is_open,false);
    await asUser(db,U_COACH);
    await assert.rejects(answer('unsure',P_A),{code:'55000'});
    await assert.rejects(manage(true),{code:'55000'});
    await db.exec('set role service_role');
    await assert.rejects(rpc('reserve_training_attendance_discord',[id,G1,U_COACH,true,true]),{code:'55000'});
    await asUser(db,U_COACH);

    saved={version:started.version,lease_token:token};
    saved=await saveActual([{player_id:P_A,present:true},{player_id:P_B,present:false}]);
    const replay=(await rpc('start_training_attendance_session',[id,INSTANCE_A,token,saved.version])).value;
    assert.deepEqual(replay.present,[P_A]);
    assert.equal(replay.version,saved.version);
    assert.equal(replay.started_at,started.started_at);
    assert.deepEqual(await poll(),frozen,'official corrections do not change published forecasts');
  }finally{await db.close()}
});

const attendanceCorrectionMigration=fs.readFileSync(path.join(migrationDir,
  '20261126110321_correct_training_poll_initialization.sql'),'utf8');

test('issue 5 reproduces the old prefill and fixes pending polls without rewriting migration-time data',async()=>{
  const db=await makeDB();
  try{
    await installAttendanceReview(db);
    const others=[P_B,'20000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000007'];
    for(const id of others.slice(1)){
      await db.query('insert into players(id,display_name,workspace_id) values($1,$2,$3)',[id,'Synthetic',WS_A]);
      await db.query('insert into coaching_group_players(group_id,player_id,active) values($1,$2,true)',[G1,id]);
    }
    await asUser(db,U_COACH);
    const roster=[{player_id:P_A,present:false},...others.map(player_id=>({player_id,present:true}))];
    const state=async id=>(await one(db,'select get_training_attendance_poll($1) as poll',[id])).poll;
    const manage=(id,open)=>db.query('select manage_training_attendance_poll($1,$2,null)',[id,open]);
    const start=async saved=>(await one(db,'select start_training_attendance_session($1,$2,$3,$4) as result',
      [saved.session_id,INSTANCE_A,saved.lease_token,saved.version])).result;
    async function prepare(){
      await asUser(db,U_COACH);
      const saved=await saveG2(db,{playerResults:true,trainedOn:'2026-01-10',attendance:roster});
      await manage(saved.session_id,true);
      await asUser(db,U_NONE);
      await db.query("select answer_training_attendance_poll($1,'present')",[saved.session_id]);
      await asUser(db,U_COACH);
      await manage(saved.session_id,false);
      return saved;
    }
    const old=await prepare();
    const pending=await prepare();
    const pendingBefore=await state(pending.session_id);
    assert.ok(pendingBefore.initialized_at);
    assert.equal(pendingBefore.started_at,null);
    const wrong=await start(old);
    assert.deepEqual([...wrong.present].sort(),others);
    const oldBefore=await state(old.session_id);
    assert.equal(oldBefore.is_open,false);

    await db.exec('reset role');
    await db.exec(attendanceCorrectionMigration);
    await asUser(db,U_COACH);
    assert.deepEqual(await state(pending.session_id),pendingBefore);
    assert.deepEqual(await state(old.session_id),oldBefore);
    const fixed=await start(pending);
    assert.deepEqual(fixed.present,[P_A]);
    const corrected=await state(pending.session_id);
    assert.equal(corrected.is_open,false);
    assert.equal(corrected.initialized_at,corrected.started_at);
    assert.deepEqual(corrected.players,pendingBefore.players);
    assert.equal((await rows(db,'select * from training_attendance where session_id=$1',[pending.session_id])).length,5);

    const fresh=await prepare();
    assert.equal((await state(fresh.session_id)).initialized_at,null);
    assert.deepEqual((await start(fresh)).present,[P_A]);
  }finally{await db.close()}
});

test('issue 5 tracks explicit choices across planned and ordinary saves and preserves historical and poll-free rosters',async()=>{
  const db=await makeDB();
  try{
    await installAttendanceReview(db);
    await db.exec(attendanceCorrectionMigration);
    await asUser(db,U_COACH);
    const args={p_editor_instance_id:INSTANCE_A,p_workspace_id:WS_A,p_group_id:G1,p_team_id:TEAM_A,
      p_trained_on:'2026-01-19',p_exercises:[],p_results:[],p_occurrences:[]};
    const save=(attendance,planned=false,source=null)=>one(db,'select * from save_training_session_with_attendance_choices($1,$2)',
      [json({...args,p_attendance:attendance,...(source?{p_session_id:source.session_id,p_expected_version:source.version,p_lease_token:source.lease_token}:{})}),planned]);
    const start=async saved=>(await one(db,'select start_training_attendance_session($1,$2,$3,$4) result',
      [saved.session_id,INSTANCE_A,saved.lease_token,saved.version])).result;
    const poll=async id=>(await one(db,'select get_training_attendance_poll($1) poll',[id])).poll;
    const manage=(id,open)=>db.query('select manage_training_attendance_poll($1,$2,null)',[id,open]);
    const answer=(id,availability,player)=>db.query('select answer_training_attendance_poll($1,$2,$3)',[id,availability,player]);
    const ordinary=[{player_id:P_A,present:true},{player_id:P_B,present:true}];
    const noPoll=await save(ordinary);
    assert.deepEqual([...(await start(noPoll)).present].sort(),[P_A,P_B]);
    assert.equal(await poll(noPoll.session_id),null);

    const roster=[{player_id:P_A,present:false,coach_choice:true},{player_id:P_B,present:true}];
    let planned=await save(roster,true);
    const id=planned.session_id;
    planned=await save(roster,false,planned);
    await manage(id,true);
    await answer(id,'present',P_A);
    await answer(id,'unsure',P_B);
    assert.equal((await poll(id)).initialized_at,null);
    await asUser(db,U_OTHER);
    await assert.rejects(db.query('select manage_training_attendance_poll($1,true,null)',[id]),{code:'42501'});
    await assert.rejects(db.query('select answer_training_attendance_poll($1,$2,$3)',[id,'present',P_A]),{code:'42501'});
    await asUser(db,U_COACH);
    const zero=await start(planned);
    assert.deepEqual(zero.present,[],'explicit absence and uncertain forecast stay absent');

    const explicit=await save([{player_id:P_A,present:true,coach_choice:true},{player_id:P_B,present:true}]);
    await manage(explicit.session_id,true);
    await answer(explicit.session_id,'absent',P_A);
    const activated=await start(explicit);
    assert.deepEqual(activated.present,[P_A],'keep the coach choice, clear the non-response');
    const corrected=await save([{player_id:P_A,present:false},{player_id:P_B,present:true}],false,
      {...explicit,version:activated.version});
    const replay=await start(corrected);
    assert.deepEqual(replay.present,[P_B]);
    assert.equal(replay.version,corrected.version);
    assert.equal(replay.started_at,activated.started_at);
    await assert.rejects(answer(explicit.session_id,'present',P_A),{code:'55000'});

    const live=await save(ordinary);
    await db.exec('begin');
    await db.query('select activate_training_session_lease($1,$2,$3)',[live.session_id,INSTANCE_A,live.lease_token]);
    await db.query("insert into training_live_periods(session_id,group_id,period_number,label) values($1,$2,1,'Collecte')",[live.session_id,G1]);
    await db.exec('commit');
    await manage(live.session_id,true);
    await answer(live.session_id,'absent',P_A);
    assert.deepEqual([...(await start(live)).present].sort(),[P_A,P_B]);

    const historical=await acquireLease(db,S1);
    await manage(S1,true);
    await answer(S1,'absent',P_A);
    const rosterBefore=await rows(db,'select player_id,present from training_attendance where session_id=$1 order by player_id',[S1]);
    const resultsBefore=await rows(db,'select * from training_results where session_id=$1 order by id',[S1]);
    await start({session_id:S1,version:1,lease_token:historical.lease_token});
    assert.deepEqual(await rows(db,'select player_id,present from training_attendance where session_id=$1 order by player_id',[S1]),rosterBefore);
    assert.deepEqual(await rows(db,'select * from training_results where session_id=$1 order by id',[S1]),resultsBefore);
  }finally{await db.close()}
});

const groupTransferMigration=fs.readFileSync(path.join(migrationDir,'20261126120642_transfer_training_preparation_group.sql'),'utf8');

async function installGroupTransfer(db){
  await installAttendanceReview(db);
  await db.exec(attendanceCorrectionMigration);
  await db.exec("alter table public.teams alter column id set default gen_random_uuid()");
}

const transferArgs=(session,{group=G2,notes='Plan modifié',occurrences=[],exercises=[],force=false}={})=>[
  json({p_session_id:session.session_id,p_editor_instance_id:INSTANCE_A,p_lease_token:session.lease_token,
    p_expected_version:session.version,p_group_id:group,p_notes:notes,p_label:'Préparation transférée',
    p_occurrences:occurrences,p_exercises:exercises,p_results:[],p_attendance:[],p_force:force}),G1
];
const transfer=(db,session,options)=>one(db,'select * from save_training_preparation_group_transfer($1,$2)',transferArgs(session,options));

test('issue 7 reproduces the old group rejection and atomically transfers the plan, team and roster',async()=>{
  const db=await makeDB();
  try{
    await installGroupTransfer(db);
    await db.query('insert into coaching_group_coaches(group_id,user_id,role) values($1,$2,$3)',[G2,U_COACH,'coach']);
    await db.query('insert into coaching_group_players(group_id,player_id) values($1,$2)',[G2,P_B]);
    await asUser(db,U_COACH);
    const plan={id:O1,kind:'plan_block',position:0,exercise_id:EX1,collects_stats:false};
    const original=await saveG2(db,{playerResults:true,notes:'Plan source',occurrences:[{...plan,id:O_SRC}],
      attendance:[{player_id:P_A,present:true}]});
    await assert.rejects(saveG2(db,{playerResults:true,sessionId:original.session_id,expected:original.version,
      token:original.lease_token,group:G2,occurrences:[plan]}),{code:'22023',message:'Séance hors du groupe'});
    await db.exec('reset role');
    await db.exec(groupTransferMigration);
    await asUser(db,U_COACH);
    const blocker=id=>one(db,'select get_training_group_transfer_blocker($1) reason',[id]);
    assert.match((await blocker(original.session_id)).reason,/historique/);
    const planned=(await one(db,'select * from save_planned_training_session($1)',[json({
      p_editor_instance_id:INSTANCE_A,p_workspace_id:WS_A,p_group_id:G1,p_team_id:TEAM_A,
      p_notes:'Plan conservé',p_exercises:[],p_occurrences:[plan],p_results:[],
      p_attendance:[{player_id:P_A,present:true}]
    })]));
    assert.equal((await blocker(planned.session_id)).reason,null);
    const id=planned.session_id;
    const conflict=await transfer(db,{...planned,version:planned.version-1},{occurrences:[plan],force:true});
    assert.equal(conflict.status,'conflict','force cannot bypass a transfer conflict');
    await assert.rejects(transfer(db,planned,{occurrences:[{...plan,exercise_id:O2}]}),{code:'23503'});
    assert.equal((await one(db,'select group_id from training_sessions where id=$1',[id])).group_id,G1);
    assert.ok((await one(db,'select present from training_attendance where session_id=$1',[id])).present);
    assert.deepEqual(await rows(db,'select id from teams where workspace_id=$1 and name=$2',[WS_A,'Équipe 2']),[]);
    const moved=await transfer(db,planned,{occurrences:[plan]});
    assert.equal(moved.status,'saved');
    const parent=await one(db,'select group_id,workspace_id,team_id,notes,version from training_sessions where id=$1',[id]);
    assert.deepEqual(parent,{group_id:G2,workspace_id:WS_A,team_id:moved.team_id,notes:'Plan modifié',version:moved.version});
    assert.equal((await one(db,'select name from teams where id=$1',[moved.team_id])).name,'Équipe 2');
    assert.deepEqual(await rows(db,'select player_id from training_attendance where session_id=$1',[id]),[]);
    assert.equal((await one(db,'select exercise_id from training_exercise_occurrences where id=$1',[O1])).exercise_id,EX1);
    assert.equal((await saveG2(db,{playerResults:true,sessionId:id,group:G2,team:moved.team_id,
      expected:moved.version,token:planned.lease_token,occurrences:[plan]})).status,'saved');
    await assert.rejects(db.query('select manage_training_attendance_poll_for_group($1,true,null,$2)',[id,G1]),{code:'40001'});
  }finally{await db.close()}
});

test('issue 7 blocks transfers for attempts outside either group or after poll, start, result or collection',async()=>{
  const db=await makeDB();
  try{
    await installGroupTransfer(db);
    await db.exec(groupTransferMigration);
    await asUser(db,U_COACH);
    const newSession=options=>saveG2(db,{playerResults:true,...options});
    const missingTarget=await newSession();
    await assert.rejects(transfer(db,missingTarget),{code:'42501'});
    await db.exec('reset role');
    await db.query('insert into coaching_group_coaches(group_id,user_id,role) values($1,$2,$3)',[G2,U_COACH,'coach']);
    await asUser(db,U_COACH);
    const blocker=async id=>(await one(db,'select get_training_group_transfer_blocker($1) reason',[id])).reason;
    const manage=(session,open)=>db.query('select manage_training_attendance_poll_for_group($1,$2,null,$3)',[session.session_id,open,G1]);
    const poll=await newSession();
    await manage(poll,true);
    for(const open of [true,false]){
      await manage(poll,open);
      assert.match(await blocker(poll.session_id),/sondage/);
      await assert.rejects(transfer(db,poll),{code:'23514',message:/sondage/});
    }
    const started=await newSession({trainedOn:'2026-01-01'});
    const startedRow=(await one(db,'select start_training_attendance_session($1,$2,$3,$4) as result',
      [started.session_id,INSTANCE_A,started.lease_token,started.version])).result;
    await assert.rejects(transfer(db,{...started,version:startedRow.version}),{code:'23514',message:/démarré/});
    assert.match(await blocker(S1),/résultats/);
    const historyLease=await acquireLease(db,S1);
    await assert.rejects(transfer(db,{session_id:S1,version:1,lease_token:historyLease.lease_token}),{code:'23514',message:/résultats/});

    const plan={id:O1,kind:'manual_stat',position:0,exercise_id:EX1,collects_stats:true,stats_position:1};
    const collection=await newSession({occurrences:[plan],exercises:[{exercise_id:EX1,position:1}]});
    await db.query('select open_training_player_collection($1,$2)',[collection.session_id,O1]);
    assert.match(await blocker(collection.session_id),/collecte/);
    await assert.rejects(transfer(db,collection),{code:'23514',message:/collecte/});

    await asUser(db,U_EDITOR);
    const editorLease=await acquireLease(db,S1,INSTANCE_B);
    assert.equal(editorLease.status,'held','cannot take a live lease from the coach');
    await assert.rejects(transfer(db,collection),{code:'55000'});
  }finally{await db.close()}
});

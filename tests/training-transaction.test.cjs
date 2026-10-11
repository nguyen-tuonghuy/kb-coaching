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
insert into auth.users values ('${U_COACH}'),('${U_EDITOR}'),('${U_NONE}');
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

async function makeDB(){const db=new PGlite();await db.exec(fixture);await db.exec(migration);await db.exec(migrationFix);await db.exec(migrationLease);await db.exec(migrationG2);return db}
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

async function saveG2(db,{occurrences=[],...options}={}){
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
  const result=await one(db,`select * from public.save_training_session_with_occurrences(
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

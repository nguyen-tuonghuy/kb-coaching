const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261015120000_allow_video_review_without_global_comment.sql'),'utf8');
const db=new PGlite();
const ids={
  group:'10000000-0000-4000-8000-000000000001',
  otherGroup:'10000000-0000-4000-8000-000000000002',
  coach:'20000000-0000-4000-8000-000000000001',
  player:'20000000-0000-4000-8000-000000000002',
  videoWithNote:'30000000-0000-4000-8000-000000000001',
  videoWithComment:'30000000-0000-4000-8000-000000000002',
  emptyVideo:'30000000-0000-4000-8000-000000000003',
  legacyVideo:'30000000-0000-4000-8000-000000000004',
  note:'40000000-0000-4000-8000-000000000001',
  legacyNote:'40000000-0000-4000-8000-000000000002'
};

async function setUser(userId){
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[userId||'']);
}

before(async()=>{
  await db.exec(`
    create schema auth;
    create schema private;
    create role authenticated;
    create role anonymous_probe;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create table private.test_group_coaches(group_id uuid not null,user_id uuid not null,primary key(group_id,user_id));
    create function private.is_group_coach(p_group_id uuid) returns boolean language sql stable as $$
      select exists(select 1 from private.test_group_coaches c where c.group_id=p_group_id and c.user_id=auth.uid())
    $$;
    create table public.coaching_player_videos(
      id uuid primary key,
      group_id uuid not null,
      status text not null default 'new',
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_text text not null default '',
      feedback_synced_at timestamptz,
      feedback_sync_error text
    );
    create table public.coaching_player_video_notes(
      id uuid primary key,
      video_id uuid not null references public.coaching_player_videos(id) on delete cascade,
      group_id uuid not null
    );
    create table public.coaching_player_video_reads(
      video_id uuid not null references public.coaching_player_videos(id) on delete cascade,
      user_id uuid not null,
      seen_at timestamptz not null default now(),
      primary key(video_id,user_id)
    );
    create function public.review_player_video(uuid,uuid,text) returns void
      language plpgsql security definer set search_path to 'public','pg_temp'
      as $$ begin null; end $$;
    revoke execute on function public.review_player_video(uuid,uuid,text) from public;
    grant execute on function public.review_player_video(uuid,uuid,text) to authenticated;
    insert into private.test_group_coaches values('${ids.group}','${ids.coach}');
    insert into public.coaching_player_videos(id,group_id,status,review_text) values
      ('${ids.videoWithNote}','${ids.group}','new',''),
      ('${ids.videoWithComment}','${ids.group}','new',''),
      ('${ids.emptyVideo}','${ids.group}','new',''),
      ('${ids.legacyVideo}','${ids.group}','reviewed','Ancien retour');
    insert into public.coaching_player_video_notes values
      ('${ids.note}','${ids.videoWithNote}','${ids.group}'),
      ('${ids.legacyNote}','${ids.legacyVideo}','${ids.group}');
  `);
  await db.exec(migration);
});

after(async()=>db.close());

test('la migration rend review_text nullable et conserve les attributs de sécurité',async()=>{
  const columns=await db.query(`select is_nullable from information_schema.columns where table_schema='public' and table_name='coaching_player_videos' and column_name='review_text'`);
  assert.equal(columns.rows[0].is_nullable,'YES');
  const functions=await db.query(`select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='review_player_video'`);
  assert.equal(functions.rows[0].prosecdef,true);
  assert.deepEqual(functions.rows[0].proconfig,['search_path=public, pg_temp']);
  const privileges=await db.query(`select has_function_privilege('authenticated','public.review_player_video(uuid,uuid,text)','execute') as authenticated,has_function_privilege('anonymous_probe','public.review_player_video(uuid,uuid,text)','execute') as anonymous`);
  assert.deepEqual(privileges.rows[0],{authenticated:true,anonymous:false});
});

test('un repère permet une publication sans commentaire et reste intact',async()=>{
  await setUser(ids.coach);
  await db.query(`select public.review_player_video($1,$2,null)`,[ids.group,ids.videoWithNote]);
  const video=await db.query(`select status,review_text,reviewed_by from public.coaching_player_videos where id=$1`,[ids.videoWithNote]);
  assert.deepEqual(video.rows[0],{status:'reviewed',review_text:null,reviewed_by:ids.coach});
  const notes=await db.query(`select count(*)::int as count from public.coaching_player_video_notes where video_id=$1`,[ids.videoWithNote]);
  assert.equal(notes.rows[0].count,1);
});

test('un commentaire seul est normalisé et permet la publication',async()=>{
  await setUser(ids.coach);
  await db.query(`select public.review_player_video($1,$2,$3)`,[ids.group,ids.videoWithComment,'  Retour global  ']);
  const video=await db.query(`select status,review_text from public.coaching_player_videos where id=$1`,[ids.videoWithComment]);
  assert.deepEqual(video.rows[0],{status:'reviewed',review_text:'Retour global'});
});

test('une analyse entièrement vide est refusée sans changer le statut',async()=>{
  await setUser(ids.coach);
  await assert.rejects(db.query(`select public.review_player_video($1,$2,$3)`,[ids.group,ids.emptyVideo,'   ']),/Analyse vide/);
  const video=await db.query(`select status from public.coaching_player_videos where id=$1`,[ids.emptyVideo]);
  assert.equal(video.rows[0].status,'new');
});

test('les droits entraîneur et les anciennes vidéos reviewed sont préservés',async()=>{
  await setUser(ids.player);
  await assert.rejects(db.query(`select public.review_player_video($1,$2,$3)`,[ids.group,ids.emptyVideo,'Retour']),/Accès entraîneur refusé/);
  await setUser(ids.coach);
  await db.query(`select public.review_player_video($1,$2,$3)`,[ids.group,ids.legacyVideo,'Retour actualisé']);
  const video=await db.query(`select status,review_text from public.coaching_player_videos where id=$1`,[ids.legacyVideo]);
  assert.deepEqual(video.rows[0],{status:'reviewed',review_text:'Retour actualisé'});
});

test('un partage repères seuls obsolète n efface pas un commentaire déjà publié',async()=>{
  await setUser(ids.coach);
  await db.query(`select public.review_player_video($1,$2,null)`,[ids.group,ids.legacyVideo]);
  const video=await db.query(`select status,review_text from public.coaching_player_videos where id=$1`,[ids.legacyVideo]);
  assert.deepEqual(video.rows[0],{status:'reviewed',review_text:'Retour actualisé'});
});

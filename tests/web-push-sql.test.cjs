const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migration = name => readFileSync(join(__dirname, '../supabase/migrations', name), 'utf8');
const uuid = n => '12345678-0000-4000-8000-' + String(n).padStart(12, '0');
const [coach, player, absent, outsider, group, otherGroup, athlete, bench, unrelated, session, occurrence, exercise] =
  Array.from({ length: 12 }, (_, i) => uuid(i + 1));

test('Web Push reuses business access, isolates devices and leases delivery', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table coaching_group_coaches(group_id uuid,user_id uuid);
    create table coaching_group_players(group_id uuid,player_id uuid,active boolean);
    create table coaching_player_accounts(group_id uuid,player_id uuid,user_id uuid);
    create table coaching_player_videos(id uuid,group_id uuid,player_id uuid,status text,uploaded_by uuid,reviewed_by uuid);
    create table coaching_player_video_notes(id uuid,group_id uuid,video_id uuid,author_user_id uuid);
    create table coaching_player_message_history(id uuid,group_id uuid,player_id uuid,created_by uuid,sender_role text);
    create table coaching_player_message_reads(message_id uuid,user_id uuid,viewer_role text);
    create table training_sessions(id uuid,group_id uuid);
    create table exercises(id uuid,measurement_type text);
    create table training_session_exercises(session_id uuid,occurrence_id uuid,exercise_id uuid);
    create table training_exercise_occurrences(session_id uuid,id uuid,exercise_id uuid,active boolean,collects_stats boolean);
    create table training_attendance(session_id uuid,player_id uuid,present boolean);
    create table training_player_collections(session_id uuid,occurrence_id uuid,measurement_type text,
      opened_by uuid,state text default 'open', unique(session_id,occurrence_id));
    create table training_player_collection_players(session_id uuid,occurrence_id uuid,player_id uuid,user_id uuid,
      unique(session_id,occurrence_id,player_id));
    insert into auth.users values ('${coach}'),('${player}'),('${absent}'),('${outsider}');
    insert into coaching_group_coaches values ('${group}','${coach}'),('${otherGroup}','${outsider}');
    insert into coaching_group_players values ('${group}','${athlete}',true),
      ('${group}','${bench}',true),('${otherGroup}','${unrelated}',true),('${group}','${unrelated}',false);
    insert into coaching_player_accounts values ('${group}','${athlete}','${player}'),
      ('${group}','${bench}','${absent}'),('${otherGroup}','${unrelated}','${outsider}'),
      ('${group}','${unrelated}','${outsider}');
    insert into training_sessions values ('${session}','${group}');
    insert into exercises values ('${exercise}','count');
    insert into training_exercise_occurrences values ('${session}','${occurrence}','${exercise}',true,true);
    insert into training_session_exercises values ('${session}','${occurrence}','${exercise}');
    insert into training_attendance values ('${session}','${athlete}',true),('${session}','${bench}',false),
      ('${session}','${unrelated}',true);
  `);
  const actualTrainingMigration = migration('20261124231719_player_training_results.sql');
  await db.exec(actualTrainingMigration.slice(
    actualTrainingMigration.indexOf('create or replace function public.open_training_player_collection('),
    actualTrainingMigration.indexOf('create or replace function public.get_training_player_collection_details(')
  ));
  await db.exec(migration('20261125131535_web_push.sql'));
  const key = 'B' + 'a'.repeat(86), auth = 'a'.repeat(22);
  await db.query('insert into private.web_push_configuration(vapid_public_key) values ($1)', [key]);

  async function as(user, role = 'authenticated') {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
    await db.exec('set role ' + role);
  }
  const endpoint = n => 'https://fcm.googleapis.com/fcm/send/demo-' + n;
  const register = (user, n, address = endpoint(n)) => db.query(
    'select public.register_web_push($1,$2,$3,$4,$5) as id', [user, uuid(30 + n), address, key, auth]);
  const prepare = async jobs =>
    (await db.query('select public.prepare_web_push($1) as jobs', [JSON.stringify(jobs)])).rows[0].jobs;
  const claimLeases = async () => {
    await as(null, 'service_role');
    return (await db.query('select public.claim_web_push() as jobs')).rows[0].jobs;
  };
  const claim = async () => prepare(await claimLeases());
  const finish = async (jobs, outcome) =>
    db.query('select public.finish_web_push($1)', [JSON.stringify(jobs.map(job => ({ ...job, outcome })))]);
  const capture = async (uid, sql) => { await as(uid, 'postgres'); await db.exec(sql); };

  await as(player);
  await assert.rejects(register(player, 1), /indisponibles/);
  await capture(coach, `
    insert into coaching_player_videos values ('${uuid(87)}','${group}','${athlete}','new','${coach}',null);
    update private.web_push_configuration set enabled=true,pilot_only=false;
  `);
  assert.deepEqual(await claim(), []);
  await as(player);
  const first = (await register(player, 1)).rows[0].id;
  const second = (await register(player, 2)).rows[0].id;
  assert.equal((await register(player, 1)).rows[0].id, first);
  await assert.rejects(register(player, 3, 'https://fcm.googleapis.com.evil.test/path'), /invalide/);
  await assert.rejects(db.query('select * from private.web_push_devices'), /permission denied/);
  await assert.rejects(db.query('select public.claim_web_push()'), /permission denied/);
  await assert.rejects(db.query("select public.prepare_web_push('[]')"), /permission denied/);
  await assert.rejects(db.query("select public.finish_web_push('[]')"), /permission denied/);
  await assert.rejects(db.query('select * from private.web_push_pilots'), /permission denied/);
  await as(outsider);
  await register(outsider, 3);
  await assert.rejects(register(player, 1), /Connexion requise/);
  await assert.rejects(register(outsider, 1), /duplicate key/);
  await assert.rejects(db.query('select public.test_web_push($1)', [uuid(31)]), /inactif/);
  await as(absent);
  await register(absent, 4);
  await as(coach);
  await register(coach, 5);
  await assert.rejects(db.query('select public.open_training_player_collection($1,$2)', [session, uuid(90)]), /introuvable/);
  await as(outsider);
  await assert.rejects(db.query('select public.open_training_player_collection($1,$2)', [session, occurrence]), /entraineur/);
  await as(coach);
  await db.query('select public.open_training_player_collection($1,$2)', [session, occurrence]);
  await db.query('select public.open_training_player_collection($1,$2)', [session, occurrence]);
  let jobs = await claim();
  assert.deepEqual(jobs.map(job => job.device).sort(), [first, second].sort());
  assert.ok(jobs.every(job => job.kind === 'collection' && job.send && job.group === group));
  assert.deepEqual(await claim(), []);
  await finish(jobs, 'sent');

  await capture(coach, `
    insert into coaching_player_videos values ('${uuid(60)}','${group}','${athlete}','new','${coach}',null);
    insert into coaching_player_video_notes values ('${uuid(61)}','${group}','${uuid(60)}','${coach}');
  `);
  await capture(player, `
    insert into coaching_player_videos values ('${uuid(66)}','${group}','${athlete}','new','${player}',null);
  `);
  jobs = await claim();
  assert.equal(jobs.length, 2);
  assert.ok(jobs.every(job => job.kind === 'video' && job.send));
  await finish(jobs, 'sent');
  await capture(coach, `
    update coaching_player_videos set status='reviewed',reviewed_by='${coach}' where id='${uuid(60)}';
    update coaching_player_videos set status='reviewed' where id='${uuid(60)}';
    insert into coaching_player_video_notes values ('${uuid(62)}','${group}','${uuid(60)}','${coach}');
    insert into coaching_player_message_history values ('${uuid(63)}','${group}','${athlete}','${coach}','coach');
  `);
  await as(player);
  await db.query('insert into public.web_push_preferences(user_id,messages) values ($1,false)', [player]);
  await assert.rejects(db.query('insert into public.web_push_preferences(user_id) values ($1)', [outsider]), /row-level security/);
  jobs = await claim();
  assert.deepEqual(jobs.map(job => job.kind).sort(), ['analysis','analysis','annotation','annotation']);
  await finish(jobs, 'sent');

  await capture(player, `insert into coaching_player_message_history values
    ('${uuid(64)}','${group}','${athlete}','${player}','player'),
    ('${uuid(65)}','${otherGroup}','${unrelated}','${player}','player');`);
  jobs = await claim();
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0].staff && jobs[0].kind === 'message');
  await finish(jobs, 'sent');

  await capture(player, `
    insert into coaching_player_message_history values ('${uuid(67)}','${group}','${athlete}','${player}','player');
    insert into coaching_player_message_reads values ('${uuid(67)}','${coach}','coach');
  `);
  assert.deepEqual(await claim(), []);

  await as(player);
  await db.query('select public.test_web_push($1)', [uuid(31)]);
  await assert.rejects(db.query('select public.test_web_push($1)', [uuid(31)]), /trop récent/);
  jobs = await claim();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].device, first);
  await finish(jobs, 'retry');
  assert.deepEqual(await claim(), []);
  await as(null, 'postgres');
  await db.exec('update private.web_push_deliveries set next_at=now() where not done');
  const retried = await claim();
  assert.equal(retried.length, 1);
  assert.notEqual(retried[0].lease, jobs[0].lease);
  await finish(jobs, 'expired');
  await as(player);
  assert.equal((await db.query('select public.web_push_device_active($1) as active', [uuid(31)])).rows[0].active, true);
  await as(null, 'service_role');
  await finish(retried, 'expired');
  await as(player);
  assert.equal((await db.query('select public.web_push_device_active($1) as active', [uuid(31)])).rows[0].active, false);
  await db.query('select public.disable_web_push($1)', [uuid(32)]);
  assert.equal((await db.query('select public.web_push_device_active($1) as active', [uuid(32)])).rows[0].active, false);

  await capture(coach, `
    update private.web_push_configuration set pilot_only=true;
    insert into private.web_push_pilots(user_id) values ('${player}');
  `);
  await as(outsider);
  assert.equal((await db.query('select public.web_push_public_key() as key')).rows[0].key, null);
  await assert.rejects(register(outsider, 8), /indisponibles/);
  await assert.rejects(db.query('select public.test_web_push($1)', [uuid(33)]), /indisponibles/);
  await as(player);
  const pilotDevice = (await register(player, 9)).rows[0].id;

  await capture(coach, `
    insert into coaching_player_videos values ('${uuid(80)}','${group}','${athlete}','new','${coach}',null);
  `);
  const allowed = await claimLeases();
  assert.deepEqual(allowed.map(job => job.device), [pilotDevice]);
  assert.equal((await prepare(allowed))[0].send, true);
  await capture(coach, `
    update coaching_group_players set active=false where group_id='${group}' and player_id='${athlete}';
  `);
  await as(null, 'service_role');
  assert.equal((await prepare(allowed))[0].send, false);
  await finish(allowed, 'skip');
  await capture(coach, `
    update coaching_group_players set active=true where group_id='${group}' and player_id='${athlete}';
    insert into coaching_player_videos values ('${uuid(81)}','${group}','${athlete}','new','${coach}',null);
  `);
  const halted = await claimLeases();
  assert.equal(halted.length, 1);
  await capture(coach, 'update private.web_push_configuration set enabled=false');
  assert.equal((await db.query('select private.web_push_work_due() as due')).rows[0].due, false);
  await as(null, 'service_role');
  assert.equal((await prepare(halted))[0].send, false);
  await capture(coach, 'update private.web_push_configuration set enabled=true');
  await db.exec("update private.web_push_deliveries set next_at=now() where not done");
  assert.equal((await db.query('select private.web_push_work_due() as due')).rows[0].due, false);
  assert.deepEqual(await claim(), []);

  await capture(coach, `
    alter table private.web_push_events add constraint test_failure check (false) not valid;
    insert into coaching_player_message_history values ('${uuid(82)}','${group}','${athlete}','${coach}','coach');
  `);
  assert.equal((await db.query('select count(*)::int as count from coaching_player_message_history where id=$1',
    [uuid(82)])).rows[0].count, 1);
});

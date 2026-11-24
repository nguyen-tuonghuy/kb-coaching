const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261122120000_player_training_results.sql'),'utf8');
const sessions=fs.readFileSync(path.join(root,'js/training/sessions.js'),'utf8');
const portal=fs.readFileSync(path.join(root,'js/shared/player-portal.js'),'utf8');
const shell=fs.readFileSync(path.join(root,'js/shared/page-shell.js'),'utf8');

test('results and declarations use the durable exercise occurrence',()=>{
  assert.match(sql,/alter table public\.training_results[\s\S]*add column if not exists occurrence_id uuid/);
  assert.match(sql,/unique \(session_id,occurrence_id,player_id\)/);
  assert.match(sql,/training_results_occurrence_player_uidx/);
  assert.match(sessions,/occurrence_id:ex\.occurrenceId,exercise_id:ex\.id,player_id:playerId/);
  assert.match(sessions,/exByOccurrence/);
  assert.doesNotMatch(sql,/min\((?:tse\.occurrence_id|tr\.id)\)/);
});

test('player writes are server-owned, scoped and serialized with retrieval',()=>{
  assert.match(sql,/create or replace function public\.submit_my_training_result/);
  assert.match(sql,/join public\.coaching_group_players gp[\s\S]*gp\.active/);
  assert.match(sql,/create table public\.training_player_collection_players/);
  assert.match(sql,/from public\.training_attendance ta[\s\S]*ta\.present/);
  assert.match(sql,/cp\.user_id=v_uid/);
  assert.match(sql,/for update of c/);
  assert.match(sql,/raise exception 'La saisie est fermée'/);
  assert.match(sql,/unique \(submitted_by,client_request_id\)/);
  assert.match(sql,/p_expected_version<>v_row\.version/);
});

test('atomic retrieval covers every merge outcome without changing declarations',()=>{
  assert.match(sql,/create or replace function public\.retrieve_training_player_results/);
  assert.match(sql,/if not found then[\s\S]*insert into public\.training_results[\s\S]*resolution_state='integrated'/);
  assert.match(sql,/resolution_state='matched'/);
  assert.match(sql,/resolution_state='pending'/);
  assert.match(sql,/state='locked'.*locked_by=v_uid/s);
  assert.doesNotMatch(sql,/delete from public\.training_player_declarations/);
});

test('arbitration is optimistic and general saves are occurrence-aware',()=>{
  assert.match(sql,/v_r\.id is distinct from p_expected_result_id/);
  assert.match(sql,/v_r\.result_version is distinct from p_expected_result_version/);
  assert.match(sql,/jsonb_build_object\('status','conflict'/);
  assert.match(sql,/create or replace function public\.save_training_session_player_results/);
  assert.match(sql,/select v_saved\.session_id,\(r->>'occurrence_id'\)::uuid/);
  assert.match(sql,/expected_result_version[\s\S]*current_result\.result_version/);
  assert.match(sessions,/rpc\('save_training_session_player_results'/);
});

test('coach and mobile player interfaces expose the complete workflow',()=>{
  assert.match(sessions,/Ouvrir la saisie joueurs/);
  assert.match(sessions,/Récupérer et verrouiller/);
  assert.match(sessions,/Conserver la valeur coach/);
  assert.match(sessions,/Utiliser la valeur joueur/);
  assert.match(portal,/Saisir mes résultats/);
  assert.match(portal,/La saisie est fermée/);
  assert.match(shell,/id="playerTrainingResults"/);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261124231719_player_training_results.sql'),'utf8');
const sessions=fs.readFileSync(path.join(root,'js/training/sessions.js'),'utf8');
const integrity=fs.readFileSync(path.join(root,'supabase/migrations/20261124231728_training_occurrence_integrity.sql'),'utf8');
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
  assert.match(integrity,/create or replace function public\.save_training_session_player_results/);
  assert.match(sessions,/rpc\('save_training_session_player_results'/);
});

test('coach input is saved before locking; failed saves and unrelated edits stay in the draft',async()=>{
  const coach={id:'ex',localKey:'coach',occurrenceId:'o1',measurement_type:'success_attempts'};
  const other={id:'ex',localKey:'other',occurrenceId:'o2',measurement_type:'success_attempts'};
  const inputs=[{success:'4',attempts:'10',note:'coach'},{success:'9',attempts:'10',note:'autre exercice'}];
  const rows=[coach,other].map((ex,i)=>({dataset:{exercise:ex.localKey,player:'p1'},querySelector(selector){
    const key=selector.slice(4);return key in inputs[i]?{value:inputs[i][key]}:null;
  }}));
  const open={occurrence_id:'o1',player_id:'p1',account_linked:true,declaration_id:'d1',collection_state:'open'};
  const calls=[];
  let saveOutcome='network';
  let dirty=true;
  const app={
    trainingState:{currentSessionId:'s1',editorLoadToken:1,sessionExercises:[coach,other],resultMeta:{},resultDraft:{},playerCollectionRows:[open]},
    trainingLocalState:{},trainingLeaseState:{instanceId:'i1',token:'t1'},
    $$:selector=>selector==='.resultRow'?rows:[],
    escapeAttr:String,escapeHtml:String,newUuid:()=> 'operation',
    db:{rpc:async(name,args)=>{
      calls.push(name);
      if(name==='retrieve_training_player_results'){
        assert.equal(args.p_occurrence_id,'o1');
        inputs[1].success='8';dirty=true;
        return {data:{state:'locked'}};
      }
      assert.equal(name,'get_training_player_collection_details');
      return {data:[{...open,collection_state:'locked',resolution_state:'pending',result_id:'r1',result_version:1,
        coach_successes:4,coach_attempts:10,coach_note:'coach',player_successes:7,player_attempts:10},
        {...open,occurrence_id:'o2',result_id:'r2',result_version:2,coach_successes:2}]};
    }}
  };
  const addEventListener=()=>{};
  vm.runInNewContext(sessions,{window:{KinballCoach:{app},addEventListener},document:{addEventListener},confirm:()=>true});
  Object.assign(app,{
    trainingLeaseCanMutate:()=>true,trainingSessionIsDirty:()=>dirty,persistTrainingLocalDraft:()=>calls.push('draft'),
    scheduleTrainingCloudSave:()=>{},renderTrainingExerciseCards:()=>{},fetchTrainingSessionParent:async()=>({version:3}),
    saveTrainingSession:async()=>{
      calls.push('save');assert.equal(app.trainingState.resultDraft.coach__p1.successes,'4');
      app.trainingLocalState.conflict=saveOutcome==='conflict';
      if(saveOutcome!=='success')return;
      dirty=false;return {status:'saved'};
    }
  });
  for(saveOutcome of ['network','conflict']){
    await app.retrieveTrainingPlayerCollection(coach);
    assert.equal(app.trainingState.playerCollectionRows[0].collection_state,'open');
    assert.equal(app.trainingState.resultDraft.coach__p1.successes,'4');
  }
  assert.deepEqual(calls,['save','save']);
  saveOutcome='success';
  await app.retrieveTrainingPlayerCollection(coach);
  assert.deepEqual(calls.slice(2),['save','retrieve_training_player_results','get_training_player_collection_details','draft']);
  assert.equal(app.trainingState.resultDraft.other__p1.successes,'8');
  assert.equal(app.trainingState.resultMeta.other__p1,undefined);
  assert.match(app.trainingPlayerCollectionHtml(coach),/Joueur <strong>7\/10<\/strong>[\s\S]*Coach <strong>4\/10<\/strong>/);
  assert.match(app.trainingPlayerCollectionHtml(coach),/1 écart à traiter/);
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

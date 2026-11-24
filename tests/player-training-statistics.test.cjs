const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261124173651_player_training_statistics.sql'),'utf8');
const viewMigration=fs.readFileSync(path.join(root,'supabase/migrations/20261124190000_training_statistics_view_mode.sql'),'utf8');
const data=fs.readFileSync(path.join(root,'js/shared/data.js'),'utf8');
const statistics=fs.readFileSync(path.join(root,'js/shared/statistics.js'),'utf8');
const shell=fs.readFileSync(path.join(root,'js/shared/page-shell.js'),'utf8');

function loadStatistics(){
  const app={escapeHtml:value=>String(value??'')};
  const calculations={statsImpactQuantile(){},statsImpactAnonymousBenchmark(){}};
  vm.runInNewContext(statistics,{window:{KinballCoach:{app,calculations}},Number,Map,Set,Object,Array,Math,JSON,console});
  return app;
}

test('the player dataset is authorized by the server and uses persistent aliases',()=>{
  assert.match(migration,/create table private\.training_stats_player_aliases/);
  assert.match(migration,/primary key \(group_id, player_id\)/);
  assert.match(migration,/unique \(group_id, alias_number\)/);
  assert.match(migration,/gp\.active = true[\s\S]*gp\.stats_access = 'group'/);
  assert.match(migration,/raise exception 'Acces aux statistiques du groupe refuse' using errcode = '42501'/);
  assert.match(migration,/else private\.training_stats_alias_label\(a\.alias_number\)/);
  assert.match(migration,/when a\.player_id = v_self_player_id then v_self_name/);
  assert.match(migration,/a\.alias_number as ranking_order/);
  assert.doesNotMatch(migration,/row_number\(\) over \(order by lower\(p\.display_name\)/);
});

test('the player payload contains opaque keys and excludes identifying raw fields',()=>{
  const responseSection=migration.slice(migration.indexOf("select jsonb_build_object(\n    'viewer_role'"));
  assert.match(migration,/'participant-' \|\| a\.alias_number/);
  assert.match(migration,/'session-' \|\| row_number\(\)/);
  assert.doesNotMatch(responseSection,/'player_id',\s*(?:rr|tr|ta|gp)\.player_id/);
  assert.doesNotMatch(responseSection,/'session_id',\s*(?:rr|tr|ta|s)\.session_id/);
  assert.doesNotMatch(responseSection,/'note'/);
  assert.doesNotMatch(responseSection,/'workspace_id'/);
  assert.doesNotMatch(responseSection,/'user_id'/);
});

test('restrictive policies prevent player access to raw training and roster rows',()=>{
  for(const table of ['training_sessions','training_attendance','training_session_exercises','training_results']){
    assert.match(migration,new RegExp(`create policy ${table.replace('training_session_exercises','training_session_exercises').replace('training_attendance','training_attendance').replace('training_results','training_results').replace('training_sessions','training_sessions')}_raw_staff_only[\\s\\S]*?as restrictive for select`));
  }
  assert.match(migration,/create policy coaching_group_players_identity_guard[\s\S]*as restrictive for select/);
  assert.match(migration,/create policy players_identity_guard[\s\S]*as restrictive for select/);
  assert.match(migration,/a\.group_id = p_group_id and a\.player_id = p_player_id and a\.user_id = auth\.uid\(\)/);
  assert.match(migration,/grant execute on function private\.can_read_training_stats_raw\(uuid\) to authenticated/);
});

test('staff and anonymized datasets produce identical cumulative scores and ranks',()=>{
  const app=loadStatistics();
  const sessions=[{id:'session-1',trained_on:'2026-10-01'}];
  const exerciseMap={e1:{id:'e1',measurement_type:'success_attempts'}};
  const results=[
    {id:'result-1',session_id:'session-1',exercise_id:'e1',player_id:'participant-1',successes:8,attempts:10},
    {id:'result-2',session_id:'session-1',exercise_id:'e1',player_id:'participant-2',successes:6,attempts:10},
    {id:'result-3',session_id:'session-1',exercise_id:'e1',player_id:'participant-3',successes:6,attempts:10}
  ];
  const staffPlayers=[
    {id:'participant-1',display_name:'Alice',ranking_order:1},
    {id:'participant-2',display_name:'Benoît',ranking_order:2},
    {id:'participant-3',display_name:'Chloé',ranking_order:3}
  ];
  const playerPlayers=[
    {id:'participant-1',display_name:'Joueur A',ranking_order:1},
    {id:'participant-2',display_name:'Benoît',ranking_order:2,is_me:true},
    {id:'participant-3',display_name:'Joueur C',ranking_order:3}
  ];
  const args={results,sessions,exerciseMap,selectedExerciseIds:['e1'],minAttempts:5};
  const staff=app.aggregateLeaderboard({...args,players:staffPlayers});
  const player=app.aggregateLeaderboard({...args,players:playerPlayers});
  const comparable=rows=>rows.map(({player_id,successes,attempts,sessionsCount,rate,rank})=>({player_id,successes,attempts,sessionsCount,rate,rank}));
  assert.deepEqual(comparable(player),comparable(staff));
  assert.deepEqual(Array.from(player,row=>row.name),['Joueur A','Benoît','Joueur C']);
  assert.deepEqual(Array.from(player,row=>row.rank),[1,2,2]);
});

test('the shared player view uses only the training RPC and hides non-training domains',()=>{
  assert.match(data,/trainingStatisticsDataset\(groupId,\{view\}=\{\}\)[\s\S]*p_view:view/);
  const loader=statistics.slice(statistics.indexOf('app.loadStatsData ='),statistics.indexOf('app.switchStatsTab ='));
  assert.match(loader,/readOnlyViewer\?'player':'staff'/);
  assert.match(loader,/services\.trainingStatisticsDataset\(groupId,\{view:requestedView\}\)/);
  assert.match(loader,/dataset\.viewer_role!==requestedView/);
  assert.doesNotMatch(loader,/services\.trainingSessions/);
  assert.doesNotMatch(loader,/fetchGroupPlayers/);
  assert.doesNotMatch(loader,/services\.trainingResults/);
  assert.match(statistics,/readOnlyViewer&&domain!=='training'/);
  assert.match(statistics,/readOnlyViewer&&tab==='player'/);
  assert.match(shell,/id="statsTitle"/);
  assert.match(shell,/id="statsGroupHint"/);
});

test('player and staff modes are authorized independently with a compatible legacy wrapper',()=>{
  assert.match(viewMigration,/get_training_statistics_dataset\(p_group_id uuid, p_view text\)/);
  assert.match(viewMigration,/if v_view = 'staff'[\s\S]*coaching_group_coaches/);
  assert.match(viewMigration,/else[\s\S]*coaching_player_accounts[\s\S]*gp\.active = true[\s\S]*gp\.stats_access = 'group'/);
  assert.match(viewMigration,/when v_view = 'staff' then p\.display_name/);
  assert.match(viewMigration,/when a\.player_id = v_self_player_id then v_self_name/);
  assert.match(viewMigration,/create or replace function public\.get_training_statistics_dataset\(p_group_id uuid\)[\s\S]*coaching_player_accounts[\s\S]*if v_self_player_id is not null then[\s\S]*return public\.get_training_statistics_dataset\(p_group_id, 'player'\)[\s\S]*return public\.get_training_statistics_dataset\(p_group_id, 'staff'\)/);
});

test('loading clears names before network work and rejects a response for the wrong view',()=>{
  const loader=statistics.slice(statistics.indexOf('app.loadStatsData ='),statistics.indexOf('app.switchStatsTab ='));
  const clearIndex=loader.indexOf('app.statsState.viewerRole=null;app.statsState.sessions=[]');
  const tableClearIndex=loader.indexOf("app.$('#statsLeaderboardTable').innerHTML=''");
  const renderIndex=loader.indexOf('app.populateStatsSelectors();app.renderStatsAll();');
  const fetchIndex=loader.indexOf('await app.fetchExerciseCategories()');
  const requestIndex=loader.indexOf('await app.services.trainingStatisticsDataset');
  const roleCheckIndex=loader.indexOf('dataset.viewer_role!==requestedView');
  const publishIndex=loader.indexOf('app.statsState.players=Array.isArray');
  assert.ok(clearIndex>=0&&clearIndex<tableClearIndex&&tableClearIndex<renderIndex&&renderIndex<fetchIndex&&fetchIndex<requestIndex);
  assert.ok(roleCheckIndex>requestIndex&&roleCheckIndex<publishIndex);
});

test('player loading never republishes stale staff names on a rejected response',async()=>{
  const app=loadStatistics();
  const elements={
    '#statsStatus':{textContent:''},
    '#statsLeaderboardSummary':{textContent:'Ancien classement'},
    '#statsLeaderboardTable':{innerHTML:'<strong>Alice</strong>'}
  };
  let releaseCategories;
  const categories=new Promise(resolve=>{releaseCategories=resolve});
  let rpcCalls=0;
  app.$=selector=>elements[selector]||null;
  app.statsState={readOnlyViewer:true,loadToken:0,players:[{display_name:'Alice'}],sessions:[],attendance:[],sessionExercises:[],results:[],exerciseMap:{},sessionMap:{},leaderboardCache:[{name:'Alice'}]};
  app.populateStatsSelectors=()=>{};
  app.renderStatsAll=()=>{};
  app.fetchExerciseCategories=()=>categories;
  app.services={trainingStatisticsDataset:async()=>{rpcCalls++;return {viewer_role:'staff',players:[{display_name:'Alice'}]}}};

  const loading=app.loadStatsData('group-1');
  assert.equal(app.statsState.players.length,0);
  assert.equal(elements['#statsLeaderboardSummary'].textContent,'');
  assert.equal(elements['#statsLeaderboardTable'].innerHTML,'');
  assert.equal(rpcCalls,0);
  releaseCategories();
  await assert.rejects(loading,/ne correspond pas à la vue demandée/);
  assert.equal(app.statsState.players.length,0);
  assert.equal(rpcCalls,1);
});

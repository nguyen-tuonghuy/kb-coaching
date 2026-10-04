const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadPage,mockClient,settle,deferred}=require('./helpers/page-harness.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const user={id:'u1',email:'lucas@example.test',user_metadata:{}};
const invitation={group_name:'Test',players:[{player_id:'p1',player_name:'Lucas'}]};

async function setup(t,page,options){
  const ui=await loadPage(page,options);t.after(()=>ui.close());
  return {...ui,app:ui.w.KinballCoach.app};
}
function invited(ui){
  ui.app.currentUser=user;
  ui.client.session={user};
  ui.w.history.replaceState({},'',`/${ui.app.page}.html?player_group_invite=token&player_id=p1`);
}

for(const page of ['index','training']){
  test(`${page}: shared DOM is mounted once and bootstrap is idempotent`,async t=>{
    const ui=await setup(t,page);
    assert.equal(ui.w.document.querySelectorAll('template[data-kc-component]').length,0);
    const ids=[...ui.w.document.querySelectorAll('[id]')].map(el=>el.id);
    assert.equal(ids.length,new Set(ids).size);
    const calls=ui.client.calls.length,timers=ui.timers.size;
    ui.w.KinballCoach.boot(page);await settle();
    assert.equal(ui.client.calls.length,calls);
    assert.equal(ui.client.listeners.length,1);
    assert.equal(ui.timers.size,timers);
    assert.equal(typeof ui.app.loadMatchAnalysisDataset,'function');
  });

  test(`${page}: read services follow the current account without capturing a stale user`,async t=>{
    const client=mockClient({tables:{user_profiles:{first_name:'Test'}}});
    const ui=await setup(t,page,{client});
    ui.app.currentUser={id:'u1'};await ui.app.services.myProfile();
    ui.app.currentUser={id:'u2'};await ui.app.services.myProfile();
    const ids=client.calls.filter(c=>c.name==='user_profiles').map(c=>c.args.find(op=>op.method==='eq').args[1]);
    assert.deepEqual(ids,['u1','u2']);
    ui.app.currentUser=null;
    assert.equal(await ui.app.services.myProfile(),null);
    assert.equal(client.calls.filter(c=>c.name==='user_profiles').length,2);
  });

  test(`${page}: player and selection services retain defaults, sorting and archived filters`,async t=>{
    const client=mockClient({tables:{
      coaching_group_players:[{player:{id:'b',display_name:'Bob'}},{player:{id:'a',display_name:'Alice'},preferred_role:'R',stats_access:'group'},{player:null}],
      coaching_group_selections:[{id:'s1',name:'Test'}],coaching_group_selection_players:[{selection_id:'s1',player_id:'a'}]
    }});
    const ui=await setup(t,page,{client});
    const players=plain(await ui.app.services.groupPlayers('g1'));
    assert.deepEqual(players.map(p=>p.id),['a','b']);
    assert.equal(players[1].preferred_role,'AP');assert.equal(players[1].stats_access,'personal');
    assert.deepEqual(plain((await ui.app.services.groupSelections('g1'))[0].player_ids),['a']);
    assert.ok(client.calls.find(c=>c.name==='coaching_group_selections').args.some(op=>op.method==='eq'&&op.args[0]==='archived'&&op.args[1]===false));
    client.calls.length=0;
    await ui.app.services.groupSelections('g1',{includeArchived:true});
    assert.equal(client.calls.find(c=>c.name==='coaching_group_selections').args.some(op=>op.method==='eq'&&op.args[0]==='archived'),false);
    client.calls.length=0;
    assert.deepEqual(plain(await ui.app.services.groupPlayers(null)),[]);
    assert.deepEqual(plain(await ui.app.services.groupSelections(null)),[]);
    assert.equal(client.calls.length,0);
  });

  test(`${page}: match dataset preserves legacy player attribution and opponent enrichment`,async t=>{
    const client=mockClient({tables:{
      matches:[{id:'m1',opponent_team_1_id:'o1',opponent1:{id:'o1',name:'Opponent'}}],
      match_events:[{id:'e1',match_id:'m1',player_id:'a',opponent_team_id:'o1',action_type:'attaque',result:'Point marqué'},
        {id:'e2',match_id:'m1',action_type:'faute',fault_type:'Marcher'}],
      match_event_attributions:[{event_id:'e1',players:{display_name:'Alice'}}],
      match_event_lineup:[{event_id:'e2',players:{display_name:'Bob'}}],
      players:[{id:'a',display_name:'Alice'}],match_players:[{players:{display_name:'Bob'}}]
    }});
    const ui=await setup(t,page,{client});
    const ds=plain(await ui.app.loadMatchAnalysisDataset(['m1','m1',null]));
    assert.deepEqual(ds.matchIds,['m1']);assert.deepEqual(ds.players,['Alice','Bob']);
    assert.equal(ds.events[0].player_name,'Alice');assert.equal(ds.events[0].opponent_name,'Opponent');
    assert.deepEqual(ds.events[0].attributed_names,['Alice']);assert.deepEqual(ds.events[1].lineup_names,['Bob']);
    assert.deepEqual(ds.events[1].attributed_names,[]);assert.equal(ds.events[1].player_name,null);
    await assert.rejects(ui.app.loadMatchAnalysisDataset([]),/Aucun match/);
  });

  test(`${page}: impact calculations use an explicit reference and leave inputs unchanged`,async t=>{
    const ui=await setup(t,page);
    const calc=ui.w.KinballCoach.calculations;
    assert.equal(Object.isFrozen(calc),true);
    const events=[{action_type:'attaque',family:'centre',result:'Point marqué',player_name:'Alice'},
      {action_type:'faute',family:'centre',fault_type:'Marcher',player_name:'Alice'}];
    const before=JSON.stringify(events);
    const reference={contexts:{game_center:{total:10,p:0.5,q:0.2,mu:0.3}}};
    const result=calc.playerOffensiveImpact(events,'Alice','all',reference);
    assert.equal(result.total,2);assert.equal(result.points,1);assert.equal(result.faults,1);
    assert.ok(Math.abs(result.impact100+30)<1e-8);
    assert.equal(calc.playerOffensiveImpact(events,'Alice','all',null).total,0);
    assert.equal(JSON.stringify(events),before);
    const rows=[{name:'B',impact100:1},{name:'A',impact100:2},{name:'C',impact100:null}];
    assert.deepEqual(plain(calc.statsImpactSortRows(rows,{direction:'asc'})).map(r=>r.name),['B','A','C']);
    assert.deepEqual(rows.map(r=>r.name),['B','A','C']);
  });

  test(`${page}: unresolved invitation identity and a missing dialog cannot authorize a claim`,async t=>{
    const client=mockClient({rpcs:{get_player_group_invite:{group_name:'Test',players:[]}}});
    const ui=await setup(t,page,{client});invited(ui);
    await assert.rejects(ui.app.claimPlayerInviteIfPresent(),/introuvable/);
    assert.equal(client.calls.some(c=>c.name.startsWith('claim_')),false);
    assert.match(ui.w.location.search,/player_group_invite=token/);
    ui.$('#playerClaimConfirmPopup').remove();
    await assert.rejects(ui.app.claimPlayerInviteIfPresent(),/dialogue/);
    assert.equal(client.calls.some(c=>c.name.startsWith('claim_')),false);
  });

  test(`${page}: concurrent invitation attempts share one consent and one mutation`,{timeout:5000},async t=>{
    const client=mockClient({tables:{user_profiles:{first_name:'Lucas'}},rpcs:{get_player_group_invite:invitation,claim_coaching_player_group_invite:true}});
    const ui=await setup(t,page,{client});invited(ui);
    const first=ui.app.claimPlayerInviteIfPresent(),second=ui.app.claimPlayerInviteIfPresent();
    assert.equal(first,second);
    await settle();ui.$('#confirmPlayerClaim').click();
    assert.equal(await first,true);assert.equal(await second,true);
    assert.equal(client.calls.filter(c=>c.name==='claim_coaching_player_group_invite').length,1);
    assert.equal(ui.app.playerClaimTask,null);
  });

  test(`${page}: changing accounts during consent prevents the mutation`,{timeout:5000},async t=>{
    const client=mockClient({tables:{user_profiles:{first_name:'Lucas'}},rpcs:{get_player_group_invite:invitation}});
    const ui=await setup(t,page,{client});invited(ui);
    const result=ui.app.claimPlayerInviteIfPresent().catch(error=>error);
    await settle();
    ui.app.currentUser={id:'u2',email:'other@example.test'};
    ui.$('#confirmPlayerClaim').click();
    assert.match((await result).message,/compte connecté a changé/);
    assert.equal(client.calls.some(c=>c.name.startsWith('claim_')),false);
    assert.match(ui.w.location.search,/player_group_invite=token/);
  });

  test(`${page}: actual auth session is rechecked even if the displayed account is stale`,{timeout:5000},async t=>{
    const client=mockClient({tables:{user_profiles:{first_name:'Lucas'}},rpcs:{get_player_group_invite:invitation}});
    const ui=await setup(t,page,{client});invited(ui);
    const result=ui.app.claimPlayerInviteIfPresent().catch(error=>error);
    await settle();
    client.session={user:{id:'u2',email:'other@example.test'}};
    ui.$('#confirmPlayerClaim').click();
    assert.match((await result).message,/compte connecté a changé/);
    assert.equal(client.calls.some(c=>c.name.startsWith('claim_')),false);
  });

  test(`${page}: confirmation supports Escape, focus containment and focus restoration`,{timeout:5000},async t=>{
    const client=mockClient({tables:{user_profiles:{first_name:'Lucas'}},rpcs:{get_player_group_invite:invitation}});
    const ui=await setup(t,page,{client});invited(ui);
    ui.$('#authEmail').focus();
    const result=ui.app.claimPlayerInviteIfPresent().catch(error=>error);
    await settle();assert.equal(ui.w.document.activeElement.id,'cancelPlayerClaim');
    ui.$('#confirmPlayerClaim').focus();
    ui.w.document.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
    assert.equal(ui.w.document.activeElement.id,'closePlayerClaimConfirm');
    ui.w.document.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
    assert.equal(ui.w.document.activeElement.id,'confirmPlayerClaim');
    ui.w.document.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert.equal((await result).playerClaimCancelled,true);
    assert.equal(ui.w.document.activeElement.id,'authEmail');
    assert.equal(client.calls.some(c=>c.name.startsWith('claim_')),false);
  });

  test(`${page}: concurrent authenticated starts do not duplicate queries or listeners`,async t=>{
    const access=deferred();
    const client=mockClient({tables:{coaching_group_coaches:[{role:'owner',group:{id:'g1',name:'Test'}}],
      exercise_categories:[],exercises:[],training_sessions:[],workspace_members:[{workspace_id:'w1'}]},
      rpcs:{get_my_player_access:()=>access.promise}});
    const ui=await setup(t,page,{client});
    const first=ui.app.initAuthenticated(user),second=ui.app.initAuthenticated(user);
    assert.equal(first,second);await first;
    assert.equal(client.calls.filter(c=>c.name==='coaching_group_coaches').length,1);
    assert.equal(client.calls.filter(c=>c.name==='get_my_player_access').length,1);
    assert.equal(client.listeners.length,1);
    access.resolve({data:[],error:null});await settle();
    assert.deepEqual(ui.alerts,[]);
  });

  test(`${page}: auth subscription returns before asynchronous initialization`,async t=>{
    const client=mockClient({tables:{coaching_group_coaches:[{role:'owner',group:{id:'g1',name:'Test'}}],
      exercise_categories:[],exercises:[],training_sessions:[],workspace_members:[{workspace_id:'w1'}]},
      rpcs:{get_my_player_access:[]}});
    const ui=await setup(t,page,{client});
    const result=client.listeners[0]('SIGNED_IN',{user});
    assert.equal(result,undefined);
    assert.equal(ui.app.currentUser,null);
    await settle();
    assert.equal(ui.app.currentUser.id,'u1');
    assert.deepEqual(ui.alerts,[]);
  });

  test(`${page}: logout invalidates a pending startup and its late access response`,async t=>{
    const groups=deferred(),access=deferred();
    const client=mockClient({tables:{coaching_group_coaches:()=>groups.promise},rpcs:{get_my_player_access:()=>access.promise}});
    const ui=await setup(t,page,{client});
    const startup=ui.app.initAuthenticated(user);
    await settle();
    ui.w.confirm=()=>true;
    await ui.$('#logout').onclick();
    groups.resolve({data:[{role:'owner',group:{id:'old',name:'Old'}}],error:null});
    access.resolve({data:[{group_id:'old',player_name:'Old'}],error:null});
    await startup;await settle();
    assert.equal(ui.$('#authPanel').classList.contains('hidden'),false);
    assert.equal(ui.$('#appHome').classList.contains('hidden'),true);
    assert.equal(ui.$('#trainingHome').classList.contains('hidden'),true);
    assert.equal(ui.$('#playerSpaceBtn').classList.contains('hidden'),true);
    assert.equal(ui.app.currentUser,null);
    assert.deepEqual(plain(ui.app.groupState.groups),[]);
    assert.deepEqual(plain(ui.app.playerPortalState.accesses),[]);
    assert.deepEqual(ui.alerts,[]);
  });
}

test('training: persisted plans, legacy drafts and organizer retain their contract',async t=>{
  const ui=await setup(t,'training'),app=ui.app;
  const plan=[{id:'a',start:'13:30',duration:10,track:'court1',title:'A',details:'Long note',draft:false},
    {id:'b',start:'',duration:5,track:'court2',title:'B',draft:true}];
  const packed=app.packTrainingNotes('Notes',plan),restored=app.unpackTrainingNotes(packed);
  assert.equal(restored.notes,'Notes');assert.equal(restored.plan[1].draft,true);
  const legacy='Notes\n\n[[KC_PLAN_V1:'+encodeURIComponent(JSON.stringify([{id:'old',start:''}]))+']]';
  assert.equal(app.unpackTrainingNotes(legacy).plan[0].draft,true);
  app.trainingState.planBlocks=[{...app.newPlanBlock(plan[0]),id:'a'},{...app.newPlanBlock(plan[1]),id:'b'}];
  app.renderTrainingPlan();
  assert.equal(ui.w.document.querySelectorAll('.trainingPlanBlock').length,1);
  assert.equal(ui.w.document.querySelectorAll('.trainingDraftCard').length,1);
  app.restoreTrainingPlanBlockFromDraft('b','court1');
  assert.equal(app.trainingState.planBlocks[1].draft,false);
  app.setTrainingPlanOrganizerMode(true);
  app.selectTrainingPlanOrganizerBlock('b');app.selectTrainingPlanOrganizerBlock('a');
  assert.deepEqual(plain(app.trainingState.planBlocks.map(b=>b.id)),['b','a']);
  assert.equal(app.trainingState.planBlocks[0].start,'13:30');
  assert.deepEqual(ui.alerts,[]);
});

test('training: history reads only the selected player and escapes stored notes',async t=>{
  const client=mockClient({tables:{training_sessions:[{id:'s1',trained_on:'2026-10-03',label:'Test'}],
    training_attendance:[{session_id:'s1',player_id:'p1',present:true}],
    training_session_exercises:[{exercise_id:'ex1',exercise:{name:'Précision'}}],
    training_results:[{session_id:'s1',player_id:'p1',exercise_id:'ex1',successes:7,attempts:10,note:'<img src=x>'},
      {session_id:'s1',player_id:'other',exercise_id:'ex1',note:'Other player note'}]}});
  const ui=await setup(t,'training',{client});
  ui.app.groupState.groups=[{id:'g1'}];ui.app.trainingState.players=[{id:'p1',display_name:'Alice'}];
  ui.$('#historyGroup').innerHTML='<option value="g1">Test</option>';
  ui.$('#historyPlayer').innerHTML='<option value="p1">Alice</option>';
  await ui.app.loadPlayerHistory('p1');
  assert.match(ui.$('#historyResults').textContent,/7 \/ 10/);
  assert.match(ui.$('#historyResults').textContent,/<img src=x>/);
  assert.equal(ui.$('#historyResults img'),null);
  assert.doesNotMatch(ui.$('#historyResults').textContent,/Other player note/);
  assert.equal(client.calls.some(c=>c.kind==='table'&&c.args.some(op=>op.method==='insert')),false);
});

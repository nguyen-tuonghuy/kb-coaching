const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadPage,mockClient,deferred,settle}=require('./helpers/page-harness.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const user={id:'test-user',email:'lucas@example.test',user_metadata:{}};
const invite={group_name:'Groupe test',players:[{player_id:'test-player',player_name:'Lucas',linked:false}]};

async function pageFor(t,page,options){
  const ui=await loadPage(page,options);
  t.after(()=>ui.close());
  return ui;
}
function currentUser(ui){ui.w.fixtureUser=user;ui.client.session={user};ui.evaluate('currentUser=window.fixtureUser');}

for(const page of ['index','training']){
  test(`${page}: current whole script boots without a session or database queries`,async t=>{
    const ui=await pageFor(t,page);
    assert.equal(ui.$('#authPanel').classList.contains('hidden'),false);
    assert.equal(ui.$('#startupScreen'),null);
    assert.equal(ui.client.listeners.length,1);
    assert.deepEqual(ui.client.calls.map(c=>c.name),['getSession']);
    assert.deepEqual(ui.alerts,[]);
    assert.deepEqual(ui.logs.filter(l=>['error','jsdomError'].includes(l.level)),[]);
  });

  test(`${page}: HTML and attribute escaping protects rendered text`,async t=>{
    const ui=await pageFor(t,page);
    assert.equal(ui.evaluate('escapeHtml(null)'), '');
    ui.w.input=`<img src="x" onerror='boom'>&`;
    const result=ui.evaluate('escapeHtml(window.input)');
    assert.equal(result,'&lt;img src=&quot;x&quot; onerror=&#39;boom&#39;&gt;&amp;');
    assert.equal(ui.evaluate('escapeAttr(window.input)'),result);
    ui.$('#playerClaimSummary').innerHTML=result;
    assert.equal(ui.$('#playerClaimSummary').textContent,ui.w.input);
    assert.equal(ui.$('#playerClaimSummary img'),null);
  });

  test(`${page}: video identifier parsing preserves supported and permissive legacy inputs`,async t=>{
    const ui=await pageFor(t,page);
    const id='abcdefghijk';
    for(const input of [id,`https://youtu.be/${id}?t=90`,`https://www.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/embed/${id}`,`https://www.youtube.com/shorts/${id}`,`https://www.youtube.com/live/${id}`,
      `https://example.test/watch?v=${id}`]){
      ui.w.input=input;assert.equal(ui.evaluate('matchYoutubeId(window.input)'),id,input);
    }
    for(const input of ['',null,'not a url']){
      ui.w.input=input;assert.equal(ui.evaluate('matchYoutubeId(window.input)'),'',String(input));
    }
  });

  test(`${page}: time parsing and formatting preserve edge-case semantics`,async t=>{
    const ui=await pageFor(t,page);
    for(const [input,expected] of [['',0],[' 90 ',90],['1:30',90],['1:02:03',3723],
      ['1:90',150],['-5',0],['x',0],['1:2:3:4',0],['1.5',1.5]]){
      ui.w.input=input;assert.equal(ui.evaluate('parseMatchVideoTime(window.input)'),expected,input);
    }
    for(const [input,expected] of [[0,'0:00'],[90.9,'1:30'],[3723,'1:02:03'],[-1,'0:00'],[null,'0:00']]){
      ui.w.input=input;assert.equal(ui.evaluate('formatMatchVideoTime(window.input)'),expected,String(input));
    }
  });

  test(`${page}: dates and distinct name-normalization contracts`,async t=>{
    const ui=await pageFor(t,page);
    assert.equal(ui.evaluate(`isoToFrInput('2026-10-03')`),'03/10/26');
    assert.equal(ui.evaluate(`frInputToIso('3/10/26')`),'2026-10-03');
    assert.equal(ui.evaluate(`frInputToIso('2026-02-31')`),'2026-02-31'); // ISO path currently passes through.
    assert.throws(()=>ui.evaluate(`frInputToIso('31/02/26')`),/Date invalide/);
    assert.equal(ui.evaluate(`normalizeClaimName(' Lúcas ')`),'lucas');
    assert.equal(ui.evaluate(`normalizeCategoryName(' CŒUR   Équipe ')`),'coeur equipe');
    assert.equal(ui.evaluate(`normalizePlayerName('Jean-Luc')`),'jean luc');
    assert.equal(ui.evaluate(`levenshtein('Lúcas','Lucas')`),0);
  });

  test(`${page}: historical attack/defense events keep their statistical meaning`,async t=>{
    const ui=await pageFor(t,page);
    ui.w.events=[
      {action_type:'attaque',result:'Point marqué'},
      {action_type:'attaque',result:'Ballon défendu'},
      {action_type:'faute',fault_type:'Marcher'},
      {action_type:'defense',result:'Ballon défendu'},
      {action_type:'defense',result:'Échappé'},
      {action_type:'faute',fault_type:'Défensive illégale'},
      {action_type:'defense',result:'Faute de l’adversaire'}
    ];
    assert.deepEqual(plain(ui.evaluate('analysisStats(window.events)')),
      {attack:{total:3,points:1,faults:1,defended:1,illegal:0},
        defense:{total:4,defended:1,escaped:1,illegal:1,points:2,opponentFaults:1}});
    assert.equal(ui.evaluate('analysisPct(0,0)'),null);
    assert.equal(ui.evaluate(`analysisContextKey({family:'remise',restart_location:null})`),'remise_centre');
    assert.equal(ui.evaluate(`analysisAttackZoneLabel('E2')`),'P');
    assert.deepEqual(plain(ui.evaluate('analysisStats([])')).attack,
      {total:0,points:0,faults:0,defended:0,illegal:0});
  });

  for(const action of ['cancelPlayerClaim','closePlayerClaimConfirm','confirmPlayerClaim']){
    test(`${page}: invitation ${action} gates the mutation and preserves cancellation context`,{timeout:5000},async t=>{
      const client=mockClient({tables:{user_profiles:{first_name:'Nathan'}},
        rpcs:{get_player_group_invite:invite,claim_coaching_player_group_invite:true}});
      const ui=await pageFor(t,page,{client});currentUser(ui);
      ui.w.history.replaceState({},'',`/${page}.html?player_group_invite=test-token&player_id=test-player`);
      ui.w.localStorage.setItem('kinball_player_invite_player','test-player');
      const original=ui.w.location.search;
      const result=ui.evaluate('claimPlayerInviteIfPresent()');
      // Attach rejection immediately, before clicking cancellation.
      const outcome=result.then(value=>({value}),error=>({error}));
      await settle();
      assert.equal(ui.$('#playerClaimConfirmPopup').classList.contains('hidden'),false);
      assert.match(ui.$('#playerClaimSummary').textContent,/lucas@example.test/);
      assert.match(ui.$('#playerClaimSummary').textContent,/Groupe test/);
      assert.equal(ui.$('#playerClaimWarning').classList.contains('hidden'),false);
      assert.equal(client.calls.some(c=>c.name==='claim_coaching_player_group_invite'),false);
      ui.$('#'+action).click();
      const settled=await outcome;
      const writes=client.calls.filter(c=>c.name==='claim_coaching_player_group_invite');
      if(action==='confirmPlayerClaim'){
        assert.equal(settled.value,true);
        assert.equal(writes.length,1);
        assert.deepEqual(plain(writes[0].args),{p_token:'test-token',p_player_id:'test-player'});
        assert.equal(ui.w.location.search,'');
        assert.equal(ui.w.localStorage.getItem('kinball_player_invite_player'),null);
        assert.equal(client.calls.filter(c=>c.name==='updateUser').length,1);
      }else{
        assert.equal(settled.error?.playerClaimCancelled,true);
        assert.equal(writes.length,0);
        assert.equal(ui.w.location.search,original);
        assert.equal(ui.w.localStorage.getItem('kinball_player_invite_player'),'test-player');
        assert.equal(client.calls.filter(c=>c.name==='updateUser').length,0);
      }
      assert.equal(ui.$('#playerClaimConfirmPopup').classList.contains('hidden'),true);
    });
  }

  test(`${page}: conversation refresh characterizes the existing scroll divergence`,async t=>{
    const response=deferred();
    const client=mockClient({rpcs:{get_player_conversation:()=>response.promise}});
    const ui=await pageFor(t,page,{client});currentUser(ui);
    ui.evaluate(`playerPortalState.groupId='test-group'; playerPortalState.staffPreview=true; playerPortalState.staffPlayerId='test-player'`);
    const box=ui.$('#playerPortalConversationList');
    box.innerHTML='<p>Previous conversation</p>';
    box.dataset.loaded='1';box.dataset.conversationKey='test-group:test-player:coach';
    Object.defineProperties(box,{scrollHeight:{value:1000,configurable:true},clientHeight:{value:200,configurable:true}});
    box.scrollTop=100;
    const pending=ui.evaluate('loadPlayerPortalConversation()');
    assert.match(box.textContent,page==='index'?/Previous conversation/:/Chargement/);
    response.resolve({data:[],error:null});await pending;
    assert.equal(box.scrollTop,page==='index'?100:1000);
    assert.deepEqual(plain(client.calls.find(c=>c.name==='get_player_conversation').args),
      {p_group_id:'test-group',p_player_id:'test-player',p_viewer_role:'coach'});
  });

  test(`${page}: match readiness preserves the existing stricter index policy`,async t=>{
    const ui=await pageFor(t,page);
    ui.$('#matchGroup').innerHTML='<option value="test-group">Test</option>';
    ui.$('#rosterChecks').innerHTML=Array.from({length:4},()=>'<input type="checkbox" checked>').join('');
    ui.$('#matchName').value='';
    ui.evaluate('updateStartButton()');
    assert.equal(ui.$('#start').disabled,page==='index');
    ui.$('#rosterChecks input').checked=false;
    ui.evaluate('updateStartButton()');
    assert.equal(ui.$('#start').disabled,true);
  });

  test(`${page}: conversation polling remains page-specific and has only one interval`,async t=>{
    const ui=await pageFor(t,page);
    if(page==='training'){
      assert.equal(ui.evaluate('typeof syncPlayerPortalMessagePolling'),'undefined');
      return;
    }
    ui.$('#playerPortal').classList.remove('hidden');
    ui.evaluate('syncPlayerPortalMessagePolling(); syncPlayerPortalMessagePolling()');
    const intervals=[...ui.timers.values()].filter(timer=>timer.kind==='interval');
    assert.equal(intervals.length,1);
    assert.equal(intervals[0].delay,5000);
    ui.$('#playerPortal').classList.add('hidden');
    ui.evaluate('syncPlayerPortalMessagePolling()');
    assert.equal([...ui.timers.values()].filter(timer=>timer.kind==='interval').length,0);
  });

  test(`${page}: player history belongs to the training module only`,async t=>{
    const ui=await pageFor(t,page);
    assert.equal(ui.evaluate('typeof loadPlayerHistory'),page==='training'?'function':'undefined');
    if(page==='training')await ui.$('#historyPlayer').onchange();
  });

  test(`${page}: group selector mapping keeps roles and all present consumers`,async t=>{
    const client=mockClient({tables:{coaching_group_coaches:[{role:'owner',group:{id:'g1',name:'Test',club:'Club'}}]}});
    const ui=await pageFor(t,page,{client});currentUser(ui);
    const groups=await ui.evaluate('fetchMyGroups()');
    assert.equal(groups[0].role,'owner');
    for(const id of ['matchGroup','statsGroup',...(page==='training'?['trainingGroup','historyGroup']:[])]){
      assert.equal(ui.$('#'+id).options[1].value,'g1');
      assert.equal(ui.$('#'+id).options[1].textContent,'Test · Club');
    }
  });

  test(`${page}: startup renders staff page without waiting for secondary access/profile`,{timeout:5000},async t=>{
    const access=deferred();
    const client=mockClient({tables:{
      coaching_group_coaches:[{role:'owner',group:{id:'g1',name:'Test',club:'Club'}}],
      exercise_categories:[],exercises:[],training_sessions:[],user_profiles:[],
      workspace_members:[{workspace_id:'w1',role:'owner'}]
    },rpcs:{get_my_player_access:()=>access.promise}});
    const ui=await pageFor(t,page,{client});
    ui.w.fixtureUser=user;
    await ui.evaluate('initAuthenticated(window.fixtureUser)');
    assert.equal(ui.$(page==='index'?'#appHome':'#trainingHome').classList.contains('hidden'),false);
    assert.equal(ui.$('#playerSpaceBtn').classList.contains('hidden'),true);
    assert.equal(client.calls.some(c=>c.name==='is_app_admin'),false);
    assert.equal(client.calls.some(c=>c.name==='get_player_message_notifications'),false);
    access.resolve({data:[],error:null});await settle();
    assert.deepEqual(ui.alerts,[]);
    assert.deepEqual(ui.logs.filter(l=>l.level==='error'),[]);
  });
}

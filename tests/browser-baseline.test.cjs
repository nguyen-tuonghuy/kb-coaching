// Actual Chrome, current HTML/CSS/JS, intercepted resources and simulated Supabase.
// No test request is allowed to reach the production backend or the CDN.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
let browser;
before(async()=>{
  execFileSync(process.execPath,[path.join(root,'tools/build-coaching-runtime.cjs'),'--check'],{cwd:root});
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true});
});
after(async()=>{await browser?.close()});

function installMock({staff,populated=false}){
  const user={id:'test-user',email:'lucas@example.test',user_metadata:{}};
  const calls=[];
  window.baseline={calls,subscriptions:0};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const respond=async(kind,name,args)=>{
    const call={kind,name,args,start:performance.now()};calls.push(call);
    const tables={
      coaching_group_coaches:[{role:'owner',group:{id:'test-group',name:'Groupe test',club:'Club test'}}],
      exercise_categories:[],exercises:[],training_sessions:[],
      workspace_members:[{workspace_id:'test-workspace',role:'owner'}],
      user_profiles:[{user_id:user.id,first_name:'Lucas'}]
    };
    if(populated)Object.assign(tables,{
      coaching_group_players:['Alice','Bob','Claire','David'].map((name,i)=>({player:{id:'p'+(i+1),display_name:name},preferred_role:'AP',stats_access:'personal'})),
      coaching_group_selections:[],coaching_group_selection_players:[],matches:[],
      match_types:[{id:'t1',name:'Test',active:true,is_native:true}],
      exercise_categories:[{id:'c1',name:'Attaque',slug:'attaque',active:true,is_native:true,is_dual_focus:false},
        {id:'c2',name:'Dual',slug:'dual',active:true,is_native:true,is_dual_focus:true},
        {id:'c3',name:'Autre',slug:'autre',active:true,is_native:true,is_dual_focus:false}],
      exercises:[{id:'ex1',name:'Précision',category_id:'c1',category:'Attaque',measurement_type:'success_attempts',active:true},
        {id:'ex2',name:'Dual',category_id:'c2',category:'Dual',measurement_type:'success_attempts',active:true,attack_instruction:'Attaquer',defense_instruction:'Défendre'}],
      training_sessions:[{id:'s1',trained_on:'2026-10-03',label:'Séance test',group_id:'test-group',group:{name:'Groupe test'}}],
      training_attendance:[{session_id:'s1',player_id:'p1',present:true}],
      training_session_exercises:[{session_id:'s1',exercise_id:'ex1',exercise:{id:'ex1',name:'Précision',category_id:'c1',measurement_type:'success_attempts'}}],
      training_results:[{session_id:'s1',exercise_id:'ex1',player_id:'p1',successes:7,attempts:10,note:'Note test'}]
    });
    const rpcs={get_my_player_access:[],get_player_message_notifications:[],get_my_video_notifications:[],is_app_admin:false,
      get_player_group_invite:{group_name:'Groupe test',players:[{player_id:'test-player',player_name:'Lucas',linked:false}]},
      claim_coaching_player_group_invite:true};
    if(populated)Object.assign(rpcs,{
      get_my_player_access:[{group_id:'test-group',group_name:'Groupe test',player_id:'p1',player_name:'Alice',stats_access:'group'}],
      get_coaching_group_player_access:[],get_player_conversation:[],get_player_objectives:[],
      get_player_portal_metrics:{group_name:'Groupe test',player_name:'Alice',matches:[],details:[],metrics:{n:0},group_average:{}}
    });
    const fixtures=kind==='table'?tables:rpcs;
    if(!Object.hasOwn(fixtures,name))throw new Error(`Unexpected mock ${kind}: ${name}`);
    if(kind==='table'&&args.some(op=>['insert','update','delete','upsert'].includes(op.method)))throw new Error('Unexpected mutation');
    await wait(name==='get_my_player_access'?3000:name==='user_profiles'?700:30);
    call.end=performance.now();
    const single=kind==='table'&&args.some(op=>['single','maybeSingle'].includes(op.method));
    return {data:single?fixtures[name][0]||null:fixtures[name],error:null};
  };
  const client={
    from:name=>{
      const args=[];
      const query=new Proxy({}, {get(_,method){
        if(method==='then')return (resolve,reject)=>respond('table',name,args).then(resolve,reject);
        return (...values)=>{args.push({method,args:values});return query};
      }});
      return query;
    },
    rpc:(name,args)=>respond('rpc',name,args),
    auth:{getSession:async()=>({data:{session:staff?{user}:null}}),
      onAuthStateChange:()=>{window.baseline.subscriptions++;return {data:{subscription:{unsubscribe(){}}}}},
      updateUser:async args=>{calls.push({kind:'auth',name:'updateUser',args});return {error:null}}}
  };
  window.supabase={createClient:()=>client};
  window.alert=message=>{throw new Error(`Unexpected alert: ${message}`)};
}

async function open(t,name,width,{staff=true,populated=false}={}){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  t.after(()=>context.close());
  await context.addInitScript(installMock,{staff,populated});
  const errors=[],requests=[],traces=[];
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    if(message.type()==='error')errors.push(message.text());
    if(message.text().startsWith('[startup]'))traces.push(message.text());
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());requests.push(url.href);
    if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('@supabase/supabase-js')){
      await route.fulfill({contentType:'text/javascript',body:'/* Supabase supplied by init-script mock. */'});return;
    }
    if(url.origin!=='https://baseline.test'){
      errors.push(`External request blocked: ${url.href}`);await route.abort();return;
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
      errors.push(`Missing resource: ${url.pathname}`);await route.fulfill({status:404,body:'Missing resource'});return;
    }
    const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'}[path.extname(file)]||'application/octet-stream';
    await route.fulfill({contentType:type,body:fs.readFileSync(file)});
  });
  await page.goto(`https://baseline.test/${name}.html`);
  return {page,errors,requests,traces};
}

for(const name of ['index','training']){
  for(const width of [1440,820,390]){
    test(`${name}: staff startup, viewport ${width}, secondary reads do not gate the page`,{timeout:15000},async t=>{
      const ui=await open(t,name,width);
      const {page}=ui;
      const main=name==='index'?'#appHome':'#trainingHome';
      await page.locator(main).waitFor({state:'visible'});
      await page.waitForFunction(()=>window.baseline.subscriptions===1);
      if(name==='training')await page.waitForFunction(()=>document.querySelector('#trainingSavedSeasons').textContent.includes('Aucune séance'));
      const reference=await page.evaluate(()=>({
        viewport:{width:innerWidth,height:innerHeight},
        horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
        calls:window.baseline.calls,
        splash:!!document.querySelector('#startupScreen'),
        subscriptions:window.baseline.subscriptions
      }));
      assert.equal(reference.viewport.width,width);
      assert.equal(reference.horizontalOverflow,false);
      assert.equal(reference.splash,false);
      const access=reference.calls.find(call=>call.name==='get_my_player_access');
      assert.ok(access);assert.equal(access.end,undefined,'page must be useful while access RPC is still pending');
      // Observe deferred profile/admin/notification requests without waiting for access.
      await page.waitForTimeout(1200);
      assert.deepEqual(ui.errors,[]);
      assert.equal(await page.evaluate(()=>window.baseline.subscriptions),1);
      t.diagnostic(JSON.stringify({page:name,viewport:reference.viewport,traces:ui.traces,
        calls:await page.evaluate(()=>window.baseline.calls.map(c=>({kind:c.kind,name:c.name,duration:c.end?Math.round(c.end-c.start):null}))),
        resources:ui.requests.length}));
      if(process.env.KB_BASELINE_ARTIFACTS){
        await page.screenshot({path:path.join(process.env.KB_BASELINE_ARTIFACTS,`${name}-${width}.png`),fullPage:true});
      }
    });
  }
  test(`${name}: unsigned session shows login without Supabase database calls`,{timeout:15000},async t=>{
    const ui=await open(t,name,390,{staff:false});
    await ui.page.locator('#authPanel').waitFor({state:'visible'});
    await ui.page.waitForFunction(()=>window.baseline.subscriptions===1);
    assert.deepEqual(await ui.page.evaluate(()=>window.baseline.calls),[]);
    assert.deepEqual(ui.errors,[]);
  });

  test(`${name}: confirmation popup at a real 390px, cancel writes nothing`,{timeout:15000},async t=>{
    const ui=await open(t,name,390,{staff:false});
    const page=ui.page;
    await page.waitForFunction(()=>window.baseline.subscriptions===1);
    await page.evaluate(()=>{
      window.KinballCoach.app.currentUser={id:'test-user',email:'lucas@example.test',user_metadata:{}};
      history.replaceState({},'',location.pathname+'?player_group_invite=test-token&player_id=test-player');
      window.claimResult=window.KinballCoach.app.claimPlayerInviteIfPresent().then(()=>({confirmed:true}),e=>({cancelled:!!e.playerClaimCancelled}));
    });
    await page.locator('#playerClaimConfirmPopup').waitFor({state:'visible'});
    const metrics=await page.locator('#playerClaimConfirmPopup .sheet').evaluate(el=>{
      const r=el.getBoundingClientRect();
      return {width:innerWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:innerHeight};
    });
    assert.equal(metrics.width,390);
    assert.ok(metrics.left>=0&&metrics.right<=390&&metrics.top>=0&&metrics.bottom<=metrics.height);
    await page.locator('#cancelPlayerClaim').click();
    assert.deepEqual(await page.evaluate(()=>window.claimResult),{cancelled:true});
    assert.equal(await page.evaluate(()=>window.baseline.calls.some(c=>c.name==='claim_coaching_player_group_invite'||c.name==='updateUser')),false);
    assert.match(page.url(),/player_group_invite=test-token/);
    assert.deepEqual(ui.errors,[]);
  });

  test(`${name}: populated groups, match setup, settings, statistics and player portal`,{timeout:20000},async t=>{
    const ui=await open(t,name,820,{populated:true}),page=ui.page;
    await page.waitForFunction(()=>window.baseline.subscriptions===1);
    await page.evaluate(()=>window.KinballCoach.app.openMatchLibrary());
    await page.locator('#matchLibrary').waitFor({state:'visible'});
    await page.evaluate(()=>window.KinballCoach.app.openMatchModule());
    await page.locator('#setup').waitFor({state:'visible'});
    assert.equal(await page.locator('#rosterChecks input').count(),4);
    await page.evaluate(()=>window.KinballCoach.app.openGroupsModule());
    await page.waitForFunction(()=>document.querySelectorAll('#groupPlayersList .historyItem').length===4);
    await page.evaluate(()=>window.KinballCoach.app.openSettingsModule());
    await page.locator('#settingsHome').waitFor({state:'visible'});
    assert.equal(await page.locator('#categoryList .trainingCard').count(),3);
    await page.evaluate(()=>window.KinballCoach.app.openStatsModule());
    await page.locator('#statsHome').waitFor({state:'visible'});
    await page.evaluate(()=>window.KinballCoach.app.openPlayerPortal([{group_id:'test-group',group_name:'Groupe test',player_id:'p1',player_name:'Alice',stats_access:'group'}]));
    await page.locator('#playerPortal').waitFor({state:'visible'});
    assert.match(await page.locator('#playerPortalHomeTitle').textContent(),/Alice/);
    await page.evaluate(()=>window.KinballCoach.app.playerPortalSetView('profile'));
    await page.locator('#playerPortalProfileView').waitFor({state:'visible'});
    assert.equal(await page.locator('#playerPortalAccountEmail').textContent(),'lucas@example.test');
    assert.deepEqual(ui.errors,[]);
    assert.equal(await page.evaluate(()=>window.baseline.calls.some(c=>c.kind==='table'&&c.args.some(op=>['insert','update','delete','upsert'].includes(op.method)))),false);
  });
}

for(const width of [1440,820,390]){
  test(`training: populated plan, draft, long notes and dual exercise at ${width}px`,{timeout:20000},async t=>{
    const ui=await open(t,'training',width,{populated:true}),page=ui.page;
    await page.waitForFunction(()=>window.KinballCoach.app.trainingState.exercises.length===2);
    await page.locator('#newTraining').click();
    await page.locator('#trainingSession').waitFor({state:'visible'});
    assert.equal(await page.locator('#trainingAttendance input:checked').count(),4);
    await page.evaluate(()=>{
      const app=window.KinballCoach.app;
      app.trainingState.planBlocks=[{...app.newPlanBlock({title:'Bloc test',duration:10,track:'court1',expanded:true}),id:'a'},
        {...app.newPlanBlock({title:'Brouillon',draft:true}),id:'b'}];
      app.renderTrainingPlan();
      app.addSessionExercise(app.trainingState.exercises.find(ex=>ex.id==='ex2'),'defense');
    });
    assert.equal(await page.locator('.trainingPlanBlock').count(),1);
    assert.equal(await page.locator('.trainingDraftCard').count(),1);
    assert.match(await page.locator('#trainingExerciseCards').textContent(),/Défendre/);
    await page.locator('#trainingNotes').fill(Array.from({length:40},(_,i)=>`Ligne ${i} : notes longues de séance.`).join('\n'));
    await page.waitForFunction(()=>{
      const el=document.querySelector('#trainingNotes');return el.clientHeight>=el.scrollHeight-2;
    });
    assert.equal(await page.locator('#trainingNotes').evaluate(el=>getComputedStyle(el).overflowY),'hidden');
    await page.locator('#organizeTrainingPlan').click();
    await page.locator('.trainingDraftCard').click();
    await page.locator('.trainingPlanBlockOverview').click();
    assert.equal(await page.locator('.trainingDraftCard').count(),0);
    assert.equal(await page.locator('.trainingPlanBlock').count(),2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.KB_BASELINE_ARTIFACTS)await page.screenshot({path:path.join(process.env.KB_BASELINE_ARTIFACTS,`training-plan-${width}.png`),fullPage:true});
    await page.evaluate(()=>window.KinballCoach.app.openTrainingHistory());
    await page.locator('#historyPlayer').selectOption('p1');
    await page.waitForFunction(()=>document.querySelector('#historyResults').textContent.includes('7 / 10'));
    assert.match(await page.locator('#historySummary').textContent(),/Alice · 1 présence · 1 résultat/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(ui.errors,[]);
    if(process.env.KB_BASELINE_ARTIFACTS)await page.screenshot({path:path.join(process.env.KB_BASELINE_ARTIFACTS,`training-history-${width}.png`),fullPage:true});
  });
}

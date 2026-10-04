// Unsaved-work protection of the training session editor. Runs against the
// current page/scripts through the shared JSDOM harness. The store is an
// in-memory fake: the default one refuses every write (no Supabase at all), the
// writable one keeps writes in memory. Neither proves RLS or real persistence.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadPage,settle}=require('./helpers/page-harness.cjs');

const GROUP_ID='g1';
const TEAM_NAME='Groupe Test';
const PLAYERS=[
  {id:'p1',display_name:'Ana Ruiz'},
  {id:'p2',display_name:'Bo Martin'}
];
const EXERCISE={
  id:'ex1',name:'Passage',category:'Attaque',category_id:'c1',copied_from_exercise_id:null,
  measurement_type:'success_attempts',description:'',objective:'',
  attack_instruction:'',defense_instruction:'',created_by:'u1',updated_by:null,active:true
};

function store({writable=false}={}){
  const tables={
    exercise_categories:[{id:'c1',name:'Attaque',slug:'attaque',active:true,is_native:true,is_dual_focus:false}],
    exercises:[EXERCISE],
    user_profiles:[{user_id:'u1',first_name:'Lucas'}],
    teams:[{id:'t1',workspace_id:'w1',name:TEAM_NAME}],
    coaching_group_coaches:[{user_id:'u1',role:'coach',group:{id:GROUP_ID,name:TEAM_NAME,club:'KC',invite_code:'ABC'}}],
    coaching_group_players:PLAYERS.map((p,i)=>({
      player_id:p.id,group_id:GROUP_ID,active:true,preferred_role:i?'AP':'P',stats_access:'personal',
      player:{id:p.id,display_name:p.display_name}
    })),
    coaching_group_selections:[],
    training_attendance:[],
    training_session_exercises:[],
    training_results:[],
    training_sessions:[]
  };
  const mutations=[];
  let nextId=1;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const client={
    from(table){
      const filters=[];let mode='select',values,single=false;
      const query=new Proxy({}, {get(_,method){
        if(method==='then')return async(resolve,reject)=>{
          try{
            mutations.push({table,mode,values:clone(values??null)});
            if(['insert','update','delete','upsert'].includes(mode)&&!writable){
              // No test may reach a real write.
              resolve({data:null,error:{message:`store refuses ${mode} on ${table}`}});
              return;
            }
            if(!Object.hasOwn(tables,table))throw new Error('Unexpected fixture table '+table);
            if(mode==='insert'){
              const rows=(Array.isArray(values)?values:[values]).map(v=>({id:v.id||`${table}-${nextId++}`,...v}));
              tables[table].push(...rows);
              resolve({data:clone(single?rows[0]:rows),error:null});
              return;
            }
            const rows=tables[table].filter(row=>filters.every(f=>f(row)));
            if(mode==='delete'){
              const keep=tables[table].filter(row=>!rows.includes(row));
              tables[table]=keep;
              resolve({data:null,error:null});
              return;
            }
            if(mode==='update')rows.forEach(row=>Object.assign(row,values));
            resolve({data:clone(single?rows[0]||null:rows),error:null});
          }catch(e){reject(e)}
        };
        return (...args)=>{
          if(method==='eq')filters.push(row=>row[args[0]]===args[1]);
          if(method==='in')filters.push(row=>args[1].includes(row[args[0]]));
          if(method==='single'||method==='maybeSingle')single=true;
          if(['insert','update','delete','upsert'].includes(method)){mode=method;values=args[0];single=false}
          return query;
        };
      }});
      return query;
    },
    rpc:async name=>{throw new Error('Unexpected rpc '+name)},
    auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}
  };
  return {client,tables,mutations};
}

async function boot(ui){
  const app=ui.page.w.KinballCoach.app;
  app.currentUser={id:'u1'};
  app.state.workspaceId='w1';
  return app;
}

async function openNewSession(ui){
  const app=await boot(ui);
  await app.startNewTraining();
  await settle();
  return app;
}

// Plan fixture shaped exactly like a saved one: one timed block, one draft.
function planFixture(){
  return [
    {start:'13:30',duration:10,track:'both',title:'Bloc A',details:'detail A',attention:'',
      sourceType:'free',exerciseId:null,collectStats:false,focus:null,draft:false},
    {start:'',duration:0,track:'both',title:'Brouillon',details:'',attention:'',
      sourceType:'free',exerciseId:null,collectStats:false,focus:null,draft:true}
  ];
}

async function openExistingSession(ui){
  const app=await boot(ui);
  await app.startNewTraining();
  const notes=app.packTrainingNotes('Observations de la seance',planFixture());
  app.trainingState.recentSessions=[{
    id:'s1',trained_on:'2026-03-04',group_id:GROUP_ID,theme:'Theme existing',
    label:'Theme existing',duration_minutes:60,notes
  }];
  const tables=ui.tablesRef;
  tables.training_attendance=[{session_id:'s1',player_id:'p1',present:true}];
  tables.training_session_exercises=[{session_id:'s1',position:1,variant:null,target:null,focus:null,exercise:EXERCISE}];
  tables.training_results=[{session_id:'s1',exercise_id:'ex1',player_id:'p1',successes:4,attempts:6,numeric_value:null,note:'bon'}];
  await app.editTrainingSessionById('s1');
  await settle();
  return app;
}

async function openDuplicatedSession(ui){
  const app=await boot(ui);
  await app.startNewTraining();
  const notes=app.packTrainingNotes('Observations de la seance',planFixture());
  app.trainingState.recentSessions=[{
    id:'s1',trained_on:'2026-03-04',group_id:GROUP_ID,theme:'Theme existing',
    label:'Theme existing',duration_minutes:60,notes
  }];
  const tables=ui.tablesRef;
  tables.training_attendance=[{session_id:'s1',player_id:'p1',present:true}];
  tables.training_session_exercises=[{session_id:'s1',position:1,variant:null,target:null,focus:null,exercise:EXERCISE}];
  await app.duplicateTrainingSessionById('s1');
  await settle();
  return app;
}

async function open(ui,{existing=false,duplicated=false}={}){
  const {client,tables}=store({writable:true});
  ui.tablesRef=tables;
  ui.page=await loadPage('training',{client});
  if(existing)return openExistingSession(ui);
  if(duplicated)return openDuplicatedSession(ui);
  return openNewSession(ui);
}

test('snapshot is deterministic and ignores presentation-only state',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui,{existing:true});
  const first=app.trainingSessionSnapshot();
  assert.ok(JSON.parse(first).plan.length,'fixture plan is loaded');
  assert.equal(JSON.parse(first).results[0].playerId,'p1');
  // Regenerated ids, expanded cards and organizer state are display details:
  // none of them may look like an edit. Loading a session regenerates both the
  // exercise keys and the draft keys, so mirror that coupling here.
  app.trainingState.planBlocks.forEach(b=>{b.expanded=true});
  app.trainingState.planBlocks[0].id='regenerated-id';
  const remapped={};
  app.trainingState.sessionExercises.forEach(ex=>{
    const oldKey=ex.localKey;
    ex.localKey='regenerated-key';
    for(const [key,draft] of Object.entries(app.trainingState.resultDraft)){
      if(key.startsWith(oldKey+'__'))remapped[ex.localKey+key.slice(oldKey.length)]=draft;
    }
  });
  app.trainingState.resultDraft=remapped;
  app.trainingState.sessionExercises.forEach(ex=>{ex.expanded=true});
  app.renderTrainingExerciseCards();
  app.renderTrainingPlan();
  app.trainingState.planOrganizerMode=true;
  app.trainingState.planOrganizerSelectedId='regenerated-id';
  assert.equal(app.trainingSessionSnapshot(),first);
});

test('new session just opened is not dirty',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  assert.equal(app.trainingSessionIsDirty(),false);
});

test('existing session just opened is not dirty despite regenerated ids',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui,{existing:true});
  assert.equal(app.trainingState.planBlocks.length,2);
  assert.ok(app.trainingState.sessionExercises.every(ex=>ex.localKey),'local keys are regenerated at load');
  assert.equal(app.trainingSessionIsDirty(),false);
});

test('duplicated session starts clean and becomes dirty after an edit',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui,{duplicated:true});
  assert.equal(app.trainingState.currentSessionId,null);
  assert.equal(app.trainingSessionIsDirty(),false);
  ui.page.$('#trainingTheme').value='Copie modifiée';
  assert.equal(app.trainingSessionIsDirty(),true);
});

test('editing a simple field makes the session dirty',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  ui.page.$('#trainingTheme').value='Mon theme';
  assert.equal(app.trainingSessionIsDirty(),true);
});

test('editing the plan start time makes the session dirty',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  ui.page.$('#trainingPlanStart').value='18:00';
  assert.equal(app.trainingSessionIsDirty(),true);
});

test('adding a plan block makes the session dirty',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  app.addTrainingPlanBlock({duration:10,track:'both',title:'Bloc'});
  assert.equal(app.trainingSessionIsDirty(),true);
});

test('moving a plan block makes the session dirty',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui,{existing:true});
  const [first,second]=app.trainingState.planBlocks;
  app.moveTrainingPlanBlock(second.id,-1);
  // Joined: arrays built inside the JSDOM realm fail deepStrictEqual prototypes.
  assert.equal(app.trainingState.planBlocks.map(b=>b.id).join(','),[second.id,first.id].join(','));
  assert.equal(app.trainingSessionIsDirty(),true);
});

test('removing a session exercise makes the session dirty',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui,{existing:true});
  const [ex]=app.trainingState.sessionExercises;
  app.removeSessionExercise(ex.localKey);
  assert.equal(app.trainingSessionIsDirty(),true);
});

test('changing attendance makes the session dirty',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  ui.page.$('#trainingAttendance input[value="p2"]').checked=false;
  assert.equal(app.trainingSessionIsDirty(),true);
});

test('editing a result makes the session dirty',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui,{existing:true});
  ui.page.$('.tr-success').value='7';
  assert.equal(app.trainingSessionIsDirty(),true);
});

test('restoring the initial value clears the dirty flag',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  ui.page.$('#trainingTheme').value='Mon theme';
  assert.equal(app.trainingSessionIsDirty(),true);
  ui.page.$('#trainingTheme').value='';
  assert.equal(app.trainingSessionIsDirty(),false);
});

test('choosing stay keeps the session and its edits',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  ui.page.$('#trainingTheme').value='Mon theme';
  ui.page.$('#cancelTraining').click();
  await settle();
  const pending=app.confirmTrainingSessionLeave();
  await settle();
  ui.page.$('#trainingUnsavedStay').click();
  assert.equal(await pending,false);
  assert.equal(ui.page.$('#trainingTheme').value,'Mon theme');
  assert.equal(ui.page.$('#trainingSession').classList.contains('hidden'),false);
  assert.equal(app.trainingSessionIsDirty(),true,'staying keeps the session dirty');
});

test('choosing to quit discards the edits and leaves the editor',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  ui.page.$('#trainingTheme').value='Mon theme';
  ui.page.$('#cancelTraining').click();
  await settle();
  assert.equal(ui.page.$('#trainingUnsavedPopup').classList.contains('hidden'),false);
  ui.page.$('#trainingUnsavedDiscard').click();
  await settle();
  await settle();
  assert.equal(ui.page.$('#trainingUnsavedPopup').classList.contains('hidden'),true);
  assert.equal(ui.page.$('#trainingSession').classList.contains('hidden'),true,
    'the replayed navigation must not reopen the dialog');
  assert.equal(app.trainingSessionIsDirty(),false);
});

test('leaving an untouched session never opens the dialog',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  ui.page.$('#cancelTraining').click();
  await settle();
  assert.equal(ui.page.$('#trainingUnsavedPopup').classList.contains('hidden'),true);
  assert.equal(ui.page.$('#trainingSession').classList.contains('hidden'),true);
});

test('Escape and the close button keep the session',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  ui.page.$('#trainingTheme').value='Mon theme';
  const viaEscape=app.confirmTrainingSessionLeave();
  await settle();
  ui.page.w.document.dispatchEvent(new ui.page.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(await viaEscape,false);
  assert.equal(ui.page.$('#trainingSession').classList.contains('hidden'),false);

  const viaClose=app.confirmTrainingSessionLeave();
  await settle();
  ui.page.$('#closeTrainingUnsaved').click();
  assert.equal(await viaClose,false);
  assert.equal(ui.page.$('#trainingTheme').value,'Mon theme');
});

test('a successful save clears the dirty flag, a later edit sets it again',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  ui.page.$('#trainingTheme').value='Mon theme';
  assert.equal(app.trainingSessionIsDirty(),true);
  await app.saveTrainingSession();
  await settle();
  assert.match(ui.page.$('#trainingSaveStatus').textContent,/enregistrée/);
  assert.equal(app.trainingSessionIsDirty(),false,'a successful save refreshes the baseline');
  ui.page.$('#trainingTheme').value='Autre theme';
  assert.equal(app.trainingSessionIsDirty(),true);
});

test('header save mirrors the footer label and saves without opening the leave dialog',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  const head=ui.page.$('#saveTrainingSessionHead');
  const footer=ui.page.$('#saveTrainingSession');
  assert.equal(head.textContent,footer.textContent);
  assert.equal(head.textContent,'Enregistrer la séance');
  ui.page.$('#trainingTheme').value='Mon theme';
  head.click();
  await settle();
  await settle();
  assert.match(ui.page.$('#trainingSaveStatus').textContent,/enregistrée/);
  assert.equal(ui.page.$('#trainingUnsavedPopup').classList.contains('hidden'),true);
  assert.equal(app.trainingSessionIsDirty(),false);
  assert.equal(head.disabled,false);
  assert.equal(footer.disabled,false);
  assert.equal(head.textContent,footer.textContent);
  assert.equal(head.textContent,'Enregistrer les modifications');
});

test('save controls reject a concurrent submission',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  ui.page.$('#trainingTheme').value='Mon theme';
  ui.page.$('#saveTrainingSessionHead').click();
  ui.page.$('#saveTrainingSession').click();
  await settle();
  await settle();
  const saves=ui.tablesRef.training_sessions.filter(session=>session.theme==='Mon theme');
  assert.equal(saves.length,1);
  assert.equal(app.trainingSaveInFlight,false);
});

test('a refused save keeps the session dirty',async t=>{
  const {client,tables,mutations}=store({writable:false});
  const page=await loadPage('training',{client});t.after(()=>page.close());
  const app=await boot({page});
  await app.startNewTraining();
  await settle();
  page.$('#trainingTheme').value='Mon theme';
  await app.saveTrainingSession();
  await settle();
  assert.ok(mutations.some(m=>m.table==='training_sessions'&&m.mode==='insert'),'the write was attempted');
  assert.equal(tables.training_sessions.length,0,'nothing was stored');
  assert.match(page.$('#trainingSaveStatus').textContent,/refuses insert/);
  assert.equal(app.trainingSessionIsDirty(),true,'a refused save must not clear the baseline');
});

test('beforeunload is guarded only while dirty',async t=>{
  const ui={};t.after(()=>ui.page?.close());
  const app=await open(ui);
  const clean=new ui.page.w.Event('beforeunload',{cancelable:true});
  ui.page.w.dispatchEvent(clean);
  assert.equal(clean.defaultPrevented,false);
  ui.page.$('#trainingTheme').value='Mon theme';
  const dirty=new ui.page.w.Event('beforeunload',{cancelable:true});
  ui.page.w.dispatchEvent(dirty);
  assert.equal(dirty.defaultPrevented,true);
});

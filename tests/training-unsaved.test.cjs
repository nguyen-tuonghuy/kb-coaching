// Unsaved-work protection of the training session editor. Runs against the
// current page/scripts through the shared JSDOM harness. The store is an
// in-memory fake: the default one refuses every write (no Supabase at all), the
// writable one keeps writes in memory. Neither proves RLS or real persistence.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadPage,settle}=require('./helpers/page-harness.cjs');
const root=path.resolve(__dirname,'..');

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

async function runAutosave(ui){
  const timers=[...ui.page.timers.entries()].filter(([,timer])=>timer.kind==='timeout'&&timer.delay===750);
  for(const [id,timer] of timers){ui.page.timers.delete(id);timer.callback()}
  await settle();
}

function serializedDraft(app){
  const identity=app.trainingDraftIdentity();
  const raw=app.trainingLocalState.store.read(identity);
  assert.equal(raw.ok,true);
  return JSON.parse(JSON.stringify(raw.record));
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
  assert.equal(app.trainingLocalState.draftId,null,'discard cancels pending local recreation');
});

test('leaving can preserve the local draft without marking it as cloud-saved',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  ui.page.$('#trainingTheme').value='À reprendre';
  ui.page.$('#trainingTheme').dispatchEvent(new ui.page.w.Event('input',{bubbles:true}));
  ui.page.$('#cancelTraining').click();await settle();
  ui.page.$('#trainingUnsavedKeep').click();await settle();await settle();
  const records=app.trainingLocalState.store.list({userId:'u1',workspaceId:'w1'}).records;
  assert.equal(records.length,1);assert.equal(records[0].document.fields.theme,'À reprendre');
  assert.equal(ui.page.$('#trainingSession').classList.contains('hidden'),true);
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

test('local draft restores three complete blocks, a long note and a drafted block after reload',async t=>{
  const first={};const second={};t.after(()=>first.page?.close());t.after(()=>second.page?.close());
  const app=await open(first);
  app.addTrainingPlanBlock({title:'Bloc 1',details:'Consigne 1',attention:'Attention 1',duration:12,track:'court1'});
  app.addTrainingPlanBlock({title:'Bloc 2',details:'Consigne 2',attention:'Attention 2',duration:18,track:'court2'});
  app.addTrainingPlanBlock({title:'Bloc 3',details:'Consigne 3',attention:'Attention 3',duration:20,track:'both'});
  const longNote=Array.from({length:80},(_,index)=>`Ligne ${index} avec accents et ponctuation.`).join('\n');
  first.page.$('#trainingNotes').value=longNote;
  first.page.$('#trainingNotes').dispatchEvent(new first.page.w.Event('input',{bubbles:true}));
  app.sendTrainingPlanBlockToDraft(app.trainingState.planBlocks[1].id);
  await runAutosave(first);
  const record=serializedDraft(app);

  const restored=await open(second);
  await restored.restoreTrainingDraftRecord(record);
  assert.equal(restored.trainingState.planBlocks.length,3);
  assert.equal(restored.trainingState.planBlocks.map(block=>block.title).join(','),'Bloc 1,Bloc 2,Bloc 3');
  assert.equal(restored.trainingState.planBlocks[1].draft,true);
  assert.equal(second.page.$('#trainingPlanDraft').textContent.includes('Bloc 2'),true);
  assert.equal(second.page.$('#trainingNotes').value,longNote);
});

test('local restoration preserves attendance and exact result values',async t=>{
  const first={};const second={};t.after(()=>first.page?.close());t.after(()=>second.page?.close());
  const app=await open(first,{existing:true});
  first.page.$('.tr-success').value='9';first.page.$('.tr-attempts').value='11';first.page.$('.tr-note').value='Note résultat exacte\nDeuxième ligne';
  first.page.$('.tr-note').dispatchEvent(new first.page.w.Event('input',{bubbles:true}));
  first.page.$('#trainingAttendance input[value="p2"]').checked=true;
  app.persistTrainingLocalDraft();const record=serializedDraft(app);

  const restored=await open(second,{existing:true});
  restored.beginTrainingLocalDraft({draftId:record.draftId,revision:record.revision,baseUpdatedAt:record.baseUpdatedAt});
  await restored.applyTrainingEditorDocument(record.document);
  assert.equal(second.page.$('#trainingAttendance input[value="p2"]').checked,true);
  assert.equal(second.page.$('.tr-success').value,'9');
  assert.equal(second.page.$('.tr-attempts').value,'11');
  assert.equal(second.page.$('.tr-note').value,'Note résultat exacte\nDeuxième ligne');
});

test('a deleted block can be undone with all of its content',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  app.addTrainingPlanBlock({title:'À récupérer',details:'Texte exact',attention:'Point exact',duration:17,track:'court2'});
  const id=app.trainingState.planBlocks[0].id;
  app.removeTrainingPlanBlock(id);
  assert.equal(app.trainingState.planBlocks.length,0);
  assert.match(ui.page.$('#trainingUndoMessage').textContent,/À récupérer/);
  ui.page.$('#undoTrainingAction').click();
  assert.equal(app.trainingState.planBlocks.length,1);
  assert.equal(app.trainingState.planBlocks[0].details,'Texte exact');
  assert.equal(app.trainingState.planBlocks[0].attention,'Point exact');
  assert.equal(app.trainingState.planBlocks[0].track,'court2');
});

test('a deletion keeps a persistent pre-destructive history revision',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  app.addTrainingPlanBlock({title:'Version récupérable',details:'Avant suppression'});
  app.removeTrainingPlanBlock(app.trainingState.planBlocks[0].id);
  const record=serializedDraft(app);
  assert.equal(record.document.planBlocks.length,0);
  assert.ok(record.history.some(entry=>entry.document.planBlocks.some(block=>block.title==='Version récupérable')));
  const previous=[...record.history].reverse().find(entry=>entry.document.planBlocks.length);
  await app.applyTrainingEditorDocument(previous.document,{loadPlayers:false});
  assert.equal(app.trainingState.planBlocks[0].title,'Version récupérable');
});

test('successful cloud save closes only the matching local draft',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  ui.page.$('#trainingTheme').value='À synchroniser';app.persistTrainingLocalDraft();
  const identity=app.trainingDraftIdentity();
  assert.ok(app.trainingLocalState.store.read(identity).record);
  await app.saveTrainingSession();await settle();
  assert.equal(app.trainingLocalState.store.read(identity).record,null);
  assert.equal(ui.page.$('#trainingLocalStatus').textContent,'Séance enregistrée sur le cloud');
});

test('cloud save preserves historical exercise variant and target fields',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui,{existing:true});
  app.trainingState.sessionExercises[0].variant='Variante conservée';
  app.trainingState.sessionExercises[0].target='Cible conservée';
  await app.saveTrainingSession();await settle();
  assert.equal(ui.tablesRef.training_session_exercises.length,1);
  assert.equal(ui.tablesRef.training_session_exercises[0].variant,'Variante conservée');
  assert.equal(ui.tablesRef.training_session_exercises[0].target,'Cible conservée');
});

test('failed cloud save preserves the complete local draft',async t=>{
  const {client}=store({writable:false});const page=await loadPage('training',{client});t.after(()=>page.close());
  const app=await boot({page});await app.startNewTraining();
  page.$('#trainingTheme').value='Conserver localement';app.addTrainingPlanBlock({title:'Bloc local'});
  await app.saveTrainingSession();await settle();
  const record=serializedDraft(app);
  assert.equal(record.document.fields.theme,'Conserver localement');
  assert.equal(record.document.planBlocks[0].title,'Bloc local');
});

test('edits made during a cloud save remain dirty and locally recoverable',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  const gate={};gate.promise=new Promise(resolve=>{gate.resolve=resolve});
  app.ensureTeam=()=>gate.promise;
  ui.page.$('#trainingTheme').value='Version envoyée';
  const saving=app.saveTrainingSession();await settle();
  ui.page.$('#trainingTheme').value='Modification pendant enregistrement';
  ui.page.$('#trainingTheme').dispatchEvent(new ui.page.w.Event('input',{bubbles:true}));
  gate.resolve('t1');await saving;await settle();
  assert.equal(app.trainingSessionIsDirty(),true);
  const record=serializedDraft(app);
  assert.equal(record.document.fields.theme,'Modification pendant enregistrement');
  assert.ok(record.sessionId,'the new local draft is linked to the inserted session');
});

test('a newer cloud version stops an existing-session save before child deletion',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui,{existing:true});
  app.trainingLocalState.baseUpdatedAt='2026-10-01T10:00:00Z';
  ui.tablesRef.training_sessions=[{id:'s1',updated_at:'2026-10-02T10:00:00Z'}];
  ui.page.$('#trainingTheme').value='Version locale';
  await app.saveTrainingSession();await settle();
  assert.equal(ui.page.$('#trainingRecoveryPopup').classList.contains('hidden'),false);
  assert.match(ui.page.$('#trainingRecoveryTitle').textContent,/modifiée ailleurs/);
  assert.equal(ui.tablesRef.training_attendance.length,1,'attendance was not deleted');
  assert.equal(ui.tablesRef.training_results.length,1,'results were not deleted');
  assert.equal(app.trainingSessionIsDirty(),true);
});

test('a local revision written by another tab stops cloud save and cannot be deleted',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  ui.page.$('#trainingTheme').value='Premier onglet';app.persistTrainingLocalDraft();
  const identity=app.trainingDraftIdentity(),current=app.trainingLocalState.store.read(identity).record;
  const foreignDocument=JSON.parse(JSON.stringify(current.document));foreignDocument.fields.theme='Second onglet';
  const foreign=app.trainingLocalState.store.write({...current,ownerTabId:'other-tab',expectedRevision:current.revision,document:foreignDocument});
  assert.equal(foreign.ok,true);
  await app.saveTrainingSession();await settle();
  assert.equal(ui.tablesRef.training_sessions.length,0,'cloud write is stopped before insertion');
  assert.equal(ui.page.$('#trainingRecoveryPopup').classList.contains('hidden'),false);
  const removal=app.removeCurrentTrainingLocalDraft();
  assert.equal(removal.ok,false);assert.equal(removal.kind,'conflict');
  assert.equal(app.trainingLocalState.store.read(identity).record.document.fields.theme,'Second onglet');
});

test('draft storage isolates users and sessions and detects concurrent revisions',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  const repository=app.createTrainingDraftStore(ui.page.w.localStorage);
  const document=app.trainingEditorDocument();
  const base={workspaceId:'w1',ownerTabId:'tab-a',expectedRevision:0,meta:{},document};
  assert.equal(repository.write({...base,userId:'u1',draftId:'draft-a',sessionId:'session-a'}).ok,true);
  assert.equal(repository.write({...base,userId:'u1',draftId:'draft-b',sessionId:'session-b'}).ok,true);
  assert.equal(repository.list({userId:'u1',workspaceId:'w1'}).records.length,2);
  assert.equal(repository.list({userId:'u2',workspaceId:'w1'}).records.length,0);
  const conflict=repository.write({...base,userId:'u1',draftId:'draft-a',sessionId:'session-a',ownerTabId:'tab-b',expectedRevision:0});
  assert.equal(conflict.ok,false);assert.equal(conflict.kind,'conflict');
  assert.equal(repository.read({userId:'u1',workspaceId:'w1',draftId:'draft-b'}).record.sessionId,'session-b');
});

test('local storage failure is visible and never blocks editing',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  const original=app.trainingLocalState.store;
  app.trainingLocalState.store={...original,write:()=>({ok:false,kind:'storage',error:new Error('quota')})};
  ui.page.$('#trainingTheme').value='Toujours éditable';
  assert.doesNotThrow(()=>app.persistTrainingLocalDraft());
  assert.equal(ui.page.$('#trainingTheme').value,'Toujours éditable');
  assert.equal(ui.page.$('#trainingLocalStatus').textContent,'Sauvegarde locale impossible');
});

test('versioned storage bounds history and keeps incompatible data untouched',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  const repository=app.createTrainingDraftStore(ui.page.w.localStorage);
  const document=app.trainingEditorDocument();
  let revision=0;
  for(let index=0;index<14;index+=1){
    document.fields.theme=`Révision ${index}`;
    const result=repository.write({userId:'u1',workspaceId:'w1',draftId:'history',sessionId:null,ownerTabId:'tab',expectedRevision:revision,meta:{},document},{checkpointReason:`Étape ${index}`,preserveCurrent:true});
    assert.equal(result.ok,true);revision=result.record.revision;
  }
  const saved=repository.read({userId:'u1',workspaceId:'w1',draftId:'history'}).record;
  assert.equal(saved.history.length,10);

  const incompatibleKey=repository.keyFor({userId:'u1',workspaceId:'w1',draftId:'legacy'});
  const incompatible=JSON.stringify({schemaVersion:99,userId:'u1',workspaceId:'w1',draftId:'legacy'});
  ui.page.w.localStorage.setItem(incompatibleKey,incompatible);
  assert.equal(repository.list({userId:'u1',workspaceId:'w1'}).unreadable.length,1);
  assert.equal(ui.page.w.localStorage.getItem(incompatibleKey),incompatible);
});

test('a throwing storage adapter returns an error without deleting recoverable data',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  const backing=new Map();
  const storage={
    get length(){return backing.size},key:index=>[...backing.keys()][index]??null,
    getItem:key=>backing.get(key)??null,removeItem:key=>backing.delete(key),
    setItem(){throw new Error('QuotaExceededError')}
  };
  const repository=app.createTrainingDraftStore(storage);
  const result=repository.write({userId:'u1',workspaceId:'w1',draftId:'quota',sessionId:null,ownerTabId:'tab',expectedRevision:0,meta:{},document:app.trainingEditorDocument()});
  assert.equal(result.ok,false);assert.equal(result.kind,'storage');assert.equal(backing.size,0);
});

// --- Lot A: permanent local-draft list and cross-tab conflict resolution ---

function seedDraft(app,{userId='u1',workspaceId='w1',draftId,sessionId=null,theme='Brouillon',groupName=TEAM_NAME,date='2026-04-01',blockCount=1,ownerTabId='seed'}={}){
  const document=app.trainingEditorDocument();
  document.fields.theme=theme;
  return app.trainingLocalState.store.write({userId,workspaceId,draftId,sessionId,ownerTabId,expectedRevision:0,
    meta:{theme,groupName,date,blockCount},document});
}

test('home lists multiple local drafts and collapses when empty',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  app.renderTrainingLocalHome();
  assert.equal(ui.page.$('#trainingLocalHome').classList.contains('hidden'),true,'empty list does not clutter the home');
  seedDraft(app,{draftId:'a',theme:'Thème A',blockCount:2});
  seedDraft(app,{draftId:'b',theme:'Thème B',blockCount:0,date:'2026-04-02'});
  app.renderTrainingLocalHome();
  assert.equal(ui.page.$('#trainingLocalHome').classList.contains('hidden'),false);
  assert.equal(ui.page.w.document.querySelectorAll('#trainingLocalHomeList .trainingLocalDraft').length,2);
  const text=ui.page.$('#trainingLocalHomeList').textContent;
  assert.match(text,/Thème A/);
  assert.match(text,/Thème B/);
  assert.match(text,/Nouvelle séance/);
  assert.match(text,/sauvegardé/i);
  assert.equal(ui.page.$('#trainingRecoveryPopup').classList.contains('hidden'),true,'the permanent list does not open the recovery popup');
});

test('resuming a draft from the home reopens the editor with its content',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  seedDraft(app,{draftId:'a',theme:'À reprendre'});
  app.renderTrainingLocalHome();
  ui.page.$('#trainingLocalHomeList [data-resume]').click();
  await settle();
  assert.equal(ui.page.$('#trainingSession').classList.contains('hidden'),false);
  assert.equal(ui.page.$('#trainingTheme').value,'À reprendre');
});

test('an ignored draft stays listed on the home',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  seedDraft(app,{draftId:'a',theme:'Ignoré'});
  app.trainingLocalState.ignored.add('a');
  app.renderTrainingLocalHome();
  assert.equal(ui.page.w.document.querySelectorAll('#trainingLocalHomeList .trainingLocalDraft').length,1);
});

test('deleting a home draft only touches local storage, never Supabase',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  seedDraft(app,{draftId:'a',theme:'À supprimer'});
  app.renderTrainingLocalHome();
  ui.page.w.confirm=()=>true;
  ui.page.$('#trainingLocalHomeList [data-delete]').click();
  assert.equal(app.trainingLocalState.store.read({userId:'u1',workspaceId:'w1',draftId:'a'}).record,null);
  assert.equal((ui.tablesRef.training_sessions||[]).length,0,'no cloud session was removed');
  assert.equal(ui.page.$('#trainingLocalHome').classList.contains('hidden'),true,'the section hides once empty');
});

test('home drafts are isolated per user',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  seedDraft(app,{userId:'u1',draftId:'a',theme:'Le mien'});
  seedDraft(app,{userId:'u2',draftId:'b',theme:'Autre compte'});
  app.renderTrainingLocalHome();
  const text=ui.page.$('#trainingLocalHomeList').textContent;
  assert.match(text,/Le mien/);
  assert.equal(/Autre compte/.test(text),false);
});

test('a same-draft tab conflict explains itself and offers three resolutions',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  ui.page.$('#trainingTheme').value='Premier onglet';app.persistTrainingLocalDraft();
  const identity=app.trainingDraftIdentity(),current=app.trainingLocalState.store.read(identity).record;
  const foreignDocument=JSON.parse(JSON.stringify(current.document));foreignDocument.fields.theme='Second onglet';
  app.trainingLocalState.store.write({...current,ownerTabId:'other-tab',expectedRevision:current.revision,document:foreignDocument});
  await app.saveTrainingSession();await settle();
  assert.equal(ui.page.$('#trainingConflictNotice').classList.contains('hidden'),false);
  assert.match(ui.page.$('#trainingConflictMessage').textContent,/modifiée dans un autre onglet/);
  assert.equal(app.trainingLocalState.conflict.kind,'sameDraft');
  assert.equal(ui.page.$('#trainingRecoveryPopup').classList.contains('hidden'),false);
  const labels=[...ui.page.w.document.querySelectorAll('#trainingRecoveryActions button')].map(button=>button.textContent);
  assert.equal(labels.length,3);
  assert.equal(labels.some(label=>/forc/i.test(label)),false,'no silent force-overwrite action');
});

test('keeping my work as a distinct draft preserves the other tab draft',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  ui.page.$('#trainingTheme').value='Premier onglet';app.persistTrainingLocalDraft();
  const identity=app.trainingDraftIdentity(),current=app.trainingLocalState.store.read(identity).record;
  const foreignDocument=JSON.parse(JSON.stringify(current.document));foreignDocument.fields.theme='Second onglet';
  app.trainingLocalState.store.write({...current,ownerTabId:'other-tab',expectedRevision:current.revision,document:foreignDocument});
  await app.saveTrainingSession();await settle();
  app.forkCurrentTrainingDraft();
  const records=app.trainingLocalState.store.list({userId:'u1',workspaceId:'w1'}).records;
  assert.equal(records.length,2,'both works coexist');
  assert.ok(records.some(record=>record.document.fields.theme==='Second onglet'));
  assert.ok(records.some(record=>record.document.fields.theme==='Premier onglet'));
  assert.equal(app.trainingLocalState.conflict,null);
});

test('resuming the latest version adopts the other tab content from disk',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  ui.page.$('#trainingTheme').value='Premier onglet';app.persistTrainingLocalDraft();
  const identity=app.trainingDraftIdentity(),current=app.trainingLocalState.store.read(identity).record;
  const foreignDocument=JSON.parse(JSON.stringify(current.document));foreignDocument.fields.theme='Second onglet';
  // The other tab wrote to disk and is now closed: no message is delivered.
  app.trainingLocalState.store.write({...current,ownerTabId:'other-tab',expectedRevision:current.revision,document:foreignDocument});
  await app.saveTrainingSession();await settle();
  await app.resumeTrainingFromLatest();await settle();
  assert.equal(ui.page.$('#trainingTheme').value,'Second onglet');
  assert.equal(app.trainingLocalState.conflict,null);
  assert.ok(app.trainingLocalState.store.read(app.trainingDraftIdentity()).record.revision>current.revision);
});

test('returning to the other tab stops local writes in this tab',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  ui.page.$('#trainingTheme').value='Premier onglet';app.persistTrainingLocalDraft();
  const identity=app.trainingDraftIdentity(),current=app.trainingLocalState.store.read(identity).record;
  app.registerTrainingTabConflict({draftId:identity.draftId,sessionId:null,revision:current.revision+1,ownerTabId:'other-tab'});
  app.concedeTrainingTab();
  assert.equal(app.trainingLocalState.suppressed,true);
  assert.equal(app.trainingLocalState.conflict,null);
  const revision=app.trainingLocalState.store.read(identity).record.revision;
  ui.page.$('#trainingTheme').value='Écrit après abandon';
  app.persistTrainingLocalDraft();
  assert.equal(app.trainingLocalState.store.read(identity).record.revision,revision,'no write happens after conceding');
  assert.match(ui.page.$('#trainingLocalStatus').textContent,/n’enregistre plus/);
});

test('two distinct drafts for the same session are distinguished from the same-draft conflict',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui,{existing:true});
  const document=app.trainingEditorDocument();document.fields.theme='Autre onglet';
  const key=app.trainingLocalState.store.keyFor({userId:'u1',workspaceId:'w1',draftId:'foreign'});
  const record=app.trainingLocalState.store.write({userId:'u1',workspaceId:'w1',draftId:'foreign',sessionId:'s1',ownerTabId:'other-tab',expectedRevision:0,meta:{theme:'Autre onglet'},document}).record;
  ui.page.w.dispatchEvent(new ui.page.w.StorageEvent('storage',{key,newValue:JSON.stringify(record)}));
  assert.equal(app.trainingLocalState.conflict.kind,'sameSession');
  app.openTrainingConflictResolution();
  assert.match(ui.page.$('#trainingRecoveryBody').textContent,/même séance|brouillon distinct/i);
  assert.equal(ui.page.$('#trainingRecoveryPopup').classList.contains('hidden'),false);
});

// --- Correctif: les brouillons locaux restent visibles sans dépendre du réseau ---

// Reproduces the production failure: one Supabase query answers with an error
// (like a lost connection). The local list reads only localStorage and must
// still render on the training home.
function failingQuery(){
  const query=new Proxy({},{get(_,method){
    if(method==='then')return resolve=>resolve({data:null,error:{message:'offline'}});
    return()=>query;
  }});
  return query;
}

async function openOffline(ui,failedTable='exercises'){
  const {client,tables}=store({writable:true});
  ui.tablesRef=tables;
  const originalFrom=client.from.bind(client);
  client.from=table=>table===failedTable?failingQuery():originalFrom(table);
  ui.page=await loadPage('training',{client});
  return boot(ui);
}

test('local drafts render on the home before any Supabase response',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  seedDraft(app,{draftId:'v',theme:'Visible tout de suite'});
  // Reload through the real navigation path, not a manual render call.
  await app.openTrainingModule();
  await settle();
  assert.equal(ui.page.$('#trainingLocalHome').classList.contains('hidden'),false);
  assert.match(ui.page.$('#trainingLocalHomeList').textContent,/Visible tout de suite/);
});

test('local drafts stay visible even when a Supabase query errors',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await openOffline(ui);
  seedDraft(app,{draftId:'off',theme:'Hors ligne'});
  await app.openTrainingModule();
  await settle();
  assert.equal(ui.page.$('#trainingHome').classList.contains('hidden'),false,'the home is shown');
  assert.equal(ui.page.$('#trainingLocalHome').classList.contains('hidden'),false,
    'the local list must not depend on a successful network call');
  assert.match(ui.page.$('#trainingLocalHomeList').textContent,/Hors ligne/);
  assert.equal(app.trainingLocalState.store.list({userId:'u1',workspaceId:'w1'}).records.length,1,
    'the failed query never deletes the local draft');
});

test('leaving a dirty session lists its draft on the home without manual refresh',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  ui.page.$('#trainingTheme').value='Séance en cours';
  ui.page.$('#trainingTheme').dispatchEvent(new ui.page.w.Event('input',{bubbles:true}));
  await runAutosave(ui);
  ui.page.$('#cancelTraining').click();await settle();
  ui.page.$('#trainingUnsavedKeep').click();await settle();await settle();
  assert.equal(ui.page.$('#trainingHome').classList.contains('hidden'),false);
  assert.equal(ui.page.$('#trainingLocalHome').classList.contains('hidden'),false);
  assert.match(ui.page.$('#trainingLocalHomeList').textContent,/Séance en cours/);
});

test('local drafts survive a full page reload',async t=>{
  const ui1={},ui2={};t.after(()=>{ui1.page?.close();ui2.page?.close()});
  const {client}=store({writable:true});
  ui1.page=await loadPage('training',{client});
  const app1=await boot(ui1);
  seedDraft(app1,{draftId:'reload',theme:'Persisté au rechargement'});
  const snapshot={};
  const storage=ui1.page.w.localStorage;
  for(let i=0;i<storage.length;i++){const key=storage.key(i);snapshot[key]=storage.getItem(key)}
  ui2.page=await loadPage('training',{client});
  for(const [key,value] of Object.entries(snapshot))ui2.page.w.localStorage.setItem(key,value);
  const app2=await boot(ui2);
  await app2.openTrainingModule();
  await settle();
  assert.equal(ui2.page.$('#trainingLocalHome').classList.contains('hidden'),false);
  assert.match(ui2.page.$('#trainingLocalHomeList').textContent,/Persisté au rechargement/);
});

test('local draft cards match the saved-session actions (ghost buttons)',async t=>{
  const ui={};t.after(()=>ui.page?.close());const app=await open(ui);
  seedDraft(app,{draftId:'a',theme:'Thème'});
  app.renderTrainingLocalHome();
  const resume=ui.page.$('#trainingLocalHomeList [data-resume]');
  const remove=ui.page.$('#trainingLocalHomeList [data-delete]');
  assert.equal(resume.classList.contains('ghost'),true);
  assert.equal(resume.classList.contains('primary'),false);
  assert.equal(remove.classList.contains('ghost'),true);
  assert.equal(remove.classList.contains('dangerAction'),true);
});

// --- Correctif: la carte brouillon rejoint le thème clair partagé ---

function cssVar(css,name){
  const match=css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(match,`--${name} introuvable`);
  return match[1];
}
function channel(hex){const value=parseInt(hex,16)/255;return value<=0.03928?value/12.92:((value+0.055)/1.055)**2.4}
function luminance(hex){
  const r=channel(hex.slice(1,3)),g=channel(hex.slice(3,5)),b=channel(hex.slice(5,7));
  return 0.2126*r+0.7152*g+0.0722*b;
}
function contrast(foreground,background){
  const [a,b]=[luminance(foreground),luminance(background)].sort((x,y)=>y-x);
  return (a+0.05)/(b+0.05);
}

test('draft card uses the shared light surface, not the legacy dark theme',()=>{
  const common=fs.readFileSync(path.join(root,'css/common.css'),'utf8');
  assert.match(common,/\.trainingSavedSession,\.trainingLocalDraft,/,
    'common.css must neutralise the draft card like the saved-session card');
  const shared=fs.readFileSync(path.join(root,'css/coaching-shared.css'),'utf8');
  assert.match(shared,/\.trainingSavedSession,\s*\.trainingLocalDraft\{/);
  assert.match(shared,/\.trainingSavedSession:hover,\.trainingLocalDraft:hover\{/);
  const training=fs.readFileSync(path.join(root,'css/training.css'),'utf8');
  const rule=training.match(/\.trainingLocalDraft\{([^}]*)\}/);
  assert.ok(rule,'.trainingLocalDraft rule expected in training.css');
  assert.equal(/#171a21|#1b2029|#53637a/.test(rule[1]),false,'no leftover dark theme colours');
  assert.match(rule[1],/var\(--panel2\)/);
  const muted=cssVar(common,'muted'),surface=cssVar(common,'surface-muted');
  const ratio=contrast(muted,surface);
  assert.ok(ratio>=4.5,`secondary text contrast ${ratio.toFixed(2)} must reach WCAG AA`);
});

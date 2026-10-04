// Frontend catalog flows against an isolated in-memory store. Not SQL/RLS proof.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadPage}=require('./helpers/page-harness.cjs');

function catalogStore(){
  const tables={
    exercise_categories:[{id:'c1',name:'Attaque',slug:'attaque',active:true,is_native:true,is_dual_focus:false},
      {id:'c2',name:'Dual',slug:'dual',active:true,is_native:true,is_dual_focus:true},
      {id:'c3',name:'Autre',slug:'autre',active:true,is_native:true,is_dual_focus:false},
      {id:'c4',name:'Personnalisée',slug:'custom',active:true,is_native:false,is_dual_focus:false}],
    match_types:[],user_profiles:[{user_id:'u1',first_name:'Lucas'}],
    exercises:[{id:'ex1',name:'Source',category_id:'c4',measurement_type:'success_attempts',active:true}]
  };
  const calls=[];let nextId=1;
  const client={calls,
    from:table=>{
      const filters=[];let mode='select',values,single=false;
      const query=new Proxy({}, {get(_,method){
        if(method==='then')return async(resolve,reject)=>{
          try{
            calls.push({table,mode,values});
            if(!tables[table])throw new Error('Unexpected fixture table '+table);
            let result=tables[table].filter(row=>filters.every(f=>f(row)));
            if(mode==='insert'){
              const row={id:'created-'+nextId++,active:true,created_by:'u1',...values};
              if(table==='exercises')row.category=tables.exercise_categories.find(c=>c.id===row.category_id)?.name;
              tables[table].push(row);result=[row];
            }else if(mode==='update')result.forEach(row=>Object.assign(row,values));
            resolve({data:JSON.parse(JSON.stringify(single?result[0]||null:result)),error:null});
          }catch(e){reject(e)}
        };
        return (...args)=>{
          if(method==='eq')filters.push(row=>row[args[0]]===args[1]);
          if(method==='in')filters.push(row=>args[1].includes(row[args[0]]));
          if(method==='insert'||method==='update'){mode=method;values=args[0]}
          if(method==='single'||method==='maybeSingle')single=true;
          return query;
        };
      }});
      return query;
    },
    rpc:async name=>{
      calls.push({rpc:name});
      assert.equal(name,'get_exercise_usage');
      return {data:{used:false,has_results:false},error:null};
    },
    auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}
  };
  return {client,tables};
}

test('training catalog: create/edit/copy, archived category and dual focus use current modules',async t=>{
  const {client,tables}=catalogStore();
  const ui=await loadPage('training',{client});t.after(()=>ui.close());
  const app=ui.w.KinballCoach.app;
  app.currentUser={id:'u1',email:'lucas@example.test'};
  await app.openSettingsModule();
  assert.equal(ui.$('#settingsHome').classList.contains('hidden'),false);
  await app.fetchTrainingExercises();
  await app.openExerciseCreatePopup('library');
  ui.$('#exerciseCreateName').value='Exercice créé';ui.$('#exerciseCreateCategory').value='c4';
  await app.createExerciseFromPopup();
  const created=tables.exercises.find(ex=>ex.name==='Exercice créé');assert.ok(created);
  await app.openExerciseEditPopup(created.id);
  ui.$('#exerciseEditName').value='Exercice modifié';await app.saveExerciseEdits();
  assert.equal(created.name,'Exercice modifié');
  await app.duplicateSharedExercise(created.id);
  const copy=tables.exercises.find(ex=>ex.copied_from_exercise_id===created.id);assert.ok(copy);
  assert.equal(copy.category_id,'c4');

  await app.runCategoryAction(()=>app.updateCustomCategory('c4',{active:false}));
  await app.openExerciseCreatePopup('library');
  assert.equal([...ui.$('#exerciseCreateCategory').options].some(o=>o.value==='c4'),false);
  await app.openExerciseEditPopup(created.id);
  assert.equal(ui.$('#exerciseEditCategory').value,'c4');
  ui.$('#exerciseEditName').value='Ancien conservé';await app.saveExerciseEdits();
  assert.equal(created.category_id,'c4');
  await app.duplicateSharedExercise(created.id);
  const archivedCopy=tables.exercises.at(-1);
  assert.match(ui.$('#exerciseEditStatus').textContent,/catégorie archivée/);
  await assert.rejects(app.saveExerciseEdits(),/catégorie est archivée/);
  assert.equal(archivedCopy.category_id,'c4');

  await app.openExerciseCreatePopup('session');
  ui.$('#exerciseCreateName').value='Dual test';ui.$('#exerciseCreateCategory').value='c2';
  app.updateCreateDualUI();
  await app.createExerciseFromPopup();
  assert.match(ui.$('#exerciseCreateStatus').textContent,/focus/);
  ui.$('#exerciseCreateSessionFocus').value='defense';
  ui.$('#exerciseCreateDefenseInstruction').value='Défendre';
  await app.createExerciseFromPopup();
  assert.equal(app.trainingState.sessionExercises.at(-1).focus,'defense');
  assert.match(ui.$('#trainingExerciseCards').textContent,/Défendre/);

  tables.exercise_categories.push({id:'unsafe',name:'<img src=x onerror=boom>',slug:'unsafe',active:true,is_native:false});
  await app.openSettingsModule();
  assert.equal(ui.$('#categoryList img'),null);
  assert.match(ui.$('#categoryList').textContent,/<img src=x onerror=boom>/);
  assert.deepEqual(ui.alerts,[]);
});

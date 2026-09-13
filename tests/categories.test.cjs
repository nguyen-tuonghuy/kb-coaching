const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {JSDOM}=require('jsdom');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260913154540_dynamic_exercise_categories.sql'),'utf8');
const user='11111111-1111-4111-8111-111111111111';
const fixture=`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users values ('${user}');
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create table public.exercises (
 id uuid primary key default gen_random_uuid(), name text not null, category text,
 measurement_type text not null, description text, objective text,
 attack_instruction text, defense_instruction text, active boolean not null default true,
 created_by uuid default auth.uid(),updated_by uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.training_results(id uuid primary key default gen_random_uuid(),exercise_id uuid references public.exercises);
create table public.user_profiles(user_id uuid,first_name text);
grant select,insert,update,delete on public.exercises to authenticated;
grant select on public.training_results,public.user_profiles to authenticated;
alter table public.exercises enable row level security;
create policy read_exercises on public.exercises for select to authenticated using (true);
create policy insert_exercises on public.exercises for insert to authenticated with check (created_by=auth.uid());
create policy update_exercises on public.exercises for update to authenticated using (true) with check (true);
create function public.fixture_audit() returns trigger language plpgsql as $$ begin
 new.updated_at=now();new.updated_by=auth.uid();return new;end $$;
create trigger trg_exercises_audit before update on public.exercises for each row execute function public.fixture_audit();
insert into public.exercises(name,category,measurement_type,created_at,updated_at) values
 ('Attaque originale','Attaque','count','2020-01-01','2020-01-01'),
 ('Défense originale','Défense','count','2020-01-01','2020-01-01'),
 ('Dual original','Attaque / Défense','success_attempts','2020-01-01','2020-01-01'),
 ('Personnalisé','  Équilibre   collectif  ','count','2020-01-01','2020-01-01'),
 ('Variante','equilibre collectif','count','2020-01-01','2020-01-01'),
 ('Sans catégorie',null,'count','2020-01-01','2020-01-01');
`;
async function makeDB(){const db=new PGlite();await db.exec(fixture);await db.exec(migration);return db}
async function asCoach(db){await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}';`)}
async function rows(db,sql,params=[]){return (await db.query(sql,params)).rows}
async function one(db,sql,params=[]){return (await rows(db,sql,params))[0]}

test('SQL: migration, native identity, legacy mapping and preserved audit',async()=>{
 const db=await makeDB();
 try{
  const cats=await rows(db,'select * from exercise_categories');
  assert.equal(cats.length,5);
  assert.equal(cats.filter(c=>c.is_native).length,4);
  assert.equal(cats.filter(c=>c.is_dual_focus).length,1);
  assert.equal(cats.some(c=>['Passe','Déplacement','Physique'].includes(c.name)),false);
  const ex=await rows(db,'select e.*,c.slug from exercises e join exercise_categories c on c.id=e.category_id');
  assert.equal(ex.length,6);
  assert.equal(ex.find(e=>e.name==='Sans catégorie').slug,'autre');
  assert.equal(ex.find(e=>e.name==='Personnalisé').category_id,ex.find(e=>e.name==='Variante').category_id);
  assert.ok(ex.every(e=>new Date(e.updated_at).getUTCFullYear()===2020),JSON.stringify(ex.map(e=>({name:e.name,date:e.updated_at}))));
 }finally{await db.close()}
});

test('SQL: RLS, normalized duplicates, protected fields, archive and compatibility',async()=>{
 const db=await makeDB();
 try{
  await db.exec('set role anon');
  await assert.rejects(rows(db,'select * from exercise_categories'),/permission denied/);
  await assert.rejects(rows(db,"insert into exercise_categories(name) values ('Interdit')"),/permission denied/);
  await asCoach(db);
  const native=await one(db,"select * from exercise_categories where slug='attaque'");
  assert.equal((await rows(db,"update exercise_categories set name='Interdit' where id=$1 returning id",[native.id])).length,0);
  assert.equal((await rows(db,"update exercise_categories set active=false where id=$1 returning id",[native.id])).length,0);
  await assert.rejects(rows(db,'delete from exercise_categories where id=$1',[native.id]),/permission denied/);
  await assert.rejects(rows(db,"insert into exercise_categories(name,is_native) values ('Faux',true)"),/permission denied/);
  const custom=await one(db,"insert into exercise_categories(name) values ('  Précision   équipe  ') returning *");
  assert.equal(custom.name,'Précision équipe');assert.equal(custom.created_by,user);
  await assert.rejects(rows(db,"insert into exercise_categories(name) values ('precision EQUIPE')"),/duplicate key/);
  await assert.rejects(rows(db,"insert into exercise_categories(name) values ('Précision équipe')"),/duplicate key/);
  await assert.rejects(rows(db,"update exercise_categories set name=' DEFENSE ' where id=$1",[custom.id]),/duplicate key/);
  await assert.rejects(rows(db,"update exercise_categories set is_dual_focus=true where id=$1",[custom.id]),/permission denied/);
  const ex=await one(db,"insert into exercises(name,measurement_type,category_id) values ('Cible','count',$1) returning *",[custom.id]);
  assert.equal(ex.category,custom.name);
  await rows(db,"update exercise_categories set name='Précision avancée' where id=$1",[custom.id]);
  assert.equal((await one(db,'select * from exercises where id=$1',[ex.id])).category,'Précision avancée');
  assert.equal((await one(db,'select * from exercise_categories where id=$1',[custom.id])).slug,custom.slug);
  await rows(db,'update exercise_categories set active=false where id=$1',[custom.id]);
  assert.equal((await rows(db,'select * from exercise_categories where id=$1',[custom.id])).length,1);
  await assert.rejects(rows(db,"insert into exercises(name,measurement_type,category_id) values ('Nouveau','count',$1)",[custom.id]),/archivée/);
  await assert.rejects(rows(db,"insert into exercises(name,measurement_type,category) values ('Ancien client','count','Précision avancée')"),/archivée/);
  await rows(db,"update exercises set name='Ancien modifié' where id=$1",[ex.id]);
  await assert.rejects(rows(db,'update exercises set category_id=$1 where name=$2',[custom.id,'Attaque originale']),/archivée/);
  await assert.rejects(rows(db,"insert into exercise_categories(name) values ('precision avancee')"),/duplicate key/);
  await rows(db,'update exercise_categories set active=true where id=$1',[custom.id]);
  await rows(db,"insert into exercises(name,measurement_type,category_id) values ('Réactivé','count',$1)",[custom.id]);
  const oldClient=await one(db,"insert into exercises(name,measurement_type,category) values ('V2.2','count','Défense') returning *");
  assert.ok(oldClient.category_id);assert.equal(oldClient.category,'Défense');
  await rows(db,"update exercises set category='Attaque' where id=$1",[oldClient.id]);
  assert.equal((await one(db,'select * from exercises where id=$1',[oldClient.id])).category_id,oldClient.category_id);
  await db.exec('reset role');
  await assert.rejects(rows(db,'delete from exercise_categories where id=$1',[custom.id]),/Archivez/);
  await assert.rejects(rows(db,"update exercise_categories set name='Même administrateur' where id=$1",[native.id]),/fixe/);
 }finally{await db.close()}
});

// Minimal Supabase query adapter backed by the migrated PostgreSQL test database.
// It exercises real constraints/RLS while the DOM runs the production inline script.
function clientFor(db){
 class Query{
  constructor(table){this.table=table;this.filters=[];this.sort=[];this.mode='select';this.values=null;this.singleRow=false;this.countOnly=false}
  select(fields,options={}){this.fields=fields;this.countOnly=!!options.head;return this}
  eq(column,value){this.filters.push({column,value});return this}
  in(column,value){this.filters.push({column,value,in:true});return this}
  order(column,options={}){this.sort.push({column,asc:options.ascending!==false});return this}
  limit(value){this.max=value;return this}
  insert(values){this.mode='insert';this.values=values;return this}
  update(values){this.mode='update';this.values=values;return this}
  single(){this.singleRow=true;return this}
  maybeSingle(){this.singleRow=true;this.optional=true;return this}
  async execute(){
   const quote=value=>{assert.match(value,/^[a-z_]+$/);return '"'+value+'"'};
   let params=[];const param=value=>{params.push(value);return '$'+params.length};
   const table=quote(this.table);let sql;
   if(this.mode==='insert'){
    const keys=Object.keys(this.values);
    sql=`insert into ${table} (${keys.map(quote)}) values (${keys.map(k=>param(this.values[k]))}) returning *`;
   }else{
    sql=this.mode==='update'?`update ${table} set ${Object.entries(this.values).map(([k,v])=>quote(k)+'='+param(v)).join(',')}`:`select * from ${table}`;
    if(this.filters.length)sql+=' where '+this.filters.map(f=>quote(f.column)+(f.in?' = any('+param(f.value)+')':' = '+param(f.value))).join(' and ');
    if(this.mode==='update')sql+=' returning *';
    else{
     if(this.sort.length)sql+=' order by '+this.sort.map(s=>quote(s.column)+(s.asc?' asc':' desc')).join(',');
     if(this.max)sql+=' limit '+Number(this.max);
    }
   }
   try{
    const data=await rows(db,sql,params);
    if(this.singleRow&&data.length!==1&&!this.optional)return {error:{message:'Expected one row',code:'PGRST116'},data:null};
    return {error:null,data:this.countOnly?null:this.singleRow?data[0]:data,count:data.length};
   }catch(error){return {error:{message:error.message,code:error.code},data:null}}
  }
  then(resolve,reject){return this.execute().then(resolve,reject)}
 }
 return {from:table=>new Query(table),auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signOut:async()=>({error:null})}};
}
function makeUI(db){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const dom=new JSDOM(html,{url:'http://localhost',runScripts:'outside-only'});
 const w=dom.window;w.supabase={createClient:()=>clientFor(db)};
 w.alert=message=>{throw new Error('Unexpected alert: '+message)};w.confirm=()=>true;w.scrollTo=()=>{};w.setTimeout=()=>0;
 const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
 w.eval(script+`;window.kb={categoryState,trainingState,statsState,categoryById,categoryLabel,isDualExercise,
  normalizeCategoryName,validateCategoryName,fetchExerciseCategories,fetchTrainingExercises,openSettingsModule,
  runCategoryAction,updateCustomCategory,openExerciseCreatePopup,createExerciseFromPopup,
  openExerciseEditPopup,saveExerciseEdits,duplicateSharedExercise,renderExerciseLibrary,
  addSessionExercise,renderStatsGroup,renderStatsExercise,populateStatsSelectors,
  setUser:()=>{currentUser={id:'${user}'}}};`);
 w.kb.setUser();return {dom,w,kb:w.kb,$:selector=>w.document.querySelector(selector)};
}

test('Frontend: settings, create/edit/duplicate, archive/filter/statistics, dual focus',async()=>{
 const db=await makeDB();let dom;
 try{
  await asCoach(db);
  const ui=makeUI(db);dom=ui.dom;const {w,kb,$}=ui;
  await kb.openSettingsModule();
  assert.equal($('#settingsHome').classList.contains('hidden'),false);
  assert.equal([...w.document.querySelectorAll('#categoryList .small')].filter(e=>e.textContent==='Fixe').length,4);
  $('#categoryName').value='Coordination';
  $('#categoryCreateForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
  // Wait on the specific handler completion, not an arbitrary wall-clock delay.
  while(kb.categoryState.busy)await new Promise(resolve=>setImmediate(resolve));
  assert.match($('#categoryStatus').textContent,/enregistrées/);
  const cat=kb.categoryState.categories.find(c=>c.name==='Coordination');assert.ok(cat);
  assert.throws(()=>kb.validateCategoryName(' COORDINÁTION '),/déjà/);
  await kb.fetchTrainingExercises();
  await kb.openExerciseCreatePopup('library');
  $('#exerciseCreateName').value='Parcours';$('#exerciseCreateCategory').value=cat.id;
  await kb.createExerciseFromPopup();
  const ex=kb.trainingState.exercises.find(e=>e.name==='Parcours');assert.equal(ex.category_id,cat.id);
  await kb.openExerciseEditPopup(ex.id);$('#exerciseEditName').value='Parcours précis';await kb.saveExerciseEdits();
  assert.equal((await one(db,'select * from exercises where id=$1',[ex.id])).name,'Parcours précis');
  await kb.duplicateSharedExercise(ex.id);
  const copy=kb.trainingState.exercises.find(e=>e.name==='Parcours précis - copie');assert.equal(copy.category_id,cat.id);
  assert.ok([...$('#trainingExerciseSelect').options].some(o=>o.value===copy.id));
  await kb.runCategoryAction(()=>kb.updateCustomCategory(cat.id,{name:'Coordination avancée'}));
  assert.equal(kb.categoryLabel(ex),'Coordination avancée');
  await kb.runCategoryAction(()=>kb.updateCustomCategory(cat.id,{active:false}));
  await kb.fetchTrainingExercises();
  await kb.openExerciseCreatePopup();
  assert.equal([...$('#exerciseCreateCategory').options].some(o=>o.value===cat.id),false);
  await kb.openExerciseEditPopup(ex.id);
  assert.equal($('#exerciseEditCategory').value,cat.id);assert.match($('#exerciseEditCategory').selectedOptions[0].textContent,/archivée/);
  $('#exerciseEditName').value='Ancien parcours';await kb.saveExerciseEdits();
  assert.equal((await one(db,'select * from exercises where id=$1',[ex.id])).category_id,cat.id);
  $('#exerciseLibraryCategory').value=cat.id;kb.renderExerciseLibrary();
  assert.match($('#exerciseLibraryList').textContent,/Ancien parcours/);
  assert.doesNotMatch($('#exerciseLibraryList').textContent,/Attaque originale/);
  assert.match($('#exerciseLibraryList').textContent,/archivée/);
  await kb.duplicateSharedExercise(ex.id);
  const archivedCopy=kb.trainingState.exercises.find(e=>e.name==='Ancien parcours - copie');
  assert.equal(archivedCopy.category_id,cat.id);
  assert.match($('#exerciseEditStatus').textContent,/archivée/);
  kb.statsState.groupId='group';kb.statsState.sessionExercises=[{exercise_id:ex.id,session_id:'s',exercise:ex}];
  kb.renderStatsGroup();assert.match($('#statsCategoryDistribution').textContent,/Coordination avancée · archivée/);
  await kb.runCategoryAction(()=>kb.updateCustomCategory(cat.id,{active:true}));
  await kb.openExerciseCreatePopup();assert.ok([...$('#exerciseCreateCategory').options].some(o=>o.value===cat.id));
  const dual=kb.categoryState.categories.find(c=>c.is_dual_focus);
  // Display name is intentionally changed only in the in-memory fixture to prove no text coupling.
  dual.name='Libellé indépendant';
  assert.equal(kb.isDualExercise({category_id:dual.id,category:'autre texte'}),true);
  $('#exerciseCreateName').value='Dual nouveau';$('#exerciseCreateCategory').value=dual.id;
  $('#exerciseCreateCategory').dispatchEvent(new w.Event('change'));
  assert.equal($('#exerciseCreateDualFields').classList.contains('hidden'),false);
  $('#exerciseCreateAttackInstruction').value='Frapper';$('#exerciseCreateDefenseInstruction').value='Recevoir';
  await kb.createExerciseFromPopup();
  const dualEx=kb.trainingState.exercises.find(e=>e.name==='Dual nouveau');
  assert.equal(dualEx.attack_instruction,'Frapper');assert.equal(dualEx.defense_instruction,'Recevoir');
  kb.addSessionExercise(dualEx,'defense');
  assert.equal(kb.trainingState.sessionExercises.at(-1).focus,'defense');
  assert.match($('#trainingExerciseCards').textContent,/Recevoir/);
  kb.statsState.exerciseMap={[dualEx.id]:dualEx};kb.populateStatsSelectors();$('#statsExercise').value=dualEx.id;kb.renderStatsExercise();
  assert.equal($('#statsExerciseFocusWrap').classList.contains('hidden'),false);
  await kb.duplicateSharedExercise(dualEx.id);
  assert.equal(kb.trainingState.exercises.find(e=>e.name==='Dual nouveau - copie').defense_instruction,'Recevoir');
  // HTML-looking names are displayed as text in settings, menus and category labels.
  await rows(db,"insert into exercise_categories(name) values ('<img src=x onerror=alert(1)>')");
  await kb.openSettingsModule();assert.equal($('#categoryList').querySelector('img'),null);
 }finally{dom?.window.close();await db.close()}
});

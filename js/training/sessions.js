/* Training plans, exercises and sessions. Shared explicit application context; no startup side effects. */
((app) => {
app.loadTrainingGroupPlayers = async function loadTrainingGroupPlayers(groupId){
  app.trainingState.players=await app.fetchGroupPlayers(groupId);
  app.renderTrainingAttendance();app.renderHistoryPlayers();
};

app.fetchTrainingPlayers = async function fetchTrainingPlayers(groupId=null){
  const gid=groupId||app.$('#trainingGroup')?.value||app.$('#historyGroup')?.value||app.groupState.groups[0]?.id||null;
  if(gid){
    const [players,selections]=await Promise.all([app.fetchGroupPlayers(gid),app.fetchGroupSelections(gid)]);
    app.trainingState.players=players;
    app.trainingState.selections=selections;
  }else{
    app.trainingState.players=[];
    app.trainingState.selections=[];
  }
  app.renderTrainingAttendance();app.renderHistoryPlayers();app.populateTrainingAttendancePreset();
  if(app.$('#trainingAttendancePresetStatus'))app.$('#trainingAttendancePresetStatus').textContent='';
};

app.populateTrainingAttendancePreset = function populateTrainingAttendancePreset(){
  const select=app.$('#trainingAttendancePreset');if(!select)return;
  const current=select.value;
  app.fillGroupSelectionSelect(select,app.trainingState.selections||[],{selectedId:current,allLabel:'Tout le groupe'});
  select.disabled=!(app.trainingState.players||[]).length;
};

app.applyTrainingAttendancePreset = function applyTrainingAttendancePreset(){
  const select=app.$('#trainingAttendancePreset'),status=app.$('#trainingAttendancePresetStatus');if(!select)return;
  const selectionId=select.value||'';
  const selection=selectionId?(app.trainingState.selections||[]).find(s=>s.id===selectionId):null;
  const allowed=selection?new Set(selection.player_ids||[]):null;
  app.$$('#trainingAttendance input').forEach(c=>{c.checked=allowed?allowed.has(c.value):true});
  if(status)status.textContent=selection?`${selection.name} · ${selection.player_ids.length} joueur${selection.player_ids.length>1?'s':''} précoché${selection.player_ids.length>1?'s':''}.`:'Tout le groupe est précoché.';
  app.renderTrainingExerciseCards();
};

app.fetchTrainingExercises = async function fetchTrainingExercises({withProfiles=true}={}){
  // Catégories et exercices sont indépendants : une seule latence réseau au lieu de deux successives.
  const categoriesPromise=app.fetchExerciseCategories();
  const exercisesPromise=app.db.from('exercises').select('id,name,category,category_id,copied_from_exercise_id,measurement_type,description,objective,attack_instruction,defense_instruction,created_by,created_at,updated_by,updated_at,active').order('name');
  const [,result]=await Promise.all([categoriesPromise,exercisesPromise]);
  const {data,error}=result;
  if(error) throw error;
  app.trainingState.exercises=data||[];
  if(withProfiles)await app.fetchProfiles(app.trainingState.exercises.flatMap(ex=>[ex.created_by,ex.updated_by]));
  const sel=app.$('#trainingExerciseSelect');
  sel.innerHTML='<option value="">— Choisir —</option>';
  app.trainingState.exercises.filter(ex=>ex.active).forEach(ex=>{
    const o=document.createElement('option');o.value=ex.id;o.textContent=`${ex.name}${' · '+app.categoryLabel(ex)}`;sel.append(o);
  });
  app.renderExerciseLibrary();
};

app.openTrainingModule = async function openTrainingModule(){
  try{
    // Afficher immédiatement la page : les données arrivent ensuite sans bloquer le clic.
    app.hideMainModules();
    app.setMatchHeaderMode(false);app.$('#trainingHome').classList.remove('hidden');
    if(app.$('#trainingSavedSeasons'))app.$('#trainingSavedSeasons').innerHTML='<div class="small">Chargement des séances…</div>';
    window.scrollTo({top:0,behavior:'instant'});

    if(!app.groupState.groups.length)await app.fetchMyGroups();

    // Données visibles prioritaires : exercices/catégories et séances partent en parallèle.
    await Promise.all([
      app.fetchTrainingExercises({withProfiles:false}),
      app.fetchRecentTrainingSessions({withProfiles:false})
    ]);
    app.renderTrainingSavedHome();
    app.startupTiming('séances et exercices affichés');

    // Les noms des auteurs sont secondaires : ils ne retardent plus l'affichage des séances.
    app.runStartupBackground('profils entraînement',async()=>{
      await app.fetchProfiles([
        ...app.trainingState.exercises.flatMap(ex=>[ex.created_by,ex.updated_by]),
        ...app.trainingState.recentSessions.flatMap(sess=>[sess.created_by,sess.updated_by])
      ]);
      app.renderExerciseLibrary();
    });
  }catch(e){app.handleError('openTrainingModule',e)}
};

app.renderTrainingAttendance = function renderTrainingAttendance(){
  const box=app.$('#trainingAttendance'); if(!box)return; box.innerHTML='';
  if(!app.trainingState.players.length){box.innerHTML='<div class="small">Aucun joueur enregistré pour le moment.</div>';return}
  app.trainingState.players.forEach(p=>{
    const l=document.createElement('label');l.className='check';
    const c=document.createElement('input');c.type='checkbox';c.value=p.id;c.dataset.name=p.display_name;c.checked=true;
    c.onchange=app.renderTrainingExerciseCards;
    l.append(c,document.createTextNode(p.display_name));box.append(l);
  });
};

app.trainingPresentPlayers = function trainingPresentPlayers(){
  return app.$$('#trainingAttendance input:checked').map(c=>({id:c.value,name:c.dataset.name}));
};

// Unsaved-work protection for the session editor. The snapshot projects only
// what a save actually persists, reusing the same field selection as
// packTrainingNotes(). Identifiers regenerated at each opening (block ids,
// exercise localKey) and presentation-only state (expanded, organizer mode) are
// excluded: they change without any user edit and would report false warnings.
app.trainingSessionSnapshot = function trainingSessionSnapshot(){
  app.captureTrainingResultDraft();
  app.captureTrainingPlan();
  app.syncPlanStatExercises();
  const blocks=app.trainingState.planBlocks.map(b=>({
    start:String(b.start||''),
    duration:Math.max(0,Number(b.duration)||0),
    track:b.track||'both',
    title:b.title||'',
    details:b.details||'',
    attention:b.attention||'',
    sourceType:b.sourceType||'free',
    exerciseId:b.sourceType==='library'?(b.exerciseId||null):null,
    collectStats:b.sourceType==='library'&&!!b.collectStats,
    focus:b.sourceType==='library'?(b.focus||null):null,
    draft:!!b.draft
  }));
  // Array order is meaningful: the save persists it as position.
const exercises=[...app.trainingState.sessionExercises]
    .map(ex=>({id:ex.id,focus:app.isDualExercise(ex)?(ex.focus||null):null}));
  const present=app.trainingPresentPlayers().map(p=>String(p.id)).sort();
  // Mirror the persisted result set: exercises x present players, drafts
  // resolved by localKey. Iterating the same pairs as the save keeps the
  // snapshot independent from stale draft entries left by a re-render.
  const results=[];
  app.trainingState.sessionExercises.forEach(ex=>{
    present.forEach(playerId=>{
      const draft=app.getTrainingDraft(ex.localKey,playerId);
      results.push({
        exerciseId:String(ex.id),
        playerId,
        successes:String(draft.successes??''),
        attempts:String(draft.attempts??''),
        value:String(draft.value??''),
        note:String(draft.note??'')
      });
    });
  });
  results.sort((a,b)=>a.exerciseId.localeCompare(b.exerciseId)||a.playerId.localeCompare(b.playerId));
  // A half-typed date must still produce a snapshot instead of throwing inside
  // the leave handler; the raw field is enough to detect the edit.
  const dateField=app.$('#trainingDate').value||'';
  let dateSnapshot=dateField.trim();
  try{dateSnapshot=app.frInputToIso(dateField)||app.isoToFrInput(app.today())}catch(_){}
  return JSON.stringify({
    date:dateSnapshot,
    group:app.$('#trainingGroup').value||'',
    theme:(app.$('#trainingTheme').value||'').trim(),
    duration:app.$('#trainingDuration').value||'',
    notes:app.$('#trainingNotes').value||'',
    planStart:app.normalizePlanTime(app.$('#trainingPlanStart')?.value||''),
    plan:blocks,
    present,
    exercises,
    results
  });
};

app.trainingSessionBaseline = null;

// Baseline is taken after the DOM is populated, and refreshed only after a
// successful save. A failed save must leave the session dirty.
app.markTrainingSessionBaseline = function markTrainingSessionBaseline(){
  app.trainingSessionBaseline=app.trainingSessionSnapshot();
};

app.trainingSessionIsDirty = function trainingSessionIsDirty(){
  if(app.trainingSessionBaseline===null)return false;
  return app.trainingSessionSnapshot()!==app.trainingSessionBaseline;
};

app.confirmTrainingSessionLeave = function confirmTrainingSessionLeave(){
  const popup=app.$('#trainingUnsavedPopup');
  if(!popup)return Promise.resolve(true);
  popup.classList.remove('hidden');
  return new Promise(resolve=>{
    const previousFocus=document.activeElement;
    let settled=false;
    const settle=answer=>{
      if(settled)return;
      settled=true;
      app.$('#trainingUnsavedDiscard').onclick=null;
      app.$('#trainingUnsavedStay').onclick=null;
      app.$('#closeTrainingUnsaved').onclick=null;
      popup.onclick=null;
      document.removeEventListener('keydown',onKeyDown,true);
      if(app.cancelTrainingUnsavedDialog===cancel)app.cancelTrainingUnsavedDialog=null;
      popup.classList.add('hidden');
      // The user accepted the loss: drop the baseline so the replayed navigation
      // is not intercepted again by this very guard.
      if(answer)app.trainingSessionBaseline=null;
      if(previousFocus?.isConnected&&!previousFocus.closest('.hidden'))previousFocus.focus();
      resolve(answer);
    };
    const cancel=()=>settle(false);
    app.cancelTrainingUnsavedDialog=cancel;
    const onKeyDown=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();settle(false);return}
      if(event.key!=='Tab')return;
      const controls=[...popup.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(el=>!el.closest('.hidden'));
      const first=controls[0],last=controls.at(-1);
      if(!popup.contains(document.activeElement)){event.preventDefault();first?.focus();return}
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    };
    app.$('#trainingUnsavedDiscard').onclick=()=>settle(true);
    app.$('#trainingUnsavedStay').onclick=()=>settle(false);
    app.$('#closeTrainingUnsaved').onclick=()=>settle(false);
    popup.onclick=e=>{if(e.target===popup)settle(false)};
    document.addEventListener('keydown',onKeyDown,true);
    app.$('#trainingUnsavedStay')?.focus();
  });
};

// Session editor exits are intercepted in one place rather than per handler,
// so bootstrap.js keeps its wiring and future exits stay covered. Capture phase
// runs before the existing onclick assignments.
const TRAINING_SESSION_EXIT_IDS=new Set(['cancelTraining','trainingBackHome','homeBtn','logout']);

document.addEventListener('click',event=>{
  const box=app.$('#trainingSession');
  if(!box||box.classList.contains('hidden')||!app.trainingSessionIsDirty())return;
  const target=event.target;
  const id=target?.closest?.('[id]')?.id||'';
  const link=target?.closest?.('a[href]');
  if(!TRAINING_SESSION_EXIT_IDS.has(id)&&!link)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  app.confirmTrainingSessionLeave().then(leave=>{
    if(!leave)return;
    // Replay the intended navigation once the user accepted the loss.
    if(id)app.$('#'+id)?.click();
    else link?.click();
  });
},true);

window.addEventListener('beforeunload',event=>{
  if(!app.trainingSessionIsDirty())return;
  event.preventDefault();
  event.returnValue='';
});

app.renderHistoryPlayers = function renderHistoryPlayers(){
  const sel=app.$('#historyPlayer');if(!sel)return;
  const current=sel.value;
  sel.innerHTML='<option value="">— Choisir un joueur —</option>';
  app.trainingState.players.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.display_name;sel.append(o)});
  if([...sel.options].some(o=>o.value===current)) sel.value=current;
};

app.unpackTrainingNotes = function unpackTrainingNotes(raw){
  const text=raw||'';
  const pos=text.lastIndexOf(app.TRAINING_PLAN_MARKER);
  if(pos<0||!text.endsWith(']]')) return {notes:text,plan:[]};
  const encoded=text.slice(pos+app.TRAINING_PLAN_MARKER.length,-2);
  try{
    const parsed=JSON.parse(decodeURIComponent(encoded));
    const plan=Array.isArray(parsed)?parsed.map(b=>({
      ...b,
      // Rétrocompatibilité avec les séances enregistrées avant la persistance du champ draft :
      // les blocs envoyés au brouillon avaient déjà leur heure vidée.
      draft:b?.draft===true||(b?.draft==null&&!String(b?.start||'').trim())
    })):[];
    return {notes:text.slice(0,pos).trimEnd(),plan};
  }catch(_){return {notes:text,plan:[]}}
};

app.packTrainingNotes = function packTrainingNotes(notes,plan){
  const clean=(notes||'').trim();
  const blocks=(plan||[]).map(({id,start,duration,track,title,details,attention,sourceType,exerciseId,collectStats,focus,draft})=>({id,start,duration,track,title,details,attention,sourceType:sourceType||'free',exerciseId:exerciseId||null,collectStats:!!collectStats,focus:focus||null,draft:!!draft}));
  if(!blocks.length)return clean||null;
  return `${clean}${app.TRAINING_PLAN_MARKER}${encodeURIComponent(JSON.stringify(blocks))}]]`;
};

app.normalizePlanTime = function normalizePlanTime(v){
  const m=String(v||'').trim().match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if(!m)return String(v||'').trim();
  const h=Math.max(0,Math.min(23,Number(m[1]))),min=Math.max(0,Math.min(59,Number(m[2]||0)));
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
};

app.planTimeMinutes = function planTimeMinutes(v){
  const m=String(v||'').match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):99999;
};

app.planEndTime = function planEndTime(start,duration){
  const mins=app.planTimeMinutes(start);if(mins===99999)return '';
  const total=(mins+(Number(duration)||0))%(24*60);return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
};

app.trainingTrackLabel = function trainingTrackLabel(t){return t==='court1'?'Terrain 1 (fond)':t==='court2'?'Terrain 2 (entrée)':t==='both'?'Deux terrains / commun':'Autre'};

app.trainingPlanStartValue = function trainingPlanStartValue(){
  const input=app.$('#trainingPlanStart');
  if(input&&app.normalizePlanTime(input.value).match(/^\d{2}:\d{2}$/))return app.normalizePlanTime(input.value);
  const mins=app.trainingState.planBlocks.filter(b=>!b.draft).map(b=>app.planTimeMinutes(b.start)).filter(x=>x!==99999);
  if(mins.length){const m=Math.min(...mins);return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`}
  return '13:30';
};

app.recalculateTrainingPlanTimes = function recalculateTrainingPlanTimes(){
  let base=app.planTimeMinutes(app.trainingPlanStartValue());if(base===99999)base=13*60+30;
  let court1=base,court2=base;
  app.trainingState.planBlocks.forEach(b=>{
    if(b.draft){b.start='';return}
    const d=Math.max(0,Number(b.duration)||0);
    if(b.track==='court1'){b.start=app.minutesToPlanTime(court1);court1+=d}
    else if(b.track==='court2'){b.start=app.minutesToPlanTime(court2);court2+=d}
    else{const start=Math.max(court1,court2);b.start=app.minutesToPlanTime(start);court1=start+d;court2=start+d}
  });
};

app.minutesToPlanTime = function minutesToPlanTime(total){total=((Number(total)||0)%(24*60)+24*60)%(24*60);return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`};

app.seedTrainingPlan27092026 = function seedTrainingPlan27092026(){
  return [
    {start:'13:30',duration:30,track:'both',title:'Échauffement',details:'Échauffement collectif 30 min.',attention:''},
    {start:'14:00',duration:10,track:'both',title:'Glissades',details:'Glissades simples puis à deux sur ligne : un joueur part glisser un ballon presque extérieur, l’autre vient en soutien. 5 min + 5 min max.',attention:''},
    {start:'14:10',duration:5,track:'both',title:'Routine frappes à 2 bras',details:'Routine de frappes à 2 bras.',attention:'Correction si nécessaire, sans allonger le bloc.'},
    {start:'14:15',duration:15,track:'both',title:'Régularité de frappe',details:'Régularité à 4 m à 90°, puis à 7 m droit.',attention:'Chercher d’abord contrôle et trajectoire.'},
    {start:'14:30',duration:20,track:'court1',title:'1v1 — situation de gel',details:'Tester une situation de gel en lançant le ballon à la cellule, éventuellement en mode 4 colonnes. Le frappeur travaille 6 frappes de suite ; possible à deux pour enchaîner. Compter les points marqués et les fautes.',attention:'Format encore à valider : observer si le rythme permet assez de répétitions.'},
    {start:'14:30',duration:20,track:'court2',title:'Frappe 1 bras — apprentissage',details:'Travail / apprentissage de la frappe à 1 bras pour les plus jeunes.',attention:'Garder une structure simple et stable pour les joueurs qui ne maîtrisent pas encore le geste.'},
    {start:'14:50',duration:20,track:'court1',title:'Routine frappe 1 bras',details:'Routine de frappe à 1 bras pour les joueurs qui maîtrisent déjà la base. Possibilité d’introduire des variations de course, de rythme et de préparation.',attention:'Pour les joueurs qui portent le ballon : privilégier un objectif de trajectoire et de longueur, puissance autour de 70–80 %.'},
    {start:'14:50',duration:20,track:'court2',title:'Frappe 1 bras — consolidation',details:'Poursuite de l’apprentissage 1 bras : répétitions simples, distance au ballon et course cohérente.',attention:'Stabiliser les invariants avant d’ajouter beaucoup de variabilité.'},
    {start:'15:10',duration:15,track:'court1',title:'Frappe plus rapide / feinte bras droit–bras gauche',details:'Travail spécifique pour accélérer la frappe et améliorer la feinte bras droit / bras gauche. Sur la frappe bras gauche, tester la consigne de poussée du pied droit.',attention:'La poussée du pied droit est à tester comme contrainte, pas à imposer comme vérité technique. Observer l’effet sur la vitesse et la trajectoire.'},
    {start:'15:10',duration:15,track:'court2',title:'Frappe 1 bras — cible et régularité',details:'Continuer le travail 1 bras avec une cible simple et une intensité contrôlée.',attention:'Donner surtout un feedback externe : zone atteinte, longueur, trajectoire.'},
    {start:'15:25',duration:20,track:'both',title:'1v1 E',details:'Départ du frappeur face au défenseur. Travail sur un quart de terrain. Défenseur placé à plus de 4 m.',attention:'Observer le transfert du travail de frappe vers une vraie situation offensive.'},
    {start:'15:45',duration:25,track:'both',title:'1v1 RG',details:'Tout le monde ne passe pas en défense : volontaires uniquement, pas les juniors. Faire surtout travailler l’attaque : 5 attaques chacun en alternance.',attention:'Priorité à la qualité des répétitions offensives.'},
    {start:'16:10',duration:20,track:'both',title:'1v1 R',details:'Situation 1v1 avec R. Contrainte du R encore à préciser.',attention:'Idée de départ : le R choisit sa position avant le début de l’attaque et la conserve jusqu’au déclenchement de la frappe ; modifier sa position entre les attaques.'}
  ].map(b=>app.newPlanBlock(b));
};

app.newPlanBlock = function newPlanBlock(seed={}){
  return {id:app.newUuid(),start:seed.draft?'':(seed.start||app.trainingPlanStartValue()),duration:seed.duration??10,track:seed.track||'both',title:seed.title||'',details:seed.details||'',attention:seed.attention||'',sourceType:seed.sourceType||'free',exerciseId:seed.exerciseId||null,collectStats:!!seed.collectStats,focus:seed.focus||null,draft:!!seed.draft,expanded:seed.expanded??false};
};

app.planExerciseById = function planExerciseById(id){return app.trainingState.exercises.find(ex=>ex.id===id)||null};

app.planExerciseOptions = function planExerciseOptions(selected=''){
  return '<option value="">— Choisir un exercice —</option>'+app.trainingState.exercises.filter(ex=>ex.active).map(ex=>`<option value="${app.escapeAttr(ex.id)}"${ex.id===selected?' selected':''}>${app.escapeHtml(ex.name)} · ${app.escapeHtml(app.categoryLabel(ex))}</option>`).join('');
};

app.planExerciseDetails = function planExerciseDetails(ex,focus=null){
  if(!ex)return '';
  const parts=[];
  if(ex.description)parts.push(ex.description);
  if(ex.objective)parts.push(`Objectif : ${ex.objective}`);
  if(focus==='attaque'&&ex.attack_instruction)parts.push(ex.attack_instruction);
  if(focus==='defense'&&ex.defense_instruction)parts.push(ex.defense_instruction);
  return parts.join('\n');
};

app.autoGrowPlanTextarea = function autoGrowPlanTextarea(el){
  if(!el)return;
  const grow=()=>{
    el.style.height='auto';
    const minHeight=el.classList.contains('tr-note')?76:132;
    const target=Math.max(minHeight,el.scrollHeight+2);
    el.style.height=`${target}px`;
    el.style.maxHeight='none';
    el.style.overflowY='hidden';
  };
  grow();
  requestAnimationFrame(grow);
};

app.planGeneratedExercise = function planGeneratedExercise(block){return app.trainingState.sessionExercises.find(ex=>ex.fromPlanBlockId===block.id)||null};

app.syncPlanStatExercises = function syncPlanStatExercises(){
  const wanted=new Set();
  app.trainingState.planBlocks.forEach(b=>{
    if(b.draft||b.sourceType!=='library'||!b.exerciseId||!b.collectStats)return;
    const base=app.planExerciseById(b.exerciseId);if(!base)return;
    wanted.add(b.id);
    let sx=app.planGeneratedExercise(b);
    if(!sx){
      sx={...base,focus:app.isDualExercise(base)?(b.focus||null):null,localKey:`plan-${b.id}`,expanded:false,fromPlanBlockId:b.id};
      app.trainingState.sessionExercises.push(sx);
    }else{
      const localKey=sx.localKey,expanded=sx.expanded;
      Object.assign(sx,base,{localKey,expanded,fromPlanBlockId:b.id,focus:app.isDualExercise(base)?(b.focus||null):null});
    }
  });
  app.trainingState.sessionExercises=app.trainingState.sessionExercises.filter(ex=>!ex.fromPlanBlockId||wanted.has(ex.fromPlanBlockId));
};

app.bindLoadedStatsToPlanBlocks = function bindLoadedStatsToPlanBlocks(){
  const used=new Set();
  app.trainingState.planBlocks.forEach(b=>{
    if(b.draft||b.sourceType!=='library'||!b.exerciseId||!b.collectStats)return;
    const sx=app.trainingState.sessionExercises.find(ex=>!used.has(ex.localKey)&&ex.id===b.exerciseId);
    if(sx){sx.fromPlanBlockId=b.id;sx.localKey=`plan-${b.id}`;sx.focus=app.isDualExercise(sx)?(b.focus||sx.focus||null):null;used.add(sx.localKey)}
  });
  app.syncPlanStatExercises();
};

app.captureTrainingPlan = function captureTrainingPlan(){
  app.$$('#trainingPlanTimeline [data-plan-id]').forEach(card=>{
    const b=app.trainingState.planBlocks.find(x=>x.id===card.dataset.planId);if(!b)return;
    b.duration=Math.max(0,Number(card.querySelector('.planDuration')?.value)||0);
    b.track=card.querySelector('.planTrack')?.value||'both';
    b.title=card.querySelector('.planTitle')?.value.trim()||'';
    b.details=card.querySelector('.planDetails')?.value||'';
    b.attention=card.querySelector('.planAttention')?.value||'';
    b.sourceType=card.querySelector('.planSourceType')?.value||'free';
    b.exerciseId=b.sourceType==='library'?(card.querySelector('.planExercise')?.value||null):null;
    b.collectStats=b.sourceType==='library'&&!!card.querySelector('.planCollectStats')?.checked;
    b.focus=card.querySelector('.planFocus')?.value||null;
  });
  app.syncPlanStatExercises();
};

app.addTrainingPlanBlock = function addTrainingPlanBlock(seed={}){app.captureTrainingPlan();app.trainingState.planBlocks.push(app.newPlanBlock(seed));app.recalculateTrainingPlanTimes();app.renderTrainingPlan();};

app.moveTrainingPlanBlock = function moveTrainingPlanBlock(id,delta){app.captureTrainingPlan();const i=app.trainingState.planBlocks.findIndex(x=>x.id===id);const j=i+delta;if(i<0||j<0||j>=app.trainingState.planBlocks.length)return;[app.trainingState.planBlocks[i],app.trainingState.planBlocks[j]]=[app.trainingState.planBlocks[j],app.trainingState.planBlocks[i]];app.recalculateTrainingPlanTimes();app.renderTrainingPlan();};

app.duplicateTrainingPlanBlock = function duplicateTrainingPlanBlock(id){app.captureTrainingPlan();const i=app.trainingState.planBlocks.findIndex(x=>x.id===id);if(i<0)return;const src=app.trainingState.planBlocks[i];app.trainingState.planBlocks.splice(i+1,0,{...src,id:app.newUuid(),expanded:false});app.recalculateTrainingPlanTimes();app.syncPlanStatExercises();app.renderTrainingPlan();app.renderTrainingExerciseCards();};

app.removeTrainingPlanBlock = function removeTrainingPlanBlock(id){app.captureTrainingPlan();app.trainingState.planBlocks=app.trainingState.planBlocks.filter(x=>x.id!==id);app.recalculateTrainingPlanTimes();app.syncPlanStatExercises();app.renderTrainingPlan();app.renderTrainingExerciseCards();};

app.sendTrainingPlanBlockToDraft = function sendTrainingPlanBlockToDraft(id){app.captureTrainingPlan();const b=app.trainingState.planBlocks.find(x=>x.id===id);if(!b)return;b.draft=true;b.start='';app.recalculateTrainingPlanTimes();app.syncPlanStatExercises();app.renderTrainingPlan();app.renderTrainingExerciseCards();};

app.restoreTrainingPlanBlockFromDraft = function restoreTrainingPlanBlockFromDraft(id,track){const b=app.trainingState.planBlocks.find(x=>x.id===id);if(!b)return;b.draft=false;if(track)b.track=track;app.recalculateTrainingPlanTimes();app.syncPlanStatExercises();app.renderTrainingPlan();app.renderTrainingExerciseCards();};

app.reorderTrainingPlanBlock = function reorderTrainingPlanBlock(dragId,targetId,newTrack){
  app.captureTrainingPlan();
  const from=app.trainingState.planBlocks.findIndex(b=>b.id===dragId);if(from<0)return;
  const [item]=app.trainingState.planBlocks.splice(from,1);
  item.draft=false;
  if(newTrack)item.track=newTrack;
  let to=targetId?app.trainingState.planBlocks.findIndex(b=>b.id===targetId):app.trainingState.planBlocks.length;
  if(to<0)to=app.trainingState.planBlocks.length;
  app.trainingState.planBlocks.splice(to,0,item);
  app.recalculateTrainingPlanTimes();app.syncPlanStatExercises();app.renderTrainingPlan();app.renderTrainingExerciseCards();
};

app.trainingPlanOrganizerSelectedBlock = function trainingPlanOrganizerSelectedBlock(){return app.trainingState.planBlocks.find(b=>b.id===app.trainingState.planOrganizerSelectedId)||null};

app.renderTrainingPlanOrganizer = function renderTrainingPlanOrganizer(){
  const panel=app.$('#trainingPlanOrganizer'),button=app.$('#organizeTrainingPlan'),plan=document.querySelector('.trainingPlan');
  if(!panel||!button)return;
  panel.classList.toggle('hidden',!app.trainingState.planOrganizerMode);
  button.textContent=app.trainingState.planOrganizerMode?'Terminer':'Organiser';
  button.classList.toggle('active',app.trainingState.planOrganizerMode);
  button.setAttribute('aria-pressed',String(app.trainingState.planOrganizerMode));
  plan?.classList.toggle('organizerMode',app.trainingState.planOrganizerMode);
  const selected=app.trainingPlanOrganizerSelectedBlock(),label=app.$('#trainingPlanOrganizerSelection'),hint=app.$('#trainingPlanOrganizerHint');

  if(!app.trainingState.planOrganizerMode){
    if(label)label.textContent='Mode organisation';
    if(hint)hint.textContent='Touchez un exercice à déplacer, puis touchez sa nouvelle position.';
    return;
  }

  if(selected){
    const title=selected.title||app.planExerciseById(selected.exerciseId)?.name||'Bloc sans titre';
    if(label)label.textContent=`${title} sélectionné`;
    if(hint)hint.textContent=selected.draft
      ? 'Touchez un exercice du planning pour replacer ce brouillon avant lui.'
      : 'Touchez directement l’exercice devant lequel le déplacer. Touchez à nouveau le même exercice pour annuler.';
  }else{
    if(label)label.textContent='Mode organisation';
    if(hint)hint.textContent='Touchez un exercice à déplacer.';
  }
};

app.setTrainingPlanOrganizerMode = function setTrainingPlanOrganizerMode(enabled){
  app.captureTrainingPlan();app.trainingState.planOrganizerMode=!!enabled;app.trainingState.planOrganizerSelectedId=null;
  if(app.trainingState.planOrganizerMode)app.trainingState.planBlocks.forEach(b=>b.expanded=false);
  app.renderTrainingPlan();
};

app.selectTrainingPlanOrganizerBlock = function selectTrainingPlanOrganizerBlock(id){
  if(!app.trainingState.planOrganizerMode)return;
  const block=app.trainingState.planBlocks.find(b=>b.id===id);if(!block)return;
  const selected=app.trainingPlanOrganizerSelectedBlock();
  if(!selected){app.trainingState.planOrganizerSelectedId=id;app.renderTrainingPlan();return}
  if(selected.id===id){app.trainingState.planOrganizerSelectedId=null;app.renderTrainingPlan();return}
  if(block.draft){app.trainingState.planOrganizerSelectedId=id;app.renderTrainingPlan();return}
  const selectedId=selected.id;app.trainingState.planOrganizerSelectedId=null;app.reorderTrainingPlanBlock(selectedId,id,null);
};

app.renderTrainingPlan = function renderTrainingPlan(){
  const box=app.$('#trainingPlanTimeline');if(!box)return;app.recalculateTrainingPlanTimes();box.innerHTML='';app.renderTrainingPlanOrganizer();
  const coarsePointer=window.matchMedia?.('(pointer: coarse)').matches||false;
  const scheduled=app.trainingState.planBlocks.filter(b=>!b.draft);
  const drafts=app.trainingState.planBlocks.filter(b=>b.draft);
  if(!scheduled.length)box.innerHTML='<div class="trainingPlanEmpty">Aucun bloc placé pour le moment. Ajoute un bloc ou remets un élément du brouillon dans le planning.</div>';
  const groups=[];
  scheduled.forEach(b=>{const index=app.trainingState.planBlocks.indexOf(b);
    let g=groups.find(x=>x.start===b.start);if(!g){g={start:b.start,items:[]};groups.push(g)}g.items.push({b,index});
  });
  groups.sort((a,b)=>app.planTimeMinutes(a.start)-app.planTimeMinutes(b.start));
  groups.forEach(g=>{
    const slot=document.createElement('div');slot.className='trainingTimelineSlot';
    const endTimes=g.items.map(({b})=>app.planEndTime(b.start,b.duration)).filter(Boolean);
    slot.innerHTML=`<div class="trainingTimelineTime">${app.escapeHtml(g.start||'Heure à définir')}${endTimes.length===1&&endTimes[0]?` <span class="small">→ ${app.escapeHtml(endTimes[0])}</span>`:''}</div><div class="trainingTimelineTracks"></div>`;
    const tracks=slot.querySelector('.trainingTimelineTracks');
    g.items.forEach(({b,index})=>{
      const ex=app.planExerciseById(b.exerciseId);
      const libraryMode=b.sourceType==='library';
      const dual=libraryMode&&ex&&app.isDualExercise(ex);
      const statMeta=ex?`${app.measurementLabel(ex.measurement_type)}${app.categoryLabel(ex)?' · '+app.categoryLabel(ex):''}`:'';
      const organizerSelected=app.trainingState.planOrganizerMode&&app.trainingState.planOrganizerSelectedId===b.id;
      const organizerTarget=app.trainingState.planOrganizerMode&&app.trainingState.planOrganizerSelectedId&&app.trainingState.planOrganizerSelectedId!==b.id;
      const card=document.createElement('div');card.className='trainingPlanBlock'+(b.expanded?' expanded':'')+(organizerSelected?' organizerSelected':'')+(organizerTarget?' organizerTarget':'');card.dataset.planId=b.id;card.dataset.track=b.track||'both';
      card.innerHTML=`<div class="trainingPlanBlockHead"><div class="trainingPlanBlockOverview" data-plan-overview role="button" tabindex="0" aria-expanded="${b.expanded?'true':'false'}"><button type="button" class="ghost trainingPlanDragHandle" draggable="true" data-plan-drag title="Maintenir et déplacer">⠿</button><div class="trainingPlanBlockMain"><div class="trainingPlanBlockTitle">${app.escapeHtml(b.title||ex?.name||'Nouveau bloc')}</div><div class="trainingPlanCompactMeta"><span class="trainingTrackTag">${app.escapeHtml(app.trainingTrackLabel(b.track))}</span><span class="trainingPlanMetaTag">${app.escapeHtml(String(b.duration||0))} min</span>${libraryMode?'<span class="trainingPlanMetaTag">Bibliothèque</span>':''}${b.collectStats?'<span class="trainingPlanMetaTag stats">Stats</span>':''}</div></div></div><button type="button" class="ghost trainingPlanToggle" data-plan-toggle title="${b.expanded?'Replier':'Déplier'}" aria-label="${b.expanded?'Replier':'Déplier'}">${b.expanded?'▴':'▾'}</button></div>
      <div class="trainingPlanBlockBody">
      <div class="trainingPlanBlockActions"><button type="button" class="ghost" data-plan-up title="Monter">↑</button><button type="button" class="ghost" data-plan-down title="Descendre">↓</button><button type="button" class="ghost" data-plan-copy>Dupliquer le bloc</button><button type="button" class="ghost" data-plan-draft>Mettre en brouillon</button><button type="button" class="ghost" data-plan-remove>Supprimer</button></div>
      <div class="trainingPlanFields">
       <div class="field"><label>Heure calculée</label><input class="planStart" readonly value="${app.escapeAttr(b.start||'')}"></div>
       <div class="field"><label>Durée (min)</label><input class="planDuration" type="number" min="0" inputmode="numeric" value="${app.escapeAttr(b.duration??'')}"></div>
       <div class="field planTrackField"><label>Terrain</label><select class="planTrack"><option value="both"${b.track==='both'?' selected':''}>Deux terrains / commun</option><option value="court1"${b.track==='court1'?' selected':''}>Terrain 1 (fond)</option><option value="court2"${b.track==='court2'?' selected':''}>Terrain 2 (entrée)</option><option value="other"${b.track==='other'?' selected':''}>Autre / hors terrain</option></select></div>
       <div class="field planTitleField"><label>Nom du bloc</label><input class="planTitle" placeholder="ex. Frappe 1 bras" value="${app.escapeAttr(b.title||'')}"></div>
      </div>
      <div class="trainingPlanLibraryRow">
       <div class="field"><label>Type</label><select class="planSourceType"><option value="free"${!libraryMode?' selected':''}>Bloc libre</option><option value="library"${libraryMode?' selected':''}>Exercice de la bibliothèque</option></select></div>
       <div class="field libraryExerciseField${libraryMode?'':' hidden'}"><label>Exercice de la bibliothèque</label><select class="planExercise">${app.planExerciseOptions(b.exerciseId||'')}</select></div>
      </div>
      <div class="trainingPlanNotes">
       <div class="field trainingPlanNoteField"><label>Contenu / consignes / variantes</label><div class="trainingPlanNoteRead" data-plan-note-read="details" tabindex="0">${b.details?app.escapeHtml(b.details):'<span class="trainingPlanNoteEmpty">Ajouter une note…</span>'}</div><textarea class="planDetails trainingPlanNoteEditor" placeholder="Organisation, répétitions, contraintes, variantes…">${app.escapeHtml(b.details||'')}</textarea><div class="trainingPlanNoteActions"><button type="button" class="ghost" data-plan-note-edit="details">Modifier</button><button type="button" class="ghost hidden" data-plan-note-done="details">Terminer</button></div></div>
       <div class="field trainingPlanNoteField"><label>Encadrement / points d’attention</label><div class="trainingPlanNoteRead" data-plan-note-read="attention" tabindex="0">${b.attention?app.escapeHtml(b.attention):'<span class="trainingPlanNoteEmpty">Ajouter une note…</span>'}</div><textarea class="planAttention trainingPlanNoteEditor" placeholder="Ce que le staff observe, corrections, joueurs concernés…">${app.escapeHtml(b.attention||'')}</textarea><div class="trainingPlanNoteActions"><button type="button" class="ghost" data-plan-note-edit="attention">Modifier</button><button type="button" class="ghost hidden" data-plan-note-done="attention">Terminer</button></div></div>
      </div>
      <div class="trainingPlanStatBox${libraryMode&&ex?'':' hidden'}">
       <div><label class="check"><input type="checkbox" class="planCollectStats"${b.collectStats?' checked':''}> Collecter les statistiques de cet exercice</label><div class="trainingPlanStatMeta">${app.escapeHtml(statMeta||'Mesure définie dans la bibliothèque')}</div></div>
       <div class="trainingPlanStatActions">${dual?`<select class="planFocus"><option value="">Focus…</option><option value="attaque"${b.focus==='attaque'?' selected':''}>Attaque</option><option value="defense"${b.focus==='defense'?' selected':''}>Défense</option></select>`:''}${b.collectStats?'<button type="button" class="ghost" data-plan-results>↓ Saisir les résultats</button>':''}</div>
      </div>
      </div>`;
      const togglePlanBlock=()=>{app.captureTrainingPlan();b.expanded=!b.expanded;app.renderTrainingPlan()};
      card.querySelector('[data-plan-toggle]').onclick=e=>{e.stopPropagation();if(app.trainingState.planOrganizerMode){app.selectTrainingPlanOrganizerBlock(b.id);return}togglePlanBlock()};
      const overview=card.querySelector('[data-plan-overview]');
      overview.onclick=e=>{if(e.target.closest('button,input,select,textarea,a'))return;if(app.trainingState.planOrganizerMode){app.selectTrainingPlanOrganizerBlock(b.id);return}togglePlanBlock()};
      overview.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&!e.target.closest('button,input,select,textarea,a')){e.preventDefault();if(app.trainingState.planOrganizerMode)app.selectTrainingPlanOrganizerBlock(b.id);else togglePlanBlock()}};
      card.querySelector('[data-plan-up]').disabled=index===0;card.querySelector('[data-plan-down]').disabled=index===app.trainingState.planBlocks.length-1;
      card.querySelector('[data-plan-up]').onclick=()=>app.moveTrainingPlanBlock(b.id,-1);card.querySelector('[data-plan-down]').onclick=()=>app.moveTrainingPlanBlock(b.id,1);card.querySelector('[data-plan-copy]').onclick=()=>app.duplicateTrainingPlanBlock(b.id);card.querySelector('[data-plan-draft]').onclick=()=>app.sendTrainingPlanBlockToDraft(b.id);card.querySelector('[data-plan-remove]').onclick=()=>{if(confirm('Supprimer définitivement ce bloc ?'))app.removeTrainingPlanBlock(b.id)};
      card.querySelector('.planSourceType').onchange=e=>{app.captureTrainingPlan();b.sourceType=e.target.value;b.exerciseId=b.sourceType==='library'?b.exerciseId:null;b.collectStats=b.sourceType==='library'?b.collectStats:false;app.renderTrainingPlan();app.renderTrainingExerciseCards()};
      const exSel=card.querySelector('.planExercise');if(exSel)exSel.onchange=e=>{app.captureTrainingPlan();const prev=b.exerciseId;b.exerciseId=e.target.value||null;const chosen=app.planExerciseById(b.exerciseId);if(chosen){if(!b.title||b.title===app.planExerciseById(prev)?.name)b.title=chosen.name;if(!b.details)b.details=app.planExerciseDetails(chosen,b.focus)}else{b.collectStats=false;b.focus=null}app.syncPlanStatExercises();app.renderTrainingPlan();app.renderTrainingExerciseCards()};
      const collect=card.querySelector('.planCollectStats');if(collect)collect.onchange=e=>{app.captureTrainingPlan();b.collectStats=!!e.target.checked;app.syncPlanStatExercises();app.renderTrainingPlan();app.renderTrainingExerciseCards()};
      const focus=card.querySelector('.planFocus');if(focus)focus.onchange=e=>{app.captureTrainingPlan();b.focus=e.target.value||null;app.syncPlanStatExercises();app.renderTrainingPlan();app.renderTrainingExerciseCards()};
      card.querySelector('[data-plan-results]')?.addEventListener('click',()=>{app.syncPlanStatExercises();app.renderTrainingExerciseCards();const target=document.querySelector(`[data-exercise-card="plan-${b.id}"]`);if(target){const ex=app.planGeneratedExercise(b);if(ex)ex.expanded=true;app.renderTrainingExerciseCards();document.querySelector(`[data-exercise-card="plan-${b.id}"]`)?.scrollIntoView({behavior:'smooth',block:'center'})}});
      card.querySelectorAll('.planDuration,.planTrack,.planTitle').forEach(el=>{el.onchange=()=>{app.captureTrainingPlan();app.recalculateTrainingPlanTimes();app.renderTrainingPlan();app.renderTrainingExerciseCards()}});
      card.querySelectorAll('.planDetails,.planAttention').forEach(el=>{app.autoGrowPlanTextarea(el);el.addEventListener('input',()=>{const target=app.trainingState.planBlocks.find(x=>x.id===b.id);if(!target)return;const key=el.classList.contains('planDetails')?'details':'attention';target[key]=el.value;const read=card.querySelector(`[data-plan-note-read="${key}"]`);if(read)read.innerHTML=el.value?app.escapeHtml(el.value):'<span class="trainingPlanNoteEmpty">Ajouter une note…</span>';app.autoGrowPlanTextarea(el)});el.addEventListener('change',app.captureTrainingPlan)});
      const tabletNotes=window.matchMedia?.('(pointer: coarse)').matches||window.innerWidth<=1024;
      card.querySelectorAll('[data-plan-note-edit]').forEach(btn=>{const key=btn.dataset.planNoteEdit;const field=btn.closest('.trainingPlanNoteField');const editor=field?.querySelector(key==='details'?'.planDetails':'.planAttention');const read=field?.querySelector('[data-plan-note-read]');const done=field?.querySelector('[data-plan-note-done]');const startEdit=()=>{if(!field||!editor)return;field.classList.add('editing');read?.classList.add('hidden');btn.classList.add('hidden');done?.classList.remove('hidden');app.autoGrowPlanTextarea(editor);editor.focus()};btn.addEventListener('click',startEdit);read?.addEventListener('click',()=>{if(tabletNotes)startEdit()});read?.addEventListener('keydown',e=>{if(tabletNotes&&(e.key==='Enter'||e.key===' ')){e.preventDefault();startEdit()}});done?.addEventListener('click',()=>{app.captureTrainingPlan();field.classList.remove('editing');read?.classList.remove('hidden');btn.classList.remove('hidden');done.classList.add('hidden');editor.blur()})});
      const dragHandle=card.querySelector('[data-plan-drag]');
      if(dragHandle)dragHandle.draggable=!app.trainingState.planOrganizerMode&&!coarsePointer;
      dragHandle?.addEventListener('dragstart',e=>{if(app.trainingState.planOrganizerMode||coarsePointer){e.preventDefault();return}app.captureTrainingPlan();card.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',b.id)});
      dragHandle?.addEventListener('dragend',()=>{card.classList.remove('dragging');box.classList.remove('drag-over')});
      tracks.append(card);
    });
    box.append(slot);
  });
  const draftBox=app.$('#trainingPlanDraft');
  if(draftBox){
    draftBox.innerHTML='';
    if(!drafts.length)draftBox.innerHTML='<div class="trainingDraftEmpty">Aucun élément en brouillon. Tu peux y envoyer un bloc avec « Mettre en brouillon », via « Organiser », ou en le faisant glisser ici sur ordinateur.</div>';
    drafts.forEach(b=>{
      const ex=app.planExerciseById(b.exerciseId);
      const organizerSelected=app.trainingState.planOrganizerMode&&app.trainingState.planOrganizerSelectedId===b.id;
      const card=document.createElement('div');card.className='trainingDraftCard'+(organizerSelected?' organizerSelected':'');card.dataset.planId=b.id;card.draggable=!app.trainingState.planOrganizerMode&&!coarsePointer;
      const preview=(b.details||b.attention||'').trim();
      card.innerHTML=`<div class="trainingDraftCardTitle">${app.escapeHtml(b.title||ex?.name||'Bloc sans titre')}</div><div class="trainingDraftCardMeta">${app.escapeHtml(b.sourceType==='library'&&ex?'Bibliothèque · '+ex.name:'Bloc libre')} · ${app.escapeHtml(app.trainingTrackLabel(b.track))} · ${app.escapeHtml(String(b.duration||0))} min</div>${preview?`<div class="trainingDraftCardText">${app.escapeHtml(preview)}</div>`:''}<div class="trainingDraftCardActions"><button type="button" class="primary" data-draft-restore>Remettre dans le planning</button><button type="button" class="ghost" data-draft-copy>Dupliquer</button><button type="button" class="ghost" data-draft-remove>Supprimer</button></div>`;
      card.querySelector('[data-draft-restore]').onclick=()=>app.restoreTrainingPlanBlockFromDraft(b.id,b.track);
      card.querySelector('[data-draft-copy]').onclick=()=>{const i=app.trainingState.planBlocks.findIndex(x=>x.id===b.id);if(i<0)return;app.trainingState.planBlocks.splice(i+1,0,{...b,id:app.newUuid(),draft:true,start:''});app.renderTrainingPlan()};
      card.querySelector('[data-draft-remove]').onclick=()=>{if(confirm('Supprimer définitivement ce brouillon ?'))app.removeTrainingPlanBlock(b.id)};
      card.addEventListener('click',e=>{if(app.trainingState.planOrganizerMode&&!e.target.closest('button,input,select,textarea,a'))app.selectTrainingPlanOrganizerBlock(b.id)});
      card.addEventListener('dragstart',e=>{if(app.trainingState.planOrganizerMode||coarsePointer){e.preventDefault();return}card.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',b.id)});
      card.addEventListener('dragend',()=>card.classList.remove('dragging'));
      draftBox.append(card);
    });
    draftBox.ondragover=e=>{e.preventDefault();draftBox.classList.add('drag-over');if(e.dataTransfer)e.dataTransfer.dropEffect='move'};
    draftBox.ondragleave=e=>{if(!draftBox.contains(e.relatedTarget))draftBox.classList.remove('drag-over')};
    draftBox.ondrop=e=>{e.preventDefault();draftBox.classList.remove('drag-over');const id=e.dataTransfer?.getData('text/plain');if(id)app.sendTrainingPlanBlockToDraft(id)};
  }
  box.ondragover=e=>{e.preventDefault();box.classList.add('drag-over');if(e.dataTransfer)e.dataTransfer.dropEffect='move'};
  box.ondragleave=e=>{if(!box.contains(e.relatedTarget))box.classList.remove('drag-over')};
  box.ondrop=e=>{
    e.preventDefault();box.classList.remove('drag-over');
    const dragId=e.dataTransfer?.getData('text/plain');if(!dragId)return;
    const rect=box.getBoundingClientRect(),ratio=(e.clientX-rect.left)/Math.max(1,rect.width);
    const newTrack=ratio<0.38?'court1':ratio>0.62?'court2':'both';
    const cards=[...box.querySelectorAll('.trainingPlanBlock:not(.dragging)')];
    let targetId=null,best=Infinity;
    cards.forEach(c=>{const r=c.getBoundingClientRect(),d=Math.abs(e.clientY-(r.top+r.height/2));if(d<best){best=d;targetId=c.dataset.planId}});
    app.reorderTrainingPlanBlock(dragId,targetId,newTrack);
  };
};

app.setTrainingSaveLabels = function setTrainingSaveLabels(text){
  app.$$('#saveTrainingSessionHead,#saveTrainingSession').forEach(button=>{button.textContent=text});
};

app.startNewTraining = async function startNewTraining(){
  if(!app.trainingState.exercises.length)await app.fetchTrainingExercises();
  app.trainingState.sessionExercises=[];
  app.trainingState.planBlocks=[];
  app.trainingState.currentSessionId=null;
  app.trainingState.resultDraft={};
  app.trainingState.planOrganizerMode=false;app.trainingState.planOrganizerSelectedId=null;
  app.setTrainingSaveLabels('Enregistrer la séance');
  if(!app.groupState.groups.length)await app.fetchMyGroups();
  if(!app.groupState.groups.length){
    alert('Crée ou rejoins d’abord un groupe dans le volet Groupes.');
    return;
  }
  app.$('#trainingDate').value=app.isoToFrInput(app.today());
  app.$('#trainingTheme').value='';
  app.$('#trainingDuration').value='';
  app.$('#trainingNotes').value='';
  app.autoGrowPlanTextarea(app.$('#trainingNotes'));
  app.trainingState.planBlocks=[];
  if(app.$('#trainingPlanStart'))app.$('#trainingPlanStart').value='13:30';
  app.syncPlanStatExercises();
  app.$('#trainingSaveStatus').textContent='';
  app.$('#trainingGroup').value=app.groupState.groups[0]?.id||'';
  await app.fetchTrainingPlayers(app.$('#trainingGroup').value||null);
  if(app.$('#trainingAttendancePreset'))app.$('#trainingAttendancePreset').value='';
  if(app.$('#trainingAttendancePresetStatus'))app.$('#trainingAttendancePresetStatus').textContent='';
  app.$$('#trainingAttendance input').forEach(c=>c.checked=true);
  app.renderTrainingExerciseCards();
  app.renderTrainingPlan();
  app.hideMainModules();app.setMatchHeaderMode(false);app.$('#trainingSession').classList.remove('hidden');window.scrollTo({top:0,behavior:'instant'});
  app.markTrainingSessionBaseline();
};

app.focusLabel = function focusLabel(f){return f==='attaque'?'Attaque':f==='defense'?'Défense':''};

app.focusInstruction = function focusInstruction(ex){
  if(ex.focus==='attaque') return ex.attack_instruction||'';
  if(ex.focus==='defense') return ex.defense_instruction||'';
  return '';
};

app.updateExistingExerciseFocusUI = function updateExistingExerciseFocusUI(){
  const ex=app.trainingState.exercises.find(x=>x.id===app.$('#trainingExerciseSelect').value);
  const dual=app.isDualExercise(ex);
  app.$('#trainingExerciseFocusWrap').classList.toggle('hidden',!dual);
  if(!dual) app.$('#trainingExerciseFocus').value='';
};

app.updateCreateDualUI = function updateCreateDualUI(){
  const dual=!!app.categoryById(app.$('#exerciseCreateCategory').value)?.is_dual_focus;
  app.$('#exerciseCreateDualFields').classList.toggle('hidden',!dual);
  const needSessionFocus=dual && app.trainingState.exerciseCreateTarget==='session';
  app.$('#exerciseCreateSessionFocusWrap').classList.toggle('hidden',!needSessionFocus);
  if(!needSessionFocus) app.$('#exerciseCreateSessionFocus').value='';
};

app.updateEditDualUI = function updateEditDualUI(){
  const dual=!!app.categoryById(app.$('#exerciseEditCategory').value)?.is_dual_focus;
  app.$('#exerciseEditDualFields').classList.toggle('hidden',!dual);
};

app.measurementLabel = function measurementLabel(t){
  return ({success_attempts:'Réussites / tentatives',count:'Nombre',time_seconds:'Temps (s)',distance:'Distance',score:'Score',rating_5:'Note / 5',rating_10:'Note / 10'})[t]||t;
};

app.collapseAllTrainingExercises = function collapseAllTrainingExercises(exceptKey=null){
  app.trainingState.sessionExercises.forEach(ex=>{
    const keep=exceptKey && ex.localKey===exceptKey;
    ex.expanded=!!keep;
    const card=document.querySelector(`[data-exercise-card="${ex.localKey}"]`);
    if(!card)return;
    card.querySelector('.trainingResults')?.classList.toggle('hidden',!keep);
    card.querySelector('[data-close]')?.classList.toggle('hidden',!keep);
  });
};

app.addSessionExercise = function addSessionExercise(ex,focus=null){
  app.trainingState.sessionExercises.push({...ex,focus:app.isDualExercise(ex)?focus:null,localKey:app.newUuid(),expanded:false});
  app.renderTrainingExerciseCards();
};

app.removeSessionExercise = function removeSessionExercise(key){app.trainingState.sessionExercises=app.trainingState.sessionExercises.filter(x=>x.localKey!==key);app.renderTrainingExerciseCards()};

app.trainingDraftKey = function trainingDraftKey(exKey,playerId){return `${exKey}__${playerId}`};

app.captureTrainingResultDraft = function captureTrainingResultDraft(){
  app.$$('.resultRow').forEach(row=>{
    const exKey=row.dataset.exercise,playerId=row.dataset.player;
    if(!exKey||!playerId)return;
    const key=app.trainingDraftKey(exKey,playerId);
    app.trainingState.resultDraft[key]={
      successes:row.querySelector('.tr-success')?.value ?? '',
      attempts:row.querySelector('.tr-attempts')?.value ?? '',
      value:row.querySelector('.tr-value')?.value ?? '',
      note:row.querySelector('.tr-note')?.value ?? ''
    };
  });
};

app.getTrainingDraft = function getTrainingDraft(exKey,playerId){
  return app.trainingState.resultDraft[app.trainingDraftKey(exKey,playerId)]||{successes:'',attempts:'',value:'',note:''};
};

app.resultInputsHtml = function resultInputsHtml(ex,p){
  const key=app.escapeAttr(`${ex.localKey}__${p.id}`);
  const d=app.getTrainingDraft(ex.localKey,p.id);
  if(ex.measurement_type==='success_attempts') return `<div class="miniGrid"><div><label>Réussites</label><input class="tr-success" data-key="${key}" type="number" min="0" inputmode="numeric" value="${app.escapeAttr(d.successes)}"></div><div><label>Tentatives</label><input class="tr-attempts" data-key="${key}" type="number" min="0" inputmode="numeric" value="${app.escapeAttr(d.attempts)}"></div></div>`;
  let max=''; if(ex.measurement_type==='rating_5')max=' max="5"';if(ex.measurement_type==='rating_10')max=' max="10"';
  return `<label>${app.escapeHtml(app.measurementLabel(ex.measurement_type))}</label><input class="tr-value" data-key="${key}" type="number" step="any" inputmode="decimal"${max} value="${app.escapeAttr(d.value)}">`;
};

app.renderTrainingExerciseCards = function renderTrainingExerciseCards(){
  app.captureTrainingResultDraft();
  const box=app.$('#trainingExerciseCards');if(!box)return;box.innerHTML='';
  const present=app.trainingPresentPlayers();
  if(!app.trainingState.sessionExercises.length){box.innerHTML='<div class="small">Ajoute au moins un exercice à la séance.</div>';return}
  app.trainingState.sessionExercises.forEach((ex,idx)=>{
    if(typeof ex.expanded!=='boolean') ex.expanded=false;
    const card=document.createElement('div');
    card.className='trainingCard';
    card.dataset.exerciseCard=ex.localKey;
    card.innerHTML=`
      <div class="row trainingExerciseHeader" style="justify-content:space-between;align-items:flex-start;gap:8px;cursor:pointer">
        <div style="min-width:0;flex:1">
          <h3>${idx+1}. ${app.escapeHtml(ex.name)}</h3>
          <div class="small">${app.escapeHtml(app.categoryLabel(ex))} · ${app.escapeHtml(app.measurementLabel(ex.measurement_type))}${ex.objective?' · '+app.escapeHtml(ex.objective):''}</div>
          ${app.isDualExercise(ex)?`<div class="small" style="margin-top:5px"><strong>Focus : ${app.escapeHtml(app.focusLabel(ex.focus)||'à choisir')}</strong>${app.focusInstruction(ex)?' · '+app.escapeHtml(app.focusInstruction(ex)):''}</div>`:''}
          <div class="small" style="margin-top:5px">${present.length} joueur${present.length>1?'s':''} présent${present.length>1?'s':''}</div>
        </div>
        <div class="row" style="gap:6px;flex:0 0 auto">
          <button class="ghost${ex.expanded?'':' hidden'}" data-close="${ex.localKey}" aria-label="Fermer l’exercice">×</button>
          <button class="ghost" data-remove="${ex.localKey}">Retirer</button>
        </div>
      </div>
      <div class="trainingResults${ex.expanded?'':' hidden'}">
        ${app.isDualExercise(ex)?`<div class="field" style="margin-bottom:10px">
          <label>Focus de l’exercice dans cette séance</label>
          <select class="sessionExerciseFocus">
            <option value="">— Choisir —</option>
            <option value="attaque"${ex.focus==='attaque'?' selected':''}>Attaque</option>
            <option value="defense"${ex.focus==='defense'?' selected':''}>Défense</option>
          </select>
        </div>`:''}
      </div>`;
    const rb=card.querySelector('.trainingResults');
    const closeBtn=card.querySelector('[data-close]');
    const removeBtn=card.querySelector('[data-remove]');
    const header=card.querySelector('.trainingExerciseHeader');
    const focusSelect=card.querySelector('.sessionExerciseFocus');
    if(focusSelect){
      focusSelect.onclick=ev=>ev.stopPropagation();
      focusSelect.onchange=ev=>{
        ev.stopPropagation();
        ex.focus=focusSelect.value||null;
        const summary=card.querySelector('.trainingExerciseHeader .small:nth-of-type(2)');
        app.renderTrainingExerciseCards();
      };
    }

    header.onclick=(ev)=>{
      if(ev.target.closest('[data-close]')||ev.target.closest('[data-remove]')) return;
      app.collapseAllTrainingExercises(ex.localKey);
    };

    closeBtn.onclick=(ev)=>{
      ev.stopPropagation();
      app.collapseAllTrainingExercises();
    };

    removeBtn.onclick=(ev)=>{
      ev.stopPropagation();
      app.removeSessionExercise(ex.localKey);
    };

    if(!present.length) rb.insertAdjacentHTML('beforeend','<div class="small">Sélectionne au moins un joueur présent.</div>');
    present.forEach(p=>{
      const row=document.createElement('div');row.className='resultRow';row.dataset.exercise=ex.localKey;row.dataset.player=p.id;
      const draft=app.getTrainingDraft(ex.localKey,p.id);
      row.innerHTML=`<div class="name">${app.escapeHtml(p.name)}</div>${app.resultInputsHtml(ex,p)}<div class="trainingResultNoteField"><label>Note facultative</label><textarea class="tr-note" rows="2" placeholder="Observation, correction, point d’attention…">${app.escapeHtml(draft.note||'')}</textarea></div>`;
      const noteEl=row.querySelector('.tr-note');
      if(noteEl){
        app.autoGrowPlanTextarea(noteEl);
        noteEl.addEventListener('input',()=>app.autoGrowPlanTextarea(noteEl));
        noteEl.addEventListener('focus',()=>app.autoGrowPlanTextarea(noteEl));
      }
      rb.append(row);
    });

    box.append(card);
  });
};

app.renderExerciseLibrary = function renderExerciseLibrary(){
  const box=app.$('#exerciseLibraryList');if(!box)return;
  const q=(app.$('#exerciseLibrarySearch')?.value||'').trim().toLowerCase();
  const category=app.$('#exerciseLibraryCategory')?.value||'';
  const filter=app.$('#exerciseLibraryActive').value;
  const filtered=app.trainingState.exercises.filter(ex=>{
    if(filter==='active'&&!ex.active)return false;
    if(filter==='archived'&&ex.active)return false;
    const hay=[ex.name,app.categoryLabel(ex),ex.description,ex.objective,ex.attack_instruction,ex.defense_instruction]
      .filter(Boolean).join(' ').toLowerCase();
    if(q && !hay.includes(q)) return false;
    if(category && ex.category_id!==category) return false;
    return true;
  });

  const count=app.$('#exerciseLibraryCount');
  if(count) count.textContent=`${filtered.length} exercice${filtered.length>1?'s':''} affiché${filtered.length>1?'s':''} sur ${app.trainingState.exercises.length}`;

  box.innerHTML='';
  if(!app.trainingState.exercises.length){
    box.innerHTML='<div class="small">Aucun exercice dans la bibliothèque pour le moment.</div>';
    return;
  }
  if(!filtered.length){
    box.innerHTML='<div class="small">Aucun exercice ne correspond à ces critères.</div>';
    return;
  }

  filtered.forEach(ex=>{
    const d=document.createElement('div');
    d.className='exerciseLibraryCard';
    d.innerHTML=`<div class="exerciseLibraryMain">
      <div class="exerciseLibraryInfo">
        <div class="exerciseLibraryTitle">${app.statsEscape(ex.name)}${ex.active?'':'<span class="exerciseArchivedTag">Archivé</span>'}</div>
        <div class="exerciseLibraryMeta">${app.statsEscape(app.categoryLabel(ex))} · ${app.statsEscape(app.measurementLabel(ex.measurement_type))}</div>
        ${ex.objective?`<div class="exerciseLibraryObjective" title="${app.statsEscape(ex.objective)}">${app.statsEscape(ex.objective)}</div>`:''}
      </div>
      <div class="exerciseLibraryActions">
        <button class="ghost" data-ex-edit="${ex.id}">Modifier</button>
        <button class="ghost" data-ex-duplicate="${ex.id}">Dupliquer</button>
        <button class="ghost" data-ex-lifecycle="${ex.id}">${ex.active?'Supprimer / Archiver':'Réactiver'}</button>
      </div>
    </div>`;

    d.querySelector('[data-ex-edit]').onclick=ev=>{
      ev.stopPropagation();
      app.openExerciseEditPopup(ex.id).catch(e=>app.handleError('editExercise',e));
    };
    d.querySelector('[data-ex-duplicate]').onclick=ev=>{
      ev.stopPropagation();
      app.duplicateSharedExercise(ex.id).catch(e=>app.handleError('duplicateExercise',e));
    };
    d.querySelector('[data-ex-lifecycle]').onclick=ev=>{
      ev.stopPropagation();
      app.changeExerciseLifecycleFromLibrary(ex.id).catch(e=>app.handleError('exerciseLifecycle',e));
    };

    d.onclick=()=>app.openExerciseEditPopup(ex.id).catch(e=>app.handleError('editExercise',e));
    box.append(d);
  });
};

app.duplicateSharedExercise = async function duplicateSharedExercise(exerciseId){
  const ex=app.trainingState.exercises.find(x=>x.id===exerciseId);
  if(!ex)return;

  await app.fetchExerciseCategories();
  const sourceCategory=app.exerciseCategory(ex);
  if(!sourceCategory)throw new Error('La catégorie de l’exercice source est introuvable.');
  const {data:created,error}=await app.db.from('exercises').insert({
    name:(ex.name||'')+' - copie',
    category_id:sourceCategory.id,
    copied_from_exercise_id:ex.id,
    measurement_type:ex.measurement_type||'success_attempts',
    description:ex.description||null,
    objective:ex.objective||null,
    attack_instruction:ex.attack_instruction||null,
    defense_instruction:ex.defense_instruction||null,
    active:true,
    created_by:app.currentUser?.id||null
  }).select('id,name,category,category_id,copied_from_exercise_id,measurement_type,description,objective,attack_instruction,defense_instruction,created_by,created_at,updated_by,updated_at').single();

  if(error)throw error;

  await app.fetchTrainingExercises();

  await app.openExerciseEditPopup(created.id);

};

app.fetchExerciseUsage = async function fetchExerciseUsage(exerciseId){
  const {data,error}=await app.db.rpc('get_exercise_usage',{p_exercise_id:exerciseId});
  if(error)throw error;
  if(!data)throw new Error('Impossible de vérifier l’utilisation de cet exercice.');
  return data;
};

app.changeExerciseLifecycleFromLibrary = async function changeExerciseLifecycleFromLibrary(exerciseId){
  const ex=app.trainingState.exercises.find(x=>x.id===exerciseId);
  if(!ex)return;

  if(!ex.active){
    if(!confirm(`Réactiver « ${ex.name} » ?`))return;
    const {error}=await app.db.from('exercises').update({active:true}).eq('id',exerciseId).select('id').single();
    if(error)throw error;
  }else{
    const usage=await app.fetchExerciseUsage(exerciseId);
    if(!usage.used){
      if(!confirm(`Supprimer définitivement « ${ex.name} » ?\n\nCet exercice n’a jamais été utilisé dans une séance.`))return;
      const {error}=await app.db.from('exercises').delete().eq('id',exerciseId).select('id').single();
      if(error){
        if(error.code==='23503')throw new Error('Cet exercice vient d’être utilisé. Recharge la bibliothèque pour l’archiver.');
        throw error;
      }
      app.trainingState.sessionExercises=app.trainingState.sessionExercises.filter(x=>x.id!==exerciseId);
    }else{
      if(!confirm(`Archiver « ${ex.name} » ?\n\nIl ne sera plus proposé pour les nouvelles séances, mais restera visible dans l’historique et les statistiques.`))return;
      const {error}=await app.db.from('exercises').update({active:false}).eq('id',exerciseId).select('id').single();
      if(error)throw error;
      app.trainingState.sessionExercises.forEach(x=>{if(x.id===exerciseId)x.active=false});
    }
  }

  await app.fetchTrainingExercises();
  app.renderTrainingExerciseCards();
};

app.changeExerciseLifecycle = async function changeExerciseLifecycle(reactivate=false){
  const id=app.trainingState.editingExerciseId;
  const ex=app.trainingState.exercises.find(x=>x.id===id);
  if(!ex)return;
  const status=app.$('#exerciseEditStatus');
  const controls=app.$$('#exerciseEditPopup button');
  controls.forEach(b=>b.disabled=true);
  try{
    // Refresh before deletion: usage may have changed since opening the popup.
    const usage=await app.fetchExerciseUsage(id);
    if(!reactivate&&!usage.used){
      if(!confirm(`Supprimer définitivement « ${ex.name} » ? Cet exercice n’a aucune utilisation enregistrée.`))return;
      const {error}=await app.db.from('exercises').delete().eq('id',id).select('id').single();
      if(error){
        if(error.code==='23503')throw new Error('Cet exercice vient d’être utilisé. Rouvre sa fiche pour l’archiver.');
        throw error;
      }
      app.trainingState.sessionExercises=app.trainingState.sessionExercises.filter(x=>x.id!==id);
    }else{
      if(!reactivate && ex.active){
        if(!confirm(`Archiver « ${ex.name} » ?\n\nIl ne sera plus proposé pour les nouvelles séances, mais restera visible dans les anciennes séances et les statistiques.`))return;
      }
      const {error}=await app.db.from('exercises').update({active:reactivate}).eq('id',id).select('id').single();
      if(error)throw error;
      app.trainingState.sessionExercises.forEach(x=>{if(x.id===id)x.active=reactivate});
    }
    await app.fetchTrainingExercises();
    app.renderTrainingExerciseCards();
    app.closeExerciseEditPopup();
  }catch(e){status.textContent=e.message||String(e);status.className='authStatus cloudErr'}
  finally{controls.forEach(b=>b.disabled=false)}
};

app.openExerciseEditPopup = async function openExerciseEditPopup(exerciseId){
  const ex=app.trainingState.exercises.find(x=>x.id===exerciseId);
  if(!ex)return;
  app.trainingState.editingExerciseId=exerciseId;
  app.trainingState.editingExerciseMeasureLocked=false;

  app.$('#exerciseEditName').value=ex.name||'';
  await app.fetchExerciseCategories();
  app.populateCategorySelect(app.$('#exerciseEditCategory'),{selected:ex.category_id,includeArchivedId:ex.category_id});
  app.$('#exerciseEditMeasure').value=ex.measurement_type||'success_attempts';
  app.$('#exerciseEditDescription').value=ex.description||'';
  app.$('#exerciseEditObjective').value=ex.objective||'';
  app.$('#exerciseEditAttackInstruction').value=ex.attack_instruction||'';
  app.$('#exerciseEditDefenseInstruction').value=ex.defense_instruction||'';
  const archivedCopy=!!ex.copied_from_exercise_id&&!app.exerciseCategory(ex)?.active;
  app.$('#exerciseEditStatus').textContent=archivedCopy?'Cette copie conserve une catégorie archivée. Choisis une catégorie active avant d’enregistrer des modifications. Tu peux fermer sans modifier la copie.':'';
  app.$('#exerciseEditStatus').className='authStatus '+(archivedCopy?'cloudErr':'');

  const usage=await app.fetchExerciseUsage(exerciseId);
  app.$('#exerciseLifecycleAction').textContent=usage.used?'Archiver':'Supprimer';
  app.$('#exerciseLifecycleAction').classList.toggle('hidden',!ex.active&&usage.used);
  app.$('#reactivateExercise').classList.toggle('hidden',!!ex.active);
  app.trainingState.editingExerciseMeasureLocked=usage.has_results;
  app.$('#exerciseEditMeasure').disabled=app.trainingState.editingExerciseMeasureLocked;
  app.$('#exerciseEditMeasureLock').classList.toggle('hidden',!app.trainingState.editingExerciseMeasureLocked);

  app.updateEditDualUI();
  app.$('#exerciseEditPopup').classList.remove('hidden');
  app.resetPopupScroll('#exerciseEditPopup');
};

app.closeExerciseEditPopup = function closeExerciseEditPopup(){
  app.trainingState.editingExerciseId=null;
  app.trainingState.editingExerciseMeasureLocked=false;
  app.$('#exerciseEditMeasure').disabled=false;
  app.$('#exerciseEditMeasureLock').classList.add('hidden');
  app.$('#exerciseEditPopup').classList.add('hidden');
};

app.saveExerciseEdits = async function saveExerciseEdits(){
  const id=app.trainingState.editingExerciseId;
  if(!id)return;
  const status=app.$('#exerciseEditStatus');
  const name=app.$('#exerciseEditName').value.trim();
  if(!name){status.textContent='Renseigne le nom de l’exercice.';status.className='authStatus cloudErr';return}
  const dual=!!app.categoryById(app.$('#exerciseEditCategory').value)?.is_dual_focus;
  status.textContent='Enregistrement…';status.className='authStatus';
  const current=app.trainingState.exercises.find(x=>x.id===id);
  const payload={
    name,
    category_id:app.requireCategory(app.$('#exerciseEditCategory').value,current?.copied_from_exercise_id?null:current?.category_id).id,
    measurement_type:app.trainingState.editingExerciseMeasureLocked?(current?.measurement_type||'success_attempts'):app.$('#exerciseEditMeasure').value,
    description:app.$('#exerciseEditDescription').value.trim()||null,
    objective:app.$('#exerciseEditObjective').value.trim()||null,
    attack_instruction:dual?(app.$('#exerciseEditAttackInstruction').value.trim()||null):null,
    defense_instruction:dual?(app.$('#exerciseEditDefenseInstruction').value.trim()||null):null
  };
  const {error}=await app.db.from('exercises').update(payload).eq('id',id).select('id').single();
  if(error)throw error;
  app.trainingState.sessionExercises.forEach(ex=>{if(ex.id===id)Object.assign(ex,payload)});
  await app.fetchTrainingExercises();
  app.renderTrainingExerciseCards();
  app.closeExerciseEditPopup();
};

app.duplicateCurrentExercise = async function duplicateCurrentExercise(){
  const id=app.trainingState.editingExerciseId;
  if(!id)return;
  app.closeExerciseEditPopup();
  await app.duplicateSharedExercise(id);
};

app.openExerciseLibrary = async function openExerciseLibrary(){
  try{
    await app.fetchTrainingExercises();
    app.$('#exerciseLibrarySearch').value='';
    app.$('#exerciseLibraryCategory').value='';
    app.$('#exerciseLibraryActive').value='active';
    app.renderExerciseLibrary();
    app.hideMainModules();
    app.setMatchHeaderMode(false);
    app.$('#exerciseLibrary').classList.remove('hidden');
    window.scrollTo({top:0,behavior:'instant'});
  }catch(e){app.handleError('exerciseLibrary',e)}
};

app.openExerciseCreatePopup = async function openExerciseCreatePopup(target='library'){
  await app.fetchExerciseCategories();
  app.trainingState.exerciseCreateTarget=target;
  app.$('#exerciseCreateName').value='';
  app.populateCategorySelect(app.$('#exerciseCreateCategory'),{selected:app.categoryState.categories.find(c=>c.slug==='attaque')?.id||app.fallbackCategory()?.id});
  app.$('#exerciseCreateMeasure').value='success_attempts';
  app.$('#exerciseCreateDescription').value='';
  app.$('#exerciseCreateObjective').value='';
  app.$('#exerciseCreateAttackInstruction').value='';
  app.$('#exerciseCreateDefenseInstruction').value='';
  app.$('#exerciseCreateSessionFocus').value='';
  app.$('#exerciseCreateStatus').textContent='';
  app.$('#exerciseCreateMeta').textContent=target==='session'
    ? 'L’exercice sera enregistré dans la bibliothèque et ajouté à cette séance.'
    : 'L’exercice sera enregistré dans la bibliothèque.';
  app.$('#confirmExerciseCreate').textContent=target==='session'?'Créer et ajouter':'Créer l’exercice';
  app.updateCreateDualUI();
  app.$('#exerciseCreatePopup').classList.remove('hidden');
  app.resetPopupScroll('#exerciseCreatePopup');
  setTimeout(()=>app.$('#exerciseCreateName')?.focus(),50);
};

app.closeExerciseCreatePopup = function closeExerciseCreatePopup(){
  app.$('#exerciseCreatePopup').classList.add('hidden');
};

app.createExerciseFromPopup = async function createExerciseFromPopup(){
  const status=app.$('#exerciseCreateStatus');
  const name=app.$('#exerciseCreateName').value.trim();
  if(!name){status.textContent='Renseigne le nom de l’exercice.';status.className='authStatus cloudErr';return}
  status.textContent='Enregistrement…';status.className='authStatus';
  const dual=!!app.categoryById(app.$('#exerciseCreateCategory').value)?.is_dual_focus;
  const sessionFocus=dual && app.trainingState.exerciseCreateTarget==='session' ? app.$('#exerciseCreateSessionFocus').value : null;
  if(dual && app.trainingState.exerciseCreateTarget==='session' && !sessionFocus){
    status.textContent='Choisis le focus Attaque ou Défense pour cette séance.';
    status.className='authStatus cloudErr';
    return;
  }
  const payload={
    name,
    category_id:app.requireCategory(app.$('#exerciseCreateCategory').value).id,
    measurement_type:app.$('#exerciseCreateMeasure').value,
    description:app.$('#exerciseCreateDescription').value.trim()||null,
    objective:app.$('#exerciseCreateObjective').value.trim()||null,
    attack_instruction:dual?(app.$('#exerciseCreateAttackInstruction').value.trim()||null):null,
    defense_instruction:dual?(app.$('#exerciseCreateDefenseInstruction').value.trim()||null):null,
    active:true
  };
  const {data,error}=await app.db.from('exercises').insert(payload).select('id,name,category,category_id,copied_from_exercise_id,measurement_type,description,objective,attack_instruction,defense_instruction,created_by').single();
  if(error) throw error;
  const target=app.trainingState.exerciseCreateTarget;
  await app.fetchTrainingExercises();
  if(target==='session') app.addSessionExercise(data,sessionFocus);
  app.closeExerciseCreatePopup();
  if(target==='library') app.renderExerciseLibrary();
};

app.fetchRecentTrainingSessions = async function fetchRecentTrainingSessions({withProfiles=true}={}){
  const ids=app.groupState.groups.map(g=>g.id);
  if(!ids.length){app.trainingState.recentSessions=[];return}
  const {data,error}=await app.db.from('training_sessions')
    .select('id,trained_on,label,theme,duration_minutes,notes,created_at,updated_at,created_by,updated_by,group_id,group:coaching_groups!training_sessions_group_id_fkey(name),team:teams!training_sessions_team_id_fkey(name)')
    .in('group_id',ids)
    .order('trained_on',{ascending:false})
    .limit(200);
  if(error) throw error;
  app.trainingState.recentSessions=data||[];
  if(withProfiles)await app.fetchProfiles(app.trainingState.recentSessions.flatMap(x=>[x.created_by,x.updated_by]));
};

app.trainingSeasonLabel = function trainingSeasonLabel(dateValue){
  const d=dateValue?new Date(dateValue+'T12:00:00'):new Date();
  const y=d.getFullYear();
  const start=d.getMonth()>=6?y:y-1;
  return `${start}-${start+1}`;
};

app.currentTrainingSeasonLabel = function currentTrainingSeasonLabel(){return app.trainingSeasonLabel(new Date().toISOString().slice(0,10))};

app.deleteTrainingSessionById = async function deleteTrainingSessionById(sessionId){
  const sess=(app.trainingState.recentSessions||[]).find(x=>x.id===sessionId);
  const date=sess?.trained_on?app.formatDateShort(sess.trained_on):'';
  const name=sess?.theme||sess?.label||'cette séance';
  const label=date?`${date} · ${name}`:name;
  if(!confirm(`Supprimer définitivement ${label} ?

Les présences, exercices et résultats enregistrés pour cette séance seront également supprimés. Cette action est irréversible.`))return false;
  try{
    app.setCloud('Suppression…',true);
    const {data,error}=await app.db.from('training_sessions').delete().eq('id',sessionId).select('id');
    if(error)throw error;
    if(!Array.isArray(data)||!data.some(x=>x.id===sessionId))throw new Error('La séance n’a pas pu être supprimée. Vérifie tes droits sur ce groupe.');
    app.trainingState.recentSessions=(app.trainingState.recentSessions||[]).filter(x=>x.id!==sessionId);
    if(app.trainingState.currentSessionId===sessionId){app.trainingState.currentSessionId=null;app.trainingState.resultDraft={}}
    app.renderTrainingSavedHome();
    if(app.$('#trainingDuplicate')&&!app.$('#trainingDuplicate').classList.contains('hidden'))app.renderDuplicateTrainingSessions();
    app.setCloud('Synchronisé',true);
    return true;
  }catch(e){
    app.setCloud('Erreur',false);
    app.handleError('delete training session',e);
    return false;
  }
};

app.renderTrainingSavedHome = function renderTrainingSavedHome(){
  const box=app.$('#trainingSavedSeasons'),count=app.$('#trainingSavedCount');
  if(!box)return;
  const sessions=app.trainingState.recentSessions||[];
  if(count)count.textContent=`${sessions.length} séance${sessions.length>1?'s':''}`;
  box.innerHTML='';
  if(!sessions.length){box.innerHTML='<div class="small">Aucune séance enregistrée.</div>';return}
  const groups=new Map();
  sessions.forEach(sess=>{const key=app.trainingSeasonLabel(sess.trained_on);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(sess)});
  const current=app.currentTrainingSeasonLabel();
  [...groups.keys()].sort((a,b)=>b.localeCompare(a)).forEach(season=>{
    const list=groups.get(season);
    const details=document.createElement('details');
    details.className='trainingSeason';
    if(season===current)details.open=true;
    const summary=document.createElement('summary');
    summary.innerHTML=`<span>Saison ${app.escapeHtml(season)}</span><span class="trainingSeasonMeta">${list.length} séance${list.length>1?'s':''}${season===current?' · en cours':''}</span>`;
    const body=document.createElement('div');body.className='trainingSeasonBody';
    list.forEach(sess=>{
      const row=document.createElement('div');row.className='trainingSavedSession';
      row.innerHTML=`<div class="trainingSavedSessionTop"><div class="trainingSavedSessionTitle"><strong>${app.escapeHtml(sess.trained_on?app.formatDateShort(sess.trained_on):'')}${sess.theme?' · '+app.escapeHtml(sess.theme):(sess.label?' · '+app.escapeHtml(sess.label):'')}</strong><div class="small" style="margin-top:4px">${app.escapeHtml(sess.group?.name||sess.team?.name||'Groupe')}${sess.duration_minutes?' · '+app.escapeHtml(sess.duration_minutes)+' min':''}</div></div><div class="trainingSavedSessionActions"><button class="ghost" data-home-duplicate-session="${sess.id}">Dupliquer</button><button class="ghost dangerAction" data-home-delete-session="${sess.id}">Supprimer</button></div></div>`;
      row.setAttribute('role','button');
      row.tabIndex=0;
      const openSession=()=>app.editTrainingSessionById(sess.id).catch(e=>app.handleError('open training session',e));
      row.onclick=openSession;
      row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openSession()}};
      row.querySelector('[data-home-duplicate-session]').onclick=e=>{e.stopPropagation();app.duplicateTrainingSessionById(sess.id).catch(err=>app.handleError('duplicate training session',err))};
      row.querySelector('[data-home-delete-session]').onclick=e=>{e.stopPropagation();app.deleteTrainingSessionById(sess.id).catch(err=>app.handleError('delete training session',err))};
      body.append(row);
    });
    details.append(summary,body);box.append(details);
  });
};

app.renderDuplicateTrainingSessions = function renderDuplicateTrainingSessions(){
  const box=app.$('#trainingDuplicateList');
  const status=app.$('#trainingDuplicateStatus');
  if(!box)return;
  box.innerHTML='';
  status.textContent=`${app.trainingState.recentSessions.length} séance${app.trainingState.recentSessions.length>1?'s':''} récente${app.trainingState.recentSessions.length>1?'s':''}`;
  if(!app.trainingState.recentSessions.length){
    box.innerHTML='<div class="small">Aucune séance enregistrée.</div>';
    return;
  }

  app.trainingState.recentSessions.forEach(sess=>{
    const d=document.createElement('div');
    d.className='historyItem';
    d.innerHTML=`<div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
      <div style="min-width:0;flex:1">
        <strong>${app.escapeHtml(sess.trained_on?app.formatDateShort(sess.trained_on):'')}${sess.theme?' · '+app.escapeHtml(sess.theme):(sess.label?' · '+app.escapeHtml(sess.label):'')}</strong>
        <div class="small" style="margin-top:4px">${app.escapeHtml(sess.group?.name||sess.team?.name||'Groupe')}${sess.duration_minutes?' · '+app.escapeHtml(sess.duration_minutes)+' min':''}</div>
        <div class="small" style="margin-top:4px">Créé par ${app.escapeHtml(app.auditName(sess.created_by))}${sess.created_at?' le '+app.escapeHtml(app.formatAuditDate(sess.created_at)):''}${sess.updated_at&&sess.updated_at!==sess.created_at?' · Modifié par '+app.escapeHtml(app.auditName(sess.updated_by))+(sess.updated_at?' le '+app.escapeHtml(app.formatAuditDate(sess.updated_at)):''):''}</div>
      </div>
      <div class="row" style="gap:6px;flex:0 0 auto">
        <button class="ghost" data-duplicate-session="${sess.id}">Dupliquer</button>
        <button class="ghost dangerAction" data-delete-session="${sess.id}">Supprimer</button>
      </div>
    </div>`;
    d.style.cursor='pointer';
    d.setAttribute('role','button');
    d.tabIndex=0;
    const openSession=()=>app.editTrainingSessionById(sess.id).catch(e=>app.handleError('open training session',e));
    d.onclick=openSession;
    d.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openSession()}};
    d.querySelector('[data-duplicate-session]').onclick=e=>{e.stopPropagation();app.duplicateTrainingSessionById(sess.id).catch(err=>app.handleError('duplicate training session',err))};
    d.querySelector('[data-delete-session]').onclick=e=>{e.stopPropagation();app.deleteTrainingSessionById(sess.id).catch(err=>app.handleError('delete training session',err))};
    box.append(d);
  });
};

app.openTrainingDuplicate = async function openTrainingDuplicate(){
  try{
    await app.fetchMyGroups();
    await Promise.all([app.fetchTrainingExercises(),app.fetchRecentTrainingSessions()]);
    app.renderDuplicateTrainingSessions();
    app.hideMainModules();
    app.setMatchHeaderMode(false);
    app.$('#trainingDuplicate').classList.remove('hidden');
    window.scrollTo({top:0,behavior:'instant'});
  }catch(e){app.handleError('training duplicate',e)}
};

app.duplicateTrainingSessionById = async function duplicateTrainingSessionById(sessionId){
  const source=app.trainingState.recentSessions.find(s=>s.id===sessionId);
  if(!source) return;
  app.trainingState.currentSessionId=null;
  app.trainingState.resultDraft={};
  app.trainingState.planOrganizerMode=false;app.trainingState.planOrganizerSelectedId=null;
  app.setTrainingSaveLabels('Enregistrer la séance');

  const [{data:attendance,error:ae},{data:sessionExercises,error:xe}]=await Promise.all([
    app.db.from('training_attendance').select('player_id,present').eq('session_id',sessionId),
    app.db.from('training_session_exercises')
      .select('position,variant,target,focus,exercise:exercises!training_session_exercises_exercise_id_fkey(id,name,category,category_id,copied_from_exercise_id,measurement_type,description,objective,attack_instruction,defense_instruction)')
      .eq('session_id',sessionId)
      .order('position')
  ]);
  if(ae) throw ae;
  if(xe) throw xe;

  app.trainingState.sessionExercises=(sessionExercises||[])
    .filter(x=>x.exercise)
    .map(x=>({...x.exercise,localKey:app.newUuid(),expanded:false,variant:x.variant||null,target:x.target||null,focus:x.focus||null}));

  app.$('#trainingDate').value=app.isoToFrInput(app.today());
  app.$('#trainingGroup').value=source.group_id||'';
  await app.fetchTrainingPlayers(source.group_id||null);
  if(app.$('#trainingAttendancePreset'))app.$('#trainingAttendancePreset').value='';
  if(app.$('#trainingAttendancePresetStatus'))app.$('#trainingAttendancePresetStatus').textContent='';
  app.$('#trainingTheme').value=source.theme||source.label||'';
  app.$('#trainingDuration').value=source.duration_minutes||'';
  const sourcePlan=app.unpackTrainingNotes(source.notes||'');
  app.$('#trainingNotes').value=sourcePlan.notes||'';
  app.autoGrowPlanTextarea(app.$('#trainingNotes'));
  app.trainingState.planBlocks=(sourcePlan.plan||[]).map(b=>({...app.newPlanBlock(b),...b,id:app.newUuid(),expanded:false}));
  if(app.$('#trainingPlanStart')&&app.trainingState.planBlocks.length){const mins=app.trainingState.planBlocks.filter(b=>!b.draft).map(b=>app.planTimeMinutes(b.start)).filter(x=>x!==99999);if(mins.length)app.$('#trainingPlanStart').value=app.minutesToPlanTime(Math.min(...mins))}
  app.bindLoadedStatsToPlanBlocks();
  app.$('#trainingSaveStatus').textContent='';

  const presentIds=new Set((attendance||[]).filter(a=>a.present).map(a=>a.player_id));
  app.$$('#trainingAttendance input').forEach(c=>c.checked=presentIds.has(c.value));
  app.renderTrainingExerciseCards();
  app.renderTrainingPlan();

  app.hideMainModules();
  app.$('#trainingSession').classList.remove('hidden');
  window.scrollTo({top:0,behavior:'instant'});
  app.markTrainingSessionBaseline();
};

app.editTrainingSessionById = async function editTrainingSessionById(sessionId){
  const source=app.trainingState.recentSessions.find(s=>s.id===sessionId);
  if(!source)return;

  const [{data:attendance,error:ae},{data:sessionExercises,error:xe},{data:results,error:re}]=await Promise.all([
    app.db.from('training_attendance').select('player_id,present').eq('session_id',sessionId),
    app.db.from('training_session_exercises')
      .select('position,variant,target,focus,exercise:exercises!training_session_exercises_exercise_id_fkey(id,name,category,category_id,copied_from_exercise_id,measurement_type,description,objective,attack_instruction,defense_instruction)')
      .eq('session_id',sessionId).order('position'),
    app.db.from('training_results')
      .select('exercise_id,player_id,successes,attempts,numeric_value,note')
      .eq('session_id',sessionId)
  ]);
  if(ae)throw ae;if(xe)throw xe;if(re)throw re;

  app.trainingState.currentSessionId=sessionId;
  app.trainingState.resultDraft={};
  app.trainingState.planOrganizerMode=false;app.trainingState.planOrganizerSelectedId=null;
  app.trainingState.sessionExercises=(sessionExercises||[])
    .filter(x=>x.exercise)
    .map(x=>({...x.exercise,localKey:app.newUuid(),expanded:false,variant:x.variant||null,target:x.target||null,focus:x.focus||null}));

  app.$('#trainingDate').value=app.isoToFrInput(source.trained_on||app.today());
  app.$('#trainingGroup').value=source.group_id||'';
  await app.fetchTrainingPlayers(source.group_id||null);
  if(app.$('#trainingAttendancePreset'))app.$('#trainingAttendancePreset').value='';
  if(app.$('#trainingAttendancePresetStatus'))app.$('#trainingAttendancePresetStatus').textContent='';
  app.$('#trainingTheme').value=source.theme||source.label||'';
  app.$('#trainingDuration').value=source.duration_minutes||'';
  const sourcePlan=app.unpackTrainingNotes(source.notes||'');
  app.$('#trainingNotes').value=sourcePlan.notes||'';
  app.autoGrowPlanTextarea(app.$('#trainingNotes'));
  app.trainingState.planBlocks=(sourcePlan.plan||[]).map(b=>({...app.newPlanBlock(b),...b,id:app.newUuid(),expanded:false}));
  if(app.$('#trainingPlanStart')&&app.trainingState.planBlocks.length){const mins=app.trainingState.planBlocks.filter(b=>!b.draft).map(b=>app.planTimeMinutes(b.start)).filter(x=>x!==99999);if(mins.length)app.$('#trainingPlanStart').value=app.minutesToPlanTime(Math.min(...mins))}
  app.bindLoadedStatsToPlanBlocks();
  app.$('#trainingSaveStatus').textContent='';
  app.setTrainingSaveLabels('Enregistrer les modifications');

  const presentIds=new Set((attendance||[]).filter(a=>a.present).map(a=>a.player_id));
  app.$$('#trainingAttendance input').forEach(c=>c.checked=presentIds.has(c.value));

  const exById=new Map(app.trainingState.sessionExercises.map(ex=>[ex.id,ex]));
  (results||[]).forEach(r=>{
    const ex=exById.get(r.exercise_id);if(!ex)return;
    app.trainingState.resultDraft[app.trainingDraftKey(ex.localKey,r.player_id)]={
      successes:r.successes==null?'':String(r.successes),
      attempts:r.attempts==null?'':String(r.attempts),
      value:r.numeric_value==null?'':String(r.numeric_value),
      note:r.note||''
    };
  });

  app.renderTrainingExerciseCards();
  app.renderTrainingPlan();
  app.hideMainModules();app.setMatchHeaderMode(false);
  app.$('#trainingSession').classList.remove('hidden');
  window.scrollTo({top:0,behavior:'instant'});
  app.markTrainingSessionBaseline();
};

app.addTrainingPlayers = async function addTrainingPlayers(){
  const names=app.$('#trainingAddPlayers').value.split(',').map(x=>x.trim()).filter(Boolean);
  if(!names.length)return;
  await app.ensurePlayers(names);
  await app.fetchTrainingPlayers();
  const wanted=new Set(names.map(x=>x.toLowerCase()));
  app.$$('#trainingAttendance input').forEach(c=>{if(wanted.has(c.dataset.name.toLowerCase()))c.checked=true});
  app.renderTrainingExerciseCards();
};

app.trainingStatus = function trainingStatus(text,error=false){
  const el=app.$('#trainingSaveStatus');
  el.textContent=text||'';
  el.className='authStatus '+(error?'cloudErr':'cloudOk');
  if(error)el.scrollIntoView?.({block:'nearest',behavior:'smooth'});
};

app.saveTrainingSession = async function saveTrainingSession(){
  if(app.trainingSaveInFlight)return;
  app.trainingSaveInFlight=true;
  const saveButtons=app.$$('#saveTrainingSessionHead,#saveTrainingSession');
  saveButtons.forEach(button=>{button.disabled=true});
  try{
    app.captureTrainingResultDraft();
    app.captureTrainingPlan();
    app.syncPlanStatExercises();
    app.trainingStatus(app.trainingState.currentSessionId?'Mise à jour…':'Enregistrement…');
    const groupId=app.$('#trainingGroup').value;
    const group=app.groupState.groups.find(g=>g.id===groupId);
    const date=app.frInputToIso(app.$('#trainingDate').value||app.isoToFrInput(app.today()));
    const present=app.trainingPresentPlayers();
    if(!groupId||!group){app.trainingStatus('Choisis un groupe.',true);return}
    if(!present.length){app.trainingStatus('Sélectionne au moins un joueur présent.',true);return}
    const withoutFocus=app.trainingState.sessionExercises.find(ex=>app.isDualExercise(ex)&&!ex.focus);
    if(withoutFocus){app.trainingStatus(`Choisis le focus Attaque ou Défense pour « ${withoutFocus.name} ».`,true);return}

    const teamId=await app.ensureTeam(group.name);
    const duration=app.$('#trainingDuration').value?Number(app.$('#trainingDuration').value):null;
    const sessionPayload={
      workspace_id:app.state.workspaceId,group_id:groupId,team_id:teamId,trained_on:date,
      label:app.$('#trainingTheme').value.trim()||'Entraînement',
      theme:app.$('#trainingTheme').value.trim()||null,
      duration_minutes:duration,
      notes:app.packTrainingNotes(app.$('#trainingNotes').value,app.trainingState.planBlocks)
    };

    let sessionId=app.trainingState.currentSessionId;
    if(sessionId){
      const {error}=await app.db.from('training_sessions').update(sessionPayload).eq('id',sessionId);
      if(error)throw error;
      const deletes=await Promise.all([
        app.db.from('training_results').delete().eq('session_id',sessionId),
        app.db.from('training_attendance').delete().eq('session_id',sessionId),
        app.db.from('training_session_exercises').delete().eq('session_id',sessionId)
      ]);
      for(const d of deletes) if(d.error) throw d.error;
    }else{
      const {data:session,error}=await app.db.from('training_sessions').insert(sessionPayload).select('id').single();
      if(error)throw error;
      sessionId=session.id;
    }

    const attendance=app.trainingState.players.map(p=>({session_id:sessionId,player_id:p.id,present:present.some(x=>x.id===p.id)}));
    if(attendance.length){const {error}=await app.db.from('training_attendance').insert(attendance);if(error)throw error}

    const sessionExRows=app.trainingState.sessionExercises.map((ex,i)=>({
      session_id:sessionId,exercise_id:ex.id,position:i+1,focus:app.isDualExercise(ex)?ex.focus:null
    }));
    if(sessionExRows.length){const {error}=await app.db.from('training_session_exercises').insert(sessionExRows);if(error)throw error}

    const results=[];
    app.trainingState.sessionExercises.forEach(ex=>{
      present.forEach(p=>{
        const d=app.getTrainingDraft(ex.localKey,p.id);
        const note=(d.note||'').trim()||null;
        if(ex.measurement_type==='success_attempts'){
          if(d.successes===''&&d.attempts===''&&!note)return;
          results.push({
            session_id:sessionId,exercise_id:ex.id,player_id:p.id,
            successes:d.successes===''?null:Number(d.successes),
            attempts:d.attempts===''?null:Number(d.attempts),note
          });
        }else{
          if(d.value===''&&!note)return;
          results.push({
            session_id:sessionId,exercise_id:ex.id,player_id:p.id,
            numeric_value:d.value===''?null:Number(d.value),note
          });
        }
      });
    });
    if(results.length){const {error}=await app.db.from('training_results').insert(results);if(error)throw error}

    app.trainingState.currentSessionId=sessionId;
    app.trainingStatus('Séance enregistrée ✓ — tu peux continuer à la modifier.');
    app.setTrainingSaveLabels('Enregistrer les modifications');
    app.setCloud('Synchronisé',true);
    app.markTrainingSessionBaseline();
  }catch(e){app.trainingStatus(e.message||String(e),true);app.handleError('saveTrainingSession',e)}
  finally{app.trainingSaveInFlight=false;saveButtons.forEach(button=>{button.disabled=false})}
};
// The historical UI had a handler pointing to an absent function. Reuse the
// existing group-scoped read contracts rather than introduce SQL or a new RPC.
app.openTrainingHistory = async () => {
  const groupId=app.$('#historyGroup').value||app.groupState.groups[0]?.id||'';
  await app.fetchTrainingPlayers(groupId);
  app.$('#historyGroup').value=groupId;
  app.hideMainModules();
  app.$('#trainingHistory').classList.remove('hidden');
  app.$('#historyPlayer').value='';
  app.$('#historySummary').textContent='';
  app.$('#historyResults').innerHTML='';
};

app.loadPlayerHistory = async playerId => {
  const groupId=app.$('#historyGroup').value;
  const summary=app.$('#historySummary'),box=app.$('#historyResults');
  summary.textContent='';box.innerHTML='';
  if(!playerId)return;
  if(!groupId||!app.groupState.groups.some(g=>g.id===groupId))throw new Error('Choisis un groupe entraîneur.');
  const player=app.trainingState.players.find(p=>p.id===playerId);
  if(!player)throw new Error('Ce joueur ne fait pas partie du groupe sélectionné.');
  summary.textContent='Chargement…';
  const sessions=await app.services.trainingSessions(groupId);
  const rows=await app.services.trainingResults(sessions.map(s=>s.id));
  // Do not apply a late response after a change of player or group.
  if(app.$('#historyPlayer').value!==playerId||app.$('#historyGroup').value!==groupId)return;
  const present=new Set(rows.attendance.filter(r=>r.player_id===playerId&&r.present).map(r=>r.session_id));
  const results=rows.results.filter(r=>r.player_id===playerId);
  summary.textContent=`${player.display_name} · ${present.size} présence${present.size===1?'':'s'} · ${results.length} résultat${results.length===1?'':'s'}`;
  const exercises=new Map(rows.sessionExercises.filter(row=>row.exercise).map(row=>[row.exercise_id,row.exercise]));
  const entries=[...sessions].reverse().filter(s=>present.has(s.id)||results.some(r=>r.session_id===s.id));
  if(!entries.length){box.textContent='Aucune séance enregistrée pour ce joueur.';return}
  box.innerHTML=entries.map(session=>{
    const body=results.filter(r=>r.session_id===session.id).map(r=>{
      const exercise=exercises.get(r.exercise_id);
      const value=r.attempts!=null||r.successes!=null?`${r.successes??'—'} / ${r.attempts??'—'}`:r.numeric_value??'—';
      return `<div class="historyItem"><strong>${app.escapeHtml(exercise?.name||'Exercice historique')}</strong><div>${app.escapeHtml(value)}</div>${r.note?`<div class="small">${app.escapeHtml(r.note)}</div>`:''}</div>`;
    }).join('');
    return `<section class="historyItem"><strong>${app.escapeHtml(app.formatDateShort(session.trained_on))} · ${app.escapeHtml(session.theme||session.label||'Entraînement')}</strong>${body||'<div class="small">Présent, sans résultat individuel enregistré.</div>'}</section>`;
  }).join('');
};
})(window.KinballCoach.app);

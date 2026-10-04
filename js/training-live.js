const SUPABASE_URL='https://chrbzchthloxowlzdvpe.supabase.co';
const SUPABASE_KEY='sb_publishable_4pQGJ5DSzMRBuHLrAUb30g_MGZVYvEY';
if(!window.supabase)throw new Error('Supabase library failed to load');
const db=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

const CONTEXTS=[
  {key:'game_center',label:'Jeu au centre'},
  {key:'restart_center',label:'Remise centre'},
  {key:'restart_line',label:'Remise ligne'},
  {key:'restart_corner',label:'Remise coin'}
];
const CONTEXT_LABEL=Object.fromEntries(CONTEXTS.map(x=>[x.key,x.label]));
const RESULT_LABEL={point:'Point',defended:'Défendu',fault:'Faute'};
const TEAM_ORDER=['blue','gray','black'];
const TEAM_META={
  blue:{label:'Équipe bleue',short:'Bleu'},
  gray:{label:'Équipe grise',short:'Gris'},
  black:{label:'Équipe noire',short:'Noir'}
};
const FAULT_TYPES=[
  "Faute d'appellation",
  'Manque un contact',
  'Pente descendante',
  'Extérieur',
  'Offensive illégale',
  'Déplacement illégal du ballon',
  'Faute de temps'
];

const state={
  user:null,workspaceId:null,groups:[],players:[],sessions:[],exercises:[],periods:[],periodCounts:{},
  selectedGroupId:'',selectedSessionId:'__new__',attendance:new Set(),teamByPlayer:new Map(),
  currentSession:null,currentPeriod:null,events:[],selectedContext:'game_center',
  activeTarget:null,faultTarget:null,saving:false,organizingTeams:false,organizerPlayerId:null,organizerSwapTeam:null
};

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function today(){const d=new Date();const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function fmtDate(value){if(!value)return '';try{return new Date(value+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})}catch{return value}}
function fmtTime(value){if(!value)return '';try{return new Date(value).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch{return ''}}
function plural(n,singular,pluralForm=singular+'s'){return n===1?singular:pluralForm}
function setStatus(el,text,error=false){if(!el)return;el.textContent=text||'';el.className='authStatus '+(text?(error?'err':'ok'):'')}
function setCloud(text,ok=null){$('#cloudStatus').textContent=text;const fieldStatus=$('#fieldCloudStatus');if(fieldStatus)fieldStatus.textContent=text;const dot=$('#cloudDot');dot.classList.remove('online','offline');if(ok===true)dot.classList.add('online');else if(ok===false)dot.classList.add('offline')}
function groupById(id){return state.groups.find(g=>g.id===id)||null}
function sessionById(id){return state.sessions.find(s=>s.id===id)||null}
function exerciseById(id){return state.exercises.find(e=>e.id===id)||null}
function presentPlayers(){return state.players.filter(p=>state.attendance.has(p.id))}
function normalizeTeamColor(value){return TEAM_ORDER.includes(value)?value:null}
function teamForPlayer(playerId){return normalizeTeamColor(state.teamByPlayer.get(playerId))}
function teamPlayers(team){return presentPlayers().filter(p=>teamForPlayer(p.id)===team)}
function unassignedPlayers(){return presentPlayers().filter(p=>!teamForPlayer(p.id))}
function autoAssignTeams(){
  const players=presentPlayers(),teamCount=Math.min(3,Math.max(1,Math.ceil(players.length/4)));
  players.forEach((p,index)=>state.teamByPlayer.set(p.id,index<teamCount*4?TEAM_ORDER[Math.min(teamCount-1,Math.floor(index/4))]:null));
  renderTeamSetup();
}
function teamSelectHtml(player){
  const current=teamForPlayer(player.id)||'';
  return `<select data-team-player="${escapeHtml(player.id)}" aria-label="Équipe de ${escapeHtml(player.display_name)}"><option value="" ${!current?'selected':''}>Non affecté</option>${TEAM_ORDER.map(team=>`<option value="${team}" ${current===team?'selected':''}>${escapeHtml(TEAM_META[team].short)}</option>`).join('')}</select>`;
}
function teamSetupPlayerHtml(player){return `<div class="teamSetupPlayer"><span>${escapeHtml(player.display_name)}</span>${teamSelectHtml(player)}</div>`}
function renderTeamSetup(){
  const box=$('#teamSetupGrid'),summary=$('#teamSetupSummary');if(!box)return;
  const players=presentPlayers();
  if(!players.length){box.innerHTML='<div class="small">Sélectionne d’abord les joueurs présents.</div>';if(summary)summary.textContent='';return}
  const columns=TEAM_ORDER.map(team=>{
    const list=teamPlayers(team);
    return `<div class="teamSetupColumn team-${team}"><div class="teamSetupColumnHead"><strong>${escapeHtml(TEAM_META[team].label)}</strong><span>${list.length}</span></div><div class="teamSetupPlayers">${list.length?list.map(teamSetupPlayerHtml).join(''):'<div class="teamSetupEmpty">Aucun joueur</div>'}</div></div>`;
  }).join('');
  const free=unassignedPlayers();
  box.innerHTML=columns+(free.length?`<div class="teamSetupUnassigned"><div class="teamSetupColumnHead"><strong>Non affectés</strong><span>${free.length}</span></div><div class="teamSetupPlayers">${free.map(teamSetupPlayerHtml).join('')}</div></div>`:'');
  box.querySelectorAll('[data-team-player]').forEach(sel=>sel.onchange=()=>{
    const playerId=sel.dataset.teamPlayer,nextTeam=normalizeTeamColor(sel.value),currentTeam=teamForPlayer(playerId);
    if(nextTeam&&nextTeam!==currentTeam&&teamPlayers(nextTeam).length>=4){setStatus($('#setupStatus'),`${TEAM_META[nextTeam].label} est déjà complète (4/4).`,true);renderTeamSetup();return}
    state.teamByPlayer.set(playerId,nextTeam);setStatus($('#setupStatus'),'');renderTeamSetup();
  });
  if(summary)summary.textContent=TEAM_ORDER.map(team=>`${TEAM_META[team].short} : ${teamPlayers(team).length}/4`).join(' · ')+(free.length?` · Non affectés : ${free.length}`:'');
}
function nextPeriodNumber(){return Math.max(0,...state.periods.map(p=>Number(p.period_number)||0))+1}
function suggestedPeriodLabel(){const ex=exerciseById($('#exerciseSelect').value);const n=nextPeriodNumber();return ex?`${ex.name} ${n}`:`Collecte ${n}`}
function updateStartState(){const ready=!!state.selectedGroupId && state.attendance.size>0 && !state.saving;$('#startCollection').disabled=!ready}
function closeFieldTools(){
  document.body.classList.remove('fieldToolsOpen');
  const drawer=$('#fieldToolsDrawer'),toggle=$('#fieldToolsToggle');
  if(drawer)drawer.setAttribute('aria-hidden','true');
  if(toggle)toggle.setAttribute('aria-expanded','false');
}
function openFieldTools(){
  if(!document.body.classList.contains('fieldCollectionMode'))return;
  syncFieldToolsMeta();
  document.body.classList.add('fieldToolsOpen');
  const drawer=$('#fieldToolsDrawer'),toggle=$('#fieldToolsToggle');
  if(drawer)drawer.setAttribute('aria-hidden','false');
  if(toggle)toggle.setAttribute('aria-expanded','true');
}
function setFieldCollectionMode(enabled){
  document.body.classList.toggle('fieldCollectionMode',!!enabled);
  if(!enabled)closeFieldTools();
}
function initFieldToolsDrawer(){
  const drawer=$('#fieldToolsDrawer'),actions=$('#fieldToolsPrimaryActions'),content=$('#fieldToolsContent');
  if(!drawer||!actions||!content)return;
  const finish=$('#finishPeriod'),back=$('#backToSetup');
  if(finish)actions.append(finish);
  if(back)actions.append(back);
  ['.classificationDetails','.liveFooter','.mergedMetricsNote','#metrics','.historyDetails'].forEach(selector=>{
    const node=$(selector);if(node)content.append(node);
  });
}
function syncFieldToolsMeta(){
  const meta=$('#fieldToolsMeta');if(!meta)return;
  const p=state.currentPeriod,s=state.currentSession;
  meta.textContent=p&&s?`${p.label} · ${s.theme||s.label||'Entraînement'}`:'';
}

async function loadWorkspace(){
  const {data,error}=await db.from('workspace_members').select('workspace_id').eq('user_id',state.user.id).limit(1);
  if(error)throw error;if(!data?.length)throw new Error('Aucun workspace associé à ce compte.');state.workspaceId=data[0].workspace_id;
}
async function loadGroups(){
  const {data,error}=await db.from('coaching_group_coaches')
    .select('role,group:coaching_groups!coaching_group_coaches_group_id_fkey(id,name,club)')
    .eq('user_id',state.user.id).order('joined_at',{ascending:true});
  if(error)throw error;
  state.groups=(data||[]).filter(x=>x.group).map(x=>({...x.group,role:x.role}));
  const sel=$('#groupSelect');sel.innerHTML='<option value="">— Choisir un groupe —</option>';
  state.groups.forEach(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.club?`${g.name} · ${g.club}`:g.name;sel.append(o)});
  if(state.groups.length===1){sel.value=state.groups[0].id;state.selectedGroupId=sel.value}
}
async function loadExercises(){
  const {data,error}=await db.from('exercises').select('id,name,active,measurement_type').order('name');
  if(error)throw error;
  state.exercises=(data||[]).sort((a,b)=>{
    const aj=/^jeu libre$/i.test(a.name||'')?0:1,bj=/^jeu libre$/i.test(b.name||'')?0:1;
    return aj-bj||(a.name||'').localeCompare(b.name||'','fr');
  });
  fillExerciseSelect($('#exerciseSelect'));
  const defaultFreePlay=state.exercises.find(ex=>ex.active&&/^jeu libre$/i.test(ex.name||''));
  if(defaultFreePlay)$('#exerciseSelect').value=defaultFreePlay.id;
  fillExerciseSelect($('#collectorExerciseSelect'));
}
function fillExerciseSelect(sel,selected=''){
  if(!sel)return;const current=selected||sel.value||'';
  sel.innerHTML='<option value="">À classer · aucun exercice</option>';
  state.exercises.forEach(ex=>{const o=document.createElement('option');o.value=ex.id;o.textContent=ex.name+(ex.active?'':' · archivé');if(!ex.active&&ex.id!==current)o.disabled=true;sel.append(o)});
  if([...sel.options].some(o=>o.value===current))sel.value=current;
}
async function loadPlayers(groupId){
  const {data,error}=await db.from('coaching_group_players')
    .select('player_id,active,player:players!coaching_group_players_player_id_fkey(id,display_name)')
    .eq('group_id',groupId).eq('active',true);
  if(error)throw error;
  state.players=(data||[]).filter(x=>x.player).map(x=>x.player).sort((a,b)=>a.display_name.localeCompare(b.display_name,'fr'));
}
async function loadSessions(groupId){
  const {data,error}=await db.from('training_sessions')
    .select('id,group_id,trained_on,label,theme,created_at')
    .eq('group_id',groupId).order('trained_on',{ascending:false}).order('created_at',{ascending:false}).limit(80);
  if(error)throw error;state.sessions=data||[];
  const sel=$('#sessionSelect');sel.disabled=false;sel.innerHTML='<option value="__new__">＋ Nouvelle séance aujourd’hui</option>';
  state.sessions.forEach(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=`${fmtDate(s.trained_on)} · ${s.theme||s.label||'Entraînement'}`;sel.append(o)});
  sel.value='__new__';state.selectedSessionId='__new__';
}
async function loadAttendance(sessionId){
  state.teamByPlayer=new Map();
  if(sessionId==='__new__'){
    state.attendance=new Set(state.players.map(p=>p.id));
    $('#attendanceHint').textContent='Nouvelle séance : tout le groupe est précoché et reste non affecté tant que tu ne constitues pas les équipes.';
    renderAttendance();return;
  }
  const {data,error}=await db.from('training_attendance').select('player_id,present').eq('session_id',sessionId);
  if(error)throw error;
  if((data||[]).length){
    state.attendance=new Set(data.filter(x=>x.present).map(x=>x.player_id));
    state.teamByPlayer=new Map();
    $('#attendanceHint').textContent='Présences enregistrées pour cette séance. Le terrain repart vide : constitue les équipes pour cette nouvelle prise de note.';
  }else{
    state.attendance=new Set(state.players.map(p=>p.id));
    $('#attendanceHint').textContent='Aucune présence enregistrée : tout le groupe est précoché et non affecté.';
  }
  renderAttendance();
}
function renderAttendance(){
  const box=$('#attendanceGrid');box.innerHTML='';
  if(!state.players.length){box.innerHTML='<div class="small">Aucun joueur actif dans ce groupe.</div>';renderTeamSetup();updateStartState();return}
  state.players.forEach(p=>{
    const label=document.createElement('label');label.className='attendanceChoice';
    label.innerHTML=`<input type="checkbox" value="${escapeHtml(p.id)}" ${state.attendance.has(p.id)?'checked':''}><span>${escapeHtml(p.display_name)}</span>`;
    label.querySelector('input').onchange=e=>{
      if(e.target.checked){state.attendance.add(p.id)}
      else{state.attendance.delete(p.id);state.teamByPlayer.delete(p.id)}
      renderTeamSetup();updateStartState();
    };
    box.append(label);
  });
  renderTeamSetup();updateStartState();
}
async function loadPeriods(sessionId){
  if(!sessionId||sessionId==='__new__'){state.periods=[];state.periodCounts={};renderPeriodList();return}
  const [{data:periods,error:pe},{data:events,error:ee}]=await Promise.all([
    db.from('training_live_periods').select('id,session_id,group_id,exercise_id,period_number,label,started_at,ended_at,team_assignments,created_at').eq('session_id',sessionId).order('period_number'),
    db.from('training_live_events').select('period_id').eq('session_id',sessionId)
  ]);
  if(pe)throw pe;if(ee)throw ee;
  state.periods=periods||[];state.periodCounts={};(events||[]).forEach(e=>state.periodCounts[e.period_id]=(state.periodCounts[e.period_id]||0)+1);renderPeriodList();
}
function renderPeriodList(){
  const block=$('#existingPeriodsBlock'),box=$('#periodList');
  if(state.selectedSessionId==='__new__'){block.classList.add('hidden');box.innerHTML='';return}
  block.classList.remove('hidden');
  if(!state.periods.length){box.innerHTML='<div class="small">Aucune collecte enregistrée pour cette séance.</div>';return}
  box.innerHTML=state.periods.map(p=>{
    const ex=exerciseById(p.exercise_id),n=state.periodCounts[p.id]||0;
    const classification=ex?`<span class="classTag">${escapeHtml(ex.name)}</span>`:'<span class="classTag unassigned">À classer</span>';
    const stateLabel=p.ended_at?'Terminée':'En cours';
    return `<div class="periodCard" data-period-card="${p.id}"><div><div class="periodCardTitle">${escapeHtml(p.label)}</div><div class="periodCardMeta">Période ${p.period_number} · ${stateLabel} · ${n} ${plural(n,'action')} · ${classification}</div></div><div class="periodCardActions"><button class="ghost" type="button" data-open-period="${p.id}">${p.ended_at?'Reprendre':'Ouvrir'}</button></div></div>`;
  }).join('');
  $$('[data-open-period]').forEach(b=>b.onclick=()=>resumePeriod(b.dataset.openPeriod).catch(showFatal));
}
function syncNewSessionFields(){
  const isNew=state.selectedSessionId==='__new__';$('#setupGrid').classList.toggle('isNewSession',isNew);$$('.newSessionField').forEach(x=>x.classList.toggle('hidden',!isNew));
  if(isNew){$('#newSessionDate').value=$('#newSessionDate').value||today();$('#existingPeriodsBlock').classList.add('hidden')}
}
async function handleGroupChange(){
  state.selectedGroupId=$('#groupSelect').value;state.selectedSessionId='__new__';state.sessions=[];state.periods=[];state.players=[];state.attendance=new Set();state.teamByPlayer=new Map();renderAttendance();renderPeriodList();
  if(!state.selectedGroupId){$('#sessionSelect').disabled=true;$('#sessionSelect').innerHTML='<option>— Choisir d’abord un groupe —</option>';return}
  setStatus($('#setupStatus'),'Chargement…');
  try{
    await Promise.all([loadPlayers(state.selectedGroupId),loadSessions(state.selectedGroupId)]);
    syncNewSessionFields();await Promise.all([loadAttendance(state.selectedSessionId),loadPeriods(state.selectedSessionId)]);
    $('#periodLabel').value=suggestedPeriodLabel();setStatus($('#setupStatus'),'Prêt.');
  }catch(e){setStatus($('#setupStatus'),e.message||String(e),true)}
}
async function handleSessionChange(){
  state.selectedSessionId=$('#sessionSelect').value||'__new__';syncNewSessionFields();setStatus($('#setupStatus'),'Chargement…');
  try{await Promise.all([loadAttendance(state.selectedSessionId),loadPeriods(state.selectedSessionId)]);$('#periodLabel').value=suggestedPeriodLabel();setStatus($('#setupStatus'),'Prêt.')}catch(e){setStatus($('#setupStatus'),e.message||String(e),true)}
}
async function ensureTeam(name){
  const {data:found,error}=await db.from('teams').select('id').eq('workspace_id',state.workspaceId).eq('name',name).limit(1);if(error)throw error;if(found?.length)return found[0].id;
  const {data,error:insertError}=await db.from('teams').insert({workspace_id:state.workspaceId,name}).select('id').single();if(insertError)throw insertError;return data.id;
}
async function createQuickTrainingSession(){
  const group=groupById(state.selectedGroupId);if(!group)throw new Error('Choisis un groupe.');
  const teamId=await ensureTeam(group.name);
  const label=$('#newSessionLabel').value.trim()||'Entraînement';
  const payload={workspace_id:state.workspaceId,group_id:group.id,team_id:teamId,trained_on:$('#newSessionDate').value||today(),label,theme:label,created_by:state.user.id,updated_by:state.user.id};
  const {data,error}=await db.from('training_sessions').insert(payload).select('id,group_id,trained_on,label,theme,created_at').single();if(error)throw error;
  state.sessions.unshift(data);state.selectedSessionId=data.id;state.currentSession=data;
  const sel=$('#sessionSelect'),o=document.createElement('option');o.value=data.id;o.textContent=`${fmtDate(data.trained_on)} · ${data.theme||data.label}`;sel.append(o);sel.value=data.id;syncNewSessionFields();return data;
}
function currentPeriodTeamSnapshot(){
  const snapshot={};
  state.players.forEach(player=>{
    if(!state.attendance.has(player.id))return;
    snapshot[player.id]=teamForPlayer(player.id);
  });
  return snapshot;
}

function applyPeriodTeamSnapshot(snapshot){
  const validPlayerIds=new Set(state.players.map(player=>player.id));
  const attendance=new Set();
  const teams=new Map();

  if(snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)){
    Object.entries(snapshot).forEach(([playerId,value])=>{
      if(!validPlayerIds.has(playerId))return;
      attendance.add(playerId);
      const team=normalizeTeamColor(value);
      if(team)teams.set(playerId,team);
    });
  }

  state.attendance=attendance;
  state.teamByPlayer=teams;
}

async function persistCurrentPeriodTeamSnapshot(){
  if(!state.currentPeriod?.id)return;
  const snapshot=currentPeriodTeamSnapshot();
  const {data,error}=await db.from('training_live_periods')
    .update({team_assignments:snapshot,updated_at:new Date().toISOString()})
    .eq('id',state.currentPeriod.id)
    .select('team_assignments,updated_at')
    .single();
  if(error)throw error;
  Object.assign(state.currentPeriod,data);
}

async function restorePeriodTeamSnapshot(period){
  if(period?.team_assignments!==null&&period?.team_assignments!==undefined){
    applyPeriodTeamSnapshot(period.team_assignments);
    renderAttendance();
    return;
  }

  const [{data:attendance,error:attendanceError},{data:events,error:eventsError}]=await Promise.all([
    db.from('training_attendance').select('player_id,present,team_color').eq('session_id',period.session_id),
    db.from('training_live_events')
      .select('player_id,attribution_type,team_color,occurred_at,created_at')
      .eq('period_id',period.id)
      .order('occurred_at',{ascending:true})
      .order('created_at',{ascending:true})
  ]);
  if(attendanceError)throw attendanceError;
  if(eventsError)throw eventsError;

  const snapshot={};
  (attendance||[]).forEach(row=>{
    if(row.present)snapshot[row.player_id]=normalizeTeamColor(row.team_color);
  });
  (events||[]).forEach(event=>{
    if(event.attribution_type!=='player'||!event.player_id)return;
    const team=normalizeTeamColor(event.team_color);
    if(team)snapshot[event.player_id]=team;
  });

  applyPeriodTeamSnapshot(snapshot);

  const {data,error}=await db.from('training_live_periods')
    .update({team_assignments:snapshot,updated_at:new Date().toISOString()})
    .eq('id',period.id)
    .select('team_assignments,updated_at')
    .single();
  if(error)throw error;
  Object.assign(period,data);
  renderAttendance();
}

async function saveAttendance(sessionId){
  const rows=state.players.map(p=>({session_id:sessionId,player_id:p.id,present:state.attendance.has(p.id),team_color:state.attendance.has(p.id)?teamForPlayer(p.id):null}));if(!rows.length)return;
  const {error}=await db.from('training_attendance').upsert(rows,{onConflict:'session_id,player_id'});if(error)throw error;
}
async function startCollection(){
  if(state.saving)return;if(!state.selectedGroupId){setStatus($('#setupStatus'),'Choisis un groupe.',true);return}if(!state.attendance.size){setStatus($('#setupStatus'),'Sélectionne au moins un joueur présent.',true);return}
  state.saving=true;updateStartState();setCloud('Enregistrement…',null);setStatus($('#setupStatus'),'Préparation de la période…');
  try{
    let session=state.selectedSessionId==='__new__'?await createQuickTrainingSession():sessionById(state.selectedSessionId);
    if(!session)throw new Error('Séance introuvable.');state.currentSession=session;
    await saveAttendance(session.id);
    await loadPeriods(session.id);
    const number=nextPeriodNumber(),exerciseId=$('#exerciseSelect').value||null;
    const label=$('#periodLabel').value.trim()||suggestedPeriodLabel();
    const teamAssignments=currentPeriodTeamSnapshot();
    const {data:period,error}=await db.from('training_live_periods').insert({session_id:session.id,group_id:state.selectedGroupId,exercise_id:exerciseId,period_number:number,label,team_assignments:teamAssignments,created_by:state.user.id}).select('*').single();
    if(error)throw error;state.periods.push(period);state.periodCounts[period.id]=0;state.selectedSessionId=session.id;$('#sessionSelect').value=session.id;
    await openPeriod(period);setStatus($('#setupStatus'),'');setCloud('Synchronisé',true);
  }catch(e){setStatus($('#setupStatus'),e.message||String(e),true);setCloud('Erreur',false)}finally{state.saving=false;updateStartState()}
}
async function resumePeriod(periodId){
  const period=state.periods.find(p=>p.id===periodId);if(!period)return;
  state.currentSession=sessionById(period.session_id)||state.currentSession;
  if(!state.currentSession){const {data,error}=await db.from('training_sessions').select('id,group_id,trained_on,label,theme,created_at').eq('id',period.session_id).single();if(error)throw error;state.currentSession=data}
  await restorePeriodTeamSnapshot(period);
  await saveAttendance(period.session_id);
  if(period.ended_at){const {data,error}=await db.from('training_live_periods').update({ended_at:null,updated_at:new Date().toISOString()}).eq('id',period.id).select('*').single();if(error)throw error;Object.assign(period,data)}
  await openPeriod(period);
}
async function openPeriod(period){
  state.currentPeriod=period;state.selectedContext='game_center';state.activeTarget=null;state.faultTarget=null;state.organizingTeams=false;state.organizerPlayerId=null;state.organizerSwapTeam=null;
  $('#collectorExerciseSelect').value=period.exercise_id||'';renderContext();renderClassification();syncFieldToolsMeta();
  await loadPeriodEvents(period.id);renderTargets();renderEvents();
  $('#setupPanel').classList.add('hidden');$('#collectorPanel').classList.remove('hidden');setFieldCollectionMode(true);closeFieldTools();window.scrollTo({top:0,behavior:'instant'});
}
async function loadPeriodEvents(periodId){
  const {data,error}=await db.from('training_live_events')
    .select('id,period_id,session_id,group_id,player_id,attribution_type,team_color,attack_context,result,fault_type,occurred_at,created_by,created_at')
    .eq('period_id',periodId).order('occurred_at',{ascending:true}).order('created_at',{ascending:true});
  if(error)throw error;state.events=data||[];
}
function renderClassification(){
  const p=state.currentPeriod,s=state.currentSession;if(!p||!s)return;const ex=exerciseById(p.exercise_id);
  $('#collectorTitle').textContent=p.label;$('#collectorSessionMeta').textContent=`${fmtDate(s.trained_on)} · ${s.theme||s.label||'Entraînement'} · période ${p.period_number}`;
  $('#classificationLine').innerHTML=ex?`Exercice : <strong>${escapeHtml(ex.name)}</strong>`:'<span class="classTag unassigned">À classer · aucune association d’exercice</span>';
  fillExerciseSelect($('#collectorExerciseSelect'),p.exercise_id||'');
}
async function saveClassification(){
  if(!state.currentPeriod)return;const exerciseId=$('#collectorExerciseSelect').value||null;setStatus($('#classificationStatus'),'Enregistrement…');
  const {data,error}=await db.from('training_live_periods').update({exercise_id:exerciseId,updated_at:new Date().toISOString()}).eq('id',state.currentPeriod.id).select('*').single();
  if(error){setStatus($('#classificationStatus'),error.message||String(error),true);return}Object.assign(state.currentPeriod,data);renderClassification();setStatus($('#classificationStatus'),exerciseId?'Association enregistrée.':'Collecte conservée « À classer ».');setCloud('Synchronisé',true)
}
function renderContext(){
  $$('.contextBtn').forEach(b=>{const active=b.dataset.context===state.selectedContext;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));const s=b.querySelector('.contextState');if(s)s.textContent=active?'Sélectionné':'Choisir'});
  $('#currentContextPill').textContent=`Contexte : ${CONTEXT_LABEL[state.selectedContext]||'—'}`;
}
function organizerPlayer(){return state.players.find(p=>p.id===state.organizerPlayerId)||null}
function organizerTeamCount(team){return teamPlayers(team).length}
function renderTeamOrganizer(){
  const bar=$('#teamOrganizerBar'),button=$('#organizeTeams');if(!bar||!button)return;
  bar.classList.toggle('hidden',!state.organizingTeams);button.textContent=state.organizingTeams?'Terminer':'Organiser';button.classList.toggle('active',state.organizingTeams);
  TEAM_ORDER.forEach(team=>{const count=organizerTeamCount(team),el=bar.querySelector(`[data-team-count="${team}"]`);if(el)el.textContent=`${count}/4`});
  const player=organizerPlayer(),selection=$('#teamOrganizerSelection'),hint=$('#teamOrganizerHint');
  const free=unassignedPlayers(),freeSelect=$('#unassignedPlayerSelect');
  if(freeSelect){
    const selectedFree=player&&!teamForPlayer(player.id)?player.id:'';
    freeSelect.innerHTML=free.length
      ? `<option value="">Choisir un joueur non affecté…</option>${free.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.display_name)}</option>`).join('')}`
      : '<option value="">Aucun joueur non affecté</option>';
    freeSelect.disabled=!state.organizingTeams||!free.length;
    freeSelect.value=selectedFree;
    freeSelect.onchange=e=>{
      state.organizerPlayerId=e.target.value||null;state.organizerSwapTeam=null;state.activeTarget=null;state.faultTarget=null;renderTargets();
    };
  }
  if(!state.organizingTeams){if(selection)selection.textContent='Mode organisation';if(hint)hint.textContent='Touchez un joueur sur le terrain, ou choisissez un joueur hors terrain.';return}
  if(state.organizerSwapTeam&&player){
    if(selection)selection.textContent=`${player.display_name} → ${TEAM_META[state.organizerSwapTeam].label}`;
    if(hint)hint.textContent='Équipe pleine : touchez le joueur avec lequel faire l’échange.';
    return;
  }
  if(player){
    if(selection)selection.textContent=`${player.display_name} sélectionné`;
    if(hint)hint.textContent=teamForPlayer(player.id)?'Choisissez Bleu, Gris, Noir ou Non affecté.':'Choisissez Bleu, Gris ou Noir pour faire entrer ce joueur.';
  }else{
    if(selection)selection.textContent='Mode organisation';
    if(hint)hint.textContent=free.length?'Touchez un joueur sur le terrain, ou choisissez un joueur hors terrain dans la liste.':'Touchez un joueur sur le terrain pour le déplacer ou le sortir.';
  }
}
function setTeamOrganizerMode(enabled){
  state.organizingTeams=!!enabled;state.organizerPlayerId=null;state.organizerSwapTeam=null;state.activeTarget=null;state.faultTarget=null;
  renderTeamOrganizer();renderTargets();
}
async function persistLiveTeamAssignments(playerIds){
  if(!state.currentSession?.id)return;
  const ids=[...new Set((playerIds||[]).filter(Boolean))];if(!ids.length)return;
  const rows=ids.map(id=>({session_id:state.currentSession.id,player_id:id,present:state.attendance.has(id),team_color:teamForPlayer(id)}));
  const {error}=await db.from('training_attendance').upsert(rows,{onConflict:'session_id,player_id'});if(error)throw error;
  await persistCurrentPeriodTeamSnapshot();
}
async function moveOrganizerPlayer(destination){
  const player=organizerPlayer();if(!player)return;
  const targetTeam=normalizeTeamColor(destination);const sourceTeam=teamForPlayer(player.id);
  if(targetTeam===sourceTeam){state.organizerPlayerId=null;state.organizerSwapTeam=null;renderTeamOrganizer();renderTargets();return}
  if(targetTeam&&organizerTeamCount(targetTeam)>=4){state.organizerSwapTeam=targetTeam;renderTeamOrganizer();renderTargets();return}
  state.teamByPlayer.set(player.id,targetTeam);
  await persistLiveTeamAssignments([player.id]);
  state.organizerPlayerId=null;state.organizerSwapTeam=null;renderTeamOrganizer();renderTargets();setStatus($('#saveStatus'),`${player.display_name} → ${targetTeam?TEAM_META[targetTeam].label:'Non affecté'}`);
}
async function handleOrganizerPlayerTap(playerId){
  const player=state.players.find(p=>p.id===playerId);if(!player)return;
  if(state.organizerSwapTeam&&state.organizerPlayerId){
    if(playerId===state.organizerPlayerId)return;
    if(teamForPlayer(playerId)!==state.organizerSwapTeam){state.organizerPlayerId=playerId;state.organizerSwapTeam=null;renderTeamOrganizer();renderTargets();return}
    const selectedId=state.organizerPlayerId,sourceTeam=teamForPlayer(selectedId),targetTeam=state.organizerSwapTeam;
    state.teamByPlayer.set(selectedId,targetTeam);state.teamByPlayer.set(playerId,sourceTeam);
    await persistLiveTeamAssignments([selectedId,playerId]);
    const selectedName=state.players.find(p=>p.id===selectedId)?.display_name||'Joueur';
    state.organizerPlayerId=null;state.organizerSwapTeam=null;renderTeamOrganizer();renderTargets();setStatus($('#saveStatus'),`${selectedName} ↔ ${player.display_name}`);
    return;
  }
  state.organizerPlayerId=state.organizerPlayerId===playerId?null:playerId;state.organizerSwapTeam=null;renderTeamOrganizer();renderTargets();
}
function targetFromKey(key){
  if(key.startsWith('collective:')){
    const team=normalizeTeamColor(key.slice('collective:'.length));return team?{key,type:'collective',id:null,team,name:`Collectif ${TEAM_META[team].short.toLowerCase()}`}:null;
  }
  const id=key.replace(/^player:/,'');const p=state.players.find(x=>x.id===id);
  return p?{key,type:'player',id:p.id,team:teamForPlayer(p.id),name:p.display_name}:null;
}
function targetEvents(t){
  return state.events.filter(e=>t.type==='collective'
    ? e.attribution_type==='collective'&&normalizeTeamColor(e.team_color)===t.team
    : e.attribution_type==='player'&&e.player_id===t.id);
}
function targetStats(t){
  const events=targetEvents(t);
  return {n:events.length,point:events.filter(e=>e.result==='point').length,defended:events.filter(e=>e.result==='defended').length,fault:events.filter(e=>e.result==='fault').length};
}
function targetStatsHtml(t){
  const s=targetStats(t);return `<div class="targetLiveStats"><span><strong>N</strong> ${s.n}</span><span><strong>Pt</strong> ${s.point}</span><span><strong>Déf</strong> ${s.defended}</span><span><strong>Fa</strong> ${s.fault}</span></div>`;
}
function targetCardHtml(t){
  const active=state.activeTarget?.key===t.key;
  const selectedForMove=state.organizingTeams&&t.type==='player'&&state.organizerPlayerId===t.id;
  const swapCandidate=state.organizingTeams&&state.organizerSwapTeam&&t.type==='player'&&teamForPlayer(t.id)===state.organizerSwapTeam&&t.id!==state.organizerPlayerId;
  const organizerClass=selectedForMove?' organizerSelected':swapCandidate?' organizerSwapCandidate':state.organizingTeams&&t.type==='player'?' organizerSelectable':'';
  const teamClass=t.team?` team-${t.team}`:'';
  if(active){
    return `<div class="targetCard activeTarget${teamClass}${organizerClass}" data-expanded-target="${escapeHtml(t.key)}" aria-label="Issue pour ${escapeHtml(t.name)}"><div class="inlineOutcomeGrid"><button class="outcomeBtn point" type="button" data-outcome="point" aria-label="Point" ${state.saving?'disabled':''}>Pt</button><button class="outcomeBtn defended" type="button" data-outcome="defended" aria-label="Défendu" ${state.saving?'disabled':''}>Déf</button><button class="outcomeBtn fault" type="button" data-outcome="fault" aria-label="Faute" ${state.saving?'disabled':''}>Fa</button></div></div>`;
  }
  return `<div class="targetCard${teamClass}${organizerClass}"><button class="targetButton ${t.type==='collective'?'collective':''}" type="button" data-target-key="${escapeHtml(t.key)}"><span class="targetName">${t.type==='collective'?'👥 ':''}${escapeHtml(t.name)}</span>${targetStatsHtml(t)}</button></div>`;
}
function closeFaultPanel(cancelTarget=false){
  state.faultTarget=null;
  if(cancelTarget)state.activeTarget=null;
  if(cancelTarget)renderTargets();else renderFaultPanel();
}
function renderFaultPanel(){
  const overlay=$('#faultOverlay'),grid=$('#faultPanelGrid'),targetLabel=$('#faultPanelTarget');
  if(!overlay||!grid||!targetLabel)return;
  const target=state.faultTarget;
  if(!target){
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden','true');
    grid.innerHTML='';
    targetLabel.textContent='';
    return;
  }
  targetLabel.textContent=target.name;
  grid.innerHTML=FAULT_TYPES.map(f=>`<button class="faultPanelBtn" type="button" data-panel-fault="${escapeHtml(f)}" ${state.saving?'disabled':''}>${escapeHtml(f)}</button>`).join('');
  grid.querySelectorAll('[data-panel-fault]').forEach(b=>b.onclick=()=>{
    if(state.saving||!state.activeTarget)return;
    saveEvent('fault',b.dataset.panelFault).catch(showFatal);
  });
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden','false');
}
function teamSummary(team){
  const events=state.events.filter(e=>normalizeTeamColor(e.team_color)===team);
  const points=events.filter(e=>e.result==='point').length,defended=events.filter(e=>e.result==='defended').length,faults=events.filter(e=>e.result==='fault').length;
  return `N ${events.length} · Pt ${points} · Déf ${defended} · Fa ${faults}`;
}
function renderTargets(){
  const box=$('#targetGrid'),activeTeams=TEAM_ORDER.filter(team=>teamPlayers(team).length);box.dataset.teamCount=String(Math.max(1,activeTeams.length));
  const teamSections=TEAM_ORDER.map(team=>{
    const players=teamPlayers(team);
    if(!players.length)return '';
    const collective={key:`collective:${team}`,type:'collective',id:null,team,name:`Collectif ${TEAM_META[team].short.toLowerCase()}`};
    const playerTargets=players.map(p=>({key:`player:${p.id}`,type:'player',id:p.id,team,name:p.display_name}));
    return `<section class="teamBoard team-${team}"><div class="teamBoardHead"><div><strong>${escapeHtml(TEAM_META[team].label)}</strong><span>${players.length} ${plural(players.length,'joueur')}</span></div><span class="teamBoardStats">${teamSummary(team)}</span></div><div class="teamCollectiveRow">${targetCardHtml(collective)}</div><div class="teamPlayersGrid">${playerTargets.map(targetCardHtml).join('')}</div></section>`;
  }).join('');
  box.innerHTML=teamSections||'<div class="fieldNoTeam"><strong>Aucun joueur sur le terrain</strong><span>Utilisez « Organiser » puis choisissez un joueur hors terrain.</span></div>';
  box.querySelectorAll('[data-target-key]').forEach(b=>b.onclick=()=>{
    if(state.saving)return;const target=targetFromKey(b.dataset.targetKey);if(!target)return;
    if(state.organizingTeams){if(target.type==='player')handleOrganizerPlayerTap(target.id).catch(showFatal);return}
    state.activeTarget=target;state.faultTarget=null;renderTargets();
  });
  box.querySelectorAll('[data-cancel-target]').forEach(b=>b.onclick=()=>{state.activeTarget=null;state.faultTarget=null;renderTargets()});
  box.querySelectorAll('[data-outcome]').forEach(b=>b.onclick=()=>{if(state.saving||state.organizingTeams||!state.activeTarget)return;if(b.dataset.outcome==='fault'){state.faultTarget={...state.activeTarget};renderFaultPanel()}else saveEvent(b.dataset.outcome,null).catch(showFatal)});
  renderTeamOrganizer();renderFaultPanel();
}

async function saveEvent(result,faultType){
  if(!state.currentPeriod||!state.currentSession||!state.activeTarget)return;const target={...state.activeTarget},context=state.selectedContext;state.saving=true;renderTargets();setStatus($('#saveStatus'),'Enregistrement…');setCloud('Enregistrement…',null);
  try{
    const payload={period_id:state.currentPeriod.id,session_id:state.currentSession.id,group_id:state.currentPeriod.group_id,player_id:target.type==='player'?target.id:null,attribution_type:target.type,team_color:normalizeTeamColor(target.team),result,attack_context:context,fault_type:result==='fault'?faultType:null,created_by:state.user.id};
    const {data,error}=await db.from('training_live_events').insert(payload).select('id,period_id,session_id,group_id,player_id,attribution_type,team_color,attack_context,result,fault_type,occurred_at,created_by,created_at').single();
    if(error)throw error;state.events.push(data);state.periodCounts[state.currentPeriod.id]=(state.periodCounts[state.currentPeriod.id]||0)+1;state.activeTarget=null;state.faultTarget=null;renderTargets();renderEvents();setStatus($('#saveStatus'),`${target.name} · ${CONTEXT_LABEL[context]} → ${RESULT_LABEL[result]}${faultType?' · '+faultType:''}`);setCloud('Synchronisé',true);
  }catch(e){setStatus($('#saveStatus'),e.message||String(e),true);setCloud('Erreur',false)}finally{state.saving=false;renderTargets()}
}
function playerName(id){return state.players.find(p=>p.id===id)?.display_name||'Joueur'}
function eventTargetLabel(e){const team=normalizeTeamColor(e.team_color);return e.attribution_type==='collective'?`Collectif${team?' '+TEAM_META[team].short.toLowerCase():''}`:playerName(e.player_id)}
function eventResultLabel(e){return e.result==='fault'?`Faute · ${e.fault_type||'non précisée'}`:RESULT_LABEL[e.result]||e.result}
function lastOwnEvent(){return [...state.events].reverse().find(e=>e.created_by===state.user.id)||null}
function renderEvents(){
  const total=state.events.length,points=state.events.filter(e=>e.result==='point').length,defended=state.events.filter(e=>e.result==='defended').length,faults=state.events.filter(e=>e.result==='fault').length;
  $('#metricTotal').textContent=total;$('#metricPoints').textContent=total?`${points} · ${Math.round(100*points/total)}%`:points;$('#metricDefended').textContent=total?`${defended} · ${Math.round(100*defended/total)}%`:defended;$('#metricFaults').textContent=total?`${faults} · ${Math.round(100*faults/total)}%`:faults;
  const last=state.events.at(-1);$('#lastEntry').textContent=last?`${eventTargetLabel(last)} · ${CONTEXT_LABEL[last.attack_context]} → ${eventResultLabel(last)}`:'—';
  const own=lastOwnEvent();$('#undoLast').disabled=!own;$('#historyCount').textContent=`${total} ${plural(total,'action')}`;
  const rows=[...state.events].reverse().slice(0,30);$('#historyList').innerHTML=rows.length?rows.map(e=>`<div class="historyRow"><div class="time">${escapeHtml(fmtTime(e.occurred_at||e.created_at))}</div><div class="target">${e.attribution_type==='collective'?'👥 ':''}${escapeHtml(eventTargetLabel(e))}</div><div class="context">${escapeHtml(CONTEXT_LABEL[e.attack_context]||e.attack_context)}</div><div class="result">${escapeHtml(eventResultLabel(e))}</div></div>`).join(''):'<div class="historyEmpty">Aucune saisie dans cette période.</div>';
}
async function undoLast(){
  const e=lastOwnEvent();if(!e)return;$('#undoLast').disabled=true;setStatus($('#saveStatus'),'Annulation…');
  const {error}=await db.from('training_live_events').delete().eq('id',e.id);if(error){setStatus($('#saveStatus'),error.message||String(error),true);renderEvents();return}
  state.events=state.events.filter(x=>x.id!==e.id);state.periodCounts[state.currentPeriod.id]=Math.max(0,(state.periodCounts[state.currentPeriod.id]||1)-1);renderTargets();renderEvents();setStatus($('#saveStatus'),'Dernière saisie annulée.');setCloud('Synchronisé',true)
}
async function finishPeriod(){
  if(!state.currentPeriod)return;const {data,error}=await db.from('training_live_periods').update({ended_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',state.currentPeriod.id).select('*').single();
  if(error){setStatus($('#saveStatus'),error.message||String(error),true);return}Object.assign(state.currentPeriod,data);setStatus($('#saveStatus'),'Période terminée.');await returnToSetup();
}
async function returnToSetup(){
  closeFieldTools();setFieldCollectionMode(false);$('#collectorPanel').classList.add('hidden');$('#setupPanel').classList.remove('hidden');state.activeTarget=null;state.faultTarget=null;state.organizingTeams=false;state.organizerPlayerId=null;state.organizerSwapTeam=null;
  if(state.currentSession?.id){
    state.selectedSessionId=state.currentSession.id;
    $('#sessionSelect').value=state.currentSession.id;
    state.teamByPlayer=new Map();
    syncNewSessionFields();
    renderTeamSetup();
    await loadPeriods(state.currentSession.id);
  }
  window.scrollTo({top:0,behavior:'instant'});
}
function showFatal(error){console.error(error);setCloud('Erreur',false);setStatus($('#saveStatus'),error?.message||String(error),true);setStatus($('#setupStatus'),error?.message||String(error),true)}

$('#groupSelect').onchange=()=>handleGroupChange();
$('#sessionSelect').onchange=()=>handleSessionChange();
$('#selectAllPlayers').onclick=()=>{state.attendance=new Set(state.players.map(p=>p.id));renderAttendance()};
$('#clearAllPlayers').onclick=()=>{state.attendance.clear();state.teamByPlayer.clear();renderAttendance()};
$('#autoAssignTeams').onclick=()=>autoAssignTeams();
$('#organizeTeams').onclick=()=>setTeamOrganizerMode(!state.organizingTeams);
$$('[data-team-destination]').forEach(b=>b.onclick=()=>{if(state.organizingTeams)moveOrganizerPlayer(b.dataset.teamDestination).catch(showFatal)});
$('#exerciseSelect').onchange=()=>{$('#periodLabel').value=suggestedPeriodLabel()};
$('#startCollection').onclick=()=>startCollection();
$('#refreshPeriods').onclick=()=>loadPeriods(state.selectedSessionId).catch(showFatal);
$$('.contextBtn').forEach(b=>b.onclick=()=>{state.selectedContext=b.dataset.context;renderContext()});
let cancelActiveTargetOnClick=false;
$('#collectorPanel').addEventListener('pointerdown',e=>{
  cancelActiveTargetOnClick=!!state.activeTarget
    && !state.saving
    && !state.organizingTeams
    && !e.target.closest('[data-expanded-target]')
    && !e.target.closest('.faultPanel')
    && !e.target.closest('.teamBoardHead');
});
$('#collectorPanel').addEventListener('click',()=>{
  if(!cancelActiveTargetOnClick)return;
  cancelActiveTargetOnClick=false;
  if(!state.activeTarget)return;
  state.activeTarget=null;state.faultTarget=null;renderTargets();
});
$('#undoLast').onclick=()=>undoLast().catch(showFatal);
$('#finishPeriod').onclick=()=>finishPeriod().catch(showFatal);
$('#backToSetup').onclick=()=>returnToSetup().catch(showFatal);
$('#saveClassification').onclick=()=>saveClassification().catch(showFatal);
$('#fieldToolsToggle').onclick=()=>document.body.classList.contains('fieldToolsOpen')?closeFieldTools():openFieldTools();
$('#fieldToolsClose').onclick=()=>closeFieldTools();
$('#fieldToolsBackdrop').onclick=()=>closeFieldTools();
$('#faultPanelClose').onclick=()=>closeFaultPanel(false);
$('#faultOverlay').onclick=e=>{if(e.target===$('#faultOverlay'))closeFaultPanel(true)};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('fieldToolsOpen'))closeFieldTools()});
initFieldToolsDrawer();

(async()=>{
  try{
    $('#newSessionDate').value=today();setCloud('Connexion…',null);
    const {data:{session}}=await db.auth.getSession();if(!session?.user){location.href='index.html';return}state.user=session.user;
    await Promise.all([loadWorkspace(),loadGroups(),loadExercises()]);
    if(!state.groups.length){setStatus($('#setupStatus'),'Aucun groupe entraîneur n’est associé à ce compte.',true);setCloud('Connecté',true);return}
    if(!state.selectedGroupId){$('#groupSelect').value=state.groups[0].id;state.selectedGroupId=state.groups[0].id}
    await handleGroupChange();renderContext();setCloud('Synchronisé',true);
  }catch(e){showFatal(e)}
})();

/* player-portal. Shared explicit application context; no startup side effects. */
((app) => {
app.enterMyPlayerPortal = async function enterMyPlayerPortal(){
  // Toujours relire les accès réellement liés au compte courant.
  // Une consultation staff d'une fiche joueur utilise un accès temporaire et ne doit jamais
  // devenir l'espace joueur personnel de l'entraîneur.
  const accesses=await app.fetchMyPlayerAccesses();
  if(!accesses.length){alert("Aucun espace joueur n'est lié à ce compte.");return false}
  app.playerPortalState.staffPreview=false;
  app.playerPortalState.staffPlayerId=null;
  app.playerPortalState.staffReturnGroupId=null;
  app.playerPortalState.hasStaffAccess=app.groupState.groups.length>0;
  await app.openPlayerPortal(accesses);
  return true;
};

app.returnToStaffSpace = async function returnToStaffSpace(){
  const returnGroupId=app.playerPortalState.staffPreview?app.playerPortalState.staffReturnGroupId:null;
  app.playerPortalState.staffPreview=false;
  app.playerPortalState.staffPlayerId=null;
  app.playerPortalState.staffReturnGroupId=null;
  app.hideMainModules();
  app.$('#playerPortal').classList.add('hidden');
  app.$('#homeBtn').classList.remove('hidden');
  app.$('#profileBtn').classList.remove('hidden');
  app.$('#playerSpaceBtn').classList.toggle('hidden',!(app.playerPortalState.accesses||[]).length);
  app.$('#logout').classList.remove('hidden');
  app.$('#newMatchTop').classList.add('hidden');
  app.setMatchHeaderMode(false);
  app.setCloud('Synchronisé',true);
  if(returnGroupId){await app.openGroupDetail(returnGroupId);return}
  app.$('#appHome').classList.remove('hidden');
  window.scrollTo({top:0,behavior:'instant'});
};

app.playerPortalSetView = function playerPortalSetView(view){
  app.playerPortalState.view=view||'home';
  const views={home:'#playerPortalHomeView',stats:'#playerPortalStatsView',profile:'#playerPortalProfileView'};
  Object.entries(views).forEach(([k,sel])=>app.$(sel)?.classList.toggle('hidden',k!==app.playerPortalState.view));
  const nav={home:'#playerPortalNavHome',stats:'#playerPortalNavStats',profile:'#playerPortalNavProfile'};
  Object.entries(nav).forEach(([k,sel])=>app.$(sel)?.classList.toggle('active',k===app.playerPortalState.view));
  window.scrollTo({top:0,behavior:'instant'});
};

app.syncStandaloneVideoLinks = function syncStandaloneVideoLinks(){
  const groupId=app.playerPortalState.groupId;
  const playerId=app.playerPortalTargetPlayerId();
  const suffix=app.playerPortalState.staffPreview&&groupId&&playerId
    ?`?group=${encodeURIComponent(groupId)}&player=${encodeURIComponent(playerId)}`
    :(groupId?`?group=${encodeURIComponent(groupId)}`:'');
  const videoHref=`videos.html${suffix}`;
  const statsHref=`player-stats.html${suffix}`;
  const navVideo=app.$('#playerPortalNavVideos'),cardVideo=app.$('#playerPortalHomeVideosCard');
  const navStats=app.$('#playerPortalNavStats'),cardStats=app.$('#playerPortalHomeStatsCard');
  if(navVideo)navVideo.href=videoHref;
  if(cardVideo)cardVideo.href=videoHref;
  if(navStats)navStats.href=statsHref;
  if(cardStats)cardStats.href=statsHref;
  const navGroupStats=app.$('#playerPortalNavGroupStats'),cardGroupStats=app.$('#playerPortalHomeGroupStatsCard');
  if(navGroupStats)navGroupStats.href='index.html#team-stats';
  if(cardGroupStats)cardGroupStats.href='index.html#team-stats';
};

app.refreshPlayerPortalIdentity = function refreshPlayerPortalIdentity(){
  const access=app.playerPortalAccessForGroup(app.playerPortalState.groupId)||app.playerPortalState.accesses?.[0];
const player=access?.player_name||'';
  const group=access?.group_name||'';
  if(app.$('#playerPortalHomeTitle'))app.$('#playerPortalHomeTitle').textContent=player?`Bonjour ${player}`:'Bienvenue';
  if(app.$('#playerPortalHomeSubtitle'))app.$('#playerPortalHomeSubtitle').textContent=group;
  if(app.$('#playerPortalProfileSubtitle'))app.$('#playerPortalProfileSubtitle').textContent=group;
};

app.playerPortalAccessForGroup = function playerPortalAccessForGroup(groupId){return (app.playerPortalState.accesses||[]).find(a=>a.group_id===groupId)||null};

app.playerPortalCanViewGroupStats = function playerPortalCanViewGroupStats(access=app.playerPortalAccessForGroup(app.playerPortalState.groupId)){return access?.stats_access==='group'};

app.syncPlayerPortalGroupStatsAccess = function syncPlayerPortalGroupStatsAccess(){
  const access=app.playerPortalAccessForGroup(app.playerPortalState.groupId)||app.playerPortalState.accesses?.[0];
  const allowed=app.playerPortalCanViewGroupStats(access);
  app.$('#playerPortalNavGroupStats')?.classList.toggle('hidden',!allowed);
  app.$('#playerPortalHomeGroupStatsCard')?.classList.toggle('hidden',!allowed);
};

app.statsGroupMeta = function statsGroupMeta(groupId){
  const coachGroup=app.groupState.groups.find(g=>g.id===groupId);
  if(coachGroup)return coachGroup;
  const access=(app.playerPortalState.accesses||[]).find(a=>a.group_id===groupId);
  return access?{id:access.group_id,name:access.group_name,role:'viewer'}:null;
};

app.playerPortalTargetPlayerId = function playerPortalTargetPlayerId(){return app.playerPortalState.staffPreview?app.playerPortalState.staffPlayerId:(app.playerPortalAccessForGroup(app.playerPortalState.groupId)?.player_id||null)};

app.playerPortalMetricsArgs = function playerPortalMetricsArgs(groupId,matchIds,scope){
  return {p_group_id:groupId,p_match_ids:matchIds,p_scope:scope,p_player_id:app.playerPortalState.staffPreview?app.playerPortalState.staffPlayerId:null};
};

app.playerPortalConversationDate = function playerPortalConversationDate(v){
  if(!v)return '';
  try{return new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return String(v)}
};

app.playerPortalConversationHtml = function playerPortalConversationHtml(rows){
  if(!rows?.length)return '<div class="playerPortalConversationEmpty">Aucun message pour le moment.</div>';
  const ownRole=app.playerPortalState.staffPreview?'coach':'player';
  return rows.map(r=>{
    const mine=(r.sender_role||'coach')===ownRole;
    const who=mine?'Moi':(r.author_name||((r.sender_role||'coach')==='player'?'Joueur':'Entraîneur'));
    const unread=!mine&&r.is_read===false;
    const readState=mine?`<span class="playerPortalMessageReadState">${r.recipient_read?'Lu':'Envoyé'}</span>`:'';
    return `<div class="playerPortalMessageRow ${mine?'mine':''} ${unread?'unread':''}"><div class="playerPortalMessageBubble"><div class="playerPortalMessageMeta">${app.escapeHtml(who)} · ${app.escapeHtml(app.playerPortalConversationDate(r.created_at))}${unread?' · Nouveau':''}${readState}</div><div class="playerPortalMessageText">${app.escapeHtml(r.message||'')}</div></div></div>`;
  }).join('');
};

app.playerObjectiveDate = function playerObjectiveDate(v){
  if(!v)return '';
  try{return new Date(v).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})}catch{return String(v)}
};

app.playerObjectiveItemHtml = function playerObjectiveItemHtml(o,isCompleted=false){
  const source=o.source==='player'?'player':'coach';
  const sourceLabel=source==='player'?'Objectif personnel':'Objectif coach';
  const canEditPersonal=!app.playerPortalState.staffPreview&&source==='player';
  const canEditCoach=app.playerPortalState.staffPreview&&source==='coach';
  const actions=[];
  if(canEditCoach)actions.push(`<button type="button" class="ghost" data-objective-action="${isCompleted?'reopen':'complete'}" data-objective-id="${app.escapeHtml(o.id)}">${isCompleted?'Réouvrir':'Marquer atteint'}</button>`);
  if(canEditPersonal){
    actions.push(`<button type="button" class="ghost" data-objective-action="${isCompleted?'reopen':'complete'}" data-objective-id="${app.escapeHtml(o.id)}">${isCompleted?'Réouvrir':'Marquer atteint'}</button>`);
    actions.push(`<button type="button" class="ghost" data-objective-action="edit" data-objective-id="${app.escapeHtml(o.id)}" data-objective-text="${app.escapeHtml(o.objective||'')}">Modifier</button>`);
    actions.push(`<button type="button" class="ghost" data-objective-action="delete" data-objective-id="${app.escapeHtml(o.id)}">Supprimer</button>`);
  }
  return `<div class="playerObjectiveItem ${isCompleted?'completed':''}">
    <div class="playerObjectiveText"><strong>${app.escapeHtml(o.objective||'')}</strong><div class="playerObjectiveMeta">${app.escapeHtml(sourceLabel)} · ${isCompleted?`Atteint le ${app.escapeHtml(app.playerObjectiveDate(o.completed_at))}`:`Ajouté le ${app.escapeHtml(app.playerObjectiveDate(o.created_at))}${o.created_by_name?' · '+app.escapeHtml(o.created_by_name):''}`}</div></div>
    ${actions.length?`<div class="playerObjectiveActions">${actions.join('')}</div>`:''}
  </div>`;
};

app.playerObjectivesHtml = function playerObjectivesHtml(rows){
  const all=rows||[];
  const sections=[
    {source:'coach',title:'Objectifs fixés par le staff'},
    {source:'player',title:'Objectifs personnels'}
  ];
  return sections.map(section=>{
    const active=all.filter(x=>(x.source||'coach')===section.source&&x.status==='active');
    const completed=all.filter(x=>(x.source||'coach')===section.source&&x.status==='completed').slice(0,5);
    let body=active.length?active.map(o=>app.playerObjectiveItemHtml(o,false)).join(''):'<div class="small">Aucun objectif actif.</div>';
    if(completed.length)body+=`<details style="margin-top:6px"><summary class="small">Objectifs atteints (${completed.length})</summary><div class="playerObjectivesList" style="margin-top:8px">${completed.map(o=>app.playerObjectiveItemHtml(o,true)).join('')}</div></details>`;
    return `<div style="display:grid;gap:7px"><div class="analysisSubtle">${section.title}</div>${body}</div>`;
  }).join('<div style="height:10px"></div>');
};

app.loadPlayerObjectives = async function loadPlayerObjectives(){
  const groupId=app.playerPortalState.groupId,playerId=app.playerPortalTargetPlayerId();
  const box=app.$('#playerObjectivesList'),composer=app.$('#playerObjectiveComposer'),hint=app.$('#playerObjectivesHint'),input=app.$('#playerObjectiveInput');
  if(!groupId||!playerId||!box)return;
  if(composer)composer.classList.remove('hidden');
  if(hint)hint.textContent=app.playerPortalState.staffPreview?'3 objectifs coach actifs maximum · les objectifs personnels restent sous le contrôle du joueur.':'Tu peux gérer jusqu’à 3 objectifs personnels, en plus de ceux fixés par le staff.';
  if(input)input.placeholder=app.playerPortalState.staffPreview?'Ajouter un objectif coach…':'Ajouter un objectif personnel…';
  box.innerHTML='<div class="small">Chargement…</div>';
  const {data,error}=await app.db.rpc('get_player_objectives',{p_group_id:groupId,p_player_id:playerId});
  if(error)throw error;
  app.playerPortalState.objectives=data||[];
  box.innerHTML=app.playerObjectivesHtml(data||[]);
  box.querySelectorAll('[data-objective-action]').forEach(b=>b.onclick=()=>app.updatePlayerObjectiveStatus(b.dataset.objectiveId,b.dataset.objectiveAction,b.dataset.objectiveText||''));
};

app.addPlayerObjective = async function addPlayerObjective(){
  const groupId=app.playerPortalState.groupId,playerId=app.playerPortalTargetPlayerId();
  const input=app.$('#playerObjectiveInput'),status=app.$('#playerObjectiveStatus'),button=app.$('#playerObjectiveAdd');
  const objective=(input?.value||'').trim();
  if(!objective||!groupId||!playerId)return;
  button.disabled=true;if(status)status.textContent='Ajout…';
  try{
    const call=app.playerPortalState.staffPreview
      ? app.db.rpc('add_player_objective',{p_group_id:groupId,p_player_id:playerId,p_objective:objective})
      : app.db.rpc('add_my_player_objective',{p_group_id:groupId,p_objective:objective});
    const {error}=await call;
    if(error)throw error;
    input.value='';if(status)status.textContent=app.playerPortalState.staffPreview?'Objectif coach ajouté.':'Objectif personnel ajouté.';
    await app.loadPlayerObjectives();
  }catch(e){
    if(status)status.textContent=e?.message?.includes('Maximum de 3')?'Maximum de 3 objectifs actifs pour cette catégorie.':'Impossible d’ajouter l’objectif.';
    app.handleError('add player objective',e);
  }finally{button.disabled=false}
};

app.updatePlayerObjectiveStatus = async function updatePlayerObjectiveStatus(objectiveId,action,currentText=''){
  if(!objectiveId)return;
  const status=app.$('#playerObjectiveStatus');
  try{
    if(app.playerPortalState.staffPreview){
      if(!['complete','reopen'].includes(action))return;
      const rpc=action==='complete'?'complete_player_objective':'reopen_player_objective';
      const {error}=await app.db.rpc(rpc,{p_group_id:app.playerPortalState.groupId,p_objective_id:objectiveId});
      if(error)throw error;
    }else{
      if(action==='edit'){
        const next=prompt('Modifier ton objectif personnel :',currentText||'');
        if(next===null)return;
        const {error}=await app.db.rpc('update_my_player_objective',{p_group_id:app.playerPortalState.groupId,p_objective_id:objectiveId,p_objective:next});
        if(error)throw error;
      }else if(action==='delete'){
        if(!confirm('Supprimer cet objectif personnel ?'))return;
        const {error}=await app.db.rpc('delete_my_player_objective',{p_group_id:app.playerPortalState.groupId,p_objective_id:objectiveId});
        if(error)throw error;
      }else{
        const rpc=action==='complete'?'complete_my_player_objective':'reopen_my_player_objective';
        const {error}=await app.db.rpc(rpc,{p_group_id:app.playerPortalState.groupId,p_objective_id:objectiveId});
        if(error)throw error;
      }
    }
    if(status)status.textContent='Objectif mis à jour.';
    await app.loadPlayerObjectives();
  }catch(e){
    if(status)status.textContent=e?.message?.includes('Maximum de 3')?'Maximum de 3 objectifs actifs pour cette catégorie.':'Impossible de modifier l’objectif.';
    app.handleError('update player objective',e);
  }
};

app.videoNotificationCountFor = function videoNotificationCountFor(groupId,playerId){
  return (app.videoNotificationState||[]).filter(x=>x.group_id===groupId&&x.player_id===playerId).length;
};

app.renderVideoNotifications = function renderVideoNotifications(){
  const total=(app.videoNotificationState||[]).length;
  ['#videoUnreadBadge','#homeVideoUnreadBadge'].forEach(sel=>{
    const badge=app.$(sel);
    if(badge){badge.textContent=String(total);badge.classList.toggle('hidden',!total)}
  });
  if(app.groupState.currentGroupId&&app.groupState.currentPlayers?.length)app.renderGroupPlayers();
};

app.refreshVideoNotifications = async function refreshVideoNotifications(){
  if(!app.currentUser)return [];
  const {data,error}=await app.db.rpc('get_my_video_notifications');
  if(error)throw error;
  app.videoNotificationState=data||[];app.renderVideoNotifications();return app.videoNotificationState;
};

app.syncPlayerPortalRole = function syncPlayerPortalRole(groupId){const access=app.playerPortalAccessForGroup(groupId);const sel=app.$('#playerPortalRole'),status=app.$('#playerPortalRoleStatus');if(!sel)return;sel.value=access?.preferred_role||'AP';if(status)status.textContent=app.playerPortalState.staffPreview?'Modifiable par l’entraîneur ou le joueur.':'Modifiable par le joueur.'};

app.saveMyPreferredRole = async function saveMyPreferredRole(role){
  const groupId=app.playerPortalState.groupId;if(!groupId)return;
  const status=app.$('#playerPortalRoleStatus');if(status)status.textContent='Enregistrement…';
  if(app.playerPortalState.staffPreview){
    const playerId=app.playerPortalState.staffPlayerId;
    const {error}=await app.db.from('coaching_group_players').update({preferred_role:role}).eq('group_id',groupId).eq('player_id',playerId);
    if(error){if(status)status.textContent='Erreur d’enregistrement';throw error}
    const access=app.playerPortalAccessForGroup(groupId);if(access)access.preferred_role=role;
    const p=app.groupState.currentPlayers.find(x=>x.id===playerId);if(p)p.preferred_role=role;
  }else{
    const {data,error}=await app.db.rpc('set_my_preferred_role',{p_group_id:groupId,p_preferred_role:role});
    if(error){if(status)status.textContent='Erreur d’enregistrement';throw error}
    const access=app.playerPortalAccessForGroup(groupId);if(access)access.preferred_role=data||role;
  }
  if(status)status.textContent='Enregistré';
  setTimeout(()=>{if(status)status.textContent=app.playerPortalState.staffPreview?'Modifiable par l’entraîneur ou le joueur.':'Modifiable par le joueur.'},1400);
};

app.playerPortalEffectiveScope = function playerPortalEffectiveScope(){if(app.playerPortalState.scope!=='restart')return app.playerPortalState.scope||'all';const loc=app.playerPortalState.restartLocation||'all';return loc==='center'?'restart_center':loc==='line'?'restart_line':loc==='corner'?'restart_corner':'restart'};

app.playerPortalScopeLabel = function playerPortalScopeLabel(scope){return scope==='center'?'Jeu au centre':scope==='restart_center'?'Remise en jeu · centre':scope==='restart_line'?'Remise en jeu · ligne':scope==='restart_corner'?'Remise en jeu · coin':scope==='restart'?'Remise en jeu · toutes':'Cumulé'};

app.playerPortalContextLabel = function playerPortalContextLabel(context){return ({game_center:'Jeu au centre',restart_center:'Remise · centre',restart_line:'Remise · ligne',restart_corner:'Remise · coin'})[context]||context};

app.playerPortalNum = function playerPortalNum(v){const n=Number(v);return Number.isFinite(n)?n:null};

app.playerPortalSigned = function playerPortalSigned(v){const n=app.playerPortalNum(v);if(n==null)return '—';const x=Math.round(n*10)/10;return `${x>0?'+':''}${x.toFixed(1).replace('.',',')}`};

app.playerPortalPct = function playerPortalPct(v){const n=app.playerPortalNum(v);if(n==null)return '—';return `${(Math.round(n*10)/10).toFixed(1).replace('.',',')} %`};

app.playerPortalImpactClass = function playerPortalImpactClass(v){const n=app.playerPortalNum(v)||0;return n>.05?'analysisImpactPositive':n<-.05?'analysisImpactNegative':'analysisImpactNeutral'};

app.playerPortalReliability = function playerPortalReliability(n){n=Number(n)||0;if(n<5)return {cls:'low',label:'Très faible'};if(n<=15)return {cls:'limited',label:'Limité'};return {cls:'ok',label:''}};

app.playerPortalTakeawaysHtml = function playerPortalTakeawaysHtml(x,n){
  n=Number(n)||0;
  const creation=app.playerPortalNum(x?.creation100),safety=app.playerPortalNum(x?.safety100);
  const items=[];
  if(n<5){
    items.push('Le volume est trop faible pour interpréter Création et Sécurité comme un niveau établi.');
    items.push('Le principal objectif pour l’instant est d’accumuler davantage d’actions analysées.');
  }else{
    if(n<=15)items.push('Le volume donne une première tendance seulement : quelques actions peuvent encore modifier nettement les scores.');
    const describe=(value,positive,neutral,negative)=>{
      if(value==null)return null;
      if(value>=3)return positive;
      if(value<=-3)return negative;
      return neutral;
    };
    const c=describe(
      creation,
      'Tu marques plus de points que ce que le référentiel prévoit pour les situations que tu as jouées.',
      'Ton nombre de points marqués est proche de ce que le référentiel prévoit pour les situations que tu as jouées.',
      'Tu marques moins de points que ce que le référentiel prévoit pour les situations que tu as jouées.'
    );
    const s=describe(safety,'Ta sécurité offensive est au-dessus du référentiel : tu fais moins de fautes qu’attendu.','Ta sécurité offensive est proche du référentiel sur la sélection actuelle.','La réduction des fautes ressort comme un axe de travail sur la sélection actuelle.');
    if(c)items.push(c);
    if(s)items.push(s);
  }
  return `<div class="playerPortalTakeaways"><h4>À retenir</h4>${items.slice(0,3).map(t=>`<div class="playerPortalTakeawayItem"><span class="playerPortalTakeawayDot"></span><span>${app.escapeHtml(t)}</span></div>`).join('')}</div>`;
};

app.playerVolumeWarningHtml = function playerVolumeWarningHtml(n){n=Number(n)||0;if(n<5)return `<div class="statsImpactVolumeWarning critical"><strong>⚠ Très faible volume (N = ${n}).</strong> Ces scores peuvent varier fortement avec une seule action et ne doivent pas être interprétés comme un niveau établi. Attends davantage d’actions avant d’en tirer une conclusion.</div>`;if(n<=15)return `<div class="statsImpactVolumeWarning"><strong>⚠ Volume encore limité (N = ${n}).</strong> Les scores donnent une première tendance, mais restent sensibles à quelques actions. Interprète-les avec prudence jusqu’à disposer d’un volume plus important.</div>`;return ''};

app.playerPortalRenderMatches = function playerPortalRenderMatches(){const box=app.$('#playerPortalMatches'),status=app.$('#playerPortalSelectionStatus');if(!box)return;const selected=new Set(app.playerPortalState.selected||[]);box.innerHTML=(app.playerPortalState.matches||[]).map(m=>`<label class="playerPortalMatchItem ${selected.has(m.id)?'checked':''}"><input type="checkbox" data-player-match="${app.escapeHtml(m.id)}" ${selected.has(m.id)?'checked':''}><span><strong>${app.escapeHtml(m.label||'Match')}</strong><span class="small">${app.escapeHtml(app.formatDateShort(m.played_on)||'Date ?')}${m.competition?' · '+app.escapeHtml(m.competition):''}</span></span></label>`).join('');if(status)status.textContent=`${selected.size} match${selected.size>1?'s':''} sélectionné${selected.size>1?'s':''}`;box.querySelectorAll('input[data-player-match]').forEach(input=>input.onchange=()=>{const set=new Set(app.playerPortalState.selected||[]);if(input.checked)set.add(input.dataset.playerMatch);else set.delete(input.dataset.playerMatch);app.playerPortalState.selected=[...set];app.playerPortalRenderMatches();app.playerPortalRender().catch(e=>app.handleError('player portal metrics',e))})};

app.playerPortalDetailsHtml = function playerPortalDetailsHtml(details){const map=Object.fromEntries((details||[]).map(d=>[d.context,d]));const contexts=['game_center','restart_center','restart_line','restart_corner'];return `<details class="statsImpactPlayerDetails" open><summary>Détail par situation</summary><div class="analysisSubtle" style="margin:8px 0">Tu peux consulter séparément le jeu au centre et chacune des remises en jeu. La valeur du référentiel est indiquée sous tes taux.</div><div class="analysisTableWrap"><table class="analysisTable"><thead><tr><th>Situation</th><th>N</th><th>% points</th><th>% fautes</th><th>Création /100</th><th>Sécurité /100</th></tr></thead><tbody>${contexts.map(c=>{const d=map[c]||{};const n=Number(d.n)||0;return `<tr><td>${app.escapeHtml(app.playerPortalContextLabel(c))}</td><td>${n}</td><td>${n?`<div>${app.playerPortalPct(d.point_rate)}</div><div class="small">Référentiel ${app.playerPortalPct(d.expected_point_rate)}</div>`:'—'}</td><td>${n?`<div>${app.playerPortalPct(d.fault_rate)}</div><div class="small">Référentiel ${app.playerPortalPct(d.expected_fault_rate)}</div>`:'—'}</td><td class="${app.playerPortalImpactClass(d.creation100)}">${n?app.playerPortalSigned(d.creation100):'—'}</td><td class="${app.playerPortalImpactClass(d.safety100)}">${n?app.playerPortalSigned(d.safety100):'—'}</td></tr>`}).join('')}</tbody></table></div></details>`};

app.playerPortalSheetHtml = function playerPortalSheetHtml(data,allDetails){
  const x=data?.metrics||{},avg=data?.group_average||{},n=Number(x.n)||0;
  const referenceVersion=data?.reference_version||'référence active';
  const rel=app.playerPortalReliability(n);
  return `<div class="statsImpactPlayerSheet"><div class="statsImpactPlayerHeader"><div><div class="analysisSubtle">${app.escapeHtml(app.playerPortalScopeLabel(app.playerPortalEffectiveScope()))}</div><h3>${app.escapeHtml(data.player_name||'')}</h3></div></div>${data?.is_test_mirror?`<div class="playerPortalTestDataNotice">Profil de test : les statistiques affichées sont une copie de celles de ${app.escapeHtml(data.stats_source_player_name||'un joueur source')} afin de tester un profil complet.</div>`:''}<div class="playerPortalExactCounts"><div class="playerPortalExactCount"><span>Nombre de frappes</span><strong>${n}</strong>${rel.label?`<span class="reliability">${app.escapeHtml(rel.label)}</span>`:''}</div><div class="playerPortalExactCount"><span>Points marqués</span><strong>${Number(x.points)||0}</strong></div><div class="playerPortalExactCount"><span>Fautes</span><strong>${Number(x.faults)||0}</strong></div></div>${app.playerVolumeWarningHtml(n)}${app.playerPortalTakeawaysHtml(x,n)}<div class="statsImpactPlayerMainMetrics"><div class="statsImpactPlayerMetric"><span>Création /100</span><strong class="${app.playerPortalImpactClass(x.creation100)}">${n?app.playerPortalSigned(x.creation100):'—'}</strong><small>Moyenne groupe ${app.playerPortalSigned(avg.creation100)}</small></div><div class="statsImpactPlayerMetric"><span>Sécurité /100</span><strong class="${app.playerPortalImpactClass(x.safety100)}">${n?app.playerPortalSigned(x.safety100):'—'}</strong><small>Moyenne groupe ${app.playerPortalSigned(avg.safety100)}</small></div></div><div class="statsImpactPlayerSecondaryMetrics"><div class="statsImpactPlayerSecondary"><span>% points</span><strong>${n?app.playerPortalPct(x.point_rate):'—'}</strong><small>${Number(x.points)||0} point${Number(x.points)===1?'':'s'} marqué${Number(x.points)===1?'':'s'} · Référentiel ${app.playerPortalPct(x.expected_point_rate)} · Moyenne groupe ${app.playerPortalPct(avg.point_rate)}</small></div><div class="statsImpactPlayerSecondary"><span>% fautes</span><strong>${n?app.playerPortalPct(x.fault_rate):'—'}</strong><small>${Number(x.faults)||0} faute${Number(x.faults)===1?'':'s'} · Référentiel ${app.playerPortalPct(x.expected_fault_rate)} · Moyenne groupe ${app.playerPortalPct(avg.fault_rate)}</small></div></div><div class="analysisSubtle statsImpactPlayerBenchmarkNote">La moyenne du groupe est calculée sans afficher les résultats des autres joueurs. Elle sert uniquement de repère collectif.</div><details class="statsImpactPlayerExplainer" open><summary>Comprendre le référentiel et les scores</summary><div class="statsImpactPlayerExplainerBody"><p><strong>Le référentiel</strong> (${app.escapeHtml(referenceVersion)}) est construit à partir des attaques de la compétition de référence sélectionnées par le staff. Les données Hommes et Femmes sont séparées, ainsi que le jeu au centre et les remises au centre, sur ligne et sur coin.</p><p>Pour chaque situation, il donne le <strong>taux de points</strong> et le <strong>taux de fautes</strong> observés sur l'ensemble des attaques retenues.</p><div class="statsImpactPlayerExplainerFormula"><strong>Création /100</strong> : nombre de points produits en plus ou en moins sur 100 attaques par rapport au nombre attendu selon le référentiel.</div><div class="statsImpactPlayerExplainerFormula"><strong>Sécurité /100</strong> : nombre de fautes évitées ou ajoutées sur 100 attaques par rapport au nombre attendu selon le référentiel.</div><p><strong>Un score de 0</strong> signifie que ta performance correspond au niveau moyen de la compétition ayant servi à construire le référentiel, en tenant compte des situations que tu as réellement jouées. Positif = au-dessus du référentiel ; négatif = en dessous.</p><p><strong>Attention au volume analysé.</strong> Les scores sont ramenés à 100 attaques : avec peu d’actions, une seule action peut donc faire fortement bouger le résultat. En pratique, <strong>N &lt; 5</strong> est trop faible pour conclure ; entre <strong>5 et 15</strong>, le score donne seulement une tendance provisoire ; au-delà de <strong>15</strong>, il devient plus stable, sans pour autant supprimer l’incertitude.</p><p>Exemple : <strong>Création +5</strong> correspond à environ 5 points de plus que prévu sur 100 attaques ; <strong>Sécurité +3</strong> à environ 3 fautes de moins que prévu sur 100 attaques.</p></div></details>${app.playerPortalDetailsHtml(allDetails||data.details||[])}</div>`
};

app.playerPortalRender = async function playerPortalRender(){const box=app.$('#playerPortalContent');if(!box||!app.playerPortalState.groupId)return;const ids=app.playerPortalState.selected||[];if(!ids.length){box.innerHTML='<div class="statsEmpty">Sélectionne au moins un match.</div>';return}if(app.playerPortalState.loading)return;app.playerPortalState.loading=true;box.innerHTML='<div class="statsEmpty">Calcul de tes statistiques…</div>';try{const scope=app.playerPortalEffectiveScope();const calls=[app.db.rpc('get_player_portal_metrics',app.playerPortalMetricsArgs(app.playerPortalState.groupId,ids,scope))];if(scope!=='all')calls.push(app.db.rpc('get_player_portal_metrics',app.playerPortalMetricsArgs(app.playerPortalState.groupId,ids,'all')));const results=await Promise.all(calls);results.forEach(r=>{if(r.error)throw r.error});const data=results[0].data||{};const details=(results[1]?.data||data).details||[];box.innerHTML=app.playerPortalSheetHtml(data,details)}finally{app.playerPortalState.loading=false}};
app.sendPlayerPortalMessage = async function sendPlayerPortalMessage(){
  const groupId=app.playerPortalState.groupId,playerId=app.playerPortalTargetPlayerId();
  const input=app.$('#playerPortalMessageInput'),status=app.$('#playerPortalMessageStatus'),button=app.$('#playerPortalMessageSend');
  const message=(input?.value||'').trim();
  if(!groupId||!playerId||!message)return;
  button.disabled=true;if(status)status.textContent='Envoi…';
  try{
    const senderRole=app.playerPortalState.staffPreview?'coach':'player';
    const {error}=await app.db.rpc('send_player_conversation_message',{p_group_id:groupId,p_player_id:playerId,p_message:message,p_sender_role:senderRole});
    if(error)throw error;
    input.value='';if(status)status.textContent='Envoyé';
    await app.loadPlayerPortalConversation({forceBottom:true});
    await app.refreshMessageNotifications(app.playerPortalState.staffPreview?'coach':'player');
    setTimeout(()=>{if(status)status.textContent=''},1200);
  }catch(e){
    if(status)status.textContent='Erreur';
    app.handleError('send player message',e);
  }finally{button.disabled=false}
};

app.loadPlayerPortalGroup = async function loadPlayerPortalGroup(groupId){app.playerPortalState.groupId=groupId;app.syncPlayerPortalRole(groupId);app.refreshPlayerPortalIdentity();app.syncPlayerPortalGroupStatsAccess();app.playerPortalState.scope='all';app.playerPortalState.restartLocation='all';document.querySelectorAll('#playerPortalScopeTabs [data-player-scope]').forEach(b=>b.classList.toggle('active',b.dataset.playerScope==='all'));app.$('#playerPortalRestartField')?.classList.add('hidden');if(app.$('#playerPortalRestart'))app.$('#playerPortalRestart').value='all';const {data,error}=await app.db.rpc('get_player_portal_metrics',app.playerPortalMetricsArgs(groupId,null,'all'));if(error)throw error;app.playerPortalState.matches=data?.matches||[];app.playerPortalState.selected=app.playerPortalState.matches.map(m=>m.id);app.$('#playerPortalTitle').textContent=data?.player_name?`Mes statistiques · ${data.player_name}`:'Mes statistiques';app.$('#playerPortalSubtitle').textContent=data?.group_name||'';await app.refreshMessageNotifications(app.playerPortalState.staffPreview?'coach':'player').catch(e=>app.handleError('message notifications',e));await app.loadPlayerPortalConversation({initial:true,forceBottom:true});await app.loadPlayerObjectives().catch(e=>app.handleError('player objectives',e));app.syncStandaloneVideoLinks();app.playerPortalRenderMatches();app.$('#playerPortalContent').innerHTML=app.playerPortalSheetHtml(data,data?.details||[])};

app.openPlayerPortal = async function openPlayerPortal(accesses){
  app.playerPortalState.accesses=accesses||await app.fetchMyPlayerAccesses();
  if(!app.playerPortalState.accesses.length)return false;
  app.playerPortalState.hasStaffAccess=app.groupState.groups.length>0;
  app.playerPortalState.view='home';
  app.hideMainModules();app.setMatchHeaderMode(false);
  app.$('#playerPortal').classList.remove('hidden');app.$('#homeBtn').classList.add('hidden');app.$('#profileBtn').classList.add('hidden');app.$('#playerSpaceBtn').classList.add('hidden');app.$('#logout').classList.remove('hidden');
  const back=app.$('#playerPortalBackStaff');back?.classList.toggle('hidden',!app.playerPortalState.staffPreview);if(back)back.textContent='← Retour au groupe';
  app.$('#playerPortalStaffPreviewBanner')?.classList.toggle('hidden',!app.playerPortalState.staffPreview);
  if(app.$('#playerPortalConversationLabel'))app.$('#playerPortalConversationLabel').textContent=app.playerPortalState.staffPreview?'Échanges avec ce joueur':'Échanges avec les entraîneurs';
  const accountCard=app.$('#playerPortalAccountCard');if(accountCard)accountCard.classList.toggle('hidden',app.playerPortalState.staffPreview);
  if(app.$('#playerPortalAccountEmail'))app.$('#playerPortalAccountEmail').textContent=app.playerPortalState.staffPreview?'':(app.currentUser?.email||'');
  const sel=app.$('#playerPortalGroup'),field=app.$('#playerPortalGroupField');
  sel.innerHTML=app.playerPortalState.accesses.map(a=>`<option value="${app.escapeHtml(a.group_id)}">${app.escapeHtml(a.group_name)} · ${app.escapeHtml(a.player_name)}</option>`).join('');
  field.classList.toggle('hidden',app.playerPortalState.staffPreview||app.playerPortalState.accesses.length<2);
  sel.onchange=()=>app.loadPlayerPortalGroup(sel.value).catch(e=>app.handleError('player portal group',e));
  await app.loadPlayerPortalGroup(app.playerPortalState.accesses[0].group_id);
  if(app.page==='index')app.syncPlayerPortalMessagePolling();
  if(location.hash==='#team-stats'){
    const access=app.playerPortalAccessForGroup(app.playerPortalState.groupId)||app.playerPortalState.accesses?.[0];
    if(app.playerPortalCanViewGroupStats(access))return await app.openGroupStatsViewer(access);
  }
  const wanted=location.hash==='#player-profile'?'profile':'home';
  app.playerPortalSetView(wanted);app.syncStandaloneVideoLinks();app.setCloud('Synchronisé',true);window.scrollTo({top:0,behavior:'instant'});return true
};
})(window.KinballCoach.app);

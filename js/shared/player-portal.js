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
  const views={home:'#playerPortalHomeView',stats:'#playerPortalStatsView',messages:'#playerPortalMessagesView',profile:'#playerPortalProfileView'};
  Object.entries(views).forEach(([k,sel])=>app.$(sel)?.classList.toggle('hidden',k!==app.playerPortalState.view));
  const nav={home:'#playerPortalNavHome',stats:'#playerPortalNavStats',messages:'#playerPortalNavMessages',profile:'#playerPortalNavProfile'};
  Object.entries(nav).forEach(([k,sel])=>app.$(sel)?.classList.toggle('active',k===app.playerPortalState.view));
  if(app.playerPortalState.view==='home')app.loadPlayerFollowUpReview().catch(e=>app.handleError('player follow-up review',e));
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

app.playerObjectiveDisplayState = function playerObjectiveDisplayState(o){
  if(!o)return 'to_work';
  if(o.status==='completed')return 'completed';
  return 'to_work';
};

app.playerObjectiveStatusInfo = function playerObjectiveStatusInfo(status){
  const s=status==='completed'?'completed':'to_work';
  return {
    to_work:{label:'À travailler',icon:'○',cls:'toWork'},
    completed:{label:'Atteint',icon:'●',cls:'completed'}
  }[s];
};

// Démo locale : ?followup=demo. Aucune écriture Supabase, aucune donnée réelle.
app.playerFollowUpDemo = function playerFollowUpDemo(){
  const followUp=app.playerPortalState.followUp;
  if(followUp.demo===null)followUp.demo=/(?:^|[?&])followup=demo(?:&|$)/.test(location.search||'');
  return followUp.demo;
};

// Le suivi détaillé dépend de la migration du suivi. Tant qu'elle n'est pas
// appliquée, le front reste en lecture historique au lieu d'échouer.
app.playerFollowUpAvailable = function playerFollowUpAvailable(){
  return !app.playerFollowUpDemo()&&app.playerPortalState.followUp.enabled!==false;
};

app.playerFollowUpRpcMissing = function playerFollowUpRpcMissing(error){
  const code=error?.code||'';
  return code==='PGRST202'||code==='42883'||/does not exist|schema cache/i.test(String(error?.message||''));
};

app.playerFollowUpDemoObjectives = function playerFollowUpDemoObjectives(){
  return [
    {id:'demo-1',objective:'Orienter mes pieds avant de recevoir pour garder le ballon devant moi',status:'active',source:'coach',coach_note:'Regarde la vidéo du match 3 : tes appuis arrivent après la frappe.',player_note:'À retravailler sur les deux premiers sets.',created_at:'2026-09-28T10:00:00Z',updated_at:'2026-10-02T18:00:00Z',created_by_name:'Karim'},
    {id:'demo-2',objective:'Servir régulièrement la zone arrière',status:'active',source:'coach',coach_note:'Cible la largeur de la table, pas seulement la profondeur.',player_note:null,created_at:'2026-09-20T10:00:00Z',updated_at:'2026-09-30T09:00:00Z',created_by_name:'Karim'},
    {id:'demo-3',objective:'Équilibrer mes attaques gauches et droites',status:'completed',source:'coach',coach_note:null,player_note:'Objectif atteint sur trois matchs.',completed_at:'2026-10-01T09:00:00Z',created_at:'2026-09-01T10:00:00Z',updated_at:'2026-10-01T09:00:00Z',created_by_name:'Karim'},
    {id:'demo-4',objective:'Garder mon concentration sur les points longs',status:'active',source:'player',coach_note:null,player_note:null,created_at:'2026-09-25T10:00:00Z',updated_at:'2026-09-25T10:00:00Z',created_by_name:'Joueur'}
  ];
};

app.playerFollowUpDemoReview = function playerFollowUpDemoReview(){
  return [{kind:'Retour staff',text:'« Tes frappes dans l’axe progressent bien, continue sur les changements de direction. »',href:'',action:''}];
};

app.playerObjectiveItemHtml = function playerObjectiveItemHtml(o){
  const source=o.source==='player'?'player':'coach';
  const sourceLabel=source==='player'?'Objectif personnel':'Objectif coach';
  const displayState=app.playerObjectiveDisplayState(o);
  const info=app.playerObjectiveStatusInfo(displayState);
  const isCompleted=displayState==='completed';
  const canEditPersonal=!app.playerPortalState.staffPreview&&source==='player';
  const actions=[`<button type="button" class="ghost" data-objective-detail="${app.escapeHtml(o.id)}">Détail</button>`];
  if(canEditPersonal){
    actions.push(`<button type="button" class="ghost" data-objective-action="${isCompleted?'reopen':'complete'}" data-objective-id="${app.escapeHtml(o.id)}">${isCompleted?'Réouvrir':'Marquer atteint'}</button>`);
    actions.push(`<button type="button" class="ghost" data-objective-action="edit" data-objective-id="${app.escapeHtml(o.id)}" data-objective-text="${app.escapeHtml(o.objective||'')}">Modifier</button>`);
    actions.push(`<button type="button" class="ghost" data-objective-action="delete" data-objective-id="${app.escapeHtml(o.id)}">Supprimer</button>`);
  }
  const pill=`<span class="playerFollowUpStatus ${info.cls}"><span aria-hidden="true">${info.icon}</span> ${info.label}</span>`;
  const date=isCompleted
    ?`Atteint le ${app.escapeHtml(app.playerObjectiveDate(o.completed_at))}`
    :`Mis à jour le ${app.escapeHtml(app.playerObjectiveDate(o.updated_at||o.created_at))}${o.created_by_name?' · '+app.escapeHtml(o.created_by_name):''}`;
  const coachNote=o.coach_note?`<div class="playerObjectiveNote"><span class="analysisSubtle">Consigne du coach</span><span>${app.escapeHtml(o.coach_note)}</span></div>`:'';
  const playerNote=o.player_note?`<div class="playerObjectiveNote"><span class="analysisSubtle">Ma note</span><span>${app.escapeHtml(o.player_note)}</span></div>`:'';
  return `<div class="playerObjectiveItem ${isCompleted?'completed':''}">
    <div class="playerObjectiveText"><strong>${app.escapeHtml(o.objective||'')}</strong><div class="playerObjectiveMeta">${app.escapeHtml(sourceLabel)} · ${date}</div><div class="playerObjectiveStatusRow">${pill}</div>${coachNote}${playerNote}</div>
    <div class="playerObjectiveActions">${actions.join('')}</div>
  </div>`;
};

app.playerObjectivesHtml = function playerObjectivesHtml(rows){
  const all=rows||[];
  const byRecent=(a,b)=>Date.parse(b.updated_at||b.created_at||0)-Date.parse(a.updated_at||a.created_at||0);
  const active=all.filter(x=>x.status==='active').sort(byRecent);
  const completed=all.filter(x=>x.status==='completed').sort(byRecent).slice(0,5);
  const blocks=[active.length
    ?`<div style="display:grid;gap:7px"><div class="analysisSubtle">Objectifs en cours</div><div class="playerObjectivesList">${active.map(o=>app.playerObjectiveItemHtml(o)).join('')}</div></div>`
    :'<div class="small">Aucun objectif en cours. Le staff peut en ajouter, et tu peux aussi définir un objectif personnel.</div>'];
  if(completed.length)blocks.push(`<details class="playerFollowUpSection"><summary class="small">Objectifs atteints (${completed.length})</summary><div class="playerObjectivesList" style="margin-top:8px">${completed.map(o=>app.playerObjectiveItemHtml(o)).join('')}</div></details>`);
  return blocks.join('<div style="height:10px"></div>');
};

app.renderPlayerObjectives = function renderPlayerObjectives(){
  const box=app.$('#playerObjectivesList');
  if(!box)return;
  box.innerHTML=app.playerObjectivesHtml(app.playerPortalState.objectives||[]);
  box.querySelectorAll('[data-objective-detail]').forEach(b=>b.onclick=()=>app.openPlayerFollowUpDetail(b.dataset.objectiveDetail));
  box.querySelectorAll('[data-objective-action]').forEach(b=>b.onclick=()=>app.updatePlayerObjectiveStatus(b.dataset.objectiveId,b.dataset.objectiveAction,b.dataset.objectiveText||''));
};

app.syncPlayerFollowUpNotice = function syncPlayerFollowUpNotice(){
  const box=app.$('#playerFollowUpNotice');
  if(!box)return;
  if(app.playerFollowUpDemo()){
    box.textContent='Démo locale : objectifs et retours fictifs, aucune écriture dans la base.';
    box.classList.remove('hidden');
  }else if(app.playerPortalState.followUp.enabled===false){
    box.textContent='Suivi détaillé indisponible : les étapes de travail ne sont pas encore activées sur cette base.';
    box.classList.remove('hidden');
  }else box.classList.add('hidden');
};

app.loadPlayerObjectives = async function loadPlayerObjectives(){
  const groupId=app.playerPortalState.groupId,playerId=app.playerPortalTargetPlayerId();
  const box=app.$('#playerObjectivesList'),composer=app.$('#playerObjectiveComposer'),hint=app.$('#playerObjectivesHint'),input=app.$('#playerObjectiveInput');
  if(!groupId||!playerId||!box)return;
  if(composer)composer.classList.remove('hidden');
  if(hint)hint.textContent=app.playerPortalState.staffPreview?'3 objectifs coach actifs maximum · les objectifs personnels restent sous le contrôle du joueur.':'Tu peux gérer jusqu’à 3 objectifs personnels, en plus de ceux fixés par le staff.';
  if(input)input.placeholder=app.playerPortalState.staffPreview?'Ajouter un objectif coach…':'Ajouter un objectif personnel…';
  box.innerHTML='<div class="small">Chargement…</div>';
  if(app.playerFollowUpDemo()){
    app.playerPortalState.objectives=app.playerFollowUpDemoObjectives();
  }else{
    const followUp=app.playerPortalState.followUp;
    const args={p_group_id:groupId,p_player_id:playerId};
    const useFollowUp=followUp.enabled!==false;
    let result=await (useFollowUp?app.db.rpc('get_player_follow_up_objectives',args):app.db.rpc('get_player_objectives',args));
    if(result.error&&useFollowUp&&app.playerFollowUpRpcMissing(result.error)){
      followUp.enabled=false;
      console.warn('[player follow-up] RPC de suivi indisponible, repli sur get_player_objectives');
      result=await app.db.rpc('get_player_objectives',args);
    }
    if(result.error)throw result.error;
    app.playerPortalState.objectives=result.data||[];
  }
  app.syncPlayerFollowUpNotice();
  app.renderPlayerObjectives();
};

app.playerFollowUpObjectiveById = function playerFollowUpObjectiveById(objectiveId){
  return (app.playerPortalState.objectives||[]).find(o=>o.id===objectiveId)||null;
};

app.playerFollowUpStatusButtonsHtml = function playerFollowUpStatusButtonsHtml(current,options={}){
  const attr=options.attr||'data-followup-status';
  const extraCls=options.cls?' '+options.cls:'';
  return ['to_work','completed'].map(key=>{
    const info=app.playerObjectiveStatusInfo(key);
    const active=current===key;
    return `<button type="button" class="ghost playerFollowUpStatus ${info.cls}${active?' active':''}${extraCls}" ${attr}="${key}" aria-pressed="${active}"><span aria-hidden="true">${info.icon}</span> ${info.label}</button>`;
  }).join('');
};

app.playerFollowUpStatusFocusable = function playerFollowUpStatusFocusable(){
  const popup=app.$('#playerFollowUpDetailPopup');
  if(!popup)return [];
  return [...popup.querySelectorAll('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled&&el.offsetParent!==null);
};

app.trapPlayerFollowUpFocus = function trapPlayerFollowUpFocus(event){
  const focusable=app.playerFollowUpStatusFocusable();
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
};

app.openPlayerFollowUpDetail = function openPlayerFollowUpDetail(objectiveId){
  const popup=app.$('#playerFollowUpDetailPopup');
  if(!popup||!objectiveId)return;
  const objective=app.playerFollowUpObjectiveById(objectiveId);
  if(!objective)return;
  app.playerPortalState.detailId=objectiveId;
  app.playerPortalState.detailReturnFocus=document.activeElement;
  app.renderPlayerFollowUpDetail();
  popup.classList.remove('hidden');
  app.$('#playerFollowUpDetailClose')?.focus();
};

app.closePlayerFollowUpDetail = function closePlayerFollowUpDetail(){
  const popup=app.$('#playerFollowUpDetailPopup');
  if(!popup)return;
  popup.classList.add('hidden');
  app.playerPortalState.detailId=null;
  ['#playerFollowUpNoteInput','#playerFollowUpCoachNoteInput','#playerFollowUpObjectiveInput'].forEach(sel=>{const field=app.$(sel);if(field)field.value=''});
  const status=app.$('#playerFollowUpDetailStatus');
  if(status)status.textContent='';
  const back=app.playerPortalState.detailReturnFocus;
  app.playerPortalState.detailReturnFocus=null;
  if(back&&typeof back.focus==='function')back.focus();
};

app.playerFollowUpDraft = function playerFollowUpDraft(){
  return {
    objective:app.$('#playerFollowUpObjectiveInput')?.value??null,
    coachNote:app.$('#playerFollowUpCoachNoteInput')?.value??null,
    playerNote:app.$('#playerFollowUpNoteInput')?.value??null
  };
};

app.playerFollowUpRestoreDraft = function playerFollowUpRestoreDraft(draft){
  if(!draft)return;
  const objective=app.$('#playerFollowUpObjectiveInput');
  if(objective&&draft.objective!==null)objective.value=draft.objective;
  const coachNote=app.$('#playerFollowUpCoachNoteInput');
  if(coachNote&&draft.coachNote!==null)coachNote.value=draft.coachNote;
  const playerNote=app.$('#playerFollowUpNoteInput');
  if(playerNote&&draft.playerNote!==null)playerNote.value=draft.playerNote;
};

app.renderPlayerFollowUpDetail = function renderPlayerFollowUpDetail(options={}){
  const body=app.$('#playerFollowUpDetailBody'),meta=app.$('#playerFollowUpDetailMeta'),save=app.$('#playerFollowUpDetailSave');
  if(!body)return;
  const objective=app.playerFollowUpObjectiveById(app.playerPortalState.detailId);
  if(!objective){body.innerHTML='<div class="small">Objectif introuvable.</div>';if(save)save.disabled=true;return}
  const available=app.playerFollowUpAvailable();
  const coachSide=app.playerPortalState.staffPreview;
  const isPersonal=objective.source==='player';
  const displayState=app.playerObjectiveDisplayState(objective);
  const info=app.playerObjectiveStatusInfo(displayState);
  const isCompleted=displayState==='completed';
  if(meta)meta.textContent=isPersonal?'Objectif personnel':'Objectif coach';
  const statusBlock=available&&coachSide
    ?`<div class="field"><label>Statut de l’objectif</label><div class="playerFollowUpStatusPicker" id="playerFollowUpStatusPicker" role="group" aria-label="Statut de l’objectif">${app.playerFollowUpStatusButtonsHtml(displayState)}</div></div>`
    :`<div class="field"><label>Statut de l’objectif</label><div class="playerFollowUpStatus ${info.cls}"><span aria-hidden="true">${info.icon}</span> ${info.label}</div></div>`;
  const coachCanEditText=available&&coachSide&&!isPersonal;
  const objectiveBlock=coachCanEditText
    ?`<div class="field"><label for="playerFollowUpObjectiveInput">Objectif</label><textarea id="playerFollowUpObjectiveInput" class="textareaCompact" maxlength="500">${app.escapeHtml(objective.objective||'')}</textarea></div>`
    :`<div class="playerFollowUpReadOnly"><span class="analysisSubtle">Objectif</span><p>${app.escapeHtml(objective.objective||'')}</p>${coachSide&&isPersonal?'<div class="small" style="margin-top:6px">Objectif personnel : seul le joueur peut le modifier.</div>':''}</div>`;
  const coachNoteBlock=!available?''
    :coachSide
      ?`<div class="field"><label for="playerFollowUpCoachNoteInput">Consigne du coach</label><textarea id="playerFollowUpCoachNoteInput" class="textareaCompact" maxlength="1000" placeholder="Ce que le joueur doit travailler sur cet objectif.">${app.escapeHtml(objective.coach_note||'')}</textarea></div>`
      :(objective.coach_note?`<div class="playerFollowUpReadOnly"><span class="analysisSubtle">Consigne du coach</span><p>${app.escapeHtml(objective.coach_note)}</p></div>`:'');
  const playerNoteBlock=coachSide
    ?(objective.player_note?`<div class="playerFollowUpReadOnly"><span class="analysisSubtle">Note du joueur</span><p>${app.escapeHtml(objective.player_note)}</p></div>`:'')
    :`<div class="field"><label for="playerFollowUpNoteInput">Ma note personnelle</label><textarea id="playerFollowUpNoteInput" class="textareaLong" maxlength="2000" placeholder="Ce que tu retiens, ce que tu veux retravailler.">${app.escapeHtml(objective.player_note||'')}</textarea><div class="small" style="margin-top:6px">Visible par toi et par les entraîneurs du groupe. Elle ne modifie pas les décisions du coach.</div></div>`;
  body.innerHTML=`${statusBlock}${objectiveBlock}${coachNoteBlock}${playerNoteBlock}<div class="small">Dernière mise à jour : ${app.escapeHtml(app.playerObjectiveDate(objective.updated_at||objective.created_at))}${isCompleted?' · objectif atteint':''}</div>`;
  app.playerFollowUpRestoreDraft(options.drafts);
  const picker=app.$('#playerFollowUpStatusPicker');
  picker?.querySelectorAll('[data-followup-status]').forEach(button=>{
    button.onclick=async()=>{
      const current=app.playerFollowUpObjectiveById(app.playerPortalState.detailId);
      if(!current)return;
      const target=button.dataset.followupStatus;
      if(target===app.playerObjectiveDisplayState(current))return;
      const statusEl=app.$('#playerFollowUpDetailStatus');
      const saveBtn=app.$('#playerFollowUpDetailSave');
      const controls=[...picker.querySelectorAll('[data-followup-status]')];
      const drafts=app.playerFollowUpDraft();
      controls.forEach(el=>{el.disabled=true});
      if(saveBtn)saveBtn.disabled=true;
      if(statusEl)statusEl.textContent=target==='completed'?'Marquage atteint…':'Réouverture…';
      try{
        const rpc=target==='completed'?'complete_player_objective':'reopen_player_objective';
        const {error}=await app.db.rpc(rpc,{p_group_id:app.playerPortalState.groupId,p_objective_id:current.id});
        if(error)throw error;
        await app.loadPlayerObjectives();
        app.renderPlayerFollowUpDetail({drafts,focusStatus:target});
        const freshStatus=app.$('#playerFollowUpDetailStatus');
        if(freshStatus)freshStatus.textContent='Objectif mis à jour.';
      }catch(e){
        controls.forEach(el=>{el.disabled=false});
        if(saveBtn)saveBtn.disabled=false;
        if(statusEl)statusEl.textContent='Action non enregistrée.';
        app.handleError('toggle objective status',e);
      }
    };
  });
  if(options.focusStatus)picker?.querySelector(`[data-followup-status="${options.focusStatus}"]`)?.focus();
  if(save)save.disabled=app.playerFollowUpDemo();
};

app.savePlayerFollowUpDetail = async function savePlayerFollowUpDetail(){
  const objective=app.playerFollowUpObjectiveById(app.playerPortalState.detailId);
  const status=app.$('#playerFollowUpDetailStatus'),button=app.$('#playerFollowUpDetailSave');
  if(!objective)return;
  if(app.playerFollowUpDemo()){if(status)status.textContent='Démo locale : aucune écriture.';return}
  if(!app.playerFollowUpAvailable()){if(status)status.textContent='Suivi détaillé indisponible sur cette base.';return}
  if(button)button.disabled=true;
  if(status)status.textContent='Enregistrement…';
  try{
    if(app.playerPortalState.staffPreview){
      const {error}=await app.db.rpc('update_player_objective_coach_fields',{
        p_group_id:app.playerPortalState.groupId,
        p_objective_id:objective.id,
        p_objective:objective.source==='player'?null:((app.$('#playerFollowUpObjectiveInput')?.value||'').trim()||null),
        p_coach_note:app.$('#playerFollowUpCoachNoteInput')?.value??null
      });
      if(error)throw error;
    }else{
      const {error}=await app.db.rpc('update_my_player_objective_note',{
        p_group_id:app.playerPortalState.groupId,
        p_objective_id:objective.id,
        p_player_note:(app.$('#playerFollowUpNoteInput')?.value||'').trim()
      });
      if(error)throw error;
    }
    if(status)status.textContent='Enregistré.';
    await app.loadPlayerObjectives();
    app.renderPlayerFollowUpDetail();
    button?.focus();
  }catch(e){
    if(status)status.textContent='Enregistrement impossible.';
    app.handleError('save player follow-up',e);
  }finally{if(button)button.disabled=false}
};

app.playerFollowUpReviewHtml = function playerFollowUpReviewHtml(items){
  if(!items.length)return '<div class="small">Rien à revoir pour le moment.</div>';
  return `<ul class="playerFollowUpReviewList">${items.map(item=>`<li class="playerFollowUpReviewItem"><span class="playerFollowUpReviewKind">${app.escapeHtml(item.kind)}</span><span class="playerFollowUpReviewText">${app.escapeHtml(item.text)}</span>${item.href?`<a class="button ghost playerFollowUpReviewLink" href="${app.escapeHtml(item.href)}">${app.escapeHtml(item.action||'Ouvrir')}</a>`:''}</li>`).join('')}</ul>`;
};

app.loadPlayerFollowUpReview = async function loadPlayerFollowUpReview(){
  const groupId=app.playerPortalState.groupId,playerId=app.playerPortalTargetPlayerId();
  const wrap=app.$('#playerFollowUpReview'),box=app.$('#playerFollowUpReviewList');
  if(!groupId||!playerId||!wrap||!box)return;
  const followUp=app.playerPortalState.followUp;
  if(followUp.reviewLoaded)return;
  followUp.reviewLoaded=true;
  const suffix=app.playerPortalState.staffPreview
    ?`?group=${encodeURIComponent(groupId)}&player=${encodeURIComponent(playerId)}`
    :`?group=${encodeURIComponent(groupId)}`;
  const videoHref=`videos.html${suffix}`;
  box.innerHTML='<div class="small">Chargement…</div>';
  let items=[];
  if(app.playerFollowUpDemo()){
    items=app.playerFollowUpDemoReview();
  }else{
    try{
      const {data,error}=await app.db.rpc('get_player_videos',{p_group_id:groupId,p_player_id:playerId});
      if(error)throw error;
      const videos=data||[];
      const unread=app.videoNotificationCountFor(groupId,playerId);
      const pending=videos.filter(v=>v.status!=='reviewed');
      const lastReviewed=videos.find(v=>v.status==='reviewed'&&v.review_text);
      if(unread)items.push({kind:'Vidéo',text:`${unread} vidéo${unread>1?'s':''} en attente d’analyse du staff.`,href:videoHref,action:'Voir mes vidéos'});
      if(lastReviewed)items.push({kind:'Retour staff',text:lastReviewed.review_text,href:videoHref,action:'Ouvrir la vidéo'});
      if(pending.length&&!unread)items.push({kind:'Vidéo',text:`${pending.length} vidéo${pending.length>1?'s':''} sans retour du staff.`,href:videoHref,action:'Voir mes vidéos'});
      if(!items.length)items.push({kind:'Suivi',text:'Aucun retour vidéo récent. Les analyses du staff apparaîtront ici.',href:videoHref,action:'Ouvrir mes vidéos'});
    }catch(e){
      items=[{kind:'Vidéo',text:'Revue vidéo momentanément indisponible.',href:videoHref,action:'Ouvrir mes vidéos'}];
      app.handleError('player follow-up review',e);
    }
  }
  wrap.classList.remove('hidden');
  box.innerHTML=app.playerFollowUpReviewHtml(items.slice(0,3));
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
  if(!objectiveId||app.playerPortalState.staffPreview)return;
  const status=app.$('#playerObjectiveStatus');
  try{
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

app.loadPlayerPortalGroup = async function loadPlayerPortalGroup(groupId){app.playerPortalState.groupId=groupId;app.syncPlayerPortalRole(groupId);app.refreshPlayerPortalIdentity();app.syncPlayerPortalGroupStatsAccess();app.playerPortalState.scope='all';app.playerPortalState.restartLocation='all';app.playerPortalState.followUp.reviewLoaded=false;document.querySelectorAll('#playerPortalScopeTabs [data-player-scope]').forEach(b=>b.classList.toggle('active',b.dataset.playerScope==='all'));app.$('#playerPortalRestartField')?.classList.add('hidden');if(app.$('#playerPortalRestart'))app.$('#playerPortalRestart').value='all';const {data,error}=await app.db.rpc('get_player_portal_metrics',app.playerPortalMetricsArgs(groupId,null,'all'));if(error)throw error;app.playerPortalState.matches=data?.matches||[];app.playerPortalState.selected=app.playerPortalState.matches.map(m=>m.id);app.$('#playerPortalTitle').textContent=data?.player_name?`Mes statistiques · ${data.player_name}`:'Mes statistiques';app.$('#playerPortalSubtitle').textContent=data?.group_name||'';
// Notifications, conversation et objectifs ne dépendent pas les uns des autres : une
// erreur de revue ne doit pas masquer la conversation, et inversement.
const background=[
  app.refreshMessageNotifications(app.playerPortalState.staffPreview?'coach':'player').catch(e=>app.handleError('message notifications',e)),
  app.loadPlayerPortalConversation({initial:true,forceBottom:true}).catch(e=>app.handleError('player conversation',e)),
  app.loadPlayerObjectives().catch(e=>app.handleError('player objectives',e))
];
app.syncStandaloneVideoLinks();app.playerPortalRenderMatches();app.$('#playerPortalContent').innerHTML=app.playerPortalSheetHtml(data,data?.details||[]);
await Promise.allSettled(background)};

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
  const wanted=location.hash==='#player-profile'?'profile':location.hash==='#player-messages'?'messages':'home';
  app.playerPortalSetView(wanted);app.syncStandaloneVideoLinks();app.setCloud('Synchronisé',true);window.scrollTo({top:0,behavior:'instant'});return true
};

app.groupFollowUpObjectivesHtml = function groupFollowUpObjectivesHtml(rows){
  const all=rows||[];
  const coachAll=all.filter(x=>(x.source||'coach')==='coach');
  const active=coachAll.filter(x=>x.status==='active');
  const completed=coachAll.filter(x=>x.status==='completed').sort((a,b)=>Date.parse(b.completed_at||b.updated_at||b.created_at||0)-Date.parse(a.completed_at||a.updated_at||a.created_at||0));
  const htmlFor=o=>{
    const displayState=app.playerObjectiveDisplayState(o);
    const info=app.playerObjectiveStatusInfo(displayState);
    const pill=`<span class="playerFollowUpStatus ${info.cls}"><span aria-hidden="true">${info.icon}</span> ${info.label}</span>`;
    const coachNote=o.coach_note?`<div class="playerObjectiveNote"><span class="analysisSubtle">Consigne</span><span>${app.escapeHtml(o.coach_note)}</span></div>`:'';
    const playerNote=o.player_note?`<div class="playerObjectiveNote"><span class="analysisSubtle">Note du joueur</span><span>${app.escapeHtml(o.player_note)}</span></div>`:'';
    const statusButtons=app.playerFollowUpAvailable()
      ?`<div class="playerFollowUpStatusPicker" role="group" aria-label="Statut de l’objectif"><span class="analysisSubtle">Statut</span>${app.playerFollowUpStatusButtonsHtml(displayState,{attr:'data-group-status'})}</div>`
      :'';
    const date=displayState==='completed'
      ?`Atteint le ${app.escapeHtml(app.playerObjectiveDate(o.completed_at||o.updated_at||o.created_at))}`
      :`Mis à jour le ${app.escapeHtml(app.playerObjectiveDate(o.updated_at||o.created_at))}`;
    return `<div class="playerFollowUpCoachItem" data-group-objective="${app.escapeHtml(o.id)}">
        <div style="min-width:0;display:grid;gap:6px">
          <strong>${app.escapeHtml(o.objective||'')}</strong>
          <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><span class="small">${date}</span>${pill}</div>
          ${coachNote}${playerNote}${statusButtons}
        </div>
      </div>`;
  };
  const parts=[];
  parts.push(active.length
    ?`<div class="analysisSubtle">Objectifs coach</div>${active.map(htmlFor).join('')}`
    :'<div class="small">Aucun objectif coach actif.</div>');
  if(completed.length){
    parts.push(`<details class="playerFollowUpSection"><summary class="small">Objectifs coach atteints (${completed.length})</summary><div class="playerObjectivesList" style="margin-top:8px">${completed.map(htmlFor).join('')}</div></details>`);
  }
  return parts.join('<div style="height:10px"></div>');
};

app.groupFollowUpBindStatusPickers = function groupFollowUpBindStatusPickers(){
  const box=app.$('#groupPlayerFollowupObjectivesList');
  if(!box)return;
  const controls=[...box.querySelectorAll('[data-group-status]')];
  controls.forEach(button=>{
    button.onclick=async()=>{
      const row=button.closest('[data-group-objective]');
      const groupId=app.groupState.currentGroupId,playerId=app.groupPlayerFollowupState.playerId;
      const status=app.$('#groupPlayerFollowupStatus');
      if(!groupId||!playerId||!row)return;
      const objectiveId=row.dataset.groupObjective;
      const target=button.dataset.groupStatus;
      const current=(app.groupPlayerFollowupState.objectives||[]).find(o=>o.id===objectiveId);
      if(current&&app.playerObjectiveDisplayState(current)===target)return;
      controls.forEach(el=>{el.disabled=true});
      if(status)status.textContent=target==='completed'?'Marquage atteint…':'Réouverture…';
      try{
        const rpc=target==='completed'?'complete_player_objective':'reopen_player_objective';
        const {error}=await app.db.rpc(rpc,{p_group_id:groupId,p_objective_id:objectiveId});
        if(error)throw error;
        await app.reloadGroupPlayerFollowupObjectives(groupId,playerId);
        const fresh=app.$('#groupPlayerFollowupStatus');
        if(fresh)fresh.textContent='Objectif mis à jour.';
        app.setCloud('Synchronisé',true);
      }catch(e){
        controls.forEach(el=>{el.disabled=false});
        if(status)status.textContent='Action non enregistrée.';
        app.handleError('toggle group objective status',e);
      }
    };
  });
};

app.reloadGroupPlayerFollowupObjectives = async function reloadGroupPlayerFollowupObjectives(groupId,playerId,expectedToken){
  const box=app.$('#groupPlayerFollowupObjectivesList');
  if(!groupId||!playerId||!box)return;
  box.innerHTML='<div class="small">Chargement…</div>';
  try{
    const useFollowUp=app.playerFollowUpAvailable();
    const args={p_group_id:groupId,p_player_id:playerId};
    let result=await (useFollowUp?app.db.rpc('get_player_follow_up_objectives',args):app.db.rpc('get_player_objectives',args));
    if(result.error&&useFollowUp&&app.playerFollowUpRpcMissing(result.error)){
      app.playerPortalState.followUp.enabled=false;
      console.warn('[player follow-up] RPC de suivi indisponible, repli sur get_player_objectives');
      result=await app.db.rpc('get_player_objectives',args);
    }
    if(result.error)throw result.error;
    if(expectedToken!==undefined&&expectedToken!==app.groupPlayerFollowupState.openToken)return;
    app.groupPlayerFollowupState.objectives=result.data||[];
    box.innerHTML=app.groupFollowUpObjectivesHtml(result.data||[]);
    app.groupFollowUpBindStatusPickers();
  }catch(e){
    if(expectedToken!==undefined&&expectedToken!==app.groupPlayerFollowupState.openToken)return;
    box.innerHTML='<div class="small">Objectifs indisponibles pour le moment.</div>';
    app.handleError('reload group player followup objectives',e);
  }
};

app.addGroupPlayerFollowupObjective = async function addGroupPlayerFollowupObjective(){
  const groupId=app.groupState.currentGroupId,playerId=app.groupPlayerFollowupState.playerId;
  const input=app.$('#groupPlayerFollowupObjectiveNew');
  const status=app.$('#groupPlayerFollowupStatus');
  const button=app.$('#groupPlayerFollowupObjectiveAdd');
  if(!groupId||!playerId||!input)return;
  const text=input.value.trim();
  if(!text){if(status)status.textContent='Objectif vide.';return}
  if(text.length>500){if(status)status.textContent='Objectif trop long (500 caractères maximum).';return}
  if(button)button.disabled=true;
  if(status)status.textContent='Ajout de l’objectif…';
  try{
    const {error}=await app.db.rpc('add_player_objective',{p_group_id:groupId,p_player_id:playerId,p_objective:text});
    if(error)throw error;
    input.value='';
    await app.reloadGroupPlayerFollowupObjectives(groupId,playerId);
    if(status)status.textContent='Objectif coach ajouté.';
    app.setCloud('Synchronisé',true);
  }catch(e){
    if(status)status.textContent=e?.message?.includes('Maximum de 3')?'Maximum de 3 objectifs coach actifs.':'Impossible d’ajouter l’objectif.';
    app.handleError('add group player followup objective',e);
  }finally{if(button)button.disabled=false}
};

app.sendGroupPlayerFollowupFeedback = async function sendGroupPlayerFollowupFeedback(){
  const groupId=app.groupState.currentGroupId,playerId=app.groupPlayerFollowupState.playerId;
  const input=app.$('#groupPlayerFollowupFeedbackNew');
  const status=app.$('#groupPlayerFollowupStatus');
  const button=app.$('#groupPlayerFollowupFeedbackSend');
  if(!groupId||!playerId||!input)return;
  const text=input.value.trim();
  if(!text){if(status)status.textContent='Message vide.';return}
  if(text.length>2000){if(status)status.textContent='Message trop long (2000 caractères maximum).';return}
  if(button)button.disabled=true;
  if(status)status.textContent='Envoi du retour…';
  try{
    const {error}=await app.db.rpc('send_player_conversation_message',{p_group_id:groupId,p_player_id:playerId,p_message:text,p_sender_role:'coach'});
    if(error)throw error;
    input.value='';
    if(status)status.textContent='Retour envoyé au joueur.';
    app.setCloud('Synchronisé',true);
  }catch(e){
    if(status)status.textContent='Impossible d’envoyer le retour.';
    app.handleError('send group player followup feedback',e);
  }finally{if(button)button.disabled=false}
};
})(window.KinballCoach.app);

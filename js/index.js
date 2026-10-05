/* Homepage policies and entry point. Shared implementations live in js/shared. */
window.KinballCoach.policies.index = (app) => {

app.loadPlayerPortalConversation = async function loadPlayerPortalConversation({initial=false,forceBottom=false}={}){
  const groupId=app.playerPortalState.groupId,playerId=app.playerPortalTargetPlayerId();
  const box=app.$('#playerPortalConversationList');
  if(!groupId||!playerId||!box)return;
  const targetKey=`${groupId}:${playerId}:${app.playerPortalState.staffPreview?'coach':'player'}`;
  const targetChanged=box.dataset.conversationKey!==targetKey;
  const firstLoad=initial||targetChanged||box.dataset.loaded!=='1';
  const oldHeight=box.scrollHeight;
  const oldTop=box.scrollTop;
  const wasNearBottom=oldHeight-oldTop-box.clientHeight<48;
  if(firstLoad){
    box.dataset.conversationKey=targetKey;
    box.dataset.loaded='0';
    box.innerHTML='<div class="playerPortalConversationEmpty">Chargement…</div>';
  }
  const viewerRole=app.playerPortalState.staffPreview?'coach':'player';
  const {data,error}=await app.db.rpc('get_player_conversation',{p_group_id:groupId,p_player_id:playerId,p_viewer_role:viewerRole});
  if(error)throw error;
  // Un rafraîchissement périodique ne vide jamais la liste : le bloc conserve sa hauteur
  // jusqu'au moment où le nouveau contenu est prêt, ce qui évite tout déplacement de page.
  const html=app.playerPortalConversationHtml(data||[]);
  if(box.innerHTML!==html)box.innerHTML=html;
  box.dataset.loaded='1';
  if(forceBottom||firstLoad||wasNearBottom)box.scrollTop=box.scrollHeight;
  else box.scrollTop=Math.max(0,oldTop+(box.scrollHeight-oldHeight));
  const hadUnread=(data||[]).some(x=>x.is_read===false);
  if(hadUnread){
    const {error:readError}=await app.db.rpc('mark_player_conversation_read',{p_group_id:groupId,p_player_id:playerId,p_viewer_role:viewerRole});
    if(readError)throw readError;
    await app.refreshMessageNotifications(viewerRole);
  }
};

app.syncPlayerPortalMessagePolling = function syncPlayerPortalMessagePolling(){
  if(app.playerPortalMessagePoll){clearInterval(app.playerPortalMessagePoll);app.playerPortalMessagePoll=null}
  if(app.$('#playerPortal')?.classList.contains('hidden'))return;
  app.playerPortalMessagePoll=setInterval(()=>{
    if(document.hidden||app.$('#playerPortal')?.classList.contains('hidden'))return;
    app.loadPlayerPortalConversation().catch(()=>{});
  },5000);
};

app.afterStaffLanding = async (initialStaff) => {
  app.startSecondaryStartupTasks();
  if(!initialStaff)return;
  if(location.hash==='#stats'){await app.openStatsModule();return}
  const params=new URLSearchParams(location.search||'');
  const group=params.get('staff_group'),player=params.get('staff_player');
  if(group&&player&&app.groupState.groups.some(g=>g.id===group)){
    await app.openGroupDetail(group);
    if(app.groupState.currentPlayers.some(p=>p.id===player)){
      await app.openStaffPlayerPortal(player);
      history.replaceState(null,'',location.pathname+'#player-home');
    }
  }
};

app.updateStartButton = function updateStartButton(){
  const btn=app.$('#start');
  if(!btn)return;
  const count=app.$$('#rosterChecks input:checked').length;
  const value=id=>(app.$('#'+id)?.value||'').trim();
  const missing=[];
  if(!value('matchGroup'))missing.push('groupe');
  if(!value('matchName'))missing.push('nom du match');
  if(!value('matchType'))missing.push('type de match');
  if(!value('matchDate'))missing.push('date');
  if(!value('teamName'))missing.push('équipe suivie');
  if(!value('opponentTeam1'))missing.push('équipe 2');
  if(!value('opponentTeam2'))missing.push('équipe 3');
  if(count!==4)missing.push('exactement 4 joueurs');
  const captureMode=app.state.captureMode||'live';
  if(captureMode==='video'&&!app.matchYoutubeId(value('matchYoutubeUrl')))missing.push('URL YouTube valide');
  const ready=missing.length===0;
  btn.disabled=!ready;
  btn.setAttribute('aria-disabled',String(!ready));
  btn.title=ready?'':`À compléter : ${missing.join(', ')}.`;
};

app.openGroupPlayerFollowup = async function openGroupPlayerFollowup(playerId){
  const groupId=app.groupState.currentGroupId;
  const p=app.groupState.currentPlayers.find(x=>x.id===playerId);
  if(!groupId||!p)return;
  app.groupPlayerFollowupState.playerId=playerId;
  app.$('#groupPlayerFollowupTitle').textContent=`Suivi joueur · ${p.display_name}`;
  app.$('#groupPlayerFollowupRole').value=p.preferred_role||'AP';
  app.$('#groupPlayerFollowupStatsAccess').value=p.stats_access||'personal';
  const linked=!!app.groupState.playerAccess?.[playerId];
  app.$('#groupPlayerFollowupAccessStatus').textContent=linked?'Compte joueur lié':'Accès joueur non encore activé';
  app.$('#groupPlayerFollowupUnlink').classList.toggle('hidden',!linked);
  app.$('#groupPlayerFollowupObjectiveNew').value='';
  app.$('#groupPlayerFollowupFeedbackNew').value='';
  app.$('#groupPlayerFollowupStatus').textContent='';
  app.$('#groupPlayerFollowupPopup').classList.remove('hidden');
  await app.reloadGroupPlayerFollowupObjectives(groupId,playerId);
};

app.saveGroupPlayerFollowup = async function saveGroupPlayerFollowup(){
  const groupId=app.groupState.currentGroupId,playerId=app.groupPlayerFollowupState.playerId;
  if(!groupId||!playerId)return;
  const role=app.$('#groupPlayerFollowupRole').value||'AP';
  const statsAccess=app.$('#groupPlayerFollowupStatsAccess').value==='group'?'group':'personal';
  const status=app.$('#groupPlayerFollowupStatus');
  const save=app.$('#saveGroupPlayerFollowup');
  save.disabled=true;status.textContent='Enregistrement…';
  try{
    const {error}=await app.db.from('coaching_group_players').update({preferred_role:role,stats_access:statsAccess}).eq('group_id',groupId).eq('player_id',playerId);
    if(error)throw error;
    const p=app.groupState.currentPlayers.find(x=>x.id===playerId);if(p){p.preferred_role=role;p.stats_access=statsAccess}
    status.textContent='Droits joueur enregistrés ✓';
    app.renderGroupPlayers();
    app.setCloud('Synchronisé',true);
  }catch(e){
    status.textContent='Erreur lors de l’enregistrement.';
    app.handleError('save group player followup',e);
  }finally{save.disabled=false}
};

};
window.KinballCoach.boot('index');

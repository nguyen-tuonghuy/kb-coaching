/* Training policies and entry point. Session editing lives in js/training. */
window.KinballCoach.policies.training = (app) => {

app.loadPlayerPortalConversation = async function loadPlayerPortalConversation(){
  const groupId=app.playerPortalState.groupId,playerId=app.playerPortalTargetPlayerId();
  const box=app.$('#playerPortalConversationList');
  if(!groupId||!playerId||!box)return;
  box.innerHTML='<div class="playerPortalConversationEmpty">Chargement…</div>';
  const viewerRole=app.playerPortalState.staffPreview?'coach':'player';
  const {data,error}=await app.db.rpc('get_player_conversation',{p_group_id:groupId,p_player_id:playerId,p_viewer_role:viewerRole});
  if(error)throw error;
  box.innerHTML=app.playerPortalConversationHtml(data||[]);
  box.scrollTop=box.scrollHeight;
  const hadUnread=(data||[]).some(x=>x.is_read===false);
  if(hadUnread){
    const {error:readError}=await app.db.rpc('mark_player_conversation_read',{p_group_id:groupId,p_player_id:playerId,p_viewer_role:viewerRole});
    if(readError)throw readError;
    await app.refreshMessageNotifications(viewerRole);
  }
};

app.afterStaffLanding = async () => {
  await app.openTrainingModule();
  app.startSecondaryStartupTasks();
};

app.updateStartButton = function updateStartButton(){
  const count=app.$$('#rosterChecks input:checked').length;
  const hasGroup=!!app.$('#matchGroup').value;
  const btn=app.$('#start');
  btn.disabled=!hasGroup||count!==4;
  btn.title=hasGroup&&count===4?'':'Choisis un groupe puis sélectionne exactement 4 joueurs.';
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
  app.$('#groupPlayerFollowupStatus').textContent='Chargement…';
  app.$('#groupPlayerFollowupMessage').value='';
  app.$('#groupPlayerFollowupMessage').dataset.currentMessage='';
  app.$('#groupPlayerFollowupPopup').classList.remove('hidden');
  try{
    const {data,error}=await app.db.from('coaching_player_messages').select('message,updated_at').eq('group_id',groupId).eq('player_id',playerId).maybeSingle();
    if(error)throw error;
    const current=data?.message||'';
    app.$('#groupPlayerFollowupMessage').value=current;
    app.$('#groupPlayerFollowupMessage').dataset.currentMessage=current;
    await app.loadGroupPlayerMessageHistory(groupId,playerId);
    app.$('#groupPlayerFollowupStatus').textContent=data?.updated_at?'Message actuel chargé.':'';
    await app.reloadGroupPlayerFollowupObjectives(groupId,playerId);
  }catch(e){
    app.$('#groupPlayerFollowupStatus').textContent='Impossible de charger le message.';
    app.handleError('load group player followup',e);
  }
};

app.saveGroupPlayerFollowup = async function saveGroupPlayerFollowup(){
  const groupId=app.groupState.currentGroupId,playerId=app.groupPlayerFollowupState.playerId;
  if(!groupId||!playerId)return;
  const role=app.$('#groupPlayerFollowupRole').value||'AP';
  const statsAccess=app.$('#groupPlayerFollowupStatsAccess').value==='group'?'group':'personal';
  const message=app.$('#groupPlayerFollowupMessage').value.trim();
  const status=app.$('#groupPlayerFollowupStatus');
  const save=app.$('#saveGroupPlayerFollowup');
  save.disabled=true;status.textContent='Enregistrement…';
  try{
    const {error:roleError}=await app.db.from('coaching_group_players').update({preferred_role:role,stats_access:statsAccess}).eq('group_id',groupId).eq('player_id',playerId);
    if(roleError)throw roleError;
    const messageInput=app.$('#groupPlayerFollowupMessage');
    const previous=(messageInput.dataset.currentMessage||'').trim();
    const now=new Date().toISOString();
    const {error:msgError}=await app.db.from('coaching_player_messages').upsert({group_id:groupId,player_id:playerId,message,updated_by:app.currentUser?.id||null,updated_at:now},{onConflict:'group_id,player_id'});
    if(msgError)throw msgError;
    if(message && message!==previous){
      const {error:historyError}=await app.db.from('coaching_player_message_history').insert({group_id:groupId,player_id:playerId,message,created_by:app.currentUser?.id||null,created_at:now});
      if(historyError)throw historyError;
    }
    messageInput.dataset.currentMessage=message;
    await app.loadGroupPlayerMessageHistory(groupId,playerId);
    const p=app.groupState.currentPlayers.find(x=>x.id===playerId);if(p){p.preferred_role=role;p.stats_access=statsAccess}
    status.textContent='Suivi joueur enregistré ✓';
    app.renderGroupPlayers();
    app.setCloud('Synchronisé',true);
  }catch(e){
    status.textContent='Erreur lors de l’enregistrement.';
    app.handleError('save group player followup',e);
  }finally{save.disabled=false}
};

};
window.KinballCoach.boot('training');

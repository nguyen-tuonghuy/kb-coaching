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

};
window.KinballCoach.boot('training');

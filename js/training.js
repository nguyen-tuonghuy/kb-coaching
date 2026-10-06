/* Training policies and entry point. Session editing lives in js/training. */
window.KinballCoach.policies.training = (app) => {

app.loadPlayerPortalConversation = async function loadPlayerPortalConversation(){
  const groupId=app.playerPortalState.groupId,playerId=app.playerPortalTargetPlayerId();
  const box=app.$('#playerPortalConversationList');
  if(!groupId||!playerId||!box)return;
  const viewerRole=app.playerPortalState.staffPreview?'coach':'player';
  await app.loadConversation({box,groupId,playerId,viewerRole,initial:true,forceBottom:true});
};

app.afterStaffLanding = async () => {
  if(app.followupRouteViewFromHash(location.hash||'')){
    const restored=await app.restoreGroupPlayerFollowupRoute({replace:true});
    if(restored){app.startSecondaryStartupTasks();return}
  }
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

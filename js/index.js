/* Homepage policies and entry point. Shared implementations live in js/shared. */
window.KinballCoach.policies.index = (app) => {

app.loadPlayerPortalConversation = async function loadPlayerPortalConversation({initial=false,forceBottom=false}={}){
  const groupId=app.playerPortalState.groupId,playerId=app.playerPortalTargetPlayerId();
  const box=app.$('#playerPortalConversationList');
  if(!groupId||!playerId||!box)return;
  const viewerRole=app.playerPortalState.staffPreview?'coach':'player';
  await app.loadConversation({box,groupId,playerId,viewerRole,initial,forceBottom});
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
  if(group&&player&&app.followupRouteViewFromHash(location.hash||'')){
    await app.restoreGroupPlayerFollowupRoute({replace:true});
    return;
  }
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

};
window.KinballCoach.boot('index');

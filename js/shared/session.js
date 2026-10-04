/* Shared authenticated startup. Page policy owns only the landing destination. */
((app) => {
  app.resetAccountCaches = () => {
    if(app.accountDefaults)Object.assign(app,JSON.parse(app.accountDefaults));
    if(app.groupAnalysisState)app.groupAnalysisState.selected=new Set();
    app.sharedInviteState=null;
    for(const id of ['groupsList','groupPlayersList','groupCoachesList','playerPortalContent','playerPortalConversationList','statsImpactContent','statsMatchSummary','trainingSavedSeasons','trainingPlanTimeline','trainingPlanDraft','trainingExerciseCards','historyResults']){
      const el=app.$('#'+id);if(el)el.innerHTML='';
    }
  };
  app.invalidateSession = () => {
    app.sessionVersion=(app.sessionVersion||0)+1;
    app.cancelPlayerClaimDialog?.();
    if(app.playerPortalMessagePoll){clearInterval(app.playerPortalMessagePoll);app.playerPortalMessagePoll=null}
    app.authenticationTask=null;
    app.authenticationUserId=null;
  };
  app.showSignedOut = () => {
    app.invalidateSession();
    app.currentUser=null;
    app.resetAccountCaches();
    app.hideMainModules();
    document.querySelectorAll('.popupBackdrop').forEach(el=>el.classList.add('hidden'));
    app.$('#playerSpaceBtn').classList.add('hidden');
    app.$('#openAdminModule')?.classList.add('hidden');
    app.$('#authPanel').classList.remove('hidden');
    for(const id of ['homeBtn','profileBtn','logout'])app.$('#'+id).classList.add('hidden');
    localStorage.removeItem(app.KEY);
    app.setCloud('Non connecté',false);
    app.hideStartupScreen();
  };
  app.displayStaffLanding = (accesses=null) => {
    app.hideMainModules();
    app.$('#appHome').classList.toggle('hidden',app.page!=='index');
    app.$('#trainingHome').classList.toggle('hidden',app.page!=='training');
    for(const id of ['groupsHome','groupDetail','trainingSession','trainingHistory'])app.$('#'+id).classList.add('hidden');
    app.$('#homeBtn').classList.remove('hidden');
    app.$('#profileBtn').classList.remove('hidden');
    app.$('#playerSpaceBtn').classList.toggle('hidden',!accesses?.length);
    app.$('#newMatchTop').classList.add('hidden');
    if(app.page==='training'&&app.$('#trainingSavedSeasons'))app.$('#trainingSavedSeasons').innerHTML='<div class="small">Chargement des séances…</div>';
  };

  app.performAuthenticatedStartup = async user => {
    if(app.lastAccountId&&app.lastAccountId!==user.id)app.resetAccountCaches();
    app.lastAccountId=user.id;
    app.currentUser=user;
    const version=app.sessionVersion=(app.sessionVersion||0)+1;
    const active=()=>app.sessionVersion===version&&app.currentUser?.id===user.id;
    const pending=app.pendingPlayerInviteFromUser(user);
    const invited=!!(app.playerGroupInviteToken()||app.playerInviteToken()||pending.group||pending.direct);
    app.$('#authPanel').classList.add('hidden');
    app.$('#setup').classList.add('hidden');
    app.$('#logout').classList.remove('hidden');
    app.setCloud('Connexion…',true);
    const splashGuard=setTimeout(app.hideStartupScreen,4000);
    try{
      try{await app.claimPlayerInviteIfPresent(user)}catch(e){
        if(!active())return;
        const cancelled=!!e?.playerClaimCancelled;
        clearTimeout(splashGuard);
        app.$('#authPanel').classList.remove('hidden');
        await app.loadSharedPlayerInvite().catch(()=>{});
        app.authMessage(cancelled?'Association non confirmée. Vérifie le joueur choisi, puis réessaie.':(e.message||'Impossible d’activer cet accès joueur.'),!cancelled);
        app.setCloud('Accès joueur à compléter',false);
        app.hideStartupScreen();
        throw e;
      }
      if(!active())return;
      const accessesPromise=app.fetchMyPlayerAccesses().catch(error=>{
        if(!active())return [];
        console.warn('[startup] accès joueur',error);
        app.playerPortalState.accesses=[];
        return [];
      });
      await app.fetchMyGroups();
      if(!active())return;
      app.startupTiming('groupes entraîneur chargés');
      if(app.groupState.groups.length&&!invited){
        app.displayStaffLanding();
        app.setCloud('Synchronisé',true);
        clearTimeout(splashGuard);
        app.hideStartupScreen();
        accessesPromise.then(accesses=>{if(active())app.$('#playerSpaceBtn').classList.toggle('hidden',!accesses.length)});
        await app.afterStaffLanding(true);
        return;
      }
      const accesses=await accessesPromise;
      if(!active())return;
      if(accesses.length&&(invited||!app.groupState.groups.length)){
        const portalPromise=app.openPlayerPortal(accesses);
        clearTimeout(splashGuard);
        app.hideStartupScreen();
        app.startSecondaryStartupTasks();
        await portalPromise;
        return;
      }
      app.displayStaffLanding(accesses);
      app.setCloud('Synchronisé',true);
      clearTimeout(splashGuard);
      app.hideStartupScreen();
      await app.afterStaffLanding(false);
    }finally{clearTimeout(splashGuard)}
  };

  app.initAuthenticated = user => {
    if(app.authenticationTask){
      if(app.authenticationUserId===user?.id)return app.authenticationTask;
      app.invalidateSession();
    }
    app.authenticationUserId=user?.id;
    const task=app.performAuthenticatedStartup(user);
    app.authenticationTask=task;
    const release=()=>{if(app.authenticationTask===task){app.authenticationTask=null;app.authenticationUserId=null}};
    task.then(release,release);
    return task;
  };
})(window.KinballCoach.app);

/* Shared authenticated startup. Page policy owns only the landing destination. */
((app) => {
  app.resetAccountCaches = () => {
    if(app.accountDefaults)Object.assign(app,JSON.parse(app.accountDefaults));
    if(app.groupAnalysisState)app.groupAnalysisState.selected=new Set();
    app.sharedInviteState=null;
    app.playerClaimJustCompleted=false;
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
    const groupInviteToken=app.playerGroupInviteToken()||pending.group;
    const invited=!!(groupInviteToken||app.playerInviteToken()||pending.direct);
    let accessesPromise=null;
    let preferredPlayerGroupId='';
    const loadAccesses=()=>accessesPromise||(accessesPromise=app.fetchMyPlayerAccesses().catch(error=>{
      if(!active())return [];
      console.warn('[startup] accès joueur',error);
      app.playerPortalState.accesses=[];
      return [];
    }));
    app.$('#authPanel').classList.add('hidden');
    app.$('#setup').classList.add('hidden');
    app.$('#logout').classList.remove('hidden');
    app.setCloud('Connexion…',true);
    const splashGuard=setTimeout(app.hideStartupScreen,4000);
    try{
      try{
        let claimed=false;
        if(groupInviteToken){
          // Le lien est validé avant de réutiliser un accès existant. Le group_id,
          // jamais le libellé du groupe, détermine si cette invitation est déjà satisfaite.
          const [invite,accesses]=await Promise.all([app.ensureSharedInviteState(groupInviteToken),loadAccesses()]);
          preferredPlayerGroupId=invite.groupId;
          const existing=invite.groupId&&accesses.find(access=>access.group_id===invite.groupId);
          if(existing){
            app.clearPlayerInviteToken();
            await app.clearPendingPlayerInviteMetadata();
          }else{
            claimed=await app.claimPlayerInviteIfPresent(user);
          }
        }else{
          claimed=await app.claimPlayerInviteIfPresent(user);
        }
        if(claimed){
          app.playerClaimJustCompleted=true;
          // La lecture lancée avant la mutation ne contient pas encore le nouvel accès.
          accessesPromise=null;
        }
      }catch(e){
        if(!active())return;
        const cancelled=!!e?.playerClaimCancelled;
        clearTimeout(splashGuard);
        app.$('#authPanel').classList.remove('hidden');
        await app.loadSharedPlayerInvite().catch(()=>{});
        accessesPromise?.then(accesses=>{
          if(active())app.$('#playerSpaceBtn').classList.toggle('hidden',!accesses.length);
        });
        app.authMessage(cancelled?'Association non confirmée. Vérifie le joueur choisi, puis réessaie.':(e.message||'Impossible d’activer cet accès joueur.'),!cancelled);
        app.setCloud('Accès joueur à compléter',false);
        app.hideStartupScreen();
        throw e;
      }
      if(!active())return;
      loadAccesses();
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
        const portalPromise=app.openPlayerPortal(accesses,preferredPlayerGroupId);
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

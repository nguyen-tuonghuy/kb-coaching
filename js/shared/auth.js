/* auth. Shared explicit application context; no startup side effects. */
((app) => {
app.startupTiming = function startupTiming(label){
  console.info(`[startup] ${label}: ${Math.round(performance.now()-app.KC_STARTUP_T0)} ms`);
};

app.hideStartupScreen = function hideStartupScreen(){
  const splash=document.getElementById('startupScreen');
  if(splash){
    splash.remove();
    app.startupTiming('splash masqué');
  }
};

app.runStartupBackground = function runStartupBackground(label,task){
  const version=app.sessionVersion;
  Promise.resolve().then(()=>{if(app.sessionVersion===version)return task()}).catch(error=>{if(app.sessionVersion===version)console.warn('[startup background]',label,error)});
};

app.runStartupDeferred = function runStartupDeferred(label,task,delay=900){
  const version=app.sessionVersion;
  setTimeout(()=>{if(app.sessionVersion===version)app.runStartupBackground(label,task)},delay);
};

app.startSecondaryStartupTasks = function startSecondaryStartupTasks(){
  // Workspace peut être utile rapidement à certains anciens écrans ; le reste attend le premier affichage.
  app.runStartupBackground('workspace',()=>app.ensureWorkspace());
  app.runStartupDeferred('notifications messages',()=>app.refreshMessageNotifications('coach'));
  app.runStartupDeferred('notifications vidéos',()=>app.refreshVideoNotifications());
  app.runStartupDeferred('profil',()=>app.ensureMyProfile());
  app.runStartupDeferred('droits admin',()=>app.refreshAdminAccess());
};

app.saveLocal = function saveLocal(){
  localStorage.setItem(app.KEY,JSON.stringify({
    currentMatchId:app.state.currentMatchId,
    workspaceId:app.state.workspaceId,
    defenseRolesByPeriod:app.state.defenseRolesByPeriod||{}
  }));
};

app.loadLocal = function loadLocal(){
  try{return JSON.parse(localStorage.getItem(app.KEY)||'{}')}catch(e){return {}}
};

app.roster = function roster(){
  const names=app.$('#rosterInput').value.split(',').map(x=>x.trim()).filter(Boolean);
  const seen=new Set();
  return names.filter(name=>{
    const key=name.toLowerCase();
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

app.ensureWorkspace = async function ensureWorkspace(){
  const userId=app.currentUser?.id,version=app.sessionVersion;
  if(!userId)return null;
  const active=()=>app.currentUser?.id===userId&&app.sessionVersion===version;
  const {data:members,error}=await app.db
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id',userId)
    .limit(1);
  if(error) throw error;
  if(!active())return null;
  if(members&&members.length){
    app.state.workspaceId=members[0].workspace_id;
    app.saveLocal();
    return app.state.workspaceId;
  }
  const {data:w,error:we}=await app.db
    .from('workspaces')
    .insert({name:'Kinball Coach',created_by:userId})
    .select('id')
    .single();
  if(we) throw we;
  if(!active())return null;
  const {error:me}=await app.db
    .from('workspace_members')
    .insert({workspace_id:w.id,user_id:userId,role:'owner'});
  if(me) throw me;
  if(!active())return null;
  app.state.workspaceId=w.id;
  app.saveLocal();
  return w.id;
};

app.refreshRecentMatches = async function refreshRecentMatches(){
  if(!app.currentUser)return;
  if(!app.groupState.groups.length) await app.fetchMyGroups();
  const sel=app.$('#recentMatches');
  if(!sel)return;
  sel.innerHTML='<option value="">— Nouveau match —</option>';
  const ids=app.groupState.groups.map(g=>g.id);
  if(!ids.length)return;
  const {data,error}=await app.db.from('matches')
    .select('id,label,played_on,created_at,updated_at,created_by,updated_by,group_id,match_type_id,match_type:match_types!matches_match_type_id_fkey(name),group:coaching_groups!matches_group_id_fkey(name),followed_team:teams!matches_team_id_fkey(name)')
    .in('group_id',ids)
    .order('created_at',{ascending:false}).limit(40);
  if(error)throw error;
  await app.fetchProfiles((data||[]).flatMap(m=>[m.created_by,m.updated_by]));
  (data||[]).forEach(m=>{
    const o=document.createElement('option');o.value=m.id;
    o.textContent=`${m.played_on?app.formatDateShort(m.played_on):'Date ?'} · ${m.label}${m.match_type?.name?' · '+m.match_type.name:''} · ${m.group?.name||m.followed_team?.name||'Groupe'}`;
    o.dataset.createdBy=m.created_by||'';
    o.dataset.updatedBy=m.updated_by||'';
    o.dataset.createdAt=m.created_at||'';
    o.dataset.updatedAt=m.updated_at||'';
    sel.append(o);
  });
  app.updateMatchAuditMeta();
};

app.updateMatchAuditMeta = function updateMatchAuditMeta(){
  const sel=app.$('#recentMatches'),meta=app.$('#matchAuditMeta'),del=app.$('#deleteSavedMatch');
  if(!sel||!meta)return;
  const o=sel.selectedOptions?.[0];
  if(del)del.disabled=!o?.value;
  if(!o || !o.value){meta.classList.add('hidden');meta.textContent='';return}
  const cName=app.auditName(o.dataset.createdBy),uName=app.auditName(o.dataset.updatedBy);
  const cDate=app.formatAuditDate(o.dataset.createdAt),uDate=app.formatAuditDate(o.dataset.updatedAt);
  let txt=`Créé par ${cName}${cDate?' le '+cDate:''}`;
  if(o.dataset.updatedAt && o.dataset.updatedAt!==o.dataset.createdAt){
    txt+=` · Dernière modification par ${uName}${uDate?' le '+uDate:''}`;
  }
  meta.textContent=txt;
  meta.classList.remove('hidden');
};

app.normalizeClaimName = function normalizeClaimName(value){return String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()};

app.playerInviteToken = function playerInviteToken(){try{return new URLSearchParams(location.search||'').get('player_invite')||''}catch{return ''}};

app.playerGroupInviteToken = function playerGroupInviteToken(){try{return new URLSearchParams(location.search||'').get('player_group_invite')||''}catch{return ''}};

app.playerGroupInvitePlayerId = function playerGroupInvitePlayerId(){try{return new URLSearchParams(location.search||'').get('player_id')||localStorage.getItem('kinball_player_invite_player')||''}catch{return ''}};

app.setPlayerGroupInvitePlayerId = function setPlayerGroupInvitePlayerId(playerId){try{const u=new URL(location.href);if(playerId){u.searchParams.set('player_id',playerId);localStorage.setItem('kinball_player_invite_player',playerId)}else{u.searchParams.delete('player_id');localStorage.removeItem('kinball_player_invite_player')}history.replaceState({},'',u.pathname+(u.search||'')+(u.hash||''))}catch{}};

app.clearPlayerInviteToken = function clearPlayerInviteToken(){try{const u=new URL(location.href);u.searchParams.delete('player_invite');u.searchParams.delete('player_group_invite');u.searchParams.delete('player_id');localStorage.removeItem('kinball_player_invite_player');history.replaceState({},'',u.pathname+(u.search||'')+(u.hash||''))}catch{}};

app.authRedirectWithPlayerInvite = function authRedirectWithPlayerInvite(){const direct=app.playerInviteToken(),group=app.playerGroupInviteToken(),playerId=app.playerGroupInvitePlayerId();if(!direct&&!group)return app.AUTH_REDIRECT_URL;const u=new URL(app.AUTH_REDIRECT_URL);if(direct)u.searchParams.set('player_invite',direct);if(group)u.searchParams.set('player_group_invite',group);if(group&&playerId)u.searchParams.set('player_id',playerId);return u.toString()};

app.loadSharedPlayerInvite = async function loadSharedPlayerInvite(){
  const token=app.playerGroupInviteToken(),box=app.$('#playerJoinBox');
  if(!token){box?.classList.add('hidden');return false}
  if(box)box.classList.remove('hidden');
  const status=app.$('#playerJoinStatus'),sel=app.$('#playerJoinSelect'),cont=app.$('#playerJoinContinue');
  if(status)status.textContent='Chargement du groupe…';
  const {data,error}=await app.db.rpc('get_player_group_invite',{p_token:token});
  if(error){if(status)status.textContent=error.message||'Lien invalide ou expiré';if(sel)sel.innerHTML='<option value="">Lien indisponible</option>';cont?.classList.add('hidden');return false}
  if(app.$('#playerJoinGroupName'))app.$('#playerJoinGroupName').textContent=`${data?.group_name||'Groupe'} · sélectionne ton prénom.`;
  const players=data?.players||[],available=players.filter(p=>!p.linked),saved=app.playerGroupInvitePlayerId();
  app.sharedInviteState={token,groupName:data?.group_name||'',players};
  if(sel){
    sel.innerHTML='<option value="">— Choisir mon prénom —</option>'+players.map(p=>`<option value="${app.escapeHtml(p.player_id)}" ${p.linked?'disabled':''}>${app.escapeHtml(p.player_name)}${p.linked?' · compte déjà activé':''}</option>`).join('');
    if(saved&&available.some(p=>p.player_id===saved))sel.value=saved;
    else if(available.length===1){sel.value=available[0].player_id;app.setPlayerGroupInvitePlayerId(sel.value)}
    sel.onchange=()=>{app.setPlayerGroupInvitePlayerId(sel.value);if(status)status.textContent=sel.value?'Ton prénom est sélectionné.':'Sélectionne ton prénom.'}
  }
  const {data:{session}}=await app.db.auth.getSession();
  const signedIn=!!session?.user;
  if(cont)cont.classList.toggle('hidden',!signedIn);
  app.$('#playerLoginBox')?.classList.toggle('hidden',signedIn);
  app.$('#playerSignupBox')?.classList.toggle('hidden',signedIn);
  if(status){
    if(!available.length)status.textContent='Tous les joueurs de ce groupe ont déjà activé leur accès.';
    else if(signedIn)status.textContent=sel?.value?'Ton prénom est sélectionné. Clique sur « Continuer avec ce compte ».':'Tu es déjà connecté. Sélectionne ton prénom puis continue.';
    else status.textContent=sel?.value?'Ton prénom est sélectionné. Connecte-toi ou crée ton compte.':'Sélectionne ton prénom puis connecte-toi ou crée ton compte.';
  }
  return true
};

app.pendingPlayerInviteFromUser = function pendingPlayerInviteFromUser(user=app.currentUser){
  const meta=user?.user_metadata||{};
  return {
    direct:meta.pending_player_invite||'',
    group:meta.pending_player_group_invite||'',
    playerId:meta.pending_player_id||''
  };
};

app.clearPendingPlayerInviteMetadata = async function clearPendingPlayerInviteMetadata(){
  try{
    const {error}=await app.db.auth.updateUser({data:{
      pending_player_invite:null,
      pending_player_group_invite:null,
      pending_player_id:null
    }});
    if(error)throw error;
  }catch(e){console.warn('Unable to clear pending player invite metadata',e)}
};

app.ensureSharedInviteState = async function ensureSharedInviteState(token){
  if(app.sharedInviteState?.token===token)return app.sharedInviteState;
  const {data,error}=await app.db.rpc('get_player_group_invite',{p_token:token});
  if(error)throw error;
  app.sharedInviteState={token,groupName:data?.group_name||'',players:data?.players||[]};
  return app.sharedInviteState
};

app.closePlayerClaimConfirmation = function closePlayerClaimConfirmation(){
  app.$('#playerClaimConfirmPopup')?.classList.add('hidden');
  const summary=app.$('#playerClaimSummary');if(summary)summary.innerHTML='';
  const warning=app.$('#playerClaimWarning');if(warning){warning.classList.add('hidden');warning.innerHTML=''}
  const status=app.$('#playerClaimStatus');if(status)status.textContent=''
};

app.confirmPlayerClaimAssociation = function confirmPlayerClaimAssociation({token,playerId}){
  const popup=app.$('#playerClaimConfirmPopup');
  const account=app.currentUser;
  if(!popup)return Promise.reject(new Error('Le dialogue de confirmation est indisponible. Recharge la page.'));
  if(!account?.id||!String(account.email||'').trim())return Promise.reject(new Error('Le compte connecté est introuvable. Reconnecte-toi.'));
  return app.ensureSharedInviteState(token).then(invite=>{
    const chosen=(invite.players||[]).find(p=>p.player_id===playerId);
    if(!chosen||!String(chosen.player_name||'').trim()||!String(invite.groupName||'').trim())throw new Error('Le joueur ou le groupe de cette invitation est introuvable. Vérifie la sélection.');
    const playerName=chosen.player_name;
    const groupName=invite.groupName;
    const email=account.email;
    const cachedProfile=app.groupState.profiles?.[app.currentUser?.id]||'';
    return app.getMyProfile()
      .then(profile=>profile?.first_name||cachedProfile)
      .catch(()=>cachedProfile)
      .then(profileFirstName=>{
        if(app.currentUser?.id!==account.id)throw new Error('Le compte connecté a changé. Réessaie avec ce compte.');
        const profileName=String(profileFirstName||'').trim();
        const summary=app.$('#playerClaimSummary'),warning=app.$('#playerClaimWarning'),status=app.$('#playerClaimStatus');
        if(summary)summary.innerHTML=[['Compte',email],['Profil',profileName||'non renseigné'],['Joueur choisi',playerName],['Groupe',groupName]]
          .map(([label,value])=>`<div class="field"><label>${app.escapeHtml(label)}</label><div>${app.escapeHtml(value)}</div></div>`).join('');
        if(warning){
          // Avertissement renforcé, jamais bloquant : surnoms et écarts légitimes existent.
          if(profileName&&app.normalizeClaimName(profileName)!==app.normalizeClaimName(playerName)){
            warning.innerHTML=`<strong>⚠ Attention : le prénom du profil « ${app.escapeHtml(profileName)} » ne correspond pas au joueur choisi « ${app.escapeHtml(playerName)} ».</strong><br>Cette différence peut être légitime (surnom, second prénom). Vérifie bien que c’est toi avant de valider.`;
            warning.classList.remove('hidden')
          }else{
            warning.classList.add('hidden');warning.innerHTML=''
          }
        }
        if(status)status.textContent='';
        popup.classList.remove('hidden');
        return new Promise(resolve=>{
          const previousFocus=document.activeElement;
          let settled=false;
          const settle=answer=>{
            if(settled)return;
            settled=true;
            app.$('#confirmPlayerClaim').onclick=null;
            app.$('#cancelPlayerClaim').onclick=null;
            app.$('#closePlayerClaimConfirm').onclick=null;
            popup.onclick=null;
            document.removeEventListener('keydown',onKeyDown,true);
            if(app.cancelPlayerClaimDialog===cancel)app.cancelPlayerClaimDialog=null;
            app.closePlayerClaimConfirmation();
            if(previousFocus?.isConnected&&!previousFocus.closest('.hidden'))previousFocus.focus();
            resolve(answer)
          };
          const cancel=()=>settle(false);
          app.cancelPlayerClaimDialog=cancel;
          const onKeyDown=event=>{
            if(event.key==='Escape'){event.preventDefault();event.stopPropagation();settle(false);return}
            if(event.key!=='Tab')return;
            const controls=[...popup.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(el=>!el.closest('.hidden'));
            const first=controls[0],last=controls.at(-1);
            if(!popup.contains(document.activeElement)){event.preventDefault();first?.focus();return}
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
            else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
          };
          app.$('#confirmPlayerClaim').onclick=()=>settle(true);
          app.$('#cancelPlayerClaim').onclick=()=>settle(false);
          app.$('#closePlayerClaimConfirm').onclick=()=>settle(false);
          // Clic sur le fond : annulation explicite, au même titre que « Retour ».
          popup.onclick=e=>{if(e.target===popup)settle(false)};
          document.addEventListener('keydown',onKeyDown,true);
          app.$('#cancelPlayerClaim')?.focus();
        })
      })
  })
};

app.performPlayerInviteClaim = async function performPlayerInviteClaim(user=app.currentUser){
  const verifyAccount=async()=>{
    const {data:{session},error}=await app.db.auth.getSession();
    if(error)throw error;
    if(session?.user?.id!==user?.id)throw new Error('Le compte connecté a changé. Reconnecte-toi avant de confirmer.');
  };
  const pending=app.pendingPlayerInviteFromUser(user);
  const groupToken=app.playerGroupInviteToken()||pending.group;
  if(groupToken){
    const playerId=app.playerGroupInvitePlayerId()||pending.playerId;
    if(!playerId)throw new Error('Sélectionne ton prénom avant de te connecter.');
    const confirmed=await app.confirmPlayerClaimAssociation({token:groupToken,playerId});
    if(!confirmed){
      // Aucune écriture : ni coaching_player_accounts, ni URL, ni métadonnées.
      // Le marqueur accompagne l'erreur jusqu'aux appelants pour éviter
      // qu'une annulation volontaire soit signalée comme une panne.
      const cancelled=new Error('Association non confirmée.');
      cancelled.playerClaimCancelled=true;
      throw cancelled
    }
    if(app.currentUser?.id!==user?.id)throw new Error('Le compte connecté a changé. Réessaie avec ce compte.');
    await verifyAccount();
    const {error}=await app.db.rpc('claim_coaching_player_group_invite',{p_token:groupToken,p_player_id:playerId});
    if(error)throw error;
    app.clearPlayerInviteToken();
    await app.clearPendingPlayerInviteMetadata();
    return true
  }
  const token=app.playerInviteToken()||pending.direct;
  if(!token)return false;
  await verifyAccount();
  const {error}=await app.db.rpc('claim_coaching_player_invite',{p_token:token});
  if(error)throw error;
  app.clearPlayerInviteToken();
  await app.clearPendingPlayerInviteMetadata();
  return true
};

// Covers resolution, consent, mutation and metadata cleanup, not just the button.
app.claimPlayerInviteIfPresent = (user=app.currentUser) => {
  if(app.playerClaimTask){
    if(app.playerClaimUserId===user?.id)return app.playerClaimTask;
    return app.playerClaimTask.catch(()=>{}).then(()=>app.claimPlayerInviteIfPresent(user));
  }
  app.playerClaimUserId=user?.id;
  const task=app.performPlayerInviteClaim(user);
  app.playerClaimTask=task;
  const release=()=>{if(app.playerClaimTask===task)app.playerClaimTask=null};
  task.then(release,release);
  return task;
};

app.fetchMyPlayerAccesses = async function fetchMyPlayerAccesses(){
  const id=app.currentUser?.id;
  const accesses=await app.services.playerAccess();
  if(app.currentUser?.id!==id)return [];
  app.playerPortalState.accesses=accesses;
  return accesses;
};

app.initAuth = async function initAuth(){
  app.$('#matchDate').value=app.isoToFrInput(app.today());
  app.$('#matchGroup').value=app.groupState.groups[0]?.id||'';
  if(app.$('#matchGroup').value) app.loadMatchGroupPlayers(app.$('#matchGroup').value).catch(e=>app.handleError('match group',e));
  if(app.$('#trainingDate')) app.$('#trainingDate').value=app.isoToFrInput(app.today());
  const hashParams=new URLSearchParams(location.hash.replace(/^#/,'')||'');
  const queryParams=new URLSearchParams(location.search||'');
  const recoveryLink=hashParams.get('type')==='recovery'||queryParams.get('type')==='recovery';
  const {data:{session}}=await app.db.auth.getSession();
  app.startupTiming('session Supabase disponible');
  if(session?.user){
    if(app.playerGroupInviteToken()&&!app.playerGroupInvitePlayerId()){
      app.currentUser=session.user;
      app.$('#authPanel').classList.remove('hidden');
      app.$('#setup').classList.add('hidden');
      app.$('#logout').classList.remove('hidden');
      app.setCloud('Accès joueur',true);
      app.authMessage('Tu es déjà connecté : sélectionne ton prénom puis continue.');
      app.hideStartupScreen();
      app.runStartupBackground('invitation joueur',()=>app.loadSharedPlayerInvite());
    }else{
      try{await app.initAuthenticated(session.user)}catch(e){if(!e?.playerClaimCancelled)console.error('initAuthenticated',e)}
    }
    if(recoveryLink) app.openResetPasswordPopup(true);
  }else{
    app.$('#authPanel').classList.remove('hidden');
    app.$('#setup').classList.add('hidden');
    app.setCloud('Non connecté',false);
    app.hideStartupScreen();
    if(app.playerInviteToken())app.authMessage('Invitation joueur détectée : connecte-toi ou crée ton compte pour accéder à ta page personnelle.');
    if(app.playerGroupInviteToken()){
      app.authMessage('Accès joueur détecté : sélectionne ton prénom puis connecte-toi ou crée ton compte.');
      app.runStartupBackground('invitation joueur',()=>app.loadSharedPlayerInvite());
    }
  }
  app.db.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){app.showSignedOut();return}
    if(session?.user && (!app.currentUser || app.currentUser.id!==session.user.id)){
      // Return before any auth/database calls: Supabase invokes subscribers under
      // its session lock. Awaiting getSession/updateUser here can deadlock.
      Promise.resolve().then(()=>app.initAuthenticated(session.user)).catch(e=>{if(!e?.playerClaimCancelled)app.handleError('auth change',e)});
    }
    if(event==='PASSWORD_RECOVERY') app.openResetPasswordPopup(true);
  });
};

app.openSignupPopup = function openSignupPopup(){
  if(app.playerGroupInviteToken()&&!app.playerGroupInvitePlayerId()){app.authMessage('Sélectionne d’abord ton prénom.',true);return}
  app.$('#signupFirstName').value='';
  app.$('#signupEmail').value='';
  app.$('#signupPassword').value='';
  app.signupMessage('');
  app.$('#signupPopup').classList.remove('hidden');
  app.resetPopupScroll('#signupPopup');
  setTimeout(()=>app.$('#signupEmail').focus(),0);
};

app.closeSignupPopup = function closeSignupPopup(){
  app.$('#signupPassword').value='';
  app.$('#signupPopup').classList.add('hidden');
  app.signupMessage('');
};

app.openForgotPasswordPopup = function openForgotPasswordPopup(){
  app.$('#forgotPasswordEmail').value=app.$('#authEmail').value.trim();
  app.forgotPasswordMessage('');
  app.$('#forgotPasswordPopup').classList.remove('hidden');
  app.resetPopupScroll('#forgotPasswordPopup');
  setTimeout(()=>app.$('#forgotPasswordEmail').focus(),0);
};

app.closeForgotPasswordPopup = function closeForgotPasswordPopup(){
  app.$('#forgotPasswordPopup').classList.add('hidden');
  app.forgotPasswordMessage('');
};

app.openResetPasswordPopup = function openResetPasswordPopup(fromRecovery=false){
  app.resetPasswordFromRecovery=!!fromRecovery;
  app.$('#newPassword').value='';
  app.$('#confirmNewPassword').value='';
  app.$('#resetPasswordMeta').textContent=fromRecovery
    ? 'Le lien de récupération est valide. Choisis maintenant un nouveau mot de passe.'
    : 'Choisis le nouveau mot de passe de ton compte.';
  app.resetPasswordMessage('');
  app.$('#resetPasswordPopup').classList.remove('hidden');
  app.resetPopupScroll('#resetPasswordPopup');
  setTimeout(()=>app.$('#newPassword').focus(),0);
};

app.closeResetPasswordPopup = function closeResetPasswordPopup(){
  app.$('#newPassword').value='';
  app.$('#confirmNewPassword').value='';
  app.$('#resetPasswordPopup').classList.add('hidden');
  app.resetPasswordMessage('');
};
})(window.KinballCoach.app);

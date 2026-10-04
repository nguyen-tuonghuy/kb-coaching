/* Ordered initialization and UI binding, once per document. */
(() => {
  const kc=window.KinballCoach;
  kc.boot = (page) => {
    const app=kc.app;
    if(app.started)return;
    if(!kc.policies[page])throw new Error('Missing page policy: '+page);
    app.started=true;
    app.page=page;
    kc.policies[page](app);
app.KEY = 'kinball_coach_cloud_v200';

app.SUPABASE_URL = 'https://chrbzchthloxowlzdvpe.supabase.co';

app.SUPABASE_KEY = 'sb_publishable_4pQGJ5DSzMRBuHLrAUb30g_MGZVYvEY';

app.AUTH_REDIRECT_URL = 'https://nguyen-tuonghuy.github.io/kb-coaching/';

if(!window.supabase){
  document.body.innerHTML='<div style="padding:24px;font-family:sans-serif;color:white;background:#111;min-height:100vh"><h2>Erreur de chargement</h2><p>La bibliothèque Supabase ne s’est pas chargée. Recharge la page avec une connexion Internet active.</p></div>';
  throw new Error('Supabase library failed to load');
}

app.db = window.supabase.createClient(app.SUPABASE_URL,app.SUPABASE_KEY);
app.services = kc.createDataServices({db:app.db,getUser:()=>app.currentUser});
app.services.matchDataset = kc.createMatchDataService(app.db);

app.state = {
  matchName:'',matchTypeId:null,teamName:'',opponentTeams:[],opponentTeamIds:{},matchDate:'',players:[],activePlayers:[],events:[],
  currentMatchId:null,currentTeamId:null,workspaceId:null,playerIds:{},defenseRolesByPeriod:{},
  captureMode:'live',youtubeUrl:'',youtubeVideoId:''
};

app.matchVideoPlayer = null;
app.matchVideoPlayerReady = false;
app.matchVideoWantedId = '';
app.matchVideoPreferredSpeed = 1.5;

app.context = 'jeu_centre';
app.pending = null;
app.zone = '';
app.movement = '';
app.who = '';
app.whoMany = [];
app.faultType = '';
app.faultWho = '';
app.editingId = null;
app.opponentTeam = '';

app.family = 'centre';
app.actionType = 'Attaque';
app.actionResult = '';
app.restartLocation = '';

app.quickSelectedAction = null;

app.currentUser = null;

app.$ = s=>document.querySelector(s);
app.$$ = s=>[...document.querySelectorAll(s)];

({escapeHtml: app.escapeHtml,escapeAttr: app.escapeAttr,matchYoutubeId: app.matchYoutubeId,parseMatchVideoTime: app.parseMatchVideoTime,formatMatchVideoTime: app.formatMatchVideoTime} = window.KinballCoach.utils);

app.today = ()=>new Date().toISOString().slice(0,10);

app.matchVideoResumeSeconds = 0;

app.matchVideoResumePending = false;

app.matchVideoResumeToken = 0;

app.VIDEO_PANE_KEY = 'kinball_video_pane_ratio';

app.youtubeIframeApiPromise = null;

app.setCloud = (text,ok=true)=>{
  app.$('#cloudStatus').textContent=text;
  app.$('#cloudDot').classList.toggle('online',ok);
  app.$('#cloudDot').classList.toggle('offline',!ok);
};

app.authMessage = (text,error=false)=>{
  app.$('#authStatus').textContent=text||'';
  app.$('#authStatus').className='authStatus '+(error?'cloudErr':'cloudOk');
};

app.handleError = (where,error)=>{
  console.error(where,error);
  app.setCloud('Erreur de synchronisation',false);
  alert((error&&error.message)||String(error)||'Erreur de synchronisation');
};

app.KC_STARTUP_T0 = performance.now();

app.sharedInviteState = null;

window.addEventListener('hashchange',()=>{
  if(app.$('#playerPortal')?.classList.contains('hidden'))return;
  if(location.hash==='#team-stats'){
    const access=app.playerPortalAccessForGroup(app.playerPortalState.groupId)||app.playerPortalState.accesses?.[0];
    if(app.playerPortalCanViewGroupStats(access))app.openGroupStatsViewer(access).catch(e=>app.handleError('team stats hash',e));
    return;
  }
  const wanted=location.hash==='#player-profile'?'profile':location.hash==='#player-home'?'home':null;
  if(wanted)app.playerPortalSetView(wanted);
});

document.addEventListener('click',e=>{
  const teamStatsLink=e.target.closest?.('#playerPortalNavGroupStats,#playerPortalHomeGroupStatsCard');
  if(teamStatsLink){
    e.preventDefault();
    const access=app.playerPortalAccessForGroup(app.playerPortalState.groupId)||app.playerPortalState.accesses?.[0];
    if(app.playerPortalCanViewGroupStats(access))app.openGroupStatsViewer(access).catch(err=>app.handleError('open team stats',err));
    return;
  }
  const link=e.target.closest?.('#playerPortalNavHome,#playerPortalNavStats,#playerPortalNavProfile,#playerPortalHomeStatsCard,#playerPortalHomeProfileCard');
  if(!link)return;
  const href=link.getAttribute('href')||'';
  const hash=href.includes('#')?'#'+href.split('#').pop():'';
  const wanted=hash==='#player-stats'?'stats':hash==='#player-profile'?'profile':hash==='#player-home'?'home':null;
  if(!wanted)return;
  if(location.hash===hash){
    e.preventDefault();
    app.playerPortalSetView(wanted);
  }
});

if (page === 'index') {
app.playerPortalMessagePoll = null;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)app.syncPlayerPortalMessagePolling()});
}

app.videoNotificationState = [];

app.$('#login').onclick=async()=>{
  if(app.playerGroupInviteToken()&&!app.playerGroupInvitePlayerId()){app.authMessage('Sélectionne d’abord ton prénom.',true);return}
  app.authMessage('Connexion…');
  const email=app.$('#authEmail').value.trim();
  const password=app.$('#authPassword').value;
  const {data,error}=await app.db.auth.signInWithPassword({email,password});
  app.$('#authPassword').value='';
  if(error){app.authMessage(error.message,true);return}
  app.authMessage('');
  try{await app.initAuthenticated(data.user)}catch(e){if(!e?.playerClaimCancelled)app.handleError('login init',e)}
};

app.signupMessage = (text,error=false)=>{
  const el=app.$('#signupStatus');
  el.textContent=text||'';
  el.className='authStatus '+(error?'cloudErr':'');
};

app.$('#signup').onclick=app.openSignupPopup;

app.$('#cancelSignup').onclick=app.closeSignupPopup;

app.$('#closeSignupPopup').onclick=app.closeSignupPopup;

app.$('#signupPopup').onclick=e=>{if(e.target===app.$('#signupPopup'))app.closeSignupPopup()};

app.$('#confirmSignup').onclick=async()=>{
  const firstName=app.$('#signupFirstName').value.trim();
  const email=app.$('#signupEmail').value.trim();
  const password=app.$('#signupPassword').value;
  if(!firstName){app.signupMessage('Saisis ton prénom.',true);return}
  if(!email){app.signupMessage('Saisis une adresse e-mail.',true);return}
  if(!password){app.signupMessage('Choisis un mot de passe.',true);return}
  app.signupMessage('Création du compte…');
  const pendingGroupInvite=app.playerGroupInviteToken();
  const pendingPlayerId=app.playerGroupInvitePlayerId();
  const pendingDirectInvite=app.playerInviteToken();
  const {data,error}=await app.db.auth.signUp({
    email,password,
    options:{
      emailRedirectTo:app.authRedirectWithPlayerInvite(),
      data:{
        first_name:firstName,
        pending_player_group_invite:pendingGroupInvite||null,
        pending_player_id:pendingPlayerId||null,
        pending_player_invite:pendingDirectInvite||null
      }
    }
  });
  app.$('#signupPassword').value='';
  if(error){app.signupMessage(error.message,true);return}
  if(data.session){
    const {error:profileError}=await app.db.rpc('set_my_first_name',{p_first_name:firstName});
    if(profileError){app.signupMessage(profileError.message,true);return}
    app.groupState.profiles[data.user.id]=firstName;
    app.closeSignupPopup();
    try{await app.initAuthenticated(data.user)}catch(e){app.handleError('signup init',e)}
  }else{
    app.signupMessage('Compte créé. Confirme ton adresse e-mail puis reviens te connecter.');
  }
};

app.forgotPasswordMessage = (text,error=false)=>{
  const el=app.$('#forgotPasswordStatus');
  el.textContent=text||'';
  el.className='authStatus '+(error?'cloudErr':'cloudOk');
};

app.$('#forgotPassword').onclick=app.openForgotPasswordPopup;

app.$('#cancelForgotPassword').onclick=app.closeForgotPasswordPopup;

app.$('#closeForgotPasswordPopup').onclick=app.closeForgotPasswordPopup;

app.$('#forgotPasswordPopup').onclick=e=>{if(e.target===app.$('#forgotPasswordPopup'))app.closeForgotPasswordPopup()};

app.$('#sendResetPassword').onclick=async()=>{
  const email=app.$('#forgotPasswordEmail').value.trim();
  if(!email){app.forgotPasswordMessage('Saisis ton adresse e-mail.',true);return}
  app.forgotPasswordMessage('Envoi du lien…');
  const {error}=await app.db.auth.resetPasswordForEmail(email,{redirectTo:app.AUTH_REDIRECT_URL});
  if(error){app.forgotPasswordMessage(error.message,true);return}
  app.forgotPasswordMessage('Si cette adresse correspond à un compte, un e-mail de réinitialisation vient d’être envoyé.');
};

app.resetPasswordFromRecovery = false;

app.resetPasswordMessage = (text,error=false)=>{
  const el=app.$('#resetPasswordStatus');
  el.textContent=text||'';
  el.className='authStatus '+(error?'cloudErr':'cloudOk');
};

app.$('#openChangePassword').onclick=()=>app.openResetPasswordPopup(false);

app.$('#cancelResetPassword').onclick=app.closeResetPasswordPopup;

app.$('#closeResetPasswordPopup').onclick=app.closeResetPasswordPopup;

app.$('#resetPasswordPopup').onclick=e=>{if(e.target===app.$('#resetPasswordPopup'))app.closeResetPasswordPopup()};

app.$('#saveNewPassword').onclick=async()=>{
  const password=app.$('#newPassword').value;
  const confirmation=app.$('#confirmNewPassword').value;
  if(!password){app.resetPasswordMessage('Choisis un nouveau mot de passe.',true);return}
  if(password.length<6){app.resetPasswordMessage('Le mot de passe doit contenir au moins 6 caractères.',true);return}
  if(password!==confirmation){app.resetPasswordMessage('Les deux mots de passe ne correspondent pas.',true);return}
  app.resetPasswordMessage('Enregistrement…');
  const {error}=await app.db.auth.updateUser({password});
  if(error){app.resetPasswordMessage(error.message,true);return}
  app.resetPasswordMessage('Mot de passe modifié ✓');
  if(app.resetPasswordFromRecovery){
    history.replaceState(null,'',app.AUTH_REDIRECT_URL);
  }
  setTimeout(app.closeResetPasswordPopup,900);
};

if (page === 'index') {
app.$('#homeBtn').onclick=app.showAppHome;
}

if (page === 'training') {
app.$('#homeBtn').onclick=()=>{window.location.href='index.html'};
}

app.$('#profileBtn').onclick=app.openProfilePopup;

app.$('#closeProfilePopup').onclick=(ev)=>{ev.preventDefault();ev.stopPropagation();app.closeProfilePopup();};

app.$('#cancelProfile').onclick=(ev)=>{ev.preventDefault();ev.stopPropagation();app.closeProfilePopup();};

app.$('#profilePopup').onclick=(ev)=>{if(ev.target===app.$('#profilePopup'))app.closeProfilePopup();};

app.$('#saveProfile').onclick=(ev)=>{
  ev.preventDefault();
  ev.stopPropagation();
  app.saveMyProfile().catch(e=>{
    const st=app.$('#profileStatus');
    st.textContent=e.message||String(e);
    st.className='authStatus cloudErr';
  });
};

app.$('#logout').onclick=async()=>{
  if(!confirm('Voulez-vous vraiment vous déconnecter ?'))return;
  app.showSignedOut();
  await app.db.auth.signOut();
};

app.DEFENSE_ROLES = ['R','A1','P','A2'];

app.$$('.entryAction').forEach(b=>b.onclick=(ev)=>{
  ev.stopPropagation();
  app.showQuickOutcomes(b);
});

document.addEventListener('click',ev=>{
  // Une fois l'issue choisie, conserver l'action active pendant les réglages
  // du bloc de saisie (ou du détail de faute). Elle sera réinitialisée au
  // second clic sur le même bouton ou après sauvegarde.
  const detailOpen=!app.$('#popup')?.classList.contains('hidden')||!app.$('#faultPopup')?.classList.contains('hidden');
  if(detailOpen)return;
  if(!ev.target.closest('.entryAction')&&!ev.target.closest('.actionOutcomeDropdown'))app.clearQuickOutcomeSelection();
});

window.addEventListener('resize',()=>{
  const selected=document.querySelector('.entryAction.selected');
  const menu=document.querySelector('.actionOutcomeDropdown');
  if(selected&&menu)app.positionActionOutcomeDropdown(selected,menu);
});

window.addEventListener('scroll',()=>{
  const selected=document.querySelector('.entryAction.selected');
  const menu=document.querySelector('.actionOutcomeDropdown');
  if(selected&&menu)app.positionActionOutcomeDropdown(selected,menu);
},{passive:true});

app.$$('#restartLocationOptions button').forEach(b=>b.onclick=()=>{
  app.restartLocation=b.dataset.restart;app.context='remise_'+app.restartLocation;
  app.$$('#restartLocationOptions button').forEach(x=>x.classList.remove('choice'));b.classList.add('choice');
  app.updatePopupSaveVisibility();
});

app.$$('#zoneOptions button').forEach(b=>b.onclick=()=>{
  app.zone=b.dataset.zone;
  app.$$('#zoneOptions button').forEach(x=>x.classList.remove('choice'));
  b.classList.add('choice');

  if(app.actionType==='Défense'&&['Échappé','Ballon défendu'].includes(app.actionResult)){
    const map=app.defenseRoleMapForPopup();
    if(app.zone==='RE'&&map?.R){
      app.who='';app.whoMany=[map.R];
      app.refreshDefenseAttributionUI();
    }else if(app.zone==='EE'&&map?.P){
      app.who='';app.whoMany=[map.P];
      app.refreshDefenseAttributionUI();
    }else if(!app.zone){
      app.who='';app.whoMany=[];
      app.refreshDefenseAttributionUI();
    }
    app.updatePopupSaveVisibility();
  }
});

app.centerDefenseGestureState = new WeakMap();

app.$$('#centerDefenseMap .sector').forEach(el=>{
  const st={simpleTimer:null,longTimer:null,longTriggered:false,suppressClickUntil:0};
  app.centerDefenseGestureState.set(el,st);

  el.addEventListener('pointerdown',ev=>{
    if(!app.isCenterDiagram())return;
    st.longTriggered=false;
    clearTimeout(st.longTimer);
    st.longTimer=setTimeout(()=>{
      st.longTriggered=true;
      st.suppressClickUntil=Date.now()+700;
      clearTimeout(st.simpleTimer);
      app.applyCenterDiagramGesture(el,true);
      if(navigator.vibrate)navigator.vibrate(35);
    },480);
  });

  const cancelLong=()=>{clearTimeout(st.longTimer);st.longTimer=null};
  el.addEventListener('pointerup',cancelLong);
  el.addEventListener('pointercancel',cancelLong);
  el.addEventListener('pointerleave',cancelLong);

  el.addEventListener('click',ev=>{
    if(!app.isCenterDiagram())return;
    ev.preventDefault();
    if(st.longTriggered||Date.now()<st.suppressClickUntil){
      st.longTriggered=false;
      return;
    }
    if(ev.detail>=2){
      clearTimeout(st.simpleTimer);
      st.simpleTimer=null;
      app.applyCenterDiagramGesture(el,true);
      return;
    }
    clearTimeout(st.simpleTimer);
    st.simpleTimer=setTimeout(()=>{
      st.simpleTimer=null;
      app.applyCenterDiagramGesture(el,false);
    },260);
  });

  el.addEventListener('dblclick',ev=>{
    if(!app.isCenterDiagram())return;
    ev.preventDefault();
    clearTimeout(st.simpleTimer);
    st.simpleTimer=null;
    app.applyCenterDiagramGesture(el,true);
  });
});

app.centerBall = app.$('#centerDefenseMap .ball');

if(app.centerBall){
  app.centerBall.addEventListener('pointerup',ev=>{
    if(!app.isCenterDiagram())return;
    ev.preventDefault();
    if(app.isCenterDefense()){
      app.applyCenterDefenseIllegal();
    }else if(app.isCenterAttack()){
      app.actionResult='Faute attaque';
      app.pending='Faute';
      app.zone='';
      app.$$('#centerDefenseMap .sector').forEach(x=>x.classList.remove('selected'));
      app.$('#popup').classList.add('hidden');
      app.openFaultPopup();
    }
    if(navigator.vibrate)navigator.vibrate(35);
  });
}

app.$('#period').onchange=()=>{app.renderDefenseRoleSetup();app.refreshCenterDefenseMapLabels();};

app.$$('#moveOptions button').forEach(b=>b.onclick=()=>{app.movement=b.dataset.move;app.$$('#moveOptions button').forEach(x=>x.classList.remove('choice'));b.classList.add('choice')});

app.$$('#faultTypes button').forEach(b=>b.onclick=()=>{app.faultType=b.dataset.fault;app.$$('#faultTypes button').forEach(x=>x.classList.remove('choice'));b.classList.add('choice')});

app.$('#savePopup').onclick=async()=>{
  const missing=app.missingActionFields();
  if(missing.length){
    const message=missing.length===1
      ? `Impossible d’enregistrer : il manque le champ « ${missing[0]} ».`
      : `Impossible d’enregistrer. Il manque :\n• ${missing.join('\n• ')}`;
    alert(message);
    return;
  }
  try{
    app.setCloud('Enregistrement…',true);
    const isDefenseFault=app.actionType==='Défense'&&app.actionResult==='Défensive illégale';
    const isOpponentFault=app.actionType==='Défense'&&app.actionResult==='Faute de l’adversaire';
    const base={
      videoPosition:app.currentVideoPosition(),period:(app.$('#popupPeriod')?.value||app.$('#period').value||'P1'),context: app.context,family: app.family,
      restartLocation:app.restartLocation||null,opponentTeam:app.opponentTeam||null,action:isDefenseFault?'Faute':app.pending,
      faultType:isDefenseFault?'Défensive illégale':null,
      zone:(isDefenseFault||isOpponentFault||app.family==='gel')?null:(app.zone||null),movement:(isDefenseFault||isOpponentFault)?null:(app.movement||null),
      player:app.actionType==='Défense'?null:(app.who||null),
      attributedPlayers:(app.actionType==='Défense'&&!isOpponentFault)?[...app.whoMany]:[],
      activePlayers:[...app.state.activePlayers],createdAt:new Date().toISOString()
    };
    const isEdit=!!app.editingId;
    const eventId=await app.persistEvent(base,isEdit);
    if(isEdit){
      const i=app.state.events.findIndex(e=>e.id===app.editingId);
      if(i>=0) app.state.events[i]={...app.state.events[i],...base,id:eventId};
    }else{
      app.state.events.push({id:eventId,...base});
    }
    app.editingId=null;app.$('#popup').classList.add('hidden');app.$('#faultPopup')?.classList.add('hidden');app.$('#popup').classList.remove('quickOutcomePreset','quickCenterSimple');app.clearQuickOutcomeSelection();app.render();app.setCloud('Synchronisé',true);
  }catch(e){app.handleError('save event',e)}
};

if(app.$('#popupPeriod'))app.$('#popupPeriod').onchange=()=>{
  const vp=(app.$('#videoPosition').value||'').trim();
  app.$('#popupMeta').textContent=(app.editingId?app.labelContext(app.context):'')+(app.editingId&&vp?' · vidéo '+vp:'');
  app.applyAutomaticDefenseAttribution();
};

if(app.$('#faultPeriod'))app.$('#faultPeriod').onchange=()=>{
  const vp=(app.$('#videoPosition').value||'').trim();
  app.$('#faultMeta').textContent=(app.actionType==='Défense'?'Défensive illégale':'Faute d’attaque')+' · '+app.labelContext(app.context)+(vp?' · vidéo '+vp:'');
};

app.$('#saveFault').onclick=async()=>{
  if(!app.opponentTeam){
    alert(app.actionType==='Défense'?'Choisis l’équipe attaquante.':'Choisis l’équipe attaquée.');
    return;
  }
  if(!app.faultType){alert('Choisis un type de faute.');return}
  try{
    app.setCloud('Enregistrement…',true);
    const base={
      videoPosition:app.currentVideoPosition(),period:(app.$('#faultPeriod')?.value||app.$('#period').value||'P1'),context: app.context,family: app.family,
      restartLocation:app.restartLocation||null,opponentTeam:app.opponentTeam||null,action:'Faute',zone:null,movement:null,
      player:app.faultWho||null,attributedPlayers:[],faultType: app.faultType,activePlayers:[...app.state.activePlayers],createdAt:new Date().toISOString()
    };
    const isEdit=!!app.editingId;
    const eventId=await app.persistEvent(base,isEdit);
    if(isEdit){
      const i=app.state.events.findIndex(e=>e.id===app.editingId);
      if(i>=0) app.state.events[i]={...app.state.events[i],...base,id:eventId};
    }else{
      app.state.events.push({id:eventId,...base});
    }
    app.editingId=null;app.$('#faultPopup').classList.add('hidden');app.$('#popup')?.classList.add('hidden');app.clearQuickOutcomeSelection();app.render();app.setCloud('Synchronisé',true);
  }catch(e){app.handleError('save fault',e)}
};

app.closePopup = id=>{
  app.editingId=null;
  app.$(id).classList.add('hidden');
  app.$('#popup')?.classList.remove('quickOutcomePreset','quickCenterSimple');
  app.clearQuickOutcomeSelection();
};

app.$('#newMatchTop').onclick=()=>{
  if(app.state.events.length && !confirm('Commencer un nouveau match ? Le match actuel restera enregistré dans la base.')) return;
  app.openMatchModule().catch(e=>app.handleError('new match',e));
};

app.$$('#matchCaptureMode [data-capture-mode]').forEach(b=>b.onclick=()=>app.setMatchCaptureMode(b.dataset.captureMode));

if (page === 'index') {
if(app.$('#matchYoutubeUrl'))app.$('#matchYoutubeUrl').oninput=()=>{
  if(app.state.captureMode==='video'){
    app.state.youtubeUrl=app.$('#matchYoutubeUrl').value.trim();
    app.state.youtubeVideoId=app.matchYoutubeId(app.state.youtubeUrl);
  }
  app.updateStartButton();
};
}

if (page === 'training') {
if(app.$('#matchYoutubeUrl'))app.$('#matchYoutubeUrl').oninput=()=>{
  if(app.state.captureMode==='video'){
    app.state.youtubeUrl=app.$('#matchYoutubeUrl').value.trim();
    app.state.youtubeVideoId=app.matchYoutubeId(app.state.youtubeUrl);
  }
};
}

if(app.$('#matchVideoBack5'))app.$('#matchVideoBack5').onclick=()=>app.matchVideoSeek(-5);

if(app.$('#matchVideoForward5'))app.$('#matchVideoForward5').onclick=()=>app.matchVideoSeek(5);

if(app.$('#matchVideoTogglePlay'))app.$('#matchVideoTogglePlay').onclick=()=>{
  if(!app.matchVideoPlayerReady||!app.matchVideoPlayer)return;
try{
    if(app.matchVideoPlayer.getPlayerState()===YT.PlayerState.PLAYING)app.matchVideoPlayer.pauseVideo();
    else app.matchVideoPlayer.playVideo();
  }catch{}
};

app.$$('.matchVideoSpeedBtn').forEach(b=>b.onclick=()=>app.applyMatchVideoSpeed(Number(b.dataset.speed)));

if(app.$('#matchVideoOpenYoutube'))app.$('#matchVideoOpenYoutube').onclick=()=>{if(app.state.youtubeUrl)window.open(app.state.youtubeUrl,'_blank','noopener')};

window.addEventListener('resize',app.syncMatchVideoUi);

app.$('#start').onclick=()=>{
  if(app.$('#rosterWrap').classList.contains('hidden')) app.buildChecks();
  const checked=app.$$('#rosterChecks input:checked');
  if(checked.length!==4){
    alert('Sélectionnez exactement 4 joueurs pour commencer la période.');
    app.updateStartButton();
    return;
  }
  app.start();
};

app.$('#editPlayers').onclick=()=>app.$('#playerEditor').classList.remove('hidden');

app.$('#closeEditor').onclick=()=>app.$('#playerEditor').classList.add('hidden');

app.$('#editLast').onclick=()=>{const last=app.state.events.at(-1);if(last)app.editEvent(last.id)};

app.$('#undo').onclick=async()=>{
  const last=app.state.events.at(-1);if(!last)return;
  try{
    const {error}=await app.db.from('match_events').delete().eq('id',last.id);
    if(error)throw error;
    app.state.events.pop();app.render();app.setCloud('Synchronisé',true);
  }catch(e){app.handleError('undo',e)}
};

app.matchTypeState = {types:[],busy:false};

app.categoryState = {categories:[],busy:false};

app.$('#openSettingsModule').onclick=app.openSettingsModule;

app.$('#settingsBackHome').onclick=app.showAppHome;

app.$('#categoryCreateForm').onsubmit=event=>{
  event.preventDefault();
  app.runCategoryAction(async()=>{
    const name=app.validateCategoryName(app.$('#categoryName').value);
    const {error}=await app.db.from('exercise_categories').insert({name}).select('id').single();
    if(error)throw error;
    app.$('#categoryName').value='';
  });
};

app.$('#matchTypeCreateForm').onsubmit=event=>{
  event.preventDefault();
  app.runMatchTypeAction(async()=>{
    const name=app.validateMatchTypeName(app.$('#matchTypeName').value);
    const {error}=await app.db.from('match_types').insert({name,created_by:app.currentUser?.id||null}).select('id').single();
    if(error)throw error;
    app.$('#matchTypeName').value='';
  });
};

if (page === 'training') {
app.trainingState = {players:[],selections:[],exercises:[],sessionExercises:[],planBlocks:[],exerciseCreateTarget:'library',editingExerciseId:null,editingExerciseMeasureLocked:false,recentSessions:[],currentSessionId:null,resultDraft:{},planOrganizerMode:false,planOrganizerSelectedId:null};
}

app.playerPortalState = {accesses:[],groupId:null,matches:[],selected:[],scope:'all',restartLocation:'all',loading:false,view:'home',hasStaffAccess:false,staffPreview:false,staffPlayerId:null,staffReturnGroupId:null,messageNotifications:[],objectives:[],videos:[],videoConfig:null};

app.groupState = {groups:[],currentGroupId:null,currentPlayers:[],currentSelections:[],matchPlayers:[],matchSelections:[],profiles:{},messageNotifications:[]};

app.adminState = {isAdmin:false,groups:[]};

app.statsState = {groupId:null,sessions:[],attendance:[],sessionExercises:[],results:[],players:[],exerciseMap:{},sessionMap:{},tab:'group',domain:'training',leaderMode:'recent',matchDataset:null,matchList:[],matchSelection:[],matchSelectionGroupId:null,matchSearch:'',matchTypeFilter:'',impactMatchList:[],impactMatchSelection:[],impactMatchSelectionGroupId:null,impactMatchSearch:'',impactMatchTypeFilter:'',impactScope:'all',impactRestartLocation:'all',impactView:'staff',impactSortField:'impact100',impactSortDirection:'desc',impactPlayerName:'',impactMatchManualOrder:[],statsMatchView:'summary',reference:null,referenceMeta:null,referenceSources:[],referenceVersions:[],impactReference:null,readOnlyViewer:false,viewerReturnGroupId:null};

app.groupPlayerFollowupState = {playerId:null};

app.matchLibraryState = {matches:[],currentReadId:null};

app.editingMatchMetaId = null;

app.editingMatchCaptureMode = 'live';

app.groupAnalysisState = {selected:new Set()};

app.analysisState = {
  matchIds:[],
  matches:[],
  events:[],
  players:[],
  activeTab:'summary',
  population:'H',
  offensiveReference:null
};

app.OFFENSIVE_CONTEXTS = [
  {key:'game_center',label:'Jeu courant · centre'},
  {key:'restart_center',label:'Remise · centre'},
  {key:'restart_line',label:'Remise · ligne'},
  {key:'restart_corner',label:'Remise · coin'}
];

if (page === 'training') {
app.TRAINING_PLAN_MARKER = '\n\n[[KC_PLAN_V1:';
document.addEventListener('click',(ev)=>{
  const box=app.$('#trainingExerciseCards');
  if(!box || !app.$('#trainingSession') || app.$('#trainingSession').classList.contains('hidden')) return;
  if(ev.target.closest('[data-exercise-card]')) return;
  app.collapseAllTrainingExercises();
});
}

app.$('#openMatchModule').onclick=()=>app.openMatchLibrary().catch(e=>app.handleError('match library',e));

if (page === 'index') {
app.$('#openTrainingModule').onclick=()=>{window.location.href='training.html'};
}

if (page === 'training') {
app.$('#openTrainingModule').onclick=()=>app.openTrainingModule();
}

app.$('#openGroupsModule').onclick=()=>app.openGroupsModule().catch(e=>app.handleError('groups module',e));

app.$('#openAdminModule').onclick=()=>app.openAdminModule().catch(e=>app.handleError('admin module',e));

app.$('#adminBackHome').onclick=app.showAppHome;

app.$('#matchBackHome').onclick=()=>app.openMatchLibrary().catch(e=>app.handleError('match library',e));

if(app.$('#liveBackHome'))app.$('#liveBackHome').onclick=()=>app.openMatchLibrary().catch(e=>app.handleError('match library',e));

app.$('#closeMatchMetaPopup').onclick=app.closeMatchMetaEditor;

app.$('#saveMatchMeta').onclick=app.saveMatchMetaEditor;

app.$$('#editMatchCaptureMode button').forEach(b=>b.onclick=()=>app.setEditMatchCaptureMode(b.dataset.editCaptureMode));

app.$('#matchMetaPopup').addEventListener('click',e=>{if(e.target===app.$('#matchMetaPopup'))app.closeMatchMetaEditor()});

app.$('#matchLibraryBack').onclick=app.showAppHome;

app.$('#libraryNewMatch').onclick=()=>app.openMatchModule().catch(e=>app.handleError('new match',e));

app.$('#libraryGroupAnalysis').onclick=()=>app.openGroupAnalysisSelector().catch(e=>app.handleError('analyse groupée',e));

app.$('#matchAnalysisSelectBack').onclick=()=>app.openMatchLibrary().catch(e=>app.handleError('match library',e));

app.$('#groupAnalysisGroup').onchange=()=>{app.$('#groupAnalysisType').value?app.autoSelectGroupAnalysisType():app.renderGroupAnalysisMatches()};

app.$('#groupAnalysisType').onchange=app.autoSelectGroupAnalysisType;

app.$('#groupAnalysisSelectVisible').onclick=()=>{app.groupAnalysisVisibleMatches().forEach(m=>app.groupAnalysisState.selected.add(m.id));app.renderGroupAnalysisMatches()};

app.$('#groupAnalysisClear').onclick=()=>{app.groupAnalysisState.selected.clear();app.renderGroupAnalysisMatches()};

app.$('#groupAnalysisRun').onclick=()=>app.runGroupedAnalysis().catch(e=>app.handleError('analyse groupée',e));

app.$('#matchReadBack').onclick=()=>app.openMatchLibrary({collapsible:true}).catch(e=>app.handleError('match library',e));

app.$('#matchAnalysisBack').onclick=()=>app.openMatchLibrary({collapsible:true}).catch(e=>app.handleError('match library',e));

app.$$('.matchAnalysisTabs button').forEach(b=>b.onclick=()=>app.setAnalysisTab(b.dataset.analysisTab));

{ const analysisPopulation=app.$('#analysisPopulation'); if(analysisPopulation) analysisPopulation.onchange=async()=>{
  app.analysisState.population=analysisPopulation.value;
  app.setCloud('Référentiel…',true);
  try{
    app.analysisState.offensiveReference=await app.loadOffensiveReference(app.analysisState.population);
    app.renderOffensiveReference();
    app.renderAnalysisPlayers(app.analysisState.events||[]);
    app.setCloud('Synchronisé',true);
  }catch(e){
    app.analysisState.offensiveReference=null;
    app.renderOffensiveReference();
    app.handleError('offensive reference',e);
  }
}; }

{ const analysisEvolutionPlayer=app.$('#analysisEvolutionPlayer'); if(analysisEvolutionPlayer) analysisEvolutionPlayer.onchange=app.renderAnalysisEvolution; }

app.$('#matchReadResume').onclick=()=>{const id=app.matchLibraryState.currentReadId;if(id)app.loadMatch(id)};

app.$('#matchReadDelete').onclick=async()=>{
  const id=app.matchLibraryState.currentReadId;
  if(id){
    const deleted=await app.deleteSavedMatch(id);
    if(deleted)await app.openMatchLibrary();
  }
};

app.$('#matchLibrarySearch').oninput=app.renderMatchLibrary;

app.$('#matchLibraryGroup').onchange=app.renderMatchLibrary;

app.$('#matchLibraryType').onchange=app.renderMatchLibrary;

if (page === 'training') {
app.$('#trainingBackHome').onclick=()=>{window.location.href='index.html'};
}

app.$('#groupsBackHome').onclick=app.showAppHome;

if (page === 'index') {
app.$('#groupDetailBack').onclick=()=>app.openGroupsModule();
app.$('#groupDetailCreateGroup').onclick=async()=>{await app.openGroupsModule();app.$('#createGroupBox').classList.remove('hidden');app.$('#joinGroupBox').classList.add('hidden');app.$('#newGroupName').focus()};
}

if (page === 'training') {
app.$('#groupDetailBack').onclick=app.showAppHome;
}

app.$('#closeGroupPlayerFollowupPopup').onclick=()=>app.$('#groupPlayerFollowupPopup').classList.add('hidden');

app.$('#cancelGroupPlayerFollowup').onclick=()=>app.$('#groupPlayerFollowupPopup').classList.add('hidden');

app.$('#saveGroupPlayerFollowup').onclick=()=>app.saveGroupPlayerFollowup();

app.$('#groupPlayerFollowupUnlink').onclick=()=>{
  const p=app.groupState.currentPlayers.find(x=>x.id===app.groupPlayerFollowupState.playerId);
  if(p)app.unlinkPlayerAccount(p.id,p.display_name);
};

if (page === 'index') {
app.$('#editGroupNameBtn').onclick=()=>{
  const g=app.groupState.groups.find(x=>x.id===app.groupState.currentGroupId);
  if(!g||g.role!=='owner')return;
  app.$('#groupNameEditInput').value=g.name||'';
  app.$('#groupNameEditRow').classList.remove('hidden');
  app.$('#editGroupNameBtn').classList.add('hidden');
  app.$('#groupNameEditStatus').textContent='';
  app.$('#groupNameEditInput').focus();
  app.$('#groupNameEditInput').select();
};
app.$('#cancelGroupNameEdit').onclick=()=>{
  app.$('#groupNameEditRow').classList.add('hidden');
  const g=app.groupState.groups.find(x=>x.id===app.groupState.currentGroupId);
  app.$('#editGroupNameBtn').classList.toggle('hidden',g?.role!=='owner');
  app.$('#groupNameEditStatus').textContent='';
};
}

if (page === 'training') {
app.$('#editGroupNameBtn').onclick=()=>{
  const g=app.groupState.groups.find(x=>x.id===app.groupState.currentGroupId);
  if(!g||g.role!=='owner')return;
  app.$('#groupNameEditInput').value=g.name||'';
  app.$('#groupNameEditRow').classList.remove('hidden');
  app.$('#groupNameEditStatus').textContent='';
  app.$('#groupNameEditInput').focus();
  app.$('#groupNameEditInput').select();
};
app.$('#cancelGroupNameEdit').onclick=()=>{
  app.$('#groupNameEditRow').classList.add('hidden');
  app.$('#groupNameEditStatus').textContent='';
};
}

app.$('#saveGroupNameEdit').onclick=()=>app.saveCurrentGroupName();

if (page === 'index') {
app.$('#groupNameEditInput').onkeydown=e=>{
  if(e.key==='Enter'){e.preventDefault();app.saveCurrentGroupName()}
  if(e.key==='Escape'){app.$('#groupNameEditRow').classList.add('hidden');const g=app.groupState.groups.find(x=>x.id===app.groupState.currentGroupId);app.$('#editGroupNameBtn').classList.toggle('hidden',g?.role!=='owner');app.$('#groupNameEditStatus').textContent=''}
};
}

if (page === 'training') {
app.$('#groupNameEditInput').onkeydown=e=>{
  if(e.key==='Enter'){e.preventDefault();app.saveCurrentGroupName()}
  if(e.key==='Escape'){app.$('#groupNameEditRow').classList.add('hidden');app.$('#groupNameEditStatus').textContent=''}
};
}

app.$('#showCreateGroup').onclick=()=>{app.$('#createGroupBox').classList.toggle('hidden');app.$('#joinGroupBox').classList.add('hidden')};

app.$('#showJoinGroup').onclick=()=>{app.$('#joinGroupBox').classList.toggle('hidden');app.$('#createGroupBox').classList.add('hidden')};

app.$('#createGroupBtn').onclick=()=>app.createGroup().catch(e=>{const st=app.$('#createGroupStatus');st.textContent=e.message||String(e);st.className='authStatus cloudErr'});

app.$('#joinGroupBtn').onclick=()=>app.joinGroup().catch(e=>{const st=app.$('#joinGroupStatus');st.textContent=e.message||String(e);st.className='authStatus cloudErr'});

app.$('#groupAddPlayersBtn').onclick=()=>app.addPlayersToCurrentGroup().catch(e=>app.handleError('add group players',e));

if(app.$('#groupSelectionCreate'))app.$('#groupSelectionCreate').onclick=()=>app.createGroupSelection().catch(e=>app.handleError('create group selection',e));

app.$('#matchGroup').onchange=async()=>{try{const groupId=app.$('#matchGroup').value;await app.loadMatchSelectionOptions(groupId,'');await app.loadMatchGroupPlayers(groupId,'')}catch(e){app.handleError('match group',e)}};

if(app.$('#matchSelection'))app.$('#matchSelection').onchange=()=>app.loadMatchGroupPlayers(app.$('#matchGroup').value,app.$('#matchSelection').value).catch(e=>app.handleError('match selection',e));

if (page === 'index') {
['matchName','matchDate','teamName','opponentTeam1','opponentTeam2'].forEach(id=>app.$('#'+id)?.addEventListener('input',app.updateStartButton));
['matchType'].forEach(id=>app.$('#'+id)?.addEventListener('change',app.updateStartButton));
app.$('#matchGroup')?.addEventListener('change',app.updateStartButton);
{ const input=app.$('#matchDate'); if(input)input.addEventListener('blur',()=>{app.normalizeFrDateField(input);app.updateStartButton()}); }
}

if (page === 'training') {
['#matchDate','#trainingDate'].forEach(sel=>{
  const input=app.$(sel);
  if(input)input.addEventListener('blur',()=>app.normalizeFrDateField(input));
});
app.$('#trainingGroup').onchange=()=>app.fetchTrainingPlayers(app.$('#trainingGroup').value).then(()=>app.renderTrainingExerciseCards()).catch(e=>app.handleError('training group',e));
if(app.$('#applyTrainingAttendancePreset'))app.$('#applyTrainingAttendancePreset').onclick=app.applyTrainingAttendancePreset;
app.$('#historyGroup').onchange=()=>app.fetchTrainingPlayers(app.$('#historyGroup').value).catch(e=>app.handleError('history group',e));
app.$('#newTraining').onclick=()=>app.startNewTraining().catch(e=>app.handleError('new training',e));
app.$('#addTrainingPlanBlock').onclick=()=>app.addTrainingPlanBlock();
app.$('#organizeTrainingPlan').onclick=()=>app.setTrainingPlanOrganizerMode(!app.trainingState.planOrganizerMode);
app.trainingPlanStartEl = app.$('#trainingPlanStart');
if(app.trainingPlanStartEl){app.trainingPlanStartEl.addEventListener('change',()=>{app.trainingPlanStartEl.value=app.normalizePlanTime(app.trainingPlanStartEl.value)||'13:30';app.recalculateTrainingPlanTimes();app.renderTrainingPlan()})}
app.$('#clearTrainingPlan').onclick=()=>{if(!app.trainingState.planBlocks.length||confirm('Vider tout le plan de séance ?')){app.trainingState.planBlocks=[];app.trainingState.planOrganizerSelectedId=null;app.renderTrainingPlan()}};
app.trainingNotesEl = app.$('#trainingNotes');
if(app.trainingNotesEl){app.trainingNotesEl.addEventListener('input',()=>app.autoGrowPlanTextarea(app.trainingNotesEl));app.autoGrowPlanTextarea(app.trainingNotesEl)}
window.addEventListener('resize',()=>document.querySelectorAll('.trainingPlanNotes textarea,.trainingGeneralNotes,.trainingResultNoteField .tr-note').forEach(app.autoGrowPlanTextarea));
app.duplicateTrainingSessionBtn = app.$('#duplicateTrainingSession');
if(app.duplicateTrainingSessionBtn)app.duplicateTrainingSessionBtn.onclick=()=>app.openTrainingDuplicate();
app.$('#trainingDuplicateBack').onclick=()=>app.openTrainingModule();
app.$('#cancelTraining').onclick=()=>app.openTrainingModule();
app.$('#trainingExerciseSelect').onchange=app.updateExistingExerciseFocusUI;
app.$('#addExistingExercise').onclick=()=>{
  const id=app.$('#trainingExerciseSelect').value;if(!id)return;
  const ex=app.trainingState.exercises.find(x=>x.id===id);if(!ex||!ex.active)return;
  const focus=app.isDualExercise(ex)?app.$('#trainingExerciseFocus').value:null;
  if(app.isDualExercise(ex)&&!focus){alert('Choisis le focus Attaque ou Défense.');return}
  app.addSessionExercise(ex,focus);
  app.$('#trainingExerciseSelect').value='';
  app.$('#trainingExerciseFocus').value='';
  app.updateExistingExerciseFocusUI();
};
app.$('#createExerciseOnTheFly').onclick=()=>app.openExerciseCreatePopup('session').catch(e=>app.handleError('create exercise',e));
app.$('#exerciseCreateCategory').onchange=app.updateCreateDualUI;
app.$('#exerciseEditCategory').onchange=app.updateEditDualUI;
app.$('#openExerciseLibrary').onclick=()=>app.openExerciseLibrary();
app.$('#exerciseLibraryBack').onclick=()=>app.openTrainingModule();
app.$('#libraryCreateExercise').onclick=()=>app.openExerciseCreatePopup('library').catch(e=>app.handleError('create exercise',e));
app.$('#exerciseLibrarySearch').oninput=app.renderExerciseLibrary;
app.$('#exerciseLibraryCategory').onchange=app.renderExerciseLibrary;
app.$('#exerciseLibraryActive').onchange=app.renderExerciseLibrary;
app.$('#exerciseLifecycleAction').onclick=()=>app.changeExerciseLifecycle();
app.$('#reactivateExercise').onclick=()=>app.changeExerciseLifecycle(true);
app.$('#duplicateExercise').onclick=()=>app.duplicateCurrentExercise().catch(e=>app.handleError('duplicateExercise',e));
app.$('#closeExerciseEditPopup').onclick=app.closeExerciseEditPopup;
app.$('#cancelExerciseEdit').onclick=app.closeExerciseEditPopup;
app.$('#exerciseEditPopup').onclick=(ev)=>{if(ev.target.id==='exerciseEditPopup')app.closeExerciseEditPopup()};
app.$('#confirmExerciseEdit').onclick=()=>app.saveExerciseEdits().catch(e=>{
  const st=app.$('#exerciseEditStatus');st.textContent=e.message||String(e);st.className='authStatus cloudErr';
  app.handleError('editExercise',e);
});
app.$('#closeExerciseCreatePopup').onclick=app.closeExerciseCreatePopup;
app.$('#cancelExerciseCreate').onclick=app.closeExerciseCreatePopup;
app.$('#exerciseCreatePopup').onclick=(ev)=>{if(ev.target.id==='exerciseCreatePopup')app.closeExerciseCreatePopup()};
app.$('#confirmExerciseCreate').onclick=()=>app.createExerciseFromPopup().catch(e=>{
  const st=app.$('#exerciseCreateStatus');st.textContent=e.message||String(e);st.className='authStatus cloudErr';
  app.handleError('createExercise',e);
});
app.$('#saveTrainingSession').onclick=app.saveTrainingSession;
app.$('#openTrainingHistory').onclick=()=>app.openTrainingHistory().catch(e=>app.handleError('history',e));
app.$('#historyBack').onclick=()=>app.openTrainingModule();
app.$('#historyPlayer').onchange=()=>app.loadPlayerHistory(app.$('#historyPlayer').value).catch(e=>app.handleError('history player',e));
}

app.bindStatsControls();

app.$('#openStatsModule').onclick=()=>app.openStatsModule();

app.$('#openVideosDashboardModule').onclick=()=>{window.location.href='coach-videos.html'};

if(app.$('#openQuickCollectionFromReference'))app.$('#openQuickCollectionFromReference').onclick=()=>{window.location.href='quick-collection.html'};

if(app.$('#openFaceToFaceFromStats'))app.$('#openFaceToFaceFromStats').onclick=()=>{
  const params=new URLSearchParams();
  const groupId=app.$('#statsGroup')?.value||'';
  if(groupId)params.set('group',groupId);
  if(app.statsState.readOnlyViewer)params.set('viewer','1');
  window.location.href=`face-a-face.html${params.toString()?'?'+params.toString():''}`;
};

app.$('#statsBackHome').onclick=()=>{if(app.statsState.readOnlyViewer){history.replaceState(null,'',location.pathname+'#player-home');app.enterMyPlayerPortal().catch(e=>app.handleError('return player portal',e));}else app.showAppHome()};

if(app.$('#statsMatchLatest'))app.$('#statsMatchLatest').onclick=()=>{
  const list=app.statsState.matchList||[];
  const latest=list[list.length-1];
  app.statsState.matchSelection=latest?[latest.id]:[];
  app.renderStatsMatchSelector();
  app.renderStatsMatchesSelection().catch(e=>app.handleError('stats latest match',e));
};

if(app.$('#statsMatchClear'))app.$('#statsMatchClear').onclick=()=>{
  app.statsState.matchSelection=[];
  app.renderStatsMatchSelector();
  app.renderStatsMatchesSelection().catch(e=>app.handleError('stats clear matches',e));
};

if(app.$('#statsMatchSearch'))app.$('#statsMatchSearch').oninput=e=>{
  app.statsState.matchSearch=e.target.value||'';
  app.renderStatsMatchSelector();
};

if(app.$('#statsMatchTypeFilter'))app.$('#statsMatchTypeFilter').onchange=e=>{
  app.statsState.matchTypeFilter=e.target.value||'';
  app.renderStatsMatchSelector();
};

if(app.$('#statsHelpBtn'))app.$('#statsHelpBtn').onclick=()=>app.$('#statsHelpBackdrop')?.classList.remove('hidden');

document.addEventListener('click',e=>{
  const backdrop=app.$('#statsHelpBackdrop');
  if(!backdrop)return;
  if(e.target?.id==='statsHelpClose'||e.target===backdrop)backdrop.classList.add('hidden');
});

document.addEventListener('keydown',e=>{
  const box=app.$('#playerVideoPlayer');
  if(!box||box.classList.contains('hidden'))return;
  const tag=(document.activeElement?.tagName||'').toLowerCase();
  if(tag==='input'||tag==='textarea'||tag==='select')return;
  if(e.key==='ArrowLeft'){e.preventDefault();stepPlayerVideo(-1)}
  else if(e.key==='ArrowRight'){e.preventDefault();stepPlayerVideo(1)}
  else if(e.key===' '){e.preventDefault();togglePlayerVideoPlayback()}
});

app.$('#playerObjectiveAdd').onclick=()=>app.addPlayerObjective();

app.$('#playerObjectiveInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();app.addPlayerObjective()}});

app.$('#playerPortalMessageSend').onclick=()=>app.sendPlayerPortalMessage();

app.$('#playerPortalMessageInput').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();app.sendPlayerPortalMessage()}});

app.$('#playerSpaceBtn').onclick=()=>app.enterMyPlayerPortal().catch(err=>app.handleError('open player portal',err));

app.$('#playerPortalBackStaff').onclick=()=>app.returnToStaffSpace().catch(e=>app.handleError('return staff space',e));

app.$('#playerJoinContinue').onclick=async()=>{const playerId=app.playerGroupInvitePlayerId();if(!playerId){app.authMessage('Sélectionne d’abord ton prénom.',true);return}const {data:{session}}=await app.db.auth.getSession();if(!session?.user){app.authMessage('Connecte-toi ou crée ton compte pour continuer.',true);return}app.authMessage('Activation de ton accès…');try{await app.initAuthenticated(session.user);app.authMessage('')}catch(e){if(!e?.playerClaimCancelled)console.error('player join continue',e)}};

app.$('#groupPlayerSharedLink').onclick=()=>app.createSharedPlayerAccessLink();

app.accountDefaults=JSON.stringify(Object.fromEntries(['state','groupState','playerPortalState','statsState','adminState','matchLibraryState','groupAnalysisState','analysisState','categoryState','matchTypeState','trainingState'].filter(key=>app[key]!==undefined).map(key=>[key,app[key]])));
app.render();

if (page === 'index') {
document.querySelectorAll('button.ghost,a.ghost').forEach(el=>{if((el.textContent||'').trim().startsWith('←'))el.classList.add('backNav')});
}

app.initVideoDesktopResizer();

app.initAuth().catch(e=>{app.handleError('initAuth',e);app.hideStartupScreen()});
  };
})();

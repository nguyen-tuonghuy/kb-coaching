/* video. Shared explicit application context; no startup side effects. */
((app) => {
app.cueMatchVideoAtResumePosition = function cueMatchVideoAtResumePosition(){
  if(!app.matchVideoPlayerReady||!app.matchVideoPlayer||!app.matchVideoWantedId)return;
  const start=Math.max(0,Number(app.matchVideoResumeSeconds)||0);
  try{
    app.matchVideoPlayer.cueVideoById({
      videoId:app.matchVideoWantedId,
      startSeconds:start
    });
    if(start){
      app.matchVideoResumePending=true;
      app.$('#videoPosition').value=app.formatMatchVideoTime(start);
      app.scheduleMatchVideoResumeSeek();
    }else{
      app.matchVideoResumePending=false;
    }
  }catch{}
};

app.scheduleMatchVideoResumeSeek = function scheduleMatchVideoResumeSeek(){
  if(!app.matchVideoResumePending||!app.matchVideoResumeSeconds)return;
  const token=++app.matchVideoResumeToken;
  [80,250,600,1200].forEach((delay,index)=>{
    setTimeout(()=>{
      if(token!==app.matchVideoResumeToken||!app.matchVideoResumePending)return;
      app.applyMatchVideoResumePosition(index===3);
    },delay);
  });
};

app.applyMatchVideoResumePosition = function applyMatchVideoResumePosition(finalAttempt=false){
  if(!app.matchVideoPlayerReady||!app.matchVideoPlayer||!app.matchVideoResumePending||!app.matchVideoResumeSeconds)return;
  const target=Math.max(0,Number(app.matchVideoResumeSeconds)||0);
  try{
    const current=Number(app.matchVideoPlayer.getCurrentTime?.()||0);
    if(Math.abs(current-target)>1.5){
      app.matchVideoPlayer.seekTo(target,true);
    }
    app.$('#videoPosition').value=app.formatMatchVideoTime(target);

    // After the player has had time to process cue/seek, stop protecting the field.
    if(finalAttempt||Math.abs(Number(app.matchVideoPlayer.getCurrentTime?.()||0)-target)<=1.5){
      app.matchVideoResumePending=false;
    }
  }catch{}
};

app.syncVideoPopupBounds = function syncVideoPopupBounds(){
  const live=app.$('#live');
  if(!live||window.innerWidth<1367||!live.classList.contains('videoDesktopLayout')){
    document.body.classList.remove('videoReviewWideActive');
    document.documentElement.style.removeProperty('--video-note-left');
    document.documentElement.style.removeProperty('--video-note-width');
    return;
  }

  const rightPane=live.querySelector(':scope > section:not(#matchVideoPanel)');
  if(!rightPane)return;
  const rect=rightPane.getBoundingClientRect();

  document.body.classList.add('videoReviewWideActive');
  document.documentElement.style.setProperty('--video-note-left',`${Math.max(0,rect.left)}px`);
  document.documentElement.style.setProperty('--video-note-width',`${Math.max(320,rect.width)}px`);
};

app.clampVideoPaneRatio = function clampVideoPaneRatio(ratio){
  const live=app.$('#live');
  if(!live)return .58;
  const width=live.getBoundingClientRect().width||1200;
  // Keep at least ~520 px for video and ~360 px for controls.
  const min=Math.min(.65,520/width);
  const max=Math.max(.50,1-(360/width));
  return Math.min(Math.max(Number(ratio)||.58,min),Math.min(.78,max));
};

app.setVideoPaneRatio = function setVideoPaneRatio(ratio,persist=true){
  const live=app.$('#live');
  if(!live)return;
  const r=app.clampVideoPaneRatio(ratio);
  live.style.setProperty('--video-pane',`${(r*100).toFixed(2)}%`);
  if(persist){
    try{localStorage.setItem(app.VIDEO_PANE_KEY,String(r))}catch{}
  }
  requestAnimationFrame(app.syncVideoPopupBounds);
};

app.applySavedVideoPaneWidth = function applySavedVideoPaneWidth(){
  let r=.58;
  try{
    const saved=parseFloat(localStorage.getItem(app.VIDEO_PANE_KEY)||'');
    if(Number.isFinite(saved))r=saved;
  }catch{}
  app.setVideoPaneRatio(r,false);
};

app.initVideoDesktopResizer = function initVideoDesktopResizer(){
  const handle=app.$('#videoDesktopResizer');
  const live=app.$('#live');
  if(!handle||!live)return;

  let dragging=false;

  const updateFromClientX=x=>{
    const rect=live.getBoundingClientRect();
    if(!rect.width)return;
    app.setVideoPaneRatio((x-rect.left)/rect.width,true);
  };

  handle.addEventListener('pointerdown',e=>{
    if(window.innerWidth<1367||!live.classList.contains('videoDesktopLayout'))return;
    dragging=true;
    handle.classList.add('dragging');
    try{handle.setPointerCapture(e.pointerId)}catch{}
    updateFromClientX(e.clientX);
    e.preventDefault();
  });

  handle.addEventListener('pointermove',e=>{
    if(!dragging)return;
    updateFromClientX(e.clientX);
    e.preventDefault();
  });

  const stop=e=>{
    if(!dragging)return;
    dragging=false;
    handle.classList.remove('dragging');
    try{handle.releasePointerCapture(e.pointerId)}catch{}
  };
  handle.addEventListener('pointerup',stop);
  handle.addEventListener('pointercancel',stop);

  handle.addEventListener('keydown',e=>{
    if(window.innerWidth<1367)return;
    let current=.58;
    try{
      current=parseFloat(getComputedStyle(live).getPropertyValue('--video-pane'))/100||.58;
    }catch{}
    if(e.key==='ArrowLeft'){
      app.setVideoPaneRatio(current-.025,true);
      e.preventDefault();
    }else if(e.key==='ArrowRight'){
      app.setVideoPaneRatio(current+.025,true);
      e.preventDefault();
    }else if(e.key==='Home'){
      app.setVideoPaneRatio(.50,true);
      e.preventDefault();
    }else if(e.key==='End'){
      app.setVideoPaneRatio(.72,true);
      e.preventDefault();
    }
  });

  window.addEventListener('resize',()=>{
    if(live.classList.contains('videoDesktopLayout'))app.applySavedVideoPaneWidth();
    requestAnimationFrame(app.syncVideoPopupBounds);
  });
};

app.syncMatchVideoUi = function syncMatchVideoUi(){
  const videoMode=app.state.captureMode==='video'&&!!app.state.youtubeVideoId;
  const container=document.querySelector('.app');
  const live=app.$('#live');
  const desktopVideo=videoMode && !!live && !live.classList.contains('hidden');
  container?.classList.toggle('videoReviewWide',desktopVideo);
  live?.classList.toggle('videoDesktopLayout',desktopVideo);
  app.$('#videoDesktopResizer')?.classList.toggle('hidden',!desktopVideo);
  document.body.classList.toggle('videoReviewWideActive',desktopVideo && window.innerWidth>=1367);
  if(desktopVideo){
    app.applySavedVideoPaneWidth();
    requestAnimationFrame(app.syncVideoPopupBounds);
  }else{
    app.syncVideoPopupBounds();
  }
  app.$('#matchVideoPanel')?.classList.toggle('hidden',!videoMode);
  if(app.$('#videoPositionHint'))app.$('#videoPositionHint').textContent=videoMode?'Mise à jour automatiquement depuis le lecteur ; tu peux la corriger manuellement.':'Facultatif en mode direct.';
  if(app.$('#videoPositionNote'))app.$('#videoPositionNote').textContent=videoMode?'La position courante du lecteur est enregistrée automatiquement au moment où tu valides chaque action.':'En mode direct, tu peux laisser la position vidéo vide et ne la renseigner que pour certaines actions utiles à retrouver.';
  const details=app.$('#matchVideoSpeedDetails');
  if(details){
    if(window.matchMedia('(max-width:1366px)').matches)details.removeAttribute('open');
    else details.setAttribute('open','');
  }
  const periodSettings=app.$('#periodSettingsPanel');
  if(periodSettings && videoMode && window.matchMedia('(min-width:641px) and (max-width:1366px)').matches){
    periodSettings.removeAttribute('open');
  }
};

app.loadYouTubeIframeApi = function loadYouTubeIframeApi(){
  if(window.YT&&window.YT.Player)return Promise.resolve(window.YT);
  if(app.youtubeIframeApiPromise)return app.youtubeIframeApiPromise;
  app.youtubeIframeApiPromise=new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-youtube-iframe-api="1"]');
    const previousReady=window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady=function(){
      try{if(typeof previousReady==='function')previousReady()}catch{}
      resolve(window.YT);
    };
    if(existing)return;
    const script=document.createElement('script');
    script.src='https://www.youtube.com/iframe_api';
    script.async=true;
    script.dataset.youtubeIframeApi='1';
    script.onerror=()=>reject(new Error('Impossible de charger YouTube.'));
    document.head.append(script);
  });
  return app.youtubeIframeApiPromise;
};

app.createMatchVideoPlayer = function createMatchVideoPlayer(){
  if(app.matchVideoPlayer||!window.YT||!YT.Player)return;
  app.matchVideoPlayer=new YT.Player('matchVideoPlayer',{
    videoId:app.matchVideoWantedId,
    playerVars:{
      playsinline:1,
      rel:0,
      start:Math.max(0,Math.floor(app.matchVideoResumeSeconds||0))
    },
    events:{
      onReady:()=>{
        app.matchVideoPlayerReady=true;
        if(app.matchVideoWantedId)app.cueMatchVideoAtResumePosition();
        app.applyMatchVideoSpeed(app.matchVideoPreferredSpeed);
      },
      onStateChange:e=>{
        // CUED (-1/5 depending on API transition): enforce the saved position once more.
        if(app.matchVideoResumePending && app.matchVideoResumeSeconds){
          const stateCode=Number(e?.data);
          if(stateCode===YT.PlayerState.CUED||stateCode===YT.PlayerState.PAUSED||stateCode===YT.PlayerState.UNSTARTED){
            app.applyMatchVideoResumePosition(false);
          }
        }
        app.syncMatchVideoPositionInput();
      },
      onPlaybackRateChange:()=>app.syncMatchVideoSpeedButtons()
    }
  });
};

app.initOrLoadMatchVideo = function initOrLoadMatchVideo(){
  app.syncMatchVideoUi();
  if(app.state.captureMode!=='video'||!app.state.youtubeVideoId)return;
  app.matchVideoWantedId=app.state.youtubeVideoId;
  app.matchVideoResumePending=!!app.matchVideoResumeSeconds;
  if(app.matchVideoPlayerReady&&app.matchVideoPlayer){
    try{
      app.cueMatchVideoAtResumePosition();
      app.applyMatchVideoSpeed(app.matchVideoPreferredSpeed);
    }catch{}
  }else if(window.YT&&YT.Player){
    app.createMatchVideoPlayer();
  }else{
    app.loadYouTubeIframeApi().then(()=>app.createMatchVideoPlayer()).catch(e=>app.handleError('youtube api',e));
  }
};

app.syncMatchVideoPositionInput = function syncMatchVideoPositionInput(){
  if(app.state.captureMode!=='video'||!app.matchVideoPlayerReady||!app.matchVideoPlayer)return;
  try{
    if(app.matchVideoResumePending&&app.matchVideoResumeSeconds){
      app.$('#videoPosition').value=app.formatMatchVideoTime(app.matchVideoResumeSeconds);
      return;
    }
    app.$('#videoPosition').value=app.formatMatchVideoTime(app.matchVideoPlayer.getCurrentTime());
  }catch{}
};

app.matchVideoSeek = function matchVideoSeek(delta){
  if(!app.matchVideoPlayerReady||!app.matchVideoPlayer)return;
  try{const t=Math.max(0,(app.matchVideoPlayer.getCurrentTime()||0)+delta);app.matchVideoPlayer.seekTo(t,true);app.syncMatchVideoPositionInput()}catch{}
};

app.applyMatchVideoSpeed = function applyMatchVideoSpeed(rate){
  app.matchVideoPreferredSpeed=Number(rate)||1;
  let chosen=app.matchVideoPreferredSpeed;
  if(app.matchVideoPlayerReady&&app.matchVideoPlayer){
    try{
      const rates=app.matchVideoPlayer.getAvailablePlaybackRates?.()||[1,1.25,1.5,2];
      if(!rates.includes(chosen))chosen=rates.reduce((a,b)=>Math.abs(b-app.matchVideoPreferredSpeed)<Math.abs(a-app.matchVideoPreferredSpeed)?b:a,rates[0]||1);
      app.matchVideoPlayer.setPlaybackRate(chosen);
    }catch{}
  }
  app.$$('.matchVideoSpeedBtn').forEach(b=>b.classList.toggle('active',Number(b.dataset.speed)===chosen));
  if(app.$('#matchVideoSpeedStatus'))app.$('#matchVideoSpeedStatus').textContent=`Vitesse : ${String(chosen).replace('.',',')}×`;
};

app.syncMatchVideoSpeedButtons = function syncMatchVideoSpeedButtons(){
  if(!app.matchVideoPlayerReady||!app.matchVideoPlayer)return;
  let rate=app.matchVideoPreferredSpeed;try{rate=app.matchVideoPlayer.getPlaybackRate()}catch{}
  app.$$('.matchVideoSpeedBtn').forEach(b=>b.classList.toggle('active',Number(b.dataset.speed)===Number(rate)));
  if(app.$('#matchVideoSpeedStatus'))app.$('#matchVideoSpeedStatus').textContent=`Vitesse : ${String(rate).replace('.',',')}×`;
};

app.currentMatchVideoPosition = function currentMatchVideoPosition(){
  if(app.state.captureMode==='video'&&app.matchVideoPlayerReady&&app.matchVideoPlayer){
    try{const v=app.formatMatchVideoTime(app.matchVideoPlayer.getCurrentTime());app.$('#videoPosition').value=v;return v}catch{}
  }
  return (app.$('#videoPosition').value||'').trim()||null;
};
app.setMatchCaptureMode = function setMatchCaptureMode(mode){
  app.state.captureMode=mode==='video'?'video':'live';
  app.$$('#matchCaptureMode [data-capture-mode]').forEach(b=>b.classList.toggle('active',b.dataset.captureMode===app.state.captureMode));
  app.$('#matchYoutubeWrap')?.classList.toggle('hidden',app.state.captureMode!=='video');
  if(app.page==='index')app.updateStartButton();
};
})(window.KinballCoach.app);

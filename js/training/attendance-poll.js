((app)=>{
  const labels={present:'Présent',absent:'Absent',unsure:'Incertain','':'Sans réponse'};
  const rpc=async(name,args)=>{
    const {data,error}=await app.db.rpc(name,args);
    if(error)throw error;
    return data;
  };
  const session=()=>app.trainingState.currentSessionId;
  const controls=()=>app.$('#trainingPollControls');
  const status=()=>app.$('#trainingPollStatus');
  const panel=()=>app.$('#trainingPoll');
  let request=0;
  let pending=false;
  let poll=null;

  app.initTrainingAttendancePoll=function initTrainingAttendancePoll(){
    if(!panel())return;
    panel().addEventListener('toggle',()=>{if(panel().open)void app.refreshTrainingAttendancePoll()});
    // Les champs du sondage sont enregistrés par leurs propres RPC.
    for(const event of ['change','input'])panel().addEventListener(event,e=>e.stopPropagation());
    controls().addEventListener('click',e=>{
      const button=e.target.closest('button[data-poll-action]');
      if(button)void act(button.dataset.pollAction,button.dataset.player);
    });
    app.$('#trainingAttendance')?.addEventListener('change',()=>{renderDifferences();app.applyTrainingLeaseControls()});
    controls().addEventListener('change',e=>{
      const select=e.target.closest('select[data-poll-player]');
      if(select)void changeResponse(select);
    });
  };

  app.resetTrainingAttendancePoll=function resetTrainingAttendancePoll(){
    ++request;
    poll=null;
    if(!panel())return;
    panel().open=false;
    controls().replaceChildren();
    status().textContent='';
  };

  app.refreshTrainingAttendancePoll=async function refreshTrainingAttendancePoll(message=''){
    if(!panel()?.open)return;
    const id=session(),serial=++request;
    status().textContent=id?'Chargement du sondage…':'';
    controls().replaceChildren();
    try{
      const next=id?await rpc('get_training_attendance_poll',{p_session:id}):null;
      if(serial!==request||id!==session())return;
      poll=next;
      render();
      status().textContent=message;
    }catch(error){
      if(serial!==request||id!==session())return;
      poll=null;
      status().textContent=error?.message||'Impossible de charger le sondage.';
      controls().innerHTML=button('refresh','Réessayer');
    }
  };

  const button=(action,label,style='ghost')=>`<button type="button" class="${style}" data-poll-action="${action}">${label}</button>`;
  function localDeadline(value){
    if(!value)return '';
    const date=new Date(value);
    return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  }

  function render(){
    if(!session()){
      controls().innerHTML='<p class="small">Enregistre la séance pour ouvrir un sondage.</p>'+button('save','Enregistrer la séance','primary');
      return;
    }
    const state=poll?(poll.is_open?'Sondage ouvert':'Sondage fermé'):'Aucun sondage';
    controls().innerHTML=`<p><strong>${state}</strong></p>
      <div class="trainingPollActions">
        <label class="field" for="trainingPollDeadline">Date limite facultative<input id="trainingPollDeadline" type="datetime-local" value="${localDeadline(poll?.deadline)}"></label>
        ${button('open',poll?.is_open?'Mettre à jour l’échéance':poll?'Rouvrir le sondage':'Ouvrir le sondage','primary')}
        ${poll?.is_open?button('close','Fermer'):''}
      </div>
      ${(poll||app.trainingState.planWithoutAttendance)&&!app.trainingState.attendanceStartedAt?
        '<div class="trainingPollActions">'+button('start','Démarrer la séance','primary')+'</div>':''}
      ${app.trainingState.attendanceStartedAt?'<p class="small">Séance démarrée.</p>':''}
      ${poll?`<div class="trainingPollActions">
        ${button('copy','Copier le lien')}
        ${poll.is_open?button('publish','Publier sur Discord')+button('remind','Relancer sur Discord'):''}
        ${button('refresh','Actualiser les réponses')}
      </div>
      <div class="trainingPollResponses">${Object.entries(labels).map(([value,label])=>{
        const players=poll.players.filter(player=>(player.availability||'')===value);
        return `<section><h4>${label} (${players.length})</h4><ul>${players.map(player=>`<li>${app.escapeHtml(player.name)}</li>`).join('')}</ul></section>`;
      }).join('')}</div>
      <div class="trainingPollResponses">${poll.players.map(player=>`
        <label class="field">${app.escapeHtml(player.name)}${player.late?' · Réponse tardive':''}${player.manual?' · Présence corrigée par le coach':''}
          <select data-poll-player="${app.escapeAttr(player.id)}">${Object.entries(labels).map(([value,label])=>
            `<option value="${value}"${value===(player.availability||'')?' selected':''}>${label}</option>`).join('')}
          </select>
        </label>`).join('')}</div>
      <div data-poll-differences></div>`:''}`;
    renderDifferences();
    app.applyTrainingLeaseControls();
  }

  function lateDifferences(){
    const inputs=new Map(app.$$('#trainingAttendance input').map(input=>[input.value,input]));
    return (poll?.players||[]).flatMap(player=>{
      if(!player.late||player.dismissed||!['present','absent'].includes(player.availability))return [];
      const input=inputs.get(player.id),want=player.availability==='present';
      return input&&input.checked!==want?[{input,want,player}]:[];
    });
  }

  function renderDifferences(){
    const wrap=controls().querySelector('[data-poll-differences]');
    if(!wrap)return;
    const changes=lateDifferences();
    const proposed=changes.filter(({player})=>!player.manual);
    wrap.innerHTML=changes.length?`<h4>Écarts de présence</h4><ul>${changes.map(({player,want})=>
      `<li>${app.escapeHtml(player.name)} · ${want?'déclare être présent':'déclare être absent'} ·
        ${player.manual?'correction du coach conservée':want?'à ajouter':'à retirer'}
        <button type="button" class="ghost" data-poll-action="dismiss" data-player="${app.escapeAttr(player.id)}"
          aria-label="Ignorer l’écart de ${app.escapeAttr(player.name)}">Ignorer</button></li>`).join('')}</ul>
      ${proposed.length?button('late',`Intégrer les écarts proposés (${proposed.length})`):''}`:'';
  }

  async function busy(task){
    if(pending||!app.trainingLeaseCanMutate())return;
    const id=session(),user=app.currentUser?.id,epoch=app.trainingState.editorLoadToken;
    const current=()=>id===session()&&user===app.currentUser?.id&&epoch===app.trainingState.editorLoadToken;
    pending=true;
    controls().setAttribute('aria-busy','true');
    status().textContent='Action en cours…';
    try{await task(current)}
    catch(error){if(current())status().textContent=error.message||'Action impossible.'}
    finally{pending=false;controls().removeAttribute('aria-busy')}
  }

  function requireSyncedSession(){
    if(app.trainingSaveInFlight||app.trainingState.playerCollectionBusy||app.trainingSessionIsDirty()||
      app.trainingLocalState.conflict||app.trainingCloudState.conflict||
      app.$('#trainingRecoveryPopup')?.matches(':not(.hidden)')){
      throw new Error('Synchronise la séance et résous les brouillons avant de modifier les présences depuis le sondage.');
    }
  }

  async function startSession(current,id){
    requireSyncedSession();
    const lease=app.trainingLeaseState;
    const {present,version,updated_at,started_at}=await rpc('start_training_attendance_session',{
      p_session:id,p_instance:lease.instanceId,p_token:lease.token,p_expected_version:app.trainingLocalState.baseVersion
    });
    if(!current())return;
    app.trainingState.attendanceStartedAt=started_at;
    if(app.trainingSessionIsDirty()||app.trainingLocalState.conflict||app.trainingCloudState.conflict){
      app.registerTrainingCloudConflict(updated_at);
      throw new Error('Des modifications locales ont été conservées. Résous le conflit avant de reprendre.');
    }
    const ids=new Set(present);
    app.$$('#trainingAttendance input').forEach(input=>{input.checked=ids.has(input.value)});
    app.renderTrainingExerciseCards({capture:false});
    app.markTrainingSessionBaseline();
    app.trainingLocalState.baseVersion=version;
    app.trainingLocalState.baseUpdatedAt=updated_at;
    await app.refreshTrainingAttendancePoll('Séance démarrée.');
  }

  function act(action,playerId){
    if(action==='refresh')return app.refreshTrainingAttendancePoll();
    return busy(async current=>{
      const id=session(),group=app.$('#trainingGroup').value;
      if(action==='save'){
        const result=await app.saveTrainingSession();
        if(!result||result.status!=='saved')throw new Error('La séance n’a pas pu être enregistrée.');
        return;
      }
      if(action==='open'||action==='close'){
        const raw=app.$('#trainingPollDeadline').value;
        await rpc('manage_training_attendance_poll',{
          p_session:id,p_open:action==='open',p_deadline:action==='open'&&raw?new Date(raw).toISOString():null
        });
        if(current())await app.refreshTrainingAttendancePoll(action==='close'?'Sondage fermé.':'Sondage ouvert.');
        return;
      }
      if(action==='start'){
        app.trainingAttendanceInitializing=startSession(current,id).finally(()=>{app.trainingAttendanceInitializing=null});
        await app.trainingAttendanceInitializing;
        return;
      }
      if(action==='dismiss'){
        const player=poll.players.find(item=>item.id===playerId);
        await rpc('dismiss_training_attendance_change',{p_session:id,p_player:player.id,p_revision:player.revision});
        if(current())await app.refreshTrainingAttendancePoll('Écart ignoré pour cette réponse.');
        return;
      }
      if(action==='late'){
        requireSyncedSession();
        const fresh=await rpc('get_training_attendance_poll',{p_session:id});
        if(!current())return;
        requireSyncedSession();
        poll=fresh;
        render();
        const changes=lateDifferences().filter(({player})=>!player.manual);
        if(!changes.length||!confirm('Appliquer aux présences effectives ?\n'+changes.map(({player,want})=>
          (want?'Ajouter ':'Retirer ')+player.name).join('\n'))){
          status().textContent='';
          return;
        }
        app.captureTrainingResultDraft();
        changes.forEach(({input,want})=>{input.checked=want});
        app.renderTrainingExerciseCards({capture:false});
        app.persistTrainingLocalDraft({checkpointReason:'Intégration des réponses tardives'});
        render();
        status().textContent='Présences mises à jour. Synchronisation en cours.';
        return;
      }
      if(action==='copy'){
        const url=new URL(app.AUTH_REDIRECT_URL);
        url.searchParams.set('player_group',group);
        url.searchParams.set('training_poll',id);
        if(navigator.clipboard){
          try{await navigator.clipboard.writeText(url.href);if(current())status().textContent='Lien copié.';return}
          catch{/* sélection manuelle si le navigateur refuse le presse-papiers */}
        }
        prompt('Copie le lien du sondage.',url.href);
        if(current())status().textContent='';
        return;
      }
      const {data,error}=await app.db.functions.invoke('training-attendance-discord',{
        body:{session_id:id,group_id:group,reminder:action==='remind'}
      });
      if(error){
        const payload=await error.context?.json?.().catch(()=>null);
        throw new Error(payload?.error||'Discord n’a pas confirmé l’envoi.');
      }
      if(current())status().textContent=data?.message||'Message envoyé sur Discord.';
    });
  }

  function changeResponse(select){
    if(pending){render();return}
    return busy(async current=>{
      try{
        await rpc('answer_training_attendance_poll',{
          p_session:session(),p_player:select.dataset.pollPlayer,p_availability:select.value||null
        });
        if(current())await app.refreshTrainingAttendancePoll('Réponse enregistrée.');
      }catch(error){
        if(current())render();
        throw error;
      }
    });
  }
})(window.KinballCoach.app);

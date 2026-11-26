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
      if(button)void act(button.dataset.pollAction);
    });
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
    const started=!!(poll?.started_at||app.trainingState.attendanceStartedAt);
    const state=poll?(poll.is_open?'Sondage ouvert':'Sondage fermé'):'Aucun sondage';
    controls().innerHTML=`<p><strong>${state}</strong></p>
      ${!started?`<div class="trainingPollActions">
        <label class="field" for="trainingPollDeadline">Date limite facultative<input id="trainingPollDeadline" type="datetime-local" value="${localDeadline(poll?.deadline)}"></label>
        ${poll?button('open',poll.is_open?'Mettre à jour l’échéance':'Rouvrir le sondage','primary'):button('trigger','Déclencher le sondage','primary')}
        ${poll?.is_open?button('close','Fermer'):''}
      </div>`:''}
      ${(poll||app.trainingState.planWithoutAttendance)&&!started?
        '<div class="trainingPollActions">'+button('start','Démarrer la séance','primary')+'</div>':''}
      ${started?'<p class="small">Séance démarrée. Les présences effectives se corrigent dans la liste des joueurs.</p>':''}
      ${poll?`<div class="trainingPollActions">
        ${button('copy','Copier le lien')}
        ${poll.is_open&&!started?button('publish','Publier sur Discord')+button('remind','Relancer sur Discord'):''}
        ${button('refresh','Actualiser les réponses')}
      </div>
      <div class="trainingPollResponses">${Object.entries(labels).map(([value,label])=>{
        const players=poll.players.filter(player=>(player.availability||'')===value);
        return `<section><h4>${label} (${players.length})</h4><ul>${players.map(player=>`<li>${app.escapeHtml(player.name)}</li>`).join('')}</ul></section>`;
      }).join('')}</div>
      ${!started?`<div class="trainingPollResponses">${poll.players.filter(player=>player.active!==false).map(player=>`
        <label class="field">${app.escapeHtml(player.name)}
          <select data-poll-player="${app.escapeAttr(player.id)}">${Object.entries(labels).map(([value,label])=>
            `<option value="${value}"${value===(player.availability||'')?' selected':''}>${label}</option>`).join('')}
          </select>
        </label>`).join('')}</div>`:''}`:''}`;
    app.applyTrainingLeaseControls();
  }

  async function busy(task){
    if(pending||!app.trainingLeaseCanMutate())return;
    if(app.hasPendingTrainingGroupTransfer?.()){
      status().textContent='Enregistre le changement de groupe avant d’agir sur le sondage.';
      return;
    }
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
      throw new Error('Synchronise la séance et résous les brouillons avant de démarrer.');
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
    void app.refreshTrainingGroupTransferStatus();
    await app.refreshTrainingAttendancePoll('Séance démarrée. Le sondage est fermé s’il avait été déclenché.');
  }

  function act(action){
    if(action==='refresh')return app.refreshTrainingAttendancePoll();
    return busy(async current=>{
      const id=session(),group=app.$('#trainingGroup').value;
      if(action==='save'){
        const result=await app.saveTrainingSession();
        if(!result||result.status!=='saved')throw new Error('La séance n’a pas pu être enregistrée.');
        return;
      }
      if(['trigger','open','close'].includes(action)){
        const raw=app.$('#trainingPollDeadline').value,open=action!=='close';
        await rpc('manage_training_attendance_poll_for_group',{
          p_session:id,p_group:group,p_open:open,p_deadline:open&&raw?new Date(raw).toISOString():null
        });
        if(current()){
          void app.refreshTrainingGroupTransferStatus();
          await app.refreshTrainingAttendancePoll(open?'Sondage ouvert.':'Sondage fermé.');
        }
        if(action==='trigger'&&current()&&confirm('Le sondage est ouvert. Publier le lien sur Discord ?')){
          await publishDiscord(current,id,group,false);
        }
        return;
      }
      if(action==='start'){
        app.trainingAttendanceInitializing=startSession(current,id).finally(()=>{app.trainingAttendanceInitializing=null});
        await app.trainingAttendanceInitializing;
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
      await publishDiscord(current,id,group,action==='remind');
    });
  }

  async function publishDiscord(current,id,group,reminder){
    const {data,error}=await app.db.functions.invoke('training-attendance-discord',{
      body:{session_id:id,group_id:group,reminder}
    });
    if(error){
      const payload=await error.context?.json?.().catch(()=>null);
      throw new Error((payload?.error||'Discord n’a pas confirmé l’envoi.')+' Le sondage reste ouvert.');
    }
    if(current())status().textContent=data?.message||'Message envoyé sur Discord.';
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

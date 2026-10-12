/* G2.2: manual tactical diagrams attached to persisted training occurrences. */
((app)=>{
app.trainingTacticalState={occurrenceId:null,occurrenceTitle:'',diagrams:[],record:null,editor:null,previousFocus:null,saving:false,frameToken:0,loadToken:0,saveToken:0};

app.trainingTacticalStatus=function trainingTacticalStatus(message,error=false){
  const target=app.$('#trainingTacticalSaveStatus');if(!target)return;
  target.textContent=message||'';target.dataset.state=error?'error':'ok';
};

app.trainingTacticalCanWrite=function trainingTacticalCanWrite(){
  const state=app.trainingTacticalState;
  return !!app.trainingState.currentSessionId
    &&app.trainingState.persistedOccurrenceIds?.has(state.occurrenceId)
    &&app.trainingLeaseState.status==='owned'
    &&app.trainingLeaseState.sessionId===app.trainingState.currentSessionId
    &&!!app.trainingLeaseState.token;
};

app.loadTrainingTacticalDiagrams=async function loadTrainingTacticalDiagrams(){
  const state=app.trainingTacticalState,sessionId=app.trainingState.currentSessionId,occurrenceId=state.occurrenceId;
  if(!sessionId||!occurrenceId){state.diagrams=[];return []}
  const {data,error}=await app.db.from('training_tactical_diagrams')
    .select('id,document,position,version,updated_at')
    .eq('session_id',sessionId).eq('occurrence_id',occurrenceId)
    .order('position',{ascending:true});
  if(error)throw error;
  if(sessionId!==app.trainingState.currentSessionId||occurrenceId!==state.occurrenceId)return [];
  state.diagrams=data||[];
  return state.diagrams;
};

app.renderTrainingTacticalManager=function renderTrainingTacticalManager(){
  const state=app.trainingTacticalState,list=app.$('#trainingTacticalList'),status=app.$('#trainingTacticalManagerStatus');
  const persisted=!!app.trainingState.currentSessionId&&app.trainingState.persistedOccurrenceIds?.has(state.occurrenceId);
  const writable=app.trainingTacticalCanWrite();
  app.$('#createTrainingTactical').disabled=!writable;
  if(status)status.textContent=!persisted?'Enregistre d’abord la séance pour activer les schémas tactiques.'
    :writable?'Chaque schéma est enregistré manuellement.':'Reprends le bail d’édition de la séance pour ouvrir ses schémas.';
  if(!list)return;
  if(!persisted){list.innerHTML='<div class="statsEmpty">Cette occurrence n’est pas encore enregistrée dans la séance.</div>';return}
  if(!state.diagrams.length){list.innerHTML='<div class="statsEmpty">Aucun schéma tactique pour cette occurrence.</div>';return}
  list.innerHTML=state.diagrams.map((diagram,index)=>`<article class="trainingTacticalItem">
    <div class="trainingTacticalItemInfo"><strong>${app.escapeHtml(diagram.document?.title||`Schéma ${index+1}`)}</strong><span class="small">Version ${diagram.version} · ${app.escapeHtml(app.formatDateShort?.(diagram.updated_at)||'')}</span></div>
    <button type="button" class="ghost" data-training-tactical-open="${app.escapeAttr(diagram.id)}" ${writable?'':'disabled'}>Ouvrir</button>
  </article>`).join('');
  list.querySelectorAll('[data-training-tactical-open]').forEach(button=>button.onclick=()=>{
    const record=state.diagrams.find(item=>item.id===button.dataset.trainingTacticalOpen);
    if(record)app.openTrainingTacticalEditor(record);
  });
};

app.openTrainingTacticalDiagrams=async function openTrainingTacticalDiagrams(occurrenceId,title='Exercice'){
  const state=app.trainingTacticalState;
  state.occurrenceId=occurrenceId;state.occurrenceTitle=title;state.record=null;state.previousFocus=document.activeElement;
  const loadToken=++state.loadToken;
  app.$('#trainingTacticalTitle').textContent='Schémas tactiques';
  app.$('#trainingTacticalMeta').textContent=title;
  app.$('#trainingTacticalManager').classList.remove('hidden');
  app.$('#trainingTacticalEditor').classList.add('hidden');
  app.$('#trainingTacticalPopup').classList.remove('hidden');
  const page=app.$('.app');if(page)page.inert=true;
  app.$('#trainingTacticalList').innerHTML='<div class="statsEmpty">Chargement…</div>';
  try{await app.loadTrainingTacticalDiagrams();if(loadToken===state.loadToken)app.renderTrainingTacticalManager()}
  catch(error){if(loadToken!==state.loadToken)return;app.$('#trainingTacticalList').innerHTML=`<div class="statsEmpty">${app.escapeHtml(error.message||String(error))}</div>`;app.handleError('training tactical list',error)}
  app.$('#closeTrainingTactical')?.focus();
};

app.openTrainingTacticalEditor=function openTrainingTacticalEditor(record=null){
  const state=app.trainingTacticalState,frame=app.$('#trainingTacticalFrame');
  if(!app.trainingTacticalCanWrite())return;
  state.record=record;state.editor=null;
  app.$('#trainingTacticalManager').classList.add('hidden');
  app.$('#trainingTacticalEditor').classList.remove('hidden');
  app.$('#saveTrainingTactical').disabled=!app.trainingTacticalCanWrite();
  app.trainingTacticalStatus('Chargement de l’éditeur…');
  const token=++state.frameToken;
  frame.onload=()=>{
    if(token!==state.frameToken||frame.src==='about:blank')return;
    try{
      const child=frame.contentWindow,editor=child.KinballCoach?.tacticalEditor;
      if(!editor)throw new Error('Éditeur tactique indisponible.');
      child.document.querySelector('.tacticalHeader')?.classList.add('hidden');
      child.document.querySelector('#newDiagram')?.classList.add('hidden');
      child.document.querySelector('#openDiagrams')?.classList.add('hidden');
      editor.save=()=>app.saveTrainingTacticalDiagram();
      child.document.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();app.leaveTrainingTacticalEditor()}
      },true);
      const document=record?.document||child.KinballTacticalModel.createDocument('Nouveau schéma');
      editor.loadDiagram(document,{clean:!!record,resetHistory:true,stored:false});
      state.editor=editor;
      app.trainingTacticalStatus(record?'Schéma chargé.':'Nouveau schéma non enregistré.');
    }catch(error){app.trainingTacticalStatus(error.message||String(error),true);app.handleError('training tactical editor',error)}
  };
  frame.src=`tactical-editor.html?embedded=1&v=${token}`;
};

app.saveTrainingTacticalDiagram=async function saveTrainingTacticalDiagram(){
  const state=app.trainingTacticalState;
  if(state.saving||!state.editor)return {ok:false};
  if(!app.trainingTacticalCanWrite()){
    app.trainingTacticalStatus('Le bail d’édition n’est plus actif. Les modifications restent ouvertes dans l’éditeur.',true);
    return {ok:false,kind:'lease'};
  }
  const checked=state.editor.root.ownerDocument.defaultView.KinballTacticalModel.validateDocument(state.editor.getDiagram());
  if(!checked.ok){app.trainingTacticalStatus(checked.error,true);return {ok:false,kind:'invalid'}}
  const document=checked.document;document.updatedAt=new Date().toISOString();
  const position=state.record?.position??(state.diagrams.reduce((max,item)=>Math.max(max,Number(item.position)||0),-1)+1);
  const editor=state.editor,occurrenceId=state.occurrenceId,sessionId=app.trainingState.currentSessionId;
  const record=state.record?{...state.record}:null,operationToken=++state.saveToken;
  const lease={instanceId:app.trainingLeaseState.instanceId,token:app.trainingLeaseState.token};
  state.saving=true;app.$('#saveTrainingTactical').disabled=true;app.$('#backTrainingTactical').disabled=true;app.$('#returnTrainingTactical').disabled=true;app.$('#closeTrainingTactical').disabled=true;app.trainingTacticalStatus('Enregistrement…');
  try{
    const {data,error}=await app.db.rpc('save_training_tactical_diagram',{
      p_session_id:sessionId,p_occurrence_id:occurrenceId,
      p_diagram_id:record?.id||null,p_expected_version:record?.version??null,
      p_document:document,p_position:position,p_editor_instance_id:lease.instanceId,p_lease_token:lease.token
    });
    if(error)throw error;
    const result=Array.isArray(data)?data[0]:data;
    const active=operationToken===state.saveToken&&state.editor===editor&&state.occurrenceId===occurrenceId&&app.trainingState.currentSessionId===sessionId;
    if(!active)return {ok:result?.status==='saved',stale:true,result};
    if(result?.status==='conflict'){
      app.trainingTacticalStatus(`Conflit de version : la version distante est ${result.remote_version}. Tes modifications restent ouvertes.`,true);
      return {ok:false,kind:'conflict',result};
    }
    if(result?.status!=='saved'||!result.diagram_id)throw new Error('Réponse de sauvegarde du schéma inattendue.');
    const saved={id:result.diagram_id,document,position,version:result.version,updated_at:result.updated_at};
    const index=state.diagrams.findIndex(item=>item.id===saved.id);
    if(index<0)state.diagrams.push(saved);else state.diagrams[index]=saved;
    state.record=saved;editor.loadDiagram(document,{clean:true,resetHistory:true,stored:false});
    app.trainingTacticalStatus('Schéma enregistré.');
    return {ok:true,record:saved};
  }catch(error){
    const leaseLost=error?.code==='55000'||/Bail d.edition|verrou/i.test(error?.message||'');
    if(leaseLost)await app.loseTrainingSessionLease();
    app.trainingTacticalStatus(`${leaseLost?'Bail d’édition perdu':'Enregistrement impossible'} : les modifications restent ouvertes.`,true);
    app.handleError('save training tactical diagram',error);
    return {ok:false,kind:leaseLost?'lease':'network',error};
  }finally{
    if(operationToken===state.saveToken){state.saving=false;app.$('#saveTrainingTactical').disabled=!app.trainingTacticalCanWrite();app.$('#backTrainingTactical').disabled=false;app.$('#returnTrainingTactical').disabled=false;app.$('#closeTrainingTactical').disabled=false}
  }
};

app.leaveTrainingTacticalEditor=function leaveTrainingTacticalEditor(){
  const state=app.trainingTacticalState;
  if(state.saving){app.trainingTacticalStatus('Attends la fin de l’enregistrement avant de fermer.');return false}
  if(state.editor?.dirty&&!confirm('Ce schéma contient des modifications non enregistrées. Les abandonner ?'))return false;
  if(state.editor?.dirty)state.editor.loadDiagram(state.editor.getDiagram(),{clean:true,resetHistory:true,stored:false});
  state.editor=null;state.record=null;++state.frameToken;
  const frame=app.$('#trainingTacticalFrame');frame.onload=null;frame.src='about:blank';
  app.$('#trainingTacticalEditor').classList.add('hidden');app.$('#trainingTacticalManager').classList.remove('hidden');
  app.renderTrainingTacticalManager();return true;
};

app.closeTrainingTacticalDiagrams=function closeTrainingTacticalDiagrams(){
  if(app.trainingTacticalState.saving){app.trainingTacticalStatus('Attends la fin de l’enregistrement avant de fermer.');return false}
  if(!app.$('#trainingTacticalEditor').classList.contains('hidden')&&!app.leaveTrainingTacticalEditor())return false;
  const state=app.trainingTacticalState;
  app.$('#trainingTacticalPopup').classList.add('hidden');
  const page=app.$('.app');if(page)page.inert=false;
  ++state.loadToken;
  const focus=state.previousFocus;state.occurrenceId=null;state.occurrenceTitle='';state.diagrams=[];state.previousFocus=null;
  if(focus?.isConnected)focus.focus();return true;
};

app.initTrainingTacticalDiagrams=function initTrainingTacticalDiagrams(){
  app.$('#createTrainingTactical').onclick=()=>app.openTrainingTacticalEditor(null);
  app.$('#saveTrainingTactical').onclick=()=>app.saveTrainingTacticalDiagram();
  app.$('#backTrainingTactical').onclick=app.leaveTrainingTacticalEditor;
  app.$('#returnTrainingTactical').onclick=app.closeTrainingTacticalDiagrams;
  app.$('#closeTrainingTactical').onclick=app.closeTrainingTacticalDiagrams;
  app.$('#trainingTacticalPopup').onclick=event=>{if(event.target===app.$('#trainingTacticalPopup'))app.closeTrainingTacticalDiagrams()};
  document.addEventListener('keydown',event=>{
    const popup=app.$('#trainingTacticalPopup');if(popup.classList.contains('hidden'))return;
    if(event.key==='Escape'){
      event.preventDefault();
      if(!app.$('#trainingTacticalEditor').classList.contains('hidden'))app.leaveTrainingTacticalEditor();
      else app.closeTrainingTacticalDiagrams();
      return;
    }
    if(event.key!=='Tab')return;
    const controls=[...popup.querySelectorAll('button:not([disabled]),iframe,[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(element=>!element.closest('.hidden'));
    const first=controls[0],last=controls.at(-1);if(!first||!last)return;
    if(!popup.contains(document.activeElement)){event.preventDefault();first.focus()}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  });
  window.addEventListener('beforeunload',event=>{
    if(!app.trainingTacticalState.editor?.dirty)return;
    event.preventDefault();event.returnValue='';
  });
};

})(window.KinballCoach.app);

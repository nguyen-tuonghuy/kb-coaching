/* G2: manual tactical diagrams attached to persisted training occurrences. */
((app)=>{
app.trainingTacticalState={occurrenceId:null,occurrenceTitle:'',diagrams:[],record:null,editor:null,previousFocus:null,saving:false,managing:false,frameToken:0,loadToken:0,saveToken:0,previewToken:0,previewObserver:null};

app.trainingTacticalStatus=function trainingTacticalStatus(message,error=false){
  const target=app.$('#trainingTacticalSaveStatus');if(!target)return;
  target.textContent=message||'';target.dataset.state=error?'error':'ok';
};

app.trainingTacticalManagerStatus=function trainingTacticalManagerStatus(message,error=false){
  const target=app.$('#trainingTacticalManagerStatus');if(!target)return;
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

app.renderTrainingTacticalThumbnail=function renderTrainingTacticalThumbnail(target,document){
  const ns='http://www.w3.org/2000/svg';
  if(!target||!document||!Array.isArray(document.objects))throw new Error('Aperçu indisponible');
  const svg=target.ownerDocument.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Aperçu de ${document.title||'ce schéma'}`);
  const add=(name,attributes={},parent=svg)=>{const node=target.ownerDocument.createElementNS(ns,name);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));parent.append(node);return node};
  add('rect',{x:4,y:4,width:992,height:992,rx:24,fill:'#f6f8fb',stroke:'#8a98aa','stroke-width':8});
  add('line',{x1:500,y1:4,x2:500,y2:996,stroke:'#c7d0da','stroke-width':5,'stroke-dasharray':'24 18'});
  add('line',{x1:4,y1:500,x2:996,y2:500,stroke:'#c7d0da','stroke-width':5,'stroke-dasharray':'24 18'});
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  for(const object of document.objects){
    if(!object||!finite(object.x)||!finite(object.y))continue;
    const group=add('g',{transform:`translate(${object.x} ${object.y}) rotate(${finite(object.rotation)?object.rotation:0}) scale(${finite(object.scaleX)?object.scaleX:1} ${finite(object.scaleY)?object.scaleY:1})`,opacity:finite(object.opacity)?object.opacity:1});
    if(object.type==='player'){
      const colors={black:['#172033','#fff'],gray:['#8793a2','#172033'],pink:['#f4267d','#fff']}[object.team]||['#172033','#fff'];
      add('circle',{r:object.radius||34,fill:colors[0],stroke:'#0b315b','stroke-width':5},group);
      const text=add('text',{x:0,y:8,'text-anchor':'middle','font-size':24,'font-weight':700,fill:colors[1]},group);text.textContent=object.label||'';
    }else if(object.type==='ball'){
      add('circle',{r:object.radius||58,fill:'#ffeb74',stroke:'#0b315b','stroke-width':5},group);
      add('circle',{r:(object.radius||58)*.55,fill:'none',stroke:'#1768b3','stroke-width':7},group);
    }else if(['arrow','curve','line'].includes(object.type)&&Array.isArray(object.points)){
      const points=object.points,attributes={fill:'none',stroke:object.stroke||'#172033','stroke-width':object.strokeWidth||6,'stroke-linecap':'round','stroke-linejoin':'round'};
      if(object.type==='curve'&&points.length===6)add('path',{...attributes,d:`M ${points[0]} ${points[1]} Q ${points[2]} ${points[3]} ${points[4]} ${points[5]}`},group);
      else add('polyline',{...attributes,points:points.join(' '),'stroke-dasharray':object.dashed?'20 14':''},group);
      if(object.type!=='line'&&points.length>=4)add('circle',{cx:points.at(-2),cy:points.at(-1),r:11,fill:object.stroke||'#172033'},group);
    }else if(object.type==='zone'){
      const attributes={fill:object.fill||'#1768b3','fill-opacity':.22,stroke:object.stroke||'#0b315b','stroke-width':object.strokeWidth||4};
      if(object.shape==='ellipse')add('ellipse',{...attributes,rx:(object.width||220)/2,ry:(object.height||150)/2},group);
      else add('rect',{...attributes,x:-(object.width||220)/2,y:-(object.height||150)/2,width:object.width||220,height:object.height||150},group);
    }else if(object.type==='text'){
      const text=add('text',{x:0,y:0,'text-anchor':'middle','dominant-baseline':'middle','font-size':object.fontSize||32,fill:object.fill||'#172033'},group);text.textContent=object.text||'';
    }
  }
  target.replaceChildren(svg);target.dataset.state='ready';
  return svg;
};

app.scheduleTrainingTacticalThumbnails=function scheduleTrainingTacticalThumbnails(){
  const state=app.trainingTacticalState,token=++state.previewToken;
  state.previewObserver?.disconnect();state.previewObserver=null;
  const render=target=>{
    if(token!==state.previewToken||!target.isConnected)return;
    const record=state.diagrams.find(item=>item.id===target.dataset.trainingTacticalPreview);
    try{if(!record)throw new Error('Schéma introuvable');app.renderTrainingTacticalThumbnail(target,record.document)}
    catch(error){target.dataset.state='error';target.textContent='Aperçu indisponible'}
  };
  const targets=[...app.$('#trainingTacticalList').querySelectorAll('[data-training-tactical-preview]')];
  if(typeof IntersectionObserver==='function'){
    state.previewObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){state.previewObserver?.unobserve(entry.target);render(entry.target)}}),{root:app.$('#trainingTacticalList'),rootMargin:'100px'});
    targets.forEach(target=>state.previewObserver.observe(target));
  }else targets.forEach(target=>setTimeout(()=>render(target),0));
};

app.renderTrainingTacticalManager=function renderTrainingTacticalManager(){
  const state=app.trainingTacticalState,list=app.$('#trainingTacticalList'),status=app.$('#trainingTacticalManagerStatus');
  ++state.previewToken;state.previewObserver?.disconnect();state.previewObserver=null;
  const persisted=!!app.trainingState.currentSessionId&&app.trainingState.persistedOccurrenceIds?.has(state.occurrenceId);
  const writable=app.trainingTacticalCanWrite(),busy=state.managing||state.saving;
  app.$('#createTrainingTactical').disabled=!writable||busy;
  if(status){status.dataset.state='ok';status.textContent=!persisted?'Enregistre d’abord la séance pour activer les schémas tactiques.'
    :writable?'Chaque schéma est enregistré manuellement.':'Reprends le bail d’édition de la séance pour gérer ses schémas.'}
  if(!list)return;
  if(!persisted){list.innerHTML='<div class="statsEmpty">Cette occurrence n’est pas encore enregistrée dans la séance.</div>';return}
  if(!state.diagrams.length){list.innerHTML='<div class="statsEmpty">Aucun schéma tactique pour cette occurrence.</div>';return}
  list.innerHTML=state.diagrams.map((diagram,index)=>`<article class="trainingTacticalItem">
    <div class="trainingTacticalPreview" data-training-tactical-preview="${app.escapeAttr(diagram.id)}" data-state="loading"><span>Chargement…</span></div>
    <div class="trainingTacticalItemInfo"><strong>${app.escapeHtml(diagram.document?.title||`Schéma ${index+1}`)}</strong><span class="small">Version ${diagram.version} · ${app.escapeHtml(app.formatDateShort?.(diagram.updated_at)||'')}</span></div>
    <div class="trainingTacticalItemActions">
     <button type="button" class="ghost" data-training-tactical-open="${app.escapeAttr(diagram.id)}" ${writable&&!busy?'':'disabled'}>Ouvrir / modifier</button>
     <button type="button" class="ghost" data-training-tactical-rename="${app.escapeAttr(diagram.id)}" ${writable&&!busy?'':'disabled'}>Renommer</button>
     <button type="button" class="ghost" data-training-tactical-duplicate="${app.escapeAttr(diagram.id)}" ${writable&&!busy?'':'disabled'}>Dupliquer</button>
     <button type="button" class="ghost danger" data-training-tactical-delete="${app.escapeAttr(diagram.id)}" ${writable&&!busy?'':'disabled'}>Supprimer</button>
    </div>
  </article>`).join('');
  list.querySelectorAll('[data-training-tactical-open]').forEach(button=>button.onclick=()=>{
    const record=state.diagrams.find(item=>item.id===button.dataset.trainingTacticalOpen);
    if(record)app.openTrainingTacticalEditor(record);
  });
  list.querySelectorAll('[data-training-tactical-rename]').forEach(button=>button.onclick=()=>app.renameTrainingTacticalDiagram(button.dataset.trainingTacticalRename));
  list.querySelectorAll('[data-training-tactical-duplicate]').forEach(button=>button.onclick=()=>app.duplicateTrainingTacticalDiagram(button.dataset.trainingTacticalDuplicate));
  list.querySelectorAll('[data-training-tactical-delete]').forEach(button=>button.onclick=()=>app.deleteTrainingTacticalDiagram(button.dataset.trainingTacticalDelete));
  app.scheduleTrainingTacticalThumbnails();
};

// Reordering needs a transactional RPC: swapping two positions directly can
// violate the immediate unique constraint on session, occurrence and position.

app.trainingTacticalDocumentId=function trainingTacticalDocumentId(){
  return `diagram-${globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`}`;
};

app.persistTrainingTacticalRecord=async function persistTrainingTacticalRecord(record,document,position){
  const state=app.trainingTacticalState;
  if(state.managing||state.saving)return {ok:false,kind:'busy'};
  if(!app.trainingTacticalCanWrite())return {ok:false,kind:'lease'};
  const sessionId=app.trainingState.currentSessionId,occurrenceId=state.occurrenceId;
  const lease={instanceId:app.trainingLeaseState.instanceId,token:app.trainingLeaseState.token};
  state.managing=true;app.$('#closeTrainingTactical').disabled=true;app.renderTrainingTacticalManager();
  try{
    const {data,error}=await app.db.rpc('save_training_tactical_diagram',{
      p_session_id:sessionId,p_occurrence_id:occurrenceId,p_diagram_id:record?.id||null,
      p_expected_version:record?.version??null,p_document:document,p_position:position,
      p_editor_instance_id:lease.instanceId,p_lease_token:lease.token
    });
    if(error)throw error;
    const result=Array.isArray(data)?data[0]:data;
    if(result?.status==='conflict')return {ok:false,kind:'conflict',result};
    if(result?.status!=='saved'||!result.diagram_id)throw new Error('Réponse de sauvegarde du schéma inattendue.');
    return {ok:true,record:{id:result.diagram_id,document,position,version:result.version,updated_at:result.updated_at}};
  }catch(error){
    const leaseLost=error?.code==='55000'||/Bail d.edition|verrou/i.test(error?.message||'');
    if(leaseLost)await app.loseTrainingSessionLease();
    return {ok:false,kind:leaseLost?'lease':'network',error};
  }finally{state.managing=false;app.$('#closeTrainingTactical').disabled=false;app.renderTrainingTacticalManager()}
};

app.renameTrainingTacticalDiagram=async function renameTrainingTacticalDiagram(diagramId){
  const state=app.trainingTacticalState,record=state.diagrams.find(item=>item.id===diagramId);if(!record)return {ok:false,kind:'missing'};
  const title=prompt('Nouveau nom du schéma',record.document?.title||'Schéma');if(title===null)return {ok:false,kind:'cancelled'};
  const trimmed=title.trim();if(!trimmed||trimmed.length>160){app.trainingTacticalManagerStatus('Le titre doit contenir entre 1 et 160 caractères.',true);return {ok:false,kind:'invalid'}}
  if(trimmed===(record.document?.title||''))return {ok:true,record};
  const document=JSON.parse(JSON.stringify(record.document));document.title=trimmed;document.updatedAt=new Date().toISOString();
  const result=await app.persistTrainingTacticalRecord(record,document,record.position);
  if(result.ok){state.diagrams[state.diagrams.findIndex(item=>item.id===record.id)]=result.record;app.renderTrainingTacticalManager();app.trainingTacticalManagerStatus('Schéma renommé.');return result}
  const message=result.kind==='conflict'?'Conflit de version : le nom distant a changé. Recharge la liste avant de réessayer.'
    :result.kind==='lease'?'Bail d’édition perdu : le schéma n’a pas été renommé.':'Renommage impossible : le schéma original est conservé.';
  app.trainingTacticalManagerStatus(message,true);if(result.error)app.handleError('rename training tactical diagram',result.error);return result;
};

app.duplicateTrainingTacticalDiagram=async function duplicateTrainingTacticalDiagram(diagramId){
  const state=app.trainingTacticalState,record=state.diagrams.find(item=>item.id===diagramId);if(!record)return {ok:false,kind:'missing'};
  const stamp=new Date().toISOString(),document=JSON.parse(JSON.stringify(record.document));
  document.id=app.trainingTacticalDocumentId();document.title=`Copie de ${document.title||'Schéma'}`.slice(0,160);document.createdAt=stamp;document.updatedAt=stamp;
  const position=state.diagrams.reduce((max,item)=>Math.max(max,Number(item.position)||0),-1)+1;
  const result=await app.persistTrainingTacticalRecord(null,document,position);
  if(result.ok){state.diagrams.push(result.record);app.renderTrainingTacticalManager();app.trainingTacticalManagerStatus('Copie indépendante créée.');return result}
  const message=result.kind==='lease'?'Bail d’édition perdu : aucune copie n’a été créée.':'Duplication impossible : le schéma original est conservé.';
  app.trainingTacticalManagerStatus(message,true);if(result.error)app.handleError('duplicate training tactical diagram',result.error);return result;
};

app.deleteTrainingTacticalDiagram=async function deleteTrainingTacticalDiagram(diagramId){
  const state=app.trainingTacticalState,record=state.diagrams.find(item=>item.id===diagramId);if(!record)return {ok:false,kind:'missing'};
  if(!confirm(`Supprimer définitivement « ${record.document?.title||'ce schéma'} » ?`))return {ok:false,kind:'cancelled'};
  if(state.managing||state.saving)return {ok:false,kind:'busy'};
  if(!app.trainingTacticalCanWrite()){app.trainingTacticalManagerStatus('Bail d’édition requis pour supprimer ce schéma.',true);return {ok:false,kind:'lease'}}
  const sessionId=app.trainingState.currentSessionId,lease={instanceId:app.trainingLeaseState.instanceId,token:app.trainingLeaseState.token};
  state.managing=true;app.$('#closeTrainingTactical').disabled=true;app.renderTrainingTacticalManager();
  let result;
  try{
    const {data,error}=await app.db.rpc('delete_training_tactical_diagram',{
      p_session_id:sessionId,p_diagram_id:record.id,p_expected_version:record.version,
      p_editor_instance_id:lease.instanceId,p_lease_token:lease.token
    });
    if(error)throw error;if(data!==true)throw new Error('Suppression du schéma non confirmée.');
    state.diagrams=state.diagrams.filter(item=>item.id!==record.id);result={ok:true};
  }catch(error){
    const leaseLost=error?.code==='55000'||/Bail d.edition|verrou/i.test(error?.message||'');
    const conflict=error?.code==='40001'||/conflit de version/i.test(error?.message||'');
    if(leaseLost)await app.loseTrainingSessionLease();
    result={ok:false,kind:leaseLost?'lease':conflict?'conflict':'network',error};app.handleError('delete training tactical diagram',error);
  }finally{state.managing=false;app.$('#closeTrainingTactical').disabled=false;app.renderTrainingTacticalManager()}
  app.trainingTacticalManagerStatus(result.ok?'Schéma supprimé.':result.kind==='conflict'?'Conflit de version : le schéma distant est conservé.'
    :result.kind==='lease'?'Bail d’édition perdu : le schéma est conservé.':'Suppression impossible : le schéma est conservé.',!result.ok);
  return result;
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
  const state=app.trainingTacticalState;
  if(state.saving){app.trainingTacticalStatus('Attends la fin de l’enregistrement avant de fermer.');return false}
  if(state.managing){app.trainingTacticalManagerStatus('Attends la fin de l’opération avant de fermer.');return false}
  if(!app.$('#trainingTacticalEditor').classList.contains('hidden')&&!app.leaveTrainingTacticalEditor())return false;
  app.$('#trainingTacticalPopup').classList.add('hidden');
  const page=app.$('.app');if(page)page.inert=false;
  ++state.loadToken;
  ++state.previewToken;state.previewObserver?.disconnect();state.previewObserver=null;
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

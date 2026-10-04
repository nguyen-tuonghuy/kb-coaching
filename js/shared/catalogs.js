/* catalogs. Shared explicit application context; no startup side effects. */
((app) => {
app.matchTypeById = function matchTypeById(id){return app.matchTypeState.types.find(t=>t.id===id)};

app.normalizeMatchTypeName = function normalizeMatchTypeName(name){
  return String(name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
};

app.populateMatchTypeSelect = function populateMatchTypeSelect(select,{selected=select?.value||'',all=false,includeArchivedId=null}={}){
  if(!select)return;
  select.innerHTML='';
  const first=document.createElement('option');
  first.value='';first.textContent=all?'Tous les types':'— Aucun type —';
  select.append(first);
  app.matchTypeState.types.filter(t=>all||t.active||t.id===includeArchivedId).forEach(t=>{
    const o=document.createElement('option');o.value=t.id;
    o.textContent=t.name+(t.active?'':' · archivé');
    select.append(o);
  });
  if([...select.options].some(o=>o.value===selected))select.value=selected;
};

app.fetchMatchTypes = async function fetchMatchTypes(){
  app.matchTypeState.types=await app.services.matchTypes();
  app.populateMatchTypeSelect(app.$('#matchType'));
  app.populateMatchTypeSelect(app.$('#matchLibraryType'),{all:true});
};

app.matchTypeMessage = function matchTypeMessage(message,error=false){
  const st=app.$('#matchTypeStatus');if(!st)return;
  st.textContent=message;st.className='authStatus '+(error?'cloudErr':'cloudOk');
};

app.validateMatchTypeName = function validateMatchTypeName(name,exceptId=null){
  const cleaned=String(name||'').replace(/\s+/g,' ').trim();
  if(!cleaned||cleaned.length>100)throw new Error('Le nom doit contenir entre 1 et 100 caractères.');
  const dup=app.matchTypeState.types.find(t=>t.id!==exceptId&&app.normalizeMatchTypeName(t.name)===app.normalizeMatchTypeName(cleaned));
  if(dup)throw new Error(dup.active?'Un type porte déjà ce nom.':'Ce type existe déjà : réactive-le dans la liste.');
  return cleaned;
};

app.updateCustomMatchType = async function updateCustomMatchType(id,changes){
  const t=app.matchTypeById(id);
  if(!t||t.is_native)throw new Error('Ce type est fixe.');
  const {error}=await app.db.from('match_types').update(changes).eq('id',id).eq('is_native',false).select('id').single();
  if(error)throw error;
};

app.fetchMatchTypeUsage = async function fetchMatchTypeUsage(id){
  const {data,error}=await app.db.rpc('get_match_type_usage',{p_match_type_id:id});
  if(error)throw error;
  return data||{match_count:0,used:false};
};

app.deleteCustomMatchType = async function deleteCustomMatchType(id){
  const t=app.matchTypeById(id);
  if(!t||t.is_native)throw new Error('Ce type est fixe.');
  const usage=await app.fetchMatchTypeUsage(id);
  if(Number(usage.match_count||0)>0){
    throw new Error(`Ce type est utilisé par ${usage.match_count} match${Number(usage.match_count)>1?'s':''}. Archive-le plutôt.`);
  }
  if(!confirm(`Supprimer définitivement le type « ${t.name} » ?`))return false;
  const {error}=await app.db.from('match_types').delete().eq('id',id).eq('is_native',false).select('id').single();
  if(error)throw error;
  return true;
};

app.runMatchTypeAction = async function runMatchTypeAction(action){
  if(app.matchTypeState.busy)return;
  app.matchTypeState.busy=true;app.matchTypeMessage('Enregistrement…');
  try{
    await action();
    await app.fetchMatchTypes();
    app.renderMatchTypeSettings();
    app.matchTypeMessage('Types de match enregistrés ✓');
  }catch(e){
    if(e.message==='__cancel__')app.matchTypeMessage('');
    else app.matchTypeMessage(e.code==='23505'?'Ce nom existe déjà.':(e.message||String(e)),true);
  }finally{app.matchTypeState.busy=false}
};

app.renderMatchTypeSettings = function renderMatchTypeSettings(){
  const list=app.$('#matchTypeList');if(!list)return;
  list.replaceChildren();
  app.matchTypeState.types.forEach(t=>{
    const card=document.createElement('div');card.className='trainingCard';
    const row=document.createElement('div');row.className='row';row.style.alignItems='center';
    const info=document.createElement('div');info.style.cssText='flex:1 1 160px;min-width:0';
    const name=document.createElement('strong');name.textContent=t.name;
    const status=document.createElement('div');status.className='small';
    status.textContent=t.is_native?'Fixe':t.active?'Actif':'Archivé';
    info.append(name,status);row.append(info);card.append(row);
    if(!t.is_native){
      const actions=document.createElement('div');actions.className='row';
      const rename=document.createElement('button');rename.className='ghost';rename.textContent='Renommer';
      const toggle=document.createElement('button');toggle.className='ghost';toggle.textContent=t.active?'Archiver':'Réactiver';
      const remove=document.createElement('button');remove.className='ghost';remove.textContent='Supprimer';
      toggle.onclick=()=>app.runMatchTypeAction(()=>app.updateCustomMatchType(t.id,{active:!t.active}));
      remove.onclick=()=>app.runMatchTypeAction(async()=>{const ok=await app.deleteCustomMatchType(t.id);if(ok===false)throw new Error('__cancel__')});
      rename.onclick=()=>{
        if(card.querySelector('form'))return;
        const form=document.createElement('form');form.className='row';form.style.marginTop='9px';
        const field=document.createElement('div');field.className='field';
        const input=document.createElement('input');input.value=t.name;input.maxLength=100;input.required=true;
        const save=document.createElement('button');save.className='primary';save.type='submit';save.textContent='Enregistrer';
        const cancel=document.createElement('button');cancel.className='ghost';cancel.type='button';cancel.textContent='Annuler';
        cancel.onclick=()=>form.remove();
        form.onsubmit=ev=>{ev.preventDefault();app.runMatchTypeAction(()=>app.updateCustomMatchType(t.id,{name:app.validateMatchTypeName(input.value,t.id)}))};
        field.append(input);form.append(field,save,cancel);card.append(form);input.focus();input.select();
      };
      actions.append(rename,toggle,remove);row.append(actions);
    }
    list.append(card);
  });
};

app.normalizeCategoryName = function normalizeCategoryName(name){
  return String(name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replaceAll('œ','oe').replaceAll('æ','ae').replace(/\s+/g,' ').trim();
};

app.categoryById = function categoryById(id){return app.categoryState.categories.find(c=>c.id===id)};

app.fallbackCategory = function fallbackCategory(){return app.categoryState.categories.find(c=>c.slug==='autre'&&c.is_native&&c.active)};

app.exerciseCategory = function exerciseCategory(ex){return app.categoryById(ex?.category_id)};

app.isDualExercise = function isDualExercise(ex){return !!app.exerciseCategory(ex)?.is_dual_focus};

app.categoryLabel = function categoryLabel(ex){
  const category=app.exerciseCategory(ex);
  return category?category.name+(category.active?'':' · archivée'):(ex?.category||app.fallbackCategory()?.name||'Sans catégorie');
};

app.requireCategory = function requireCategory(id,existingId=null){
  const category=app.categoryById(id);
  if(!category)throw new Error('Choisis une catégorie.');
  if(!category.active&&id!==existingId)throw new Error('Cette catégorie est archivée. Choisis une catégorie active.');
  return category;
};

app.fetchExerciseCategories = async function fetchExerciseCategories(){
  // Include archived rows: their identifiers remain meaningful in historical data.
  app.categoryState.categories=await app.services.exerciseCategories();
  app.populateCategorySelect(app.$('#exerciseLibraryCategory'),{all:true});
};

app.categoryMessage = function categoryMessage(message,error=false){
  const status=app.$('#categoryStatus');status.textContent=message;
  status.className='authStatus '+(error?'cloudErr':'cloudOk');
};

app.validateCategoryName = function validateCategoryName(name,exceptId=null){
  const cleaned=name.replace(/\s+/g,' ').trim();
  if(!cleaned||cleaned.length>100)throw new Error('Le nom doit contenir entre 1 et 100 caractères.');
  const duplicate=app.categoryState.categories.find(c=>c.id!==exceptId&&app.normalizeCategoryName(c.name)===app.normalizeCategoryName(cleaned));
  if(duplicate)throw new Error(duplicate.active?'Une catégorie porte déjà ce nom.':'Cette catégorie existe déjà : réactive-la dans la liste.');
  return cleaned;
};

app.runCategoryAction = async function runCategoryAction(action){
  if(app.categoryState.busy)return;
  app.categoryState.busy=true;app.categoryMessage('Enregistrement…');
  app.$$('#settingsHome button, #settingsHome input').forEach(el=>el.disabled=true);
  try{
    await action();
    await app.fetchExerciseCategories();
    app.renderCategorySettings();
    app.categoryMessage('Catégories enregistrées ✓');
  }catch(e){
    if(e.message==='__cancel__')app.categoryMessage('');
    else app.categoryMessage(e.code==='23505'?'Ce nom existe déjà, y compris parmi les catégories archivées.':(e.message||String(e)),true);
  }finally{
    app.categoryState.busy=false;
    app.$$('#settingsHome button, #settingsHome input').forEach(el=>el.disabled=false);
  }
};

app.updateCustomCategory = async function updateCustomCategory(id,changes){
  const category=app.categoryById(id);
  if(!category||category.is_native)throw new Error('Cette catégorie est fixe.');
  const {error}=await app.db.from('exercise_categories').update(changes).eq('id',id).eq('is_native',false).select('id').single();
  if(error)throw error;
};

app.fetchExerciseCategoryUsage = async function fetchExerciseCategoryUsage(categoryId){
  const {data,error}=await app.db.rpc('get_exercise_category_usage',{p_category_id:categoryId});
  if(error)throw error;
  if(!data)throw new Error('Impossible de vérifier l’utilisation de cette catégorie.');
  return data;
};

app.deleteCustomCategory = async function deleteCustomCategory(id){
  const category=app.categoryById(id);
  if(!category||category.is_native)throw new Error('Cette catégorie est fixe.');

  const usage=await app.fetchExerciseCategoryUsage(id);
  const count=Number(usage.exercise_count||0);
  const usedCount=Number(usage.used_exercise_count||0);

  if(usedCount>0){
    throw new Error(`Cette catégorie contient ${usedCount} exercice${usedCount>1?'s':''} déjà utilisé${usedCount>1?'s':''}. Archive-la plutôt pour préserver l’historique.`);
  }

  if(count===0){
    if(!confirm(`Supprimer définitivement la catégorie « ${category.name} » ?`))return false;
  }else{
    const other=app.fallbackCategory();
    if(!other)throw new Error('La catégorie « Autre » est introuvable.');
    if(!confirm(`Supprimer définitivement la catégorie « ${category.name} » ?\n\nSes ${count} exercice${count>1?'s':''} n’ont jamais été utilisé${count>1?'s':''} en séance et seront déplacé${count>1?'s':''} vers « Autre ».`))return false;

    const {error:moveError}=await app.db.from('exercises')
      .update({category_id:other.id})
      .eq('category_id',id);
    if(moveError)throw moveError;
  }

  const {error}=await app.db.from('exercise_categories')
    .delete()
    .eq('id',id)
    .eq('is_native',false)
    .select('id')
    .single();
  if(error)throw error;
  return true;
};

app.renderCategorySettings = function renderCategorySettings(){
  const list=app.$('#categoryList');list.replaceChildren();
  app.categoryState.categories.forEach(category=>{
    const card=document.createElement('div');card.className='trainingCard';
    const row=document.createElement('div');row.className='row';row.style.alignItems='center';
    const info=document.createElement('div');info.style.cssText='flex:1 1 160px;min-width:0;overflow-wrap:anywhere';
    const name=document.createElement('strong');name.textContent=category.name;
    const status=document.createElement('div');status.className='small';
    status.textContent=category.is_native?'Fixe':category.active?'Active':'Archivée';
    info.append(name,status);row.append(info);card.append(row);
    if(!category.is_native){
      const actions=document.createElement('div');actions.className='row';
      const rename=document.createElement('button');rename.className='ghost';rename.textContent='Renommer';
      rename.setAttribute('aria-label','Renommer '+category.name);
      const toggle=document.createElement('button');toggle.className='ghost';toggle.textContent=category.active?'Archiver':'Réactiver';
      toggle.setAttribute('aria-label',toggle.textContent+' '+category.name);
      toggle.onclick=()=>app.runCategoryAction(()=>app.updateCustomCategory(category.id,{active:!category.active}));
      const remove=document.createElement('button');remove.className='ghost';remove.textContent='Supprimer';
      remove.setAttribute('aria-label','Supprimer '+category.name);
      remove.onclick=()=>app.runCategoryAction(async()=>{
        const deleted=await app.deleteCustomCategory(category.id);
        if(deleted===false)throw new Error('__cancel__');
      });
      rename.onclick=()=>{
        if(card.querySelector('form'))return;
        const form=document.createElement('form');form.className='row';form.style.marginTop='10px';
        const field=document.createElement('div');field.className='field';
        const input=document.createElement('input');input.value=category.name;input.maxLength=100;input.required=true;
        input.setAttribute('aria-label','Nouveau nom pour '+category.name);field.append(input);
        const save=document.createElement('button');save.type='submit';save.className='primary';save.textContent='Enregistrer';
        const cancel=document.createElement('button');cancel.type='button';cancel.className='ghost';cancel.textContent='Annuler';
        cancel.onclick=()=>form.remove();
        form.onsubmit=event=>{event.preventDefault();app.runCategoryAction(()=>app.updateCustomCategory(category.id,{name:app.validateCategoryName(input.value,category.id)}))};
        form.append(field,save,cancel);card.append(form);input.focus();input.select();
      };
      actions.append(rename,toggle,remove);row.append(actions);
    }
    list.append(card);
  });
};

app.openSettingsModule = async function openSettingsModule(){
  app.hideMainModules();app.setMatchHeaderMode(false);app.$('#settingsHome').classList.remove('hidden');
  app.$('#categoryList').replaceChildren();app.$('#matchTypeList').replaceChildren();app.categoryMessage('Chargement…');app.matchTypeMessage('Chargement…');
  try{
    await Promise.all([app.fetchExerciseCategories(),app.fetchMatchTypes()]);
    app.renderCategorySettings();app.renderMatchTypeSettings();app.categoryMessage('');app.matchTypeMessage('');
  }catch(e){app.categoryMessage(e.message||String(e),true);app.matchTypeMessage(e.message||String(e),true)}
  window.scrollTo({top:0,behavior:'instant'});
};

app.messageNotificationFor = function messageNotificationFor(groupId,playerId){
  return (app.groupState.messageNotifications||[]).find(x=>x.group_id===groupId&&x.player_id===playerId)||null;
};

app.totalStaffUnread = function totalStaffUnread(){
  return (app.groupState.messageNotifications||[]).reduce((sum,x)=>sum+(Number(x.unread_count)||0),0);
};

app.renderMessageNotifications = function renderMessageNotifications(){
  const total=app.totalStaffUnread();
  const groupBadge=app.$('#groupsUnreadBadge');
  if(groupBadge){groupBadge.textContent=String(total);groupBadge.classList.toggle('hidden',!total)}
  const recent=app.$('#staffRecentMessages'),list=app.$('#staffRecentMessageList');
  const staffRows=(app.groupState.messageNotifications||[]).filter(x=>x.last_sender_role==='player');
  if(recent&&list){
    recent.classList.toggle('hidden',!staffRows.length);
    list.innerHTML=staffRows.slice(0,6).map(x=>`<button type="button" class="staffRecentMessage" data-group-id="${app.escapeHtml(x.group_id)}" data-player-id="${app.escapeHtml(x.player_id)}"><span class="staffRecentMessageText"><strong>${app.escapeHtml(x.player_name)} · ${app.escapeHtml(x.group_name)}</strong><span class="preview">${app.escapeHtml(x.last_message||'Nouveau message')}</span></span><span class="messageUnreadBadge">${Number(x.unread_count)||0}</span></button>`).join('');
    list.querySelectorAll('[data-player-id]').forEach(b=>b.onclick=()=>app.openStaffPlayerPortalFromNotification(b.dataset.groupId,b.dataset.playerId).catch(e=>app.handleError('open message notification',e)));
  }
  const playerBadge=app.$('#playerUnreadBadge');
  if(playerBadge){
    const groupId=app.playerPortalState.groupId;
    const playerId=app.playerPortalTargetPlayerId?.();
    const n=groupId&&playerId?Number((app.playerPortalState.messageNotifications||[]).find(x=>x.group_id===groupId&&x.player_id===playerId)?.unread_count||0):0;
    playerBadge.textContent=String(n);playerBadge.classList.toggle('hidden',!n);
  }
  if(app.groupState.currentGroupId&&app.groupState.currentPlayers?.length)app.renderGroupPlayers();
};

app.refreshMessageNotifications = async function refreshMessageNotifications(viewerRole='coach'){
  if(!app.currentUser)return [];
  const {data,error}=await app.db.rpc('get_player_message_notifications',{p_viewer_role:viewerRole});
  if(error)throw error;
  if(viewerRole==='player')app.playerPortalState.messageNotifications=data||[];
  else app.groupState.messageNotifications=data||[];
  app.renderMessageNotifications();
  return data||[];
};

app.openStaffPlayerPortalFromNotification = async function openStaffPlayerPortalFromNotification(groupId,playerId){
  await app.openGroupDetail(groupId);
  await app.openStaffPlayerPortal(playerId);
};
app.populateCategorySelect = function populateCategorySelect(select,{selected=select?.value||'',all=false,includeArchivedId=null}={}){
  if(!select)return;
  select.replaceChildren();
  if(all){const option=document.createElement('option');option.value='';option.textContent='Toutes les catégories';select.append(option)}
  app.categoryState.categories.filter(c=>all||c.active||c.id===includeArchivedId).forEach(c=>{
    const option=document.createElement('option');option.value=c.id;
    option.textContent=c.name+(c.active?'':' · archivée');select.append(option);
  });
  if([...select.options].some(o=>o.value===selected))select.value=selected;
  else select.value=all?'':(app.fallbackCategory()?.id||'');
};
})(window.KinballCoach.app);

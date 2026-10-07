/* groups. Shared explicit application context; no startup side effects. */
((app) => {
app.fetchProfiles = async function fetchProfiles(userIds){
  const id=app.currentUser?.id;
  const map=await app.services.profiles(userIds);
  if(app.currentUser?.id!==id)return {};
  Object.assign(app.groupState.profiles,map);
  return map;
};

app.getMyProfile = async function getMyProfile(){
  const id=app.currentUser?.id;
  const profile=await app.services.myProfile();
  return app.currentUser?.id===id?profile:null;
};

app.openProfilePopup = function openProfilePopup(){
  const current=app.groupState.profiles[app.currentUser?.id]||'';
  app.$('#profileFirstName').value=current;
  app.$('#profileStatus').textContent='';
  app.$('#profilePopup').classList.remove('hidden');
  app.resetPopupScroll('#profilePopup');
};

app.closeProfilePopup = function closeProfilePopup(){
  const popup=app.$('#profilePopup');
  if(popup) popup.classList.add('hidden');
};

app.saveMyProfile = async function saveMyProfile(){
  const firstName=app.$('#profileFirstName').value.trim();
  const status=app.$('#profileStatus');
  if(!firstName){status.textContent='Renseigne ton prénom.';status.className='authStatus cloudErr';return}
  status.textContent='Enregistrement…';status.className='authStatus';
  const {error}=await app.db.rpc('set_my_first_name',{p_first_name:firstName});
  if(error)throw error;
  app.groupState.profiles[app.currentUser.id]=firstName;
  status.textContent='Profil enregistré ✓';status.className='authStatus cloudOk';
  app.closeProfilePopup();
};

app.ensureMyProfile = async function ensureMyProfile(){
  if(!app.currentUser)return;
  const id=app.currentUser.id;
  const p=await app.getMyProfile();
  if(app.currentUser?.id!==id)return;
  if(p?.first_name){
    app.groupState.profiles[app.currentUser.id]=p.first_name;
    return;
  }
  app.openProfilePopup();
};

app.refreshAdminAccess = async function refreshAdminAccess(){
  if(!app.currentUser){
    app.adminState.isAdmin=false;
    app.$('#openAdminModule')?.classList.add('hidden');
    return false;
  }
  const id=app.currentUser.id;
  const {data,error}=await app.db.rpc('is_app_admin');
  if(error)throw error;
  if(app.currentUser?.id!==id)return false;
  app.adminState.isAdmin=!!data;
  app.$('#openAdminModule')?.classList.toggle('hidden',!app.adminState.isAdmin);
  return app.adminState.isAdmin;
};

app.fetchAdminGroups = async function fetchAdminGroups(){
  if(!app.adminState.isAdmin)throw new Error('Accès administrateur requis.');
  const {data,error}=await app.db.rpc('admin_list_groups');
  if(error)throw error;
  app.adminState.groups=data||[];
  return app.adminState.groups;
};

app.renderAdminGroups = function renderAdminGroups(){
  const box=app.$('#adminGroupsList');
  const status=app.$('#adminGroupsStatus');
  if(!box||!status)return;
  const groups=app.adminState.groups||[];
  status.textContent=`${groups.length} groupe${groups.length>1?'s':''}`;
  box.innerHTML='';
  if(!groups.length){
    box.innerHTML='<div class="small">Aucun groupe créé.</div>';
    return;
  }
  groups.forEach(g=>{
    const card=document.createElement('div');
    card.className='adminGroupCard';
    const coaches=Array.isArray(g.coaches)?g.coaches:[];
    const coachRows=coaches.map(c=>{
      const display=(c.first_name||c.email||'Entraîneur');
      const role=c.role==='owner'?'Créateur':'Entraîneur';
      const email=c.email&&c.email!==display?c.email:'';
      return `<div class="adminCoachRow">
        <div class="adminCoachName">${app.statsEscape(display)}</div>
        <div class="adminCoachMeta">${app.statsEscape(role)}${email?'<br>'+app.statsEscape(email):''}</div>
      </div>`;
    }).join('');
    card.innerHTML=`<div class="adminGroupTitle">${app.statsEscape(g.group_name||'Groupe')}</div>
      <div class="adminGroupClub">${app.statsEscape(g.club||'Club non renseigné')}</div>
      <div class="adminCoachList">${coachRows||'<div class="small">Aucun entraîneur associé.</div>'}</div>`;
    box.append(card);
  });
};

app.openAdminModule = async function openAdminModule(){
  if(!app.adminState.isAdmin){
    const ok=await app.refreshAdminAccess();
    if(!ok)return;
  }
  app.hideMainModules();
  app.setMatchHeaderMode(false);
  app.$('#adminHome').classList.remove('hidden');
  app.$('#adminGroupsStatus').textContent='Chargement…';
  app.$('#adminGroupsList').innerHTML='';
  await app.fetchAdminGroups();
  app.renderAdminGroups();
  window.scrollTo({top:0,behavior:'instant'});
};

app.formatDateShort = function formatDateShort(v){
  if(!v)return '';
  const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m)return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
  const d=new Date(v);
  if(Number.isNaN(d.getTime()))return String(v);
  return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'});
};

app.isoToFrInput = function isoToFrInput(v){
  if(!v)return '';
  const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m)return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
  return app.formatDateShort(v);
};

app.frInputToIso = function frInputToIso(v){
  const raw=String(v||'').trim();
  if(!raw)return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
  const m=raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
  if(!m)throw new Error('Date invalide. Utilise le format JJ/MM/AA.');
  const day=Number(m[1]),month=Number(m[2]);
  let year=Number(m[3]);
  if(m[3].length===2)year=2000+year;
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)
    throw new Error('Date invalide. Utilise le format JJ/MM/AA.');
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
};

app.normalizeFrDateField = function normalizeFrDateField(input){
  if(!input||!input.value.trim())return;
  try{input.value=app.isoToFrInput(app.frInputToIso(input.value))}
  catch(_){}
};

app.formatAuditDate = function formatAuditDate(v){
  if(!v)return '';
  const d=new Date(v);
  if(Number.isNaN(d.getTime()))return '';
  return d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
};

app.auditName = function auditName(userId){
  if(!userId)return 'inconnu';
  if(app.currentUser && userId===app.currentUser.id)return 'toi';
  return app.groupState.profiles[userId]||'un entraîneur';
};

app.normalizePlayerName = function normalizePlayerName(name){
  return (name||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,' ')
    .trim()
    .replace(/\s+/g,' ');
};

app.levenshtein = function levenshtein(a,b){
  a=app.normalizePlayerName(a);b=app.normalizePlayerName(b);
  if(a===b)return 0;
  const dp=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let prev=dp[0];dp[0]=i;
    for(let j=1;j<=b.length;j++){
      const tmp=dp[j];
      dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=tmp;
    }
  }
  return dp[b.length];
};

app.nearDuplicatePlayer = function nearDuplicatePlayer(name,players){
  const n=app.normalizePlayerName(name);
  if(!n)return null;
  const exact=(players||[]).find(p=>app.normalizePlayerName(p.display_name)===n);
  if(exact)return {type:'exact',player:exact};
  if(n.length<4)return null;
  let best=null;
  for(const p of players||[]){
    const pn=app.normalizePlayerName(p.display_name);
    const d=app.levenshtein(n,pn);
    const threshold=Math.max(n.length,pn.length)>=8?2:1;
    if(d<=threshold && (!best || d<best.distance))best={type:'near',player:p,distance:d};
  }
  return best;
};

app.fetchMyGroups = async function fetchMyGroups(){
  const id=app.currentUser?.id;
  const groups=await app.services.myGroups();
  if(app.currentUser?.id!==id)return [];
  app.groupState.groups=groups;
  app.populateGroupSelectors();
  return app.groupState.groups;
};

app.populateGroupSelectors = function populateGroupSelectors(){
  ['matchGroup','trainingGroup','historyGroup','statsGroup'].forEach(id=>{
    const sel=app.$('#'+id);if(!sel)return;
    const current=sel.value;
    sel.innerHTML='<option value="">— Choisir un groupe —</option>';
    app.groupState.groups.forEach(g=>{
      const o=document.createElement('option');o.value=g.id;o.textContent=g.club?`${g.name} · ${g.club}`:g.name;sel.append(o);
    });
    if([...sel.options].some(o=>o.value===current))sel.value=current;
  });
};

app.fetchGroupPlayers = async function fetchGroupPlayers(groupId){
  return app.services.groupPlayers(groupId);
};

app.fetchGroupSelections = async function fetchGroupSelections(groupId,{includeArchived=false}={}){
  return app.services.groupSelections(groupId,{includeArchived});
};

app.groupSelectionTypeLabel = function groupSelectionTypeLabel(type){return type==='competition'?'Compétition':type==='stage'?'Stage':'Autre'};

app.groupSelectionPeriodLabel = function groupSelectionPeriodLabel(selection){
  const fmt=v=>{if(!v)return'';const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:v};
  if(selection.starts_on&&selection.ends_on)return selection.starts_on===selection.ends_on?fmt(selection.starts_on):`${fmt(selection.starts_on)} → ${fmt(selection.ends_on)}`;
  return fmt(selection.starts_on||selection.ends_on)||'';
};

app.fillGroupSelectionSelect = function fillGroupSelectionSelect(select,selections,{selectedId='',allLabel='Tout le groupe'}={}){
  if(!select)return;
  select.innerHTML=`<option value="">${app.escapeHtml(allLabel)}</option>`;
  (selections||[]).filter(s=>!s.archived||s.id===selectedId).forEach(s=>{
    const o=document.createElement('option');
    o.value=s.id;
    o.textContent=s.archived?`${s.name} · archivée`:s.name;
    select.append(o);
  });
  select.value=(selectedId&&[...select.options].some(o=>o.value===selectedId))?selectedId:'';
};

app.openGroupsModule = async function openGroupsModule(){
  // Afficher immédiatement le module : le clic ne dépend plus d'un chargement réseau.
  app.restoreGroupDetailStandalone();
  app.groupState.currentGroupId=null;
  app.hideMainModules();
  app.setMatchHeaderMode(false);
  app.$('#groupsHome').classList.remove('hidden');
  window.scrollTo({top:0,behavior:'instant'});
  try{
    await app.fetchMyGroups();
    app.renderGroupsList();
  }catch(e){
    app.handleError('openGroupsModule',e);
    app.renderGroupsList();
  }
};

app.restoreGroupDetailStandalone = function restoreGroupDetailStandalone(){
  const detail=app.$('#groupDetail');
  const groupsHome=app.$('#groupsHome');
  if(!detail)return;
  if(groupsHome?.contains(detail))groupsHome.after(detail);
  detail.classList.remove('groupDetailEmbedded');
  detail.classList.add('hidden');
};

app.renderGroupsList = function renderGroupsList(){
  const box=app.$('#groupsList');if(!box)return;
  app.restoreGroupDetailStandalone();
  box.innerHTML='';
  if(!app.groupState.groups.length){
    box.innerHTML='<div class="small">Tu n’es encore entraîneur d’aucun groupe. Crée-en un ou rejoins-en un avec son code.</div>';return;
  }
  const single=app.groupState.groups.length===1;
  app.groupState.groups.forEach(g=>{
    const d=document.createElement('details');d.className='groupAccordion';
    const summary=document.createElement('summary');
    summary.innerHTML=`<span><span>${app.escapeHtml(g.name)}</span><div class="groupAccordionMeta">${app.escapeHtml(g.club||'Club non renseigné')} · ${g.role==='owner'?'Créateur':'Entraîneur'}</div></span>`;
    const body=document.createElement('div');body.className='groupAccordionBody';
    body.innerHTML='<div class="groupAccordionLoading small">Chargement du groupe…</div>';
    d.addEventListener('toggle',()=>{
      if(!d.open){
        if(app.groupState.currentGroupId===g.id){
          app.restoreGroupDetailStandalone();
          app.groupState.currentGroupId=null;
        }
        return;
      }
      box.querySelectorAll('.groupAccordion[open]').forEach(other=>{if(other!==d)other.open=false});
      app.openGroupDetail(g.id,{inlineBody:body}).catch(e=>app.handleError('openGroupDetail',e));
    });
    d.append(summary,body);box.append(d);
    if(single)d.open=true;
  });
};

app.openGroupDetail = async function openGroupDetail(groupId,{inlineBody=null}={}){
  try{
    let g=app.groupState.groups.find(x=>x.id===groupId);
    if(!g){
      await app.fetchMyGroups();
      g=app.groupState.groups.find(x=>x.id===groupId);
    }
    if(!g)return;

    // Dans la liste des groupes, le contenu complet est directement celui de l’accordéon.
    // Les autres appels conservent la vue autonome historique.
    app.groupState.currentGroupId=groupId;
    app.setMatchHeaderMode(false);
    const detail=app.$('#groupDetail');
    if(inlineBody){
      inlineBody.querySelector('.groupAccordionLoading')?.remove();
      inlineBody.append(detail);
      detail.classList.add('groupDetailEmbedded');
      detail.classList.remove('hidden');
    }else{
      app.restoreGroupDetailStandalone();
      app.hideMainModules();
      detail.classList.remove('hidden');
    }
    app.$('#groupDetailName').textContent=g.name;
    app.$('#groupDetailClub').textContent=g.club||'';
    app.$('#groupInviteCode').textContent=g.invite_code||'—';
    app.$('#editGroupNameBtn').classList.toggle('hidden',g.role!=='owner');
    app.$('#groupNameEditRow').classList.add('hidden');
    app.$('#groupNameEditInput').value=g.name||'';
    app.$('#groupNameEditStatus').textContent='Chargement…';
    if(app.$('#groupSelectionStatus')){app.$('#groupSelectionStatus').textContent='';app.$('#groupSelectionStatus').className='authStatus'}
    if(app.$('#groupSelectionName'))app.$('#groupSelectionName').value='';
    if(!inlineBody)window.scrollTo({top:0,behavior:'instant'});

    const [players,selections,playerAccessResult]=await Promise.all([
      app.fetchGroupPlayers(groupId),
      app.fetchGroupSelections(groupId,{includeArchived:true}),
      app.db.rpc('get_coaching_group_player_access',{p_group_id:groupId})
    ]);
    if(playerAccessResult.error)throw playerAccessResult.error;
    app.groupState.currentPlayers=players;
    app.groupState.currentSelections=selections;
    app.groupState.playerAccess=Object.fromEntries((playerAccessResult.data||[]).map(x=>[x.player_id,!!x.linked]));
    app.$('#groupNameEditStatus').textContent='';
    await app.refreshMessageNotifications('coach').catch(e=>app.handleError('message notifications',e));
    await app.refreshVideoNotifications().catch(e=>app.handleError('video notifications',e));
    app.renderGroupPlayers();
    app.renderGroupSelections();
    const {data:coaches,error}=await app.db.from('coaching_group_coaches').select('user_id,role,joined_at').eq('group_id',groupId).order('joined_at');
    if(error)throw error;
    await app.fetchProfiles((coaches||[]).map(c=>c.user_id));
    const cb=app.$('#groupCoachesList');cb.innerHTML='';
    const coachesStatus=app.$('#groupCoachesStatus');if(coachesStatus){coachesStatus.textContent='';coachesStatus.className='authStatus'}
    (coaches||[]).forEach((c,i)=>{
      const d=document.createElement('div');d.className='historyItem';
      const name=app.groupState.profiles[c.user_id]||`Entraîneur ${i+1}`;
      const row=document.createElement('div');row.className='row';row.style.alignItems='center';row.style.gap='8px';
      const info=document.createElement('div');info.style.flex='1';info.style.minWidth='0';
      info.innerHTML=`<strong>${app.escapeHtml(name)}</strong><div class="small">${c.role==='owner'?'Créateur du groupe':'Entraîneur'}${c.user_id===app.currentUser.id?' · toi':''}</div>`;
      row.append(info);
      if(g.role==='owner'&&c.role!=='owner'&&c.user_id!==app.currentUser.id){
        const remove=document.createElement('button');
        remove.type='button';remove.className='ghost';
        remove.style.color='#ff8d8d';
        remove.textContent='Retirer';
        remove.onclick=()=>app.removeCoachFromCurrentGroup(c.user_id,name);
        row.append(remove);
      }
      d.append(row);
      cb.append(d);
    });
  }catch(e){
    const st=app.$('#groupNameEditStatus');
    if(st){st.textContent='Une partie des données du groupe n’a pas pu être chargée.';st.className='authStatus cloudErr'}
    app.handleError('openGroupDetail',e);
  }
};

app.removeCoachFromCurrentGroup = async function removeCoachFromCurrentGroup(userId,displayName){
  const groupId=app.groupState.currentGroupId;
  const g=app.groupState.groups.find(x=>x.id===groupId);
  const status=app.$('#groupCoachesStatus');
  if(!groupId||!g||g.role!=='owner')return;
  if(!confirm(`Retirer ${displayName||'cet entraîneur'} du groupe « ${g.name} » ?\n\nIl n’aura plus accès aux matchs, entraînements et statistiques partagés de ce groupe.`))return;
  if(status){status.textContent='Suppression de l’entraîneur…';status.className='authStatus'}
  try{
    const {error}=await app.db.rpc('remove_coaching_group_coach',{p_group_id:groupId,p_user_id:userId});
    if(error)throw error;
    if(status){status.textContent='Entraîneur retiré du groupe ✓';status.className='authStatus cloudOk'}
    await app.openGroupDetail(groupId);
  }catch(e){
    if(status){status.textContent=e.message||'Impossible de retirer cet entraîneur.';status.className='authStatus cloudErr'}
    app.handleError('remove group coach',e);
  }
};

app.renderGroupPlayers = function renderGroupPlayers(){
  const box=app.$('#groupPlayersList');if(!box)return;box.innerHTML='';if(!app.groupState.currentPlayers.length){box.innerHTML='<div class="small">Aucun joueur dans ce groupe.</div>';return}
  const roleLabel={R:'Rapproché (R)',A:'Ailier (A)',P:'Pointe (P)',AP:'A ou P'};
  const group=app.groupState.groups.find(x=>x.id===app.groupState.currentGroupId);
  const canRemove=group?.role==='owner';
  app.groupState.currentPlayers.forEach(p=>{
    const d=document.createElement('div');d.className='historyItem';
    const row=document.createElement('div');row.className='row';row.style.alignItems='center';row.style.gap='8px';
    const notif=app.messageNotificationFor(app.groupState.currentGroupId,p.id);const unread=Number(notif?.unread_count||0);
    const videoUnread=app.videoNotificationCountFor(app.groupState.currentGroupId,p.id);
    const statsAccessLabel=p.stats_access==='group'?' · Stats groupe en lecture seule':'';
    const open=document.createElement('button');open.type='button';open.className='ghost groupPlayerOpen';
    open.style.cssText='flex:1;min-width:140px;text-align:left;white-space:normal;padding:7px 10px';
    open.innerHTML=`<strong>${app.escapeHtml(p.display_name)}${unread?`<span class="groupPlayerUnread">💬 ${unread} nouveau${unread>1?'x':''}</span>`:''}${videoUnread?`<span class="videoUnreadBadge">📹 ${videoUnread}</span>`:''}</strong><div class="small">${app.escapeHtml(roleLabel[p.preferred_role||'AP'])} · ${app.groupState.playerAccess?.[p.id]?'Compte joueur lié':'Accès joueur non encore activé'}${statsAccessLabel}</div>`;
    open.setAttribute('aria-label',`Ouvrir le suivi de ${p.display_name}`);
    open.onclick=()=>app.openGroupPlayerFollowup(p.id).catch(e=>app.handleError('open player followup',e));
    row.append(open);
    if(canRemove){
      const rename=document.createElement('button');rename.type='button';rename.className='ghost';rename.textContent='Renommer';
      rename.title='Modifier le nom affiché du joueur sans changer son historique';
      rename.onclick=()=>app.renamePlayerInCurrentGroup(p.id,p.display_name);
      const remove=document.createElement('button');remove.type='button';remove.className='ghost dangerAction';remove.textContent='Retirer du groupe';
      remove.title='Retire le joueur de cet effectif sans supprimer son historique';
      remove.onclick=()=>app.removePlayerFromCurrentGroup(p.id,p.display_name);
      row.append(rename,remove);
    }
    d.append(row);box.append(d);
  })
};

app.renderGroupSelections = function renderGroupSelections(){
  const box=app.$('#groupSelectionsList');if(!box)return;
  box.innerHTML='';
  const rows=app.groupState.currentSelections||[];
  if(!rows.length){box.innerHTML='<div class="small">Aucune sélection pour ce groupe. Les sélections servent à définir un sous-effectif sans dupliquer les joueurs.</div>';return}
  rows.forEach(selection=>{
    const details=document.createElement('details');details.className='groupSelectionCard';
    if(selection.archived)details.classList.add('archived');
    const period=app.groupSelectionPeriodLabel(selection);
    const summary=document.createElement('summary');
    summary.innerHTML=`<span><strong>${app.escapeHtml(selection.name)}</strong><span class="groupSelectionMeta">${app.escapeHtml(app.groupSelectionTypeLabel(selection.selection_type))}${period?' · '+app.escapeHtml(period):''} · ${selection.player_ids.length} joueur${selection.player_ids.length>1?'s':''}${selection.archived?' · archivée':''}</span></span><span class="groupSelectionChevron">⌄</span>`;
    const body=document.createElement('div');body.className='groupSelectionBody';
    body.innerHTML=`<div class="row groupSelectionEditFields">
      <div class="field" style="flex:2 1 220px"><label>Nom</label><input data-selection-name maxlength="100" value="${app.escapeHtml(selection.name)}"></div>
      <div class="field" style="flex:1 1 150px"><label>Type</label><select data-selection-type><option value="competition">Compétition</option><option value="stage">Stage</option><option value="other">Autre</option></select></div>
      <div class="field" style="flex:1 1 150px"><label>Début</label><input data-selection-start type="date" value="${app.escapeHtml(selection.starts_on||'')}"></div>
      <div class="field" style="flex:1 1 150px"><label>Fin</label><input data-selection-end type="date" value="${app.escapeHtml(selection.ends_on||'')}"></div>
    </div>
    <div class="small" style="margin:10px 0 7px">Joueurs de cette sélection</div>
    <div class="groupSelectionRoster"></div>
    <div class="row groupSelectionActions"><button type="button" class="primary" data-selection-save>Enregistrer</button><button type="button" class="ghost" data-selection-archive>${selection.archived?'Réactiver':'Archiver'}</button><span class="small" data-selection-status></span></div>`;
    body.querySelector('[data-selection-type]').value=selection.selection_type||'competition';
    const roster=body.querySelector('.groupSelectionRoster');
    const selected=new Set(selection.player_ids||[]);
    (app.groupState.currentPlayers||[]).forEach(p=>{
      const label=document.createElement('label');label.className='check';
      const input=document.createElement('input');input.type='checkbox';input.value=p.id;input.checked=selected.has(p.id);
      label.append(input,document.createTextNode(p.display_name));roster.append(label);
    });
    body.querySelector('[data-selection-save]').onclick=()=>app.saveGroupSelection(selection.id,body).catch(e=>app.handleError('save group selection',e));
    body.querySelector('[data-selection-archive]').onclick=()=>app.toggleGroupSelectionArchive(selection.id,!selection.archived).catch(e=>app.handleError('archive group selection',e));
    details.append(summary,body);box.append(details);
  });
};

app.refreshCurrentGroupSelections = async function refreshCurrentGroupSelections(){
  if(!app.groupState.currentGroupId){app.groupState.currentSelections=[];return[]}
  app.groupState.currentSelections=await app.fetchGroupSelections(app.groupState.currentGroupId,{includeArchived:true});
  app.renderGroupSelections();
  return app.groupState.currentSelections;
};

app.createGroupSelection = async function createGroupSelection(){
  const groupId=app.groupState.currentGroupId,status=app.$('#groupSelectionStatus');
  if(!groupId)return;
  const name=(app.$('#groupSelectionName')?.value||'').trim();
  if(!name){if(status){status.textContent='Renseigne un nom de sélection.';status.className='authStatus cloudErr'}return}
  const payload={group_id:groupId,name,selection_type:app.$('#groupSelectionType')?.value||'competition',starts_on:app.$('#groupSelectionStart')?.value||null,ends_on:app.$('#groupSelectionEnd')?.value||null};
  if(payload.starts_on&&payload.ends_on&&payload.starts_on>payload.ends_on){if(status){status.textContent='La date de fin doit être postérieure à la date de début.';status.className='authStatus cloudErr'}return}
  try{
    if(status){status.textContent='Création…';status.className='authStatus'}
    const {error}=await app.db.from('coaching_group_selections').insert(payload);
    if(error)throw error;
    app.$('#groupSelectionName').value='';app.$('#groupSelectionType').value='competition';app.$('#groupSelectionStart').value='';app.$('#groupSelectionEnd').value='';
    if(status){status.textContent='Sélection créée ✓';status.className='authStatus cloudOk'}
    await app.refreshCurrentGroupSelections();app.setCloud('Synchronisé',true);
  }catch(e){if(status){status.textContent=e?.code==='23505'?'Une sélection porte déjà ce nom.':'Impossible de créer la sélection.';status.className='authStatus cloudErr'}throw e}
};

app.saveGroupSelection = async function saveGroupSelection(selectionId,body){
  const selection=(app.groupState.currentSelections||[]).find(s=>s.id===selectionId);if(!selection||!body)return;
  const status=body.querySelector('[data-selection-status]');
  const name=(body.querySelector('[data-selection-name]')?.value||'').trim();
  const type=body.querySelector('[data-selection-type]')?.value||'competition';
  const startsOn=body.querySelector('[data-selection-start]')?.value||null;
  const endsOn=body.querySelector('[data-selection-end]')?.value||null;
  if(!name){status.textContent='Le nom est obligatoire.';return}
  if(startsOn&&endsOn&&startsOn>endsOn){status.textContent='Dates incohérentes.';return}
  const wanted=new Set([...body.querySelectorAll('.groupSelectionRoster input:checked')].map(c=>c.value));
  const current=new Set(selection.player_ids||[]);
  const additions=[...wanted].filter(id=>!current.has(id));
  const removals=[...current].filter(id=>!wanted.has(id));
  status.textContent='Enregistrement…';
  const {error:updateError}=await app.db.from('coaching_group_selections').update({name,selection_type:type,starts_on:startsOn,ends_on:endsOn,updated_at:new Date().toISOString()}).eq('id',selectionId);
  if(updateError)throw updateError;
  if(additions.length){
    const {error}=await app.db.from('coaching_group_selection_players').insert(additions.map(player_id=>({selection_id:selectionId,group_id:selection.group_id,player_id})));
    if(error)throw error;
  }
  if(removals.length){
    const {error}=await app.db.from('coaching_group_selection_players').delete().eq('selection_id',selectionId).in('player_id',removals);
    if(error)throw error;
  }
  status.textContent='Sélection enregistrée ✓';
  await app.refreshCurrentGroupSelections();app.setCloud('Synchronisé',true);
};

app.toggleGroupSelectionArchive = async function toggleGroupSelectionArchive(selectionId,archived){
  const {error}=await app.db.from('coaching_group_selections').update({archived,updated_at:new Date().toISOString()}).eq('id',selectionId);
  if(error)throw error;
  await app.refreshCurrentGroupSelections();app.setCloud('Synchronisé',true);
};

app.renamePlayerInCurrentGroup = async function renamePlayerInCurrentGroup(playerId,currentName){
  const groupId=app.groupState.currentGroupId;
  const group=app.groupState.groups.find(x=>x.id===groupId);
  if(!groupId||!group||group.role!=='owner')return;

  const entered=prompt(`Nouveau nom pour ${currentName||'ce joueur'} :`,currentName||'');
  if(entered===null)return;
  const nextName=entered.trim().replace(/\s+/g,' ');
  if(!nextName){alert('Le nom du joueur ne peut pas être vide.');return}
  if(nextName===currentName)return;

  const others=(app.groupState.currentPlayers||[]).filter(p=>p.id!==playerId);
  const duplicate=app.nearDuplicatePlayer(nextName,others);
  if(duplicate?.type==='exact'){
    alert(`« ${nextName} » existe déjà dans ce groupe.`);
    return;
  }
  if(duplicate?.type==='near'){
    const ok=confirm(`« ${nextName} » ressemble beaucoup à « ${duplicate.player.display_name} » déjà présent dans ce groupe.

Confirmer malgré tout le changement de nom ?`);
    if(!ok)return;
  }

  try{
    app.setCloud('Enregistrement…',true);
    const {data,error}=await app.db.from('players')
      .update({display_name:nextName})
      .eq('id',playerId)
      .select('id,display_name')
      .single();
    if(error)throw error;
    if(!data?.id)throw new Error('Le nom du joueur n’a pas pu être modifié.');
    await app.openGroupDetail(groupId);
    app.setCloud('Synchronisé',true);
  }catch(e){
    app.setCloud('Erreur',false);
    app.handleError('rename group player',e);
  }
};

app.removePlayerFromCurrentGroup = async function removePlayerFromCurrentGroup(playerId,displayName){
  const groupId=app.groupState.currentGroupId;
  const group=app.groupState.groups.find(x=>x.id===groupId);
  if(!groupId||!group||group.role!=='owner')return;
  if(!confirm(`Retirer ${displayName||'ce joueur'} du groupe « ${group.name} » ?

La fiche joueur, les matchs, les séances et les statistiques déjà enregistrés seront conservés. Le joueur sera également retiré des sélections de ce groupe et son accès joueur à ce groupe sera désactivé.`))return;
  try{
    app.setCloud('Suppression…',true);
    const {data,error}=await app.db.from('coaching_group_players').delete().eq('group_id',groupId).eq('player_id',playerId).select('player_id');
    if(error)throw error;
    if(!Array.isArray(data)||!data.some(x=>x.player_id===playerId))throw new Error('Le joueur n’a pas pu être retiré du groupe.');
    app.groupState.currentPlayers=app.groupState.currentPlayers.filter(x=>x.id!==playerId);
    app.groupState.matchPlayers=app.groupState.matchPlayers.filter(x=>x.id!==playerId);
    if(app.groupState.playerAccess)delete app.groupState.playerAccess[playerId];
    app.renderGroupPlayers();
    await app.refreshCurrentGroupSelections();
    app.setCloud('Synchronisé',true);
  }catch(e){
    app.setCloud('Erreur',false);
    app.handleError('remove group player',e);
  }
};

app.coachMessageDate = function coachMessageDate(v){
  if(!v)return '';
  try{return new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return String(v)}
};

app.coachMessageHistoryHtml = function coachMessageHistoryHtml(rows,showAuthor=true){
  if(!rows?.length)return '<div class="small">Aucun message antérieur.</div>';
  return rows.map(r=>`<div class="coachMessageHistoryItem"><div class="coachMessageHistoryMeta">${app.escapeHtml(app.coachMessageDate(r.created_at))}${showAuthor&&r.author_name?` · ${app.escapeHtml(r.author_name)}`:''}</div><div class="coachMessageHistoryText">${app.escapeHtml(r.message||'')}</div></div>`).join('');
};

app.loadGroupPlayerMessageHistory = async function loadGroupPlayerMessageHistory(groupId,playerId,expectedToken){
  const box=app.$('#groupPlayerFollowupHistory');
  if(!box)return;
  box.innerHTML='<div class="small">Chargement…</div>';
  const {data,error}=await app.db.from('coaching_player_message_history').select('message,created_at,created_by').eq('group_id',groupId).eq('player_id',playerId).order('created_at',{ascending:false});
  if(error)throw error;
  await app.fetchProfiles((data||[]).map(x=>x.created_by));
  if(expectedToken!==undefined&&expectedToken!==app.groupPlayerFollowupState.loadToken)return;
  const rows=(data||[]).map(x=>({...x,author_name:x.created_by?(app.groupState.profiles[x.created_by]||'Entraîneur'):'Entraîneur'}));
  box.innerHTML=app.coachMessageHistoryHtml(rows,true);
};

app.loadMyPlayerMessageHistory = async function loadMyPlayerMessageHistory(groupId){
  const box=app.$('#playerPortalMessageHistory');
  const wrap=app.$('#playerPortalMessageHistoryWrap');
  if(!box||!groupId)return;
  box.innerHTML='<div class="small">Chargement…</div>';
  try{
    const {data,error}=await app.db.rpc('get_my_player_message_history',{p_group_id:groupId});
    if(error)throw error;
    box.innerHTML=app.coachMessageHistoryHtml(data||[],true);
    if(wrap)wrap.classList.toggle('hidden',!(data||[]).length);
  }catch(e){
    box.innerHTML='<div class="small">Impossible de charger l’historique.</div>';
    app.handleError('load player message history',e);
  }
};

app.openStaffPlayerPortal = async function openStaffPlayerPortal(playerId){
  const groupId=app.groupState.currentGroupId;
  const p=app.groupState.currentPlayers.find(x=>x.id===playerId);
  const g=app.groupState.groups.find(x=>x.id===groupId);
  if(!groupId||!p||!g)return;
  app.playerPortalState.staffPreview=true;
  app.playerPortalState.staffPlayerId=playerId;
  app.playerPortalState.staffReturnGroupId=groupId;
  const previewAccess=[{group_id:groupId,group_name:g.name,player_id:p.id,player_name:p.display_name,preferred_role:p.preferred_role||'AP',stats_access:p.stats_access||'personal'}];
  await app.openPlayerPortal(previewAccess);
};

app.followupRouteHash = function followupRouteHash(view){
  return view==='messages'?'#player-follow-up-messages':view==='access'?'#player-follow-up-access':'#player-follow-up';
};

app.followupRouteViewFromHash = function followupRouteViewFromHash(hash){
  if(hash==='#player-follow-up-messages')return'messages';
  if(hash==='#player-follow-up-access')return'access';
  if(hash==='#player-follow-up')return'followup';
  return null;
};

app.buildGroupPlayerFollowupUrl = function buildGroupPlayerFollowupUrl(groupId,playerId,view){
  const u=new URL(location.href);
  u.search='';
  u.searchParams.set('staff_group',groupId);
  u.searchParams.set('staff_player',playerId);
  u.hash=app.followupRouteHash(view);
  return u.pathname+u.search+u.hash;
};

app.pushGroupPlayerFollowupHistory = function pushGroupPlayerFollowupHistory(groupId,playerId,view,{replace=false}={}){
  const state={kc:'group-followup',groupId,playerId,view};
  const url=app.buildGroupPlayerFollowupUrl(groupId,playerId,view);
  if(replace)history.replaceState(state,'',url);
  else history.pushState(state,'',url);
};

app.setGroupPlayerFollowupView = function setGroupPlayerFollowupView(view,{history:updateHistory=true}={}){
  const target=['followup','messages','access'].includes(view)?view:'followup';
  const root=app.$('#groupPlayerFollowup');
  if(!root)return;
  root.querySelectorAll('[data-followup-tab]').forEach(btn=>{
    const active=btn.dataset.followupTab===target;
    btn.classList.toggle('active',active);
    if(active)btn.setAttribute('aria-current','page');
    else btn.removeAttribute('aria-current');
  });
  app.$('#groupPlayerFollowupPanelFollowup')?.classList.toggle('hidden',target!=='followup');
  app.$('#groupPlayerFollowupPanelMessages')?.classList.toggle('hidden',target!=='messages');
  app.$('#groupPlayerFollowupPanelAccess')?.classList.toggle('hidden',target!=='access');
  app.$('#groupPlayerFollowupPanelUnavailable')?.classList.add('hidden');
  app.groupPlayerFollowupState.activeView=target;
  const {groupId,playerId}=app.groupPlayerFollowupState;
  if(target==='messages'&&groupId&&playerId){
    const box=app.$('#groupPlayerFollowupConversationList');
    const loaded=box&&box.dataset.loaded==='1'&&box.dataset.conversationKey===`${groupId}:${playerId}:coach`;
    if(loaded)box.scrollTop=box.scrollHeight;
    else app.loadGroupPlayerFollowupConversation({initial:true,forceBottom:true})
      .catch(e=>app.handleError('load followup conversation',e));
  }
  if(updateHistory&&groupId&&playerId){
    app.pushGroupPlayerFollowupHistory(groupId,playerId,target);
  }
};

app.renderGroupPlayerFollowupLastExchange = function renderGroupPlayerFollowupLastExchange(rows){
  const box=app.$('#groupPlayerFollowupLastExchange');
  if(!box)return;
  const list=rows||[];
  const last=list[list.length-1];
  if(!last){box.innerHTML='<div class="small">Aucun échange pour le moment.</div>';return}
  const who=(last.sender_role||'coach')==='player'?(last.author_name||'Le joueur'):(last.author_name||'Entraîneur');
  box.innerHTML=`<div class="coachMessageHistoryItem"><div class="coachMessageHistoryMeta">${app.escapeHtml(app.coachMessageDate(last.created_at))} · ${app.escapeHtml(who)}</div><div class="coachMessageHistoryText">${app.escapeHtml(last.message||'')}</div></div>`;
};

app.loadGroupPlayerFollowupConversation = async function loadGroupPlayerFollowupConversation({initial=false,forceBottom=false,token}={}){
  const {groupId,playerId}=app.groupPlayerFollowupState;
  const box=app.$('#groupPlayerFollowupConversationList');
  if(!groupId||!playerId||!box)return;
  try{
    const rows=await app.loadConversation({box,groupId,playerId,viewerRole:'coach',initial,forceBottom});
    if(token!==undefined&&token!==app.groupPlayerFollowupState.loadToken)return;
    app.renderGroupPlayerFollowupLastExchange(rows||[]);
  }catch(e){
    if(token!==undefined&&token!==app.groupPlayerFollowupState.loadToken)return;
    box.innerHTML='<div class="playerPortalConversationEmpty">Conversation indisponible pour le moment.</div>';
    app.renderGroupPlayerFollowupLastExchange(null);
    throw e;
  }
};

app.sendGroupPlayerFollowupMessage = async function sendGroupPlayerFollowupMessage(){
  const {groupId,playerId}=app.groupPlayerFollowupState;
  const input=app.$('#groupPlayerFollowupConversationInput'),status=app.$('#groupPlayerFollowupConversationStatus'),button=app.$('#groupPlayerFollowupConversationSend');
  const message=(input?.value||'').trim();
  if(!groupId||!playerId||!message)return;
  if(button)button.disabled=true;if(status)status.textContent='Envoi…';
  try{
    const {error}=await app.db.rpc('send_player_conversation_message',{p_group_id:groupId,p_player_id:playerId,p_message:message,p_sender_role:'coach'});
    if(error)throw error;
    input.value='';
    if(status)status.textContent='Envoyé';
    await app.loadGroupPlayerFollowupConversation({forceBottom:true});
    await app.refreshMessageNotifications('coach');
    app.setCloud('Synchronisé',true);
    setTimeout(()=>{if(status)status.textContent=''},1200);
  }catch(e){
    if(status)status.textContent='Erreur';
    app.handleError('send group followup message',e);
  }finally{if(button)button.disabled=false}
};

app.showGroupPlayerFollowupUnavailable = function showGroupPlayerFollowupUnavailable(message){
  const root=app.$('#groupPlayerFollowup');
  if(!root)return;
  app.hideMainModules();
  app.setMatchHeaderMode(false);
  root.classList.remove('hidden');
  app.$('#groupPlayerFollowupTitle').textContent='Suivi joueur';
  app.$('#groupPlayerFollowupSubtitle').textContent='';
  app.$('#groupPlayerFollowupPanelFollowup')?.classList.add('hidden');
  app.$('#groupPlayerFollowupPanelMessages')?.classList.add('hidden');
  app.$('#groupPlayerFollowupPanelAccess')?.classList.add('hidden');
  let missing=app.$('#groupPlayerFollowupPanelUnavailable');
  if(!missing){
    missing=document.createElement('div');
    missing.className='followupView';
    missing.id='groupPlayerFollowupPanelUnavailable';
    missing.innerHTML='<div class="followupSection"><div class="small" id="groupPlayerFollowupUnavailableMessage"></div><div class="followupActions"><span class="small"></span><button type="button" class="ghost" id="groupPlayerFollowupUnavailableBack">← Retour aux groupes</button></div></div>';
    root.append(missing);
  }
  missing.classList.remove('hidden');
  const box=app.$('#groupPlayerFollowupUnavailableMessage');
  if(box)box.textContent=message||'Suivi joueur indisponible.';
  app.$('#groupPlayerFollowupUnavailableBack').onclick=()=>app.openGroupsModule().catch(e=>app.handleError('followup unavailable back',e));
};

app.leaveGroupPlayerFollowupPage = async function leaveGroupPlayerFollowupPage(){
  const st=app.groupPlayerFollowupState;
  const groupId=st.groupId;
  app.$('#groupPlayerFollowup')?.classList.add('hidden');
  st.loadToken=(st.loadToken||0)+1;
  if(groupId&&app.groupState.groups.some(g=>g.id===groupId)){
    await app.openGroupDetail(groupId);
    history.replaceState(null,'',app.page==='training'?'training.html':'index.html');
  }else{
    await app.openGroupsModule();
  }
};

app.returnFromGroupPlayerFollowup = function returnFromGroupPlayerFollowup(){
  const st=app.groupPlayerFollowupState;
  if(st.returnContext?.viaHistory){history.back();return}
  app.leaveGroupPlayerFollowupPage().catch(e=>app.handleError('return followup page',e));
};

app.followupRouteParams = function followupRouteParams(){
  const params=new URLSearchParams(location.search||'');
  return {groupId:params.get('staff_group'),playerId:params.get('staff_player'),view:app.followupRouteViewFromHash(location.hash||'')};
};

app.restoreGroupPlayerFollowupRoute = async function restoreGroupPlayerFollowupRoute({replace=false}={}){
  const {groupId,playerId,view}=app.followupRouteParams();
  if(!groupId||!playerId||!view)return false;
  return await app.openGroupPlayerFollowup(playerId,{groupId,view,replace,fromRoute:true});
};

app.resolveFollowupGroup = async function resolveFollowupGroup(groupId){
  let g=app.groupState.groups.find(x=>x.id===groupId);
  if(!g){
    try{await app.fetchMyGroups()}catch(e){app.handleError('fetch groups for followup',e)}
    g=app.groupState.groups.find(x=>x.id===groupId);
  }
  return g||null;
};

app.resolveFollowupPlayer = async function resolveFollowupPlayer(groupId,playerId){
  if(app.groupState.currentGroupId!==groupId){
    app.groupState.currentGroupId=groupId;
    app.groupState.currentPlayers=[];
  }
  let p=app.groupState.currentPlayers.find(x=>x.id===playerId);
  if(p)return p;
  try{
    const players=await app.fetchGroupPlayers(groupId);
    app.groupState.currentPlayers=players;
    if(!app.groupState.playerAccess){
      const access=await app.db.rpc('get_coaching_group_player_access',{p_group_id:groupId});
      if(!access.error)app.groupState.playerAccess=Object.fromEntries((access.data||[]).map(x=>[x.player_id,!!x.linked]));
    }
  }catch(e){app.handleError('fetch group players for followup',e)}
  return app.groupState.currentPlayers.find(x=>x.id===playerId)||null;
};

app.openGroupPlayerFollowup = async function openGroupPlayerFollowup(playerId,options={}){
  const groupId=options.groupId||app.groupState.currentGroupId;
  if(!groupId||!playerId)return false;
  const g=await app.resolveFollowupGroup(groupId);
  if(!g){app.showGroupPlayerFollowupUnavailable('Ce groupe n’est pas accessible avec ton compte.');return false}
  const p=await app.resolveFollowupPlayer(groupId,playerId);
  if(!p){app.showGroupPlayerFollowupUnavailable('Ce joueur n’est pas accessible dans ce groupe.');return false}

  const token=(app.groupPlayerFollowupState.loadToken||0)+1;
  app.groupPlayerFollowupState.loadToken=token;
  app.groupPlayerFollowupState.groupId=groupId;
  app.groupPlayerFollowupState.playerId=playerId;
  app.groupPlayerFollowupState.returnContext=options.returnContext||{viaHistory:options.fromRoute!==true};

  const title=app.$('#groupPlayerFollowupTitle');
  if(title)title.textContent=`Suivi joueur · ${p.display_name}`;
  const groupLabel=app.$('#groupPlayerFollowupSubtitle');
  if(groupLabel)groupLabel.textContent=g.name||'';
  app.$('#groupPlayerFollowupRole').value=p.preferred_role||'AP';
  app.$('#groupPlayerFollowupStatsAccess').value=p.stats_access||'personal';
  const linked=!!app.groupState.playerAccess?.[playerId];
  app.$('#groupPlayerFollowupAccessStatus').textContent=linked?'Compte joueur lié':'Accès joueur non encore activé';
  app.$('#groupPlayerFollowupUnlink').classList.toggle('hidden',!linked);
  app.$('#groupPlayerFollowupObjectiveNew').value='';
  app.$('#groupPlayerFollowupStatus').textContent='Chargement…';
  app.$('#groupPlayerFollowupAccessSaveStatus').textContent='';
  app.$('#groupPlayerFollowupMessageStatus').textContent='';
  const messageInput=app.$('#groupPlayerFollowupMessage');
  if(messageInput){messageInput.value='';messageInput.dataset.currentMessage=''}
  const historyBox=app.$('#groupPlayerFollowupHistory');
  if(historyBox)historyBox.innerHTML='<div class="small">Chargement…</div>';
  const lastExchange=app.$('#groupPlayerFollowupLastExchange');
  if(lastExchange)lastExchange.innerHTML='<div class="small">Chargement…</div>';
  const videoLink=app.$('#groupPlayerFollowupVideosLink');
  if(videoLink){
    const source=app.page==='training'?'training':'index';
    videoLink.setAttribute('href',`videos.html?group=${encodeURIComponent(groupId)}&player=${encodeURIComponent(playerId)}&from=player-follow-up&source=${source}`);
  }
  app.hideMainModules();
  app.setMatchHeaderMode(false);
  const section=app.$('#groupPlayerFollowup');
  if(section)section.classList.remove('hidden');
  const view=options.view||app.followupRouteViewFromHash(location.hash);
  app.setGroupPlayerFollowupView(view,{history:false});
  if(!options.fromRoute)app.pushGroupPlayerFollowupHistory(groupId,playerId,view);
  window.scrollTo({top:0,behavior:'instant'});

  const isCurrent=()=>token===app.groupPlayerFollowupState.loadToken;
  const messageTask=app.db.from('coaching_player_messages').select('message,updated_at').eq('group_id',groupId).eq('player_id',playerId).maybeSingle()
    .then(({data,error})=>{if(error)throw error;if(!isCurrent())return;const mi=app.$('#groupPlayerFollowupMessage');if(mi){mi.value=data?.message||'';mi.dataset.currentMessage=data?.message||''}});
  const results=await Promise.allSettled([
    app.reloadGroupPlayerFollowupObjectives(groupId,playerId,token),
    app.loadGroupPlayerMessageHistory(groupId,playerId,token),
    app.loadGroupPlayerFollowupConversation({initial:true,forceBottom:true,token}),
    messageTask
  ]);
  if(!isCurrent())return false;
  app.$('#groupPlayerFollowupStatus').textContent=results.some(r=>r.status==='rejected')?'Certaines informations n’ont pas pu être chargées.':'';
  results.forEach(r=>{if(r.status==='rejected')app.handleError('load group player followup',r.reason)});
  return true;
};

app.saveGroupPlayerFollowup = async function saveGroupPlayerFollowup(){
  const groupId=app.groupPlayerFollowupState.groupId,playerId=app.groupPlayerFollowupState.playerId;
  if(!groupId||!playerId)return;
  const role=app.$('#groupPlayerFollowupRole').value||'AP';
  const statsAccess=app.$('#groupPlayerFollowupStatsAccess').value==='group'?'group':'personal';
  const status=app.$('#groupPlayerFollowupAccessSaveStatus');
  const save=app.$('#saveGroupPlayerFollowup');
  if(save)save.disabled=true;if(status)status.textContent='Enregistrement…';
  try{
    const {error}=await app.db.from('coaching_group_players').update({preferred_role:role,stats_access:statsAccess}).eq('group_id',groupId).eq('player_id',playerId);
    if(error)throw error;
    const p=app.groupState.currentPlayers.find(x=>x.id===playerId);if(p){p.preferred_role=role;p.stats_access=statsAccess}
    if(status)status.textContent='Droits joueur enregistrés ✓';
    app.renderGroupPlayers();
    app.setCloud('Synchronisé',true);
  }catch(e){
    if(status)status.textContent='Erreur lors de l’enregistrement.';
    app.handleError('save group player followup',e);
  }finally{if(save)save.disabled=false}
};

app.saveGroupPlayerFollowupMessage = async function saveGroupPlayerFollowupMessage(){
  const groupId=app.groupPlayerFollowupState.groupId,playerId=app.groupPlayerFollowupState.playerId;
  const messageInput=app.$('#groupPlayerFollowupMessage');
  const status=app.$('#groupPlayerFollowupMessageStatus');
  const save=app.$('#saveGroupPlayerFollowupMessage');
  if(!groupId||!playerId||!messageInput)return;
  const message=messageInput.value.trim();
  const previous=(messageInput.dataset.currentMessage||'').trim();
  if(save)save.disabled=true;if(status)status.textContent='Enregistrement…';
  try{
    const now=new Date().toISOString();
    const {error}=await app.db.from('coaching_player_messages').upsert({group_id:groupId,player_id:playerId,message,updated_by:app.currentUser?.id||null,updated_at:now},{onConflict:'group_id,player_id'});
    if(error)throw error;
    if(message&&message!==previous){
      const {error:historyError}=await app.db.from('coaching_player_message_history').insert({group_id:groupId,player_id:playerId,message,created_by:app.currentUser?.id||null,created_at:now});
      if(historyError)throw historyError;
    }
    messageInput.dataset.currentMessage=message;
    await app.loadGroupPlayerMessageHistory(groupId,playerId);
    if(status)status.textContent='Message enregistré ✓';
    app.setCloud('Synchronisé',true);
  }catch(e){
    if(status)status.textContent='Erreur lors de l’enregistrement.';
    app.handleError('save group player message',e);
  }finally{if(save)save.disabled=false}
};

app.createSharedPlayerAccessLink = async function createSharedPlayerAccessLink(){if(!app.groupState.currentGroupId)return;const button=app.$('#groupPlayerSharedLink'),status=app.$('#groupPlayerSharedLinkStatus');const old=button?.textContent;if(button){button.disabled=true;button.textContent='Création…'}if(status)status.textContent='';try{const {data,error}=await app.db.rpc('create_coaching_player_group_invite',{p_group_id:app.groupState.currentGroupId});if(error)throw error;const token=data?.[0]?.token;if(!token)throw new Error('Lien non généré');const u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('player_group_invite',token);const link=u.toString();let copied=false;try{await navigator.clipboard.writeText(link);copied=true}catch{}if(status)status.textContent=copied?'Lien commun copié.':'Lien commun créé.';prompt(`${copied?'Lien copié dans le presse-papiers. ':''}Transmets ce même lien à tous les joueurs du groupe. Chacun sélectionnera son prénom avant de créer ou connecter son compte.`,link)}catch(e){app.handleError('create shared player access link',e);if(status)status.textContent='Erreur lors de la création du lien.'}finally{if(button){button.disabled=false;button.textContent=old}}};

app.unlinkPlayerAccount = async function unlinkPlayerAccount(playerId,playerName){if(!app.groupState.currentGroupId||!playerId)return;if(!confirm(`Délier le compte joueur de ${playerName} ?\n\nLe joueur pourra ensuite réactiver son accès avec le lien commun du groupe.`))return;try{const {error}=await app.db.rpc('unlink_coaching_player_account',{p_group_id:app.groupState.currentGroupId,p_player_id:playerId});if(error)throw error;app.groupState.playerAccess[playerId]=false;app.renderGroupPlayers();if(app.groupPlayerFollowupState.playerId===playerId){app.$('#groupPlayerFollowupAccessStatus').textContent='Accès joueur non encore activé';app.$('#groupPlayerFollowupUnlink').classList.add('hidden')}app.setCloud('Synchronisé',true)}catch(e){app.handleError('unlink player account',e)}};

app.updateGroupPlayerPreference = async function updateGroupPlayerPreference(playerId,preferredRole){
  if(!app.groupState.currentGroupId)return;
  try{
    const {error}=await app.db.from('coaching_group_players')
      .update({preferred_role:preferredRole})
      .eq('group_id',app.groupState.currentGroupId)
      .eq('player_id',playerId);
    if(error)throw error;
    const p=app.groupState.currentPlayers.find(x=>x.id===playerId);
    if(p)p.preferred_role=preferredRole;
    const mp=app.groupState.matchPlayers.find(x=>x.id===playerId);
    if(mp)mp.preferred_role=preferredRole;
    const name=Object.entries(app.state.playerIds||{}).find(([,id])=>id===playerId)?.[0];
    if(name){
      app.state.playerRolePreferences ||= {};
      app.state.playerRolePreferences[name]=preferredRole;
}
    app.setCloud('Synchronisé',true);
  }catch(e){app.handleError('update player preferred role',e)}
};

app.addPlayersToCurrentGroup = async function addPlayersToCurrentGroup(){
  const names=app.$('#groupAddPlayers').value.split(',').map(x=>x.trim()).filter(Boolean);
  const preferredRole='AP';
  if(!names.length||!app.groupState.currentGroupId)return;

  const accepted=[];
  for(const name of names){
    const duplicate=app.nearDuplicatePlayer(name,[...app.groupState.currentPlayers,...accepted.map(display_name=>({display_name}))]);
    if(duplicate?.type==='exact'){
      alert(`« ${name} » existe déjà dans ce groupe sous le nom « ${duplicate.player.display_name} ». Il ne sera pas ajouté.`);
      continue;
    }
    if(duplicate?.type==='near'){
      const ok=confirm(`Le joueur « ${name} » ressemble beaucoup à « ${duplicate.player.display_name} » déjà présent dans le groupe.\n\nCréer quand même un nouveau joueur ?`);
      if(!ok)continue;
    }

    const {data:p,error:pe}=await app.db.from('players')
      .insert({workspace_id:app.state.workspaceId,display_name:name})
      .select('id,display_name').single();
    if(pe)throw pe;

    const {error:ge}=await app.db.from('coaching_group_players')
      .insert({group_id:app.groupState.currentGroupId,player_id:p.id,preferred_role:preferredRole});
    if(ge)throw ge;

    accepted.push(name);
    app.groupState.currentPlayers.push({...p,preferred_role:preferredRole});
  }

  app.$('#groupAddPlayers').value='';
  await app.openGroupDetail(app.groupState.currentGroupId);
};

app.createGroup = async function createGroup(){
  const status=app.$('#createGroupStatus'),name=app.$('#newGroupName').value.trim(),club=app.$('#newGroupClub').value.trim();
  if(!name){status.textContent='Renseigne le nom du groupe.';status.className='authStatus cloudErr';return}
  status.textContent='Création…';status.className='authStatus';
  const {data,error}=await app.db.rpc('create_coaching_group',{p_name:name,p_club:club||null});
  if(error)throw error;
  status.textContent='Groupe créé ✓';status.className='authStatus cloudOk';
  app.$('#newGroupName').value='';app.$('#newGroupClub').value='';
  await app.fetchMyGroups();app.renderGroupsList();
  if(data)await app.openGroupDetail(data);
};

app.joinGroup = async function joinGroup(){
  const status=app.$('#joinGroupStatus'),code=app.$('#joinGroupCode').value.trim();
  if(!code){status.textContent='Renseigne le code d’invitation.';status.className='authStatus cloudErr';return}
  status.textContent='Connexion au groupe…';status.className='authStatus';
  const {data,error}=await app.db.rpc('join_coaching_group',{p_invite_code:code});
  if(error)throw error;
  status.textContent='Groupe rejoint ✓';status.className='authStatus cloudOk';
  app.$('#joinGroupCode').value='';
  await app.fetchMyGroups();app.renderGroupsList();
  if(data)await app.openGroupDetail(data);
};

app.loadMatchSelectionOptions = async function loadMatchSelectionOptions(groupId,selectedId=''){
  const select=app.$('#matchSelection');
  app.groupState.matchSelections=groupId?await app.fetchGroupSelections(groupId,{includeArchived:true}):[];
  app.fillGroupSelectionSelect(select,app.groupState.matchSelections,{selectedId,allLabel:'Tout le groupe'});
  if(select)select.disabled=!groupId||!app.groupState.matchSelections.some(s=>!s.archived||s.id===selectedId);
  return app.groupState.matchSelections;
};

app.loadMatchGroupPlayers = async function loadMatchGroupPlayers(groupId,selectionId=app.$('#matchSelection')?.value||''){
  const allPlayers=await app.fetchGroupPlayers(groupId);
  const selection=selectionId?(app.groupState.matchSelections||[]).find(s=>s.id===selectionId):null;
  const allowed=selection?new Set(selection.player_ids||[]):null;
  app.groupState.matchPlayers=allowed?allPlayers.filter(p=>allowed.has(p.id)):allPlayers;
  app.state.playerRolePreferences=Object.fromEntries(app.groupState.matchPlayers.map(p=>[p.display_name,p.preferred_role||'AP']));
  const box=app.$('#rosterChecks');box.innerHTML='';
  app.groupState.matchPlayers.forEach((p,i)=>{
    const l=document.createElement('label');l.className='check';
    const c=document.createElement('input');c.type='checkbox';c.value=p.id;c.dataset.name=p.display_name;c.checked=i<4;
    c.onchange=app.updateStartButton;
    l.append(c,document.createTextNode(p.display_name));box.append(l);
  });
  app.$('#rosterWrap').classList.toggle('hidden',app.groupState.matchPlayers.length<1);
  if(selection){
    app.$('#matchGroupHint').textContent=app.groupState.matchPlayers.length>=4?`Sélection « ${selection.name} » · ${app.groupState.matchPlayers.length} joueurs disponibles.`:`La sélection « ${selection.name} » ne contient que ${app.groupState.matchPlayers.length} joueur(s).`;
  }else{
    app.$('#matchGroupHint').textContent=app.groupState.matchPlayers.length>=4?`Effectif complet du groupe · ${app.groupState.matchPlayers.length} joueurs disponibles.`:`Ce groupe ne contient que ${app.groupState.matchPlayers.length} joueur(s). Ajoute au moins 4 joueurs dans Groupes.`;
  }
  app.updateStartButton();
};
app.saveCurrentGroupName = async function saveCurrentGroupName(){
  const groupId=app.groupState.currentGroupId;
  const g=app.groupState.groups.find(x=>x.id===groupId);
  if(!groupId||!g||g.role!=='owner')return;
  const input=app.$('#groupNameEditInput');
  const status=app.$('#groupNameEditStatus');
  const name=(input?.value||'').trim();
  if(!name){
    status.textContent='Le nom du groupe ne peut pas être vide.';
    status.className='authStatus cloudErr';
    return;
  }
  if(name===g.name){
    app.$('#groupNameEditRow').classList.add('hidden');
    if(app.page==='index')app.$('#editGroupNameBtn').classList.remove('hidden');
    status.textContent='';
    return;
  }
  try{
    status.textContent='Enregistrement…';
    status.className='authStatus';
    const {error}=await app.db.from('coaching_groups')
      .update({name})
      .eq('id',groupId);
    if(error)throw error;

    g.name=name;
    app.$('#groupDetailName').textContent=name;
    app.$('#groupNameEditRow').classList.add('hidden');
    if(app.page==='index')app.$('#editGroupNameBtn').classList.remove('hidden');
    status.textContent='Nom du groupe mis à jour ✓';
    status.className='authStatus cloudOk';
    app.populateGroupSelectors();
    app.renderGroupsList();
    app.setCloud('Synchronisé',true);
  }catch(e){
    status.textContent='Impossible de modifier le nom du groupe.';
    status.className='authStatus cloudErr';
    app.handleError('update group name',e);
  }
};
})(window.KinballCoach.app);

/* match-library. Shared explicit application context; no startup side effects. */
((app) => {
app.hideMainModules = function hideMainModules(){
  ['settingsHome','adminHome','appHome','setup','live','matchLibrary','matchAnalysisSelect','matchReadOnly','matchAnalysis','groupsHome','groupDetail','groupPlayerFollowup','trainingHome','trainingSession','trainingDuplicate','exerciseLibrary','trainingHistory','statsHome','playerPortal'].forEach(id=>app.$('#'+id)?.classList.add('hidden'));
  app.$('#footer')?.classList.add('hidden');
  app.$('#newMatchTop').classList.add('hidden');
};

app.showAppHome = function showAppHome(){
  app.hideMainModules();
  app.setMatchHeaderMode(false);
  app.$('#appHome').classList.remove('hidden');
  app.setCloud('Synchronisé',true);
  window.scrollTo({top:0,behavior:'instant'});
};

app.fetchMatchLibrary = async function fetchMatchLibrary(){
  if(!app.groupState.groups.length)await app.fetchMyGroups();
  await app.fetchMatchTypes();
  const groupIds=app.groupState.groups.map(g=>g.id);
  if(!groupIds.length){app.matchLibraryState.matches=[];return}
  const {data,error}=await app.db.from('matches')
    .select('id,label,played_on,status,group_id,selection_id,match_type_id,created_at,updated_at,created_by,updated_by,match_type:match_types!matches_match_type_id_fkey(name,active),selection:coaching_group_selections!matches_selection_group_fkey(name),group:coaching_groups!matches_group_id_fkey(name),followed_team:teams!matches_team_id_fkey(name),opponent1:teams!matches_opponent_team_1_id_fkey(name),opponent2:teams!matches_opponent_team_2_id_fkey(name),match_events(count)')
    .in('group_id',groupIds)
    .order('played_on',{ascending:false})
    .order('created_at',{ascending:false});
  if(error)throw error;
  app.matchLibraryState.matches=data||[];
  await app.fetchProfiles(app.matchLibraryState.matches.flatMap(m=>[m.created_by,m.updated_by]));
};

app.populateMatchLibraryFilters = function populateMatchLibraryFilters(){
  const gs=app.$('#matchLibraryGroup');if(gs){
    const current=gs.value;gs.innerHTML='<option value="">Tous les groupes</option>';
    app.groupState.groups.forEach(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.name;gs.append(o)});
    if([...gs.options].some(o=>o.value===current))gs.value=current;
  }
  app.populateMatchTypeSelect(app.$('#matchLibraryType'),{all:true,selected:app.$('#matchLibraryType')?.value||''});
};

app.matchActionCount = function matchActionCount(m){
  const x=Array.isArray(m.match_events)?m.match_events[0]?.count:0;
  return Number(x||0);
};

app.renderMatchLibrary = function renderMatchLibrary(){
  const list=app.$('#matchLibraryList');if(!list)return;
  const q=(app.$('#matchLibrarySearch')?.value||'').trim().toLowerCase();
  const gid=app.$('#matchLibraryGroup')?.value||'';
  const tid=app.$('#matchLibraryType')?.value||'';
  const rows=app.matchLibraryState.matches.filter(m=>{
    if(gid&&m.group_id!==gid)return false;
    if(tid&&m.match_type_id!==tid)return false;
    const hay=[m.label,m.group?.name,m.followed_team?.name,m.opponent1?.name,m.opponent2?.name,m.match_type?.name].filter(Boolean).join(' ').toLowerCase();
    return !q||hay.includes(q);
  });
  app.$('#matchLibraryCount').textContent=`${rows.length} match${rows.length>1?'s':''} affiché${rows.length>1?'s':''} sur ${app.matchLibraryState.matches.length}`;
  list.innerHTML='';
  if(!rows.length){list.innerHTML='<div class="small">Aucun match ne correspond à ces critères.</div>';return}
  rows.forEach(m=>{
    const card=document.createElement('div');card.className='matchLibraryCard';
    const opponents=[m.opponent1?.name,m.opponent2?.name].filter(Boolean).join(' / ');
    const type=m.match_type?.name||'Sans type';
    const n=app.matchActionCount(m);
    const videoBadge=m.capture_mode==='video'&&m.youtube_url?' · 🎥 vidéo':'';
    card.innerHTML=`<div class="matchLibraryMain">
      <div class="matchLibraryInfo">
        <div class="matchLibraryTitle">${app.statsEscape(app.formatDateShort(m.played_on)||'Date ?')} · ${app.statsEscape(m.label)}</div>
        <div class="matchLibraryMeta">${app.statsEscape(type)}${m.match_type&&!m.match_type.active?'<span class="matchTypeArchived">archivé</span>':''} · ${app.statsEscape(m.group?.name||m.followed_team?.name||'Groupe')}${m.selection?.name?' · Sélection '+app.statsEscape(m.selection.name):''}${opponents?' · vs '+app.statsEscape(opponents):''}${videoBadge} · ${n} action${n>1?'s':''}</div>
      </div>
      <div class="matchLibraryActions">
        <button class="primary" data-analyze="${m.id}">Analyser</button>
        <button class="ghost" data-consult="${m.id}">Consulter</button>
        <button class="ghost" data-edit-meta="${m.id}">Modifier infos</button>
        <button class="ghost" data-resume="${m.id}">Reprendre</button>
        <button class="ghost" data-delete="${m.id}">Supprimer</button>
      </div>
    </div>`;
    card.querySelector('[data-analyze]').onclick=()=>app.openMatchAnalysis(m.id).catch(e=>app.handleError('analyse match',e));
    card.querySelector('[data-consult]').onclick=()=>app.openMatchReadOnly(m.id).catch(e=>app.handleError('consult match',e));
    card.querySelector('[data-edit-meta]').onclick=()=>app.openMatchMetaEditor(m.id).catch(e=>app.handleError('edit match meta',e));
    card.querySelector('[data-resume]').onclick=()=>app.loadMatch(m.id);
    card.querySelector('[data-delete]').onclick=async()=>{
      const deleted=await app.deleteSavedMatch(m.id);
      if(deleted)await app.openMatchLibrary();
    };
    list.append(card);
  });
};

app.openMatchLibrary = async function openMatchLibrary(options={}){
  const details=app.$('.matchLibraryDetails');
  if(details)details.setAttribute('open','');
  app.hideMainModules();app.setMatchHeaderMode(false);
  app.$('#matchLibrary').classList.remove('hidden');
  app.$('#matchLibraryList').innerHTML='<div class="small">Chargement…</div>';
  await app.fetchMyGroups();
  await app.fetchMatchLibrary();
  app.populateMatchLibraryFilters();
  app.renderMatchLibrary();
  window.scrollTo({top:0,behavior:'instant'});
};

app.setEditMatchCaptureMode = function setEditMatchCaptureMode(mode){
  app.editingMatchCaptureMode=mode==='video'?'video':'live';
  app.$$('#editMatchCaptureMode button').forEach(b=>b.classList.toggle('active',b.dataset.editCaptureMode===app.editingMatchCaptureMode));
  app.$('#editMatchYoutubeWrap')?.classList.toggle('hidden',app.editingMatchCaptureMode!=='video');
};

app.openMatchMetaEditor = async function openMatchMetaEditor(matchId){
  app.setCloud('Chargement…',true);
  await app.fetchMatchTypes();
  const {data:m,error}=await app.db.from('matches')
    .select('id,label,played_on,group_id,selection_id,match_type_id,opponent_team_1_id,opponent_team_2_id,capture_mode,youtube_url,opponent1:teams!matches_opponent_team_1_id_fkey(name),opponent2:teams!matches_opponent_team_2_id_fkey(name)')
    .eq('id',matchId).single();
  if(error)throw error;
  app.editingMatchMetaId=matchId;
  app.$('#editMatchName').value=m.label||'';
  app.$('#editMatchDate').value=app.isoToFrInput(m.played_on||app.today());
  app.populateMatchTypeSelect(app.$('#editMatchType'),{selected:m.match_type_id||'',includeArchivedId:m.match_type_id||null});
  const editSelections=m.group_id?await app.fetchGroupSelections(m.group_id,{includeArchived:true}):[];
  app.fillGroupSelectionSelect(app.$('#editMatchSelection'),editSelections,{selectedId:m.selection_id||'',allLabel:'Tout le groupe'});
  app.$('#editMatchOpponent1').value=m.opponent1?.name||'';
  app.$('#editMatchOpponent2').value=m.opponent2?.name||'';
  app.$('#editMatchYoutubeUrl').value=m.youtube_url||'';
  app.setEditMatchCaptureMode(m.capture_mode==='video'?'video':'live');
  app.$('#matchMetaPopup').classList.remove('hidden');
  app.setCloud('Synchronisé',true);
};

app.closeMatchMetaEditor = function closeMatchMetaEditor(){app.editingMatchMetaId=null;app.$('#matchMetaPopup')?.classList.add('hidden')};

app.saveMatchMetaEditor = async function saveMatchMetaEditor(){
  if(!app.editingMatchMetaId)return;
  const name=app.$('#editMatchName').value.trim()||'Match';
  const date=app.frInputToIso(app.$('#editMatchDate').value||app.isoToFrInput(app.today()));
  const typeId=app.$('#editMatchType').value||null;
  const selectionId=app.$('#editMatchSelection')?.value||null;
  const opp1=app.$('#editMatchOpponent1').value.trim();
  const opp2=app.$('#editMatchOpponent2').value.trim();
  const youtubeUrl=app.editingMatchCaptureMode==='video'?(app.$('#editMatchYoutubeUrl').value||'').trim():'';
  if(!opp1||!opp2){alert('Renseigne les deux équipes adverses.');return}
  if(opp1.toLowerCase()===opp2.toLowerCase()){alert('Les deux équipes adverses doivent être différentes.');return}
  if(app.editingMatchCaptureMode==='video'&&!app.matchYoutubeId(youtubeUrl)){alert('Renseigne une URL YouTube valide pour le mode vidéo.');return}
  try{
    app.setCloud('Enregistrement…',true);
    const [opp1Id,opp2Id]=await Promise.all([app.ensureTeam(opp1),app.ensureTeam(opp2)]);
    const {error}=await app.db.from('matches').update({label:name,played_on:date,match_type_id:typeId,selection_id:selectionId,opponent_team_1_id:opp1Id,opponent_team_2_id:opp2Id,capture_mode:app.editingMatchCaptureMode,youtube_url:youtubeUrl||null}).eq('id',app.editingMatchMetaId);
    if(error)throw error;
    app.closeMatchMetaEditor();
    await app.fetchMatchLibrary();app.populateMatchLibraryFilters();app.renderMatchLibrary();app.setCloud('Synchronisé',true);
  }catch(e){app.handleError('save match meta',e);app.setCloud('Erreur',false)}
};

app.openMatchReadOnly = async function openMatchReadOnly(matchId){
  const {data:m,error:me}=await app.db.from('matches')
    .select('id,label,played_on,group_id,selection_id,match_type_id,team_id,created_at,updated_at,created_by,updated_by,match_type:match_types!matches_match_type_id_fkey(name),selection:coaching_group_selections!matches_selection_group_fkey(name),group:coaching_groups!matches_group_id_fkey(name),followed_team:teams!matches_team_id_fkey(name),opponent1:teams!matches_opponent_team_1_id_fkey(name),opponent2:teams!matches_opponent_team_2_id_fkey(name)')
    .eq('id',matchId).single();
  if(me)throw me;
  const [{data:events,error:ee},{data:mp,error:pe}]=await Promise.all([
    app.db.from('match_events').select('*').eq('match_id',matchId).order('sequence_no',{ascending:true}),
    app.db.from('match_players').select('player_id,players!match_players_player_id_fkey(display_name)').eq('match_id',matchId)
  ]);
  if(ee)throw ee;if(pe)throw pe;
  const ids=(events||[]).map(e=>e.id);
  let attributions=[],lineups=[];
  if(ids.length){
    const [a,l]=await Promise.all([
      app.db.from('match_event_attributions').select('event_id,player_id,players!match_event_attributions_player_id_fkey(display_name)').in('event_id',ids),
      app.db.from('match_event_lineup').select('event_id,player_id,players!match_event_lineup_player_id_fkey(display_name)').in('event_id',ids)
    ]);
    if(a.error)throw a.error;if(l.error)throw l.error;
    attributions=a.data||[];lineups=l.data||[];
  }
  const attMap={},lineMap={};
  attributions.forEach(x=>{const n=x.players?.display_name;if(n)(attMap[x.event_id]??=[]).push(n)});
  lineups.forEach(x=>{const n=x.players?.display_name;if(n)(lineMap[x.event_id]??=[]).push(n)});
  const teamIds=[m.team_id,m.opponent1?.id,m.opponent2?.id].filter(Boolean);
  const opponents={};
  const playerIds=[...new Set((events||[]).map(e=>e.player_id).filter(Boolean))];
  let playerMap={};
  if(playerIds.length){
    const {data,error}=await app.db.from('players').select('id,display_name').in('id',playerIds);
    if(error)throw error;playerMap=Object.fromEntries((data||[]).map(p=>[p.id,p.display_name]));
  }
  app.$('#matchReadTitle').textContent=m.label;
  const opp=[m.opponent1?.name,m.opponent2?.name].filter(Boolean).join(' / ');
  app.$('#matchReadMeta').textContent=`${app.formatDateShort(m.played_on)} · ${m.match_type?.name||'Sans type'} · ${m.group?.name||m.followed_team?.name||'Groupe'}${m.selection?.name?' · Sélection '+m.selection.name:''}${opp?' · vs '+opp:''}`;
  app.$('#matchReadPlayers').textContent=(mp||[]).map(x=>x.players?.display_name).filter(Boolean).join(' · ')||'—';
  const box=app.$('#matchReadTimeline');box.innerHTML='';
  if(!(events||[]).length)box.innerHTML='<div class="small">Aucune prise de note.</div>';
  (events||[]).forEach(e=>{
    const action=e.action_type==='attaque'?'Attaque':e.action_type==='defense'?'Défense':'Faute';
    const result=action==='Faute'?(e.fault_type||'Faute'):`${action} · ${e.result||''}`;
    const attr=(attMap[e.id]||[]).join(', ')||(e.player_id?playerMap[e.player_id]:'')||'Collectif/non spécifié';
    const d=document.createElement('div');d.className='item';
    d.innerHTML=`<div class="time">${app.escapeHtml(e.video_position||'')}<br>${app.escapeHtml(e.period||'')}</div><div><strong>${app.escapeHtml(result)}</strong><div class="small">${app.escapeHtml(app.eventContext(e.family,e.restart_location))}${e.zone?' · '+app.escapeHtml(({E1:'A1',E2:'P',E3:'A2'}[e.zone]||e.zone)):''}${e.movement!=null?' · déplacement '+(e.movement?'oui':'non'):''} · ${app.escapeHtml(attr)}</div></div>`;
    const edit=document.createElement('button');
    edit.className='ghost';
    edit.textContent='Modifier';
    edit.onclick=async evt=>{
      evt.stopPropagation();
      await app.loadMatch(matchId);
      if(app.state.currentMatchId===matchId)app.editEvent(e.id);
    };
    d.append(edit);
    box.append(d);
  });
  app.matchLibraryState.currentReadId=matchId;
  app.hideMainModules();app.setMatchHeaderMode(false);app.$('#matchReadOnly').classList.remove('hidden');
  window.scrollTo({top:0,behavior:'instant'});
};

app.openGroupAnalysisSelector = async function openGroupAnalysisSelector(){
  if(!app.groupState.groups.length)await app.fetchMyGroups();
  await app.fetchMatchLibrary();
  app.hideMainModules();app.setMatchHeaderMode(false);app.$('#matchAnalysisSelect').classList.remove('hidden');
  app.groupAnalysisState.selected=new Set();
  const gs=app.$('#groupAnalysisGroup');gs.innerHTML='<option value="">Tous les groupes</option>';
  app.groupState.groups.forEach(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.name;gs.append(o)});
  const ts=app.$('#groupAnalysisType');ts.innerHTML='<option value="">— Sélection manuelle —</option>';
  app.matchTypeState.types.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.name+(t.active?'':' · archivé');ts.append(o)});
  app.renderGroupAnalysisMatches();window.scrollTo({top:0,behavior:'instant'});
};

app.groupAnalysisVisibleMatches = function groupAnalysisVisibleMatches(){
  const gid=app.$('#groupAnalysisGroup')?.value||'',tid=app.$('#groupAnalysisType')?.value||'';
  return (app.matchLibraryState.matches||[]).filter(m=>(!gid||m.group_id===gid)&&(!tid||m.match_type_id===tid));
};

app.renderGroupAnalysisMatches = function renderGroupAnalysisMatches(){
  const box=app.$('#groupAnalysisMatchList'),visible=app.groupAnalysisVisibleMatches();box.innerHTML='';
  visible.forEach(m=>{
    const opponents=[m.opponent1?.name,m.opponent2?.name].filter(Boolean).join(' / ');
    const label=document.createElement('label');label.className='analysisMatchChoice';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=app.groupAnalysisState.selected.has(m.id);cb.value=m.id;
    cb.onchange=()=>{cb.checked?app.groupAnalysisState.selected.add(m.id):app.groupAnalysisState.selected.delete(m.id);app.updateGroupAnalysisSelectionStatus()};
    const main=document.createElement('div');main.className='analysisMatchChoiceMain';
    const title=document.createElement('div');title.className='analysisMatchChoiceTitle';title.textContent=`${app.formatDateShort(m.played_on)||'Date ?'} · ${m.label||'Match'}`;
    const meta=document.createElement('div');meta.className='analysisMatchChoiceMeta';meta.textContent=[m.match_type?.name||'Sans type',m.group?.name||m.followed_team?.name||'Groupe',opponents?'vs '+opponents:'',`${app.matchActionCount(m)} action${app.matchActionCount(m)>1?'s':''}`].filter(Boolean).join(' · ');
    main.append(title,meta);label.append(cb,main);box.append(label);
  });
  if(!visible.length)box.innerHTML='<div class="analysisEmpty">Aucun match ne correspond à ces filtres.</div>';
  app.updateGroupAnalysisSelectionStatus();
};

app.updateGroupAnalysisSelectionStatus = function updateGroupAnalysisSelectionStatus(){
  const n=app.groupAnalysisState.selected.size;
  const visible=app.groupAnalysisVisibleMatches().length;
  app.$('#groupAnalysisStatus').textContent=`${n} match${n>1?'s':''} sélectionné${n>1?'s':''} · ${visible} affiché${visible>1?'s':''}`;
  const b=app.$('#groupAnalysisRun');b.disabled=n===0;b.textContent=n?`Analyser ${n} match${n>1?'s':''}`:'Analyser la sélection';
};

app.autoSelectGroupAnalysisType = function autoSelectGroupAnalysisType(){
  const tid=app.$('#groupAnalysisType').value,gid=app.$('#groupAnalysisGroup').value||'';
  if(!tid){app.renderGroupAnalysisMatches();return}
  app.groupAnalysisState.selected=new Set((app.matchLibraryState.matches||[]).filter(m=>m.match_type_id===tid&&(!gid||m.group_id===gid)).map(m=>m.id));
  app.renderGroupAnalysisMatches();
};

app.runGroupedAnalysis = async function runGroupedAnalysis(){const ids=[...app.groupAnalysisState.selected];if(ids.length)await app.openMatchAnalysisIds(ids)};
app.setMatchHeaderMode = isMatch => {if(app.page==='index')app.$('#count')?.classList.add('hidden');else app.$('#count')?.classList.toggle('hidden',!isMatch)};
})(window.KinballCoach.app);

/* match-capture. Shared explicit application context; no startup side effects. */
((app) => {
app.buildChecks = function buildChecks(){
  const r=app.roster(), box=app.$('#rosterChecks'); box.innerHTML='';
  if(r.length<4){
    app.$('#rosterWrap').classList.add('hidden');
    app.updateStartButton();
    alert('Renseigne au moins 4 joueurs distincts dans l’effectif.');
    return;
  }
  r.forEach((p,i)=>{
    const l=document.createElement('label');l.className='check';
    const c=document.createElement('input');c.type='checkbox';c.value=p;c.checked=i<4;
    c.onchange=app.updateStartButton;
    l.append(c,document.createTextNode(p));box.append(l)
  });
  app.$('#rosterWrap').classList.remove('hidden');
  app.updateStartButton();
};

app.renderPlayers = function renderPlayers(){
  const b=app.$('#activePlayers');b.innerHTML='';
  app.state.activePlayers.forEach(p=>{
    const x=document.createElement('button');x.className='on';x.textContent=p;b.append(x)
  });
  const a=app.$('#allPlayers');a.innerHTML='';
  app.state.players.forEach(p=>{
    const active=app.state.activePlayers.includes(p),x=document.createElement('button');
    x.className=active?'on':'off';x.textContent=(active?'✓ ':'')+p;
    x.onclick=()=>{
      app.state.activePlayers=active?app.state.activePlayers.filter(y=>y!==p):[...app.state.activePlayers,p];
      app.renderPlayers();
    };
    a.append(x)
  });
  app.renderDefenseRoleSetup();
};

app.migrateDefenseRoleMap = function migrateDefenseRoleMap(map){
  if(!map)return map;
  if(map.A1||map.P||map.A2)return map;
  if(map.E1||map.E2||map.E3){
    return {R:map.R||'',A1:map.E1||'',P:map.E2||'',A2:map.E3||''};
  }
  return map;
};

app.currentDefensePeriod = function currentDefensePeriod(){
  return app.$('#period')?.value||app.$('#startPeriod')?.value||'P1';
};

app.validDefensePlayers = function validDefensePlayers(){
  return [...app.state.activePlayers].slice(0,4);
};

app.preferredRoleForPlayer = function preferredRoleForPlayer(name){
  return app.state.playerRolePreferences?.[name]||'AP';
};

app.buildPreferredDefenseRoleMap = function buildPreferredDefenseRoleMap(players){
  const map={R:'',A1:'',P:'',A2:''};
  const remaining=players.map(name=>({name,pref:app.preferredRoleForPlayer(name)}));
  const take=(slot,predicate)=>{
    if(map[slot])return false;
    const i=remaining.findIndex(predicate);
    if(i<0)return false;
    map[slot]=remaining.splice(i,1)[0].name;
    return true;
  };
  const takeWing=predicate=>{
    const slot=!map.A1?'A1':(!map.A2?'A2':null);
    return slot?take(slot,predicate):false;
  };

  take('R',x=>x.pref==='R');
  take('P',x=>x.pref==='P');
  while((!map.A1||!map.A2) && remaining.some(x=>x.pref==='A')) takeWing(x=>x.pref==='A');

  while(remaining.some(x=>x.pref==='AP') && (!map.P||!map.A1||!map.A2)){
    if(!map.P) take('P',x=>x.pref==='AP');
    else takeWing(x=>x.pref==='AP');
  }

  while(remaining.some(x=>x.pref==='P') && (!map.A1||!map.A2)) takeWing(x=>x.pref==='P');
  if(!map.P) take('P',x=>x.pref==='A');
  if(!map.P) take('P',x=>x.pref==='R');
  while(remaining.some(x=>x.pref==='A') && (!map.A1||!map.A2)) takeWing(x=>x.pref==='A');
  while(remaining.some(x=>x.pref==='R') && (!map.A1||!map.A2)) takeWing(x=>x.pref==='R');

  const free=['R','P','A1','A2'].filter(slot=>!map[slot]);
  const leftovers=[...remaining].sort(()=>Math.random()-.5);
  free.forEach((slot,i)=>{map[slot]=leftovers[i]?.name||''});
  return map;
};

app.defenseRoleMap = function defenseRoleMap(period=app.currentDefensePeriod()){
  app.state.defenseRolesByPeriod ||= {};
  const players=app.validDefensePlayers();
  let map=app.migrateDefenseRoleMap(app.state.defenseRolesByPeriod[period]);
  if(map)app.state.defenseRolesByPeriod[period]=map;
  const validMap=map && app.DEFENSE_ROLES.every(r=>players.includes(map[r])) && new Set(app.DEFENSE_ROLES.map(r=>map[r])).size===4;
  if(!validMap){
    const n=parseInt(String(period).replace(/\D/g,''),10);
    const prevRaw=Number.isFinite(n)&&n>1?app.state.defenseRolesByPeriod['P'+(n-1)]:null;
    const prev=app.migrateDefenseRoleMap(prevRaw);
    if(prevRaw&&prev)app.state.defenseRolesByPeriod['P'+(n-1)]=prev;
    const prevValid=prev && app.DEFENSE_ROLES.every(r=>players.includes(prev[r])) && new Set(app.DEFENSE_ROLES.map(r=>prev[r])).size===4;
    map=prevValid?{...prev}:app.buildPreferredDefenseRoleMap(players);
    app.state.defenseRolesByPeriod[period]=map;
    app.saveLocal();
  }
  return map;
};

app.roleForPlayer = function roleForPlayer(name,period=app.currentDefensePeriod()){
  const map=app.defenseRoleMap(period);
  return app.DEFENSE_ROLES.find(r=>map[r]===name)||'';
};

app.swapDefenseRole = function swapDefenseRole(role,newPlayer){
  const map={...app.defenseRoleMap()};
  const oldPlayer=map[role];
  const otherRole=app.DEFENSE_ROLES.find(r=>r!==role&&map[r]===newPlayer);
  map[role]=newPlayer;
  if(otherRole)map[otherRole]=oldPlayer;
  app.state.defenseRolesByPeriod[app.currentDefensePeriod()]=map;
  app.saveLocal();
  app.renderDefenseRoleSetup();
  app.refreshCenterDefenseMapLabels();
};

app.renderDefenseRoleSetup = function renderDefenseRoleSetup(){
  const panel=app.$('#defenseRolesPanel');
  if(!panel)return;
  const players=app.validDefensePlayers();
  const hint=app.$('#defenseRoleHint');
  const ids={R:'#defRoleR',A1:'#defRoleA1',P:'#defRoleP',A2:'#defRoleA2'};
  if(players.length!==4){
    app.DEFENSE_ROLES.forEach(r=>{const sel=app.$(ids[r]);if(sel){sel.innerHTML='<option>—</option>';sel.disabled=true}});
    if(hint)hint.textContent='Il faut exactement 4 joueurs en jeu pour configurer R, A1, P et A2.';
    return;
  }
  const map=app.defenseRoleMap();
  app.DEFENSE_ROLES.forEach(role=>{
    const sel=app.$(ids[role]);if(!sel)return;
    sel.disabled=false;sel.innerHTML='';
    players.forEach(p=>{
      const o=document.createElement('option');o.value=p;o.textContent=p;sel.append(o);
    });
    sel.value=map[role];
    sel.onchange=()=>app.swapDefenseRole(role,sel.value);
  });
  if(hint)hint.textContent=`${app.currentDefensePeriod()} · R = ${map.R} · A1 = ${map.A1} · P = ${map.P} · A2 = ${map.A2}`;
  app.refreshCenterDefenseMapLabels();
};

app.isCenterDefense = function isCenterDefense(){
  return app.family==='centre'&&app.actionType==='Défense';
};

app.isCenterAttack = function isCenterAttack(){
  return app.family==='centre'&&app.actionType==='Attaque';
};

app.isCenterDiagram = function isCenterDiagram(){
  return app.family==='centre'&&(app.actionType==='Attaque'||app.actionType==='Défense');
};

app.populateDefenseRoleSelects = function populateDefenseRoleSelects(prefix){
  const players=app.validDefensePlayers();
  const map=app.defenseRoleMap();
  app.DEFENSE_ROLES.forEach(role=>{
    const sel=app.$(`#${prefix}${role}`);
    if(!sel)return;
    const current=map[role]||'';
    sel.innerHTML='';
    players.forEach(p=>{
      const o=document.createElement('option');
      o.value=p;o.textContent=p;sel.append(o);
    });
    if(players.includes(current))sel.value=current;
    sel.onchange=()=>{
      app.swapDefenseRole(role,sel.value);
      app.populateDefenseRoleSelects(prefix);
      if(app.isCenterDefense()){
        app.syncCenterDefenseSectorFromEvent();
        app.renderCenterDefenseResponsibility();
      }
    };
  });
};

app.refreshCenterDefenseMapLabels = function refreshCenterDefenseMapLabels(){
  const editor=app.$('.centerDefenseRoleEditor');
  const hint=app.$('#centerGestureHintText');
  if(hint)hint.innerHTML=app.isCenterAttack()
    ? 'Zone : <strong>1 tap = ballon défendu</strong> · <strong>2 taps / appui long = point marqué</strong> · Ballon : <strong>1 tap = faute offensive</strong>.'
    : 'Zone : <strong>1 tap = défendu</strong> · <strong>2 taps / appui long = échappé</strong> · Ballon : <strong>1 tap = défensive illégale</strong>.';
  if(app.isCenterAttack()){
    if(editor)editor.classList.add('hidden');
    const labels={R:'R',A1:'A',P:'P',A2:'A'};
    const ids={R:'#centerMapRoleR',A1:'#centerMapRoleA1',P:'#centerMapRoleP',A2:'#centerMapRoleA2'};
    Object.entries(ids).forEach(([role,sel])=>{const el=app.$(sel);if(el)el.textContent=labels[role]});
    return;
  }
  if(editor)editor.classList.remove('hidden');
  const map=app.defenseRoleMap();
  const ids={R:'#centerMapRoleR',A1:'#centerMapRoleA1',P:'#centerMapRoleP',A2:'#centerMapRoleA2'};
  app.DEFENSE_ROLES.forEach(role=>{
    const el=app.$(ids[role]);
    if(el)el.textContent=map[role]||role;
  });
  app.populateDefenseRoleSelects('popupDefRole');
};

app.renderCenterDefenseResponsibility = function renderCenterDefenseResponsibility(){
  const box=app.$('#whoOptions');
  if(!box)return;
  box.innerHTML='';
  const map=app.defenseRoleMap();
  app.DEFENSE_ROLES.forEach(role=>{
    const p=map[role];
    if(!p)return;
    const b=document.createElement('button');
    b.dataset.who=p;b.dataset.role=role;
    b.textContent=`${role} · ${p}`;
    box.append(b);
  });
  app.$$('#whoOptions button').forEach(b=>{
    const name=b.dataset.who||'';
    b.classList.toggle('choice',app.whoMany.includes(name));
    b.onclick=()=>{
      app.whoMany=app.whoMany.includes(name)?app.whoMany.filter(x=>x!==name):[...app.whoMany,name];
      app.$$('#whoOptions button').forEach(x=>{
        const n=x.dataset.who||'';
        x.classList.toggle('choice',app.whoMany.includes(n));
      });
    };
  });
};

app.clearCenterDefenseSectorSelection = function clearCenterDefenseSectorSelection(){
  app.zone='';
  app.$$('#centerDefenseMap .sector').forEach(x=>x.classList.remove('selected'));
  app.whoMany=[];
  if(app.isCenterDefense())app.renderCenterDefenseResponsibility();
};

app.selectCenterDefenseSector = function selectCenterDefenseSector(el){
  const map=app.defenseRoleMap();
  app.zone=el.dataset.zone||'';
  const roles=(el.dataset.roles||'').split(',').filter(Boolean);
  app.whoMany=roles.map(r=>map[r]).filter(Boolean);
  app.$$('#centerDefenseMap .sector').forEach(x=>x.classList.toggle('selected',x===el));
  app.renderCenterDefenseResponsibility();
};

app.selectCenterAttackSector = function selectCenterAttackSector(el){
  app.zone=el.dataset.zone||'';
  app.$$('#centerDefenseMap .sector').forEach(x=>x.classList.toggle('selected',x===el));
};

app.applyCenterAttackGesture = function applyCenterAttackGesture(el,result){
  app.selectCenterAttackSector(el);
  app.actionResult=result;
  app.pending=`Attaque · ${result}`;
  app.faultType='';
  app.movement=app.movement||'Non';
  app.$$('#resultOptions button').forEach(b=>b.classList.toggle('choice',b.dataset.result===result));
  app.$('#moveStep').classList.remove('hidden');
  app.$('#whoStep').classList.remove('hidden');
  app.configureWhoUI();
  app.updatePopupSaveVisibility();
};

app.applyCenterDiagramGesture = function applyCenterDiagramGesture(el,longGesture=false){
  if(app.isCenterAttack()){
    app.applyCenterAttackGesture(el,longGesture?'Point marqué':'Ballon défendu');
  }else if(app.isCenterDefense()){
    app.applyCenterDefenseGesture(el,longGesture?'Échappé':'Ballon défendu');
  }
};

app.applyCenterDefenseGesture = function applyCenterDefenseGesture(el,result){
  app.selectCenterDefenseSector(el);
  app.actionResult=result;
  app.pending=`Défense · ${result}`;
  app.faultType='';
  app.movement=app.movement||'Non';
  app.$$('#resultOptions button').forEach(b=>b.classList.toggle('choice',b.dataset.result===result));
  app.$('#moveStep').classList.remove('hidden');
  app.$('#whoStep').classList.remove('hidden');
  app.renderCenterDefenseResponsibility();
  app.updatePopupSaveVisibility();
};

app.applyCenterDefenseIllegal = function applyCenterDefenseIllegal(){
  if(!app.isCenterDefense())return;
  const button=app.$('#resultOptions button[data-result="Défensive illégale"]');
  if(!button)return;
  app.actionResult='Défensive illégale';
  app.pending='Faute';
  app.faultType='Défensive illégale';
  app.zone='';
  app.movement='Non';
  const map=app.defenseRoleMap();
  app.whoMany=map.R?[map.R]:[];
  app.$$('#centerDefenseMap .sector').forEach(x=>x.classList.remove('selected'));
  app.$$('#resultOptions button').forEach(x=>x.classList.toggle('choice',x===button));
  // The map must remain visible: only clear its selected sector.
  app.$('#centerDefenseMapStep').classList.remove('hidden');
  app.$('#zoneStep').classList.add('hidden');
  app.$('#moveStep').classList.add('hidden');
  app.$('#whoStep').classList.remove('hidden');
  app.configureWhoUI();
  app.updatePopupSaveVisibility();
};

app.syncCenterDefenseSectorFromEvent = function syncCenterDefenseSectorFromEvent(){
  app.$$('#centerDefenseMap .sector').forEach(x=>x.classList.remove('selected'));
  if(!app.zone)return;
  if(app.isCenterAttack()){
    app.$$('#centerDefenseMap .sector').find(el=>el.dataset.zone===app.zone)?.classList.add('selected');
    return;
  }
  const map=app.defenseRoleMap();
  const selected=new Set(app.whoMany);
  let candidate=app.$$('#centerDefenseMap .sector').find(el=>{
    if(el.dataset.zone!==app.zone)return false;
    const names=(el.dataset.roles||'').split(',').filter(Boolean).map(r=>map[r]).filter(Boolean);
    return names.length===selected.size&&names.every(n=>selected.has(n));
  });
  if(!candidate)candidate=app.$$('#centerDefenseMap .sector').find(el=>el.dataset.zone===app.zone);
  candidate?.classList.add('selected');
};

app.configureWhoUI = function configureWhoUI(){
  if(app.isCenterDefense()){
    app.$('#whoOptions').classList.remove('attackAttributionLayout');
    app.$('#whoTitle').textContent='Responsabilité — modifiable';
    app.renderCenterDefenseResponsibility();
  }else{
    app.buildWho('#whoOptions');
    app.$('#whoOptions').classList.toggle('attackAttributionLayout',['Attaque','Défense'].includes(app.actionType));
    const requiresAttackPlayer=app.attackOutcomeRequiresPlayer();
    app.$('#whoTitle').textContent=app.actionType==='Attaque'?'Frappeur — facultatif':(app.isCenterAttack()?'Attaquant':(app.actionType==='Défense'?'Attribution — plusieurs joueurs possibles':'Attribution — facultatif'));
    app.$$('#whoOptions button').forEach(b=>{
      const name=b.dataset.who||'';
      b.classList.toggle('choice',app.actionType==='Défense'?app.whoMany.includes(name):name===app.who);
      b.onclick=()=>{
        if(app.actionType==='Défense'){
          app.whoMany=app.whoMany.includes(name)?app.whoMany.filter(x=>x!==name):[...app.whoMany,name];
          b.classList.toggle('choice',app.whoMany.includes(name));
        }else{
          app.who=(app.who===name?'':name);
          app.$$('#whoOptions button').forEach(x=>x.classList.remove('choice'));
          if(app.who)b.classList.add('choice');
        }
        app.updatePopupSaveVisibility();
      };
    });
  }
};

app.configureZoneUI = function configureZoneUI(show=true){
  // Les diagrammes de terrain ne sont plus utilisés : on conserve uniquement
  // les boutons de zone, y compris pour le jeu au centre et lors d'une édition.
  app.$('#centerDefenseMapStep').classList.add('hidden');
  app.$('#zoneStep').classList.toggle('hidden',!show||app.family==='gel');
};

app.buildWho = function buildWho(boxId){
  const box=app.$(boxId);box.innerHTML='';
  app.state.activePlayers.forEach(p=>{
    const b=document.createElement('button');b.dataset.who=p;b.textContent=p;box.append(b)
  });
};

app.ensureTeam = async function ensureTeam(name){
  const {data:found,error}=await app.db
    .from('teams').select('id,name')
    .eq('workspace_id',app.state.workspaceId).eq('name',name).limit(1);
  if(error) throw error;
  if(found&&found.length) return found[0].id;
  const {data,error:ie}=await app.db
    .from('teams').insert({workspace_id:app.state.workspaceId,name}).select('id').single();
  if(ie) throw ie;
  return data.id;
};

app.ensurePlayers = async function ensurePlayers(names){
  const {data:existing,error}=await app.db
    .from('players').select('id,display_name')
    .eq('workspace_id',app.state.workspaceId);
  if(error) throw error;
  const map={};
  (existing||[]).forEach(p=>map[p.display_name]=p.id);
  for(const name of names){
    if(map[name]) continue;
    const {data,error:ie}=await app.db
      .from('players')
      .insert({workspace_id:app.state.workspaceId,display_name:name})
      .select('id,display_name').single();
    if(ie) throw ie;
    map[name]=data.id;
  }
  return map;
};

app.resetForNewMatch = function resetForNewMatch(){
  app.state.matchName='';
  app.state.matchTypeId=null;
  app.state.teamName='';
  app.state.opponentTeams=[];
  app.state.opponentTeamIds={};
  app.state.matchDate='';
  app.state.players=[];
  app.state.activePlayers=[];
  app.state.events=[];
  app.state.currentMatchId=null;
  app.state.currentTeamId=null;
  app.state.playerIds={};
  app.state.playerRolePreferences={};
  app.state.defenseRolesByPeriod={};
  app.state.captureMode='live';
  app.state.youtubeUrl='';
  app.state.youtubeVideoId='';
  app.matchVideoResumeSeconds=0;
  app.matchVideoResumePending=false;
  app.matchVideoResumeToken++;

  app.$('#matchName').value='Match';
  if(app.$('#matchType'))app.$('#matchType').value='';
  app.$('#teamName').value='Mon équipe';
  app.$('#opponentTeam1').value='';
  app.$('#opponentTeam2').value='';
  app.$('#matchDate').value=app.isoToFrInput(app.today());
  if(app.$('#trainingDate')) app.$('#trainingDate').value=app.isoToFrInput(app.today());
  app.$('#rosterWrap').classList.add('hidden');
  if(app.$('#recentMatches')) app.$('#recentMatches').value='';
  app.$('#videoPosition').value='';
  if(app.$('#matchYoutubeUrl'))app.$('#matchYoutubeUrl').value='';
  app.setMatchCaptureMode('live');
  app.syncMatchVideoUi();
  app.$('#period').value='P1';
  app.$('#startPeriod').value='P1';

  app.$('#activePlayers').innerHTML='';
  app.$('#allPlayers').innerHTML='';
  app.$('#timeline').innerHTML='';
  app.$('#last').textContent='Aucune';
  app.$('#count').textContent='0 actions';

  app.$('#live').classList.add('hidden');
  app.$('#footer')?.classList.add('hidden');
  app.$('#appHome').classList.add('hidden');
  app.$('#trainingHome').classList.add('hidden');
  app.$('#trainingSession').classList.add('hidden');
  app.$('#trainingHistory').classList.add('hidden');
  app.$('#setup').classList.remove('hidden');
  app.$('#newMatchTop').classList.remove('hidden');

  localStorage.removeItem(app.KEY);
  app.setCloud('Prêt pour un nouveau match',true);
window.scrollTo({top:0,behavior:'instant'});
};

app.start = async function start(){
  try{
    app.setCloud('Enregistrement…',true);
    app.state.matchName=app.$('#matchName').value.trim()||'Match';
    app.state.matchTypeId=app.$('#matchType').value||null;
    app.state.teamName=app.$('#teamName').value.trim()||'Mon équipe';
    app.state.opponentTeams=[app.$('#opponentTeam1').value.trim(),app.$('#opponentTeam2').value.trim()];
    if(app.state.opponentTeams.some(x=>!x)){alert('Renseigne le nom des 3 équipes du match.');return}
    if(new Set([app.state.teamName,...app.state.opponentTeams].map(x=>x.toLowerCase())).size!==3){alert('Les 3 équipes doivent avoir des noms différents.');return}
    app.state.matchDate=app.frInputToIso(app.$('#matchDate').value||app.isoToFrInput(app.today()));
    app.state.captureMode=app.state.captureMode==='video'?'video':'live';
    app.state.youtubeUrl=app.state.captureMode==='video'?(app.$('#matchYoutubeUrl').value||'').trim():'';
    app.state.youtubeVideoId=app.state.captureMode==='video'?app.matchYoutubeId(app.state.youtubeUrl):'';
    app.matchVideoResumeSeconds=0;
    app.matchVideoResumePending=false;
    app.matchVideoResumeToken++;
    if(app.state.captureMode==='video'&&!app.state.youtubeVideoId){alert('Renseigne une URL YouTube valide pour le mode vidéo.');return}
    const groupId=app.$('#matchGroup').value;
    const selectionId=app.$('#matchSelection')?.value||null;
    if(!groupId){alert('Choisis le groupe suivi.');return}
    if(app.groupState.matchPlayers.length<4){alert(selectionId?'La sélection choisie doit contenir au moins 4 joueurs.':'Le groupe doit contenir au moins 4 joueurs.');return}
    app.state.players=app.groupState.matchPlayers.map(p=>p.display_name);
    app.state.playerIds=Object.fromEntries(app.groupState.matchPlayers.map(p=>[p.display_name,p.id]));
    app.state.playerRolePreferences=Object.fromEntries(app.groupState.matchPlayers.map(p=>[p.display_name,p.preferred_role||'AP']));

    const checked=app.$$('#rosterChecks input:checked');
    if(checked.length!==4){
      alert('Sélectionnez exactement 4 joueurs pour commencer la période.');
      app.updateStartButton();
      return;
    }
    app.state.activePlayers=checked.map(c=>c.dataset.name);

    app.state.currentTeamId=await app.ensureTeam(app.state.teamName);
    const opp1Id=await app.ensureTeam(app.state.opponentTeams[0]);
    const opp2Id=await app.ensureTeam(app.state.opponentTeams[1]);
    app.state.opponentTeamIds={
      [app.state.opponentTeams[0]]:opp1Id,
      [app.state.opponentTeams[1]]:opp2Id
    };

    const {data:m,error}=await app.db.from('matches').insert({
      workspace_id:app.state.workspaceId,
      group_id:groupId,
      selection_id:selectionId,
      team_id:app.state.currentTeamId,
      opponent_team_1_id:app.state.opponentTeamIds[app.state.opponentTeams[0]],
      opponent_team_2_id:app.state.opponentTeamIds[app.state.opponentTeams[1]],
      match_type_id:app.state.matchTypeId,
      label:app.state.matchName,
      played_on:app.state.matchDate,
      capture_mode:app.state.captureMode,
      youtube_url:app.state.youtubeUrl||null,
      status:'draft'
    }).select('id').single();
    if(error) throw error;

    app.state.currentMatchId=m.id;
    app.state.defenseRolesByPeriod={};
    app.state.events=[];
    app.$('#timeline').innerHTML='';
    app.$('#last').textContent='Aucune';
    app.$('#count').textContent='0 actions';

    const matchPlayers=app.state.players.map(p=>({
      match_id:app.state.currentMatchId,
      player_id:app.state.playerIds[p],
      started_on_court:app.state.activePlayers.includes(p)
    }));
    const {error:mpe}=await app.db.from('match_players').insert(matchPlayers);
    if(mpe) throw mpe;

    app.$('#period').value=app.$('#startPeriod').value;
    app.$('#setup').classList.add('hidden');
    app.$('#live').classList.remove('hidden');
    app.$('#footer')?.classList.remove('hidden');
    app.syncMatchVideoUi();
    app.initOrLoadMatchVideo();
    app.saveLocal();app.renderPlayers();app.render();
    await app.refreshRecentMatches();
    app.setCloud('Synchronisé',true);
  }catch(e){app.handleError('start',e)}
};

app.labelContext = function labelContext(c){
  if(c==='centre') return 'Jeu au centre';
  if(c==='remise_centre') return 'Remise en jeu · Centre';
  if(c==='remise_ligne') return 'Remise en jeu · Ligne';
  if(c==='remise_coin') return 'Remise en jeu · Coin';
  if(c==='gel') return 'Gel';
  return c;
};

app.currentVideoPosition = function currentVideoPosition(){
  return app.currentMatchVideoPosition();
};

app.dbActionType = function dbActionType(e){
  if(e.action==='Faute') return 'faute';
  if(e.action?.startsWith('Attaque')) return 'attaque';
  if(e.action?.startsWith('Défense')) return 'defense';
  return 'faute';
};

app.dbResult = function dbResult(e){
  if(e.action==='Faute') return null;
  const parts=(e.action||'').split(' · ');
  return parts.slice(1).join(' · ')||null;
};

app.playerIdFor = function playerIdFor(name){return name?app.state.playerIds[name]||null:null};

app.eventContext = function eventContext(fam,restart){
  if(fam==='centre') return 'centre';
  if(fam==='gel') return 'gel';
  return 'remise_'+(restart||'centre');
};

app.insertLineup = async function insertLineup(eventId,activePlayers){
  if(!activePlayers?.length) return;
  const rows=activePlayers.map(name=>app.state.playerIds[name]).filter(Boolean).map(id=>({event_id:eventId,player_id:id}));
  if(!rows.length) return;
  const {error}=await app.db.from('match_event_lineup').insert(rows);
  if(error) throw error;
};

app.insertAttributions = async function insertAttributions(eventId,players){
  if(!players?.length) return;
  const rows=[...new Set(players)].map(name=>app.state.playerIds[name]).filter(Boolean).map(id=>({event_id:eventId,player_id:id}));
  if(!rows.length) return;
  const {error}=await app.db.from('match_event_attributions').insert(rows);
  if(error) throw error;
};

app.persistEvent = async function persistEvent(base,isEdit=false){
  const payload={
    match_id:app.state.currentMatchId,
    sequence_no:isEdit
      ? (app.state.events.find(e=>e.id===app.editingId)?.sequenceNo||1)
      : (Math.max(0,...app.state.events.map(e=>e.sequenceNo||0))+1),
    period:base.period,
    video_position:base.videoPosition,
    family:base.family,
    restart_location:base.family==='remise'?base.restartLocation:null,
    action_type:app.dbActionType(base),
    result:app.dbResult(base),
    fault_type:base.faultType||null,
    movement:base.movement==null?null:(base.movement==='Oui'),
    zone:base.zone||null,
    player_id:app.playerIdFor(base.player)||(base.attributedPlayers?.length===1?app.playerIdFor(base.attributedPlayers[0]):null),
    is_collective:!base.player&&!base.attributedPlayers?.length,
    opponent_team_id:base.opponentTeam?app.state.opponentTeamIds[base.opponentTeam]||null:null
  };

  let eventId=app.editingId;
  if(isEdit){
    const {error}=await app.db.from('match_events').update(payload).eq('id',app.editingId);
    if(error) throw error;
    const {error:de}=await app.db.from('match_event_lineup').delete().eq('event_id',app.editingId);
    if(de) throw de;
    const {error:dae}=await app.db.from('match_event_attributions').delete().eq('event_id',app.editingId);
    if(dae) throw dae;
  }else{
    const {data,error}=await app.db.from('match_events').insert(payload).select('id,sequence_no,created_at').single();
    if(error) throw error;
    eventId=data.id;
    base.createdAt=data.created_at;
    base.sequenceNo=data.sequence_no;
  }
  await app.insertLineup(eventId,base.activePlayers);
  await app.insertAttributions(eventId,base.attributedPlayers||[]);
  return eventId;
};

app.loadMatch = async function loadMatch(matchId){
  try{
    app.setCloud('Chargement…',true);
    const [{data:m,error:me},{data:players,error:pe},{data:events,error:ee}] = await Promise.all([
      app.db.from('matches').select('id,label,played_on,group_id,selection_id,team_id,match_type_id,opponent_team_1_id,opponent_team_2_id,capture_mode,youtube_url,followed_team:teams!matches_team_id_fkey(name)').eq('id',matchId).single(),
      Promise.resolve({data:[],error:null}),
      app.db.from('match_events').select('*').eq('match_id',matchId).order('sequence_no',{ascending:true})
    ]);
    if(me) throw me;if(pe) throw pe;if(ee) throw ee;

    app.state.currentMatchId=m.id;
    const localMatch=app.loadLocal();
    app.state.defenseRolesByPeriod=(localMatch.currentMatchId===matchId&&localMatch.defenseRolesByPeriod)?localMatch.defenseRolesByPeriod:{};
    app.state.currentTeamId=m.team_id;
    app.state.matchName=m.label;
    app.state.matchTypeId=m.match_type_id||null;
    app.state.teamName=m.followed_team?.name||'Mon équipe';
    const opponentIds=[m.opponent_team_1_id,m.opponent_team_2_id].filter(Boolean);
    let opponentRows=[];
    if(opponentIds.length){
      const {data,error}=await app.db.from('teams').select('id,name').in('id',opponentIds);
      if(error) throw error;
      opponentRows=data||[];
    }
    const opponentById=Object.fromEntries(opponentRows.map(t=>[t.id,t.name]));
    app.state.opponentTeams=[m.opponent_team_1_id,m.opponent_team_2_id].map(id=>opponentById[id]||'').filter(Boolean);
    app.state.opponentTeamIds=Object.fromEntries(opponentRows.map(t=>[t.name,t.id]));
    app.state.matchDate=m.played_on||'';
    app.state.captureMode=m.capture_mode==='video'?'video':'live';
    app.state.youtubeUrl=m.youtube_url||'';
    app.state.youtubeVideoId=app.state.captureMode==='video'?app.matchYoutubeId(app.state.youtubeUrl):'';
    app.state.playerIds={};
    const idToName={};

    const {data:mp,error:mpe}=await app.db.from('match_players').select('player_id,started_on_court').eq('match_id',matchId);
    if(mpe) throw mpe;
    const playerIds=[...new Set((mp||[]).map(x=>x.player_id).filter(Boolean))];
    let playerRows=[];
    if(playerIds.length){
      const {data,error}=await app.db.from('players').select('id,display_name').in('id',playerIds);
      if(error)throw error;playerRows=data||[];
    }
    playerRows.forEach(p=>{app.state.playerIds[p.display_name]=p.id;idToName[p.id]=p.display_name});
    app.state.players=(mp||[]).map(x=>idToName[x.player_id]).filter(Boolean);
    app.state.playerRolePreferences={};
    if(m.group_id){
      const groupRoster=await app.fetchGroupPlayers(m.group_id);
      groupRoster.forEach(p=>{app.state.playerRolePreferences[p.display_name]=p.preferred_role||'AP'});
    }

    const ids=(events||[]).map(e=>e.id);
    let lineups=[];
    if(ids.length){
      const {data,error}=await app.db.from('match_event_lineup').select('event_id,player_id').in('event_id',ids);
      if(error) throw error;
      lineups=data||[];
    }
    const lineupMap={};
    lineups.forEach(x=>{
      const playerName=idToName[x.player_id];
      if(playerName) (lineupMap[x.event_id]??=[]).push(playerName);
    });

    let attributions=[];
    if(ids.length){
      const {data,error}=await app.db.from('match_event_attributions').select('event_id,player_id').in('event_id',ids);
      if(error) throw error;
      attributions=data||[];
    }
    const attributionMap={};
    attributions.forEach(x=>{
      const playerName=idToName[x.player_id];
      if(playerName) (attributionMap[x.event_id]??=[]).push(playerName);
    });

    app.state.events=(events||[]).map(e=>{
      const at=e.action_type==='attaque'?'Attaque':e.action_type==='defense'?'Défense':'Faute';
      return {
        id:e.id,sequenceNo:e.sequence_no,
        videoPosition:e.video_position,period:e.period||'P1',
        context:app.eventContext(e.family,e.restart_location),
        family:e.family,restartLocation:e.restart_location,
        action:at==='Faute'?'Faute':`${at} · ${e.result||''}`,
        faultType:e.fault_type,
        zone:e.zone,
        movement:e.movement==null?null:(e.movement?'Oui':'Non'),
        player:e.player_id?idToName[e.player_id]||null:null,
        attributedPlayers:attributionMap[e.id]||((e.action_type==='defense'&&e.player_id&&idToName[e.player_id])?[idToName[e.player_id]]:[]),
        activePlayers:lineupMap[e.id]||[],
        opponentTeam:e.opponent_team_id?opponentById[e.opponent_team_id]||null:null,
        createdAt:e.created_at
      };
    });
    const last=app.state.events.at(-1);
    app.state.activePlayers=(last?.activePlayers?.length?last.activePlayers:(mp||[]).filter(x=>x.started_on_court).map(x=>idToName[x.player_id]).filter(Boolean));

    // When resuming note-taking, continue from the period of the last recorded action.
    const resumePeriod=last?.period||'P1';
    if(app.$('#period'))app.$('#period').value=resumePeriod;
    if(app.$('#startPeriod'))app.$('#startPeriod').value=resumePeriod;

    // Resume YouTube from the most recent timestamp actually recorded.
    const lastTimedEvent=[...app.state.events].reverse().find(e=>(e.videoPosition||'').trim());
    app.matchVideoResumeSeconds=app.parseMatchVideoTime(lastTimedEvent?.videoPosition||'');
    app.matchVideoResumePending=!!app.matchVideoResumeSeconds;
    app.matchVideoResumeToken++;
    if(app.$('#videoPosition')){
      app.$('#videoPosition').value=lastTimedEvent?.videoPosition||'';
    }

    app.$('#matchName').value=app.state.matchName;
    await app.fetchMatchTypes();
    app.populateMatchTypeSelect(app.$('#matchType'),{selected:app.state.matchTypeId,includeArchivedId:app.state.matchTypeId});
    app.$('#teamName').value=app.state.teamName;
    app.$('#opponentTeam1').value=app.state.opponentTeams[0]||'';
    app.$('#opponentTeam2').value=app.state.opponentTeams[1]||'';
    app.$('#matchDate').value=app.isoToFrInput(app.state.matchDate||app.today());
    app.setMatchCaptureMode(app.state.captureMode);
    if(app.$('#matchYoutubeUrl'))app.$('#matchYoutubeUrl').value=app.state.youtubeUrl||'';
    if(m.group_id){app.$('#matchGroup').value=m.group_id;await app.loadMatchSelectionOptions(m.group_id,m.selection_id||'');await app.loadMatchGroupPlayers(m.group_id,m.selection_id||'');}
    app.$('#setup').classList.add('hidden');
    app.$('#live').classList.remove('hidden');
    app.initOrLoadMatchVideo();
    app.$('#footer')?.classList.remove('hidden');
    app.renderPlayers();app.render();app.saveLocal();
    app.setCloud('Synchronisé',true);
  }catch(e){app.handleError('loadMatch',e)}
};

app.deleteSavedMatch = async function deleteSavedMatch(matchId){
  const libraryMatch=(app.matchLibraryState.matches||[]).find(m=>m.id===matchId);
  const recentSel=app.$('#recentMatches');
  const recentOption=recentSel?[...recentSel.options].find(o=>o.value===matchId):null;
  const label=libraryMatch
    ? `${app.formatDateShort(libraryMatch.played_on)||''} · ${libraryMatch.label||'ce match'}`.trim()
    : (recentOption?.textContent||'ce match');

  const ok=confirm(`Supprimer définitivement ${label} ?\n\nToutes les prises de notes et compositions liées à ce match seront supprimées. Cette action est irréversible.`);
  if(!ok)return false;

  app.setCloud('Suppression…',true);

  try{
    const {data,error}=await app.db.from('matches').delete().eq('id',matchId).select('id');
    if(error)throw error;
    const deleted=Array.isArray(data)?data:data?[data]:[];
    if(!deleted.some(x=>x?.id===matchId)){
      throw new Error('Le match n’a pas pu être supprimé. Vérifie tes droits sur ce groupe.');
    }

    if(app.state.currentMatchId===matchId){
      app.state.currentMatchId=null;
      app.state.events=[];
      app.state.defenseRolesByPeriod={};
      const local=app.loadLocal();
      if(local.currentMatchId===matchId){
        localStorage.setItem(app.KEY,JSON.stringify({
          currentMatchId:null,
          workspaceId:app.state.workspaceId,
          defenseRolesByPeriod:{}
        }));
      }
    }

    app.matchLibraryState.matches=(app.matchLibraryState.matches||[]).filter(m=>m.id!==matchId);
    app.groupAnalysisState.selected?.delete(matchId);

    // Le sélecteur historique a été retiré de l'interface V2.9+, mais
    // on garde cette branche pour compatibilité avec d'anciennes vues.
    if(recentSel){
      await app.refreshRecentMatches();
      recentSel.value='';
      app.updateMatchAuditMeta();
    }

    if(app.$('#matchLibrary')&&!app.$('#matchLibrary').classList.contains('hidden')){
      app.renderMatchLibrary();
    }
    if(app.$('#matchAnalysisSelect')&&!app.$('#matchAnalysisSelect').classList.contains('hidden')){
      app.renderGroupAnalysisMatches();
    }

    app.setCloud('Synchronisé',true);
    return true;
  }catch(e){
    app.setCloud('Erreur',false);
    app.handleError('delete match',e);
    return false;
  }
};

app.buildOutcomeButtons = function buildOutcomeButtons(){
  const box=app.$('#resultOptions');box.innerHTML='';
  const add=(label,value)=>{
    const b=document.createElement('button');
    b.textContent=label;b.dataset.result=value;b.onclick=()=>app.handleOutcome(value,b);box.appendChild(b)
  };
  if(app.actionType==='Attaque'){
    add('POINT MARQUÉ','Point marqué');
    add('BALLON DÉFENDU','Ballon défendu');
    add('FAUTE D’ATTAQUE','Faute attaque');
    if(app.isCenterAttack()){
      const point=app.$('#resultOptions button[data-result="Point marqué"]');
      const defended=app.$('#resultOptions button[data-result="Ballon défendu"]');
      const fault=app.$('#resultOptions button[data-result="Faute attaque"]');
      if(point)point.innerHTML='POINT<br>MARQUÉ';
      if(defended)defended.innerHTML='BALLON<br>DÉFENDU';
      if(fault)fault.innerHTML='FAUTE<br>OFFENSIVE';
    }
  }else{
    add('BALLON DÉFENDU','Ballon défendu');
    add('ÉCHAPPÉ','Échappé');
    add('DÉFENSIVE ILLÉGALE','Défensive illégale');
    if(app.family==='centre'||app.family==='remise') add('FAUTE DE L’ADVERSAIRE','Faute de l’adversaire');
    if(app.isCenterDefense()){
      const defended=app.$('#resultOptions button[data-result="Ballon défendu"]');
      const illegal=app.$('#resultOptions button[data-result="Défensive illégale"]');
      const opponentFault=app.$('#resultOptions button[data-result="Faute de l’adversaire"]');
      if(defended)defended.innerHTML='BALLON<br>DÉFENDU';
      if(illegal)illegal.innerHTML='DÉFENSIVE<br>ILLÉGALE';
      if(opponentFault)opponentFault.innerHTML='FAUTE DE<br>L’ADVERSAIRE';
    }
  }
};

app.handleOutcome = function handleOutcome(value,button){
  app.actionResult=value;
  app.$$('#resultOptions button').forEach(x=>x.classList.remove('choice'));button.classList.add('choice');
  if(app.actionType==='Attaque'&&value==='Faute attaque'){
    app.$('#popup').classList.add('hidden');app.openFaultPopup();return
  }
  if(app.isCenterAttack()&&value==='Défensive illégale'){
    app.pending='Attaque · Défensive illégale';
    app.faultType='Défensive illégale';
    app.who='';
    app.$('#whoStep').classList.remove('hidden');
    app.configureWhoUI();
    app.$$('#whoOptions button').forEach(x=>x.classList.toggle('choice',(x.dataset.who||'')===''));
    app.updatePopupSaveVisibility();
    return
  }
  if(app.actionType==='Défense'&&value==='Défensive illégale'){
    app.pending='Faute';app.faultType='Défensive illégale';app.zone='';app.movement='Non';
    const map=app.defenseRoleMapForPopup();
    app.whoMany=map?.R?[map.R]:[];
    app.who='';
    if(app.isCenterDefense()){
      app.$('#centerDefenseMapStep').classList.remove('hidden');
      app.$('#zoneStep').classList.add('hidden');
      app.$$('#centerDefenseMap .sector').forEach(x=>x.classList.remove('selected'));
    }else{
      app.configureZoneUI(false);
    }
    app.$('#moveStep').classList.add('hidden');app.$('#whoStep').classList.remove('hidden');
    app.configureWhoUI();
    app.updatePopupSaveVisibility();
    return
  }
  if(app.actionType==='Défense'&&value==='Faute de l’adversaire'){
    app.pending='Défense · Faute de l’adversaire';
    app.faultType='';app.zone='';app.movement=null;app.who='';app.whoMany=[];
    app.$$('#centerDefenseMap .sector').forEach(x=>x.classList.remove('selected'));
    if(app.isCenterDefense()){
      app.$('#centerDefenseMapStep').classList.remove('hidden');
      app.$('#zoneStep').classList.add('hidden');
    }else{
      app.configureZoneUI(false);
    }
    app.$('#moveStep').classList.add('hidden');
    app.$('#whoStep').classList.add('hidden');
    app.updatePopupSaveVisibility();
    return
  }
  app.pending=app.actionType+' · '+value;
  app.configureZoneUI(true);app.$('#moveStep').classList.remove('hidden');app.$('#whoStep').classList.remove('hidden');
  app.configureWhoUI();
  app.updatePopupSaveVisibility();
};

app.resetPopupScroll = function resetPopupScroll(popupId){const sheet=app.$(popupId+' .sheet');if(sheet) sheet.scrollTop=0};

app.buildActionOpponentOptions = function buildActionOpponentOptions(){
  const box=app.$('#actionOpponentOptions');
  if(!box)return;
  if(app.opponentTeam&&!app.state.opponentTeams.includes(app.opponentTeam))app.opponentTeam='';
  box.innerHTML='';
  app.state.opponentTeams.forEach(name=>{
    const b=document.createElement('button');
    b.type='button';b.dataset.opponent=name;b.textContent=name;
    b.classList.toggle('choice',app.opponentTeam===name);
    b.onclick=()=>{
      app.opponentTeam=name;
      app.$$('#actionOpponentOptions button').forEach(x=>x.classList.toggle('choice',x.dataset.opponent===name));
      app.updatePopupSaveVisibility();
    };
    box.append(b);
  });
};

app.buildOpponentOptions = function buildOpponentOptions(){app.buildActionOpponentOptions()};

app.attackOutcomeRequiresPlayer = function attackOutcomeRequiresPlayer(){
  return false;
};

app.missingActionFields = function missingActionFields(){
  const missing=[];
  if(!app.opponentTeam) missing.push(app.actionType==='Attaque'?'équipe attaquée':'équipe attaquante');
  if(app.family==='remise'&&!app.restartLocation) missing.push('position de la remise en jeu');
  if(!app.pending) missing.push('issue de l’action');
  if(app.attackOutcomeRequiresPlayer()&&!app.who) missing.push('frappeur');
  return missing;
};

app.updatePopupSaveVisibility = function updatePopupSaveVisibility(){
  const btn=app.$('#savePopup');
  if(!btn)return;
  btn.disabled=false;
  const missing=app.missingActionFields();
  btn.title=missing.length?`À compléter : ${missing.join(', ')}`:'Sauvegarder l’action';
};

app.clearQuickOutcomeSelection = function clearQuickOutcomeSelection(){
  app.quickSelectedAction=null;
  app.$$('.entryAction').forEach(x=>x.classList.remove('selected'));
  app.$$('.actionOutcomeDropdown').forEach(x=>x.remove());
  app.$('#quickOutcomePanel')?.classList.add('hidden');
  const grid=app.$('#quickOutcomeGrid');
  if(grid){grid.innerHTML='';grid.className='quickOutcomeGrid'}
};

app.positionActionOutcomeDropdown = function positionActionOutcomeDropdown(button,menu){
  if(!button||!menu)return;
  const r=button.getBoundingClientRect();
  const margin=6;
  const width=Math.max(150,Math.min(r.width,window.innerWidth-margin*2));
  let left=Math.max(margin,Math.min(r.left,window.innerWidth-width-margin));
  let top=r.bottom+4;
  menu.style.width=width+'px';
  menu.style.left=left+'px';
  menu.style.top=top+'px';
  const mr=menu.getBoundingClientRect();
  if(mr.bottom>window.innerHeight-margin && r.top>mr.height+margin){
    top=Math.max(margin,r.top-mr.height-4);
    menu.style.top=top+'px';
  }
};

app.showQuickOutcomes = function showQuickOutcomes(button){
  const selectedFamily=button.dataset.family;
  const selectedActionType=button.dataset.actiontype;
  const presetRestart=button.dataset.restart||'';
  const detailOpen=!app.$('#popup')?.classList.contains('hidden')||!app.$('#faultPopup')?.classList.contains('hidden');
  const sameAction=button.classList.contains('selected')&&app.quickSelectedAction
    && app.quickSelectedAction.family===selectedFamily
    && app.quickSelectedAction.actionType===selectedActionType
    && (app.quickSelectedAction.restart||'')===presetRestart;
  const alreadyOpen=sameAction&&document.querySelector('.actionOutcomeDropdown');

  // Un second clic sur l'action active joue le rôle de l'ancien bouton Annuler :
  // on ferme la saisie en cours et on repart de zéro.
  if(sameAction&&detailOpen){
    app.editingId=null;
    app.pending=null;app.actionResult='';app.zone='';app.movement='';app.who='';app.whoMany=[];
    app.$('#popup')?.classList.add('hidden');
    app.$('#faultPopup')?.classList.add('hidden');
    app.$('#popup')?.classList.remove('quickOutcomePreset','quickCenterSimple','centerDefenseCompact','centerAttackMode','fieldMode');
    app.clearQuickOutcomeSelection();
    return;
  }

  app.clearQuickOutcomeSelection();
  if(alreadyOpen)return;

  app.quickSelectedAction={family:selectedFamily,actionType:selectedActionType,restart:presetRestart};
  button.classList.add('selected');

  const attack=selectedActionType==='Attaque';
  const outcomes=attack
    ? [
        {label:'POINT MARQUÉ',value:'Point marqué',cls:'point'},
        {label:'DÉFENDU',value:'Ballon défendu',cls:'defended'},
        {label:'FAUTE OFFENSIVE',value:'Faute attaque',cls:'fault'}
      ]
    : [
        {label:'ÉCHAPPÉ',value:'Échappé',cls:'point'},
        {label:'DÉFENDU PAR NOUS',value:'Ballon défendu',cls:'defended'},
        {label:'DÉFENSIVE ILLÉGALE',value:'Défensive illégale',cls:'illegal'},
        {label:'FAUTE OFFENSIVE ADVERSE',value:'Faute de l’adversaire',cls:'fault'}
      ];

  const menu=document.createElement('div');
  menu.className='actionOutcomeDropdown '+(attack?'attack':'defense');
  menu.setAttribute('role','menu');
  menu.setAttribute('aria-label',attack?'Issue de l’attaque':'Issue de la défense');

  outcomes.forEach(o=>{
    const b=document.createElement('button');
    b.type='button';
    b.className='quickOutcomeBtn '+o.cls;
    b.textContent=o.label;
    b.setAttribute('role','menuitem');
    b.onclick=(ev)=>{
      ev.stopPropagation();
      menu.remove();
      // Le bouton d'action reste visuellement actif pendant toute la saisie.
      button.classList.add('selected');
      app.launchQuickOutcome(o.value);
    };
    menu.appendChild(b);
  });

  document.body.appendChild(menu);
  app.positionActionOutcomeDropdown(button,menu);
};

app.defenseRoleMapForPopup = function defenseRoleMapForPopup(){
  const period=app.$('#popupPeriod')?.value||app.$('#period')?.value||'P1';
  return app.defenseRoleMap(period);
};

app.refreshDefenseAttributionUI = function refreshDefenseAttributionUI(){
  if(app.actionType!=='Défense')return;
  if(app.$('#popup')?.classList.contains('quickOutcomePreset')){
    app.configureQuickAttributionUI();
  }else{
    app.configureWhoUI();
  }
};

app.applyAutomaticDefenseAttribution = function applyAutomaticDefenseAttribution(){
  if(app.actionType!=='Défense')return false;

  const map=app.defenseRoleMapForPopup();
  let player=null;

  // Defensive illegal by us is always attributed to our R.
  if(app.actionResult==='Défensive illégale'){
    player=map?.R||null;
  }
  // On an escape or a ball defended by us, RE belongs to R and EE to P.
  else if(['Échappé','Ballon défendu'].includes(app.actionResult)){
    if(app.zone==='RE')player=map?.R||null;
    else if(app.zone==='EE')player=map?.P||null;
  }

  if(!player)return false;
  app.who='';
  app.whoMany=[player];
  app.refreshDefenseAttributionUI();
  app.updatePopupSaveVisibility();
  return true;
};

app.configureQuickAttributionUI = function configureQuickAttributionUI(){
  const box=app.$('#whoOptions');
  if(!box)return;

  app.buildWho('#whoOptions');

  box.classList.toggle('attackAttributionLayout',['Attaque','Défense'].includes(app.actionType));

  if(app.actionType==='Attaque'){
    app.$('#whoTitle').textContent='Frappeur — facultatif';
    app.$$('#whoOptions button').forEach(b=>{
      const name=b.dataset.who||'';
      b.classList.toggle('choice',name===app.who);
      b.onclick=()=>{
        app.who=(app.who===name?'':name);
        app.$$('#whoOptions button').forEach(x=>x.classList.remove('choice'));
        if(app.who)b.classList.add('choice');
        app.updatePopupSaveVisibility();
      };
    });
  }else{
    app.$('#whoTitle').textContent='Défenseur(s) — facultatif';
    app.$$('#whoOptions button').forEach(b=>{
      const name=b.dataset.who||'';
      b.classList.toggle('choice',app.whoMany.includes(name));
      b.onclick=()=>{
        app.whoMany=app.whoMany.includes(name)?app.whoMany.filter(x=>x!==name):[...app.whoMany,name];
        app.$$('#whoOptions button').forEach(x=>{
          const n=x.dataset.who||'';
          x.classList.toggle('choice',app.whoMany.includes(n));
        });
        app.updatePopupSaveVisibility();
      };
    });
  }
};

app.launchQuickOutcome = function launchQuickOutcome(outcome){
  if(!app.quickSelectedAction)return;
  const q={...app.quickSelectedAction};

  app.openActionPopup(q.family,q.actionType,q.restart);

  // The outcome has already been chosen in the quick-entry panel.
  app.$('#popup')?.classList.add('quickOutcomePreset');

  const resultButton=app.$(`#resultOptions button[data-result="${CSS.escape(outcome)}"]`);
  if(resultButton){
    app.handleOutcome(outcome,resultButton);
  }else{
    app.actionResult=outcome;
    app.pending=q.actionType+' · '+outcome;
    app.updatePopupSaveVisibility();
  }

  // Attack faults keep the dedicated fault popup.
  if(app.$('#popup').classList.contains('hidden'))return;

  app.$('#resultStep').classList.add('hidden');

  // For centre actions, the diagram is intentionally skipped in quick-entry mode:
  // only attribution is requested, just like the simplified restart workflow.
  if(q.family==='centre'){
    app.$('#popup').classList.add('quickCenterSimple');
    app.$('#popup').classList.remove('centerDefenseCompact','centerAttackMode','fieldMode');

    // En saisie rapide au centre, on ne réaffiche pas les champs que
    // handleOutcome() a volontairement masqués. Pour une faute offensive
    // adverse, le comportement doit être strictement le même qu'en remise
    // en jeu : aucun champ Zone / Déplacement / Défenseur n'est demandé.
    const opponentAttackFault=q.actionType==='Défense'&&outcome==='Faute de l’adversaire';

    app.$('#centerDefenseMapStep').classList.add('hidden');
    if(opponentAttackFault){
      app.$('#zoneStep').classList.add('hidden');
      app.$('#moveStep').classList.add('hidden');
      app.$('#whoStep').classList.add('hidden');
      app.whoMany=[];
      app.who='';
      app.updatePopupSaveVisibility();
    }else{
      // Keep the useful manual fields, but skip the graphical court diagram.
      app.$('#zoneStep').classList.remove('hidden');
      app.$('#moveStep').classList.remove('hidden');

      // Start with the same neutral defaults as the restart workflow.
      if(!app.zone)app.zone='';
      if(app.movement==null)app.movement='';
      app.$$('#zoneOptions button').forEach(b=>b.classList.toggle('choice',(b.dataset.zone||'')===app.zone));
      app.$$('#moveOptions button').forEach(b=>b.classList.toggle('choice',(b.dataset.move||'')===app.movement));

      // Do not pre-assign a defender from the old centre diagram logic.
      if(q.actionType==='Défense'){
        app.whoMany=[];
        app.who='';
      }

      app.$('#whoStep').classList.remove('hidden');
      app.configureQuickAttributionUI();
      app.applyAutomaticDefenseAttribution();
      app.updatePopupSaveVisibility();
    }
  }else{
    app.applyAutomaticDefenseAttribution();
  }

  app.resetPopupScroll('#popup');
};

app.openActionPopup = function openActionPopup(selectedFamily,selectedActionType,presetRestart=''){
  app.$('#popup')?.classList.remove('quickOutcomePreset','quickCenterSimple');
  app.family=selectedFamily;app.actionType=selectedActionType;app.restartLocation=selectedFamily==='remise'?(presetRestart||''):'';
  app.$('#popup').classList.toggle('centerDefenseCompact',app.family==='centre');
  app.$('#popup').classList.toggle('centerAttackMode',app.family==='centre'&&app.actionType==='Attaque');
  app.$('#popup').classList.toggle('fieldMode',app.family==='centre');
  app.context=app.family==='centre'?'centre':(app.family==='gel'?'gel':('remise_'+(app.restartLocation||'centre')));
  app.pending=null;app.actionResult='';app.zone='';app.movement='';app.who='';app.whoMany=[];app.editingId=null;
  if(app.$('#popupPeriod'))app.$('#popupPeriod').value=app.$('#period').value||'P1';
  const restartLabel=app.restartLocation?({'centre':'centre','ligne':'ligne','coin':'coin'}[app.restartLocation]||app.restartLocation):'';
  app.$('#popupTitle').textContent=app.actionType+(app.family==='centre'?' au centre':app.family==='gel'?' Gel':(' remise'+(restartLabel?' · '+restartLabel:'')));
  app.$('#popupMeta').textContent=app.currentVideoPosition()?('Vidéo '+app.currentVideoPosition()):'';
  app.$$('#restartLocationOptions button').forEach(b=>b.classList.toggle('choice',!!app.restartLocation&&b.dataset.restart===app.restartLocation));
  app.$$('#zoneOptions button').forEach(b=>b.classList.remove('choice'));
  app.$('#zoneOptions button[data-zone=""]').classList.add('choice');
  app.$$('#moveOptions button').forEach(b=>b.classList.remove('choice'));
  app.$('#moveOptions button[data-move=""]').classList.add('choice');
  app.buildOpponentOptions();
  app.$('#restartLocationStep').classList.toggle('hidden',app.family!=='remise'||!!presetRestart);
  app.buildOutcomeButtons();
  app.$('#resultStep').classList.remove('hidden');
  app.configureZoneUI(app.family!=='gel');
  app.$('#moveStep').classList.remove('hidden');app.$('#whoStep').classList.remove('hidden');
  app.updatePopupSaveVisibility();
  app.configureWhoUI();
  app.syncVideoPopupBounds();
  app.syncVideoPopupBounds();
  app.$('#faultPopup')?.classList.add('hidden');app.$('#popup').classList.remove('hidden');app.resetPopupScroll('#popup');
};

app.buildFaultOpponentOptions = function buildFaultOpponentOptions(){
  const box=app.$('#faultOpponentOptions');box.innerHTML='';
  app.state.opponentTeams.forEach(name=>{
    const b=document.createElement('button');
    b.dataset.opponent=name;b.textContent=name;
    b.classList.toggle('choice',app.opponentTeam===name);
    b.onclick=()=>{
      app.opponentTeam=name;
      app.$$('#faultOpponentOptions button').forEach(x=>x.classList.toggle('choice',x.dataset.opponent===name));
    };
    box.append(b);
  });
  app.$('#faultOpponentTitle').textContent=app.actionType==='Défense'?'Équipe attaquante':'Équipe attaquée';
};

app.openFaultPopup = function openFaultPopup(){
  app.faultType='';app.faultWho='';
  if(app.$('#faultPeriod'))app.$('#faultPeriod').value=app.$('#period').value||'P1';
  const vp=app.currentVideoPosition();
  app.$('#faultMeta').textContent='Faute d’attaque · '+app.labelContext(app.context)+(vp?' · vidéo '+vp:'');
  app.buildActionOpponentOptions();
  app.$$('#faultTypes button').forEach(b=>b.classList.remove('choice'));
  app.buildWho('#faultWhoOptions');
  app.$$('#faultWhoOptions button').forEach(b=>b.classList.remove('choice'));
  const defaultFaultWho=app.$('#faultWhoOptions button[data-who=""]');
  if(defaultFaultWho)defaultFaultWho.classList.add('choice');
  app.$$('#faultWhoOptions button').forEach(b=>b.onclick=()=>{app.faultWho=b.dataset.who;app.$$('#faultWhoOptions button').forEach(x=>x.classList.remove('choice'));b.classList.add('choice')});
  app.syncVideoPopupBounds();
  app.$('#popup')?.classList.add('hidden');app.$('#faultPopup').classList.remove('hidden');app.resetPopupScroll('#faultPopup');
};

app.editEvent = function editEvent(id){
  app.clearQuickOutcomeSelection();
  app.$('#popup')?.classList.remove('quickOutcomePreset');
  const e=app.state.events.find(x=>x.id===id);if(!e)return;
  app.editingId=id;app.context=e.context||'centre';
  app.family=e.family||(app.context.startsWith('remise_')?'remise':'centre');
  app.restartLocation=e.restartLocation||(app.context.startsWith('remise_')?app.context.replace('remise_',''):'');
  if(app.$('#popupPeriod'))app.$('#popupPeriod').value=e.period||'P1';
  if(app.$('#faultPeriod'))app.$('#faultPeriod').value=e.period||'P1';
  app.$('#videoPosition').value=e.videoPosition||'';
  if(e.action==='Faute'){
    app.faultType=e.faultType||'';app.faultWho=e.player||'';app.opponentTeam=e.opponentTeam||'';
    app.actionType=app.faultType==='Défensive illégale'?'Défense':'Attaque';
    if(app.faultType==='Défensive illégale'&&!app.$('#faultTypes button[data-fault="Défensive illégale"]')){
      const b=document.createElement('button');b.dataset.fault='Défensive illégale';b.textContent='DÉFENSIVE ILLÉGALE';
      app.$('#faultTypes').appendChild(b);
      b.onclick=()=>{app.faultType=b.dataset.fault;app.$$('#faultTypes button').forEach(x=>x.classList.remove('choice'));b.classList.add('choice')};
    }
    app.$('#faultMeta').textContent=(app.actionType==='Défense'?'Défensive illégale':'Faute d’attaque')+' · '+app.labelContext(app.context)+(e.videoPosition?' · vidéo '+e.videoPosition:'');
    app.buildActionOpponentOptions();
    app.$$('#faultTypes button').forEach(b=>b.classList.toggle('choice',b.dataset.fault===app.faultType));
    app.buildWho('#faultWhoOptions');
    app.$$('#faultWhoOptions button').forEach(b=>{
      b.classList.toggle('choice',(b.dataset.who||'')===app.faultWho);
      b.onclick=()=>{app.faultWho=b.dataset.who;app.$$('#faultWhoOptions button').forEach(x=>x.classList.remove('choice'));b.classList.add('choice')}
    });
    app.syncVideoPopupBounds();
    app.$('#popup')?.classList.add('hidden');app.$('#faultPopup').classList.remove('hidden');app.resetPopupScroll('#faultPopup');return
  }
  app.pending=e.action;app.actionType=e.action.startsWith('Attaque')?'Attaque':'Défense';
  app.$('#popup').classList.toggle('centerDefenseCompact',app.family==='centre'&&app.actionType==='Défense');
  if(e.action.includes('Point marqué'))app.actionResult='Point marqué';
  else if(e.action.includes('Ballon défendu'))app.actionResult='Ballon défendu';
  else if(e.action.includes('Échappé'))app.actionResult='Échappé';
  else if(e.action.includes('Défensive illégale'))app.actionResult='Défensive illégale';
  else if(e.action.includes('Faute de l’adversaire'))app.actionResult='Faute de l’adversaire';
  else app.actionResult='';
  app.zone=app.family==='gel'?'':(({E1:'A1',E2:'P',E3:'A2'}[e.zone])||e.zone||'');app.movement=e.movement||'';app.who=e.player||'';app.whoMany=app.actionType==='Défense'?[...(e.attributedPlayers||((e.player)?[e.player]:[]))]:[];app.opponentTeam=e.opponentTeam||'';
  app.$('#popupTitle').textContent='Modifier · '+app.actionType;
  app.$('#popupMeta').textContent=app.labelContext(app.context)+(e.videoPosition?' · vidéo '+e.videoPosition:'');
  app.buildOpponentOptions();
  app.$('#restartLocationStep').classList.toggle('hidden',app.family!=='remise');
  app.$$('#restartLocationOptions button').forEach(b=>b.classList.toggle('choice',b.dataset.restart===app.restartLocation));
  app.buildOutcomeButtons();
  app.$$('#resultOptions button').forEach(b=>b.classList.toggle('choice',b.dataset.result===app.actionResult));
  app.$('#resultStep').classList.remove('hidden');
  if(app.actionType==='Défense'&&app.actionResult==='Faute de l’adversaire'){
    app.$('#moveStep').classList.add('hidden');
    app.configureZoneUI(false);
    app.$('#whoStep').classList.add('hidden');
  }else{
    app.$('#moveStep').classList.remove('hidden');
    app.configureZoneUI(app.family!=='gel');
    app.$('#whoStep').classList.remove('hidden');
  }
  app.$('#savePopup').disabled=false;
  app.$$('#zoneOptions button').forEach(b=>b.classList.toggle('choice',(b.dataset.zone||'')===app.zone));
  app.$$('#moveOptions button').forEach(b=>b.classList.toggle('choice',(b.dataset.move||'')===app.movement));
  app.configureWhoUI();
  if(app.isCenterDefense())app.syncCenterDefenseSectorFromEvent();
  app.$('#faultPopup')?.classList.add('hidden');app.$('#popup').classList.remove('hidden');app.resetPopupScroll('#popup');
};

app.eventAttributionLabel = function eventAttributionLabel(e){
  if(e.attributedPlayers?.length) return e.attributedPlayers.join(', ');
  return e.player||'Collectif/non spécifié';
};
})(window.KinballCoach.app);

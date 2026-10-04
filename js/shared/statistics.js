/* statistics. Shared explicit application context; no startup side effects. */
((app) => {
app.statsEscape = function statsEscape(v){ return app.escapeHtml(v); };

app.statsMetric = function statsMetric(label,value,sub=''){
  return `<div class="statsMetric"><div class="small">${app.statsEscape(label)}</div><div class="value">${app.statsEscape(value)}</div>${sub?`<div class="small">${app.statsEscape(sub)}</div>`:''}</div>`;
};

app.statsValueNumber = function statsValueNumber(r,type){
  if(type==='success_attempts') return r.attempts>0&&r.successes!=null ? 100*r.successes/r.attempts : null;
  return r.numeric_value==null?null:Number(r.numeric_value);
};

app.statsFormatAggregate = function statsFormatAggregate(rows,type){
  if(!rows.length)return '—';
  if(type==='success_attempts'){
    const success=rows.reduce((a,r)=>a+(Number(r.successes)||0),0);
    const attempts=rows.reduce((a,r)=>a+(Number(r.attempts)||0),0);
    return attempts>0?`${Math.round(100*success/attempts)} % · ${success}/${attempts}`:'—';
  }
  const vals=rows.map(r=>Number(r.numeric_value)).filter(Number.isFinite);
  if(!vals.length)return '—';
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
  const suffix=type==='time_seconds'?' s':type==='rating_5'?' /5':type==='rating_10'?' /10':'';
  return `${Math.round(avg*10)/10}${suffix}`;
};

app.statsFormatSingle = function statsFormatSingle(r,type){
  if(!r)return '—';
  if(type==='success_attempts'){
    if(r.attempts>0&&r.successes!=null)return `${r.successes}/${r.attempts} · ${Math.round(100*r.successes/r.attempts)} %`;
    return '—';
  }
  if(r.numeric_value==null)return '—';
  const suffix=type==='time_seconds'?' s':type==='rating_5'?' /5':type==='rating_10'?' /10':'';
  return `${Number(r.numeric_value)}${suffix}`;
};

app.statsBestRow = function statsBestRow(rows,type){
  const valid=rows.filter(r=>app.statsValueNumber(r,type)!=null);
  if(!valid.length)return null;
  return valid.reduce((best,r)=>{
    if(!best)return r;
    const v=app.statsValueNumber(r,type),b=app.statsValueNumber(best,type);
    return type==='time_seconds' ? (v<b?r:best) : (v>b?r:best);
  },null);
};

app.statsSparkline = function statsSparkline(values,labels=[]){
  const vals=values.map(Number).filter(Number.isFinite);
  if(vals.length<2)return '';
  const w=600,h=120,p=10,min=Math.min(...vals),max=Math.max(...vals),span=(max-min)||1;
  const pts=vals.map((v,i)=>{
    const x=p+(w-2*p)*(i/(vals.length-1));
    const y=h-p-(h-2*p)*((v-min)/span);
    return [x,y];
  });
  const poly=pts.map(p=>p.join(',')).join(' ');
  const circles=pts.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="4"><title>${app.statsEscape(labels[i]||'')} · ${Math.round(vals[i]*10)/10}</title></circle>`).join('');
  return `<div class="statsChart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Évolution des résultats"><polyline points="${poly}"></polyline>${circles}</svg></div>`;
};

app.statsBarList = function statsBarList(items){
  if(!items.length)return '<div class="statsEmpty">Aucune donnée.</div>';
  const max=Math.max(...items.map(x=>x.value),1);
  return items.map(x=>`<div class="statsBarRow"><div class="statsBarTop"><span>${app.statsEscape(x.label)}</span><strong>${app.statsEscape(x.display??x.value)}</strong></div><div class="statsBarTrack"><div class="statsBarFill" style="width:${Math.max(3,100*x.value/max)}%"></div></div></div>`).join('');
};

app.statsSessionExerciseFocus = function statsSessionExerciseFocus(sessionId,exerciseId){
  return app.statsState.sessionExercises.find(x=>x.session_id===sessionId&&x.exercise_id===exerciseId)?.focus||null;
};

app.statsFilteredExerciseResults = function statsFilteredExerciseResults(exerciseId,focus=null){
  return app.statsState.results.filter(r=>{
    if(r.exercise_id!==exerciseId)return false;
    if(!focus)return true;
    return app.statsSessionExerciseFocus(r.session_id,exerciseId)===focus;
  });
};

app.loadStatsData = async function loadStatsData(groupId){
  await app.fetchExerciseCategories();
  app.statsState.groupId=groupId;
  app.statsState.sessions=[];app.statsState.attendance=[];app.statsState.sessionExercises=[];app.statsState.results=[];app.statsState.players=[];app.statsState.exerciseMap={};app.statsState.sessionMap={};
  if(!groupId){app.renderStatsAll();return}
  app.$('#statsStatus').textContent='Chargement…';
  app.statsState.sessions=await app.services.trainingSessions(groupId);
  app.statsState.sessions.forEach(x=>app.statsState.sessionMap[x.id]=x);
  app.statsState.players=await app.fetchGroupPlayers(groupId);
  const ids=app.statsState.sessions.map(x=>x.id);
  if(ids.length){
    const rows=await app.services.trainingResults(ids);
    app.statsState.attendance=rows.attendance;
    app.statsState.sessionExercises=rows.sessionExercises;
    app.statsState.results=rows.results;
    app.statsState.sessionExercises.forEach(x=>{if(x.exercise)app.statsState.exerciseMap[x.exercise.id]=x.exercise});
  }
  app.$('#statsStatus').textContent=`${app.statsState.sessions.length} séance${app.statsState.sessions.length>1?'s':''} analysée${app.statsState.sessions.length>1?'s':''}`;
  app.populateStatsSelectors();
  app.renderStatsAll();
};

app.switchStatsTab = function switchStatsTab(tab){
  app.statsState.tab=tab;
  app.$$('.statsTab').forEach(b=>b.classList.toggle('active',b.dataset.statsTab===tab));
  app.$('#statsGroupView').classList.toggle('hidden',tab!=='group');
  app.$('#statsPlayerView').classList.toggle('hidden',tab!=='player');
  app.$('#statsExerciseView').classList.toggle('hidden',tab!=='exercise');
  if(tab==='player')app.renderStatsPlayer();
  if(tab==='exercise')app.renderStatsExercise();
};

app.renderStatsAll = function renderStatsAll(){
  app.renderStatsGroup();
  app.renderStatsPlayer();
  app.renderStatsExercise();
};

app.renderStatsGroup = function renderStatsGroup(){
  const m=app.$('#statsGroupMetrics'),top=app.$('#statsTopExercises'),cat=app.$('#statsCategoryDistribution');
  if(!app.statsState.groupId){m.innerHTML='';top.innerHTML='<div class="statsEmpty">Choisis un groupe.</div>';cat.innerHTML='';return}
  const recorded=app.statsState.attendance.length;
  const present=app.statsState.attendance.filter(a=>a.present).length;
  const rate=recorded?Math.round(100*present/recorded):0;
  const evaluated=new Set(app.statsState.results.map(r=>r.player_id)).size;
  m.innerHTML=app.statsMetric('Présence moyenne',recorded?rate+' %':'—')+app.statsMetric('Joueurs évalués',evaluated||'—');

  const usage={};
  app.statsState.sessionExercises.forEach(x=>{
    if(!x.exercise)return;
    if(!usage[x.exercise_id])usage[x.exercise_id]={label:x.exercise.name,value:0};
    usage[x.exercise_id].value++;
  });
  const tops=Object.values(usage).sort((a,b)=>b.value-a.value).slice(0,5).map(x=>({...x,display:`${x.value} séance${x.value>1?'s':''}`}));
  top.innerHTML=app.statsBarList(tops);

  const cats={};
  app.statsState.sessionExercises.forEach(x=>{
    const id=x.exercise?.category_id||app.fallbackCategory()?.id||'unknown';
    if(!cats[id])cats[id]={label:app.categoryLabel(x.exercise),value:0};
    cats[id].value++;
  });
  const catRows=Object.values(cats).map(({label,value})=>({label,value,display:String(value)})).sort((a,b)=>b.value-a.value);
  cat.innerHTML=app.statsBarList(catRows);
};

app.renderStatsLeaderboard = function renderStatsLeaderboard(rows,ex){
  const leader=app.$('#statsLeaderboard'),hint=app.$('#statsLeaderboardHint');
  const playerMap=Object.fromEntries(app.statsState.players.map(p=>[p.id,p.display_name]));
  const grouped={};
  rows.forEach(r=>(grouped[r.player_id]??=[]).push(r));
  let entries=[];
  Object.entries(grouped).forEach(([pid,all])=>{
    all.sort((a,b)=>(app.statsState.sessionMap[b.session_id]?.trained_on||'').localeCompare(app.statsState.sessionMap[a.session_id]?.trained_on||''));
    const used=app.statsState.leaderMode==='recent'?all.slice(0,3):all;
    if(ex.measurement_type==='success_attempts'){
      const successes=used.reduce((a,r)=>a+(Number(r.successes)||0),0);
      const attempts=used.reduce((a,r)=>a+(Number(r.attempts)||0),0);
      if(attempts<5)return;
      entries.push({pid,name:playerMap[pid]||'Joueur',score:100*successes/attempts,display:`${Math.round(100*successes/attempts)} % · ${successes}/${attempts}`,volume:attempts});
    }else{
      const vals=used.map(r=>Number(r.numeric_value)).filter(Number.isFinite);
      if(!vals.length)return;
      const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
      const suffix=ex.measurement_type==='time_seconds'?' s':ex.measurement_type==='rating_5'?' /5':ex.measurement_type==='rating_10'?' /10':'';
      entries.push({pid,name:playerMap[pid]||'Joueur',score:avg,display:`${Math.round(avg*10)/10}${suffix}`,volume:vals.length});
    }
  });
  entries.sort((a,b)=>ex.measurement_type==='time_seconds'?a.score-b.score:b.score-a.score);
  hint.textContent=ex.measurement_type==='success_attempts'
    ? `${app.statsState.leaderMode==='recent'?'3 derniers résultats':'Toutes les données'} · minimum 5 tentatives`
    : `${app.statsState.leaderMode==='recent'?'Moyenne des 3 derniers résultats':'Moyenne globale'}${ex.measurement_type==='time_seconds'?' · temps le plus bas en tête':''}`;
  if(!entries.length){leader.innerHTML='<div class="statsEmpty">Pas encore assez de données pour établir un classement.</div>';return}
  leader.innerHTML=entries.slice(0,10).map((x,i)=>`<div class="leaderRow"><div class="leaderRank">${i+1}</div><div><strong>${app.statsEscape(x.name)}</strong><div class="small">${x.volume} ${ex.measurement_type==='success_attempts'?'tentative'+(x.volume>1?'s':''):'résultat'+(x.volume>1?'s':'')}</div></div><strong>${app.statsEscape(x.display)}</strong></div>`).join('');
};

app.switchStatsDomain = function switchStatsDomain(domain){
  app.statsState.domain=domain;
  app.$$('.statsDomainTab').forEach(b=>b.classList.toggle('active',b.dataset.statsDomain===domain));
  app.$('#statsTrainingDomain').classList.toggle('hidden',domain!=='training');
  app.$('#statsMatchesDomain').classList.toggle('hidden',domain!=='matches');
  app.$('#statsReferenceDomain').classList.toggle('hidden',domain!=='reference');
  app.$('#statsImpactDomain').classList.toggle('hidden',domain!=='impact');
  if(domain==='matches'){app.statsState.statsMatchView='summary';app.loadStatsMatches().catch(e=>{app.handleError('stats matches',e);app.$('#statsMatchSummary').innerHTML=`<div class="statsEmpty">${app.escapeHtml(e.message||String(e))}</div>`})};
  if(domain==='reference')app.loadStatsReference().catch(e=>{app.handleError('stats reference',e);app.$('#statsReferenceContent').innerHTML=`<div class="statsEmpty">${app.escapeHtml(e.message||String(e))}</div>`});
  if(domain==='impact')app.loadStatsImpact().catch(e=>{app.handleError('stats impact',e);app.$('#statsImpactContent').innerHTML=`<div class="statsEmpty">${app.escapeHtml(e.message||String(e))}</div>`});
};

app.statsMatchDisplayLabel = function statsMatchDisplayLabel(m){
  const date=m.played_on?new Date(`${m.played_on}T12:00:00`).toLocaleDateString('fr-FR'):'Date inconnue';
  return {title:m.label||m.match_type?.name||'Match',meta:[date,m.opponent1?.name,m.opponent2?.name].filter(Boolean).join(' · ')};
};

app.renderStatsMatchSelector = function renderStatsMatchSelector(){
  const list=app.statsState.matchList||[];
  const selected=new Set(app.statsState.matchSelection||[]);
  const box=app.$('#statsMatchSelector');
  const status=app.$('#statsMatchSelectionStatus');
  const search=(app.statsState.matchSearch||'').trim().toLowerCase();
  const typeFilter=app.statsState.matchTypeFilter||'';

  if(!list.length){
    box.innerHTML='';
    status.textContent='';
    return;
  }

  const visible=list.filter(m=>{
    const hay=[
      m.label,
      m.match_type?.name,
      m.opponent1?.name,
      m.opponent2?.name,
      m.played_on
    ].filter(Boolean).join(' ').toLowerCase();
    const matchSearch=!search||hay.includes(search);
    const matchType=!typeFilter||(m.match_type?.name||'')===typeFilter;
    return matchSearch&&matchType;
  });

  box.innerHTML=visible.length
    ? visible.slice().reverse().map(m=>{
        const l=app.statsMatchDisplayLabel(m);
        return `<label class="statsMatchChoice">
          <input type="checkbox" data-stats-match-id="${m.id}" ${selected.has(m.id)?'checked':''}>
          <span><strong>${app.escapeHtml(l.title)}</strong><span class="small">${app.escapeHtml(l.meta)}</span></span>
        </label>`;
      }).join('')
    : '<div class="statsEmpty" style="grid-column:1/-1">Aucun match ne correspond aux filtres.</div>';

  const hiddenSelected=[...selected].filter(id=>!visible.some(m=>m.id===id)).length;
  status.textContent=`${selected.size} match${selected.size>1?'s':''} sélectionné${selected.size>1?'s':''}${hiddenSelected?` · ${hiddenSelected} masqué${hiddenSelected>1?'s':''} par les filtres`:''}`;

  box.querySelectorAll('input[data-stats-match-id]').forEach(input=>{
    input.onchange=()=>{
      const id=input.dataset.statsMatchId;
      const set=new Set(app.statsState.matchSelection||[]);
      if(input.checked)set.add(id); else set.delete(id);
      app.statsState.matchSelection=[...set];
      app.renderStatsMatchSelector();
      app.renderStatsMatchesSelection().catch(e=>{app.handleError('stats matches selection',e);app.$('#statsMatchSummary').innerHTML=`<div class="statsEmpty">${app.escapeHtml(e.message||String(e))}</div>`});
    };
  });
};

app.statsOutcomeCounts = function statsOutcomeCounts(events,mode){
  const counts=app.emptyOffensiveCounts();
  let usable=0;
  (events||[]).forEach(e=>{
    let obs=null;
    if(mode==='attack'){
      if(e.action_type!=='attaque'&&e.action_type!=='faute')return;
      obs=app.detailedEventToOffensiveObservation(e);
    }else{
      if(e.action_type!=='defense')return;
      obs=app.detailedEventToOffensiveObservation(e);
    }
    if(!obs)return;
    app.addOffensiveObservation(counts,obs.context,obs.outcome);usable++;
  });
  return {counts,usable};
};

app.statsContextTable = function statsContextTable(counts,title){
  const rows=app.OFFENSIVE_CONTEXTS.map(c=>{
    const x=counts[c.key]||{point:0,defended:0,attack_fault:0,total:0};
    const pointRate=x.total?Math.round(1000*x.point/x.total)/10:null;
    const faultRate=x.total?Math.round(1000*x.attack_fault/x.total)/10:null;
    return `<tr><td>${app.escapeHtml(c.label)}</td><td>${x.point}</td><td>${x.defended}</td><td>${x.attack_fault}</td><td>${x.total}</td><td>${pointRate==null?'—':String(pointRate).replace('.',',')+' %'}</td><td>${faultRate==null?'—':String(faultRate).replace('.',',')+' %'}</td></tr>`;
  }).join('');
  return `<div class="analysisSubsectionTitle">${app.escapeHtml(title)}</div><div class="analysisTableWrap"><table class="analysisTable"><thead><tr><th>Contexte</th><th>Points</th><th>Défendus</th><th>Fautes</th><th>N</th><th>% point</th><th>% faute</th></tr></thead><tbody>${rows}</tbody></table></div>`;
};

app.statsPct1 = function statsPct1(v){
  return v==null||!Number.isFinite(v)?'—':`${String(Math.round(v*1000)/10).replace('.',',')} %`;
};

app.statsSignedPct1 = function statsSignedPct1(v){
  if(v==null||!Number.isFinite(v))return '—';
  const n=Math.round(v*1000)/10;
  return `${n>0?'+':''}${String(n).replace('.',',')} pt`;
};

app.statsSigned3 = function statsSigned3(v){
  if(v==null||!Number.isFinite(v))return '—';
  const n=Math.round(v*1000)/1000;
  return `${n>0?'+':''}${n.toFixed(3).replace('.',',')}`;
};

app.opponentOffensivePerformance = function opponentOffensivePerformance(events,reference){
  let attacks=0,points=0,faults=0,realValue=0,expectedValue=0,expectedPoints=0,expectedFaults=0;
  const byContext={};
  app.OFFENSIVE_CONTEXTS.forEach(c=>byContext[c.key]={attacks:0,points:0,faults:0,realValue:0,expectedValue:0,expectedPoints:0,expectedFaults:0});

  (events||[]).forEach(e=>{
    if(e.action_type!=='defense')return;
    const obs=app.detailedEventToOffensiveObservation(e);
    if(!obs)return;
    const ref=reference?.contexts?.[obs.context];
    if(!ref||!ref.total)return;

    const v=obs.outcome==='point'?1:(obs.outcome==='attack_fault'?-1:0);
    const c=byContext[obs.context];
    attacks++; c.attacks++;
    if(obs.outcome==='point'){points++;c.points++}
    if(obs.outcome==='attack_fault'){faults++;c.faults++}
    realValue+=v;c.realValue+=v;
    expectedValue+=ref.mu;c.expectedValue+=ref.mu;
    expectedPoints+=ref.p;c.expectedPoints+=ref.p;
    expectedFaults+=ref.q;c.expectedFaults+=ref.q;
  });

  const performance=realValue-expectedValue;
  const performance100=attacks?100*performance/attacks:null;
  return {attacks,points,faults,realValue,expectedValue,expectedPoints,expectedFaults,performance,performance100,byContext};
};

app.opponentOffensivePerformanceHtml = function opponentOffensivePerformanceHtml(perf,population,title='Performance offensive adverse'){
  if(!perf||!perf.attacks)return '<div class="statsEmpty">Pas assez d’attaques adverses exploitables pour calculer la performance offensive adverse.</div>';
  const rows=app.OFFENSIVE_CONTEXTS.map(c=>{
    const x=perf.byContext[c.key];
    if(!x.attacks)return `<tr><td>${app.escapeHtml(c.label)}</td><td>0</td><td colspan="5">—</td></tr>`;
    const performance=x.realValue-x.expectedValue;
    const performance100=100*performance/x.attacks;
    return `<tr>
      <td>${app.escapeHtml(c.label)}</td>
      <td>${x.attacks}</td>
      <td>${x.points}</td>
      <td>${(Math.round(x.expectedPoints*10)/10).toFixed(1).replace('.',',')}</td>
      <td>${x.faults}</td>
      <td>${(Math.round(x.expectedFaults*10)/10).toFixed(1).replace('.',',')}</td>
      <td>${app.offensivePerf100Display(performance100,x.attacks)}</td>
    </tr>`;
  }).join('');

  return `<div class="analysisBlock" style="margin-top:14px">
    <div class="analysisSubsectionTitle" style="margin-bottom:8px">${app.escapeHtml(title)}</div>
    <div class="analysisSubtle" style="margin-bottom:10px">Référentiel ${population==='H'?'Hommes':'Femmes'} · attaques adverses reconstituées depuis nos actions défensives · voir ? pour les définitions.</div>
    <div class="statsMatchGrid">
      <div class="statsMatchCard"><span class="small">Attaques adverses</span><strong>${perf.attacks}</strong></div>
      <div class="statsMatchCard"><span class="small">Valeur réelle adverse</span><strong>${app.signed1(perf.realValue)}</strong></div>
      <div class="statsMatchCard"><span class="small">Valeur attendue</span><strong>${app.signed1(perf.expectedValue)}</strong></div>
      <div class="statsMatchCard"><span class="small">Performance offensive /100</span><strong>${app.offensivePerf100Display(perf.performance100,perf.attacks)}</strong></div>
    </div>
    <div class="analysisTableWrap" style="margin-top:10px">
      <table class="analysisTable">
        <thead><tr><th>Contexte</th><th>Att.</th><th>Pts</th><th>Pts att.</th><th>Fautes</th><th>Fautes att.</th><th>Perf. /100</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
};

app.statsOpponentDefenseEventsByCountry = function statsOpponentDefenseEventsByCountry(events){
  const groups={};
  let missingOpponent=0;
  (events||[]).forEach(e=>{
    if(e.action_type!=='defense')return;
    const obs=app.detailedEventToOffensiveObservation(e);
    if(!obs)return;
    const opponent=(e.opponent_name||'').trim();
    if(!opponent){missingOpponent++;return}
    if(!groups[opponent])groups[opponent]=[];
    groups[opponent].push(e);
  });
  return {groups,missingOpponent};
};

app.statsOneVsOneByOpponent = function statsOneVsOneByOpponent(events,reference){
  const groups={},eventGroups={};
  let missingOpponent=0;
  (events||[]).forEach(e=>{
    if(e.action_type!=='attaque'&&e.action_type!=='faute')return;
    const obs=app.detailedEventToOffensiveObservation(e);
    if(!obs)return;
    const opponent=(e.opponent_name||'').trim();
    if(!opponent){missingOpponent++;return}
    if(!groups[opponent])groups[opponent]=app.emptyOffensiveCounts();
    if(!eventGroups[opponent])eventGroups[opponent]=[];
    app.addOffensiveObservation(groups[opponent],obs.context,obs.outcome);
    eventGroups[opponent].push(e);
  });
  return {groups,eventGroups,missingOpponent};
};

app.statsOneVsOneHtml = function statsOneVsOneHtml(events,reference,population){
  const countries=[...new Set((events||[]).map(e=>(e.opponent_name||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
  if(!countries.length)return '<div class="statsEmpty">Aucun adversaire renseigné pour afficher un face-à-face.</div>';
  return `<div class="analysisBlock" style="margin-top:16px">
    <div class="row" style="justify-content:space-between;align-items:center;gap:10px">
      <div>
        <div class="analysisSubsectionTitle" style="margin:0">Face-à-face par pays</div>
        <div class="analysisSubtle" style="margin-top:4px">${countries.length} adversaire${countries.length>1?'s':''} disponible${countries.length>1?'s':''} · analyse détaillée sur une page dédiée.</div>
      </div>
      <button class="primary" type="button" onclick="openDetailedFaceoff()">Voir le face-à-face détaillé →</button>
    </div>
  </div>`;
};

app.teamOffensivePerformance = function teamOffensivePerformance(events,reference){
  let attacks=0,points=0,faults=0,realValue=0,expectedValue=0,expectedPoints=0,expectedFaults=0;
  const byContext={};
  app.OFFENSIVE_CONTEXTS.forEach(c=>byContext[c.key]={attacks:0,points:0,faults:0,realValue:0,expectedValue:0,expectedPoints:0,expectedFaults:0});

  (events||[]).forEach(e=>{
    if(e.action_type!=='attaque'&&e.action_type!=='faute')return;
    const obs=app.detailedEventToOffensiveObservation(e);
    if(!obs)return;
    const ref=reference?.contexts?.[obs.context];
    if(!ref||!ref.total)return;

    const v=obs.outcome==='point'?1:(obs.outcome==='attack_fault'?-1:0);
    const c=byContext[obs.context];
    attacks++; c.attacks++;
    if(obs.outcome==='point'){points++;c.points++}
    if(obs.outcome==='attack_fault'){faults++;c.faults++}
    realValue+=v;c.realValue+=v;
    expectedValue+=ref.mu;c.expectedValue+=ref.mu;
    expectedPoints+=ref.p;c.expectedPoints+=ref.p;
    expectedFaults+=ref.q;c.expectedFaults+=ref.q;
  });

  const impact=realValue-expectedValue;
  const impact100=attacks?100*impact/attacks:null;
  return {attacks,points,faults,realValue,expectedValue,expectedPoints,expectedFaults,impact,impact100,byContext};
};

app.offensiveSampleLabel = function offensiveSampleLabel(n){
  if(n<5)return {level:'too_small',html:'<span class="small" style="color:var(--warn)">Échantillon insuffisant (N&lt;5)</span>'};
  if(n<=15)return {level:'limited',html:'<span class="small" style="color:var(--warn)">Échantillon limité</span>'};
  return {level:'ok',html:''};
};

app.offensivePerf100Display = function offensivePerf100Display(value,n){
  const q=app.offensiveSampleLabel(n);
  if(q.level==='too_small')return `<span class="small">—</span><br>${q.html}`;
  return `<span class="${app.impactClass(value||0)}">${app.signed1(value)}</span>${q.html?`<br>${q.html}`:''}`;
};

app.teamOffensivePerformanceHtml = function teamOffensivePerformanceHtml(perf,population){
  if(!perf||!perf.attacks)return '<div class="statsEmpty">Pas assez d’attaques exploitables pour calculer la performance offensive de l’équipe.</div>';
  const cls=app.impactClass(perf.impact100||0);
  const rows=app.OFFENSIVE_CONTEXTS.map(c=>{
    const x=perf.byContext[c.key];
    if(!x.attacks)return `<tr><td>${app.escapeHtml(c.label)}</td><td>0</td><td colspan="5">—</td></tr>`;
    const impact=x.realValue-x.expectedValue;
    const impact100=100*impact/x.attacks;
    return `<tr>
      <td>${app.escapeHtml(c.label)}</td>
      <td>${x.attacks}</td>
      <td>${x.points}</td>
      <td>${(Math.round(x.expectedPoints*10)/10).toFixed(1).replace('.',',')}</td>
      <td>${x.faults}</td>
      <td>${(Math.round(x.expectedFaults*10)/10).toFixed(1).replace('.',',')}</td>
      <td>${app.offensivePerf100Display(impact100,x.attacks)}</td>
    </tr>`;
  }).join('');

  return `<div class="analysisBlock" style="margin-top:14px">
    <div class="analysisSubsectionTitle" style="margin-bottom:8px">Performance offensive de l’équipe</div>
    <div class="analysisSubtle" style="margin-bottom:10px">Référentiel ${population==='H'?'Hommes':'Femmes'} · mêmes contextes de départ · voir ? pour les définitions.</div>
    <div class="statsMatchGrid">
      <div class="statsMatchCard"><span class="small">Attaques</span><strong>${perf.attacks}</strong></div>
      <div class="statsMatchCard"><span class="small">Valeur réelle</span><strong>${app.signed1(perf.realValue)}</strong></div>
      <div class="statsMatchCard"><span class="small">Valeur attendue</span><strong>${app.signed1(perf.expectedValue)}</strong></div>
      <div class="statsMatchCard"><span class="small">Performance offensive /100</span><strong class="${cls}">${app.signed1(perf.impact100)}</strong></div>
    </div>
    <div class="analysisTableWrap" style="margin-top:10px">
      <table class="analysisTable">
        <thead><tr><th>Contexte</th><th>Att.</th><th>Pts</th><th>Pts att.</th><th>Fautes</th><th>Fautes att.</th><th>Perf. /100</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

  </div>`;
};

app.openDetailedFaceoff = function openDetailedFaceoff(){
  const groupId=app.$('#statsGroup')?.value||'';
  const params=new URLSearchParams();
  if(groupId)params.set('group',groupId);
  if(app.statsState.readOnlyViewer)params.set('viewer','1');
  const query=params.toString();
  window.location.href='face-a-face.html'+(query?'?'+query:'');
};

app.statsAnalysisSummaryHtml = function statsAnalysisSummaryHtml(events){
  const periods=[...new Set((events||[]).map(e=>e.period||'Non précisée'))].sort(app.analysisPeriodSort);
  const per=periods.map(period=>({period,...app.analysisStats((events||[]).filter(e=>(e.period||'Non précisée')===period))}));
  const periodTable=`<thead><tr>
    <th>Période</th><th>Taux d’attaque</th><th>Taux d’attaque adverse</th><th>Taux de fautes d’attaque</th>
  </tr></thead><tbody>${per.map(x=>`<tr>
    <td>${app.escapeHtml(x.period)}</td>
    <td>${app.analysisRateHtml(x.attack.points,x.attack.total)}</td>
    <td>${app.analysisOpponentAttackRateHtml(x.defense)}</td>
    <td>${app.analysisRateHtml(x.attack.faults,x.attack.total)}</td>
  </tr>`).join('')||'<tr><td colspan="4">Aucune donnée.</td></tr>'}</tbody>`;
  return `<div class="matchAnalysisSection statsEmbeddedSummary">
    <div class="analysisBlock">
      <h3>Cumul contre les deux adversaires</h3>
      ${app.analysisCombinedBreakdownHtml(events||[])}
    </div>
    <div class="analysisBlock">
      <h3>Par équipe adverse</h3>
      ${app.analysisOpponentBreakdownHtml(events||[])}
    </div>
    <div class="analysisBlock">
      <h3>Évolution par période</h3>
      <div class="analysisLegend"><span>Taux de point marqué</span><span class="defense">Taux d’attaque de l’adversaire</span><span class="attackFault">Taux de faute d’attaque</span></div>
      <div class="analysisPeriodChart">${app.analysisPeriodChartHtml(events||[],periods)}</div>
    </div>
    <div class="analysisBlock">
      <h3>Détail par période</h3>
      <div class="analysisTableWrap"><table class="analysisTable">${periodTable}</table></div>
    </div>
  </div>`;
};

app.switchStatsMatchView = function switchStatsMatchView(view){
  app.statsState.statsMatchView=view==='advanced'?'advanced':'summary';
  const root=app.$('#statsMatchSummary');
  if(!root)return;
  root.querySelectorAll('[data-stats-match-view]').forEach(b=>b.classList.toggle('active',b.dataset.statsMatchView===app.statsState.statsMatchView));
  root.querySelector('#statsMatchViewSummary')?.classList.toggle('hidden',app.statsState.statsMatchView!=='summary');
  root.querySelector('#statsMatchViewAdvanced')?.classList.toggle('hidden',app.statsState.statsMatchView!=='advanced');
};

app.statsReferenceHtml = function statsReferenceHtml(ref){
  if(!ref)return '<div class="statsEmpty">Référentiel indisponible.</div>';
  const rows=app.OFFENSIVE_CONTEXTS.map(c=>{
    const x=ref.contexts[c.key];
    const pct=v=>x.total?`${String(Math.round(1000*v)/10).replace('.',',')} %`:'—';
    return `<tr><td>${app.escapeHtml(c.label)}</td><td>${x.point}</td><td>${x.defended}</td><td>${x.attack_fault}</td><td>${x.total}</td><td>${pct(x.p)}</td><td>${pct(x.q)}</td><td>${x.total?(Math.round(1000*x.mu)/1000).toFixed(3).replace('.',','):'—'}</td></tr>`;
  }).join('');
  return `<div class="statsMatchGrid">
    <div class="statsMatchCard"><span class="small">Population</span><strong>${ref.population==='H'?'Hommes':'Femmes'}</strong></div>
    <div class="statsMatchCard"><span class="small">Observations</span><strong>${ref.total}</strong></div>
    <div class="statsMatchCard"><span class="small">Collecte rapide</span><strong>${ref.quickCount}</strong></div>
    <div class="statsMatchCard"><span class="small">Matchs détaillés</span><strong>${ref.detailedCount}</strong></div>
   </div>
   <div class="analysisTableWrap" style="margin-top:10px"><table class="analysisTable"><thead><tr><th>Contexte</th><th>Points</th><th>Défendus</th><th>Fautes</th><th>N</th><th>% point</th><th>% faute</th><th>μ = p − q</th></tr></thead><tbody>${rows}</tbody></table></div>
   <div class="analysisSubtle" style="margin-top:8px">Cette table provient uniquement de la version active. Les sources cochées pour une future version n’ont aucun effet tant que tu ne crées pas cette nouvelle version.</div>`;
};

app.formatReferenceDate = function formatReferenceDate(value){
  if(!value)return '';
  try{return new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}catch{return String(value)}
};

app.loadReferenceMeta = async function loadReferenceMeta(){
  const {data,error}=await app.db.rpc('get_active_offensive_reference_meta');
  if(error)throw error;
  app.statsState.referenceMeta=(data||[])[0]||null;
  const box=app.$('#statsReferenceActiveMeta');
  if(box){
    const m=app.statsState.referenceMeta;
    box.innerHTML=m
      ? `<span class="referenceVersionBadge">Version active</span> <strong>${app.escapeHtml(m.label)}</strong><div class="analysisSubtle" style="margin-top:4px">Créée le ${app.escapeHtml(app.formatReferenceDate(m.created_at))} · ${Number(m.source_counts?.matches||0)} match(s) · ${Number(m.source_counts?.quick_sessions||0)} collecte(s) rapide(s)</div>`
      : '<span class="small">Aucune version active.</span>';
  }
};

app.referenceSourcePopulationSelect = function referenceSourcePopulationSelect(source){
  if(source.source_type==='quick')return `<span class="sourcePopulation small">${source.population==='F'?'F':'H'}</span>`;
  const value=source.population||'';
  return `<select class="sourcePopulation" data-ref-population="${source.source_id}">
    <option value="" ${!value?'selected':''}>H/F ?</option>
    <option value="H" ${value==='H'?'selected':''}>H</option>
    <option value="F" ${value==='F'?'selected':''}>F</option>
  </select>`;
};

app.renderReferenceSources = function renderReferenceSources(){
  const box=app.$('#statsReferenceSources'),status=app.$('#statsReferenceSourceStatus');
  if(!box||!status)return;
  const rows=app.statsState.referenceSources||[];
  if(!rows.length){box.innerHTML='<div class="statsEmpty">Aucune source disponible.</div>';status.textContent='';return}
  const included=rows.filter(x=>x.included).length;
  status.textContent=`${included} source${included>1?'s':''} préparée${included>1?'s':''} pour la prochaine version · ${rows.length} disponible${rows.length>1?'s':''}`;
  box.innerHTML=rows.map(s=>`<div class="referenceSourceRow">
    <input type="checkbox" data-ref-include="${s.source_id}" data-ref-type="${s.source_type}" ${s.included?'checked':''}>
    <div class="sourceMain">
      <div class="sourceTitle">${app.escapeHtml(s.source_label||'Sans nom')}</div>
      <div class="sourceMeta">${app.escapeHtml(s.source_type==='quick'?'Collecte rapide':'Match détaillé')} · ${app.escapeHtml(s.source_date?app.formatDateShort(s.source_date):'Date ?')}${s.source_group?' · '+app.escapeHtml(s.source_group):''}${s.source_category?' · '+app.escapeHtml(s.source_category):''}</div>
    </div>
    ${app.referenceSourcePopulationSelect(s)}
    <div class="sourceVolume small">N=${Number(s.volume||0)}</div>
  </div>`).join('');
};

app.loadReferenceSources = async function loadReferenceSources(){
  if(!app.adminState.isAdmin){app.$('#statsReferenceManager')?.classList.add('hidden');return}
  app.$('#statsReferenceManager')?.classList.remove('hidden');
  const {data,error}=await app.db.rpc('get_offensive_reference_sources');
  if(error)throw error;
  app.statsState.referenceSources=data||[];
  app.renderReferenceSources();
  await app.loadReferenceVersions();
};

app.saveReferenceSources = async function saveReferenceSources(){
  if(!app.adminState.isAdmin)return;
  const rows=app.statsState.referenceSources||[];
  const box=app.$('#statsReferenceSources');
  if(!box)return;
  app.setCloud('Enregistrement…',true);
  for(const source of rows){
    const checkbox=box.querySelector(`[data-ref-include="${source.source_id}"]`);
    if(!checkbox)continue;
    const included=checkbox.checked;
    let population=source.population||null;
    if(source.source_type==='match'){
      population=box.querySelector(`[data-ref-population="${source.source_id}"]`)?.value||null;
      if(included&&!population){alert(`Choisis H ou F pour « ${source.source_label||'ce match'} ».`);app.setCloud('Synchronisé',true);return false}
    }
    const {error}=await app.db.rpc('set_offensive_reference_source',{p_source_type:source.source_type,p_source_id:source.source_id,p_included:included,p_population:population});
    if(error)throw error;
  }
  await app.loadReferenceSources();
  app.setCloud('Synchronisé',true);
  return true;
};

app.createReferenceVersion = async function createReferenceVersion(){
  if(!app.adminState.isAdmin)return;
  const saved=await app.saveReferenceSources();
  if(saved===false)return;
  const input=app.$('#statsReferenceVersionLabel');
  const label=(input?.value||'').trim();
  if(!label){alert('Donne un nom à la nouvelle version du référentiel.');input?.focus();return}
  if(!confirm(`Créer et activer le référentiel « ${label} » ?\n\nLes performances seront ensuite calculées avec cette nouvelle version.`))return;
  app.setCloud('Création du référentiel…',true);
  const {error}=await app.db.rpc('create_offensive_reference_version',{p_label:label});
  if(error)throw error;
  if(input)input.value='';
  await app.loadStatsReference();
  app.setCloud('Synchronisé',true);
};

app.loadReferenceVersions = async function loadReferenceVersions(){
  const {data,error}=await app.db.from('offensive_reference_versions').select('id,label,is_active,created_at,snapshot').order('created_at',{ascending:false}).limit(12);
  if(error)throw error;
  app.statsState.referenceVersions=data||[];
  const box=app.$('#statsReferenceVersions');if(!box)return;
  box.innerHTML=(data||[]).map(v=>{
    const counts=v.snapshot?.source_counts||{};
    return `<div class="referenceVersionItem"><div><strong>${app.escapeHtml(v.label)}</strong>${v.is_active?' <span class="referenceVersionBadge">active</span>':''}<div class="analysisSubtle">${app.escapeHtml(app.formatReferenceDate(v.created_at))}</div></div><div class="small">${Number(counts.matches||0)} match(s) · ${Number(counts.quick_sessions||0)} collecte(s)</div></div>`;
  }).join('')||'<div class="small">Aucune version.</div>';
};

app.renderStatsImpactMatchSelector = function renderStatsImpactMatchSelector(){
  const list=app.statsState.impactMatchList||[];
  const selected=new Set(app.statsState.impactMatchSelection||[]);
  const box=app.$('#statsImpactMatchSelector');
  const status=app.$('#statsImpactMatchSelectionStatus');
  if(!box||!status)return;

  const search=(app.statsState.impactMatchSearch||'').trim().toLowerCase();
  const typeFilter=app.statsState.impactMatchTypeFilter||'';

  if(!list.length){
    box.innerHTML='';
    status.textContent='';
    return;
  }

  const visible=list.filter(m=>{
    const hay=[
      m.label,
      m.match_type?.name,
      m.opponent1?.name,
      m.opponent2?.name,
      m.played_on
    ].filter(Boolean).join(' ').toLowerCase();
    const matchSearch=!search||hay.includes(search);
    const matchType=!typeFilter||(m.match_type?.name||'')===typeFilter;
    return matchSearch&&matchType;
  });

  box.innerHTML=visible.length
    ? visible.slice().reverse().map(m=>{
        const l=app.statsMatchDisplayLabel(m);
        return `<label class="statsMatchChoice">
          <input type="checkbox" data-impact-match-id="${m.id}" ${selected.has(m.id)?'checked':''}>
          <span><strong>${app.escapeHtml(l.title)}</strong><span class="small">${app.escapeHtml(l.meta)}</span></span>
        </label>`;
      }).join('')
    : '<div class="statsEmpty" style="grid-column:1/-1">Aucun match ne correspond aux filtres.</div>';

  const hiddenSelected=[...selected].filter(id=>!visible.some(m=>m.id===id)).length;
  status.textContent=`${selected.size} match${selected.size>1?'s':''} sélectionné${selected.size>1?'s':''}${hiddenSelected?` · ${hiddenSelected} masqué${hiddenSelected>1?'s':''} par les filtres`:''}`;

  box.querySelectorAll('input[data-impact-match-id]').forEach(input=>{
    input.onchange=()=>{
      const id=input.dataset.impactMatchId;
      const set=new Set(app.statsState.impactMatchSelection||[]);
      if(input.checked)set.add(id); else set.delete(id);
      app.statsState.impactMatchSelection=[...set];
      app.renderStatsImpactMatchSelector();
      app.renderStatsImpactSelection().catch(e=>{
        app.handleError('stats impact selection',e);
        app.$('#statsImpactContent').innerHTML=`<div class="statsEmpty">${app.escapeHtml(e.message||String(e))}</div>`;
      });
    };
  });
};

app.statsMatchSort = function statsMatchSort(a,b){
  return (a.played_on||'').localeCompare(b.played_on||'')||(a.label||'').localeCompare(b.label||'','fr');
};

app.statsImpactOrderStorageKey = function statsImpactOrderStorageKey(){
  return `kinball_stats_impact_match_order_${app.$('#statsGroup')?.value||'all'}`;
};

app.loadStatsImpactManualOrder = function loadStatsImpactManualOrder(){
  try{
    const raw=localStorage.getItem(app.statsImpactOrderStorageKey());
    const parsed=raw?JSON.parse(raw):[];
    app.statsState.impactMatchManualOrder=Array.isArray(parsed)?parsed.filter(Boolean):[];
  }catch{
    app.statsState.impactMatchManualOrder=[];
  }
};

app.saveStatsImpactManualOrder = function saveStatsImpactManualOrder(){
  try{localStorage.setItem(app.statsImpactOrderStorageKey(),JSON.stringify(app.statsState.impactMatchManualOrder||[]))}catch{}
};

app.statsImpactOrderedMatches = function statsImpactOrderedMatches(matches){
  const source=[...(matches||[])];
  const defaultSorted=[...source].sort(app.statsMatchSort);
  const ids=new Set(source.map(m=>m.id));
  const manual=(app.statsState.impactMatchManualOrder||[]).filter(id=>ids.has(id));
  const seen=new Set(manual);
  defaultSorted.forEach(m=>{if(!seen.has(m.id)){manual.push(m.id);seen.add(m.id)}});
  const map=Object.fromEntries(source.map(m=>[m.id,m]));
  return manual.map(id=>map[id]).filter(Boolean);
};

app.moveStatsImpactMatch = function moveStatsImpactMatch(matchId,delta){
  const ds=app.statsState.impactDataset;
  if(!ds)return;
  const ordered=app.statsImpactOrderedMatches(ds.matches||[]);
  const ids=ordered.map(m=>m.id);
  const index=ids.indexOf(matchId);
  const target=index+delta;
  if(index<0||target<0||target>=ids.length)return;
  [ids[index],ids[target]]=[ids[target],ids[index]];
  const other=(app.statsState.impactMatchManualOrder||[]).filter(id=>!ids.includes(id));
  app.statsState.impactMatchManualOrder=[...ids,...other];
  app.saveStatsImpactManualOrder();
  app.renderStatsImpactSelection().catch(e=>app.handleError('stats impact reorder',e));
};

app.statsImpactPlayersWithAttempts = function statsImpactPlayersWithAttempts(ds,scope='all'){
  return (ds.players||[]).filter(name=>app.playerOffensiveImpact(ds.events||[],name,scope).total>0)
    .sort((a,b)=>a.localeCompare(b,'fr'));
};

app.statsImpactPlayerSeries = function statsImpactPlayerSeries(ds,playerName,scope='all'){
  const matches=app.statsImpactOrderedMatches(ds.matches||[]);
  return matches.map(match=>{
    const perf=app.playerOffensiveImpact((ds.events||[]).filter(e=>e.match_id===match.id),playerName,scope);
    return {
      match,
      ...perf,
      label:app.formatDateShort(match.played_on)||'Date ?',
      shortLabel:(app.formatDateShort(match.played_on)||'Date ?').replace(/\//g,'/'),
      title:[app.formatDateShort(match.played_on)||'Date ?',match.label||'Match'].filter(Boolean).join(' · ')
    };
  });
};

app.statsImpactEvolutionChartHtml = function statsImpactEvolutionChartHtml(series){
  const items=(series||[]).filter(x=>x.total>0&&Number.isFinite(x.impact100));
  if(!items.length)return '<div class="statsEmpty">Pas assez de données pour tracer une évolution.</div>';
  const maxAbsRaw=Math.max(...items.map(x=>Math.abs(x.impact100)),5);
  const maxAbs=Math.max(5,Math.ceil(maxAbsRaw/5)*5);
  const width=Math.max(560,items.length*92);
  const height=230,left=46,right=14,top=24,bottom=54;
  const plotWidth=width-left-right,plotHeight=height-top-bottom;
  const valueToY=v=>top+plotHeight/2-(v/maxAbs)*(plotHeight/2);
  const step=plotWidth/Math.max(items.length-1,1);
  const ticks=[maxAbs,maxAbs/2,0,-maxAbs/2,-maxAbs].map(v=>{
    const y=valueToY(v);
    return `<g><line x1="${left}" x2="${width-right}" y1="${y}" y2="${y}" class="statsImpactGridLine"></line><text x="${left-8}" y="${y+3}" text-anchor="end" class="statsImpactTick">${String(Math.round(v*10)/10).replace('.',',')}</text></g>`;
  }).join('');
  const points=items.map((x,i)=>{
    const cx=items.length===1?left+plotWidth/2:left+step*i;
    const cy=valueToY(x.impact100);
    const q=app.offensiveSampleLabel(x.total).level;
    const cls=q==='too_small'?'statsImpactPointInsufficient':q==='limited'?'statsImpactPointLimited':'statsImpactPointSimple';
    const label=(app.formatDateShort(x.match.played_on)||'Date ?').slice(0,10);
    return {x,cx,cy,cls,label};
  });
  const poly=points.length>1?`<polyline points="${points.map(p=>`${p.cx},${p.cy}`).join(' ')}" class="statsImpactLineSimple"></polyline>`:'';
  const marks=points.map(p=>`<g>
    <title>${app.escapeHtml(p.x.title)} · N=${p.x.total} · performance /100 ${app.signed1(p.x.impact100)}</title>
    <circle cx="${p.cx}" cy="${p.cy}" r="5" class="${p.cls}"></circle>
    <text x="${p.cx}" y="${p.cy-10}" text-anchor="middle" class="statsImpactValueLabel">${app.signed1(p.x.impact100)}</text>
    <text x="${p.cx}" y="${height-22}" text-anchor="middle" class="statsImpactMatchLabel">${app.escapeHtml(p.label)}</text>
    <text x="${p.cx}" y="${height-9}" text-anchor="middle" class="statsImpactMatchLabel">N=${p.x.total}</text>
  </g>`).join('');
  return `<div class="analysisSubtle">Un point = un match. Orange = échantillon limité (5–15 attaques), gris = insuffisant (&lt;5).</div>
    <div class="statsImpactEvolutionSvgWrap">
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="statsImpactEvolutionSvg" role="img" aria-label="Performance offensive par match">
        ${ticks}
        <line x1="${left}" x2="${width-right}" y1="${valueToY(0)}" y2="${valueToY(0)}" class="statsImpactAxis"></line>
        ${poly}${marks}
      </svg>
    </div>`;
};

app.statsImpactEvolutionTableHtml = function statsImpactEvolutionTableHtml(series){
  const items=series||[];
  const rows=items.map((x,i)=>{
    const reliability=x.total?app.offensiveSampleLabel(x.total):{html:'<span class="small">Aucune attaque</span>'};
    return `<tr>
      <td>
        <div class="statsImpactEvolutionOrderCell">
          <button type="button" class="ghost statsImpactEvolutionOrderBtn" data-impact-move="${x.match.id}" data-impact-delta="-1" ${i===0?'disabled':''} title="Monter ce match">↑</button>
          <button type="button" class="ghost statsImpactEvolutionOrderBtn" data-impact-move="${x.match.id}" data-impact-delta="1" ${i===items.length-1?'disabled':''} title="Descendre ce match">↓</button>
        </div>
      </td>
      <td>${i+1}</td>
      <td>${app.escapeHtml(app.formatDateShort(x.match.played_on)||'—')}</td>
      <td>${app.escapeHtml(x.match.label||'Match')}</td>
      <td>${x.total}</td>
      <td>${x.total?app.actualVsReferencePctHtml(x.pointRate,x.expectedPointRate):'—'}</td>
      <td>${x.total?app.actualVsReferencePctHtml(x.faultRate,x.expectedFaultRate):'—'}</td>
      <td class="${app.impactClass(x.creation100||0)}">${x.total?app.signed1(x.creation100):'—'}</td>
      <td class="${app.impactClass(x.safety100||0)}">${x.total?app.signed1(x.safety100):'—'}</td>
      <td>${x.total?app.offensivePerf100Display(x.impact100,x.total):'—'}</td>
      <td>${x.total?reliability.html:'—'}</td>
    </tr>`;
  }).join('');
  return `<div class="analysisSubtle statsImpactEvolutionOrderHint">L’ordre suit la date par défaut. Utilise ↑ / ↓ pour corriger l’ordre réel des matchs joués le même jour. Cet ordre est mémorisé pour ce groupe.</div>
  <div class="analysisTableWrap">
    <table class="analysisTable">
      <thead><tr><th>Ordre</th><th>#</th><th>Date</th><th>Match</th><th>N</th><th>% points</th><th>% fautes</th><th>Création /100</th><th>Sécurité /100</th><th>Performance /100</th><th>Fiabilité</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="11">Aucun match.</td></tr>'}</tbody>
    </table>
  </div>`;
};

app.statsImpactEvolutionBlockHtml = function statsImpactEvolutionBlockHtml(ds,scope='all'){
  const players=app.statsImpactPlayersWithAttempts(ds,scope);
  if(!players.length)return '';
  let playerName=app.statsState.impactPlayerName||'';
  if(!players.includes(playerName))playerName=players[0];
  app.statsState.impactPlayerName=playerName;
  const overall=app.playerOffensiveImpact(ds.events||[],playerName,scope);
  const series=app.statsImpactPlayerSeries(ds,playerName,scope);
  return `<div class="statsImpactEvolutionBlock">
    <div class="analysisSubsectionTitle" style="margin-top:0">Évolution par match</div>
    <div class="statsImpactEvolutionControls">
      <div class="field">
        <label>Joueur</label>
        <select id="statsImpactPlayerSelect">${players.map(name=>`<option value="${app.escapeHtml(name)}" ${name===playerName?'selected':''}>${app.escapeHtml(name)}</option>`).join('')}</select>
      </div>
      <div class="analysisSubtle" style="flex:2 1 340px">
        Lecture chronologique des matchs sélectionnés. La performance /100 reste comparable malgré des volumes d’attaques différents, mais la fiabilité dépend fortement de N.
      </div>
    </div>
    ${app.statsImpactEvolutionTableHtml(series)}
    <details class="statsImpactEvolutionToggle">
      <summary>Afficher le graphique</summary>
      ${app.statsImpactEvolutionChartHtml(series)}
    </details>
  </div>`;
};

app.statsImpactEffectiveScope = function statsImpactEffectiveScope(){
  const base=app.statsState.impactScope||'all';
  if(base!=='restart')return base;
  const location=app.statsState.impactRestartLocation||'all';
  if(location==='center')return 'restart_center';
  if(location==='line')return 'restart_line';
  if(location==='corner')return 'restart_corner';
  return 'restart';
};

app.statsImpactScopeLabel = function statsImpactScopeLabel(scope){
  if(scope==='center')return 'Jeu au centre';
  if(scope==='restart_center')return 'Remise en jeu · centre';
  if(scope==='restart_line')return 'Remise en jeu · ligne';
  if(scope==='restart_corner')return 'Remise en jeu · coin';
  if(scope==='restart')return 'Remise en jeu · toutes';
  return 'Cumulé';
};

app.statsImpactQuantile = window.KinballCoach.calculations.statsImpactQuantile;

app.statsImpactAnonymousBenchmark = window.KinballCoach.calculations.statsImpactAnonymousBenchmark;

app.statsImpactBenchmarkText = function statsImpactBenchmarkText(bench,formatter=app.signed1){
  if(!bench)return '—';
  return `Moyenne groupe ${formatter(bench.mean)}`;
};

app.statsImpactPlayerContextRows = function statsImpactPlayerContextRows(ds,playerName){
  return [
    ['Jeu au centre','center'],
    ['Remise · centre','restart_center'],
    ['Remise · ligne','restart_line'],
    ['Remise · coin','restart_corner']
  ].map(([label,scope])=>({label,scope,...app.playerOffensiveImpact(ds.events||[],playerName,scope)}));
};

app.statsImpactPlayerContextTableHtml = function statsImpactPlayerContextTableHtml(ds,playerName){
  const rows=app.statsImpactPlayerContextRows(ds,playerName);
  const body=rows.map(x=>`<tr>
    <td>${app.escapeHtml(x.label)}</td>
    <td>${x.total}</td>
    <td>${x.total?app.actualVsReferencePctHtml(x.pointRate,x.expectedPointRate):'—'}</td>
    <td>${x.total?app.actualVsReferencePctHtml(x.faultRate,x.expectedFaultRate):'—'}</td>
    <td class="${app.impactClass(x.creation100||0)}">${x.total?app.signed1(x.creation100):'—'}</td>
    <td class="${app.impactClass(x.safety100||0)}">${x.total?app.signed1(x.safety100):'—'}</td>
  </tr>`).join('');
  return `<details class="statsImpactPlayerDetails" open>
    <summary>Détail par situation</summary>
    <div class="analysisSubtle" style="margin:8px 0">Les remises centre, ligne et coin restent consultables séparément. Les valeurs de référence s’affichent sous les taux observés.</div>
    <div class="analysisTableWrap"><table class="analysisTable">
      <thead><tr><th>Situation</th><th>N</th><th>% points</th><th>% fautes</th><th>Création /100</th><th>Sécurité /100</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </details>`;
};

app.statsImpactPlayerOpponentRows = function statsImpactPlayerOpponentRows(ds,playerName,scope){
  const grouped=new Map();
  (ds.events||[]).forEach(e=>{
    const name=e.opponent_name||'Équipe non précisée';
    if(!grouped.has(name))grouped.set(name,[]);
    grouped.get(name).push(e);
  });
  return [...grouped.entries()]
    .map(([name,events])=>{
      const total=app.playerOffensiveImpact(events,playerName,scope);
      const byMatch=new Map();
      events.forEach(e=>{
        const id=e.match_id||e.match?.id||'unknown';
        if(!byMatch.has(id))byMatch.set(id,[]);
        byMatch.get(id).push(e);
      });
      const matches=[...byMatch.entries()].map(([matchId,matchEvents])=>{
        const impact=app.playerOffensiveImpact(matchEvents,playerName,scope);
        const m=matchEvents[0]?.match||null;
        return {
          matchId,
          matchLabel:m?.label||m?.match_type?.name||'Match',
          playedOn:m?.played_on||'',
          competition:m?.match_type?.name||'',
          ...impact
        };
      }).filter(x=>x.total>0)
        .sort((a,b)=>(a.playedOn||'').localeCompare(b.playedOn||'')||(a.matchLabel||'').localeCompare(b.matchLabel||'','fr'));
      return {opponentName:name,...total,matches};
    })
    .filter(x=>x.total>0)
    .sort((a,b)=>{
      if(a.opponentName==='Équipe non précisée')return 1;
      if(b.opponentName==='Équipe non précisée')return -1;
      return a.opponentName.localeCompare(b.opponentName,'fr');
    });
};

app.statsImpactPlayerOpponentTableHtml = function statsImpactPlayerOpponentTableHtml(ds,playerName,scope){
  const rows=app.statsImpactPlayerOpponentRows(ds,playerName,scope);
  if(!rows.length)return `<details class="statsImpactPlayerDetails statsImpactOpponentBlock" open>
    <summary>Performance par adversaire</summary>
    <div class="statsEmpty">Aucune attaque attribuée contre un adversaire dans cette sélection.</div>
  </details>`;

  const body=rows.map((x,idx)=>{
    const expandable=x.matches.length>1;
    const parent=`<tr>
      <td>${expandable
        ?`<div class="statsImpactOpponentToggle" data-stats-impact-opponent-toggle="${idx}"><span class="chev">▶</span><strong>${app.escapeHtml(x.opponentName)}</strong><span class="small">${x.matches.length} matchs</span></div>`
        :`<strong>${app.escapeHtml(x.opponentName)}</strong>`}
      </td>
      <td>${x.total}</td>
      <td>${x.points}</td>
      <td>${x.faults}</td>
      <td>${x.defended}</td>
      <td>${x.total?app.actualVsReferencePctHtml(x.pointRate,x.expectedPointRate):'—'}</td>
      <td>${x.total?app.actualVsReferencePctHtml(x.faultRate,x.expectedFaultRate):'—'}</td>
      <td class="${app.impactClass(x.creation100||0)}">${x.total?app.signed1(x.creation100):'—'}</td>
      <td class="${app.impactClass(x.safety100||0)}">${x.total?app.signed1(x.safety100):'—'}</td>
    </tr>`;

    const children=expandable?x.matches.map(m=>`<tr class="statsImpactOpponentMatchRow hidden" data-stats-impact-opponent-child="${idx}">
      <td class="statsImpactOpponentMatchLabel">
        <strong>${app.escapeHtml(m.matchLabel||'Match')}</strong>
        <span class="statsImpactOpponentMatchMeta">${app.escapeHtml(app.formatDateShort(m.playedOn)||'')}${m.competition?' · '+app.escapeHtml(m.competition):''}</span>
      </td>
      <td>${m.total}</td>
      <td>${m.points}</td>
      <td>${m.faults}</td>
      <td>${m.defended}</td>
      <td>${m.total?app.actualVsReferencePctHtml(m.pointRate,m.expectedPointRate):'—'}</td>
      <td>${m.total?app.actualVsReferencePctHtml(m.faultRate,m.expectedFaultRate):'—'}</td>
      <td class="${app.impactClass(m.creation100||0)}">${m.total?app.signed1(m.creation100):'—'}</td>
      <td class="${app.impactClass(m.safety100||0)}">${m.total?app.signed1(m.safety100):'—'}</td>
    </tr>`).join(''):'';

    return parent+children;
  }).join('');

  return `<details class="statsImpactPlayerDetails statsImpactOpponentBlock" open>
    <summary>Performance par adversaire</summary>
    <div class="analysisSubtle" style="margin:8px 0">
      Les mêmes filtres de matchs et de contexte s’appliquent. Quand un adversaire a été rencontré plusieurs fois, clique sur son nom pour afficher le détail de chaque match.
    </div>
    <div class="analysisTableWrap"><table class="analysisTable">
      <thead><tr>
        <th>Adversaire</th>
        <th>N</th>
        <th>Points</th>
        <th>Fautes</th>
        <th>Défendus</th>
        <th>% points</th>
        <th>% fautes</th>
        <th>Création /100</th>
        <th>Sécurité /100</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </details>`;
};

app.bindStatsImpactOpponentBreakdowns = function bindStatsImpactOpponentBreakdowns(root){
  (root||document).querySelectorAll('[data-stats-impact-opponent-toggle]').forEach(el=>{
    el.onclick=()=>{
      const id=el.dataset.statsImpactOpponentToggle;
      const rows=(root||document).querySelectorAll(`[data-stats-impact-opponent-child="${CSS.escape(id)}"]`);
      const opening=[...rows].some(r=>r.classList.contains('hidden'));
      rows.forEach(r=>r.classList.toggle('hidden',!opening));
      el.classList.toggle('open',opening);
    };
  });
};

app.statsImpactPlayerViewHtml = function statsImpactPlayerViewHtml(ds,allRows,scope){
  const players=(ds.players||[]).filter(Boolean).filter(name=>app.playerOffensiveImpact(ds.events||[],name,scope).total>0).sort((a,b)=>a.localeCompare(b,'fr'));
  if(!players.length)return '<div class="statsEmpty">Aucune attaque attribuée à un joueur dans cette vue.</div>';
  let playerName=app.statsState.impactPlayerName||'';
  if(!players.includes(playerName))playerName=players[0];
  app.statsState.impactPlayerName=playerName;
  const x=app.playerOffensiveImpact(ds.events||[],playerName,scope);
  const creationBench=app.statsImpactAnonymousBenchmark(allRows,'creation100');
  const safetyBench=app.statsImpactAnonymousBenchmark(allRows,'safety100');
  const pointBench=app.statsImpactAnonymousBenchmark(allRows,'pointRate');
  const faultBench=app.statsImpactAnonymousBenchmark(allRows,'faultRate');
  const pct=v=>app.pct1(v);
  return `<div class="statsImpactPlayerSheet">
    <div class="statsImpactPlayerHeader">
      <div><div class="analysisSubtle">${app.escapeHtml(app.statsImpactScopeLabel(scope))}</div><h3>${app.escapeHtml(playerName)}</h3></div>
      <div class="statsImpactPlayerVolume"><span class="small">Volume analysé</span><strong>N = ${x.total}</strong></div>
    </div>
    ${app.playerVolumeWarningHtml(x.total)}
    <div class="statsImpactPlayerMainMetrics">
      <div class="statsImpactPlayerMetric"><span>Création /100</span><strong class="${app.impactClass(x.creation100||0)}">${x.total?app.signed1(x.creation100):'—'}</strong><small>${app.statsImpactBenchmarkText(creationBench,app.signed1)}</small></div>
      <div class="statsImpactPlayerMetric"><span>Sécurité /100</span><strong class="${app.impactClass(x.safety100||0)}">${x.total?app.signed1(x.safety100):'—'}</strong><small>${app.statsImpactBenchmarkText(safetyBench,app.signed1)}</small></div>
    </div>
    <div class="statsImpactPlayerSecondaryMetrics">
      <div class="statsImpactPlayerSecondary"><span>% points</span><strong>${x.total?app.pct1(x.pointRate):'—'}</strong><small>Référentiel ${app.pct1(x.expectedPointRate)} · ${app.statsImpactBenchmarkText(pointBench,pct)}</small></div>
      <div class="statsImpactPlayerSecondary"><span>% fautes</span><strong>${x.total?app.pct1(x.faultRate):'—'}</strong><small>Référentiel ${app.pct1(x.expectedFaultRate)} · ${app.statsImpactBenchmarkText(faultBench,pct)}</small></div>
    </div>
    <div class="analysisSubtle statsImpactPlayerBenchmarkNote">La moyenne du groupe est calculée anonymement sur les joueurs ayant au moins une attaque dans la sélection et la situation affichée (${allRows.filter(r=>r.total>0).length} joueurs). Elle sert uniquement de repère collectif, sans classement.</div>
    <details class="statsImpactPlayerExplainer" open>
      <summary>Comprendre le référentiel et les scores</summary>
      <div class="statsImpactPlayerExplainerBody">
        <p><strong>Le référentiel</strong> est construit à partir des attaques de la compétition de référence sélectionnées par le staff. Les données Hommes et Femmes sont séparées, ainsi que les situations : jeu au centre, remise au centre, sur ligne et sur coin.</p>
        <p>Pour chaque situation, le référentiel donne le <strong>taux de points</strong> et le <strong>taux de fautes</strong> observés sur l'ensemble des attaques retenues. Il s'agit donc d'une moyenne pondérée par le nombre d'attaques, et non d'un classement des joueurs.</p>
        <div class="statsImpactPlayerExplainerFormula"><strong>Création /100</strong> : combien de points supplémentaires (ou manquants) le joueur produit sur 100 attaques par rapport au nombre de points attendu selon le référentiel.</div>
        <div class="statsImpactPlayerExplainerFormula"><strong>Sécurité /100</strong> : combien de fautes le joueur évite (ou ajoute) sur 100 attaques par rapport au nombre de fautes attendu selon le référentiel.</div>
        <p><strong>Un score de 0</strong> signifie que le joueur est exactement au niveau moyen observé dans la compétition ayant servi de référentiel, pour les situations qu'il a réellement jouées. Un score positif est au-dessus de ce niveau de référence ; un score négatif est en dessous.</p>
        <p><strong>Attention au volume analysé.</strong> Les scores sont ramenés à 100 attaques : avec peu d'actions, une seule action peut donc modifier fortement le résultat. En pratique, <strong>N &lt; 5</strong> est trop faible pour conclure ; entre <strong>5 et 15</strong>, le score donne seulement une tendance provisoire ; au-delà de <strong>15</strong>, il devient plus stable, sans supprimer toute incertitude.</p>
        <p>Exemple : <strong>Création +5</strong> signifie environ 5 points de plus que prévu sur 100 attaques ; <strong>Sécurité +3</strong> signifie environ 3 fautes de moins que prévu sur 100 attaques.</p>
      </div>
    </details>
    ${app.statsImpactPlayerContextTableHtml(ds,playerName)}
    ${app.statsImpactPlayerOpponentTableHtml(ds,playerName,scope)}
  </div>`;
};

app.statsImpactLoadCoachMessage = async function statsImpactLoadCoachMessage(groupId,playerName){
  const input=app.$('#statsImpactCoachMessageInput');
  const status=app.$('#statsImpactCoachMessageStatus');
  const save=app.$('#statsImpactCoachMessageSave');
  if(!input||!save||!groupId||!playerName)return;
  input.disabled=true;save.disabled=true;if(status)status.textContent='Chargement…';
  try{
    const players=await app.fetchGroupPlayers(groupId);
    const player=players.find(p=>p.display_name===playerName);
    if(!player){if(status)status.textContent='Joueur introuvable dans le groupe.';return;}
    input.dataset.playerId=player.id;
    const {data,error}=await app.db.from('coaching_player_messages').select('message,updated_at').eq('group_id',groupId).eq('player_id',player.id).maybeSingle();
    if(error)throw error;
    input.value=data?.message||'';
    if(status)status.textContent=data?.updated_at?'Message enregistré.':'';
    input.disabled=false;save.disabled=false;
    save.onclick=()=>app.statsImpactSaveCoachMessage(groupId,player.id);
  }catch(e){
    if(status)status.textContent='Impossible de charger le message.';
    app.handleError('load player coach message',e);
  }
};

app.statsImpactSaveCoachMessage = async function statsImpactSaveCoachMessage(groupId,playerId){
  const input=app.$('#statsImpactCoachMessageInput');
  const status=app.$('#statsImpactCoachMessageStatus');
  const save=app.$('#statsImpactCoachMessageSave');
  if(!input||!groupId||!playerId)return;
  const message=input.value.trim();
  if(save)save.disabled=true;if(status)status.textContent='Enregistrement…';
  try{
    const {error}=await app.db.from('coaching_player_messages').upsert({group_id:groupId,player_id:playerId,message,updated_at:new Date().toISOString()},{onConflict:'group_id,player_id'});
    if(error)throw error;
    if(status)status.textContent='Message enregistré.';
  }catch(e){
    if(status)status.textContent='Erreur lors de l’enregistrement.';
    app.handleError('save player coach message',e);
  }finally{if(save)save.disabled=false;}
};

app.prepareStatsModuleForGroup = async function prepareStatsModuleForGroup(groupId,{readOnly=false}={}){
  app.hideMainModules();app.setMatchHeaderMode(false);
  app.$('#statsHome').classList.remove('hidden');
  app.statsState.readOnlyViewer=!!readOnly;
  app.statsState.viewerReturnGroupId=readOnly?groupId:null;
  app.$('#statsReadOnlyBadge')?.classList.toggle('hidden',!readOnly);
  if(app.$('#statsBackHome'))app.$('#statsBackHome').textContent=readOnly?'← Espace joueur':'← Accueil';
  app.$('#openQuickCollectionFromReference')?.classList.toggle('hidden',!!readOnly);
  if(readOnly)app.$('#statsReferenceManager')?.classList.add('hidden');
  app.statsState.tab='group';app.statsState.domain='training';app.statsState.leaderMode='recent';
  app.$$('.statsLeaderboardMode').forEach(b=>b.classList.toggle('active',b.dataset.leaderMode==='recent'));
  app.switchStatsTab('group');
  app.switchStatsDomain('training');
  await app.loadStatsData(groupId);
  const group=app.statsGroupMeta(groupId);
  const pop=app.groupPopulationFromName(group?.name)||'H';
  if(app.$('#statsReferencePopulation'))app.$('#statsReferencePopulation').value=pop;
  if(app.$('#statsImpactPopulation'))app.$('#statsImpactPopulation').value=pop;
  if(app.$('#statsImpactSortField'))app.$('#statsImpactSortField').value=app.statsState.impactSortField||'impact100';
  if(app.$('#statsImpactSortDirection'))app.$('#statsImpactSortDirection').value=app.statsState.impactSortDirection||'desc';
  if(app.$('#statsImpactRestartLocation'))app.$('#statsImpactRestartLocation').value=app.statsState.impactRestartLocation||'all';
  app.$('#statsImpactRestartFilter')?.classList.toggle('hidden',(app.statsState.impactScope||'all')!=='restart');
  window.scrollTo({top:0,behavior:'instant'});
};

app.openStatsModule = async function openStatsModule(){
  try{
    app.statsState.readOnlyViewer=false;
    await app.fetchMyGroups();
    const sel=app.$('#statsGroup');
    if(sel){sel.disabled=false;sel.innerHTML='<option value="">— Choisir un groupe —</option>';app.groupState.groups.forEach(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.name;sel.append(o)});sel.value=app.groupState.groups[0]?.id||''}
    await app.prepareStatsModuleForGroup(sel?.value||'',{readOnly:false});
  }catch(e){app.handleError('stats',e);app.$('#statsStatus').textContent=e.message||String(e)}
};

app.openGroupStatsViewer = async function openGroupStatsViewer(access){
  try{
    if(!access||access.stats_access!=='group')throw new Error('Cet accès aux statistiques du groupe n’est pas autorisé.');
    const allowed=(app.playerPortalState.accesses||[]).filter(a=>a.stats_access==='group');
    const sel=app.$('#statsGroup');
    if(sel){
      sel.innerHTML=allowed.map(a=>`<option value="${app.escapeHtml(a.group_id)}">${app.escapeHtml(a.group_name)}</option>`).join('');
      sel.value=access.group_id;
      sel.disabled=allowed.length<=1;
    }
    history.replaceState(null,'',location.pathname+'#team-stats');
    await app.prepareStatsModuleForGroup(access.group_id,{readOnly:true});
    return true;
  }catch(e){app.handleError('group stats viewer',e);alert(e.message||String(e));return false}
};

app.render = function render(){
  app.buildActionOpponentOptions();
  app.$('#count').textContent=app.state.events.length+' action'+(app.state.events.length>1?'s':'');
  const last=app.state.events.at(-1);
  app.$('#last').textContent=last
    ? `${last.action}${last.faultType?' · '+last.faultType:''} · ${app.labelContext(last.context)}${last.opponentTeam?' · '+last.opponentTeam:''}${last.zone?' · '+last.zone:''}${last.movement?' · déplacement '+last.movement.toLowerCase():''} · ${app.eventAttributionLabel(last)}`
    : 'Aucune';
  const t=app.$('#timeline');t.innerHTML='';
  [...app.state.events].reverse().forEach(e=>{
    const d=document.createElement('div');d.className='item';
    const detail=e.faultType?e.faultType:e.action,pos=e.videoPosition||'—';
    d.innerHTML=`<div class="time">${app.escapeHtml(pos)}<br>${app.escapeHtml(e.period)}</div><div><strong>${app.escapeHtml(detail)}</strong><div class="small">${app.escapeHtml(app.labelContext(e.context))}${e.opponentTeam?' · '+app.escapeHtml(e.opponentTeam):''}${e.zone?' · '+app.escapeHtml(({E1:'A1',E2:'P',E3:'A2'}[e.zone]||e.zone)):''}${e.movement?' · déplacement '+app.escapeHtml(e.movement.toLowerCase()):''} · ${app.escapeHtml(app.eventAttributionLabel(e))}</div></div>`;
    d.onclick=()=>app.editEvent(e.id);
    const controls=document.createElement('div');controls.className='row';
    const edit=document.createElement('button');edit.className='ghost';edit.textContent='Modifier';edit.onclick=evt=>{evt.stopPropagation();app.editEvent(e.id)};
    const del=document.createElement('button');del.className='ghost';del.textContent='Suppr.';
    del.onclick=async evt=>{
      evt.stopPropagation();
      if(!confirm('Supprimer cette action ?'))return;
      try{
        const {error}=await app.db.from('match_events').delete().eq('id',e.id);
        if(error)throw error;
        app.state.events=app.state.events.filter(x=>x.id!==e.id);app.render();app.setCloud('Synchronisé',true);
      }catch(err){app.handleError('delete event',err)}
    };
    controls.append(edit,del);d.append(controls);t.append(d)
  });
};
app.populateStatsSelectors = function populateStatsSelectors(){
  const playerSel=app.$('#statsPlayer');
  const playerCurrent=playerSel?.value||'';
  if(playerSel){
    playerSel.innerHTML='<option value="">— Choisir —</option>';
    app.statsState.players.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.display_name;playerSel.append(o)});
    if([...playerSel.options].some(o=>o.value===playerCurrent))playerSel.value=playerCurrent;
  }

  const exs=Object.values(app.statsState.exerciseMap).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
  const exSel=app.$('#statsExercise');
  const exCurrent=exSel?.value||'';
  if(exSel){
    exSel.innerHTML='<option value="">— Choisir —</option>';
    exs.forEach(ex=>{const o=document.createElement('option');o.value=ex.id;o.textContent=ex.name;exSel.append(o)});
    if([...exSel.options].some(o=>o.value===exCurrent))exSel.value=exCurrent;
  }
  app.populateStatsPlayerExercises();
};

app.populateStatsPlayerExercises = function populateStatsPlayerExercises(){
  const playerSel=app.$('#statsPlayer'),sel=app.$('#statsPlayerExercise');
  if(!sel)return;
  const pid=playerSel?.value||'',cur=sel.value||'';
  sel.innerHTML='<option value="">— Choisir —</option>';
  const ids=[...new Set(app.statsState.results.filter(r=>r.player_id===pid).map(r=>r.exercise_id))];
  ids.map(id=>app.statsState.exerciseMap[id]).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name,'fr')).forEach(ex=>{
    const o=document.createElement('option');o.value=ex.id;o.textContent=ex.name;sel.append(o);
  });
  if([...sel.options].some(o=>o.value===cur))sel.value=cur;
};

app.renderStatsPlayer = function renderStatsPlayer(){
  const pid=app.$('#statsPlayer')?.value||'';
  const m=app.$('#statsPlayerMetrics'),sum=app.$('#statsPlayerExerciseSummary'),evo=app.$('#statsPlayerEvolution');
  m.innerHTML='';sum.innerHTML='';evo.innerHTML='';
  if(!pid){m.innerHTML='<div class="statsEmpty" style="grid-column:1/-1">Choisis un joueur.</div>';return}
  const att=app.statsState.attendance.filter(a=>a.player_id===pid);
  const present=att.filter(a=>a.present);
  const rate=att.length?Math.round(100*present.length/att.length):0;
  const dates=present.map(a=>app.statsState.sessionMap[a.session_id]?.trained_on).filter(Boolean).sort();
  m.innerHTML=app.statsMetric('Présence',att.length?rate+' %':'—')+
    app.statsMetric('Séances suivies',present.length)+
    app.statsMetric('Dernier entraînement',dates.length?app.formatDateShort(dates.at(-1)):'—');

  const exId=app.$('#statsPlayerExercise')?.value||'';
  if(!exId){sum.innerHTML='<div class="statsEmpty">Choisis un exercice pour voir l’évolution.</div>';return}
  const ex=app.statsState.exerciseMap[exId];if(!ex)return;
  const rows=app.statsState.results.filter(r=>r.player_id===pid&&r.exercise_id===exId)
    .sort((a,b)=>(app.statsState.sessionMap[a.session_id]?.trained_on||'').localeCompare(app.statsState.sessionMap[b.session_id]?.trained_on||''));
  if(!rows.length){sum.innerHTML='<div class="statsEmpty">Aucun résultat sur cet exercice.</div>';return}
  const last=rows.at(-1),best=app.statsBestRow(rows,ex.measurement_type),recent=rows.slice(-3);
  sum.innerHTML=`<div class="statsMetrics">${app.statsMetric('Dernier',app.statsFormatSingle(last,ex.measurement_type))}${app.statsMetric('Moyenne récente',app.statsFormatAggregate(recent,ex.measurement_type),'3 derniers résultats')}${app.statsMetric('Meilleur',app.statsFormatSingle(best,ex.measurement_type))}</div>`;
  const values=rows.map(r=>app.statsValueNumber(r,ex.measurement_type)).filter(v=>v!=null);
  const labels=rows.filter(r=>app.statsValueNumber(r,ex.measurement_type)!=null).map(r=>app.formatDateShort(app.statsState.sessionMap[r.session_id]?.trained_on||''));
  evo.innerHTML=values.length>1?`<h3 style="font-size:16px;margin:12px 0 6px">Évolution</h3>${app.statsSparkline(values,labels)}`:'';
};

app.renderStatsExercise = function renderStatsExercise(){
  const exId=app.$('#statsExercise')?.value||'';
  const metrics=app.$('#statsExerciseMetrics'),evo=app.$('#statsExerciseEvolution'),leader=app.$('#statsLeaderboard'),hint=app.$('#statsLeaderboardHint');
  metrics.innerHTML='';evo.innerHTML='';leader.innerHTML='';hint.textContent='';
  const ex=app.statsState.exerciseMap[exId];
  const dual=app.isDualExercise(ex);
  app.$('#statsExerciseFocusWrap').classList.toggle('hidden',!dual);
  if(!ex){metrics.innerHTML='<div class="statsEmpty" style="grid-column:1/-1">Choisis un exercice.</div>';return}
  const focus=dual?(app.$('#statsExerciseFocus')?.value||'attaque'):null;
  const sx=app.statsState.sessionExercises.filter(x=>x.exercise_id===exId&&(!focus||x.focus===focus));
  const sessionIds=new Set(sx.map(x=>x.session_id));
  const rows=app.statsState.results.filter(r=>r.exercise_id===exId&&sessionIds.has(r.session_id));
  const evaluated=new Set(rows.map(r=>r.player_id)).size;
  const best=app.statsBestRow(rows,ex.measurement_type);
  metrics.innerHTML=app.statsMetric('Utilisé',`${sessionIds.size} séance${sessionIds.size>1?'s':''}`)+
    app.statsMetric('Joueurs évalués',evaluated||'—')+
    app.statsMetric('Moyenne groupe',app.statsFormatAggregate(rows,ex.measurement_type))+
    app.statsMetric('Meilleur résultat',app.statsFormatSingle(best,ex.measurement_type));

  const bySession=[...sessionIds].map(sid=>{
    const rr=rows.filter(r=>r.session_id===sid);
    let val=null;
    if(ex.measurement_type==='success_attempts'){
      const s=rr.reduce((a,r)=>a+(Number(r.successes)||0),0),a=rr.reduce((a,r)=>a+(Number(r.attempts)||0),0);
      if(a>0)val=100*s/a;
    }else{
      const vals=rr.map(r=>Number(r.numeric_value)).filter(Number.isFinite);
      if(vals.length)val=vals.reduce((a,b)=>a+b,0)/vals.length;
    }
    return {date:app.statsState.sessionMap[sid]?.trained_on||'',val};
  }).filter(x=>x.val!=null).sort((a,b)=>a.date.localeCompare(b.date));
  if(bySession.length>1)evo.innerHTML=`<h3 style="font-size:16px;margin:12px 0 6px">Évolution du groupe</h3>${app.statsSparkline(bySession.map(x=>x.val),bySession.map(x=>app.formatDateShort(x.date)))}`;

  app.renderStatsLeaderboard(rows,ex);
};

app.statsGroupMatchList = async function statsGroupMatchList(){
  const groupId=app.$('#statsGroup')?.value||'';
  if(!groupId)return [];
  const {data,error}=await app.db.from('matches')
    .select('id,label,played_on,match_type:match_types!matches_match_type_id_fkey(name),opponent1:teams!matches_opponent_team_1_id_fkey(name),opponent2:teams!matches_opponent_team_2_id_fkey(name)')
    .eq('group_id',groupId)
    .order('played_on',{ascending:true});
  if(error)throw error;
  return data||[];
};

app.renderStatsMatchesSelection = async function renderStatsMatchesSelection(){
  const box=app.$('#statsMatchSummary');
  const groupId=app.$('#statsGroup')?.value||'';
  const selected=(app.statsState.matchSelection||[]).filter(id=>(app.statsState.matchList||[]).some(m=>m.id===id));
  if(!groupId){box.innerHTML='<div class="statsEmpty">Choisis un groupe.</div>';return}
  if(!selected.length){
    app.statsState.matchDataset=null;
    box.innerHTML='<div class="statsEmpty">Sélectionne au moins un match. Tu peux en cocher plusieurs pour construire un cumul.</div>';
    return;
  }

  box.innerHTML='<div class="statsEmpty">Chargement…</div>';
  const ds=await app.loadMatchAnalysisDataset(selected);
  app.statsState.matchDataset=ds;

  const attacks=app.statsOutcomeCounts(ds.events,'attack');
  const adverse=app.statsOutcomeCounts(ds.events,'defense');
  const group=app.statsGroupMeta(groupId);
  const population=app.groupPopulationFromName(group?.name)||'H';
  let offensiveReference=null;
  try{offensiveReference=await app.loadOffensiveReference(population)}catch(e){console.error('stats 1v1 reference',e)}
  const teamPerformance=app.teamOffensivePerformance(ds.events,offensiveReference);
  const opponentPerformance=app.opponentOffensivePerformance(ds.events,offensiveReference);
  const attackTotals=Object.values(attacks.counts).reduce((a,x)=>({point:a.point+x.point,defended:a.defended+x.defended,attack_fault:a.attack_fault+x.attack_fault,total:a.total+x.total}),{point:0,defended:0,attack_fault:0,total:0});
  const pointRate=attackTotals.total?Math.round(1000*attackTotals.point/attackTotals.total)/10:null;
  const faultRate=attackTotals.total?Math.round(1000*attackTotals.attack_fault/attackTotals.total)/10:null;

  const currentView=app.statsState.statsMatchView==='advanced'?'advanced':'summary';
  box.innerHTML=`<div class="analysisSubtle" style="margin-bottom:8px">${selected.length===1?'Analyse du match sélectionné':`Cumul construit sur ${selected.length} matchs sélectionnés`}.</div>
   <div class="statsMatchViewTabs">
    <button type="button" class="ghost ${currentView==='summary'?'active':''}" data-stats-match-view="summary">Résumé</button>
    <button type="button" class="ghost ${currentView==='advanced'?'active':''}" data-stats-match-view="advanced">Analyse avancée</button>
   </div>
   <div id="statsMatchViewSummary" class="${currentView==='summary'?'':'hidden'}">
    ${app.statsAnalysisSummaryHtml(ds.events)}
   </div>
   <div id="statsMatchViewAdvanced" class="${currentView==='advanced'?'':'hidden'}">
    <div class="statsMatchGrid">
     <div class="statsMatchCard"><span class="small">Matchs inclus</span><strong>${selected.length}</strong></div>
     <div class="statsMatchCard"><span class="small">Attaques exploitables</span><strong>${attackTotals.total}</strong></div>
     <div class="statsMatchCard"><span class="small">Taux de point</span><strong>${pointRate==null?'—':String(pointRate).replace('.',',')+' %'}</strong></div>
     <div class="statsMatchCard"><span class="small">Taux de faute</span><strong>${faultRate==null?'—':String(faultRate).replace('.',',')+' %'}</strong></div>
    </div>
    ${app.teamOffensivePerformanceHtml(teamPerformance,population)}
    ${app.opponentOffensivePerformanceHtml(opponentPerformance,population,'Performance offensive de nos adversaires contre nous')}
    ${app.statsContextTable(attacks.counts,'Attaque de l’équipe suivie')}
    ${app.statsContextTable(adverse.counts,'Attaque adverse observée via notre défense')}
    ${app.statsOneVsOneHtml(ds.events,offensiveReference,population)}
    <div class="analysisSubtle" style="margin-top:8px">Centre / ligne / coin correspondent à la position de départ de l’attaque ou de la remise en jeu.</div>
   </div>`;
  box.querySelectorAll('[data-stats-match-view]').forEach(b=>b.onclick=()=>app.switchStatsMatchView(b.dataset.statsMatchView));
};

app.loadStatsMatches = async function loadStatsMatches(){
  const box=app.$('#statsMatchSummary');
  const groupId=app.$('#statsGroup')?.value||'';
  if(!groupId){
    app.statsState.matchList=[];
    app.statsState.matchSelection=[];
    app.renderStatsMatchSelector();
    box.innerHTML='<div class="statsEmpty">Choisis un groupe.</div>';
    return;
  }

  const list=await app.statsGroupMatchList();
  app.statsState.matchList=list;

  const typeSelect=app.$('#statsMatchTypeFilter');
  const types=[...new Set(list.map(m=>m.match_type?.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
  if(typeSelect){
    typeSelect.innerHTML='<option value="">Toutes les compétitions</option>'+types.map(t=>`<option value="${app.escapeHtml(t)}">${app.escapeHtml(t)}</option>`).join('');
    typeSelect.value=types.includes(app.statsState.matchTypeFilter)?app.statsState.matchTypeFilter:'';
    app.statsState.matchTypeFilter=typeSelect.value;
  }

  if(!list.length){
    app.statsState.matchSelection=[];
    app.statsState.matchSelectionGroupId=groupId;
    app.renderStatsMatchSelector();
    box.innerHTML='<div class="statsEmpty">Aucun match enregistré dans ce groupe.</div>';
    return;
  }

  const validIds=new Set(list.map(m=>m.id));
  const groupChanged=app.statsState.matchSelectionGroupId!==groupId;
  if(groupChanged){
    app.statsState.matchSearch='';
    app.statsState.matchTypeFilter='';
    if(app.$('#statsMatchSearch'))app.$('#statsMatchSearch').value='';
    if(app.$('#statsMatchTypeFilter'))app.$('#statsMatchTypeFilter').value='';
  }
  let selected=(app.statsState.matchSelection||[]).filter(id=>validIds.has(id));

  if(groupChanged||!selected.length){
    const latest=list[list.length-1];
    selected=latest?[latest.id]:[];
  }

  app.statsState.matchSelection=selected;
  app.statsState.matchSelectionGroupId=groupId;
  app.renderStatsMatchSelector();
  await app.renderStatsMatchesSelection();
};

app.loadStatsReference = async function loadStatsReference(){
  const pop=app.$('#statsReferencePopulation')?.value||'H';
  const box=app.$('#statsReferenceContent');box.innerHTML='<div class="statsEmpty">Chargement du référentiel…</div>';
  await app.loadReferenceMeta();
  app.statsState.reference=await app.loadOffensiveReference(pop);
  box.innerHTML=app.statsReferenceHtml(app.statsState.reference);
  await app.loadReferenceSources();
};

app.statsGroupMatchDataset = async function statsGroupMatchDataset(){
const groupId=app.$('#statsGroup')?.value||'';
  if(!groupId)return {matchIds:[],matches:[],events:[],players:[]};
  const list=await app.statsGroupMatchList();
  const ids=(list||[]).map(m=>m.id);
  if(!ids.length)return {matchIds:[],matches:[],events:[],players:[]};
  return await app.loadMatchAnalysisDataset(ids);
};

app.renderStatsImpactSelection = async function renderStatsImpactSelection(){
  const groupId=app.$('#statsGroup')?.value||'';
  const box=app.$('#statsImpactContent');
  const view=app.statsState.impactView||'staff';
  const playerControl=app.$('#statsImpactPlayerViewControl');
  const sortControls=app.$('#statsImpactSortControls');
  if(playerControl)playerControl.classList.toggle('hidden',view!=='player');
  if(sortControls)sortControls.classList.toggle('hidden',view==='player');
  document.querySelectorAll('#statsImpactViewTabs [data-impact-view]').forEach(b=>b.classList.toggle('active',b.dataset.impactView===view));
  if(!groupId){box.innerHTML='<div class="statsEmpty">Choisis un groupe.</div>';return}

  const selected=(app.statsState.impactMatchSelection||[])
    .filter(id=>(app.statsState.impactMatchList||[]).some(m=>m.id===id));

  if(!selected.length){
    box.innerHTML='<div class="statsEmpty">Sélectionne au moins un match. Tu peux en cocher plusieurs pour construire un cumul.</div>';
    return;
  }

  box.innerHTML='<div class="statsEmpty">Calcul de la performance offensive…</div>';
  const ds=await app.loadMatchAnalysisDataset(selected);
  if(!ds.matchIds.length){box.innerHTML='<div class="statsEmpty">Aucun match exploitable.</div>';return}
  app.statsState.impactDataset=ds;
  app.loadStatsImpactManualOrder();

  const pop=app.$('#statsImpactPopulation')?.value||'H';
  const ref=await app.loadOffensiveReference(pop);
  app.statsState.impactReference=ref;

  const previousRef=app.analysisState.offensiveReference;
  app.analysisState.offensiveReference=ref;
  const names=(ds.players||[]).filter(Boolean);
  const scope=app.statsImpactEffectiveScope();
  const rawRows=names.map(name=>app.playerOffensiveImpact(ds.events,name,scope));
  const rows=app.statsImpactSortRows(rawRows);

  const body=rows.map(x=>`<tr>
    <td>${app.escapeHtml(x.name)}</td>
    <td>${x.total}</td>
    <td>${x.total?app.actualVsReferencePctHtml(x.pointRate,x.expectedPointRate):'—'}</td>
    <td>${x.total?app.actualVsReferencePctHtml(x.faultRate,x.expectedFaultRate):'—'}</td>
    <td class="${app.impactClass(x.creation100||0)}">${x.total?app.signed1(x.creation100):'—'}</td>
    <td class="${app.impactClass(x.safety100||0)}">${x.total?app.signed1(x.safety100):'—'}</td>
    <td>${x.total?app.offensivePerf100Display(x.impact100,x.total):'—'}</td>
   </tr>`).join('');

  const scopeLabel=app.statsImpactScopeLabel(scope);
  if(view==='player'){
    box.innerHTML=app.statsImpactPlayerViewHtml(ds,rawRows.filter(r=>r.total>0),scope);
    app.bindStatsImpactOpponentBreakdowns(box);
  }else{
    box.innerHTML=`<div class="analysisSubtle" style="margin-bottom:8px">
      ${selected.length===1?'Match sélectionné':`Cumul de ${selected.length} matchs sélectionnés`} ·
      Vue : ${scopeLabel} ·
      Référentiel ${pop==='H'?'Hommes':'Femmes'} ·
      valeur d’une attaque : +1 point, 0 ballon défendu, −1 faute.
      Création /100 mesure les points marqués au-dessus de l’attendu ; Sécurité /100 mesure les fautes évitées par rapport à l’attendu.
      Performance /100 = Création /100 + Sécurité /100.
      Les colonnes % points et % fautes rappellent aussi, sous la valeur observée, le niveau du référentiel correspondant.
      Les actions laissées en collectif ne sont pas attribuées à un joueur.
    </div>
    <div class="analysisTableWrap" style="margin-top:14px"><table class="analysisTable"><thead><tr>
      <th>Joueur</th><th>N</th><th>% points</th><th>% fautes</th><th>Création /100</th><th>Sécurité /100</th><th>Performance /100</th>
    </tr></thead><tbody>${body||'<tr><td colspan="7">Aucune attaque attribuée.</td></tr>'}</tbody></table></div>
    ${app.statsImpactEvolutionBlockHtml(ds,scope)}`;
  }
  const playerViewSelect=app.$('#statsImpactPlayerViewSelect');
  if(playerViewSelect){
    const players=(ds.players||[]).filter(Boolean).filter(name=>app.playerOffensiveImpact(ds.events||[],name,scope).total>0).sort((a,b)=>a.localeCompare(b,'fr'));
    let selectedPlayer=app.statsState.impactPlayerName||'';
    if(!players.includes(selectedPlayer))selectedPlayer=players[0]||'';
    app.statsState.impactPlayerName=selectedPlayer;
    playerViewSelect.innerHTML=players.map(name=>`<option value="${app.escapeHtml(name)}" ${name===selectedPlayer?'selected':''}>${app.escapeHtml(name)}</option>`).join('');
    playerViewSelect.onchange=e=>{app.statsState.impactPlayerName=e.target.value||'';app.renderStatsImpactSelection().catch(err=>app.handleError('stats impact player view',err));};
  }
  const playerSelect=app.$('#statsImpactPlayerSelect');
  if(playerSelect)playerSelect.onchange=e=>{
    app.statsState.impactPlayerName=e.target.value||'';
    app.renderStatsImpactSelection().catch(err=>app.handleError('stats impact player',err));
  };
  box.querySelectorAll('[data-impact-move]').forEach(b=>b.onclick=()=>{
    app.moveStatsImpactMatch(b.dataset.impactMove,Number(b.dataset.impactDelta)||0);
  });
  app.analysisState.offensiveReference=previousRef;
};

app.loadStatsImpact = async function loadStatsImpact(){
  const groupId=app.$('#statsGroup')?.value||'';
  const box=app.$('#statsImpactContent');
  if(!groupId){
    app.statsState.impactMatchList=[];
    app.statsState.impactMatchSelection=[];
    app.renderStatsImpactMatchSelector();
    box.innerHTML='<div class="statsEmpty">Choisis un groupe.</div>';
    return;
  }

  const list=await app.statsGroupMatchList();
  app.statsState.impactMatchList=list;

  const typeSelect=app.$('#statsImpactMatchTypeFilter');
  const types=[...new Set(list.map(m=>m.match_type?.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
  if(typeSelect){
    typeSelect.innerHTML='<option value="">Toutes les compétitions</option>'+types.map(t=>`<option value="${app.escapeHtml(t)}">${app.escapeHtml(t)}</option>`).join('');
    typeSelect.value=types.includes(app.statsState.impactMatchTypeFilter)?app.statsState.impactMatchTypeFilter:'';
    app.statsState.impactMatchTypeFilter=typeSelect.value;
  }

  if(!list.length){
    app.statsState.impactMatchSelection=[];
    app.statsState.impactMatchSelectionGroupId=groupId;
    app.renderStatsImpactMatchSelector();
    box.innerHTML='<div class="statsEmpty">Aucun match enregistré dans ce groupe.</div>';
    return;
  }

  const validIds=new Set(list.map(m=>m.id));
  const groupChanged=app.statsState.impactMatchSelectionGroupId!==groupId;
  if(groupChanged){
    app.statsState.impactMatchSearch='';
    app.statsState.impactMatchTypeFilter='';
    if(app.$('#statsImpactMatchSearch'))app.$('#statsImpactMatchSearch').value='';
    if(app.$('#statsImpactMatchTypeFilter'))app.$('#statsImpactMatchTypeFilter').value='';
  }

  let selected=(app.statsState.impactMatchSelection||[]).filter(id=>validIds.has(id));
  if(groupChanged||!selected.length){
    const latest=list[list.length-1];
    selected=latest?[latest.id]:[];
  }

  app.statsState.impactMatchSelection=selected;
  app.statsState.impactMatchSelectionGroupId=groupId;
  app.renderStatsImpactMatchSelector();
  await app.renderStatsImpactSelection();
};

app.bindStatsControls = function bindStatsControls(){
  const statsGroup=app.$('#statsGroup');
  if(statsGroup)statsGroup.onchange=async()=>{
    try{
      await app.loadStatsData(statsGroup.value);
      if(app.statsState.readOnlyViewer&&!((app.playerPortalState.accesses||[]).some(a=>a.group_id===statsGroup.value&&a.stats_access==='group')))return;
      const group=app.statsGroupMeta(statsGroup.value);
      const pop=app.groupPopulationFromName(group?.name)||'H';
      if(app.$('#statsReferencePopulation'))if(app.$('#statsReferencePopulation'))app.$('#statsReferencePopulation').value=pop;
      if(app.$('#statsImpactPopulation'))if(app.$('#statsImpactPopulation'))app.$('#statsImpactPopulation').value=pop;
      if(app.statsState.domain==='matches')await app.loadStatsMatches();
      if(app.statsState.domain==='impact')await app.loadStatsImpact();
      if(app.statsState.domain==='reference')await app.loadStatsReference();
    }catch(e){
      app.handleError('stats group',e);
      if(app.$('#statsStatus'))app.$('#statsStatus').textContent=e.message||String(e);
    }
  };

  app.$$('.statsDomainTab[data-stats-domain]').forEach(b=>b.onclick=()=>app.switchStatsDomain(b.dataset.statsDomain));
  app.$$('.statsTab').forEach(b=>b.onclick=()=>app.switchStatsTab(b.dataset.statsTab));

  const refPopulation=app.$('#statsReferencePopulation');
  if(refPopulation)refPopulation.onchange=()=>app.loadStatsReference().catch(e=>app.handleError('stats reference population',e));

  const reloadSources=app.$('#statsReferenceReloadSources');
  if(reloadSources)reloadSources.onclick=()=>app.loadReferenceSources().catch(e=>app.handleError('reference sources',e));

  const saveSources=app.$('#statsReferenceSaveSources');
  if(saveSources)saveSources.onclick=()=>app.saveReferenceSources().catch(e=>{app.handleError('save reference sources',e);app.setCloud('Erreur',false)});

  const createVersion=app.$('#statsReferenceCreateVersion');
  if(createVersion)createVersion.onclick=()=>app.createReferenceVersion().catch(e=>{app.handleError('create reference version',e);app.setCloud('Erreur',false)});

  const impactPopulation=app.$('#statsImpactPopulation');
  if(impactPopulation)impactPopulation.onchange=()=>app.renderStatsImpactSelection().catch(e=>app.handleError('stats impact population',e));

  const impactSortField=app.$('#statsImpactSortField');
  if(impactSortField)impactSortField.onchange=()=>{
    app.statsState.impactSortField=impactSortField.value||'impact100';
    app.renderStatsImpactSelection().catch(e=>app.handleError('stats impact sort field',e));
  };

  const impactSortDirection=app.$('#statsImpactSortDirection');
  if(impactSortDirection)impactSortDirection.onchange=()=>{
    app.statsState.impactSortDirection=impactSortDirection.value||'desc';
    app.renderStatsImpactSelection().catch(e=>app.handleError('stats impact sort direction',e));
  };

  app.$$('#statsImpactScopeTabs [data-impact-scope]').forEach(b=>b.onclick=()=>{
    app.statsState.impactScope=b.dataset.impactScope||'all';
    app.$$('#statsImpactScopeTabs [data-impact-scope]').forEach(x=>x.classList.toggle('active',x===b));
    app.$('#statsImpactRestartFilter')?.classList.toggle('hidden',app.statsState.impactScope!=='restart');
    app.renderStatsImpactSelection().catch(e=>app.handleError('stats impact scope',e));
  });

  const impactRestartLocation=app.$('#statsImpactRestartLocation');
  if(impactRestartLocation)impactRestartLocation.onchange=()=>{
    app.statsState.impactRestartLocation=impactRestartLocation.value||'all';
    app.renderStatsImpactSelection().catch(e=>app.handleError('stats impact restart location',e));
  };

  document.querySelectorAll('#statsImpactViewTabs [data-impact-view]').forEach(b=>b.onclick=()=>{
    app.statsState.impactView=b.dataset.impactView||'staff';
    document.querySelectorAll('#statsImpactViewTabs [data-impact-view]').forEach(x=>x.classList.toggle('active',x===b));
    app.renderStatsImpactSelection().catch(e=>app.handleError('stats impact view',e));
  });

  const impactLatest=app.$('#statsImpactLatest');
  if(impactLatest)impactLatest.onclick=()=>{
    const list=app.statsState.impactMatchList||[];
    const latest=list[list.length-1];
    app.statsState.impactMatchSelection=latest?[latest.id]:[];
    app.renderStatsImpactMatchSelector();
    app.renderStatsImpactSelection().catch(e=>app.handleError('stats impact latest',e));
  };

  const impactClear=app.$('#statsImpactClear');
  if(impactClear)impactClear.onclick=()=>{
    app.statsState.impactMatchSelection=[];
    app.renderStatsImpactMatchSelector();
    app.renderStatsImpactSelection().catch(e=>app.handleError('stats impact clear',e));
  };

  const impactSearch=app.$('#statsImpactMatchSearch');
  if(impactSearch)impactSearch.oninput=e=>{
    app.statsState.impactMatchSearch=e.target.value||'';
    app.renderStatsImpactMatchSelector();
  };

  const impactType=app.$('#statsImpactMatchTypeFilter');
  if(impactType)impactType.onchange=e=>{
    app.statsState.impactMatchTypeFilter=e.target.value||'';
    app.renderStatsImpactMatchSelector();
  };

  const statsPlayer=app.$('#statsPlayer');
  if(statsPlayer)statsPlayer.onchange=()=>{app.populateStatsPlayerExercises();app.renderStatsPlayer()};

  const statsPlayerExercise=app.$('#statsPlayerExercise');
  if(statsPlayerExercise)statsPlayerExercise.onchange=app.renderStatsPlayer;

  const statsExercise=app.$('#statsExercise');
  if(statsExercise)statsExercise.onchange=app.renderStatsExercise;

  const statsExerciseFocus=app.$('#statsExerciseFocus');
  if(statsExerciseFocus)statsExerciseFocus.onchange=app.renderStatsExercise;

  app.$$('.statsLeaderboardMode').forEach(b=>b.onclick=()=>{
    app.statsState.leaderMode=b.dataset.leaderMode;
    app.$$('.statsLeaderboardMode').forEach(x=>x.classList.toggle('active',x===b));
    app.renderStatsExercise();
  });
};
})(window.KinballCoach.app);

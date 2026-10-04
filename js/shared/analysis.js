/* analysis. Shared explicit application context; no startup side effects. */
((app) => {
app.analysisSemanticType = window.KinballCoach.calculations.analysisSemanticType;

app.analysisOutcome = window.KinballCoach.calculations.analysisOutcome;

app.analysisContextKey = window.KinballCoach.calculations.analysisContextKey;

app.analysisContextLabel = window.KinballCoach.calculations.analysisContextLabel;

app.analysisEventPeople = window.KinballCoach.calculations.analysisEventPeople;

app.analysisIsFault = window.KinballCoach.calculations.analysisIsFault;

app.analysisPct = window.KinballCoach.calculations.analysisPct;

app.analysisPctLabel = window.KinballCoach.calculations.analysisPctLabel;

app.analysisPeriodSort = window.KinballCoach.calculations.analysisPeriodSort;

app.analysisRateHtml = function analysisRateHtml(n,d){
  const numerator=Number(n)||0;
  const denominator=Number(d)||0;
  const p=app.analysisPct(numerator,denominator);
  const width=p==null?0:Math.max(0,Math.min(100,p));
  return `<div class="analysisRateBar"><span>${p==null?'—':p+' %'} (${numerator}/${denominator})</span><div class="analysisRateTrack"><div class="analysisRateFill" style="width:${width}%"></div></div></div>`;
};

app.analysisMetricHtml = function analysisMetricHtml(label,value){
  return `<div class="analysisMetric"><div class="label">${app.escapeHtml(label)}</div><div class="value">${app.escapeHtml(value)}</div></div>`;
};

app.analysisAttackPointsMetricHtml = function analysisAttackPointsMetricHtml(stats){
  const illegal=Number(stats?.illegal)||0;
  const detail=illegal?`<div class="analysisSubtle" style="margin-top:4px">dont ${illegal} défensive${illegal>1?'s':''} illégale${illegal>1?'s':''} adverse${illegal>1?'s':''}</div>`:'';
  return `<div class="analysisMetric"><div class="label">Points marqués</div><div class="value">${app.escapeHtml(stats?.points??0)}</div>${detail}</div>`;
};

app.analysisDefensePointsMetricHtml = function analysisDefensePointsMetricHtml(stats){
  const illegal=Number(stats?.illegal)||0;
  const points=Number(stats?.points)||0;
  const detail=illegal?`<div class="analysisSubtle" style="margin-top:4px">dont ${illegal} défensive${illegal>1?'s':''} illégale${illegal>1?'s':''} commise${illegal>1?'s':''} par nous</div>`:'';
  return `<div class="analysisMetric"><div class="label">Points marqués par l’adversaire</div><div class="value">${app.escapeHtml(points)}</div>${detail}</div>`;
};

app.analysisStats = window.KinballCoach.calculations.analysisStats;

app.analysisDefenseSuccesses = window.KinballCoach.calculations.analysisDefenseSuccesses;

app.analysisDefensePctLabel = window.KinballCoach.calculations.analysisDefensePctLabel;

app.analysisDefenseRateHtml = function analysisDefenseRateHtml(stats){
  return app.analysisRateHtml(app.analysisDefenseSuccesses(stats),stats?.total||0);
};

app.analysisOpponentAttackPctLabel = window.KinballCoach.calculations.analysisOpponentAttackPctLabel;

app.analysisOpponentAttackRateHtml = function analysisOpponentAttackRateHtml(stats){
  return app.analysisRateHtml(stats?.points||0,stats?.total||0);
};

app.analysisAttackZoneLabel = window.KinballCoach.calculations.analysisAttackZoneLabel;

app.analysisDefenseZoneGroup = window.KinballCoach.calculations.analysisDefenseZoneGroup;

app.inferAnalysisPopulation = function inferAnalysisPopulation(){
  const text=(app.analysisState.matches||[]).map(m=>m.group?.name||'').join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\b(feminin|feminine|femmes|femme|edf f)\b/.test(text))return 'F';
  return 'H';
};

app.groupPopulationFromName = window.KinballCoach.calculations.groupPopulationFromName;

app.offensiveContextFromEvent = window.KinballCoach.calculations.offensiveContextFromEvent;

app.emptyOffensiveCounts = function emptyOffensiveCounts(){
  return Object.fromEntries(app.OFFENSIVE_CONTEXTS.map(c=>[c.key,{point:0,defended:0,attack_fault:0,total:0}]));
};

app.addOffensiveObservation = function addOffensiveObservation(counts,context,outcome){
  const x=counts[context];
  if(!x||!['point','defended','attack_fault'].includes(outcome))return false;
  x[outcome]++;x.total++;return true;
};

app.detailedEventToOffensiveObservation = function detailedEventToOffensiveObservation(e){
  const context=app.offensiveContextFromEvent(e);
  if(!context)return null;
  if(e.action_type==='attaque'){
    if(['Point marqué','Défensive illégale'].includes(e.result))return {context,outcome:'point'};
    if(e.result==='Ballon défendu')return {context,outcome:'defended'};
    if(e.result==='Faute attaque')return {context,outcome:'attack_fault'};
    return null;
  }
  if(e.action_type==='faute'&&e.fault_type!=='Défensive illégale'){
    return {context,outcome:'attack_fault'};
  }
  if(e.action_type==='defense'){
    if(e.result==='Ballon défendu')return {context,outcome:'defended'};
    if(e.result==='Échappé'||e.result==='Défensive illégale')return {context,outcome:'point'};
    if(e.result==='Faute de l’adversaire')return {context,outcome:'attack_fault'};
  }
  if(e.action_type==='faute'&&e.fault_type==='Défensive illégale'){
    return {context,outcome:'point'};
  }
  return null;
};

app.loadOffensiveReference = async function loadOffensiveReference(population){
  const pop=population==='F'?'F':'H';
  const counts=app.emptyOffensiveCounts();
  let quickCount=0,detailedCount=0;
  const {data,error}=await app.db.rpc('get_active_offensive_reference',{p_population:pop});
  if(error)throw error;
  (data||[]).forEach(row=>{
    const n=Number(row.n)||0;
    const context=row.attack_context;
    const outcome=row.outcome;
    if(!counts[context]||!['point','defended','attack_fault'].includes(outcome)||!n)return;
    counts[context][outcome]+=n;
    counts[context].total+=n;
    if(row.source==='quick')quickCount+=n;
    else if(row.source==='detailed')detailedCount+=n;
  });
  const contexts={};
  app.OFFENSIVE_CONTEXTS.forEach(c=>{
    const x=counts[c.key];
    contexts[c.key]={...x,p:x.total?x.point/x.total:0,q:x.total?x.attack_fault/x.total:0,mu:x.total?(x.point-x.attack_fault)/x.total:0};
  });
  return {population:pop,contexts,total:quickCount+detailedCount,quickCount,detailedCount};
};

app.renderOffensiveReference = function renderOffensiveReference(){
  const box=app.$('#analysisOffensiveReference');if(!box)return;
  const ref=app.analysisState.offensiveReference;
  if(!ref){box.innerHTML='<div class="analysisEmpty">Référentiel indisponible.</div>';return}
  box.innerHTML=`<div class="analysisReferenceGrid">${app.OFFENSIVE_CONTEXTS.map(c=>{
    const x=ref.contexts[c.key];
    return `<div class="analysisReferenceCard">
      <strong>${app.escapeHtml(c.label)}</strong>
      <div class="small">Point : ${x.total?Math.round(1000*x.p)/10+' %':'—'} · Faute : ${x.total?Math.round(1000*x.q)/10+' %':'—'}</div>
      <div class="small">Valeur attendue μ : ${x.total?(Math.round(1000*x.mu)/1000).toFixed(3):'—'}</div>
      <div class="small">N = ${x.total}</div>
    </div>`;
  }).join('')}</div>
  <div class="analysisSubtle" style="margin-top:8px">Version active du référentiel · population ${ref.population==='H'?'Hommes':'Femmes'} · ${ref.total} observations : ${ref.quickCount} collecte rapide + ${ref.detailedCount} issues des matchs détaillés. Centre / ligne / coin désignent la position de départ.</div>`;
};

app.offensiveActualValue = window.KinballCoach.calculations.offensiveActualValue;

app.playerOffensiveImpact = (events,playerName,scope='all') => window.KinballCoach.calculations.playerOffensiveImpact(events,playerName,scope,app.analysisState.offensiveReference);

app.signed1 = window.KinballCoach.calculations.signed1;

app.pct1 = window.KinballCoach.calculations.pct1;

app.actualVsReferencePctHtml = function actualVsReferencePctHtml(actual,expected){
  if(actual==null||!Number.isFinite(actual))return '—';
  return `<div>${app.pct1(actual)}</div><div class="small">réf. ${app.pct1(expected)}</div>`;
};

app.statsImpactSortRows = rows => window.KinballCoach.calculations.statsImpactSortRows(rows,{field:app.statsState.impactSortField,direction:app.statsState.impactSortDirection});

app.impactClass = window.KinballCoach.calculations.impactClass;

app.renderOffensiveImpactTable = function renderOffensiveImpactTable(events,allPlayers){
  const rows=allPlayers.map(name=>app.playerOffensiveImpact(events,name));
  return `<div class="analysisSubsectionTitle">Performance offensive ajustée au contexte</div>
  <div class="analysisSubtle" style="margin-bottom:7px">Valeur d’une attaque : +1 point · 0 ballon défendu · −1 faute. Création = points produits au-dessus de l’attendu ; Sécurité = fautes évitées par rapport à l’attendu. Performance = Création + Sécurité. Les actions laissées en collectif ne sont pas affectées à un joueur.</div>
  <div class="analysisTableWrap"><table class="analysisTable"><thead><tr>
    <th>Joueur</th><th>Att.</th><th>% points</th><th>% fautes</th><th>Création /100</th><th>Sécurité /100</th><th>Performance /100</th>
  </tr></thead><tbody>${rows.map(x=>`<tr>
    <td>${app.escapeHtml(x.name)}${x.total>0?` ${app.offensiveSampleLabel(x.total).html}`:''}</td>
    <td>${x.total}</td>
    <td>${x.total?app.actualVsReferencePctHtml(x.pointRate,x.expectedPointRate):'—'}</td>
    <td>${x.total?app.actualVsReferencePctHtml(x.faultRate,x.expectedFaultRate):'—'}</td>
    <td class="${app.impactClass(x.creation100||0)}">${x.total?app.signed1(x.creation100):'—'}</td>
    <td class="${app.impactClass(x.safety100||0)}">${x.total?app.signed1(x.safety100):'—'}</td>
    <td>${x.total?app.offensivePerf100Display(x.impact100,x.total):'—'}</td>
  </tr>`).join('')}</tbody></table></div>`;
};

app.loadMatchAnalysisDataset = (matchIds) => app.services.matchDataset(matchIds);

app.openMatchAnalysis = async function openMatchAnalysis(matchId){return app.openMatchAnalysisIds([matchId]);};

app.openMatchAnalysisIds = async function openMatchAnalysisIds(matchIds){
  app.setCloud('Analyse…',true);
  const dataset=await app.loadMatchAnalysisDataset(matchIds);
  app.analysisState={...app.analysisState,...dataset,activeTab:'summary'};
  app.analysisState.population=app.inferAnalysisPopulation();
  const populationSelect=app.$('#analysisPopulation');
  if(populationSelect)populationSelect.value=app.analysisState.population;
  try{
    app.analysisState.offensiveReference=await app.loadOffensiveReference(app.analysisState.population);
  }catch(e){
    console.error('offensive reference',e);
    app.analysisState.offensiveReference=null;
  }
  app.renderMatchAnalysisHeader();app.populateAnalysisEvolutionPlayers();app.setAnalysisTab('summary');app.renderMatchAnalysis();app.renderOffensiveReference();
  app.hideMainModules();app.setMatchHeaderMode(false);app.$('#matchAnalysis').classList.remove('hidden');app.setCloud('Synchronisé',true);window.scrollTo({top:0,behavior:'instant'});
};

app.renderMatchAnalysisHeader = function renderMatchAnalysisHeader(){
  const matches=[...(app.analysisState.matches||[])].sort((a,b)=>(a.played_on||'').localeCompare(b.played_on||'')||(a.label||'').localeCompare(b.label||'','fr'));
  if(!matches.length)return;
  if(matches.length===1){
    const m=matches[0],opponents=[m.opponent1?.name,m.opponent2?.name].filter(Boolean).join(' / ');
    app.$('#matchAnalysisTitle').textContent=m.label||'Analyse du match';
    app.$('#matchAnalysisMeta').textContent=[app.formatDateShort(m.played_on),m.match_type?.name||'Sans type',m.group?.name||m.followed_team?.name||'Groupe',opponents?'vs '+opponents:''].filter(Boolean).join(' · ');
    app.$('#matchAnalysisScope').textContent='Analyse calculée à partir des actions enregistrées pour ce match.';
  }else{
    const types=[...new Set(matches.map(m=>m.match_type?.name).filter(Boolean))],groups=[...new Set(matches.map(m=>m.group?.name||m.followed_team?.name).filter(Boolean))];
    app.$('#matchAnalysisTitle').textContent=types.length===1?`Analyse · ${types[0]}`:'Analyse groupée';
    app.$('#matchAnalysisMeta').textContent=[`${matches.length} matchs`,types.length===1?types[0]:(types.length?`${types.length} types de match`:''),groups.length===1?groups[0]:(groups.length?`${groups.length} groupes`:'')].filter(Boolean).join(' · ');
    app.$('#matchAnalysisScope').textContent=`Analyse agrégée sur ${matches.length} matchs. Les volumes et taux utilisent uniquement les actions réellement enregistrées.`;
  }
};

app.setAnalysisTab = function setAnalysisTab(tab){
  app.analysisState.activeTab=tab;app.$$('.matchAnalysisTabs button').forEach(b=>b.classList.toggle('active',b.dataset.analysisTab===tab));
  const map={summary:'#analysisSummaryTab',players:'#analysisPlayersTab',zones:'#analysisZonesTab'};
  Object.entries(map).forEach(([key,sel])=>app.$(sel).classList.toggle('hidden',key!==tab));
};

app.renderMatchAnalysis = function renderMatchAnalysis(){const events=app.analysisState.events||[];app.renderAnalysisSummary(events);app.renderAnalysisPlayers(events);app.renderAnalysisZonesAndContexts(events);};

app.analysisSummaryContextGroups = function analysisSummaryContextGroups(events){
  const definitions=[
    {key:'centre',label:'Jeu au centre',test:e=>e.family==='centre'},
    {key:'remise',label:'Remise en jeu',test:e=>e.family==='remise'},
    {key:'gel',label:'Gel',test:e=>e.family==='gel'}
  ];
  const known=new Set(['centre','remise','gel']);
  const groups=definitions.map(d=>({...d,events:events.filter(d.test)}));
  const other=events.filter(e=>!known.has(e.family));
  if(other.length)groups.push({key:'other',label:'Autres contextes',events:other});
  return groups.filter(g=>g.events.length);
};

app.analysisSummaryContextHtml = function analysisSummaryContextHtml(label,stats,type){
  const values=type==='attack'?[
    app.analysisMetricHtml('Attaques',stats.total),
    app.analysisAttackPointsMetricHtml(stats),
    app.analysisMetricHtml('Fautes d’attaque',stats.faults),
    app.analysisMetricHtml('Ballons défendus par l’adversaire',stats.defended),
    app.analysisMetricHtml('Taux de point marqué',app.analysisPctLabel(stats.points,stats.total))
  ]:[
    app.analysisMetricHtml('Situations défensives',stats.total),
    app.analysisDefensePointsMetricHtml(stats),
    app.analysisMetricHtml('Fautes d’attaque de l’adversaire',stats.opponentFaults),
    app.analysisMetricHtml('Ballons défendus par nous',stats.defended),
    app.analysisMetricHtml('Taux d’attaque de l’adversaire',app.analysisOpponentAttackPctLabel(stats))
  ];
  return `<div class="analysisSummaryContext"><div class="analysisSummaryContextTitle">${app.escapeHtml(label)}</div><div class="analysisMetricGrid">${values.join('')}</div></div>`;
};

app.analysisCombinedBreakdownHtml = function analysisCombinedBreakdownHtml(events){
  const contextDefs=[
    {key:'centre',label:'Jeu au centre',test:e=>e.family==='centre'},
    {key:'remise',label:'Remise en jeu',test:e=>e.family==='remise'},
    {key:'gel',label:'Gel',test:e=>e.family==='gel'}
  ];
  const known=new Set(contextDefs.map(c=>c.key));
  const contexts=contextDefs.map(c=>({...c,events:events.filter(c.test)}));
  const other=events.filter(e=>!known.has(e.family));
  if(other.length)contexts.push({key:'other',label:'Autres contextes',events:other});
  const rateMetric=(label,value,kind)=>`<div class="analysisMetric ${kind==='own'?'analysisMetricRateOwn':'analysisMetricRateOpponent'}"><div class="label">${app.escapeHtml(label)}</div><div class="value">${app.escapeHtml(value)}</div></div>`;
  const placeholder=()=>'<div class="analysisMetric analysisOpponentComparePlaceholder" aria-hidden="true"><div class="label">—</div><div class="value">—</div></div>';
  const body=contexts.filter(c=>c.events.length).map(context=>{
    const attackEvents=context.events.filter(e=>app.analysisSemanticType(e)==='attack');
    const defenseEvents=context.events.filter(e=>app.analysisSemanticType(e)==='defense');
    const attackStats=app.analysisStats(attackEvents).attack;
    const defenseStats=app.analysisStats(defenseEvents).defense;
    const attackMetrics=attackEvents.length?[
      app.analysisMetricHtml('Attaques',attackStats.total),
      app.analysisAttackPointsMetricHtml(attackStats),
      app.analysisMetricHtml('Fautes d’attaque',attackStats.faults),
      app.analysisMetricHtml('Ballons défendus par l’adversaire',attackStats.defended),
      rateMetric('Taux de point marqué',app.analysisPctLabel(attackStats.points,attackStats.total),'own')
    ]:Array.from({length:5},placeholder);
    const defenseMetrics=defenseEvents.length?[
      app.analysisMetricHtml('Situations défensives',defenseStats.total),
      app.analysisDefensePointsMetricHtml(defenseStats),
      app.analysisMetricHtml('Fautes d’attaque de l’adversaire',defenseStats.opponentFaults),
      app.analysisMetricHtml('Ballons défendus par nous',defenseStats.defended),
      rateMetric('Taux d’attaque de l’adversaire',app.analysisOpponentAttackPctLabel(defenseStats),'opponent')
    ]:Array.from({length:5},placeholder);
    const paired=attackMetrics.map((metric,i)=>metric+defenseMetrics[i]).join('');
    return `<div class="analysisSummaryContext"><div class="analysisSummaryContextTitle">${app.escapeHtml(context.label)}</div><div class="analysisOpponentCompareGrid"><div class="analysisOpponentCompareTitle">Attaque</div><div class="analysisOpponentCompareTitle">Défense</div>${paired}</div></div>`;
  }).join('');
  return body||'<div class="analysisEmpty">Aucune donnée enregistrée.</div>';
};

app.analysisOpponentGroups = function analysisOpponentGroups(events){
  const groups=new Map();
  events.forEach(e=>{
    const name=e.opponent_name||'Équipe non précisée';
    if(!groups.has(name))groups.set(name,[]);
    groups.get(name).push(e);
  });
  return [...groups.entries()].sort((a,b)=>{
    if(a[0]==='Équipe non précisée')return 1;
    if(b[0]==='Équipe non précisée')return -1;
    return a[0].localeCompare(b[0],'fr');
  }).map(([label,groupEvents])=>({label,events:groupEvents}));
};

app.analysisOpponentBreakdownHtml = function analysisOpponentBreakdownHtml(events){
  const groups=app.analysisOpponentGroups(events);
  if(!groups.length)return '<div class="analysisEmpty">Aucune donnée par équipe adverse.</div>';
  const contextDefs=[
    {key:'centre',label:'Jeu au centre',test:e=>e.family==='centre'},
    {key:'remise',label:'Remise en jeu',test:e=>e.family==='remise'},
    {key:'gel',label:'Gel',test:e=>e.family==='gel'}
  ];
  const rateMetric=(label,value,kind)=>`<div class="analysisMetric ${kind==='own'?'analysisMetricRateOwn':'analysisMetricRateOpponent'}"><div class="label">${app.escapeHtml(label)}</div><div class="value">${app.escapeHtml(value)}</div></div>`;
  const placeholder=()=>'<div class="analysisMetric analysisOpponentComparePlaceholder" aria-hidden="true"><div class="label">—</div><div class="value">—</div></div>';
  return groups.map(group=>{
    const known=new Set(contextDefs.map(c=>c.key));
    const contexts=contextDefs.map(c=>({...c,events:group.events.filter(c.test)}));
    const other=group.events.filter(e=>!known.has(e.family));
    if(other.length)contexts.push({key:'other',label:'Autres contextes',events:other});
    const body=contexts.filter(c=>c.events.length).map(context=>{
      const attackEvents=context.events.filter(e=>app.analysisSemanticType(e)==='attack');
      const defenseEvents=context.events.filter(e=>app.analysisSemanticType(e)==='defense');
      const attackStats=app.analysisStats(attackEvents).attack;
      const defenseStats=app.analysisStats(defenseEvents).defense;
      const attackMetrics=attackEvents.length?[
        app.analysisMetricHtml('Attaques',attackStats.total),
        app.analysisAttackPointsMetricHtml(attackStats),
        app.analysisMetricHtml('Fautes d’attaque',attackStats.faults),
        app.analysisMetricHtml('Ballons défendus par l’adversaire',attackStats.defended),
        rateMetric('Taux de point marqué',app.analysisPctLabel(attackStats.points,attackStats.total),'own')
      ]:Array.from({length:5},placeholder);
      const defenseMetrics=defenseEvents.length?[
        app.analysisMetricHtml('Situations défensives',defenseStats.total),
        app.analysisDefensePointsMetricHtml(defenseStats),
        app.analysisMetricHtml('Fautes d’attaque de l’adversaire',defenseStats.opponentFaults),
        app.analysisMetricHtml('Ballons défendus par nous',defenseStats.defended),
        rateMetric('Taux d’attaque de l’adversaire',app.analysisOpponentAttackPctLabel(defenseStats),'opponent')
      ]:Array.from({length:5},placeholder);
      const paired=attackMetrics.map((metric,i)=>metric+defenseMetrics[i]).join('');
      return `<div class="analysisSummaryContext"><div class="analysisSummaryContextTitle">${app.escapeHtml(context.label)}</div><div class="analysisOpponentCompareGrid"><div class="analysisOpponentCompareTitle">Attaque</div><div class="analysisOpponentCompareTitle">Défense</div>${paired}</div></div>`;
    }).join('');
    return `<div class="analysisOpponentCard"><div class="analysisOpponentTitle">${app.escapeHtml(group.label)}</div>${body||'<div class="analysisEmpty">Aucune donnée pour cette équipe.</div>'}</div>`;
  }).join('');
};

app.analysisPeriodChartHtml = function analysisPeriodChartHtml(events,periods){
  const maxPct=100;
  const per=periods.map(period=>({period,...app.analysisStats(events.filter(e=>(e.period||'Non précisée')===period))}));
  return per.length?per.map(x=>{
    const pointRate=app.analysisPct(x.attack.points,x.attack.total)||0;
    const defenseRate=app.analysisPct(x.defense.points,x.defense.total)||0;
    const attackFaultRate=app.analysisPct(x.attack.faults,x.attack.total)||0;
    const pointHeight=Math.max(2,Math.round(120*pointRate/maxPct));
    const defenseHeight=Math.max(2,Math.round(120*defenseRate/maxPct));
    const attackFaultHeight=Math.max(2,Math.round(120*attackFaultRate/maxPct));
    return `<div class="analysisPeriodCol" title="${app.escapeAttr(x.period)}">
      <div class="analysisPeriodBars">
        <div class="analysisPeriodBar attack" style="height:${pointHeight}px" title="Taux de point marqué ${pointRate}% (${x.attack.points}/${x.attack.total})"></div>
        <div class="analysisPeriodBar defense" style="height:${defenseHeight}px" title="Taux d’attaque de l’adversaire ${defenseRate}% (${x.defense.points}/${x.defense.total})"></div>
        <div class="analysisPeriodBar attackFault" style="height:${attackFaultHeight}px" title="Taux de faute d’attaque ${attackFaultRate}% (${x.attack.faults}/${x.attack.total})"></div>
      </div>
      <div class="analysisPeriodLabel">${app.escapeHtml(x.period)}</div>
    </div>`;
  }).join(''):'<div class="analysisEmpty">Aucune période enregistrée.</div>';
};

app.renderOpponentPeriodCharts = function renderOpponentPeriodCharts(events,periods){
  const box=app.$('#analysisOpponentPeriodCharts');
  if(!box)return;
  const groups=app.analysisOpponentGroups(events).filter(g=>g.label!=='Équipe non précisée');
  if(!groups.length){box.innerHTML='';return}
  box.innerHTML=groups.map(group=>`<div class="analysisOpponentPeriodCard">
    <div class="analysisOpponentPeriodTitle">Évolution contre ${app.escapeHtml(group.label)}</div>
    <div class="analysisPeriodChart">${app.analysisPeriodChartHtml(group.events,periods)}</div>
  </div>`).join('');
};

app.renderAnalysisSummary = function renderAnalysisSummary(events){
  app.$('#analysisCombinedMetrics').innerHTML=app.analysisCombinedBreakdownHtml(events);
  app.$('#analysisOpponentMetrics').innerHTML=app.analysisOpponentBreakdownHtml(events);

  const periods=[...new Set(events.map(e=>e.period||'Non précisée'))].sort(app.analysisPeriodSort);
  const per=periods.map(period=>({period,...app.analysisStats(events.filter(e=>(e.period||'Non précisée')===period))}));

  app.$('#analysisPeriodChart').innerHTML=app.analysisPeriodChartHtml(events,periods);

  app.$('#analysisPeriodTable').innerHTML=`<thead><tr>
    <th>Période</th><th>Taux d’attaque</th><th>Taux d’attaque adverse</th><th>Taux de fautes d’attaque</th>
  </tr></thead><tbody>${per.map(x=>`<tr>
    <td>${app.escapeHtml(x.period)}</td>
    <td>${app.analysisRateHtml(x.attack.points,x.attack.total)}</td>
    <td>${app.analysisOpponentAttackRateHtml(x.defense)}</td>
    <td>${app.analysisRateHtml(x.attack.faults,x.attack.total)}</td>
  </tr>`).join('')||'<tr><td colspan="4">Aucune donnée.</td></tr>'}</tbody>`;
};

app.renderAnalysisPlayers = function renderAnalysisPlayers(events){
  const allPlayers=(app.analysisState.players||[]).filter(Boolean);
  const buildAttackRows=attackEvents=>{
    const attackMap={};
    allPlayers.forEach(name=>attackMap[name]={name,total:0,points:0,faults:0,defended:0,illegal:0});
    const addAttack=(name,outcome)=>{
      attackMap[name]??={name,total:0,points:0,faults:0,defended:0,illegal:0};
      const x=attackMap[name];x.total++;
      if(outcome==='Point marqué')x.points++;
      else if(outcome==='Faute attaque')x.faults++;
      else if(outcome==='Ballon défendu')x.defended++;
      else if(outcome==='Défensive illégale')x.illegal++;
    };
    attackEvents.forEach(e=>{
      const people=app.analysisEventPeople(e);
      const name=people.length===1?people[0]:'Collectif / non attribué';
      addAttack(name,app.analysisOutcome(e));
    });
    return Object.values(attackMap).sort((a,b)=>{
      if(a.name==='Collectif / non attribué')return 1;
      if(b.name==='Collectif / non attribué')return -1;
      return a.name.localeCompare(b.name,'fr');
    });
  };
  const renderAttackTable=(title,rows)=>`<div class="analysisSubsectionTitle">${app.escapeHtml(title)}</div><div class="analysisTableWrap"><table class="analysisTable"><thead><tr>
    <th>Joueur</th><th>Attaques</th><th>Points</th><th>Fautes</th><th>Défendues</th><th>Déf. ill. adv.</th><th>Taux pts</th>
  </tr></thead><tbody>${rows.map(x=>`<tr>
    <td>${app.escapeHtml(x.name)}</td><td>${x.total}</td><td>${x.points}</td><td>${x.faults}</td><td>${x.defended}</td><td>${x.illegal}</td><td>${app.analysisRateHtml(x.points,x.total)}</td>
  </tr>`).join('')}</tbody></table></div>`;

  const buildDefenseRows=defenseEvents=>{
    const defenseMap={};
    allPlayers.forEach(name=>defenseMap[name]={name,total:0,defended:0,escaped:0,illegal:0,opponentFaults:0});
    const addDefense=(name,outcome)=>{
      defenseMap[name]??={name,total:0,defended:0,escaped:0,illegal:0,opponentFaults:0};
const x=defenseMap[name];x.total++;
      if(outcome==='Ballon défendu')x.defended++;
      else if(outcome==='Échappé')x.escaped++;
      else if(outcome==='Défensive illégale')x.illegal++;
      else if(outcome==='Faute de l’adversaire')x.opponentFaults++;
    };
    defenseEvents.forEach(e=>{
      const people=app.analysisEventPeople(e);
      if(people.length)people.forEach(name=>addDefense(name,app.analysisOutcome(e)));
      else addDefense('Collectif / non attribué',app.analysisOutcome(e));
    });
    return Object.values(defenseMap).sort((a,b)=>{
      if(a.name==='Collectif / non attribué')return 1;
      if(b.name==='Collectif / non attribué')return -1;
      return b.total-a.total||a.name.localeCompare(b.name,'fr');
    });
  };
  const renderDefenseTable=rows=>`<div class="analysisTableWrap"><table class="analysisTable"><thead><tr>
    <th>Joueur</th><th>Participations</th><th>Sur défendu</th><th>Sur faute adv.</th><th>Sur échappé</th><th>Sur déf. ill.</th>
  </tr></thead><tbody>${rows.map(x=>`<tr>
    <td>${app.escapeHtml(x.name)}</td><td>${x.total}</td><td>${x.defended}</td><td>${x.opponentFaults}</td><td>${x.escaped}</td><td>${x.illegal}</td>
  </tr>`).join('')}</tbody></table></div>`;

  const scopes=[{label:'Global',events}];
  app.analysisOpponentGroups(events).forEach(group=>{
    if(group.label!=='Équipe non précisée')scopes.push({label:group.label,events:group.events});
  });
  const unassigned=events.filter(e=>!e.opponent_name);
  if(unassigned.length)scopes.push({label:'Équipe non précisée',events:unassigned});

  app.$('#analysisPlayersByOpponent').innerHTML=scopes.map(scope=>{
    const scopeAttacks=scope.events.filter(e=>app.analysisSemanticType(e)==='attack');
    const scopeDefenses=scope.events.filter(e=>app.analysisSemanticType(e)==='defense');
    return `<div class="analysisBlock"><h3>${app.escapeHtml(scope.label)}</h3>
      ${app.renderOffensiveImpactTable(scopeAttacks,allPlayers)}
      <div class="analysisSubtle" style="font-weight:800;margin:14px 0 6px">Détail de l’attaque par joueur</div>
      ${renderAttackTable('Jeu au centre',buildAttackRows(scopeAttacks.filter(e=>e.family==='centre')))}
      ${renderAttackTable('Remise en jeu',buildAttackRows(scopeAttacks.filter(e=>e.family==='remise')))}
      <div class="analysisSubsectionTitle">Implication défensive</div>
      ${renderDefenseTable(buildDefenseRows(scopeDefenses))}
    </div>`;
  }).join('');
};

app.renderAnalysisZonesAndContexts = function renderAnalysisZonesAndContexts(events){
  const defenses=events.filter(e=>app.analysisSemanticType(e)==='defense');
  const defenseGroups={};
  defenses.forEach(e=>{
    const name=app.analysisDefenseZoneGroup(e.zone);
    defenseGroups[name]??={name,total:0,defended:0,escaped:0,illegal:0,opponentFaults:0};
    const x=defenseGroups[name],o=app.analysisOutcome(e);x.total++;
    if(o==='Ballon défendu')x.defended++;
    else if(o==='Échappé')x.escaped++;
    else if(o==='Défensive illégale')x.illegal++;
    else if(o==='Faute de l’adversaire')x.opponentFaults++;
  });
  const defenseRows=['R / RE','EE / reste','Non précisée'].filter(k=>defenseGroups[k]).map(k=>defenseGroups[k]);
  app.$('#analysisDefenseZonesTable').innerHTML=`<thead><tr>
    <th>Zone</th><th>Situations déf.</th><th>Défendues</th><th>Fautes adv.</th><th>Échappés</th><th>Déf. ill.</th><th>Taux adv.</th>
  </tr></thead><tbody>${defenseRows.map(x=>`<tr>
    <td>${app.escapeHtml(x.name)}</td><td>${x.total}</td><td>${x.defended}</td><td>${x.opponentFaults}</td><td>${x.escaped}</td><td>${x.illegal}</td><td>${app.analysisRateHtml(x.defended+x.opponentFaults,x.total)}</td>
  </tr>`).join('')||'<tr><td colspan="7">Aucune défense.</td></tr>'}</tbody>`;

  const contextDefinitions=[
    {key:'centre',label:'Jeu au centre',test:e=>app.analysisContextKey(e)==='centre'},
    {key:'remise',label:'Remise en jeu',test:e=>String(app.analysisContextKey(e)).startsWith('remise_')},
    {key:'gel',label:'Gel',test:e=>app.analysisContextKey(e)==='gel'}
  ];
  const renderContextCards=contextEvents=>contextDefinitions.map(c=>{
    const st=app.analysisStats(contextEvents.filter(c.test));
    return `<div class="analysisContextCard"><strong>${app.escapeHtml(c.label)}</strong>
      <div class="analysisContextStats">
        <div>Attaques<b>${st.attack.total}</b></div>
        <div>Taux points<b>${app.escapeHtml(app.analysisPctLabel(st.attack.points,st.attack.total))}</b></div>
        <div>Défenses<b>${st.defense.total}</b></div>
        <div>Taux adv.<b>${app.escapeHtml(app.analysisOpponentAttackPctLabel(st.defense))}</b></div>
      </div>
    </div>`;
  }).join('');
  app.$('#analysisContexts').innerHTML=renderContextCards(events);

  const contextPeriods=[...new Set(events.map(e=>e.period||'Non précisée'))].sort(app.analysisPeriodSort);
  app.$('#analysisContextsByPeriod').innerHTML=contextPeriods.length?contextPeriods.map(period=>{
    const periodEvents=events.filter(e=>(e.period||'Non précisée')===period);
    return `<div class="analysisContextPeriod"><div class="analysisSubsectionTitle">${app.escapeHtml(period)}</div><div class="analysisContextGrid">${renderContextCards(periodEvents)}</div></div>`;
  }).join(''):'<div class="analysisEmpty">Aucune période enregistrée.</div>';

  const restartRows=[
    {key:'global',label:'Remise en jeu · Global',events:events.filter(e=>String(app.analysisContextKey(e)).startsWith('remise_'))},
    {key:'remise_centre',label:'Centre',events:events.filter(e=>app.analysisContextKey(e)==='remise_centre')},
    {key:'remise_ligne',label:'Ligne',events:events.filter(e=>app.analysisContextKey(e)==='remise_ligne')},
    {key:'remise_coin',label:'Coin',events:events.filter(e=>app.analysisContextKey(e)==='remise_coin')}
  ].map(x=>({...x,...app.analysisStats(x.events)}));
  app.$('#analysisRestartTable').innerHTML=`<thead><tr>
    <th>Position</th><th>Att.</th><th>Pts</th><th>Taux pts</th><th>Déf.</th><th>Pts adv.</th><th>Ballons déf.</th><th>Taux adv.</th>
  </tr></thead><tbody>${restartRows.map(x=>`<tr>
    <td>${app.escapeHtml(x.label)}</td>
    <td>${x.attack.total}</td><td>${x.attack.points}</td><td>${app.analysisRateHtml(x.attack.points,x.attack.total)}</td>
    <td>${x.defense.total}</td><td>${app.analysisDefenseSuccesses(x.defense)}</td><td>${x.defense.escaped}</td><td>${app.analysisOpponentAttackRateHtml(x.defense)}</td>
  </tr>`).join('')}</tbody>`;
};

app.populateAnalysisEvolutionPlayers = function populateAnalysisEvolutionPlayers(){
  const sel=app.$('#analysisEvolutionPlayer');if(!sel)return;sel.innerHTML='<option value="">Équipe · Global</option>';
  (app.analysisState.players||[]).forEach(name=>{const o=document.createElement('option');o.value=name;o.textContent=name;sel.append(o)});
};

app.analysisEvolutionSegments = function analysisEvolutionSegments(){
  const events=app.analysisState.events||[];
  if((app.analysisState.matches||[]).length>1)return [...app.analysisState.matches].sort((a,b)=>(a.played_on||'').localeCompare(b.played_on||'')||(a.label||'').localeCompare(b.label||'','fr')).map(m=>({key:m.id,label:`${app.formatDateShort(m.played_on)||''} ${m.label||'Match'}`.trim(),events:events.filter(e=>e.match_id===m.id)}));
  const periods=[...new Set(events.map(e=>e.period||'Non précisée'))].sort(app.analysisPeriodSort);return periods.map(period=>({key:period,label:period,events:events.filter(e=>(e.period||'Non précisée')===period)}));
};

app.analysisPlayerSegmentStats = function analysisPlayerSegmentStats(events,player){
  const attacks=events.filter(e=>app.analysisSemanticType(e)==='attack'&&app.analysisEventPeople(e).length===1&&app.analysisEventPeople(e)[0]===player);
  const defenses=events.filter(e=>app.analysisSemanticType(e)==='defense'&&app.analysisEventPeople(e).includes(player));
  return {attack:{total:attacks.length,points:attacks.filter(e=>['Point marqué','Défensive illégale'].includes(app.analysisOutcome(e))).length,faults:attacks.filter(e=>app.analysisOutcome(e)==='Faute attaque').length,defended:attacks.filter(e=>app.analysisOutcome(e)==='Ballon défendu').length,illegal:attacks.filter(e=>app.analysisOutcome(e)==='Défensive illégale').length},defense:{participations:defenses.length,defended:defenses.filter(e=>app.analysisOutcome(e)==='Ballon défendu').length,escaped:defenses.filter(e=>app.analysisOutcome(e)==='Échappé').length,illegal:defenses.filter(e=>app.analysisOutcome(e)==='Défensive illégale').length}};
};

app.renderAnalysisEvolution = function renderAnalysisEvolution(){
  const chart=app.$('#analysisEvolutionChart'),table=app.$('#analysisEvolutionTable');if(!chart||!table)return;
  const player=app.$('#analysisEvolutionPlayer')?.value||'',segments=app.analysisEvolutionSegments(),unit=(app.analysisState.matches||[]).length>1?'match':'période';
  app.$('#analysisEvolutionHint').textContent=player?`Évolution de ${player} ${unit==='match'?'match par match':'période par période'}. Les défenses sont comptées comme participations, sans taux individuel artificiel.`:`Évolution de l’équipe ${unit==='match'?'match par match':'période par période'}.`;
  if(!segments.length){chart.innerHTML='<div class="analysisEmpty">Aucune donnée d’évolution.</div>';table.innerHTML='<tbody><tr><td>Aucune donnée.</td></tr></tbody>';return}
  if(!player){
    app.$('#analysisEvolutionChartTitle').textContent=unit==='match'?'Évolution match par match':'Évolution par période';app.$('#analysisEvolutionLegend').innerHTML='<span>Taux de point marqué</span><span class="defense">Taux d’attaque de l’adversaire</span>';
    const rows=segments.map(seg=>({seg,...app.analysisStats(seg.events)}));
    chart.innerHTML=rows.map(x=>{const pa=app.analysisPct(x.attack.points,x.attack.total)||0,pd=app.analysisPct(app.analysisDefenseSuccesses(x.defense),x.defense.total)||0;return `<div class="analysisEvolutionCol"><div class="analysisEvolutionBars"><div class="analysisEvolutionBar attack" style="height:${Math.max(2,Math.round(125*pa/100))}px" title="Attaque ${pa}%"></div><div class="analysisEvolutionBar defense" style="height:${Math.max(2,Math.round(125*pd/100))}px" title="Défense ${pd}%"></div></div><div class="analysisEvolutionLabel">${app.escapeHtml(x.seg.label)}</div><div class="analysisEvolutionValue">${pa}% / ${pd}%</div></div>`}).join('');
    table.innerHTML=`<thead><tr><th>${unit==='match'?'Match':'Période'}</th><th>Att.</th><th>Pts</th><th>Fautes</th><th>Taux pts</th><th>Déf.</th><th>Réussies</th><th>Échappés</th><th>Taux adv.</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${app.escapeHtml(x.seg.label)}</td><td>${x.attack.total}</td><td>${x.attack.points}</td><td>${x.attack.faults}</td><td>${app.analysisRateHtml(x.attack.points,x.attack.total)}</td><td>${x.defense.total}</td><td>${app.analysisDefenseSuccesses(x.defense)}</td><td>${x.defense.escaped}</td><td>${app.analysisOpponentAttackRateHtml(x.defense)}</td></tr>`).join('')}</tbody>`;
  }else{
    app.$('#analysisEvolutionChartTitle').textContent=`Évolution · ${player}`;app.$('#analysisEvolutionLegend').innerHTML='<span>Taux de point marqué</span><span class="defense">Participations défensives</span>';
    const rows=segments.map(seg=>({seg,...app.analysisPlayerSegmentStats(seg.events,player)})),maxPart=Math.max(1,...rows.map(x=>x.defense.participations));
    chart.innerHTML=rows.map(x=>{const pa=app.analysisPct(x.attack.points,x.attack.total)||0,hv=Math.max(2,Math.round(125*x.defense.participations/maxPart));return `<div class="analysisEvolutionCol"><div class="analysisEvolutionBars"><div class="analysisEvolutionBar attack" style="height:${Math.max(2,Math.round(125*pa/100))}px" title="Attaque ${pa}%"></div><div class="analysisEvolutionBar volume" style="height:${hv}px" title="${x.defense.participations} participations défensives"></div></div><div class="analysisEvolutionLabel">${app.escapeHtml(x.seg.label)}</div><div class="analysisEvolutionValue">${pa}% · ${x.defense.participations} déf.</div></div>`}).join('');
    table.innerHTML=`<thead><tr><th>${unit==='match'?'Match':'Période'}</th><th>Att.</th><th>Pts</th><th>Fautes</th><th>Taux pts</th><th>Part. déf.</th><th>Sur défendu</th><th>Sur échappé</th><th>Sur faute déf.</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${app.escapeHtml(x.seg.label)}</td><td>${x.attack.total}</td><td>${x.attack.points}</td><td>${x.attack.faults}</td><td>${app.analysisRateHtml(x.attack.points,x.attack.total)}</td><td>${x.defense.participations}</td><td>${x.defense.defended}</td><td>${x.defense.escaped}</td><td>${x.defense.illegal}</td></tr>`).join('')}</tbody>`;
  }
};

app.openMatchModule = async function openMatchModule(){
  await Promise.all([app.fetchMyGroups(),app.fetchMatchTypes()]);
  app.resetForNewMatch();
  app.hideMainModules();
  app.setMatchHeaderMode(true);
  app.$('#setup').classList.remove('hidden');
  app.$('#newMatchTop').classList.remove('hidden');
  if(!app.groupState.groups.length){
    app.$('#matchGroupHint').textContent='Crée ou rejoins d’abord un groupe dans le volet Groupes.';
  }else{
    app.$('#matchGroupHint').textContent='L’effectif du groupe sera utilisé pour sélectionner les 4 joueurs de départ.';
  }
  app.populateMatchTypeSelect(app.$('#matchType'),{selected:''});
  if(!app.$('#matchGroup').value && app.groupState.groups.length) app.$('#matchGroup').value=app.groupState.groups[0].id;
  if(app.$('#matchGroup').value){await app.loadMatchSelectionOptions(app.$('#matchGroup').value,'');await app.loadMatchGroupPlayers(app.$('#matchGroup').value,'');}
  window.scrollTo({top:0,behavior:'instant'});
};
})(window.KinballCoach.app);

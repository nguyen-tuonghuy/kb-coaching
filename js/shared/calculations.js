/* Pure calculations. Reference and sorting policy are explicit parameters. */
(() => {
 const calc={};
calc.analysisSemanticType = function analysisSemanticType(e){
  if(e.action_type==='attaque')return 'attack';
  if(e.action_type==='defense')return 'defense';
  if(e.action_type==='faute'&&e.fault_type==='Défensive illégale')return 'defense';
  return 'attack';
};

calc.analysisOutcome = function analysisOutcome(e){
  const type=calc.analysisSemanticType(e);
  if(type==='attack'){
    if(e.action_type==='faute')return 'Faute attaque';
    return e.result||'Non précisé';
  }
  if(e.action_type==='faute'&&e.fault_type==='Défensive illégale')return 'Défensive illégale';
  return e.result||'Non précisé';
};

calc.analysisContextKey = function analysisContextKey(e){
  if(e.family==='centre')return 'centre';
  if(e.family==='gel')return 'gel';
  if(e.family==='remise')return 'remise_'+(e.restart_location||'centre');
  return e.family||'autre';
};

calc.analysisContextLabel = function analysisContextLabel(key){
  return ({
    centre:'Centre',
    remise:'Remise en jeu',
    remise_centre:'Remise · Centre',
    remise_ligne:'Remise · Ligne',
    remise_coin:'Remise · Coin',
    gel:'Gel'
  })[key]||key||'Autre';
};

calc.analysisEventPeople = function analysisEventPeople(e){
  const names=[...(e.attributed_names||[])];
  if(!names.length&&e.player_name)names.push(e.player_name);
  return [...new Set(names.filter(Boolean))];
};

calc.analysisIsFault = function analysisIsFault(e){
  return e.action_type==='faute';
};

calc.analysisPct = function analysisPct(n,d){
  return d?Math.round(100*n/d):null;
};

calc.analysisPctLabel = function analysisPctLabel(n,d){
  const numerator=Number(n)||0;
  const denominator=Number(d)||0;
  const p=calc.analysisPct(numerator,denominator);
  return `${p==null?'—':p+' %'} (${numerator}/${denominator})`;
};

calc.analysisPeriodSort = function analysisPeriodSort(a,b){
  const na=parseInt(String(a).replace(/\D/g,''),10);
  const nb=parseInt(String(b).replace(/\D/g,''),10);
  if(Number.isFinite(na)&&Number.isFinite(nb))return na-nb;
  return String(a).localeCompare(String(b),'fr');
};

calc.analysisStats = function analysisStats(events){
  const attacks=events.filter(e=>calc.analysisSemanticType(e)==='attack');
  const defenses=events.filter(e=>calc.analysisSemanticType(e)==='defense');
  const attack={
    total:attacks.length,
    points:attacks.filter(e=>['Point marqué','Défensive illégale'].includes(calc.analysisOutcome(e))).length,
    faults:attacks.filter(e=>calc.analysisOutcome(e)==='Faute attaque').length,
    defended:attacks.filter(e=>calc.analysisOutcome(e)==='Ballon défendu').length,
    illegal:attacks.filter(e=>calc.analysisOutcome(e)==='Défensive illégale').length
  };
  const defenseEscaped=defenses.filter(e=>calc.analysisOutcome(e)==='Échappé').length;
  const defenseIllegal=defenses.filter(e=>calc.analysisOutcome(e)==='Défensive illégale').length;
  const defense={
    total:defenses.length,
    defended:defenses.filter(e=>calc.analysisOutcome(e)==='Ballon défendu').length,
    escaped:defenseEscaped,
    illegal:defenseIllegal,
    points:defenseEscaped+defenseIllegal,
    opponentFaults:defenses.filter(e=>calc.analysisOutcome(e)==='Faute de l’adversaire').length
  };
  return {attack,defense};
};

calc.analysisDefenseSuccesses = function analysisDefenseSuccesses(stats){
  return (stats?.defended||0)+(stats?.opponentFaults||0);
};

calc.analysisDefensePctLabel = function analysisDefensePctLabel(stats){
  return calc.analysisPctLabel(calc.analysisDefenseSuccesses(stats),stats?.total||0);
};

calc.analysisOpponentAttackPctLabel = function analysisOpponentAttackPctLabel(stats){
  return calc.analysisPctLabel(stats?.points||0,stats?.total||0);
};

calc.analysisAttackZoneLabel = function analysisAttackZoneLabel(zone){
  const z=({E1:'A1',E2:'P',E3:'A2'}[zone]||zone||'Non précisée');
  return z;
};

calc.analysisDefenseZoneGroup = function analysisDefenseZoneGroup(zone){
  if(zone==='R'||zone==='RE')return 'R / RE';
  if(['EE','A1','P','A2','E1','E2','E3'].includes(zone))return 'EE / reste';
  return 'Non précisée';
};

calc.groupPopulationFromName = function groupPopulationFromName(name){
  const t=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\b(feminin|feminine|femmes|femme|edf f)\b/.test(t))return 'F';
  if(/\b(hommes|homme|masculin|masculine|edf h)\b/.test(t))return 'H';
  return null;
};

calc.offensiveContextFromEvent = function offensiveContextFromEvent(e){
  if(e.family==='centre')return 'game_center';
  if(e.family!=='remise')return null;
  if(e.restart_location==='centre')return 'restart_center';
  if(e.restart_location==='ligne')return 'restart_line';
  if(e.restart_location==='coin')return 'restart_corner';
  return null;
};

calc.offensiveActualValue = function offensiveActualValue(outcome){
  if(outcome==='Point marqué'||outcome==='Défensive illégale')return 1;
  if(outcome==='Ballon défendu')return 0;
  if(outcome==='Faute attaque')return -1;
  return null;
};

calc.playerOffensiveImpact = function playerOffensiveImpact(events,playerName,scope='all',reference){
  const ref=reference;
  const out={name:playerName,total:0,points:0,defended:0,faults:0,expectedPoints:0,expectedFaults:0,actualValue:0,expectedValue:0,creation:0,safety:0,creation100:null,safety100:null,impact:0,impact100:null};
  if(!ref)return out;
  events.forEach(e=>{
    if(calc.analysisSemanticType(e)!=='attack')return;
    const people=calc.analysisEventPeople(e);
    if(people.length!==1||people[0]!==playerName)return;
    const context=calc.offensiveContextFromEvent(e);
    if(scope==='center'&&context!=='game_center')return;
    if(scope==='restart'&&!['restart_center','restart_line','restart_corner'].includes(context))return;
    if(scope==='restart_center'&&context!=='restart_center')return;
    if(scope==='restart_line'&&context!=='restart_line')return;
    if(scope==='restart_corner'&&context!=='restart_corner')return;
    const r=ref.contexts[context];
    if(!context||!r||!r.total)return;
    const outcome=calc.analysisOutcome(e);
    const value=calc.offensiveActualValue(outcome);
    if(value==null)return;
    out.total++;
    if(outcome==='Point marqué'||outcome==='Défensive illégale')out.points++;
    else if(outcome==='Ballon défendu')out.defended++;
    else if(outcome==='Faute attaque')out.faults++;
    out.expectedPoints+=r.p;
    out.expectedFaults+=r.q;
    out.actualValue+=value;
    out.expectedValue+=r.mu;
  });
  out.pointRate=out.total?100*out.points/out.total:null;
  out.faultRate=out.total?100*out.faults/out.total:null;
  out.expectedPointRate=out.total?100*out.expectedPoints/out.total:null;
  out.expectedFaultRate=out.total?100*out.expectedFaults/out.total:null;
  out.creation=out.points-out.expectedPoints;
  out.safety=out.expectedFaults-out.faults;
  out.creation100=out.total?100*out.creation/out.total:null;
  out.safety100=out.total?100*out.safety/out.total:null;
  out.impact=out.creation+out.safety;
  out.impact100=out.total?100*out.impact/out.total:null;
  return out;
};

calc.signed1 = function signed1(v){
  if(v==null||!Number.isFinite(v))return '—';
  const rounded=Math.round(v*10)/10;
  return `${rounded>0?'+':''}${rounded.toFixed(1).replace('.',',')}`;
};

calc.pct1 = function pct1(v){
  if(v==null||!Number.isFinite(v))return '—';
  return `${(Math.round(v*10)/10).toFixed(1).replace('.',',')} %`;
};

calc.statsImpactSortRows = function statsImpactSortRows(rows,options={}){
  const field=options.field||'impact100';
  const dir=options.direction||'desc';
  const sorted=[...(rows||[])];
  const getVal=row=>{
    switch(field){
      case 'name': return String(row.name||'');
      case 'total': return row.total;
      case 'pointRate': return row.pointRate;
      case 'faultRate': return row.faultRate;
      case 'creation100': return row.creation100;
      case 'safety100': return row.safety100;
      case 'impact100':
      default: return row.impact100;
    }
  };
  sorted.sort((a,b)=>{
    const av=getVal(a), bv=getVal(b);
    if(field==='name'){
      const cmp=String(av).localeCompare(String(bv),'fr');
      return dir==='asc'?cmp:-cmp;
    }
    const aMissing=av==null||!Number.isFinite(av), bMissing=bv==null||!Number.isFinite(bv);
    if(aMissing&&bMissing)return String(a.name||'').localeCompare(String(b.name||''),'fr');
    if(aMissing)return 1;
    if(bMissing)return -1;
    const cmp=av===bv?0:(av<bv?-1:1);
    if(cmp!==0)return dir==='asc'?cmp:-cmp;
    return String(a.name||'').localeCompare(String(b.name||''),'fr');
  });
  return sorted;
};

calc.impactClass = function impactClass(v){
  if(v>0.05)return 'analysisImpactPositive';
  if(v<-0.05)return 'analysisImpactNegative';
  return 'analysisImpactNeutral';
};

calc.statsImpactQuantile = function statsImpactQuantile(values,q){
  const arr=(values||[]).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!arr.length)return null;
  if(arr.length===1)return arr[0];
  const pos=(arr.length-1)*q;
  const lo=Math.floor(pos),hi=Math.ceil(pos);
  return lo===hi?arr[lo]:arr[lo]+(arr[hi]-arr[lo])*(pos-lo);
};

calc.statsImpactAnonymousBenchmark = function statsImpactAnonymousBenchmark(rows,key){
  const vals=(rows||[]).map(x=>x[key]).filter(Number.isFinite);
  if(!vals.length)return null;
  return {
    mean:vals.reduce((sum,v)=>sum+v,0)/vals.length,
    count:vals.length
  };
};
 window.KinballCoach.calculations=Object.freeze(calc);
})();

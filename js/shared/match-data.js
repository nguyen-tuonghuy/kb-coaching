/* Match dataset assembly. Explicit client, no DOM or mutable page state. */
window.KinballCoach.createMatchDataService = (db) => async function loadMatchAnalysisDataset(matchIds){
  const unique=[...new Set((matchIds||[]).filter(Boolean))];
  if(!unique.length)throw new Error('Aucun match à analyser.');
  const {data:matches,error:me}=await db.from('matches')
    .select('id,label,played_on,group_id,match_type_id,team_id,opponent_team_1_id,opponent_team_2_id,match_type:match_types!matches_match_type_id_fkey(name),group:coaching_groups!matches_group_id_fkey(name),followed_team:teams!matches_team_id_fkey(name),opponent1:teams!matches_opponent_team_1_id_fkey(id,name),opponent2:teams!matches_opponent_team_2_id_fkey(id,name)')
    .in('id',unique);
  if(me)throw me;

  const {data:events,error:ee}=await db.from('match_events')
    .select('*')
    .in('match_id',unique)
    .order('sequence_no',{ascending:true});
  if(ee)throw ee;

  const ids=(events||[]).map(e=>e.id);
  let attributions=[],lineups=[];
  if(ids.length){
    const [a,l]=await Promise.all([
      db.from('match_event_attributions').select('event_id,player_id,players!match_event_attributions_player_id_fkey(display_name)').in('event_id',ids),
      db.from('match_event_lineup').select('event_id,player_id,players!match_event_lineup_player_id_fkey(display_name)').in('event_id',ids)
    ]);
    if(a.error)throw a.error;
    if(l.error)throw l.error;
    attributions=a.data||[];
    lineups=l.data||[];
  }

  const eventPlayerIds=[...new Set((events||[]).map(e=>e.player_id).filter(Boolean))];
  let eventPlayerMap={};
  if(eventPlayerIds.length){
    const {data,error}=await db.from('players').select('id,display_name').in('id',eventPlayerIds);
    if(error)throw error;
    eventPlayerMap=Object.fromEntries((data||[]).map(p=>[p.id,p.display_name]));
  }

  const {data:matchPlayers,error:mpe}=await db.from('match_players')
    .select('match_id,player_id,players!match_players_player_id_fkey(display_name)')
    .in('match_id',unique);
  if(mpe)throw mpe;

  const attrMap={},lineMap={};
  attributions.forEach(a=>{
    const n=a.players?.display_name;
    if(n)(attrMap[a.event_id]??=[]).push(n);
  });
  lineups.forEach(l=>{
    const n=l.players?.display_name;
    if(n)(lineMap[l.event_id]??=[]).push(n);
  });

  const matchMap=Object.fromEntries((matches||[]).map(m=>[m.id,m]));
  const normalized=(events||[]).map(e=>{
    const match=matchMap[e.match_id]||null;
    let opponent_name=null;
    if(e.opponent_team_id&&match){
      if(e.opponent_team_id===match.opponent_team_1_id||e.opponent_team_id===match.opponent1?.id)opponent_name=match.opponent1?.name||null;
      else if(e.opponent_team_id===match.opponent_team_2_id||e.opponent_team_id===match.opponent2?.id)opponent_name=match.opponent2?.name||null;
    }
    return {
      ...e,
      match,
      opponent_name,
      attributed_names:attrMap[e.id]||[],
      lineup_names:lineMap[e.id]||[],
      player_name:e.player_id?eventPlayerMap[e.player_id]||null:null
    };
  });

  const playerNames=[...new Set([
    ...(matchPlayers||[]).map(p=>p.players?.display_name),
    ...attributions.map(a=>a.players?.display_name),
    ...lineups.map(l=>l.players?.display_name),
    ...Object.values(eventPlayerMap)
  ].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));

  return {matchIds:unique,matches:matches||[],events:normalized,players:playerNames};
};

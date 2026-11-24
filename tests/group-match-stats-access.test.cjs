const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const migration=read('supabase/migrations/20261124191500_group_match_stats_access.sql');
const data=read('js/shared/data.js');
const auth=read('js/shared/auth.js');
const bootstrap=read('js/shared/bootstrap.js');
const portal=read('js/shared/player-portal.js');
const statistics=read('js/shared/statistics.js');
const groups=read('js/shared/groups.js');
const shell=read('js/shared/page-shell.js');
const playerStats=read('player-stats.html');
const faceToFace=read('face-a-face.html');

test('match stats access is opt-in per group and never backfilled from training access',()=>{
  assert.match(migration,/add column if not exists match_stats_access boolean not null default false/);
  assert.doesNotMatch(migration,/match_stats_access\s*=\s*stats_access/);
  assert.match(migration,/select a\.group_id, coalesce\(bool_or\(gp\.match_stats_access\), false\)/);
  assert.match(migration,/gp\.active = true/);
  assert.match(migration,/grant execute on function public\.get_my_player_match_stats_access\(\) to authenticated/);
  assert.match(migration,/where a\.user_id = auth\.uid\(\)[\s\S]*?and a\.group_id = p_group_id/);
});

test('restrictive Supabase guards cover every raw match dataset',()=>{
  const tables={
    matches:'private.can_read_group_match_stats_raw(group_id, workspace_id)',
    match_events:'private.can_read_match_stats_raw(match_id)',
    match_players:'private.can_read_match_stats_raw(match_id)',
    match_event_attributions:'private.can_read_match_event_stats_raw(event_id)',
    match_event_lineup:'private.can_read_match_event_stats_raw(event_id)'
  };
  for(const [table,expression] of Object.entries(tables)){
    assert.match(migration,new RegExp(`create policy ${table}_group_match_stats_guard[\\s\\S]*?as restrictive for select to authenticated`));
    assert.match(migration,new RegExp(`create policy ${table}_match_stats_viewers_read[\\s\\S]*?as permissive for select to authenticated`));
    assert.ok(migration.includes(expression),`missing guard for ${table}`);
  }
  assert.match(migration,/create or replace function private\.can_read_group_player_raw[\s\S]*own\.match_stats_access = true/);
  assert.match(migration,/create or replace function private\.can_read_player_raw[\s\S]*join public\.coaching_group_players gp[\s\S]*gp\.player_id = p_player_id[\s\S]*own\.match_stats_access = true/);
});

test('the player service merges the new right without blocking personal stats',()=>{
  assert.match(data,/playerMatchStatsGroups\(\)[\s\S]*db\.rpc\('get_my_player_match_stats_access'\)/);
  assert.match(data,/match_stats_access:!!x\.match_stats_access/);
  assert.match(auth,/Promise\.all\(\[[\s\S]*playerAccess\(\)[\s\S]*playerMatchStatsGroups/);
  assert.match(auth,/match_stats_access:allowed\.has\(access\.group_id\)/);
  assert.match(auth,/console\.warn\('\[player match stats\]',error\)/);
  assert.match(portal,/playerPortalCanViewGroupMatchStats[\s\S]*match_stats_access===true/);
  assert.match(bootstrap,/playerPortalCanOpenGroupStats\(access\)\)[^\n]*team stats hash/);
  assert.match(bootstrap,/playerPortalCanOpenGroupStats\(access\)\)[^\n]*open team stats/);
  assert.doesNotMatch(bootstrap,/playerPortalCanViewGroupStats\(access\)/);
  assert.match(portal,/playerPortalCanOpenGroupStats[\s\S]*playerPortalCanViewGroupStats[\s\S]*playerPortalCanViewGroupMatchStats/);
});

test('the read-only viewer can open matches only when explicitly allowed',()=>{
  assert.match(statistics,/app\.statsDomainAllowed = function statsDomainAllowed/);
  assert.match(statistics,/if\(\['matches','impact','reference'\]\.includes\(domain\)\)return !!app\.statsState\.viewerCanMatches/);
  assert.match(statistics,/readOnlyViewer&&!app\.statsState\.viewerCanTraining/);
  assert.match(statistics,/viewerCanMatches=!!rights\.matches/);
  assert.match(statistics,/app\.playerPortalGroupStatsRights\(groupId\)/);
  assert.match(statistics,/openFaceToFaceFromStats'\)[^\n]*readOnly&&!rights\.matches/);
  assert.match(statistics,/statsDomainTab\[data-stats-domain\]/);
  assert.match(statistics,/openGroupStatsViewer[\s\S]*playerPortalCanOpenGroupStats\(access\)/);
  assert.match(statistics,/bindStatsControls[\s\S]*playerPortalCanOpenGroupStats\(access\)/);
  assert.match(statistics,/readOnlyViewer&&tab==='player'/);
});

test('coaches choose the match right per player and standalone pages honour it',()=>{
  assert.match(shell,/id="groupPlayerFollowupMatchStatsAccess"/);
  assert.match(shell,/Désactivé par défaut/);
  assert.match(groups,/match_stats_access:matchStatsAccess/);
  assert.match(groups,/p\.match_stats_access===true/);
  assert.match(playerStats,/get_my_player_match_stats_access/);
  assert.match(playerStats,/access\?\.stats_access==='group'\|\|access\?\.match_stats_access===true/);
  assert.match(faceToFace,/get_my_player_match_stats_access/);
  assert.match(faceToFace,/allowedMatchGroups\.has\(x\.group_id\)/);
});

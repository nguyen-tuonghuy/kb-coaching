const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadPage,mockClient,settle,deferred}=require('./helpers/page-harness.cjs');

const root=path.resolve(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));

const coachActive={id:'o1',objective:'Servir régulièrement la zone arrière',status:'active',source:'coach',coach_note:'Cible la largeur.',player_note:null,created_at:'2026-09-20T10:00:00Z',updated_at:'2026-09-30T09:00:00Z',created_by_name:'Karim'};
const coachDone={id:'o2',objective:'Équilibrer mes attaques',status:'completed',source:'coach',stage:'to_work',coach_note:null,player_note:null,completed_at:'2026-10-01T09:00:00Z',created_at:'2026-09-01T10:00:00Z',updated_at:'2026-10-01T09:00:00Z',created_by_name:'Karim'};
const personal={id:'o3',objective:'Garder mon concentration',status:'active',source:'player',stage:'stabilized',coach_note:null,player_note:'À retravailler.',created_at:'2026-09-25T10:00:00Z',updated_at:'2026-09-25T10:00:00Z',created_by_name:'Joueur'};

async function setup(t,page,options){
  const ui=await loadPage(page,options);
  t.after(()=>ui.close());
  return {...ui,app:ui.w.KinballCoach.app};
}

function coachPortal(ui){
  const state=ui.app.playerPortalState;
  state.groupId='g1';
  state.staffPreview=true;
  state.staffPlayerId='p1';
}

function objectiveRpc(rows){
  return ()=>({data:plain(rows),error:null});
}

for(const page of ['index','training']){
  test(`${page}: la liste d'objectifs ne dérive que de status et retire le bouton coach séparé`,async t=>{
    const ui=await setup(t,page);
    coachPortal(ui);
    assert.equal(ui.app.playerObjectiveDisplayState({status:'completed',stage:'to_work'}),'completed');
    assert.equal(ui.app.playerObjectiveDisplayState({status:'completed',stage:'in_progress'}),'completed');
    assert.equal(ui.app.playerObjectiveDisplayState({status:'active',stage:'stabilized'}),'to_work');
    assert.equal(ui.app.playerObjectiveDisplayState(null),'to_work');

    ui.app.playerPortalState.objectives=[coachActive,coachDone,personal];
    ui.app.renderPlayerObjectives();
    const box=ui.$('#playerObjectivesList');
    assert.equal(box.querySelectorAll('[data-objective-action]').length,0);
    assert.equal(box.querySelectorAll('.playerObjectiveItem.completed').length,1);
    assert.match(box.querySelector('.playerObjectiveItem.completed').textContent,/Atteint/);
    assert.match(box.querySelector('.playerObjectiveItem.completed').textContent,/Équilibrer/);
    assert.match(box.querySelector('.playerObjectiveItem.completed').textContent,/○|●/);
    assert.match(box.textContent,/Objectifs atteints \(1\)/);
  });
}

test("côté joueur, les commandes personnelles restent disponibles",async t=>{
  const ui=await setup(t,'index');
  ui.app.playerPortalState.groupId='g1';
  ui.app.playerPortalState.staffPreview=false;
  ui.app.playerPortalState.objectives=[coachActive,personal];
  ui.app.renderPlayerObjectives();
  const actions=[...ui.$('#playerObjectivesList').querySelectorAll('[data-objective-action]')].map(b=>b.dataset.objectiveAction);
  assert.deepEqual(actions,['complete','edit','delete']);
});

test('le détail coach expose deux statuts et rend un objectif personnel non modifiable',async t=>{
  const ui=await setup(t,'index');
  coachPortal(ui);
  ui.app.playerPortalState.objectives=[coachDone,personal];

  ui.app.openPlayerFollowUpDetail('o3');
  assert.equal(ui.$('#playerFollowUpObjectiveInput'),null);
  assert.match(ui.$('#playerFollowUpDetailBody').textContent,/seul le joueur peut le modifier/);
  assert.match(ui.$('#playerFollowUpDetailBody').textContent,/Note du joueur/);
  assert.ok(ui.$('#playerFollowUpCoachNoteInput'));
  const picker=ui.$('#playerFollowUpStatusPicker');
  assert.ok(picker);
  assert.equal(picker.querySelectorAll('[data-followup-status]').length,2);
  assert.equal(picker.querySelector('[data-followup-status="to_work"]').getAttribute('aria-pressed'),'true');
  assert.equal(picker.querySelector('[data-followup-status="completed"]').getAttribute('aria-pressed'),'false');
  assert.equal(picker.querySelector('[data-followup-status="to_work"]').classList.contains('active'),true);

  ui.app.openPlayerFollowUpDetail('o2');
  const donePicker=ui.$('#playerFollowUpStatusPicker');
  assert.equal(donePicker.querySelector('[data-followup-status="completed"]').getAttribute('aria-pressed'),'true');
  assert.match(ui.$('#playerFollowUpDetailBody').textContent,/objectif atteint/);

  ui.app.playerPortalState.staffPreview=false;
  ui.app.openPlayerFollowUpDetail('o3');
  assert.equal(ui.$('#playerFollowUpStatusPicker'),null);
  assert.ok(ui.$('#playerFollowUpNoteInput'));
  assert.match(ui.$('#playerFollowUpDetailBody').textContent,/À travailler/);
  assert.match(ui.$('#playerFollowUpDetailBody').textContent,/Ma note personnelle/);
  assert.match(ui.$('#playerFollowUpDetailBody').textContent,/À retravailler\./);
});

test('marquer atteint relance le RPC, rerender le détail et ignore un second clic sans changement',async t=>{
  const rows=[{...coachActive}];
  let gate=null;
  const client=mockClient({rpcs:{
    get_player_follow_up_objectives:objectiveRpc(rows),
    complete_player_objective:()=>gate?gate.promise:{data:null,error:null},
    reopen_player_objective:()=>({data:null,error:null})
  }});
  const ui=await setup(t,'index',{client});
  coachPortal(ui);
  ui.app.playerPortalState.objectives=plain(rows);
  ui.app.openPlayerFollowUpDetail('o1');
  ui.$('#playerFollowUpObjectiveInput').value='Brouillon non enregistré';

  gate=deferred();
  const completedButton=ui.$('#playerFollowUpStatusPicker [data-followup-status="completed"]');
  completedButton.click();
  await settle();
  assert.equal(client.calls.filter(c=>c.name==='complete_player_objective').length,1);
  assert.equal(ui.$('#playerFollowUpDetailStatus').textContent,'Marquage atteint…');
  const pending=[...ui.$('#playerFollowUpStatusPicker').querySelectorAll('[data-followup-status]')];
  assert.equal(pending.every(button=>button.disabled),true);

  rows[0]={...rows[0],status:'completed',completed_at:'2026-10-05T09:00:00Z'};
  gate.resolve({data:null,error:null});
  await settle();await settle();

  assert.equal(ui.$('#playerFollowUpDetailStatus').textContent,'Objectif mis à jour.');
  const refreshed=ui.$('#playerFollowUpStatusPicker [data-followup-status="completed"]');
  assert.equal(refreshed.getAttribute('aria-pressed'),'true');
  assert.equal(refreshed.classList.contains('active'),true);
  assert.equal(ui.$('#playerFollowUpObjectiveInput').value,'Brouillon non enregistré');
  assert.match(ui.$('#playerObjectivesList').textContent,/Objectifs atteints \(1\)/);

  refreshed.click();
  await settle();
  assert.equal(client.calls.filter(c=>c.name==='complete_player_objective').length,1);
});

test("l'enregistrement coach n'envoie jamais p_stage et ne reprend pas le texte personnel",async t=>{
  const client=mockClient({rpcs:{
    get_player_follow_up_objectives:objectiveRpc([coachActive,personal]),
    update_player_objective_coach_fields:()=>({data:null,error:null})
  }});
  const ui=await setup(t,'index',{client});
  coachPortal(ui);
  ui.app.playerPortalState.objectives=[coachActive,personal];

  ui.app.openPlayerFollowUpDetail('o1');
  ui.$('#playerFollowUpObjectiveInput').value='Nouvel objectif coach';
  ui.$('#playerFollowUpDetailSave').click();
  await settle();await settle();
  let call=client.calls.find(c=>c.name==='update_player_objective_coach_fields');
  assert.ok(call);
  assert.equal('p_stage' in call.args,false);
  assert.equal(call.args.p_objective,'Nouvel objectif coach');
  assert.equal(call.args.p_group_id,'g1');
  assert.equal(call.args.p_objective_id,'o1');

  ui.app.openPlayerFollowUpDetail('o3');
  ui.$('#playerFollowUpCoachNoteInput').value='Consigne ajoutée';
  ui.$('#playerFollowUpDetailSave').click();
  await settle();await settle();
  call=client.calls.filter(c=>c.name==='update_player_objective_coach_fields').at(-1);
  assert.equal('p_stage' in call.args,false);
  assert.equal(call.args.p_objective,null);
  assert.equal(call.args.p_coach_note,'Consigne ajoutée');
  assert.equal(ui.$('#playerFollowUpDetailStatus').textContent,'Enregistré.');
});

test('la fiche joueur coach n utilise que les deux statuts et les RPC de cycle de vie',async t=>{
  const rows=[{...coachActive},{...coachDone}];
  const client=mockClient({rpcs:{
    get_player_follow_up_objectives:objectiveRpc(rows),
    complete_player_objective:()=>{rows[0]={...rows[0],status:'completed',completed_at:'2026-10-05T09:00:00Z'};return {data:null,error:null}},
    reopen_player_objective:()=>({data:null,error:null})
  }});
  const ui=await setup(t,'index',{client});
  ui.app.groupPlayerFollowupState.groupId='g1';
  ui.app.groupPlayerFollowupState.playerId='p1';
  const box=ui.$('#groupPlayerFollowupObjectivesList');
  box.innerHTML=ui.app.groupFollowUpObjectivesHtml(rows);
  ui.app.groupFollowUpBindStatusPickers();

  assert.doesNotMatch(box.textContent,/Objectifs coach en cours/);
  assert.match(box.textContent,/Objectifs coach/);
  assert.match(box.textContent,/Objectifs coach atteints \(1\)/);
  assert.equal(box.querySelectorAll('[data-group-stage]').length,0);
  assert.equal(box.querySelectorAll('[data-group-objective="o1"] [data-group-status]').length,2);
  assert.equal(box.querySelector('[data-group-objective="o1"] [data-followup-stage]'),null);

  box.querySelector('[data-group-objective="o1"] [data-group-status="completed"]').click();
  await settle();await settle();
  assert.equal(client.calls.filter(c=>c.name==='complete_player_objective').length,1);
  assert.equal(client.calls.filter(c=>c.name==='set_player_objective_stage').length,0);
  assert.equal(ui.$('#groupPlayerFollowupStatus').textContent,'Objectif mis à jour.');
  assert.ok(box.querySelector('[data-group-objective="o1"]').closest('details'));
});

test('le bundle et les pages ne conservent aucun reliquat du modèle stage',()=>{
  const bundle=fs.readFileSync(path.join(root,'js/shared/coaching.bundle.js'),'utf8');
  for(const stale of ['data-followup-stage','data-group-stage','playerObjectiveStageInfo','playerObjectiveStageOf','playerFollowUpStage','detailStage','followUpStageEdit','p_stage','Objectifs coach en cours']){
    assert.equal(bundle.includes(stale),false,`bundle: ${stale}`);
  }
  const css=fs.readFileSync(path.join(root,'css/coaching-shared.css'),'utf8');
  assert.doesNotMatch(css,/\.followupPage\s*\{[^}]*max-width/,'no local max-width for followupPage');
  for(const page of ['index','training']){
    const html=fs.readFileSync(path.join(root,`${page}.html`),'utf8');
    assert.match(html,/<template data-kc-component="groupPlayerFollowupPage"><\/template>/);
    assert.doesNotMatch(html,/Objectifs coach en cours/);
    const appOpen=html.indexOf('<div class="app">');
    const followup=html.indexOf('<template data-kc-component="groupPlayerFollowupPage">');
    const appLastChild=html.indexOf('<template data-kc-component="live">');
    assert.ok(appOpen>-1&&followup>appOpen&&followup<appLastChild,`${page}.html: followup template must live inside .app`);
  }
  const shell=fs.readFileSync(path.join(root,'js/shared/page-shell.js'),'utf8');
  assert.match(shell,/"groupPlayerFollowupPage"/);
  assert.match(shell,/Objectifs coach/);
  assert.doesNotMatch(shell,/Objectifs coach en cours/);
});

for(const page of ['index','training']){
  test(`${page}: #groupPlayerFollowup est monté comme enfant direct du conteneur .app`,async t=>{
    const ui=await setup(t,page);
    const section=ui.$('#groupPlayerFollowup');
    const app=ui.$('.app');
    assert.ok(section);
    assert.ok(app);
    assert.equal(section.parentElement,app);
    assert.equal(section.closest('.app'),app);
    assert.equal(ui.w.document.querySelectorAll('#groupPlayerFollowup').length,1);
    assert.equal(ui.w.document.querySelector('#profilePopup').closest('.app'),null,'popups must stay outside .app');
  });
}

test('la migration du suivi reste sans stage et refuse l écriture du texte personnel',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261005093000_player_objective_follow_up.sql'),'utf8');
  assert.match(sql,/add column if not exists coach_note/);
  assert.match(sql,/add column if not exists player_note/);
  assert.doesNotMatch(sql,/add column if not exists stage/);
  assert.doesNotMatch(sql,/\bp_stage\b/);
  assert.doesNotMatch(sql,/stage_check/);
  assert.doesNotMatch(sql,/\n\s*stage text,/);
  assert.doesNotMatch(sql,/create or replace function public\.set_player_objective_stage/);
  assert.doesNotMatch(sql,/create or replace function public\.complete_player_objective/);
  assert.doesNotMatch(sql,/create or replace function public\.reopen_player_objective/);
  const grants=sql.match(/grant execute on function public\.update_player_objective_coach_fields\([^)]*\)[^;]*/g)||[];
  assert.deepEqual(grants,['grant execute on function public.update_player_objective_coach_fields(uuid,uuid,text,text) to authenticated']);
  assert.match(sql,/Objectif personnel non modifiable par le coach/);
  assert.match(sql,/security definer/);
  assert.match(sql,/set search_path to 'public','pg_temp'/);
  assert.match(sql,/private\.is_group_coach/);
});

function makeDb(dbCalls){
  return {
    from(table){
      const query={
        select(){dbCalls.push({table,method:'select'});return query},
        eq(){return query},
        maybeSingle(){return Promise.resolve({data:{message:'Salut',updated_at:'2026-10-01T00:00:00Z'},error:null})},
        update(args){dbCalls.push({table,method:'update',args});return query},
        insert(){dbCalls.push({table,method:'insert'});return query},
        upsert(){dbCalls.push({table,method:'upsert'});return query},
        then(resolve){return Promise.resolve({data:null,error:null}).then(resolve)}
      };
      return query;
    }
  };
}

test('la page de suivi joueur route ses vues et enregistre les droits',async t=>{
  const ui=await setup(t,'index');
  const app=ui.app;
  const dbCalls=[];
  app.groupState.groups=[{id:'g1',name:'Les Bleus',role:'owner'}];
  app.groupState.currentGroupId='g1';
  app.groupState.currentPlayers=[{id:'p1',display_name:'Alex',preferred_role:'A',stats_access:'personal'}];
  app.groupState.playerAccess={p1:true};
  app.reloadGroupPlayerFollowupObjectives=async()=>{};
  app.loadGroupPlayerMessageHistory=async()=>{};
  app.loadGroupPlayerFollowupConversation=async()=>{};
  app.renderGroupPlayers=()=>{};
  app.setCloud=()=>{};
  app.handleError=()=>{};
  app.db=makeDb(dbCalls);

  await app.openGroupPlayerFollowup('p1');
  await settle();

  const page=ui.$('#groupPlayerFollowup');
  assert.equal(page.classList.contains('hidden'),false);
  assert.equal(ui.$('#groupPlayerFollowupPanelFollowup').classList.contains('hidden'),false);
  assert.equal(ui.$('#groupPlayerFollowupPanelMessages').classList.contains('hidden'),true);
  assert.equal(ui.$('#groupPlayerFollowupPanelAccess').classList.contains('hidden'),true);
  assert.equal(page.querySelector('nav[aria-label]')!==null,true);
  assert.equal(ui.$('#groupPlayerFollowupTabFollowup').getAttribute('aria-current'),'page');
  assert.equal(ui.$('#groupPlayerFollowupTabAccess').getAttribute('aria-current'),null);
  assert.equal(ui.$('#groupPlayerFollowupMessage').value,'Salut');
  assert.equal(ui.$('#groupPlayerFollowupRole').value,'A');
  assert.equal(ui.$('#groupPlayerFollowupStatsAccess').value,'personal');
  assert.match(ui.$('#groupPlayerFollowupVideosLink').getAttribute('href'),/^videos\.html\?group=g1&player=p1&from=player-follow-up&source=index$/);
  assert.equal(ui.w.location.hash,'#player-follow-up');
  assert.match(ui.w.location.search,/staff_group=g1/);

  app.setGroupPlayerFollowupView('messages');
  assert.equal(ui.$('#groupPlayerFollowupPanelFollowup').classList.contains('hidden'),true);
  assert.equal(ui.$('#groupPlayerFollowupPanelMessages').classList.contains('hidden'),false);
  assert.equal(ui.$('#groupPlayerFollowupTabMessages').getAttribute('aria-current'),'page');
  assert.equal(ui.w.location.hash,'#player-follow-up-messages');

  app.setGroupPlayerFollowupView('access');
  assert.equal(ui.$('#groupPlayerFollowupPanelAccess').classList.contains('hidden'),false);
  assert.equal(ui.w.location.hash,'#player-follow-up-access');

  dbCalls.length=0;
  await app.saveGroupPlayerFollowup();
  await settle();
  const mutations=dbCalls.filter(c=>['update','insert','upsert','delete'].includes(c.method));
  assert.deepEqual(mutations.map(c=>c.method),['update']);
  assert.equal(mutations[0].table,'coaching_group_players');
  assert.equal(mutations[0].args.preferred_role,'A');
  assert.equal(mutations[0].args.stats_access,'personal');
});

test('la route de suivi restaure la page depuis l url',async t=>{
  const ui=await setup(t,'index',{url:'https://local.test/index.html?staff_group=g1&staff_player=p1#player-follow-up-access'});
  const app=ui.app;
  app.groupState.groups=[{id:'g1',name:'Les Bleus',role:'owner'}];
  app.groupState.currentGroupId='g1';
  app.groupState.currentPlayers=[{id:'p1',display_name:'Alex',preferred_role:'A',stats_access:'personal'}];
  app.groupState.playerAccess={p1:true};
  app.reloadGroupPlayerFollowupObjectives=async()=>{};
  app.loadGroupPlayerMessageHistory=async()=>{};
  app.loadGroupPlayerFollowupConversation=async()=>{};
  app.renderGroupPlayers=()=>{};
  app.setCloud=()=>{};
  app.handleError=()=>{};

  const restored=await app.restoreGroupPlayerFollowupRoute({replace:true});
  assert.equal(restored,true);
  assert.equal(ui.$('#groupPlayerFollowup').classList.contains('hidden'),false);
  assert.equal(ui.$('#groupPlayerFollowupPanelAccess').classList.contains('hidden'),false);
  assert.equal(ui.$('#groupPlayerFollowupTabAccess').getAttribute('aria-current'),'page');
});

test('un joueur inaccessible affiche un repli explicite',async t=>{
  const ui=await setup(t,'index');
  const app=ui.app;
  app.groupState.groups=[{id:'g1',name:'Les Bleus',role:'owner'}];
  app.groupState.currentGroupId='g1';
  app.groupState.currentPlayers=[];
  app.fetchGroupPlayers=async()=>[];
  app.handleError=()=>{};

  const opened=await app.openGroupPlayerFollowup('p1');
  assert.equal(opened,false);
  const missing=ui.$('#groupPlayerFollowupPanelUnavailable');
  assert.ok(missing);
  assert.equal(missing.classList.contains('hidden'),false);
  assert.match(ui.$('#groupPlayerFollowupUnavailableMessage').textContent,/pas accessible/);
});

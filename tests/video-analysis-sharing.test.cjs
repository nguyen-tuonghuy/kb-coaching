const {test}=require('node:test');
const assert=require('node:assert/strict');
const {deferred,loadVideoPage,settle,videoClient}=require('./helpers/video-page-harness.cjs');

const clone=value=>JSON.parse(JSON.stringify(value));

function makeStore({status='new',reviewText=null,notes=[]}={}){
  return {
    video:{id:'v1',status,title:'Service',file_name:'service.mp4',drive_file_id:'drive-1',seen_by_me:true,review_text:reviewText,uploaded_at:'2026-10-01T10:00:00Z'},
    notes:clone(notes),
    reviewCalls:0
  };
}

function makeClient(store,{player=false,reviewRoute=null}={}){
  const config={player_id:'p1',player_name:'Alex Martin',drive_folder_id:null,feedback_doc_id:null};
  return videoClient({
    session:{user:{id:player?'player-1':'coach-1'},access_token:'token',refresh_token:'refresh'},
    rpcs:{
      get_my_player_access:()=>({data:[{group_id:'g1',player_id:'p1',player_name:'Alex Martin',group_name:'Bleus'}],error:null}),
      get_player_video_config:()=>({data:[config],error:null}),
      get_player_videos:()=>({data:[clone(store.video)],error:null}),
      get_player_video_notes:()=>player&&store.video.status!=='reviewed'
        ?{data:null,error:{message:'Accès aux brouillons refusé'}}
        :{data:clone(store.notes),error:null},
      mark_player_video_seen:()=>({data:null,error:null}),
      review_player_video:args=>{
        store.reviewCalls+=1;
        if(player)return {data:null,error:{message:'Réservé aux entraîneurs'}};
        if(reviewRoute)return reviewRoute(args);
        store.video.status='reviewed';store.video.review_text=args.p_review_text;
        return {data:null,error:null};
      },
      add_player_video_note:args=>{
        const note={id:`n${store.notes.length+1}`,note_time_ms:args.p_note_time_ms,note_text:args.p_note_text,snapshot_data_url:args.p_snapshot_data_url,drawing_data:args.p_drawing_data,author_user_id:'coach-1',author_name:'Coach',created_at:'2026-10-15T10:00:00Z'};
        store.notes.push(note);
        return {data:note,error:null};
      },
      update_player_video_note:args=>{
        const note=store.notes.find(item=>item.id===args.p_note_id);
        if(note){note.note_text=args.p_note_text;note.note_time_ms=args.p_note_time_ms;note.drawing_data=args.p_drawing_data;note.snapshot_data_url=args.p_snapshot_data_url}
        return {data:null,error:null};
      },
      delete_player_video_note:args=>{
        store.notes=store.notes.filter(item=>item.id!==args.p_note_id);
        return {data:null,error:null};
      }
    },
    functions:{
      'player-drive':({body})=>body.action==='get_stream_url'
        ?{data:{stream_url:'https://stream.test/video.mp4'},error:null}
        :{data:{count:1},error:null}
    }
  });
}

async function setupCoach(t,store,options={}){
  const client=makeClient(store,options);
  const ui=await loadVideoPage({client});
  t.after(()=>ui.close());
  await ui.evaluate('openVideo("v1")');
  return ui;
}

async function setupPlayer(t,store){
  const client=makeClient(store,{player:true});
  const ui=await loadVideoPage({client,url:'https://local.test/videos.html?group=g1'});
  t.after(()=>ui.close());
  await ui.evaluate('openVideo("v1")');
  return ui;
}

test('un repère enregistré reste invisible au joueur avant le partage',async t=>{
  const store=makeStore({notes:[{id:'n1',note_time_ms:1200,note_text:'Placement',drawing_data:[],created_at:'2026-10-01T10:00:00Z'}]});
  const ui=await setupPlayer(t,store);
  assert.match(ui.$('#noteList').textContent,/l’entraîneur aura partagé son analyse/);
  assert.equal(ui.client.calls.some(call=>call.name==='get_player_video_notes'),false);
  assert.equal(ui.$('#analysisSharing').classList.contains('hidden'),true);
});

test('le partage avec un repère et sans commentaire attend la confirmation serveur',async t=>{
  const gate=deferred();
  const store=makeStore({notes:[{id:'n1',note_time_ms:1200,note_text:'Placement',drawing_data:[],created_at:'2026-10-01T10:00:00Z'}]});
  const ui=await setupCoach(t,store,{reviewRoute:async args=>{
    const result=await gate.promise;
    if(!result.error){store.video.status='reviewed';store.video.review_text=args.p_review_text}
    return result;
  }});
  const pending=ui.evaluate('saveAnalysisReview("v1",{publish:true,confirmPublish:false})');
  await settle();
  assert.equal(store.reviewCalls,1);
  assert.equal(ui.$('#analysisSharingTitle').textContent,'Analyse non partagée');
  assert.equal(ui.$('#shareAnalysisBtn').disabled,true);
  gate.resolve({data:null,error:null});
  assert.equal(await pending,true);
  assert.equal(ui.client.calls.find(call=>call.name==='review_player_video').args.p_review_text,null);
  assert.equal(ui.$('#analysisSharingTitle').textContent,'Analyse partagée');
  assert.match(ui.$('#videoList').textContent,/Analyse partagée avec le joueur/);
});

test('un commentaire global seul autorise le partage et le dialogue nomme le joueur',async t=>{
  const store=makeStore();
  const ui=await setupCoach(t,store);
  ui.$('#analysisReviewText').value='Bonne progression';
  ui.$('#shareAnalysisBtn').click();
  await settle();
  assert.match(ui.$('#analysisDialogText').textContent,/Partager cette analyse avec Alex/);
  ui.$('#analysisDialogPrimary').click();
  await settle();await settle();
  assert.equal(store.video.status,'reviewed');
  assert.equal(store.video.review_text,'Bonne progression');
});

test('le partage vide est refusé explicitement sans appel RPC',async t=>{
  const store=makeStore();
  const ui=await setupCoach(t,store);
  assert.equal(await ui.evaluate('saveAnalysisReview("v1",{publish:true,confirmPublish:false})'),false);
  assert.match(ui.$('#analysisSharingMessage').textContent,/au moins un repère ou un commentaire global/);
  assert.equal(store.reviewCalls,0);
});

test('les clics successifs ne lancent qu une publication',async t=>{
  const gate=deferred(),store=makeStore({notes:[{id:'n1',note_time_ms:0,drawing_data:[],created_at:'2026-10-01T10:00:00Z'}]});
  const ui=await setupCoach(t,store,{reviewRoute:async()=>{
    const result=await gate.promise;
    if(!result.error)store.video.status='reviewed';
    return result;
  }});
  const first=ui.evaluate('saveAnalysisReview("v1",{publish:true,confirmPublish:false})');
  const second=ui.evaluate('saveAnalysisReview("v1",{publish:true,confirmPublish:false})');
  await settle();
  assert.equal(store.reviewCalls,1);
  gate.resolve({data:null,error:null});
  assert.equal(await first,true);
  assert.equal(await second,true);
});

test('une erreur réseau conserve les annotations et le statut non partagé',async t=>{
  const note={id:'n1',note_time_ms:0,note_text:'Conservé',drawing_data:[],created_at:'2026-10-01T10:00:00Z'};
  const store=makeStore({notes:[note]});
  const ui=await setupCoach(t,store,{reviewRoute:()=>({data:null,error:{message:'Réseau indisponible'}})});
  assert.equal(await ui.evaluate('saveAnalysisReview("v1",{publish:true,confirmPublish:false})'),false);
  assert.equal(store.video.status,'new');
  assert.equal(store.notes.length,1);
  assert.match(ui.$('#analysisSharingMessage').textContent,/Réseau indisponible/);
  assert.equal(ui.$('#analysisSharingTitle').textContent,'Analyse non partagée');
});

test('la sortie avertit et son annulation conserve le lecteur',async t=>{
  const store=makeStore({notes:[{id:'n1',note_time_ms:0,drawing_data:[],created_at:'2026-10-01T10:00:00Z'}]});
  const ui=await setupCoach(t,store);
  let left=false;
  const pending=ui.evaluate('guardAnalysisExit(()=>{window.__left=true})');
  await settle();
  assert.match(ui.$('#analysisDialogText').textContent,/annotations sont bien enregistrées/);
  assert.equal(ui.$('#analysisDialogPrimary').textContent,'Partager maintenant');
  assert.equal(ui.$('#analysisDialogSecondary').textContent,'Quitter sans partager');
  ui.$('#analysisDialogCancel').click();
  assert.equal(await pending,false);
  left=ui.w.__left===true;
  assert.equal(left,false);
  assert.equal(ui.$('#playerBox').classList.contains('hidden'),false);
  assert.equal(ui.evaluate('state.currentVideoId'),'v1');
});

test('une vidéo reviewed historique reste partagée même sans commentaire',async t=>{
  const store=makeStore({status:'reviewed',notes:[{id:'n1',note_time_ms:0,note_text:'Ancien repère',drawing_data:[],created_at:'2026-09-01T10:00:00Z'}]});
  const ui=await setupCoach(t,store);
  assert.equal(ui.$('#analysisSharingTitle').textContent,'Analyse partagée');
  assert.equal(ui.$('#shareAnalysisBtn').classList.contains('hidden'),true);
  assert.equal(ui.$('#updateAnalysisBtn').classList.contains('hidden'),false);
});

test('après publication, un nouveau repère est immédiatement visible au joueur',async t=>{
  const store=makeStore({status:'reviewed',notes:[{id:'n1',note_time_ms:0,note_text:'Initial',drawing_data:[],created_at:'2026-10-01T10:00:00Z'}]});
  const coach=await setupCoach(t,store);
  coach.$('#noteText').value='Ajout publié';
  await coach.evaluate('saveNote()');
  assert.equal(store.notes.length,2);
  assert.match(coach.$('#analysisSharingMessage').textContent,/visible par Alex/);
  const player=await setupPlayer(t,store);
  assert.match(player.$('#noteList').textContent,/Initial/);
  assert.match(player.$('#noteList').textContent,/Ajout publié/);

  coach.evaluate('state.editingNoteId="n1"');
  coach.$('#noteText').value='Initial modifié';
  await coach.evaluate('saveNote()');
  coach.w.confirm=()=>true;
  await coach.evaluate('deleteNote("n2")');
  const refreshedPlayer=await setupPlayer(t,store);
  assert.match(refreshedPlayer.$('#noteList').textContent,/Initial modifié/);
  assert.doesNotMatch(refreshedPlayer.$('#noteList').textContent,/Ajout publié/);
});

test('le joueur ne dispose d aucune publication et le serveur simulé refuse son appel direct',async t=>{
  const store=makeStore({notes:[{id:'n1',note_time_ms:0,drawing_data:[],created_at:'2026-10-01T10:00:00Z'}]});
  const ui=await setupPlayer(t,store);
  assert.equal(ui.$('#analysisSharing').classList.contains('hidden'),true);
  const result=await ui.evaluate('db.rpc("review_player_video",{p_group_id:"g1",p_video_id:"v1",p_review_text:null})');
  assert.match(result.error.message,/Réservé aux entraîneurs/);
  const draft=await ui.evaluate('db.rpc("get_player_video_notes",{p_group_id:"g1",p_video_id:"v1"})');
  assert.match(draft.error.message,/brouillons refusé/);
  assert.equal(store.video.status,'new');
});

test('le streaming, les contrôles et l éditeur de repères restent opérationnels',async t=>{
  const store=makeStore();
  const ui=await setupCoach(t,store);
  const streamCall=ui.client.calls.find(call=>call.kind==='function'&&call.args.body.action==='get_stream_url');
  assert.ok(streamCall);
  assert.equal(ui.$('#video').getAttribute('src'),'https://stream.test/video.mp4');
  ui.$('#annotationModeBtn').click();
  assert.equal(ui.evaluate('state.annotationMode'),true);
  ui.$('#noteText').value='Repère sans dessin';
  await ui.evaluate('saveNote()');
  assert.equal(store.notes.length,1);
  assert.equal(ui.evaluate('state.annotationMode'),false);
  assert.equal(ui.$('#video').controls,true);
});

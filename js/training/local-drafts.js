/* Versioned local persistence for the training editor. No network side effects. */
((app) => {
  const PREFIX='kinball.training.draft.v1:';
  const SCHEMA_VERSION=1;
  const MAX_HISTORY=10;

  const clone=value=>JSON.parse(JSON.stringify(value));
  const sameDocument=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const part=value=>encodeURIComponent(String(value||''));

  function validDocument(document){
    return !!document&&typeof document==='object'&&!Array.isArray(document)
      &&typeof document.fields==='object'&&document.fields!==null
      &&Array.isArray(document.planBlocks)
      &&Array.isArray(document.sessionExercises)
      &&Array.isArray(document.attendance)
      &&typeof document.resultDraft==='object'&&document.resultDraft!==null&&!Array.isArray(document.resultDraft);
  }

  function validRecord(record){
    return !!record&&typeof record==='object'&&record.schemaVersion===SCHEMA_VERSION
      &&typeof record.userId==='string'&&!!record.userId
      &&typeof record.workspaceId==='string'&&!!record.workspaceId
      &&typeof record.draftId==='string'&&!!record.draftId
      &&Number.isInteger(record.revision)&&record.revision>=1
      &&typeof record.savedAt==='string'&&validDocument(record.document)
      &&Boolean(record.baseVersion==null||Number.isInteger(record.baseVersion))
      &&Array.isArray(record.history);
  }

  app.createTrainingDraftStore = function createTrainingDraftStore(storage=null){
    if(!storage){
      try{storage=window.localStorage}
      catch(accessError){
        storage={get length(){throw accessError},key(){throw accessError},getItem(){throw accessError},setItem(){throw accessError},removeItem(){throw accessError}};
      }
    }
    const keyFor=({userId,workspaceId,draftId})=>`${PREFIX}${part(userId)}:${part(workspaceId)}:${part(draftId)}`;

    const parse=(raw,key='')=>{
      try{
        const record=JSON.parse(raw);
        if(!validRecord(record))return {ok:false,kind:record?.schemaVersion!==SCHEMA_VERSION?'incompatible':'invalid',key,raw};
        return {ok:true,record};
      }catch(error){return {ok:false,kind:'invalid',key,raw,error}}
    };

    const read=identity=>{
      const key=keyFor(identity);
      try{
        const raw=storage.getItem(key);
        return raw==null?{ok:true,record:null}:{...parse(raw,key),key};
      }catch(error){return {ok:false,kind:'storage',key,error}}
    };

    const list=({userId,workspaceId})=>{
      const records=[],unreadable=[];
      try{
        for(let i=0;i<storage.length;i+=1){
          const key=storage.key(i);
          if(!key?.startsWith(PREFIX))continue;
          const raw=storage.getItem(key);
          if(raw==null)continue;
          const parsed=parse(raw,key);
          if(!parsed.ok){unreadable.push(parsed);continue}
          const record=parsed.record;
          if(record.userId===String(userId||'')&&record.workspaceId===String(workspaceId||''))records.push(record);
        }
        records.sort((a,b)=>Date.parse(b.savedAt||0)-Date.parse(a.savedAt||0));
        return {ok:true,records:clone(records),unreadable};
      }catch(error){return {ok:false,kind:'storage',error,records:[],unreadable}}
    };

    const write=(candidate,{checkpointReason='',preserveCurrent=false}={})=>{
      const identity={userId:candidate.userId,workspaceId:candidate.workspaceId,draftId:candidate.draftId};
      const existingResult=read(identity);
      if(!existingResult.ok)return existingResult;
      const existing=existingResult.record;
      const expected=candidate.expectedRevision??existing?.revision??0;
      if(existing&&existing.revision!==expected){
        return {ok:false,kind:'conflict',record:clone(existing)};
      }

      let history=Array.isArray(existing?.history)?clone(existing.history):[];
      if(checkpointReason){
        const document=preserveCurrent?candidate.document:existing?.document;
        if(validDocument(document)&&!sameDocument(history.at(-1)?.document,document)){
          history.push({savedAt:new Date().toISOString(),reason:checkpointReason,document:clone(document)});
        }
      }
      history=history.slice(-MAX_HISTORY);
      const record={
        schemaVersion:SCHEMA_VERSION,
        userId:String(candidate.userId||''),
        workspaceId:String(candidate.workspaceId||''),
        draftId:String(candidate.draftId||''),
        sessionId:candidate.sessionId||null,
        sourceSessionId:candidate.sourceSessionId||null,
        baseUpdatedAt:candidate.baseUpdatedAt||null,
        baseVersion:candidate.baseVersion==null?null:candidate.baseVersion,
        ownerTabId:candidate.ownerTabId||null,
        revision:(existing?.revision||0)+1,
        savedAt:new Date().toISOString(),
        meta:clone(candidate.meta||{}),
        document:clone(candidate.document),
        history
      };
      if(!validRecord(record))return {ok:false,kind:'invalid'};
      try{
        storage.setItem(keyFor(record),JSON.stringify(record));
        return {ok:true,record:clone(record)};
      }catch(error){return {ok:false,kind:'storage',error}}
    };

    const remove=identity=>{
      const current=read(identity);
      if(!current.ok)return current;
      if(!current.record)return {ok:true};
      const expected=identity.expectedRevision??identity.revision;
      if(expected!=null&&current.record.revision!==expected)return {ok:false,kind:'conflict',record:clone(current.record)};
      if(identity.ownerTabId&&current.record.ownerTabId&&current.record.ownerTabId!==identity.ownerTabId)return {ok:false,kind:'conflict',record:clone(current.record)};
      try{storage.removeItem(keyFor(identity));return {ok:true}}
      catch(error){return {ok:false,kind:'storage',error}}
    };

    return {prefix:PREFIX,schemaVersion:SCHEMA_VERSION,maxHistory:MAX_HISTORY,keyFor,read,list,write,remove,validDocument};
  };

  app.TRAINING_DRAFT_SCHEMA_VERSION=SCHEMA_VERSION;
})(window.KinballCoach.app);

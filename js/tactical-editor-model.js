/* Versioned tactical-diagram documents, history and local persistence. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.KinballTacticalModel=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const SCHEMA='kinball-coach-tactical-diagram';
  const SCHEMA_VERSION=1;
  const STORAGE_PREFIX='kinball.tactical-diagram.v1:';
  const DOCUMENT_SIZE=1000;
  const DRAW_MIN_SPAN=12;
  const OBJECT_TYPES=new Set(['player','ball','arrow','curve','line','zone','text']);
  const TEAMS=new Set(['black','gray','pink']);
  const ZONE_SHAPES=new Set(['rectangle','ellipse']);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const text=(value,max)=>typeof value==='string'&&value.length<=max;
  const validColor=value=>text(value,40)&&(/^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^)]+\)|[a-z]+)$/i).test(value);

  function createId(prefix='item'){
    if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  }

  function now(){return new Date().toISOString()}

  function baseObject(type,overrides={}){
    return {
      id:createId(type),type,x:DOCUMENT_SIZE/2,y:DOCUMENT_SIZE/2,rotation:0,
      scaleX:1,scaleY:1,opacity:1,...overrides
    };
  }

  function createObject(type,overrides={}){
    const defaults={
      player:{radius:34,team:'black',label:'1'},
      ball:{radius:58,label:'KIN-BALL'},
      arrow:{points:[-90,0,90,0],stroke:'#1768B3',strokeWidth:8},
      curve:{points:[-100,50,0,-80,100,30],stroke:'#F4267D',strokeWidth:8,curvature:0.3},
      line:{points:[-90,0,90,0],stroke:'#172033',strokeWidth:6,dashed:false},
      zone:{shape:'rectangle',width:220,height:150,fill:'#1768B3',stroke:'#0B315B',strokeWidth:4},
      text:{text:'Consigne',width:260,fontSize:32,fill:'#172033'}
    };
    if(!OBJECT_TYPES.has(type))throw new Error(`Type d'objet inconnu : ${type}`);
    return baseObject(type,{...defaults[type],...overrides});
  }

  // Trois points (début, contrôle, fin) d'une courbe dérivés de deux extrémités
  // et d'une courbure signée proportionnelle à la longueur de la corde.
  function curvePoints(start,end,curvature=0.3){
    const midX=(start.x+end.x)/2,midY=(start.y+end.y)/2;
    const dx=end.x-start.x,dy=end.y-start.y;
    const length=Math.hypot(dx,dy)||1;
    const offset=curvature*length;
    return [start.x,start.y,midX-dy/length*offset,midY+dx/length*offset,end.x,end.y];
  }

  // Session d'un tracé en deux clics : le premier clic l'initialise, chaque
  // mouvement met à jour l'aperçu, le second clic produit l'objet ou annule
  // si l'arrivée est trop proche du départ. Aucune dépendance Konva.
  function createDrawSession(type,start){
    const origin={x:start.x,y:start.y};
    let current={x:start.x,y:start.y};
    return {
      type,
      start:{...origin},
      update(point){
        current={x:point.x,y:point.y};
        return {start:{...origin},point:{...current}};
      },
      end(endPoint){
        const end={x:endPoint.x,y:endPoint.y};
        if(Math.hypot(end.x-origin.x,end.y-origin.y)<DRAW_MIN_SPAN)return {kind:'cancel'};
        const mid={x:(origin.x+end.x)/2,y:(origin.y+end.y)/2};
        let object;
        if(type==='curve'){
          const [ax,ay,cx,cy,bx,by]=curvePoints(origin,end,0.3);
          object=createObject(type,{x:mid.x,y:mid.y,points:[ax-mid.x,ay-mid.y,cx-mid.x,cy-mid.y,bx-mid.x,by-mid.y],curvature:0.3});
        }else{
          object=createObject(type,{x:mid.x,y:mid.y,points:[origin.x-mid.x,origin.y-mid.y,end.x-mid.x,end.y-mid.y]});
        }
        return {kind:'object',object};
      }
    };
  }

  function createDocument(title='Nouveau schéma'){
    const stamp=now();
    return {
      schema:SCHEMA,schemaVersion:SCHEMA_VERSION,id:createId('diagram'),title,
      createdAt:stamp,updatedAt:stamp,
      canvas:{width:DOCUMENT_SIZE,height:DOCUMENT_SIZE},
      court:{width:20,height:20,unit:'m',proportion:'square',basis:'working-default'},
      objects:[]
    };
  }

  function validateObject(object,index,ids){
    const at=`objects[${index}]`;
    if(!object||typeof object!=='object'||Array.isArray(object))return `${at} doit être un objet`;
    if(!text(object.id,120)||!object.id)return `${at}.id est invalide`;
    if(ids.has(object.id))return `${at}.id est dupliqué`;
    ids.add(object.id);
    if(!OBJECT_TYPES.has(object.type))return `${at}.type est inconnu`;
    for(const key of ['x','y','rotation','scaleX','scaleY','opacity'])if(!finite(object[key]))return `${at}.${key} doit être un nombre fini`;
    if(object.scaleX<=0||object.scaleY<=0)return `${at} possède une échelle invalide`;
    if(object.opacity<0||object.opacity>1)return `${at}.opacity doit être compris entre 0 et 1`;
    if(['player','ball'].includes(object.type)&&(!finite(object.radius)||object.radius<8||object.radius>300))return `${at}.radius est invalide`;
    if(object.type==='player'&&(!TEAMS.has(object.team)||!text(object.label,40)))return `${at} possède une équipe ou un libellé invalide`;
    if(['arrow','curve','line'].includes(object.type)){
      const expected=object.type==='curve'?6:4;
      if(!Array.isArray(object.points)||object.points.length!==expected||object.points.some(value=>!finite(value)))return `${at}.points est invalide`;
      if(!validColor(object.stroke)||!finite(object.strokeWidth)||object.strokeWidth<1||object.strokeWidth>60)return `${at} possède un trait invalide`;
      if(object.type==='line'&&typeof object.dashed!=='boolean')return `${at}.dashed est invalide`;
      if(object.type==='curve'&&object.curvature!==undefined&&(!finite(object.curvature)||object.curvature<-2||object.curvature>2))return `${at}.curvature est invalide`;
    }
    if(object.type==='zone'){
      if(!ZONE_SHAPES.has(object.shape)||!finite(object.width)||!finite(object.height)||object.width<10||object.height<10)return `${at} possède une géométrie invalide`;
      if(!validColor(object.fill)||!validColor(object.stroke)||!finite(object.strokeWidth)||object.strokeWidth<1||object.strokeWidth>60)return `${at} possède un style invalide`;
    }
    if(object.type==='text'&&(!text(object.text,2000)||!finite(object.width)||object.width<20||!finite(object.fontSize)||object.fontSize<8||object.fontSize>180||!validColor(object.fill)))return `${at} possède un texte invalide`;
    if(object.type==='ball'&&object.label!==undefined&&!text(object.label,40))return `${at}.label est invalide`;
    return null;
  }

  function validateDocument(document){
    if(!document||typeof document!=='object'||Array.isArray(document))return {ok:false,error:'Le document JSON doit être un objet'};
    if(document.schema!==SCHEMA)return {ok:false,error:'Ce fichier n’est pas un schéma tactique Kinball Coach'};
    if(document.schemaVersion!==SCHEMA_VERSION)return {ok:false,error:`Version ${document.schemaVersion??'absente'} non prise en charge`};
    if(!text(document.id,120)||!document.id)return {ok:false,error:'Identifiant de schéma invalide'};
    if(!text(document.title,160)||!document.title.trim())return {ok:false,error:'Titre de schéma invalide'};
    if(!text(document.createdAt,40)||!text(document.updatedAt,40))return {ok:false,error:'Dates du schéma invalides'};
    if(!document.canvas||document.canvas.width!==DOCUMENT_SIZE||document.canvas.height!==DOCUMENT_SIZE)return {ok:false,error:`Le canevas doit mesurer ${DOCUMENT_SIZE} x ${DOCUMENT_SIZE} unités`};
    if(!document.court||!finite(document.court.width)||!finite(document.court.height)||document.court.width<=0||document.court.height<=0||!text(document.court.unit,12))return {ok:false,error:'Configuration du terrain invalide'};
    if(!Array.isArray(document.objects)||document.objects.length>500)return {ok:false,error:'La liste des objets est invalide ou trop grande'};
    const ids=new Set();
    for(let index=0;index<document.objects.length;index+=1){
      const error=validateObject(document.objects[index],index,ids);
      if(error)return {ok:false,error};
    }
    return {ok:true,document:clone(document)};
  }

  function parseDocument(raw){
    if(typeof raw!=='string')return {ok:false,error:'Le contenu importé doit être du texte JSON'};
    if(raw.length>2_000_000)return {ok:false,error:'Le fichier dépasse la limite de 2 Mo'};
    try{return validateDocument(JSON.parse(raw))}
    catch(error){return {ok:false,error:`JSON illisible : ${error.message}`}}
  }

  class History{
    constructor(document,limit=100){
      this.limit=limit;this.past=[];this.present=clone(document);this.future=[];
    }
    reset(document){this.past=[];this.present=clone(document);this.future=[];return this.current()}
    commit(document){
      const next=clone(document);
      if(JSON.stringify(next)===JSON.stringify(this.present))return this.current();
      this.past.push(this.present);
      if(this.past.length>this.limit)this.past.shift();
      this.present=next;this.future=[];return this.current();
    }
    undo(){if(!this.past.length)return null;this.future.unshift(this.present);this.present=this.past.pop();return this.current()}
    redo(){if(!this.future.length)return null;this.past.push(this.present);this.present=this.future.shift();return this.current()}
    current(){return clone(this.present)}
    get canUndo(){return this.past.length>0}
    get canRedo(){return this.future.length>0}
  }

  function createStore(storage){
    const target=storage||(typeof localStorage!=='undefined'?localStorage:null);
    if(!target)throw new Error('Stockage local indisponible');
    const key=id=>`${STORAGE_PREFIX}${encodeURIComponent(id)}`;
    const read=id=>{
      try{
        const raw=target.getItem(key(id));
        if(raw===null)return {ok:true,document:null};
        return parseDocument(raw);
      }catch(error){return {ok:false,error:`Lecture locale impossible : ${error.message}`}}
    };
    const list=()=>{
      const documents=[],errors=[];
      try{
        for(let index=0;index<target.length;index+=1){
          const itemKey=target.key(index);
          if(!itemKey||!itemKey.startsWith(STORAGE_PREFIX))continue;
          const parsed=parseDocument(target.getItem(itemKey));
          if(parsed.ok)documents.push(parsed.document);else errors.push({key:itemKey,error:parsed.error});
        }
        documents.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
        return {ok:true,documents,errors};
      }catch(error){return {ok:false,error:`Liste locale inaccessible : ${error.message}`,documents:[],errors}}
    };
    const save=document=>{
      const checked=validateDocument(document);
      if(!checked.ok)return checked;
      try{target.setItem(key(document.id),JSON.stringify(document));return {ok:true,document:clone(document)}}
      catch(error){return {ok:false,error:`Enregistrement local impossible : ${error.message}`}}
    };
    const remove=id=>{
      try{target.removeItem(key(id));return {ok:true}}
      catch(error){return {ok:false,error:`Suppression locale impossible : ${error.message}`}}
    };
    return {prefix:STORAGE_PREFIX,key,read,list,save,remove};
  }

  return {SCHEMA,SCHEMA_VERSION,STORAGE_PREFIX,DOCUMENT_SIZE,DRAW_MIN_SPAN,OBJECT_TYPES,TEAMS,createId,createObject,curvePoints,createDrawSession,createDocument,validateDocument,parseDocument,History,createStore,clone};
});

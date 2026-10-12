/* Tactical editor UI and Konva rendering. Documents remain library-independent. */
(function(){
  'use strict';

  const Model=window.KinballTacticalModel;
  const TEAM_STYLE={
    black:{fill:'#172033',text:'#FFFFFF',marker:'N'},
    gray:{fill:'#CBD5E1',text:'#172033',marker:'G'},
    pink:{fill:'#F4267D',text:'#FFFFFF',marker:'R'}
  };
  const TYPE_LABEL={player:'Joueur',ball:'Ballon',arrow:'Flèche',curve:'Trajectoire',line:'Ligne',zone:'Zone',text:'Texte'};
  const TRANSFORM_TYPES=new Set(['player','ball','arrow','curve','line','zone','text']);
  const STROKE_TYPES=new Set(['arrow','curve','line','zone']);
  const DRAW_TYPES=new Set(['arrow','curve','line']);
  const DRAW_HINT='Premier clic : départ. Second clic : arrivée. Échap annule.';
  const deepFreeze=value=>{
    if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
    Object.freeze(value);Object.values(value).forEach(deepFreeze);return value;
  };

  class TacticalEditor{
    constructor(root,options={}){
      if(!Model)throw new Error('Le modèle tactique est indisponible.');
      this.root=root;
      this.options=options;
      this.$=selector=>root.querySelector(selector);
      this.readOnly=false;this.saveHandler=null;this._document=Model.createDocument();
      Object.defineProperty(this,'document',{enumerable:true,get:()=>this._document,set:value=>{
        if(this.readOnly)throw new Error('Éditeur tactique en lecture seule.');
        this._document=value;
      }});
      this.history=new Model.History(this.document);
      this.store=Model.createStore(options.storage);
      this.selectedIds=[];
      this.nodes=new Map();
      this.mode='select';
      this.zoom=1;
      this.fitScale=1;
      this.viewOffset={x:0,y:0};
      this.dirty=false;
      this.currentStored=false;
      this.savedSnapshot='';
      this.marqueeStart=null;
      this.marqueeMoved=false;
      this.dragPositions=null;
      this.drawTool=null;
      this.draw=null;
      this.resizeObserver=null;
      this.toastTimer=null;
      this.lastFocus=null;
      this.defaultHint=this.$('#canvasHint')?.textContent||'';
      this.initStage();
      this.bindUI();
      this.loadDiagram(this.document,{clean:true,resetHistory:true});
      if(options.readOnly)this.setReadOnly(true);
    }

    canMutate(notify=true){
      if(!this.readOnly)return true;
      if(notify)this.showToast('Ce schéma est ouvert en lecture seule.',true);
      return false;
    }

    setSaveHandler(handler){this.saveHandler=typeof handler==='function'?handler:null}

    setReadOnly(readOnly=true){
      const next=!!readOnly;if(next===this.readOnly)return next;
      if(next){
        this.cancelDraw(false);this.world?.stopDrag?.();this.world?.draggable?.(false);
        this._document=deepFreeze(Model.clone(this._document));
      }else this._document=Model.clone(this._document);
      this.readOnly=next;this.root.classList?.toggle('tacticalReadOnly',next);
      const title=this.$('#diagramTitle');if(title){title.readOnly=next;title.setAttribute?.('aria-readonly',String(next));title.value=this.document.title}
      const selectors=['#newDiagram','#saveDiagram','#openDiagrams','#importJson','#importFile','#duplicateObjects','#deleteObjects','#bringForward','#sendBackward','[data-add]','#propertiesForm input','#propertiesForm select','#propertiesForm textarea'];
      this.root.querySelectorAll(selectors.join(',')).forEach(control=>{
        if(next){if(!control.disabled){control.disabled=true;control.dataset.readOnlyDisabled='true'}}
        else if(control.dataset.readOnlyDisabled==='true'){control.disabled=false;delete control.dataset.readOnlyDisabled}
      });
      for(const node of this.nodes.values())node.draggable(this.mode==='select'&&!next);
      if(this.transformer){this.transformer.visible(!next&&this.mode==='select'&&this.selectedIds.length>0);this.transformer.forceUpdate();this.overlayLayer.batchDraw()}
      this.updateHistoryButtons();this.markDirty();return next;
    }

    initStage(){
      const container=this.$('#konvaContainer');
      if(typeof window.Konva==='undefined'){
        this.$('#canvasError').hidden=false;
        this.$('#canvasError').textContent='Le moteur graphique Konva.js n’a pas pu être chargé. Vérifiez la connexion puis rechargez la page.';
        this.stage=null;
        return;
      }
      this.stage=new Konva.Stage({container,width:container.clientWidth||600,height:container.clientHeight||600});
      this.layer=new Konva.Layer();
      this.overlayLayer=new Konva.Layer();
      this.world=new Konva.Group();
      this.gridGroup=new Konva.Group({listening:false});
      this.objectGroup=new Konva.Group();
      this.previewGroup=new Konva.Group({listening:false});
      this.world.add(this.createCourt(),this.gridGroup,this.objectGroup,this.previewGroup);
      this.layer.add(this.world);
      this.transformer=new Konva.Transformer({
        rotateEnabled:true,flipEnabled:false,borderStroke:'#1768B3',anchorStroke:'#1768B3',anchorFill:'#FFFFFF',
        anchorSize:14,anchorCornerRadius:7,padding:5,keepRatio:false,
        boundBoxFunc:(oldBox,newBox)=>newBox.width<20||newBox.height<20?oldBox:newBox
      });
      this.selectionRect=new Konva.Rect({visible:false,fill:'rgba(23,104,179,.14)',stroke:'#1768B3',dash:[8,5],listening:false});
      this.overlayLayer.add(this.selectionRect,this.transformer);
      this.stage.add(this.layer,this.overlayLayer);
      this.drawGrid();
      this.bindStage();
      this.resizeObserver=new ResizeObserver(()=>this.resizeStage());
      this.resizeObserver.observe(this.$('#canvasViewport'));
    }

    createCourt(){
      const size=Model.DOCUMENT_SIZE;
      const group=new Konva.Group({name:'court'});
      group.add(new Konva.Rect({x:0,y:0,width:size,height:size,fill:'#FDFDFB',stroke:'#0B315B',strokeWidth:10,name:'court'}));
      group.add(new Konva.Line({points:[size/2-18,size/2,size/2+18,size/2],stroke:'#627083',strokeWidth:4,listening:false}));
      group.add(new Konva.Line({points:[size/2,size/2-18,size/2,size/2+18],stroke:'#627083',strokeWidth:4,listening:false}));
      return group;
    }

    drawGrid(){
      if(!this.gridGroup)return;
      this.gridGroup.destroyChildren();
      const size=Model.DOCUMENT_SIZE;
      for(let value=50;value<size;value+=50){
        const major=value%250===0;
        this.gridGroup.add(new Konva.Line({points:[value,0,value,size],stroke:major?'#B7C4D1':'#DDE4EB',strokeWidth:major?2:1}));
        this.gridGroup.add(new Konva.Line({points:[0,value,size,value],stroke:major?'#B7C4D1':'#DDE4EB',strokeWidth:major?2:1}));
      }
      this.gridGroup.moveToTop();
      this.objectGroup.moveToTop();
      this.previewGroup.moveToTop();
    }

    resizeStage(){
      if(!this.stage)return;
      const viewport=this.$('#canvasViewport');
      const width=Math.max(280,viewport.clientWidth);
      const height=Math.max(300,viewport.clientHeight);
      this.stage.size({width,height});
      this.fitView(false);
    }

    fitView(resetZoom=true){
      if(!this.stage)return;
      const padding=28;
      this.fitScale=Math.min((this.stage.width()-padding*2)/Model.DOCUMENT_SIZE,(this.stage.height()-padding*2)/Model.DOCUMENT_SIZE);
      if(resetZoom){this.zoom=1;this.viewOffset={x:0,y:0}}
      const scale=this.fitScale*this.zoom;
      this.world.scale({x:scale,y:scale});
      this.world.position({
        x:(this.stage.width()-Model.DOCUMENT_SIZE*scale)/2+this.viewOffset.x,
        y:(this.stage.height()-Model.DOCUMENT_SIZE*scale)/2+this.viewOffset.y
      });
      this.transformer.getLayer()?.batchDraw();
      this.transformer.forceUpdate();
      this.layer.batchDraw();
      this.updateZoomLabel();
    }

    setZoom(next,pointer){
      if(!this.stage)return;
      const oldScale=this.world.scaleX();
      const bounded=Math.max(.5,Math.min(3,next));
      const newScale=this.fitScale*bounded;
      const focus=pointer||{x:this.stage.width()/2,y:this.stage.height()/2};
      const local={x:(focus.x-this.world.x())/oldScale,y:(focus.y-this.world.y())/oldScale};
      this.zoom=bounded;
      this.world.scale({x:newScale,y:newScale});
      this.world.position({x:focus.x-local.x*newScale,y:focus.y-local.y*newScale});
      const centered={x:(this.stage.width()-Model.DOCUMENT_SIZE*newScale)/2,y:(this.stage.height()-Model.DOCUMENT_SIZE*newScale)/2};
      this.viewOffset={x:this.world.x()-centered.x,y:this.world.y()-centered.y};
      this.layer.batchDraw();this.overlayLayer.batchDraw();this.updateZoomLabel();
      this.transformer.forceUpdate();
    }

    updateZoomLabel(){this.$('#zoomValue').textContent=`${Math.round(this.zoom*100)} %`}

    bindStage(){
      this.stage.on('wheel',event=>{
        event.evt.preventDefault();
        const direction=event.evt.deltaY>0?-.1:.1;
        this.setZoom(this.zoom+direction,this.stage.getPointerPosition());
      });
      this.stage.on('pointerdown',event=>{
        if(this.mode!=='draw'||this.readOnly)return;
        event.evt.preventDefault();
        this.handleDrawPoint();
      });
      this.stage.on('pointermove',()=>{if(this.mode==='draw'&&!this.readOnly)this.updateDrawPreview()});
      this.stage.on('mousedown touchstart',event=>{
        if(this.mode==='draw')return;
        if(this.mode==='pan'){
          this.marqueeStart=this.stage.getPointerPosition();
          this.world.draggable(true);this.world.startDrag();
          return;
        }
        const isCourt=event.target===this.stage||event.target.name()==='court'||event.target.getParent()?.name()==='court';
        if(!isCourt)return;
        const point=this.stage.getPointerPosition();
        this.marqueeStart=point;this.marqueeMoved=false;
        this.selectionRect.setAttrs({x:point.x,y:point.y,width:0,height:0,visible:true});
        this.overlayLayer.batchDraw();
      });
      this.stage.on('mousemove touchmove',()=>{
        if(this.mode==='draw'){this.updateDrawPreview();return}
        if(!this.marqueeStart)return;
        if(this.mode==='pan')return;
        const point=this.stage.getPointerPosition();
        const x=Math.min(this.marqueeStart.x,point.x),y=Math.min(this.marqueeStart.y,point.y);
        const width=Math.abs(point.x-this.marqueeStart.x),height=Math.abs(point.y-this.marqueeStart.y);
        this.marqueeMoved=this.marqueeMoved||width>4||height>4;
        this.selectionRect.setAttrs({x,y,width,height});this.overlayLayer.batchDraw();
      });
      this.stage.on('mouseup touchend',event=>{
        if(this.mode==='pan'){
          if(this.marqueeStart){
            this.world.stopDrag();this.world.draggable(false);
            const scale=this.world.scaleX();
            const centered={x:(this.stage.width()-Model.DOCUMENT_SIZE*scale)/2,y:(this.stage.height()-Model.DOCUMENT_SIZE*scale)/2};
            this.viewOffset={x:this.world.x()-centered.x,y:this.world.y()-centered.y};this.transformer.forceUpdate();
          }
          this.marqueeStart=null;return;
        }
        if(!this.marqueeStart)return;
        const box=this.selectionRect.getClientRect();
        this.selectionRect.visible(false);this.marqueeStart=null;
        if(this.marqueeMoved){
          this.selectedIds=[...this.nodes].filter(([,node])=>Konva.Util.haveIntersection(box,node.getClientRect())).map(([id])=>id);
          this.updateSelection();
        }else if(!event.evt.shiftKey){this.selectedIds=[];this.updateSelection()}
        this.marqueeMoved=false;this.overlayLayer.batchDraw();
      });
      this.world.on('dragmove',()=>{if(this.mode==='pan'){this.layer.batchDraw();this.overlayLayer.batchDraw()}});
      this.transformer.on('transformend',()=>this.syncSelectedNodes('Transformation'));
    }

    bindUI(){
      this.root.addEventListener('click',event=>{
        const add=event.target.closest('[data-add]');
        if(add){
          const type=add.dataset.add;
          if(DRAW_TYPES.has(type))this.startDraw(type);
          else this.addObject(type,{team:add.dataset.team});
          return;
        }
        const mode=event.target.closest('[data-mode]');
        if(mode){if(this.mode==='draw')this.cancelDraw(false);this.setMode(mode.dataset.mode)}
      });
      this.$('#mobilePanToggle').addEventListener('click',()=>this.setMode(this.mode==='pan'?'select':'pan'));
      this.$('#showGrid').addEventListener('change',event=>{this.gridGroup.visible(event.target.checked);this.layer.batchDraw()});
      this.$('#zoomIn').addEventListener('click',()=>this.setZoom(this.zoom+.1));
      this.$('#zoomOut').addEventListener('click',()=>this.setZoom(this.zoom-.1));
      this.$('#fitView').addEventListener('click',()=>this.fitView(true));
      this.$('#undoAction').addEventListener('click',()=>this.undo());
      this.$('#redoAction').addEventListener('click',()=>this.redo());
      this.$('#newDiagram').addEventListener('click',()=>this.newDiagram());
      this.$('#saveDiagram').addEventListener('click',()=>this.save());
      this.$('#openDiagrams').addEventListener('click',()=>this.openLibrary());
      this.$('#exportJson').addEventListener('click',()=>this.exportJSON());
      this.$('#importJson').addEventListener('click',()=>this.$('#importFile').click());
      this.$('#importFile').addEventListener('change',event=>this.importJSON(event.target.files[0]));
      this.$('#exportPng').addEventListener('click',()=>this.downloadPNG());
      this.$('#diagramTitle').addEventListener('input',event=>{
        if(!this.canMutate(false)){event.target.value=this.document.title;return}
        this.document.title=event.target.value;this.markDirty();
      });
      this.$('#diagramTitle').addEventListener('change',()=>{
        if(!this.canMutate(false)){this.$('#diagramTitle').value=this.document.title;return}
        this.document.title=this.document.title.trim()||'Nouveau schéma';this.$('#diagramTitle').value=this.document.title;this.commit('Renommage');
      });
      this.$('#duplicateObjects').addEventListener('click',()=>this.duplicateSelected());
      this.$('#deleteObjects').addEventListener('click',()=>this.deleteSelected());
      this.$('#bringForward').addEventListener('click',()=>this.changeOrder(1));
      this.$('#sendBackward').addEventListener('click',()=>this.changeOrder(-1));
      this.bindProperties();
      this.bindDialog();
      window.addEventListener('keydown',event=>this.onKeyDown(event));
      window.addEventListener('keyup',event=>{if(event.code==='Space'&&this.previousMode){const mode=this.previousMode;this.previousMode=null;this.setMode(mode)}});
      window.addEventListener('beforeunload',event=>{if(this.dirty){event.preventDefault();event.returnValue=''}});
    }

    bindProperties(){
      const fields={
        objectLabel:['change',value=>({key:this.firstSelected().type==='text'?'text':'label',value})],
        objectTeam:['change',value=>({key:'team',value})],
        objectShape:['change',value=>({key:'shape',value})],
        objectFill:['change',value=>({key:'fill',value})],
        objectStroke:['change',value=>({key:'stroke',value})],
        objectStrokeWidth:['change',value=>({key:'strokeWidth',value:Number(value)})],
        objectFontSize:['change',value=>({key:'fontSize',value:Number(value)})],
        objectCurvature:['change',value=>({key:'curvature',value:Number(value)})]
      };
      for(const [id,[eventName,map]] of Object.entries(fields))this.$(`#${id}`).addEventListener(eventName,event=>{
        if(this.selectedIds.length!==1)return;
        const update=map(event.target.value);this.updateSelectedProperty(update.key,update.value);
      });
      this.$('#objectCurvature').addEventListener('input',event=>{this.$('#objectCurvatureValue').textContent=Number(event.target.value).toFixed(2)});
      this.$('#objectDashed').addEventListener('change',event=>this.updateSelectedProperty('dashed',event.target.checked));
    }

    bindDialog(){
      const dialog=document.querySelector('#libraryDialog');
      dialog.querySelectorAll('.dialogClose').forEach(button=>button.addEventListener('click',()=>this.closeLibrary()));
      dialog.addEventListener('click',event=>{if(event.target===dialog)this.closeLibrary()});
      document.addEventListener('keydown',event=>{
        if(dialog.hidden)return;
        if(event.key==='Escape'){event.preventDefault();this.closeLibrary();return}
        if(event.key!=='Tab')return;
        const controls=[...dialog.querySelectorAll('button:not(:disabled)')];
        if(!controls.length)return;
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      });
    }

    onKeyDown(event){
      if(!document.querySelector('#libraryDialog').hidden)return;
      const editing=['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName);
      const modifier=event.ctrlKey||event.metaKey;
      if(modifier&&event.key.toLowerCase()==='s'){event.preventDefault();this.save();return}
      if(editing)return;
      if(modifier&&event.key.toLowerCase()==='z'){
        event.preventDefault();event.shiftKey?this.redo():this.undo();return;
      }
      if(modifier&&event.key.toLowerCase()==='y'){event.preventDefault();this.redo();return}
      if((event.key==='Delete'||event.key==='Backspace')&&this.selectedIds.length){event.preventDefault();this.deleteSelected();return}
      if(modifier&&event.key.toLowerCase()==='d'&&this.selectedIds.length){event.preventDefault();this.duplicateSelected();return}
      if(modifier&&event.key.toLowerCase()==='a'){event.preventDefault();this.selectedIds=this.document.objects.map(object=>object.id);this.updateSelection();return}
      if(this.selectedIds.length&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
        if(!this.canMutate())return;
        event.preventDefault();const step=event.shiftKey?10:2;const delta={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[event.key];
        this.document.objects.filter(object=>this.selectedIds.includes(object.id)).forEach(object=>{object.x+=delta[0];object.y+=delta[1]});this.commit('Déplacement clavier');return;
      }
      if(event.key==='Escape'&&this.mode==='draw'){event.preventDefault();this.cancelDraw();return}
      if(event.code==='Space'&&!event.repeat&&this.mode!=='draw'){event.preventDefault();this.previousMode=this.mode;this.setMode('pan')}
      if(event.key==='Escape'){this.selectedIds=[];this.updateSelection()}
    }

    setMode(mode){
      this.mode=mode==='pan'?'pan':'select';
      this.root.querySelectorAll('[data-mode]').forEach(button=>{const active=button.dataset.mode===this.mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
      const mobile=this.$('#mobilePanToggle');mobile.classList.toggle('active',this.mode==='pan');mobile.setAttribute('aria-pressed',String(this.mode==='pan'));
      this.$('#canvasViewport').style.cursor=this.mode==='pan'?'grab':'default';
      for(const node of this.nodes.values())node.draggable(this.mode==='select'&&!this.readOnly);
      if(this.transformer){this.transformer.visible(!this.readOnly&&this.mode==='select'&&this.selectedIds.length>0);this.overlayLayer.batchDraw()}
    }

    localCenter(){
      if(!this.stage)return {x:500,y:500};
      const transform=this.world.getAbsoluteTransform().copy().invert();
      const point=transform.point({x:this.stage.width()/2,y:this.stage.height()/2});
      return {x:Math.max(40,Math.min(960,point.x)),y:Math.max(40,Math.min(960,point.y))};
    }

    addObject(type,overrides={}){
      if(!this.canMutate())return false;
      const center=this.localCenter();
      const same=this.document.objects.filter(object=>object.type===type).length;
      const position={x:center.x+(same%5)*12,y:center.y+(same%5)*12};
      if(type==='player')position.label=String(same+1);
      const object=Model.createObject(type,{...position,...overrides});
      this.document.objects.push(object);this.selectedIds=[object.id];this.commit(`Ajout ${TYPE_LABEL[type]}`);
    }

    stageToLocal(point=this.stage?.getPointerPosition()){
      if(!this.stage||!point)return null;
      return this.world.getAbsoluteTransform().copy().invert().point(point);
    }

    markActiveTool(type){this.root.querySelectorAll('[data-add]').forEach(button=>button.classList.toggle('active',button.dataset.add===type))}

    startDraw(type){
      if(!this.canMutate())return false;
      if(this.mode==='pan')this.setMode('select');
      this.cancelDraw(false);
      this.mode='draw';this.drawTool=type;
      this.selectedIds=[];this.updateSelection();
      for(const node of this.nodes.values())node.draggable(false);
      if(this.transformer){this.transformer.visible(false);this.overlayLayer.batchDraw()}
      this.markActiveTool(type);
      this.$('#canvasViewport').style.cursor='crosshair';
      this.$('#canvasHint').textContent=DRAW_HINT;
    }

    handleDrawPoint(){
      if(!this.canMutate())return false;
      const point=this.stageToLocal();if(!point)return;
      if(!this.draw){
        const group=this.buildPreview(this.drawTool,point);
        this.previewGroup.add(group);this.previewGroup.moveToTop();this.layer.batchDraw();
        const session=Model.createDrawSession(this.drawTool,point);
        session.preview={group,shape:group._geom};
        this.draw=session;
        return;
      }
      const result=this.draw.end(point);
      if(result.kind==='cancel'){this.cancelDraw();return}
      this.finalizeDraw(result.object);
    }

    updateDrawPreview(){
      if(!this.draw)return;
      const point=this.stageToLocal();if(!point)return;
      const {start,point:current}=this.draw.update(point);
      this.draw.preview.shape.points(this.draw.type==='curve'?Model.curvePoints(start,current,0.3):[start.x,start.y,current.x,current.y]);
      this.layer.batchDraw();
    }

    buildPreview(type,point){
      const sample=Model.createObject(type);
      const points=[point.x,point.y,point.x,point.y];
      const geom=type==='line'
        ?new Konva.Line({points,stroke:sample.stroke,strokeWidth:sample.strokeWidth,dash:sample.dashed?[20,14]:[],lineCap:'round',listening:false})
        :new Konva.Arrow({points,stroke:sample.stroke,fill:sample.stroke,strokeWidth:sample.strokeWidth,pointerLength:22,pointerWidth:20,tension:type==='curve'?.55:0,lineCap:'round',lineJoin:'round',listening:false});
      const dot=new Konva.Circle({x:point.x,y:point.y,radius:7,fill:'#1768B3',listening:false});
      const group=new Konva.Group({opacity:.9,listening:false});
      group.add(geom,dot);group._geom=geom;
      return group;
    }

    finalizeDraw(object){
      if(!this.canMutate())return false;
      this.document.objects.push(object);
      this.cancelDraw(false);
      this.selectedIds=[object.id];
      this.commit(`Ajout ${TYPE_LABEL[object.type]}`);
    }

    cancelDraw(showToast=true){
      this.clearDrawPreview();
      this.drawTool=null;this.mode='select';
      this.markActiveTool(null);
      if(this.$('#canvasViewport'))this.$('#canvasViewport').style.cursor='default';
      if(this.$('#canvasHint'))this.$('#canvasHint').textContent=this.defaultHint;
      for(const node of this.nodes.values())node.draggable(!this.readOnly);
      this.root.querySelectorAll('[data-mode]').forEach(button=>{const active=button.dataset.mode==='select';button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
      if(showToast)this.showToast('Tracé annulé');
    }

    clearDrawPreview(){
      if(this.draw?.preview?.group)this.draw.preview.group.destroy();
      this.draw=null;
      if(this.previewGroup)this.previewGroup.destroyChildren();
      if(this.layer)this.layer.batchDraw();
    }

    buildNode(object){
      const group=new Konva.Group({id:object.id,x:object.x,y:object.y,rotation:object.rotation,scaleX:object.scaleX,scaleY:object.scaleY,opacity:object.opacity,draggable:this.mode==='select'&&!this.readOnly});
      if(object.type==='player'){
        const style=TEAM_STYLE[object.team];
        group.add(new Konva.Circle({radius:object.radius,fill:style.fill,stroke:'#0B315B',strokeWidth:5}));
        group.add(new Konva.Text({x:-object.radius,y:-13,width:object.radius*2,align:'center',text:`${style.marker} · ${object.label||''}`,fontSize:22,fontStyle:'bold',fill:style.text,listening:false}));
      }else if(object.type==='ball'){
        group.add(new Konva.Circle({radius:object.radius,fill:'#FFEB74',stroke:'#0B315B',strokeWidth:5}));
        group.add(new Konva.Arc({innerRadius:object.radius*.65,outerRadius:object.radius*.65,angle:100,rotation:22,stroke:'#1768B3',strokeWidth:6,listening:false}));
        group.add(new Konva.Arc({innerRadius:object.radius*.48,outerRadius:object.radius*.48,angle:105,rotation:202,stroke:'#F4267D',strokeWidth:6,listening:false}));
        group.add(new Konva.Text({x:-object.radius,y:-10,width:object.radius*2,align:'center',text:object.label||'KIN-BALL',fontSize:14,fontStyle:'bold',fill:'#172033',listening:false}));
      }else if(object.type==='arrow'){
        group.add(new Konva.Arrow({points:object.points,stroke:object.stroke,fill:object.stroke,strokeWidth:object.strokeWidth,pointerLength:22,pointerWidth:20,lineCap:'round',lineJoin:'round'}));
      }else if(object.type==='curve'){
        group.add(new Konva.Arrow({points:object.points,stroke:object.stroke,fill:object.stroke,strokeWidth:object.strokeWidth,pointerLength:22,pointerWidth:20,tension:.55,lineCap:'round',lineJoin:'round'}));
      }else if(object.type==='line'){
        group.add(new Konva.Line({points:object.points,stroke:object.stroke,strokeWidth:object.strokeWidth,dash:object.dashed?[20,14]:[],lineCap:'round'}));
      }else if(object.type==='zone'){
        const attrs={x:-object.width/2,y:-object.height/2,width:object.width,height:object.height,fill:object.fill,opacity:.22,stroke:object.stroke,strokeWidth:object.strokeWidth};
        group.add(object.shape==='ellipse'?new Konva.Ellipse({x:0,y:0,radiusX:object.width/2,radiusY:object.height/2,fill:attrs.fill,opacity:attrs.opacity,stroke:attrs.stroke,strokeWidth:attrs.strokeWidth}):new Konva.Rect(attrs));
      }else if(object.type==='text'){
        group.add(new Konva.Text({x:-object.width/2,y:-object.fontSize/2,width:object.width,text:object.text,fontSize:object.fontSize,fill:object.fill,align:'center',lineHeight:1.2,padding:5}));
      }
      group.on('click tap',event=>{
        if(this.mode!=='select')return;
        event.cancelBubble=true;
        const additive=event.evt.shiftKey||event.evt.ctrlKey||event.evt.metaKey;
        if(additive)this.selectedIds=this.selectedIds.includes(object.id)?this.selectedIds.filter(id=>id!==object.id):[...this.selectedIds,object.id];
        else this.selectedIds=[object.id];
        this.updateSelection();
      });
      group.on('dragstart',()=>{
        if(!this.selectedIds.includes(object.id)){this.selectedIds=[object.id];this.updateSelection()}
        this.dragPositions=new Map(this.selectedIds.map(id=>{const node=this.nodes.get(id);return [id,{x:node.x(),y:node.y()}]}));
      });
      group.on('dragmove',()=>{
        if(!this.dragPositions||this.selectedIds.length<2)return;
        const origin=this.dragPositions.get(object.id);if(!origin)return;
        const dx=group.x()-origin.x,dy=group.y()-origin.y;
        for(const id of this.selectedIds){if(id===object.id)continue;const node=this.nodes.get(id),start=this.dragPositions.get(id);if(node&&start)node.position({x:start.x+dx,y:start.y+dy})}
        this.transformer.forceUpdate();this.layer.batchDraw();this.overlayLayer.batchDraw();
      });
      group.on('dragend',()=>{this.syncSelectedNodes('Déplacement');this.dragPositions=null});
      return group;
    }

    renderObjects(){
      if(!this.stage)return;
      this.objectGroup.destroyChildren();this.nodes.clear();
      for(const object of this.document.objects){const node=this.buildNode(object);this.objectGroup.add(node);this.nodes.set(object.id,node)}
      this.updateSelection();this.layer.batchDraw();
      this.renderObjectList();
      this.$('#canvasEmpty').hidden=this.document.objects.length>0;
    }

    syncSelectedNodes(reason){
      if(!this.canMutate())return false;
      for(const id of this.selectedIds){
        const object=this.document.objects.find(item=>item.id===id),node=this.nodes.get(id);
        if(!object||!node)continue;
        Object.assign(object,{x:node.x(),y:node.y(),rotation:node.rotation(),scaleX:node.scaleX(),scaleY:node.scaleY()});
      }
      this.commit(reason);
    }

    firstSelected(){return this.document.objects.find(object=>object.id===this.selectedIds[0])||null}

    updateSelection(){
      this.selectedIds=this.selectedIds.filter(id=>this.nodes.has(id));
      if(this.transformer){this.transformer.nodes(this.selectedIds.map(id=>this.nodes.get(id)).filter(Boolean));this.transformer.visible(!this.readOnly&&this.mode==='select'&&this.selectedIds.length>0);this.transformer.forceUpdate();this.overlayLayer.batchDraw()}
      const count=this.selectedIds.length;
      this.$('#selectionStatus').textContent=count?`${count} objet${count>1?'s':''} sélectionné${count>1?'s':''}`:'Aucun objet sélectionné';
      this.$('#emptyProperties').hidden=count>0;this.$('#propertiesForm').hidden=count===0;
      this.renderObjectList();
      if(!count)return;
      this.$('#selectedCount').textContent=count>1?`${count} objets`:'1 objet';
      this.$('#selectedType').textContent=count>1?'Sélection multiple':TYPE_LABEL[this.firstSelected().type];
      this.root.querySelectorAll('.propertySingle,[data-property]').forEach(field=>field.hidden=count>1);
      if(count>1)return;
      const object=this.firstSelected();
      this.$('#objectLabel').maxLength=object.type==='text'?2000:40;
      const supports={
        label:['player','ball','text'].includes(object.type),team:object.type==='player',shape:object.type==='zone',
        fill:['zone','text'].includes(object.type),stroke:STROKE_TYPES.has(object.type),strokeWidth:STROKE_TYPES.has(object.type),
        fontSize:object.type==='text',dashed:object.type==='line',curvature:object.type==='curve'
      };
      for(const [property,visible] of Object.entries(supports))this.root.querySelector(`[data-property="${property}"]`).hidden=!visible;
      if(supports.label)this.$('#objectLabel').value=object.type==='text'?object.text:(object.label||'');
      if(supports.team)this.$('#objectTeam').value=object.team;
      if(supports.shape)this.$('#objectShape').value=object.shape;
      if(supports.fill)this.$('#objectFill').value=object.fill;
      if(supports.stroke)this.$('#objectStroke').value=object.stroke;
      if(supports.strokeWidth)this.$('#objectStrokeWidth').value=object.strokeWidth;
      if(supports.fontSize)this.$('#objectFontSize').value=object.fontSize;
      if(supports.dashed)this.$('#objectDashed').checked=object.dashed;
      if(supports.curvature){this.$('#objectCurvature').value=object.curvature;this.$('#objectCurvatureValue').textContent=Number(object.curvature).toFixed(2)}
    }

    updateSelectedProperty(key,value){
      if(!this.canMutate())return false;
      const object=this.firstSelected();if(!object)return;
      if(typeof value==='number'&&!Number.isFinite(value)){this.showToast('Valeur numérique invalide',true);this.updateSelection();return}
      const previous=object[key];object[key]=value;
      if(key==='curvature')this.applyCurvature(object);
      const checked=Model.validateDocument(this.document);
      if(!checked.ok){object[key]=previous;if(key==='curvature')this.applyCurvature(object);this.showToast(checked.error,true);this.updateSelection();return}
      this.commit(`Modification ${TYPE_LABEL[object.type]}`);
    }

    applyCurvature(object){
      if(!this.canMutate())return false;
      if(object.type!=='curve'||!Array.isArray(object.points)||object.points.length!==6)return;
      const start={x:object.x+object.points[0],y:object.y+object.points[1]};
      const end={x:object.x+object.points[4],y:object.y+object.points[5]};
      const [ax,ay,cx,cy,bx,by]=Model.curvePoints(start,end,Number(object.curvature)||0);
      object.points=[ax-object.x,ay-object.y,cx-object.x,cy-object.y,bx-object.x,by-object.y];
    }

    renderObjectList(){
      const list=this.$('#objectList');
      const focusedId=list.contains(document.activeElement)?document.activeElement.dataset.objectId:null;
      list.replaceChildren();
      if(!this.document.objects.length){const empty=document.createElement('div');empty.className='objectListEmpty';empty.textContent='Aucun objet';list.append(empty);return}
      this.document.objects.slice().reverse().forEach((object,index)=>{
        const button=document.createElement('button');button.type='button';button.className='ghost';button.dataset.objectId=object.id;button.classList.toggle('active',this.selectedIds.includes(object.id));button.setAttribute('aria-pressed',String(this.selectedIds.includes(object.id)));
        const label=object.type==='text'?object.text:(object.label||'');button.textContent=`${this.document.objects.length-index}. ${TYPE_LABEL[object.type]}${label?` - ${label}`:''}`;
        button.addEventListener('click',event=>{if(event.shiftKey||event.ctrlKey||event.metaKey)this.selectedIds=this.selectedIds.includes(object.id)?this.selectedIds.filter(id=>id!==object.id):[...this.selectedIds,object.id];else this.selectedIds=[object.id];this.updateSelection()});
        list.append(button);
      });
      if(focusedId)list.querySelector(`[data-object-id="${CSS.escape(focusedId)}"]`)?.focus();
    }

    duplicateSelected(){
      if(!this.canMutate())return false;
      if(!this.selectedIds.length)return;
      const copies=this.document.objects.filter(object=>this.selectedIds.includes(object.id)).map(object=>({...Model.clone(object),id:Model.createId(object.type),x:object.x+28,y:object.y+28}));
      this.document.objects.push(...copies);this.selectedIds=copies.map(object=>object.id);this.commit('Duplication');
    }

    deleteSelected(){
      if(!this.canMutate())return false;
      if(!this.selectedIds.length)return;
      this.document.objects=this.document.objects.filter(object=>!this.selectedIds.includes(object.id));this.selectedIds=[];this.commit('Suppression');
    }

    changeOrder(direction){
      if(!this.canMutate())return false;
      if(!this.selectedIds.length)return;
      const selected=new Set(this.selectedIds),items=this.document.objects;
      if(direction>0){for(let index=items.length-2;index>=0;index-=1)if(selected.has(items[index].id)&&!selected.has(items[index+1].id))[items[index],items[index+1]]=[items[index+1],items[index]]}
      else{for(let index=1;index<items.length;index+=1)if(selected.has(items[index].id)&&!selected.has(items[index-1].id))[items[index],items[index-1]]=[items[index-1],items[index]]}
      this.commit(direction>0?'Avancer':'Reculer');
    }

    commit(){
      if(!this.canMutate())return false;
      const comparable=value=>JSON.stringify({...value,updatedAt:null});
      if(comparable(this.document)===comparable(this.history.present)){this.document=Model.clone(this.history.present);this.refreshDocumentUI();return}
      this.document.updatedAt=new Date().toISOString();
      this.history.commit(this.document);this.markDirty();this.renderObjects();this.updateHistoryButtons();
    }

    undo(){if(!this.canMutate())return false;const document=this.history.undo();if(document){this.document=document;this.selectedIds=[];this.markDirty();this.refreshDocumentUI()}}
    redo(){if(!this.canMutate())return false;const document=this.history.redo();if(document){this.document=document;this.selectedIds=[];this.markDirty();this.refreshDocumentUI()}}

    updateHistoryButtons(){this.$('#undoAction').disabled=this.readOnly||!this.history.canUndo;this.$('#redoAction').disabled=this.readOnly||!this.history.canRedo}

    markDirty(){
      this.dirty=JSON.stringify(this.document)!==this.savedSnapshot;
      const status=this.$('#saveState');status.classList.toggle('isDirty',this.dirty);status.textContent=(this.dirty?'Modifications non enregistrées':(this.currentStored?'Enregistré localement':'Nouveau schéma'))+(this.readOnly?' · Lecture seule':'');
    }

    discardChanges(){this.savedSnapshot=JSON.stringify(this.document);this.dirty=false;this.markDirty();return true}

    refreshDocumentUI(){this.$('#diagramTitle').value=this.document.title;this.renderObjects();this.updateHistoryButtons()}

    confirmDiscard(){return !this.dirty||window.confirm('Des modifications ne sont pas enregistrées. Continuer sans les enregistrer ?')}

    newDiagram(){if(!this.canMutate())return false;if(!this.confirmDiscard())return;this.loadDiagram(Model.createDocument(),{clean:true,resetHistory:true});this.showToast('Nouveau schéma créé')}

    save(){
      if(!this.canMutate())return {ok:false,kind:'readonly'};
      this.document.title=(this.$('#diagramTitle').value||'').trim()||'Nouveau schéma';
      if(this.document.title!==this.history.present.title)this.commit('Renommage');
      this.document.updatedAt=new Date().toISOString();
      if(this.saveHandler)return this.saveHandler(this.getDiagram());
      const result=this.store.save(this.document);
      if(!result.ok){this.showToast(result.error,true);return result}
      this.history.present=Model.clone(this.document);this.savedSnapshot=JSON.stringify(this.document);this.currentStored=true;this.dirty=false;this.markDirty();this.$('#diagramTitle').value=this.document.title;this.showToast('Schéma enregistré dans ce navigateur');return result;
    }

    loadDiagram(document,{clean=false,resetHistory=true,stored=false}={}){
      if(!this.canMutate())return {ok:false,kind:'readonly'};
      const checked=Model.validateDocument(document);if(!checked.ok)throw new Error(checked.error);
      this.document=checked.document;this.selectedIds=[];
      if(resetHistory)this.history.reset(this.document);
      this.savedSnapshot=clean?JSON.stringify(this.document):'';this.currentStored=stored;this.dirty=!clean;
      this.refreshDocumentUI();this.markDirty();this.fitView(true);return this.getDiagram();
    }

    getDiagram(){return Model.clone(this.document)}

    openLibrary(){
      if(!this.renderLibrary())return;
      const dialog=document.querySelector('#libraryDialog');this.lastFocus=document.activeElement;dialog.hidden=false;dialog.querySelector('.dialogClose').focus();
    }

    renderLibrary(){
      const result=this.store.list();if(!result.ok){this.showToast(result.error,true);return false}
      const list=document.querySelector('#localDiagramList');list.replaceChildren();
      if(!result.documents.length){const empty=document.createElement('div');empty.className='libraryEmpty';empty.textContent='Aucun schéma enregistré sur cet appareil.';list.append(empty)}
      for(const diagram of result.documents){
        const item=document.createElement('article');item.className='localDiagramItem';
        const info=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('div');
        title.textContent=diagram.title;meta.className='localDiagramMeta';meta.textContent=`${diagram.objects.length} objet${diagram.objects.length>1?'s':''} · ${new Date(diagram.updatedAt).toLocaleString('fr-FR')}`;info.append(title,meta);
        const actions=document.createElement('div');actions.className='localDiagramActions';
        const open=this.actionButton('Ouvrir',()=>{if(!this.confirmDiscard())return;this.loadDiagram(diagram,{clean:true,stored:true});this.closeLibrary()});
        const rename=this.actionButton('Renommer',()=>this.renameStored(diagram));
        const remove=this.actionButton('Supprimer',()=>this.removeStored(diagram),true);
        actions.append(open,rename,remove);item.append(info,actions);list.append(item);
      }
      return true;
    }

    actionButton(label,action,danger=false){const button=document.createElement('button');button.type='button';button.className=danger?'dangerAction':'ghost';button.textContent=label;button.addEventListener('click',action);return button}

    closeLibrary(){const dialog=document.querySelector('#libraryDialog');dialog.hidden=true;this.lastFocus?.focus()}

    renameStored(diagram){
      if(!this.canMutate())return false;
      const title=window.prompt('Nouveau nom du schéma',diagram.title);if(title===null)return;
      const trimmed=title.trim();if(!trimmed){this.showToast('Le nom ne peut pas être vide',true);return}
      const currentWasDirty=this.document.id===diagram.id&&this.dirty;
      diagram.title=trimmed;diagram.updatedAt=new Date().toISOString();const result=this.store.save(diagram);
      if(!result.ok)this.showToast(result.error,true);else{if(this.document.id===diagram.id){this.document.title=trimmed;this.document.updatedAt=diagram.updatedAt;this.savedSnapshot=JSON.stringify(diagram);if(!currentWasDirty)this.history.present=Model.clone(this.document);this.refreshDocumentUI();this.markDirty()}this.renderLibrary();document.querySelector('#libraryDialog .dialogClose')?.focus()}
    }

    removeStored(diagram){
      if(!this.canMutate())return false;
      if(!window.confirm(`Supprimer définitivement « ${diagram.title} » de ce navigateur ?`))return;
      const result=this.store.remove(diagram.id);if(!result.ok)this.showToast(result.error,true);else{if(this.document.id===diagram.id){this.savedSnapshot='';this.currentStored=false;this.markDirty()}this.renderLibrary();document.querySelector('#libraryDialog .dialogClose')?.focus()}
    }

    exportJSON(){
      const checked=Model.validateDocument(this.document);if(!checked.ok){this.showToast(checked.error,true);return}
      this.downloadBlob(new Blob([JSON.stringify(this.document,null,2)],{type:'application/json'}),`${this.fileName()}.json`);this.showToast('Export JSON préparé');
    }

    async importJSON(file){
      if(!this.canMutate())return {ok:false,kind:'readonly'};
      this.$('#importFile').value='';if(!file)return;
      if(!this.confirmDiscard())return;
      try{
        if(file.size>2_000_000)throw new Error('Le fichier dépasse la limite de 2 Mo');
        const result=Model.parseDocument(await file.text());if(!result.ok)throw new Error(result.error);
        result.document.id=Model.createId('diagram');result.document.createdAt=new Date().toISOString();result.document.updatedAt=result.document.createdAt;
        this.loadDiagram(result.document,{clean:false});this.showToast('Schéma importé comme nouvelle copie. Enregistrez-le pour le conserver localement.');
      }catch(error){this.showToast(`Import impossible : ${error.message}`,true)}
    }

    toDataURL(pixelRatio=2){
      if(!this.stage)return null;
      const state={stageSize:this.stage.size(),position:this.world.position(),scale:this.world.scale(),transformer:this.transformer.visible(),grid:this.gridGroup.visible()};
      try{
        this.transformer.visible(false);this.world.position({x:0,y:0});this.world.scale({x:1,y:1});this.stage.size({width:Model.DOCUMENT_SIZE,height:Model.DOCUMENT_SIZE});this.stage.draw();
        return this.stage.toDataURL({x:0,y:0,width:Model.DOCUMENT_SIZE,height:Model.DOCUMENT_SIZE,pixelRatio});
      }finally{
        this.stage.size(state.stageSize);this.world.position(state.position);this.world.scale(state.scale);this.transformer.visible(state.transformer);this.gridGroup.visible(state.grid);this.transformer.forceUpdate();this.stage.draw();
      }
    }

    downloadPNG(){
      try{const data=this.toDataURL(2);if(!data)throw new Error('moteur graphique indisponible');const link=document.createElement('a');link.download=`${this.fileName()}.png`;link.href=data;link.click();this.showToast('Image PNG préparée')}
      catch(error){this.showToast(`Export PNG impossible : ${error.message}`,true)}
    }

    fileName(){return (this.document.title||'schema-tactique').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'schema-tactique'}

    downloadBlob(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),0)}

    showToast(message,error=false){const toast=document.querySelector('#toast');toast.textContent=message;toast.classList.toggle('isError',error);toast.hidden=false;clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>{toast.hidden=true},3500)}

    destroy(){this.resizeObserver?.disconnect();this.stage?.destroy()}
  }

  window.KinballCoach=window.KinballCoach||{};
  window.KinballCoach.TacticalEditor=TacticalEditor;
  window.KinballCoach.createTacticalEditor=(root,options)=>new TacticalEditor(root,options);

  const root=document.querySelector('.tacticalApp');
  if(root){
    try{window.KinballCoach.tacticalEditor=new TacticalEditor(root)}
    catch(error){const target=document.querySelector('#canvasError');if(target){target.hidden=false;target.textContent=`Éditeur indisponible : ${error.message}`}console.error('[tactical editor]',error)}
  }
})();

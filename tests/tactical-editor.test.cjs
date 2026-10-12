const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Model=require('../js/tactical-editor-model.js');

function memoryStorage(){
  const values=new Map();
  return {
    get length(){return values.size},
    key(index){return [...values.keys()][index]??null},
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)}
  };
}

class FakeNode{
  constructor(attrs={}){this.attrs={...attrs};this.children=[];this.parent=null;this.destroyed=false}
  add(...children){for(const child of children){child.parent=this;this.children.push(child)}return this}
  destroy(){this.destroyed=true;if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this)}
  destroyChildren(){for(const child of [...this.children])child.destroy();this.children=[]}
  moveToTop(){return this}
  on(){return this}
  draggable(value){if(value!==undefined)this.attrs.draggable=value;return this.attrs.draggable}
  points(value){if(value!==undefined)this.attrs.points=[...value];return this.attrs.points}
  visible(value){if(value!==undefined)this.attrs.visible=value;return this.attrs.visible}
}

class FakeStage{
  constructor(){this.pointer={x:0,y:0};this.handlers=new Map()}
  on(names,handler){for(const name of names.split(' ')){const handlers=this.handlers.get(name)||[];handlers.push(handler);this.handlers.set(name,handlers)}}
  emit(name,event={evt:{preventDefault(){}}}){for(const handler of this.handlers.get(name)||[])handler(event)}
  getPointerPosition(){return {...this.pointer}}
}

function createEditorHarness(){
  const Konva={
    Group:class Group extends FakeNode{},
    Arrow:class Arrow extends FakeNode{},
    Line:class Line extends FakeNode{},
    Circle:class Circle extends FakeNode{},
    Arc:class Arc extends FakeNode{},
    Text:class Text extends FakeNode{},
    Rect:class Rect extends FakeNode{},
    Ellipse:class Ellipse extends FakeNode{}
  };
  const sandbox={
    window:{KinballTacticalModel:Model},Konva,
    document:{querySelector:selector=>selector==='#libraryDialog'?{hidden:true}:null},console,setTimeout,clearTimeout
  };
  const source=fs.readFileSync(path.join(__dirname,'../js/tactical-editor.js'),'utf8');
  vm.runInNewContext(source,sandbox,{filename:'js/tactical-editor.js'});
  const Editor=sandbox.window.KinballCoach.TacticalEditor;
  const editor=Object.create(Editor.prototype);
  const elements={
    '#canvasViewport':{style:{}},
    '#canvasHint':{textContent:'Sélectionnez un objet'},
    '#canvasEmpty':{hidden:false},
    '#diagramTitle':{value:'Nouveau schéma',readOnly:false,setAttribute(){}}
  };
  editor.root={querySelectorAll:()=>[],classList:{toggle(){}}};
  editor.$=selector=>elements[selector]||null;
  editor.readOnly=false;editor.saveHandler=null;editor._document=Model.createDocument();
  Object.defineProperty(editor,'document',{enumerable:true,get:()=>editor._document,set:value=>{
    if(editor.readOnly)throw new Error('Éditeur tactique en lecture seule.');editor._document=value;
  }});
  editor.history=new Model.History(editor.document);
  editor.savedSnapshot=JSON.stringify(editor.document);
  editor.dirty=false;editor.currentStored=false;
  editor.selectedIds=[];editor.nodes=new Map();editor.mode='select';editor.drawTool=null;editor.draw=null;
  editor.defaultHint=elements['#canvasHint'].textContent;
  editor.stage=new FakeStage();
  editor.layer={batchDraw(){}};editor.overlayLayer={batchDraw(){}};
  editor.world={
    on(){},draggable(){},stopDrag(){},
    getAbsoluteTransform(){return {copy(){return this},invert(){return this},point(point){return {...point}}}}
  };
  editor.objectGroup=new Konva.Group();editor.previewGroup=new Konva.Group({listening:false});
  editor.transformer={on(){},visible(){},forceUpdate(){},nodes(){}};
  editor.updateSelection=()=>{};editor.renderObjectList=()=>{};editor.markDirty=()=>{};editor.updateHistoryButtons=()=>{};
  editor.showToast=()=>{};
  editor.bindStage();
  return {editor,Konva};
}

test('creates and round-trips every supported tactical object',()=>{
  const document=Model.createDocument('Défense centrale');
  for(const type of Model.OBJECT_TYPES)document.objects.push(Model.createObject(type));
  const checked=Model.validateDocument(document);
  assert.equal(checked.ok,true);
  const imported=Model.parseDocument(JSON.stringify(document));
  assert.equal(imported.ok,true);
  assert.deepEqual(imported.document,document);
  assert.equal(new Set(imported.document.objects.map(object=>object.id)).size,Model.OBJECT_TYPES.size);
});

test('rejects incompatible, duplicate and malformed documents',()=>{
  const incompatible=Model.createDocument();incompatible.schemaVersion=99;
  assert.match(Model.validateDocument(incompatible).error,/Version 99/);
  const duplicate=Model.createDocument();
  const player=Model.createObject('player');duplicate.objects=[player,{...player}];
  assert.match(Model.validateDocument(duplicate).error,/dupliqué/);
  const invalidZone=Model.createDocument();invalidZone.objects=[Model.createObject('zone',{strokeWidth:0})];
  assert.match(Model.validateDocument(invalidZone).error,/style invalide/);
  assert.match(Model.parseDocument('{').error,/JSON illisible/);
  assert.equal(Model.parseDocument('x'.repeat(2_000_001)).ok,false);
});

test('curve points derive a control point offset by signed curvature',()=>{
  const start={x:0,y:0},end={x:100,y:0};
  const flat=Model.curvePoints(start,end,0);
  assert.deepEqual(flat,[0,0,50,0,100,0]);
  const bent=Model.curvePoints(start,end,0.5);
  assert.equal(bent.length,6);
  assert.equal(bent[0],0);assert.equal(bent[4],100);
  assert.equal(bent[2],50);assert.equal(bent[3],50);
  const reversed=Model.curvePoints(start,end,-0.5);
  assert.equal(reversed[3],-50);
});

test('curve curvature is validated while staying optional for legacy documents',()=>{
  const document=Model.createDocument();
  const curve=Model.createObject('curve');
  assert.equal(Model.validateDocument({...document,objects:[curve]}).ok,true);
  assert.equal(Model.validateDocument({...document,objects:[{...curve,curvature:3}]}).ok,false);
  delete curve.curvature;
  assert.equal(Model.validateDocument({...document,objects:[curve]}).ok,true);
});

test('two-click draw cycle activates, previews and commits an object',()=>{
  const start={x:400,y:600},move={x:520,y:540},end={x:640,y:480};
  for(const type of ['arrow','line','curve']){
    const session=Model.createDrawSession(type,start);
    assert.equal(session.type,type);
    assert.deepEqual(session.start,start);
    const preview=session.update(move);
    assert.deepEqual(preview.start,start);
    assert.deepEqual(preview.point,move);
    const result=session.end(end);
    assert.equal(result.kind,'object');
    assert.equal(result.object.type,type);
    assert.equal(result.object.curvature,type==='curve'?0.3:undefined);
    const lastX=type==='curve'?4:2,lastY=type==='curve'?5:3;
    assert.equal(result.object.points[0],-result.object.points[lastX]);
    assert.equal(result.object.points[1],-result.object.points[lastY]);
    assert.equal(Model.validateDocument({...Model.createDocument(),objects:[result.object]}).ok,true);
  }
});

test('two-click draw cancels when the second click stays at the start point',()=>{
  for(const type of ['arrow','line','curve']){
    const start={x:400,y:400};
    const session=Model.createDrawSession(type,start);
    assert.equal(session.end({x:405,y:402}).kind,'cancel');
  }
});

test('two-click handlers keep every drawn object after rendering and changing tools',()=>{
  const expectedShape={arrow:'Arrow',line:'Line',curve:'Arrow'};
  const nextTool={arrow:'line',line:'curve',curve:'arrow'};
  for(const type of ['arrow','line','curve']){
    const {editor}=createEditorHarness();
    editor.startDraw(type);
    assert.equal(editor.mode,'draw');

    editor.stage.pointer={x:100,y:200};
    editor.stage.emit('pointerdown');
    assert.equal(editor.document.objects.length,0);
    assert.equal(editor.previewGroup.children.length,1);

    editor.stage.pointer={x:300,y:250};
    editor.stage.emit('pointermove');
    editor.stage.pointer={x:500,y:400};
    editor.stage.emit('pointerdown');

    assert.equal(editor.document.objects.length,1);
    const object=editor.document.objects[0];
    assert.equal(object.type,type);
    assert.equal(object.x,300);assert.equal(object.y,300);
    assert.equal(editor.previewGroup.children.length,0);
    assert.equal(editor.objectGroup.children.length,1);
    assert.equal(editor.objectGroup.children[0].children[0].constructor.name,expectedShape[type]);
    assert.equal(editor.nodes.has(object.id),true);

    editor.renderObjects();
    assert.equal(editor.document.objects.length,1);
    assert.equal(editor.objectGroup.children.length,1);
    assert.equal(editor.nodes.has(object.id),true);

    editor.startDraw(nextTool[type]);
    assert.equal(editor.document.objects.length,1);
    assert.equal(editor.objectGroup.children.length,1);
    assert.equal(editor.nodes.has(object.id),true);
  }
});

test('history restores complete immutable snapshots and clears redo branches',()=>{
  const first=Model.createDocument('Premier');
  const history=new Model.History(first,3);
  const second=Model.clone(first);second.objects.push(Model.createObject('ball'));
  history.commit(second);
  second.objects[0].x=999;
  assert.notEqual(history.current().objects[0].x,999);
  assert.equal(history.undo().objects.length,0);
  assert.equal(history.canRedo,true);
  assert.equal(history.redo().objects.length,1);
  history.undo();
  const branch=Model.clone(first);branch.objects.push(Model.createObject('text'));
  history.commit(branch);
  assert.equal(history.canRedo,false);
});

test('local store saves, lists, reopens and removes without changing documents',()=>{
  const store=Model.createStore(memoryStorage());
  const older=Model.createDocument('Ancien');older.updatedAt='2026-01-01T00:00:00.000Z';older.objects.push(Model.createObject('player',{team:'pink',label:'7'}));
  const recent=Model.createDocument('Récent');recent.updatedAt='2026-02-01T00:00:00.000Z';recent.objects.push(Model.createObject('curve'));
  assert.equal(store.save(older).ok,true);assert.equal(store.save(recent).ok,true);
  const listed=store.list();
  assert.equal(listed.ok,true);assert.deepEqual(listed.documents.map(document=>document.title),['Récent','Ancien']);
  assert.deepEqual(store.read(older.id).document,older);
  assert.equal(store.remove(older.id).ok,true);assert.equal(store.read(older.id).document,null);
});

test('store reports corrupt records without hiding valid diagrams',()=>{
  const storage=memoryStorage(),store=Model.createStore(storage),document=Model.createDocument('Valide');
  store.save(document);storage.setItem(`${Model.STORAGE_PREFIX}broken`,'not json');
  const listed=store.list();
  assert.equal(listed.ok,true);assert.equal(listed.documents.length,1);assert.equal(listed.errors.length,1);
});

test('read-only mode blocks direct API, keyboard and document mutations then restores editing',async()=>{
  const {editor}=createEditorHarness();
  editor.document.objects.push(Model.createObject('ball'));
  editor.history.reset(editor.document);editor.selectedIds=[editor.document.objects[0].id];
  let saveCalls=0;editor.setSaveHandler(()=>{saveCalls+=1;return {ok:true}});
  const before=JSON.stringify(editor.getDiagram());

  assert.equal(editor.setReadOnly(true),true);
  assert.equal(Object.isFrozen(editor.document),true);assert.equal(Object.isFrozen(editor.document.objects),true);
  assert.throws(()=>editor.document.objects.push(Model.createObject('player')),/extensible|read only|frozen/i);
  assert.throws(()=>{editor.document=Model.createDocument('Forcé')},/lecture seule/i);
  assert.equal(editor.addObject('player'),false);
  assert.equal(editor.startDraw('arrow'),false);
  assert.equal(editor.handleDrawPoint(),false);
  assert.equal(editor.finalizeDraw(Model.createObject('line')),false);
  assert.equal(editor.syncSelectedNodes('Déplacement'),false);
  assert.equal(editor.updateSelectedProperty('label','Forcé'),false);
  assert.equal(editor.applyCurvature(Model.createObject('curve')),false);
  assert.equal(editor.duplicateSelected(),false);assert.equal(editor.deleteSelected(),false);assert.equal(editor.changeOrder(1),false);
  assert.equal(editor.commit(),false);assert.equal(editor.undo(),false);assert.equal(editor.redo(),false);assert.equal(editor.newDiagram(),false);
  assert.equal(editor.loadDiagram(Model.createDocument('Autre')).kind,'readonly');
  assert.equal(editor.save().kind,'readonly');assert.equal(saveCalls,0);
  assert.equal((await editor.importJSON({size:2,text:async()=>before})).kind,'readonly');
  editor.renameStored(editor.getDiagram());editor.removeStored(editor.getDiagram());
  for(const event of [
    {key:'s',ctrlKey:true},{key:'z',ctrlKey:true},{key:'y',ctrlKey:true},{key:'d',ctrlKey:true},
    {key:'Delete'},{key:'ArrowRight'}
  ])editor.onKeyDown({target:{tagName:'DIV'},metaKey:false,shiftKey:false,repeat:false,code:'',preventDefault(){},...event});
  assert.equal(JSON.stringify(editor.getDiagram()),before);assert.equal(saveCalls,0);

  assert.equal(editor.discardChanges(),true);assert.equal(editor.dirty,false);assert.equal(JSON.stringify(editor.getDiagram()),before);

  assert.equal(editor.setReadOnly(false),false);assert.equal(Object.isFrozen(editor.document),false);
  editor.stage=null;
  editor.addObject('player');assert.equal(editor.document.objects.length,2);
  editor.save();assert.equal(saveCalls,1);
});

// Loads current HTML and whole local scripts. No function extraction or real network.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'../..');
execFileSync(process.execPath,[path.join(root,'tools/build-coaching-runtime.cjs'),'--check'],{cwd:root});

function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no});
  return {promise,resolve,reject};
}

function mockClient({session=null,tables={},rpcs={}}={}){
  const calls=[],listeners=[];
  const client={calls,listeners,tables,rpcs,session};
  const respond=async(kind,name,args)=>{
    calls.push({kind,name,args});
    if(kind==='table'&&args.some(op=>['insert','update','delete','upsert'].includes(op.method))){
      throw new Error(`Unexpected mock mutation: ${name}`);
    }
    const routes=kind==='table'?tables:rpcs;
    if(!Object.hasOwn(routes,name))throw new Error(`Unexpected mock ${kind}: ${name}`);
    const route=routes[name];
    return typeof route==='function'?route(args):{data:route,error:null};
  };
  client.from=table=>{
    const operations=[];
    const query=new Proxy({}, {get(_,method){
      if(method==='then')return (resolve,reject)=>respond('table',table,operations).then(resolve,reject);
      return (...args)=>{operations.push({method,args});return query};
    }});
    return query;
  };
  client.rpc=(name,args)=>respond('rpc',name,args);
  client.auth={
    getSession:async()=>{calls.push({kind:'auth',name:'getSession'});return {data:{session:client.session}}},
    onAuthStateChange:callback=>{listeners.push(callback);return {data:{subscription:{unsubscribe(){}}}}},
    updateUser:async args=>{calls.push({kind:'auth',name:'updateUser',args});return {error:null}},
    signOut:async()=>{calls.push({kind:'auth',name:'signOut'});return {error:null}}
  };
  return client;
}

async function settle(){
  // Flush promise jobs and Node's next event-loop turn, not a guessed UI delay.
  await new Promise(resolve=>setImmediate(resolve));
}

async function loadPage(page,{client=mockClient(),url=`https://local.test/${page}.html`}={}){
  if(!['index','training'].includes(page))throw new Error('Unsupported page');
  const html=fs.readFileSync(path.join(root,`${page}.html`),'utf8');
  const logs=[],alerts=[],timers=new Map();
  let nextTimer=1;
  const console=new VirtualConsole();
  for(const level of ['log','info','warn','error','jsdomError'])console.on(level,(...args)=>logs.push({level,args}));
  const dom=new JSDOM(html,{url,runScripts:'outside-only',virtualConsole:console,pretendToBeVisual:true});
  const w=dom.window;
  w.supabase={createClient:()=>client};
  w.alert=message=>alerts.push(String(message));
  w.confirm=()=>false;
  w.scrollTo=()=>{};
  for(const kind of ['timeout','interval']){
    w[kind==='timeout'?'setTimeout':'setInterval']=(callback,delay)=>{
      const id=nextTimer++;timers.set(id,{kind,callback,delay});return id;
    };
    w[kind==='timeout'?'clearTimeout':'clearInterval']=id=>timers.delete(id);
  }
  w.requestAnimationFrame=callback=>w.setTimeout(callback,16);
  w.cancelAnimationFrame=w.clearTimeout;
  const context=dom.getInternalVMContext();
  const evaluate=source=>new vm.Script(source).runInContext(context);
  // CDN Supabase is replaced above; PWA is tested in the real-browser harness.
  const scripts=[...w.document.querySelectorAll('script[src]')]
    .map(el=>el.getAttribute('src')).filter(src=>!/^https?:/.test(src)&&src!=='js/pwa.js');
  if(!scripts.includes(`js/${page}.js`))throw new Error(`Missing entry point for ${page}`);
  for(const src of scripts){
    const filename=path.resolve(root,src);
    if(!filename.startsWith(root+path.sep))throw new Error('Script outside project');
    new vm.Script(fs.readFileSync(filename,'utf8'),{filename}).runInContext(context);
  }
  // Test-only compatibility accessors let characterization expressions inspect
  // the explicit context. Production code exposes only KinballCoach.app.
  const app=w.KinballCoach?.app;
  if(app)for(const key of Object.keys(app)){
    if(key==='started'||key==='page')continue;
    Object.defineProperty(w,key,{configurable:true,get:()=>app[key],set:value=>{app[key]=value}});
  }
  await settle();
  return {dom,w,client,logs,alerts,timers,evaluate,close:()=>dom.window.close(),
    $:selector=>w.document.querySelector(selector)};
}

module.exports={loadPage,mockClient,deferred,settle};

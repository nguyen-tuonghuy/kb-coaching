const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');

const root=path.resolve(__dirname,'../..');

function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no});
  return {promise,resolve,reject};
}

async function settle(){
  await new Promise(resolve=>setImmediate(resolve));
}

function videoClient({session={user:{id:'coach-1'},access_token:'token',refresh_token:'refresh'},rpcs={},functions={}}={}){
  const calls=[];
  return {
    calls,
    auth:{
      getSession:async()=>({data:{session}}),
      signOut:async()=>({error:null})
    },
    rpc:async(name,args)=>{
      calls.push({kind:'rpc',name,args});
      if(!Object.hasOwn(rpcs,name))throw new Error(`Unexpected mock RPC: ${name}`);
      const route=rpcs[name];
      return typeof route==='function'?route(args):{data:route,error:null};
    },
    functions:{invoke:async(name,args)=>{
      calls.push({kind:'function',name,args});
      if(!Object.hasOwn(functions,name))throw new Error(`Unexpected mock function: ${name}`);
      const route=functions[name];
      return typeof route==='function'?route(args):{data:route,error:null};
    }}
  };
}

async function loadVideoPage({client,url='https://local.test/videos.html?group=g1&player=p1'}={}){
  const html=fs.readFileSync(path.join(root,'videos.html'),'utf8');
  const logs=[],alerts=[];
  const virtualConsole=new VirtualConsole();
  for(const level of ['log','info','warn','error','jsdomError'])virtualConsole.on(level,(...args)=>logs.push({level,args}));
  const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
  const w=dom.window;
  w.supabase={createClient:()=>client};
  w.alert=message=>alerts.push(String(message));
  w.confirm=()=>false;
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HTMLMediaElement.prototype.pause=()=>{};
  w.HTMLMediaElement.prototype.play=async()=>{};
  w.HTMLMediaElement.prototype.load=()=>{};
  const canvasContext={
    save(){},restore(){},setTransform(){},clearRect(){},drawImage(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},ellipse(){},closePath(){},fill(){}
  };
  w.HTMLCanvasElement.prototype.getContext=()=>canvasContext;
  w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,test';
  w.requestAnimationFrame=callback=>{callback();return 1};
  w.cancelAnimationFrame=()=>{};
  const context=dom.getInternalVMContext();
  const source=[...w.document.querySelectorAll('script:not([src])')].map(script=>script.textContent).find(text=>text.includes("const SUPABASE_URL="));
  if(!source)throw new Error('Inline video application script not found');
  new vm.Script(source,{filename:path.join(root,'videos.html')}).runInContext(context);
  await settle();await settle();
  return {
    dom,w,client,logs,alerts,
    evaluate:sourceText=>new vm.Script(sourceText).runInContext(context),
    $:selector=>w.document.querySelector(selector),
    close:()=>w.close()
  };
}

module.exports={deferred,loadVideoPage,settle,videoClient};

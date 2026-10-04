// Locks the three fallback tiers of newUuid(). Loads only the utility module:
// the page harness runs on an HTTPS origin where crypto.randomUUID() always
// exists, so it can never expose the missing-Web-Crypto paths.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');
const {loadPage}=require('./helpers/page-harness.cjs');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/shared/utils.js'),'utf8');
// Version nibble 4 and variant 10xx are part of the format, not decoration.
const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Only the variant nibble is readable from a canonical UUID string.
const versionOf=id=>id[14];
const variantOf=id=>id[19];

function loadUtils(stubCrypto){
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://local.test/',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  const w=dom.window;
  // window.crypto is a configurable accessor, so Web Crypto can be removed entirely.
  Object.defineProperty(w,'crypto',{value:stubCrypto,configurable:true,writable:true});
  new vm.Script(source,{filename:'js/shared/utils.js'}).runInContext(dom.getInternalVMContext());
  return {newUuid:w.KinballCoach.utils.newUuid,close:()=>w.close()};
}

test('newUuid prefers crypto.randomUUID() when Web Crypto exposes it',t=>{
  let calls=0;
  const stub=()=>`00000000-0000-4000-8000-${String(++calls).padStart(12,'0')}`;
  const u=loadUtils({
    randomUUID:stub,
    getRandomValues:()=>{throw new Error('getRandomValues must not be reached while randomUUID works')}
  });
  t.after(u.close);
  const first=u.newUuid(),second=u.newUuid();
  assert.equal(first,'00000000-0000-4000-8000-000000000001');
  assert.equal(second,'00000000-0000-4000-8000-000000000002');
  assert.notEqual(first,second);
  assert.equal(calls,2);
});

test('newUuid falls back to crypto.getRandomValues() and forces version and variant',t=>{
  let n=0;
  const u=loadUtils({getRandomValues:a=>{a.fill(0);a[15]=++n}});
  t.after(u.close);
  const first=u.newUuid(),second=u.newUuid();
  // All-zero bytes: only the injected version and variant nibbles may survive.
  assert.equal(first,'00000000-0000-4000-8000-000000000001');
  assert.equal(second,'00000000-0000-4000-8000-000000000002');
  assert.notEqual(first,second);
  assert.match(first,UUID_V4);
  assert.equal(versionOf(first),'4');
  assert.ok('89ab'.includes(variantOf(first)),`variante ${variantOf(first)}`);
});

test('newUuid falls back to Math.random() when Web Crypto is absent',t=>{
  const u=loadUtils(undefined);
  t.after(u.close);
  const first=u.newUuid(),second=u.newUuid();
  assert.match(first,UUID_V4);
  assert.match(second,UUID_V4);
  assert.notEqual(first,second);
  assert.equal(versionOf(first),'4');
  assert.ok('89ab'.includes(variantOf(first)),`variante ${variantOf(first)}`);
  assert.ok('89ab'.includes(variantOf(second)),`variante ${variantOf(second)}`);
});

test('newUuid is exposed as app.newUuid on the training page',async t=>{
  const ui=await loadPage('training');
  t.after(ui.close);
  const app=ui.w.KinballCoach.app;
  assert.equal(typeof app.newUuid,'function');
  const first=app.newUuid(),second=app.newUuid();
  assert.match(first,UUID_V4);
  assert.notEqual(first,second);
});
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');

test('published shared runtime matches source modules and parses without dependencies',()=>{
  execFileSync(process.execPath,[path.join(root,'tools/build-coaching-runtime.cjs'),'--check'],{cwd:root});
  new vm.Script(fs.readFileSync(path.join(root,'js/shared/coaching.bundle.js'),'utf8'));
});

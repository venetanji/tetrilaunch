const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSaveStore, saveRoot, validateValues } = require('./steam-save.js');
const A = '76561198027391269', B = '76561198027391270';
const values = { 'tetrilaunch.meta': JSON.stringify({salvage:42,unlocks:['reactor']}), 'tetrilaunch.best':'123' };
async function setup(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'tetrilaunch-save-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let id=A;
 const store=createSaveStore({root, getAccountId:()=>id});
 return {root,store,setId:x=>id=x, file:id=>path.join(root,'saves',id,'progress.json')};
}
test('explicit OS paths do not depend on Electron product name',()=>{
 assert.equal(saveRoot('win32',{appData:'C:/Users/A/Roaming',home:'/home/a'}),path.join('C:/Users/A/Roaming','Tetrilaunch'));
 assert.equal(saveRoot('darwin',{appData:'/ignored',home:'/Users/a'}),'/Users/a/Library/Application Support/Tetrilaunch');
 assert.equal(saveRoot('linux',{appData:'/custom-xdg',home:'/home/a'}),'/home/a/.config/Tetrilaunch');
});
test('first migration persists and the downloaded file wins over stale legacy',async t=>{
 const x=await setup(t); assert.deepEqual(await x.store.open(values),values);
 await x.store.write({...values,'tetrilaunch.best':'999'});
 const second=createSaveStore({root:x.root,getAccountId:()=>A});
 assert.equal((await second.open(values))['tetrilaunch.best'],'999');
});
test('migration marker prevents legacy leaking to another account or restoring deleted save',async t=>{
 const x=await setup(t); await x.store.open(values);
 const second=createSaveStore({root:x.root,getAccountId:()=>B});
 assert.deepEqual(await second.open(values),{});
 await fs.unlink(x.file(A));
 await assert.rejects(createSaveStore({root:x.root,getAccountId:()=>A}).open(values),/missing/i);
});
test('identity unavailable or changed never writes another account',async t=>{
 const x=await setup(t); x.setId(null); await assert.rejects(x.store.open(values),/identity/i);
 x.setId(A); await x.store.open(values); x.setId(B);
 await assert.rejects(x.store.write(values),/identity/i);
 await assert.rejects(fs.stat(x.file(B)),{code:'ENOENT'});
});
test('corrupt, future and wrong-account files remain byte-identical',async t=>{
 const x=await setup(t); await fs.mkdir(path.dirname(x.file(A)),{recursive:true});
 for(const raw of ['{broken',JSON.stringify({version:2,accountId:A,values}),JSON.stringify({version:1,accountId:B,values})]){
  await fs.writeFile(x.file(A),raw);
  await assert.rejects(createSaveStore({root:x.root,getAccountId:()=>A}).open(values));
  assert.equal(await fs.readFile(x.file(A),'utf8'),raw);
 }
});
test('serialized writes and drain retain newest snapshot and local backup',async t=>{
 const x=await setup(t); await x.store.open(values);
 const writes=[1,2,3].map(n=>x.store.write({...values,'tetrilaunch.best':String(n)}));
 await x.store.drain(); await Promise.all(writes);
 assert.equal(JSON.parse(await fs.readFile(x.file(A),'utf8')).values['tetrilaunch.best'],'3');
 assert.equal(JSON.parse(await fs.readFile(x.file(A)+'.bak','utf8')).values['tetrilaunch.best'],'2');
});
test('strict payload validation rejects settings, unknown keys and malformed progression',()=>{
 assert.throws(()=>validateValues({'tetrilaunch.settings':'{}'}));
 assert.throws(()=>validateValues({'tetrilaunch.best':'NaN'}));
 assert.throws(()=>validateValues({'tetrilaunch.meta':'[]'}));
 assert.throws(()=>validateValues({'tetrilaunch.onboarding':'{"sound":false}'}));
 assert.throws(()=>validateValues({'tetrilaunch.meta':'{"salvage":-1}'}));
 assert.throws(()=>validateValues({'tetrilaunch.name':'x'.repeat(1048576)}));
});
test('JSON primitives are corrupt files, not absent saves or migration state',async t=>{
 const x=await setup(t); await fs.mkdir(path.dirname(x.file(A)),{recursive:true});
 for(const raw of ['null','false','0','""','[]']) {
  await fs.writeFile(x.file(A),raw);
  await assert.rejects(createSaveStore({root:x.root,getAccountId:()=>A}).open(values));
  assert.equal(await fs.readFile(x.file(A),'utf8'),raw);
 }
 await fs.unlink(x.file(A));
 for(const raw of ['null','false','0','""','[]']) {
  await fs.writeFile(path.join(x.root,'migration.json'),raw);
  await assert.rejects(createSaveStore({root:x.root,getAccountId:()=>A}).open(values));
  assert.equal(await fs.readFile(path.join(x.root,'migration.json'),'utf8'),raw);
 }
});
test('a second renderer in the same desktop process reloads the durable account save',async t=>{
 const x=await setup(t); await x.store.open(values);
 await x.store.write({...values,'tetrilaunch.best':'321'});
 assert.equal((await x.store.open(values))['tetrilaunch.best'],'321');
});
test('invalid migration journals preserve files rather than starting empty progress',async t=>{
 const x=await setup(t);
 for(const marker of [
  {version:1,legacyOwner:A,accounts:[],pending:{}},
  {version:1,legacyOwner:A,accounts:[],pending:{accountId:A}},
  {version:1,legacyOwner:B,accounts:[],pending:{accountId:A,values}},
  {version:1,legacyOwner:'bad',accounts:[]},
  {version:1,legacyOwner:A,accounts:['bad']},
 ]) {
  const raw=JSON.stringify(marker); await fs.writeFile(path.join(x.root,'migration.json'),raw);
  await assert.rejects(x.store.open(values));
  assert.equal(await fs.readFile(path.join(x.root,'migration.json'),'utf8'),raw);
  await assert.rejects(fs.stat(x.file(A)),{code:'ENOENT'});
 }
});
test('interrupted migration resumes its journal; another account cannot claim it',async t=>{
 const x=await setup(t);
 await fs.writeFile(path.join(x.root,'migration.json'),JSON.stringify({version:1,legacyOwner:A,accounts:[],pending:{accountId:A,values}}));
 const other=createSaveStore({root:x.root,getAccountId:()=>B});
 assert.deepEqual(await other.open({'tetrilaunch.best':'999'}),{});
 assert.deepEqual(await x.store.open({'tetrilaunch.best':'999'}),values);
 const marker=JSON.parse(await fs.readFile(path.join(x.root,'migration.json'),'utf8'));
 assert.deepEqual(marker.accounts,[B,A]); assert.equal(marker.pending,undefined);
});
test('malformed known progression flags fail closed',()=>{
 assert.throws(()=>validateValues({'tetrilaunch.meta':'{"tierRunDone":"true"}'}));
});
test('achievement delivery is gated to the opened account',async t=>{
 const x=await setup(t); assert.equal(x.store.isCurrentAccount(),false);
 await x.store.open(values);assert.equal(x.store.isCurrentAccount(),true);
 x.setId(B);assert.equal(x.store.isCurrentAccount(),false);
});

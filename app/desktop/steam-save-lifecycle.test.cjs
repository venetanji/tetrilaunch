const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture() {
 const app=new EventEmitter(), windows=[], ipc=new Map(), calls=[];
 Object.assign(app,{isPackaged:true,requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),getPath:()=>'/tmp/fixture',quit:()=>calls.push('quit')});
 let flush=()=>Promise.resolve();
 class BrowserWindow extends EventEmitter {
  static getAllWindows(){return windows;}
  constructor(options){super();this.options=options;windows.push(this);this.webContents=new EventEmitter();Object.assign(this.webContents,{
   isDestroyed:()=>false,setWindowOpenHandler:()=>{},executeJavaScript:script=>{assert.match(script,/flushDesktopSave\(true\)/);calls.push('flush');return flush();},
  });}
  isDestroyed(){return false;}
  loadURL(){}
  close(){let prevented=false;this.emit('close',{preventDefault:()=>prevented=true});if(!prevented)calls.push('closed');}
 }
 const saves={isCurrentAccount:()=>false,open:async()=>({}),write:async()=>{},drain:async()=>{calls.push('drain');}};
 vm.runInNewContext(fs.readFileSync(require.resolve('./main.js'),'utf8'),{
  __dirname:'/fixture',process:{platform:'linux'},console,URL,Response,
  require:name=>{
   if(name==='electron')return {app,BrowserWindow,protocol:{registerSchemesAsPrivileged(){},handle(){}},ipcMain:{handle:(key,fn)=>ipc.set(key,fn)},dialog:{showMessageBox:async()=>({response:0})}};
   if(name==='./package.json')return {steamBuild:true};
   if(name==='./steam-achievements.js')return {UNLOCK_CHANNEL:'steam:unlock-achievement',isTrustedSender:e=>e.trusted,createSteamAchievements:()=>({initialize(){},restartIfNecessary:()=>false,getAccountId:()=> '76561198027391269'})};
   if(name==='./steam-save.js')return {saveRoot:()=>'/fixture',createSaveStore:()=>saves};
   if(name.includes('catalog.json'))return [];
   return require(name);
  },
 });
 await tick(); return {app,win:windows[0],calls,ipc,setFlush:f=>flush=f};
}
test('window close freezes renderer then drains native queue before destruction; repeated close coalesces',async()=>{
 const x=await fixture();let done;x.setFlush(()=>new Promise(resolve=>done=resolve));
 x.win.close();x.win.close();assert.deepEqual(x.calls,['flush']);
 done();await tick();assert.deepEqual(x.calls,['flush','drain','closed']);
});
test('application quit waits for renderer acknowledgement and native drain',async()=>{
 const x=await fixture();let done;x.setFlush(()=>new Promise(resolve=>done=resolve));
 let prevented=false;x.app.emit('before-quit',{preventDefault:()=>prevented=true});
 assert.equal(prevented,true);assert.deepEqual(x.calls,['flush']);done();await tick();
 assert.equal(x.calls.at(-1),'quit'); assert.ok(x.calls.indexOf('drain')>x.calls.indexOf('flush'));
});
test('untrusted frames cannot open or write saves',async()=>{
 const x=await fixture();
 assert.throws(()=>x.ipc.get('steam:save-open')({trusted:false},{}),/Untrusted/);
 assert.throws(()=>x.ipc.get('steam:save-write')({trusted:false},{}),/Untrusted/);
});
test('failed close can be cancelled and retried without destroying the window',async()=>{
 const x=await fixture();x.setFlush(()=>Promise.reject(new Error('disk full')));
 x.win.close();await tick();assert.equal(x.calls.includes('closed'),false);
 x.setFlush(()=>Promise.resolve());x.win.close();await tick();assert.equal(x.calls.at(-1),'closed');
});

test('no achievement ledger is delivered without an opened matching account',async()=>{
 const x=await fixture();
 assert.equal(x.ipc.get('steam:unlock-achievement')({trusted:true},'FIRST_CONTRACT'),false);
});

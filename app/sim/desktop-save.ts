import assert from 'node:assert/strict';
import { createProgressStorage } from '../src/lib/desktop-save';
function memory(initial: Record<string,string> = {}) {
 const data = new Map(Object.entries(initial));
 return { getItem:(k:string)=>data.get(k)??null, setItem:(k:string,v:string)=>{data.set(k,v);} };
}
const local=memory({'tetrilaunch.meta':'{"salvage":999}', 'tetrilaunch.settings':'{"sound":false,"seenTutorial":true,"devMode":true}'});
let saved: Record<string,string> = {};
const adapter=createProgressStorage(local,{
 open:async legacy=>{assert.equal(legacy['tetrilaunch.meta'],'{"salvage":999}'); return {'tetrilaunch.meta':'{"salvage":42}'};},
 write:async values=>{saved=values;},
},()=>{});
await adapter.open();
assert.equal(adapter.getItem('tetrilaunch.meta'),'{"salvage":42}');
const settings=JSON.parse(adapter.getItem('tetrilaunch.settings')!);
assert.equal(settings.sound,false); assert.equal(settings.seenTutorial,false); assert.equal(settings.devMode,false);
adapter.setItem('tetrilaunch.meta','{"salvage":43}');
adapter.setItem('tetrilaunch.settings','{"sound":true,"seenTutorial":true,"devMode":false}');
await adapter.flush();
assert.equal(local.getItem('tetrilaunch.meta'),'{"salvage":999}');
assert.equal(saved['tetrilaunch.meta'],'{"salvage":43}');
assert.deepEqual(JSON.parse(saved['tetrilaunch.onboarding']),{seenDragHint:false,seenTutorial:true,devMode:false});
assert.equal(saved['tetrilaunch.settings'],undefined);
let failure='';
const failing=createProgressStorage(memory(),{open:async()=>({}),write:async()=>{throw new Error('disk full');}},e=>failure=e.message);
await failing.open(); failing.setItem('tetrilaunch.best','1');
await assert.rejects(failing.flush(),/disk full/); assert.equal(failure,'disk full');
const unavailable=createProgressStorage(memory(),{open:async()=>{throw new Error('Steam unavailable');},write:async()=>{}},()=>{});
await assert.rejects(unavailable.open(),/Steam unavailable/);
assert.throws(()=>unavailable.getItem('tetrilaunch.meta'),/not ready/);
console.log('Desktop save: restore before reads, device preference exclusion, account cache isolation, error reporting passed.');
const damaged=createProgressStorage(memory({'tetrilaunch.settings':'null'}),{open:async()=>({'tetrilaunch.best':'900'}),write:async()=>{}},()=>{});
await damaged.open(); assert.equal(damaged.getItem('tetrilaunch.best'),'900');
assert.equal(JSON.parse(damaged.getItem('tetrilaunch.settings')!).seenTutorial,false);
let attempts=0;
const retrying=createProgressStorage(memory(),{open:async()=>({}),write:async()=>{if(++attempts===1)throw new Error('temporary');}},()=>{});
await retrying.open(); retrying.setItem('tetrilaunch.best','2'); await retrying.flush();
assert.equal(attempts,2);
let writtenOnQuota=false;
const full=createProgressStorage({getItem:()=>null,setItem:()=>{throw new Error('quota');}}, {open:async()=>({}),write:async()=>{writtenOnQuota=true;}},()=>{});
await full.open(); full.setItem('tetrilaunch.settings','{"seenTutorial":true}'); await full.flush(); assert.equal(writtenOnQuota,true);

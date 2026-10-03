// Comparative live-loop profile: blocks every API request; no score writes.
// Run against two source roots on the same machine. rAF timing here includes
// normal pacing; use sim:renderperf separately for forced raster cost.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
const root=process.env.PROFILE_ROOT||fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const output=process.argv[process.argv.indexOf('--json')+1];
const server=await createServer({root,configFile:root+'/vite.config.ts',server:{host:'127.0.0.1'},logLevel:'error'});await server.listen();
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});const page=await browser.newPage({viewport:{width:844,height:390},deviceScaleFactor:3});
await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"profile_isolated"}'}));
await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.__tl);await page.addScriptTag({url:'/sim/hudperf/probe.ts',type:'module'});await page.waitForFunction(()=>window.__hudperf);
const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
const results=[];
try{
for(const scenario of ['idle','fire','aim-held','space-held','geometry-off','geometry-off-fire']){
 await page.evaluate(async()=>{
  // newRun is seeded synchronously during start(); restore the clock before
  // waiting for warmup frames so gameplay timers keep their real semantics.
  const clock=Date.now;let ready;
  try {Date.now=()=>1730000000000;ready=window.__hudperf.start();}
  finally {Date.now=clock;}
  await ready;
  const a=window.__tl;if(a.run?.seed!==(1730000000000>>>0))throw new Error("Profile seed was not applied");window.__origGeometry??=a.sampleHudGeometry;a.sampleHudGeometry=window.__origGeometry;
 });
 if(scenario.startsWith('geometry-off'))await page.evaluate(()=>window.__tl.sampleHudGeometry=()=>{});
 const before=await cdp.send('Performance.getMetrics');
 const promise=page.evaluate(async({scenario})=>{
 const a=window.__tl,g=a.game;const oldGeom=a.sampleHudGeometry,oldUpdate=g.update,oldTrajectory=g.updateTrajectory;
 const data={frames:[],geometry:[],physics:[],trajectory:[],samples:0,rects:0,shots:0};
 const rect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){data.rects++;return rect.call(this);};
 a.sampleHudGeometry=function(){const old=this.hudSampleAt,t=performance.now();const r=oldGeom.call(this);if(this.hudSampleAt!==old){data.geometry.push(performance.now()-t);data.samples++;}return r;};
 g.update=function(...args){const t=performance.now();const r=oldUpdate.apply(this,args);data.physics.push(performance.now()-t);return r;};
 g.updateTrajectory=function(...args){const t=performance.now();const r=oldTrajectory.apply(this,args);data.trajectory.push(performance.now()-t);return r;};
 let prev;for(let i=0;i<420;i++){const now=await new Promise(requestAnimationFrame);if(prev)data.frames.push(now-prev);prev=now;if(scenario==='fire'||scenario==='geometry-off-fire')g.shoot(now);}
 data.shots=g.shotsFired;data.cubes=g.cubes.length;data.dom=document.querySelectorAll('.plant *').length;data.state=a.state;
 Element.prototype.getBoundingClientRect=rect;a.sampleHudGeometry=oldGeom;g.update=oldUpdate;g.updateTrajectory=oldTrajectory;
 for(const key of ['frames','geometry','physics','trajectory']){const values=data[key].sort((a,b)=>a-b);data[key]={n:values.length,p50:values[Math.floor(values.length*.5)]??0,p95:values[Math.floor(values.length*.95)]??0,total:values.reduce((a,b)=>a+b,0)};}
 return data;
 },{scenario});
 if(scenario==='aim-held')await page.keyboard.down('ArrowUp');if(scenario==='space-held')await page.keyboard.down('Space');
 const result=await promise;await page.keyboard.up('ArrowUp');await page.keyboard.up('Space');
 const after=await cdp.send('Performance.getMetrics');const m=Object.fromEntries(before.metrics.map(m=>[m.name,m.value]));const delta=Object.fromEntries(after.metrics.filter(m=>/Duration|Count/.test(m.name)).map(x=>[x.name,x.value-(m[x.name]??0)]));
 results.push({scenario,seed:1730000000000>>>0,result,delta});console.log(JSON.stringify(results.at(-1)));
}
if(process.argv.includes('--json')) await writeFile(output,JSON.stringify(results,null,2));
}finally{await browser.close();await server.close();}

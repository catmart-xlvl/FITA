import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {randomUUID} from 'node:crypto';
import yazl from 'yazl';
import {emptyProject} from '../server/storage.js';
import {createApp} from '../server/app.js';

const MB=1024**2,LATER=7*3600*1000;
async function instance(t,{picks=[]}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fita-cleanup-')),dataDir=path.join(root,'data');
  const pickPath=async()=>picks.shift()?.()??{cancelled:true},measureSpace=async()=>100*1024**3;
  // Files written by the test are "old" for the cleanup (it skips the last 6 h).
  const {app,store}=await createApp({dataDir,projectArchiveOptions:{pickPath,tempDir:root,measureSpace},projectCleanupOptions:{clock:()=>Date.now()+LATER}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,token=(await (await fetch(base+'/api/session')).json()).token;
  const call=async(route,{method='POST',body}={})=>{const res=await fetch(base+route,{method,headers:{'x-workbench-token':token,...(body?{'Content-Type':'application/json'}:{})},body:body&&JSON.stringify(body)});return {status:res.status,data:await res.json().catch(()=>null)};};
  const finish=async(route,job)=>{for(let i=0;i<600;i++){const {data}=await call(route+job.id,{method:'GET'});if(data.job.status!=='running')return data.job;await new Promise(r=>setTimeout(r,10));}throw Error('job did not finish');};
  return {root,dataDir,store,call,finish:job=>finish('/api/cleanup/jobs/',job),finishArchive:job=>finish('/api/project-archives/',job),picks};
}
const write=async(file,bytes)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);return file;};
const ino=async file=>(await fs.stat(file,{bigint:true})).ino;
const exists=file=>fs.stat(file).then(()=>true,()=>false);
// Blender-style zstd: several frames plus a seek table in a skippable frame.
function seekableZstd(parts){
  const frames=parts.map(part=>zlib.zstdCompressSync(Buffer.from(part,'latin1')));
  const table=Buffer.alloc(8+frames.length*8+9);
  table.writeUInt32LE(0x184d2a5e,0);table.writeUInt32LE(frames.length*8+9,4);
  frames.forEach((frame,i)=>{table.writeUInt32LE(frame.length,8+i*8);table.writeUInt32LE(Buffer.byteLength(parts[i],'latin1'),12+i*8);});
  const footer=8+frames.length*8;table.writeUInt32LE(frames.length,footer);table[footer+4]=0;table.writeUInt32LE(0x8f92eab1,footer+5);
  return Buffer.concat([...frames,table]);
}
const zipOf=files=>new Promise(resolve=>{const zip=new yazl.ZipFile(),chunks=[];for(const [name,text] of Object.entries(files))zip.addBuffer(Buffer.from(text),name);zip.end();zip.outputStream.on('data',c=>chunks.push(c)).on('end',()=>resolve(Buffer.concat(chunks)));});

async function seed(env,{busy=false}={}){
  const p=emptyProject('Limpieza');await env.store.save(p);
  const big=Buffer.alloc(2*MB,3),asset=await env.store.asset(p,big,'glb','fixture');
  const ws=path.join(env.root,'projects',p.id),data=path.join(env.dataDir,p.id);
  const jobId=randomUUID(),runId=randomUUID(),oldRun=randomUUID(),loose=randomUUID(),viewsWs=randomUUID(),grant=randomUUID(),finish=randomUUID(),recentWs=randomUUID();
  const f={
    asset:path.join(data,asset.id),
    frozenCopy:await write(path.join(data,'placement-jobs',jobId,'head.glb'),big),
    inputCopy:await write(path.join(ws,'rigging',runId,'input','original.glb'),big),
    blend1:await write(path.join(ws,'rigging',runId,'output','rigged.blend1'),Buffer.alloc(1000,1)),
    discarded:await write(path.join(ws,'rigging',oldRun,'output','rigged.glb'),Buffer.alloc(5000,2)),
    unused:await write(path.join(ws,'codex','segmentation',loose,'work.bin'),Buffer.alloc(4000,4)),
    viaPackage:await write(path.join(ws,'codex','views',viewsWs,'front.png'),Buffer.alloc(300,5)),
    viaScene:await write(path.join(ws,'codex','model-finish',finish,'output','mouth.png'),Buffer.alloc(300,6)),
    recent:await write(path.join(ws,'codex','segmentation',recentWs,'new.bin'),Buffer.alloc(300,7)),
    history:await write(path.join(data,'workflow-history',randomUUID()+'.json'),JSON.stringify({previous:{riggingRuns:[{id:oldRun}]}})),
    fixed:await write(path.join(ws,'codex','notes.txt'),'workspace file without an id'),
  };
  // The views workspace is only named inside the Codex delivery package.
  await write(path.join(env.dataDir,'.codex-deliveries',grant+'.zip'),await zipOf({'UBICACIONES.json':JSON.stringify({workspace:path.dirname(f.viaPackage)})}));
  // The model-finish texture is only named inside a compressed .blend; the id is split between two frames.
  const texture=path.dirname(path.dirname(f.viaScene)),cut=texture.length-10;
  const scene=await env.store.asset(p,seekableZstd(['BLENDER-v405 image '+texture.slice(0,cut),texture.slice(cut)+'\\output\\mouth.png end']),'blend','fixture');
  const recentTime=new Date(Date.now()+LATER);await fs.utimes(f.recent,recentTime,recentTime);
  Object.assign(p,{reference:{id:asset.id},models:[{id:scene.id}],placements:[{id:jobId,status:busy?'running':'succeeded'}],riggingRuns:[{id:runId,status:'succeeded'}],codexDelivery:{id:grant,status:'waiting'}});
  await env.store.save(p);
  return {p,f,scene};
}

test('cleanup moves only what nothing uses, shares frozen copies, and can be restored or emptied',async t=>{
  const env=await instance(t),{p,f}=await seed(env);
  const analysis=await env.finish((await env.call('/api/cleanup/analyze',{body:{}})).data.job);
  assert.equal(analysis.status,'succeeded',analysis.error);
  const summary=analysis.projects.find(x=>x.projectId===p.id);
  assert.equal(summary.busy,false);assert.equal(summary.unreadable,0);assert.equal(summary.recent,1);
  assert.deepEqual({blend1:summary.bytes.blend1,discarded:summary.bytes.discarded,unused:summary.bytes.unused,links:summary.bytes.links},{blend1:1000,discarded:5000,unused:4000,links:2*MB});
  assert(await exists(f.blend1),'analysis moves nothing');
  assert.equal((await env.call('/api/cleanup/run',{body:{}})).status,400,'the user must confirm');
  const done=await env.finish((await env.call('/api/cleanup/run',{body:{confirm:true}})).data.job);
  assert.equal(done.status,'succeeded',done.error);
  const result=done.results.find(x=>x.projectId===p.id);
  assert.equal(result.trashedFiles,3);assert.equal(result.linkedBytes,2*MB);
  for(const kept of ['asset','frozenCopy','inputCopy','viaPackage','viaScene','recent','history','fixed'])assert(await exists(f[kept]),kept+' stays');
  for(const gone of ['blend1','discarded','unused'])assert.equal(await exists(f[gone]),false,gone+' goes to the trash');
  assert.equal(await ino(f.frozenCopy),await ino(f.asset),'frozen copy now shares the asset');
  assert.notEqual(await ino(f.inputCopy),await ino(f.asset),'a rewritable copy keeps its own file');
  const {data:trash}=await env.call('/api/cleanup/trash',{method:'GET'});
  assert.equal(trash.batches.length,1);assert.equal(trash.batches[0].bytes,10000);
  const restored=await env.call(`/api/cleanup/trash/${trash.batches[0].id}/restore`);
  assert.equal(restored.data.restored,3);
  for(const back of ['blend1','discarded','unused'])assert(await exists(f[back]),back+' is back');
  assert.equal((await env.call('/api/cleanup/trash',{method:'GET'})).data.batches.length,0);
  const again=await env.finish((await env.call('/api/cleanup/run',{body:{confirm:true}})).data.job);
  assert.equal(again.results.find(x=>x.projectId===p.id).trashedFiles,3);
  const batch=(await env.call('/api/cleanup/trash',{method:'GET'})).data.batches[0];
  assert.equal((await env.call('/api/cleanup/trash/'+batch.id,{method:'DELETE'})).status,200);
  assert.equal(await exists(path.join(env.dataDir,'.cleanup-trash',batch.id)),false,'emptying deletes the batch');
  assert.equal(env.store.get(p.id).name,'Limpieza');
});

test('a project with work in progress is skipped entirely',async t=>{
  const env=await instance(t),{p,f}=await seed(env,{busy:true});
  const done=await env.finish((await env.call('/api/cleanup/run',{body:{confirm:true}})).data.job);
  assert.equal(done.results.find(x=>x.projectId===p.id).busy,true);
  assert(await exists(f.blend1));assert(await exists(f.unused));
  assert.notEqual(await ino(f.frozenCopy),await ino(f.asset));
});

test('.fita stores identical files once, leaves out .blend1, and opens them as links or copies',async t=>{
  const a=await instance(t),{p,f}=await seed(a),dest=path.join(a.root,'Limpieza.fita');
  a.picks.push(()=>({path:dest}));
  const exported=await a.finishArchive((await a.call(`/api/projects/${p.id}/archive`)).data.job);
  assert.equal(exported.status,'succeeded',exported.error);
  assert(exported.totalBytes<3*MB,'the 2 MB content is counted once: '+exported.totalBytes);
  const b=await instance(t);b.picks.push(()=>({path:dest}));
  const opened=await b.finishArchive((await b.call('/api/projects/import')).data.job);
  assert.equal(opened.status,'succeeded',opened.error);
  const at=file=>file.replace(a.root,b.root);
  assert.equal((await fs.readFile(at(f.inputCopy))).length,2*MB);
  assert.equal(await ino(at(f.frozenCopy)),await ino(at(f.asset)),'frozen copies come back shared');
  assert.notEqual(await ino(at(f.inputCopy)),await ino(at(f.asset)),'rewritable copies come back separate');
  assert.equal(await exists(at(f.blend1)),false,'.blend1 is not exported');
  assert(await exists(at(f.viaScene)));
});

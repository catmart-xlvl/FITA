import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import {emptyProject,Store} from '../server/storage.js';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createApp} from '../server/app.js';
import {safeFileName,exportProject,importProject,projectArchiveLimits} from '../server/project-archive.js';

async function instance(t,picks=[],options={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fita-archive-')),dataDir=path.join(root,'data');
  const pickPath=async({mode})=>picks.shift()?.(mode)??{cancelled:true};
  const {app,store}=await createApp({dataDir,projectArchiveOptions:{pickPath,tempDir:root,...options}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,token=(await (await fetch(base+'/api/session')).json()).token;
  const call=async(route,{method='POST',body,headers={}}={})=>{const res=await fetch(base+route,{method,headers:{'x-workbench-token':token,...(body&&!(body instanceof Uint8Array)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof Uint8Array?body:body&&JSON.stringify(body)});return {status:res.status,data:await res.json().catch(()=>null)};};
  const finish=async job=>{for(let i=0;i<400;i++){const {data}=await call('/api/project-archives/'+job.id,{method:'GET'});if(data.job.status!=='running')return data.job;await new Promise(r=>setTimeout(r,10));}throw Error('job did not finish');};
  return {root,dataDir,store,call,finish,picks,port:server.address().port};
}
async function seed(env){
  const p=emptyProject('Example de prueba');await env.store.save(p);
  const asset=await env.store.asset(p,Buffer.from('glb bytes'),'glb','fixture');
  const workspace=path.join(env.root,'projects',p.id,'codex','views');
  await fs.mkdir(workspace,{recursive:true});
  await fs.writeFile(path.join(workspace,'descriptor.json'),JSON.stringify({projectId:p.id,workspace}));
  await fs.writeFile(path.join(workspace,'big.bin'),Buffer.alloc(300000,7));
  p.textureOperations=[{id:'op',type:'monitor',status:'running'}];p.reference={id:asset.id,url:'/files/'+p.id+'/'+asset.id};await env.store.save(p);
  return {p,asset,workspace};
}

test('a project saved as .fita opens on another FITA with its assets, workspaces and paths rewritten',async t=>{
 const a=await instance(t),{p,asset}=await seed(a),dest=path.join(a.root,'out','Example.fita');
 await fs.mkdir(path.dirname(dest));a.picks.push(()=>({path:dest.replace(/\.fita$/,'')}));
 const started=await a.call(`/api/projects/${p.id}/archive`);assert.equal(started.status,202);
 const exported=await a.finish(started.data.job);assert.equal(exported.status,'succeeded',exported.error);
 assert.equal(exported.path,dest,'the .fita extension is added');assert(exported.totalBytes>300000);
 const b=await instance(t);b.picks.push(()=>({path:dest}));
 const imported=await b.finish((await b.call('/api/projects/import')).data.job);
 assert.equal(imported.status,'succeeded',imported.error);assert.equal(imported.projectId,p.id);assert.equal(imported.copied,false);
 const copy=b.store.get(p.id);assert.equal(copy.name,'Example de prueba');
 assert.equal(await fs.readFile(path.join(b.dataDir,p.id,asset.id),'utf8'),'glb bytes');
 const descriptor=JSON.parse(await fs.readFile(path.join(b.root,'projects',p.id,'codex','views','descriptor.json'),'utf8'));
 assert.equal(descriptor.workspace,path.join(b.root,'projects',p.id,'codex','views'),'absolute paths follow the new machine');
 assert.equal((await fs.stat(path.join(b.root,'projects',p.id,'codex','views','big.bin'))).size,300000);
 assert.equal(copy.textureOperations[0].status,'failed','work running at export time cannot stay busy');
 assert.equal((await b.call('/api/projects',{method:'GET'})).data.some(x=>x.id===p.id),true);
});

test('opening a .fita of an existing project makes a copy and never overwrites the original',async t=>{
 const a=await instance(t),{p,asset}=await seed(a),dest=path.join(a.root,'Example.fita');
 a.picks.push(()=>({path:dest}));await a.finish((await a.call(`/api/projects/${p.id}/archive`)).data.job);
 a.picks.push(()=>({path:dest}));
 const imported=await a.finish((await a.call('/api/projects/import')).data.job);
 assert.equal(imported.status,'succeeded',imported.error);assert.equal(imported.copied,true);assert.notEqual(imported.projectId,p.id);
 const copy=a.store.get(imported.projectId);assert.equal(copy.name,'Example de prueba (copia)');
 assert.equal(copy.reference.url,'/files/'+imported.projectId+'/'+asset.id,'references follow the new id');
 const descriptor=JSON.parse(await fs.readFile(path.join(a.root,'projects',imported.projectId,'codex','views','descriptor.json'),'utf8'));
 assert.equal(descriptor.projectId,imported.projectId);
 assert.equal(a.store.get(p.id).name,'Example de prueba');assert.equal(await fs.readFile(path.join(a.dataDir,p.id,asset.id),'utf8'),'glb bytes');
});

test('hostile or foreign archives are refused without writing outside FITA',async t=>{
 const a=await instance(t),make=async(name,entries)=>{const zip=new yazl.ZipFile(),file=path.join(a.root,name);const done=new Promise(r=>zip.outputStream.pipe(createWriteStream(file)).on('close',r));for(const [n,v] of entries)zip.addBuffer(Buffer.from(v),n.replace('../../','xx/xx/').replace('C:/','Cx/'));zip.end();await done;
  // yazl refuses hostile names, so write a placeholder of the same length and patch the bytes.
  let bytes=await fs.readFile(file);for(const [from,to] of [['xx/xx/','../../'],['Cx/','C:/']])bytes=Buffer.from(bytes.toString('latin1').split(from).join(to),'latin1');await fs.writeFile(file,bytes);return file;};
 const id='11111111-2222-4333-8444-555555555555',manifest=JSON.stringify({format:'fita-project',version:1,projectId:id,sourceRoot:'C:/x'}),record=JSON.stringify({...emptyProject('Evil'),id});
 const cases=[['traversal.fita',[['fita-project.json',manifest],['project.json',record],['data/../../evil.txt','x']]],['absolute.fita',[['fita-project.json',manifest],['project.json',record],['workspace/C:/evil.txt','x']]],['other.fita',[['readme.txt','not a project']]],['newer.fita',[['fita-project.json',JSON.stringify({format:'fita-project',version:99,projectId:id})],['project.json',record]]]];
 for(const [name,entries] of cases){
  const file=await make(name,entries);a.picks.push(()=>({path:file}));
  const job=await a.finish((await a.call('/api/projects/import')).data.job);
  assert.equal(job.status,'failed',name);assert.match(job.error,/FITA_ARCHIVE_(INVALID|NEWER_VERSION)/,name);
 }
 await assert.rejects(fs.stat(path.join(a.root,'evil.txt')));await assert.rejects(fs.stat(path.join(os.tmpdir(),'evil.txt')));
 assert.equal((await fs.readdir(a.dataDir)).filter(n=>n.startsWith('.import-')).length,0,'staging is cleaned');
});

test('cancelling the dialog does nothing; without a native dialog the browser fallback is offered',async t=>{
 const a=await instance(t),{p}=await seed(a);
 a.picks.push(()=>({cancelled:true}));assert.deepEqual((await a.call(`/api/projects/${p.id}/archive`)).data,{cancelled:true});
 a.picks.push(()=>({unavailable:true}));assert.deepEqual((await a.call('/api/projects/import')).data,{fallback:'upload'});
 assert.equal(safeFileName('Example: "Prueba" / 0.2.12?'),'Example Prueba 0.2.12.fita');
});


test('browser fallback: download the .fita, then open it by uploading the file',async t=>{
 const a=await instance(t),{p}=await seed(a);
 const res=await fetch(`http://127.0.0.1:${a.port}/api/projects/${p.id}/archive.fita`);
 assert.equal(res.status,200);assert.match(res.headers.get('content-disposition')||'',/Example de prueba\.fita/);
 const bytes=new Uint8Array(await res.arrayBuffer());assert.equal(Buffer.from(bytes.slice(0,2)).toString(),'PK');
 const b=await instance(t);
 const started=await b.call('/api/projects/import-upload',{body:bytes,headers:{'Content-Type':'application/octet-stream','x-file-name':'Example de prueba.fita'}});
 assert.equal(started.status,202);
 const job=await b.finish(started.data.job);assert.equal(job.status,'succeeded',job.error);assert.equal(b.store.get(p.id).name,'Example de prueba');
});

test('a full disk is detected before writing: save and open fail early with the space needed',async t=>{
 const full=async()=>1024**2;
 const a=await instance(t,[],{measureSpace:full}),{p}=await seed(a),dest=path.join(a.root,'Example.fita');
 a.picks.push(()=>({path:dest}));
 const saved=await a.finish((await a.call(`/api/projects/${p.id}/archive`)).data.job);
 assert.equal(saved.status,'failed');assert.equal(saved.error,'FITA_NOT_ENOUGH_SPACE');
 assert(saved.details.neededBytes>saved.details.freeBytes);
 await assert.rejects(fs.stat(dest+'.partial'),'nothing half-written is left');
 const b=await instance(t),other=await seed(b);b.picks.push(()=>({path:dest}));
 assert.equal((await b.finish((await b.call(`/api/projects/${other.p.id}/archive`)).data.job)).status,'succeeded');
 const c=await instance(t,[],{measureSpace:full});c.picks.push(()=>({path:dest}));
 const opened=await c.finish((await c.call('/api/projects/import')).data.job);
 assert.equal(opened.status,'failed');assert.equal(opened.error,'FITA_NOT_ENOUGH_SPACE');
 assert.deepEqual((await fs.readdir(c.dataDir)).filter(n=>n.startsWith('.import-')),[],'no staging folder is left');
});

async function archiveStore(t,label){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fita-record-'+label+'-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new Store(path.join(root,'data'));await store.init();return {root,store};
}
async function sizedArchive(file,p,size){
 const zip=new yazl.ZipFile();
 const manifest=JSON.stringify({format:'fita-project',version:2,projectId:p.id});
 zip.addBuffer(Buffer.from(manifest),'fita-project.json');
 const prefix=Buffer.from(JSON.stringify(p).slice(0,-1)+',"padding":"'),suffix=Buffer.from('"}');
 async function* record(){yield prefix;let left=size-prefix.length-suffix.length;const block=Buffer.alloc(64*1024,120);while(left){const n=Math.min(left,block.length);yield block.subarray(0,n);left-=n;}yield suffix;}
 zip.addReadStreamLazy('project.json',{size},callback=>callback(null,Readable.from(record())));zip.end();await pipeline(zip.outputStream,createWriteStream(file));
}
test('export and import preserve a valid project record larger than the former 16 MiB limit',async t=>{
 const a=await archiveStore(t,'large-source'),b=await archiveStore(t,'large-target'),p=emptyProject('Large project state');p.notes='x'.repeat(17*1024**2);await a.store.save(p);
 const file=path.join(a.root,'large.fita');await exportProject({store:a.store,id:p.id,dest:file});
 const existing=emptyProject('Keep this project');await b.store.save(existing);
 const result=await importProject({store:b.store,file});assert.equal(result.id,p.id);assert.equal(b.store.get(p.id).notes,p.notes);assert.equal(b.store.get(existing.id).name,'Keep this project');
 assert(projectArchiveLimits.recordBytes>16*1024**2);assert(projectArchiveLimits.manifestBytes===16*1024**2);
});
test('a legacy pretty-printed record over 16 MiB imports without removing the small index budget',async t=>{
 const a=await archiveStore(t,'legacy'),p=emptyProject('Legacy record'),file=path.join(a.root,'legacy.fita');p.notes='x'.repeat(16*1024**2);
 const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(JSON.stringify({format:'fita-project',version:1,projectId:p.id})),'fita-project.json');zip.addBuffer(Buffer.from(JSON.stringify(p,null,2)),'project.json');zip.end();await pipeline(zip.outputStream,createWriteStream(file));
 assert.equal((await importProject({store:a.store,file})).id,p.id);assert.equal(a.store.get(p.id).notes.length,p.notes.length);
});
test('over-budget project records fail on both export and import without replacing existing data',async t=>{
 const a=await archiveStore(t,'too-large'),p=emptyProject('Over budget');p.notes='x'.repeat(projectArchiveLimits.recordBytes);await a.store.save(p);
 const dest=path.join(a.root,'existing.fita');await fs.writeFile(dest,'keep previous archive');
 await assert.rejects(exportProject({store:a.store,id:p.id,dest}),e=>e.message==='FITA_ARCHIVE_PROJECT_TOO_LARGE'&&e.details.limitBytes===projectArchiveLimits.recordBytes);
 assert.equal(await fs.readFile(dest,'utf8'),'keep previous archive');await assert.rejects(fs.access(dest+'.partial'),{code:'ENOENT'});
 const fixture=path.join(a.root,'oversize-import.fita'),small=emptyProject('Still keep this');await sizedArchive(fixture,small,projectArchiveLimits.recordBytes+1);
 await assert.rejects(importProject({store:a.store,file:fixture}),e=>e.message==='FITA_ARCHIVE_PROJECT_TOO_LARGE');assert.equal(a.store.projects.size,1);assert.equal(a.store.get(p.id).notes.length,projectArchiveLimits.recordBytes);
 assert.equal((await fs.readdir(a.store.root)).filter(name=>name.startsWith('.import-')).length,0);
});
test('a large index is rejected at its own smaller limit before project extraction',async t=>{
 const a=await archiveStore(t,'index'),p=emptyProject('Index cap'),file=path.join(a.root,'index.fita'),zip=new yazl.ZipFile(),size=projectArchiveLimits.manifestBytes+1;
 async function* index(){let left=size;const block=Buffer.alloc(64*1024,32);while(left){const n=Math.min(left,block.length);yield block.subarray(0,n);left-=n;}}
 zip.addReadStreamLazy('fita-project.json',{size},callback=>callback(null,Readable.from(index())));zip.addBuffer(Buffer.from(JSON.stringify(p)),'project.json');zip.end();await pipeline(zip.outputStream,createWriteStream(file));
 await assert.rejects(importProject({store:a.store,file}),e=>e.message==='FITA_ARCHIVE_MANIFEST_TOO_LARGE');assert.equal(a.store.projects.size,0);
});

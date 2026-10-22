// Free disk space without touching anything a project still uses (lobby →
// "Free up space"). Nothing is deleted here: files go to a cleanup trash
// (data/.cleanup-trash/<batch>/) that the user can restore or empty.
//  Level 1: Blender .blend1 backups go to the trash; identical copies in places
//           FITA never rewrites become hard links to one file.
//  Level 2: files that only the rewind history (workflow-history) or nothing at
//           all still names go to the trash: stages discarded by going back,
//           old Codex attempts and the regenerable placement-editable cache.
// "Still names" is followed transitively: the record, then every kept text,
// zip or Codex delivery package it reaches, so a workspace located only from
// inside a package stays. .blend/.fbx files are read too (zstd or gzip
// included): they may load textures from another folder by path.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import zlib from 'node:zlib';
import yauzl from 'yauzl';

export const CLEANUP_TRASH='.cleanup-trash';
const MB=1024**2,RECENT_MS=6*3600*1000;
const ID=/^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{16,})$/i;
const IDS=/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{16,}/gi;
const TEXT=/\.(?:json|txt|md|ya?ml|csv|py|gltf|obj|mtl)$/i,SCENE=/\.(?:blend|fbx)$/i;
const UUIDS=/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi;
const stem=name=>name.replace(/\.[^.]+$/,'');

// Places FITA writes once and never rewrites in place: assets, placement jobs
// and versioned rig/facial results. Only these may share one file as hard links
// (an in-place write to one link would change every copy).
export function frozenPath(area,parts){
  if(area==='data')return parts.length===1||parts[0]==='placement-jobs';
  return parts.length>=5&&['reports','results'].includes(parts[2])&&ID.test(parts[3]);
}

const hashes=new Map();
export async function contentHash(abs,size,mtimeMs){
  const key=abs+'|'+size+'|'+mtimeMs;
  if(!hashes.has(key)){const h=createHash('sha256');for await(const chunk of fs.createReadStream(abs,{highWaterMark:8*MB}))h.update(chunk);hashes.set(key,h.digest('hex'));}
  return hashes.get(key);
}

async function walk(base,area){
  const out=[];
  const visit=async(dir,parts)=>{
    let entries;try{entries=await fsp.readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries){
      const abs=path.join(dir,entry.name),next=[...parts,entry.name];
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory())await visit(abs,next);
      else if(entry.isFile()){const s=await fsp.stat(abs,{bigint:true});out.push({abs,area,parts:next,rel:area+'/'+next.join('/'),size:Number(s.size),mtimeMs:Number(s.mtimeMs),ino:s.ino});}
    }
  };
  await visit(base,[]);
  return out;
}
const idsIn=text=>new Set((String(text).match(IDS)||[]).map(x=>x.toLowerCase()));
function zipText(file){
  return new Promise(resolve=>yauzl.open(file,{lazyEntries:true,autoClose:false},(error,zip)=>{
    if(error)return resolve('');
    const parts=[];const done=()=>{zip.close();resolve(parts.join('\n'));};
    zip.on('error',done);zip.on('end',done);
    zip.on('entry',entry=>{
      parts.push(entry.fileName);
      if(!TEXT.test(entry.fileName)||entry.uncompressedSize>MB)return zip.readEntry();
      zip.openReadStream(entry,(err,stream)=>{if(err)return zip.readEntry();const chunks=[];stream.on('data',c=>chunks.push(c));stream.on('error',()=>zip.readEntry());stream.on('end',()=>{parts.push(Buffer.concat(chunks).toString('utf8'));zip.readEntry();});});
    });
    zip.readEntry();
  }));
}
// Blender writes zstd as many frames plus a seek table at the end (skippable
// frame, footer magic 0x8F92EAB1): decompress it frame by frame.
async function* zstdFrames(handle,size){
  const footer=Buffer.alloc(9);await handle.read(footer,0,9,size-9);
  if(footer.readUInt32LE(5)!==0x8f92eab1)throw Error('FITA_CLEANUP_UNREADABLE');
  const count=footer.readUInt32LE(0),entry=footer[4]&0x80?12:8,table=Buffer.alloc(count*entry);
  await handle.read(table,0,table.length,size-9-table.length);
  for(let i=0,offset=0;i<count;i++){
    const length=table.readUInt32LE(i*entry),frame=Buffer.alloc(length);
    await handle.read(frame,0,length,offset);offset+=length;
    yield zlib.zstdDecompressSync(frame);
  }
}
async function* gzipChunks(abs){
  const source=fs.createReadStream(abs,{highWaterMark:8*MB}),unpack=zlib.createGunzip();
  source.on('error',error=>unpack.destroy(error));
  yield* source.pipe(unpack);
}
// Ids in a binary scene file, decompressed when needed. A tail is kept so an
// id split between chunks is still found. Unreadable => throws.
const sceneIds=new Map();
async function sceneText(abs){
  const s=await fsp.stat(abs),key=abs+'|'+s.size+'|'+s.mtimeMs;
  if(!sceneIds.has(key)){
    const handle=await fsp.open(abs),found=new Set();let tail='';
    try{
      const head=Buffer.alloc(4);await handle.read(head,0,4,0);
      const chunks=head.readUInt32LE(0)===0xfd2fb528?zstdFrames(handle,s.size):head[0]===0x1f&&head[1]===0x8b?gzipChunks(abs):fs.createReadStream(abs,{highWaterMark:8*MB});
      for await(const chunk of chunks){const text=tail+chunk.toString('latin1');for(const id of text.match(UUIDS)||[])found.add(id.toLowerCase());tail=text.slice(-64);}
    }finally{await handle.close();}
    sceneIds.set(key,[...found].join(' '));
  }
  return sceneIds.get(key);
}
const textOf=async abs=>SCENE.test(abs)?sceneText(abs):TEXT.test(abs)?(await fsp.stat(abs)).size<=8*MB?fsp.readFile(abs,'utf8'):'':/\.zip$/i.test(abs)?zipText(abs):'';

// Codex delivery packages live outside the project folders (data/.<kind>-deliveries).
async function deliveries(store,projectId){
  const out=[];
  for(const dir of await fsp.readdir(store.root).catch(()=>[])){
    if(!/^\..+-(deliveries|supervisors)$/.test(dir))continue;
    for(const name of await fsp.readdir(path.join(store.root,dir)).catch(()=>[])){
      if(!/\.(json|zip)$/.test(name)||!ID.test(stem(name)))continue;
      out.push({id:stem(name).toLowerCase(),abs:path.join(store.root,dir,name),projectId});
    }
  }
  return out;
}

const projectDirs=(store,id)=>({data:path.join(store.root,id),workspace:path.join(path.dirname(store.root),'projects',id)});
const keys=f=>[...f.parts.slice(0,-1).filter(p=>ID.test(p)),...(ID.test(stem(f.parts.at(-1)))?[stem(f.parts.at(-1))]:[])].map(x=>x.toLowerCase());

// What can go and what can be shared, for one project. Read-only.
export async function planCleanup(store,p,{now=Date.now(),busy=false}={}){
  const dirs=projectDirs(store,p.id);
  const files=[...await walk(dirs.data,'data'),...await walk(dirs.workspace,'workspace')];
  const total=new Map();for(const f of files)total.set(f.ino,f.size);
  const totalBytes=[...total.values()].reduce((a,b)=>a+b,0);
  if(busy)return {projectId:p.id,name:p.name,busy:true,totalBytes,afterBytes:totalBytes,trash:[],links:[],bytes:{},recent:0};
  // Transitive references: start from the record, add what every kept file names.
  // The rewind history is always kept but never counts as a use.
  const isHistory=f=>f.area==='data'&&f.parts[0]==='workflow-history',isBlend1=f=>/\.blend1$/i.test(f.abs),isRecent=f=>f.mtimeMs>now-RECENT_MS;
  const live=idsIn(JSON.stringify(p)),packages=await deliveries(store,p.id),read=new Set();
  // Recent files may be work in progress that the record does not name yet.
  const candidates=new Set(files.filter(f=>!isHistory(f)&&keys(f).length&&!(isRecent(f)&&!isBlend1(f))));
  const kept=new Set(files.filter(f=>!isHistory(f)&&!candidates.has(f)));
  // A file that cannot be read might name anything: then only .blend1 backups go.
  let blind=0;
  const learn=async abs=>{let text='';try{text=await textOf(abs);}catch{blind++;}let grew=false;for(const id of idsIn(text))if(!live.has(id)){live.add(id);grew=true;}return grew;};
  for(let changed=true;changed;){
    changed=false;
    for(const f of [...kept])if(!read.has(f.abs)){read.add(f.abs);if(await learn(f.abs))changed=true;}
    for(const d of packages)if(live.has(d.id)&&!read.has(d.abs)){read.add(d.abs);if(await learn(d.abs))changed=true;}
    for(const f of candidates)if(!kept.has(f)&&keys(f).some(k=>live.has(k))){kept.add(f);changed=true;}
  }
  const history=new Set();
  for(const f of files)if(isHistory(f))for(const id of idsIn(await textOf(f.abs).catch(()=>'')))history.add(id);
  // Recent files nothing names yet: left alone this time, counted for the UI.
  let recent=files.filter(f=>isRecent(f)&&!isBlend1(f)&&!isHistory(f)&&keys(f).length&&!keys(f).some(k=>live.has(k))).length;
  const trash=[];
  for(const f of files){
    const blend1=isBlend1(f);
    if(isHistory(f)||((kept.has(f)||blind)&&!blend1))continue;
    if(isRecent(f)){recent++;continue;}
    const reason=blend1?'blend1':f.area==='data'&&f.parts[0]==='placement-editable'?'cache':keys(f).some(k=>history.has(k))?'discarded':'unused';
    trash.push({abs:f.abs,rel:f.rel,size:f.size,mtimeMs:f.mtimeMs,ino:f.ino,reason});
  }
  // Identical frozen copies that stay: share one file.
  const gone=new Set(trash.map(t=>t.abs)),bySize=new Map(),links=[];
  for(const f of files)if(!gone.has(f.abs)&&f.size>=MB&&frozenPath(f.area,f.parts)){const list=bySize.get(f.size)||[];list.push(f);bySize.set(f.size,list);}
  for(const same of bySize.values()){
    if(same.length<2)continue;
    const byHash=new Map();
    for(const f of same){const h=await contentHash(f.abs,f.size,f.mtimeMs);const list=byHash.get(h)||[];list.push(f);byHash.set(h,list);}
    for(const [hash,list] of byHash){
      const target=list.find(f=>f.area==='data'&&f.parts.length===1)||list[0];
      for(const f of list)if(f!==target&&f.ino!==target.ino)links.push({abs:f.abs,rel:f.rel,size:f.size,mtimeMs:f.mtimeMs,target:target.abs,targetMtimeMs:target.mtimeMs,hash});
    }
  }
  const bytes={blend1:0,discarded:0,unused:0,cache:0,links:0};
  const freed=new Map();
  for(const t of trash){bytes[t.reason]+=t.size;freed.set(t.ino,t.size);}
  for(const l of links){bytes.links+=l.size;}
  // A hard-linked file only frees space when its last name goes.
  const remaining=new Set(files.filter(f=>!gone.has(f.abs)).map(f=>f.ino));
  const freedBytes=[...freed].filter(([ino])=>!remaining.has(ino)).reduce((n,[,s])=>n+s,0)+bytes.links;
  return {projectId:p.id,name:p.name,busy:false,totalBytes,afterBytes:Math.max(0,totalBytes-freedBytes),trash,links,bytes,recent,unreadable:blind};
}

const batchDir=(store,id)=>path.join(store.root,CLEANUP_TRASH,id);
async function writeBatch(store,batch){const file=path.join(batchDir(store,batch.id),'batch.json');await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.writeFile(file+'.tmp',JSON.stringify(batch));await fsp.rename(file+'.tmp',file);}
async function pruneEmpty(dir,stop){for(let d=dir;d.startsWith(stop+path.sep);d=path.dirname(d)){try{await fsp.rmdir(d);}catch{return;}}}
const unchanged=async(abs,size,mtimeMs)=>{const s=await fsp.stat(abs,{bigint:true}).catch(()=>null);return !!s&&s.isFile()&&Number(s.size)===size&&Number(s.mtimeMs)===mtimeMs;};
// Same volume: a rename. Another volume: copy, then remove the original.
async function move(from,to){try{await fsp.rename(from,to);}catch(error){if(error.code!=='EXDEV')throw error;await fsp.copyFile(from,to,fs.constants.COPYFILE_EXCL);await fsp.unlink(from);}}

// Apply a fresh plan: move to the trash, then share identical frozen copies.
export async function cleanProject(store,p,plan,progress=()=>{}){
  const dirs=projectDirs(store,p.id),batch={id:randomUUID(),projectId:p.id,name:p.name,createdAt:new Date().toISOString(),items:[]};
  const files=path.join(batchDir(store,batch.id),'files');
  let done=0,skipped=0;const steps=plan.trash.length+plan.links.length;
  if(plan.trash.length)await writeBatch(store,batch);
  for(const t of plan.trash){
    progress(++done,steps);
    if(!await unchanged(t.abs,t.size,t.mtimeMs)){skipped++;continue;}
    const dest=path.join(files,...t.rel.split('/'));
    await fsp.mkdir(path.dirname(dest),{recursive:true});
    // A file open in another program (Blender) stays where it is.
    try{await move(t.abs,dest);}catch{skipped++;continue;}
    batch.items.push({rel:t.rel,size:t.size,reason:t.reason});
    if(batch.items.length%200===0)await writeBatch(store,batch);
    await pruneEmpty(path.dirname(t.abs),t.rel.startsWith('data/')?dirs.data:dirs.workspace);
  }
  if(plan.trash.length)await writeBatch(store,batch);
  let linked=0;
  for(const l of plan.links){
    progress(++done,steps);
    if(!await unchanged(l.abs,l.size,l.mtimeMs)||!await unchanged(l.target,l.size,l.targetMtimeMs)){skipped++;continue;}
    if(await contentHash(l.target,l.size,l.targetMtimeMs)!==l.hash||await contentHash(l.abs,l.size,l.mtimeMs)!==l.hash){skipped++;continue;}
    // Link under a temporary name, then replace the copy in one rename.
    const temp=l.abs+'.fita-link';
    try{await fsp.rm(temp,{force:true});await fsp.link(l.target,temp);await fsp.rename(temp,l.abs);linked+=l.size;}
    catch{await fsp.rm(temp,{force:true}).catch(()=>{});skipped++;}
  }
  if(plan.trash.length&&!batch.items.length)await fsp.rm(batchDir(store,batch.id),{recursive:true,force:true});
  return {batchId:batch.items.length?batch.id:null,trashedBytes:batch.items.reduce((n,i)=>n+i.size,0),trashedFiles:batch.items.length,linkedBytes:linked,skipped};
}

export async function listTrash(store){
  const out=[];
  for(const id of await fsp.readdir(path.join(store.root,CLEANUP_TRASH)).catch(()=>[])){
    const batch=JSON.parse(await fsp.readFile(path.join(batchDir(store,id),'batch.json'),'utf8').catch(()=>'null'));
    if(batch?.id===id)out.push({id,projectId:batch.projectId,name:batch.name,createdAt:batch.createdAt,files:batch.items.length,bytes:batch.items.reduce((n,i)=>n+i.size,0)});
  }
  return out.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

// Put every file back where it was. A path that is taken again stays in the batch.
export async function restoreBatch(store,id){
  if(!ID.test(id))throw Object.assign(Error('FITA_CLEANUP_NOT_FOUND'),{status:404});
  const dir=batchDir(store,id),batch=JSON.parse(await fsp.readFile(path.join(dir,'batch.json'),'utf8').catch(()=>'null'));
  if(!batch)throw Object.assign(Error('FITA_CLEANUP_NOT_FOUND'),{status:404});
  if(!store.projects.has(batch.projectId))throw Object.assign(Error('FITA_CLEANUP_PROJECT_MISSING'),{status:409});
  const dirs=projectDirs(store,batch.projectId),left=[];let restored=0;
  for(const item of batch.items){
    const [area,...parts]=item.rel.split('/'),dest=path.join(area==='data'?dirs.data:dirs.workspace,...parts),from=path.join(dir,'files',...item.rel.split('/'));
    if(!fs.existsSync(from))continue;
    if(fs.existsSync(dest)){left.push(item);continue;}
    await fsp.mkdir(path.dirname(dest),{recursive:true});await move(from,dest);restored++;
  }
  if(left.length)await writeBatch(store,{...batch,items:left});else await fsp.rm(dir,{recursive:true,force:true});
  return {restored,conflicts:left.length};
}
export async function emptyBatch(store,id){
  if(!ID.test(id)||!fs.existsSync(path.join(batchDir(store,id),'batch.json')))throw Object.assign(Error('FITA_CLEANUP_NOT_FOUND'),{status:404});
  await fsp.rm(batchDir(store,id),{recursive:true,force:true});
  return {emptied:id};
}

// Routes. Analysis and cleanup are background jobs; the UI polls them.
export function mountProjectCleanup(app,{store,isBusy=()=>false,othersBusy=()=>false,measureSpace,clock=Date.now}){
  const jobs=new Map();
  const fail=(code,status=400)=>{throw Object.assign(new Error(code),{status});};
  const summary=plan=>({projectId:plan.projectId,name:plan.name,busy:plan.busy,totalBytes:plan.totalBytes,afterBytes:plan.afterBytes,bytes:plan.bytes,files:plan.trash.length,links:plan.links.length,recent:plan.recent,unreadable:plan.unreadable||0});
  const publicJob=j=>({id:j.id,kind:j.kind,status:j.status,step:j.step,steps:j.steps,project:j.project,projects:j.projects,results:j.results,error:j.error,freeBytes:j.freeBytes});
  const running=()=>[...jobs.values()].some(j=>j.status==='running');
  function start(kind,work){
    if(running()||othersBusy())fail('FITA_CLEANUP_BUSY',409);
    const job={id:randomUUID(),kind,status:'running',step:0,steps:0};
    jobs.set(job.id,job);while(jobs.size>10)jobs.delete(jobs.keys().next().value);
    work(job).then(result=>Object.assign(job,result,{status:'succeeded'}),error=>Object.assign(job,{status:'failed',error:error.message||'FITA_CLEANUP_FAILED'}));
    return job;
  }
  const free=async()=>measureSpace?measureSpace(store.root).catch(()=>null):null;
  const chosen=ids=>{const all=[...store.projects.values()];return Array.isArray(ids)?all.filter(p=>ids.includes(p.id)):all;};
  app.post('/api/cleanup/analyze',async(req,res)=>{
    const projects=chosen(req.body?.projectIds);
    const job=start('analyze',async job=>{
      job.steps=projects.length;const out=[];
      for(const p of projects){job.step++;job.project=p.name;out.push(summary(await planCleanup(store,p,{busy:isBusy(p),now:clock()})));}
      return {projects:out,freeBytes:await free()};
    });
    res.status(202).json({job:publicJob(job)});
  });
  app.post('/api/cleanup/run',async(req,res)=>{
    if(req.body?.confirm!==true)fail('FITA_CLEANUP_CONFIRMATION');
    const projects=chosen(req.body?.projectIds);
    const job=start('clean',async job=>{
      job.steps=projects.length;const results=[];
      for(const p of projects){
        job.step++;job.project=p.name;
        // Re-plan right before acting: nothing decided minutes ago is trusted.
        const plan=await planCleanup(store,p,{busy:isBusy(p),now:clock()});
        if(plan.busy){results.push({projectId:p.id,name:p.name,busy:true});continue;}
        results.push({projectId:p.id,name:p.name,...await cleanProject(store,p,plan)});
      }
      return {results,freeBytes:await free()};
    });
    res.status(202).json({job:publicJob(job)});
  });
  app.get('/api/cleanup/jobs/:id',(req,res)=>{const job=jobs.get(req.params.id);if(!job)fail('FITA_CLEANUP_NOT_FOUND',404);res.json({job:publicJob(job)});});
  app.get('/api/cleanup/trash',async(req,res)=>res.json({batches:await listTrash(store),freeBytes:await free()}));
  app.post('/api/cleanup/trash/:id/restore',async(req,res)=>{if(running())fail('FITA_CLEANUP_BUSY',409);res.json(await restoreBatch(store,req.params.id));});
  app.delete('/api/cleanup/trash/:id',async(req,res)=>{if(running())fail('FITA_CLEANUP_BUSY',409);res.json(await emptyBatch(store,req.params.id));});
  return {busy:running};
}

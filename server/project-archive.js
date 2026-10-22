// Portable FITA projects (.fita): one ZIP with the project record, its assets
// (data/<id>/) and its Codex workspaces (projects/<id>/). Written and read as
// streams, so multi-GB projects never sit in memory. Opening an archive never
// replaces an existing project: if its id is taken it becomes a copy.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';
import {contentHash,frozenPath} from './project-cleanup.js';
import {publishArchive,archiveStorageError} from './archive-publication.js';

export const ARCHIVE_FORMAT='fita-project';
// v2: identical files are stored once and listed in manifest.copies.
export const ARCHIVE_VERSION=2;
const MANIFEST='fita-project.json',RECORD='project.json';
// Already compressed media is stored as is: faster, and deflate gains nothing.
const STORED=new Set(['.png','.jpg','.jpeg','.webp','.glb','.fbx','.zip','.blend','.blend1','.mp4','.ktx2','.gz','.fita']);
// Text files may embed the project id or absolute paths of the source machine.
const TEXT=new Set(['.json','.txt','.md','.csv','.yaml','.yml','.py','.log','.mtl','.gltf']);
// Keep a separate bounded budget for project state, which includes histories
// and geometry metadata. The small archive index and text-rewrite budget stay
// at 16 MiB. Export and import share these same limits.
export const projectArchiveLimits=Object.freeze({entries:50000,totalBytes:64*1024**3,textBytes:16*1024**2,manifestBytes:16*1024**2,recordBytes:32*1024**2});
const LIMITS=projectArchiveLimits;
function checkTextSize(bytes,limit,code,entry){
  if(bytes>limit)throw Object.assign(Error(code),{status:400,details:{entry,bytes,limitBytes:limit}});
}
function archiveJson(value,limit,code,entry){
  const text=JSON.stringify(value);
  checkTextSize(Buffer.byteLength(text),limit,code,entry);
  return Buffer.from(text);
}
// Check the destination disk before writing: a multi-GB project must not fail
// halfway with ENOSPC. The margin leaves room for the OS and FITA itself.
const SPACE_MARGIN=512*1024**2;
export async function freeSpace(dir){const s=await fsp.statfs(dir);return Number(s.bavail)*Number(s.bsize);}
async function ensureSpace(dir,needed,measure){
  const free=await measure(dir);
  if(free<needed+SPACE_MARGIN)throw Object.assign(Error('FITA_NOT_ENOUGH_SPACE'),{status:507,details:{neededBytes:needed+SPACE_MARGIN,freeBytes:free}});
}
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

async function walk(dir,prefix){
  const out=[];
  const visit=async(abs,rel)=>{
    let entries;try{entries=await fsp.readdir(abs,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries){
      const childAbs=path.join(abs,entry.name),childRel=rel?rel+'/'+entry.name:entry.name;
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory())await visit(childAbs,childRel);
      // Blender's .blend1 backups are never used by FITA: they stay out of the archive.
      else if(entry.isFile()&&!/\.(tmp|partial|blend1)$/i.test(entry.name)){const stat=await fsp.stat(childAbs,{bigint:true});out.push({abs:childAbs,name:prefix+childRel,size:Number(stat.size),mtime:new Date(Number(stat.mtimeMs)),mtimeMs:Number(stat.mtimeMs),ino:stat.ino});}
    }
  };
  await visit(dir,'');
  return out;
}

export function safeFileName(name){
  const base=String(name||'Proyecto').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'').slice(0,80);
  return (base||'Proyecto')+'.fita';
}

// Write <dest>.partial and rename on success, so a cancelled or failed export
// never leaves a truncated .fita behind.
export async function exportProject({store,id,dest,progress=()=>{},measureSpace=freeSpace}){
  const p=store.get(id);
  await store.save(p);
  // Compact JSON preserves state without archiving indentation. Reject an
  // unreadable export before opening/replacing the destination archive.
  const record=archiveJson(p,LIMITS.recordBytes,'FITA_ARCHIVE_PROJECT_TOO_LARGE',RECORD);
  const appRoot=path.dirname(store.root);
  const all=[...await walk(path.join(store.root,id),'data/'),...await walk(path.join(appRoot,'projects',id),'workspace/')];
  // Identical content (same hard link, or same size and hash) goes in once.
  const files=[],copies=[],seen=new Map();
  for(const file of all){
    const key=file.size<1024**2?null:seen.has('i'+file.ino)?'i'+file.ino:'h'+file.size+':'+await contentHash(file.abs,file.size,file.mtimeMs);
    const first=key&&(seen.get(key)||seen.get('i'+file.ino));
    if(first){copies.push({name:file.name,same:first.name});continue;}
    if(key){seen.set(key,file);seen.set('i'+file.ino,file);}
    files.push(file);
  }
  const totalBytes=files.reduce((n,f)=>n+f.size,0)+record.length;
  const manifest={format:ARCHIVE_FORMAT,version:ARCHIVE_VERSION,app:'FITA',exportedAt:new Date().toISOString(),projectId:p.id,name:p.name,sourceRoot:appRoot,fileCount:all.length,totalBytes,copies};
  if(files.length+2>LIMITS.entries||all.length>LIMITS.entries)throw Object.assign(Error('FITA_ARCHIVE_TOO_MANY_FILES'),{status:400});
  if(all.reduce((n,f)=>n+f.size,0)>LIMITS.totalBytes)throw Object.assign(Error('FITA_ARCHIVE_TOO_LARGE'),{status:400});
  const manifestBytes=archiveJson(manifest,LIMITS.manifestBytes,'FITA_ARCHIVE_MANIFEST_TOO_LARGE',MANIFEST);
  await ensureSpace(path.dirname(dest),totalBytes,measureSpace);
  const partial=dest+'.partial',zip=new yazl.ZipFile(),out=fs.createWriteStream(partial);
  let written=record.length;progress({bytes:0,totalBytes});
  const done=pipeline(zip.outputStream,out);
  zip.addBuffer(manifestBytes,MANIFEST);
  zip.addBuffer(record,RECORD);
  for(const file of files){
    zip.addReadStreamLazy(file.name,{compress:!STORED.has(path.extname(file.name).toLowerCase()),mtime:file.mtime,size:file.size},callback=>{
      const stream=fs.createReadStream(file.abs);
      stream.on('data',chunk=>{written+=chunk.length;progress({bytes:written,totalBytes});});
      callback(null,stream);
    });
  }
  zip.end();
  try{await done;await fsp.rename(partial,dest);}
  catch(error){await fsp.rm(partial,{force:true});throw error;}
  progress({bytes:totalBytes,totalBytes});
  return {path:dest,totalBytes,fileCount:all.length,copies:copies.length,size:(await fsp.stat(dest)).size};
}

const openZip=file=>new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:false,validateEntrySizes:true,strictFileNames:true,decodeStrings:true},(error,zip)=>error?reject(error):resolve(zip)));
function listEntries(zip){
  return new Promise((resolve,reject)=>{
    const entries=[];
    zip.on('entry',entry=>{entries.push(entry);if(entries.length>LIMITS.entries){zip.close();reject(Object.assign(Error('FITA_ARCHIVE_TOO_MANY_FILES'),{status:400}));return;}zip.readEntry();});
    zip.on('end',()=>resolve(entries));zip.on('error',reject);zip.readEntry();
  });
}
const readStream=(zip,entry)=>new Promise((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>error?reject(error):resolve(stream)));
async function readText(zip,entry,limit=LIMITS.textBytes,code='FITA_ARCHIVE_INVALID'){
  checkTextSize(entry.uncompressedSize,limit,code,entry.fileName);
  // One bounded buffer instead of retaining all chunks plus a concatenation.
  const bytes=Buffer.alloc(entry.uncompressedSize);let written=0;
  for await(const chunk of await readStream(zip,entry)){
    checkTextSize(written+chunk.length,limit,code,entry.fileName);
    if(written+chunk.length>bytes.length)throw Object.assign(Error('FITA_ARCHIVE_INVALID'),{status:400});
    chunk.copy(bytes,written);written+=chunk.length;
  }
  if(written!==bytes.length)throw Object.assign(Error('FITA_ARCHIVE_INVALID'),{status:400});
  return bytes.toString('utf8');
}
// Only data/… and workspace/… relative paths; no traversal, drive letters,
// backslashes or symbolic links.
function entryTarget(entry){
  const name=entry.fileName;
  if(name.endsWith('/'))return null;
  if(name===MANIFEST||name===RECORD)return null;
  const mode=(entry.externalFileAttributes>>>16)&0o170000;
  if(mode===0o120000)throw Object.assign(Error('FITA_ARCHIVE_INVALID'),{status:400});
  const match=name.match(/^(data|workspace)\/(.+)$/);
  if(!match||name.includes('\\')||/(^|\/)\.\.?(\/|$)/.test(match[2])||/^[a-z]:/i.test(match[2])||match[2].startsWith('/'))throw Object.assign(Error('FITA_ARCHIVE_INVALID'),{status:400});
  return {area:match[1],relative:match[2]};
}
function rewriter({sourceRoot,targetRoot,fromId,toId}){
  const pairs=[];
  if(sourceRoot&&sourceRoot!==targetRoot){
    const variants=root=>[root,root.replace(/\\/g,'/'),JSON.stringify(root).slice(1,-1)];
    const [a,b,c]=variants(sourceRoot),[x,y,z]=variants(targetRoot);
    pairs.push([c,z],[a,x],[b,y]);
  }
  if(fromId!==toId)pairs.push([fromId,toId]);
  return text=>pairs.reduce((value,[from,to])=>value.split(from).join(to),text);
}

// Recorded work that was running when the archive was made cannot continue on
// this machine: mark it interrupted so nothing looks busy forever.
function settleImported(p){
  for(const key of ['textureOperations','placements','studioOperations','rigStudioJobs','riggingRuns'])
    for(const record of Array.isArray(p[key])?p[key]:[])
      if(record&&['queued','running'].includes(record.status)){record.status='failed';record.error='FITA_IMPORT_INTERRUPTED';}
}

const invalid=error=>error?.status?error:Object.assign(Error('FITA_ARCHIVE_INVALID'),{status:400,cause:error});
const importReservations=new WeakMap();
export async function importProject({store,file,progress=()=>{},measureSpace=freeSpace}){
  // Not a ZIP, a damaged one, or entry names yauzl refuses (traversal,
  // absolute paths): all are "not a valid .fita".
  const zip=await openZip(file).catch(error=>{throw invalid(error);});
  try{
    const entries=await listEntries(zip).catch(error=>{throw invalid(error);});
    const manifestEntry=entries.find(e=>e.fileName===MANIFEST),recordEntry=entries.find(e=>e.fileName===RECORD);
    if(!manifestEntry||!recordEntry)throw Object.assign(Error('FITA_ARCHIVE_INVALID'),{status:400});
    const manifest=JSON.parse(await readText(zip,manifestEntry,LIMITS.manifestBytes,'FITA_ARCHIVE_MANIFEST_TOO_LARGE'));
    if(manifest.format!==ARCHIVE_FORMAT||!Number.isInteger(manifest.version))throw Object.assign(Error('FITA_ARCHIVE_INVALID'),{status:400});
    if(manifest.version>ARCHIVE_VERSION)throw Object.assign(Error('FITA_ARCHIVE_NEWER_VERSION'),{status:400});
    const targets=entries.map(entry=>({entry,target:entryTarget(entry)})).filter(x=>x.target);
    // v2 copies: each names an extracted file with the same content. Frozen
    // places share it as a hard link; any other place gets its own copy.
    const byName=new Map(targets.map(x=>[x.entry.fileName,x]));
    const copies=Array.isArray(manifest.copies)?manifest.copies:[];
    if(targets.length+copies.length>LIMITS.entries)throw Object.assign(Error('FITA_ARCHIVE_TOO_MANY_FILES'),{status:400});
    const copyPlan=copies.map(c=>{
      const target=entryTarget({fileName:String(c?.name||''),externalFileAttributes:0}),source=byName.get(String(c?.same||''));
      if(!target||!source||byName.has(c.name))throw Object.assign(Error('FITA_ARCHIVE_INVALID'),{status:400});
      const area=a=>a==='data'?'data':'workspace',shared=frozenPath(area(target.area),target.relative.split('/'))&&frozenPath(area(source.target.area),source.target.relative.split('/'));
      return {target,source,shared,size:source.entry.uncompressedSize};
    });
    const totalBytes=targets.reduce((n,x)=>n+x.entry.uncompressedSize,0);
    if(totalBytes+copyPlan.reduce((n,c)=>n+c.size,0)>LIMITS.totalBytes)throw Object.assign(Error('FITA_ARCHIVE_TOO_LARGE'),{status:400});
    await ensureSpace(store.root,totalBytes+copyPlan.filter(c=>!c.shared).reduce((n,c)=>n+c.size,0),measureSpace);
    const original=JSON.parse(await readText(zip,recordEntry,LIMITS.recordBytes,'FITA_ARCHIVE_PROJECT_TOO_LARGE'));
    if(!UUID.test(original.id||'')||original.id!==manifest.projectId)throw Object.assign(Error('FITA_ARCHIVE_INVALID'),{status:400});
    const appRoot=path.dirname(store.root);
    const reservations=importReservations.get(store)||new Set();importReservations.set(store,reservations);
    // Trash reserves its identity; workspaces and even dangling links also count
    // as occupied. Never merge a new import with a previous project or workspace.
    const exists=file=>!!fs.lstatSync(file,{throwIfNoEntry:false});
    const taken=id=>reservations.has(id)||store.projects.has(id)||store.unavailable?.has(id)||exists(path.join(store.root,id+'.json'))||exists(path.join(store.root,id))||exists(path.join(appRoot,'projects',id));
    let id=original.id;while(taken(id))id=randomUUID();reservations.add(id);
    const rewrite=rewriter({sourceRoot:manifest.sourceRoot,targetRoot:appRoot,fromId:original.id,toId:id});
    const staging=path.join(store.root,'.import-'+randomUUID());
    let written=0;progress({bytes:0,totalBytes});
    try{
      for(const {entry,target} of targets){
        const dest=path.join(staging,target.area,...target.relative.split('/'));
        if(!dest.startsWith(path.join(staging,target.area)+path.sep))throw Object.assign(Error('FITA_ARCHIVE_INVALID'),{status:400});
        await fsp.mkdir(path.dirname(dest),{recursive:true});
        if(TEXT.has(path.extname(dest).toLowerCase())&&entry.uncompressedSize<=LIMITS.textBytes){
          await fsp.writeFile(dest,rewrite(await readText(zip,entry)));written+=entry.uncompressedSize;
        }else{
          const stream=await readStream(zip,entry);
          stream.on('data',chunk=>{written+=chunk.length;progress({bytes:written,totalBytes});});
          await pipeline(stream,fs.createWriteStream(dest,{flags:'wx'}));
        }
        progress({bytes:written,totalBytes});
      }
      for(const c of copyPlan){
        const from=path.join(staging,c.source.target.area,...c.source.target.relative.split('/')),dest=path.join(staging,c.target.area,...c.target.relative.split('/'));
        if(!dest.startsWith(path.join(staging,c.target.area)+path.sep))throw Object.assign(Error('FITA_ARCHIVE_INVALID'),{status:400});
        await fsp.mkdir(path.dirname(dest),{recursive:true});
        if(c.shared)await fsp.link(from,dest).catch(()=>fsp.copyFile(from,dest,fs.constants.COPYFILE_EXCL));
        else await fsp.copyFile(from,dest,fs.constants.COPYFILE_EXCL);
      }
      const p=JSON.parse(rewrite(JSON.stringify(original)));
      p.id=id;
      if(id!==original.id)p.name=String(p.name||'Proyecto').slice(0,70)+' (copia)';
      settleImported(p);
      await publishArchive({store,project:p,staging});
      try{progress({bytes:totalBytes,totalBytes});}catch{}
      return {id,name:p.name,copied:id!==original.id,totalBytes};
    }catch(error){
      if(['EPERM','EACCES','EBUSY','EEXIST','ENOTEMPTY','EXDEV'].includes(error.code))throw archiveStorageError(error);
      throw error;
    }finally{reservations.delete(id);}
  }finally{zip.close();}
}

// Native Windows "Save as" / "Open" dialog from the local server. The dialog
// path is the only thing that crosses: no shell interpolation of user data.
export function pickPathNative({mode,defaultName=''}){
  if(process.platform!=='win32')return Promise.resolve({unavailable:true});
  const dialog=mode==='save'
    ?"$d=New-Object System.Windows.Forms.SaveFileDialog;$d.OverwritePrompt=$true;$d.FileName=$env:FITA_DEFAULT_NAME;"
    :"$d=New-Object System.Windows.Forms.OpenFileDialog;$d.Multiselect=$false;";
  const script="[Console]::OutputEncoding=[Text.Encoding]::UTF8;Add-Type -AssemblyName System.Windows.Forms;"+
    "$o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true;ShowInTaskbar=$false;Opacity=0;StartPosition='CenterScreen'};$o.Show();$o.Activate();"+
    dialog+"$d.Filter='Proyecto FITA (*.fita)|*.fita';$d.InitialDirectory=[Environment]::GetFolderPath('MyDocuments');"+
    "if($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Out.Write($d.FileName)};$o.Close()";
  return new Promise(resolve=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-Command',script],{env:{...process.env,FITA_DEFAULT_NAME:defaultName},windowsHide:true});
    let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',d=>{out+=d;});
    const timer=setTimeout(()=>child.kill(),10*60000);
    child.on('error',()=>{clearTimeout(timer);resolve({unavailable:true});});
    child.on('close',()=>{clearTimeout(timer);const value=out.trim();resolve(value?{path:value}:{cancelled:true});});
  });
}

// Long exports and imports run as jobs; the UI polls their progress.
export function mountProjectArchive(app,{store,pickPath=pickPathNative,tempDir=os.tmpdir(),measureSpace=freeSpace,othersBusy=()=>false}){
  const jobs=new Map();let dialogOpen=false;
  const fail=(code,status=400)=>{throw Object.assign(new Error(code),{status});};
  const publicJob=j=>({id:j.id,kind:j.kind,status:j.status,bytes:j.bytes,totalBytes:j.totalBytes,projectId:j.projectId,name:j.name,path:j.path,copied:j.copied,error:j.error,details:j.details});
  function start(kind,fields,work){
    const job={id:randomUUID(),kind,status:'running',bytes:0,totalBytes:0,...fields};
    jobs.set(job.id,job);while(jobs.size>20)jobs.delete(jobs.keys().next().value);
    work(({bytes,totalBytes})=>{job.bytes=bytes;job.totalBytes=totalBytes;}).then(result=>Object.assign(job,result,{status:'succeeded'}),error=>Object.assign(job,{status:'failed',error:error.message||'FITA_ARCHIVE_FAILED',details:error.details}));
    return job;
  }
  async function choose(mode,defaultName){
    if(dialogOpen)fail('FITA_DIALOG_ALREADY_OPEN',409);
    dialogOpen=true;try{return await pickPath({mode,defaultName});}finally{dialogOpen=false;}
  }
  const running=()=>[...jobs.values()].some(j=>j.status==='running'),busy=()=>running()||othersBusy();
  app.post('/api/projects/:id/archive',async(req,res)=>{
    const p=store.get(req.params.id);
    if(busy())fail('FITA_ARCHIVE_BUSY',409);
    const picked=await choose('save',safeFileName(p.name));
    if(picked.unavailable)return res.status(200).json({fallback:'download'});
    if(picked.cancelled)return res.status(200).json({cancelled:true});
    const dest=/\.fita$/i.test(picked.path)?picked.path:picked.path+'.fita';
    const job=start('export',{projectId:p.id,name:p.name,path:dest},progress=>exportProject({store,id:p.id,dest,progress,measureSpace}));
    res.status(202).json({job:publicJob(job)});
  });
  // Browser fallback (no native dialog): stream the archive as a download.
  app.get('/api/projects/:id/archive.fita',async(req,res)=>{
    const p=store.get(req.params.id),temp=path.join(tempDir,'fita-export-'+randomUUID()+'.fita');
    try{
      await exportProject({store,id:p.id,dest:temp,measureSpace});
      res.download(temp,safeFileName(p.name),()=>{void fsp.rm(temp,{force:true});});
    }catch(error){await fsp.rm(temp,{force:true});throw error;}
  });
  app.post('/api/projects/import',async(req,res)=>{
    if(busy())fail('FITA_ARCHIVE_BUSY',409);
    const picked=await choose('open','');
    if(picked.unavailable)return res.status(200).json({fallback:'upload'});
    if(picked.cancelled)return res.status(200).json({cancelled:true});
    const job=start('import',{path:picked.path,name:path.basename(picked.path)},async progress=>{const r=await importProject({store,file:picked.path,progress,measureSpace});return {projectId:r.id,name:r.name,copied:r.copied};});
    res.status(202).json({job:publicJob(job)});
  });
  // Browser fallback: the archive arrives as the raw request body (streamed to disk).
  app.post('/api/projects/import-upload',async(req,res)=>{
    if(busy())fail('FITA_ARCHIVE_BUSY',409);
    const temp=path.join(tempDir,'fita-import-'+randomUUID()+'.fita');
    await pipeline(req,fs.createWriteStream(temp));
    const job=start('import',{name:String(req.headers['x-file-name']||'proyecto.fita').slice(0,120)},async progress=>{
      try{const r=await importProject({store,file:temp,progress,measureSpace});return {projectId:r.id,name:r.name,copied:r.copied};}
      finally{await fsp.rm(temp,{force:true});}
    });
    res.status(202).json({job:publicJob(job)});
  });
  app.get('/api/project-archives/:jobId',(req,res)=>{
    const job=jobs.get(req.params.jobId);if(!job)fail('FITA_ARCHIVE_JOB_NOT_FOUND',404);
    res.json({job:publicJob(job)});
  });
  return {busy:running};
}

import fs from 'node:fs/promises';
import path from 'node:path';
const marker='import-transaction.json';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const archiveStorageError=cause=>Object.assign(Error('FITA_ARCHIVE_STORAGE_BLOCKED'),{status:409,cause});
async function info(file){try{const s=await fs.lstat(file,{bigint:true});return {directory:s.isDirectory()&&!s.isSymbolicLink(),ino:String(s.ino),dev:String(s.dev)};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const same=(a,b)=>!!a&&a.directory&&a.ino===b.ino&&a.dev===b.dev;
function paths(store,staging,id){
 const root=path.resolve(store.root),stage=path.resolve(staging);
 if(!uuid.test(id)||path.dirname(stage)!==root||!/^\.import-[a-f0-9-]{36}$/i.test(path.basename(stage)))throw archiveStorageError();
 return {stage,record:path.join(root,id+'.json'),data:path.join(root,id),workspace:path.join(path.dirname(root),'projects',id)};
}
async function writeJournal(stage,journal){const tmp=path.join(stage,marker+'.tmp');await fs.writeFile(tmp,JSON.stringify(journal));await fs.rename(tmp,path.join(stage,marker));}
async function recordId(file){try{const s=await fs.stat(file);if(s.size>64*1024**2)return null;return JSON.parse(await fs.readFile(file,'utf8')).id;}catch{return null;}}
async function finish(stage){
 // Only our own metadata and an empty staging directory may be removed.
 // Unknown files, failed extractions and old orphaned imports are preserved.
 await fs.unlink(path.join(stage,marker)).catch(()=>{});
 await fs.rmdir(stage).catch(()=>{});
}
async function rollback(store,staging,journal){
 const p=paths(store,staging,journal.id);
 for(const area of [...journal.areas].reverse()){
  if(!['data','workspace'].includes(area.name))throw archiveStorageError();
  const source=path.join(p.stage,area.name),destination=p[area.name];
  const a=await info(source),b=await info(destination);
  if(a){if(!same(a,area.owner)||b)throw archiveStorageError();continue;}
  if(!same(b,area.owner))throw archiveStorageError();
  await fs.rename(destination,source);
 }
 journal.phase='rolled-back';await writeJournal(p.stage,journal);
}
export async function publishArchive({store,project,staging,move=fs.rename}){
 const p=paths(store,staging,project.id);
 await fs.mkdir(p.stage,{recursive:true});
 if(await info(p.record)||await info(p.data)||await info(p.workspace)||store.projects.has(project.id)||store.unavailable?.has(project.id))throw archiveStorageError();
 const areas=[];
 for(const name of ['data','workspace']){const owner=await info(path.join(p.stage,name));if(owner){if(!owner.directory||owner.ino==='0')throw archiveStorageError();areas.push({name,owner});}}
 const journal={schema:1,id:project.id,phase:'prepared',areas};await writeJournal(p.stage,journal);
 try{
  for(const area of areas){await fs.mkdir(path.dirname(p[area.name]),{recursive:true});await move(path.join(p.stage,area.name),p[area.name]);journal.phase=area.name+'-published';await writeJournal(p.stage,journal);}
  if(await info(p.record))throw archiveStorageError();
  await store.adopt(project);
 }catch(cause){
  // adopt() registers in memory before its write can fail. Do not leave that
  // uncommitted record visible, or overwrite it on a later unrelated save.
  if(store.projects.get(project.id)===project){store.projects.delete(project.id);store.writes?.delete(project.id);}
  try{
   if(await recordId(p.record)===project.id)await fs.rename(p.record,path.join(p.stage,'uncommitted-project.json'));
   await rollback(store,p.stage,journal);
  }catch(rollbackError){journal.phase='recovery-required';await writeJournal(p.stage,journal).catch(()=>{});}
  throw archiveStorageError(cause);
 }
 journal.phase='committed';await writeJournal(p.stage,journal).catch(()=>{});await finish(p.stage);
}
export async function recoverArchivePublications(store){
 for(const name of await fs.readdir(store.root)){
  if(!/^\.import-[a-f0-9-]{36}$/i.test(name))continue;
  const stage=path.join(store.root,name);
  try{
   const stat=await fs.lstat(stage);if(!stat.isDirectory()||stat.isSymbolicLink())continue;
   const journalFile=path.join(stage,marker),journalStat=await fs.lstat(journalFile);if(!journalStat.isFile()||journalStat.isSymbolicLink()||journalStat.size>8192)continue;
   const raw=await fs.readFile(journalFile,'utf8');
   const journal=JSON.parse(raw);if(journal.schema!==1||!uuid.test(journal.id)||!Array.isArray(journal.areas)||journal.areas.length>2)continue;
   const p=paths(store,stage,journal.id);
   if(await recordId(p.record)===journal.id){
    if(journal.areas.every(a=>['data','workspace'].includes(a.name))&&(await Promise.all(journal.areas.map(async a=>same(await info(p[a.name]),a.owner)))).every(Boolean))await finish(stage);
   }else if(journal.phase!=='rolled-back')await rollback(store,stage,journal);
  }catch{console.warn('FITA kept an interrupted import for recovery. No existing project was replaced.');}
 }
}

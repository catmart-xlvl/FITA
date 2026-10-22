import fs from 'node:fs/promises';
import path from 'node:path';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fail=code=>{throw Object.assign(Error(code),{status:409});};
async function stat(file){try{return await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function ordinaryTree(root){
 let count=0;
 async function visit(file){const s=await fs.lstat(file);if(++count>200000||s.isSymbolicLink()||!s.isDirectory()&&!s.isFile())fail('FITA_TRASH_PATH_UNSAFE');if(s.isDirectory())for(const name of await fs.readdir(file))await visit(path.join(file,name));}
 await visit(root);
}
export async function trashEntry(store,id){
 if(!uuid.test(id))fail('FITA_TRASH_PATH_UNSAFE');
 const base=path.resolve(store.root,'.trash'),dir=path.resolve(base,id),s=await stat(dir),bs=await stat(base);
 if(!s?.isDirectory()||s.isSymbolicLink()||!bs?.isDirectory()||bs.isSymbolicLink()||path.dirname(await fs.realpath(dir))!==await fs.realpath(base))fail('FITA_TRASH_PATH_UNSAFE');
 const recPath=path.join(dir,'record.json'),rs=await stat(recPath);if(!rs?.isFile()||rs.isSymbolicLink()||rs.size>16384)fail('FITA_TRASH_PATH_UNSAFE');
 const record=JSON.parse(await fs.readFile(recPath,'utf8'));if(record.id!==id||!uuid.test(record.projectId))fail('FITA_TRASH_PATH_UNSAFE');
 const pending=await stat(path.join(dir,'purge.json'));if(pending?.isSymbolicLink())fail('FITA_TRASH_PATH_UNSAFE');
 let project;const ps=await stat(path.join(dir,'project.json'));
 if(ps){if(!ps.isFile()||ps.isSymbolicLink()||ps.size>64*1024**2)fail('FITA_TRASH_PATH_UNSAFE');project=JSON.parse(await fs.readFile(path.join(dir,'project.json'),'utf8'));if(project.id!==record.projectId)fail('FITA_TRASH_PATH_UNSAFE');}
 else if(!pending)fail('FITA_TRASH_PATH_UNSAFE');
 return {dir,record,project:project||{id:record.projectId,jobs:[]},deletionPending:!!pending};
}
export async function purgeTrashEntry(store,id,{confirm,projectId,busy=()=>false}={}){
 if(confirm!==true)fail('FITA_TRASH_DELETE_CONFIRMATION');
 const {dir,record,project}=await trashEntry(store,id);
 if(projectId!==record.projectId)fail('FITA_TRASH_PATH_UNSAFE');
 if(store.projects.has(projectId)||await stat(path.join(store.root,projectId+'.json'))||busy(project))fail('FITA_TRASH_DELETE_BUSY');
 const names=await fs.readdir(dir);if(names.some(n=>!['record.json','project.json','project.json.tmp','assets','workspace','purge.json'].includes(n)))fail('FITA_TRASH_PATH_UNSAFE');
 // Validate every recursive target before any irreversible work. Hardlinks are
 // unlinked here; other projects' links keep their bytes. Never follow junctions.
 await ordinaryTree(dir);
 const legacy=path.resolve(path.dirname(store.root),'projects',projectId),inside=path.join(dir,'workspace');
 const others=(await store.listTrash()).filter(r=>r.id!==id&&r.projectId===projectId);
 if(!others.length&&await stat(legacy)){
  if(await stat(inside))fail('FITA_TRASH_PATH_UNSAFE');
  if(path.dirname(legacy)!==path.resolve(path.dirname(store.root),'projects'))fail('FITA_TRASH_PATH_UNSAFE');
  await ordinaryTree(legacy);await fs.rename(legacy,inside);
 }
 await fs.writeFile(path.join(dir,'purge.json'),JSON.stringify({schema:1,projectId}));
 try{
  for(const name of ['assets','workspace']){const target=path.resolve(dir,name);if(path.dirname(target)!==dir)fail('FITA_TRASH_PATH_UNSAFE');if(await stat(target))await fs.rm(target,{recursive:true});}
  // Metadata remains until all project bytes were removed. A partial failure
  // keeps the entry visible for explicit retry and disables unsafe restoration.
  for(const name of ['project.json','project.json.tmp','record.json','purge.json'])await fs.unlink(path.join(dir,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});
  await fs.rmdir(dir);return {deleted:true,id,projectId};
 }catch(cause){throw Object.assign(Error('FITA_TRASH_DELETE_FAILED'),{status:409,cause});}
}

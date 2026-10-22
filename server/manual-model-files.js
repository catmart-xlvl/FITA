import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const marker='manual-model-transaction.json';
const assetName=/^[a-f0-9-]{36}\.(blend|glb)$/;
function directory(root,id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid model project');return path.resolve(root,id);}
async function cleanup(dir,transaction){for(const f of transaction.files)for(const name of [f.staged,f.backup])await fs.unlink(path.join(dir,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.unlink(path.join(dir,marker)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
async function rollback(dir,transaction){
 for(const f of transaction.files){if(f.hadOriginal)await fs.copyFile(path.join(dir,f.backup),path.join(dir,f.id));else await fs.unlink(path.join(dir,f.id)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 await cleanup(dir,transaction);
}
// A crash between the two file replacements and project.json commit is rolled
// back at startup. Backups exist only for the transaction, never as versions.
export async function recoverManualModelFiles(root,p){
 const dir=directory(root,p.id);let tx;try{tx=JSON.parse(await fs.readFile(path.join(dir,marker),'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
 if(!Array.isArray(tx.files)||tx.files.length!==2||tx.files.some(f=>!assetName.test(f.id)||f.staged!==f.id+'.new'||f.backup!==f.id+'.rollback'))throw Error('Invalid model recovery');
 if(p.manualPlacement?.id===tx.manualId)await cleanup(dir,tx);else await rollback(dir,tx);
}
export async function replaceManualModelFiles(store,p,manualId,bytes,previous,commit){
 const dir=directory(store.root,p.id);await fs.mkdir(dir,{recursive:true});
 const files=['blend','glb'].map(ext=>{const old=previous?.[ext==='blend'?'blend':'preview'];const id=assetName.test(old?.id||'')?old.id:randomUUID()+'.'+ext;return {id,ext,staged:id+'.new',backup:id+'.rollback',hadOriginal:false};});
 const tx={manualId,files};let published=false;
 try{
  for(const f of files){await fs.writeFile(path.join(dir,f.staged),bytes[f.ext]);try{await fs.copyFile(path.join(dir,f.id),path.join(dir,f.backup));f.hadOriginal=true;}catch(e){if(e.code!=='ENOENT')throw e;}}
  await fs.writeFile(path.join(dir,marker),JSON.stringify(tx));published=true;
  for(const f of files)await fs.rename(path.join(dir,f.staged),path.join(dir,f.id));
  const asset=f=>({id:f.id,url:`/files/${p.id}/${f.id}`,source:'Saved artist-edited model',bytes:bytes[f.ext].length,createdAt:new Date().toISOString()});
  const result=await commit({blend:asset(files[0]),preview:asset(files[1])});
  // A committed project must never be rolled back because cleanup failed.
  await cleanup(dir,tx).catch(()=>{});return result;
 }catch(e){if(published)await rollback(dir,tx);else for(const f of files)for(const n of [f.staged,f.backup])await fs.unlink(path.join(dir,n)).catch(()=>{});throw e;}
}

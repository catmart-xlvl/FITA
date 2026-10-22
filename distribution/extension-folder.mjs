import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const extensionDirectory='FITA Extension';
export const extensionInventory='.fita-extension.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function exists(file){try{return await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}

// Read only ordinary extension files. Browser storage and profiles never enter this tree.
export async function extensionFiles(dir){
  const root=await fs.lstat(dir);
  if(!root.isDirectory()||root.isSymbolicLink())throw Error('The extension folder must be a real directory.');
  const files=[];let total=0;
  async function visit(folder,prefix=''){
    for(const item of await fs.readdir(folder,{withFileTypes:true})){
      if(!prefix&&item.name===extensionInventory)continue;
      if(!/^[a-zA-Z0-9_. -]+$/.test(item.name)||/[. ]$/.test(item.name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(item.name))throw Error('Unexpected extension file name.');
      const rel=prefix+item.name,abs=path.join(folder,item.name);
      if(item.isSymbolicLink())throw Error('Extension links are not supported.');
      if(item.isDirectory())await visit(abs,rel+'/');
      else if(item.isFile()){
        const stat=await fs.stat(abs);
        if(files.length>=256||(total+=stat.size)>16*1024**2)throw Error('Extension folder exceeds its size limit.');
        const bytes=await fs.readFile(abs);files.push({path:rel,bytes});
      }else throw Error('Unexpected extension file type.');
    }
  }
  await visit(dir);files.sort((a,b)=>a.path.localeCompare(b.path));
  return files;
}
export function extensionManifest(files){
  const manifest=JSON.parse(files.find(f=>f.path==='manifest.json')?.bytes.toString('utf8')||'null');
  if(manifest?.manifest_version!==3||!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version))throw Error('Invalid FITA extension manifest.');
  return {schema:1,version:manifest.version,files:files.map(f=>({path:f.path,bytes:f.bytes.length,sha256:sha(f.bytes)}))};
}
async function checkedInstalled(dir){
  if(!await exists(dir))return null;
  const files=await extensionFiles(dir),actual=extensionManifest(files);
  const marker=path.join(dir,extensionInventory),stat=await fs.lstat(marker);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)throw Error('Invalid extension inventory.');
  const expected=JSON.parse(await fs.readFile(marker,'utf8'));
  if(!same(expected,actual))throw Error('FITA Extension has local changes. Keep that folder and restore an official copy before updating. No extension or browser data was replaced.');
  return actual;
}
export async function extensionFolderInfo(root,appDir){
  const folder=path.join(root,extensionDirectory);
  const expected=JSON.parse(await fs.readFile(path.join(appDir,'extension-tripo-studio','manifest.json'),'utf8'));
  return {extensionFolder:folder,extensionVersion:expected.version};
}
export async function prepareExtensionFolder(root,appDir){
  const target=path.join(root,extensionDirectory);
  const files=await extensionFiles(path.join(appDir,'extension-tripo-studio')),inventory=extensionManifest(files);
  const previous=await checkedInstalled(target);
  if(same(previous,inventory))return {changed:false,activate:async()=>{},rollback:async()=>{}};
  const runtime=path.join(root,'runtime');await fs.mkdir(runtime,{recursive:true});
  const stage=path.join(runtime,'extension-stage-'+randomUUID());await fs.mkdir(stage);
  for(const file of files){const dest=path.join(stage,file.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,file.bytes,{flag:'wx'});}
  await fs.writeFile(path.join(stage,extensionInventory),JSON.stringify(inventory,null,2)+'\n',{flag:'wx'});
  await checkedInstalled(stage);
  let backup=null,activated=false;
  return {changed:true,
    async activate(){
      if(!same(await checkedInstalled(target),previous))throw Error('The extension folder changed during update. No replacement was made.');
      if(previous){backup=path.join(runtime,'extension-backup-'+randomUUID());await fs.rename(target,backup);}
      try{await fs.rename(stage,target);activated=true;}
      catch(error){if(backup)await fs.rename(backup,target);throw error;}
    },
    async rollback(){
      if(!activated)return;
      // Keep both versions for diagnosis. Never delete browser data or a modified folder.
      if(!same(await checkedInstalled(target),inventory))throw Error('Extension changed during rollback. Keep runtime backups and restore the previous folder manually.');
      await fs.rename(target,path.join(runtime,'extension-unactivated-'+randomUUID()));
      if(backup)await fs.rename(backup,target);
      activated=false;
    }
  };
}
export async function ensureExtensionFolder(root,appDir){
  const change=await prepareExtensionFolder(root,appDir);await change.activate();return change.changed;
}

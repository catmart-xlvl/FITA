import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Object.assign(Error('RESERVED_RIG_PARTS_CHANGED'),{status:409});};
// Reserved garments stay outside the facial/FITA source and are included only
// when the user later prepares the destination export.
export async function reservedRigParts(bodyFolder,report){
 const r=report?.reservedForVrchat;if(!r)return {files:{},parts:null};
 if(r.schema!=='fita-reserved-rig-parts/v1'||!Array.isArray(r.meshes)||!r.meshes.length||new Set(r.meshes).size!==r.meshes.length||r.meshes.some(n=>typeof n!=='string'||!n.trim())||!Array.isArray(r.files)||r.files.length!==3)fail();
 const expected=new Map([['reserved/character-with-coat.blend','input/reserved-rig.blend'],['reserved/character-with-coat.glb','input/reserved-rig.glb'],['reserved/runtime-with-coat.json','input/reserved-runtime.json']]),files={};
 const base=await fs.realpath(path.join(bodyFolder,'output')).catch(()=>null);if(!base)fail();
 for(const f of r.files){
  const target=expected.get(f.file);if(!target||files[target]||!/^\w{64}$/.test(f.sha256))fail();
  const file=path.join(base,f.file),real=await fs.realpath(file).catch(()=>null),stat=await fs.lstat(file).catch(()=>null);
  if(!real||!real.startsWith(base+path.sep)||!stat?.isFile()||stat.isSymbolicLink()||stat.size>150*1024*1024)fail();
  const bytes=await fs.readFile(file);if(hash(bytes)!==f.sha256)fail();files[target]=bytes;
 }
 return {files,parts:{meshes:r.meshes,policy:'Merge only the reserved garment meshes and their required bones/runtime into the final facial character. Preserve all final body and facial data.'}};
}

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import multer from 'multer';
import {parseGlb,buildGlb} from '../scripts/texture-layout.mjs';
import {inspectRestPreservation} from './rigging-validation.js';
import {findBlender,runBlender} from './placement.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Object.assign(Error('RIG_ASSEMBLY_INVALID: preserve the original model and explicitly list only the added meshes.'),{status:400});};
export function meshNames(bytes){return parseGlb(bytes).json.nodes.filter(n=>n.mesh!==undefined).map(n=>n.name);}
export function meshSubset(bytes,names){const {json,bin}=parseGlb(bytes),keep=new Set(names);for(const n of json.nodes)if(n.mesh!==undefined&&!keep.has(n.name)){delete n.mesh;delete n.skin;}return buildGlb(json,bin);}
export function validateAssemblyRest(original,assembly,additions){
 const before=meshNames(original),after=meshNames(assembly),names=additions?.map(x=>x.name);
 if(!Array.isArray(additions)||!additions.length||additions.length>32||new Set(names).size!==names.length||new Set(after).size!==after.length||after.length!==before.length+names.length||before.some(n=>!after.includes(n))||additions.some(a=>typeof a.name!=='string'||before.includes(a.name)||!after.includes(a.name)||!['hair','clothing','accessory'].includes(a.kind)||typeof a.reason!=='string'||!a.reason.trim()||a.reason.length>1200))fail();
 inspectRestPreservation(original,meshSubset(assembly,before));return {originalMeshes:before.length,additionalMeshes:names,originalRestPreserved:true};
}
export function mountRigAssembly(app,{store,editable,riggingSource,donorFor,runFor,workspace,locked,validateFiles}){
 const upload=multer({storage:multer.memoryStorage(),limits:{files:2,fileSize:150*1024*1024,fields:3}}).fields([{name:'blend',maxCount:1},{name:'glb',maxCount:1}]);
 app.post('/api/projects/:id/rigging/refinement/runs/:runId/assembly',upload,async(req,res)=>{
  const p=store.get(req.params.id);editable(p);await locked(p,async()=>{
   const r=runFor(p,req.params.runId),source=riggingSource(p),donor=donorFor(p);
   if(r.sourcePlacementId!==source?.id||r.donorId!==donor?.id||(r.version?req.body.expectedVersion!==r.version:!!req.body.expectedVersion))fail();
   const blend=req.files?.blend?.[0]?.buffer,glb=req.files?.glb?.[0]?.buffer;let additions;
   try{additions=JSON.parse(req.body.additions);}catch{fail();}
   if(req.body.confirm!=='true'||!blend||blend.subarray(0,7).toString()!=='BLENDER'||!glb)fail();
   const original=await store.read(p,source.preview),sourceBlend=await store.read(p,source.blend),audit=validateAssemblyRest(original,glb,additions),digests={blend:hash(blend),glb:hash(glb)};
   if(r.assembly&&JSON.stringify(r.assembly.hashes)===JSON.stringify(digests)&&JSON.stringify(r.assembly.additions)===JSON.stringify(additions)){res.json({assembly:r.assembly,reused:true});return;}
   let directory,validation;
   try{
    if(validateFiles)validation=await validateFiles({sourceBlend,blend,glb,additions});
    else{
     directory=await fs.mkdtemp(path.join(os.tmpdir(),'fita-rig-assembly-'));
     const job={source:path.join(directory,'original.blend'),input:path.join(directory,'assembly.blend'),preview:path.join(directory,'assembly.glb'),additions:additions.map(a=>a.name),report:path.join(directory,'report.json')};
     for(const [file,bytes] of [[job.source,sourceBlend],[job.input,blend],[job.preview,glb]])await fs.writeFile(file,bytes);
     const jobFile=path.join(directory,'job.json');await fs.writeFile(jobFile,JSON.stringify(job));const executable=await findBlender();if(!executable)fail();
     await runBlender(executable,jobFile,()=>{},'validate_rig_assembly.py');validation=JSON.parse(await fs.readFile(job.report,'utf8'));
    }
    if(validation?.pairVerified!==true||validation.originalEditablePreserved!==true)fail();
    const check=()=>{if(store.get(p.id)!==p||riggingSource(p)?.id!==source.id||donorFor(p)?.id!==donor.id)fail();};check();
    const next=structuredClone(p),staged=[];
    try{
     const savedBlend=await store.asset(next,blend,'blend','Rig assembly with approved additions');staged.push(savedBlend);
     const savedGlb=await store.asset(next,glb,'glb','Rig assembly with approved additions');staged.push(savedGlb);check();
     const assembly={schema:'fita-rig-assembly/v1',additions,hashes:digests,blend:savedBlend,glb:savedGlb,validation:{...audit,...validation},createdAt:new Date().toISOString()};
     const entry=next.rigRefinements.find(x=>x.id===r.id);
     // A later export can reserve a previously added garment. Keep its prior
     // assembly and rig version, and require the caller's exact current version.
     if(r.assembly)(entry.assemblyHistory||=[]).push({assembly:r.assembly,rigVersion:r.version||null,replacedAt:assembly.createdAt});
     entry.assembly=assembly;
     try{await store.save(next);}catch(error){if(store.get(p.id)===next)store.projects.set(p.id,p);throw error;}
     staged.length=0;res.json({assembly});
    }finally{for(const a of staged)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});}
   }finally{if(directory)await fs.rm(directory,{recursive:true,force:true});}
  });
 });
}
export async function assemblySource(store,p,run,source){
 if(!run.assembly)return {glb:await store.read(p,source.preview),blend:await store.read(p,source.blend)};
 const a=run.assembly,glb=await store.read(p,a.glb),blend=await store.read(p,a.blend);
 if(hash(glb)!==a.hashes.glb||hash(blend)!==a.hashes.blend)fail();
 validateAssemblyRest(await store.read(p,source.preview),glb,a.additions);return {glb,blend};
}

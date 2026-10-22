import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import multer from 'multer';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {findBlender,runBlender,placementCurrent} from './placement.js';
const fail=()=>{throw Object.assign(Error('PLACEMENT_LIP_PATCH_INVALID'),{status:409});};
export function mountLipRepair(app,{store,editable,presentProject,execute=runBlender,blenderPath=findBlender}){
 const locks=new Set(),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:24*1024*1024,files:1,fieldSize:2*1024*1024}});
 app.post('/api/projects/:id/placement/repair-lips',upload.single('image'),async(req,res)=>{
  const p=store.get(req.params.id);editable(p);
  const source=p.placements?.find(r=>r.id===req.body.placementId),latest=[...p.placements||[]].reverse().find(r=>r.status==='succeeded'&&placementCurrent(p,r));
  let patch;try{patch=JSON.parse(req.body.patch);}catch{fail();}
  if(locks.has(p.id)||!source?.blend||latest?.id!==source.id||source.lipPatch||req.body.reviewed!=='true'||!req.file||patch?.schema!=='workbench-local-face-uv/v1')fail();
  locks.add(p.id);const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lip-repair-')),assets=[];
  try{
   const meta=await sharp(req.file.buffer,{limitInputPixels:16777216}).metadata();if(meta.format!=='png'||meta.pages>1||meta.width!==meta.height||meta.width<512||meta.width>4096||meta.space!=='srgb')fail();
   const executable=await blenderPath();if(!executable)throw Error('PLACEMENT_BLENDER_NOT_FOUND');
   const job={input:path.join(dir,'source.blend'),blend:path.join(dir,'repaired.blend'),glb:path.join(dir,'repaired.glb'),report:path.join(dir,'report.json'),image:path.join(dir,'lips.png'),patch};
   await fs.writeFile(job.input,await store.read(p,source.blend));await fs.writeFile(job.image,req.file.buffer);
   const file=path.join(dir,'job.json');await fs.writeFile(file,JSON.stringify(job));await execute(executable,file,()=>{},'repair_lip_uv.py');
   const report=JSON.parse(await fs.readFile(job.report,'utf8'));if(!report.lipRegistrationRepaired||!report.geometryPreserved||!report.unselectedUvAndOriginalAtlasPreserved||report.overlappingTexels!==0)fail();
   const check=()=>{if(store.get(p.id)!==p||!placementCurrent(p,source))fail();editable(p);};check();
   const next=structuredClone(p),asset=async(bytes,ext)=>{const a=await store.asset(next,bytes,ext,'Reviewed local lip correction');assets.push(a);return a;};
   const blend=await asset(await fs.readFile(job.blend),'blend'),preview=await asset(await fs.readFile(job.glb),'glb'),image=await asset(req.file.buffer,'png');check();
   const run={...source,id:randomUUID(),source:'lip-repair',parentPlacementId:source.id,blend,preview,renders:{},packageHash:undefined,createdAt:new Date().toISOString(),completedAt:new Date().toISOString(),lipPatch:{patch,image},report:{...report,reviewRequired:true,lipRepair:report,artistReview:{scope:'Local lip UV/albedo registration checked against mouth geometry in five views.',artistApprovalPending:true}}};
   next.placements.push(run);await store.save(next);assets.length=0;res.json({run,project:presentProject(next)});
  }finally{locks.delete(p.id);await fs.rm(dir,{recursive:true,force:true});for(const a of assets)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});}
 });
}

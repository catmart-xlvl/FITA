import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {findBlender,runBlender,placementCurrent} from './placement.js';
import {scleraPatches} from './sclera-patches.js';
const fail=()=>{throw Object.assign(Error('PLACEMENT_SCLERA_PATCH_INVALID'),{status:409});};
export function mountScleraRepair(app,{store,editable,presentProject,execute=runBlender,blenderPath=findBlender}){
 const locks=new Set();
 app.post('/api/projects/:id/placement/repair-sclera',async(req,res)=>{
  const p=store.get(req.params.id);editable(p);
  const source=p.placements?.find(r=>r.id===req.body.placementId);
  const latest=()=>[...p.placements||[]].reverse().find(r=>r.status==='succeeded'&&r.blend&&placementCurrent(p,r));
  if(locks.has(p.id)||!source?.blend||source!==latest()||!['workbench-sclera-repair/v1','workbench-sclera-repair/v2'].includes(req.body.patch?.schema)||req.body.reviewed!==true)fail();
  locks.add(p.id);const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sclera-repair-')),assets=[];
  try{
   const executable=await blenderPath();if(!executable)throw Error('PLACEMENT_BLENDER_NOT_FOUND');
   const job={input:path.join(dir,'source.blend'),blend:path.join(dir,'repaired.blend'),glb:path.join(dir,'repaired.glb'),report:path.join(dir,'report.json'),patch:req.body.patch};
   await fs.writeFile(job.input,await store.read(p,source.blend));const jobfile=path.join(dir,'job.json');await fs.writeFile(jobfile,JSON.stringify(job));await execute(executable,jobfile,()=>{},'repair_sclera.py');
   const report=JSON.parse(await fs.readFile(job.report,'utf8'));if(!report.interiorsRebuilt||!report.neckShouldersTrapeziusPreserved||!report.irisLashesBrowsPreserved)fail();
   if(store.get(p.id)!==p||source!==latest())fail();editable(p);
   const next=structuredClone(p),blend=await store.asset(next,await fs.readFile(job.blend),'blend','Reviewed sclera repair');assets.push(blend);
   const preview=await store.asset(next,await fs.readFile(job.glb),'glb','Reviewed sclera repair');assets.push(preview);
   if(store.get(p.id)!==p||source!==latest())fail();editable(p);
   const run={...source,id:randomUUID(),source:'sclera-repair',parentPlacementId:source.id,blend,preview,renders:{},packageHash:undefined,createdAt:new Date().toISOString(),completedAt:new Date().toISOString(),report:{...report,reviewRequired:true,scleraRepair:report,artistReview:{scope:'Rebuilt reviewed eye interiors with white sclera; previous placement preserved.',artistApprovalPending:true}},scleraPatch:req.body.patch};
   run.scleraPatches=[...scleraPatches(source),req.body.patch];
   next.placements.push(run);await store.save(next);assets.length=0;res.json({run,project:presentProject(next)});
  }finally{locks.delete(p.id);await fs.rm(dir,{recursive:true,force:true});for(const a of assets)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});}
 });
}

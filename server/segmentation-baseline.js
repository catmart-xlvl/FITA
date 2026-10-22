import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {segmentationSourceIdentity,currentSegmentationBaseline} from './segmentation-identity.js';
import {selectedSource} from './texture-workflow.js';
import {glbBuffer} from './validation.js';
import {segFail as fail} from './segmentation-files.js';
export async function importSegmentationBaseline({p,store,runner,buffer,input,check}){
 const identity=segmentationSourceIdentity(p),digest=createHash('sha256').update(buffer||Buffer.alloc(0)).digest('hex');
 if(input?.sourceIdentity!==identity||input.confirm!==true)fail('SEG_INPUTS_CHANGED');
 if(!buffer||buffer.subarray(0,7).toString()!=='BLENDER')fail('SEG_PACKAGE_INVALID');
 const existing=currentSegmentationBaseline(p);if(existing?.digest===digest)return existing;
 if(!['front','left','right'].every(v=>input.review?.views?.includes(v))||!input.review.referenceFront||!input.review.referenceLeft||!input.review.referenceRight||!input.review.findings)fail('SEG_BASELINE_REVIEW_REQUIRED');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-baseline-')),staged=[];let committed=false;
 try{
  const job={sources:{},inputBlend:path.join(dir,'input.blend'),directory:dir};
  for(const part of ['head','body']){job.sources[part]=path.join(dir,part+'-original.glb');await fs.writeFile(job.sources[part],await store.read(p,selectedSource(p,part)));}
  await fs.writeFile(job.inputBlend,buffer);const file=path.join(dir,'job.json');await fs.writeFile(file,JSON.stringify(job));
  await runner('baseline',file);check();if(identity!==segmentationSourceIdentity(p))fail('SEG_INPUTS_CHANGED');
  const report=JSON.parse(await fs.readFile(path.join(dir,'baseline-validation.json'),'utf8'));
  if(!report.topologyPreserved||!report.outsideNeckPreserved||!report.headLocalShapePreserved||!report.independentParts)fail('SEG_BASELINE_INVALID');
  const save=async(b,ext,label)=>{const a=await store.asset(p,b,ext,label);staged.push(a);return a;},sources={};
  for(const part of ['head','body'])sources[part]=await save(glbBuffer(await fs.readFile(path.join(dir,part+'-baseline.glb'))),'glb','Pretexture aligned '+part);
  const blend=await save(buffer,'blend','Pretexture baseline');check();if(identity!==segmentationSourceIdentity(p))fail('SEG_INPUTS_CHANGED');
  const baseline={id:randomUUID(),sourceIdentity:identity,digest,sources,blend,validation:report,review:input.review,reviewRequired:true,createdAt:new Date().toISOString()},previous=p.segmentationBaseline;
  p.segmentationBaseline=baseline;
  try{await store.save(p);}catch(e){p.segmentationBaseline=previous;throw e;}
  committed=true;return baseline;
 }finally{if(!committed)for(const a of staged)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}
}

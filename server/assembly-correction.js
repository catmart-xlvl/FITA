import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {currentSegmentation} from './segmentation-identity.js';
import {currentTexture,inspectTextureGlb} from './texture-workflow.js';
import {segFail as fail} from './segmentation-files.js';

export async function correctAssembly({p,store,runner,buffer,input,check}){
 const s=currentSegmentation(p),previous=s?.reconstruction;
 if(!previous?.blend||input?.segmentationId!==s.id||input.parentBlendId!==previous.blend.id||input.confirm!==true)fail('SEG_INPUTS_CHANGED');
 if(!buffer||buffer.subarray(0,7).toString()!=='BLENDER')fail('SEG_PACKAGE_INVALID');
 if(!['front','left','right'].every(v=>input.review?.views?.includes(v))||!input.review.findings)fail('SEG_BASELINE_REVIEW_REQUIRED');
 const originals=['head','body'].map(g=>currentTexture(p,g));
 if(originals.some(t=>!t||!previous.textureIds.includes(t.id)))fail('SEG_INPUTS_CHANGED');
 const digest=createHash('sha256').update(buffer).digest('hex'),revisionId=randomUUID();
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-assembly-')),staged=[];
 const unchanged=()=>{check();if(currentSegmentation(p)!==s||s.reconstruction!==previous||originals.some(t=>currentTexture(p,t.group)?.id!==t.id))fail('SEG_INPUTS_CHANGED');};
 try{
  const job={directory:dir,sourceBlend:path.join(dir,'source.blend'),inputBlend:path.join(dir,'input.blend')};
  await fs.writeFile(job.sourceBlend,await store.read(p,previous.blend));await fs.writeFile(job.inputBlend,buffer);
  const jobFile=path.join(dir,'job.json');await fs.writeFile(jobFile,JSON.stringify(job));
  await runner('correct_assembly',jobFile);unchanged();
  const report=JSON.parse(await fs.readFile(path.join(dir,'correction.json'),'utf8'));
  if(!report.uvPreserved||!report.materialsPreserved||!report.topologyPreserved||!report.independentParts||!report.outsideNeckPreserved||!report.headLocalShapePreserved||!report.savedAndReopened)fail('SEG_GEOMETRY_CHANGED');
  const save=async(bytes,ext,label)=>{const a=await store.asset(p,bytes,ext,label);staged.push(a);return a;},textures=[];
  for(const original of originals){const bytes=await fs.readFile(path.join(dir,original.group+'-corrected.glb'));inspectTextureGlb(bytes);textures.push({...original,...await save(bytes,'glb','Corrected textured assembly'),parentTextureId:original.id,assemblyCorrectionId:revisionId});}
  const blend=await save(await fs.readFile(path.join(dir,'corrected.blend')),'blend','Corrected textured assembly');unchanged();
  const oldTextures=p.textures,oldHistory=s.reconstructionHistory;
  p.textures=[...oldTextures,...textures];s.reconstructionHistory=[...oldHistory||[],structuredClone(previous)];
  s.reconstruction={...previous,blend,textureIds:textures.map(t=>t.id),reviewRequired:true,reviewedAt:undefined,correction:{id:revisionId,parentBlendId:previous.blend.id,digest,report,review:input.review,at:new Date().toISOString()}};
  try{await store.save(p);}catch(e){p.textures=oldTextures;s.reconstruction=previous;s.reconstructionHistory=oldHistory;throw e;}
  staged.length=0;return {reconstruction:s.reconstruction};
 }finally{for(const a of staged)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}
}

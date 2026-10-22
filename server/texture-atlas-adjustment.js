// Deterministic post-finish color maintenance, separate from facial preparation.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {atlasImages,replaceAtlases,verifyTextureLayout} from '../scripts/texture-layout.mjs';
import {placementTexture} from './texture-workflow.js';
import {currentManual} from './manual-placement.js';
import {manualModelInputKey,readManualModelSnapshot} from './manual-model-snapshot.js';
import {replaceManualModelFiles} from './manual-model-files.js';
import {findBlender,runBlender} from './placement.js';
import {reservePlacement,assertPlacementEditing} from './placement-state.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{status:409});};

export async function adjustAtlasSaturation(bytes,factor){
 if(typeof factor!=='number'||!Number.isFinite(factor)||factor<0||factor>1)fail('ATLAS_INVALID_SATURATION');
 const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 for(let i=0;i<data.length;i+=4){const peak=Math.max(data[i],data[i+1],data[i+2]);for(let c=0;c<3;c++)data[i+c]=Math.round(peak-factor*(peak-data[i+c]));}
 return sharp(data,{raw:info}).png().toBuffer();
}
export function replaceMatchingAtlases(saved,originals,replacements){
 const images=atlasImages(saved),mapped=new Map();
 for(const [index,bytes]of replacements){const matches=images.filter(im=>im.sha256===originals[index].sha256);if(!matches.length)fail('ATLAS_SAVED_IMAGE_NOT_FOUND');for(const im of matches)mapped.set(im.index,bytes);}
 return replaceAtlases(saved,mapped);
}
export function mountTextureAtlasAdjustment(app,{store,editable,execute=runBlender,blenderPath=findBlender}){
 const locks=new Set();
 app.post('/api/projects/:id/texture-refinement/adjust-atlases',async(req,res)=>{
  const p=store.get(req.params.id);editable(p);assertPlacementEditing(p);
  const source=placementTexture(p,'head'),manual=currentManual(p),edits=req.body.edits;
  if(locks.has(p.id))fail('ATLAS_ADJUSTMENT_BUSY');
  if(!source||source.id!==req.body.sourceId||!manual||manual.id!==req.body.manualId||p.manualPlacementDraft)fail('PLACEMENT_SOURCE_CHANGED');
  if(!Array.isArray(edits)||!edits.length||edits.length>16||new Set(edits.map(e=>e.index)).size!==edits.length||edits.some(e=>!Number.isInteger(e.index)||e.index<0||typeof e.saturation!=='number'||!Number.isFinite(e.saturation)||e.saturation<0||e.saturation>1))fail('ATLAS_INVALID_SATURATION');
  const run=(p.textureRefinements||[]).find(r=>r.id===source.refinementId&&!r.reviewRequired);if(!run)fail('REFINE_REVIEW_REQUIRED');
  const release=reservePlacement(store,p.id);locks.add(p.id);let dir;const staged=[];
  const check=()=>{editable(p);assertPlacementEditing(p);if(store.get(p.id)!==p||placementTexture(p,'head')!==source||currentManual(p)!==manual||p.manualPlacementDraft)fail('PLACEMENT_SOURCE_CHANGED');};
  try{
   const original=await store.read(p,source),images=atlasImages(original),replacements=new Map();
   for(const e of edits){if(!images[e.index]?.editable)fail('ATLAS_PROTECTED_IMAGE');replacements.set(e.index,await adjustAtlasSaturation(images[e.index].bytes,e.saturation));}
   const corrected=replaceAtlases(original,replacements);verifyTextureLayout(original,corrected);
   const saved=await readManualModelSnapshot(store,p,manual),glb=replaceMatchingAtlases(saved['approved.glb'],images,replacements);verifyTextureLayout(saved['approved.glb'],glb);
   dir=await fs.mkdtemp(path.join(os.tmpdir(),'fita-atlas-'));
   const inputBlend=path.join(dir,'input.blend'),outputBlend=path.join(dir,'output.blend'),reportFile=path.join(dir,'report.json');
   await fs.writeFile(inputBlend,saved['approved.blend']);const jobImages=[];
   for(const [index,bytes]of replacements){const filename=path.join(dir,index+'.png');await fs.writeFile(filename,bytes);jobImages.push({sha256:images[index].sha256,path:filename});}
   const job=path.join(dir,'job.json');await fs.writeFile(job,JSON.stringify({inputBlend,outputBlend,report:reportFile,images:jobImages}));
   const executable=await blenderPath();if(!executable)fail('PLACEMENT_BLENDER_NOT_FOUND');
   await execute(executable,job,()=>{},'replace_saved_atlases.py');
   const blend=await fs.readFile(outputBlend),report=JSON.parse(await fs.readFile(reportFile,'utf8'));
   if(!report.geometryUvNormalsWeightsTransformsPreserved||report.before!==report.after)fail('ATLAS_SAVED_GEOMETRY_CHANGED');check();
   const next=structuredClone(p),adjustmentId=randomUUID(),refinementId=randomUUID(),manualId=randomUUID();
   const stage=async(bytes,ext,label)=>{const a=await store.asset(next,bytes,ext,label);staged.push(a);return a;};
   const asset=await stage(corrected,'glb','Local texture saturation adjustment');
   const backups={blend:await stage(saved['approved.blend'],'blend','Before texture saturation adjustment'),preview:await stage(saved['approved.glb'],'glb','Before texture saturation adjustment')};
   const texture={...source,...asset,refinedFrom:source.id,refinementId,atlasAdjustmentId:adjustmentId};next.textures.push(texture);
   const correction={id:adjustmentId,sourceId:source.id,manualId:manual.id,edits,report,savedModelBackups:backups,createdAt:new Date().toISOString()};
   (next.textureAtlasAdjustments||=[]).push(correction);
   const ids=run.textureIds.map(id=>id===source.id?texture.id:id);
   next.textureRefinements.push({...run,id:refinementId,textureIds:ids,createdAt:correction.createdAt,inheritedFrom:run.id,reviewRequired:run.reviewRequired,report:{...run.report,atlasAdjustment:correction},changedAtlases:edits.length});
   const sources={...manual.sources,head:texture.id};
   next.manualPlacement={...manual,id:manualId,sources};
   const sourceHashes={...manual.modelSnapshot.sourceHashes,head:hash(corrected)};
   await replaceManualModelFiles(store,p,manualId,{blend,glb},manual.modelSnapshot,async assets=>{
    check();next.manualModelStorage=assets;
    next.manualPlacement.modelSnapshot={...manual.modelSnapshot,...assets,inputKey:manualModelInputKey(next),sourceHashes,blendSha256:hash(blend),glbSha256:hash(glb),textureUpdatedAt:correction.createdAt};
    if(next.placementHandoff)next.placementHandoff={...next.placementHandoff,status:'cancelled'};
    await store.save(next);
   });
   staged.length=0;res.json({status:'updated',projectId:p.id,adjustmentId,textureId:texture.id,manualId,edits,geometryPreserved:true,savedModelUpdated:true,bodyUnchanged:true,report});
  }finally{
   locks.delete(p.id);release();
   for(const a of staged)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});
   if(dir&&path.dirname(dir)===path.resolve(os.tmpdir()))await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
 });
}

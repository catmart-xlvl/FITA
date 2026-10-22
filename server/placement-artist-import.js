import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {currentManual} from './manual-placement.js';
import {readManualModelSnapshot,manualModelInputKey} from './manual-model-snapshot.js';
import {assertPlacementEditing,reservePlacement} from './placement-state.js';
import {inspectTextureGlb} from './texture-workflow.js';
import {event} from './storage.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{status:409});};

// Artist imports establish a NEW baseline. They never weaken the preservation
// checks on an existing Codex handoff or reuse a cancelled delivery manifest.
export function mountPlacementArtistImport(app,{store,editable,presentProject,execute,blenderPath,validateFiles}){
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:150*1024*1024,files:2,fields:4}}).fields([{name:'blend',maxCount:1},{name:'glb',maxCount:1}]);
 app.post('/api/projects/:id/placement/artist-import',upload,async(req,res)=>{
  const p=store.get(req.params.id),release=reservePlacement(store,p.id),staged=[];let directory;
  try{
   editable(p);assertPlacementEditing(p);
   const previous=currentManual(p),inputKey=manualModelInputKey(p),epoch=p.workflowEpoch||0;
   if(req.body.confirm!=='true'||!previous||req.body.baseApprovalId!==previous.id||Number(req.body.workflowEpoch)!==epoch||p.manualPlacementDraft)fail('PLACEMENT_SOURCE_CHANGED');
   const blend=req.files?.blend?.[0]?.buffer,glb=req.files?.glb?.[0]?.buffer;
   if(!blend||blend.subarray(0,7).toString()!=='BLENDER'||!glb)fail('PLACEMENT_INVALID_RESULT');
   inspectTextureGlb(glb);await readManualModelSnapshot(store,p,previous);
   const check=()=>{editable(p);assertPlacementEditing(p);if(store.get(p.id)!==p||currentManual(p)?.id!==previous.id||manualModelInputKey(p)!==inputKey||(p.workflowEpoch||0)!==epoch||p.manualPlacementDraft)fail('PLACEMENT_SOURCE_CHANGED');};
   let files;
   if(validateFiles)files=await validateFiles({blend,glb,heightCm:previous.heightCm});
   else{
    const executable=await blenderPath();if(!executable)fail('PLACEMENT_BLENDER_NOT_FOUND');
    directory=await fs.mkdtemp(path.join(os.tmpdir(),'fita-artist-import-'));
    const job={input:path.join(directory,'input.blend'),preview:path.join(directory,'input.glb'),blend:path.join(directory,'placed.blend'),glb:path.join(directory,'placed.glb'),report:path.join(directory,'report.json'),heightCm:previous.heightCm};
    await fs.writeFile(job.input,blend);await fs.writeFile(job.preview,glb);const jobFile=path.join(directory,'job.json');await fs.writeFile(jobFile,JSON.stringify(job));
    await execute(executable,jobFile,()=>{},'import_artist_model.py');
    files={blend:await fs.readFile(job.blend),glb:await fs.readFile(job.glb),report:JSON.parse(await fs.readFile(job.report,'utf8'))};
   }
   check();inspectTextureGlb(files.glb);
   if(files.blend.subarray(0,7).toString()!=='BLENDER'||files.report.schema!=='fita-artist-model-import/v1'||files.report.pairVerified!==true||files.report.reviewRequired!==true)fail('PLACEMENT_INVALID_RESULT');
   const next=structuredClone(p),manualId=randomUUID(),importId=randomUUID(),at=new Date().toISOString();
   const save=async(bytes,ext)=>{const asset=await store.asset(next,bytes,ext,'Artist Blender edit');staged.push(asset);return asset;};
   const savedBlend=await save(files.blend,'blend'),preview=await save(files.glb,'glb');check();
   (next.artistModelImports||=[]).push({id:importId,previousManual:structuredClone(previous),previousHandoff:next.placementHandoff||null,sourceHashes:{blend:hash(blend),glb:hash(glb)},createdAt:at});
   const snapshot={...previous.modelSnapshot,blend:savedBlend,preview,blendSha256:hash(files.blend),glbSha256:hash(files.glb),inputKey,createdAt:at};
   next.manualPlacement={...previous,id:manualId,approvedAt:at,externalEditing:true,modelSnapshot:snapshot};next.manualModelStorage={blend:savedBlend,preview};delete next.manualPlacementDraft;
   const run={id:importId,source:'artist-import',status:'succeeded',manualPlacementId:manualId,sources:previous.sources,sourceHashes:snapshot.sourceHashes,preview,blend:savedBlend,report:files.report,createdAt:at,completedAt:at};
   (next.placements||=[]).push(run);next.placementHandoff={id:randomUUID(),source:'artist-import',status:'imported',manualId,importId,workflowEpoch:epoch,createdAt:at,completedAt:at,lastError:null};
   event(next,'Malla y texturas editadas en Blender importadas como nueva versión. Se conserva el modelo anterior para recuperación.');
   try{await store.save(next);}catch(error){if(store.get(p.id)===next)store.projects.set(p.id,p);throw error;}staged.length=0;
   res.json({status:'imported',importId,manual:next.manualPlacement,run,project:presentProject(next)});
  }finally{
   for(const asset of staged)await fs.unlink(path.join(store.root,p.id,asset.id)).catch(()=>{});
   if(directory)await fs.rm(directory,{recursive:true,force:true});release();
  }
 });
}

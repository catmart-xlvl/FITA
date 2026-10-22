import {localInstructionPackage} from './local-instruction-package.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {zipBuffers} from './codex-handoff.js';
import {placementCurrent} from './placement.js';
import {currentManual} from './manual-placement.js';
import {inspectTextureGlb} from './texture-workflow.js';
import {inspectRiggedGlb,inspectRestPreservation} from './rigging-validation.js';
import {mountRigRefinement} from './rig-refinement.js';
import {inspectRigConnectivity} from './rig-connectivity.js';
import {validateEditableRigConnectivity} from './rig-connectivity-blender.js';

const templateRoot=fileURLToPath(new URL('../templates/rigs/humanoid-v1/',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
export function riggingSource(p){
  const manual=currentManual(p);
  if(manual?.modelSnapshot?.storage==='single'&&(p.manualPlacementDraft||p.placementHandoff?.status!=='imported'))return null;
  return [...p.placements||[]].reverse().find(r=>r.status==='succeeded'&&r.preview&&r.blend&&placementCurrent(p,r)&&(!manual||r.manualPlacementId===manual.id));
}
const workspaceRoot=store=>path.join(path.dirname(store.root),'projects');
const directory=(store,p,run)=>path.join(workspaceRoot(store),p.id,'rigging',run.id);
async function readBounded(file,limit){const stat=await fs.lstat(file).catch(()=>null);if(!stat||!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)fail('Save rigged.glb, rigged.blend, manifest.json and report.json in the output folder first.');return fs.readFile(file);}
function instructions(manifest,workspace){return `FITA HUMANOID RIGGING — LOCAL HANDOFF

Workspace: ${workspace}
Read manifest.json. Work only on copies in this workspace. The model is already assembled and textured. Open input/model.blend in Blender, then append WB_Humanoid from input/template.blend. The template is a prototype, not a fitted rig. No paid generation is needed.
Use the connected editable meshes in model.blend, not raw GLB seam copies. Preserve the _workbench_vertex POINT identities and their connections; transfer weights once per source vertex. Export GLB with export_attributes=True. Copies of one source vertex must have identical weights and morph deltas. The app checks both the GLB and the editable Blender topology.

1. Inspect the character from front, both sides and back. Fit every joint in Edit Mode to this character: hips, spine, neck, shoulders, elbows, wrists, fingers, knees, ankles, eyes and jaw if appropriate. Review asymmetry and silhouette; do not just rescale the template. Preserve the mapped names and anatomical parents. Optional eyes/jaw may be omitted when unsuitable. Read input/profile.json. Do not insert auxiliary bones into the main Humanoid chains.
2. Recompute auxiliary bone rest orientation/roll after fitting. The Blender template includes prototype axial torsion drivers; verify their axes and quaternion behavior on this fitted character. Keep a portable rotation recipe; drivers and constraints do not automatically transfer to game engines. Secondary chains for hair/clothing are per-character: create only meaningful chains with weights and a separate runtime recipe. Do not put physics on the core humanoid joints.
3. Create the Armature modifiers and individual weights for ALL renderable parts, including hair, clothing and independent eye pieces. Rigid parts can have one influence. Start with automatic weights or transfer where appropriate, then inspect/correct shoulders, elbows, wrists, hips and knees. Max four nonzero influences per vertex, sum one, no unweighted vertices. Do not remesh, move the approved rest geometry, change UVs, textures or materials. Extra facial shape keys are a later task; do not manufacture tracking guarantees.
4. Test arm raise, elbow bend, wrist twist, squat and knee bend in Blender. Check weight spill across neighboring clothing/limbs, volume and collisions. Record actual findings and remaining limitations. The web application provides its own diagnostic animation; no external animation or Mixamo account is required.
5. Reset to the fitted rest pose and save output/rigged.blend. Export output/rigged.glb with the complete model, skin, embedded textures and stable WB_ bone names. Use standard glTF without Draco/KTX2; include the deforming auxiliary bones. Blender driver behavior needs a portable adapter or baking and is not proof of runtime support. Do not overwrite any input, app data or another project.
6. Copy manifest.json UNCHANGED into output/manifest.json. Write output/report.json with schema "workbench-rigging-review/v1", reviewRequired: true, jointsReviewed: true, weightsReviewed: true, preservationReviewed: true, observations (array of findings), limitations (array). These fields record the review you actually performed; never claim a hardware/VRChat test that was not run.
7. Return to Rigging in FITA and use “Load rigged result”. The application validates the local output and keeps the original files. A successful import means skin data is present; Unity Humanoid, retarget, physics and real trackers still need their own destination tests.

Project: ${manifest.projectName}
Template: ${manifest.template.id}
Source placement: ${manifest.source.placementId}
`;}

export function mountRigging(app,{store,editable,bridge}){
  mountRigRefinement(app,{store,editable,bridge,riggingSource});
  const locks=new Set();
  async function locked(p,fn){if(locks.has(p.id))fail('Rigging workspace is being prepared. Try again shortly.');locks.add(p.id);try{return await fn();}finally{locks.delete(p.id);}}
  async function state(p){
    const source=riggingSource(p),profileBytes=await fs.readFile(path.join(templateRoot,'profile.json')),profile=JSON.parse(profileBytes);
    return {eligible:!!source,source:source?{id:source.id,preview:source.preview}:null,
      template:{id:profile.id,bones:profile.bones.length,humanoidBones:profile.bones.filter(b=>b.role==='humanoid').length,twistBones:profile.twistRecipes.length,url:'/api/rigging/template/template.glb'},
      runs:(p.riggingRuns||[]).map(r=>({...r,current:r.sourcePlacementId===source?.id&&r.templateHash===hash(profileBytes),workspace:directory(store,p,r),preview:r.resultHash?{url:`/api/projects/${p.id}/rigging/runs/${r.id}/rigged.glb?version=${r.version}`}:null}))};
  }
  app.get('/api/rigging/template/:file',(req,res)=>{if(!['template.glb','template.blend','profile.json'].includes(req.params.file))fail('Rig template file not found.',404);res.sendFile(path.join(templateRoot,req.params.file));});
  app.get('/api/projects/:id/rigging',async(req,res)=>res.json(await state(store.get(req.params.id))));
  app.post('/api/projects/:id/rigging/prepare',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);
    await locked(p,async()=>{
      const source=riggingSource(p);if(!source)fail('Finish placement before preparing the rigging workspace.');
      const profile=await fs.readFile(path.join(templateRoot,'profile.json'));
      const templateHash=hash(profile);
      if((p.riggingRuns||[]).some(r=>r.sourcePlacementId===source.id&&r.templateHash===templateHash)){res.json(await state(p));return;}
      const preview=await store.read(p,source.preview),blend=await store.read(p,source.blend);
      const sourceHashes={glb:hash(preview),blend:hash(blend)};
      const run={id:randomUUID(),status:'awaiting-codex',sourcePlacementId:source.id,templateHash,createdAt:new Date().toISOString()};
      const workspace=directory(store,p,run),manifest={schema:'workbench-rigging-handoff/v1',runId:run.id,projectId:p.id,projectName:p.name,
        source:{placementId:source.id,previewId:source.preview.id,blendId:source.blend.id,hashes:sourceHashes},template:{id:'wb-humanoid-v1',sha256:templateHash},workspace};
      await fs.mkdir(path.join(workspace,'input'),{recursive:true});await fs.mkdir(path.join(workspace,'output'));await fs.mkdir(path.join(workspace,'reports'));
      for(const [name,bytes] of Object.entries({'model.glb':preview,'model.blend':blend,'profile.json':profile,'template.blend':await fs.readFile(path.join(templateRoot,'template.blend'))}))await fs.writeFile(path.join(workspace,'input',name),bytes);
      const referenceFiles=[];
      if(p.reference){await fs.writeFile(path.join(workspace,'input','concept.png'),await store.read(p,p.reference));referenceFiles.push('concept.png');}
      for(const [name,asset] of Object.entries(source.references||{})){await fs.writeFile(path.join(workspace,'input','reference_'+name+'.png'),await store.read(p,asset));referenceFiles.push('reference_'+name+'.png');}
      manifest.references=referenceFiles;
      await fs.writeFile(path.join(workspace,'manifest.json'),JSON.stringify(manifest,null,2));
      await fs.writeFile(path.join(workspace,'INSTRUCTIONS.txt'),instructions(manifest,workspace));
      if(store.get(p.id)!==p||riggingSource(p)?.id!==source.id)fail('The placement changed. Prepare a new rigging workspace.');
      editable(p);const next=structuredClone(p);(next.riggingRuns||=[]).push(run);await store.save(next);res.json(await state(next));
    });
  });
  function runFor(p,id){const run=p.riggingRuns?.find(r=>r.id===id);if(!run)fail('Rigging run not found.',404);return run;}
  app.get('/api/projects/:id/rigging/runs/:runId/package',async(req,res)=>{
    const p=store.get(req.params.id),run=runFor(p,req.params.runId);if(riggingSource(p)?.id!==run.sourcePlacementId)fail('The placement changed. Prepare a new rigging workspace.');
    const root=directory(store,p,run),files={};for(const file of ['manifest.json','INSTRUCTIONS.txt'])files[file]=await fs.readFile(path.join(root,file));
    res.type('application/zip').attachment('fita_rigging_instructions.zip').send(await localInstructionPackage(store,p,'rigging',files));
  });
  app.post('/api/projects/:id/rigging/runs/:runId/import',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);
    await locked(p,async()=>{
      const run=runFor(p,req.params.runId),source=riggingSource(p);if(source?.id!==run.sourcePlacementId)fail('The placement changed. Prepare a new rigging workspace.');
      const root=directory(store,p,run),output=path.join(root,'output');
      const original=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
      if(original.schema!=='workbench-rigging-handoff/v1'||original.projectId!==p.id||original.runId!==run.id||original.source?.placementId!==source.id||original.template?.sha256!==run.templateHash)fail('The result belongs to another project or source version.');
      const returned=JSON.parse(await readBounded(path.join(output,'manifest.json'),1024*1024));
      if(JSON.stringify(original)!==JSON.stringify(returned))fail('The result belongs to another project or source version.');
      if(hash(await store.read(p,source.preview))!==original.source.hashes.glb||hash(await store.read(p,source.blend))!==original.source.hashes.blend)fail('The placement changed. Prepare a new rigging workspace.');
      const profileBytes=await fs.readFile(path.join(root,'input','profile.json'));
      if(hash(profileBytes)!==run.templateHash)fail('The result belongs to another project or source version.');
      const profile=JSON.parse(profileBytes);
      const bytes=await readBounded(path.join(output,'rigged.glb'),150*1024*1024);
      inspectTextureGlb(bytes);const validation={...inspectRiggedGlb(bytes,profile),...inspectRestPreservation(await store.read(p,source.preview),bytes)};
      const blend=await readBounded(path.join(output,'rigged.blend'),512*1024*1024);if(blend.subarray(0,7).toString()!=='BLENDER')fail('Return an uncompressed editable Blender file.',400);
      Object.assign(validation,inspectRigConnectivity(await store.read(p,source.preview),bytes,{required:source.report?.lockedPlacementValidation?.vertexIdentitiesPreserved===true}));
      if(validation.connectivityChecked)Object.assign(validation,await validateEditableRigConnectivity(await store.read(p,source.blend),blend));
      const report=JSON.parse(await readBounded(path.join(output,'report.json'),1024*1024));
      if(report.schema!=='workbench-rigging-review/v1'||report.reviewRequired!==true||report.jointsReviewed!==true||report.weightsReviewed!==true||report.preservationReviewed!==true||!Array.isArray(report.observations)||!Array.isArray(report.limitations))fail('Return the joint, weight and preservation review in report.json.',400);
      const resultHash=hash(bytes)+':'+hash(blend)+':'+hash(Buffer.from(JSON.stringify(report)));
      if(run.resultHash===resultHash){res.json({...await state(p),duplicate:true});return;}
      // Store immutable reviewed copies; edits in output never silently replace a loaded preview.
      const version=randomUUID(),reviewed=path.join(root,'reports',version);await fs.mkdir(reviewed,{recursive:true});
      await fs.writeFile(path.join(reviewed,'rigged.glb'),bytes);await fs.writeFile(path.join(reviewed,'rigged.blend'),blend);await fs.writeFile(path.join(reviewed,'report.json'),JSON.stringify({report,validation},null,2));
      if(store.get(p.id)!==p||riggingSource(p)?.id!==source.id)fail('The placement changed. Prepare a new rigging workspace.');
      editable(p);const next=structuredClone(p),updated=next.riggingRuns.find(r=>r.id===run.id);
      Object.assign(updated,{status:'needs-review',version,resultHash,validation,completedAt:new Date().toISOString(),report});
      await store.save(next);res.json(await state(next));
    });
  });
  app.get('/api/projects/:id/rigging/runs/:runId/:file',(req,res)=>{
    const p=store.get(req.params.id),run=runFor(p,req.params.runId);if(!run.version||!['rigged.glb','rigged.blend'].includes(req.params.file))fail('Rigged result not found.',404);
    res.sendFile(path.join(directory(store,p,run),'reports',run.version,req.params.file));
  });
}

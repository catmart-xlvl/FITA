import {bodySupportProfile,validateBodyRigReview} from './rig-runtime-validation.js';
import {fileURLToPath} from 'node:url';
import {localInstructionPackage} from './local-instruction-package.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import {randomUUID,createHash} from 'node:crypto';
import {inspectTextureGlb} from './texture-workflow.js';
import {inspectRiggedGlb,inspectRestPreservation} from './rigging-validation.js';
import {inferHumanoidMap,requiredHumanoidRoles} from '../shared/humanoid-map.js';
import {mountStudioRig} from './studio-rig.js';
import {mountManualRig} from './rig-manual.js';
import {mountAvatarDelivery} from './avatar-delivery.js';
import {vrchatPreparationFiles} from './vrchat-preparation-resources.js';
import {inspectRigConnectivity} from './rig-connectivity.js';
import {validateEditableRigConnectivity} from './rig-connectivity-blender.js';
import {mountRigAssembly,assemblySource} from './rig-assembly.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
const auxiliaryProfileFile=new URL('../templates/rigs/auxiliary-v1.json',import.meta.url);
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
const json=b=>JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
export function donorProfile(bytes){
  const validation=inspectRiggedGlb(bytes,null,{baseline:true}),d=json(bytes),joints=new Set(d.skins.flatMap(s=>s.joints)),parents=new Map();
  d.nodes.forEach((n,i)=>n.children?.forEach(c=>parents.set(c,i)));
  const bones=[...joints].map(i=>({name:d.nodes[i].name,parent:joints.has(parents.get(i))?d.nodes[parents.get(i)].name:null}));
  const humanoid=inferHumanoidMap(bones.map(b=>b.name));
  const missing=requiredHumanoidRoles.filter(k=>!humanoid[k]);
  if(missing.length)fail('The donor skeleton has unmapped humanoid joints: '+missing.join(', '),400);
  return {schema:'workbench-donor-rig/v1',humanoid,bones,validation};
}
export function refinementInstructions(m){return `FITA RIG REFINEMENT — ORIGINAL MESH + TRIPO DONOR

Workspace: ${m.workspace}
Project: ${m.projectName}
Change working directory to the exact Workspace above. Every input/, output/, manifest and profile path below is relative to THAT rigging workspace, not the downloaded ZIP or the codex handoff directory. Save the final files in ${m.workspace}/output.
Read manifest.json and input/donor-profile.json. Work only on copies inside this workspace.
Read AUXILIARY_PROFILE.json: humanoid-support-v2 is the fixed support-bone specification. It is saved in the project workspace beside these instructions; UBICACIONES.json gives its exact local path. Do not choose a new auxiliary skeleton for each character.
VRCHAT_PC_HANDOFF.md describes the later destination preparation, including Unity calibration, native auxiliary controls, progressive PhysBones and fitted colliders, Poiyomi Toon anime materials, height and local tests. Read VRCHAT_PC_REFERENCE_PROFILE.json for the measured pilot baseline and known limits, not as universal anatomical constants. Do not run that stage during Rigging unless the user requests it. Fix connected skin weights and their measured deformation here; keep destination T-pose calibration, hierarchy adapters and Unity/VRChat materials in that later stage.

NON-NEGOTIABLE SOURCE ROLES
- input/original.blend and input/original.glb are the approved character. Keep its rest geometry, topology, UVs, textures, materials, separate pieces and facial meshes.
- Open input/original.blend as the authoritative CONNECTED editable mesh. Do not recreate the original by importing raw GLB seam copies. Preserve its _workbench_vertex POINT attribute unchanged; never regenerate, delete or renumber those identities. Paint/transfer weights once per connected source vertex, including support bones. Do not separate by UV islands or materials. GLB seam copies must carry identical weights and morph deltas for each source identity. The app rejects broken editable connectivity and conflicting seam weights.
- input/donor.glb supplies ONLY its complete skeleton, joint placement, hierarchy and starting skin weights. NEVER use its mesh as the final character. Tripo may reorder/weld vertices, quantize positions, rescale or translate the model.
- Do not fit another skeleton from scratch. Do not rename, delete, reparent or individually reposition the donor anatomical joints. Use a single global similarity transform to align the donor to the original. Record this transform and alignment distances. If anatomy differs, stop and report the mismatch instead of distorting the original.

1. Open the original in background Blender; import the donor separately. Inspect both in rest pose. Align their coordinate systems, orientation, scale and origin. Match corresponding parts by name and geometry. Transfer the COMPLETE donor armature and skin weights to the ORIGINAL meshes. Use verified vertex correspondence when possible; otherwise nearest-surface barycentric transfer within the corresponding part (never indiscriminately across hair/body/eyes). Check and report transfer distances. Retain the donor only in a hidden reference collection, excluded from export.
2. Complete the skeleton BEFORE final weight refinement. Apply all 26 fixed body support roles in AUXILIARY_PROFILE.json (13 per side): three upper-arm twist zones, three forearm twist zones, three thigh twist zones, elbow-volume and knee-volume helpers, and one breast and one glute physics-ready anchor per side. These body roles exist on every ordinary humanoid; adapt their fit, not their presence. Reuse verified equivalents and record canonical role -> actual name in runtime.supportBones. Keep donor anatomy unchanged. Then inspect the character and add the necessary hair and clothing chains, adapted to its actual attachments, length, panels and independent moving masses. Inventory every original mesh and justify chains, rigid attachment or following the body. No fixed hairstyle, no universal skirt grid. Physics simulation and expressions are later sections.
3. Refine weights only after ALL fixed and adaptive bones exist. Audit the transferred weights first. Remove opposite-leg and opposite-arm leakage in unambiguous limb regions, including opposite auxiliary bones, without destroying pelvis/crotch transitions or center-spanning garments. Use connected surface topology and explicit anatomical ownership, never x-sign or Euclidean distance alone. Paint overlapping longitudinal support masks for the 25/50/75 percent twist zones and local convex-joint masks for elbow/knee helpers. Smooth shoulders/axilla, hips/groin, elbows, knees and ankles locally; keep chest/pelvis attachment bands, fingers, rigid soles/buckles and separate clothing layers controlled. Fit breast/glute masks with no contralateral leakage; fit hair roots/tips and cloth waistband/hem masks with appropriate body support. Keep separate facial pieces coordinated under Head without adding expressions.
Use the EXISTING helper module ${fileURLToPath(new URL('./blender/rig_weight_exchange.py',import.meta.url))}: import refine_regions(obj, armature, regions, iterations=3, strength=0.35) in background Blender after building the fitted skeleton and initial support/chain weights. Each region supplies name, vertices (connected original mesh indices), allowedBones, fallbackBone, optional lockedVertices (smoothing locks) and smooth:false for rigid parts. Regions must be disjoint; separate protected transitions into their own region. The helper removes disallowed weights, smooths only edge-connected neighbors within the region and prunes/normalizes to four influences. It does not infer anatomy or paint missing helper masks: fit these first. Save its measured audit in report.json. Recheck ownership, silhouette and volume after pruning; repair any artifact instead of declaring automatic smoothing professional quality.
SECONDARY WEIGHT ACCEPTANCE: A named bone, a nonzero vertex count or normalized weights do not prove useful influence. Measure each breast/glute anchor's fitted location, intended connected region, weight range, coverage and resulting surface displacement under small isolated rotations in both directions. Compare left/right only after accounting for actual character asymmetry; investigate unexplained differences. Test after four-influence pruning, which can erase helper influence. Repair ineffective masks or report a failed region; do not hide submillimetre tissue response with a larger Spring value. Use the garment's actual fitted surface where no underlying body exists, protect neckline/waist/medial attachments and coordinate overlapping fitted layers. Do not indiscriminately copy weights to loose cloth.
Protected anatomical attachments do not mean a hard unweighted stripe through the centre of a fitted garment. Define intentional shared transition regions where both nearby tissue helpers may contribute with smooth overlapping masks, while retaining anatomical support. Verify the centre deforms continuously, including after four-weight pruning; inspect short-edge weight jumps and shared-source seam copies. Distinguish this documented shared region from accidental opposite-limb or distant-hair leakage. Never split these maps with a hard x-sign boundary or a fixed-width zero-weight band.
For hair, test each independent mass against an explicitly protected scalp/central-hair region, front locks and the opposite ponytail. Separate chains do not guarantee isolation: inspect residual weights on connected pieces. A source vertex accidentally bound to a distant tip can deform the scalp even if all chains are valid. Keep root transitions intentional, smooth and measured. For skirts, test both moving and stationary crouch/sitting poses; motion-only collision success does not prove static clearance. Record these measured secondaryWeightChecks and evidence in bodyRig.weightAudit without inventing successful values.
4. Do NOT create new corrective shape keys or new face controls in this stage. Body corrective shape keys remain deferred. Facial expressions and visemes belong to their own later section. Existing shape keys, if present in an approved source, must be preserved unchanged. Bone-based elbow and knee correctives from the fixed profile are included now.
5. Run measured before/after poses on the ORIGINAL: each arm and leg separately (detect movement in the opposite unambiguous region), shoulder elevation 0/45/90/120 degrees, elbow and knee bends, upper-arm/forearm/thigh twists in both directions, hip/squat and ankle transitions. Test tissue and hair/clothing chain attachments with small isolated rotations, then reset. Verify root stability, cloth layers and preserved hair normals under deformation. Report the required poseChecks listed in AUXILIARY_PROFILE.json.reviewPoses, with side-specific maxUnintendedDisplacementMeters, passed and evidence paths; define measured protected regions explicitly. Unintended displacement in those protected regions must be at most 0.001 metres; exclude intentional pelvis/torso transitions from that measurement. Save before/after evidence under output/review/. The app provides its own test animations; the GLB needs no animation clips. Avoid open-ended aesthetic iteration in this cleanup stage.
6. Supply output/runtime.json (schema workbench-rig-runtime/v1): humanoid mapping with original bone names, twists array and bone correctives array. Read input/runtime-example.json for formats, but follow the fixed profile's scope: any old shapeCorrective example is not permission to add new shape keys. Axes are in the relevant joint's REST LOCAL frame; distances use the exported target parent's local units. Set auxiliaryProfile:"humanoid-support-v2" and supportBones:{canonicalRole:actualBoneName}. Supply the matching recipe for every twist/volume helper. Declare secondary:[{kind:"breast"|"glute"|"hair"|"clothing",bones:[parentToChildNames],attachment:actualParentBone,meshes:[originalMeshNames],region:description,simulated:false}]. Each fixed tissue anchor is its own single-bone declaration; hair/cloth chains are character-specific. Secondary bones inherit their parent in the viewer, with simulation deferred. Never disguise them as zero-motion twist recipes. Preserve existing recipes for approved existing shape keys only. Blender drivers/constraints do not execute in glTF. Verify recipes against Blender poses; Unity/VRChat adapters remain separate.
7. Reset all poses/morph weights. Export ONLY original meshes with the transferred skeleton, weights, auxiliary bones and any corrective targets to output/rigged.glb (self-contained, no Draco/KTX2). Use export_attributes=True so _WORKBENCH_VERTEX survives UV seam splitting. Save editable output/rigged.blend, uncompressed, with the donor hidden from rendering/export. Keep source files untouched. Preserve original mesh object names in the GLB. Never replace app data or the original project.
8. Copy manifest.json unchanged into output/manifest.json. Write output/report.json: schema workbench-rig-refinement-review/v1, reviewRequired:true, originalMeshPreserved:true, donorMeshExcluded:true, skeletonTransferred:true, weightsReviewed:true, auxiliariesReviewed:true, correctivesReviewed:true, alignment:{matrix:[16 finite numbers, column-major donor world to original world],maxDistanceMeters:number}, observations:[], limitations:[]. Also include bodyRig:{profile:"humanoid-support-v2",stageOrder:["transfer","fixed-body-support","hair-and-clothing-chains","weight-refinement","deformation-review"],meshInventory:[{mesh:originalName,kind:"body"|"face"|"hair"|"clothing"|"accessory",decision:"chains"|"follows-body"|"rigid",reason:description}],weightAudit:{before:{unweightedVertices:number,unnormalizedVertices:number,maxInfluences:number},after:{unweightedVertices:0,unnormalizedVertices:0,maxInfluences:4-or-less},regionChecks:[{mesh:originalName,region:description,allowedBones:[actualNames],removedDisallowedWeight:number}],poseChecks:[{test:requiredTest,side:"L"|"R"|"both",maxUnintendedDisplacementMeters:number,passed:true,evidence:["review/file.png"]}]}}. All original meshes must be inventoried. Use measured values, never fill these with assumed zeros. Missing fixed helpers, unresolved cross-limb leakage or failed pose checks must be repaired before import; report actual limitations honestly. The validator checks structure and evidence presence, not artistic quality.
9. Use Load refined result in Rigging. Import checks data and preservation, not professional quality. Further manual weight work can use Download GLB / Download FBX and Upload edited weights. Humanoid mapping, retargeting, VRChat SDK, PhysBones and tracker performance need destination validation.
When that later VRChat stage is requested, follow VRCHAT_PC_HANDOFF.md. Do not imply this Rigging import executed destination controls or created facial expressions. Do not replace a failed generic rig test with a custom emote and describe the rig as universally fixed.
`;}
export function mountRigRefinement(app,{store,editable,riggingSource,bridge}){
  mountManualRig(app,{store,editable,riggingSource});
  mountAvatarDelivery(app,{store,editable,riggingSource});
  const root='/api/projects/:id/rigging/refinement',locks=new Set(),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:150*1024*1024,files:1}});
  const workspace=(p,r)=>path.join(path.dirname(store.root),'projects',p.id,'rigging',r.id);
  const donorFor=p=>[...(p.rigDonors||[])].reverse().find(d=>d.sourcePlacementId===riggingSource(p)?.id);
  const runFor=(p,id)=>p.rigRefinements?.find(r=>r.id===id)||fail('Rigging run not found.',404);
  async function locked(p,fn){if(locks.has(p.id))fail('Rigging workspace is being prepared. Try again shortly.');locks.add(p.id);try{return await fn();}finally{locks.delete(p.id);}}
  function current(p,source){if(store.get(p.id)!==p||riggingSource(p)?.id!==source.id)fail('The placement changed. Prepare a new rigging workspace.');editable(p);}
  mountRigAssembly(app,{store,editable,riggingSource,donorFor,runFor,workspace,locked});
  function state(p){const source=riggingSource(p),donor=donorFor(p);return {eligible:!!source,source,donor,studio:bridge?.status(),studioJob:publicStudioJob(p),runs:(p.rigRefinements||[]).map(r=>({...r,current:r.sourcePlacementId===source?.id&&r.donorId===donor?.id,workspace:workspace(p,r),preview:r.version?{url:`${root.replace(':id',p.id)}/runs/${r.id}/rigged.glb?version=${r.version}`}:null}))};}
  function publicStudioJob(p){const j=p.rigStudioJobs?.at(-1);return j&&['preparing','running'].includes(j.stage)&&!bridge?.getOperation(j.operationId)?{...j,stage:'attention',error:'STUDIO_SESSION_LOST'}:j;}
  async function acceptDonor(p,bytes,filename){const profile=donorProfile(bytes),sha256=hash(bytes),source=riggingSource(p);if(!source)fail('Finish placement before preparing the rigging workspace.');if(donorFor(p)?.sha256===sha256)return donorFor(p);const donor={id:randomUUID(),asset:await store.asset(p,bytes,'glb','tripo-rig-donor'),sha256,sourcePlacementId:source.id,profile,filename:path.basename(filename),createdAt:new Date().toISOString()};(p.rigDonors||=[]).push(donor);return donor;}
  mountStudioRig(app,{store,bridge,editable,riggingSource,acceptDonor});
  app.get(root,(q,s)=>s.json(state(store.get(q.params.id))));
  app.post(root+'/donor',upload.single('file'),async(q,s)=>{
    const p=store.get(q.params.id);editable(p);await locked(p,async()=>{
      const source=riggingSource(p);if(!source)fail('Finish placement before preparing the rigging workspace.');
      if(!q.file)fail('Import the rigged donor GLB from Tripo.',400);
      const bytes=q.file.buffer,profile=donorProfile(bytes),sha256=hash(bytes);
      if(donorFor(p)?.sha256===sha256){s.json(state(p));return;}
      const asset=await store.asset(p,bytes,'glb','tripo-rig-donor');current(p,source);
      const next=structuredClone(p);(next.rigDonors||=[]).push({id:randomUUID(),asset,sha256,sourcePlacementId:source.id,profile,filename:path.basename(q.file.originalname),createdAt:new Date().toISOString()});await store.save(next);s.json(state(next));
    });
  });
  app.post(root+'/prepare',async(q,s)=>{
    const p=store.get(q.params.id);editable(p);await locked(p,async()=>{
      const source=riggingSource(p),donor=donorFor(p);if(!source||!donor)fail('Import the rigged donor GLB from Tripo.');
      if(p.rigRefinements?.some(r=>r.sourcePlacementId===source.id&&r.donorId===donor.id)){s.json(state(p));return;}
      const r={id:randomUUID(),sourcePlacementId:source.id,donorId:donor.id,status:'awaiting-codex',supportProfileId:bodySupportProfile.id,createdAt:new Date().toISOString()},dir=workspace(p,r);
      const files={'original.glb':await store.read(p,source.preview),'original.blend':await store.read(p,source.blend),'donor.glb':await store.read(p,donor.asset),'donor-profile.json':Buffer.from(JSON.stringify(donor.profile,null,2))};
      const runtime={schema:'workbench-rig-runtime/v1',auxiliaryProfile:bodySupportProfile.id,supportBones:{},secondary:[],humanoid:donor.profile.humanoid,twists:[],correctives:[],examples:{twist:{target:'NEW_AUXILIARY',source:donor.profile.humanoid.Hand_L,axis:[0,1,0],fraction:.5,mode:'twist'},boneCorrective:{source:donor.profile.humanoid.LowerArm_L,axis:[1,0,0],start:.4,end:1.6,targetBone:'NEW_CORRECTIVE',translation:[0,.005,0],rotationAxis:[1,0,0],rotationAngle:.2},shapeCorrective:{source:donor.profile.humanoid.LowerArm_L,axis:[1,0,0],start:.4,end:1.6,targetMesh:'ORIGINAL_MESH_NAME',morph:'ElbowFix',maxWeight:1}},notes:'Examples are not fitted recipes. Replace placeholders and measure axes; remove examples in output.'};
      files['runtime-example.json']=Buffer.from(JSON.stringify(runtime,null,2));
      for(const folder of ['input','output','reports'])await fs.mkdir(path.join(dir,folder),{recursive:true});
      await fs.writeFile(path.join(dir,'AUXILIARY_PROFILE.json'),await fs.readFile(auxiliaryProfileFile));
      for(const [name,bytes] of Object.entries(await vrchatPreparationFiles()))await fs.writeFile(path.join(dir,name),bytes);
      for(const [file,b] of Object.entries(files))await fs.writeFile(path.join(dir,'input',file),b);
      const manifest={schema:'workbench-rig-refinement/v1',supportProfileId:bodySupportProfile.id,runId:r.id,projectId:p.id,projectName:p.name,workspace:dir,sourcePlacementId:source.id,donorId:donor.id,inputs:Object.fromEntries(Object.entries(files).map(([file,b])=>[file,hash(b)]))};
      for(const [key,asset] of Object.entries(source.references||{}))await fs.writeFile(path.join(dir,'input',`reference_${key}.png`),await store.read(p,asset));
      await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));await fs.writeFile(path.join(dir,'INSTRUCTIONS.txt'),refinementInstructions(manifest));r.manifestHash=hash(Buffer.from(JSON.stringify(manifest)));
      current(p,source);const next=structuredClone(p);(next.rigRefinements||=[]).push(r);await store.save(next);s.json(state(next));
    });
  });
  app.get(root+'/runs/:runId/package',async(q,s)=>{
    const p=store.get(q.params.id),r=runFor(p,q.params.runId);if(r.sourcePlacementId!==riggingSource(p)?.id||r.donorId!==donorFor(p)?.id)fail('The placement changed. Prepare a new rigging workspace.');
    const dir=workspace(p,r),manifest=await fs.readFile(path.join(dir,'manifest.json'));
    const files={'manifest.json':manifest,'INSTRUCTIONS.txt':Buffer.from(refinementInstructions(JSON.parse(manifest))),'AUXILIARY_PROFILE.json':await fs.readFile(auxiliaryProfileFile),...await vrchatPreparationFiles()};
    // Refresh handoff guidance without changing immutable input hashes/results.
    for(const name of Object.keys(files).filter(name=>name!=='manifest.json'))await fs.writeFile(path.join(dir,name),files[name]);
    if(r.supportProfileId!==bodySupportProfile.id){const next=structuredClone(p);next.rigRefinements.find(x=>x.id===r.id).supportProfileId=bodySupportProfile.id;await store.save(next);}
    s.type('application/zip').attachment('fita_rig_refinement.zip').send(await localInstructionPackage(store,p,'rig-refinement',files));
  });
  app.post(root+'/runs/:runId/import',async(q,s)=>{
    const p=store.get(q.params.id);editable(p);await locked(p,async()=>{
      const r=runFor(p,q.params.runId),source=riggingSource(p),donor=donorFor(p);if(r.sourcePlacementId!==source?.id||r.donorId!==donor?.id)fail('The placement changed. Prepare a new rigging workspace.');
      const dir=workspace(p,r);async function read(name,max=1024*1024){const file=path.join(dir,name),stat=await fs.lstat(file).catch(()=>null);if(!stat?.isFile()||stat.isSymbolicLink()||stat.size>max)fail('Return rigged.glb, rigged.blend, manifest.json, runtime.json and report.json in output.');return fs.readFile(file);}
      const manifest=JSON.parse(await read('manifest.json'));if(hash(Buffer.from(JSON.stringify(manifest)))!==r.manifestHash||JSON.stringify(JSON.parse(await read('output/manifest.json')))!==JSON.stringify(manifest))fail('The result belongs to another project or source version.');
      for(const [name,expected] of Object.entries(manifest.inputs))if(hash(await read('input/'+name,512*1024*1024))!==expected)fail('The refinement inputs changed.');
      if(hash(await store.read(p,source.preview))!==manifest.inputs['original.glb']||hash(await store.read(p,source.blend))!==manifest.inputs['original.blend']||hash(await store.read(p,donor.asset))!==manifest.inputs['donor.glb'])fail('The refinement inputs changed.');
      const bytes=await read('output/rigged.glb',150*1024*1024);inspectTextureGlb(bytes);
      const expected=await assemblySource(store,p,r,source);
      const validation={...inspectRiggedGlb(bytes,{bones:donor.profile.bones}),...inspectRestPreservation(expected.glb,bytes)};
      const blend=await read('output/rigged.blend',512*1024*1024);if(blend.subarray(0,7).toString()!=='BLENDER')fail('Return an uncompressed editable Blender file.',400);
      Object.assign(validation,inspectRigConnectivity(expected.glb,bytes,{required:!!r.assembly||source.report?.lockedPlacementValidation?.vertexIdentitiesPreserved===true}));
      if(validation.connectivityChecked)Object.assign(validation,await validateEditableRigConnectivity(expected.blend,blend));
      const report=JSON.parse(await read('output/report.json')),runtime=JSON.parse(await read('output/runtime.json'));
      if(report.schema!=='workbench-rig-refinement-review/v1'||['reviewRequired','originalMeshPreserved','donorMeshExcluded','skeletonTransferred','weightsReviewed','auxiliariesReviewed','correctivesReviewed'].some(k=>report[k]!==true)||!Array.isArray(report.observations)||!Array.isArray(report.limitations)||report.alignment?.matrix?.length!==16||!report.alignment.matrix.every(Number.isFinite)||!Number.isFinite(report.alignment.maxDistanceMeters)||report.alignment.maxDistanceMeters<0)fail('Return the transfer, weight and corrective review in report.json.',400);
      const {validateRigRuntime,validateTransferredJoints}=await import('./rig-runtime-validation.js');Object.assign(validation,validateTransferredJoints(await store.read(p,donor.asset),bytes,report.alignment.matrix));
      const requiredSupportProfile=r.supportProfileId||manifest.supportProfileId;
      validateRigRuntime(bytes,runtime,donor.profile,{requiredSupportProfile});
      if(requiredSupportProfile===bodySupportProfile.id){
        const evidence=validateBodyRigReview(bytes,runtime,report,validation);
        for(const name of evidence){const image=await read('output/'+name,12*1024*1024);if(!(image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||image[0]===255&&image[1]===216))fail('Return PNG/JPEG pose evidence: '+name,400);}
        validation.bodySupportProfileVerified=true;validation.secondaryBoneCount=(runtime.secondary||[]).reduce((n,c)=>n+c.bones.length,0);
      }
      const resultHash=hash(bytes)+hash(blend)+hash(Buffer.from(JSON.stringify({runtime,report})));if(r.resultHash===resultHash){s.json({...state(p),duplicate:true});return;}
      const version=randomUUID(),target=path.join(dir,'reports',version);await fs.mkdir(target,{recursive:true});for(const [n,b] of Object.entries({'rigged.glb':bytes,'rigged.blend':blend,'runtime.json':JSON.stringify(runtime,null,2),'report.json':JSON.stringify({validation,report},null,2)}))await fs.writeFile(path.join(target,n),b);
      current(p,source);const next=structuredClone(p);Object.assign(next.rigRefinements.find(x=>x.id===r.id),{version,resultHash,validation,report,runtime,status:'needs-review'});await store.save(next);s.json(state(next));
    });
  });
  app.get(root+'/runs/:runId/:file',(q,s)=>{const p=store.get(q.params.id),r=runFor(p,q.params.runId);if(!r.version||!['rigged.glb','rigged.blend','runtime.json'].includes(q.params.file))fail('Rigged result not found.',404);s.sendFile(path.join(workspace(p,r),'reports',r.version,q.params.file));});
}

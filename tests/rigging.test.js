import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {randomUUID,createHash} from 'node:crypto';
import {Store,emptyProject} from '../server/storage.js';
import {snapshot} from '../server/lineage.js';
import {fingerprintViewSet} from '../server/view-set.js';
import {mountRigging} from '../server/rigging.js';
import {inspectRiggedGlb,inspectRestPreservation} from '../server/rigging-validation.js';
import {rigPreview} from '../src/viewer-rigging.js';
import * as THREE from 'three';

const profile=JSON.parse(await fs.readFile('templates/rigs/humanoid-v1/profile.json'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
function fixture(skinned=true,patch=()=>{}){
  const chunks=[],views=[],accessors=[];
  function add(bytes,type,componentType,count){const start=chunks.reduce((n,b)=>n+b.length,0),padding=Buffer.alloc((-bytes.length)%4&3);chunks.push(bytes,padding);views.push({buffer:0,byteOffset:start,byteLength:bytes.length});const index=accessors.length;accessors.push({bufferView:views.length-1,type,componentType,count});return index;}
  const floats=a=>{const b=Buffer.alloc(a.length*4);a.forEach((v,i)=>b.writeFloatLE(v,i*4));return b;};
  const position=add(floats([0,0,0,1,0,0,0,1,0]),'VEC3',5126,3),uv=add(floats([0,0,1,0,0,1]),'VEC2',5126,3);
  const names=new Map(profile.bones.map((b,i)=>[b.name,i]));
  const nodes=skinned?profile.bones.map(b=>({name:b.name,children:profile.bones.filter(x=>x.parent===b.name).map(x=>names.get(x.name))})):[];
  const attributes={POSITION:position,TEXCOORD_0:uv};
  const skins=[];
  if(skinned){
    attributes.JOINTS_0=add(Buffer.alloc(12),'VEC4',5121,3);
    attributes.WEIGHTS_0=add(floats([1,0,0,0,1,0,0,0,1,0,0,0]),'VEC4',5126,3);
    const matrices=profile.bones.flatMap(()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    skins.push({joints:profile.bones.map((_,i)=>i),inverseBindMatrices:add(floats(matrices),'MAT4',5126,profile.bones.length)});
  }
  const meshNode=nodes.length;nodes.push({name:'Body',mesh:0,...(skinned?{skin:0}:{})});
  const d={asset:{version:'2.0'},scene:0,scenes:[{nodes:skinned?[names.get('WB_Hips'),meshNode]:[meshNode]}],nodes,skins,
    meshes:[{primitives:[{attributes,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{uri:'data:image/png;base64,'+png.toString('base64')}],accessors,bufferViews:views};
  const bin=Buffer.concat(chunks);d.buffers=[{byteLength:bin.length}];patch(d,bin);
  let json=Buffer.from(JSON.stringify(d));json=Buffer.concat([json,Buffer.alloc((-json.length)%4&3,32)]);
  const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const binary=Buffer.alloc(8);binary.writeUInt32LE(bin.length);binary.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,json,binary,bin]);
}

test('weighted GLB rejects missing joints, bad hierarchy, invalid weights and unskinned meshes',()=>{
  assert.equal(inspectRiggedGlb(fixture(),profile).maxInfluences,1);
  for(const invalid of [fixture(false),fixture(true,d=>{d.nodes.find(n=>n.name==='WB_LowerArm_L').name='missing';}),fixture(true,d=>{d.nodes.find(n=>n.name==='WB_UpperArm_L').children=[];}),fixture(true,(d,b)=>{const a=d.accessors[d.meshes[0].primitives[0].attributes.WEIGHTS_0];b.writeFloatLE(.2,d.bufferViews[a.bufferView].byteOffset);}),fixture(true,(d,b)=>{const a=d.accessors[d.meshes[0].primitives[0].attributes.JOINTS_0];b[d.bufferViews[a.bufferView].byteOffset]=250;})])assert.throws(()=>inspectRiggedGlb(invalid,profile));
});
test('rigging cannot replace the approved rest geometry, UVs or base color',()=>{
  assert.equal(inspectRestPreservation(fixture(false),fixture()).restGeometryAndBaseColorPreserved,true);
  assert.throws(()=>inspectRestPreservation(fixture(false),fixture(true,(d,b)=>b.writeFloatLE(.5,0))),/rest geometry/);
  assert.throws(()=>inspectRestPreservation(fixture(false),fixture(true,d=>{d.materials[0].pbrMetallicRoughness.baseColorFactor=[.5,1,1,1];})),/rest geometry/);
});

test('rest preservation supports uniform anime cavity materials while protecting their color',()=>{
  const solid=d=>{d.materials[0].pbrMetallicRoughness={baseColorFactor:[.041,.012,.019,1]};};
  const source=fixture(false,solid),result=fixture(true,solid);
  assert.equal(inspectRestPreservation(source,result).restGeometryAndBaseColorPreserved,true);
  assert.throws(()=>inspectRestPreservation(source,fixture(true,d=>{solid(d);d.materials[0].pbrMetallicRoughness.baseColorFactor[0]=.2;})),/rest geometry/);
});

test('local handoff stays small, immutable and scoped to the current source',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-rigging-test-')),store=new Store(path.join(temp,'data'));await store.init();
  const p=emptyProject('Synthetic rig test');p.reference=await store.asset(p,png,'png','fixture');p.referenceState={status:'ready',referenceId:p.reference.id};
  for(const group of ['head','body']){p.groups[group].views.front=p.reference;const model={id:randomUUID()+'.glb',group,source:'importado',lineage:snapshot(p)};p.models.push(model);p.groups[group].selectedModelId=model.id;(p.textures||=[]).push({...await store.asset(p,fixture(false),'glb','fixture'),group,sourceModelId:model.id,fingerprint:fingerprintViewSet(p,group)});}
  p.placements=[{id:randomUUID(),status:'succeeded',sources:Object.fromEntries(p.textures.map(a=>[a.group,a.id])),preview:await store.asset(p,fixture(false),'glb','fixture'),blend:await store.asset(p,Buffer.from('BLENDERfixture'),'blend','fixture')}];await store.save(p);
  const app=express();app.use(express.json());mountRigging(app,{store,editable:()=>{}});app.use((e,q,r,n)=>r.status(e.status||400).json({error:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));assert(temp.startsWith(path.join(os.tmpdir(),'workbench-rigging-test-')));await fs.rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/rigging`;
  const post=async url=>{const r=await fetch(url,{method:'POST'});return {status:r.status,data:await r.json()};};
  const first=await post(base+'/prepare');assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.runs[0].current,true);
  const second=await post(base+'/prepare');assert.equal(second.data.runs.length,1);const run=first.data.runs[0];
  assert.equal(hash(await fs.readFile(path.join(run.workspace,'input','model.glb'))),hash(await store.read(p,p.placements[0].preview)));
  const zip=await fetch(base+`/runs/${run.id}/package`);assert.equal(zip.status,200);assert((await zip.arrayBuffer()).byteLength<20000);
  const importUrl=base+`/runs/${run.id}/import`;assert.notEqual((await post(importUrl)).status,200);
  const out=path.join(run.workspace,'output'),manifest=await fs.readFile(path.join(run.workspace,'manifest.json'));
  await fs.writeFile(path.join(out,'manifest.json'),manifest);await fs.writeFile(path.join(out,'rigged.blend'),Buffer.from('BLENDERfixture'));
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify({schema:'workbench-rigging-review/v1',reviewRequired:true,jointsReviewed:true,weightsReviewed:true,preservationReviewed:true,observations:['Synthetic data only'],limitations:['No real deformation test']}));
  await fs.writeFile(path.join(out,'rigged.glb'),fixture(false));assert.notEqual((await post(importUrl)).status,200);
  await fs.writeFile(path.join(out,'rigged.glb'),fixture());const imported=await post(importUrl);assert.equal(imported.status,200,JSON.stringify(imported.data));assert.equal(imported.data.runs[0].status,'needs-review');
  assert.equal((await post(importUrl)).data.duplicate,true);
  const original=store.get(p.id);original.textures[0].id=randomUUID()+'.glb';assert.equal((await post(importUrl)).status,409);
});
function hash(b){let n=0;for(const value of b)n=(n*31+value)>>>0;return n;}

test('built-in preview moves weighted vertices, resets pose and distributes wrist torsion',()=>{
  const root=new THREE.Group(),joints=new Map();
  for(const spec of profile.bones){const bone=new THREE.Bone();bone.name=spec.name;const parent=profile.bones.find(b=>b.name===spec.parent),origin=parent?.head||[0,0,0];bone.position.set(spec.head[0]-origin[0],spec.head[2]-origin[2],-(spec.head[1]-origin[1]));joints.set(spec.name,bone);}
  for(const spec of profile.bones)(joints.get(spec.parent)||root).add(joints.get(spec.name));
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([.725,1.385,0],3));geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([0,0,0,0],4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0],4));
  const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton([joints.get('WB_Hand_L')]));
  const before=mesh.applyBoneTransform(0,new THREE.Vector3(.725,1.385,0));const preview=rigPreview(root);preview.select('Arm raise');preview.update(2);root.updateMatrixWorld(true);
  const after=mesh.applyBoneTransform(0,new THREE.Vector3(.725,1.385,0));assert(after.distanceTo(before)>.2);
  preview.select('Rest pose');root.updateMatrixWorld(true);assert(mesh.applyBoneTransform(0,new THREE.Vector3(.725,1.385,0)).distanceTo(before)<1e-5);
  preview.select('Wrist twist');preview.update(2);assert(joints.get('WB_LowerArmTwistWrist_L').quaternion.angleTo(new THREE.Quaternion())>0);
  preview.select('Left arm only');preview.update(2);assert(joints.get('WB_UpperArm_L').quaternion.angleTo(new THREE.Quaternion())>.5);assert(joints.get('WB_UpperArm_R').quaternion.angleTo(new THREE.Quaternion())<1e-6);
  preview.dispose();geometry.dispose();mesh.material.dispose();
});

test('Tripo donor handoff preserves the original mesh, rejects donor substitution and moved joints',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-rigging-v2-')),store=new Store(path.join(temp,'data'));await store.init();
  const p=emptyProject('Donor transfer fixture');p.reference=await store.asset(p,png,'png','fixture');p.referenceState={status:'ready',referenceId:p.reference.id};
  for(const group of ['head','body']){p.groups[group].views.front=p.reference;const model={id:randomUUID()+'.glb',group,source:'importado',lineage:snapshot(p)};p.models.push(model);p.groups[group].selectedModelId=model.id;(p.textures||=[]).push({...await store.asset(p,fixture(false),'glb','fixture'),group,sourceModelId:model.id,fingerprint:fingerprintViewSet(p,group)});}
  p.placements=[{id:randomUUID(),status:'succeeded',sources:Object.fromEntries(p.textures.map(a=>[a.group,a.id])),preview:await store.asset(p,fixture(false),'glb','fixture'),blend:await store.asset(p,Buffer.from('BLENDERfixture'),'blend','fixture')}];await store.save(p);
  const app=express();app.use(express.json());mountRigging(app,{store,editable:()=>{}});app.use((e,q,r,n)=>r.status(e.status||400).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));assert(temp.startsWith(path.join(os.tmpdir(),'workbench-rigging-v2-')));await fs.rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/rigging/refinement`,post=async(url,body)=>{const r=await fetch(url,{method:'POST',body});return {status:r.status,data:await r.json()};};
  assert.equal((await post(base+'/prepare')).status,409);
  const rename=d=>{for(const n of d.nodes)if(n.name.startsWith('WB_'))n.name=n.name.slice(3);};
  const donor=fixture(true,(d,b)=>{rename(d);b.writeFloatLE(.2,0);}),body=new FormData();body.append('file',new Blob([donor]),'donor.glb');
  const imported=await post(base+'/donor',body);assert.equal(imported.status,200,JSON.stringify(imported.data));assert.equal(imported.data.donor.profile.humanoid.Hips,'Hips');assert.equal(store.get(p.id).placements[0].preview.id,p.placements[0].preview.id);
  const prepared=await post(base+'/prepare'),run=prepared.data.runs[0];assert.equal(prepared.status,200,JSON.stringify(prepared.data));assert.equal((await post(base+'/prepare')).data.runs.length,1);
  assert.equal(hash(await fs.readFile(path.join(run.workspace,'input','original.glb'))),hash(fixture(false)));
  assert.equal(hash(await fs.readFile(path.join(run.workspace,'input','donor.glb'))),hash(donor));
  assert.match(await fs.readFile(path.join(run.workspace,'INSTRUCTIONS.txt'),'utf8'),/NEVER use its mesh/);
  const destinationGuide=await fs.readFile('docs/VRCHAT_PC_CODEX_HANDOFF.md');
  const destinationProfile=await fs.readFile('docs/VRCHAT_PC_REFERENCE_PROFILE.json'),profilePath=path.join(run.workspace,'VRCHAT_PC_REFERENCE_PROFILE.json');
  const guidePath=path.join(run.workspace,'VRCHAT_PC_HANDOFF.md'),manifestBeforeGuide=await fs.readFile(path.join(run.workspace,'manifest.json'));
  assert.deepEqual(await fs.readFile(guidePath),destinationGuide);
  assert.deepEqual(await fs.readFile(profilePath),destinationProfile);
  await fs.writeFile(guidePath,'outdated destination notes');
  await fs.writeFile(profilePath,'outdated destination profile');
  const zip=await fetch(base+`/runs/${run.id}/package`);assert.equal(zip.status,200);assert((await zip.arrayBuffer()).byteLength<20000);
  assert.deepEqual(await fs.readFile(guidePath),destinationGuide,'regenerating instructions refreshes the destination guide');
  assert.deepEqual(await fs.readFile(profilePath),destinationProfile,'regenerating instructions refreshes tested settings');
  assert.deepEqual(await fs.readFile(path.join(run.workspace,'manifest.json')),manifestBeforeGuide,'guide refresh preserves the immutable source manifest');
  const handoffRoot=path.join(temp,'projects',p.id,'codex','rig-refinement'),handoffIds=await fs.readdir(handoffRoot);
  assert.equal(handoffIds.length,1);
  assert.deepEqual(await fs.readFile(path.join(handoffRoot,handoffIds[0],'VRCHAT_PC_HANDOFF.md')),destinationGuide,'local instruction entries carry the usable guide for the receiving Codex');
  assert.deepEqual(await fs.readFile(path.join(handoffRoot,handoffIds[0],'VRCHAT_PC_REFERENCE_PROFILE.json')),destinationProfile,'reference settings stay separate from immutable rig inputs');
  const output=path.join(run.workspace,'output'),report={schema:'workbench-rig-refinement-review/v1',reviewRequired:true,originalMeshPreserved:true,donorMeshExcluded:true,skeletonTransferred:true,weightsReviewed:true,auxiliariesReviewed:true,correctivesReviewed:true,alignment:{matrix:new THREE.Matrix4().toArray(),maxDistanceMeters:0},observations:['Synthetic fixture'],limitations:['No visual review']};
  await fs.copyFile(path.join(run.workspace,'manifest.json'),path.join(output,'manifest.json'));await fs.writeFile(path.join(output,'rigged.blend'),'BLENDERfixture');await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report));await fs.writeFile(path.join(output,'runtime.json'),JSON.stringify({schema:'workbench-rig-runtime/v1',humanoid:imported.data.donor.profile.humanoid,twists:[],correctives:[]}));
  const url=base+`/runs/${run.id}/import`;
  await fs.writeFile(path.join(output,'rigged.glb'),donor);assert.match((await post(url)).data.error,/rest geometry/);
  await fs.writeFile(path.join(output,'rigged.glb'),fixture(true,d=>{rename(d);d.nodes.find(n=>n.name==='LowerArm_L').translation=[.02,0,0];}));assert.match((await post(url)).data.error,/moved a donor joint/);
  await fs.writeFile(path.join(output,'rigged.glb'),fixture(true,rename));
  assert.match((await post(url)).data.error,/required body support profile/);
  // Previously issued v1 runs remain readable; a new v2 handoff cannot accept this incomplete rig.
  const legacy=structuredClone(store.get(p.id));delete legacy.rigRefinements[0].supportProfileId;
  const legacyManifest=JSON.parse(await fs.readFile(path.join(run.workspace,'manifest.json'),'utf8'));delete legacyManifest.supportProfileId;
  legacy.rigRefinements[0].manifestHash=createHash('sha256').update(JSON.stringify(legacyManifest)).digest('hex');
  for(const file of [path.join(run.workspace,'manifest.json'),path.join(output,'manifest.json')])await fs.writeFile(file,JSON.stringify(legacyManifest));
  await store.save(legacy);
  const result=await post(url);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.runs[0].validation.donorJointPlacementPreserved,true);assert.equal((await post(url)).data.duplicate,true);
  await fs.writeFile(path.join(run.workspace,'input','donor.glb'),fixture(true,rename));assert.match((await post(url)).data.error,/inputs changed/);
});

test('runtime recipes activate weighted helpers and corrective morphs, then reset to rest',async()=>{
  const {createRigRuntime}=await import('../src/rig-runtime.js');const root=new THREE.Group(),source=new THREE.Bone(),helper=new THREE.Bone(),mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());source.name='Left_LowerArm';helper.name='ElbowHelper';mesh.name='Body';mesh.morphTargetDictionary={ElbowFix:0};mesh.morphTargetInfluences=[0];root.add(source,helper,mesh);
  const runtime=createRigRuntime(root,{twists:[],correctives:[{source:source.name,axis:[1,0,0],start:.2,end:1,targetBone:helper.name,translation:[0,.01,0],rotationAxis:[1,0,0],rotationAngle:.3},{source:source.name,axis:[1,0,0],start:.2,end:1,targetMesh:mesh.name,morph:'ElbowFix',maxWeight:1}]},n=>root.getObjectByName(n));
  runtime.update();assert.equal(mesh.morphTargetInfluences[0],0);source.rotation.x=1;runtime.update();assert.equal(mesh.morphTargetInfluences[0],1);assert(Math.abs(helper.position.y-.01)<1e-8);assert(Math.abs(helper.rotation.x-.3)<1e-8);runtime.reset();assert.equal(mesh.morphTargetInfluences[0],0);assert.equal(helper.position.y,0);mesh.geometry.dispose();mesh.material.dispose();
});


async function supportFixture(){
  const {bodySupportProfile:fixed}=await import('../server/rig-runtime-validation.js');
  const {inferHumanoidMap}=await import('../shared/humanoid-map.js');
  const base=fixture(),size=base.readUInt32LE(12),d=JSON.parse(base.toString('utf8',20,20+size)),chunks=[base.subarray(size+28)];
  const donor={bones:profile.bones.map(b=>({name:b.name,parent:b.parent})),humanoid:inferHumanoidMap(profile.bones.map(b=>b.name))};
  const runtime={schema:'workbench-rig-runtime/v1',auxiliaryProfile:fixed.id,humanoid:donor.humanoid,supportBones:{},twists:[],correctives:[],secondary:[]};
  const added=[];
  const addBone=(name,parent)=>{
    const id=d.nodes.length;d.nodes.push({name});const p=d.nodes.find(n=>n.name===parent);(p.children||=[]).push(id);d.skins[0].joints.push(id);added.push(name);return id;
  };
  for(const side of fixed.sides)for(const b of fixed.requiredBonesPerSide){
    const role=b.name.replaceAll('{side}',side),name=role,resolve=r=>runtime.humanoid[r.replaceAll('{side}',side)];
    addBone(name,resolve(b.parentRole));runtime.supportBones[role]=name;
    if(b.kind==='twist')runtime.twists.push({target:name,source:resolve(b.sourceRole),axis:[0,1,0],fraction:b.fraction,mode:b.mode});
    else if(b.kind==='bone-corrective')runtime.correctives.push({targetBone:name,source:resolve(b.jointRole),axis:[1,0,0],start:35*Math.PI/180,end:110*Math.PI/180,translation:[0,.002,0],rotationAxis:[1,0,0],rotationAngle:0});
    else runtime.secondary.push({kind:b.region,bones:[name],attachment:resolve(b.parentRole),meshes:['Body'],region:side+' tissue',simulated:false});
  }
  addBone('HairRoot',runtime.humanoid.Head);addBone('HairTip','HairRoot');addBone('Hem',runtime.humanoid.Hips);
  runtime.secondary.push({kind:'hair',bones:['HairRoot','HairTip'],attachment:runtime.humanoid.Head,meshes:['Body'],region:'hair region',simulated:false},{kind:'clothing',bones:['Hem'],attachment:runtime.humanoid.Hips,meshes:['Body'],region:'hem region',simulated:false});
  function add(values,type,componentType,width){
    const bytes=Buffer.alloc(values.length*(componentType===5123?2:4));values.forEach((v,i)=>bytes[componentType===5123?'writeUInt16LE':'writeFloatLE'](v,i*(componentType===5123?2:4)));
    const offset=chunks.reduce((n,b)=>n+b.length,0);d.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});chunks.push(bytes,Buffer.alloc((-bytes.length)&3));d.accessors.push({bufferView:d.bufferViews.length-1,type,componentType,count:values.length/width});return d.accessors.length-1;
  }
  const names=[...added,runtime.humanoid.Hips],n=names.length;
  const attrs=d.meshes[0].primitives[0].attributes;
  attrs.POSITION=add(Array.from({length:n},(_,i)=>[i*.01,0,0]).flat(),'VEC3',5126,3);
  attrs.TEXCOORD_0=add(Array(n*2).fill(0),'VEC2',5126,2);
  attrs.JOINTS_0=add(names.flatMap(name=>[d.skins[0].joints.findIndex(j=>d.nodes[j].name===name),0,0,0]),'VEC4',5123,4);
  attrs.WEIGHTS_0=add(names.flatMap(()=>[1,0,0,0]),'VEC4',5126,4);
  d.skins[0].inverseBindMatrices=add(d.skins[0].joints.flatMap(()=>new THREE.Matrix4().toArray()),'MAT4',5126,16);
  const bin=Buffer.concat(chunks);d.buffers[0].byteLength=bin.length;
  function encode(){let j=Buffer.from(JSON.stringify(d));j=Buffer.concat([j,Buffer.alloc((-j.length)&3,32)]);const h=Buffer.alloc(20),b=Buffer.alloc(8);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+j.length+bin.length,8);h.writeUInt32LE(j.length,12);h.writeUInt32LE(0x4e4f534a,16);b.writeUInt32LE(bin.length);b.writeUInt32LE(0x004e4942,4);return Buffer.concat([h,j,b,bin]);}
  return {d,bin,encode,donor,runtime,fixed};
}

test('body support contract accepts pose morphs alongside fixed support bones and rejects duplicate or missing morph recipes',async()=>{
  const {validateRigRuntime}=await import('../server/rig-runtime-validation.js');
  const f=await supportFixture(),mesh=f.d.meshes[0];mesh.extras={targetNames:['ShoulderDrop']};mesh.weights=[0];mesh.primitives[0].targets=[{POSITION:mesh.primitives[0].attributes.POSITION}];
  const recipe={source:f.runtime.humanoid.UpperArm_L,axis:[1,0,0],start:.2,end:1.2,targetMesh:'Body',morph:'ShoulderDrop',maxWeight:1};f.runtime.correctives.push(recipe);
  assert.equal(validateRigRuntime(f.encode(),f.runtime,f.donor,{requiredSupportProfile:f.fixed.id}),true);
  f.runtime.correctives.push({...recipe});assert.throws(()=>validateRigRuntime(f.encode(),f.runtime,f.donor),/shape key target/);f.runtime.correctives.pop();
  f.runtime.correctives.pop();assert.throws(()=>validateRigRuntime(f.encode(),f.runtime,f.donor),/needs a runtime recipe/);
});

test('body support contract accepts weighted fixed roles and adaptive chains, rejects incomplete or mislabeled rigs',async()=>{
  const {validateRigRuntime}=await import('../server/rig-runtime-validation.js');
  const f=await supportFixture(),bytes=f.encode(),opts={requiredSupportProfile:f.fixed.id};
  assert.equal(validateRigRuntime(bytes,f.runtime,f.donor,opts),true);
  for(const mutate of [
    r=>{delete r.auxiliaryProfile;},r=>{delete r.supportBones.WB_Physics_Glute_L;},
    r=>{r.twists[0].fraction=.9;},r=>{r.twists[0].source=r.humanoid.UpperArm_R;},
    r=>{r.secondary.find(c=>c.kind==='hair').bones.reverse();},
    r=>{r.secondary.find(c=>c.kind==='hair').simulated=true;},
    r=>{r.secondary=r.secondary.filter(c=>c.kind!=='clothing');},
    r=>{r.supportBones.WB_Physics_Breast_L=r.humanoid.Chest;},
  ]){const r=structuredClone(f.runtime);mutate(r);assert.throws(()=>validateRigRuntime(bytes,r,f.donor,opts));}
  // A declared but unused helper is rejected even if the report claims it was painted.
  const a=f.d.accessors[f.d.meshes[0].primitives[0].attributes.JOINTS_0],offset=f.d.bufferViews[a.bufferView].byteOffset;
  f.bin.writeUInt16LE(0,offset);assert.throws(()=>validateRigRuntime(f.encode(),f.runtime,f.donor,opts),/unweighted/);
});

test('body rig review requires complete inventory, measured skin metrics and evidence for both sides',async()=>{
  const {validateBodyRigReview}=await import('../server/rig-runtime-validation.js');const f=await supportFixture(),bytes=f.encode(),validation=inspectRiggedGlb(bytes,f.donor);
  const metrics={unweightedVertices:0,unnormalizedVertices:0,maxInfluences:1};
  const report={bodyRig:{profile:f.fixed.id,stageOrder:['transfer','fixed-body-support','hair-and-clothing-chains','weight-refinement','deformation-review'],meshInventory:[{mesh:'Body',kind:'body',decision:'follows-body',reason:'Synthetic combined mesh'}],weightAudit:{before:metrics,after:metrics,regionChecks:[{mesh:'Body',region:'test',allowedBones:[f.runtime.humanoid.Hips],removedDisallowedWeight:.2}],poseChecks:f.fixed.reviewPoses.map(c=>({...c,passed:true,maxUnintendedDisplacementMeters:0,evidence:[`review/${c.test}_${c.side}.png`]}))}}};
  assert.equal(validateBodyRigReview(bytes,f.runtime,report,validation).length,14);
  for(const mutate of [r=>r.bodyRig.meshInventory.pop(),r=>r.bodyRig.stageOrder.reverse(),r=>r.bodyRig.weightAudit.poseChecks.pop(),r=>{r.bodyRig.weightAudit.poseChecks[0].maxUnintendedDisplacementMeters=.05;},r=>{r.bodyRig.weightAudit.after.maxInfluences=4;},r=>{r.bodyRig.weightAudit.poseChecks[0].evidence=['../outside.png'];}]){
    const r=structuredClone(report);mutate(r);assert.throws(()=>validateBodyRigReview(bytes,f.runtime,r,validation));
  }
});

test('distributed twist preserves measured local axes and secondary chains inherit parent motion without fake physics',async()=>{
  const {createRigRuntime}=await import('../src/rig-runtime.js');const root=new THREE.Group(),source=new THREE.Bone(),head=new THREE.Bone(),hair=new THREE.Bone();root.add(source,head);head.add(hair);hair.position.set(0,1,0);
  const helpers=[.25,.5,.75].map((fraction,i)=>{const b=new THREE.Bone();b.name='Twist'+i;root.add(b);return b;});source.name='Source';
  const r=createRigRuntime(root,{twists:helpers.map((b,i)=>({target:b.name,source:'Source',mode:'twist',axis:[0,1,0],fraction:[.25,.5,.75][i]})),correctives:[],secondary:[{kind:'hair',bones:['Hair'],simulated:false}]},name=>root.getObjectByName(name));
  for(const angle of [-1.2,1.2]){source.rotation.y=angle;r.update();helpers.forEach((b,i)=>assert(Math.abs(b.rotation.y-angle*[.25,.5,.75][i])<1e-6));}
  head.rotation.z=Math.PI/2;root.updateMatrixWorld(true);assert(hair.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(-1,0,0))<1e-6);assert.equal(hair.quaternion.angleTo(new THREE.Quaternion()),0);
  r.reset();helpers.forEach(b=>assert(b.quaternion.angleTo(new THREE.Quaternion())<1e-6));
});


test('v2 refinement import accepts the complete reviewed contract and rejects missing pose evidence',async t=>{
  const {mountRigRefinement}=await import('../server/rig-refinement.js');
  const f=await supportFixture(),bytes=f.encode(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'wb-body-import-'));
  const store=new Store(path.join(temp,'data'));await store.init();const p=emptyProject('Body rig contract');
  const source={id:'placement',preview:await store.asset(p,bytes,'glb','original'),blend:await store.asset(p,Buffer.from('BLENDERfixture'),'blend','original')};
  p.rigDonors=[{id:'donor',sourcePlacementId:source.id,asset:await store.asset(p,fixture(),'glb','donor'),profile:f.donor}];await store.save(p);
  const app=express();app.use(express.json());mountRigRefinement(app,{store,editable:()=>{},riggingSource:()=>source});app.use((e,q,s,n)=>s.status(e.status||500).json({error:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/rigging/refinement`;
  const post=async endpoint=>{const r=await fetch(base+endpoint,{method:'POST'});return {status:r.status,data:await r.json()};};
  const prepared=await post('/prepare');assert.equal(prepared.status,200);const run=prepared.data.runs[0],output=path.join(run.workspace,'output');
  const metrics={unweightedVertices:0,unnormalizedVertices:0,maxInfluences:1};
  const report={schema:'workbench-rig-refinement-review/v1',reviewRequired:true,originalMeshPreserved:true,donorMeshExcluded:true,skeletonTransferred:true,weightsReviewed:true,auxiliariesReviewed:true,correctivesReviewed:true,alignment:{matrix:new THREE.Matrix4().toArray(),maxDistanceMeters:0},observations:['Synthetic contract test'],limitations:['No artistic validation'],bodyRig:{profile:f.fixed.id,stageOrder:['transfer','fixed-body-support','hair-and-clothing-chains','weight-refinement','deformation-review'],meshInventory:[{mesh:'Body',kind:'body',decision:'follows-body',reason:'Synthetic combined fixture'}],weightAudit:{before:metrics,after:metrics,regionChecks:[{mesh:'Body',region:'fixture',allowedBones:[f.runtime.humanoid.Hips],removedDisallowedWeight:0}],poseChecks:f.fixed.reviewPoses.map(c=>({...c,passed:true,maxUnintendedDisplacementMeters:0,evidence:['review/fixture.png']}))}}};
  await fs.copyFile(path.join(run.workspace,'manifest.json'),path.join(output,'manifest.json'));
  for(const [name,data] of Object.entries({'rigged.glb':bytes,'rigged.blend':'BLENDERfixture','runtime.json':JSON.stringify(f.runtime),'report.json':JSON.stringify(report)}))await fs.writeFile(path.join(output,name),data);
  const endpoint=`/runs/${run.id}/import`;assert.notEqual((await post(endpoint)).status,200);
  await fs.mkdir(path.join(output,'review'));await fs.writeFile(path.join(output,'review/fixture.png'),png);
  const accepted=await post(endpoint);assert.equal(accepted.status,200,JSON.stringify(accepted.data));assert.equal(accepted.data.runs[0].validation.bodySupportProfileVerified,true);assert.equal(accepted.data.runs[0].validation.secondaryBoneCount,7);
  assert.equal((await post(endpoint)).data.duplicate,true);
});

import {Matrix4,Vector3,Quaternion} from 'three';
import {readFileSync} from 'node:fs';
import {inspectRiggedGlb} from './rigging-validation.js';
export const bodySupportProfile=JSON.parse(readFileSync(new URL('../templates/rigs/auxiliary-v1.json',import.meta.url),'utf8'));
const fail=message=>{throw Object.assign(Error(message),{status:400});};
const doc=bytes=>JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
const vector=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
const axis=a=>vector(a)&&Math.abs(Math.hypot(...a)-1)<.001;
export function validateRigRuntime(bytes,runtime,profile,{requiredSupportProfile=null}={}){
  const d=doc(bytes),joints=new Set(d.skins.flatMap(s=>s.joints)),names=new Set([...joints].map(i=>d.nodes[i].name));
  if(runtime.schema!=='workbench-rig-runtime/v1'||!Array.isArray(runtime.twists)||!Array.isArray(runtime.correctives)||runtime.twists.length+runtime.correctives.length>128||Object.entries(profile.humanoid).some(([k,n])=>runtime.humanoid?.[k]!==n))fail('Invalid rig runtime mapping.');
  const targets=new Set(),morphTargets=new Set(),core=new Set(profile.bones.map(b=>b.name)),sources=new Set();
  const supportEnabled=requiredSupportProfile===bodySupportProfile.id||runtime.auxiliaryProfile===bodySupportProfile.id;
  if(requiredSupportProfile&&runtime.auxiliaryProfile!==requiredSupportProfile)fail('Return the required body support profile: '+requiredSupportProfile);
  const equivalents=new Set(supportEnabled?Object.values(runtime.supportBones||{}):[]),anatomical=new Set(Object.values(profile.humanoid));
  if(runtime.shoulders!==undefined&&(!Array.isArray(runtime.shoulders)||runtime.shoulders.length>2))fail('Invalid shoulder coupling.');
  const shoulderTargets=new Set();
  for(const r of runtime.shoulders||[]){
    const side=['L','R'].find(s=>runtime.humanoid['Shoulder_'+s]===r.target);
    if(!side||runtime.humanoid['UpperArm_'+side]!==r.source||profile.bones.find(b=>b.name===r.source)?.parent!==r.target||!axis(r.axis)||!axis(r.rotationAxis)||![r.activationAngle,r.ratio,r.maximumRotationAngle].every(Number.isFinite)||r.activationAngle<0||r.activationAngle>Math.PI/2||r.ratio<0||r.ratio>1||r.maximumRotationAngle<0||r.maximumRotationAngle>Math.PI/2||shoulderTargets.has(r.target))fail('Invalid anatomical shoulder coupling.');
    shoulderTargets.add(r.target);
  }
  const target=name=>{if(!names.has(name)||core.has(name)&&(!equivalents.has(name)||anatomical.has(name))||targets.has(name))fail('Auxiliary runtime targets must be unique support bones, never anatomical joints.');targets.add(name);};
  for(const r of runtime.twists){
    if(!names.has(r.source)||!axis(r.axis)||!Number.isFinite(r.fraction)||r.fraction<0||r.fraction>1||!['twist','swing-twist'].includes(r.mode))fail('Invalid twist runtime recipe.');
    target(r.target);sources.add(r.source);
  }
  // Secondary chains follow their parent at rest. No browser physics is implied.
  const parents=new Map();d.nodes.forEach(n=>n.children?.forEach(i=>parents.set(d.nodes[i].name,n.name)));
  const meshNames=new Set(d.nodes.filter(n=>n.mesh!==undefined).map(n=>n.name));
  if(runtime.secondary!==undefined&&(!Array.isArray(runtime.secondary)||runtime.secondary.length>128))fail('Invalid secondary chain inventory.');
  let secondaryCount=0;
  for(const chain of runtime.secondary||[]){
    if(!supportEnabled||!['breast','glute','hair','clothing'].includes(chain.kind)||!Array.isArray(chain.bones)||!chain.bones.length||(secondaryCount+=chain.bones.length)>256||!names.has(chain.attachment)||!Array.isArray(chain.meshes)||!chain.meshes.length||chain.meshes.some(n=>!meshNames.has(n))||typeof chain.region!=='string'||!chain.region.trim()||chain.simulated!==false)fail('Invalid secondary chain declaration.');
    chain.bones.forEach((name,i)=>{
      if(core.has(name)&&!equivalents.has(name)){
        if(anatomical.has(name)||targets.has(name))fail('Secondary chains cannot replace anatomical joints.');
        targets.add(name);
      }else target(name);
      if(parents.get(name)!==(i?chain.bones[i-1]:chain.attachment))fail('Secondary chain hierarchy does not match the exported bones.');
    });
  }
  for(const r of runtime.correctives){
    if(!names.has(r.source)||!axis(r.axis)||![r.start,r.end].every(Number.isFinite)||r.start===r.end||Math.max(Math.abs(r.start),Math.abs(r.end))>Math.PI)fail('Invalid corrective activation.');sources.add(r.source);
    if(r.targetBone){target(r.targetBone);if(!vector(r.translation)||!axis(r.rotationAxis)||!Number.isFinite(r.rotationAngle)||Math.abs(r.rotationAngle)>Math.PI)fail('Invalid corrective bone motion.');}
    else{
      const meshes=d.nodes.filter(n=>n.mesh!==undefined&&n.name===r.targetMesh),mesh=d.meshes[meshes[0]?.mesh];
      const morph=mesh?.extras?.targetNames?.indexOf(r.morph);
      const id=`${r.targetMesh}:${r.morph}`;
      if(meshes.length!==1||!Number.isInteger(morph)||morph<0||!mesh.primitives.every(p=>p.targets?.[morph]?.POSITION!==undefined)||morphTargets.has(id)||!Number.isFinite(r.maxWeight)||r.maxWeight<=0||r.maxWeight>1)fail('Invalid corrective shape key target.');morphTargets.add(id);
    }
  }
  if(supportEnabled){
    const weighted=new Set(inspectRiggedGlb(bytes,profile).weightedBoneNames);
    const support=runtime.supportBones;
    const roles=bodySupportProfile.sides.flatMap(side=>bodySupportProfile.requiredBonesPerSide.map(b=>({side,b,role:b.name.replaceAll('{side}',side)})));
    if(!support||Object.keys(support).length!==roles.length||new Set(Object.values(support)).size!==roles.length)fail('Declare every fixed body support role exactly once.');
    const resolve=(role,side)=>{
      const key=role.replaceAll('{side}',side);
      return runtime.humanoid[key]||(key.startsWith('Shoulder_')?runtime.humanoid.Chest||runtime.humanoid.UpperChest||runtime.humanoid.Spine:key==='Chest'?runtime.humanoid.UpperChest||runtime.humanoid.Spine:null);
    };
    for(const {side,b,role} of roles){
      const name=support[role];
      if(!names.has(name)||anatomical.has(name)||!weighted.has(name))fail('Required body support role is missing or unweighted: '+role);
      if(parents.get(name)!==resolve(b.parentRole,side))fail('Incorrect support attachment: '+role);
      if(b.kind==='twist'){
        const r=runtime.twists.find(r=>r.target===name);
        if(!r||r.source!==resolve(b.sourceRole,side)||r.mode!==b.mode||Math.abs(r.fraction-b.fraction)>1e-6)fail('Incorrect distributed twist recipe: '+role);
      }else if(b.kind==='bone-corrective'){
        const r=runtime.correctives.find(r=>r.targetBone===name);
        if(!r||r.source!==resolve(b.jointRole,side)||Math.abs(Math.abs(r.start)-b.activationDegrees[0]*Math.PI/180)>1e-5||Math.abs(Math.abs(r.end)-b.activationDegrees[1]*Math.PI/180)>1e-5||r.start*r.end<=0)fail('Incorrect joint-volume recipe: '+role);
      }else{
        const r=runtime.secondary?.find(c=>c.bones.includes(name));
        if(!r||r.kind!==b.region||r.bones.length!==1)fail('Missing fixed tissue physics anchor: '+role);
      }
    }
    const fixed=new Set(Object.values(support));
    for(const name of targets)if(!fixed.has(name)&&!core.has(name)&&!runtime.secondary?.some(c=>['hair','clothing'].includes(c.kind)&&c.bones.includes(name)))fail('Additional support families are not part of the fixed body profile.');
    for(const c of runtime.secondary||[])if(['hair','clothing'].includes(c.kind)&&!c.bones.some(n=>weighted.has(n)))fail('A hair/clothing chain needs actual regional skin weights.');
  }
  // Recipes depend on anatomical motion, never on each other (stable evaluation order).
  if([...sources].some(s=>targets.has(s)))fail('Runtime recipes cannot depend on another auxiliary target.');
  for(const name of names)if(!core.has(name)&&!targets.has(name))fail('Every added bone needs a runtime recipe: '+name);
  for(const n of d.nodes.filter(n=>n.mesh!==undefined)){
    const m=d.meshes[n.mesh],weights=n.weights||m.weights||[];
    if(weights.some(w=>!Number.isFinite(w)||Math.abs(w)>1e-6))fail('Export the rig in rest pose with corrective shape keys at zero.');
    for(const name of m.extras?.targetNames||[])if(!morphTargets.has(`${n.name}:${name}`))fail('Every corrective shape key needs a runtime recipe: '+name);
  }
  return true;
}
export function validateTransferredJoints(donorBytes,resultBytes,alignment){
  const matrix=new Matrix4().fromArray(alignment),x=new Vector3().setFromMatrixColumn(matrix,0),y=new Vector3().setFromMatrixColumn(matrix,1),z=new Vector3().setFromMatrixColumn(matrix,2),scale=x.length();
  if(!Number.isFinite(matrix.determinant())||matrix.determinant()<=0||scale<.0001||scale>10000||Math.abs(y.length()/scale-1)>.0001||Math.abs(z.length()/scale-1)>.0001||Math.abs(x.dot(y)/scale**2)>.0001||Math.abs(x.dot(z)/scale**2)>.0001||Math.abs(y.dot(z)/scale**2)>.0001||[matrix.elements[3],matrix.elements[7],matrix.elements[11],matrix.elements[15]-1].some(n=>Math.abs(n)>1e-8))fail('Use one uniform alignment transform for the donor skeleton.');
  const world=bytes=>{const d=doc(bytes),result=new Map(),seen=new Set();const walk=(i,parent)=>{if(seen.has(i))fail('Invalid skeleton hierarchy.');seen.add(i);const n=d.nodes[i],local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3(...n.translation||[0,0,0]),new Quaternion(...n.rotation||[0,0,0,1]),new Vector3(...n.scale||[1,1,1])),m=parent.clone().multiply(local);result.set(n.name,new Vector3().setFromMatrixPosition(m));for(const c of n.children||[])walk(c,m);};for(const i of d.scenes[d.scene||0].nodes)walk(i,new Matrix4());return result;};
  const d=doc(donorBytes),before=world(donorBytes),after=world(resultBytes);let maximum=0;
  for(const i of new Set(d.skins.flatMap(s=>s.joints))){const name=d.nodes[i].name,pos=after.get(name);if(!pos)fail('The donor skeleton is incomplete.');const distance=before.get(name).clone().applyMatrix4(matrix).distanceTo(pos);if(!Number.isFinite(distance)||distance>.0001)fail('The result individually moved a donor joint: '+name);maximum=Math.max(maximum,distance);}
  return {donorJointPlacementPreserved:true,maxJointAlignmentErrorMeters:maximum};
}

// This gates completeness and measured audit fields, not artistic certification.
export function validateBodyRigReview(bytes,runtime,report,validation){
  const review=report.bodyRig,d=doc(bytes),meshes=new Set(d.nodes.filter(n=>n.mesh!==undefined).map(n=>n.name));
  const order=['transfer','fixed-body-support','hair-and-clothing-chains','weight-refinement','deformation-review'];
  if(review?.profile!==bodySupportProfile.id||JSON.stringify(review.stageOrder)!==JSON.stringify(order)||!Array.isArray(review.meshInventory)||!review.meshInventory.length)fail('Return the ordered body rig review and mesh inventory.');
  const inventoried=new Set();
  for(const entry of review.meshInventory){
    if(!meshes.has(entry.mesh)||!['body','face','hair','clothing','accessory'].includes(entry.kind)||!['chains','follows-body','rigid'].includes(entry.decision)||typeof entry.reason!=='string'||!entry.reason.trim())fail('Invalid body rig mesh inventory.');
    if(entry.decision==='chains'&&!runtime.secondary.some(c=>c.meshes.includes(entry.mesh)&&c.kind===entry.kind))fail('Inventory claims a missing secondary chain.');
    inventoried.add(entry.mesh);
  }
  if([...meshes].some(n=>!inventoried.has(n)))fail('Inventory every original mesh, including hair and clothing.');
  const audit=review.weightAudit,fields=['unweightedVertices','unnormalizedVertices','maxInfluences'];
  if(!audit||['before','after'].some(k=>fields.some(f=>!Number.isInteger(audit[k]?.[f])||audit[k][f]<0))||fields.some(f=>audit.after[f]!==validation[f]))fail('Weight audit does not match the exported skin.');
  const bones=new Set(d.skins.flatMap(s=>s.joints).map(i=>d.nodes[i].name));
  if(!Array.isArray(audit.regionChecks)||!audit.regionChecks.length)fail('Return the anatomical region weight audit.');
  for(const r of audit.regionChecks)if(!meshes.has(r.mesh)||typeof r.region!=='string'||!r.region.trim()||!Array.isArray(r.allowedBones)||!r.allowedBones.length||r.allowedBones.some(n=>!bones.has(n))||!Number.isFinite(r.removedDisallowedWeight)||r.removedDisallowedWeight<0)fail('Invalid anatomical weight region audit.');
  if(!Array.isArray(audit.poseChecks))fail('Return the measured before/after pose checks.');
  const evidence=new Set();
  for(const required of bodySupportProfile.reviewPoses){
    const checks=audit.poseChecks.filter(c=>c.test===required.test&&c.side===required.side),c=checks[0];
    if(checks.length!==1||c.passed!==true||!Number.isFinite(c.maxUnintendedDisplacementMeters)||c.maxUnintendedDisplacementMeters<0||c.maxUnintendedDisplacementMeters>.001||!Array.isArray(c.evidence)||!c.evidence.length)fail('Missing or failed body rig pose check: '+required.test+' '+required.side);
    for(const file of c.evidence){
      if(typeof file!=='string'||!/^review\/[a-zA-Z0-9_/-]+\.(png|jpg|jpeg)$/.test(file)||file.includes('..')||file.includes('//'))fail('Pose evidence must be inside output/review.');
      evidence.add(file);
    }
  }
  return [...evidence];
}

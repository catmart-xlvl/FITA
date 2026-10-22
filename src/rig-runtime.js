import * as THREE from 'three';
// Declarative pose drivers shared by every built-in test clip. No expressions,
// scripts or Blender driver code are evaluated in the browser.
export function createRigRuntime(root,config,lookup){
  const quaternions=new Map(),positions=new Map(),world=new Map(),morphRest=new Map();
  root.updateMatrixWorld(true);root.traverse(n=>{quaternions.set(n,n.quaternion.clone());positions.set(n,n.position.clone());world.set(n,n.getWorldQuaternion(new THREE.Quaternion()));if(n.morphTargetInfluences)morphRest.set(n,[...n.morphTargetInfluences]);});
  const twists=(config?.twists||[]).map(r=>{
    const target=lookup(r.target),source=lookup(r.source);if(!target||!source)return null;
    return {...r,target,source,axis:new THREE.Vector3(...r.axis),frame:world.get(target).clone().invert().multiply(world.get(source))};
  }).filter(Boolean);
  const correctives=(config?.correctives||[]).map(r=>{
    const source=lookup(r.source),target=r.targetBone?lookup(r.targetBone):null,meshes=[];
    if(r.targetMesh)root.traverse(n=>{if(n.isMesh&&(n.userData.workbenchSourceName||n.name)===r.targetMesh&&n.morphTargetDictionary?.[r.morph]!==undefined)meshes.push(n);});
    return source?{...r,source,target,meshes,axis:new THREE.Vector3(...r.axis)}:null;
  }).filter(Boolean);
  const shoulders=(config?.shoulders||[]).map(r=>{
    const target=lookup(r.target),source=lookup(r.source);
    return target&&source?{...r,target,source,axis:new THREE.Vector3(...r.axis),rotationAxis:new THREE.Vector3(...r.rotationAxis)}:null;
  }).filter(Boolean);
  function delta(n){const q=quaternions.get(n).clone().invert().multiply(n.quaternion).normalize();return q.w<0?q.set(-q.x,-q.y,-q.z,-q.w):q;}
  function signedTwist(q,a){const dot=q.x*a.x+q.y*a.y+q.z*a.z;return Math.hypot(dot,q.w)>1e-8?2*Math.atan2(dot,q.w):0;}
  function update({animatedShoulders=false}={}){
    for(const r of animatedShoulders?[]:shoulders){
      const angle=THREE.MathUtils.clamp((signedTwist(delta(r.source),r.axis)-r.activationAngle)*r.ratio,0,r.maximumRotationAngle);
      r.target.quaternion.copy(quaternions.get(r.target)).multiply(new THREE.Quaternion().setFromAxisAngle(r.rotationAxis,angle));
    }
    for(const r of twists){
      const q=delta(r.source).premultiply(r.frame).multiply(r.frame.clone().invert()).normalize(),angle=signedTwist(q,r.axis),twist=new THREE.Quaternion().setFromAxisAngle(r.axis,angle),reduced=new THREE.Quaternion().setFromAxisAngle(r.axis,angle*r.fraction);
      const pose=r.mode==='swing-twist'?q.multiply(twist.invert()).multiply(reduced):reduced;r.target.quaternion.copy(quaternions.get(r.target)).multiply(pose);
    }
    for(const r of correctives){
      let weight=THREE.MathUtils.clamp((signedTwist(delta(r.source),r.axis)-r.start)/(r.end-r.start),0,1);weight=weight*weight*(3-2*weight);
      if(r.target){r.target.position.copy(positions.get(r.target)).addScaledVector(new THREE.Vector3(...r.translation),weight);r.target.quaternion.copy(quaternions.get(r.target)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...r.rotationAxis),weight*r.rotationAngle));}
      else for(const mesh of r.meshes)mesh.morphTargetInfluences[mesh.morphTargetDictionary[r.morph]]=weight*r.maxWeight;
    }
  }
  function reset(){for(const r of shoulders)r.target.quaternion.copy(quaternions.get(r.target));for(const r of twists)r.target.quaternion.copy(quaternions.get(r.target));for(const r of correctives)if(r.target){r.target.position.copy(positions.get(r.target));r.target.quaternion.copy(quaternions.get(r.target));}for(const [mesh,values] of morphRest)mesh.morphTargetInfluences.splice(0,values.length,...values);}
  return {update,reset};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRigRuntime} from '../src/rig-runtime.js';

test('clavicle coupling follows arm elevation in fitted frames without accumulating or changing rest',()=>{
 const root=new THREE.Group(),shoulder=new THREE.Bone(),upper=new THREE.Bone();shoulder.name='Left_Shoulder';upper.name='Left_UpperArm';root.add(shoulder);shoulder.add(upper);
 shoulder.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),.35);upper.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),-.45);upper.position.set(.1,0,0);root.updateMatrixWorld(true);
 const restShoulder=shoulder.quaternion.clone(),restUpper=upper.quaternion.clone(),worldAxis=new THREE.Vector3(0,0,1),axis=worldAxis.clone().applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()).invert()),rotationAxis=worldAxis.clone().applyQuaternion(shoulder.getWorldQuaternion(new THREE.Quaternion()).invert());
 const recipe={source:upper.name,target:shoulder.name,axis:axis.toArray(),rotationAxis:rotationAxis.toArray(),activationAngle:THREE.MathUtils.degToRad(5),ratio:.55,maximumRotationAngle:THREE.MathUtils.degToRad(35)};
 const lookup=name=>name===upper.name?upper:name===shoulder.name?shoulder:null,runtime=createRigRuntime(root,{shoulders:[recipe]},lookup);
 for(const degrees of [0,10,40,67,90,-30]){
  upper.quaternion.copy(restUpper).multiply(new THREE.Quaternion().setFromAxisAngle(axis,THREE.MathUtils.degToRad(degrees)));runtime.update();
  const expected=restShoulder.clone().multiply(new THREE.Quaternion().setFromAxisAngle(rotationAxis,Math.min(recipe.maximumRotationAngle,Math.max(0,THREE.MathUtils.degToRad(degrees)-recipe.activationAngle)*recipe.ratio)));
  assert(shoulder.quaternion.angleTo(expected)<1e-7);
  const once=shoulder.quaternion.clone();for(let i=0;i<8;i++)runtime.update();assert(shoulder.quaternion.angleTo(once)<1e-7);
 }
 runtime.reset();assert(shoulder.quaternion.angleTo(restShoulder)<1e-7);
});

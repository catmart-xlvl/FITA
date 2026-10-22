import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {keepAnimatedMeshesVisible} from '../src/viewer-visibility.js';
import {createSecondaryContacts} from '../src/secondary-collisions.js';

function skin(root,name,geometry,bone){
  const count=geometry.attributes.position.count,indices=new Uint16Array(count*4),weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());mesh.name=name;mesh.userData.workbenchSourceName=name;root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton([bone]));return mesh;
}
test('close-view hands and face pieces remain renderable after leaving the cached rest sphere, including wire clones',()=>{
  const root=new THREE.Group(),bone=new THREE.Bone();bone.position.x=2;root.add(bone);
  const hand=skin(root,'Hand',new THREE.BoxGeometry(.1,.1,.1).translate(2,0,0),bone);hand.computeBoundingSphere();bone.position.x=0;root.updateMatrixWorld(true);
  const camera=new THREE.PerspectiveCamera(35,1,.001,100);camera.position.z=.5;camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  assert.equal(frustum.intersectsObject(hand),false,'reproduces stale rest-bound culling');assert(frustum.containsPoint(hand.getVertexPosition(0,new THREE.Vector3())));
  assert.equal(keepAnimatedMeshesVisible(root),1);assert.equal(hand.frustumCulled,false);assert.equal(hand.clone(false).frustumCulled,false);
});
test('hair surface contacts exclude the face without changing the mesh or moving the chain attachment',()=>{
  const root=new THREE.Group(),head=new THREE.Bone(),a=new THREE.Bone(),b=new THREE.Bone();head.name='Head';a.name='Lock1';b.name='Lock2';head.position.y=1.6;root.add(head);head.add(a);a.position.set(.12,.15,.03);a.add(b);b.position.y=-.2;
  skin(root,'rostro export',new THREE.BoxGeometry(.18,.28,.18).translate(0,1.6,0),head);
  const hair=skin(root,'cabello export',new THREE.BoxGeometry(.03,.24,.035).translate(.12,1.60,.03),a),original=hair.geometry.attributes.position.array.slice(),attachment=a.position.clone(),length=b.position.length();
  const contacts=createSecondaryContacts(root,{humanoid:{Head:'Head'},secondary:[{kind:'hair',bones:['Lock1','Lock2'],meshes:['cabello export']}]},n=>root.getObjectByName(n),[{bone:a},{bone:b}],2);
  a.rotation.z=-.45;root.updateMatrixWorld(true);const before=contacts.verifySurface();assert(before.maximumPenetration>.02,'surface penetrates face despite a free chain tip');contacts.solve();
  assert(contacts.verifySurface().maximumPenetration<.001);assert(a.position.distanceTo(attachment)<1e-9);assert.equal(b.position.length(),length);assert.deepEqual(hair.geometry.attributes.position.array,original);contacts.dispose();
});
test('a moving thigh pushes skirt surfaces to their original outward side and preserves the chain lengths',()=>{
  const root=new THREE.Group(),left=new THREE.Bone(),right=new THREE.Bone(),knee=new THREE.Bone(),otherKnee=new THREE.Bone(),foot=new THREE.Bone(),otherFoot=new THREE.Bone(),a=new THREE.Bone(),b=new THREE.Bone();
  for(const [bone,name] of [[left,'ThighL'],[right,'ThighR'],[knee,'KneeL'],[otherKnee,'KneeR'],[foot,'FootL'],[otherFoot,'FootR'],[a,'Skirt1'],[b,'Skirt2']])bone.name=name;
  root.add(left,right,a);left.position.set(.08,1,0);right.position.set(-.08,1,0);left.add(knee);right.add(otherKnee);knee.position.y=otherKnee.position.y=-.45;knee.add(foot);otherKnee.add(otherFoot);foot.position.y=otherFoot.position.y=-.45;a.position.set(.12,1.05,.10);a.add(b);b.position.y=-.18;
  skin(root,'piernas export',new THREE.BoxGeometry(.11,.40,.15).translate(.08,.79,0),left);skin(root,'piernas export',new THREE.BoxGeometry(.11,.40,.15).translate(-.08,.79,0),right);
  skin(root,'vestuario export',new THREE.BoxGeometry(.12,.30,.015).translate(.12,.88,.10),a);
  const contacts=createSecondaryContacts(root,{humanoid:{UpperLeg_L:'ThighL',UpperLeg_R:'ThighR',LowerLeg_L:'KneeL',LowerLeg_R:'KneeR',Foot_L:'FootL',Foot_R:'FootR'},secondary:[{kind:'clothing',bones:['Skirt1','Skirt2'],meshes:['vestuario export']}]},n=>root.getObjectByName(n),[{bone:a},{bone:b}],2);
  left.rotation.x=-.4;root.updateMatrixWorld(true);assert(contacts.verifySurface().maximumPenetration>.005);contacts.solve();assert(contacts.verifySurface().maximumPenetration<.001);assert(Math.abs(b.position.length()-.18)<1e-9);assert(a.quaternion.length()> .999999);contacts.dispose();
});

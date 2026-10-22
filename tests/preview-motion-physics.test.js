import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createSecondaryPhysics} from '../src/secondary-physics.js';import {retargetMotionLibrary} from '../src/animation-retarget.js';
globalThis.ProgressEvent??=class ProgressEvent{constructor(type,args){this.type=type;Object.assign(this,args);}};
test('secondary preview responds to impulse, stays finite and bounded, then restores every rest transform',()=>{
 const root=new THREE.Group(),head=new THREE.Bone(),a=new THREE.Bone(),b=new THREE.Bone();head.name='Head';a.name='Hair1';b.name='Hair2';root.add(head);head.add(a);a.position.set(0,1,0);a.add(b);b.position.set(0,-.2,0);const rest=a.quaternion.clone(),p=a.position.clone();
 const config={humanoid:{Head:'Head'},secondary:[{kind:'hair',bones:['Hair1','Hair2'],attachment:'Head',simulated:false}]};const physics=createSecondaryPhysics(root,config,n=>root.getObjectByName(n));
 physics.enable(true);physics.impulse();let peak=0;for(let i=0;i<120;i++){physics.restore();physics.update(1/60);peak=Math.max(peak,a.quaternion.angleTo(rest));}assert(physics.audit().finite);assert.equal(physics.audit().steps,240);assert(peak>.001);assert(peak<Math.PI/3);assert(a.position.distanceTo(p)<1e-8);
 physics.enable(false);assert(a.quaternion.angleTo(rest)<1e-8);assert(a.position.distanceTo(p)<1e-8);
 physics.dispose();
});
test('single tissue anchor translates only within its bounded motion and has no rest offset',()=>{
 const root=new THREE.Group(),chest=new THREE.Bone(),anchor=new THREE.Bone();root.add(chest);chest.add(anchor);anchor.name='Breast';anchor.position.set(.04,.1,.08);const p=anchor.position.clone(),config={secondary:[{kind:'breast',bones:['Breast']} ]},physics=createSecondaryPhysics(root,config,n=>root.getObjectByName(n));
 physics.enable(true);physics.impulse();for(let i=0;i<30;i++){physics.restore();physics.update(1/60);}assert(anchor.position.distanceTo(p)<.01);assert(physics.audit().finite);physics.enable(false);assert(anchor.position.distanceTo(p)<1e-8);
});
test('collision projection retains segment length and normalized bone rotation',()=>{
 const root=new THREE.Group(),hips=new THREE.Bone(),chest=new THREE.Bone(),head=new THREE.Bone(),foot=new THREE.Bone(),a=new THREE.Bone(),b=new THREE.Bone();hips.name='Hips';chest.name='Chest';head.name='Head';foot.name='Foot';a.name='Hair1';b.name='Hair2';root.add(hips,chest,head,foot,a);hips.position.y=.8;chest.position.y=1.4;head.position.y=1.3;a.position.set(.09,1.1,0);a.add(b);b.position.y=-.2;
 const config={humanoid:{Hips:'Hips',Chest:'Chest',Head:'Head',Foot_L:'Foot'},secondary:[{kind:'hair',bones:['Hair1','Hair2']}]};const physics=createSecondaryPhysics(root,config,n=>root.getObjectByName(n));physics.enable(true);
 for(let i=0;i<120;i++){physics.restore();physics.update(1/60);assert(physics.audit().finite);assert(physics.audit().normalized);assert(Math.abs(a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()))-.2)<1e-6);}
 assert(physics.audit().collisions>0);
});
test('actual CC0 library retarget keeps target rest intact and supplies articulated dance, walk and idle',async()=>{
 const bytes=await fs.readFile(new URL('../public/animations/quaternius/library.glb',import.meta.url)),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),loader=new GLTFLoader();const library=await loader.parseAsync(buffer,'');
 const target=library.scene.clone(true),lookup=n=>target.getObjectByName(n);const humanoid={Hips:'pelvis',Spine:'spine_01',Chest:'spine_02',UpperChest:'spine_03',Neck:'neck_01',Head:'Head'};
 for(const side of ['L','R'])for(const [role,name] of Object.entries({Shoulder:'clavicle',UpperArm:'upperarm',LowerArm:'lowerarm',Hand:'hand',UpperLeg:'thigh',LowerLeg:'calf',Foot:'foot',Toes:'ball'}))humanoid[role+'_'+side]=name+'_'+side.toLowerCase();
 const before=new Map();target.traverse(n=>before.set(n.uuid,{q:n.quaternion.clone(),p:n.position.clone()}));const clips=retargetMotionLibrary(target,library.scene,library.animations,humanoid,lookup);
 assert.equal(clips.length,3);assert(clips.every(c=>c.userData.license==='CC0 1.0'&&c.duration>0&&c.tracks.length>20));assert(clips[0].tracks.some(t=>t.name===lookup('calf_l').uuid+'.quaternion'));
 target.traverse(n=>{const original=before.get(n.uuid);assert(n.quaternion.toArray().every((v,i)=>Math.abs(v-original.q.toArray()[i])<1e-8),n.name+' rest quaternion changed');assert(n.position.distanceTo(original.p)<1e-8);});
 const mixer=new THREE.AnimationMixer(target);mixer.clipAction(clips[0]).play();mixer.setTime(clips[0].duration*.3);target.updateMatrixWorld(true);assert(lookup('upperarm_l').quaternion.angleTo(before.get(lookup('upperarm_l').uuid).q)>.05);assert(lookup('calf_l').quaternion.angleTo(before.get(lookup('calf_l').uuid).q)>.05);
});

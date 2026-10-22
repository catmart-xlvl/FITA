import * as THREE from 'three';

// Shared preview motion; geometry and the fitted target rest skeleton stay intact.
export const motionLibrary={url:'/animations/quaternius/library.glb',author:'Quaternius',license:'CC0 1.0',source:'https://quaternius.itch.io/universal-animation-library'};
const map={Hips:'pelvis',Spine:'spine_01',Chest:'spine_02',UpperChest:'spine_03',Neck:'neck_01',Head:'Head'};
for(const side of ['L','R']){
 const s=side.toLowerCase();
 for(const [role,name] of Object.entries({Shoulder:'clavicle',UpperArm:'upperarm',LowerArm:'lowerarm',Hand:'hand',UpperLeg:'thigh',LowerLeg:'calf',Foot:'foot',Toes:'ball'}))map[role+'_'+side]=name+'_'+s;
 for(const [role,name] of Object.entries({Thumb:'thumb',Index:'index',Middle:'middle',Ring:'ring',Little:'pinky'}))for(let i=1;i<=3;i++)map[`${role}_0${i}_${side}`]=`${name}_0${i}_${s}`;
}
const selection=[['Dance_Loop','Dance · Quaternius'],['Walk_Loop','Walk · Quaternius'],['Idle_Talking_Loop','Natural idle · Quaternius']];
const fitaMap={Hips:'Hips',Spine:'Spine',Chest:'Chest',UpperChest:'UpperChest',Neck:'Neck',Head:'Head'};
for(const [side,prefix] of [['L','Left'],['R','Right']]){
 for(const role of ['Shoulder','UpperArm','LowerArm','Hand','UpperLeg','LowerLeg','Foot','Toes'])fitaMap[role+'_'+side]=prefix+'_'+role;
 for(const [role,name] of Object.entries({Thumb:'Thumb',Index:'Index',Middle:'Middle',Ring:'Ring',Little:'Pinky'}))for(const [i,segment] of ['Proximal','Intermediate','Distal'].entries())fitaMap[`${role}_0${i+1}_${side}`]=`${prefix}_${name}${segment}`;
}
// Compatibility metadata only. This optional local clip is not distributed.
export const idolMotionLibrary={url:null,author:'FITA',source:null,boneMap:fitaMap,selection:[],fps:60,loop:false};
export const motionLibraries=[motionLibrary];
const pos=n=>n.getWorldPosition(new THREE.Vector3()),quat=n=>n.getWorldQuaternion(new THREE.Quaternion()).normalize();
function basis(hips,head,left,right){const up=pos(head).sub(pos(hips)).normalize(),x=pos(left).sub(pos(right)).normalize();x.addScaledVector(up,-x.dot(up)).normalize();const z=x.clone().cross(up).normalize();return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,up,z));}
export function retargetMotionLibrary(target,source,animations,humanoid,lookup,options={}){
 const {fps=30,boneMap=map,selection:chosen=selection,loop=true,...metadata}=options;
 const sourceBones=new Map();source.traverse(n=>sourceBones.set(n.name,n));
 const pairs=Object.entries(boneMap).map(([role,name])=>({role,source:sourceBones.get(name),target:lookup(humanoid[role])})).filter(p=>p.source&&p.target);
 const hip=pairs.find(p=>p.role==='Hips');if(!hip||pairs.length<15)throw Error('MOTION_HUMANOID_MAPPING_INCOMPLETE');
 const saved=[];target.traverse(n=>saved.push({n,q:n.quaternion.clone(),p:n.position.clone(),s:n.scale.clone()}));
 const sourceSaved=[];source.traverse(n=>sourceSaved.push({n,q:n.quaternion.clone(),p:n.position.clone(),s:n.scale.clone()}));
 const restore=rows=>rows.forEach(({n,q,p,s})=>{n.quaternion.copy(q);n.position.copy(p);n.scale.copy(s);});
 const mixer=new THREE.AnimationMixer(source),tpose=animations.find(c=>c.name==='A_TPose');
 if(tpose){mixer.clipAction(tpose).play();mixer.setTime(0);}
 source.updateMatrixWorld(true);target.updateMatrixWorld(true);
 const sourceRest=new Map(pairs.map(p=>[p.role,quat(p.source)])),targetRest=new Map(pairs.map(p=>[p.role,quat(p.target)]));
 const get=(role,key)=>pairs.find(p=>p.role===role)[key];
 const align=basis(get('Hips','target'),get('Head','target'),get('UpperArm_L','target'),get('UpperArm_R','target')).multiply(basis(get('Hips','source'),get('Head','source'),get('UpperArm_L','source'),get('UpperArm_R','source')).invert());
 const sourceHip=pos(hip.source),targetHip=pos(hip.target),scale=pos(get('Head','target')).distanceTo(targetHip)/pos(get('Head','source')).distanceTo(sourceHip);
 const depth=n=>{let i=0;while(n.parent){i++;n=n.parent;}return i;};pairs.sort((a,b)=>depth(a.target)-depth(b.target));
 const clips=[];
 try{
  for(const [originalName,label] of chosen){
   const clip=animations.find(c=>c.name===originalName);if(!clip)continue;
   mixer.stopAllAction();restore(sourceSaved);const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
   const count=Math.ceil(clip.duration*fps),times=Array.from({length:count+1},(_,i)=>Math.min(i/fps,clip.duration)),values=new Map(pairs.map(p=>[p.role,[]])),hipValues=[];
   for(const time of times){
    restore(saved);mixer.setTime(time);source.updateMatrixWorld(true);target.updateMatrixWorld(true);
    for(const p of pairs){
     const delta=quat(p.source).multiply(sourceRest.get(p.role).clone().invert());delta.premultiply(align).multiply(align.clone().invert());
     const desired=delta.multiply(targetRest.get(p.role));
     p.target.quaternion.copy(p.target.parent?quat(p.target.parent).invert().multiply(desired):desired).normalize();p.target.updateWorldMatrix(false,true);
     const row=values.get(p.role),q=p.target.quaternion;
     if(row.length&&new THREE.Quaternion().fromArray(row,row.length-4).dot(q)<0)q.set(-q.x,-q.y,-q.z,-q.w);
     row.push(...q.toArray());
    }
    const offset=pos(hip.source).sub(sourceHip).applyQuaternion(align).multiplyScalar(scale),point=targetHip.clone().add(offset);
    if(hip.target.parent)hip.target.parent.worldToLocal(point);hipValues.push(...point.toArray());
   }
   const tracks=pairs.map(p=>new THREE.QuaternionKeyframeTrack(p.target.uuid+'.quaternion',times,values.get(p.role)));
   tracks.push(new THREE.VectorKeyframeTrack(hip.target.uuid+'.position',times,hipValues));
   const output=new THREE.AnimationClip(label,clip.duration,tracks);output.userData={retargeted:true,animatedShoulders:true,sourceClip:originalName,...(options.boneMap?metadata:motionLibrary),loop,mappedRoles:pairs.map(p=>p.role)};clips.push(output);
  }
 }finally{mixer.stopAllAction();mixer.uncacheRoot(source);restore(saved);restore(sourceSaved);target.updateMatrixWorld(true);source.updateMatrixWorld(true);}
 return clips;
}

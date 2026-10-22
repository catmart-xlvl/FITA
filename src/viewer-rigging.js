import * as THREE from 'three';
import {inferHumanoidMap} from '../shared/humanoid-map.js';
import {createRigRuntime} from './rig-runtime.js';
import {createSecondaryPhysics} from './secondary-physics.js';
import {retargetMotionLibrary} from './animation-retarget.js';

// Small built-in diagnostic poses, independent of external clip providers.
// World axes are converted into each joint's fitted rest frame.
export function rigPreview(root,config={}){
  root.updateMatrixWorld(true);
  const bones=new Map(),rest=new Map(),restPositions=new Map(),world=new Map(),lines=[];
  root.traverse(node=>{if(node.isBone||/^WB_/.test(node.name)&&!node.isMesh){bones.set(node.name,node);rest.set(node.name,node.quaternion.clone());world.set(node.name,node.getWorldQuaternion(new THREE.Quaternion()));}});
  for(const [name,bone] of bones)restPositions.set(name,bone.position.clone());
  const originalNames=new Map([...bones.values()].map(n=>[n.userData.workbenchSourceName||n.name,n]));
  const humanoid=config.humanoid||inferHumanoidMap([...originalNames.keys()]);
  const resolve=name=>name?(originalNames.get(name)||bones.get(name)||originalNames.get(humanoid[name.replace(/^WB_/,'')])):null;
  if(!resolve('WB_Hips'))return null;
  const runtime=createRigRuntime(root,config,resolve);
  const physics=createSecondaryPhysics(root,config,resolve);
  for(const node of bones.values()){
    const tail=node.userData?.boneTail;
    if(Array.isArray(tail)&&tail.length===3)lines.push([node,null,new THREE.Vector3(...tail)]);
    else for(const child of node.children)if(bones.has(child.name))lines.push([node,child,null]);
  }
  const geometry=new THREE.BufferGeometry();
  const positions=new Float32Array(lines.length*6);
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const helper=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xe6e6e6,depthTest:false,transparent:true,opacity:.95}));
  helper.name='WorkbenchSkeletonOverlay';helper.renderOrder=1000;helper.frustumCulled=false;root.add(helper);
  const jointPositions=new Float32Array(bones.size*3),jointGeometry=new THREE.BufferGeometry();jointGeometry.setAttribute('position',new THREE.BufferAttribute(jointPositions,3));
  const markers=new THREE.Points(jointGeometry,new THREE.PointsMaterial({color:0xffffff,size:4,sizeAttenuation:false,depthTest:false}));markers.renderOrder=1001;markers.frustumCulled=false;helper.add(markers);
  function updateLines(){
    root.updateMatrixWorld(true);const a=new THREE.Vector3(),b=new THREE.Vector3();
    for(let i=0;i<lines.length;i++){const [node,child,tail]=lines[i];node.getWorldPosition(a);if(child)child.getWorldPosition(b);else b.copy(tail).applyMatrix4(node.matrixWorld);root.worldToLocal(a);root.worldToLocal(b);a.toArray(positions,i*6);b.toArray(positions,i*6+3);}
    geometry.attributes.position.needsUpdate=true;geometry.computeBoundingSphere();
    let index=0;for(const bone of bones.values()){bone.getWorldPosition(a);root.worldToLocal(a);a.toArray(jointPositions,index++*3);}jointGeometry.attributes.position.needsUpdate=true;jointGeometry.computeBoundingSphere();
  }
  function track(name,axis,values,times){
    const node=resolve(name);if(!node)return null;
    const localAxis=axis.clone().applyQuaternion(world.get(node.name).clone().invert()).normalize();
    return new THREE.QuaternionKeyframeTrack(node.uuid+'.quaternion',times,values.flatMap(angle=>rest.get(node.name).clone().multiply(new THREE.Quaternion().setFromAxisAngle(localAxis,angle)).toArray()));
  }
  const x=new THREE.Vector3(1,0,0),z=new THREE.Vector3(0,0,1);
  const times=[0,1,2,3,4],make=(name,specs)=>new THREE.AnimationClip(name,4,specs.map(([bone,axis,angles])=>track(bone,axis,angles,times)).filter(Boolean));
  const clips=[
    make('Idle', [['WB_Chest',z,[0,.015,0,-.015,0]],['WB_Head',x,[0,.025,0,-.025,0]]]),
    make('Arm raise', [['WB_UpperArm_L',z,[0,.48,.96,.48,0]],['WB_UpperArm_R',z,[0,-.48,-.96,-.48,0]]]),
    make('Elbow bend', [['WB_LowerArm_L',new THREE.Vector3(0,1,0),[0,-.6,-1.4,-.6,0]],['WB_LowerArm_R',new THREE.Vector3(0,1,0),[0,.6,1.4,.6,0]]]),
    make('Knee bend', [['WB_UpperLeg_L',x,[0,-.25,-.5,-.25,0]],['WB_UpperLeg_R',x,[0,-.25,-.5,-.25,0]],['WB_LowerLeg_L',x,[0,.5,1,.5,0]],['WB_LowerLeg_R',x,[0,.5,1,.5,0]]]),
  ];
  // Isolated diagnostics expose contralateral leakage hidden by symmetric poses.
  for(const [side,label] of [['L','Left'],['R','Right']]){
    const sign=side==='L'?1:-1;
    clips.push(make(label+' arm only', [['WB_UpperArm_'+side,z,[0,.5*sign,sign,.5*sign,0]]]));
    clips.push(make(label+' leg only', [['WB_UpperLeg_'+side,x,[0,-.25,-.5,-.25,0]],['WB_LowerLeg_'+side,x,[0,.5,1,.5,0]]]));
  }
  for(const [part,end,label] of [['UpperArm','LowerArm','Upper arm twist'],['UpperLeg','LowerLeg','Thigh twist']]){
    const tracks=[];
    for(const side of ['L','R']){
      const start=resolve('WB_'+part+'_'+side),finish=resolve('WB_'+end+'_'+side);if(!start||!finish)continue;
      const axis=finish.getWorldPosition(new THREE.Vector3()).sub(start.getWorldPosition(new THREE.Vector3()));
      if(axis.lengthSq()>1e-10)tracks.push(track(start.name,axis.normalize(),[0,-.8,0,.8,0],times));
    }
    if(tracks.length)clips.push(new THREE.AnimationClip(label,4,tracks.filter(Boolean)));
  }
  for(const goal of [90,120,180]){
    const tracks=[];
    for(const side of ['L','R']){
      const upper=resolve('WB_UpperArm_'+side),lower=resolve('WB_LowerArm_'+side);if(!upper||!lower)continue;
      const direction=lower.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).normalize();
      const recipe=(config.shoulders||[]).find(r=>r.source===(upper.userData.workbenchSourceName||upper.name));
      const theta=THREE.MathUtils.degToRad(goal),desired=new THREE.Vector3((side==='L'?1:-1)*Math.sin(theta),-Math.cos(theta),0),sourceFrame=world.get(upper.name),target=recipe?resolve(recipe.target):null;
      const axis=recipe?new THREE.Vector3(...recipe.axis):null,liftAxis=target?new THREE.Vector3(...recipe.rotationAxis).applyQuaternion(world.get(target.name)):z;
      let lift=0,localPose=new THREE.Quaternion();
      // The donor has a small sagittal offset. Solve the 3D direction and
      // shoulder coupling together so the 180-degree test reaches vertical.
      for(let i=0;i<40;i++){
        const intermediate=desired.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(liftAxis,-lift));
        const q=new THREE.Quaternion().setFromUnitVectors(direction,intermediate);
        localPose.copy(sourceFrame).invert().multiply(q).multiply(sourceFrame).normalize();
        if(recipe){const dot=localPose.x*axis.x+localPose.y*axis.y+localPose.z*axis.z;lift=THREE.MathUtils.clamp((2*Math.atan2(dot,localPose.w)-recipe.activationAngle)*recipe.ratio,0,recipe.maximumRotationAngle);}
      }
      const rotations=[0,.5,1,.5,0].flatMap(f=>rest.get(upper.name).clone().multiply(new THREE.Quaternion().slerp(localPose,f)).toArray());
      tracks.push(new THREE.QuaternionKeyframeTrack(upper.uuid+'.quaternion',times,rotations));
    }
    clips.push(new THREE.AnimationClip('Abduction '+goal,4,tracks));
  }
  const wristTracks=[];
  for(const side of ['L','R']){
    const arm=resolve('WB_LowerArm_'+side),hand=resolve('WB_Hand_'+side);if(!arm||!hand)continue;
    const axis=hand.getWorldPosition(new THREE.Vector3()).sub(arm.getWorldPosition(new THREE.Vector3())).normalize();
    wristTracks.push(track(hand.name,axis,[0,.65,1.3,.65,0],times));
  }
  clips.push(new THREE.AnimationClip('Wrist twist',4,wristTracks.filter(Boolean)));
  const fingerTracks=[];
  for(const side of ['L','R'])for(const digit of ['Thumb','Index','Middle','Ring','Little'])for(let i=1;i<=3;i++){
    const node=resolve(`WB_${digit}_${String(i).padStart(2,'0')}_${side}`),axis=node?.userData?.workbenchFingerCurlAxis;
    if(!node||!Array.isArray(axis)||axis.length!==3||!axis.every(Number.isFinite))continue;
    const amount=THREE.MathUtils.degToRad((digit==='Thumb'?[15,25,15]:[25,35,15])[i-1]),curlAxis=new THREE.Vector3(...axis).normalize();
    const opposition=node.userData.workbenchFingerOppositionAxis;
    const rotations=[0,.5,1,.5,0].flatMap(f=>{const q=new THREE.Quaternion().setFromAxisAngle(curlAxis,amount*f);
      if(Array.isArray(opposition)&&opposition.length===3&&opposition.every(Number.isFinite))q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...opposition).normalize(),THREE.MathUtils.degToRad(20)*f));
      return rest.get(node.name).clone().multiply(q).toArray();});
    fingerTracks.push(new THREE.QuaternionKeyframeTrack(node.uuid+'.quaternion',times,rotations));
  }
  if(fingerTracks.length)clips.push(new THREE.AnimationClip('Finger curl',4,fingerTracks));
  const shoulderRecipes=[];
  for(const side of ['L','R']){
    const target=bones.get('WB_Shoulder_'+side),encoded=target?.userData?.workbenchShoulderRecipe;
    if(typeof encoded!=='string')continue;
    try{
      const r=JSON.parse(encoded),source=bones.get(r.source),vectors=[r.sourceRestUpLocal,r.targetLiftAxisLocal],numbers=[r.restElevationRadians,r.activationRadians,r.humerusToClavicleRatio,r.maximumLiftRadians];
      if(r.target!==target.name||source?.parent!==target||!vectors.every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite))||!numbers.every(Number.isFinite)||r.humerusToClavicleRatio<0||r.humerusToClavicleRatio>1||r.maximumLiftRadians<0||r.maximumLiftRadians>Math.PI/2)continue;
      shoulderRecipes.push({...r,target,source,up:new THREE.Vector3(...r.sourceRestUpLocal).normalize(),axis:new THREE.Vector3(...r.targetLiftAxisLocal).normalize()});
    }catch{/* Optional metadata must not interrupt the viewer. */}
  }
  const mixer=new THREE.AnimationMixer(root);let action=null,paused=false;
  const recipes=[];
  for(const side of ['L','R'])for(const [part,source,fraction,axial] of [
    ['UpperArmTwist','UpperArm',.5,false],['UpperLegTwist','UpperLeg',.5,false],
    ['LowerArmTwist','Hand',.35,true],['LowerArmTwistWrist','Hand',.75,true]]){
    const target=bones.get('WB_'+part+'_'+side),origin=bones.get('WB_'+source+'_'+side);
    if(target&&origin){
      const core=bones.get('WB_'+(axial?'LowerArm':source)+'_'+side),end=bones.get('WB_'+(axial?'Hand':source==='UpperArm'?'LowerArm':'LowerLeg')+'_'+side);
      const axis=target.userData?.boneTail?new THREE.Vector3(...target.userData.boneTail).normalize():end.getWorldPosition(new THREE.Vector3()).sub(core.getWorldPosition(new THREE.Vector3())).applyQuaternion(world.get(target.name).clone().invert()).normalize();
      recipes.push({target,origin,fraction,axial,axis,frame:world.get(target.name).clone().invert().multiply(world.get(origin.name))});
    }
  }
  function reset(){mixer.stopAllAction();for(const [name,node] of bones){node.quaternion.copy(rest.get(name));node.position.copy(restPositions.get(name));}runtime.reset();physics.reset();}
  function select(name){reset();action=null;const clip=clips.find(c=>c.name===name);if(clip){action=mixer.clipAction(clip);action.reset();action.setLoop(clip.userData?.loop===false?THREE.LoopOnce:THREE.LoopRepeat,clip.userData?.loop===false?1:Infinity);action.clampWhenFinished=clip.userData?.loop===false;action.play();action.paused=paused;}updateLines();}
  function update(delta){
    if(paused){updateLines();return;}
    physics.restore();
    mixer.update(delta);
    for(const r of shoulderRecipes){
      const q=rest.get(r.source.name).clone().invert().multiply(r.source.quaternion).normalize();
      const direction=new THREE.Vector3(0,1,0).applyQuaternion(q);
      const elevation=Math.asin(THREE.MathUtils.clamp(r.up.dot(direction),-1,1))-r.restElevationRadians;
      const lift=THREE.MathUtils.clamp((elevation-r.activationRadians)*r.humerusToClavicleRatio,0,r.maximumLiftRadians);
      r.target.quaternion.copy(rest.get(r.target.name)).multiply(new THREE.Quaternion().setFromAxisAngle(r.axis,lift));
    }
    for(const {target,origin,fraction,axial,axis,frame} of recipes){
      const q=rest.get(origin.name).clone().invert().multiply(origin.quaternion);
      q.premultiply(frame).multiply(frame.clone().invert()).normalize();
      if(q.w<0)q.set(-q.x,-q.y,-q.z,-q.w);
      const projected=q.x*axis.x+q.y*axis.y+q.z*axis.z,length=Math.hypot(projected,q.w);
      const twist=length>1e-8?new THREE.Quaternion(axis.x*projected/length,axis.y*projected/length,axis.z*projected/length,q.w/length):new THREE.Quaternion();
      const reduced=new THREE.Quaternion().setFromAxisAngle(axis,2*Math.atan2(projected,length>1e-8?q.w:1)*fraction);
      const pose=axial?reduced:q.clone().multiply(twist.clone().invert()).multiply(reduced);
      target.quaternion.copy(rest.get(target.name)).multiply(pose);
    }
    runtime.update({animatedShoulders:!!action?.getClip().userData?.animatedShoulders});physics.update(delta);updateLines();
  }
  updateLines();
  return {helper,clips,select,update,physics,
    addMotionLibrary(source,animations,options){
      // A download can finish while another preview is playing. Retarget from
      // the fitted rest pose, then put the current preview back without seeking.
      const current=[...bones.values()].map(n=>({n,q:n.quaternion.clone(),p:n.position.clone()}));
      try{
        for(const [name,node] of bones){node.quaternion.copy(rest.get(name));node.position.copy(restPositions.get(name));}
        root.updateMatrixWorld(true);
        const added=retargetMotionLibrary(root,source,animations,humanoid,resolve,options);clips.push(...added);return added;
      }finally{for(const {n,q,p} of current){n.quaternion.copy(q);n.position.copy(p);}root.updateMatrixWorld(true);}
    },
    pause(value){paused=!!value;if(action)action.paused=paused;},
    dispose(){reset();physics.dispose();mixer.uncacheRoot(root);helper.removeFromParent();geometry.dispose();helper.material.dispose();jointGeometry.dispose();markers.material.dispose();}};
}

import * as THREE from 'three';
import {createSecondaryContacts} from './secondary-collisions.js';

// Bounded local preview, independent of exported PhysBone/VRM settings.
export function createSecondaryPhysics(root,config,lookup){
 const point=n=>root.worldToLocal(n.getWorldPosition(new THREE.Vector3()));
 root.updateMatrixWorld(true);
 const h=config.humanoid||{},hip=h.Hips?lookup(h.Hips):null,head=h.Head?lookup(h.Head):null,foot=h.Foot_L?lookup(h.Foot_L):null,height=head&&foot?point(head).distanceTo(point(foot))*1.15:hip&&head?point(head).distanceTo(point(hip))*2:1.6;
 const segments=[],rest=new Map();
 for(const chain of config.secondary||[]){
  if(!['hair','clothing','breast','glute'].includes(chain.kind))continue;
  const bones=chain.bones.map(lookup);if(bones.some(b=>!b))continue;
  bones.forEach((bone,i)=>{
   rest.set(bone,{q:bone.quaternion.clone(),p:bone.position.clone()});
   let tail=i+1<bones.length?point(bones[i+1]):null;
   if(!tail){const axis=new THREE.Vector3(0,1,0).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));tail=point(bone).add(axis.multiplyScalar(height*(chain.kind==='clothing'?.045:chain.kind==='hair'?.045:.02)));}
   const localTip=bone.worldToLocal(root.localToWorld(tail.clone())),base=point(bone),length=base.distanceTo(tail);
   if(length<1e-6)return;
   segments.push({bone,kind:chain.kind,frontLock:/FrontLock/.test(chain.bones[0]),index:i,localTip,length,tip:tail.clone(),previous:tail.clone(),restTip:tail.clone()});
  });
 }
 const contacts=createSecondaryContacts(root,config,lookup,segments,height);
 let enabled=false,strength=.7,accumulator=0,initialized=false,steps=0,collisions=0;
 const tissue=s=>s.kind==='breast'||s.kind==='glute';
 function restore(){for(const [bone,r] of rest){bone.quaternion.copy(r.q);bone.position.copy(r.p);}root.updateMatrixWorld(true);}
 function reset(){restore();for(const s of segments){s.tip.copy(root.worldToLocal(s.bone.localToWorld(s.localTip.clone())));s.previous.copy(s.tip);}initialized=true;accumulator=0;}
 function capsule(a,b,r){return a&&b?{a:point(a),b:point(b),radius:height*r}:null;}
 const optional=name=>name?lookup(name):null;
 function colliders(){return [capsule(optional(h.Hips),optional(h.UpperChest||h.Chest),.064),...['L','R'].flatMap(side=>[capsule(optional(h['UpperLeg_'+side]),optional(h['LowerLeg_'+side]),.029),capsule(optional(h['LowerLeg_'+side]),optional(h['Foot_'+side]),.022)])].filter(Boolean);}
 function solve(dt){
  const bodies=colliders();
  for(const s of segments){
   const bone=s.bone,r=rest.get(bone);bone.quaternion.copy(r.q);bone.position.copy(r.p);bone.updateWorldMatrix(true,true);
   const base=point(bone),goal=root.worldToLocal(bone.localToWorld(s.localTip.clone())),velocity=s.tip.clone().sub(s.previous).multiplyScalar(tissue(s)?.82:.94),stiff=tissue(s)?230:s.kind==='clothing'?90:65;
   const next=s.tip.clone().add(velocity).addScaledVector(goal.clone().sub(s.tip),stiff*dt*dt).add(new THREE.Vector3(0,tissue(s)?0:-9.81*strength,0).multiplyScalar(dt*dt));
   s.previous.copy(s.tip);
   if(tissue(s)){
    const offset=next.sub(goal).clampLength(0,height*.006*strength),worldOffset=root.localToWorld(base.clone().add(offset));
    bone.position.copy(bone.parent.worldToLocal(worldOffset));s.tip.copy(goal.add(offset));
   }else{
    let direction=next.clone().sub(base).normalize(),restDirection=goal.clone().sub(base).normalize(),angle=restDirection.angleTo(direction),limit=THREE.MathUtils.degToRad((s.kind==='hair'?(s.frontLock?(s.index?10:8):(s.index?12:20)):(s.index?8:12))*strength);
    if(angle>limit)direction=restDirection.clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(restDirection,direction).slerp(new THREE.Quaternion(),1-limit/angle));
    next.copy(base).addScaledVector(direction,s.length);
    for(const c of bodies){const ab=c.b.clone().sub(c.a),near=c.a.clone().addScaledVector(ab,THREE.MathUtils.clamp(next.clone().sub(c.a).dot(ab)/Math.max(ab.lengthSq(),1e-9),0,1)),away=next.clone().sub(near),d=away.length();
     // Do not displace a root already inside its own approximate attachment.
     if(d<c.radius&&base.distanceTo(near)>c.radius*.8&&d>1e-7){next.copy(near).addScaledVector(away,c.radius/d);const projected=next.clone().sub(base).normalize();next.copy(base).addScaledVector(projected,s.length);collisions++;}
    }
    // Contact projection is the final positional constraint. Clamping back to
    // the swing cone here would put the chain straight back inside the body.
    const from=goal.clone().sub(base).normalize(),to=next.clone().sub(base).normalize(),worldDelta=new THREE.Quaternion().setFromUnitVectors(from,to),rootQ=root.getWorldQuaternion(new THREE.Quaternion()),restWorld=bone.getWorldQuaternion(new THREE.Quaternion());
    worldDelta.premultiply(rootQ).multiply(rootQ.clone().invert());const desired=worldDelta.multiply(restWorld),parentQ=bone.parent.getWorldQuaternion(new THREE.Quaternion());bone.quaternion.copy(parentQ.invert().multiply(desired)).normalize();s.tip.copy(next);
   }
   bone.updateWorldMatrix(false,true);
  }
  steps++;
 }
 return {available:segments.length>0,count:segments.length,restore,reset,
  verifySurface:contacts.verifySurface,
  enable(value){enabled=!!value;reset();},strength(value){strength=THREE.MathUtils.clamp(Number(value)||0,0,1);reset();},
  impulse(){if(!initialized)reset();for(const s of segments)s.previous.x-=s.length*(tissue(s)?.10:.16)*strength;},
  update(delta){if(!enabled||!segments.length)return;if(!initialized)reset();accumulator+=Math.min(Math.max(delta,0),.05);while(accumulator>=1/120){solve(1/120);accumulator-=1/120;}
    if(contacts.solve())for(const s of segments)if(!tissue(s)){const next=root.worldToLocal(s.bone.localToWorld(s.localTip.clone()));s.previous.add(next.clone().sub(s.tip));s.tip.copy(next);}
  },
  audit(){return {enabled,segments:segments.length,steps,collisions,...contacts.audit(),maximumTipDisplacement:Math.max(0,...segments.map(s=>s.tip.distanceTo(s.previous))),finite:segments.every(s=>[...s.tip,...s.previous,...s.bone.quaternion.toArray()].every(Number.isFinite)),normalized:segments.every(s=>Math.abs(s.bone.quaternion.length()-1)<1e-5)};},
  dispose(){reset();contacts.dispose();segments.length=0;rest.clear();}};
}

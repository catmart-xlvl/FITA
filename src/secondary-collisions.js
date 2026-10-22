import * as THREE from 'three';
import {ConvexHull} from 'three/addons/math/ConvexHull.js';

const sourceName=node=>{
  for(let n=node;n;n=n.parent)if(n.userData.workbenchSourceName)return n.userData.workbenchSourceName;
  return node.name;
};
const isBelow=(node,parent)=>{for(let n=node;n;n=n.parent)if(n===parent)return true;return false;};

// Fit body envelopes once from the actual rest surfaces. The envelopes follow
// the animated body bones; the contact probes use the actual blended skinning.
export function createSecondaryContacts(root,config,lookup,segments,height){
  const bodies=[],chains=[],margin=height*.0015,rootInverse=new THREE.Matrix4(),meshFrames=new Map();
  const rootPoint=(mesh,i)=>mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(meshFrames.get(mesh));
  const meshes=[];root.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
  root.updateMatrixWorld(true);
  rootInverse.copy(root.matrixWorld).invert();for(const mesh of meshes)meshFrames.set(mesh,new THREE.Matrix4().multiplyMatrices(rootInverse,mesh.matrixWorld));
  const surface=pattern=>meshes.filter(n=>pattern.test(sourceName(n))).flatMap(mesh=>{
    const points=[];for(let i=0;i<mesh.geometry.attributes.position.count;i++)points.push(rootPoint(mesh,i));return points;
  });
  function hull(name,bone,points,kinds){
    if(!bone||points.length<8)return;
    const cells=new Map(),toLocal=new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(root.matrixWorld);
    for(const point of points){const p=point.clone().applyMatrix4(toLocal),key=p.toArray().map(v=>Math.round(v/(height*.005))).join(',');if(!cells.has(key))cells.set(key,p);}
    const cloud=[...cells.values()];if(cloud.length<8)return;
    const shape=new ConvexHull().setFromPoints(cloud),planes=shape.faces.map(f=>[f.normal.x,f.normal.y,f.normal.z,f.constant]);
    if(planes.length<4)return;
    bodies.push({name,bone,kinds,planes,inverse:new THREE.Matrix4(),forward:new THREE.Matrix4(),box:new THREE.Box3().setFromPoints(cloud).expandByScalar(margin),type:'hull'});
  }
  const h=config.humanoid||{};
  hull('head-face',lookup(h.Head),surface(/^rostro(?:\b|_)/i),['hair']);
  // Upper torso protects long locks and hanging front accessories.
  hull('upper-torso',lookup(h.Chest||h.UpperChest),surface(/^piel-superior(?:\b|_)/i).filter(p=>p.y<root.worldToLocal(lookup(h.Neck)?.getWorldPosition(new THREE.Vector3())||new THREE.Vector3(0,height,0)).y),['hair','clothing']);
  const legs=surface(/^piernas(?:\b|_)/i);
  for(const side of ['L','R']){
    const opposite=lookup(h['UpperLeg_'+(side==='L'?'R':'L')]),thigh=lookup(h['UpperLeg_'+side]);
    if(!thigh||!opposite)continue;
    const a=root.worldToLocal(thigh.getWorldPosition(new THREE.Vector3())),other=root.worldToLocal(opposite.getWorldPosition(new THREE.Vector3()));
    const own=legs.filter(p=>p.distanceToSquared(a)<p.distanceToSquared(other));
    for(const [role,end,label] of [['UpperLeg','LowerLeg','thigh'],['LowerLeg','Foot','shin']]){
      const bone=lookup(h[role+'_'+side]),tail=lookup(h[end+'_'+side]);if(!bone||!tail)continue;
      const start=root.worldToLocal(bone.getWorldPosition(new THREE.Vector3())),finish=root.worldToLocal(tail.getWorldPosition(new THREE.Vector3())),axis=finish.clone().sub(start),lengthSq=axis.lengthSq();
      hull(label+'-'+side,bone,own.filter(p=>{const t=p.clone().sub(start).dot(axis)/lengthSq;return t>-.18&&t<1.12;}),['clothing']);
    }
  }
  function refresh(){
    rootInverse.copy(root.matrixWorld).invert();
    for(const mesh of meshes)meshFrames.get(mesh).multiplyMatrices(rootInverse,mesh.matrixWorld);
    for(const body of bodies){body.forward.multiplyMatrices(rootInverse,body.bone.matrixWorld);body.inverse.copy(body.forward).invert();}
  }
  // A convex envelope is conservative in concavities. Retain each probe's rest
  // clearance there, so enabling physics cannot inflate the approved rest mesh.
  function contact(body,point){
    const p=point.clone().applyMatrix4(body.inverse);if(!body.box.containsPoint(p))return null;
    let distance=-Infinity,plane=null,planeIndex=-1;
    for(let i=0;i<body.planes.length;i++){const f=body.planes[i],d=f[0]*p.x+f[1]*p.y+f[2]*p.z-f[3];if(d>distance){distance=d;plane=f;planeIndex=i;}}
    return {distance,planeIndex,local:p,normal:new THREE.Vector3(plane[0],plane[1],plane[2]).transformDirection(body.forward)};
  }
  refresh();
  for(const spec of config.secondary||[]){
    if(!['hair','clothing'].includes(spec.kind))continue;
    const members=segments.filter(s=>spec.bones.includes(s.bone.userData.workbenchSourceName||s.bone.name));if(!members.length)continue;
    const chain={name:spec.bones[0],kind:spec.kind,members,probes:[],fullProbes:[]},cells=new Map();
    for(const mesh of meshes){
      if(spec.meshes?.length&&!spec.meshes.includes(sourceName(mesh)))continue;
      const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;if(!indices||!weights)continue;
      for(let i=0;i<indices.count;i++){
        const influence=members.map(s=>{let total=0;for(let k=0;k<4;k++)if(isBelow(mesh.skeleton.bones[indices.getComponent(i,k)],s.bone))total+=weights.getComponent(i,k);return total;});
        if(Math.max(...influence)<.15)continue;
        const p=rootPoint(mesh,i),key=p.toArray().map(v=>Math.round(v/(height*.01))).join(','),probe={mesh,index:i,influence,clearances:new Map()};
        for(const body of bodies.filter(b=>b.kinds.includes(chain.kind))){
          // Obtain a stable outward side even when the rest point is beyond
          // the broad-phase box. This prevents a swept leg from pushing the
          // front skirt through to the back of the thigh.
          const local=p.clone().applyMatrix4(body.inverse);let distance=-Infinity,planeIndex=0;
          body.planes.forEach((f,i)=>{const d=f[0]*local.x+f[1]*local.y+f[2]*local.z-f[3];if(d>distance){distance=d;planeIndex=i;}});
          probe.clearances.set(body,{distance:Math.min(margin,distance),planeIndex});
        }
        chain.fullProbes.push(probe);
        if(!cells.has(key))cells.set(key,probe);
      }
    }
    chain.probes=[...cells.values()];chain.active=new Set(chain.probes);if(chain.probes.length)chains.push(chain);
  }
  let corrections=0,maximumPenetration=0,pendingContacts=[];
  function worst(chain,probes=chain.probes){
    let result=null;
    for(const probe of probes){const position=rootPoint(probe.mesh,probe.index);
      for(const [body,clearance] of probe.clearances){const c=contact(body,position);if(!c||c.distance>=clearance.distance-height*.00015)continue;
        const f=body.planes[clearance.planeIndex],distance=f[0]*c.local.x+f[1]*c.local.y+f[2]*c.local.z-f[3],depth=clearance.distance-distance;
        const normal=new THREE.Vector3(f[0],f[1],f[2]).transformDirection(body.forward);
        if(depth>height*.00015&&(!result||depth>result.depth))result={probe,position,normal,depth,body:body.name};
      }
    }
    return result;
  }
  const restRotations=new Map(segments.map(s=>[s.bone,s.bone.quaternion.clone()]));
  function solve(){
    if(!chains.length)return false;
    root.updateMatrixWorld(true);refresh();let changed=false;
    for(let iteration=0;iteration<24;iteration++){
      let pending=false;
      for(const chain of chains){
        const hit=worst(chain);if(!hit)continue;pending=true;
        const gradients=chain.members.map((s,i)=>hit.position.clone().sub(s.bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInverse)).cross(hit.normal).multiplyScalar(hit.probe.influence[i]));
        const denominator=gradients.reduce((sum,g)=>sum+g.lengthSq(),0);if(denominator<1e-10)continue;
        for(let i=0;i<chain.members.length;i++){
          const bone=chain.members[i].bone,rotation=gradients[i].multiplyScalar(hit.depth/denominator*.85),angle=Math.min(rotation.length(),.10);if(angle<1e-7)continue;
          const worldAxis=rotation.normalize().transformDirection(root.matrixWorld),parentQ=bone.parent.getWorldQuaternion(new THREE.Quaternion()),worldQ=bone.getWorldQuaternion(new THREE.Quaternion());
          const desired=new THREE.Quaternion().setFromAxisAngle(worldAxis,angle).multiply(worldQ);
          const local=parentQ.invert().multiply(desired).normalize(),rest=restRotations.get(bone),limit=THREE.MathUtils.degToRad(chain.kind==='hair'?70:85),swing=rest.angleTo(local);
          bone.quaternion.copy(swing>limit?rest.clone().slerp(local,limit/swing):local).normalize();bone.updateWorldMatrix(false,true);
        }
        changed=true;corrections++;
      }
      if(!pending){
        // Validate the omitted vertices too. Cache new contact witnesses so
        // an inner cloth layer cannot slip between the coarse surface probes.
        let added=false;
        for(const chain of chains){const hit=worst(chain,chain.fullProbes);if(hit&&!chain.active.has(hit.probe)){chain.active.add(hit.probe);chain.probes.push(hit.probe);added=true;}}
        if(!added)break;
      }
    }
    pendingContacts=chains.map(c=>{const hit=worst(c);return hit?{chain:c.name,body:hit.body,depth:hit.depth,vertex:hit.probe.index,influence:hit.probe.influence}:null;}).filter(Boolean);
    maximumPenetration=Math.max(0,...pendingContacts.map(c=>c.depth));
    return changed;
  }
  return {solve,
    verifySurface(){root.updateMatrixWorld(true);refresh();const hits=chains.map(c=>{const hit=worst(c,c.fullProbes);return hit?{chain:c.name,body:hit.body,depth:hit.depth,vertex:hit.probe.index}:null;}).filter(Boolean);return {vertices:chains.reduce((n,c)=>n+c.fullProbes.length,0),maximumPenetration:Math.max(0,...hits.map(h=>h.depth)),hits};},
    audit:()=>({colliders:bodies.map(b=>b.name),surfaceProbes:chains.reduce((n,c)=>n+c.probes.length,0),contactCorrections:corrections,maximumPenetration,pendingContacts}),dispose(){chains.length=0;bodies.length=0;restRotations.clear();}};
}

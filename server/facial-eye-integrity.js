import {Matrix3,Matrix4,Quaternion,Vector3} from 'three';
import {blinkEyePolicy as policy} from '../shared/facial-profile.js';

const ocularRoles=new Set(['iris','pupil','glint']);
const blinkExpressions=['blink','blinkLeft','blinkRight'];
const fail=detail=>{throw Object.assign(Error('FACE_INVALID: '+detail),{status:400});};
const standardPart=name=>{
  const m=/^WB_(Iris|Pupil|Glint)_([LR])(?:_|\s|$)/i.exec(name);
  return m&&{mesh:name,role:m[1].toLowerCase(),eye:m[2].toUpperCase()==='L'?'left':'right'};
};

// Inspect actual world-space morph deltas, including UV seam identities and
// nested/non-uniform mesh transforms. A blink may only leave an eye assembly
// still or translate the entire assembly a little towards its interior.
export function inspectBlinkEyeIntegrity(source,bindings,allDeltas,coordinatedParts=[]){
  const {doc,read}=source,nodes=doc.nodes.filter(n=>n.mesh!==undefined),byName=new Map(nodes.map(n=>[n.name,n])),parts=new Map();
  for(const p of coordinatedParts){
    if(!ocularRoles.has(p?.role))continue;
    if(!byName.has(p.mesh)||parts.has(p.mesh))fail('invalid ocular inventory');
    const known=standardPart(p.mesh),eye=p.eye||known?.eye;
    if(!['left','right'].includes(eye)||known&&(known.role!==p.role||known.eye!==eye))fail('ocular role/eye required: '+p.mesh);
    parts.set(p.mesh,{mesh:p.mesh,role:p.role,eye});
  }
  for(const node of nodes){const known=standardPart(node.name);if(known&&!parts.has(node.name))parts.set(node.name,known);}
  if(!parts.size)return {checked:false,reason:'No separate ocular parts identified.'};
  const worlds=new Map();
  function walk(i,parent){
    const n=doc.nodes[i],local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3(...(n.translation||[0,0,0])),new Quaternion(...(n.rotation||[0,0,0,1])),new Vector3(...(n.scale||[1,1,1]))),world=parent.clone().multiply(local);
    worlds.set(n,world);for(const child of n.children||[])walk(child,world);
  }
  for(const root of doc.scenes[doc.scene||0].nodes)walk(root,new Matrix4());
  const groups=new Map();
  for(const part of parts.values()){
    const node=byName.get(part.mesh),world=worlds.get(node);if(!world)fail('ocular part outside active scene');
    const rows=new Map(),normalMatrix=new Matrix3().getNormalMatrix(world),linear=new Matrix3().setFromMatrix4(world);
    for(const p of doc.meshes[node.mesh].primitives){
      const ids=read(p.attributes._WORKBENCH_VERTEX),positions=read(p.attributes.POSITION),normals=p.attributes.NORMAL===undefined?null:read(p.attributes.NORMAL);
      ids.forEach(([id],i)=>{if(!rows.has(id))rows.set(id,{point:new Vector3(...positions[i]).applyMatrix4(world),normal:normals?new Vector3(...normals[i]).applyMatrix3(normalMatrix).normalize():null});});
    }
    if(!groups.has(part.eye))groups.set(part.eye,[]);
    groups.get(part.eye).push({...part,rows,linear});
  }
  const checks=[];
  for(const [eye,assembly] of groups){
    const iris=assembly.filter(p=>p.role==='iris');if(!iris.length)fail('iris missing from ocular assembly: '+eye);
    const points=iris.flatMap(p=>[...p.rows.values()].map(r=>r.point)),center=points.reduce((v,p)=>v.add(p),new Vector3()).divideScalar(points.length);
    const diameter=2*Math.max(...points.map(p=>p.distanceTo(center)));if(!(diameter>0))fail('degenerate iris');
    const tolerance=Math.max(policy.absoluteToleranceMetres,diameter*policy.rigidityRelativeTolerance),limit=Math.min(policy.maximumRetractionMetres,diameter*policy.maximumRetractionDiameterRatio);
    const inward=iris.flatMap(p=>[...p.rows.values()]).reduce((v,r)=>r.normal?v.sub(r.normal):v,new Vector3()).normalize();
    // Also check the UI's simultaneous bilateral/individual controls. Shared
    // keys clamp at one; independent keys must not add an excessive retreat.
    for(const expressions of [...blinkExpressions.map(e=>[e]),blinkExpressions]){
      const controlled=new Map();
      for(const e of expressions)for(const entry of bindings.expressions[e]||[]){
        const key=JSON.stringify([entry.mesh,entry.shape]);controlled.set(key,Math.min(1,(controlled.get(key)||0)+entry.weight));
      }
      let common=null;
      for(const part of assembly){
        let translation=null;
        for(const id of part.rows.keys()){
          const delta=new Vector3();
          for(const [key,weight] of controlled){
            const [mesh]=JSON.parse(key);if(mesh!==part.mesh)continue;
            const value=allDeltas.get(key)?.get(id);if(!value)fail('ocular source identity missing: '+part.mesh);
            delta.addScaledVector(new Vector3(...value).applyMatrix3(part.linear),weight);
          }
          translation??=delta.clone();
          if(delta.distanceTo(translation)>tolerance)fail('blink must not shrink or deform '+part.mesh);
        }
        common??=translation;
        if(!translation||translation.distanceTo(common)>tolerance)fail('blink must move iris, pupil and glints together: '+eye);
      }
      const distance=common.length();
      if(distance>limit+tolerance)fail('blink eye retreat exceeds minimal clearance: '+eye);
      if(distance>tolerance&&(inward.lengthSq()<.5||common.dot(inward)/distance<policy.minimumInwardAlignment))fail('blink eye translation must be inward: '+eye);
      checks.push({eye,expressions,translationMetres:common.toArray(),maximumRetractionMetres:limit});
    }
  }
  return {checked:true,parts:parts.size,checks};
}

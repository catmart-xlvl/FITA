import {createHash} from 'node:crypto';
import {Matrix3,Matrix4,Quaternion,Vector3} from 'three';
import {parseRigGlb} from './rig-connectivity.js';
import {buildGlb,parseGlb} from '../scripts/texture-layout.mjs';
import {faceFieldNormals} from '../scripts/face-normal-preparation.mjs';

const fail=detail=>{throw Object.assign(Error('FACE_NORMAL_FIELD_INVALID: '+detail),{status:400});};
const facial=name=>['face','face export','head-face','eye_shadows'].includes(name)||/^WB_(?:Iris|Pupil|Glint|Sclera|Eyebrow|EyeShadow)_[LR](?:_|\s|$)/.test(name);

// One mask in world space; every participating piece samples the same field.
// Sampling the deformed positions produces smooth morph normals without
// inheriting rotations of individual collapsed eyelid triangles.
export function facialNormalEvaluator(parsed,patch){
  if(patch?.schema!=='workbench-facial-normal-field/v1'||!Array.isArray(patch.targets)||!patch.targets.length||patch.targets.length>32)fail('schema');
  // Validate the ellipsoid using the same production sampler as preparation.
  faceFieldNormals([patch.proxy?.center?.[0]??0,patch.proxy?.center?.[1]??0,(patch.proxy?.center?.[2]??0)+1],[0,0,1],{proxy:patch.proxy,weights:[1]});
  const worlds=new Map(),d=parsed.doc;
  function walk(i,parent){const n=d.nodes[i],local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3(...(n.translation||[0,0,0])),new Quaternion(...(n.rotation||[0,0,0,1])),new Vector3(...(n.scale||[1,1,1]))),world=parent.clone().multiply(local);if(n.mesh!==undefined)worlds.set(n.name,world);for(const c of n.children||[])walk(c,world);}
  for(const i of d.scenes[d.scene||0].nodes)walk(i,new Matrix4());
  const evaluators=new Map();
  for(const t of patch.targets){
    const node=d.nodes.find(n=>n.name===t.mesh&&n.mesh!==undefined),world=worlds.get(t.mesh);
    if(!node||!world||!facial(t.mesh)||evaluators.has(t.mesh)||!Array.isArray(t.weights)||!t.weights.length)fail('facial scope');
    const known=new Set(d.meshes[node.mesh].primitives.flatMap(p=>parsed.read(p.attributes._WORKBENCH_VERTEX).map(([id])=>id))),weights=new Map();
    for(const row of t.weights){if(!Array.isArray(row)||row.length!==2||!known.has(row[0])||weights.has(row[0])||!Number.isFinite(row[1])||row[1]<=0||row[1]>1)fail('weights or source identities');weights.set(...row);}
    const toWorld=new Matrix3().getNormalMatrix(world),toLocal=toWorld.clone().invert();
    evaluators.set(t.mesh,(positions,normals,ids)=>{
      if(!ids.some(id=>weights.has(id)))return normals.map(n=>n.slice());
      const wp=positions.flatMap(p=>new Vector3(...p).applyMatrix4(world).toArray()),wn=normals.flatMap(n=>new Vector3(...n).applyMatrix3(toWorld).normalize().toArray());
      const field=faceFieldNormals(wp,wn,{proxy:patch.proxy,weights:ids.map(id=>weights.get(id)||0)});
      return ids.map((id,i)=>weights.has(id)?new Vector3(...field.slice(i*3,i*3+3)).applyMatrix3(toLocal).normalize().toArray():normals[i].slice());
    });
  }
  return evaluators;
}

export function applyFacialNormalField(source,patch,{allow=false}={}){
  if(!allow)throw Object.assign(Error('FACE_NORMAL_FIELD_CONFIRMATION_REQUIRED'),{status:409});
  if(patch?.sourceSha256!==createHash('sha256').update(source).digest('hex'))fail('source hash');
  const parsed=parseRigGlb(source),samplers=facialNormalEvaluator(parsed,patch),{json:d,bin:original}=parseGlb(source);let bin=Buffer.from(original);const checks=[];
  const append=(rows,size)=>{const bytes=Buffer.alloc(rows.length*size*4);rows.forEach((r,i)=>r.forEach((v,j)=>bytes.writeFloatLE(v,(i*size+j)*4)));bin=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);d.bufferViews.push({buffer:0,byteOffset:bin.length,byteLength:bytes.length});bin=Buffer.concat([bin,bytes]);d.accessors.push({bufferView:d.bufferViews.length-1,componentType:5126,count:rows.length,type:'VEC'+size});return d.accessors.length-1;};
  for(const n of d.nodes){const sample=samplers.get(n.name);if(!sample)continue;
    for(const p of d.meshes[n.mesh].primitives){
      if(p.targets?.length)fail('existing facial morphs require explicit normal profiles');
      const ids=parsed.read(p.attributes._WORKBENCH_VERTEX).map(([id])=>id),positions=parsed.read(p.attributes.POSITION),old=parsed.read(p.attributes.NORMAL),normals=sample(positions,old,ids);p.attributes.NORMAL=append(normals,3);
      if(p.attributes.TANGENT!==undefined){const tangents=parsed.read(p.attributes.TANGENT).map((r,i)=>{const normal=new Vector3(...normals[i]),v=new Vector3(...r);v.addScaledVector(normal,-v.dot(normal));if(v.lengthSq()<1e-12){v.set(Math.abs(normal.x)<.9?1:0,Math.abs(normal.x)<.9?0:1,0);v.addScaledVector(normal,-v.dot(normal));}return [...v.normalize().toArray(),r[3]];});p.attributes.TANGENT=append(tangents,4);}
    }
    checks.push({mesh:n.name,affectedSourceVertices:patch.targets.find(t=>t.mesh===n.name).weights.length});
  }
  d.buffers[0].byteLength=bin.length;return {bytes:buildGlb(d,bin),validation:{scope:'facial-normals-only',checks,geometryUVsTexturesSkinPreserved:true,proxyExported:false}};
}

import {createHash} from 'node:crypto';
import {Matrix3,Matrix4,Quaternion,Vector3} from 'three';
import {parseRigGlb} from './rig-connectivity.js';

const fail=detail=>{throw Object.assign(Error('FACE_IRIS_REPAIR_INVALID: '+detail),{status:400});};
const infer=name=>{const m=/^WB_(Iris|Pupil|Glint)_([LR])(?:_|\s|$)/i.exec(name);return m&&{role:m[1].toLowerCase(),eye:m[2].toUpperCase()==='L'?'left':'right'};};
const radius=rows=>{const c=rows.reduce((v,p)=>v.add(new Vector3(...p)),new Vector3()).divideScalar(rows.length);return 2*Math.max(...rows.map(p=>new Vector3(...p).distanceTo(c)));};

// Explicitly authorized late repair, confined to existing ocular positions and
// normals. Original buffers, topology, UVs, images, materials and skin remain.
export function repairIrisSurfaces(source,repair,{allow=false}={}){
  if(!allow)throw Object.assign(Error('FACE_IRIS_REPAIR_CONFIRMATION_REQUIRED'),{status:409});
  if(repair?.schema!=='workbench-iris-surface-repair/v1'||repair.sourceSha256!==createHash('sha256').update(source).digest('hex')||!Array.isArray(repair.patches)||!repair.patches.length||repair.patches.length>32)fail('source or schema');
  const parsed=parseRigGlb(source),d=structuredClone(parsed.doc),nodes=new Map(d.nodes.filter(n=>n.mesh!==undefined).map(n=>[n.name,n])),seen=new Set(),prepared=[];
  for(const patch of repair.patches){
    const node=nodes.get(patch.mesh),part=infer(patch.mesh);if(!node||!part||seen.has(patch.mesh)||patch.role!==part.role||patch.eye!==part.eye)fail('ocular mesh scope');seen.add(patch.mesh);
    const original=new Map();for(const p of d.meshes[node.mesh].primitives){const ids=parsed.read(p.attributes._WORKBENCH_VERTEX),positions=parsed.read(p.attributes.POSITION);ids.forEach(([id],i)=>original.set(id,positions[i]));}
    const decode=rows=>{if(!Array.isArray(rows)||rows.length!==original.size)fail('vertex count');const map=new Map();for(const row of rows){if(!Array.isArray(row)||row.length!==4||!original.has(row[0])||map.has(row[0])||row.some(x=>!Number.isFinite(x)))fail('vertex identity');map.set(row[0],row.slice(1));}return map;};
    const positions=decode(patch.positions),normals=decode(patch.normals);
    for(const normal of normals.values())if(Math.abs(new Vector3(...normal).length()-1)>1e-4)fail('unit normals required');
    prepared.push({patch,node,original,positions,normals});
  }
  const checks=[],worlds=new Map();
  function walk(i,parent){const n=d.nodes[i],local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3(...(n.translation||[0,0,0])),new Quaternion(...(n.rotation||[0,0,0,1])),new Vector3(...(n.scale||[1,1,1]))),world=parent.clone().multiply(local);worlds.set(n,world);for(const c of n.children||[])walk(c,world);}
  for(const i of d.scenes[d.scene||0].nodes)walk(i,new Matrix4());
  for(const row of prepared){
    const iris=prepared.find(r=>r.patch.eye===row.patch.eye&&r.patch.role==='iris');if(!iris)fail('iris required for each repaired eye');
    // Convert the physical bound to mesh-local distances even with scale.
    // Workbench ocular objects must retain their existing canonical transforms;
    // displacement is measured using their active scene world linear frame.
    const world=worlds.get(row.node),irisWorld=worlds.get(iris.node);if(!world||!irisWorld)fail('inactive mesh');
    const diameter=radius([...iris.original.values()].map(p=>new Vector3(...p).applyMatrix4(irisWorld).toArray())),limit=Math.min(.0015,diameter*.08);let max=0;
    for(const [id,p] of row.positions){const delta=new Vector3(...p).sub(new Vector3(...row.original.get(id))).applyMatrix3(new Matrix3().setFromMatrix4(world));max=Math.max(max,delta.length());}
    if(max>limit+1e-7)fail('repair exceeds local smoothing bound');
    const before=radius([...row.original.values()].map(p=>new Vector3(...p).applyMatrix4(world).toArray())),after=radius([...row.positions.values()].map(p=>new Vector3(...p).applyMatrix4(world).toArray()));
    if(Math.abs(after-before)>Math.max(.0001,before*.05))fail('ocular silhouette size changed');
    checks.push({mesh:row.patch.mesh,vertices:row.positions.size,maximumDisplacementMetres:max,limitMetres:limit});
  }
  const jlen=source.readUInt32LE(12),originalBin=source.subarray(28+jlen,28+jlen+source.readUInt32LE(20+jlen));let bin=Buffer.from(originalBin);
  const append=rows=>{const bytes=Buffer.alloc(rows.length*12);rows.forEach((r,i)=>r.forEach((v,j)=>bytes.writeFloatLE(v,i*12+j*4)));bin=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);d.bufferViews.push({buffer:0,byteOffset:bin.length,byteLength:bytes.length});bin=Buffer.concat([bin,bytes]);const index=d.accessors.length;d.accessors.push({bufferView:d.bufferViews.length-1,componentType:5126,count:rows.length,type:'VEC3',min:[0,1,2].map(k=>Math.min(...rows.map(r=>r[k]))),max:[0,1,2].map(k=>Math.max(...rows.map(r=>r[k])))});return index;};
  for(const row of prepared)for(const p of d.meshes[row.node.mesh].primitives){const ids=parsed.read(p.attributes._WORKBENCH_VERTEX);p.attributes.POSITION=append(ids.map(([id])=>row.positions.get(id)));p.attributes.NORMAL=append(ids.map(([id])=>row.normals.get(id)));}
  d.buffers[0].byteLength=bin.length;const raw=Buffer.from(JSON.stringify(d)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),header=Buffer.alloc(20),bh=Buffer.alloc(8);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
  return {bytes:Buffer.concat([header,json,bh,bin]),validation:{scope:'authorized-local-iris-smoothing',checks,topologyUVsSkinMaterialsPreserved:true}};
}

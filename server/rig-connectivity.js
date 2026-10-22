import {Matrix4,Quaternion,Vector3} from 'three';
import {glbBuffer} from './validation.js';

const ID='_WORKBENCH_VERTEX';
const fail=message=>{throw Object.assign(Error('RIG_CONNECTIVITY: '+message),{status:400});};
export function parseRigGlb(bytes){
  glbBuffer(bytes);const size=bytes.readUInt32LE(12),doc=JSON.parse(bytes.toString('utf8',20,20+size));
  const bin=bytes.subarray(28+size);
  function read(index){
    const a=doc.accessors?.[index],width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a?.type],size={5121:1,5123:2,5125:4,5126:4}[a?.componentType];
    if(!a||!width||!size||!Number.isInteger(a.count)||a.count<1||a.count>2000000)fail('Invalid accessor.');
    let values=Array.from({length:a.count},()=>Array(width).fill(0));
    function rows(viewIndex,offset,count,type,n){
      const view=doc.bufferViews?.[viewIndex],bytesPer={5121:1,5123:2,5125:4,5126:4}[type],method={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[type];
      if(!view||view.buffer!==0||!bytesPer)fail('Invalid buffer.');
      const start=(view.byteOffset||0)+offset,stride=view.byteStride||bytesPer*n;
      if(offset<0||stride<bytesPer*n||start+(count-1)*stride+bytesPer*n>bin.length||offset+(count-1)*stride+bytesPer*n>view.byteLength)fail('Invalid buffer bounds.');
      return Array.from({length:count},(_,i)=>Array.from({length:n},(_,j)=>bin[method](start+i*stride+j*bytesPer)));
    }
    if(a.bufferView!==undefined)values=rows(a.bufferView,a.byteOffset||0,a.count,a.componentType,width);
    if(a.sparse){const s=a.sparse;if(!Number.isInteger(s.count)||s.count<1||s.count>a.count)fail('Invalid sparse accessor.');const ids=rows(s.indices.bufferView,s.indices.byteOffset||0,s.count,s.indices.componentType,1),data=rows(s.values.bufferView,s.values.byteOffset||0,s.count,a.componentType,width);let previous=-1;ids.forEach(([i],n)=>{if(i<=previous||i>=a.count)fail('Invalid sparse indices.');previous=i;values[i]=data[n];});}
    for(const row of values)for(let i=0;i<row.length;i++){if(!Number.isFinite(row[i]))fail('Non-finite data.');if(a.normalized)row[i]/=a.componentType===5121?255:65535;}
    return values;
  }
  return {doc,read};
}
const parse=parseRigGlb;
export function hasRigConnectivity(bytes){
  const {doc}=parse(bytes);return doc.meshes?.some(m=>m.primitives.some(p=>p.attributes?.[ID]!==undefined))===true;
}
function snapshot(bytes,weighted){
  const {doc,read}=parse(bytes),meshes=new Map(),seen=new Set();
  function walk(index,parent){
    if(seen.has(index))fail('Repeated scene node.');seen.add(index);
    const node=doc.nodes?.[index];if(!node)fail('Missing node.');
    const local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3(...(node.translation||[0,0,0])),new Quaternion(...(node.rotation||[0,0,0,1])),new Vector3(...(node.scale||[1,1,1]))),world=parent.clone().multiply(local);
    if(node.mesh!==undefined){
      if(!node.name||meshes.has(node.name))fail('Mesh names must be unique.');
      const triangles=[],deformation=new Map();let logical=new Set();
      for(const p of doc.meshes[node.mesh].primitives){
        if(p.attributes?.[ID]===undefined)fail('Source vertex identities are missing. Export with export_attributes=True.');
        const ids=read(p.attributes[ID]),points=read(p.attributes.POSITION),indices=p.indices===undefined?points.map((_,i)=>[i]):read(p.indices);
        if(ids.length!==points.length||ids.some(a=>a.length!==1||!Number.isSafeInteger(a[0])||a[0]<0)||(p.mode??4)!==4||indices.length%3)fail('Invalid source vertex identities.');
        const uv=p.attributes.TEXCOORD_0===undefined?null:read(p.attributes.TEXCOORD_0);
        const corners=points.map((position,i)=>[ids[i][0],...new Vector3(...position).applyMatrix4(world).toArray().map(x=>Math.round(x*1e5)),...(uv?.[i]||[]).map(x=>Math.round(x*1e5))].join(','));
        for(let i=0;i<indices.length;i+=3){const face=indices.slice(i,i+3).map(([index])=>{if(!Number.isInteger(index)||!corners[index])fail('Invalid triangle.');logical.add(ids[index][0]);return corners[index];});triangles.push([face.join('|'),[...face.slice(1),face[0]].join('|'),[face[2],...face.slice(0,2)].join('|')].sort()[0]);}
        if(weighted){
          const skin=doc.skins?.[node.skin];if(!skin)fail('Skin is missing.');
          const sets=Object.keys(p.attributes).filter(k=>/^JOINTS_\d+$/.test(k)).map(k=>[read(p.attributes[k]),read(p.attributes[k.replace('JOINTS_','WEIGHTS_')])]);
          if(!sets.length)fail('Weights are missing.');
          const morphs=(p.targets||[]).map(t=>t.POSITION===undefined?null:read(t.POSITION));
          ids.forEach(([id],i)=>{
            const weights=new Map();for(const [js,ws] of sets){if(!js[i]||!ws[i])fail('Invalid weights.');js[i].forEach((j,k)=>{const w=ws[i][k];if(w>0){const name=doc.nodes[skin.joints[j]]?.name;if(!name)fail('Invalid weighted bone.');weights.set(name,(weights.get(name)||0)+w);}});}
            const current={weights,morphs:morphs.map(m=>m?.[i]||[0,0,0])},old=deformation.get(id);
            if(old){const names=new Set([...old.weights.keys(),...weights.keys()]);if([...names].some(n=>Math.abs((old.weights.get(n)||0)-(weights.get(n)||0))>1e-6))fail('UV seam copies have different weights in '+node.name+'.');
              if(old.morphs.length!==current.morphs.length||old.morphs.some((m,j)=>m.some((v,k)=>Math.abs(v-current.morphs[j][k])>1e-6)))fail('UV seam copies have different morph deltas in '+node.name+'.');
            }else deformation.set(id,current);
          });
        }
      }
      meshes.set(node.name,{triangles:triangles.sort().join('\n'),vertices:logical.size});
    }
    for(const child of node.children||[])walk(child,world);
  }
  for(const root of doc.scenes?.[doc.scene??0]?.nodes||[])walk(root,new Matrix4());
  if(!meshes.size)fail('No meshes.');return meshes;
}
export function inspectRigConnectivity(source,result,{required=false}={}){
  if(!hasRigConnectivity(source)){
    if(required)fail('The connected placement source has lost its vertex identities.');
    return {connectivityChecked:false,connectivityReason:'Legacy source has no vertex identities.'};
  }
  const before=snapshot(source,false),after=snapshot(result,true);
  if(before.size!==after.size||[...before].some(([name,m])=>m.triangles!==after.get(name)?.triangles))fail('The original vertex connections or corner ownership changed.');
  return {connectivityChecked:true,sourceConnectionsPreserved:true,seamWeightsConsistent:true,logicalVertices:[...before.values()].reduce((n,m)=>n+m.vertices,0)};
}

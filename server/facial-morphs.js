import {parseRigGlb,inspectRigConnectivity} from './rig-connectivity.js';
import {inspectRestPreservation} from './rigging-validation.js';
import {facialExpressions,facialProfile} from '../shared/facial-profile.js';
import {inspectBlinkEyeIntegrity} from './facial-eye-integrity.js';
import {inspectEyeShadowBindings} from './facial-shadow-integrity.js';

const fail=detail=>{throw Object.assign(Error('FACE_INVALID: '+detail),{status:400});};
// Preserve the approved GLB byte-for-byte except for appended morph data and its
// metadata. A Blender export supplies deltas, never replacement skin or UVs.
export function appendFacialMorphs(source,candidate,bindings,{coordinatedParts=[]}={}){
  inspectRestPreservation(source,candidate);
  inspectRigConnectivity(source,candidate,{required:true});
  if(bindings?.schema!==facialProfile||!bindings.expressions)fail('bindings schema');
  const a=parseRigGlb(source),b=parseRigGlb(candidate),d=structuredClone(a.doc);
  const sourceNodes=d.nodes.filter(n=>n.mesh!==undefined),candidateNodes=b.doc.nodes.filter(n=>n.mesh!==undefined);
  const names=new Set(sourceNodes.map(n=>n.name));
  if(names.size!==sourceNodes.length||new Set(sourceNodes.map(n=>n.mesh)).size!==sourceNodes.length)fail('instanced or unnamed meshes');
  const wanted=new Map();
  for(const expression of facialExpressions){
    const list=bindings.expressions[expression];
    if(!Array.isArray(list)||(!list.length&&expression!=='vrc.v_sil'))fail('missing '+expression);
    const seen=new Set();
    for(const entry of list){
      if(!names.has(entry.mesh)||typeof entry.shape!=='string'||!entry.shape||entry.shape.length>100||!Number.isFinite(entry.weight)||entry.weight<=0||entry.weight>1)fail('invalid binding '+expression);
      const key=JSON.stringify([entry.mesh,entry.shape]);if(seen.has(key))fail('duplicate binding');seen.add(key);
      if(!wanted.has(entry.mesh))wanted.set(entry.mesh,new Set());wanted.get(entry.mesh).add(entry.shape);
    }
  }
  const jsonLength=source.readUInt32LE(12),binStart=28+jsonLength;
  const chunks=[source.subarray(binStart,binStart+source.readUInt32LE(20+jsonLength))];let length=chunks[0].length;
  const nonzero=new Set(),allDeltas=new Map();
  for(const node of sourceNodes){
    const shapes=wanted.get(node.name);if(!shapes)continue;
    const other=candidateNodes.find(n=>n.name===node.name);if(!other)fail('missing mesh '+node.name);
    const mesh=d.meshes[node.mesh],incoming=b.doc.meshes[other.mesh],oldNames=mesh.extras?.targetNames||[];
    const originalPositions=new Map();for(const p of mesh.primitives){const ids=a.read(p.attributes._WORKBENCH_VERTEX),positions=a.read(p.attributes.POSITION);ids.forEach(([id],i)=>originalPositions.set(id,positions[i]));}
    if((mesh.primitives[0].targets?.length||0)!==oldNames.length)fail('existing morph names required');
    if([...shapes].some(s=>oldNames.includes(s)))fail('new shapes must not replace existing morphs');
    const maps=new Map(),normalMaps=new Map();
    for(const shape of shapes){
      const target=incoming.extras?.targetNames?.indexOf(shape);if(!(target>=0))fail('missing shape '+shape);
      const values=new Map(),normals=new Map();
      for(const p of incoming.primitives){
        const ids=b.read(p.attributes._WORKBENCH_VERTEX),delta=p.targets?.[target]?.POSITION;
        const positions=b.read(p.attributes.POSITION);
        ids.forEach(([id],i)=>{const original=originalPositions.get(id);if(!original||original.some((v,j)=>Math.abs(v-positions[i][j])>1e-5))fail('mesh-local rest coordinates changed');});
        if(delta===undefined)fail('missing POSITION target');
        const rows=b.read(delta);if(rows.length!==ids.length)fail('target length');
        if(p.targets[target].NORMAL!==undefined&&p.attributes.NORMAL!==undefined){
          const base=b.read(p.attributes.NORMAL),nd=b.read(p.targets[target].NORMAL);if(base.length!==ids.length||nd.length!==ids.length)fail('normal target length');
          ids.forEach(([id],i)=>{if(!normals.has(id))normals.set(id,[]);normals.get(id).push({base:base[i],delta:nd[i]});});
        }
        ids.forEach(([id],i)=>{const v=rows[i];if(v.length!==3||v.some(x=>!Number.isFinite(x)))fail('invalid delta');const prev=values.get(id);if(prev&&prev.some((x,j)=>Math.abs(x-v[j])>1e-6))fail('split seam morph');values.set(id,v);});
      }
      maps.set(shape,values);
      normalMaps.set(shape,normals);
      allDeltas.set(JSON.stringify([node.name,shape]),values);
    }
    for(const p of mesh.primitives){
      const ids=a.read(p.attributes._WORKBENCH_VERTEX);p.targets||=[];
      if(p.targets.length!==oldNames.length)fail('inconsistent existing targets');
      for(const shape of shapes){
        const data=Buffer.alloc(ids.length*12),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
        ids.forEach(([id],i)=>{const v=maps.get(shape).get(id);if(!v)fail('missing source identity');v.forEach((x,j)=>{data.writeFloatLE(x,i*12+j*4);min[j]=Math.min(min[j],x);max[j]=Math.max(max[j],x);if(Math.abs(x)>1e-7)nonzero.add(JSON.stringify([node.name,shape]));});});
        const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}
        const view=d.bufferViews.length;d.bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length});chunks.push(data);length+=data.length;
        const accessor=d.accessors.length;d.accessors.push({bufferView:view,componentType:5126,count:ids.length,type:'VEC3',min,max});p.targets.push({POSITION:accessor});
        if(p.attributes.NORMAL!==undefined&&normalMaps.get(shape).size){
          const base=a.read(p.attributes.NORMAL),normalData=Buffer.alloc(ids.length*12);
          ids.forEach(([id],i)=>{const row=normalMaps.get(shape).get(id)?.find(v=>v.base.every((x,j)=>Math.abs(x-base[i][j])<1e-4));if(!row)fail('normal seam correspondence');row.delta.forEach((v,j)=>normalData.writeFloatLE(v,i*12+j*4));});
          const normalView=d.bufferViews.length;d.bufferViews.push({buffer:0,byteOffset:length,byteLength:normalData.length});chunks.push(normalData);length+=normalData.length;
          const normalAccessor=d.accessors.length;d.accessors.push({bufferView:normalView,componentType:5126,count:ids.length,type:'VEC3'});p.targets.at(-1).NORMAL=normalAccessor;
        }
      }
    }
    mesh.extras={...mesh.extras,targetNames:[...oldNames,...shapes]};
    mesh.weights=[...(mesh.weights||Array(oldNames.length).fill(0)),...Array(shapes.size).fill(0)];
    if(node.weights)node.weights=[...node.weights,...Array(shapes.size).fill(0)];
  }
  for(const name of facialExpressions.filter(e=>e!=='vrc.v_sil'))if(!bindings.expressions[name].some(e=>nonzero.has(JSON.stringify([e.mesh,e.shape]))))fail('empty expression '+name);
  inspectBlinkEyeIntegrity(a,bindings,allDeltas,coordinatedParts);
  inspectEyeShadowBindings(a,b,bindings,allDeltas,coordinatedParts);
  const visemeSignatures=new Set();
  for(const name of facialExpressions.filter(e=>e.startsWith('vrc.v_')&&e!=='vrc.v_sil')){
    const combined=new Map();for(const entry of bindings.expressions[name])for(const [id,delta] of allDeltas.get(JSON.stringify([entry.mesh,entry.shape]))){const key=JSON.stringify([entry.mesh,id]),v=combined.get(key)||[0,0,0];combined.set(key,v.map((x,i)=>x+delta[i]*entry.weight));}
    const signature=JSON.stringify([...combined].map(([key,v])=>[key,v.map(x=>Math.round(x*1e6))]).filter(([,v])=>v.some(x=>x)).sort(([a],[b])=>a.localeCompare(b)));
    if(visemeSignatures.has(signature))fail('duplicate speech poses');visemeSignatures.add(signature);
  }
  // All expressions are returned at rest; prior morph defaults must also be neutral.
  if(d.meshes.some(m=>m.weights?.some(v=>v!==0))||d.nodes.some(n=>n.weights?.some(v=>v!==0)))fail('reset original morph weights');
  d.buffers[0].byteLength=length;
  const raw=Buffer.from(JSON.stringify(d)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),bin=Buffer.concat(chunks),header=Buffer.alloc(20),bh=Buffer.alloc(8);
  header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
  const bytes=Buffer.concat([header,json,bh,bin]);inspectRigConnectivity(source,bytes,{required:true});
  return bytes;
}

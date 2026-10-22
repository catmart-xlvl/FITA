import {Matrix4,Matrix3,Vector3,Quaternion} from 'three';
import {createDeformationSurface,partMatrix,validateDeformers} from '../shared/placement-deformers.js';

export function deformationRecords(bytes,part,transform){
 const jsonLength=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+jsonLength).toString()),binStart=20+jsonLength+8;
 const sizes={5126:4,5125:4,5123:2,5121:1},reads={5126:'readFloatLE',5125:'readUInt32LE',5123:'readUInt16LE',5121:'readUInt8'};
 function accessor(index){const a=doc.accessors?.[index],v=doc.bufferViews?.[a?.bufferView],count={SCALAR:1,VEC3:3}[a?.type],size=sizes[a?.componentType];if(!a||!v||v.buffer!==0||a.sparse||a.normalized||!count||!size)throw Error('PLACEMENT_DEFORMER_SOURCE_CHANGED');const array=[];for(let i=0;i<a.count;i++)for(let j=0;j<count;j++)array.push(bytes[reads[a.componentType]](binStart+(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*count)+j*size));return array;}
 const records=[],roots=doc.scenes?.[doc.scene||0]?.nodes||[],partTransform=partMatrix(transform),seen=new Set();
 function walk(index,parent){if(seen.has(index))throw Error('PLACEMENT_DEFORMER_SOURCE_CHANGED');seen.add(index);const node=doc.nodes[index],local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3(...node.translation||[0,0,0]),new Quaternion(...node.rotation||[0,0,0,1]),new Vector3(...node.scale||[1,1,1])),matrix=parent.clone().multiply(local);
  if(node.skin!==undefined)throw Error('PLACEMENT_DEFORMER_SOURCE_CHANGED');
  if(node.mesh!==undefined)doc.meshes[node.mesh].primitives.forEach((primitive,p)=>{if(primitive.mode!==undefined&&primitive.mode!==4)throw Error('PLACEMENT_DEFORMER_SOURCE_CHANGED');records.push({part,key:index+':'+p,sourceName:node.name||doc.meshes[node.mesh].name||null,positions:accessor(primitive.attributes.POSITION),indices:primitive.indices===undefined?null:accessor(primitive.indices),vertexIds:primitive.attributes._WORKBENCH_VERTEX===undefined?null:accessor(primitive.attributes._WORKBENCH_VERTEX),matrix:partTransform.clone().multiply(matrix).toArray()});});
  for(const child of node.children||[])walk(child,matrix);
 }
 for(const node of roots)walk(node,new Matrix4());return records;
}

// Replay positions on the connected editable import, before its placement is
// baked. Matching is exact source position at float precision, never nearest.
export function deformationBake(head,body,manual){
 const state=validateDeformers(manual.deformers);if(!state.pins.length)return null;
 const surface=createDeformationSurface(['head','body'].flatMap(g=>deformationRecords(g==='head'?head:body,g,manual.transforms[g]))),result=surface.apply(state),tables={head:new Map(),body:new Map()},C=new Matrix4().makeRotationX(Math.PI/2);
 const affected=new Set([...surface.lookup.values()].filter(item=>Array.from({length:item.count},(_,i)=>result.fields.has(item.start+i)).some(Boolean)).map(item=>item.part));
 for(const item of surface.lookup.values()){
  if(!affected.has(item.part))continue;
  const inverse=partMatrix(manual.transforms[item.part]).invert(),rotation=new Matrix3().setFromMatrix4(C.clone().multiply(inverse)),rotationInverse=rotation.clone().invert();
  for(let i=0;i<item.count;i++){
   const index=item.start+i,before=result.original[index].clone().applyMatrix4(inverse).applyMatrix4(C),after=result.world[index].clone().applyMatrix4(inverse).applyMatrix4(C),key=before.toArray().map(n=>Math.round(n*1e6)).join(',');
   const j=result.fields.get(index),jacobian=j?new Matrix3().set(...j):new Matrix3(),normalMatrix=rotation.clone().multiply(jacobian).multiply(rotationInverse).invert().transpose().toArray();
   const vertexId=item.vertexIds?.[i],sourceName=item.sourceName;
   const identity=vertexId!==undefined&&sourceName?JSON.stringify([sourceName,vertexId]):key;
   const entry={before:before.toArray(),after:after.toArray(),normalMatrix,...(identity!==key?{sourceName,vertexId}: {})};const old=tables[item.part].get(identity);
   if(old&&(new Vector3(...old.after).distanceTo(after)>1e-6||old.normalMatrix.some((v,i)=>Math.abs(v-normalMatrix[i])>1e-5)))throw Error('PLACEMENT_DEFORMER_AMBIGUOUS_SURFACE');
   tables[item.part].set(identity,entry);
  }
 }
 return Object.fromEntries(['head','body'].map(g=>[g,[...tables[g].values()]]));
}

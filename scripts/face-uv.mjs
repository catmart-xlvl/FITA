// Explicit, replayable UV-only migration. Never trust a Blender re-export to
// preserve unrelated geometry, materials, animation, or facial preparations.
import {createHash} from 'node:crypto';
import {parseGlb,buildGlb,atlasImages} from './texture-layout.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('FACE_UV_INVALID');};
export function readAccessor(j,bin,id){
 const a=j.accessors[id],v=j.bufferViews[a?.bufferView],n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a?.type],size={5121:1,5123:2,5125:4,5126:4}[a?.componentType];
 if(!v||!n||!size||a.sparse||a.normalized||v.buffer!==0)fail();
 const read={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];
 return Array.from({length:a.count},(_,i)=>Array.from({length:n},(_,k)=>bin[read]((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*n)+k*size)));
}
export function faceUvInput(bytes,nodeName='head-face'){
 const {json:j,bin}=parseGlb(bytes),nodes=j.nodes.filter(n=>n.name===nodeName);if(nodes.length!==1)fail();
 const mesh=nodes[0].mesh,m=j.meshes[mesh];if(m.primitives.length!==1)fail();const p=m.primitives[0],mat=j.materials[p.material];
 // Tangent-space normals and additional texture channels need their own bake.
 // Stop rather than silently misregister them on the new layout.
 if(p.targets||p.extensions||!Number.isInteger(p.attributes.TEXCOORD_0)||p.mode!==undefined&&p.mode!==4||Object.keys(p.attributes).some(k=>!['POSITION','NORMAL','TEXCOORD_0','_WORKBENCH_VERTEX'].includes(k)))fail();
 if(mat.normalTexture||mat.occlusionTexture||mat.emissiveTexture||mat.pbrMetallicRoughness?.metallicRoughnessTexture||mat.extensions||mat.alphaMode&&mat.alphaMode!=='OPAQUE')fail();
 const tex=mat.pbrMetallicRoughness.baseColorTexture;if(!tex||tex.texCoord||tex.extensions)fail();
 const imageIndex=j.textures[tex.index].source,image=atlasImages(bytes)[imageIndex];
 return {schema:'workbench-face-uv/v1',sourceHash:hash(bytes),nodeName,mesh,primitive:0,positions:readAccessor(j,bin,p.attributes.POSITION),uv:readAccessor(j,bin,p.attributes.TEXCOORD_0),triangles:readAccessor(j,bin,p.indices).map(x=>x[0]),imageIndex,image};
}
export function applyFaceUv(bytes,patch,png){
 const input=faceUvInput(bytes,patch.nodeName),{json:j,bin}=parseGlb(bytes);
 if(patch.schema!==input.schema||patch.sourceHash!==input.sourceHash||patch.mesh!==input.mesh||patch.primitive!==0||patch.uv?.length!==input.triangles.length||patch.uv.some(u=>u.length!==2||u.some(x=>!Number.isFinite(x)||x<0||x>1))||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail();
 const p=j.meshes[input.mesh].primitives[0];let length=bin.length;const chunks=[bin];
 function view(b){const pad=Buffer.alloc((4-length%4)%4);chunks.push(pad,b);length+=pad.length;const id=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:length,byteLength:b.length});length+=b.length;return id;}
 function accessor(values,type,componentType=5126){const b=Buffer.alloc(values.flat().length*4);values.flat().forEach((v,i)=>componentType===5126?b.writeFloatLE(v,i*4):b.writeUInt32LE(v,i*4));const id=j.accessors.length;const a={bufferView:view(b),componentType,count:values.length,type};if(type==='VEC3'){a.min=[0,1,2].map(k=>Math.min(...values.map(v=>v[k])));a.max=[0,1,2].map(k=>Math.max(...values.map(v=>v[k])));}j.accessors.push(a);return id;}
 // Deduplicate identical new corner attributes; splits exist only at actual
 // new seams, and vertex/normal values are copied exactly from the source.
 const oldIndices=input.triangles,keys=new Map(),remap=[],sourceVertices=[],newUv=[];
 oldIndices.forEach((id,c)=>{const key=id+':'+patch.uv[c].map(Math.fround).join(',');let dst=keys.get(key);if(dst===undefined){dst=keys.size;keys.set(key,dst);sourceVertices.push(id);newUv.push(patch.uv[c]);}remap.push([dst]);});
 for(const [name,id]of Object.entries(p.attributes)){const values=readAccessor(j,bin,id);p.attributes[name]=accessor(name==='TEXCOORD_0'?newUv:sourceVertices.map(i=>values[i]),j.accessors[id].type);}
 p.indices=accessor(remap,'SCALAR',5125);
 // New image/texture/material: a shared source atlas may serve other objects.
 const material=structuredClone(j.materials[p.material]),oldTexture=j.textures[material.pbrMetallicRoughness.baseColorTexture.index];
 const imageId=j.images.length;j.images.push({bufferView:view(png),mimeType:'image/png',name:'head-face_rebaked'});
 material.pbrMetallicRoughness.baseColorTexture.index=j.textures.length;j.textures.push({...oldTexture,source:imageId});p.material=j.materials.length;j.materials.push(material);
 j.buffers[0].byteLength=length;return buildGlb(j,Buffer.concat(chunks));
}
export function verifyFaceUv(original,result,patch){
 const images=atlasImages(result),png=images.at(-1).bytes,expected=applyFaceUv(original,patch,png);
 if(!expected.equals(result))fail();return {geometryPreserved:true,unrelatedAssetsPreserved:true,uvRebuilt:true};
}

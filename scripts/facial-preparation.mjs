// Portable, deterministic eye/brow patch. Original vertex/UV buffers are retained;
// only reviewed triangle indices are removed and named facial pieces appended.
import {parseGlb,buildGlb,atlasImages,replaceAtlases,verifyTextureLayout} from './texture-layout.mjs';
const fail=()=>{throw Error('REFINE_FACIAL_PATCH_INVALID');};
const roles=new Set(['iris','pupil','glint','eyebrow','sclera','eyeshadow']);
function readAccessor(j,b,i){const a=j.accessors?.[i],v=j.bufferViews?.[a?.bufferView];if(!a||!v||a.sparse||v.byteStride)fail();const size={5123:2,5125:4,5126:4}[a.componentType],n={SCALAR:1,VEC2:2,VEC3:3}[a.type];if(!size||!n)fail();const start=(v.byteOffset||0)+(a.byteOffset||0);if(start+a.count*n*size>b.length)fail();return Array.from({length:a.count*n},(_,k)=>a.componentType===5126?b.readFloatLE(start+k*size):size===2?b.readUInt16LE(start+k*size):b.readUInt32LE(start+k*size));}
export function applyFacialPatch(source,patch){
 if(patch?.schema!=='workbench-facial-preparation/v1'||!Array.isArray(patch.removals)||!Array.isArray(patch.pieces)||patch.pieces.length<2||patch.pieces.length>24||patch.removals.length>8)fail();
 const {json:j,bin}=parseGlb(source);let length=bin.length,chunks=[bin];
 const append=(bytes)=>{const pad=Buffer.alloc((4-length%4)%4);chunks.push(pad,bytes);length+=pad.length;const i=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length});length+=bytes.length;return i;};
 const accessor=(values,n,float=true)=>{if(!Array.isArray(values)||!values.length||values.length%n||values.length>180000||values.some(v=>!Number.isFinite(v)))fail();const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>{if(float)b.writeFloatLE(v===0?0:v,i*4);else{if(!Number.isInteger(v)||v<0)fail();b.writeUInt32LE(v,i*4);}});const a={bufferView:append(b),componentType:float?5126:5125,count:values.length/n,type:{1:'SCALAR',2:'VEC2',3:'VEC3'}[n]};if(n===3){a.min=[0,1,2].map(k=>Math.min(...values.filter((_,i)=>i%3===k)));a.max=[0,1,2].map(k=>Math.max(...values.filter((_,i)=>i%3===k)));}j.accessors.push(a);return j.accessors.length-1;};
 const removedKeys=new Set();let removed=0;const zones=[];
 for(const r of patch.removals){
  const key=`${r.mesh}:${r.primitive}`;if(removedKeys.has(key)||!Number.isInteger(r.mesh)||!Number.isInteger(r.primitive))fail();removedKeys.add(key);
  const p=j.meshes?.[r.mesh]?.primitives?.[r.primitive];if(!p||!Number.isInteger(p.indices)||(p.mode??4)!==4||!Array.isArray(r.triangles)||!r.triangles.length)fail();
  const node=j.nodes.find(n=>n.mesh===r.mesh);if(!node||/hair|body/i.test(node.name||''))fail();
  const ids=readAccessor(j,bin,p.indices),pos=readAccessor(j,bin,p.attributes.POSITION),drop=new Set(r.triangles);
  if(drop.size!==r.triangles.length||drop.size>ids.length/3*.20||[...drop].some(i=>!Number.isInteger(i)||i<0||i>=ids.length/3))fail();
  if(!Array.isArray(r.regions)||!r.regions.length||r.regions.length>4)fail();
  const spans=[0,1,2].map(k=>Math.max(...pos.filter((_,i)=>i%3===k))-Math.min(...pos.filter((_,i)=>i%3===k))),span=Math.max(...spans);
  for(const region of r.regions){if(!region?.min||!region.max||region.min.length!==3||region.max.length!==3||region.min.some((v,k)=>!Number.isFinite(v)||!Number.isFinite(region.max[k])||region.max[k]<=v||region.max[k]-v>span*.4))fail();zones.push(region);}
  for(const t of drop)for(const id of ids.slice(t*3,t*3+3)){const point=pos.slice(id*3,id*3+3);if(!r.regions.some(z=>point.every((v,k)=>v>=z.min[k]&&v<=z.max[k])))fail();}
  p.indices=accessor(ids.filter((_,i)=>!drop.has(Math.floor(i/3))),1,false);removed+=drop.size;
 }
 // Add shadows to an already prepared face without rebuilding approved eyes.
 const shadowsOnly=!removed&&patch.pieces.length===2&&patch.pieces.every(p=>p.role==='eyeshadow');
 if(!removed){
  if(!shadowsOnly||!Array.isArray(patch.regions)||!patch.regions.length||patch.regions.length>2)fail();
  const face=j.nodes.find(n=>['face','head-face'].includes(n.name)),p=j.meshes?.[face?.mesh]?.primitives?.[0];if(!p)fail();
  const pos=readAccessor(j,bin,p.attributes.POSITION),lo=[0,1,2].map(k=>Math.min(...pos.filter((_,i)=>i%3===k))),hi=[0,1,2].map(k=>Math.max(...pos.filter((_,i)=>i%3===k))),span=Math.max(...hi.map((v,k)=>v-lo[k]));
  for(const z of patch.regions){if(!z?.min||!z.max||z.min.length!==3||z.max.length!==3||z.min.some((v,k)=>!Number.isFinite(v)||!Number.isFinite(z.max[k])||z.max[k]<=v||z.max[k]-v>span*.4||v<lo[k]-.003||z.max[k]>hi[k]+.003))fail();zones.push(z);}
 }
 const names=new Set(),eyeRoles={L:new Set(),R:new Set()};let newFaces=0;
 for(const piece of patch.pieces){
  const {role,eye,name,positions,normals,uv,indices}=piece;const label={iris:'Iris',pupil:'Pupil',glint:'Glint',eyebrow:'Eyebrow',sclera:'Sclera',eyeshadow:'EyeShadow'}[role];if(!roles.has(role)||!['L','R'].includes(eye)||typeof name!=='string'||!new RegExp(`^WB_${label}_${eye}(?:_[0-9]+)?$`).test(name)||names.has(name)||j.nodes.some(n=>n.name===name))fail();names.add(name);eyeRoles[eye].add(role);
  if(!Array.isArray(positions)||positions.length%3||positions.length>30000||!Array.isArray(normals)||normals.length!==positions.length||!Array.isArray(uv)||uv.length!==positions.length/3*2||!Array.isArray(indices)||indices.length%3||indices.length>30000||indices.some(i=>!Number.isInteger(i)||i<0||i>=positions.length/3)||[...positions,...normals,...uv].some(v=>!Number.isFinite(v))||uv.some(v=>v<0||v>1))fail();
  for(let i=0;i<positions.length;i+=3)if(!zones.some(z=>positions.slice(i,i+3).every((v,k)=>v>=z.min[k]-.003&&v<=z.max[k]+.003)))fail();
  if(['glint','sclera','eyeshadow'].includes(role)&&(piece.white!==true||piece.texture))fail();
  if(role==='eyeshadow'&&(!Number.isFinite(piece.opacity)||piece.opacity<=0||piece.opacity>=1||indices.length/3>128))fail();
  let texture=piece.texture?Buffer.from(piece.texture,'base64'):Buffer.from(patch.whiteTexture||'','base64');if(texture.length<24||texture.length>4*1024*1024||!texture.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail();
  const image=j.images.length;j.images.push({bufferView:append(texture),mimeType:'image/png'});const tex=j.textures.length;j.textures.push({source:image});const mat=j.materials.length;
  j.materials.push({name,extras:{workbenchFacialRole:role},pbrMetallicRoughness:{baseColorTexture:{index:tex},baseColorFactor:role==='eyeshadow'?[0,0,0,piece.opacity]:[1,1,1,1],metallicFactor:0,roughnessFactor:1},doubleSided:true,...(role==='eyeshadow'?{alphaMode:'BLEND'}:{}),...(['glint','sclera','eyeshadow'].includes(role)?{extensions:{KHR_materials_unlit:{}}}:{} )});
  const prim={attributes:{POSITION:accessor(positions,3),NORMAL:accessor(normals,3),TEXCOORD_0:accessor(uv,2)},indices:accessor(indices,1,false),material:mat};
  const mesh=j.meshes.length;j.meshes.push({name,primitives:[prim]});const ni=j.nodes.length;j.nodes.push({name,mesh,extras:{workbenchFacialRole:role,eye}});j.scenes[j.scene||0].nodes.push(ni);newFaces+=indices.length/3;
 }
 if(shadowsOnly){if(['L','R'].some(e=>!eyeRoles[e].has('eyeshadow')||!['Iris','Pupil'].every(r=>j.nodes.some(n=>n.name===`WB_${r}_${e}`))))fail();}
 else if(['L','R'].some(e=>!['iris','pupil'].every(r=>eyeRoles[e].has(r))))fail();
 if(newFaces>5000)fail();
 j.extensionsUsed=[...new Set([...(j.extensionsUsed||[]),'KHR_materials_unlit'])];j.buffers[0].byteLength=length;
 return buildGlb(j,Buffer.concat(chunks));
}
export function verifyFacialPreparation(original,result,patch){
 const before=atlasImages(original),after=atlasImages(result);if(after.length!==before.length+patch?.pieces?.length)fail();
 const edited=new Map(before.filter((a,i)=>a.sha256!==after[i]?.sha256).map(a=>[a.index,after[a.index].bytes]));
 const expected=applyFacialPatch(replaceAtlases(original,edited),patch);verifyTextureLayout(expected,result);
 const expectedImages=atlasImages(expected);for(let i=before.length;i<after.length;i++)if(after[i].sha256!==expectedImages[i].sha256)fail();
 return {protectedGeometryPreserved:true,originalUvsPreserved:true,pieces:patch.pieces.length,removedFaces:patch.removals.reduce((n,r)=>n+r.triangles.length,0)};
}

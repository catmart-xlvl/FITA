import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {buildGlb,parseGlb,atlasImages} from '../scripts/texture-layout.mjs';
import {faceUvInput,applyFaceUv,verifyFaceUv,readAccessor} from '../scripts/face-uv.mjs';
import {reviewFaceUvAudit,faceGeometryHash,validateFaceUvProfile} from '../server/face-uv.js';

test('semantic UV selections are disjoint and bound to exact source corner geometry',()=>{
 const input={positions:[[0,0,0],[1,0,0],[0,1,0]],triangles:[0,1,2]},profile={schema:'workbench-face-uv-regions/v1',geometryHash:faceGeometryHash(input),regions:{'ear-left':[0]}};
 assert.deepEqual(validateFaceUvProfile(profile,input),profile);
 for(const update of [{regions:{skin:[0]}},{regions:{'ear-left':[1]}},{regions:{'ear-left':[0],'eye-left':[0]}},{geometryHash:'0'.repeat(64)}])assert.throws(()=>validateFaceUvProfile({...profile,...update},input),/FACE_UV_PROFILE_/);
});
test('new facial layout requires one continuous skin island and a completed zero overlap check',()=>{
 const input={positions:[[0,0,0],[1,0,0],[0,1,0]],triangles:[0,1,2]},audit={layout:'single-face-island/v1',skinIslands:1,skinIslandFaces:[1],newIslands:1,uvOverlapChecked:true,overlappingTexels:0};
 assert.doesNotThrow(()=>reviewFaceUvAudit(input,audit));
 for(const update of [{skinIslands:2},{uvOverlapChecked:false},{overlappingTexels:undefined}])assert.throws(()=>reviewFaceUvAudit(input,{...audit,...update}),/FACE_UV_REVIEW_REQUIRED/);
});

test('continuous skin review measures source area instead of decorative triangle density',()=>{
 const input={positions:[[0,0,0],[1,0,0],[0,1,0]],triangles:[0,1,2]};
 for(let i=0;i<20;i++){const v=input.positions.length;input.positions.push([i+2,0,0],[i+2.001,0,0],[i+2,.001,0]);input.triangles.push(v,v+1,v+2);}
 const audit={layout:'single-face-island/v1',skinIslands:1,skinIslandFaces:[1],newIslands:21,uvOverlapChecked:true,overlappingTexels:0,uvFoldChecked:true,skinSourceFaces:[0]};
 assert(reviewFaceUvAudit(input,audit).skinSurfaceFraction>.99);
 for(const update of [{skinSourceFaces:[1]},{skinSourceFaces:[0,0],skinIslandFaces:[2]},{skinSourceFaces:[21]},{uvFoldChecked:false},{skinIslandFaces:[2]},{skinIslands:2}])assert.throws(()=>reviewFaceUvAudit(input,{...audit,...update}),/FACE_UV_REVIEW_REQUIRED/);
 const old={...audit};delete old.skinSourceFaces;assert.throws(()=>reviewFaceUvAudit(input,old),/FACE_UV_REVIEW_REQUIRED/);
});

test('UV review permits disconnected facial details without relaxing skin continuity',()=>{
 const positions=[],triangles=[];
 for(let i=0;i<66;i++){const v=positions.length;positions.push([i*3,0,0],[i*3+1,0,0],[i*3,1,0]);triangles.push(v,v+1,v+2);}
 const input={positions,triangles},audit={skinIslands:4,skinIslandFaces:[40,2,1,1],newIslands:75};
 assert.deepEqual(reviewFaceUvAudit(input,audit),{geometryComponents:66,allowedTotalIslands:97});
 for(const update of [{skinIslands:9},{skinIslandFaces:[20]},{newIslands:98},{newIslands:NaN}]){
  assert.throws(()=>reviewFaceUvAudit(input,{...audit,...update}),/FACE_UV_REVIEW_REQUIRED/);
 }
 assert.throws(()=>reviewFaceUvAudit(input,{}),/FACE_UV_REVIEW_REQUIRED/);
});
test('UV review welds seam duplicates and keeps the previous limit on connected geometry',()=>{
 const input={positions:[[0,0,0],[1,0,0],[0,1,0],[0,1,0],[1,0,0],[1,1,0]],triangles:[0,1,2,3,4,5]};
 const audit={skinIslands:1,skinIslandFaces:[2],newIslands:32};
 assert.deepEqual(reviewFaceUvAudit(input,audit),{geometryComponents:1,allowedTotalIslands:32});
 assert.throws(()=>reviewFaceUvAudit(input,{...audit,newIslands:33}),/FACE_UV_REVIEW_REQUIRED/);
});

test('UV island allowance counts sheets separated at ambiguous proxy edges',()=>{
 const input={positions:[[0,0,0],[1,0,0],[0,1,0],[0,-1,0],[0,0,1]],triangles:[0,1,2,1,0,3,0,1,4]};
 const audit={skinIslands:1,skinIslandFaces:[2],newIslands:34};
 assert.deepEqual(reviewFaceUvAudit(input,audit),{geometryComponents:3,allowedTotalIslands:34});
 assert.throws(()=>reviewFaceUvAudit(input,{...audit,newIslands:35}),/FACE_UV_REVIEW_REQUIRED/);
});

async function fixture(){
 const image=await sharp({create:{width:64,height:64,channels:3,background:'#d6a69b'}}).png().toBuffer(),geo=Buffer.alloc(104);
 [0,0,0,1,0,0,0,1,0,1,1,0].forEach((v,i)=>geo.writeFloatLE(v,4*i));
 [0,0,1,0,0,1,1,1].forEach((v,i)=>geo.writeFloatLE(v,48+4*i));[0,1,2,2,1,3].forEach((v,i)=>geo.writeUInt32LE(v,80+4*i));
 return buildGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],nodes:[{name:'head-face',mesh:0},{name:'head-hair',mesh:1,translation:[2,0,0]}],buffers:[{byteLength:104+image.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:48},{buffer:0,byteOffset:48,byteLength:32},{buffer:0,byteOffset:80,byteLength:24},{buffer:0,byteOffset:104,byteLength:image.length}],accessors:[{bufferView:0,componentType:5126,count:4,type:'VEC3'},{bufferView:1,componentType:5126,count:4,type:'VEC2'},{bufferView:2,componentType:5125,count:6,type:'SCALAR'}],meshes:[0,1].map(()=>({primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2,material:0}]})),materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{bufferView:3,mimeType:'image/png'}]},Buffer.concat([geo,image]));
}
test('face UV patch changes only requested corner UVs and a private atlas, preserving shared skin/hair inputs',async()=>{
 const original=await fixture(),input=faceUvInput(original),patch={...input,uv:[[.02,.02],[.6,.02],[.02,.6],[.8,.1],[.8,.7],[.98,.7]]};delete patch.image;
 const result=applyFaceUv(original,patch,input.image.bytes),a=parseGlb(original),b=parseGlb(result);
 assert(verifyFaceUv(original,result,patch).geometryPreserved);
 assert.deepEqual(a.json.meshes[1],b.json.meshes[1]);assert.deepEqual(a.json.nodes,b.json.nodes);assert.deepEqual(a.json.materials[0],b.json.materials[0]);
 assert(b.bin.subarray(0,a.bin.length).equals(a.bin));assert.equal(atlasImages(result)[0].sha256,atlasImages(original)[0].sha256);
 const p=b.json.meshes[0].primitives[0],pos=readAccessor(b.json,b.bin,p.attributes.POSITION),indices=readAccessor(b.json,b.bin,p.indices).flat(),uv=readAccessor(b.json,b.bin,p.attributes.TEXCOORD_0);
 assert.deepEqual(indices.map(i=>pos[i]),input.triangles.map(i=>input.positions[i]));assert.deepEqual(indices.map(i=>uv[i]),patch.uv.map(u=>u.map(Math.fround)));
 for(const mutate of [j=>j.nodes[1].translation=[0,0,0],j=>j.materials[0].doubleSided=true,j=>j.meshes[1].primitives[0].material=1]){const q=parseGlb(result);mutate(q.json);assert.throws(()=>verifyFaceUv(original,buildGlb(q.json,q.bin),patch),/FACE_UV_INVALID/);}
 const q=parseGlb(result);q.bin[0]^=1;assert.throws(()=>verifyFaceUv(original,buildGlb(q.json,q.bin),patch),/FACE_UV_INVALID/);
});
test('UV migration rejects stale inputs, invalid coordinates and unsupported maps rather than dropping channels',async()=>{
 const source=await fixture(),i=faceUvInput(source),p={...i,uv:i.triangles.map(x=>i.uv[x])};
 for(const update of [{sourceHash:'stale'},{uv:[[NaN,0]]},{uv:p.uv.map(()=>[1.1,0])},{nodeName:'head-hair'}])assert.throws(()=>applyFaceUv(source,{...p,...update},i.image.bytes),/FACE_UV_INVALID/);
 const q=parseGlb(source);q.json.materials[0].normalTexture={index:0};assert.throws(()=>faceUvInput(buildGlb(q.json,q.bin)),/FACE_UV_INVALID/);
});

test('face UV rebake carries original vertex identities into all newly split corners',async()=>{
 const q=parseGlb(await fixture()),values=Buffer.alloc(16);[0,1,2,3].forEach((v,i)=>values.writeFloatLE(v,4*i));
 const padding=Buffer.alloc((4-q.bin.length%4)%4),offset=q.bin.length+padding.length;
 q.json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:16});q.json.accessors.push({bufferView:q.json.bufferViews.length-1,componentType:5126,count:4,type:'SCALAR'});
 q.json.meshes[0].primitives[0].attributes._WORKBENCH_VERTEX=q.json.accessors.length-1;q.json.buffers[0].byteLength=offset+16;
 const original=buildGlb(q.json,Buffer.concat([q.bin,padding,values])),input=faceUvInput(original),patch={...input,uv:[[.02,.02],[.6,.02],[.02,.6],[.8,.1],[.8,.7],[.98,.7]]};
 const out=parseGlb(applyFaceUv(original,patch,input.image.bytes)),p=out.json.meshes[0].primitives[0],ids=readAccessor(out.json,out.bin,p.attributes._WORKBENCH_VERTEX).flat(),indices=readAccessor(out.json,out.bin,p.indices).flat();
 assert.deepEqual(indices.map(i=>ids[i]),input.triangles);
});

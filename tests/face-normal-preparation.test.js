import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildGlb,parseGlb}from'../scripts/texture-layout.mjs';import{positionDigest}from'../scripts/hair-normal-preparation.mjs';import{faceFieldNormals,applyFaceNormalPatch,verifyFaceNormalPreparation,validateFaceNormalReview}from'../scripts/face-normal-preparation.mjs';
const positions=[1,0,1,0,1,1,-1,0,1],original=[0,0,1,0,0,1,0,0,1],target={mesh:0,primitive:0,positionHash:positionDigest(positions),proxy:{type:'ellipsoid',center:[0,0,0],radii:[1,1,1]},weights:[1,.5,0]},patch={schema:'workbench-face-normals/v1',targets:[target]};
function fixture(){const bin=Buffer.alloc(72);[...positions,...original].forEach((v,i)=>bin.writeFloatLE(v,i*4));return buildGlb({asset:{version:'2.0'},buffers:[{byteLength:72}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36}],accessors:[{bufferView:0,type:'VEC3',componentType:5126,count:3},{bufferView:1,type:'VEC3',componentType:5126,count:3}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1}}]}],nodes:[{name:'face',mesh:0,skin:0}],skins:[{joints:[1]}],animations:[{name:'protected'}],images:[]},bin);}
test('face mask blends a smooth proxy without changing protected zero-weight normals',()=>{const n=faceFieldNormals(positions,original,target);assert(n[0]>.70&&n[2]>.70);assert(n[4]>.35&&n[4]<.40);assert.deepEqual(n.slice(6),original.slice(6));assert.throws(()=>faceFieldNormals(positions,original,{...target,weights:[0,0,0]}));assert.throws(()=>faceFieldNormals(positions,original,{...target,weights:[1,NaN,0]}));});
test('stored face normals preserve source buffers, geometry, skin, animations and export no proxy',()=>{const source=fixture(),result=applyFaceNormalPatch(source,patch),a=parseGlb(source),b=parseGlb(result);assert(verifyFaceNormalPreparation(source,result,patch).faceNormalsPrepared);assert.equal(a.json.meshes.length,b.json.meshes.length);assert.deepEqual(a.json.skins,b.json.skins);assert.deepEqual(a.json.animations,b.json.animations);assert(b.bin.subarray(0,a.bin.length).equals(a.bin));b.bin.writeFloatLE(9,0);assert.throws(()=>verifyFaceNormalPreparation(source,buildGlb(b.json,b.bin),patch));});
test('face transfer rejects wrong identity, other objects, morphs and unsupported review claims',()=>{const source=fixture();assert.throws(()=>applyFaceNormalPatch(source,{...patch,targets:[{...target,positionHash:'wrong'}]}));const a=parseGlb(source);a.json.nodes[0].name='hair';assert.throws(()=>applyFaceNormalPatch(buildGlb(a.json,a.bin),patch));a.json.nodes[0].name='face';a.json.meshes[0].primitives[0].targets=[{NORMAL:1}];assert.throws(()=>applyFaceNormalPatch(buildGlb(a.json,a.bin),patch));assert.throws(()=>validateFaceNormalReview({status:'prepared',reason:'unchecked',patch}));});

test('a rotated fitted ellipsoid evaluates normals in the face local space',()=>{
 const q=[0,0,Math.SQRT1_2,Math.SQRT1_2],p=[1,1,1],n=faceFieldNormals(p,[0,0,1],{weights:[1],proxy:{type:'ellipsoid',center:[0,0,0],radii:[2,1,1],rotation:q}}),length=Math.hypot(1,.25,1);
 for(let k=0;k<3;k++)assert(Math.abs(n[k]-[1,.25,1][k]/length)<1e-7);
 assert.throws(()=>faceFieldNormals(p,[0,0,1],{weights:[1],proxy:{...target.proxy,rotation:[0,0,0,2]}}));
});

test('face transfer accepts FITA transferred head-face while retaining target guards',()=>{
 const a=parseGlb(fixture());a.json.nodes[0].name='head-face';
 const source=buildGlb(a.json,a.bin),result=applyFaceNormalPatch(source,patch);
 assert(verifyFaceNormalPreparation(source,result,patch).faceNormalsPrepared);
 for(const name of ['head-hair','body','face-accessory']){
  a.json.nodes[0].name=name;assert.throws(()=>applyFaceNormalPatch(buildGlb(a.json,a.bin),patch));
 }
});

test('one reviewed field can cover facial skin and prepared eye layers, excluding hair and duplicate targets',()=>{
 const a=parseGlb(fixture());a.json.meshes.push(structuredClone(a.json.meshes[0]));a.json.nodes.push({name:'WB_Iris_L',mesh:1});const source=buildGlb(a.json,a.bin),multi={...patch,targets:[target,{...target,mesh:1}]},r=parseGlb(applyFaceNormalPatch(source,multi));
 const access=r.json.meshes.map(m=>r.json.accessors[m.primitives[0].attributes.NORMAL]),values=access.map(v=>r.bin.subarray(r.json.bufferViews[v.bufferView].byteOffset,r.json.bufferViews[v.bufferView].byteOffset+36));assert.deepEqual(values[0],values[1]);
 assert.throws(()=>applyFaceNormalPatch(source,{...patch,targets:[target,target]}));a.json.nodes[1].name='hair';assert.throws(()=>applyFaceNormalPatch(buildGlb(a.json,a.bin),multi));
});

test('the reusable mask is an open smooth unit hemisphere with no character geometry',async()=>{
 const {json:j,bin}=parseGlb(await fs.readFile(new URL('../resources/face-normals/face-normal-mask.glb',import.meta.url)));
 assert.equal(j.meshes.length,1);assert.equal(j.nodes.length,1);assert.equal(j.nodes[0].name,'FITA_FaceNormalMask');assert(!j.skins&&!j.animations);
 const p=j.meshes[0].primitives[0],read=index=>{const a=j.accessors[index],v=j.bufferViews[a.bufferView],o=(v.byteOffset||0)+(a.byteOffset||0);return Array.from({length:a.count*3},(_,i)=>bin.readFloatLE(o+Math.floor(i/3)*(v.byteStride||12)+(i%3)*4));},pos=read(p.attributes.POSITION),norm=read(p.attributes.NORMAL);
 let rim=0;for(let i=0;i<pos.length;i+=3){const point=pos.slice(i,i+3),normal=norm.slice(i,i+3);assert(point[2]>-1e-6);assert(Math.abs(Math.hypot(...point)-1)<1e-6);assert(point.reduce((s,v,k)=>s+v*normal[k],0)>.99999);if(Math.abs(point[2])<1e-6)rim++;}assert(rim>=96);
});

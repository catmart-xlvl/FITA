import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Vector3} from 'three';
import {buildGlb,parseGlb} from '../scripts/texture-layout.mjs';
import {parseRigGlb} from '../server/rig-connectivity.js';
import {applyFacialNormalField,facialNormalEvaluator} from '../server/facial-normal-field.js';
function fixture(){
 const d={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1,2]}],nodes:[{name:'face export',mesh:0},{name:'WB_Iris_L export',mesh:1},{name:'outfit export',mesh:2}],meshes:[],bufferViews:[],accessors:[],buffers:[],skins:[{joints:[0]}],materials:[{name:'preserved'}]},chunks=[];let offset=0;
 const add=(rows,type)=>{const b=Buffer.alloc(rows.flat().length*4);rows.flat().forEach((v,i)=>b.writeFloatLE(v,i*4));d.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length});offset+=b.length;chunks.push(b);d.accessors.push({bufferView:d.bufferViews.length-1,componentType:5126,type,count:rows.length});return d.accessors.length-1;};
 for(let i=0;i<3;i++)d.meshes.push({primitives:[{attributes:{POSITION:add([[-.02,0,.1],[.02,0,.1],[0,.01,.1]],'VEC3'),NORMAL:add([[0,0,1],[0,0,1],[0,0,1]],'VEC3'),TEXCOORD_0:add([[0,0],[1,0],[.5,1]],'VEC2'),_WORKBENCH_VERTEX:add([[0],[1],[2]],'SCALAR')}}]});
 const bin=Buffer.concat(chunks);d.buffers=[{byteLength:bin.length}];const source=buildGlb(d,bin),patch={schema:'workbench-facial-normal-field/v1',sourceSha256:createHash('sha256').update(source).digest('hex'),proxy:{type:'ellipsoid',center:[0,0,0],radii:[.2,.3,.2]},targets:['face export','WB_Iris_L export'].map(mesh=>({mesh,weights:[[0,1],[1,1],[2,1]]}))};return {source,patch};
}
test('shared face normal field changes only normals, preserves buffers/rig/UV and agrees across overlapping pieces',()=>{
 const {source,patch}=fixture(),r=applyFacialNormalField(source,patch,{allow:true}),a=parseGlb(source),b=parseGlb(r.bytes),parsed=parseRigGlb(r.bytes);
 assert(b.bin.subarray(0,a.bin.length).equals(a.bin));assert.deepEqual(b.json.skins,a.json.skins);assert.deepEqual(b.json.materials,a.json.materials);assert.deepEqual(b.json.nodes,a.json.nodes);assert.deepEqual(b.json.meshes[2],a.json.meshes[2]);
 for(let i=0;i<2;i++)for(const k of ['POSITION','TEXCOORD_0','_WORKBENCH_VERTEX'])assert.equal(b.json.meshes[i].primitives[0].attributes[k],a.json.meshes[i].primitives[0].attributes[k]);
 const normals=b.json.meshes.slice(0,2).map(m=>parsed.read(m.primitives[0].attributes.NORMAL));assert.deepEqual(normals[0],normals[1]);assert(normals[0][0][0]<0);assert.equal(r.validation.proxyExported,false);
});
test('collapsed eyelid geometry samples continuous normals from the mask, independently of triangle rotations',()=>{
 const {source,patch}=fixture(),sample=facialNormalEvaluator(parseRigGlb(source),patch).get('face export'),p=[[-.02,0,.1],[.02,0,.1],[0,0,.1]],old=[[0,1,0],[0,-1,0],[0,0,-1]],n=sample(p,old,[0,1,2]);
 for(const normal of n)assert(normal[2]>.98);assert(new Vector3(...n[0]).dot(new Vector3(...n[2]))>.98);
});

test('prepared and artist-authored eye shadow surfaces can share the face field without changing material alpha',()=>{
 for(const name of ['WB_EyeShadow_L','WB_EyeShadow_R export','eye_shadows']){
  const f=fixture(),a=parseGlb(f.source);a.json.nodes[1].name=name;
  const source=buildGlb(a.json,a.bin),patch={...f.patch,sourceSha256:createHash('sha256').update(source).digest('hex'),targets:[{mesh:name,weights:[[0,1],[1,1],[2,1]]}]};
  const result=applyFacialNormalField(source,patch,{allow:true});assert.deepEqual(parseGlb(result.bytes).json.materials,a.json.materials);assert.equal(result.validation.checks[0].mesh,name);
 }
});
test('normal correction requires explicit authorization, exact source, facial scope and valid proxy/identities',()=>{
 const {source,patch}=fixture();assert.throws(()=>applyFacialNormalField(source,patch),/CONFIRMATION_REQUIRED/);
 for(const mutate of [p=>p.sourceSha256='wrong',p=>p.targets[0].mesh='outfit export',p=>p.targets[0].weights[0][0]=100,p=>p.targets[0].weights[0][1]=NaN,p=>p.targets.push(p.targets[0]),p=>p.proxy.radii[0]=0]){
  const p=structuredClone(patch);mutate(p);assert.throws(()=>applyFacialNormalField(source,p,{allow:true}),/FACE_NORMAL/);
 }
});

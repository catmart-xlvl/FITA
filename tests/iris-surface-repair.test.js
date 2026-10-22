import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {repairIrisSurfaces} from '../server/iris-surface-repair.js';
import {parseRigGlb} from '../server/rig-connectivity.js';

function fixture(){
  const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],nodes:[{name:'WB_Iris_L export',mesh:0},{name:'Face',mesh:1}],meshes:[],accessors:[],bufferViews:[],buffers:[],materials:[{name:'approved'}],skins:[{joints:[0]}]},chunks=[];let offset=0;
  const add=(rows,type)=>{const b=Buffer.alloc(rows.flat().length*4);rows.flat().forEach((v,i)=>b.writeFloatLE(v,i*4));doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length});offset+=b.length;chunks.push(b);doc.accessors.push({bufferView:doc.bufferViews.length-1,componentType:5126,count:rows.length,type});return doc.accessors.length-1;};
  for(let i=0;i<2;i++)doc.meshes.push({primitives:[{material:0,attributes:{POSITION:add([[-.01,0,0],[.01,0,0],[0,.01,0]],'VEC3'),NORMAL:add([[0,0,1],[0,0,1],[0,0,1]],'VEC3'),_WORKBENCH_VERTEX:add([[0],[1],[2]],'SCALAR'),TEXCOORD_0:add([[0,0],[1,0],[.5,1]],'VEC2'),WEIGHTS_0:add([[1,0,0,0],[1,0,0,0],[1,0,0,0]],'VEC4')}}]});
  const bin=Buffer.concat(chunks);doc.buffers=[{byteLength:bin.length}];const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),head=Buffer.alloc(20),bh=Buffer.alloc(8);head.write('glTF');head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+bin.length,8);head.writeUInt32LE(json.length,12);head.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);const source=Buffer.concat([head,json,bh,bin]);
  const patch={mesh:'WB_Iris_L export',role:'iris',eye:'left',positions:[[0,-.01,0,0],[1,.01,0,0],[2,0,.01,-.0003]],normals:[[0,0,0,1],[1,0,0,1],[2,0,0,1]]};
  return {source,repair:{schema:'workbench-iris-surface-repair/v1',sourceSha256:createHash('sha256').update(source).digest('hex'),patches:[patch]}};
}

test('authorized iris repair preserves original binary and every nonocular attribute',()=>{
  const {source,repair}=fixture(),r=repairIrisSurfaces(source,repair,{allow:true}),a=parseRigGlb(source),b=parseRigGlb(r.bytes),attrs=a.doc.meshes[0].primitives[0].attributes,newAttrs=b.doc.meshes[0].primitives[0].attributes;
  assert.deepEqual(b.doc.nodes,a.doc.nodes);assert.deepEqual(b.doc.skins,a.doc.skins);assert.deepEqual(b.doc.materials,a.doc.materials);assert.deepEqual(b.doc.meshes[1],a.doc.meshes[1]);
  for(const k of ['_WORKBENCH_VERTEX','TEXCOORD_0','WEIGHTS_0'])assert.equal(newAttrs[k],attrs[k]);
  const start=28+source.readUInt32LE(12),end=start+source.readUInt32LE(20+source.readUInt32LE(12)),newStart=28+r.bytes.readUInt32LE(12);assert.deepEqual(r.bytes.subarray(newStart,newStart+end-start),source.subarray(start,end));
  assert(Math.abs(b.read(newAttrs.POSITION)[2][2]+.0003)<1e-9);assert.equal(r.validation.scope,'authorized-local-iris-smoothing');
});
test('repair requires explicit authorization and the exact immutable source hash',()=>{
  const {source,repair}=fixture();assert.throws(()=>repairIrisSurfaces(source,repair),/CONFIRMATION_REQUIRED/);repair.sourceSha256='stale';assert.throws(()=>repairIrisSurfaces(source,repair,{allow:true}),/source or schema/);
});
test('repair rejects body edits, changed identities, nonfinite data, bad normals and excessive motion',()=>{
  const mutations=[p=>p.mesh='Face',p=>p.positions[0][0]=9,p=>p.positions[0][1]=NaN,p=>p.normals[0][3]=2,p=>p.positions[2][3]=.003,p=>p.role='pupil'];
  for(const mutate of mutations){const {source,repair}=fixture();mutate(repair.patches[0]);assert.throws(()=>repairIrisSurfaces(source,repair,{allow:true}),/FACE_IRIS_REPAIR_INVALID/);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4} from 'three';
import {createDeformationSurface,validateDeformers,emptyDeformers,partMatrix} from '../shared/placement-deformers.js';
import {deformationRecords,deformationBake} from '../server/placement-deformers.js';
import {approveManual,placementDraft} from '../server/manual-placement.js';
const positions=[0,0,0, .1,0,0, 0,1,0, .02,0,.02,.12,0,.02,.02,1,.02];
const record=(part='body',key='0:0',extra={})=>({part,key,positions,indices:[0,1,2,3,4,5],matrix:new Matrix4().toArray(),...extra});
const pin=(patch={})=>({id:'point-1',part:'body',mesh:'0:0',vertex:0,center:[0,0,0],delta:[0,0,.1],radius:.5,connectedOnly:true,enabled:true,...patch});
const field=pins=>({version:1,pins});

test('connected influence follows surface edges and never reaches a nearby detached island or another mesh',()=>{
 const surface=createDeformationSurface([record(),record('head','1:0')]),result=surface.apply(field([pin()]));
 assert.equal(result.output[0].positions[2],Math.fround(.1));assert.equal(result.output[0].positions[11],Math.fround(.02));assert.equal(result.output[1].positions[2],0);
 // The distant end of a long triangle is outside the surface radius.
 assert.equal(result.output[0].positions[8],0);
 const all=surface.apply(field([pin({connectedOnly:false})]));assert(all.output[0].positions[11]>.02);assert.equal(all.output[1].positions[2],Math.fround(.1));
 assert.deepEqual(positions,[0,0,0,.1,0,0,0,1,0,.02,0,.02,.12,0,.02,.02,1,.02]);
});

test('deleting or disabling a pin removes exactly its contribution; empty state restores byte-identical source positions',()=>{
 const surface=createDeformationSurface([record()]),a=pin(),b=pin({id:'point-2',delta:[.05,0,0]});
 surface.apply(field([a,b]));const remaining=surface.apply(field([b]));assert.deepEqual(remaining.output[0].positions,surface.apply(field([a,b].filter(p=>p.id!==a.id))).output[0].positions);
 assert.deepEqual(surface.apply(field([a,{...b,enabled:false}])).output[0].positions,surface.apply(field([a])).output[0].positions);
 assert.deepEqual(surface.apply(emptyDeformers()).output[0].positions,new Float32Array(positions));
 for(let i=0;i<4;i++)assert.deepEqual(surface.apply(field([a])).output[0].positions,surface.apply(field([a])).output[0].positions);
});

test('connected material primitives share authorized source identities while different scene nodes stay separate',()=>{
 const a=record('body','0:0',{positions:positions.slice(0,9),indices:[0,1,2],vertexIds:[0,1,2]}),b=record('body','0:1',{positions:[0,0,0,-.1,0,0,0,-1,0],indices:[0,1,2],vertexIds:[0,3,4]}),other={...b,key:'1:0'};
 const surface=createDeformationSurface([a,b,other]),out=surface.apply(field([pin()]));assert.equal(out.output[0].positions[2],out.output[1].positions[2]);assert(out.output[1].positions[5]>0);assert.equal(out.output[2].positions[2],0);
});

test('render-only boundary splits stay closed without welding vertices or changing triangle indices',()=>{
 const r=record('body','0:0',{positions:[0,0,0,1,0,0,0,1,0, 1,0,0,0,0,0,0,-1,0],indices:[0,1,2,3,4,5]}),before=structuredClone(r);
 const out=createDeformationSurface([r]).apply(field([pin({radius:2})])).output[0].positions;
 assert.equal(out[2],out[14]);assert.equal(out[5],out[11]);assert.deepEqual(r,before);assert.equal(out.length,r.positions.length);
});

test('pins retain source node transforms and a radius relative to placed body height',()=>{
 const matrix=partMatrix({position:[3,4,5],rotation:[0,Math.PI/2,0],scale:2}),surface=createDeformationSurface([record('body','0:0',{matrix:matrix.toArray()})]);assert.equal(surface.height,2);
 const out=surface.apply(field([pin({delta:[.2,0,0]})])).output[0].positions;assert(Math.abs(out[2]-.1)<1e-6);assert.equal(out[0],0);
});

test('invalid persisted controls and stale mesh seeds are rejected rather than silently deforming another source',()=>{
 for(const patch of [{radius:Infinity},{radius:0},{delta:[0,NaN,0]},{connectedOnly:'true'},{mesh:'name'},{vertex:-1}])assert.throws(()=>validateDeformers(field([pin(patch)])),/INVALID_DEFORMERS/);
 assert.throws(()=>validateDeformers(field([pin(),pin()])),/INVALID_DEFORMERS/);assert.throws(()=>validateDeformers(field(Array.from({length:33},(_,i)=>pin({id:'p'+i})))),/INVALID_DEFORMERS/);
 assert.throws(()=>createDeformationSurface([record()]).apply(field([pin({mesh:'9:0'})])),/SOURCE_CHANGED/);assert.deepEqual(validateDeformers(),emptyDeformers());
});

function glb({vertices=positions,ids,name}={}){
 const positions=vertices;
 const bin=Buffer.alloc(positions.length*4+6*2+(ids?ids.length*4:0));positions.forEach((v,i)=>bin.writeFloatLE(v,i*4));[0,1,2,3,4,5].forEach((v,i)=>bin.writeUInt16LE(v,positions.length*4+i*2));
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,translation:[1,0,0]}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteLength:positions.length*4},{buffer:0,byteOffset:positions.length*4,byteLength:12}],accessors:[{bufferView:0,componentType:5126,count:6,type:'VEC3'},{bufferView:1,componentType:5123,count:6,type:'SCALAR'}]};
 if(ids){const offset=positions.length*4+12;ids.forEach((v,i)=>bin.writeFloatLE(v,offset+i*4));doc.nodes[0].name=name;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:ids.length*4});doc.accessors.push({bufferView:2,componentType:5126,count:ids.length,type:'SCALAR'});doc.meshes[0].primitives[0].attributes._WORKBENCH_VERTEX=2;}
 const text=JSON.stringify(doc),json=Buffer.from(text.padEnd(Math.ceil(text.length/4)*4,' ')),out=Buffer.alloc(28+json.length+bin.length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);out.writeUInt32LE(bin.length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);bin.copy(out,28+json.length);return out;
}
test('the handoff replays the same deformation in Blender source coordinates without modifying either GLB',()=>{
 const bytes=glb(),before=Buffer.from(bytes),transforms={head:{position:[0,3,0],rotation:[0,0,0],scale:.5},body:{position:[0,0,0],rotation:[0,0,0],scale:1}},manual={transforms,deformers:field([pin()])};
 const records=deformationRecords(bytes,'body',transforms.body);assert.equal(records[0].matrix[12],1);assert.equal(records[0].key,'0:0');
 const baked=deformationBake(bytes,bytes,manual);assert(Math.abs(baked.body[0].after[1]+.1)<1e-7);assert(Math.abs(baked.body[0].after[2])<1e-7);assert.deepEqual(bytes,before);
 assert.equal(deformationBake(bytes,bytes,{transforms}),null);
});

test('coincident independent vertices keep their source identity and distinct viewport deformations during save',()=>{
 const vertices=[...positions];vertices.splice(9,3,0,0,0);const bytes=glb({vertices,ids:[10,11,12,20,21,22],name:'outfit'}),transforms={head:{position:[0,3,0],rotation:[0,0,0],scale:.5},body:{position:[0,0,0],rotation:[0,0,0],scale:1}};
 const baked=deformationBake(bytes,bytes,{transforms,deformers:field([pin()])});
 const a=baked.body.find(v=>v.vertexId===10),b=baked.body.find(v=>v.vertexId===20);assert.deepEqual(a.before,b.before);assert.notDeepEqual(a.after,b.after);assert.equal(a.sourceName,'outfit');assert.equal(b.sourceName,'outfit');
});

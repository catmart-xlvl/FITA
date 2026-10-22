import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGlb} from '../scripts/texture-layout.mjs';
import {inspectRigConnectivity} from '../server/rig-connectivity.js';

function fixture({weighted=false,split=false,missing=false,leak=false,morph=false,primitiveSplit=false,idsSwap=false}={}){
  const chunks=[],bufferViews=[],accessors=[];let length=0;
  const add=(rows,type)=>{const data=Buffer.alloc(rows.flat().length*4);rows.flat().forEach((v,i)=>data.writeFloatLE(v,i*4));bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length});length+=data.length;chunks.push(data);accessors.push({bufferView:bufferViews.length-1,componentType:5126,count:rows.length,type});return accessors.length-1;};
  const positions=[[0,0,0],[1,0,0],[1,1,0],[0,0,0],[1,1,0],[0,1,0]],ids=split?[[0],[1],[2],[4],[5],[3]]:[[0],[1],[2],[0],[2],[3]],uv=[[0,0],[1,0],[1,1],[.2,0],[.8,1],[0,1]];
  if(idsSwap){ids[1]=[2];ids[2]=[1];ids[4]=[1];}
  const primitives=[];
  for(const [start,end] of primitiveSplit?[[0,3],[3,6]]:[[0,6]]){
    const attributes={POSITION:add(positions.slice(start,end),'VEC3'),TEXCOORD_0:add(uv.slice(start,end),'VEC2')};
    if(!missing)attributes._WORKBENCH_VERTEX=add(ids.slice(start,end),'SCALAR');
    if(weighted){attributes.JOINTS_0=add(positions.slice(start,end).map((_,n)=>[leak&&n+start===3?1:0,0,0,0]),'VEC4');attributes.WEIGHTS_0=add(positions.slice(start,end).map(()=>[1,0,0,0]),'VEC4');}
    const p={attributes};if(morph)p.targets=[{POSITION:add(positions.slice(start,end).map((_,n)=>n+start===3?[0,0,.1]:[0,0,0]),'VEC3')}];primitives.push(p);
  }
  return buildGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1,2]}],nodes:[{name:'Garment',mesh:0,...(weighted?{skin:0}:{})},{name:'Hips'},{name:'Arm'}],skins:[{joints:[1,2]}],meshes:[{primitives}],accessors,bufferViews,buffers:[{byteLength:length}]},Buffer.concat(chunks));
}
test('GLB UV copies preserve logical connections and identical weights across material primitives',()=>{
  const result=inspectRigConnectivity(fixture(),fixture({weighted:true,primitiveSplit:true}));assert.equal(result.logicalVertices,4);assert.equal(result.sourceConnectionsPreserved,true);assert.equal(result.seamWeightsConsistent,true);
});
test('rejects disconnected identities, lost metadata and changed corner ownership',()=>{
  for(const change of [{split:true},{missing:true},{idsSwap:true}])assert.throws(()=>inspectRigConnectivity(fixture(),fixture({weighted:true,...change})),/RIG_CONNECTIVITY/);
});
test('rejects weight and morph cracks across a UV seam including separate material primitives',()=>{
  assert.throws(()=>inspectRigConnectivity(fixture(),fixture({weighted:true,leak:true})),/different weights/);
  assert.throws(()=>inspectRigConnectivity(fixture(),fixture({weighted:true,leak:true,primitiveSplit:true})),/different weights/);
  assert.throws(()=>inspectRigConnectivity(fixture(),fixture({weighted:true,morph:true})),/different morph/);
});
test('legacy sources are explicitly reported as unchecked instead of claiming preservation',()=>{
  assert.equal(inspectRigConnectivity(fixture({missing:true}),fixture({weighted:true})).connectivityChecked,false);
  assert.throws(()=>inspectRigConnectivity(fixture({missing:true}),fixture({weighted:true}),{required:true}),/lost its vertex identities/);
});

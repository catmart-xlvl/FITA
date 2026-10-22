import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGlb,parseGlb} from '../scripts/texture-layout.mjs';
import {fieldNormals,applyHairNormalPatch,verifyHairNormalPreparation,positionDigest,validateHairNormalReview} from '../scripts/hair-normal-preparation.mjs';
import {patchHairNormals} from '../src/viewer-surface-profiles.js';
import {Texture,ShaderLib,ShaderChunk,Vector3,Matrix3,Matrix4,Mesh,BufferGeometry,Float32BufferAttribute,MeshStandardMaterial,Group} from 'three';
import {MToonMaterial} from '@pixiv/three-vrm-materials-mtoon';
import {previewMaterials} from '../src/viewer-materials.js';
const pos=[1,0,0,0,1,0,0,0,1];
const volumes=[{type:'ellipsoid',center:[0,0,0],radii:[1,1,1]}];
const patch=()=>({schema:'workbench-hair-normals/v1',targets:[{mesh:0,primitive:0,positionHash:positionDigest(pos),volumes}]});
function source({morph=false}={}){
 const bin=Buffer.alloc(36);pos.forEach((v,i)=>bin.writeFloatLE(v,i*4));
 return buildGlb({asset:{version:'2.0'},buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,type:'VEC3',componentType:5126,count:3}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:0},...(morph?{targets:[{POSITION:0,NORMAL:0}]}:{})}]}],nodes:[{mesh:0,skin:0}],skins:[{joints:[1]}],animations:[{name:'protected-clip'}],images:[]},bin);
}
test('arbitrary hair volumes blend explicit regions without assuming two tails or symmetry',()=>{
 assert.deepEqual(fieldNormals(pos,{volumes}),pos);
 const points=[-2,0,1,3,0,1,7,0,1],v=[-2,3,7].map((x,i)=>({type:'tube',points:[[x,-1,0],[x,1,0]],weights:[0,1,2].map(k=>k===i?1:0)}));
 assert.deepEqual(fieldNormals(points,{volumes:v}),[0,0,1,0,0,1,0,0,1]);
 assert.throws(()=>fieldNormals(pos,{volumes:[{...volumes[0],weights:[0,0,0]}]}),/HAIR_NORMAL/);
});
test('production normals preserve mesh, skin and animation data and reject unrelated edits',()=>{
 const original=source(),p=patch(),result=applyHairNormalPatch(original,p),a=parseGlb(original),b=parseGlb(result);
 assert(verifyHairNormalPreparation(original,result,p).normalsPrepared);
 assert.deepEqual(a.json.skins,b.json.skins);assert.deepEqual(a.json.animations,b.json.animations);assert(b.bin.subarray(0,a.bin.length).equals(a.bin));
 assert.equal(b.json.nodes[0].extras.workbenchHairNormals.version,1);
 b.json.nodes[0].skin=99;assert.throws(()=>verifyHairNormalPreparation(original,buildGlb(b.json,b.bin),p));
 assert.throws(()=>applyHairNormalPatch(original,{...p,targets:[{...p.targets[0],positionHash:'wrong'}]}));
});
test('morph normals require a shaped profile and replace stale normal deltas',()=>{
 const original=source({morph:true}),p=patch();assert.throws(()=>applyHairNormalPatch(original,p));
 p.targets[0].morphProfiles=[{volumes}];const b=parseGlb(applyHairNormalPatch(original,p));
 const target=b.json.meshes[0].primitives[0].targets[0],a=b.json.accessors[target.NORMAL],v=b.json.bufferViews[a.bufferView];
 for(let k=0;k<9;k++)assert.equal(b.bin.readFloatLE(v.byteOffset+k*4),0);
 assert.equal(target.POSITION,0);
});
test('hair review cannot complete without lighting and deformation evidence',()=>{
 assert.throws(()=>validateHairNormalReview({status:'prepared',reason:'done',patch:patch()}));
 assert.doesNotThrow(()=>validateHairNormalReview({status:'no-hair',reason:'Bald head inspected'}));
});
test('Standard and MToon hair fields use the morphed and skinned normal, never a fixed attribute',()=>{
 const toon=new MToonMaterial();
 for(const s of [ShaderLib.standard,toon]){
  const shader={vertexShader:s.vertexShader,fragmentShader:s.fragmentShader,uniforms:{}};patchHairNormals(shader,{value:1});
  assert.equal(shader.vertexShader,s.vertexShader);
  assert(shader.fragmentShader.includes('fieldNormal=normalize(vNormal)'));
  assert(!shader.fragmentShader.includes('wbHairNormal'));
  assert(shader.vertexShader.indexOf('skinnormal_vertex')<shader.vertexShader.indexOf('defaultnormal_vertex'));
 }
 assert(ShaderChunk.skinnormal_vertex.includes('skinMatrix * vec4( objectNormal, 0.0 )'));
 // A quarter-turn bone and a nonuniform object transform rotate the authored
 // field along with the strand. An unskinned attribute would remain +Z.
 const bone=new Matrix4().makeRotationY(Math.PI/2),object=new Matrix4().makeScale(2,1,.5);
 const n=new Vector3(0,0,1).transformDirection(bone).applyMatrix3(new Matrix3().getNormalMatrix(object)).normalize();
 assert(n.x>.999);assert(Math.abs(n.z)<1e-6);toon.dispose();
});
test('prepared GLB node marker enables hair shading automatically without comparison controls',()=>{
 const root=new Group(),g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(pos,3));g.setAttribute('normal',new Float32BufferAttribute(pos,3));
 const mesh=new Mesh(g,new MeshStandardMaterial({map:new Texture()}));mesh.userData.workbenchHairNormals={version:1};root.add(mesh);
 const material=mesh.material,api=previewMaterials(root);api.set('mtoon');assert(api.hasHair);
 assert.equal(mesh.material.uniforms.workbenchHairStrength.value,1);api.dispose();assert.equal(mesh.material,material);
});

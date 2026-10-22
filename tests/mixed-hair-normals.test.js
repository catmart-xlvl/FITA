import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGlb,parseGlb} from '../scripts/texture-layout.mjs';
import {applyHairNormalPatch,verifyHairNormalPreparation,positionDigest,fieldNormals} from '../scripts/hair-normal-preparation.mjs';
import {Group,Mesh,BufferGeometry,Float32BufferAttribute,MeshStandardMaterial,Texture} from 'three';
import {previewMaterials} from '../src/viewer-materials.js';
const positions=[1,0,0,0,1,0,0,0,1,2,0,0,2,1,0,2,0,1];
const originalNormals=Array.from({length:6},()=>[0,0,-1]).flat();
const volumes=[{type:'ellipsoid',center:[0,0,0],radii:[1,1,1],weights:[1,1,1,0,0,0]}];
function fixture(ids=[0,1,2,3,4,5]){
 const bin=Buffer.alloc(positions.length*8+ids.length*4);positions.forEach((v,i)=>bin.writeFloatLE(v,i*4));originalNormals.forEach((v,i)=>bin.writeFloatLE(v,positions.length*4+i*4));ids.forEach((v,i)=>bin.writeUInt32LE(v,positions.length*8+i*4));
 return buildGlb({asset:{version:'2.0'},buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:72},{buffer:0,byteOffset:72,byteLength:72},{buffer:0,byteOffset:144,byteLength:24}],accessors:[{bufferView:0,type:'VEC3',componentType:5126,count:6},{bufferView:1,type:'VEC3',componentType:5126,count:6},{bufferView:2,type:'SCALAR',componentType:5125,count:6}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2}]}],nodes:[{name:'hair',mesh:0}],images:[]},bin);
}
const patch=()=>({schema:'workbench-hair-normals/v1',targets:[{mesh:0,primitive:0,positionHash:positionDigest(positions),volumes,protectedVertices:[3,4,5]}]});
test('mixed hair keeps accessory normals byte exact and records a reproducible geometric classification',()=>{
 const source=fixture(),p=patch(),result=applyHairNormalPatch(source,p),before=parseGlb(source),after=parseGlb(result);assert(verifyHairNormalPreparation(source,result,p).normalsPrepared);assert(after.bin.subarray(0,before.bin.length).equals(before.bin));
 const primitive=after.json.meshes[0].primitives[0],accessor=after.json.accessors[primitive.attributes.NORMAL],view=after.json.bufferViews[accessor.bufferView];
 for(let i=9;i<18;i++)assert.equal(after.bin.readFloatLE(view.byteOffset+i*4),originalNormals[i]);
 assert.notEqual(after.bin.readFloatLE(view.byteOffset),originalNormals[0]);assert.equal(after.json.nodes[0].extras.workbenchHairNormals.mixed,true);
 const mask=after.json.accessors[primitive.attributes._WORKBENCH_HAIR_MASK];assert.equal(mask.type,'SCALAR');assert.equal(mask.count,6);
 assert.throws(()=>applyHairNormalPatch(fixture([0,1,3,3,4,5]),p),/HAIR_NORMAL/);
 for(const protectedVertices of [[3,3],[0,1,2,3,4,5],[-1],[6]])assert.throws(()=>applyHairNormalPatch(source,{...p,targets:[{...p.targets[0],protectedVertices}]}),/HAIR_NORMAL/);
 assert.throws(()=>fieldNormals(positions,{volumes,protectedVertices:[3,4,5]}),/HAIR_NORMAL/);
});
test('mixed hair preview separates accessory shading and restores geometry/materials on dispose',()=>{
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new Float32BufferAttribute(originalNormals,3));geometry.setAttribute('_workbench_hair_mask',new Float32BufferAttribute([1,1,1,0,0,0],1));geometry.setIndex([0,1,2,3,4,5]);
 const sourceIndex=Array.from(geometry.index.array),material=new MeshStandardMaterial({map:new Texture()}),mesh=new Mesh(geometry,material),root=new Group();mesh.userData.workbenchHairNormals={version:1,mixed:true};root.add(mesh);
 const api=previewMaterials(root);api.set('mtoon');assert.deepEqual(Array.from(mesh.geometry.index.array),[0,1,2]);assert.equal(mesh.children.length,1);
 const accessory=mesh.children[0];assert.deepEqual(Array.from(accessory.geometry.index.array),[3,4,5]);assert.equal(accessory.material.matcapTexture,null);assert.notEqual(mesh.material.matcapTexture,null);assert.equal(accessory.material.uniforms.workbenchHairStrength,undefined);
 api.dispose();assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);assert.deepEqual(Array.from(geometry.index.array),sourceIndex);assert.equal(mesh.children.length,0);
});

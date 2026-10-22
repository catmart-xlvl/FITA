import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh,BoxGeometry,MeshStandardMaterial,MeshBasicMaterial,Texture,LinearFilter,LinearMipmapLinearFilter,DoubleSide,Group} from 'three';
import {previewMaterials} from '../src/viewer-materials.js';
import {normalizeLighting,studioLighting,readLighting,applyLighting} from '../src/viewer-lighting.js';
import {DirectionalLight,HemisphereLight} from 'three';
import {captureBatch,textureTiming} from '../extension-tripo-studio/batch-capture.js';

test('MToon preview shares albedo and alpha without mutating original GLB materials, restores and disposes cleanly',()=>{
  const map=new Texture(),original=new MeshStandardMaterial({map,transparent:true,alphaTest:.3,opacity:.8,side:DoubleSide,color:0xe3aacb});
  const root=new Group(),a=new Mesh(new BoxGeometry(),original),b=new Mesh(new BoxGeometry(),[original]);root.add(a,b);
  const before=original.toJSON(),preview=previewMaterials(root);let disposed=0,textureDisposed=0;map.addEventListener('dispose',()=>textureDisposed++);
  preview.set('mtoon');assert(a.material.isMToonMaterial);assert.equal(a.material,b.material[0]);assert.notEqual(a.material.map,map);assert.equal(a.material.map.image,map.image);assert.equal(a.material.shadeMultiplyTexture,a.material.map);assert.equal(a.material.map.generateMipmaps,true);assert.equal(a.material.map.minFilter,LinearMipmapLinearFilter);
  for(const key of ['transparent','opacity','alphaTest','side'])assert.equal(a.material[key],original[key]);
  assert.deepEqual(original.toJSON(),before);a.material.addEventListener('dispose',()=>disposed++);preview.update(.016);
  preview.set('original');assert.notEqual(a.material,original);assert.equal(a.material.map.generateMipmaps,true);preview.set('mtoon');preview.dispose();assert.equal(a.material,original);assert.equal(disposed,1);assert.equal(textureDisposed,0);
});

test('authored white eye glints stay unlit with original, base color and MToon at low exposure',()=>{
 for(const role of ['glint','sclera']){
 const source=new MeshBasicMaterial({map:new Texture(),color:0xffffff});source.userData.workbenchFacialRole=role;
 const mesh=new Mesh(new BoxGeometry(),source),p=previewMaterials(mesh);p.exposure(.2);p.intensity(5);
 for(const mode of ['original','basecolor','mtoon']){p.set(mode);assert(mesh.material.isMeshBasicMaterial);assert.equal(mesh.material.toneMapped,false);assert.equal(mesh.material.color.getHex(),0xffffff);assert.equal(mesh.material.map.image,source.map.image);assert.equal(mesh.material.map.generateMipmaps,true);}
 p.wire(true);assert.equal(mesh.material.color.getHex(),0xffffff);p.dispose();assert.equal(mesh.material,source);
 }
});
test('clay preview is neutral and restores source material without changing it',()=>{
 const source=new MeshStandardMaterial({color:0xffffff}),mesh=new Mesh(new BoxGeometry(),source),p=previewMaterials(mesh),before=source.toJSON();
 p.set('original');assert(p.isGeometry);assert.equal(mesh.material.metalness,0);assert(mesh.material.roughness>0&&mesh.material.roughness<.5,'soft satin reflections');assert(mesh.material.color.r>.35&&mesh.material.color.r<.6,'neutral mid-gray albedo');
 const clay=mesh.material;p.set('mtoon');assert.equal(mesh.material,clay);assert.deepEqual(source.toJSON(),before);p.dispose();assert.equal(mesh.material,source);
});

test('segmentation ID colors remain unlit and distinct instead of being replaced with gray clay',()=>{
 const source=new MeshStandardMaterial({color:0xaa2244}),mesh=new Mesh(new BoxGeometry(),source),before=source.toJSON(),p=previewMaterials(mesh,{colorLabels:true});
 for(const mode of ['original','mtoon','basecolor']){p.set(mode);assert(mesh.material.isMeshBasicMaterial);assert(mesh.material.color.equals(source.color));assert.equal(p.isGeometry,false);}
 assert.deepEqual(source.toJSON(),before);p.dispose();assert.equal(mesh.material,source);
});

test('head and body candidates use face normals without rewriting geometry, textures or later preview materials',()=>{
 for(const group of ['head','body'])for(let index=0;index<4;index++){
  const geometry=new BoxGeometry(),map=new Texture(),normalMap=new Texture(),source=new MeshStandardMaterial({map,normalMap,flatShading:false});
  const mesh=new Mesh(geometry,source),positions=geometry.attributes.position.array.slice(),normals=geometry.attributes.normal.array.slice(),indices=geometry.index.array.slice(),before=source.toJSON();
  mesh.name=group+' candidate '+index;
  const preview=previewMaterials(mesh,{facetedGeometry:true});
  for(const mode of ['original','mtoon','basecolor']){
   preview.set(mode);assert.equal(preview.isGeometry,true);assert.equal(mesh.material.flatShading,true);assert.equal(mesh.material.normalMap,null);assert.equal(mesh.material.map,null);
  }
  preview.wire(true);assert.equal(mesh.material.flatShading,true);assert.equal(mesh.children[0].geometry,geometry);
  assert.equal(mesh.geometry,geometry);assert.deepEqual(geometry.attributes.position.array,positions);assert.deepEqual(geometry.attributes.normal.array,normals);assert.deepEqual(geometry.index.array,indices);assert.deepEqual(source.toJSON(),before);
  preview.dispose();assert.equal(mesh.material,source);
  const later=previewMaterials(mesh);later.set('original');assert.equal(mesh.material.flatShading,false);assert(mesh.material.map);assert(mesh.material.normalMap);later.dispose();
 }
});

test('base color is unlit and source-safe; anime exposure survives wireframe clones and mode changes',()=>{
 const map=new Texture(),source=new MeshStandardMaterial({map,color:0xd4a149,transparent:true,opacity:.8,alphaTest:.2}),mesh=new Mesh(new BoxGeometry(),source),p=previewMaterials(mesh),before=source.toJSON();
 p.set('basecolor');assert(mesh.material.isMeshBasicMaterial);assert.equal(mesh.material.toneMapped,false);assert.equal(mesh.material.map.image,map.image);assert.equal(mesh.material.map.generateMipmaps,true);assert(mesh.material.color.equals(source.color));
 p.set('mtoon');p.exposure(1.8);assert.equal(mesh.material.toneMapped,false);assert.equal(mesh.material.uniforms.workbenchExposure.value,1.8);assert.match(mesh.material.fragmentShader,/albedoPeak/);
 p.wire(true);assert.equal(mesh.material.uniforms.workbenchExposure.value,1.8);assert.match(mesh.material.fragmentShader,/albedoPeak/);p.exposure(.4);assert.equal(mesh.material.uniforms.workbenchExposure.value,.4);
 p.wire(false);assert.equal(mesh.material.uniforms.workbenchExposure.value,.4);p.set('basecolor');assert.equal(mesh.material.toneMapped,false);p.set('mtoon');assert.equal(mesh.material.uniforms.workbenchExposure.value,.4);
 assert.deepEqual(source.toJSON(),before);p.dispose();assert.equal(mesh.material,source);
});
test('wireframe overlays a solid textured or clay surface, survives shading switches, and never disposes shared geometry',()=>{
 for(const textured of [false,true]){
  const geometry=new BoxGeometry(),map=textured?new Texture():null,source=new MeshStandardMaterial({map}),root=new Group(),mesh=new Mesh(geometry,source);root.add(mesh);mesh.position.set(2,3,4);mesh.scale.setScalar(2);
  let disposedGeometry=0,disposedMap=0;geometry.addEventListener('dispose',()=>disposedGeometry++);map?.addEventListener('dispose',()=>disposedMap++);
  const p=previewMaterials(root),before=source.toJSON();p.set('original');p.wire(true);
  const overlay=mesh.children[0];assert.equal(mesh.material.wireframe,false);assert.equal(mesh.material.polygonOffset,true);assert.equal(overlay.material.wireframe,true);assert.equal(overlay.material.depthTest,true);assert.equal(overlay.material.depthWrite,false);assert.equal(overlay.material.forceSinglePass,true);assert.equal(overlay.geometry,geometry);assert.deepEqual(overlay.position.toArray(),[0,0,0]);assert.deepEqual(overlay.scale.toArray(),[1,1,1]);
  p.set('mtoon');assert.equal(mesh.material.wireframe,false);assert(overlay.visible);p.update(.016);p.wire(false);assert.equal(overlay.visible,false);p.wire(true);assert.equal(mesh.children.length,1);assert.deepEqual(source.toJSON(),before);
  p.dispose();assert.equal(mesh.material,source);assert.equal(mesh.children.length,0);assert.equal(disposedGeometry,0);assert.equal(disposedMap,0);
 }
});
test('lighting settings reject corrupt values, clamp ranges and update lights without moving geometry',()=>{
 assert.deepEqual(readLighting({getItem:()=>'{broken'}),studioLighting);
 assert.deepEqual(normalizeLighting({intensity:Infinity,fill:-1,rotation:999,exposure:'2'}),{intensity:1,fill:0,rotation:180,exposure:1});
 const lights={ambient:new HemisphereLight(),key:new DirectionalLight(),fill:new DirectionalLight(),rim:new DirectionalLight(),renderer:{}};
 applyLighting(lights,studioLighting);const before=lights.key.position.clone();applyLighting(lights,{...studioLighting,rotation:90,intensity:0,exposure:.6},true);
 assert.equal(lights.key.intensity,0);assert.equal(lights.fill.intensity,0);assert.equal(lights.renderer.toneMappingExposure,.6);assert(Math.abs(lights.key.position.x-before.z)<.0001);assert.equal(lights.key.position.y,before.y);
});
const ids=Array.from({length:6},(_,i)=>`10000000-0000-4000-8000-00000000000${i}`);
test('batch association requires four stable new distinct links including the selected task, never old or ambiguous tasks',()=>{
 const before={existingTaskIds:[ids[0]],currentTaskId:ids[0]},after={existingTaskIds:ids.slice(0,5),currentTaskId:ids[1]};
 assert.equal(captureBatch(before,after).verified,false);assert.equal(captureBatch(before,after,ids.slice(1,5)).verified,true);
 for(const changed of [{...after,existingTaskIds:ids},{...after,currentTaskId:ids[0]},{...after,existingTaskIds:ids.slice(0,3)}])assert.equal(captureBatch(before,changed,ids.slice(1,5)).verified,false);
});
test('texture estimates belong only to the selected processing card and have bounded seconds',()=>{
 const read=text=>textureTiming({taskCards:[{taskId:ids[0],text:'Generando textura 999s'},{taskId:ids[1],text:'Modelo'},{taskId:ids[1],text:'Textura'},{taskId:ids[1],text}]},ids[1]);
 assert.deepEqual(read('Generando textura… 60s'),{processing:true,estimatedSeconds:60});assert.equal(read('Texturing about 2 minutes').estimatedSeconds,120);
 assert.equal(read('Texture 4K 60s').estimatedSeconds,null);assert.equal(read('Generando textura').estimatedSeconds,null);assert.equal(read('Generando textura 9000s').estimatedSeconds,null);
});

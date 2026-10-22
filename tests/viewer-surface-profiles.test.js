import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh,Group,BoxGeometry,MeshStandardMaterial,Texture,ShaderLib,Vector3,Color} from 'three';
import {MToonMaterial} from '@pixiv/three-vrm-materials-mtoon';
import {surfaceProfile,mixedSkinMask,patchHairNormals,patchFaceNormals,skinShading} from '../src/viewer-surface-profiles.js';
import {previewMaterials,hairHighlightDefault} from '../src/viewer-materials.js';

test('upper eye shadows retain black alpha in all modes and wireframe without double blending or changing source',()=>{
 const source=new MeshStandardMaterial({color:0x000000,map:new Texture(),opacity:.25,transparent:true,depthWrite:true});source.userData.workbenchFacialRole='eyeshadow';
 const mesh=new Mesh(new BoxGeometry(),source),before=source.toJSON(),p=previewMaterials(mesh);
 for(const mode of ['original','basecolor','mtoon'])for(const wire of [false,true]){p.set(mode);p.wire(wire);assert(mesh.material.isMeshBasicMaterial);assert.equal(mesh.material.opacity,.25);assert.equal(mesh.material.color.getHex(),0);assert.equal(mesh.material.transparent,true);assert.equal(mesh.material.depthWrite,false);assert.equal(mesh.material.forceSinglePass,true);}
 p.dispose();assert.deepEqual(source.toJSON(),before);
});

test('skin domains share shadow settings while preserving independent maps and factors; dark cloth is excluded by mixed mask',()=>{
 const root=new Group(),meshes=[];
 for(const color of [0xffe5df,0xdab8aa]){const m=new MeshStandardMaterial({color,map:new Texture()});m.userData.workbenchSurfaceRole='skin';const mesh=new Mesh(new BoxGeometry(),m);meshes.push(mesh);root.add(mesh);}
 const before=meshes.map(m=>m.material.toJSON()),sources=meshes.map(m=>m.material),p=previewMaterials(root);p.set('mtoon');
 assert.notEqual(meshes[0].material.map,meshes[1].material.map);
 for(const [i,m] of meshes.entries()){assert(m.material.shadeColorFactor.equals(sources[i].color.clone().multiply(new Color(...skinShading.shade))));assert.equal(m.material.map.image,sources[i].map.image);}
 assert(mixedSkinMask([.7,.45,.43])>.99);assert.equal(mixedSkinMask([.02,.01,.03]),0);assert.equal(mixedSkinMask([.04,.12,.4]),0);
 p.dispose();for(let i=0;i<2;i++)assert.deepEqual(sources[i].toJSON(),before[i]);
});
test('semantic surface lookup protects facial pieces and never guesses skin from an arbitrary body or texture name',()=>{
 const parent=new Group(),m=new Mesh(new BoxGeometry(),new MeshStandardMaterial());parent.userData.workbenchSourceName='reviewed';parent.add(m);
 assert.equal(surfaceProfile(m,m.material,{reviewed:{role:'skin-mixed'}}).role,'skin-mixed');
 m.material.name='WB_Glint_L_1';assert.equal(surfaceProfile(m,m.material,{reviewed:{role:'skin'}}).role,'glint');
 m.material.name='body';assert.equal(surfaceProfile(m,m.material).role,'other');
});
test('normal field patch bypasses face flipping only in the proxy field and supports both original and MToon shaders',()=>{
 for(const shader of [new MToonMaterial(),{...ShaderLib.standard,uniforms:{}}]){
  patchHairNormals(shader,{value:1});
  assert.match(shader.vertexShader,/#include <skinnormal_vertex>/);
  assert.match(shader.fragmentShader,/fieldNormal=normalize\(vNormal\)/);
  assert.doesNotMatch(shader.fragmentShader,/fieldNormal\s*\*=\s*faceDirection/);
  assert.match(shader.fragmentShader,/workbenchHairStrength>0.0/);
 }
 // A mirrored pair under mirrored lights must agree; opposite winding must
 // not reverse the proxy at full influence (regression for double-sided cards).
 const left=new Vector3(-.6,.2,.77).normalize(),right=new Vector3(.6,.2,.77).normalize();
 const light=new Vector3(-1,.5,1).normalize(),mirror=new Vector3(1,.5,1).normalize();
 assert(Math.abs(left.dot(light)-right.dot(mirror))<1e-10);
});
test('hair controls remain independent, survive wireframe and mode switches and leave source assets unchanged',()=>{
 const source=new MeshStandardMaterial({map:new Texture()}),mesh=new Mesh(new BoxGeometry(),source);mesh.userData.workbenchSourceName='hair';
 const before=source.toJSON(),p=previewMaterials(mesh,{surfaces:{hair:{role:'hair'}},hairNormalNode:'hair'});
 p.set('mtoon');assert.equal(mesh.material.matcapFactor.r,hairHighlightDefault);assert(hairHighlightDefault>0&&hairHighlightDefault<.3);
 p.set('basecolor');assert(mesh.material.isMeshBasicMaterial);assert.equal(mesh.material.map.image,source.map.image);
 p.hairHighlight(.3);p.hairNormals(1);p.set('mtoon');assert.equal(mesh.material.matcapFactor.r,.3);assert.equal(mesh.material.uniforms.workbenchHairStrength.value,1);
 p.wire(true);p.hairHighlight(.1);p.hairNormals(.5);assert.equal(mesh.material.matcapFactor.r,.1);assert.equal(mesh.material.uniforms.workbenchHairStrength.value,.5);
 p.set('original');assert.match(mesh.material.customProgramCacheKey(),/workbench-hair-deformed/);p.set('basecolor');assert(mesh.material.isMeshBasicMaterial);
 p.dispose();assert.deepEqual(source.toJSON(),before);
});

test('prepared facial fields survive double-sided shading, wireframe and hair controls without affecting unprepared meshes',()=>{
 for(const shader of [new MToonMaterial(),{...ShaderLib.standard,uniforms:{}}]){
  patchFaceNormals(shader);assert.equal(shader.uniforms.workbenchFaceStrength.value,1);
  assert.match(shader.fragmentShader,/fieldNormal=normalize\(vNormal\)/);
  assert.doesNotMatch(shader.fragmentShader,/fieldNormal\s*\*=\s*faceDirection/);
 }
 const root=new Group(),source=new MeshStandardMaterial({map:new Texture()}),face=new Mesh(new BoxGeometry(),source),other=new Mesh(new BoxGeometry(),new MeshStandardMaterial({map:new Texture()}));
 face.userData.workbenchFaceNormals={version:1};root.add(face,other);const before=source.toJSON(),p=previewMaterials(root);
 p.set('original');assert.match(face.material.customProgramCacheKey(),/workbench-face-deformed/);assert.doesNotMatch(other.material.customProgramCacheKey(),/workbench-face-deformed/);
 p.set('mtoon');assert.equal(face.material.uniforms.workbenchFaceStrength.value,1);p.hairNormals(0);p.wire(true);assert.equal(face.material.uniforms.workbenchFaceStrength.value,1);
 p.set('original');assert.match(face.material.customProgramCacheKey(),/workbench-face-deformed/);p.dispose();assert.deepEqual(source.toJSON(),before);
});

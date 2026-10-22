import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh,BoxGeometry,MeshStandardMaterial,Texture,Group} from 'three';
import {previewMaterials} from '../src/viewer-materials.js';
test('texture comparison preserves source, UV transforms and geometry through all shading modes',()=>{
 const originalMap=new Texture({width:4,height:4}),painted=new Texture({width:4,height:4});originalMap.flipY=false;originalMap.offset.set(.1,.2);originalMap.repeat.set(.5,.7);originalMap.channel=1;
 const original=new MeshStandardMaterial({name:'cloth',map:originalMap}),other=new MeshStandardMaterial({name:'skin',map:new Texture()});
 const root=new Group(),cloth=new Mesh(new BoxGeometry(),original),skin=new Mesh(new BoxGeometry(),other);root.add(cloth,skin);
 const before=original.toJSON(),geometry=cloth.geometry,matrix=cloth.matrix.clone(),p=previewMaterials(root);let sourceDisposed=0,trialDisposed=0;
 originalMap.addEventListener('dispose',()=>sourceDisposed++);painted.addEventListener('dispose',()=>trialDisposed++);
 assert(p.textureTrial(new Map([['cloth',painted]])));
 for(const mode of ['original','basecolor','mtoon'])for(const wire of [false,true])for(const after of [true,false,true]){
   p.set(mode);p.wire(wire);p.compareTextures(after);
   assert.equal(cloth.material.map.image,after?painted.image:originalMap.image);
   assert.equal(cloth.material.map.flipY,false);assert.equal(cloth.material.map.channel,1);assert(cloth.material.map.offset.equals(originalMap.offset));assert(cloth.material.map.repeat.equals(originalMap.repeat));
   if(cloth.material.isMToonMaterial){assert.equal(cloth.material.shadeMultiplyTexture,cloth.material.map);assert.equal(cloth.material.rimMultiplyTexture,cloth.material.map);}
   assert.equal(skin.material.map.image,other.map.image);assert.equal(cloth.geometry,geometry);assert(cloth.matrix.equals(matrix));
 }
 assert.deepEqual(original.toJSON(),before);p.dispose();assert.equal(cloth.material,original);assert.equal(sourceDisposed,0);assert.equal(trialDisposed,0);
});

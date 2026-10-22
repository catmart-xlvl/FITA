import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh,SphereGeometry,MeshStandardMaterial,Group,Vector3,BufferGeometry,Float32BufferAttribute} from 'three';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hairNormalPreview,attachHairNormalStudy} from '../src/viewer-hair-normals.js';
const profile={cap:{center:[0,.5,0],radii:[1,1,1],blendX:[.8,1],blendY:[-.5,0]},tails:[[[-1,1,0],[-1,-1,0]],[[1,1,0],[1,-1,0]]]};
test('procedural frontal surface samples retain forward normals on both sides',()=>{
 const study={cap:{center:[0,.5,-1],radii:[1,1,1],blendX:[.8,1],blendY:[-.5,0]},tails:[[[-1,1,-1],[-1,-1,-1]],[[1,1,-1],[1,-1,-1]]]};
 // Surface samples from the reviewed mesh; the previous tube centers sat in
 // front of these samples, yielding reversed or almost sideways lighting.
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([-.32,.7,-.09,.32,.7,-.10],3));g.setAttribute('normal',new Float32BufferAttribute([0,0,1,0,0,1],3));
 const mesh=new Mesh(g,new MeshStandardMaterial()),p=hairNormalPreview(mesh,study);p.set(1);
 for(let i=0;i<2;i++)assert(mesh.geometry.attributes.normal.getZ(i)>.6);
 p.dispose();
});
test('normal trial preserves positions, indices, UVs, materials and source normals and restores exactly',()=>{
 const g=new SphereGeometry(1,16,12);g.computeTangents();const m=new Mesh(g,new MeshStandardMaterial()),before=g.toJSON(),material=m.material,p=hairNormalPreview(m,profile);
 p.set(.65);assert.notEqual(m.geometry,g);assert.deepEqual(g.toJSON(),before);assert.equal(m.material,material);
 for(const key of ['position','uv'])assert.deepEqual(m.geometry.attributes[key].array,g.attributes[key].array);
 assert.deepEqual(m.geometry.index.array,g.index.array);assert.notDeepEqual(m.geometry.attributes.normal.array,g.attributes.normal.array);
 for(let i=0;i<g.attributes.position.count;i++){
  const n=new Vector3().fromBufferAttribute(m.geometry.attributes.normal,i),t=new Vector3().fromBufferAttribute(m.geometry.attributes.tangent,i);
  assert(Math.abs(n.length()-1)<1e-5);assert(Math.abs(t.dot(n))<1e-5);
 }
 p.set(0);assert.equal(m.geometry,g);p.set(1);p.dispose();assert.equal(m.geometry,g);assert.deepEqual(g.toJSON(),before);
});
test('a normal study only attaches to the exact declared source geometry',async()=>{
 const root=new Group(),m=new Mesh(new SphereGeometry(),new MeshStandardMaterial());m.userData.workbenchSourceName='hair';root.add(m);
 const a=m.geometry.attributes.position.array,study={...profile,node:'hair',positionHash:createHash('sha256').update(Buffer.from(a.buffer)).digest('hex')};
 assert.equal(await attachHairNormalStudy(root,{...study,node:'body'}),null);assert.equal(await attachHairNormalStudy(root,{...study,positionHash:'wrong'}),null);
 const p=await attachHairNormalStudy(root,study);assert(p);p.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,Float32BufferAttribute,Mesh,MeshStandardMaterial} from 'three';
import {nativeTopology} from '../src/native-topology.js';
import {previewMaterials} from '../src/viewer-materials.js';
function quad(){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,1,1,.2,0,1,0],3));g.setIndex([0,1,2,0,2,3]);g.setAttribute('_wb_face',new Float32BufferAttribute([0,0,0,0],1));g.computeVertexNormals();return g;}
test('native polygon IDs remove only the rendering diagonal, preserve four boundary edges and source geometry',()=>{
 const g=quad(),indices=g.index.array.slice(),n=nativeTopology(g);assert.equal(n.quads,1);assert.equal(n.polygons,1);assert.equal(n.geometry.getAttribute('position').count,8);assert.deepEqual(g.index.array,indices);n.geometry.dispose();
 const material=new MeshStandardMaterial(),mesh=new Mesh(g,material),preview=previewMaterials(mesh,{facetedGeometry:true});preview.set('original');assert.equal(mesh.material.flatShading,false);preview.wire(true);assert(mesh.children[0].isLineSegments);assert.equal(mesh.children[0].geometry.getAttribute('position').count,8);preview.dispose();assert.equal(mesh.material,material);assert.equal(mesh.children.length,0);
});
test('triangulated legacy files are never relabeled as quads; corrupt face IDs fail closed',()=>{
 const g=quad();g.deleteAttribute('_wb_face');assert.equal(nativeTopology(g),null);g.setAttribute('_wb_face',new Float32BufferAttribute([0,1,0,0],1));assert.equal(nativeTopology(g),null);
});

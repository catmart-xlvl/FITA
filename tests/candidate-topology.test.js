import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {findBlender} from '../server/placement.js';import {fbxBuffer,candidatePreview} from '../server/candidate-topology.js';
import {nativeTopology} from '../src/native-topology.js';import {zipBuffers} from '../server/codex-handoff.js';
test('FBX export validation accepts a single native file and refuses ambiguous or invalid archives',async()=>{
 const native=Buffer.from('; FBX 7.4.0 project file\nObjects: {}\n');assert.deepEqual(await fbxBuffer(native),native);
 assert.deepEqual(await fbxBuffer(await zipBuffers({'model.fbx':native})),native);
 await assert.rejects(fbxBuffer(await zipBuffers({'a.fbx':native,'b.fbx':native})),/AMBIGUOUS/);
 await assert.rejects(fbxBuffer(Buffer.from('This is not an FBX model.')),/INVALID_FBX/);
});
test('real native FBX conversion preserves quad counts, exact source bytes and face IDs across GPU triangulation',async t=>{
 const executable=await findBlender();if(!executable){t.skip('Blender is not installed');return;}
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fita-native-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const script=path.join(dir,'fixture.py'),file=path.join(dir,'source.fbx');
 await fs.writeFile(script,`import bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\nm=bpy.data.meshes.new('NativeQuads')\nm.from_pydata([(0,0,0),(1,0,0),(1,1,.2),(0,1,0),(2,0,0),(2,1,0),(3,0,0)],[],[(0,1,2,3),(1,4,5,2),(4,6,5)])\no=bpy.data.objects.new('NativeQuads',m);bpy.context.collection.objects.link(o);o.select_set(True)\nbpy.ops.export_scene.fbx(filepath=${JSON.stringify(file)},use_selection=True,add_leaf_bones=False)\n`);
 const made=spawnSync(executable,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',script],{encoding:'utf8',windowsHide:true});assert.equal(made.status,0,made.stdout+made.stderr);
 const source=await fs.readFile(file),hash=createHash('sha256').update(source).digest('hex');
 const converted=await candidatePreview(source,{executable});assert.equal(converted.report.quads,2);assert.equal(converted.report.triangles,1);
 const gltf=await new GLTFLoader().parseAsync(converted.bytes.buffer.slice(converted.bytes.byteOffset,converted.bytes.byteOffset+converted.bytes.length),'');let quads=0,triangles=0;
 gltf.scene.traverse(o=>{if(o.isMesh){const topology=nativeTopology(o.geometry);assert(topology);quads+=topology.quads;triangles+=topology.triangles;topology.geometry.dispose();}});
 assert.equal(quads,2);assert.equal(triangles,1);assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'),hash);
 const glb=path.join(dir,'preview.glb');await fs.writeFile(glb,converted.bytes);
 const check=path.join(dir,'check.py');await fs.writeFile(check,`import sys,bpy\nsys.path.insert(0,${JSON.stringify(path.resolve('server/blender'))})\nfrom segment_mesh import import_glb\nbpy.ops.wm.read_factory_settings(use_empty=True)\nobjects,meshes=import_glb(${JSON.stringify(glb)})\nassert len(meshes)==1\nassert len(meshes[0].data.vertices)==7, len(meshes[0].data.vertices)\nassert len(meshes[0].data.polygons)==5\nassert meshes[0].data.attributes.get('_wb_face') is None\n`);
 const verified=spawnSync(executable,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',check],{encoding:'utf8',windowsHide:true});assert.equal(verified.status,0,verified.stdout+verified.stderr);
});

import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import express from 'express';
import {buildGlb,parseGlb} from '../scripts/texture-layout.mjs';
import {validateAssemblyRest,mountRigAssembly,assemblySource} from '../server/rig-assembly.js';
function fixture(add=false){
 const b=Buffer.alloc(66);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>b.writeFloatLE(v,i*4));[0,0,1,0,0,1].forEach((v,i)=>b.writeFloatLE(v,36+i*4));[0,1,2].forEach((v,i)=>b.writeUInt16LE(v,60+i*2));
 const j={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'head-face',mesh:0}],buffers:[{byteLength:b.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:6}],accessors:[{bufferView:0,type:'VEC3',componentType:5126,count:3},{bufferView:1,type:'VEC2',componentType:5126,count:3},{bufferView:2,type:'SCALAR',componentType:5123,count:3}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{uri:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}]};
 if(add){j.nodes.push({name:'head-hair',mesh:0,translation:[0,0,1]});j.scenes[0].nodes.push(1);}
 return buildGlb(j,b);
}
const additions=[{name:'head-hair',kind:'hair',reason:'User-approved reserved original hair'}];
test('registered additions preserve every original rest triangle, UV and material; undeclared or changed meshes fail',()=>{
 assert.equal(validateAssemblyRest(fixture(),fixture(true),additions).originalRestPreserved,true);
 for(const change of [({bin})=>bin.writeFloatLE(.5,0),({json})=>json.nodes[0].translation=[1,0,0],({json})=>json.materials[0].alphaMode='BLEND',({json})=>json.nodes[0].name='replaced']){const value=parseGlb(fixture(true));change(value);assert.throws(()=>validateAssemblyRest(fixture(),buildGlb(value.json,value.bin),additions));}
 assert.throws(()=>validateAssemblyRest(fixture(),fixture(true),[]));assert.throws(()=>validateAssemblyRest(fixture(),fixture(true),[{...additions[0],name:'other'}]));assert.throws(()=>validateAssemblyRest(fixture(),fixture(true),[{...additions[0],reason:''}]));
});
async function harness(t,{failSave=false,changeSource=false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rig-assembly-test-')),original=fixture(),source={id:'placement',preview:{id:'source.glb'},blend:{id:'source.blend'}},donor={id:'donor'},p={id:'p',rigRefinements:[{id:'run',sourcePlacementId:'placement',donorId:'donor'}]},projects=new Map([['p',p]]);
 const store={root:dir,projects,get:id=>projects.get(id),read:async(p,a)=>a.id==='source.glb'?original:a.id==='source.blend'?Buffer.from('BLENDER_original'):fs.readFile(path.join(dir,p.id,a.id)),asset:async(p,b,ext)=>{await fs.mkdir(path.join(dir,p.id),{recursive:true});const a={id:randomUUID()+'.'+ext};await fs.writeFile(path.join(dir,p.id,a.id),b);return a;},save:async n=>{projects.set(n.id,n);if(failSave)throw Error('disk failure');}};
 const app=express();mountRigAssembly(app,{store,editable:()=>{},riggingSource:()=>source,donorFor:()=>donor,runFor:(p,id)=>p.rigRefinements.find(r=>r.id===id),locked:async(p,fn)=>fn(),validateFiles:async()=>{if(changeSource)projects.set('p',{...p,other:true});return {pairVerified:true,originalEditablePreserved:true};}});app.use((e,q,r,n)=>r.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 return {store,p,source,get:()=>projects.get('p'),post:async(confirm=true,{expectedVersion,glb=fixture(true)}={})=>{const form=new FormData();form.set('confirm',String(confirm));form.set('additions',JSON.stringify(additions));if(expectedVersion)form.set('expectedVersion',expectedVersion);form.set('blend',new Blob([Buffer.from('BLENDER_assembly')]),'assembly.blend');form.set('glb',new Blob([glb]),'assembly.glb');const r=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/p/rigging/refinement/runs/run/assembly`,{method:'POST',body:form});return {status:r.status,body:await r.json()};},files:async()=>fs.readdir(path.join(dir,'p')).catch(()=>[])};
}

test('a later export assembly requires the exact rig version and retains the prior assembly for reserved additions',async t=>{
 const h=await harness(t);assert.equal((await h.post()).status,200);const previous=h.get().rigRefinements[0].assembly;h.get().rigRefinements[0].version='v1';
 const changed=parseGlb(fixture(true));changed.json.nodes[1].translation=[0,0,2];const glb=buildGlb(changed.json,changed.bin);
 assert.equal((await h.post(true,{glb})).status,400);assert.equal((await h.post(true,{glb,expectedVersion:'stale'})).status,400);assert.equal((await h.files()).length,2);
 assert.equal((await h.post(true,{glb,expectedVersion:'v1'})).status,200);const run=h.get().rigRefinements[0];assert.equal(run.version,'v1');assert.notEqual(run.assembly.hashes.glb,previous.hashes.glb);assert.deepEqual(run.assemblyHistory[0].assembly,previous);assert.equal(run.assemblyHistory[0].rigVersion,'v1');assert.equal((await h.files()).length,4);
});
test('assembly registration requires explicit intent and retains immutable source/donor/run identity',async t=>{
 const h=await harness(t);assert.equal((await h.post(false)).status,400);assert.deepEqual(await h.files(),[]);
 assert.equal((await h.post()).status,200);const r=h.get().rigRefinements[0];assert.equal(r.sourcePlacementId,'placement');assert.equal(r.donorId,'donor');assert.deepEqual(r.assembly.additions,additions);assert.equal((await h.post()).body.reused,true);assert.equal((await h.files()).length,2);
 const source=await assemblySource(h.store,h.get(),r,h.source);assert.deepEqual(source.glb,fixture(true));await fs.writeFile(path.join(h.store.root,'p',r.assembly.glb.id),'changed');await assert.rejects(()=>assemblySource(h.store,h.get(),r,h.source),/RIG_ASSEMBLY/);
});
test('concurrent source changes and persistence failures cannot publish a partial assembly',async t=>{
 for(const options of [{changeSource:true},{failSave:true}]){const h=await harness(t,options);assert((await h.post()).status>=400);assert.deepEqual(await h.files(),[]);assert.equal(h.get().rigRefinements[0].assembly,undefined);}
});

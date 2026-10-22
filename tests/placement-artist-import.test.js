import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,emptyProject} from '../server/storage.js';
import {snapshot,present} from '../server/lineage.js';
import {fingerprintViewSet} from '../server/view-set.js';
import {mountPlacement} from '../server/placement.js';
import {readManualModelSnapshot} from '../server/manual-model-snapshot.js';
import {mountPlacementHandoff} from '../server/placement-handoff.js';
import {riggingSource} from '../server/rigging.js';
import {identityPart} from '../src/placement-math.js';
const png=await fs.readFile('fixtures/head-front.png');
function textured(){const d={asset:{version:'2.0'},meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{uri:'data:image/png;base64,'+png.toString('base64')}]};const text=JSON.stringify(d),json=Buffer.from(text.padEnd(Math.ceil(text.length/4)*4,' ')),b=Buffer.alloc(20+json.length);b.write('glTF');b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);return b;}
async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'artist-import-')),store=new Store(dir);await store.init();const p=emptyProject('Artist import');p.reference=await store.asset(p,png,'png','fixture');p.referenceState={status:'ready',referenceId:p.reference.id};
 for(const group of ['head','body']){p.groups[group].views.front=p.reference;const model={id:randomUUID()+'.glb',group,source:'importado',lineage:snapshot(p)};p.models.push(model);p.groups[group].selectedModelId=model.id;(p.textures||=[]).push({...await store.asset(p,textured(),'glb','fixture'),group,sourceModelId:model.id,fingerprint:fingerprintViewSet(p,group)});}
 await store.save(p);let validations=0,beforeValidate=async()=>{};
 const validateArtistFiles=async({blend,glb})=>{validations++;await beforeValidate();return {blend,glb,report:{schema:'fita-artist-model-import/v1',pairVerified:true,reviewRequired:true,headMeshes:1,bodyMeshes:2,independentParts:true}};};
 const app=express();app.use(express.json());mountPlacement(app,{store,editable:()=>{},presentProject:present,blenderPath:async()=>'fixture',bakeModel:async()=>({'approved.blend':Buffer.from('BLENDER-original'),'approved.glb':textured()}),validateArtistFiles});const handoff=mountPlacementHandoff(app,{store,editable:()=>{},presentProject:present});app.use('/api/placement-deliveries',handoff.router);app.use((e,q,r,n)=>r.status(e.status||400).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const root=`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/placement`;t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const post=async(route,body)=>{const response=await fetch(root+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 await post('/manual',{confirm:true,workflowEpoch:0,baseApprovalId:null,sources:Object.fromEntries(p.textures.map(x=>[x.group,x.id])),transforms:{head:identityPart(),body:identityPart()},heightCm:167});
 const send=async(extra={})=>{const current=store.get(p.id),form=new FormData();form.set('blend',new Blob([Buffer.from('BLENDER-artist-new-mesh')]),'artist.blend');form.set('glb',new Blob([textured()]),'artist.glb');for(const [k,v] of Object.entries({confirm:'true',baseApprovalId:current.manualPlacement.id,workflowEpoch:0,...extra}))form.set(k,String(v));const response=await fetch(root+'/artist-import',{method:'POST',body:form});return {status:response.status,data:await response.json()};};
 return {store,p,root,send,post,validations:()=>validations,onValidate:fn=>beforeValidate=fn};
}
test('artist import requires explicit intent, current baseline and cancelled waiting',async t=>{
 const h=await setup(t),before=JSON.stringify(h.store.get(h.p.id));
 assert.equal((await h.send({confirm:false})).status,409);assert.equal((await h.send({baseApprovalId:'stale'})).status,409);assert.equal(h.validations(),0);assert.equal(JSON.stringify(h.store.get(h.p.id)),before);
 const p=h.store.get(h.p.id);p.placementHandoff={id:randomUUID(),status:'waiting',manualId:p.manualPlacement.id};await h.store.save(p);
 assert.equal((await h.send()).data.error,'PLACEMENT_WAITING_FOR_CODEX');assert.equal(h.validations(),0);
 assert.equal((await h.post('/unlock',{confirm:true,deliveryId:p.placementHandoff.id})).status,200);
 assert.equal((await h.send()).status,200);
});
test('artist import updates editable mesh and preview together, retains prior assets and enables rigging',async t=>{
 const h=await setup(t),before=structuredClone(h.store.get(h.p.id)),old=before.manualPlacement.modelSnapshot;
 const result=await h.send();assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.status,'imported');
 const p=h.store.get(h.p.id);assert.equal(p.placementHandoff.source,'artist-import');assert.equal(p.placementHandoff.status,'imported');assert.equal(p.manualPlacement.externalEditing,true);assert.notEqual(p.manualPlacement.id,before.manualPlacement.id);assert.notEqual(p.manualPlacement.modelSnapshot.preview.id,old.preview.id);assert.notEqual(p.manualPlacement.modelSnapshot.blend.id,old.blend.id);
 const files=await readManualModelSnapshot(h.store,p,p.manualPlacement);assert.equal(files['approved.blend'].toString(),'BLENDER-artist-new-mesh');assert.equal((await h.store.read(p,old.blend)).toString(),'BLENDER-original');assert.deepEqual(p.textures,before.textures);assert.equal(p.artistModelImports[0].previousManual.id,before.manualPlacement.id);
 assert.equal(riggingSource(p).id,result.data.importId);assert.equal((await h.post('/continue',{})).status,200);
});
test('a source change during artist validation rejects the import without publishing assets',async t=>{
 const h=await setup(t),p=h.store.get(h.p.id),files=await fs.readdir(path.join(h.store.root,p.id));h.onValidate(async()=>{p.manualPlacementDraft={changed:true};});
 assert.equal((await h.send()).status,409);assert.deepEqual(await fs.readdir(path.join(h.store.root,p.id)),files);assert.equal(p.artistModelImports,undefined);
});
test('failed project commit rolls back in-memory state and deletes staged imported assets',async t=>{
 const h=await setup(t),p=h.store.get(h.p.id),files=await fs.readdir(path.join(h.store.root,p.id)),save=h.store.save.bind(h.store);h.store.save=async next=>{if(next.artistModelImports){h.store.projects.set(p.id,next);throw Error('disk failure');}return save(next);};
 assert.equal((await h.send()).status,400);assert.equal(h.store.get(p.id),p);assert.deepEqual(await fs.readdir(path.join(h.store.root,p.id)),files);assert.equal(p.artistModelImports,undefined);
});
test('an imported artist baseline cannot be accidentally rebuilt from the old source parts',async t=>{
 const h=await setup(t);assert.equal((await h.send()).status,200);const p=h.store.get(h.p.id),before=JSON.stringify(p);
 const result=await h.post('/manual',{confirm:true});assert.equal(result.status,409);assert.match(result.data.error,/Blender/);assert.equal(JSON.stringify(h.store.get(p.id)),before);
});

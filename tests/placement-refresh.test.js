import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {Store,emptyProject} from '../server/storage.js';
import {snapshot} from '../server/lineage.js';
import {fingerprintViewSet} from '../server/view-set.js';
import {mountPlacement,canRefreshPlacement} from '../server/placement.js';
const png=await fs.readFile('fixtures/head-front.png');
function textured(){const d={asset:{version:'2.0'},meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{uri:'data:image/png;base64,'+png.toString('base64')}]};const text=JSON.stringify(d),json=Buffer.from(text.padEnd(Math.ceil(text.length/4)*4,' ')),b=Buffer.alloc(20+json.length);b.write('glTF');b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);return b;}
async function harness(t,action){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'placement-refresh-')),store=new Store(dir);await store.init();const p=emptyProject('Refresh fixture');p.reference=await store.asset(p,png,'png','fixture');p.referenceState={status:'ready',referenceId:p.reference.id};p.textures=[];
 for(const group of ['head','body']){p.groups[group].views.front=p.reference;const model={id:randomUUID()+'.glb',group,source:'importado',lineage:snapshot(p)};p.models.push(model);p.groups[group].selectedModelId=model.id;p.textures.push({...await store.asset(p,textured(),'glb','fixture'),group,sourceModelId:model.id,fingerprint:fingerprintViewSet(p,group)});}
 const parent={id:randomUUID(),status:'succeeded',sources:Object.fromEntries(p.textures.map(x=>[x.group,x.id])),preview:await store.asset(p,textured(),'glb','fixture'),blend:await store.asset(p,Buffer.from('BLENDER fixture'),'blend','fixture'),report:{independentParts:true,headMeshes:1,bodyMeshes:1,artistReview:{hair:'preserved'}}};p.placements=[parent];
 const old=p.textures[1];p.textures.push({...old,...await store.asset(p,textured(),'glb','new texture')});await store.save(p);
 let startedResolve,finishResolve,calls=0;const started=new Promise(r=>startedResolve=r),finished=new Promise(r=>finishResolve=r);
 const runPlacement=async(exe,file,progress,script)=>{calls++;assert.equal(script,'refresh_placement_textures.py');const job=JSON.parse(await fs.readFile(file));startedResolve();try{await action?.({job,p,store});await fs.writeFile(job.glb,textured());await fs.writeFile(job.blend,'BLENDER updated');await fs.writeFile(job.report,JSON.stringify({...parent.report,textureRefresh:{geometryPreserved:true,before:'same',after:'same'}}));}finally{finishResolve();}};
 const app=express();app.use(express.json());mountPlacement(app,{store,editable:()=>{},runPlacement,blenderPath:async()=>'/fixture/blender'});app.use((e,q,r,n)=>r.status(e.status||500).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/placement`;
 const post=async id=>{const r=await fetch(base+'/refresh-textures',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({placementId:id})});return {status:r.status,data:await r.json()};};
 const done=async()=>{await finished;for(let i=0;i<100;i++){const r=p.placements.at(-1);if(!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('test timeout');};return {p,parent,post,started,done,store,base,calls:()=>calls};
}
test('new texture keeps old placement visible, refresh creates a new version and is unavailable for a different source',async t=>{
 const h=await harness(t),before=structuredClone(h.parent);assert(canRefreshPlacement(h.p,h.parent));
 const state=await(await fetch(h.base)).json();assert.equal(state.runs[0].current,false);assert.equal(state.runs[0].canRefreshTextures,true);
 assert.equal((await h.post('foreign-project-id')).status,409);
 h.p.textures.at(-1).sourceModelId='wrong';assert.equal(canRefreshPlacement(h.p,h.parent),false);h.p.textures.at(-1).sourceModelId=h.p.textures[1].sourceModelId;
 assert.equal((await h.post(h.parent.id)).status,202);const r=await h.done();assert.equal(r.status,'succeeded');assert.equal(r.parentPlacementId,h.parent.id);assert.equal(r.source,'texture-refresh');assert.notEqual(r.preview.id,h.parent.preview.id);assert.deepEqual(h.parent,before);assert.equal(canRefreshPlacement(h.p,r),false);
});
test('double clicks start one refresh and geometric mismatch never replaces the previous result',async t=>{
 let release;const hold=new Promise(r=>release=r);const h=await harness(t,async()=>{await hold;throw Error('PLACEMENT_TEXTURE_GEOMETRY_MISMATCH');});
 await h.post(h.parent.id);await h.started;assert.equal((await h.post(h.parent.id)).status,409);release();const r=await h.done();assert.equal(h.calls(),1);assert.equal(r.status,'failed');assert.equal(r.preview,undefined);assert.equal(h.parent.status,'succeeded');assert.match(r.error,/GEOMETRY_MISMATCH/);
});
test('a newer texture arriving during refresh rejects stale output without overwriting it',async t=>{
 const h=await harness(t,async({p})=>{p.textures.push({...p.textures.at(-1),id:randomUUID()+'.glb'});});await h.post(h.parent.id);const r=await h.done();assert.equal(r.status,'failed');assert.equal(r.error,'PLACEMENT_SOURCE_CHANGED');assert.equal(r.preview,undefined);assert.equal(h.parent.status,'succeeded');
});

import {workspaceFiles} from './local-workspace-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import yauzl from 'yauzl';
import {Store,emptyProject} from '../server/storage.js';
import {segmentIdentity} from '../server/segmentation-identity.js';
import {prepareBudget,advanceChain,acceptBudget} from '../server/segmentation-budget.js';
import {acceptGroupPlan,createSegmentReferences,currentPlan,referenceInstructions} from '../server/segment-references.js';
import {zipBuffers} from '../server/codex-handoff.js';
import {skinReferenceInstructions,segmentReferencePrompt} from '../server/segment-reference-prompts.js';
const settings={resolution:'4K',removeLighting:false};

test('body references include non-explicit skin coverage with recorded temporary underwear and no automatic refusal retry',()=>{
 for(const category of ['skin','clothing','unclassified']){
  const prompt=segmentReferencePrompt({id:'torso',part:'body',category});assert(prompt.includes(skinReferenceInstructions));assert.match(prompt,/sin pezones, areolas, genitales/);assert.match(prompt,/bandeau gris carbón oscuro o negro mate/);assert.match(prompt,/SIN TIRANTES/);assert.match(prompt,/coverage.json/);assert.match(prompt,/no repitas|ni repitas generaciones/);
 }
 assert(!segmentReferencePrompt({id:'face',part:'head'}).includes(skinReferenceInstructions));
 assert.match(referenceInstructions,/CONTINUIDAD DE PATRONES/);assert.match(referenceInstructions,/prompts\/<id>/);
});
const provider={capabilities:()=>({supported:true}),quote:async({step})=>({source:'studio',verified:true,credits:step==='smartUV'?7:19,conditions:step+'4K',expiresAt:Date.now()+600000})};
const fixture=()=>({id:'seg',approval:{id:'approval'},groups:['hair','face','outfit'].map((id,i)=>({id,name:id,part:i<2?'head':'body',settings:{...settings},referencesReady:false}))});
async function quotes(seg){return Promise.all(['head','body'].map(p=>prepareBudget(seg,p,provider)));}
const consent=bs=>({confirm:true,confirmUpload:true,autoStart:true,total:78,budgetIds:Object.fromEntries(bs.map(b=>[b.part,b.id]))});
test('combined consent includes separate exact head/body costs and rejects partial, expired, changed or unaccepted quotes',async()=>{
 const seg=fixture(),bs=await quotes(seg),args=consent(bs),plan=acceptGroupPlan(seg,bs,args);assert.deepEqual(plan.totals,{head:52,body:26});assert.equal(plan.maxCredits,78);
 for(const change of [{confirm:false},{confirmUpload:false},{autoStart:false},{total:77},{budgetIds:{head:bs[0].id}}])assert.throws(()=>acceptGroupPlan(seg,bs,{...args,...change}),/SEG_BUDGET/);
 bs[0].rows[0].smartUV.expiresAt=0;assert.throws(()=>acceptGroupPlan(seg,bs,args),/STALE/);bs[0].rows[0].smartUV.expiresAt=Date.now()+600000;
 seg.groups[0].settings.resolution='8K';assert.throws(()=>acceptGroupPlan(seg,bs,args),/STALE/);
 assert.match(referenceInstructions,/TRES imágenes independientes POR GRUPO/);assert.match(referenceInstructions,/NO uses Tripo/);
});
async function unpack(buffer){return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(e,z)=>{if(e)return reject(e);const files={};z.on('error',reject);z.on('end',()=>resolve(workspaceFiles(files)));z.on('entry',e=>z.openReadStream(e,(err,s)=>{if(err)return reject(err);const chunks=[];s.on('data',b=>chunks.push(b));s.on('end',()=>{files[e.fileName]=Buffer.concat(chunks);z.readEntry();});}));z.readEntry();}));}
async function png(i){return sharp(Buffer.from(`<svg width="256" height="256"><rect x="${10+i}" y="10" width="160" height="160" fill="rgb(${20+i*8},90,130)"/></svg>`)).png().toBuffer();}
test('reference delivery accepts exactly three transparent distinct PNGs per segment, auto-delivers once and invalidates changed plans',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'seg-ref-')),store=new Store(dir);await store.init();const p=emptyProject('reference delivery fixture'),seg=fixture(),model=await fs.readFile('fixtures/mannequin.glb');
 seg.identity=segmentIdentity(p);p.segmentations=[seg];for(const g of seg.groups)g.asset=await store.asset(p,model,'glb','fixture');
 const bs=await quotes(seg);p.segmentTexturePlan=acceptGroupPlan(seg,bs,consent(bs));await store.save(p);
 let starts=0;const delivered=new Set();
 const delivery=await createSegmentReferences({store,ensure:()=>{},idle:()=>{},afterImport:async project=>{const id=currentPlan(project).referencesReceipt.id;if(!delivered.has(id)){starts++;delivered.add(id);}},runner:async(mode,file)=>{assert.equal(mode,'guides');const job=JSON.parse(await fs.readFile(file));for(const g of job.groups)for(const v of ['front','right','back'])await fs.writeFile(path.join(job.directory,`${g.id}_${v}.png`),await png(1));}});
 const app=express();app.use('/api/segment-references-deliveries',delivery.router);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const grant=await delivery.issue(p),pack=await unpack(await delivery.package(p,grant.id)),desc=JSON.parse(pack['ENTREGA_LOCAL.json']),manifest=JSON.parse(pack['manifest.json']);
 assert.equal((await delivery.issue(p)).id,grant.id);assert.equal(manifest.groups.length,3);assert.equal(manifest.groups.flatMap(g=>g.files).length,9);assert(pack['guides/hair_right.png']);assert(pack['prompts/outfit.txt'].toString().includes(skinReferenceInstructions));
 const coverage=JSON.parse(pack['coverage.json']);coverage.groups.forEach(g=>g.status='none');
 const files={'manifest.json':pack['manifest.json'],'coverage.json':Buffer.from(JSON.stringify(coverage))};let n=0;for(const g of manifest.groups)for(const name of g.files)files[name]=await png(n++);
 const post=async f=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api/segment-references-deliveries/${grant.id}`,{method:'POST',headers:{Authorization:'Bearer '+desc.token,'Content-Type':'application/zip'},body:Buffer.isBuffer(f)?f:await zipBuffers(f)});return {status:res.status,body:await res.json()};};
 const incomplete={...files};delete incomplete['references/hair_right.png'];assert.equal((await post(incomplete)).body.error,'SEG_REFERENCES_REQUIRED');assert.equal(starts,0);
 assert.equal((await post({...files,'references/face_front.png':files['references/hair_front.png']})).body.error,'SEG_REFERENCE_DUPLICATE');assert.equal(starts,0);assert(seg.groups.every(g=>!g.referencesReady));
 const opaque=await sharp({create:{width:256,height:256,channels:4,background:'#fff'}}).png().toBuffer();assert.equal((await post({...files,'references/hair_front.png':opaque})).body.error,'SEG_REFERENCE_TRANSPARENCY');
 const wrongManifest={...manifest,projectId:'other'};assert.equal((await post({...files,'manifest.json':Buffer.from(JSON.stringify(wrongManifest))})).body.error,'SEG_INPUTS_CHANGED');
 const resultZip=await zipBuffers(files),good=await post(resultZip);assert.equal(good.status,200);assert.equal(good.body.status,'imported');assert.equal(starts,1);assert(seg.groups.every(g=>g.referencesReady&&Object.keys(g.references).length===3));
 // A lost reply resends the same ZIP, including its entry timestamps.
 const again=await post(resultZip);assert.equal(again.body.duplicate,true);assert.equal(starts,1);assert.equal((await delivery.status(p)).status,'imported');
 const count=await fs.readdir(path.join(dir,p.id));assert.equal(count.length,12,'3 mesh copies + exactly 9 references; rejected deliveries leave no assets');
 seg.groups[0].settings.resolution='8K';assert.equal(currentPlan(p),null);await assert.rejects(()=>delivery.issue(p),/SEG_BUDGET_CONFIRMATION/);
});
test('every group finishes its download before the next group starts, head then body; missing reference prevents the queue',async()=>{
 const seg=fixture(),bs=await quotes(seg),order=[];seg.groups.forEach(g=>g.referencesReady=true);
 const p={...provider,execute:async({operation})=>{order.push(`${operation.groupId}:${operation.step}`);return {status:'completed',credits:operation.quote.credits};},recover:async()=>null};
 for(const b of bs){const run=acceptBudget(seg,b,{maxCredits:b.total,confirm:true,confirmSeparateAssets:true});await advanceChain({run,seg,provider:p,save:async()=>{},isCurrent:()=>true});assert.equal(run.status,'completed');}
 assert.deepEqual(order,['hair','face','outfit'].flatMap(id=>['import','smartUV','texture','download'].map(s=>`${id}:${s}`)));
});

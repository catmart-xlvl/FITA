import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Store,emptyProject} from '../server/storage.js';
import {segmentIdentity} from '../server/segmentation-identity.js';
import {planIdentity} from '../server/segment-references.js';
import {correctRejectedGroup} from '../server/segment-texture-retry.js';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'texture-retry-')),store=new Store(root);await store.init();t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const p=emptyProject('retry'),g={id:'skin',part:'body',settings:{resolution:'4K',removeLighting:false},references:{front:{id:'old'}},referencesReady:true};
 const s={id:'seg',identity:segmentIdentity(p),approval:{id:'approved'},groups:[g]};p.segmentations=[s];
 const plan={id:'plan',identity:planIdentity(s),status:'attention',total:240,maxCredits:240,totals:{head:80,body:160},budgets:[{part:'body',total:160}],error:'TEXTURE_IMAGE_REQUIRED'};p.segmentTexturePlan=plan;
 const run={id:'run',planId:'plan',part:'body',status:'attention',error:'TEXTURE_IMAGE_REQUIRED',maxCredits:160,committedCredits:40,operations:['import','smartUV','texture','download'].map(step=>({id:step,groupId:'skin',step,status:'completed',quote:{credits:['texture','smartUV'].includes(step)?20:0},receipt:{step}}))};p.segmentTextureRuns=[run];await store.save(p);
 const files={};for(const [i,v] of ['front','right','back'].entries())files[v]=[{buffer:await sharp(Buffer.from(`<svg width="256" height="256"><rect x="${10+i}" y="10" width="180" height="200" fill="red"/></svg>`)).png().toBuffer()}];
 const input={runId:'run',groupId:'skin',textureOperationId:'texture',confirmRejected:true,confirmRetry:true,acceptedExtraCredits:20,coverage:{groupId:'skin',status:'temporary',areas:['chest'],description:'Dark opaque bandeau'}};
 const provider={resultBytes:async()=>{throw new Error('TEXTURE_IMAGE_REQUIRED');}};
 return {p,store,provider,input,files,g,run,plan};
}
test('verified rejected texture replaces only its references/texture/download and preserves paid UV and conservative cost',async t=>{
 const f=await fixture(t),old=f.g.references;await correctRejectedGroup(f);
 assert.deepEqual(f.run.operations.map(o=>o.step),['import','smartUV']);assert.equal(f.run.committedCredits,40);assert.equal(f.run.maxCredits,180);assert.equal(f.plan.maxCredits,260);assert.equal(f.plan.totals.head,80);assert.equal(f.plan.totals.body,180);assert.equal(f.run.retryHistory[0].references,old);assert.equal(f.run.retryHistory[0].operations.length,2);assert.notEqual(f.g.references,old);
 await assert.rejects(()=>correctRejectedGroup(f),/SEG_RETRY_NOT_SAFE/);
});
test('retry refuses uncertain downloads, valid paid textures and unconfirmed extra credits',async t=>{
 const f=await fixture(t);f.provider.resultBytes=async()=>Buffer.from('valid texture');await assert.rejects(()=>correctRejectedGroup(f),/SEG_RETRY_NOT_SAFE/);
 f.provider.resultBytes=async()=>{throw new Error('DOWNLOAD_NOT_FOUND');};await assert.rejects(()=>correctRejectedGroup(f),/DOWNLOAD_NOT_FOUND/);
 f.provider.resultBytes=async()=>{throw new Error('TEXTURE_IMAGE_REQUIRED');};f.input.acceptedExtraCredits=0;await assert.rejects(()=>correctRejectedGroup(f),/SEG_BUDGET_CONFIRMATION/);assert.equal(f.run.operations.length,4);assert.equal(f.run.maxCredits,160);
});
test('failed reference validation and failed save leave original references and run intact',async t=>{
 const f=await fixture(t),before=JSON.stringify({run:f.run,plan:f.plan,g:f.g});f.files.back=f.files.front;
 await assert.rejects(()=>correctRejectedGroup(f),/SEG_REFERENCE_DUPLICATE/);assert.equal(JSON.stringify({run:f.run,plan:f.plan,g:f.g}),before);assert.deepEqual(await fs.readdir(path.join(f.store.root,f.p.id)),[]);
 f.files.back=[{buffer:await sharp(Buffer.from('<svg width="256" height="256"><circle cx="100" cy="100" r="70" fill="blue"/></svg>')).png().toBuffer()}];f.store.save=async()=>{throw new Error('disk failure');};
 await assert.rejects(()=>correctRejectedGroup(f),/disk failure/);assert.equal(JSON.stringify({run:f.run,plan:f.plan,g:f.g}),before);assert.deepEqual(await fs.readdir(path.join(f.store.root,f.p.id)),[]);
});

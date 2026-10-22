import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {Store,emptyProject} from '../server/storage.js';
import {segmentIdentity} from '../server/segmentation-identity.js';
import {prepareBudget} from '../server/segmentation-budget.js';
import {acceptGroupPlan} from '../server/segment-references.js';
import {createTextureSupervisor,supervisorState} from '../server/texture-supervisor.js';
import {waitForApproval,waitForTextureEvent} from '../scripts/supervise-textures.mjs';
import {texturePreviewState,textureWorkingPreviews} from '../server/texture-preview.js';

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'texture-supervisor-')),store=new Store(root);await store.init();
 const p=emptyProject('Supervision test');await store.save(p);let clock=Date.now();const calls=[];
 const delivery=kind=>({issue:async()=>{calls.push(kind);return{id:kind};},package:async()=>Buffer.from('ZIP '+kind)});
 const options={store,now:()=>clock,ttlMs:5000,segmentation:{resumePlan:async()=>{calls.push('resume');p.segmentTexturePlan.status='running';p.segmentTexturePlan.error=null;},references:delivery('references'),finishForAgent:async()=>{calls.push('transfer');p.segmentTexturePlan.status='finishing';}},refinement:{delivery:delivery('finish')}};
 let workflow=await createTextureSupervisor(options);const files=await workflow.issue(p),d=JSON.parse(files['SUPERVISION_LOCAL.json']);
 const seg={id:'seg',identity:segmentIdentity(p),supervisionId:d.id,workflowVersion:2,approval:null,groups:['hair','face','outfit'].map((id,i)=>({id,part:i<2?'head':'body',settings:{resolution:'4K',removeLighting:false}}))};p.segmentations=[seg];await store.save(p);
 const app=express();app.use('/api/texture-supervisors',(req,res,next)=>workflow.router(req,res,next));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api/texture-supervisors/${d.id}`;
 const call=async(route='/events',body,headers={})=>fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+d.token,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
 async function quote(){seg.approval={id:'review'};p.segmentBudgets=await Promise.all(['head','body'].map(part=>prepareBudget(seg,part,{quote:async({step})=>({source:'studio',verified:true,credits:step==='smartUV'?20:30,conditions:'fixture 4K',expiresAt:Date.now()+600000})})));}
 async function approve(){await quote();p.segmentTexturePlan=acceptGroupPlan(seg,p.segmentBudgets,{confirm:true,confirmUpload:true,autoStart:true,total:150,budgetIds:Object.fromEntries(p.segmentBudgets.map(b=>[b.part,b.id]))});await store.save(p);}
 return{p,seg,files,d,calls,call,base,quote,approve,resume:()=>workflow.resumePackage(p),restart:async()=>{workflow=await createTextureSupervisor(options);},expire:()=>clock+=6000};
}

test('preview stays hidden throughout the approved workflow, including recovery, until validated finish',async t=>{
 const h=await fixture(t);assert.equal(texturePreviewState(h.p).previewPending,false);await h.approve();
 h.p.textures=[{id:'transfer-head',supervisedPending:true},{id:'old-body'}];
 for(const status of ['waiting-references','references-ready','running','reconstructing','ready-to-finish','finishing','attention']){
  h.p.segmentTexturePlan.status=status;assert.deepEqual(texturePreviewState(h.p),{previewPending:true,textures:[]});
 }
 await h.restart();assert.equal(texturePreviewState(h.p).previewPending,true);
 h.p.textures.push({id:'refined-head',refinementId:'validated'},{id:'refined-body',refinementId:'validated'});h.p.segmentTexturePlan.status='completed';
 assert.deepEqual(texturePreviewState(h.p).textures.map(t=>t.id),['old-body','refined-head','refined-body']);assert.equal(texturePreviewState(h.p).previewPending,false);
});

test('working previews require a verified current transfer and never count as final approval',async t=>{
 const h=await fixture(t);await h.approve();const plan=h.p.segmentTexturePlan;
 h.p.segmentTextureRuns=['head','body'].map(part=>({id:part,part,planId:plan.id,status:'completed'}));
 h.p.textures=['head','body'].map(group=>({id:group,group,segmentationId:h.seg.id,supervisedPending:true}));
 h.seg.reconstruction={runIds:['head','body'],textureIds:['head','body'],report:{geometryPreserved:true,cornerUvTransfer:true,savedAndReopened:true,faceUv:{geometryPreserved:true,overlappingTexels:0,skinIslands:1}}};
 assert.equal(textureWorkingPreviews(h.p).length,2);assert.equal(texturePreviewState(h.p).textures.length,0);
 delete h.seg.reconstruction.report.faceUv;assert.equal(textureWorkingPreviews(h.p).length,2);
 h.seg.reconstruction.report.cornerUvTransfer=false;assert.deepEqual(textureWorkingPreviews(h.p),[]);h.seg.reconstruction.report.cornerUvTransfer=true;
 h.p.segmentTextureRuns[1].planId='old';assert.deepEqual(textureWorkingPreviews(h.p),[]);
});

test('supervisor exposes actual separate costs, durable consent and only source-bound actionable stages',async t=>{
 const h=await fixture(t);assert.equal((await(await h.call()).json()).stage,'awaiting-review');
 h.seg.approval={id:'review'};assert.equal((await(await h.call()).json()).stage,'quoting');
 await h.quote();const priced=await(await h.call()).json();assert.deepEqual(priced.totals,{head:100,body:50});assert.equal(priced.stage,'awaiting-consent');assert.equal(priced.consent.accepted,false);
 assert.equal((await h.call('/package',{kind:'references'})).status,409);assert.deepEqual(h.calls,[]);
 await h.approve();await h.restart();let state=await(await h.call()).json();assert.equal(state.consent.accepted,true);assert.equal(state.consent.planId,h.p.segmentTexturePlan.id);assert.equal(state.consent.maxCredits,150);
 assert.equal((await h.call('/package',{kind:'references'})).status,200);assert.deepEqual(h.calls,['references']);
 h.p.segmentTexturePlan.status='running';assert.equal((await h.call('/package',{kind:'finish'})).status,409);
 h.p.segmentTexturePlan.status='ready-to-finish';assert.equal((await h.call('/package',{kind:'finish'})).status,200);assert.deepEqual(h.calls,['references','transfer','finish']);
 h.p.segmentTexturePlan.status='completed';assert.equal((await(await h.call()).json()).stage,'completed');
 h.seg.groups[0].settings.resolution='8K';state=await(await h.call()).json();assert.equal(state.consent.accepted,false);assert.equal(state.planId,null);
});

test('supervisor cannot approve costs, cross projects, use browser origins, expired or revoked capabilities',async t=>{
 const h=await fixture(t);assert.equal((await h.call('/events',null,{Authorization:'Bearer '+'0'.repeat(64)})).status,401);
 assert.equal((await h.call('/events',null,{Origin:'https://example.com'})).status,403);
 const hostStatus=await new Promise((resolve,reject)=>http.get(h.base+'/events',{headers:{Host:'example.com',Authorization:'Bearer '+h.d.token}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject));assert.equal(hostStatus,403);
 assert.equal((await h.call('/package',{kind:'approve',confirm:true,total:999})).status,409);assert(!h.p.segmentTexturePlan);
 h.seg.supervisionId='different';assert.equal(supervisorState(h.p,h.d.id).stage,'analysis');assert.equal(supervisorState(h.p,h.d.id).consent.accepted,false);
 h.p.notesRevision++;assert.equal((await h.call()).status,409);h.p.notesRevision--;
 h.expire();assert.equal((await(await h.call()).json()).error,'SEG_DELIVERY_EXPIRED');assert.deepEqual(h.calls,[]);
 assert.match(h.files['FLUJO_SUPERVISADO.txt'].toString(),/máximo 60 segundos/);assert.match(h.files['FLUJO_SUPERVISADO.txt'].toString(),/NO ImageGen/);
});

test('approval wait exits at 60 seconds without approving or repeating the wait',async()=>{
 let clock=0,reads=0;const result=await waitForApproval(async({waitMs})=>{reads++;clock+=waitMs||1;return{stage:'awaiting-consent',cursor:'same',consent:{accepted:false}};},{now:()=>clock});
 assert.equal(clock,60000);assert.equal(reads,4);assert.equal(result.stage,'approval-wait-ended');assert.equal(result.approved,false);assert.equal(result.message,'Dime cuando apruebes la generación de texturas.');
});

test('resuming paid legacy work requires every saved group and a verified transfer, without new consent or spend',async t=>{
 const h=await fixture(t);await assert.rejects(()=>h.resume(),/SEG_RESULTS_REQUIRED/);await h.approve();
 const plan=h.p.segmentTexturePlan;plan.status='completed';delete plan.workflowVersion;plan.referencesReceipt={id:'paid-references'};
 h.p.segmentTextureRuns=['head','body'].map(part=>({id:part,part,planId:plan.id,status:'completed',operations:h.seg.groups.filter(g=>g.part===part).map(g=>({groupId:g.id,step:'download',status:'completed',downloadAsset:{id:g.id+'.glb'}}))}));
 h.seg.reconstruction={report:{geometryPreserved:true,cornerUvTransfer:true,savedAndReopened:true},runIds:['head','body'],textureIds:['head-final','body-final']};
 const before={id:plan.id,total:plan.total,createdAt:plan.createdAt,budgets:JSON.stringify(plan.budgets)};
 const op=h.p.segmentTextureRuns[0].operations[0];delete op.downloadAsset;await assert.rejects(()=>h.resume(),/SEG_RESULTS_REQUIRED/);op.downloadAsset={id:'hair.glb'};
 const zip=await h.resume();assert.equal(zip.subarray(0,2).toString(),'PK');assert.equal(plan.status,'ready-to-finish');assert.equal(plan.workflowVersion,2);assert.deepEqual({id:plan.id,total:plan.total,createdAt:plan.createdAt,budgets:JSON.stringify(plan.budgets)},before);assert.deepEqual(h.calls,[]);
 h.p.textureRefinements=[{manifest:{sources:[{id:'head-final'}]}}];await assert.rejects(()=>h.resume(),/SUPERVISOR_STAGE_MISMATCH/);
});

test('approval wait requires recorded matching plan, resumes promptly, and bounds a stalled network',async()=>{
 let clock=0,reads=0;const state=await waitForApproval(async({waitMs})=>{clock+=waitMs||1;reads++;return reads<3?{stage:'references-required',cursor:'x',planId:'p',consent:{accepted:reads===2,planId:'other'}}:{stage:'references-required',cursor:'yes',planId:'p',consent:{accepted:true,planId:'p'}};},{now:()=>clock});
 assert.equal(reads,3);assert.equal(state.consent.planId,'p');
 const keepAlive=setTimeout(()=>{},1000);try{
 const timeout=await waitForApproval(({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),{timeoutMs:30});assert.equal(timeout.stage,'approval-wait-ended');
 }finally{clearTimeout(keepAlive);}
 await assert.rejects(()=>waitForApproval(async()=>{throw Error('SEG_DELIVERY_EXPIRED');}),/SEG_DELIVERY_EXPIRED/);
});


test('supervisor reports operation progress, verifies consent at reference handoff and resumes only the same approved plan',async t=>{
 const h=await fixture(t);assert.equal((await h.call('/resume',{planId:'anything'})).status,409);
 await h.approve();const plan=h.p.segmentTexturePlan;assert.equal(plan.supervisorVerified,undefined);
 await h.call('/package',{kind:'references'});assert.equal(plan.supervisorVerified.planId,plan.id);
 plan.status='running';h.p.segmentTextureRuns=[{planId:plan.id,part:'head',status:'running',operations:[{id:'op',groupId:'hair',step:'import',status:'running'}]}];
 const before=await(await h.call()).json();h.p.segmentTextureRuns[0].operations[0].status='unknown';plan.status='attention';plan.error='SEG_IMPORT_UNCERTAIN';
 const after=await(await h.call()).json();assert.notEqual(after.cursor,before.cursor);assert.equal(after.progress[0].operations[0].step,'import');
 assert.equal((await h.call('/resume',{planId:'another-plan'})).status,409);assert.equal((await h.call('/resume',{planId:plan.id})).status,202);assert.equal(h.calls.filter(v=>v==='resume').length,1);
 assert.equal((await h.call('/resume',{planId:plan.id})).status,409);
});

test('quiet supervision returns repeated attention immediately and reports a stall without executing anything',async()=>{
 let clock=0,reads=0;
 const stalled=await waitForTextureEvent(async()=>{clock+=25000;reads++;return {stage:'texturing',cursor:'unchanged',progress:[]};},{after:'unchanged',now:()=>clock,stallMs:75000});
 assert.equal(stalled.stage,'stalled');assert.equal(reads,3);
 const attention=await waitForTextureEvent(async()=>({stage:'attention',cursor:'same'}),{after:'same'});assert.equal(attention.stage,'attention');
});

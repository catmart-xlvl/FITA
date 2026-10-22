import {workspaceFiles} from './local-workspace-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MESH_REPAIR_POLICY,REPAIR_VIEWS,REPAIR_REGIONS} from '../server/mesh-repair-policy.js';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import yauzl from 'yauzl';
import {Store,emptyProject} from '../server/storage.js';
import {snapshot} from '../server/lineage.js';
import {createSegmentation,segmentManifest,currentSegmentation} from '../server/segmentation.js';
import {readSegmentationZip} from '../server/segmentation-files.js';
import {textureCurrent,placementTexture} from '../server/texture-workflow.js';
import {fingerprintViewSet} from '../server/view-set.js';
import {zipBuffers} from '../server/codex-handoff.js';
import {createTextureSupervisor} from '../server/texture-supervisor.js';

async function unzip(b){return new Promise((resolve,reject)=>yauzl.fromBuffer(b,{lazyEntries:true},(e,z)=>{if(e)return reject(e);const files={};z.on('error',reject);z.on('end',()=>resolve(workspaceFiles(files)));z.on('entry',entry=>z.openReadStream(entry,(e,s)=>{if(e)return reject(e);const a=[];s.on('data',b=>a.push(b));s.on('end',()=>{files[entry.fileName]=Buffer.concat(a);z.readEntry();});}));z.readEntry();}));}
async function harness(t,provider){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'segmentation-test-')),store=new Store(root);await store.init();const p=emptyProject('Segmentation fixture');
 const image=await sharp({create:{width:256,height:256,channels:4,background:{r:50,g:90,b:130,alpha:1}}}).png().toBuffer(),glb=await fs.readFile('fixtures/mannequin.glb');
 p.reference=await store.asset(p,image,'png','fixture');p.referenceState={status:'ready',referenceId:p.reference.id};
 for(const group of ['head','body']){p.groups[group].views.front=await store.asset(p,image,'png','fixture');p.groups[group].selectedViews=['front'];const m={...await store.asset(p,glb,'glb','importado'),group,lineage:snapshot(p)};p.models.push(m);p.groups[group].selectedModelId=m.id;}await store.save(p);
 const calls=[],fault={error:null,after:null};let now=Date.now();
 const runner=async(mode,file)=>{calls.push(mode);if(fault.error)throw Error(fault.error);const job=JSON.parse(await fs.readFile(file)),proposal=JSON.parse(await fs.readFile(job.proposal));for(const g of proposal.groups)await fs.writeFile(path.join(job.directory,g.id+'.glb'),glb);for(const part of ['head','body'])await fs.writeFile(path.join(job.directory,part+'-ids.glb'),glb);await fs.writeFile(path.join(job.directory,'segmented.blend'),'BLENDERfixture');await fs.writeFile(path.join(job.directory,'correspondence.json'),'{}');await fs.writeFile(path.join(job.directory,'validated.json'),JSON.stringify({...proposal,counts:{head:2,body:1},geometryPreserved:true,savedAndReopened:true,meshRepair:{policy:MESH_REPAIR_POLICY,reviewed:true}}));await fault.after?.();};
 const workflow=await createSegmentation({store,editable:()=>{},gate:()=>{},presentProject:p=>p,bridge:{status:()=>({controlAvailable:false})},...(provider?{provider}:{}),runner,deliveryOptions:{now:()=>now,ttlMs:2000}}),app=express();app.use('/api/segmentation-deliveries',workflow.delivery.router);app.use(express.json());workflow.mount(app);app.use((e,q,r,n)=>r.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`,url=base+`/api/projects/${p.id}/segmentation`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
 const call=async(route='',body)=>{const r=await fetch(url+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
 const proposal={schema:'workbench-segmentation-result/v1',groups:[{id:'hair',name:'Hair',part:'head',category:'hair',faces:[0],components:['head0'],referencesReviewed:true},{id:'face',name:'Face',part:'head',category:'skin',faces:[1],components:['head1'],referencesReviewed:true},{id:'outfit',name:'Outfit',part:'body',category:'clothing',faces:[0],referencesReviewed:true}],pending:[],warnings:[],visualReview:{views:['front','left','right','back','isolated'],findings:'Synthetic contract fixture, not a real semantic review.'}};
 // Synthetic evidence exercises the delivery contract; Blender geometry and
 // real repair/evidence replay are covered separately with Blender fixtures.
 const repairFiles={},meshRepair={policy:MESH_REPAIR_POLICY,sourceFingerprint:'f'.repeat(64),operations:[],pending:[],decisions:{before:[],after:[]},visualReview:{}};
 for(const part of ['head','body']){
  const review={findings:'Synthetic reviewed fixture',regions:Object.fromEntries(REPAIR_REGIONS[part].map(r=>[r,{status:'clear',reason:'Synthetic region'}])),views:{}};
  for(const view of REPAIR_VIEWS[part]){review.views[view]={};for(const phase of ['before','after']){const file=`review/${part}_${view}_${phase}.png`;repairFiles[file]=image;review.views[view][phase]={file,sha256:createHash('sha256').update(image).digest('hex')};}}
  meshRepair.visualReview[part]=review;
 }
 proposal.meshRepair=meshRepair;
 async function result(change={}){const files={...repairFiles,'manifest.json':Buffer.from(JSON.stringify(await segmentManifest(store,p))),'result.json':Buffer.from(JSON.stringify({...proposal,...change})),'segmented.blend':Buffer.from('BLENDERfixture')};for(const g of proposal.groups)for(const v of ['front','back'])files[`references/${g.id}_${v}.png`]=image;return zipBuffers(files);}
 async function grant(){const g=await workflow.delivery.issue(p),files=await unzip(await workflow.delivery.package(p,g.id));return{...g,descriptor:JSON.parse(files['ENTREGA_LOCAL.json']),files};}
 async function deliver(g,bytes,extra={}){const r=await fetch(base+'/api/segmentation-deliveries/'+g.id,{method:'POST',headers:{Authorization:'Bearer '+g.descriptor.token,'Content-Type':'application/zip',...extra},body:bytes});return{status:r.status,body:await r.json()};}
 return{root,store,p,workflow,call,result,grant,deliver,calls,fault,proposal,advance:()=>now+=3000};
}
test('an interrupted quotation after restart becomes retryable instead of spinning forever',async t=>{
 const h=await harness(t);h.p.segmentQuotation={status:'running',part:'body',error:null};await h.store.save(h.p);
 const state=await h.call();assert.equal(state.body.quotation.status,'attention');assert.equal(state.body.quotation.error,'SEG_QUOTE_INTERRUPTED');
 assert.equal(h.p.segmentQuotation.status,'attention');
});

test('a delivered analysis cannot skip hole review even with an otherwise valid Blend and grouping',async t=>{
 const h=await harness(t),g=await h.grant();
 assert.equal(JSON.parse(g.files['manifest.json']).meshRepairPolicy,MESH_REPAIR_POLICY);
 assert.equal(JSON.parse(g.files['job.json']).meshRepairPolicy,MESH_REPAIR_POLICY);
 assert(g.files['mesh_hole_repair.py']&&g.files['REPARAR_HUECOS.md']);
 assert.match(g.files['INSTRUCCIONES.txt'].toString(),/OBLIGATORIO ANTES DE SEGMENTAR/);
 await assert.rejects(async()=>h.workflow.importPackage(h.p,await h.result({meshRepair:undefined})),/SEG_MESH_REPAIR_REQUIRED/);
 assert.equal(h.calls.length,0);assert.equal(h.p.segmentations,undefined);
 const repair=structuredClone(h.proposal.meshRepair);repair.visualReview.head.views.interior.after.sha256='0'.repeat(64);
 await assert.rejects(async()=>h.workflow.importPackage(h.p,await h.result({meshRepair:repair})),/SEG_MESH_REPAIR_EVIDENCE/);
 assert.equal(h.calls.length,0);
});

test('UV region profiles persist on the current analysis without touching paid runs, and cannot replace an existing transfer',async t=>{
 const h=await harness(t),s=await h.workflow.importPackage(h.p,await h.result());
 h.p.segmentTextureRuns=[{id:'paid',status:'completed',committedCredits:80,operations:[]}];
 const before=JSON.stringify(h.p.segmentTextureRuns),profile={schema:'workbench-face-uv-regions/v1',geometryHash:'a'.repeat(64),regions:{'ear-left':[0]}};
 assert.equal((await h.call('/face-uv-profile',{id:'stale',profile})).status,409);
 assert.equal((await h.call('/face-uv-profile',{id:s.id,profile})).status,200);
 assert.deepEqual(s.faceUvProfile,profile);assert.equal(JSON.stringify(h.p.segmentTextureRuns),before);
 const stored=new Store(h.root);await stored.init();assert.deepEqual(currentSegmentation(stored.get(h.p.id)).faceUvProfile,profile);
 s.reconstruction={runIds:['paid']};assert.equal((await h.call('/face-uv-profile',{id:s.id,profile})).status,409);
});

test('UV save audit recovers only an existing UV operation and preserves historical textures and costs',async t=>{
 const calls=[],provider={capabilities:()=>({supported:true}),forProject:()=>({recover:async args=>{calls.push(args.operation.id);return {status:'completed',uvSaved:true,taskId:'same-asset'};}})};
 const h=await harness(t,provider),s=await h.workflow.importPackage(h.p,await h.result());
 const run={id:'old-run',segmentationId:s.id,status:'completed',committedCredits:40,operations:[{id:'uv-op',groupId:'hair',step:'smartUV',status:'completed',receipt:{taskId:'same-asset'}},{id:'tex-op',groupId:'hair',step:'texture',status:'completed',receipt:{taskId:'same-asset'}}]};
 h.p.segmentTextureRuns=[run];const before=JSON.stringify(run);
 assert.equal((await h.call('/recover-uv-save',{operationId:'missing'})).body.error,'SEG_OPERATION_MISSING');
 assert.equal((await h.call('/recover-uv-save',{operationId:'tex-op'})).body.error,'SEG_OPERATION_MISSING');
 assert.equal(calls.length,0);
 const result=await h.call('/recover-uv-save',{operationId:'uv-op'});
 assert.equal(result.status,200);assert.equal(result.body.audit.receipt.uvSaved,true);
 assert.equal(result.body.audit.existingTextureRequiresReview,true);assert.deepEqual(calls,['uv-op']);
 assert.equal(JSON.stringify(run),before);assert.equal(h.p.uvSaveAudits.length,1);
});

test('delivery reuses identical package, expires explicitly, and keeps source-bound tokens separate',async t=>{
 const h=await harness(t),g=await h.grant(),again=await h.grant();assert.equal(g.id,again.id);assert.deepEqual(g.files,again.files);
 assert(g.files['head.glb']&&g.files['body.glb']&&g.files['segment_mesh.py']&&g.files['INSTRUCCIONES.txt']);
 assert(!g.files['skills/colocacion-personaje-por-referencias/SKILL.md']);
 assert.match(g.files['INSTRUCCIONES.txt'].toString(),/NO hagas colocaci/);

 const state=await h.call();assert(!JSON.stringify(state).includes(g.descriptor.token));
 h.advance();await assert.rejects(()=>h.workflow.delivery.issue(h.p),/SEG_DELIVERY_RENEW_REQUIRED/);
 const replacement=await h.workflow.delivery.issue(h.p,{renew:true});assert.notEqual(replacement.id,g.id);
 assert.equal((await h.deliver(g,await h.result())).body.error,'SEG_DELIVERY_REPLACED');
});

test('explicit renewal replaces a waiting capability without modifying its previous workspace',async t=>{
 const h=await harness(t),first=await h.grant();
 const cached=await h.workflow.delivery.package(h.p,first.id),before=await unzip(cached);
 const renewed=await h.workflow.delivery.issue(h.p,{renew:true});
 assert.notEqual(renewed.id,first.id);
 const nextFiles=await unzip(await h.workflow.delivery.package(h.p,renewed.id));
 assert.notEqual(JSON.parse(nextFiles['ENTREGA_LOCAL.json']).deliveryId,first.descriptor.deliveryId);
 assert.deepEqual(nextFiles['head.glb'],first.files['head.glb']);
 assert.deepEqual(nextFiles['body.glb'],first.files['body.glb']);
 assert.deepEqual(await unzip(cached),before);
 assert.equal((await h.deliver(first,await h.result())).body.error,'SEG_DELIVERY_REPLACED');
 assert.equal((await h.workflow.delivery.issue(h.p)).id,renewed.id,'ordinary downloads keep the current capability');
});
test('delivery imports once across lost replies, auto reports imported, and requires artist approval',async t=>{
 const h=await harness(t),g=await h.grant(),zip=await h.result();const outcomes=await Promise.all([h.deliver(g,zip),h.deliver(g,zip)]);assert(outcomes.every(o=>o.status===200));assert(outcomes.some(o=>o.body.duplicate));assert.equal(h.calls.length,1);assert.equal(h.p.segmentations.length,1);
 const state=await h.call();assert.equal(state.body.delivery.status,'imported');assert.equal(state.body.current.approval,null);assert.equal(state.body.current.groups.length,3);assert(!('faces' in state.body.current.groups[0]));
 const s=h.p.segmentations[0];assert.equal((await h.call('/approve',{id:s.id,confirm:true})).status,200);
 const price=await h.call('/budget',{part:'head'});assert.equal(price.body.budget.total,80);assert.equal(price.body.budget.rows.length,2);
 const paid=await h.call('/texture',{budgetId:price.body.budget.id,maxCredits:100,confirm:true,confirmSeparateAssets:true,acceptProvisional:true});assert.equal(paid.body.error,'SEG_STUDIO_VALIDATION_REQUIRED');assert.equal(h.p.segmentTextureRuns,undefined);
});
test('capability rejects wrong token, web origin, project/input changes and ZIP scripts',async t=>{
 const h=await harness(t),g=await h.grant(),zip=await h.result();assert.equal((await h.deliver({...g,descriptor:{token:'0'.repeat(64)}},zip)).status,401);
 assert.equal((await h.deliver(g,zip,{Origin:'https://attacker.example'})).status,403);
 h.p.notesRevision++;assert.equal((await h.deliver(g,zip)).body.error,'SEG_INPUTS_CHANGED');assert.equal(h.p.segmentations,undefined);
 await assert.rejects(()=>readSegmentationZip(awaitableDummy()),/SEG_PACKAGE_INVALID/);
 const scripted=await zipBuffers({'run.py':Buffer.from('print(1)')});await assert.rejects(()=>readSegmentationZip(scripted),/SEG_PACKAGE_INVALID/);
 function awaitableDummy(){return Buffer.from('not a zip');}
});
test('failed validation and edits during analysis never replace originals or leave staged assets',async t=>{
 const h=await harness(t),before=await fs.readdir(path.join(h.root,h.p.id)),sources=JSON.stringify(h.p.models),zip=await h.result();h.fault.error='SEG_FACE_COVERAGE';
 await assert.rejects(()=>h.workflow.importPackage(h.p,zip),/SEG_FACE_COVERAGE/);assert.deepEqual(await fs.readdir(path.join(h.root,h.p.id)),before);assert.equal(JSON.stringify(h.p.models),sources);
 h.fault.error=null;h.fault.after=async()=>{h.p.notesRevision++;};await assert.rejects(()=>h.workflow.importPackage(h.p,zip),/SEG_INPUTS_CHANGED/);assert.equal(h.p.segmentations,undefined);assert.deepEqual(await fs.readdir(path.join(h.root,h.p.id)),before);
});
test('retired merges cannot mutate history; settings still invalidate budgets and changed inputs invalidate analysis',async t=>{
 const h=await harness(t),s=await h.workflow.importPackage(h.p,await h.result());await h.call('/approve',{id:s.id,confirm:true});const price=(await h.call('/budget',{part:'head'})).body.budget;
 assert.equal((await h.call('/settings',{id:s.id,groupId:'hair',settings:{resolution:'8K',removeLighting:true}})).status,200);assert.equal((await h.call()).body.budgets.filter(b=>b.part==='head').length,0);
 assert.equal(s.proposal.groups[0].settings.resolution,'8K');const merged=await h.call('/merge',{id:s.id,groupIds:['hair','face'],name:'Head surface'});assert.equal(merged.status,410);assert.equal(h.p.segmentations.length,1);assert.equal(h.p.models.length,2);assert.equal(h.p.segmentations[0].approval.id,s.approval.id);
 h.p.groups.head.views.front.id='replacement.png';assert.equal(currentSegmentation(h.p),undefined);assert.equal((await h.call()).body.history.length,1);
});
test('artist may accept classified review regions for quotation without approving texture references',async t=>{
 const h=await harness(t),s=await h.workflow.importPackage(h.p,await h.result({pending:[{reason:'Fused region',part:'body',faces:[0]}]}));assert.equal((await h.call('/approve',{id:s.id,confirm:true})).body.error,'SEG_REVIEW_REQUIRED');
 const state=(await h.call()).body.current;assert.equal(state.review.canApprove,true);assert.equal(state.review.reviewCount,1);assert.equal(state.pending,undefined);assert.equal(state.warnings,undefined);assert.equal(state.visualReview,undefined);assert.equal(state.colored,undefined);
 s.groups[0].referencesReady=false;const approved=await h.call('/approve',{id:s.id,confirm:true,confirmReviewedRegions:true});assert.equal(approved.status,200);assert.equal(s.approval.reviewedRegions,1);assert.equal(s.pending.length,1);assert.equal(s.groups[0].referencesReady,false);assert.equal((await h.call('/budget',{part:'head'})).status,200);
 s.approval={id:'fixture-approval'};s.reconstruction={reviewRequired:true};const tex={id:'fixture-texture',group:'head',sourceModelId:h.p.groups.head.selectedModelId,fingerprint:fingerprintViewSet(h.p,'head'),segmentationId:s.id,segmentationApprovalId:s.approval.id};h.p.textures=[tex];assert(textureCurrent(h.p,tex));assert.equal(placementTexture(h.p,'head'),null);s.reconstruction.reviewRequired=false;assert.equal(placementTexture(h.p,'head'),tex);
});

test('verified hair fragments and facial details become two head groups, with changed references invalidated',async t=>{
 const h=await harness(t),groups=[...h.proposal.groups,{id:'fringe',name:'Fringe',part:'head',category:'hair',faces:[2]},{id:'mouth',name:'Mouth',part:'head',category:'facial_features',faces:[3]}];
 const s=await h.workflow.importPackage(h.p,await h.result({groups}));assert.deepEqual(h.calls,['verify','build']);assert.equal(s.groups.filter(g=>g.part==='head').length,2);assert.deepEqual(s.groups.find(g=>g.category==='hair').faces,[0,2]);assert.deepEqual(s.groups.find(g=>g.category==='skin').faces,[1,3]);assert(s.groups.filter(g=>g.part==='head').every(g=>!g.referencesReady&&Object.keys(g.references).length===0));assert(s.groups.find(g=>g.part==='body').referencesReady);
 assert.equal((await h.call('/approve',{id:s.id,confirm:true})).status,200);
 const unchanged=await h.workflow.normalizeExisting(h.p);assert.equal(unchanged.id,s.id);assert.equal(h.p.segmentations.length,1);
});

test('unclassified analysis remains unavailable for approval and spending',async t=>{
 const h=await harness(t),groups=h.proposal.groups.map(g=>({...g,category:g.id==='hair'?'unclassified':g.category}));const s=await h.workflow.importPackage(h.p,await h.result({groups}));
 assert.equal((await h.call()).body.current.review.reason,'SEG_ANALYSIS_INCOMPLETE');assert.equal((await h.call('/approve',{id:s.id,confirm:true,confirmReviewedRegions:true})).body.error,'SEG_ANALYSIS_INCOMPLETE');assert.equal(s.approval,null);
});

test('supervised analysis ZIP reuses its capability, enforces cleanup and binds the imported analysis',async t=>{
 const h=await harness(t);h.p.textureWorkflowVersion=2;
 const supervisor=await createTextureSupervisor({store:h.store,segmentation:h.workflow,refinement:{}});h.workflow.setSupervisor(supervisor);
 const g=await h.grant(),again=await h.grant();assert.deepEqual(g.files,again.files);const desc=JSON.parse(g.files['SUPERVISION_LOCAL.json']);assert.equal(desc.id,h.p.textureSupervisorId);
 assert(g.files['clean_duplicate_faces.py']);assert.equal(JSON.parse(g.files['job.json']).cleanupPolicy,'exact-duplicate-faces/v1');assert.match(g.files['FLUJO_SUPERVISADO.txt'].toString(),/wait-approval/);
 await assert.rejects(async()=>h.workflow.importPackage(h.p,await h.result()),/SEG_CLEANUP_POLICY/);
 const imported=await h.workflow.importPackage(h.p,await h.result({cleanupPolicy:'exact-duplicate-faces/v1'}));assert.equal(imported.supervisionId,desc.id);assert.equal(imported.workflowVersion,2);assert.equal(supervisor.summary(h.p).stage,'awaiting-review');assert.equal(imported.approval,null);
});

test('supervised queue downloads every group in order and stops before transfer, without duplicate paid steps',async t=>{
 const executed=[],bytes=await fs.readFile('fixtures/mannequin.glb'),provider={capabilities:()=>({supported:true}),quote:async({step})=>({source:'studio',verified:true,credits:step==='smartUV'?10:step==='texture'?20:0,conditions:'fixture',expiresAt:Date.now()+600000}),execute:async({operation})=>{executed.push(operation.groupId+':'+operation.step);return{status:'completed'};},resultBytes:async()=>bytes,recover:async()=>{throw Error('Unexpected resubmission');}};
 const h=await harness(t,provider);h.p.textureWorkflowVersion=2;const seg=await h.workflow.importPackage(h.p,await h.result({cleanupPolicy:'exact-duplicate-faces/v1'}));await h.call('/approve',{id:seg.id,confirm:true});
 const budgets=await Promise.all(['head','body'].map(async part=>(await h.call('/budget',{part})).body.budget));
 const accepted=await h.call('/accept-plan',{budgetIds:Object.fromEntries(budgets.map(b=>[b.part,b.id])),total:120,confirm:true,confirmUpload:true,autoStart:true});assert.equal(accepted.status,200);assert.equal(accepted.body.plan.workflowVersion,2);
 h.p.segmentTexturePlan.referencesReceipt={id:'validated-reference-fixture'};h.p.segmentTexturePlan.status='attention';
 assert.equal((await h.call('/resume-plan',{})).status,202);
 for(let i=0;i<100&&h.p.segmentTexturePlan.status!=='ready-to-finish';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(h.p.segmentTexturePlan.status,'ready-to-finish',h.p.segmentTexturePlan.error);assert.equal(h.p.textures,undefined);assert(!h.calls.includes('reconstruct'));
 assert.deepEqual(executed,['hair','face','outfit'].flatMap(id=>['import','smartUV','texture','download'].map(step=>id+':'+step)));
 assert.equal((await h.call('/resume-plan',{})).status,409);assert.equal(executed.length,12);assert.equal((await h.call('/reconstruct',{})).status,409);
});


test('review and immediate local head/body pricing never call Studio, even disconnected; consent waits for references',async t=>{
 let calls=0;const provider={capabilities:()=>({supported:false}),quote:async()=>{calls++;throw Error('No upload for pricing');},execute:async()=>{calls++;throw Error('No upload before references');}};
 const h=await harness(t,provider),seg=await h.workflow.importPackage(h.p,await h.result());
 await h.call('/approve',{id:seg.id,confirm:true});
 let state=(await h.call()).body;assert.equal(state.quotation.status,'completed');
 assert.deepEqual(Object.fromEntries(state.budgets.map(b=>[b.part,b.total])),{head:80,body:40});
 assert.equal((await h.call('/quote-all',{})).body.status,'completed');assert.equal(calls,0);
 state=(await h.call()).body;const budgets=Object.fromEntries(state.budgets.map(b=>[b.part,b]));
 const args={budgetIds:Object.fromEntries(Object.entries(budgets).map(([part,b])=>[part,b.id])),total:120,confirm:true,confirmUpload:true,autoStart:true};
 assert.equal((await h.call('/accept-plan',args)).body.plan.status,'waiting-references');
 assert.equal((await h.call('/accept-plan',args)).body.error,'SEG_BUSY');assert.equal(calls,0);assert.equal(h.p.segmentTextureRuns,undefined);
});

test('an unconfigured tariff fails locally without uploads or an endless pricing spinner',async t=>{
 let calls=0;const h=await harness(t,{capabilities:()=>({supported:false}),quote:async()=>{calls++;}}),seg=await h.workflow.importPackage(h.p,await h.result());
 await h.call('/approve',{id:seg.id,confirm:true});
 await h.call('/settings',{id:seg.id,groupId:'hair',settings:{resolution:'8K',removeLighting:false}});
 const result=await h.call('/quote-all',{});assert.equal(result.body.status,'attention');assert.equal(result.body.error,'SEG_LOCAL_RATE_REQUIRED');assert.equal(calls,0);
});


test('opening an old stuck price request replaces it locally without touching an approved paid plan',async t=>{
 let calls=0;const h=await harness(t,{capabilities:()=>({supported:false}),quote:async()=>{calls++;throw Error('No upload');}}),seg=await h.workflow.importPackage(h.p,await h.result());
 seg.approval={id:'previous-review'};h.p.segmentQuotation={status:'running',error:null};
 const state=(await h.call()).body;assert.equal(state.quotation.status,'completed');assert.equal(calls,0);assert.deepEqual(state.budgets.map(b=>b.total),[80,40]);
});


test('supervised plans cannot upload before Codex verifies the consent through its scoped handoff',async t=>{
 let calls=0;const h=await harness(t,{capabilities:()=>({supported:true}),quote:async()=>{calls++;throw Error('Must not call Studio');},execute:async()=>{calls++;}});
 h.p.textureWorkflowVersion=2;h.p.textureSupervisorId='bound-supervisor';const seg=await h.workflow.importPackage(h.p,await h.result({cleanupPolicy:'exact-duplicate-faces/v1'}));
 await h.call('/approve',{id:seg.id,confirm:true});const budgets=h.p.segmentBudgets;
 await h.call('/accept-plan',{budgetIds:Object.fromEntries(budgets.map(b=>[b.part,b.id])),total:120,confirm:true,confirmUpload:true,autoStart:true});
 const plan=h.p.segmentTexturePlan;assert.equal(plan.requiresSupervisor,true);plan.referencesReceipt={id:'validated'};plan.status='attention';
 await h.call('/resume-plan',{});for(let i=0;i<50&&plan.status!=='attention';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(plan.error,'SUPERVISOR_CONSENT_CHECK_REQUIRED');assert.equal(calls,0);
});

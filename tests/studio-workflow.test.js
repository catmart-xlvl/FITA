import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {Store,emptyProject} from '../server/storage.js';
import {present,snapshot,viewIds} from '../server/lineage.js';
import {validateViewSet,viewSetReady,fingerprintViewSet} from '../server/view-set.js';
import {mountStudioWorkflow} from '../server/studio-workflow.js';
import {workflowMessages,workflowText} from '../src/studio-workflow-locales.js';

const taskId='10000000-0000-4000-8000-000000000001',previousTask='10000000-0000-4000-8000-000000000002';
const observed={stage:'prepared',costLabel:'60',modelLabel:'P2.0',mode:'smart-mesh',generationCount:4,inputsVerified:true,preparationReady:true,options:{privacy:true,parts:false,texture8k:false,generationFaceLimits:[17000,20000,23000,25000]},expectedInputs:[{slot:'front',sha256:'a'.repeat(64),size:100,mimeType:'image/png'}],pageSignature:'observed-signature',snapshot:{currentTaskId:previousTask}};
test('four IDs arriving after submission bind automatically through read-only discovery, without another generation',async t=>{
 const h=await harness(t);h.state.adapter={automaticCandidatesVersion:1};const id=await h.submitted();
 const first=await h.call('/discover-candidates',{operationId:id});assert.equal(first.status,202,JSON.stringify(first.data));assert.equal(h.commands.at(-1).type,'observe');assert.equal(h.commands.at(-1).payload.discoverSubmissionId,id);
 const ids=Array.from({length:4},()=>randomUUID());h.complete(first.data.operation.id,{stage:'candidates-found',batchAssociationVerified:true,candidateTaskIds:ids});await h.call('/operation/'+first.data.operation.id);
 const submission=(await h.call('/operation/'+id)).data.operation;assert.deepEqual(submission.candidates.map(c=>c.taskId),ids);assert.equal(submission.candidateBinding,'automatic-post-submit-links');assert.equal(h.commands.filter(c=>c.type==='submit').length,1);
});
async function harness(t,options={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-workflow-'));
  const downloadsDir=path.join(root,'Downloads');await fs.mkdir(downloadsDir);
  const store=new Store(path.join(root,'data'));await store.init();
  const p=emptyProject('Test Studio workflow');
  p.reference=await store.asset(p,await fs.readFile('fixtures/body-front.png'),'png','importado');
  p.referenceRevision=1;p.referenceState={status:'ready',referenceId:p.reference.id};
  for(const group of ['head','body'])for(const view of ['front','right','back']){
    const asset=await store.asset(p,await fs.readFile(`fixtures/${group}-${view}.png`),'png','importado');
    p.groups[group].views[view]={...asset,referenceId:p.reference.id,notesRevision:0};
  }
  p.viewSetValidation=await validateViewSet(p,asset=>store.read(p,asset));
  p.viewSetValidation.humanReview={approved:true,reportId:p.viewSetValidation.id,fingerprint:p.viewSetValidation.fingerprint};
  for(const group of ['head','body'])p.groups[group].approval={id:randomUUID(),referenceId:p.reference.id,notesRevision:0,viewIds:viewIds(p,group)};
  await store.save(p);
  const operations=new Map(),commands=[],state={controlAvailable:true,preparationAvailable:true,generationAvailable:true};
  const bridge={status:()=>({...state,adapter:{nativeQuadExportVersion:1,...state.adapter}}),getOperation:id=>operations.get(id),enqueue(type,payload,context){
    const op={id:randomUUID(),type,status:'queued',context,createdAt:new Date().toISOString()};
    commands.push({id:op.id,type,payload,context});operations.set(op.id,op);return op;
  }};
  const app=express();app.use(express.json());
  const presentProject=project=>({...present(project),viewSetReady:viewSetReady(project)});
  mountStudioWorkflow(app,{store,bridge,downloadsDir,...options,editable:()=>{},gate(project,group){
    if(!viewSetReady(project,group))throw Object.assign(new Error('GATE_BLOCKED'),{status:409});
  },presentProject});
  app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  async function call(route,body,project=p){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${project.id}/studio${route}`,{
    method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),
  });return {status:response.status,data:await response.json()};}
  function complete(id,result,status='succeeded',error=null){Object.assign(operations.get(id),{result,status,error});}
  async function prepared(){const response=await call('/prepare',{group:'head',confirmUpload:true});assert.equal(response.status,202);const id=response.data.operation.id;complete(id,observed);await call('/operation/'+id);return id;}
  async function submitted({native=false}={}){const id=await prepared();const result=await call('/submit',{operationId:id,expectedCost:'60',confirmCost:true});assert.equal(result.status,202);complete(result.data.operation.id,{stage:'submitted',existingTaskIds:[previousTask],taskNeedsConfirmation:true});if(!native)delete p.studioOperations.find(o=>o.id===result.data.operation.id).sourceFormat;return result.data.operation.id;}
  return {root,downloadsDir,store,p,commands,operations,state,call,complete,prepared,submitted};
}

test('Studio preparation requires gates, explicit upload consent and authorized browser; sends only the selected three assets',async t=>{
  const h=await harness(t);
  assert.equal((await h.call('/prepare',{group:'head'})).status,409);
  assert.equal((await h.call('/prepare',{group:'invalid',confirmUpload:true})).status,400);
  h.state.preparationAvailable=false;
  assert.equal((await h.call('/prepare',{group:'head',confirmUpload:true})).status,409);
  h.state.preparationAvailable=true;
  const response=await h.call('/prepare',{group:'body',confirmUpload:true,inputs:['attacker-input']});
  assert.equal(response.status,202);
  const command=h.commands.at(-1);
  assert.equal(command.type,'prepare');
  assert.deepEqual(command.payload.inputs.map(input=>input.slot),['front','right','back']);
  for(const input of command.payload.inputs){
    const asset=h.p.groups.body.views[input.slot];
    assert.equal(input.assetId,asset.id);
    assert.deepEqual(Buffer.from(input.dataBase64,'base64'),await h.store.read(h.p,asset));
  }
  assert.equal(JSON.stringify(response.data).includes('dataBase64'),false);
  assert.equal(JSON.stringify(h.p).includes('dataBase64'),false);
  h.p.notesRevision++;
  assert.equal((await h.call('/prepare',{group:'head',confirmUpload:true})).status,409);
  assert.equal(h.commands.length,1);
});

test('one-click generation consumes the displayed quote once and derives all inputs on the server',async t=>{
  const h=await harness(t);h.state.adapter={quickGenerationVersion:1,topologySettingsVersion:1};
  const quoted=await h.call('/quote',{group:'head'}),id=quoted.data.operation.id;
  assert.deepEqual(h.commands.at(-1).payload,{configureGenerationDefaults:true,faceLimits:[17000,20000,23000,25000]});
  h.complete(id,{...observed,stage:'observed'});
  for(const body of [{confirmUpload:true,expectedCost:'60'},{confirmCost:true,expectedCost:'60'},{confirmUpload:true,confirmCost:true,expectedCost:'1'}])
    assert.equal((await h.call('/generate',{operationId:id,...body})).status,409);
  const responses=await Promise.all([1,2].map(()=>h.call('/generate',{operationId:id,expectedCost:'60',confirmUpload:true,confirmCost:true,inputs:['forged']})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[202,409]);
  const command=h.commands.at(-1);
  assert.equal(command.type,'generate');assert.equal(h.commands.filter(c=>c.type==='generate').length,1);
  assert.deepEqual(command.payload.inputs.map(i=>i.slot),['front','right','back']);
  assert.equal(responses.find(r=>r.status===202).data.operation.type,'submit');
  assert.equal(responses.find(r=>r.status===202).data.operation.includesPreparation,true);
  assert.equal(JSON.stringify(h.p).includes('dataBase64'),false);
});

test('one-click generation rejects expired quote and obsolete extension',async t=>{
  const h=await harness(t);
  assert.equal((await h.call('/quote',{group:'head'})).data.error,'STUDIO_QUICK_EXTENSION_REQUIRED');
  h.state.adapter={quickGenerationVersion:1,topologySettingsVersion:1};
  const quoted=await h.call('/quote',{group:'head'}),id=quoted.data.operation.id;
  h.complete(id,{...observed,stage:'observed'});h.p.studioOperations.find(r=>r.id===id).createdAt=new Date(Date.now()-301000).toISOString();
  assert.equal((await h.call('/generate',{operationId:id,expectedCost:'60',confirmUpload:true,confirmCost:true})).data.error,'STUDIO_QUOTE_EXPIRED');
  assert.equal(h.commands.filter(c=>c.type==='generate').length,0);
});

test('approved generation can reprepare after leaving Model while the direct submit remains blocked',async t=>{
 const h=await harness(t);h.state.adapter={quickGenerationVersion:1,topologySettingsVersion:1,generationNavigationVersion:1,supported:false};
 h.state.generationAvailable=false;
 const quote=await h.call('/quote',{group:'head'});assert.equal(quote.status,202);
 const id=quote.data.operation.id;h.complete(id,{...observed,stage:'observed'});
 assert.equal((await h.call('/generate',{operationId:id,expectedCost:'60',confirmUpload:true})).status,409);
 const approved=await h.call('/generate',{operationId:id,expectedCost:'60',confirmUpload:true,confirmCost:true});
 assert.equal(approved.status,202,JSON.stringify(approved.data));
 assert.equal(h.commands.at(-1).type,'generate');assert.equal(h.commands.at(-1).payload.expectedCost,'60');
});

test('wrong-part or missing polygon settings cannot authorize generation; server owns the four limits',async t=>{
  const h=await harness(t);h.state.adapter={quickGenerationVersion:1,topologySettingsVersion:1};
  const quote=await h.call('/quote',{group:'head',faceLimits:[500,500,500,500]}),id=quote.data.operation.id;
  assert.deepEqual(h.commands.at(-1).payload.faceLimits,[17000,20000,23000,25000]);
  for(const generationFaceLimits of [undefined,[18000,20000,22500,25000],[20000,17000,23000,25000]]){
    h.complete(id,{...observed,stage:'observed',options:{generationFaceLimits}});
    assert.equal((await h.call('/generate',{operationId:id,expectedCost:'60',confirmUpload:true,confirmCost:true})).data.error,'STUDIO_POLYGON_SETTINGS_NOT_VERIFIED');
  }
  assert.equal(h.commands.filter(c=>c.type==='generate').length,0);assert(!h.p.studioOperations.find(r=>r.id===id).consumedAt);
  h.complete(id,{...observed,stage:'observed'});h.state.adapter={quickGenerationVersion:1};
  assert.equal((await h.call('/generate',{operationId:id,expectedCost:'60',confirmUpload:true,confirmCost:true})).data.error,'STUDIO_TOPOLOGY_EXTENSION_REQUIRED');
  h.state.adapter={quickGenerationVersion:1,topologySettingsVersion:1};
  h.p.models.push({id:'head-model',group:'head',current:true});h.p.groups.head.selectedModelId='head-model';
  const body=await h.call('/quote',{group:'body'});assert.equal(body.status,202);assert.deepEqual(h.commands.at(-1).payload.faceLimits,[18000,20000,22500,25000]);
});

test('monitor exposes all confirmed thumbnails before any GLB export, without storing base64 in the project',async t=>{
  const h=await harness(t),submission=await h.submitted();
  const taskIds=Array.from({length:4},(_,i)=>`20000000-0000-4000-8000-00000000000${i}`);
  await h.call('/confirm-candidates',{operationId:submission,taskIds,confirmCandidates:true});
  const monitor=await h.call('/monitor',{operationId:submission});
  assert.deepEqual(h.commands.at(-1).payload.previewTaskIds,taskIds);
  const {default:sharp}=await import('sharp');
  const png=await sharp({create:{width:96,height:96,channels:4,background:'#aabbcc'}}).png().toBuffer();
  h.complete(monitor.data.operation.id,{stage:'ready',taskId:taskIds[0],previews:taskIds.map(taskId=>({taskId,dataBase64:png.toString('base64')}))});
  const result=await h.call('/operation/'+monitor.data.operation.id);
  assert.equal(result.data.project.models.length,0);
  const batch=result.data.project.studioOperations.find(r=>r.id===submission);
  assert.equal(batch.candidates.filter(c=>c.preview?.url).length,4);
  assert.equal(JSON.stringify(result.data).includes('dataBase64'),false);
});

test('Studio cost confirmation is exact, single-use under concurrent requests, and cannot be forged by another project',async t=>{
  const h=await harness(t),prepared=await h.prepared();
  assert.equal((await h.call('/submit',{operationId:prepared,expectedCost:'60',confirmCost:false})).status,409);
  assert.equal((await h.call('/submit',{operationId:prepared,expectedCost:60,confirmCost:true})).status,409);
  assert.equal((await h.call('/submit',{operationId:prepared,expectedCost:'30',confirmCost:true})).status,409);
  const other=emptyProject('Other');await h.store.save(other);
  assert.equal((await h.call('/operation/'+prepared,null,other)).status,404);
  const responses=await Promise.all([1,2].map(()=>h.call('/submit',{operationId:prepared,expectedCost:'60',confirmCost:true})));
  assert.deepEqual(responses.map(response=>response.status).sort(),[202,409]);
  assert.equal(h.commands.filter(command=>command.type==='submit').length,1);
  const command=h.commands.at(-1);
  assert.equal(command.payload.expectedSnapshot.pageSignature,observed.pageSignature);
  assert.deepEqual(command.payload.expectedSnapshot.expectedInputs,observed.expectedInputs,'The server must retain the file proof for the final worker recheck');
  assert.equal(command.payload.confirmCost,true);
  assert.equal(typeof command.payload.confirmationNonce,'string');
  assert.equal(JSON.stringify(h.p).includes(command.payload.confirmationNonce),false);
  h.complete(command.id,null,'unknown','lost result');
  const unknown=await h.call('/operation/'+command.id);
  assert.equal(unknown.data.operation.status,'unknown');
  assert.equal((await h.call('/submit',{operationId:prepared,expectedCost:'60',confirmCost:true})).status,409);
  assert.equal((await h.call('/prepare',{group:'body',confirmUpload:true})).status,409);
});

test('Export recovery derives one same-task download event from saved evidence, never caller hints',async t=>{
  const h=await harness(t),submission=await h.submitted();
  await h.call('/confirm-task',{operationId:submission,taskId,confirmTask:true});
  async function monitor(){const r=await h.call('/monitor',{operationId:submission});h.complete(r.data.operation.id,{stage:'ready',taskId});return r.data.operation.id;}
  const first=await h.call('/export',{operationId:await monitor()});
  const firstRecord=h.p.studioOperations.find(r=>r.id===first.data.operation.id);
  const eventStartTime=new Date(Date.parse(firstRecord.createdAt)+1000).toISOString();
  const diagnostic={observedCount:1,matchedCount:0,events:[{startTime:eventStartTime,extension:null,referrer:{origin:'https://studio.tripo3d.ai',pathname:'/'},state:'in_progress'}]};
  const result={stage:'requires_manual_import',taskId,message:JSON.stringify({downloadDiagnostics:diagnostic})};
  h.complete(firstRecord.id,result);await h.call('/operation/'+firstRecord.id);
  await h.call('/export',{operationId:await monitor(),downloadRecovery:{taskId:previousTask,eventStartTime:'attacker'}});
  assert.deepEqual(h.commands.at(-1).payload.downloadRecovery,{sourceOperationId:firstRecord.id,taskId,eventStartTime});
  diagnostic.observedCount=2;
  h.complete(firstRecord.id,{...result,message:JSON.stringify({downloadDiagnostics:diagnostic})});await h.call('/operation/'+firstRecord.id);
  await h.call('/export',{operationId:await monitor(),downloadRecovery:{taskId,eventStartTime}});
  assert.equal(h.commands.at(-1).payload.downloadRecovery,undefined);
  diagnostic.observedCount=1;diagnostic.events[0].referrer.origin='https://example.com';
  h.complete(firstRecord.id,{...result,message:JSON.stringify({downloadDiagnostics:diagnostic})});await h.call('/operation/'+firstRecord.id);
  await h.call('/export',{operationId:await monitor()});
  assert.equal(h.commands.at(-1).payload.downloadRecovery,undefined);
});

test('Changed view fingerprints prevent submitting an earlier observed price and snapshot',async t=>{
  const h=await harness(t),id=await h.prepared();
  h.p.notesRevision++;
  h.p.viewSetValidation=await validateViewSet(h.p,asset=>h.store.read(h.p,asset));
  const report=h.p.viewSetValidation;report.humanReview={approved:true,reportId:report.id,fingerprint:report.fingerprint};
  const response=await h.call('/submit',{operationId:id,expectedCost:'60',confirmCost:true});
  assert.equal(response.status,409);assert.equal(response.data.error,'STUDIO_VIEWS_CHANGED');
  assert.equal(h.commands.filter(command=>command.type==='submit').length,0);
});

test('Monitoring requires an explicitly identified new task; export imports only the proven Downloads GLB once',async t=>{
  const h=await harness(t),submission=await h.submitted();
  assert.equal((await h.call('/monitor',{operationId:submission})).status,409);
  assert.equal((await h.call('/confirm-task',{operationId:submission,taskId,confirmTask:false})).status,409);
  assert.equal((await h.call('/confirm-task',{operationId:submission,taskId:previousTask,confirmTask:true})).status,409);
  assert.equal((await h.call('/confirm-task',{operationId:submission,taskId,confirmTask:true})).status,200);
  let monitor=await h.call('/monitor',{operationId:submission});
  assert.equal(monitor.status,202);
  assert.deepEqual(h.commands.at(-1).payload,{taskId,taskConfirmed:true});
  assert.equal((await h.call('/monitor',{operationId:submission})).data.operation.id,monitor.data.operation.id,'Pending checks must not queue duplicates');
  h.complete(monitor.data.operation.id,{stage:'ready',taskId});
  await h.call('/operation/'+monitor.data.operation.id);
  const exported=await h.call('/export',{operationId:monitor.data.operation.id});
  assert.equal(exported.status,202);
  const file=path.join(h.downloadsDir,'result.glb'),bytes=await fs.readFile('fixtures/mannequin.glb');
  await fs.writeFile(file,bytes);
  h.complete(exported.data.operation.id,{stage:'exported',download:{path:file,filename:'result.glb',id:10,taskId}});
  const results=await Promise.all([1,2].map(()=>h.call('/operation/'+exported.data.operation.id)));
  assert.equal(h.p.models.length,1);
  assert.equal(results[0].data.operation.importedModelId,h.p.models[0].id);
  assert.equal(h.p.models[0].source,'Tripo Studio');
  assert.deepEqual(h.p.models[0].lineage,snapshot({...h.p,models:[]}));
  assert.deepEqual(await h.store.read(h.p,h.p.models[0]),bytes);
  assert.equal(JSON.stringify(results).includes(file),false,'Do not expose native local download paths in operation results');
  assert.equal(h.commands.filter(command=>command.type==='submit').length,1);
});

test('new submissions preserve native FBX as the original and save a derived preview once; legacy submissions keep GLB',async t=>{
 const raw=Buffer.from('; FBX 7.4.0 project file\nObjects: {}\n'),preview=await fs.readFile('fixtures/mannequin.glb');let conversions=0;
 const h=await harness(t,{convertCandidate:async bytes=>{assert.deepEqual(bytes,raw);conversions++;return {bytes:preview,report:{version:1,format:'FBX',quads:100,triangles:2,ngons:0,polygons:102}};}});
 const id=await h.submitted({native:true});assert.equal(h.p.studioOperations.find(o=>o.id===id).sourceFormat,'FBX');
 await h.call('/confirm-task',{operationId:id,taskId,confirmTask:true});const monitor=await h.call('/monitor',{operationId:id});h.complete(monitor.data.operation.id,{stage:'ready',taskId});await h.call('/operation/'+monitor.data.operation.id);
 const exported=await h.call('/export',{operationId:monitor.data.operation.id});assert.equal(exported.status,202);assert.equal(h.commands.at(-1).payload.sourceFormat,'FBX');
 const file=path.join(h.downloadsDir,'native.fbx');await fs.writeFile(file,raw);h.complete(exported.data.operation.id,{stage:'exported',download:{path:file,taskId}});
 await Promise.all([h.call('/operation/'+exported.data.operation.id),h.call('/operation/'+exported.data.operation.id)]);
 assert.equal(conversions,1);assert.equal(h.p.models.length,1);assert.equal(h.p.models[0].sourceTopology.quads,100);
 assert.deepEqual(await h.store.read(h.p,h.p.models[0].sourceTopology.asset),raw);assert.deepEqual(await h.store.read(h.p,h.p.models[0]),preview);
 assert.equal(h.commands.filter(c=>c.type==='submit').length,1);
});

test('Untrusted download paths, task mismatches and missing files do not import arbitrary local data',async t=>{
  const h=await harness(t),submission=await h.submitted();
  await h.call('/confirm-task',{operationId:submission,taskId,confirmTask:true});
  const outside=path.join(h.root,'outside.glb');await fs.copyFile('fixtures/mannequin.glb',outside);
  const bad=path.join(h.downloadsDir,'invalid.glb');await fs.writeFile(bad,'not a GLB');
  for(const download of [
    {path:outside,taskId},
    {path:bad,taskId},
    {path:bad,taskId:previousTask},
    {path:path.join(h.downloadsDir,'missing.glb'),taskId},
  ]) {
    const monitor=await h.call('/monitor',{operationId:submission});h.complete(monitor.data.operation.id,{stage:'ready',taskId});
    const exported=await h.call('/export',{operationId:monitor.data.operation.id});h.complete(exported.data.operation.id,{stage:'exported',download});
    const result=await h.call('/operation/'+exported.data.operation.id);
    assert.equal(result.data.operation.importError,'STUDIO_INVALID_GLB');
    assert.equal(h.p.models.length,0);
  }
});

test('Lost sessions can be acknowledged without resubmission, cancellation or falsely completing the remote task',async t=>{
  const h=await harness(t),id=await h.submitted();
  h.complete(id,null,'unknown','No result');await h.call('/operation/'+id);
  assert.equal((await h.call('/stop-tracking',{operationId:id,confirmStopTracking:false})).status,409);
  const closed=await h.call('/stop-tracking',{operationId:id,confirmStopTracking:true});
  assert.equal(closed.status,200);assert.equal(closed.data.operation.status,'abandoned');
  assert.equal(closed.data.operation.generationComplete,undefined);
  assert.equal(h.commands.filter(command=>command.type==='submit').length,1);
  assert.equal(h.commands.length,2,'Closing local tracking must not issue remote commands');
  assert.equal((await h.call('/prepare',{group:'body',confirmUpload:true})).status,202);
  const latest=h.commands.at(-1);
  assert.equal((await h.call('/stop-tracking',{operationId:latest.id,confirmStopTracking:true})).status,409,'Do not abandon a live command that could still click');
  h.operations.delete(latest.id);
  assert.equal((await h.call('/operation/'+latest.id)).data.operation.status,'unknown');
});

test('Studio workflow English, Spanish and Japanese catalogs preserve costs as observed',async()=>{
  assert.deepEqual(Object.keys(workflowMessages.en),Object.keys(workflowMessages.es));
  assert.deepEqual(Object.keys(workflowMessages.en),Object.keys(workflowMessages.ja));
  for(const language of ['en','es','ja']){
    assert(Object.values(workflowMessages[language]).every(Boolean));
    assert(workflowText(language,'Generate {part} · {cost}',{part:'part',cost:'60 créditos'}).includes('60 créditos'));
  }
  const source=await fs.readFile('src/StudioWorkflow.jsx','utf8');
  for(const match of source.matchAll(/\bt\('([^']+)'/g))assert(workflowMessages.en[match[1]],match[1]);
});

test('Recovery only sends file hashes and requires proven Smart Mesh inputs before a paid command',async t=>{
  const h=await harness(t);
  const response=await h.call('/recover',{group:'head'});
  assert.equal(response.status,202);
  const command=h.commands.at(-1);
  assert.equal(command.type,'observe');
  assert.deepEqual(command.payload.expectedInputs.map(i=>i.slot),['front','right','back']);
  assert(command.payload.expectedInputs.every(i=>/^[a-f0-9]{64}$/.test(i.sha256)&&i.size>0&&!i.dataBase64));
  for(const result of [{...observed,stage:'observed',mode:'hd'},{...observed,stage:'observed',generationCount:1},{...observed,stage:'observed',inputsVerified:false}]){
    h.complete(command.id,result);
    const attempt=await h.call('/submit',{operationId:command.id,expectedCost:'60',confirmCost:true});
    assert.equal(attempt.status,409);
  }
  assert.equal(h.commands.length,1,'Recovery and failed gates must not upload or generate');
  h.complete(command.id,{...observed,stage:'observed'});
  assert.equal((await h.call('/submit',{operationId:command.id,expectedCost:'60',confirmCost:true})).status,202);
});

test('A one-view part can prepare without the other part and selection changes invalidate its recovery',async t=>{
  const h=await harness(t);
  h.p.groups.head.selectedViews=['back'];
  h.p.groups.body.selectedViews=[];
  const report=await validateViewSet(h.p,a=>h.store.read(h.p,a),'head');
  report.humanReview={approved:true,reportId:report.id,fingerprint:report.fingerprint};
  h.p.viewSetValidations={head:report};
  const prepared=await h.call('/prepare',{group:'head',confirmUpload:true});
  assert.equal(prepared.status,202);
  assert.deepEqual(h.commands.at(-1).payload.inputs.map(i=>i.slot),['back']);
  assert.equal((await h.call('/prepare',{group:'body',confirmUpload:true})).status,409);
  h.complete(prepared.data.operation.id,observed);
  h.p.groups.head.selectedViews=['front'];
  assert.equal((await h.call('/submit',{operationId:prepared.data.operation.id,expectedCost:'60',confirmCost:true})).status,409);
  assert.equal(h.commands.filter(c=>c.type==='submit').length,0);
});

test('Four confirmed candidates are downloaded independently and never chosen automatically',async t=>{
  const h=await harness(t),submission=await h.submitted();
  const ids=[3,4,5,6].map(n=>`10000000-0000-4000-8000-00000000000${n}`);
  assert.equal((await h.call('/confirm-candidates',{operationId:submission,taskIds:[...ids.slice(0,3),ids[0]],confirmCandidates:true})).status,409);
  assert.equal((await h.call('/confirm-candidates',{operationId:submission,taskIds:[...ids.slice(0,3),previousTask],confirmCandidates:true})).status,409);
  assert.equal((await h.call('/confirm-candidates',{operationId:submission,taskIds:ids,confirmCandidates:true})).status,200);
  for(let index=0;index<4;index++){
    const monitored=await h.call('/monitor',{operationId:submission});assert.equal(monitored.status,202);
    assert.equal(h.commands.at(-1).payload.taskId,ids[index]);
    assert.equal(h.commands.at(-1).payload.navigateConfirmedTask,true);
    h.complete(monitored.data.operation.id,{stage:'ready',taskId:ids[index]});
    const exported=await h.call('/export',{operationId:monitored.data.operation.id});assert.equal(exported.status,202);
    const file=path.join(h.downloadsDir,`candidate-${index}.glb`);await fs.copyFile('fixtures/mannequin.glb',file);
    h.complete(exported.data.operation.id,{stage:'exported',download:{path:file,taskId:ids[index]}});
    await h.call('/operation/'+exported.data.operation.id);
    assert.equal(h.p.models[index].studioTaskId,ids[index]);
    assert.equal(h.p.models[index].candidateIndex,index);
    assert.equal(h.p.models[index].studioSubmissionId,submission);
  }
  assert.equal(h.p.models.length,4);
  assert.equal(h.p.groups.head.selectedModelId,undefined);
  assert(h.p.studioOperations.find(r=>r.id===submission).candidates.every(c=>c.status==='saved'&&c.modelId));
  assert.equal(h.commands.filter(c=>c.type==='submit').length,1);
});

test('empty verification never reports provider failures for saved models, and legacy markers recover after restart',async t=>{
 const h=await harness(t),submissionId=await h.submitted(),ids=Array.from({length:4},()=>randomUUID());
 await h.call('/confirm-candidates',{operationId:submissionId,taskIds:ids,confirmCandidates:true});
 const submission=h.p.studioOperations.find(o=>o.id===submissionId);
 for(const candidate of submission.candidates){
  const asset=await h.store.asset(h.p,await fs.readFile('fixtures/mannequin.glb'),'glb','test');
  h.p.models.push({...asset,group:'head',studioTaskId:candidate.taskId,studioSubmissionId:submissionId});candidate.modelId=asset.id;
 }
 h.state.adapter={generationFailureVersion:1};
 const verification=await h.call('/verify-candidates',{operationId:submissionId});
 h.complete(verification.data.operation.id,{stage:'observed',failureVerificationVersion:1,candidateFailures:[]});
 await h.call('/operation/'+verification.data.operation.id);
 assert.equal(submission.generationComplete,true);assert.equal(submission.generationFailuresVerifiedAt,undefined);
 assert(submission.candidates.every(c=>c.status==='saved'&&!c.error));
 const monitor=await h.call('/monitor',{operationId:submissionId,taskId:ids[0]});
 h.complete(monitor.data.operation.id,{stage:'ready',taskId:ids[0]});await h.call('/operation/'+monitor.data.operation.id);
 assert.equal(submission.candidates[0].status,'saved');
 h.complete(monitor.data.operation.id,null,'failed','STUDIO_DID_NOT_RESPOND');await h.call('/operation/'+monitor.data.operation.id);
 assert.equal(submission.candidates[0].status,'saved');assert.equal(submission.candidates[0].error,null);
 submission.generationFailuresVerifiedAt='legacy-empty-scan';submission.candidates[0].status='ready';h.operations.clear();
 await h.call('/operations');assert.equal(submission.generationFailuresVerifiedAt,undefined);
 assert(submission.candidates.every(c=>c.status==='saved'));assert.equal(h.p.models.length,4);
 assert.equal(h.commands.filter(c=>c.type==='submit').length,1);
});

test('remote failures are verified automatically by exact task identity; surviving geometry is retained and retries require a new quote',async t=>{
 const h=await harness(t),submission=await h.submitted(),ids=Array.from({length:4},()=>randomUUID());
 await h.call('/confirm-candidates',{operationId:submission,taskIds:ids,confirmCandidates:true});
 assert.equal((await h.call('/accept-partial-batch',{operationId:submission,confirmFailureReview:true})).data.error,'STUDIO_AUTOMATIC_FAILURE_VERIFICATION_REQUIRED');
 const monitor=await h.call('/monitor',{operationId:submission,taskId:ids[2]});h.complete(monitor.data.operation.id,{stage:'ready',taskId:ids[2]});
 const exported=await h.call('/export',{operationId:monitor.data.operation.id});
 const file=path.join(h.downloadsDir,'survivor.glb');await fs.copyFile('fixtures/mannequin.glb',file);h.complete(exported.data.operation.id,{stage:'exported',download:{path:file,taskId:ids[2]}});await h.call('/operation/'+exported.data.operation.id);
 const pending=await h.call('/monitor',{operationId:submission,taskId:ids[0]});
 h.complete(pending.data.operation.id,null,'failed','STUDIO_DID_NOT_RESPOND');await h.call('/operation/'+pending.data.operation.id);
 h.state.adapter={generationFailureVersion:1};const verification=await h.call('/verify-candidates',{operationId:submission});assert.equal(verification.status,202);assert.deepEqual(h.commands.at(-1).payload.verifyCandidateTaskIds,ids);
 const evidence=id=>({taskId:id,status:'failed',provider:'Tripo',code:'invalid_user_input',source:'studio-notification',observedAt:new Date().toISOString()});
 h.complete(verification.data.operation.id,{stage:'observed',failureVerificationVersion:1,candidateFailures:[evidence(randomUUID())]});await h.call('/operation/'+verification.data.operation.id);assert.equal(!!h.p.studioOperations.find(o=>o.id===submission).generationComplete,false);
 const verified=await h.call('/verify-candidates',{operationId:submission});h.complete(verified.data.operation.id,{stage:'observed',failureVerificationVersion:1,candidateFailures:[0,1,3].map(i=>evidence(ids[i]))});await h.call('/operation/'+verified.data.operation.id);
 const accepted=await h.call('/operation/'+submission);assert.equal(accepted.data.operation.generationComplete,true);
 assert.equal(accepted.data.operation.candidates.filter(c=>c.failureSource==='studio-observed').length,3);assert.equal(accepted.data.operation.candidates[2].status,'saved');assert.equal(h.p.models.length,1);assert.equal(h.p.groups.head.selectedModelId,undefined);
 assert.equal((await h.call('/monitor',{operationId:submission})).data.error,'STUDIO_BATCH_COMPLETE');assert.equal(h.commands.filter(c=>c.type==='submit').length,1);
 await h.call('/operations');const again=await h.call('/operation/'+submission);assert.equal(again.data.operation.generationFailuresVerifiedAt,accepted.data.operation.generationFailuresVerifiedAt);assert.equal(again.data.operation.candidates[0].status,'failed');
 h.state.adapter={quickGenerationVersion:1,topologySettingsVersion:1};const quote=await h.call('/quote',{group:'head'});assert.equal(quote.status,202,JSON.stringify(quote.data));assert.equal(h.commands.at(-1).type,'observe');assert.equal(h.commands.filter(c=>c.type==='submit').length,1);assert.equal(h.p.models.length,1);
 h.p.notesRevision++;assert.equal((await h.call('/verify-candidates',{operationId:submission})).status,409);
});

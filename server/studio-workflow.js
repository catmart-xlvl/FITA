import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { fingerprintViewSet, selectedViews } from './view-set.js';
import { snapshot } from './lineage.js';
import { glbBuffer } from './validation.js';
import {saveCandidatePreviews} from './candidate-previews.js';
import {generationSequenceBlocker} from '../shared/generation-sequence.js';
import {generationLimits,matchingGenerationLimits} from '../shared/generation-profile.js';
import {fbxBuffer,candidatePreview} from './candidate-topology.js';

const terminal = new Set(['succeeded','failed','unknown','abandoned']);
function fail(code, status=409) { throw Object.assign(new Error(code),{status}); }
function records(p) { return p.studioOperations ||= []; }
async function imageProof(bytes){
  const {data,info}=await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,mimeType:'image/png',width:info.width,height:info.height,
    pixelSha256:createHash('sha256').update(`${info.width}:${info.height}:`).update(data).digest('hex')};
}
function safeResult(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of ['stage','costLabel','modelLabel','options','pageSignature','snapshot','taskId','candidateTaskId','currentTaskId','taskNeedsConfirmation','existingTaskIds','progress','message','errorCode','reason','inputsVerified','preparationReady','selectedSlots','mode','generationCount','readinessErrors','expectedInputs','observedNewTaskIds','candidateTaskIds','batchAssociationVerified','candidateFailures','checkedTaskIds','failureVerificationVersion'])
    if (value[key] !== undefined) result[key] = structuredClone(value[key]);
  return result;
}
function publicRecord(record) {
  const {confirmationNonce, ...value} = record;
  return structuredClone(value);
}

function downloadRecoveryFor(project,submissionId,taskId) {
  for(const previous of [...records(project)].reverse()){
    if(previous.type!=='export'||previous.sourceOperationId!==submissionId||previous.taskId!==taskId||previous.importedModelId||previous.result?.stage!=='requires_manual_import')continue;
    try{
      const diagnostic=JSON.parse(previous.result.message).downloadDiagnostics;
      if(diagnostic?.observedCount!==1||diagnostic.events?.length!==1)continue;
      const event=diagnostic.events[0],started=Date.parse(event.startTime),created=Date.parse(previous.createdAt);
      if(!Number.isFinite(started)||!Number.isFinite(created)||started<created||started-created>180000)continue;
      if(event.referrer?.origin!=='https://studio.tripo3d.ai'||!(event.referrer.pathname==='/'||event.referrer.pathname?.endsWith(taskId)))continue;
      if(event.extension&&event.extension!=='.glb')continue;
      return {sourceOperationId:previous.id,taskId,eventStartTime:event.startTime};
    }catch{}
  }
  return null;
}

/** Mounted after the app's local-origin, CSRF and JSON middleware.
 * Browser commands are explicit, single-use operations. Persisted records contain
 * asset IDs and observed settings; image/GLB bytes never enter project manifests.
 */
export function mountStudioWorkflow(app,{store,bridge,editable,gate,presentProject,downloadsDir=path.join(os.homedir(),'Downloads'),convertCandidate=candidatePreview}) {
  const refreshes = new Map();
  function find(p,id) {
    const record = records(p).find(value=>value.id===id);
    if (!record) fail('STUDIO_OPERATION_NOT_FOUND',404);
    return record;
  }
  function current(p,record) {
    gate(p,record.group);
    if (record.fingerprint !== fingerprintViewSet(p,record.fingerprintScope==='part'?record.group:undefined)) fail('STUDIO_VIEWS_CHANGED');
  }
  function available(kind) {
    const state=bridge.status();
    if (!state.controlAvailable) fail('STUDIO_CONNECT_TAB');
    if (kind==='prepare'&&!state.preparationAvailable) fail('STUDIO_AUTHORIZE_AUTOMATION');
    if (kind==='submit'&&!state.generationAvailable) fail('STUDIO_SUBMIT_UNAVAILABLE');
    return state;
  }
  function recordCommand(p,type,payload,context) {
    if(['submit','generate'].includes(type)&&bridge.status().adapter?.nativeQuadExportVersion!==1)fail('STUDIO_QUAD_EXTENSION_RELOAD_REQUIRED');
    const operation=bridge.enqueue(type,payload,{projectId:p.id,...context});
    const record={id:operation.id,type,status:operation.status||'queued',group:context.group,
      fingerprint:context.fingerprint,fingerprintScope:context.fingerprintScope||'part',lineage:context.lineage,sourceOperationId:context.sourceOperationId||null,
      ...(context.taskId?{taskId:context.taskId,candidateIndex:context.candidateIndex}:{}),
      createdAt:operation.createdAt||new Date().toISOString(),result:null,error:null};
    if(['submit','generate'].includes(type))record.sourceFormat='FBX';
    records(p).push(record);
    return record;
  }
  async function refresh(p,record) {
    if(record.trackingClosedAt)return record;
    if (refreshes.has(record.id)) return refreshes.get(record.id);
    const operation=(async()=>{
      const batch=record.type==='submit'?record:records(p).find(r=>r.id===record.sourceOperationId);
      if(batch?.candidates?.length===4){
        const before=JSON.stringify(batch);
        for(const candidate of batch.candidates)if(candidate.modelId&&p.models.some(m=>m.id===candidate.modelId)){
          candidate.status='saved';candidate.error=null;
        }
        if(batch.candidates.every(c=>c.modelId&&p.models.some(m=>m.id===c.modelId))){
          batch.generationComplete=true;
          // Repair legacy empty-verification markers, including after a server
          // restart. Existing GLBs are stronger evidence than an empty scan.
          delete batch.generationFailuresVerifiedAt;
        }
        if(JSON.stringify(batch)!==before)await store.save(p);
      }
      const live=bridge.getOperation(record.id);
      if (!live) {
        if (!terminal.has(record.status)) {
          record.status='unknown';record.error='STUDIO_SESSION_LOST';await store.save(p);
        }
        return record;
      }
      if (live.context?.projectId && live.context.projectId!==p.id) fail('STUDIO_OPERATION_NOT_FOUND',404);
      const before=JSON.stringify(record);
      record.status=live.status;record.error=live.error||null;record.result=safeResult(live.result);
      if(live.status==='succeeded'&&live.result?.failureVerificationVersion===1&&Array.isArray(live.result.candidateFailures)){
        const submission=record.type==='submit'?record:records(p).find(r=>r.id===record.sourceOperationId);
        if(submission?.candidates?.length===4){
          for(const evidence of live.result.candidateFailures.slice(0,4)){
            const candidate=submission.candidates.find(c=>c.taskId===evidence.taskId);
            if(!candidate||candidate.modelId||evidence.provider!=='Tripo'||evidence.status!=='failed'||!['studio-task-status','studio-notification'].includes(evidence.source)||!['invalid_user_input','generation_failed'].includes(evidence.code))continue;
            candidate.previousError ||= candidate.error||null;candidate.status='failed';candidate.failureSource='studio-observed';candidate.error=evidence.code==='invalid_user_input'?'STUDIO_REMOTE_INVALID_USER_INPUT':'STUDIO_REMOTE_GENERATION_FAILED';candidate.failureEvidence=structuredClone(evidence);
          }
          if(submission.candidates.every(c=>c.modelId||c.failureSource==='studio-observed')){
            submission.generationComplete=true;
            if(submission.candidates.some(c=>!c.modelId&&c.failureSource==='studio-observed'))submission.generationFailuresVerifiedAt ||= new Date().toISOString();
          }
        }
      }
      if(live.status==='succeeded'&&live.result?.batchAssociationVerified===true){
        const submission=record.type==='submit'?record:record.discoveryFor?find(p,record.discoveryFor):null;
        if(submission&&!submission.candidates){
          const ids=live.result.candidateTaskIds,previous=[...(submission.result?.existingTaskIds||[]),...(find(p,submission.sourceOperationId).result?.snapshot?.existingTaskIds||[]),find(p,submission.sourceOperationId).result?.snapshot?.currentTaskId].filter(Boolean);
          if(!Array.isArray(ids)||ids.length!==4||new Set(ids).size!==4||ids.some(id=>!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)||previous.includes(id)))fail('STUDIO_CONFIRM_FOUR_CANDIDATES');
          submission.candidates=ids.map((taskId,index)=>({index,taskId,status:'waiting',modelId:null,error:null}));
          submission.candidatesConfirmedAt=new Date().toISOString();submission.candidateBinding='automatic-post-submit-links';
        }
      }
      if(live.status==='succeeded'&&record.type==='monitor'&&!record.previewsChecked){
        await saveCandidatePreviews({store,project:p,submission:find(p,record.sourceOperationId),previews:live.result?.previews});
        record.previewsChecked=true;
      }
      if (live.status==='succeeded'&&record.type==='monitor'&&live.result?.stage==='ready') {
        const submission=find(p,record.sourceOperationId);
        const candidate=submission.candidates?.find(c=>c.taskId===record.taskId);
        if(candidate){if(!candidate.modelId&&!candidate.failureSource)candidate.status='ready';}
        else submission.generationComplete=true;
      }
      // The user's export action also authorizes saving that result locally.
      // Never fetch arbitrary remote URLs or turn page HTML into a model.
      if (live.status==='succeeded'&&record.type==='export'&&!record.importedModelId&&!record.importError) {
        const download=live.result?.download;
        if (download?.path) {
          try {
            const submission=find(p,record.sourceOperationId);
            const taskId=record.taskId||submission.confirmedTaskId;
            if(download.taskId!==taskId||!taskId||
              typeof download.path!=='string'||!path.isAbsolute(download.path)||path.extname(download.path).toLowerCase()!==(record.sourceFormat==='FBX'?'.fbx':'.glb'))fail('STUDIO_INVALID_GLB',400);
            const [root,filename]=await Promise.all([fs.realpath(downloadsDir),fs.realpath(download.path)]);
            const relative=path.relative(root,filename);
            if(!relative||relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))fail('STUDIO_INVALID_GLB',400);
            const stat=await fs.stat(filename);
            if(!stat.isFile()||stat.size>150*1024*1024)fail('STUDIO_INVALID_GLB',400);
            const source=await fs.readFile(filename);
            const native=record.sourceFormat==='FBX'?await fbxBuffer(source):null;
            const converted=native?await convertCandidate(native):null;
            const bytes=converted?.bytes||glbBuffer(source);
            const sourceTopology=native?{asset:await store.asset(p,native,'fbx','Tripo native quad source'),...converted.report,sha256:createHash('sha256').update(native).digest('hex')}:null;
            const asset=await store.asset(p,bytes,'glb','Tripo Studio');
            const stale=record.fingerprint!==fingerprintViewSet(p,record.fingerprintScope==='part'?record.group:undefined);
            const model={...asset,label:`${record.group} · Tripo Studio`,group:record.group,
              lineage:record.lineage,studioOperationId:record.id,obsolete:stale,
              studioSubmissionId:submission.id,studioTaskId:taskId,candidateIndex:record.candidateIndex??0,
              ...(sourceTopology?{sourceTopology}:{}),
              ...(stale?{obsoleteReason:'STUDIO_PREVIOUS_REVISION'}:{})};
            p.models.push(model);record.importedModelId=model.id;
            const candidate=submission.candidates?.find(c=>c.taskId===taskId);
            if(candidate){candidate.modelId=model.id;candidate.status='saved';candidate.error=null;
              submission.generationComplete=submission.candidates.every(c=>c.modelId||c.failureSource==='studio-observed');
              if(submission.generationComplete&&submission.candidates.some(c=>c.failureSource==='studio-observed'))submission.generationFailuresVerifiedAt ||= new Date().toISOString();}
          } catch(error) {record.importError=record.sourceFormat==='FBX'?error.message:'STUDIO_INVALID_GLB';}
        } else record.importError='STUDIO_EXPORT_NOT_RETURNED';
      }
      if(record.taskId&&(record.error||record.importError)){
        const submission=records(p).find(r=>r.id===record.sourceOperationId);
        const candidate=submission?.candidates?.find(c=>c.taskId===record.taskId);
        if(candidate&&!candidate.modelId&&!candidate.failureSource){candidate.error=record.error||record.importError;candidate.status='needs-attention';}
      }
      if (JSON.stringify(record)!==before) await store.save(p);
      return record;
    })();
    refreshes.set(record.id,operation);
    try {return await operation;} finally {refreshes.delete(record.id);}
  }

  app.get('/api/projects/:id/studio/operations',async(req,res)=>{
    const p=store.get(req.params.id);
    for (const record of [...records(p)]) await refresh(p,record);
    res.json({operations:records(p).map(publicRecord)});
  });
  app.get('/api/projects/:id/studio/operation/:operationId',async(req,res)=>{
    const p=store.get(req.params.id),record=find(p,req.params.operationId);
    await refresh(p,record);
    res.json({operation:publicRecord(record),project:presentProject(p)});
  });
  app.post('/api/projects/:id/studio/quote',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);
    const group=req.body?.group;
    if(!['head','body'].includes(group))fail('STUDIO_INVALID_GROUP',400);
    const sequenceBlocker=generationSequenceBlocker(p,group);if(sequenceBlocker)fail(sequenceBlocker);
    gate(p,group);if(p.demo)fail('STUDIO_DEMO_BLOCKED');
    if(available('prepare').adapter?.quickGenerationVersion!==1)fail('STUDIO_QUICK_EXTENSION_REQUIRED');
    if(available('prepare').adapter?.topologySettingsVersion!==1)fail('STUDIO_TOPOLOGY_EXTENSION_REQUIRED');
    const record=recordCommand(p,'observe',{configureGenerationDefaults:true,faceLimits:generationLimits(group)},{group,fingerprint:fingerprintViewSet(p,group),lineage:snapshot(p)});
    record.quoteOnly=true;
    await store.save(p);res.status(202).json({operation:publicRecord(record)});
  });
  app.post('/api/projects/:id/studio/generate',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);
    const quote=find(p,req.body?.operationId);
    await refresh(p,quote);current(p,quote);
    const sequenceBlocker=generationSequenceBlocker(p,quote.group);if(sequenceBlocker)fail(sequenceBlocker);
    if(p.demo)fail('STUDIO_DEMO_BLOCKED');
    if(available('prepare').adapter?.quickGenerationVersion!==1)fail('STUDIO_QUICK_EXTENSION_REQUIRED');
    if(available('prepare').adapter?.topologySettingsVersion!==1)fail('STUDIO_TOPOLOGY_EXTENSION_REQUIRED');
    if(!quote.quoteOnly||quote.type!=='observe'||quote.status!=='succeeded'||quote.result?.mode!=='smart-mesh'||quote.result.generationCount!==4||!/^P2\.0(?:\s|$)/.test(quote.result.modelLabel||''))fail('STUDIO_COST_UNAVAILABLE');
    if(!matchingGenerationLimits(quote.group,quote.result.options?.generationFaceLimits))fail('STUDIO_POLYGON_SETTINGS_NOT_VERIFIED');
    if(quote.consumedAt)fail('STUDIO_CONFIRMATION_USED');
    if(Date.now()-Date.parse(quote.createdAt)>300000)fail('STUDIO_QUOTE_EXPIRED');
    if(req.body.confirmUpload!==true||req.body.confirmCost!==true||typeof req.body.expectedCost!=='string'||!req.body.expectedCost.trim()||req.body.expectedCost!==quote.result.costLabel)fail('STUDIO_COST_CONFIRMATION');
    if(records(p).some(r=>r.type==='submit'&&!r.trackingClosedAt&&!r.generationComplete&&r.status!=='failed'))fail('STUDIO_GENERATION_ALREADY_TRACKED');
    quote.consumedAt=new Date().toISOString();await store.save(p);
    const inputs=[];
    for(const slot of selectedViews(p,quote.group)){
      const asset=p.groups[quote.group].views[slot],bytes=await store.read(p,asset);
      inputs.push({slot,assetId:asset.id,name:`${quote.group}-${slot}.png`,...await imageProof(bytes),dataBase64:bytes.toString('base64')});
    }
    current(p,quote);
    const record=recordCommand(p,'generate',{inputs,group:quote.group,faceLimits:generationLimits(quote.group),confirmUpload:true,confirmCost:true,expectedCost:quote.result.costLabel,confirmationNonce:randomUUID()},
      {group:quote.group,fingerprint:quote.fingerprint,lineage:quote.lineage,sourceOperationId:quote.id});
    // Existing tracking/recovery associates all four results with this submission.
    record.type='submit';record.includesPreparation=true;quote.submitOperationId=record.id;
    await store.save(p);res.status(202).json({operation:publicRecord(record)});
  });
  app.post('/api/projects/:id/studio/prepare',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);
    if (p.demo) fail('STUDIO_DEMO_BLOCKED');
    const group=req.body?.group;
    if (!['head','body'].includes(group)) fail('STUDIO_INVALID_GROUP',400);
    gate(p,group);
    if (req.body.confirmUpload!==true) fail('STUDIO_UPLOAD_CONSENT');
    available('prepare');
    if (records(p).some(record=>record.type==='submit'&&!record.trackingClosedAt&&!record.generationComplete&&record.status!=='failed'))
      fail('STUDIO_GENERATION_ALREADY_TRACKED');
    const fingerprint=fingerprintViewSet(p,group),lineage=snapshot(p);
    const assets=selectedViews(p,group).map(view=>({view,asset:structuredClone(p.groups[group].views[view])}));
    const inputs=[];
    for (const {view,asset} of assets) {
      const bytes=await store.read(p,asset);
      inputs.push({slot:view,assetId:asset.id,name:`${group}-${view}.png`,...await imageProof(bytes),dataBase64:bytes.toString('base64')});
    }
    if (fingerprint!==fingerprintViewSet(p,group)) fail('STUDIO_VIEWS_CHANGED');
    const record=recordCommand(p,'prepare',{inputs,group,faceLimits:generationLimits(group)},{group,fingerprint,lineage});
    await store.save(p);res.status(202).json({operation:publicRecord(record)});
  });
  app.post('/api/projects/:id/studio/recover',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);
    const group=req.body?.group;
    if(!['head','body'].includes(group))fail('STUDIO_INVALID_GROUP',400);
    gate(p,group);if(p.demo)fail('STUDIO_DEMO_BLOCKED');available('prepare');
    if(records(p).some(r=>r.type==='submit'&&!r.trackingClosedAt&&!r.generationComplete&&r.status!=='failed'))fail('STUDIO_GENERATION_ALREADY_TRACKED');
    const fingerprint=fingerprintViewSet(p,group),lineage=snapshot(p),expectedInputs=[];
    const previous=[...records(p)].reverse().find(r=>r.group===group&&r.fingerprintScope==='part'&&r.fingerprint===fingerprint&&r.status==='succeeded'&&r.result?.preparationReady===true&&Array.isArray(r.result.expectedInputs));
    for(const slot of selectedViews(p,group)){
      const bytes=await store.read(p,p.groups[group].views[slot]);
      const proof=await imageProof(bytes);
      const prior=previous?.result.expectedInputs.find(input=>input.slot===slot&&input.sha256===proof.sha256&&input.size===proof.size&&input.mimeType===proof.mimeType);
      expectedInputs.push({slot,...proof,...(prior?.receipt?{receipt:structuredClone(prior.receipt)}:{})});
    }
    if(fingerprint!==fingerprintViewSet(p,group))fail('STUDIO_VIEWS_CHANGED');
    const record=recordCommand(p,'observe',{expectedInputs,requireReady:true},{group,fingerprint,lineage});
    await store.save(p);res.status(202).json({operation:publicRecord(record)});
  });
  app.post('/api/projects/:id/studio/submit',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);
    const prepared=find(p,req.body?.operationId);
    await refresh(p,prepared);current(p,prepared);available('submit');
    if (p.demo) fail('STUDIO_DEMO_BLOCKED');
    if (!['prepare','observe'].includes(prepared.type)||prepared.status!=='succeeded'||!['prepared','observed'].includes(prepared.result?.stage)||prepared.result?.inputsVerified!==true||prepared.result?.preparationReady!==true) fail('STUDIO_PREPARE_FIRST');
    if (prepared.consumedAt) fail('STUDIO_CONFIRMATION_USED');
    const observed=prepared.result;
    if(observed.mode!=='smart-mesh'||observed.generationCount!==4)fail('STUDIO_SMART_MESH_REQUIRED');
    if(!matchingGenerationLimits(prepared.group,observed.options?.generationFaceLimits))fail('STUDIO_POLYGON_SETTINGS_NOT_VERIFIED');
    if (typeof observed.costLabel!=='string'||!observed.costLabel.trim()||!observed.pageSignature) fail('STUDIO_COST_UNAVAILABLE');
    if (req.body.confirmCost!==true||req.body.expectedCost!==observed.costLabel) fail('STUDIO_COST_CONFIRMATION');
    prepared.consumedAt=new Date().toISOString();const confirmationNonce=randomUUID();
    await store.save(p); // A concurrent/repeated POST cannot consume this confirmation twice.
    let record;
    try {
      record=recordCommand(p,'submit',{expectedSnapshot:observed,confirmCost:true,confirmationNonce},
        {group:prepared.group,fingerprint:prepared.fingerprint,lineage:prepared.lineage,sourceOperationId:prepared.id});
      prepared.submitOperationId=record.id;
    } catch(error) {
      prepared.submitError=String(error.message||'STUDIO_SUBMIT_UNAVAILABLE');
      await store.save(p);throw error;
    }
    await store.save(p);res.status(202).json({operation:publicRecord(record)});
  });
  app.post('/api/projects/:id/studio/confirm-task',async(req,res)=>{
    const p=store.get(req.params.id),submission=find(p,req.body?.operationId);
    await refresh(p,submission);
    const taskId=req.body?.taskId;
    if(submission.type!=='submit'||submission.status!=='succeeded'||submission.result?.stage!=='submitted')fail('STUDIO_NO_TRACKED_GENERATION');
    if(req.body.confirmTask!==true||typeof taskId!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(taskId))fail('STUDIO_CONFIRM_TASK');
    const prepared=find(p,submission.sourceOperationId);
    const previous=[...(submission.result.existingTaskIds||[]),prepared.result?.snapshot?.currentTaskId].filter(Boolean);
    if(previous.includes(taskId))fail('STUDIO_TASK_ALREADY_EXISTED');
    if(submission.confirmedTaskId&&submission.confirmedTaskId!==taskId)fail('STUDIO_TASK_ALREADY_BOUND');
    submission.confirmedTaskId=taskId;submission.taskConfirmedAt=new Date().toISOString();
    await store.save(p);res.json({operation:publicRecord(submission)});
  });
  app.post('/api/projects/:id/studio/discover-candidates',async(req,res)=>{
    const p=store.get(req.params.id),submission=find(p,req.body?.operationId);await refresh(p,submission);current(p,submission);
    if(submission.type!=='submit'||submission.status!=='succeeded'||submission.result?.stage!=='submitted'||submission.trackingClosedAt)fail('STUDIO_NO_TRACKED_GENERATION');
    if(submission.candidates)return res.json({operation:publicRecord(submission),project:presentProject(p)});
    if(available('monitor').adapter?.automaticCandidatesVersion!==1)fail('STUDIO_AUTOMATIC_IDS_EXTENSION_REQUIRED');
    const pending=records(p).find(r=>r.discoveryFor===submission.id&&!terminal.has(r.status));
    if(pending)return res.status(202).json({operation:publicRecord(pending)});
    const r=recordCommand(p,'observe',{discoverSubmissionId:submission.id},{group:submission.group,fingerprint:submission.fingerprint,fingerprintScope:submission.fingerprintScope,lineage:submission.lineage,sourceOperationId:submission.id});r.discoveryFor=submission.id;
    await store.save(p);res.status(202).json({operation:publicRecord(r)});
  });
  app.post('/api/projects/:id/studio/confirm-candidates',async(req,res)=>{
    const p=store.get(req.params.id),submission=find(p,req.body?.operationId);
    await refresh(p,submission);
    if(submission.type!=='submit'||submission.status!=='succeeded'||submission.result?.stage!=='submitted')fail('STUDIO_NO_TRACKED_GENERATION');
    const taskIds=req.body?.taskIds;
    if(req.body.confirmCandidates!==true||!Array.isArray(taskIds)||taskIds.length!==4||new Set(taskIds).size!==4||taskIds.some(id=>typeof id!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)))fail('STUDIO_CONFIRM_FOUR_CANDIDATES');
    const prepared=find(p,submission.sourceOperationId);
    const previous=[...(submission.result.existingTaskIds||[]),prepared.result?.snapshot?.currentTaskId].filter(Boolean);
    if(taskIds.some(id=>previous.includes(id)))fail('STUDIO_TASK_ALREADY_EXISTED');
    if(submission.candidates&&JSON.stringify(submission.candidates.map(c=>c.taskId))!==JSON.stringify(taskIds))fail('STUDIO_TASK_ALREADY_BOUND');
    submission.candidates ||= taskIds.map((taskId,index)=>({index,taskId,status:'waiting',modelId:null,error:null}));
    submission.candidatesConfirmedAt=new Date().toISOString();
    await store.save(p);res.json({operation:publicRecord(submission),project:presentProject(p)});
  });
  app.post('/api/projects/:id/studio/stop-tracking',async(req,res)=>{
    const p=store.get(req.params.id),record=find(p,req.body?.operationId);
    await refresh(p,record);
    if(req.body.confirmStopTracking!==true)fail('STUDIO_STOP_CONSENT');
    if(!terminal.has(record.status))fail('STUDIO_COMMAND_STILL_ACTIVE');
    const submission=record.type==='submit'?record:
      ['monitor','export'].includes(record.type)?find(p,record.sourceOperationId):null;
    const targets=submission?records(p).filter(value=>value.id===submission.id||value.sourceOperationId===submission.id):[record];
    if(targets.some(value=>['queued','running'].includes(value.status)))fail('STUDIO_COMMAND_STILL_ACTIVE');
    for(const target of targets){target.previousStatus=target.status;target.status='abandoned';target.trackingClosedAt=new Date().toISOString();}
    await store.save(p);res.json({operation:publicRecord(record),project:presentProject(p)});
  });
  app.post('/api/projects/:id/studio/monitor',async(req,res)=>{
    const p=store.get(req.params.id),submission=find(p,req.body?.operationId);
    await refresh(p,submission);available('monitor');
    if (submission.type!=='submit'||submission.status!=='succeeded'||submission.result?.stage!=='submitted') fail('STUDIO_NO_TRACKED_GENERATION');
    if(submission.partialBatchAcceptedAt||submission.generationFailuresVerifiedAt)fail('STUDIO_BATCH_COMPLETE');
    const candidate=req.body?.taskId?submission.candidates?.find(c=>c.taskId===req.body.taskId&&!c.failureSource):submission.candidates?.find(c=>!c.modelId&&!c.failureSource);
    const taskId=candidate?.taskId||(!submission.candidates?submission.confirmedTaskId:null);
    if(!taskId)fail('STUDIO_CONFIRM_TASK');
    const pending=records(p).find(record=>record.type==='monitor'&&record.sourceOperationId===submission.id&&record.taskId===taskId&&!terminal.has(record.status));
    if(pending)return res.status(202).json({operation:publicRecord(pending)});
    const record=recordCommand(p,'monitor',{taskId,taskConfirmed:true,...(candidate?{navigateConfirmedTask:true,submissionId:submission.id,batchTaskIds:submission.candidates.map(c=>c.taskId),previewTaskIds:submission.candidates.filter(c=>!c.preview).map(c=>c.taskId)}:{})},
      {group:submission.group,fingerprint:submission.fingerprint,fingerprintScope:submission.fingerprintScope,lineage:submission.lineage,sourceOperationId:submission.id,taskId,candidateIndex:candidate?.index});
    if(candidate){candidate.status='checking';candidate.error=null;}
    await store.save(p);res.status(202).json({operation:publicRecord(record)});
  });
  app.post('/api/projects/:id/studio/accept-partial-batch',async(req,res)=>{
    fail('STUDIO_AUTOMATIC_FAILURE_VERIFICATION_REQUIRED');
  });
  app.post('/api/projects/:id/studio/verify-candidates',async(req,res)=>{
    const p=store.get(req.params.id),submission=find(p,req.body?.operationId);await refresh(p,submission);current(p,submission);
    if(submission.type!=='submit'||submission.status!=='succeeded'||submission.trackingClosedAt||submission.candidates?.length!==4)fail('STUDIO_NO_TRACKED_GENERATION');
    if(available('monitor').adapter?.generationFailureVersion!==1)fail('STUDIO_FAILURE_EXTENSION_REQUIRED');
    const pending=records(p).find(r=>r.verificationFor===submission.id&&!terminal.has(r.status));
    if(pending)return res.status(202).json({operation:publicRecord(pending)});
    const record=recordCommand(p,'observe',{verifyCandidateTaskIds:submission.candidates.map(c=>c.taskId),pendingTaskIds:submission.candidates.filter(c=>!c.modelId&&!c.failureSource).map(c=>c.taskId),submissionId:submission.id,scanNotifications:true},{group:submission.group,fingerprint:submission.fingerprint,fingerprintScope:submission.fingerprintScope,lineage:submission.lineage,sourceOperationId:submission.id});record.verificationFor=submission.id;
    await store.save(p);res.status(202).json({operation:publicRecord(record)});
  });
  app.post('/api/projects/:id/studio/export',async(req,res)=>{
    const p=store.get(req.params.id),monitored=find(p,req.body?.operationId);
    await refresh(p,monitored);available('export');
    if(monitored.type!=='monitor'||monitored.status!=='succeeded'||monitored.result?.stage!=='ready')fail('STUDIO_MODEL_NOT_READY');
    const submission=find(p,monitored.sourceOperationId);
    if(monitored.exportOperationId)return res.status(202).json({operation:publicRecord(find(p,monitored.exportOperationId))});
    const candidate=submission.candidates?.find(c=>c.taskId===monitored.taskId);
    const taskId=candidate?.taskId||submission.confirmedTaskId;
    if(!taskId)fail('STUDIO_CONFIRM_TASK');
    if(candidate?.modelId)fail('STUDIO_CANDIDATE_ALREADY_SAVED');
    const downloadRecovery=downloadRecoveryFor(p,submission.id,taskId);
    const nativeQuads=submission.sourceFormat==='FBX';
    if(nativeQuads&&bridge.status().adapter?.nativeQuadExportVersion!==1)fail('STUDIO_QUAD_EXTENSION_RELOAD_REQUIRED');
    const record=recordCommand(p,'export',{taskId,taskConfirmed:true,directExportTransfer:true,...(nativeQuads?{sourceFormat:'FBX'}:{}),...(candidate?{navigateConfirmedTask:true}:{}),...(downloadRecovery?{downloadRecovery}:{})},
      {group:submission.group,fingerprint:submission.fingerprint,fingerprintScope:submission.fingerprintScope,lineage:submission.lineage,sourceOperationId:submission.id,taskId,candidateIndex:candidate?.index});
    if(candidate)candidate.status='downloading';
    if(nativeQuads)record.sourceFormat='FBX';
    monitored.exportOperationId=record.id;
    await store.save(p);res.status(202).json({operation:publicRecord(record)});
  });
  return {refresh};
}

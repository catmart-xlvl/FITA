import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {glbBuffer} from './validation.js';
import {modelCurrent} from './lineage.js';
import {selectedViews,fingerprintViewSet} from './view-set.js';
import {currentSegmentation} from './segmentation-identity.js';
import {texturePreviewState,textureWorkingPreviews} from './texture-preview.js';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const terminal=new Set(['succeeded','failed','unknown']);
const sameSettings=(a,b)=>!!a&&!!b&&a.resolution===b.resolution&&typeof a.removeLighting==='boolean'&&a.removeLighting===b.removeLighting;
export function selectedSource(p,group){return p.models.find(m=>m.group===group&&m.id===p.groups[group]?.selectedModelId&&modelCurrent(p,m));}
export function textureCurrent(p,t){
 if(!t||t.sourceModelId!==selectedSource(p,t.group)?.id||t.fingerprint!==fingerprintViewSet(p,t.group))return false;
 if(t.segmentationId){const s=currentSegmentation(p);return s?.id===t.segmentationId&&s?.approval?.id===t.segmentationApprovalId;}
 return true;
}
export function currentTexture(p,group){return [...p.textures||[]].reverse().find(t=>t.group===group&&textureCurrent(p,t));}
export function placementTexture(p,group){const t=currentTexture(p,group);if(t?.refinementRequired&&!p.textureRefinements?.some(r=>r.id===t.refinementId&&!r.reviewRequired&&r.textureIds.includes(t.id)))return null;return t?.segmentationId&&currentSegmentation(p)?.reconstruction?.reviewRequired?null:t;}
export function inspectTextureGlb(bytes){
  glbBuffer(bytes);const d=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  const primitives=d.meshes.flatMap(m=>m.primitives||[]);
  if(!primitives.length||primitives.some(p=>{
    const t=d.materials?.[p.material]?.pbrMetallicRoughness?.baseColorTexture;
    const image=d.images?.[d.textures?.[t?.index]?.source];
    const uv=t?.extensions?.KHR_texture_transform?.texCoord??t?.texCoord??0;
    return !t||p.attributes?.['TEXCOORD_'+uv]===undefined||!image||(!Number.isInteger(image.bufferView)&&!image.uri?.startsWith('data:image/'));
  }))fail('TEXTURE_IMAGE_REQUIRED');
  const binOffset=20+bytes.readUInt32LE(12),binLength=binOffset+8<=bytes.length&&bytes.readUInt32LE(binOffset+4)===0x004e4942?bytes.readUInt32LE(binOffset):0;
  for(const image of d.images){
    let pixels;
    if(image.uri?.startsWith('data:image/'))pixels=Buffer.from(image.uri.split(',')[1]||'','base64');
    else {const view=d.bufferViews?.[image.bufferView];if(!view||view.buffer!==0||!Number.isInteger(view.byteLength)||view.byteLength<1||(view.byteOffset||0)<0||(view.byteOffset||0)+view.byteLength>binLength||binOffset+8+binLength>bytes.length)fail('TEXTURE_IMAGE_REQUIRED');pixels=bytes.subarray(binOffset+8+(view.byteOffset||0),binOffset+8+(view.byteOffset||0)+view.byteLength);}
    if(pixels.length<24||!(pixels.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||pixels[0]===255&&pixels[1]===216&&pixels[2]===255))fail('TEXTURE_IMAGE_REQUIRED');
  }
  return {primitives:primitives.length,images:d.images.length,verifiedBaseColor:true};
}
export function mountTextureWorkflow(app,{store,bridge,gate,editable,presentProject,downloadsDir=path.join(os.homedir(),'Downloads')}){
  const records=p=>p.textureOperations ||= [],refreshing=new Map();
  const find=(p,id)=>records(p).find(r=>r.id===id)||fail('TEXTURE_OPERATION_NOT_FOUND',404);
  const current=(p,r)=>{if(!textureCurrent(p,r))fail('TEXTURE_SOURCE_CHANGED');gate(p,r.group);};
  const scheduled=new Map(),advancing=new Set();
  function schedule(projectId,delay=2500){
    if(scheduled.has(projectId))return;
    const timer=setTimeout(()=>{scheduled.delete(projectId);void advance(projectId).catch(()=>{});},delay);timer.unref?.();scheduled.set(projectId,timer);
  }
  async function advance(projectId){
    if(advancing.has(projectId))return;advancing.add(projectId);
    try{
      const p=store.get(projectId);
      for(const r of records(p))await refresh(p,r);
      const submission=[...records(p)].reverse().find(r=>r.type==='submit'&&r.autoTrack&&!r.closedAt&&!records(p).some(e=>e.type==='export'&&e.submissionId===r.id&&e.assetId));
      if(!submission||submission.status!=='succeeded'||!submission.taskId)return;
      current(p,submission);
      const children=records(p).filter(r=>r.submissionId===submission.id),last=children.at(-1);
      if(last&&(!terminal.has(last.status)||last.error||last.importError))return;
      if(last?.type==='export')return;
      const state=bridge.status();if(!state.controlAvailable||state.pending){schedule(projectId,5000);return;}
      const type=last?.result?.stage==='ready'?'export':'monitor',parent=type==='export'?last:submission;
      const operation=enqueue(p,type,{taskId:submission.taskId,taskConfirmed:true,navigateConfirmedTask:true,directExportTransfer:true,exportRevision:submission.id,processingObserved:!!submission.processingObservedAt},parent);
      operation.taskId=submission.taskId;operation.submissionId=submission.id;await store.save(p);
    }finally{advancing.delete(projectId);}
  }
  bridge.subscribe?.(operation=>{if(operation.context?.workflow==='texture')schedule(operation.context.projectId);});
  function enqueue(p,type,payload,source){
    const op=bridge.enqueue(type,{workflow:'texture',...payload},{projectId:p.id,workflow:'texture',group:source.group});
    const r={id:op.id,type,status:op.status,createdAt:op.createdAt,group:source.group,sourceModelId:source.sourceModelId,sourceTaskId:source.sourceTaskId,fingerprint:source.fingerprint,settings:source.settings,parentId:source.id||null};records(p).push(r);return r;
  }
  async function refresh(p,r){
    if(refreshing.has(r.id))return refreshing.get(r.id);
    const work=(async()=>{
      const bindSource=()=>{
        // Studio updates the selected asset in place when generating textures.
        // This is a successful paid command against an already verified source,
        // not an arbitrary ID from asset history. Retain the same binding on restart.
        const prepared=records(p).find(o=>o.id===r.parentId);
        if(r.type==='submit'&&r.status==='succeeded'&&r.result?.stage==='submitted'&&!r.taskId&&r.result.currentTaskId===r.sourceTaskId&&prepared?.result?.preparationReady&&prepared.sourceTaskId===r.sourceTaskId){r.taskId=r.sourceTaskId;r.taskBinding='texture-on-selected-source';return true;}return false;
      };
      if(bindSource())await store.save(p);
      const live=bridge.getOperation(r.id);if(!live){if(!terminal.has(r.status)){r.status='unknown';r.error='STUDIO_SESSION_LOST';await store.save(p);}return;}
      const before=JSON.stringify(r);r.status=live.status;r.error=live.error||null;
      // Keep only known protocol data; downloads and transient URLs stay out of manifests.
      if(live.result){r.result={};for(const k of ['stage','mode','options','costLabel','pageSignature','snapshot','expectedInputs','inputsVerified','preparationReady','observedNewTaskIds','existingTaskIds','candidateTaskId','currentTaskId','taskId','processing','estimatedSeconds'])if(live.result[k]!==undefined)r.result[k]=structuredClone(live.result[k]);}
      bindSource();
      const submission=r.type==='submit'?r:records(p).find(s=>s.id===r.submissionId);
      if(submission&&r.result?.processing){
        submission.processingObservedAt ||= new Date().toISOString();
        if(!submission.estimate&&Number.isFinite(r.result.estimatedSeconds)&&r.result.estimatedSeconds>0&&r.result.estimatedSeconds<=7200)submission.estimate={seconds:r.result.estimatedSeconds,observedAt:new Date().toISOString(),source:'studio-initial-estimate'};
      }
      if(r.type==='export'&&r.status==='succeeded'&&!r.assetId&&!r.importError){
        try{
          const download=live.result?.download;if(download?.taskId!==r.taskId||typeof download.path!=='string'||!path.isAbsolute(download.path)||path.extname(download.path).toLowerCase()!=='.glb')fail('STUDIO_INVALID_GLB');
          const root=await fs.realpath(downloadsDir),filename=await fs.realpath(download.path),relative=path.relative(root,filename);
          if(!relative||relative.startsWith('..')||path.isAbsolute(relative))fail('STUDIO_INVALID_GLB');
          if((await fs.stat(filename)).size>150*1024*1024)fail('STUDIO_INVALID_GLB');
          const bytes=await fs.readFile(filename),validation=inspectTextureGlb(bytes),asset=await store.asset(p,bytes,'glb','Tripo Studio texture');
          const texture={...asset,group:r.group,sourceModelId:r.sourceModelId,sourceTaskId:r.sourceTaskId,studioTaskId:r.taskId,fingerprint:r.fingerprint,validation,settings:r.settings};
          (p.textures ||= []).push(texture);r.assetId=asset.id;
        }catch(e){r.importError=e.message;}
      }
      if(before!==JSON.stringify(r))await store.save(p);
    })();refreshing.set(r.id,work);try{await work;}finally{refreshing.delete(r.id);}
  }
  app.get('/api/projects/:id/textures',async(req,res)=>{const p=store.get(req.params.id);for(const r of records(p))await refresh(p,r);schedule(p.id);const preview=texturePreviewState(p);res.json({operations:records(p),previewPending:preview.previewPending,workingPreviews:textureWorkingPreviews(p).map(t=>({...t,current:false,preliminary:true})),textures:preview.textures.map(t=>({...t,current:textureCurrent(p,t)})),project:presentProject(p)});});
  app.post('/api/projects/:id/textures/prepare',async(req,res)=>{
    const p=store.get(req.params.id),group=req.body.group;editable(p);
    if(!['head','body'].includes(group))fail('STUDIO_INVALID_GROUP');
    if(!selectedSource(p,'head')||!selectedSource(p,'body'))fail('TEXTURE_CHOOSE_BOTH');
    gate(p,group);const model=selectedSource(p,group);if(!model?.studioTaskId)fail('TEXTURE_STUDIO_SOURCE_REQUIRED');
    if(req.body.confirmUpload!==true)fail('STUDIO_UPLOAD_CONSENT');
    const settings=req.body.settings;if(!['2K','4K','8K'].includes(settings?.resolution)||typeof settings.removeLighting!=='boolean')fail('TEXTURE_SETTINGS_NOT_VERIFIED');
    if(records(p).some(r=>r.type==='submit'&&!r.closedAt&&!records(p).some(e=>e.type==='export'&&e.submissionId===r.id&&e.assetId)))fail('TEXTURE_ALREADY_TRACKED');
    const source={group,sourceModelId:model.id,sourceTaskId:model.studioTaskId,fingerprint:fingerprintViewSet(p,group),settings:{resolution:settings.resolution,removeLighting:settings.removeLighting}},inputs=[];
    for(const slot of selectedViews(p,group)){const asset=p.groups[group].views[slot],bytes=await store.read(p,asset);inputs.push({slot,name:asset.id,mimeType:'image/png',sha256:createHash('sha256').update(bytes).digest('hex'),dataBase64:bytes.toString('base64')});}
    current(p,source);const operation=enqueue(p,'prepare',{sourceTaskId:source.sourceTaskId,settings:source.settings,inputs},source);await store.save(p);res.status(202).json({operation});
  });
  app.post('/api/projects/:id/textures/submit',async(req,res)=>{
    const p=store.get(req.params.id),r=find(p,req.body.operationId);await refresh(p,r);current(p,r);
    if(!['prepare','observe'].includes(r.type)||r.status!=='succeeded'||!r.result?.preparationReady||r.result.mode!=='texture'||r.result.snapshot?.currentTaskId!==r.sourceTaskId||!sameSettings(r.result.options?.texture,r.settings))fail('STUDIO_PREPARE_FIRST');
    if(r.consumedAt)fail('STUDIO_CONFIRMATION_USED');
    if(req.body.confirmCost!==true||!r.result.costLabel||req.body.expectedCost!==r.result.costLabel||!r.result.pageSignature)fail('STUDIO_COST_CONFIRMATION');
    r.consumedAt=new Date().toISOString();await store.save(p);
    const operation=enqueue(p,'submit',{expectedSnapshot:r.result,confirmCost:true,confirmationNonce:randomUUID()},r);operation.autoTrack=req.body.autoTrack===true;await store.save(p);res.status(202).json({operation});
  });
  app.post('/api/projects/:id/textures/quote',async(req,res)=>{
    const p=store.get(req.params.id),r=find(p,req.body.operationId);await refresh(p,r);current(p,r);
    if(!['prepare','observe'].includes(r.type)||r.status!=='succeeded'||!r.result?.preparationReady||r.consumedAt)fail('STUDIO_PREPARE_FIRST');
    const settings=req.body.settings;if(!['2K','4K','8K'].includes(settings?.resolution)||typeof settings.removeLighting!=='boolean')fail('TEXTURE_SETTINGS_NOT_VERIFIED');
    // Invalidate the previous quote before changing the provider's resolution.
    r.consumedAt=new Date().toISOString();await store.save(p);
    const operation=enqueue(p,'observe',{sourceTaskId:r.sourceTaskId,settings:{resolution:settings.resolution,removeLighting:settings.removeLighting},expectedInputs:r.result.expectedInputs,refreshTextureSettings:true},{...r,settings:{resolution:settings.resolution,removeLighting:settings.removeLighting}});
    await store.save(p);res.status(202).json({operation});
  });
  app.post('/api/projects/:id/textures/confirm-task',async(req,res)=>{
    const p=store.get(req.params.id),r=find(p,req.body.operationId);await refresh(p,r);const id=req.body.taskId;
    if(r.type!=='submit'||r.status!=='succeeded'||r.result?.stage!=='submitted'||req.body.confirmTask!==true||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id||'')||id===r.sourceTaskId||r.result.existingTaskIds?.includes(id))fail('STUDIO_CONFIRM_TASK');
    if(r.taskId&&r.taskId!==id)fail('STUDIO_TASK_ALREADY_BOUND');r.taskId=id;await store.save(p);res.json({operation:r});
  });
  for(const type of ['monitor','export'])app.post('/api/projects/:id/textures/'+type,async(req,res)=>{
    const p=store.get(req.params.id),r=find(p,req.body.operationId);await refresh(p,r);
    if(type==='monitor'&&(r.type!=='submit'||!r.taskId))fail('STUDIO_CONFIRM_TASK');
    if(type==='export'&&(r.type!=='monitor'||r.status!=='succeeded'||r.result?.stage!=='ready'))fail('STUDIO_MODEL_NOT_READY');
    const existing=records(p).find(e=>e.type===type&&e.parentId===r.id&&(type==='export'||!terminal.has(e.status)));if(existing)return res.json({operation:existing});
    const submissionId=type==='monitor'?r.id:r.submissionId;
    const submission=find(p,submissionId);current(p,submission);
    const operation=enqueue(p,type,{taskId:r.taskId,taskConfirmed:true,navigateConfirmedTask:true,directExportTransfer:true,exportRevision:submissionId,processingObserved:!!submission.processingObservedAt},r);operation.taskId=r.taskId;operation.submissionId=submissionId;await store.save(p);res.status(202).json({operation});
  });
  app.post('/api/projects/:id/textures/close',async(req,res)=>{const p=store.get(req.params.id),r=find(p,req.body.operationId);await refresh(p,r);if(req.body.confirmStopTracking!==true||!terminal.has(r.status))fail('STUDIO_COMMAND_STILL_ACTIVE');r.closedAt=new Date().toISOString();await store.save(p);res.json({operation:r});});
  for(const p of store.projects.values())if(records(p).some(r=>r.autoTrack&&!r.closedAt))schedule(p.id);
  return {advance};
}

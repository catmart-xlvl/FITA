import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {glbBuffer} from './validation.js';
import {inspectTextureGlb} from './texture-workflow.js';
import {segFail as fail} from './segmentation-files.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function studioGroupProvider(bridge,{store,pollMs=1500,pause=sleep,now=Date.now,recoveryWaitMs=20*60000}={}){
 let queue=Promise.resolve();const cache=new Map();
 const serial=fn=>{const job=queue.catch(()=>{}).then(fn);queue=job;return job;};
 const capabilities=()=>{const s=bridge.status(),supported=s.preparationAvailable===true&&s.adapter?.segmentWorkflowVersion===1&&s.adapter?.importOrientationVersion===2&&s.adapter?.uvSaveVersion===1&&s.adapter?.uvSelectionVersion===1;return {supported,requiresUvSave:true,connected:s.controlAvailable===true,reason:supported?null:'SEG_EXTENSION_RELOAD_REQUIRED'};};
 async function command(payload,context){
  const op=bridge.enqueue('segment',payload,context);const deadline=Date.now()+185000;
  while(Date.now()<deadline){bridge.status();const live=bridge.getOperation(op.id);if(live?.status==='succeeded')return live.result;if(['failed','unknown'].includes(live?.status))fail(live.error||'SEG_OPERATION_UNKNOWN');await sleep(pollMs);}
  fail('SEG_OPERATION_UNKNOWN');
 }
 function bound(project){
  async function inputs(group){return Promise.all(['front','right','back'].map(async slot=>{const asset=group.references?.[slot];if(!asset)fail('SEG_REFERENCES_REQUIRED');const bytes=await store.read(project,asset);return {slot,name:`${group.id}_${slot}.png`,mimeType:'image/png',size:bytes.length,sha256:hash(bytes),dataBase64:bytes.toString('base64')};}));}
  async function base(group){const bytes=await store.read(project,group.asset),sha256=hash(bytes);return {groupKey:hash(JSON.stringify([project.id,group.id,group.asset.id,sha256])),settings:group.settings,model:{name:`${group.id}.glb`,sha256,dataBase64:bytes.toString('base64')}};}
  async function quote({group,step,fresh=false,previous}){
   if(!capabilities().supported)return {source:'studio',verified:false,credits:null,reason:'SEG_EXTENSION_RELOAD_REQUIRED'};
   if(fresh)await inputs(group);
   if(fresh&&step==='texture'&&previous?.uvSaved!==true)fail('SEG_UV_SAVE_NOT_VERIFIED');
   const payload=await base(group),key=payload.groupKey+JSON.stringify(group.settings);let saved=cache.get(key)||(group.studioPrices?.key===key?group.studioPrices:null);
   if(fresh||!saved||saved.expiresAt<=Date.now()){
    const result=await serial(()=>command({...payload,action:'quote',step:fresh?step:null,uvOperationId:previous?.operationId},{projectId:project.id,segmentId:group.id}));
    if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(result.taskId||''))fail('SEG_IMPORT_UNCERTAIN');
    if(result.settings?.resolution!==group.settings.resolution||result.settings?.removeLighting!==group.settings.removeLighting)fail('TEXTURE_SETTINGS_NOT_VERIFIED');
    saved={...result,prices:{...saved?.prices,...result.prices},expiresAt:Date.now()+10*60000};cache.set(key,saved);
    group.studioImport={groupKey:payload.groupKey,taskId:result.taskId,sha256:payload.model.sha256};group.studioPrices={...saved,key};await store.save(project);
   }
   const raw=saved.prices?.[step],credits=/^\d+(?:[.,]\d+)?$/.test(raw||'')?Number(raw.replace(',','.')):NaN;
   if(!Number.isFinite(credits)||credits<0)fail('SEG_PRICE_PENDING');
   return {source:'studio',verified:true,credits,costLabel:raw,taskId:saved.taskId,conditions:JSON.stringify({step,settings:group.settings,model:payload.model.sha256}),expiresAt:saved.expiresAt};
  }
  async function recoverOnce({operation,group,previous}){
   const payload=await base(group),taskId=operation.targetTaskId||operation.receipt?.taskId||group.studioImport?.taskId,result=await serial(()=>command({...payload,action:operation.step==='download'?'download':'recover',operationId:operation.id,recoveryStep:operation.step,textureOperationId:operation.step==='download'?previous?.operationId:undefined,optimizeUV:operation.optimizeUV===true,taskId},{projectId:project.id,segmentId:group.id}));return {...result.receipt,operationId:operation.id};
  }
  async function waitRecorded(receipt,context){
   const until=now()+recoveryWaitMs;
   while(receipt.status==='running'&&now()<until){
    await pause(Math.min(3000,until-now()));
    receipt=await recoverOnce(context);
   }
   return receipt;
  }
  async function recover(context){return waitRecorded(await recoverOnce(context),context);}
  async function execute({operation,group,previous,expectedQuote}){
   const payload=await base(group),taskId=operation.targetTaskId||previous?.taskId||group.studioImport?.taskId;
   const value={...payload,action:operation.step,operationId:operation.id,taskId};
   if(operation.step==='texture'){
    if(previous?.uvSaved!==true)fail('SEG_UV_SAVE_NOT_VERIFIED');
    value.uvOperationId=previous.operationId;value.inputs=await inputs(group);
   }
   if(['smartUV','texture'].includes(operation.step)){value.expectedCost=expectedQuote.costLabel;value.confirmCost=true;}
   if(operation.step==='download')value.textureOperationId=previous?.operationId;
   const result=await serial(()=>command(value,{projectId:project.id,segmentId:group.id}));let receipt={...result.receipt,operationId:operation.id};
   // Submission and recovery use the same bounded wait for an existing receipt.
   // A slow recovered UV run is still running, not an unknown new submission.
   return waitRecorded(receipt,{operation,group,previous});
  }
  return {capabilities,quote,execute,recover,resultBytes};
 }
 async function resultBytes(receipt){
  const filename=receipt?.download?.path,folders=['FITA','LocalWorkbench'].map(name=>path.join(os.homedir(),'Downloads',name));
  if(typeof filename!=='string'||!folders.includes(path.dirname(path.resolve(filename)))||!filename.endsWith('.glb'))fail('SEG_DOWNLOAD_INCOMPLETE');
  const stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32*1024*1024)fail('SEG_DOWNLOAD_INCOMPLETE');
  const bytes=glbBuffer(await fs.readFile(filename));inspectTextureGlb(bytes);return bytes;
 }
 return {capabilities,forProject:bound,resultBytes,quote:async()=>({source:'studio',verified:false,credits:null,reason:'SEG_EXTENSION_RELOAD_REQUIRED'}),execute:async()=>fail('SEG_EXTENSION_RELOAD_REQUIRED'),recover:async()=>null,
  inspect:()=>serial(()=>command({action:'inspect',groupKey:'0'.repeat(64)},{}))};
}

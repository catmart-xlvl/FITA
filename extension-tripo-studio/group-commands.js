import {exportRecoveryDiagnostic} from './export-recovery-diagnostic.js';
import {studioGroupControl,observeGroupStudio,controlImportOrientation} from './group-adapter.js';
import {observeStudioDocument,selectStudioTextureSettings,exportStudioControl} from './studio-adapter.js';
import {navigateStudioTask,navigateStudioModelWorkspace} from './studio-navigation.js';
import {studioUvSaveControl} from './smart-uv-save.js';
import {studioUvCandidatesControl,optimizeUvCandidates} from './uv-candidates.js';
import {textureTiming} from './batch-capture.js';
import {uvRecoveryDiagnostic} from './uv-recovery-diagnostic.js';
import {recoverUvResultView} from './uv-result-recovery.js';
export function createGroupCommands({chrome,runInTab,pause,legacy,exportGlb,importMesh,now=Date.now,workerRevision=null}){
 return async function execute(bridge,command){
  const p=command.payload||{},key='workbenchGroup:'+p.groupKey,opKey='workbenchGroupOperation:'+p.operationId;
  if(!/^[a-f0-9]{64}$/.test(p.groupKey||''))throw Error('SEG_GROUP_KEY_REQUIRED');
  const get=async k=>(await chrome.storage.local.get(k))[k],set=async(k,v)=>chrome.storage.local.set({[k]:v});
  const read=()=>runInTab(bridge,observeGroupStudio),control=arg=>runInTab(bridge,studioGroupControl,[arg]);
  async function finishPendingOrientation(){
   if(!(await runInTab(bridge,controlImportOrientation,[{}])).present)return;
   // A renewed quote starts with earlier pieces. Recover the extension's one
   // outstanding upload before navigating away from its angle preview.
   const saved=await chrome.storage.local.get(null);
   const pending=Object.entries(saved).filter(([k,v])=>/^workbenchGroup:[a-f0-9]{64}$/.test(k)&&v?.state==='uploading'&&Array.isArray(v.beforeIds)&&/^[a-f0-9]{64}$/.test(v.sha256||'')&&(v.tabId==null||v.tabId===bridge.tabId));
   if(pending.length!==1)throw Error('SEG_IMPORT_OTHER_UPLOAD_PENDING');
   const [pendingKey,receipt]=pending[0];
   await execute(bridge,{payload:{action:'import',recoveryOnly:true,groupKey:pendingKey.slice('workbenchGroup:'.length),model:{sha256:receipt.sha256}}});
  }
  const navigate=(taskId,workflow)=>navigateStudioTask({chrome,runInTab,pause,bridge},taskId,workflow);
  async function downloadGroup(receipt){
   if(!receipt){
    const texture=await get('workbenchGroupOperation:'+p.textureOperationId);
    if(texture?.status!=='completed'||texture.step!=='texture'||texture.groupKey!==p.groupKey||texture.taskId!==p.taskId)throw Error('SEG_TEXTURE_RECEIPT_REQUIRED');
    receipt={status:'running',step:'download',groupKey:p.groupKey,taskId:p.taskId,credits:0,textureOperationId:p.textureOperationId};
    await set(opKey,receipt);
   }
   await navigate(receipt.taskId,'texture');
   let result;
   for(let attempt=0;attempt<2;attempt++){
    result=await exportGlb(bridge,receipt.taskId,{operationId:command.id,directExportTransfer:true,exportRevision:receipt.textureOperationId,captureWaitSeconds:attempt?60:90});
    // The native exporter checks its durable causal receipt and browser events
    // before re-exporting. A slow/lost capture can use that same free recovery
    // once automatically, inside the command deadline, without another paid step.
    if(result.stage==='exported'||result.reason!=='EXPORT_CAPTURE_TIMEOUT')break;
   }
   if(result.stage!=='exported')throw Error(result.reason||result.message||'SEG_DOWNLOAD_INCOMPLETE');
   Object.assign(receipt,{status:'completed',download:result.download});await set(opKey,receipt);
   try{await runInTab(bridge,exportStudioControl,[{step:'close',taskId:receipt.taskId}]);}catch(error){receipt.cleanupWarning=error.message;await set(opKey,receipt);}
   return {stage:'exported',receipt};
  }
  async function requireSavedUv(taskId){
   if(!/^[0-9a-f-]{36}$/i.test(p.uvOperationId||''))throw Error('SEG_UV_SAVE_NOT_VERIFIED');
   const uv=await get('workbenchGroupOperation:'+p.uvOperationId);
   if(uv?.step!=='smartUV'||uv.groupKey!==p.groupKey||uv.taskId!==taskId||uv.status!=='completed'||uv.uvSaved!==true)throw Error('SEG_UV_SAVE_NOT_VERIFIED');
  }
  async function recoverUv(receipt){
   await navigate(receipt.taskId,'smart-uv');
   const inspect=()=>runInTab(bridge,studioUvSaveControl,[{taskId:receipt.taskId}]);
   let state=await inspect();
   if(p.optimizeUV===true&&state.pending&&receipt.uvSaved===true){receipt.uvSaved=false;receipt.saveAttempted=false;receipt.saveAttempts=0;receipt.lastSaveAttemptAt=null;receipt.uvSelection=null;}
   if(p.optimizeUV===true)receipt.uvSelectionVersion=1;
   if(receipt.uvSaved===true&&!state.pending)return {stage:'ready',receipt};
   if(!state.pending&&!receipt.saveAttempted){
    if(receipt.status==='completed')throw Error('SEG_UV_SAVE_NOT_VERIFIED');
    if(state.generateEnabled&&receipt.processingObserved){
     state=await recoverUvResultView({receipt,state,bridge,read,inspect,now,pause,persist:()=>set(opKey,receipt),getTab:chrome.tabs?.get?id=>chrome.tabs.get(id):undefined,reload:chrome.tabs?.reload?id=>chrome.tabs.reload(id):undefined});
     if(!state.pending)return {stage:'processing',receipt};
    }else{
     if(state.busy){receipt.processingObserved=true;await set(opKey,receipt);}
     return {stage:'processing',receipt};
    }
   }
   receipt.status='running';receipt.groupKey=p.groupKey;receipt.uvSaveVersion=1;
   if(state.pending&&receipt.uvSelectionVersion===1&&!receipt.saveAttempted){
    const complete=await optimizeUvCandidates({receipt,now,pause,persist:()=>set(opKey,receipt),inspect:()=>runInTab(bridge,studioUvCandidatesControl,[{taskId:receipt.taskId}]),act:input=>runInTab(bridge,studioUvCandidatesControl,[{taskId:receipt.taskId,...input}])});
    if(!complete)return {stage:'processing',receipt};
    state=await inspect();
   }
   let stable=0;
   for(let i=0;i<80;i++){
    if(state.blockingDialog)throw Error('CLOSE_OTHER_DIALOGS_FIRST');
    if(state.pending){
     stable=0;receipt.resultObserved=true;
     if(state.saveEnabled&&(!receipt.lastSaveAttemptAt||now()-receipt.lastSaveAttemptAt>=5000)){
      if((receipt.saveAttempts||0)>=3)throw Error('SEG_UV_SAVE_NOT_VERIFIED');
      // Persist before the free Save click. A lost reply resumes verification,
      // never Generate UV. Retry only the still-pending result of this asset.
      receipt.saveAttempted=true;receipt.saveAttempts=(receipt.saveAttempts||0)+1;receipt.lastSaveAttemptAt=now();await set(opKey,receipt);
      await runInTab(bridge,studioUvSaveControl,[{taskId:receipt.taskId,action:'save'}]);
     }
    }else if(receipt.saveAttempted&&state.generateEnabled&&!state.busy){
     const current=await read();
     if(current.taskId!==receipt.taskId)throw Error('CONFIRMED_TASK_CHANGED');
     if(!current.unsavedChanges&&current.uv.downloadReady)stable++;else stable=0;
     if(stable>=3){
      receipt.status='completed';receipt.uvSaved=true;receipt.savedAt=now();await set(opKey,receipt);
      return {stage:'ready',receipt};
     }
    }else stable=0;
    await pause(500);state=await inspect();
   }
   await set(opKey,receipt);return {stage:'processing',receipt};
  }
  async function imported(){
   let receipt=await get(key);
   if(receipt&&receipt.sha256!==p.model?.sha256)throw Error('SEG_IMPORT_SOURCE_CHANGED');
   if(receipt?.taskId)return receipt;
   if(receipt&&(receipt.state!=='uploading'||!Array.isArray(receipt.beforeIds)))throw Error('SEG_IMPORT_UNCERTAIN');
   if(receipt?.tabId!=null&&receipt.tabId!==bridge.tabId)throw Error('SEG_IMPORT_TAB_CHANGED');
   let recoveryCount=receipt?.recoveryCount||0;
   async function readyForImport(){
    let state=await read();
    if(state.importAvailable===false&&!state.importBusy&&!state.importFileCount){
     if((await runInTab(bridge,controlImportOrientation,[{}])).present)throw Error('SEG_IMPORT_OTHER_UPLOAD_PENDING');
     state=await navigateStudioModelWorkspace({chrome,runInTab,pause,bridge});
    }
    const previousTaskId=state.taskId;
    // After export Studio can leave an empty canvas while its route still
    // identifies the previous asset. Do not send a file into that stale page.
    if(state.taskId&&state.modelReady===false&&!state.importBusy&&!state.importFileCount){
     for(let i=0;i<20&&state.modelReady===false;i++){await pause(250);state=await read();if(state.taskId!==previousTaskId)throw Error('CONFIRMED_TASK_CHANGED');}
     if(state.modelReady===false){
      if((receipt?.pageReloads||0)>=1||!chrome.tabs?.reload)throw Error('SEG_IMPORT_PAGE_NOT_READY');
      if(state.importBusy||state.importFileCount||(await runInTab(bridge,controlImportOrientation,[{}])).present)throw Error('SEG_IMPORT_PAGE_NOT_READY');
      receipt||={state:'uploading',beforeIds:[...new Set([state.taskId,...state.links.map(l=>l.taskId)].filter(Boolean))],sha256:p.model?.sha256,tabId:bridge.tabId,recoveryCount,createdAt:now(),importRecoveryVersion:3};
      receipt.pageReloads=(receipt.pageReloads||0)+1;await set(key,receipt);
      await chrome.tabs.reload(bridge.tabId);
      for(let i=0;i<120;i++){await pause(250);try{state=await read();}catch{continue;}if(state.taskId!==previousTaskId)throw Error('CONFIRMED_TASK_CHANGED');if(state.modelReady===true)break;}
      if(state.modelReady!==true)throw Error('SEG_IMPORT_PAGE_NOT_READY');
     }
    }
    return state;
   }
   async function dispatch({retry=false,migrate=false}={}){
    const before=await readyForImport();if(!before.importAvailable)throw Error('SEG_IMPORT_CONTROL_REQUIRED');
    if((await runInTab(bridge,controlImportOrientation,[{}])).present)throw Error('SEG_IMPORT_OTHER_UPLOAD_PENDING');
    if(retry)recoveryCount++;
    const history=receipt?.dispatchHistory||[];
    if(receipt)history.push({createdAt:receipt.createdAt??null,recoveryCount:receipt.recoveryCount||0,version:receipt.importRecoveryVersion??null,dispatch:receipt.dispatch||null,error:receipt.dispatchError||null});
    receipt={state:'uploading',beforeIds:[...new Set([...(receipt?.beforeIds||[]),...before.links.map(l=>l.taskId),...(before.taskId?[before.taskId]:[])])],sha256:p.model?.sha256,tabId:bridge.tabId,recoveryCount,importRecoveryVersion:3,createdAt:now(),pageReloads:receipt?.pageReloads||0,legacyRecovered:migrate||receipt?.legacyRecovered===true,dispatchHistory:history};
    await set(key,receipt);
    try{
     if(importMesh)await importMesh(bridge,{model:p.model,receipt,persist:()=>set(key,receipt),previousTaskId:before.taskId||null});
     else await control({action:'import',model:p.model});
    }catch(error){
     if(!['STUDIO_DID_NOT_RESPOND','SEG_IMPORT_DISPATCH_UNCERTAIN'].includes(error.message))throw error;
     // Observe the existing upload after a lost acknowledgement. Its result or
     // orientation can still appear; do not exit straight into a second upload.
     receipt.dispatchError=error.message;await set(key,receipt);
    }
   }
   if(!receipt){if(p.recoveryOnly||p.action==='recover')throw Error('SEG_IMPORT_UNCERTAIN');await dispatch();}
   let waitingSince=now();
   let prior=null,orientationSeen=receipt.orientationSeen===true,lastOrientationClick=now();
   for(let i=0;i<160;i++){
    await pause(500);let state;try{state=await read();}catch{continue;}
    const orientation=await runInTab(bridge,controlImportOrientation,[{}]);
    if(orientation.present){
     orientationSeen=true;
     if(!receipt.orientationSeen){receipt.orientationSeen=true;await set(key,receipt);}
     if(receipt.orientationPanelId&&orientation.panelId!==receipt.orientationPanelId)throw Error('SEG_IMPORT_ORIENTATION_CHANGED');
     if(orientation.confirmClicks>=3&&now()-lastOrientationClick>=3000)throw Error('SEG_IMPORT_ORIENTATION_STUCK');
     // A previous lost click reply is recoverable only when this adapter can
     // observe the same pending panel and its bounded DOM click counter.
     const retry=receipt.orientationAttempted&&orientation.panelId&&Number.isInteger(orientation.confirmClicks)&&orientation.confirmClicks<3&&now()-lastOrientationClick>=3000;
     if(orientation.enabled&&(!receipt.orientationAttempted||retry)){
      // Persist BEFORE click. Recovery observes this free panel before acting.
      receipt.orientationAttempted=true;receipt.orientationPanelId=orientation.panelId;await set(key,receipt);
      const confirmation=await runInTab(bridge,controlImportOrientation,[{confirm:true,panelId:orientation.panelId}]);
      lastOrientationClick=now();
      // A re-render can disable/remove Confirm between inspection and click.
      // Retry only a reply that proves no click occurred; a lost reply stays uncertain.
      if(confirmation.confirmed===false&&!orientation.confirmClicks){receipt.orientationAttempted=false;await set(key,receipt);}
      prior=null;continue;
     }
    }
    // A preview URL may appear before Confirm has completed. It is not an import receipt.
    if(orientation.present){prior=null;continue;}
    const old=(await get(key)).beforeIds,ids=[...new Set([state.taskId,...state.links.map(l=>l.taskId)].filter(id=>id&&!old.includes(id)))];
    if(ids.length>1)throw Error('SEG_IMPORT_RESULT_AMBIGUOUS');
    if(ids.length===1&&ids[0]===state.taskId&&prior===ids[0]){receipt={...receipt,state:'imported',taskId:ids[0],sha256:p.model.sha256};await set(key,receipt);return receipt;}prior=ids.length===1?ids[0]:null;
    // Ten seconds is a checkpoint, not proof of failure. Restart only a free
    // upload whose UI is empty and idle, with no identifiable imported result.
    const possibleResult=ids.length===1&&ids[0]===state.taskId;
    const abandonedLegacy=!receipt.importRecoveryVersion&&receipt.createdAt&&now()-receipt.createdAt>=185000;
    // One migration for the old discarded-async-reply bug, only for this same
    // recovered free import after an idle observation window. Never clear its
    // counter/history, an observed preview, or any paid operation receipt.
    const recoverDiscardedV2=receipt.importRecoveryVersion===2&&p.action==='recover'&&p.recoveryStep==='import'&&!receipt.legacyRecovered&&!receipt.orientationAttempted&&state.modelReady===true&&receipt.createdAt&&now()-receipt.createdAt>=185000;
    if(!p.recoveryOnly&&now()-waitingSince>=10000&&ids.length===0&&!possibleResult&&!orientationSeen&&(!receipt.orientationAttempted||abandonedLegacy)&&state.importAvailable&&state.importFileCount===0&&state.importBusy===false){
     if(recoveryCount>=1&&!abandonedLegacy&&!recoverDiscardedV2)throw Error('SEG_IMPORT_RETRY_EXHAUSTED');
     await dispatch({retry:true,migrate:recoverDiscardedV2});waitingSince=now();prior=null;
    }
   }
   throw Error(orientationSeen?'SEG_IMPORT_ORIENTATION_STUCK':'SEG_IMPORT_UNCERTAIN');
  }
  async function textureSettings(taskId){
   await navigate(taskId,'texture');
   for(let i=0;i<30;i++){
    const s=await runInTab(bridge,observeStudioDocument);
    if(s.currentTaskId!==taskId||s.blockingDialog)throw Error('CONFIRMED_TASK_CHANGED');
    if(s.options?.texture?.resolution===p.settings.resolution&&s.options.texture.removeLighting===p.settings.removeLighting&&s.costLabel)return s;
    await runInTab(bridge,selectStudioTextureSettings,[p.settings]);await pause(250);
   }
   throw Error('TEXTURE_SETTINGS_NOT_VERIFIED');
  }
  async function uvPrice(taskId){
   await navigate(taskId,'smart-uv');
   // A new import can expose its workspace before Studio has loaded its price.
   let stablePrice=null,stableReads=0;
   for(let i=0;i<360;i++){
    const state=await read();
    if(state.taskId&&state.taskId!==taskId||state.workflow&&state.workflow!=='smart-uv')throw Error('CONFIRMED_TASK_CHANGED');
    const price=state.taskId===taskId&&state.workflow==='smart-uv'?state.uv?.costLabel:null;
    if(price&&/^\d+(?:[.,]\d+)?$/.test(price)){
     if(price===stablePrice)stableReads++;else{stablePrice=price;stableReads=1;}
     if(stableReads>=3)return price;
    }else{stablePrice=null;stableReads=0;}
    await pause(250);
   }
   throw Error('SEG_PRICE_PENDING');
  }
  if(p.action==='inspect'){
   const snapshot=await read();let orientation;
   try{orientation=await runInTab(bridge,controlImportOrientation,[{}]);}catch(error){orientation={present:null,error:error.message};}
   const saved=await chrome.storage.local.get(null);
   const pendingImports=Object.entries(saved).filter(([k,v])=>/^workbenchGroup:[a-f0-9]{64}$/.test(k)&&v?.state==='uploading').map(([k,v])=>({groupKey:k.slice('workbenchGroup:'.length),state:v.state,tabId:v.tabId??null,recoveryCount:v.recoveryCount||0,orientationAttempted:v.orientationAttempted===true,orientationSeen:v.orientationSeen===true,importRecoveryVersion:v.importRecoveryVersion??null,createdAt:v.createdAt??null,beforeIds:v.beforeIds||[]}));
   const uvCandidates=snapshot.workflow==='smart-uv'?await runInTab(bridge,studioUvCandidatesControl,[{taskId:snapshot.taskId,diagnostic:true}]):null;
   const importHistory=Object.entries(saved).filter(([k,v])=>/^workbenchGroup:[a-f0-9]{64}$/.test(k)&&v?.importRecoveryVersion===3).map(([k,v])=>({groupKey:k.slice('workbenchGroup:'.length),state:v.state,taskId:v.taskId??null,recoveryCount:v.recoveryCount||0,pageReloads:v.pageReloads||0,legacyRecovered:v.legacyRecovered===true,dispatch:v.dispatch||null,dispatchHistory:v.dispatchHistory||[]}));
   return {stage:'observed',workerRevision,importRecoveryVersion:3,pendingImports,importHistory,uvOperations:uvRecoveryDiagnostic(saved,snapshot.taskId),lastScriptFailure:saved.workbenchLastScriptFailure||null,exportDownloads:await exportRecoveryDiagnostic(saved,snapshot.taskId,chrome.downloads?.search?query=>chrome.downloads.search(query):null),snapshot:{...snapshot,orientation},uvCandidates,diagnostic:await runInTab(bridge,observeStudioDocument,[{includeLayoutDiagnostic:true}])};
  }
  if(p.action==='quote'){
   await finishPendingOrientation();
   const item=await imported(),prices={};
   if(!p.step||p.step==='smartUV')prices.smartUV=await uvPrice(item.taskId);
   if(p.step==='texture')await requireSavedUv(item.taskId);
   if(!p.step||p.step==='texture'){const texture=await textureSettings(item.taskId);prices.texture=texture.costLabel;}
   return {stage:'observed',taskId:item.taskId,prices,settings:p.settings};
  }
  async function importResult(){
   const receipt={status:'completed',...(await imported()),step:'import',groupKey:p.groupKey,credits:0};
   if(/^[0-9a-f-]{36}$/.test(p.operationId||''))await set(opKey,receipt);
   return {stage:'ready',receipt};
  }
  if(p.action==='import')return importResult();
  if(!/^[0-9a-f-]{36}$/.test(p.operationId||''))throw Error('SEG_OPERATION_MISSING');
  let receipt=await get(opKey);
  if(p.action==='recover'){
   // Imports have a second durable record under their immutable source group.
   // Recover that record when a lost reply predates the operation receipt.
   if(!receipt&&p.recoveryStep==='import')return importResult();
   // Only a download positively identified by the local queue may be recovered
   // without a receipt. A completed texture of this exact group/task is required.
   if(!receipt&&p.recoveryStep==='download')return downloadGroup(null);
   if(!receipt)return {stage:'unknown',receipt:{status:'unknown'}};
   if(receipt.groupKey&&receipt.groupKey!==p.groupKey||p.taskId&&receipt.taskId!==p.taskId)throw Error('CONFIRMED_TASK_CHANGED');
   if(receipt.step==='smartUV'&&receipt.clicked&&(receipt.uvSaved!==true||p.optimizeUV===true))return recoverUv(receipt);
   if(receipt.status==='completed')return {stage:'ready',receipt};
   if(receipt.step==='download')return downloadGroup(receipt);
   if(!receipt.clicked)return {stage:'unknown',receipt:{...receipt,status:'unknown'}};
   if(receipt.step==='texture'){
    await navigate(receipt.taskId,'texture');const state=await runInTab(bridge,observeStudioDocument),timing=textureTiming(state,receipt.taskId);
    if(timing.processing){receipt.processingObserved=true;await set(opKey,receipt);}
    if(receipt.processingObserved&&!timing.processing&&state.modelReady){receipt.status='completed';await set(opKey,receipt);}
   }
   return {stage:receipt.status==='completed'?'ready':'processing',receipt};
  }
  if(receipt){
   if(receipt.groupKey&&receipt.groupKey!==p.groupKey||p.taskId&&receipt.taskId!==p.taskId)throw Error('CONFIRMED_TASK_CHANGED');
   if(receipt.step==='smartUV'&&receipt.clicked&&receipt.uvSaved!==true)return recoverUv(receipt);
   if(receipt.step==='download'&&receipt.status!=='completed')return downloadGroup(receipt);
   return {stage:receipt.status==='completed'?'ready':'processing',receipt};
  }
  if(p.action==='smartUV'){
   const state=await navigate(p.taskId,'smart-uv');
   if(state.uv.costLabel!==p.expectedCost||!state.uv.enabled)throw Error('SEG_PRICE_CHANGED');
   receipt={status:'unknown',step:'smartUV',groupKey:p.groupKey,taskId:p.taskId,credits:Number(p.expectedCost),downloadWasDisabled:!state.uv.downloadReady,uvSaveVersion:1,uvSelectionVersion:1,uvSaved:false,clicked:false};await set(opKey,receipt);
   await control({action:'submitUV',taskId:p.taskId,expectedCost:p.expectedCost});
   receipt.clicked=true;receipt.status='running';await set(opKey,receipt);await pause(500);
   const after=await read();if(after.taskId===p.taskId&&!after.uv.enabled)receipt.processingObserved=true;await set(opKey,receipt);
   return {stage:'submitted',receipt};
  }
  if(p.action==='texture'){
   await requireSavedUv(p.taskId);
   await textureSettings(p.taskId);
   const prepared=await legacy(bridge,{...command,type:'prepare',payload:{workflow:'texture',sourceTaskId:p.taskId,settings:p.settings,inputs:p.inputs}});
   if(prepared.costLabel!==p.expectedCost||!prepared.preparationReady)throw Error('SEG_PRICE_CHANGED');
   receipt={status:'unknown',step:'texture',groupKey:p.groupKey,taskId:p.taskId,credits:Number(p.expectedCost),clicked:false};await set(opKey,receipt);
   const result=await legacy(bridge,{...command,type:'submit',payload:{workflow:'texture',expectedSnapshot:prepared,confirmCost:true,confirmationNonce:p.operationId}});
   receipt.clicked=true;receipt.status='running';receipt.processingObserved=result.processing===true;await set(opKey,receipt);return {stage:'submitted',receipt};
  }
  if(p.action==='download'){
   return downloadGroup(null);
  }
  throw Error('SEG_GROUP_ACTION_INVALID');
 };
}

import {createRigCommands} from './rig-commands.js';
import { STUDIO_WORKER_REVISION,captureStudioExport,observeStudioDocument,selectStudioSmartMesh,selectStudioModelVersion,selectStudioFourResults,selectStudioMultiview,studioTopologyControl,uploadStudioView,clearStudioView,clickStudioGenerate,resolveStudioGenerationWorkspace,exportStudioControl,selectStudioTextureSettings } from "./studio-adapter.js";
import {createConnectionLoop,createCommandHeartbeat} from './connection-loop.js';
import {readCandidatePreviews} from './candidate-previews.js';
import {readStudioGenerationFailures} from './studio-adapter.js';
import {captureBatch,textureTiming} from './batch-capture.js';
import {createGroupCommands} from './group-commands.js';
import {createMeshImporter} from './mesh-import.js';
import {isReadOnlyStudioCall} from './tab-execution.js';
import {navigateStudioTask,studioNavigationControl} from './studio-navigation.js';
import {observeGroupStudio} from './group-adapter.js';
import {checkNavigationRecovery,checkTabLifecycle,isNavigationCheckCall,isExportPreparationCall} from './navigation-check.js';
import {resumeUrl,reopenedTab} from './tab-recovery.js';
import {studioWorkGuard} from './studio-guard.js';
const BASE = "http://127.0.0.1:4317/api/studio/bridge";
const STUDIO = "https://studio.tripo3d.ai";
const ALARM = "local-studio-heartbeat";
const WORKER_REVISION = STUDIO_WORKER_REVISION;
let busy = false;
// Watchdog: no command legitimately keeps the cycle busy this long (the bridge
// expires commands after 3-6 min). A cycle stuck past it is released and the
// step it was waiting on is recorded for diagnosis.
const BUSY_LIMIT_MS=globalThis.__fitaTimeouts?.busy??8*60000;
let busySince=0,busyPhase='idle',cycleSeq=0;
const phase=name=>{busyPhase=name;};
let lastInspection=null;
let authorizationEpoch = 0;
const session = async () => (await chrome.storage.session.get("bridge")).bridge;
const save = async (bridge) => chrome.storage.session.set({ bridge });
// Remembered pairing: survives browser restarts, extension reloads and FITA
// restarts, so the user pairs once per browser. FITA keeps only its hash;
// Disconnect (here or in FITA) forgets it on both sides. The session token
// above stays short-lived and is re-issued from this credential.
const DEVICE_KEY='fitaRememberedBrowser';
const rememberedBrowser=async()=>(await chrome.storage.local.get(DEVICE_KEY))[DEVICE_KEY]||null;
async function remember(patch){const current=await rememberedBrowser();if(current?.credential||patch.credential)await chrome.storage.local.set({[DEVICE_KEY]:{...current,...patch}});}
const forgetBrowser=()=>chrome.storage.local.remove(DEVICE_KEY);
// The Tripo tab to use without asking: the last authorized one if it still
// exists, the only Studio tab, or the active/most recent one.
function adoptableTab(tabs,device){
  if(!tabs.length)return null;
  const previous=tabs.find(t=>t.id===device?.lastTabId);if(previous)return previous;
  if(tabs.length===1)return tabs[0];
  const active=tabs.filter(t=>t.active);if(active.length===1)return active[0];
  const recent=[...tabs].filter(t=>Number.isFinite(t.lastAccessed)).sort((a,b)=>b.lastAccessed-a.lastAccessed);
  return recent[0]||null;
}
let resuming=null;
function resumeRemembered(){
  resuming||=(async()=>{
    const device=await rememberedBrowser();
    if(!device?.credential)return null;
    const epoch=authorizationEpoch;let result;
    try{result=await request('resume',{credential:device.credential});}
    catch(error){if([401,403].includes(error.status))await forgetBrowser();return null;}
    if(epoch!==authorizationEpoch)return null;
    const tabs=await chrome.tabs.query({url:`${STUDIO}/*`}),tab=adoptableTab(tabs,device);
    const bridge={token:result.token,expiresAt:result.expiresAt,tabId:tab?.id??null,tabWindowId:tab?.windowId??device.tabWindowId??null,resumeUrl:(tab&&resumeUrl(tab.url))||device.resumeUrl||null,priorTabIds:tabs.map(t=>t.id),closedTabId:null,automationAuthorized:device.automationAuthorized===true,readable:false,resumed:true};
    await save(bridge);if(tab)await remember({lastTabId:tab.id,tabWindowId:tab.windowId});
    if(!(await chrome.alarms.get(ALARM)))await chrome.alarms.create(ALARM,{periodInMinutes:0.5});
    lastInspection=null;connectionLoop.start();return bridge;
  })().finally(()=>{resuming=null;});
  return resuming;
}
const connectionLoop=createConnectionLoop({run:cycle,connected:async()=>{const bridge=await session();return !!bridge?.token||!!(await resumeRemembered())?.token;}});
const commandHeartbeat=createCommandHeartbeat({session,inspect,send:(snapshot,token)=>request('heartbeat',snapshot,token),epoch:()=>authorizationEpoch});
const isStudio = (url) => { try { return new URL(url).origin === STUDIO; } catch { return false; } };
async function request(route, data, token) {
  const response = await fetch(`${BASE}/${route}`, {
    method: "POST", credentials: "omit", redirect: "error",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data || {}), signal: AbortSignal.timeout(6000),
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || "El taller rechazó la conexión.");
    error.status = response.status;
    throw error;
  }
  return value;
}
// Runs in the isolated extension world of exactly the tab explicitly selected in the popup.
// It never reads cookies, storage, field values, asset URLs or document text.
function inspectDocument() {
  if (location.origin !== "https://studio.tripo3d.ai") return null;
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const buttons = [...document.querySelectorAll("button,[role=button]")].filter(visible);
  return {
    acknowledged: true, origin: location.origin, readyState: document.readyState,
    visibleButtons: buttons.length,
    disabledButtons: buttons.filter((el) => el.disabled || el.getAttribute("aria-disabled") === "true").length,
    fileInputs: document.querySelectorAll('input[type="file"]').length,
    canvases: [...document.querySelectorAll("canvas")].filter(visible).length,
  };
}
// chrome.scripting has no timeout. A page call that never settles kept the
// worker busy forever (seen 2026-10-21 after a texture preparation): no polls,
// no heartbeats, no alarm recovery. Every injection is bounded; a timeout is
// treated as a lost reply, so paid or mutating calls are never repeated.
// Tests may shorten the bounds through globalThis.__fitaTimeouts.
const SCRIPT_TIMEOUT_MS=globalThis.__fitaTimeouts?.script??60000,INSPECT_TIMEOUT_MS=globalThis.__fitaTimeouts?.inspect??15000;
async function executeBounded(details,ms=SCRIPT_TIMEOUT_MS){
  const timeout=new Promise((_,reject)=>AbortSignal.timeout(ms).addEventListener('abort',()=>reject(new Error('STUDIO_SCRIPT_TIMEOUT')),{once:true}));
  try{return await Promise.race([chrome.scripting.executeScript(details),timeout]);}
  catch(error){
    if(error.message==='STUDIO_SCRIPT_TIMEOUT')try{await chrome.storage.local.set({workbenchHungScript:{at:new Date().toISOString(),workerRevision:WORKER_REVISION,function:details.func?.name||null,action:typeof details.args?.[0]?.action==='string'?details.args[0].action:null,step:typeof details.args?.[0]?.step==='string'?details.args[0].step:null,ms}});}catch{}
    throw error;
  }
}
async function inspect(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isStudio(tab.url)) throw new Error("La pestaña elegida ya no está en Tripo Studio. Selecciónala de nuevo.");
  const results = await executeBounded({ target: { tabId }, func: inspectDocument, world: "ISOLATED" },INSPECT_TIMEOUT_MS);
  if (!results[0]?.result?.acknowledged) throw new Error("No se pudo confirmar acceso a la página. Espera a que termine de cargar.");
  let adapter=null,adapterError=null;
  try{
    const result=(await executeBounded({target:{tabId},func:observeStudioDocument,world:"ISOLATED"},INSPECT_TIMEOUT_MS))[0];
    adapter=result?.result;
    if(adapter?.adapterVersion!==2)adapterError="ADAPTER_NO_RESPONSE";
  }catch(error){adapterError="ADAPTER_EXECUTION_FAILED: "+String(error.message||error).slice(0,200);}
  return { tab: { id: tab.id, url: STUDIO, title: tab.title || "Tripo Studio" }, inspection: results[0].result,adapter,adapterError };
}
const pause=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
// Chrome's script-result transport may reorder object keys. Compare values.
const sameTextureSettings=(a,b)=>!!a&&!!b&&a.resolution===b.resolution&&typeof a.removeLighting==='boolean'&&a.removeLighting===b.removeLighting;
async function ensureAutomaticDownloads() {
  const setting=chrome.contentSettings?.automaticDownloads;
  if(!setting)throw new Error('AUTOMATIC_DOWNLOADS_EXTENSION_RELOAD_REQUIRED');
  await setting.set({primaryPattern:`${STUDIO}/*`,setting:'allow',scope:'regular'});
  if((await setting.get({primaryUrl:STUDIO+'/'}))?.setting!=='allow')throw new Error('AUTOMATIC_DOWNLOADS_BLOCKED');
}
// Free calls that may be repeated after closing one of Studio's informational
// popovers (fita-hint-v1). Paid clicks, uploads and Save are never listed.
const HINT_RETRY_CALLS=new Set(['studioNavigationControl','resolveStudioGenerationWorkspace','studioTopologyControl','selectStudioSmartMesh','selectStudioModelVersion','selectStudioFourResults','selectStudioMultiview','selectStudioTextureSettings']);
const hintRetryAllowed=(func,args)=>isReadOnlyStudioCall(func,args)||HINT_RETRY_CALLS.has(func.name)&&args[0]?.action!=='close-hints'||func.name==='exportStudioControl'&&['inspect','open','format','select-fbx','blender-preset','close'].includes(args[0]?.step);
async function runInTab(bridge,func,args=[],world="ISOLATED") {
  if(!isReadOnlyStudioCall(func,args))await guardGate(bridge);
  try{return await runInTabOnce(bridge,func,args,world);}
  catch(error){
    if(!/CLOSE_OTHER_DIALOGS_FIRST/.test(error.message||'')||!hintRetryAllowed(func,args))throw error;
    let closed;
    try{closed=await runInTabOnce(bridge,studioNavigationControl,[{action:'close-hints'}]);}catch{throw error;}
    if(!closed.hints)throw error;
    await pause(300);
    return runInTabOnce(bridge,func,args,world);
  }
}
async function runInTabOnce(bridge,func,args=[],world="ISOLATED") {
  phase('script:'+func.name+(typeof args[0]?.action==='string'?':'+args[0].action:typeof args[0]?.step==='string'?':'+args[0].step:''));
  if(bridge.exportPreparationCheck===true&&!isExportPreparationCall(func,args,world))throw Error('STUDIO_EXPORT_CHECK_ACTION_FORBIDDEN');
  if(bridge.navigationCheck===true&&!isNavigationCheckCall(func,args,world))throw Error('STUDIO_NAVIGATION_CHECK_ACTION_FORBIDDEN');
  const current=await session();
  if(current?.token!==bridge.token||current.tabId!==bridge.tabId||!current.automationAuthorized)throw new Error("AUTOMATION_NOT_AUTHORIZED");
  if(!isStudio((await chrome.tabs.get(bridge.tabId)).url))throw new Error("STUDIO_ORIGIN_CHANGED");
  const actualArgs=func===observeStudioDocument&&!args.length?[{includeFileHashes:true}]:args;
  const bounded=async details=>{try{return (await executeBounded(details))[0];}catch(error){if(error.message==='STUDIO_SCRIPT_TIMEOUT')return {timedOut:true};throw error;}};
  let injection=await bounded({target:{tabId:bridge.tabId},world,func,args:actualArgs}),result=injection?.result;
  // A document transition can discard a read-only result. Never repeat clicks,
  // uploads or paid submissions on an empty response.
  if(result==null&&isReadOnlyStudioCall(func,args)){
    for(let attempt=0;attempt<3&&result==null;attempt++){
      await pause(250);
      const latest=await session();
      if(latest?.token!==bridge.token||latest.tabId!==bridge.tabId||!latest.automationAuthorized)throw new Error('AUTOMATION_NOT_AUTHORIZED');
      if(!isStudio((await chrome.tabs.get(bridge.tabId)).url))throw new Error('STUDIO_ORIGIN_CHANGED');
      injection=await bounded({target:{tabId:bridge.tabId},world:'ISOLATED',func,args:actualArgs});result=injection?.result;
    }
  }
  if(result==null){
    // No model bytes, URLs, credentials or DOM text in this diagnostic.
    await chrome.storage.local.set({workbenchLastScriptFailure:{at:new Date().toISOString(),workerRevision:WORKER_REVISION,function:func.name,action:typeof args[0]?.action==='string'?args[0].action:null,documentId:injection?.documentId||null,frameId:injection?.frameId??null,reason:injection?.timedOut?'timeout':injection?.error?'script-error':'empty-result'}});
    throw new Error("STUDIO_DID_NOT_RESPOND");
  }
  if(result.adapterError)throw new Error(`${result.adapterError}${result.exportStep?` [export:${result.exportStep}]`:''}`);
  return result;
}
// Glass wall over the authorized tab while FITA works (studio-guard.js).
// Pause holds the next Tripo change at a safe point. A paid click is a single
// page call, so a pause never lands between that click and its receipt. Long
// pauses end the command before any paid click, under the bridge's 180 s
// command window; generation monitors just report "still processing".
const GUARD_KEY='fitaGuard',GUARD_HOLD_MS=150000,GUARD_IDLE_MS=8000;
let guardHideTimer=null,activeCommand=null,guardRendered=null;
const guardState=async()=>(await chrome.storage.session.get(GUARD_KEY))[GUARD_KEY]||{};
const guardView=guard=>guard.paused?'paused':guard.active?'working':'hidden';
async function renderGuard(tabId,guard,force=false){
  const view=guardView(guard),key=tabId+':'+view+':'+(guard.step||'');
  if(!force&&guardRendered===key)return;
  try{await executeBounded({target:{tabId},world:'ISOLATED',func:studioWorkGuard,args:[{state:view,step:guard.step||null}]},5000);guardRendered=key;}
  catch{/* The wall is a convenience; a reload re-renders it. */}
}
// Renew the wall while it is shown; the page drops it after 60 s without this.
let guardRenewedAt=0;
async function guardKeepAlive(){
  if(Date.now()-guardRenewedAt<20000)return;
  const guard=await guardState();
  if(!Number.isInteger(guard.tabId)||!(guard.active||guard.paused))return;
  guardRenewedAt=Date.now();await renderGuard(guard.tabId,guard,true);
}
async function setGuard(tabId,patch){
  const guard={...(await guardState()),...patch,tabId,updatedAt:Date.now()};
  await chrome.storage.session.set({[GUARD_KEY]:guard});
  await renderGuard(tabId,guard);
  return guard;
}
// Commands that change Tripo show the wall. Passive observations and the
// heartbeat inspection do not, so an idle FITA never covers the tab.
function guardStep(command){
  const p=command.payload||{};
  if(command.type==='inspect')return null;
  if(command.type==='observe')return p.configureGenerationDefaults||p.refreshTextureSettings?'configure':p.verifyNavigation||p.verifyLifecycle?'navigate':null;
  if(command.type==='monitor')return 'monitor';
  if(command.type==='export')return 'export';
  if(['prepare','submit','generate'].includes(command.type))return p.workflow==='texture'?'texture':command.type==='prepare'?'prepare':'generate';
  if(command.type==='rig')return 'rig';
  return 'segment';
}
async function guardGate(bridge){
  let guard=await guardState();
  if(!guard.paused||guard.tabId!==bridge.tabId)return;
  for(const until=Date.now()+GUARD_HOLD_MS;Date.now()<until;){
    await pause(300);guard=await guardState();
    if(!guard.paused||guard.tabId!==bridge.tabId)return;
  }
  const error=new Error('FITA_PAUSED_BY_USER');error.beforeSubmit=true;throw error;
}
const operationSnapshot=(snapshot,stage)=>({stage,mode:snapshot.generationMode,generationCount:snapshot.generationCount,costLabel:snapshot.costLabel,modelLabel:snapshot.modelLabel,options:snapshot.options,pageSignature:snapshot.pageSignature,snapshot});
function verifyExpectedInputs(snapshot,expectedInputs) {
  const allowed=["front","left","right","back"],errors=[];
  if(!Array.isArray(expectedInputs)||expectedInputs.length<1||expectedInputs.length>4||new Set(expectedInputs.map((input)=>input.slot)).size!==expectedInputs.length||expectedInputs.some((input)=>!allowed.includes(input.slot)||!/^[a-f0-9]{64}$/i.test(input.sha256||"")))
    return {inputsVerified:false,preparationReady:false,selectedSlots:[],readinessErrors:["INVALID_EXPECTED_INPUT_MANIFEST"]};
  const selectedSlots=expectedInputs.map((input)=>input.slot);
  for(const expected of expectedInputs){
    const current=snapshot.slots?.[expected.slot],file=current?.files?.[0];
    const nativeMatches=current?.files?.length===1&&file?.sha256?.toLowerCase()===expected.sha256.toLowerCase()&&(expected.size==null||file.size===expected.size)&&(!expected.mimeType||file.mimeType===expected.mimeType);
    const preview=current?.previewProof;
    const previewMatches=current?.semanticBinding==='observed-multiview-card'&&current.previewVisible&&(preview?.previewBytesSha256?.toLowerCase()===expected.sha256.toLowerCase()||(/^[a-f0-9]{64}$/i.test(expected.pixelSha256||'')&&preview?.pixelSha256?.toLowerCase()===expected.pixelSha256.toLowerCase()&&preview.width===expected.width&&preview.height===expected.height));
    const receipt=expected.receipt||current?.receipt;
    const receiptMatches=current?.semanticBinding==='observed-multiview-card'&&current.previewVisible&&receipt?.version===1&&receipt.slot===expected.slot&&/^[0-9a-f-]{36}$/i.test(receipt.operationId||'')&&receipt.originalSha256===expected.sha256&&receipt.originalSize===expected.size&&receipt.mimeType===expected.mimeType&&preview?.width===receipt.width&&preview?.height===receipt.height&&((receipt.previewBytesSha256&&receipt.previewBytesSha256===preview.previewBytesSha256)||(receipt.pixelSha256&&receipt.pixelSha256===preview.pixelSha256));
    const contentMatches=current?.files?.length?nativeMatches&&(current.semanticBinding!=='observed-multiview-card'||!current.previewVisible||previewMatches||receiptMatches):previewMatches||receiptMatches;
    if(!current?.found||!contentMatches)errors.push(`FILE_CONTENT_MISMATCH_${expected.slot.toUpperCase()}`);
  }
  for(const slot of allowed)if(!selectedSlots.includes(slot)&&snapshot.slots?.[slot]?.occupied)errors.push(`UNEXPECTED_OCCUPIED_SLOT_${slot.toUpperCase()}`);
  const inputsVerified=errors.length===0;
  for(const slot of selectedSlots)if(!snapshot.slots?.[slot]?.previewVisible)errors.push(`PREVIEW_NOT_OBSERVED_${slot.toUpperCase()}`);
  if(!snapshot.supported)errors.push("STUDIO_INTERFACE_NOT_SUPPORTED");
  if(snapshot.blockingDialog)errors.push("CLOSE_OTHER_DIALOGS_FIRST");
  if(!snapshot.generateEnabled)errors.push("GENERATE_NOT_ENABLED");
  if(!snapshot.costLabel)errors.push("COST_NOT_OBSERVED");
  if(snapshot.generationMode==="texture"){
    if(!snapshot.currentTaskId||!["2K","4K","8K"].includes(snapshot.options?.texture?.resolution)||typeof snapshot.options?.texture?.removeLighting!=="boolean")errors.push("TEXTURE_SETTINGS_NOT_VERIFIED");
    return {inputsVerified,preparationReady:errors.length===0,selectedSlots,readinessErrors:errors};
  }
  if(!snapshot.modelLabel)errors.push("MODEL_NOT_OBSERVED");
  if(snapshot.generationMode!=="smart-mesh"||!/^P2\.0(?:\s|$)/.test(snapshot.modelLabel||""))errors.push("SMART_MESH_REQUIRED");
  if(snapshot.generationCount!==4)errors.push("FOUR_GENERATIONS_REQUIRED");
  return {inputsVerified,preparationReady:errors.length===0,selectedSlots,readinessErrors:errors};
}
async function approvedInputManifest(inputs) {
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>4||new Set(inputs.map((input)=>input.slot)).size!==inputs.length||inputs.some((input)=>!["front","left","right","back"].includes(input.slot)))throw new Error("ONE_TO_FOUR_DISTINCT_VIEW_SLOTS_REQUIRED");
  const expected=[];
  for(const input of inputs){
    if(!["image/png","image/jpeg","image/webp"].includes(input.mimeType)||typeof input.dataBase64!=="string"||input.dataBase64.length>45*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64)||typeof input.name!=="string"||input.name.length>120)throw new Error("INVALID_APPROVED_IMAGE");
    const bytes=Uint8Array.from(atob(input.dataBase64),(char)=>char.charCodeAt(0));
    const sha256=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
    if(input.sha256&&input.sha256.toLowerCase()!==sha256)throw new Error("APPROVED_IMAGE_HASH_MISMATCH");
    const pixelProof=input.pixelSha256?{pixelSha256:input.pixelSha256,width:input.width,height:input.height}:{};
    if(input.pixelSha256&&(!/^[a-f0-9]{64}$/i.test(input.pixelSha256)||!Number.isInteger(input.width)||!Number.isInteger(input.height)||input.width<1||input.height<1||input.width*input.height>32*1024*1024))throw new Error("INVALID_APPROVED_PIXEL_PROOF");
    expected.push({slot:input.slot,sha256,mimeType:input.mimeType,size:bytes.length,...pixelProof});
  }
  return expected;
}
// Read only the URL emitted by the confirmed native Export action. No API URL
// is constructed, no credentials are read, and signed URLs remain in memory.
async function readExportedGlb({url,taskId,action,lease,offset,format='GLB'}) {
  try{
    const key='__workbenchExportBytesV1';
    if(action==='release'){if(window[key]?.lease===lease){clearTimeout(window[key].timer);delete window[key];}return {stage:'released'};}
    if(location.origin!=='https://studio.tripo3d.ai'||!location.pathname.endsWith(taskId))throw new Error('CONFIRMED_TASK_CHANGED');
    if(action==='chunk'){
      const saved=window[key];if(!saved||saved.lease!==lease||saved.taskId!==taskId)throw Error('EXPORT_BYTES_EXPIRED');
      if(!Number.isInteger(offset)||offset<0||offset>=saved.bytes.length)throw Error('EXPORT_CHUNK_INVALID');
      const chunk=saved.bytes.subarray(offset,offset+1024*1024);let binary='';
      for(let i=0;i<chunk.length;i+=32768)binary+=String.fromCharCode(...chunk.subarray(i,i+32768));
      return {dataBase64:btoa(binary),offset,length:chunk.length};
    }
    const limit=action==='start'?150*1024*1024:32*1024*1024;
    const source=new URL(url);
    if(source.protocol!=='https:'&&!(source.protocol==='blob:'&&source.origin===location.origin))throw new Error('EXPORT_DOWNLOAD_URL_UNSUPPORTED');
    const response=await fetch(source.href,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw new Error('EXPORTED_GLB_FETCH_FAILED');
    if(Number(response.headers.get('content-length'))>limit)throw Error('EXPORTED_GLB_TOO_LARGE');
    const reader=response.body.getReader(),parts=[];let length=0;
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new Error('EXPORTED_GLB_TOO_LARGE');}parts.push(value);}
    const bytes=new Uint8Array(length);let cursor=0;for(const part of parts){bytes.set(part,cursor);cursor+=part.length;}
    const header=String.fromCharCode(...bytes.subarray(0,40));
    const valid=format==='FBX'?header.startsWith('Kaydara FBX Binary  ')||header.startsWith('; FBX')||bytes[0]===80&&bytes[1]===75:format==='GLB'&&length>=20&&header.startsWith('glTF')&&new DataView(bytes.buffer).getUint32(4,true)===2&&new DataView(bytes.buffer).getUint32(8,true)===length;
    if(!valid)throw new Error(format==='GLB'?'EXPORTED_GLB_INVALID':'EXPORTED_FBX_INVALID');
    if(action==='start'){
      if(window[key])clearTimeout(window[key].timer);
      const saved={lease,taskId,bytes,timer:setTimeout(()=>{if(window[key]===saved)delete window[key];},180000)};
      window[key]=saved;return {totalBytes:length};
    }
    let binary='';for(let i=0;i<length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return {dataBase64:btoa(binary)};
  }catch(error){return {adapterError:['CONFIRMED_TASK_CHANGED','EXPORT_DOWNLOAD_URL_UNSUPPORTED','EXPORTED_GLB_TOO_LARGE','EXPORTED_GLB_INVALID','EXPORT_BYTES_EXPIRED','EXPORT_CHUNK_INVALID'].includes(error.message)?error.message:'EXPORTED_GLB_FETCH_FAILED'};}
}
async function nativeGlbExport(bridge,taskId,{operationId,downloadRecovery,directExportTransfer=false,exportRevision=null,requireSkeleton=false,uiRecoveryAttempt=0,captureWaitSeconds=90,format='GLB'}={}) {
  if(!['GLB','FBX'].includes(format))throw Error('EXPORT_FORMAT_UNSUPPORTED');
  if(!chrome.downloads?.onCreated)throw new Error("DOWNLOAD_PERMISSION_REQUIRES_EXTENSION_RELOAD");
  const selectedUrl=new URL((await chrome.tabs.get(bridge.tabId)).url);
  if(selectedUrl.origin!==STUDIO||!selectedUrl.pathname.endsWith(taskId))throw new Error("CONFIRMED_TASK_CHANGED");
  const storageKey='studioDownloadReceiptsV1',receipts=(await chrome.storage.local.get(storageKey))[storageKey]||{};
  if(exportRevision!==null&&!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(exportRevision))throw new Error('INVALID_EXPORT_REVISION');
  const receiptKey=format==='FBX'?`${taskId}:source:fbx`:exportRevision?`${taskId}:texture:${exportRevision}`:taskId;
  let receipt=receipts[receiptKey]||null,clickAt=null,captureDiagnostic=null;
  const observedIds=new Set();let observedCount=0;
  let freeRecoveryMetadata=receipt?.freeRecoveryCount?{freeRecoveryCount:receipt.freeRecoveryCount,recoveryHistory:receipt.recoveryHistory||[]}:{};
  const persist=async(value)=>{value={...value,...freeRecoveryMetadata};receipt=value;const latest=(await chrome.storage.local.get(storageKey))[storageKey]||{};latest[receiptKey]=value;await chrome.storage.local.set({[storageKey]:latest});};
  const sameTask=async()=>{const url=new URL((await chrome.tabs.get(bridge.tabId)).url);return url.origin===STUDIO&&url.pathname===selectedUrl.pathname;};
  const sourceMatches=(item)=>{try{const ref=new URL(item.referrer);return ref.origin===STUDIO&&(ref.pathname===selectedUrl.pathname||ref.pathname==='/');}catch{return false;}};
  const failedExport=async(reason)=>{
    const events=[];
    for(const id of new Set([...observedIds,...(Number.isInteger(receipt?.id)?[receipt.id]:[])])){
      try{
        const [item]=await chrome.downloads.search({id});if(!item)continue;
        let referrer=null;try{const url=new URL(item.referrer);if(url.origin===STUDIO)referrer={origin:STUDIO,pathname:url.pathname.slice(0,240)};}catch{}
        events.push({id:item.id,startTime:Number.isFinite(Date.parse(item.startTime))?new Date(item.startTime).toISOString():null,extension:item.filename?.match(/\.[a-z0-9]{1,8}$/i)?.[0]?.toLowerCase()||null,referrer,state:item.state||null,danger:item.danger||null,paused:item.paused===true,ownedByExtension:item.byExtensionId===chrome.runtime.id,hasExtensionAttribution:typeof item.byExtensionId==='string',error:item.error||null,matched:receipt?.id===item.id});
      }catch{events.push({unavailable:true});}
    }
    // message is retained by the existing backend without changing its schema.
    return {stage:'requires_manual_import',taskId,reason,message:JSON.stringify({downloadDiagnostics:{observedCount,matchedCount:Number.isInteger(receipt?.id)?1:0,receiptState:receipt?.state||null,events},...(captureDiagnostic?{captureDiagnostic}:{})})};
  };
  const finishKnown=async()=>{
    const current=await session();if(current?.token!==bridge.token||current.tabId!==bridge.tabId||!current.automationAuthorized)throw new Error('AUTOMATION_NOT_AUTHORIZED');
    if(receipt?.correlation==='local-export-bytes'&&receipt.state==='complete'&&receipt.taskId===taskId&&receipt.taskPath===selectedUrl.pathname&&receipt.localDownload?.taskId===taskId)return {stage:'exported',taskId,download:receipt.localDownload};
    if(!Number.isInteger(receipt?.id)||receipt.taskId!==taskId)return failedExport('DOWNLOAD_RECEIPT_REQUIRES_REVIEW');
    if(clickAt===null){observedIds.add(receipt.id);observedCount=Math.max(observedCount,1);}
    const [item]=await chrome.downloads.search({id:receipt.id});
    const managed=receipt.correlation==='managed-native-export';
    if(!item||item.startTime!==receipt.startTime||(managed?item.byExtensionId!==chrome.runtime.id:!sourceMatches(item)))return failedExport('DOWNLOAD_RECEIPT_CHANGED');
    if(item.state==='complete'){
      if(!item.filename.toLowerCase().endsWith('.'+format.toLowerCase()))return failedExport('DOWNLOAD_FORMAT_MISMATCH');
      await persist({...receipt,state:'complete'});
      return {stage:'exported',taskId,download:{path:item.filename,filename:item.filename.split(/[\\/]/).at(-1),id:item.id,taskId}};
    }
    if(item.state==='interrupted')return failedExport('DOWNLOAD_INTERRUPTED');
    return null;
  };
  // Resume a persisted causal receipt before opening a dialog or clicking Export again.
  // Reuse known files first. An unresolved direct capture may get one free
  // re-export of its exact task; legacy browser downloads require an empty window.
  if(receipt?.state==='unresolved'&&!Number.isInteger(receipt.id)&&!Number.isInteger(receipt.nativeId)&&Number.isFinite(receipt.clickAt)&&Date.now()>receipt.clickAt+90000){
    const prior=await chrome.downloads.search({startedAfter:new Date(receipt.clickAt-1000).toISOString(),startedBefore:new Date(receipt.clickAt+90000).toISOString(),limit:100});
    if(directExportTransfer&&receipt.taskId===taskId&&receipt.taskPath===selectedUrl.pathname&&(receipt.freeRecoveryCount||0)<1&&await sameTask()){
      // An unresolved free Export is not an uncertain paid Generate. Keep the
      // old intent and every browser file untouched; one fresh leased capture
      // can request the same confirmed asset, never submit another generation.
      freeRecoveryMetadata={freeRecoveryCount:1,recoveryHistory:[...(receipt.recoveryHistory||[]),{operationId:receipt.operationId,clickAt:receipt.clickAt,state:receipt.state,correlation:receipt.correlation,windowEventCount:prior.length}]};
      receipt=null;
    }else if(prior.length===0&&!directExportTransfer)receipt=null;
  }
  // An explicit retry may replace a stalled old Save As download, but only
  // after proving its exact persisted ID, time, task and source/extension.
  // A completed file is always reused; a paid generation is never repeated.
  let recoveredDownload=null;
  if(directExportTransfer&&receipt?.state==='complete'&&receipt.taskId===taskId&&receipt.taskPath===selectedUrl.pathname&&receipt.correlation==='managed-native-export'&&Number.isInteger(receipt.id)){
    const [item]=await chrome.downloads.search({id:receipt.id});
    if(item?.state==='complete'&&item.startTime===receipt.startTime&&item.byExtensionId===chrome.runtime.id&&await sameTask()){
      recoveredDownload={id:receipt.id,startTime:receipt.startTime};receipt=null;
    }
  }
  if(directExportTransfer&&receipt?.state==='waiting'&&receipt.taskId===taskId&&receipt.taskPath===selectedUrl.pathname&&Number.isInteger(receipt.id)){
    let [item]=await chrome.downloads.search({id:receipt.id});
    const verified=item&&item.startTime===receipt.startTime&&(receipt.correlation==='managed-native-export'?item.byExtensionId===chrome.runtime.id:sourceMatches(item));
    if(verified&&await sameTask()&&(item.state==='interrupted'||item.state==='in_progress'&&Date.now()-Date.parse(item.startTime)>90000)){
      if(item.state==='in_progress'){await chrome.downloads.cancel(item.id);[item]=await chrome.downloads.search({id:receipt.id});}
      if(item?.state==='interrupted'&&item.startTime===receipt.startTime){recoveredDownload={id:receipt.id,startTime:receipt.startTime};receipt=null;}
    }
  }
  // This state is written only for a positively identified DOM guard failure
  // before Export's download button was clicked. Uncertain clicks stay blocked.
  if(receipt?.state==='not-clicked'&&receipt.notClickedProof==='export-dom-guard'&&receipt.taskId===taskId&&receipt.taskPath===selectedUrl.pathname)receipt=null;
  if(receipt){
    // Repair only the 0.2.6 race: exactly our cancelled native event plus the
    // confirmed extension-created ID. Any third event or changed proof stays blocked.
    if(receipt.state==='ambiguous'&&receipt.correlation==='managed-native-export'&&receipt.taskId===taskId&&receipt.taskPath===selectedUrl.pathname&&Number.isInteger(receipt.id)&&Number.isInteger(receipt.nativeId)&&receipt.id!==receipt.nativeId&&Array.isArray(receipt.downloadIds)&&receipt.downloadIds.length===2&&new Set(receipt.downloadIds).size===2&&receipt.downloadIds.includes(receipt.id)&&receipt.downloadIds.includes(receipt.nativeId)){
      const [native]=await chrome.downloads.search({id:receipt.nativeId}),[managed]=await chrome.downloads.search({id:receipt.id});
      const elapsed=Date.parse(managed?.startTime)-Date.parse(native?.startTime);
      if(native?.state==='interrupted'&&native.startTime===receipt.nativeStartTime&&sourceMatches(native)&&managed?.byExtensionId===chrome.runtime.id&&managed.startTime===receipt.startTime&&elapsed>=0&&elapsed<=180000&&await sameTask())await persist({...receipt,state:'waiting',downloadIds:[receipt.nativeId],repairedManagedEventRace:true});
    }
    if(receipt.taskId!==taskId||receipt.taskPath!==selectedUrl.pathname||['ambiguous','unresolved','started','transferring'].includes(receipt.state))return failedExport('DOWNLOAD_RECEIPT_REQUIRES_REVIEW');
    for(let i=0;i<60;i++){const result=await finishKnown();if(result)return result;await pause(1000);}
    return failedExport('DOWNLOAD_PENDING_SAVE_OR_COMPLETION');
  }
  if(downloadRecovery){
    const recoveryTime=Date.parse(downloadRecovery.eventStartTime);
    if(downloadRecovery.taskId!==taskId||!/^[0-9a-f-]{36}$/i.test(downloadRecovery.sourceOperationId||'')||!Number.isFinite(recoveryTime))throw new Error('INVALID_DOWNLOAD_RECOVERY_DESCRIPTOR');
    const found=await chrome.downloads.search({startedAfter:new Date(recoveryTime-100).toISOString(),startedBefore:new Date(recoveryTime+100).toISOString(),limit:10});
    const exact=found.filter((item)=>item.startTime===downloadRecovery.eventStartTime&&sourceMatches(item));
    if(found.length!==1||exact.length!==1||!(await sameTask()))throw new Error('DOWNLOAD_RECOVERY_NOT_UNIQUE');
    const item=exact[0];
    await persist({version:1,taskId,taskPath:selectedUrl.pathname,operationId:downloadRecovery.sourceOperationId,id:item.id,startTime:item.startTime,state:'waiting',correlation:'backend-verified-exact-event'});
    for(let i=0;i<60;i++){const result=await finishKnown();if(result)return result;await pause(1000);}
    return failedExport('DOWNLOAD_PENDING_SAVE_OR_COMPLETION');
  }
  // Arm before clicking Export: no native browser download is started, so an
  // "ask where to save" preference cannot race our filename listener.
  // A user can close Export while it mounts or while GLB is being selected.
  // Reopen only this free preparation, bounded to three attempts. Nothing has
  // been downloaded yet; the durable download/capture intent starts below.
  for(let attempt=0;attempt<3;attempt++){
    if(!(await sameTask()))throw Error('CONFIRMED_TASK_CHANGED');
    try{
      await runInTab(bridge,exportStudioControl,[{step:'open',taskId,format}]);await pause(350);
      const formatState=await runInTab(bridge,exportStudioControl,[{step:'format',taskId,format}]);
      if(formatState.stage===`choose-${format.toLowerCase()}`){await pause(250);await runInTab(bridge,exportStudioControl,[{step:`select-${format.toLowerCase()}`,taskId,format}]);await pause(250);}
      if(format==='FBX')await runInTab(bridge,exportStudioControl,[{step:'blender-preset',taskId,format}]);
      if(requireSkeleton)await runInTab(bridge,exportStudioControl,[{step:'include-skeleton',taskId}]);
      break;
    }catch(error){
      if(attempt===2||!/^(?:EXPORT_DIALOG_NOT_VERIFIED|EXPORT_FORMAT_CONTROL_NOT_VERIFIED|EXPORT_FORMAT_LIST_NOT_READY|(?:GLB|FBX)_OPTION_NOT_VISIBLE|(?:GLB|FBX)_SELECTION_NOT_ACKNOWLEDGED)(?: \[export:(?:format|select-glb|select-fbx|include-skeleton)\])?$/.test(error.message))throw error;
      await pause(750);
    }
  }
  const lease=operationId;
  await runInTab(bridge,captureStudioExport,[{action:'arm',taskId,lease,format}],'MAIN');
  let retryPreparation=false;
  try{
    if(!(await sameTask()))throw Error('CONFIRMED_TASK_CHANGED');
    clickAt=Date.now();
    await persist({version:1,taskId,taskPath:selectedUrl.pathname,operationId,state:'started',clickAt,correlation:'captured-export',...(recoveredDownload?{recoveredDownload}:{})});
    await runInTab(bridge,exportStudioControl,[{step:'download',taskId,format}]);
    let captured;
    for(let i=0;i<Math.max(1,Math.min(90,captureWaitSeconds));i++){
      captured=await runInTab(bridge,captureStudioExport,[{action:'read',taskId,lease}],'MAIN');
      captureDiagnostic=captured.diagnostic||captureDiagnostic;
      if(captured.stage==='captured')break;
      await pause(1000);
    }
    if(captured?.stage!=='captured')throw Error('EXPORT_CAPTURE_TIMEOUT');
    const source=new URL(captured.url);
    if(source.protocol!=='https:'&&!(source.protocol==='blob:'&&source.origin===STUDIO))throw Error('EXPORT_DOWNLOAD_URL_UNSUPPORTED');
    if(!(await sameTask()))throw Error('CONFIRMED_TASK_CHANGED');
    if(directExportTransfer){
      try{
        const info=await runInTab(bridge,readExportedGlb,[{url:source.href,taskId,action:'start',lease,format}]);
        if(!Number.isInteger(info.totalBytes)||info.totalBytes<20||info.totalBytes>150*1024*1024)throw Error('EXPORTED_GLB_INVALID');
        for(let offset=0;offset<info.totalBytes;){
          const chunk=await runInTab(bridge,readExportedGlb,[{taskId,action:'chunk',lease,offset}]);
          if(chunk.offset!==offset||!Number.isInteger(chunk.length)||chunk.length<=0||chunk.length>1024*1024||offset+chunk.length>info.totalBytes)throw Error('EXPORT_CHUNK_INVALID');
          const body={phase:'chunk',operationId,taskId,offset,totalBytes:info.totalBytes,dataBase64:chunk.dataBase64,format};
          let ack;
          try{ack=await request('export-file',body,bridge.token);}catch(error){if(error.status)throw error;ack=await request('export-file',body,bridge.token);}
          if(ack.received!==offset+chunk.length)throw Error('EXPORT_CHUNK_NOT_ACKNOWLEDGED');
          offset+=chunk.length;
        }
        if(!(await sameTask())||(await session())?.token!==bridge.token)throw Error('AUTOMATION_NOT_AUTHORIZED');
        const saved=await request('export-file',{phase:'finish',operationId,taskId,format},bridge.token);
        await persist({...receipt,state:'complete',correlation:'local-export-bytes',localDownload:saved.download});
        return finishKnown();
      }catch(error){
        // A CDN denying fetch can still be downloaded through the
        // explicit API. No fallback ever clicks native Export a second time.
        if(error.message!=='EXPORTED_GLB_FETCH_FAILED')throw error;
      }
    }
    if(!(await sameTask())||(await session())?.token!==bridge.token)throw Error('AUTOMATION_NOT_AUTHORIZED');
    const id=await chrome.downloads.download({url:source.href,filename:`FITA/${taskId}.${format.toLowerCase()}`,saveAs:false,conflictAction:'uniquify'});
    await persist({...receipt,id,state:'waiting',correlation:'managed-native-export'});
    const [item]=await chrome.downloads.search({id});
    if(item?.byExtensionId!==chrome.runtime.id||!Number.isFinite(Date.parse(item?.startTime)))throw Error('MANAGED_DOWNLOAD_NOT_VERIFIED');
    await persist({...receipt,startTime:item.startTime});
    for(let i=0;i<60;i++){const result=await finishKnown();if(result)return result;await pause(1000);}
    return failedExport('DOWNLOAD_PENDING_COMPLETION');
  }catch(error){
    const beforeClick=/^(?:EXPORT_DIALOG_NOT_VERIFIED|(?:GLB|FBX)_FORMAT_NOT_SELECTED|EXPORT_FORMAT_LIST_STILL_OPEN) \[export:download\]$/.test(error.message);
    if(beforeClick){
      await persist({...receipt,state:'not-clicked',notClickedProof:'export-dom-guard'});
      if(uiRecoveryAttempt<2&&await sameTask())retryPreparation=true;
      else return failedExport(error.message);
    }else{
      if(!Number.isInteger(receipt?.id))await persist({...receipt,state:'unresolved'});
      return failedExport(error.message||'AUTOMATIC_DOWNLOAD_FAILED');
    }
  }finally{
    try{await runInTab(bridge,readExportedGlb,[{taskId,action:'release',lease}]);}catch{}
    // No token/asset URL is persisted in the page. The lease also self-expires
    // if the service worker is terminated or authorization is revoked.
    try{await runInTab(bridge,captureStudioExport,[{action:'disarm',taskId,lease}],'MAIN');}catch{}
  }
  if(retryPreparation){
    await pause(750);
    return nativeGlbExport(bridge,taskId,{operationId,downloadRecovery,directExportTransfer,exportRevision,requireSkeleton,uiRecoveryAttempt:uiRecoveryAttempt+1,captureWaitSeconds,format});
  }
}
async function performStudioCommand(bridge,command) {
  const payload=command.payload||{};
  if(command.type==='observe'&&payload.verifyExportPreparation===true){
    const testBridge={...bridge,exportPreparationCheck:true},initial=await runInTab(testBridge,observeGroupStudio),taskId=initial.taskId;
    if(!taskId||initial.unsavedChanges||initial.importBusy||initial.importFileCount)throw Error('STUDIO_LIFECYCLE_UNSAFE');
    const control=step=>runInTab(testBridge,exportStudioControl,[{step,taskId,format:'FBX'}]);
    try{
      await control('open');const format=await control('format');if(format.stage==='choose-fbx')await control('select-fbx');
      const preset=await control('blender-preset');
      return {stage:'observed',exportPreparation:{passed:preset.stage==='blender-preset-verified',format:'FBX',preset:'Blender',downloads:0,paidActions:0}};
    }catch(error){
      const snapshot=await runInTab(testBridge,observeStudioDocument,[{includeLayoutDiagnostic:true}]);
      return {stage:'observed',exportPreparation:{passed:false,error:error.message,layoutDiagnostic:snapshot.layoutDiagnostic,downloads:0,paidActions:0}};
    }finally{await control('close');}
  }
  if(command.type==='observe'&&(payload.verifyNavigation===true||payload.verifyLifecycle===true)){
    const diagnosticBridge={...bridge,navigationCheck:true};
    const ready=async()=>{for(let i=0;i<60;i++){try{const s=await inspect(diagnosticBridge.tabId);if(s.inspection.readyState==='complete'&&s.adapter?.currentTaskId)return s;}catch{}await pause(500);}throw Error('STUDIO_DOCUMENT_NOT_READY');};
    const reload=async()=>{await chrome.tabs.reload(diagnosticBridge.tabId);lastInspection=null;await ready();};
    const reopen=async()=>{
      const tab=await chrome.tabs.get(diagnosticBridge.tabId),url=resumeUrl(tab.url);if(!url)throw Error('STUDIO_RESUME_URL_NOT_VERIFIED');
      const old=tab.id;await chrome.tabs.remove(old);const next=await chrome.tabs.create({url,windowId:tab.windowId,active:tab.active===true});
      const latest=await session();if(latest?.token!==bridge.token)throw Error('AUTOMATION_NOT_AUTHORIZED');
      await save({...latest,closedTabId:old});
      // Run the same automatic reattachment policy used for a user's reopened tab.
      let candidate;
      // tabs.create resolves before Chrome exposes its committed URL. The
      // normal connection loop already waits; the diagnostic must do so too.
      for(let attempt=0;attempt<60;attempt++){
        candidate=reopenedTab(await session(),await chrome.tabs.query({url:`${STUDIO}/*`}));
        if(candidate)break;await pause(500);
      }
      if(candidate?.id!==next.id)throw Error('STUDIO_REOPEN_AMBIGUOUS');
      diagnosticBridge.tabId=next.id;const snapshot=await ready();
      await request('heartbeat',{...snapshot,automationAuthorized:true,resumePreviousTabId:old},bridge.token);
      const current=await session();if(current?.token!==bridge.token)throw Error('AUTOMATION_NOT_AUTHORIZED');
      await save({...current,tabId:next.id,closedTabId:null,resumeUrl:url,readable:true});lastInspection=null;
    };
    return (payload.verifyLifecycle?checkTabLifecycle:checkNavigationRecovery)({reload,reopen,
      observe:()=>runInTab(diagnosticBridge,observeGroupStudio),
      navigate:(taskId,workflow)=>navigateStudioTask({chrome,runInTab,pause,bridge:diagnosticBridge},taskId,workflow),
      monitor:taskId=>performStudioCommand(diagnosticBridge,{id:command.id,type:'monitor',payload:{taskId,taskConfirmed:true,navigateConfirmedTask:true}}),pause,
    });
  }
  if(command.type==='rig')return createRigCommands({chrome,runInTab,pause,exportGlb:nativeGlbExport})(bridge,command);
  if(command.type==='segment')return groupCommand(bridge,command);
  if(command.type==='observe'&&payload.verifyCandidateTaskIds){
    const taskIds=payload.verifyCandidateTaskIds,key='workbenchFailures:'+payload.submissionId;
    const prior=(await chrome.storage.local.get(key))[key]||[];
    let evidence=await runInTab(bridge,readStudioGenerationFailures,[{taskIds,action:'watch'}]);
    const snapshot=await runInTab(bridge,observeStudioDocument);
    const pending=payload.pendingTaskIds||taskIds,complete=()=>pending.every(id=>[...prior,...evidence.failures].some(f=>f.taskId===id));
    if(!complete()&&payload.scanNotifications&&!snapshot.blockingDialog){
      const opened=await runInTab(bridge,readStudioGenerationFailures,[{taskIds,action:'open'}]);
      try{
        if(['opened','already-open'].includes(opened.navigation))for(let page=0;page<48;page++){
          await pause(300);evidence=await runInTab(bridge,readStudioGenerationFailures,[{taskIds,action:'inspect'}]);if(complete())break;
          const older=await runInTab(bridge,readStudioGenerationFailures,[{taskIds,action:'older'}]);if(!['scrolled','loading'].includes(older.navigation))break;
        }
      }finally{
        if(opened.navigation==='opened'){
          await runInTab(bridge,readStudioGenerationFailures,[{taskIds,action:'close'}]);
          for(let i=0;i<12;i++){await pause(250);const closed=await runInTab(bridge,observeStudioDocument);if(!closed.blockingDialog)break;if(i===11)throw Error('CLOSE_OTHER_DIALOGS_FIRST');}
        }
      }
    }
    const failures=[...new Map([...prior,...evidence.failures].filter(f=>taskIds.includes(f.taskId)).map(f=>[f.taskId,f])).values()];
    await chrome.storage.local.set({[key]:failures});
    return {stage:'observed',candidateFailures:failures,checkedTaskIds:taskIds,failureVerificationVersion:1,reason:complete()?null:snapshot.blockingDialog?'CLOSE_OTHER_DIALOGS_FIRST':'STUDIO_RESULTS_NOT_VERIFIED'};
  }
  if(command.type==='generate'){
    let prepared;
    try{
      if(payload.confirmCost!==true||payload.confirmUpload!==true||!payload.confirmationNonce||!payload.expectedCost)throw new Error('STUDIO_COST_CONFIRMATION');
      prepared=await performStudioCommand(bridge,{...command,type:'prepare'});
      if(prepared.costLabel!==payload.expectedCost)throw new Error('STUDIO_QUOTED_COST_CHANGED');
      if(prepared.mode!=='smart-mesh'||prepared.generationCount!==4||!/^P2\.0(?:\s|$)/.test(prepared.modelLabel||''))throw new Error('SMART_MESH_REQUIRED');
    }catch(error){error.beforeSubmit=true;throw error;}
    return performStudioCommand(bridge,{...command,type:'submit',payload:{confirmCost:true,confirmationNonce:payload.confirmationNonce,expectedSnapshot:prepared}});
  }
  let snapshot=await runInTab(bridge,observeStudioDocument,[{includeFileHashes:true,includeLayoutDiagnostic:command.type==="observe"}]);
  if(command.type==='observe'&&!payload.configureGenerationDefaults&&!payload.refreshTextureSettings&&!payload.discoverSubmissionId)return {...operationSnapshot(snapshot,'observed'),...verifyExpectedInputs(snapshot,payload.expectedInputs),expectedInputs:payload.expectedInputs||[],layoutDiagnostic:snapshot.layoutDiagnostic};
  const texture=payload.workflow==='texture';
  async function generationTopology(configure=false){
    const limits=payload.faceLimits||payload.expectedSnapshot?.options?.generationFaceLimits;
    if(!Array.isArray(limits)||limits.length!==4)throw Error('STUDIO_POLYGON_SETTINGS_NOT_VERIFIED');
    // Four accessible sliders may need distinct acknowledged keyboard steps.
    // Bound this free reconciliation by both transitions and wall-clock time.
    const started=Date.now();
    for(let i=0;i<(configure?80:1)&&Date.now()-started<25000;i++){
      let topology;
      try{topology=await runInTab(bridge,studioTopologyControl,[{step:configure?'configure':'inspect',faceLimits:limits,configurationId:command.id}]);}
      catch(error){
        // The next configure call re-reads the native values before changing one
        // field. An empty reply never justifies replaying a paid action.
        if(!configure||error.message!=='STUDIO_DID_NOT_RESPOND')throw error;
        await pause(300);continue;
      }
      if(!topology.pending&&JSON.stringify(topology.faceLimits)===JSON.stringify(limits)){
        snapshot=await runInTab(bridge,observeStudioDocument,[{includeFileHashes:true}]);
        snapshot.options={...snapshot.options,generationFaceLimits:topology.faceLimits};return;
      }
      if(!configure)break;
      await pause(300);
    }
    throw Error('STUDIO_POLYGON_SETTINGS_NOT_VERIFIED');
  }
  async function generationSetting(control,verified,failure){
    let last=null;
    for(let attempt=0;attempt<3;attempt++){
      if(snapshot.workflow&&snapshot.workflow!=='generate')throw Error('GENERATION_WORKSPACE_REQUIRED');
      if(snapshot.blockingDialog)throw Error('CLOSE_OTHER_DIALOGS_FIRST');
      if(verified(snapshot))return;
      try{last=await runInTab(bridge,control);}
      catch(error){if(error.message!=='STUDIO_DID_NOT_RESPOND')throw error;last={noResponse:true};}
      // A free setting may have changed even when Chrome lost the reply. Read
      // its actual state before deciding whether another setting click is needed.
      for(let poll=0;poll<20;poll++){
        await pause(250);
        try{snapshot=await runInTab(bridge,observeStudioDocument);}
        catch(error){if(error.message==='STUDIO_DID_NOT_RESPOND')continue;throw error;}
        if(snapshot.workflow&&snapshot.workflow!=='generate')throw Error('GENERATION_WORKSPACE_REQUIRED');
        if(snapshot.blockingDialog)throw Error('CLOSE_OTHER_DIALOGS_FIRST');
        if(verified(snapshot))return;
      }
    }
    // The bracketed detail is for diagnosis; FITA translates the code before it.
    let buttons='';
    try{const detail=await runInTab(bridge,observeStudioDocument,[{includeLayoutDiagnostic:true}]);buttons=(detail.layoutDiagnostic?.modeButtons||[]).map(b=>`${b.text}:${[].concat(b.classes||[]).join('.')}`).join(',');}catch{}
    throw Error(`${failure} [${control.name}: mode=${snapshot.generationMode} model=${snapshot.modelLabel} count=${snapshot.generationCount} input=${snapshot.mode} last=${JSON.stringify(last).slice(0,120)} buttons=${buttons.slice(0,200)}]`);
  }
  async function closeExport(){
    // Export completion and navigation can leave a short-lived notice mounted.
    // Re-observe it before reporting a blocker; unknown dialogs are never clicked.
    for(let attempt=0;attempt<13;attempt++){
      if(!snapshot.blockingDialog)return;
      const notice=await runInTab(bridge,studioNavigationControl,[{action:'close-notifications'}]);
      if(['closed','closing'].includes(notice.navigation)){await pause(250);snapshot=await runInTab(bridge,observeStudioDocument);if(!snapshot.blockingDialog)return;}
      try{await runInTab(bridge,exportStudioControl,[{step:'close',taskId:snapshot.currentTaskId}]);}
      catch(error){if(!error.message.startsWith('CLOSE_OTHER_DIALOGS_FIRST'))throw error;}
      await pause(250);snapshot=await runInTab(bridge,observeStudioDocument);
    }
    if(snapshot.blockingDialog){
      // Capture the state before opening the popup can dismiss a transient UI.
      // This file is local and contains only the selected page's dialog controls.
      try{
        const detail=await runInTab(bridge,observeStudioDocument,[{includeLayoutDiagnostic:true}]);
        const diagnostic={workerRevision:WORKER_REVISION,operationId:command.id,at:new Date().toISOString(),taskId:detail.currentTaskId,workflow:detail.workflow,dialogs:detail.layoutDiagnostic?.exportDialogs||[]};
        await chrome.downloads.download({url:'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(diagnostic,null,2)),filename:'FITA/studio-operation-diagnostic.json',saveAs:false,conflictAction:'overwrite'});
      }catch{/* Diagnostic failure must preserve the original blocker. */}
      throw new Error('CLOSE_OTHER_DIALOGS_FIRST');
    }
  }
  if(['prepare','observe'].includes(command.type))await closeExport();
  async function discover(submissionId){
    const key='workbenchBatch:'+submissionId,stored=(await chrome.storage.local.get(key))[key];
    if(!stored||stored.tabId!==bridge.tabId||stored.state!=='clicked')throw new Error('STUDIO_BATCH_CAPTURE_UNAVAILABLE');
    let previous=stored.observed||[],result;
    for(let i=0;i<8;i++){
      const after=await runInTab(bridge,observeStudioDocument);result=captureBatch(stored.before,after,previous);previous=result.ids;
      if(result.verified){await chrome.storage.local.set({[key]:{...stored,observed:result.ids}});return {stage:'candidates-found',candidateTaskIds:result.ids,batchAssociationVerified:true,association:'same-tab-post-submit-stable-links',existingTaskIds:stored.before.existingTaskIds};}
      await pause(500);
    }
    await chrome.storage.local.set({[key]:{...stored,observed:previous}});
    return {stage:'discovering',candidateTaskIds:[],batchAssociationVerified:false,observedNewTaskIds:previous};
  }
  if(command.type==='observe'&&payload.discoverSubmissionId)return discover(payload.discoverSubmissionId);
  async function navigateTask(taskId,workflow){
    await navigateStudioTask({chrome,runInTab,pause,bridge},taskId,workflow);
    snapshot=await runInTab(bridge,observeStudioDocument);
  }
  // Recover an already paid candidate from any Studio section. The shared
  // navigator rebuilds context from links, native cards and tools.
  // Never guess a task URL or replay Generate.
  if(['monitor','export'].includes(command.type)&&payload.navigateConfirmedTask===true){
    if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload.taskId||'')||payload.taskConfirmed!==true)throw Error('CONFIRM_THE_GENERATED_TASK_FIRST');
    if(payload.batchTaskIds){
      await runInTab(bridge,readStudioGenerationFailures,[{taskIds:payload.batchTaskIds,action:'close'}]);
      snapshot=await runInTab(bridge,observeStudioDocument);
    }
    await closeExport();
    const workflow=texture?'texture':'generate';
    if(snapshot.currentTaskId!==payload.taskId||snapshot.workflow&&snapshot.workflow!==workflow||!snapshot.supported){
      await navigateTask(payload.taskId,workflow);
    }
  }
  async function applyTextureSettings(){
    // A mode switch replaces the controls; do not reuse controls or demand a
    // synchronous render acknowledgement after clicking them.
    for(let i=0;i<24;i++){
      if(snapshot.currentTaskId!==payload.sourceTaskId||snapshot.blockingDialog)throw new Error('CONFIRMED_TASK_CHANGED');
      if(sameTextureSettings(snapshot.options?.texture,payload.settings)&&i>0)return;
      await runInTab(bridge,selectStudioTextureSettings,[payload.settings]);
      await pause(500);snapshot=await runInTab(bridge,observeStudioDocument);
    }
    if(!sameTextureSettings(snapshot.options?.texture,payload.settings))throw new Error('TEXTURE_SETTINGS_NOT_VERIFIED');
  }
  if(texture&&command.type==='prepare'){
    if(snapshot.currentTaskId!==payload.sourceTaskId)await navigateTask(payload.sourceTaskId,snapshot.workflow||'generate');
    if(snapshot.workflow!=='texture')await navigateTask(payload.sourceTaskId,'texture');
    await closeExport();
    await applyTextureSettings();
  }
  if(texture&&snapshot.workflow!=='texture')throw new Error('TEXTURE_WORKSPACE_REQUIRED');
  if(texture&&command.type==='observe'&&payload.refreshTextureSettings===true){
    if(snapshot.currentTaskId!==payload.sourceTaskId||snapshot.blockingDialog)throw new Error('CONFIRMED_TASK_CHANGED');
    await applyTextureSettings();
  }
  // Only free preparation may change tools. Passive observations and a paid
  // submit never navigate or reuse a snapshot from another workspace.
  if(!texture&&(command.type==='prepare'||command.type==='observe'&&payload.configureGenerationDefaults===true)&&
    (snapshot.generationWorkspaceReady===false||snapshot.workflow&&snapshot.workflow!=='generate'||!snapshot.supported)){
    const target=await runInTab(bridge,resolveStudioGenerationWorkspace);
    const current=await session();if(current?.token!==bridge.token||current.tabId!==bridge.tabId||!current.automationAuthorized)throw Error('AUTOMATION_NOT_AUTHORIZED');
    await chrome.tabs.update(bridge.tabId,{url:target.url});
    let arrived=false;
    for(let i=0,until=Date.now()+30000;i<120&&Date.now()<until;i++){
      await pause(250);
      try{snapshot=await runInTab(bridge,observeStudioDocument);}catch(error){if(error.message==='AUTOMATION_NOT_AUTHORIZED')throw error;continue;}
      if(snapshot.workflow==='generate'&&snapshot.generationWorkspaceReady===true&&snapshot.supported){arrived=true;break;}
    }
    if(!arrived)throw Error('GENERATION_WORKSPACE_NOT_LOADED');
  }
  if(!texture&&command.type==='submit'&&(snapshot.generationWorkspaceReady===false||snapshot.workflow&&snapshot.workflow!=='generate'))throw new Error('GENERATION_WORKSPACE_REQUIRED');
  if(!texture&&command.type==='observe'&&payload.configureGenerationDefaults===true){
    await closeExport();
    if(!snapshot.supported||snapshot.blockingDialog)throw new Error('CLOSE_OTHER_DIALOGS_FIRST');
    await generationSetting(selectStudioSmartMesh,s=>s.generationMode==='smart-mesh','SMART_MESH_REQUIRED');
    await generationSetting(selectStudioModelVersion,s=>s.generationMode==='smart-mesh'&&/^P2\.0(?:\s|$)/.test(s.modelLabel||''),'SMART_MESH_REQUIRED');
    if(snapshot.generationMode!=='smart-mesh'||!/^P2\.0(?:\s|$)/.test(snapshot.modelLabel||''))throw new Error('SMART_MESH_REQUIRED');
    await generationSetting(selectStudioFourResults,s=>s.generationCount===4,'FOUR_GENERATIONS_REQUIRED');
    await generationSetting(selectStudioMultiview,s=>s.mode==='multiview','FOUR_EMPTY_MULTIVIEW_SLOTS_REQUIRED');
    if(snapshot.generationCount!==4||snapshot.mode!=='multiview'||!snapshot.costLabel?.trim())throw new Error('STUDIO_COST_UNAVAILABLE');
    await generationTopology(true);
    return operationSnapshot(snapshot,'observed');
  }
  if(command.type==="observe")return {...operationSnapshot(snapshot,"observed"),...verifyExpectedInputs(snapshot,payload.expectedInputs),expectedInputs:payload.expectedInputs||[],layoutDiagnostic:snapshot.layoutDiagnostic};
  if(!snapshot.supported)throw new Error("STUDIO_INTERFACE_NOT_SUPPORTED");
  if(snapshot.blockingDialog){
    if(['monitor','export'].includes(command.type))await runInTab(bridge,exportStudioControl,[{step:'inspect',taskId:snapshot.currentTaskId}]);
    else throw new Error("CLOSE_OTHER_DIALOGS_FIRST");
  }
  if(command.type==="prepare"){
    const inputs=payload.inputs;
    const expectedInputs=await approvedInputManifest(inputs);
    if(!texture)await generationSetting(selectStudioSmartMesh,s=>s.generationMode==='smart-mesh','SMART_MESH_REQUIRED');
    if(!texture)await generationSetting(selectStudioModelVersion,s=>s.generationMode==='smart-mesh'&&/^P2\.0(?:\s|$)/.test(s.modelLabel||''),'SMART_MESH_REQUIRED');
    if(!texture&&(snapshot.generationMode!=="smart-mesh"||!/^P2\.0(?:\s|$)/.test(snapshot.modelLabel||"")))throw new Error("SMART_MESH_REQUIRED");
    if(!texture)await generationSetting(selectStudioFourResults,s=>s.generationCount===4,'FOUR_GENERATIONS_REQUIRED');
    if(!texture&&snapshot.generationCount!==4)throw new Error("FOUR_GENERATIONS_REQUIRED");
    if(!texture)await generationSetting(selectStudioMultiview,s=>s.mode==='multiview','FOUR_EMPTY_MULTIVIEW_SLOTS_REQUIRED');
    if(texture&&snapshot.mode!=="multiview"){
      await runInTab(bridge,selectStudioMultiview);
      for(let i=0;i<20;i++){await pause(250);snapshot=await runInTab(bridge,observeStudioDocument);if(snapshot.mode==="multiview")break;}
    }
    if(snapshot.mode!=="multiview")throw new Error("FOUR_EMPTY_MULTIVIEW_SLOTS_REQUIRED");
    if(!texture&&(snapshot.generationMode!=="smart-mesh"||snapshot.generationCount!==4))throw new Error("SMART_MESH_FOUR_RESULTS_SETTINGS_CHANGED");
    // Entering multiview may restore Studio's saved front reference. Reconcile
    // AFTER that transition, and re-read each slot before touching it. Reuse only
    // content-proven images; matching names or dimensions are never sufficient.
    for(const slot of [...inputs.map(input=>input.slot),...['front','left','right','back'].filter(slot=>!inputs.some(input=>input.slot===slot))]){
      const input=inputs.find(entry=>entry.slot===slot),expected=expectedInputs.find(entry=>entry.slot===slot);
      for(let i=0;i<20;i++){
        snapshot=await runInTab(bridge,observeStudioDocument);
        if(snapshot.blockingDialog)throw new Error('CLOSE_OTHER_DIALOGS_FIRST');
        if(texture&&(snapshot.workflow!=='texture'||snapshot.currentTaskId!==payload.sourceTaskId))throw new Error('CONFIRMED_TASK_CHANGED');
        if(snapshot.slots?.[slot]?.occupied||snapshot.slots?.[slot]?.acceptsImages)break;
        await pause(200);
      }
      const current=snapshot.slots?.[slot];
      if(expected&&current?.previewVisible&&!verifyExpectedInputs(snapshot,[expected]).readinessErrors.includes(`FILE_CONTENT_MISMATCH_${slot.toUpperCase()}`))continue;
      if(current?.occupied){
        if(snapshot.mode!=="multiview"||Object.values(snapshot.slots).some(entry=>!entry.found||entry.semanticBinding!=='observed-multiview-card'))throw new Error("MULTIVIEW_REPLACEMENT_NOT_VERIFIED");
        await runInTab(bridge,clearStudioView,[slot]);
        for(let i=0;i<20;i++){await pause(200);snapshot=await runInTab(bridge,observeStudioDocument);if(!snapshot.slots[slot]?.occupied&&snapshot.slots[slot]?.acceptsImages)break;}
        if(snapshot.slots[slot]?.occupied||!snapshot.slots[slot]?.acceptsImages)throw new Error(`REPLACEMENT_SLOT_NOT_CLEARED_${slot.toUpperCase()}`);
      }
      if(!snapshot.slots?.[slot]?.acceptsImages)throw new Error("FOUR_EMPTY_MULTIVIEW_SLOTS_REQUIRED");
      if(input){await runInTab(bridge,uploadStudioView,[{...input,sha256:expected.sha256,operationId:command.id}]);await pause(50);}
    }
    for(let i=0;i<240;i++){
      snapshot=await runInTab(bridge,observeStudioDocument);
      const proof=verifyExpectedInputs(snapshot,expectedInputs);
      if(proof.readinessErrors.some((error)=>error.startsWith("UNEXPECTED_OCCUPIED_SLOT_")))throw new Error(proof.readinessErrors.find((error)=>error.startsWith("UNEXPECTED_OCCUPIED_SLOT_")));
      if(proof.preparationReady&&(!texture||snapshot.currentTaskId===payload.sourceTaskId&&sameTextureSettings(snapshot.options?.texture,payload.settings))){
        if(!texture){await generationTopology(true);if(!verifyExpectedInputs(snapshot,expectedInputs).preparationReady)continue;}
        return {...operationSnapshot(snapshot,"prepared"),...proof,expectedInputs:expectedInputs.map((expected)=>({...expected,...(snapshot.slots[expected.slot].receipt?{receipt:snapshot.slots[expected.slot].receipt}:{})}))};
      }
      await pause(250);
    }
    throw new Error("PREPARATION_NOT_READY_CHECK_STUDIO_NO_GENERATION_SENT");
  }
  if(command.type==="submit"){
    const expected=payload.expectedSnapshot;
    // The user may have touched Tripo since the quote. Restore the confirmed
    // free settings first (Smart Mesh, P2.0, four results, multiview, Quad and
    // polygon limits); the page signature and price must then still match.
    if(!texture)try{
      await generationSetting(selectStudioSmartMesh,s=>s.generationMode==='smart-mesh','SMART_MESH_REQUIRED');
      await generationSetting(selectStudioModelVersion,s=>s.generationMode==='smart-mesh'&&/^P2\.0(?:\s|$)/.test(s.modelLabel||''),'SMART_MESH_REQUIRED');
      await generationSetting(selectStudioFourResults,s=>s.generationCount===4,'FOUR_GENERATIONS_REQUIRED');
      await generationSetting(selectStudioMultiview,s=>s.mode==='multiview','FOUR_EMPTY_MULTIVIEW_SLOTS_REQUIRED');
      await generationTopology(true);
    }catch(error){error.beforeSubmit=true;throw error;}
    if(payload.confirmCost!==true||typeof payload.confirmationNonce!=="string"||!payload.confirmationNonce||!expected?.pageSignature||expected.pageSignature!==snapshot.pageSignature||expected.costLabel!==snapshot.costLabel)throw new Error("CONFIRMED_INPUTS_OPTIONS_OR_COST_CHANGED");
    if(!verifyExpectedInputs(snapshot,expected.expectedInputs).preparationReady)throw new Error("GENERATION_NOT_READY");
    const batchKey='workbenchBatch:'+command.id;
    if(!texture)await chrome.storage.local.set({[batchKey]:{tabId:bridge.tabId,state:'clicked',before:{existingTaskIds:snapshot.existingTaskIds,currentTaskId:snapshot.currentTaskId},createdAt:new Date().toISOString()}});
    await runInTab(bridge,clickStudioGenerate,[snapshot.generateLabel]);
    await pause(1500);
    const after=await runInTab(bridge,observeStudioDocument);
    const candidate=after.currentTaskId&&!snapshot.existingTaskIds.includes(after.currentTaskId)&&after.currentTaskId!==snapshot.currentTaskId?after.currentTaskId:null;
    const observedNewTaskIds=[...new Set([...(after.existingTaskIds||[]),...(candidate?[candidate]:[])])].filter((id)=>!snapshot.existingTaskIds.includes(id)&&id!==snapshot.currentTaskId);
    let batch={};
    if(!texture)try{batch=await discover(command.id);}catch(error){batch={batchAssociationVerified:false,captureError:error.message};}
    const timing=texture?textureTiming(after,after.currentTaskId):{};
    return {...batch,stage:"submitted",candidateTaskId:candidate,observedNewTaskIds,currentTaskId:after.currentTaskId,existingTaskIds:snapshot.existingTaskIds,taskNeedsConfirmation:!batch.batchAssociationVerified,costLabel:snapshot.costLabel,generationCount:snapshot.generationCount,...timing};
  }
  if(["monitor","export"].includes(command.type)){
    if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload.taskId||"")||payload.taskConfirmed!==true)throw new Error("CONFIRM_THE_GENERATED_TASK_FIRST");
    if(!texture&&payload.batchTaskIds){
      const evidence=await runInTab(bridge,readStudioGenerationFailures,[{taskIds:payload.batchTaskIds,action:'watch'}]);
      if(payload.submissionId&&evidence.failures.length)await chrome.storage.local.set({['workbenchFailures:'+payload.submissionId]:evidence.failures});
      if(evidence.failures.some(f=>f.taskId===payload.taskId))return {stage:'unknown',taskId:payload.taskId,candidateFailures:evidence.failures,failureVerificationVersion:1,errorCode:'STUDIO_REMOTE_GENERATION_FAILED'};
    }
    if(snapshot.currentTaskId!==payload.taskId||snapshot.workflow==='smart-uv'||payload.navigateConfirmedTask===true&&snapshot.workflow&&snapshot.workflow!==(texture?'texture':'generate'))throw new Error("CONFIRM_THE_GENERATED_TASK_FIRST");
    const exportUi=snapshot.blockingDialog?await runInTab(bridge,exportStudioControl,[{step:'inspect',taskId:payload.taskId}]):null;
    const timing=texture?textureTiming(snapshot,payload.taskId):{};
    const textureProcessing=texture&&timing.processing;
    // The old untextured model is visible while its replacement is starting.
    // Only export after processing has actually been seen for this submission.
    const ready=!textureProcessing&&(!texture||payload.processingObserved===true)&&(snapshot.modelReady||exportUi?.exportDialogOpen===true);
    if(command.type==="monitor"){
      let previews=[];
      if(!texture&&Array.isArray(payload.previewTaskIds))try{previews=await runInTab(bridge,readCandidatePreviews,[payload.previewTaskIds]);}catch{}
      return {stage:ready?"ready":"processing",taskId:payload.taskId,progress:null,exportAvailable:ready,previews,...timing};
    }
    if(!ready)throw new Error("CONFIRMED_MODEL_NOT_READY_FOR_EXPORT");
    if(texture&&!payload.exportRevision)throw new Error('INVALID_EXPORT_REVISION');
    const exported=await nativeGlbExport(bridge,payload.taskId,{operationId:command.id,downloadRecovery:payload.downloadRecovery,directExportTransfer:payload.directExportTransfer===true,exportRevision:texture?payload.exportRevision:null,format:!texture&&payload.sourceFormat==='FBX'?'FBX':'GLB'});
    try{await runInTab(bridge,exportStudioControl,[{step:'close',taskId:payload.taskId}]);}catch(error){exported.cleanupWarning=error.message;}
    return exported;
  }
  throw new Error("UNSUPPORTED_STUDIO_COMMAND");
}
const groupCommand=createGroupCommands({chrome,runInTab,pause,legacy:performStudioCommand,exportGlb:nativeGlbExport,importMesh:createMeshImporter({runInTab}),workerRevision:WORKER_REVISION});
async function processCommand(bridge,command) {
  if(command.tabId!==bridge.tabId)return;
  const step=guardStep(command);
  if(!step)return processCommandOnce(bridge,command);
  clearTimeout(guardHideTimer);activeCommand=command.id;
  try{
    const guard=await guardState();
    // While paused, generation monitors are answered without touching Tripo:
    // the remote job keeps running and nothing is given up.
    if(guard.paused&&guard.tabId===bridge.tabId&&command.type==='monitor'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(command.payload?.taskId||'')){
      await request("operation-result",{id:command.id,status:'complete',result:{stage:'processing',taskId:command.payload.taskId,progress:null,exportAvailable:false,previews:[],pausedByUser:true}},bridge.token);
      return;
    }
    if(!guard.paused)await setGuard(bridge.tabId,{active:true,step});
    return await processCommandOnce(bridge,command);
  }finally{
    activeCommand=null;
    guardHideTimer=setTimeout(()=>void guardIdle(bridge.tabId),GUARD_IDLE_MS);
  }
}
// Hide the wall only after a short quiet period, so a multi-command flow
// (prepare, submit, monitor, export) is not left uncovered between commands.
async function guardIdle(tabId){
  if(activeCommand)return;
  const guard=await guardState();
  if(guard.active&&!guard.paused&&guard.tabId===tabId)await setGuard(tabId,{active:false,step:null});
}
async function processCommandOnce(bridge,command) {
  let saved=(await session())?.lastOperation;
  if(saved?.id!==command.id){
    const current=await session();if(current?.token!==bridge.token)return;
    saved={id:command.id,status:"started"};await save({...current,lastOperation:saved});
    try{saved={id:command.id,status:"complete",result:await performStudioCommand(bridge,command)};}
    catch(error){const definitelyBeforeSubmit=error.beforeSubmit===true||["FITA_PAUSED_BY_USER","CONFIRMED_INPUTS_OPTIONS_OR_COST_CHANGED","GENERATION_NOT_READY","STUDIO_INTERFACE_NOT_SUPPORTED","CLOSE_OTHER_DIALOGS_FIRST"].includes(error.message);saved={id:command.id,status:"complete",error:error.message||"STUDIO_OPERATION_FAILED",outcome:(["submit","generate"].includes(command.type)||command.type==='rig'&&command.payload?.action==='submit')&&!definitelyBeforeSubmit?"unknown":"failed"};}
    const latest=await session();if(latest?.token!==bridge.token)return;
    await save({...latest,lastOperation:saved});
  }else if(saved.status==="started"){
    if(command.type==='monitor'||command.type==='observe'&&!command.payload?.configureGenerationDefaults&&!command.payload?.refreshTextureSettings&&!command.payload?.discoverSubmissionId){
      try{saved={id:command.id,status:'complete',result:await performStudioCommand(bridge,command)};}
      catch(error){saved={id:command.id,status:'complete',error:error.message,outcome:'failed'};}
      const latest=await session();if(latest?.token!==bridge.token)return;await save({...latest,lastOperation:saved});
    }else saved={id:command.id,error:"OPERATION_INTERRUPTED_CHECK_STUDIO_BEFORE_RETRYING",outcome:"unknown"};
  }
  await request("operation-result",saved,bridge.token);
}
async function cycle() {
  if (busy&&Date.now()-busySince>BUSY_LIMIT_MS) {
    try{await chrome.storage.local.set({workbenchStuckCycle:{at:new Date().toISOString(),since:new Date(busySince).toISOString(),phase:busyPhase,workerRevision:WORKER_REVISION}});}catch{}
    // A late result from the stuck cycle can no longer save or report state.
    authorizationEpoch++;busy=false;lastInspection=null;
  }
  if (busy) {await commandHeartbeat();await guardKeepAlive();return;}
  busy = true;busySince=Date.now();phase('cycle');const thisCycle=++cycleSeq;
  const epoch=authorizationEpoch;
  let cycleToken = null,processed=false;
  try {
    let bridge = await session();
    if (!bridge?.token) {phase('resume');bridge=await resumeRemembered();}
    if (!bridge?.token) return;
    if (!Number.isInteger(bridge.tabId)) {
      // Resumed without a Tripo tab: adopt one as soon as it is open.
      const device=await rememberedBrowser(),tab=device?adoptableTab(await chrome.tabs.query({url:`${STUDIO}/*`}),device):null;
      if(!tab)return 5000;
      bridge={...bridge,tabId:tab.id,tabWindowId:tab.windowId,resumeUrl:resumeUrl(tab.url)||bridge.resumeUrl,closedTabId:null};
      await save(bridge);await remember({lastTabId:tab.id,tabWindowId:tab.windowId});lastInspection=null;
    }
    cycleToken = bridge.token;
    phase('guard');await guardKeepAlive();
    if(bridge.closedTabId){
      const studioTabs=await chrome.tabs.query({url:`${STUDIO}/*`}),device=await rememberedBrowser();
      const replacement=reopenedTab(bridge,studioTabs)||(device?.automationAuthorized&&bridge.automationAuthorized?adoptableTab(studioTabs.filter(t=>t.id!==bridge.closedTabId),device):null);
      if(!replacement)return 1000;
      const previousTabId=bridge.closedTabId;
      if(resumeUrl(replacement.url)!==bridge.resumeUrl)await chrome.tabs.update(replacement.id,{url:bridge.resumeUrl});
      const fresh=await inspect(replacement.id);
      const latest=await session();if(latest?.token!==bridge.token||epoch!==authorizationEpoch)return;
      await request('heartbeat',{...fresh,automationAuthorized:true,resumePreviousTabId:previousTabId},bridge.token);
      bridge={...latest,tabId:replacement.id,closedTabId:null,readable:true,lastError:null};await save(bridge);await remember({lastTabId:replacement.id,tabWindowId:replacement.windowId});lastInspection=null;
    }
    let snapshot;
    try {
      if(lastInspection?.token===bridge.token&&lastInspection.tabId===bridge.tabId&&Date.now()-lastInspection.at<15000)snapshot=lastInspection.snapshot;
      else {phase('inspect');snapshot=await inspect(bridge.tabId);lastInspection={token:bridge.token,tabId:bridge.tabId,at:Date.now(),snapshot};}
    }
    catch {
      await request("heartbeat", { tab: null, inspection: null, suspended:true }, bridge.token);
      if ((await session())?.token === bridge.token)
        await save({ ...bridge, readable: false, lastError: "Esperando que Tripo termine de cargar o que se vuelva a abrir su pestaña." });
      lastInspection=null;return 10000;
    }
    if(epoch!==authorizationEpoch)return;
    phase('heartbeat');const acknowledged=await request("heartbeat", {...snapshot,automationAuthorized:bridge.automationAuthorized===true}, bridge.token);
    phase('poll');const { command } = await request("poll", {}, bridge.token);
    if (command?.type === "inspect" && command.tabId === bridge.tabId) {
      const current = await inspect(bridge.tabId);
      await request("result", { id: command.id, inspection: current.inspection }, bridge.token);
    }else if(command&&bridge.automationAuthorized){phase('command:'+command.type);await processCommand(bridge,command);lastInspection=null;processed=true;}
    phase('save');
    // Do not restore credentials after a concurrent explicit disconnect.
    const current=await session();
    if (current?.token === bridge.token&&epoch===authorizationEpoch)
      await save({ ...current, resumeUrl:resumeUrl((await chrome.tabs.get(current.tabId)).url)||current.resumeUrl,readable: true,adapterVersion:snapshot.adapter?.adapterVersion??null,preparationAvailable:(acknowledged.preparationAvailable??acknowledged.generationAvailable)===true,lastSeen: new Date().toISOString(), lastError:snapshot.adapterError||null });
    // Flows send their next command right away: poll again soon after one.
    if(processed)return 250;
  } catch (error) {
    const bridge = await session();
    if (bridge && bridge.token === cycleToken) {
      if ([401, 403].includes(error.status)) {
        await chrome.storage.session.remove("bridge");lastInspection=null;
        if((await rememberedBrowser())?.credential){void resumeRemembered();return 2000;}
        await chrome.alarms.clear(ALARM);
      } else await save({ ...bridge, readable: false, lastError: "No se pudo contactar al taller local. Comprueba que siga abierto." });
    }
    lastInspection=null;return 10000;
  } finally { if(thisCycle===cycleSeq){busy = false;phase('idle');} }
}
async function disconnect() {
  connectionLoop.stop();lastInspection=null;
  authorizationEpoch++;
  const bridge = await session();
  if(Number.isInteger(bridge?.tabId)){clearTimeout(guardHideTimer);await setGuard(bridge.tabId,{active:false,paused:false,step:null});}
  await chrome.storage.session.remove("bridge");
  await forgetBrowser();
  await chrome.alarms.clear(ALARM);
  await chrome.contentSettings?.automaticDownloads?.clear({scope:'regular'});
  if (bridge?.token) {
    try { await request("disconnect", {}, bridge.token); }
    catch { return { notice: "Desconectado aquí. Si el taller estaba apagado, su sesión vencerá o puedes revocarla desde Configuración." }; }
  }
  return { notice: "Conexión revocada." };
}
async function handle(message) {
  if (message.type === "status") {
    const bridge = await session();
    const tabs = (await chrome.tabs.query({ url: `${STUDIO}/*` }))
      .map((tab) => ({ id: tab.id, title: tab.title || "Tripo Studio" }));
    return {
      extensionId: chrome.runtime.id, tabs,workerRevision:WORKER_REVISION,remembered:!!(await rememberedBrowser())?.credential,
      bridge: bridge ? { paired: true, tabId: bridge.tabId, readable: !!(bridge.readable && Date.now() - Date.parse(bridge.lastSeen) < 90000), lastSeen: bridge.lastSeen, lastError: bridge.lastError,automationAuthorized:bridge.automationAuthorized===true,adapterVersion:bridge.adapterVersion??null,preparationAvailable:bridge.preparationAvailable===true } : null,
    };
  }
  if (message.type === "open") { await chrome.tabs.create({ url: `${STUDIO}/workspace/generate` }); return {}; }
  if (message.type === "pair") {
    if (!/^\d{8}$/.test(message.code || "")) throw new Error("Introduce el código temporal de ocho cifras del taller.");
    await disconnect();
    const epoch = authorizationEpoch;
    const result = await request("pair", { code: message.code });
    if (authorizationEpoch !== epoch) throw new Error("Conexión revocada.");
    await save({ token: result.token, expiresAt: result.expiresAt, tabId: null, readable: false });
    if(typeof result.deviceCredential==='string')await chrome.storage.local.set({[DEVICE_KEY]:{credential:result.deviceCredential}});
    return {};
  }
  if (message.type === "connect") {
    const epoch = ++authorizationEpoch;
    const bridge = await session();
    if (!bridge?.token) throw new Error("Empareja primero con el código temporal.");
    if (!Number.isInteger(message.tabId)) throw new Error("Elige una pestaña de Tripo Studio.");
    const snapshot = await inspect(message.tabId);
    const acknowledged=await request("heartbeat", {...snapshot,automationAuthorized:message.automationAuthorized===true}, bridge.token);
    if (authorizationEpoch !== epoch || (await session())?.token !== bridge.token) throw new Error("Conexión revocada.");
    const requested=message.automationAuthorized===true;
    // A readable Studio tab is a valid connection even outside generation.
    // Specific operations keep their own workflow, source and price checks.
    const diagnostic=requested?(snapshot.adapterError||(snapshot.adapter?.supported&&!acknowledged.generationAvailable?"COMMANDS_NOT_ACKNOWLEDGED":null)):null;
    const selectedTab=await chrome.tabs.get(message.tabId),priorTabs=await chrome.tabs.query({url:`${STUDIO}/*`});
    await save({ ...bridge, tabId: message.tabId,tabWindowId:selectedTab.windowId,resumeUrl:resumeUrl(selectedTab.url),priorTabIds:priorTabs.map(t=>t.id),closedTabId:null, automationAuthorized:requested&&snapshot.adapter?.adapterVersion===2,adapterVersion:snapshot.adapter?.adapterVersion??null,preparationAvailable:(acknowledged.preparationAvailable??acknowledged.generationAvailable)===true,readable: true, lastSeen: new Date().toISOString(), lastError: diagnostic });
    await remember({automationAuthorized:requested&&snapshot.adapter?.adapterVersion===2,lastTabId:message.tabId,tabWindowId:selectedTab.windowId,resumeUrl:resumeUrl(selectedTab.url)});
    await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
    lastInspection=null;connectionLoop.start();
    if(diagnostic)throw new Error(diagnostic);
    return {workerRevision:WORKER_REVISION,automationAuthorized:requested,preparationAvailable:(acknowledged.preparationAvailable??acknowledged.generationAvailable)===true};
  }
  if (message.type === "disconnect") return disconnect();
  if (message.type === "refresh") { lastInspection=null;await cycle(); return {}; }
  if(message.type==="diagnostics"){
    const bridge=await session();
    if(!bridge?.token||!Number.isInteger(bridge.tabId))throw new Error("Elige una pestaña de Tripo Studio.");
    const result=bridge.automationAuthorized?await runInTab(bridge,observeStudioDocument,[{includeFileHashes:true,includeLayoutDiagnostic:true}]):(await inspect(bridge.tabId)).adapter;
    return {workerRevision:WORKER_REVISION,diagnostic:result};
  }
  throw new Error("Acción no disponible: esta versión solo permite conectar e inspeccionar.");
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Pause/Continue from the glass wall injected in the authorized Studio tab.
  if(message?.type==='fita-guard'&&sender.id===chrome.runtime.id&&Number.isInteger(sender.tab?.id)&&['pause','resume'].includes(message.action)){
    void (async()=>{
      const bridge=await session();
      if(bridge?.tabId!==sender.tab.id)return sendResponse({ok:false});
      const paused=message.action==='pause';
      await setGuard(bridge.tabId,{paused,active:!paused&&!!activeCommand});
      sendResponse({ok:true,paused});
    })();
    return true;
  }
  // No website, content script or other extension can invoke privileged popup operations.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return false;
  handle(message).then((value) => sendResponse({ ok: true, ...value }), (error) => sendResponse({ ok: false, error: error.message || "No se pudo completar la acción." }));
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) connectionLoop.start(); });
// Browser start and extension reload: reconnect a remembered browser.
chrome.runtime.onStartup?.addListener(()=>{void resumeRemembered();});
chrome.runtime.onInstalled?.addListener(()=>{void resumeRemembered();});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const bridge = await session();
  if (bridge?.tabId === tabId) {lastInspection=null;await save({...bridge,closedTabId:tabId,readable:false});void cycle();}
});
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (change.status !== "complete" && !change.url) return;
  const bridge=await session();if (bridge?.tabId === tabId||bridge?.closedTabId) {lastInspection=null;void cycle();}
  // A reload removes the wall from the page; put it back while it is needed.
  if(bridge?.tabId===tabId&&change.status==='complete'){const guard=await guardState();if(guard.tabId===tabId&&(guard.active||guard.paused))await renderGuard(tabId,guard,true);}
});
// Alarms may be cleared by browser restarts; session tokens do not survive
// them, but a remembered browser resumes with its own credential.
void session().then(async (bridge) => {
  if (bridge?.token) {
    if(!(await chrome.alarms.get(ALARM)))await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
    connectionLoop.start();
  } else void resumeRemembered();
});

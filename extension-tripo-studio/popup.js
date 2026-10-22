import { messages, translateError } from "./popup-i18n.js";
import { observeStudioDocument,STUDIO_WORKER_REVISION } from "./studio-adapter.js";
import { uvRecoveryDiagnostic } from './uv-recovery-diagnostic.js';
const $ = (id) => document.getElementById(id);
let language = "en";
const EXPECTED_WORKER = STUDIO_WORKER_REVISION;
let workerRevision = null;
const t = (key) => messages[language][key] || messages.en[key];
function translate() {
  document.documentElement.lang = language;
  document.title = t("heading");
  $("language").value = language;
  for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
  $("code").placeholder = t("codeHint");
  $("tabs").setAttribute("aria-label", t("step3"));
}
async function send(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (!result?.ok) throw new Error(result?.error || "No respondió la extensión. Vuelve a abrir su panel.");
  return result;
}
function message(text, error = false) { $("status").textContent = text; $("status").className = error ? "error" : ""; }
async function render() {
  const result = await send("status");
  workerRevision=result.workerRevision;
  $("extension-id").value = result.extensionId;
  const chosen = $("tabs").value;
  $("tabs").replaceChildren();
  for (const tab of result.tabs) {
    const option = document.createElement("option");
    option.value = tab.id; option.textContent = tab.title;
    $("tabs").append(option);
  }
  if (!result.tabs.length) {
    const option = document.createElement("option"); option.textContent = t("noTabs"); option.value = ""; $("tabs").append(option);
  } else if (result.tabs.some((tab) => String(tab.id) === chosen)) $("tabs").value = chosen;
  else if (result.bridge?.tabId != null) $("tabs").value = String(result.bridge.tabId);
  $("connect").disabled = !result.bridge?.paired || !result.tabs.length;
  $("disconnect").disabled = !result.bridge?.paired;
  // Diagnostics execute directly in this popup after checking the current tab
  // authorization; an older worker does not make those reads unsafe.
  $("diagnostics").disabled=!result.bridge?.paired||!Number.isInteger(result.bridge?.tabId);
  $("save-diagnostics").disabled=$("diagnostics").disabled||!result.bridge?.automationAuthorized;
  $("reload-extension").hidden=workerRevision===EXPECTED_WORKER;
  if(workerRevision!==EXPECTED_WORKER){message(t('reloadWorker'),true);return;}
  message(result.bridge?.lastError ? translateError(result.bridge.lastError, language) : t(result.bridge?.readable ? (result.bridge.preparationAvailable?"automationReady":result.bridge.automationAuthorized?"connectedWorkspace":"readable") : result.bridge?.paired ? "paired" : "offline"), !!result.bridge?.lastError);
}
let acting = false;
async function localDiagnostic(saveFile=false){
  if(acting)return;acting=true;
  try{
    message(t('checking'));
    const before=await send('status'),tabId=before.bridge?.tabId;
    if(!before.bridge?.paired||!before.bridge?.automationAuthorized||!Number.isInteger(tabId))throw new Error('Elige una pestaña de Tripo Studio.');
    const tab=await chrome.tabs.get(tabId);
    if(new URL(tab.url).origin!=='https://studio.tripo3d.ai')throw new Error('La pestaña elegida ya no está en Tripo Studio. Selecciónala de nuevo.');
    const diagnostic=(await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:observeStudioDocument,args:[{includeFileHashes:true,includeLayoutDiagnostic:true}]}))[0]?.result;
    const after=await send('status');
    if(!after.bridge?.paired||!after.bridge?.automationAuthorized||after.bridge.tabId!==tabId)throw new Error('Conexión revocada.');
    if(!diagnostic?.layoutDiagnostic)throw new Error('ADAPTER_NO_RESPONSE');
    const receipts=(await chrome.storage.local.get('studioDownloadReceiptsV1')).studioDownloadReceiptsV1||{};
    const lastOperation=(await chrome.storage.session.get('bridge')).bridge?.lastOperation;
    const receipt=Object.values(receipts).filter(r=>r.taskId===diagnostic.currentTaskId).sort((a,b)=>(b.clickAt||0)-(a.clickAt||0))[0];
    const downloadDiagnostic={receiptState:receipt?.state||null,correlation:receipt?.correlation||null,operationId:receipt?.operationId||null,events:[],lastOperation:lastOperation?{id:lastOperation.id,status:lastOperation.status,error:lastOperation.error||null,stage:lastOperation.result?.stage||null,reason:lastOperation.result?.reason||null,taskId:lastOperation.result?.taskId||null}:null};
    if(receipt?.taskId===diagnostic.currentTaskId){
      const ids=[...new Set([receipt.nativeId,receipt.id,...(receipt.downloadIds||[])])].filter(Number.isInteger).slice(0,8);
      for(const id of ids){
        const [item]=await chrome.downloads.search({id});
        downloadDiagnostic.events.push(item?{id:item.id,startTime:item.startTime,state:item.state,danger:item.danger||null,paused:item.paused===true,canResume:item.canResume===true,error:item.error||null,ownedByExtension:item.byExtensionId===chrome.runtime.id,hasExtensionAttribution:typeof item.byExtensionId==='string',filenameExtension:item.filename?.match(/\.[a-z0-9]{1,8}$/i)?.[0]?.toLowerCase()||null,bytesReceived:item.bytesReceived,totalBytes:item.totalBytes,native:id===receipt.nativeId,managed:id===receipt.id}:{id,unavailable:true});
      }
    }
    const failedScript=(await chrome.storage.local.get('workbenchLastScriptFailure')).workbenchLastScriptFailure;
    const scriptFailure=failedScript?{at:failedScript.at,workerRevision:failedScript.workerRevision,function:failedScript.function,action:failedScript.action,reason:failedScript.reason}:null;
    const uvOperations=uvRecoveryDiagnostic(await chrome.storage.local.get(null),diagnostic.currentTaskId);
    const report=JSON.stringify({source:'popup-read-only',diagnosticVersion:5,workerRevision:before.workerRevision,...diagnostic,downloadDiagnostic,scriptFailure,uvOperations},null,2);
    $('diagnostic-report').hidden=false;$('diagnostic-report').textContent=report;
    if(saveFile){
      const url=URL.createObjectURL(new Blob([report],{type:'application/json'}));
      try{await chrome.downloads.download({url,filename:'FITA/studio-layout-diagnostic.json',saveAs:false,conflictAction:'overwrite'});}finally{setTimeout(()=>URL.revokeObjectURL(url),10000);}
      message(t('diagnosticSaved'));
    }else message(t('diagnosticHint'));
  }catch(error){message(translateError(error.message,language),true);}finally{acting=false;}
}
async function act(type, data) {
  if (acting) return;
  acting = true;
  try {
    message(t("checking"));
    if(type==='connect'&&workerRevision!==EXPECTED_WORKER)throw new Error('WORKER_RELOAD_REQUIRED');
    const result = await send(type, data);
    if (type === "pair") $("code").value = "";
    await render();
    if(result.diagnostic){$("diagnostic-report").hidden=false;$("diagnostic-report").textContent=JSON.stringify({workerRevision:result.workerRevision,...result.diagnostic},null,2);}
    if (result.notice) message(translateError(result.notice, language));
  } catch (error) { message(translateError(error.message, language), true); }
  finally { acting = false; }
}
$("open").addEventListener("click", () => act("open"));
$("pair").addEventListener("click", () => act("pair", { code: $("code").value.trim() }));
$("connect").addEventListener("click", () => act("connect", { tabId: Number($("tabs").value),automationAuthorized:$("automation").checked }));
$("refresh").addEventListener("click", () => act("refresh"));
$("reload-extension").addEventListener("click", () => chrome.runtime.reload());
$("disconnect").addEventListener("click", () => act("disconnect"));
$("diagnostics").addEventListener("click",()=>localDiagnostic());
$("save-diagnostics").addEventListener("click",()=>localDiagnostic(true));
$("extension-id").addEventListener("click", () => $("extension-id").select());
$("language").addEventListener("change", async () => {
  language = $("language").value;
  await chrome.storage.local.set({ language });
  translate();
  await render().catch((error) => message(translateError(error.message, language), true));
});
const preference = (await chrome.storage.local.get("language")).language;
if (messages[preference]) language = preference;
translate();
void render().catch((error) => message(translateError(error.message, language), true));

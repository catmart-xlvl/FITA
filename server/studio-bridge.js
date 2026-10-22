import express from "express";
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { glbBuffer } from './validation.js';
import {fbxBuffer,isFbx} from './candidate-topology.js';
import {generationLimits} from '../shared/generation-profile.js';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const STUDIO_ORIGIN = "https://studio.tripo3d.ai";
const EXTENSION_ID = /^[a-p]{32}$/;
const safeEqual = (a, b) => typeof a === "string" && typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const bounded = (n) => Number.isSafeInteger(n) && n >= 0 ? Math.min(n, 100000) : 0;
const cleanTitle = (s) => typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) : "Tripo Studio";

// The path/search/hash can carry personal identifiers or access tokens. Store only the origin.
function tabSummary(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id < 0) return null;
  try {
    const url = new URL(value.url);
    if (url.origin !== STUDIO_ORIGIN || url.username || url.password) return null;
    return { id: value.id, url: STUDIO_ORIGIN, title: cleanTitle(value.title) };
  } catch { return null; }
}
function inspectionSummary(value) {
  if (!value || value.origin !== STUDIO_ORIGIN || value.acknowledged !== true) return null;
  return {
    origin: STUDIO_ORIGIN,
    readyState: ["loading", "interactive", "complete"].includes(value.readyState) ? value.readyState : "unknown",
    visibleButtons: bounded(value.visibleButtons),
    disabledButtons: bounded(value.disabledButtons),
    fileInputs: bounded(value.fileInputs),
    canvases: bounded(value.canvases),
    loginVerified: false,
    generationValidated: false,
  };
}

/** Mount BEFORE the application's generic Origin/CSRF middleware. This router checks both itself.
 * Session tokens live only in memory. A paired browser also keeps a long-lived
 * device credential; only its SHA-256 is stored (devicesFile), so the extension
 * can resume after a server or browser restart without a new pairing code.
 * Disconnect revokes both. Unused devices expire after deviceTtlMs.
 */
export function mountStudioBridge(app, {
  csrf,
  host = "127.0.0.1:4317",
  now = Date.now,
  pairingTtlMs = 120000,
  sessionTtlMs = 8 * 60 * 60 * 1000,
  heartbeatTtlMs = 90000,
  devicesFile = null,
  deviceTtlMs = 30 * 24 * 60 * 60 * 1000,
  onOperationResult = async () => {},
  downloadsDir = path.join(os.homedir(), 'Downloads'),
} = {}) {
  if (!csrf || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Configuración local del puente inválida.");
  const router = express.Router();
  let pairing = null, session = null, pending = null;
  // Remembered browsers: {id, extensionId, hash, createdAt, lastUsedAt}. The
  // credential itself is never stored here.
  const digestOf=value=>createHash('sha256').update(String(value)).digest('hex');
  let devices=[];
  try{devices=devicesFile?JSON.parse(readFileSync(devicesFile,'utf8')).devices||[]:[];}catch{devices=[];}
  devices=devices.filter(d=>d&&EXTENSION_ID.test(d.extensionId||'')&&/^[a-f0-9]{64}$/.test(d.hash||'')&&now()-Date.parse(d.lastUsedAt||d.createdAt||0)<deviceTtlMs);
  let resumeFailures=0,resumeLockedUntil=0;
  async function saveDevices(){
    if(!devicesFile)return;
    const temp=devicesFile+'.tmp';
    await fs.writeFile(temp,JSON.stringify({version:1,devices},null,1),{mode:0o600});
    await fs.rename(temp,devicesFile);
  }
  function forgetDevices(extensionId){devices=extensionId?devices.filter(d=>d.extensionId!==extensionId):[];return saveDevices();}
  const operations = new Map();
  const resultListeners=new Set();
  const publicOperation = (operation) => operation ? structuredClone({ id:operation.id,type:operation.type,status:operation.status,context:operation.context,createdAt:operation.createdAt,result:operation.result,error:operation.error }) : null;
  function cancelPending(reason) {
    const operation=pending&&operations.get(pending.id);
    if(operation){operation.status=operation.status==="running"?"unknown":"failed";operation.error=reason;void Promise.resolve(onOperationResult(publicOperation(operation))).catch(()=>{});}
    pending=null;
  }
  function operationError(message) { const error=new Error(message);error.status=409;throw error; }
  function enqueue(type,payload={},context={}) {
    if(!["prepare","observe","submit","generate","monitor","export","segment","rig"].includes(type))operationError("Unsupported Studio operation.");
    const current=status();
    if(type==='rig'||type==='observe'&&!payload.configureGenerationDefaults&&!payload.refreshTextureSettings&&!payload.discoverSubmissionId){if(!current.controlAvailable||!current.automationAuthorized)operationError("Authorize automation for a connected Studio tab in the extension first.");}
    else if(!current.preparationAvailable)operationError("Authorize automation for a connected Studio tab in the extension first.");
    if(type==='rig'){
      if(session?.adapter?.rigWorkflowVersion!==1)operationError('RIG_EXTENSION_RELOAD_REQUIRED');
      if(!['prepare','submit','monitor','download'].includes(payload.action))operationError('RIG_ACTION_INVALID');
      if(payload.action==='submit'&&(payload.confirmCost!==true||!payload.operationId||!/^\d+(?:[.,]\d+)?$/.test(payload.expectedCost||'')))operationError('STUDIO_COST_CONFIRMATION');
    }
    if(type==='segment'){
      if(session?.adapter?.segmentWorkflowVersion!==1)operationError('SEG_EXTENSION_RELOAD_REQUIRED');
      if(!['inspect','quote','import','smartUV','texture','download','recover'].includes(payload.action))operationError('SEG_GROUP_ACTION_INVALID');
      if(['smartUV','texture'].includes(payload.action)&&(!payload.confirmCost||!payload.operationId||!/^\d+(?:[.,]\d+)?$/.test(payload.expectedCost||'')))operationError('SEG_BUDGET_CONFIRMATION');
    }
    if(payload.workflow==='texture'&&session?.adapter?.textureWorkflowVersion!==2)operationError('TEXTURE_EXTENSION_RELOAD_REQUIRED');
    if(type==='export'&&payload.sourceFormat==='FBX'&&session?.adapter?.nativeQuadExportVersion!==1)operationError('STUDIO_QUAD_EXTENSION_RELOAD_REQUIRED');
    if((type==='generate'||payload.configureGenerationDefaults)&&session?.adapter?.quickGenerationVersion!==1)operationError('STUDIO_QUICK_EXTENSION_REQUIRED');
    if((type==='generate'||payload.configureGenerationDefaults||type==='submit'&&payload.workflow!=='texture')&&session?.adapter?.topologySettingsVersion!==1)operationError('STUDIO_TOPOLOGY_EXTENSION_REQUIRED');
    if(type==='generate'&&(payload.confirmCost!==true||payload.confirmUpload!==true||typeof payload.expectedCost!=='string'||!payload.expectedCost.trim()||!payload.confirmationNonce))operationError('STUDIO_COST_CONFIRMATION');
    if(["monitor","export"].includes(type)&&(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload.taskId||"")||payload.taskConfirmed!==true))operationError("Confirm the generated Studio task before monitoring or exporting it.");
    if(pending)operationError("Wait for the pending Studio operation before starting another.");
    if(type==="submit"&&(!payload.confirmCost||typeof payload.confirmationNonce!=="string"||!payload.confirmationNonce||!payload.expectedSnapshot?.pageSignature))operationError("Explicit confirmation of the current Studio cost and snapshot is required.");
    const operation={id:randomUUID(),type,status:"queued",context:structuredClone(context),createdAt:iso(now()),result:null,error:null};
    operations.set(operation.id,operation);
    while(operations.size>32)operations.delete(operations.keys().next().value);
    pending={id:operation.id,type,payload:structuredClone(payload),expiresAt:now()+(type==='rig'&&payload.action==='prepare'?360000:180000),tabId:session.tab.id};
    return publicOperation(operation);
  }
  const iso = (n) => n == null ? null : new Date(n).toISOString();
  function expire() {
    if (pairing && now() >= pairing.expiresAt) pairing = null;
    if (session && now() >= session.expiresAt) { cancelPending("Studio session expired. Inspect the tab before retrying any generation.");session = null; }
    devices=devices.filter(d=>now()-Date.parse(d.lastUsedAt||d.createdAt||0)<deviceTtlMs);
    if (pending && now() >= pending.expiresAt) {
      const operation=operations.get(pending.id);
      if(operation){operation.status=operation.status==="running"?"unknown":"failed";operation.error="Studio operation timed out. Check the tab before retrying; a submitted job must not be sent again automatically.";void Promise.resolve(onOperationResult(publicOperation(operation))).catch(()=>{});}
      pending = null;
    }
  }
  function status() {
    expire();
    const connected = !!(session?.lastSeen != null && now() - session.lastSeen < heartbeatTtlMs);
    return {
      transport: "browser-extension",
      paired: !!session,
      connected,
      controlAvailable: connected && session?.acknowledged === true,
      controlScope:session?.automationAuthorized===true?"explicit-project-commands":"read-only-inspection",
      preparationAvailable: connected && session?.acknowledged===true && session?.automationAuthorized===true && (session?.adapter?.supported===true||session?.adapter?.generationNavigationVersion===1),
      generationAvailable: connected && session?.acknowledged===true && session?.automationAuthorized===true && session?.adapter?.supported===true,
      monitorAvailable:connected&&session?.automationAuthorized===true&&session?.adapter?.supported===true,
      exportAvailable:connected&&session?.automationAuthorized===true&&session?.adapter?.supported===true,
      automationAuthorized:session?.automationAuthorized===true,
      adapterVersion:session?.adapter?.adapterVersion??null,
      adapter:session?.adapter??null,
      extensionId: session?.extensionId ?? pairing?.extensionId ?? null,
      rememberedBrowsers: devices.length,
      resumed: session?.resumed===true,
      tab: session?.tab ?? null,
      lastSeen: iso(session?.lastSeen),
      expiresAt: iso(session?.expiresAt),
      pairingExpiresAt: iso(pairing?.expiresAt),
      inspection: session?.inspection ?? null,
      inspectionAt: iso(session?.inspectionAt),
      pending: pending ? { type: pending.type, expiresAt: iso(pending.expiresAt) } : null,
      message: !session ? "Instala y empareja la extensión local. Abrir Tripo no establece conexión."
        : !connected ? "Extensión emparejada; esperando una pestaña autorizada y una señal reciente."
          : !session.acknowledged ? "La extensión responde, pero no puede leer la pestaña elegida. Vuelve a conectarla desde su panel."
            : "Pestaña accesible para inspección de solo lectura. Inicio de sesión y generación automática aún no verificados.",
    };
  }
  const error = (res, code, message) => res.status(code).json({ error: message });
  router.use((req, res, next) => {
    expire();
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    if (req.headers.host !== host) return error(res, 403, "El puente solo acepta su dirección local configurada.");
    const origin = req.headers.origin;
    if (req.path.startsWith("/bridge/")) {
      const id = req.path === "/bridge/pair" ? pairing?.extensionId
        : req.path === "/bridge/resume" ? devices.find(d=>origin===`chrome-extension://${d.extensionId}`)?.extensionId
          : session?.extensionId;
      if (!id || origin !== `chrome-extension://${id}`) return error(res, 403, "Extensión no autorizada. Empareja su ID desde el taller local.");
      res.set({ "Access-Control-Allow-Origin": origin, "Vary": "Origin" });
      if (req.method === "OPTIONS") {
        res.set({ "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "60" });
        return res.sendStatus(204);
      }
      if (req.method !== "POST") return error(res, 405, "Método no permitido.");
      if (!["/bridge/pair","/bridge/resume"].includes(req.path) && !safeEqual(req.headers.authorization, `Bearer ${session?.token}`))
        return error(res, 401, "Sesión del puente inválida o vencida. Vuelve a emparejar.");
    } else {
      if (origin && origin !== `http://${host}`) return error(res, 403, "Origen local no permitido.");
      // Protect reads too: status can contain a user-chosen tab title.
      if (!safeEqual(req.headers["x-workbench-token"], csrf)) return error(res, 403, "Sesión local inválida. Recarga el taller.");
    }
    next();
  });
  const exportTransfers=new Map();
  const standardJson=express.json({limit:'8kb'}),operationJson=express.json({limit:'384kb'}),exportJson=express.json({limit:'44mb'});
  router.use((req,res,next)=>(req.path==='/bridge/export-file'?exportJson:req.path==='/bridge/operation-result'?operationJson:standardJson)(req,res,next));
  router.post('/bridge/export-file', async(req,res)=>{
    const authorizedSession=session;
    const operation=operations.get(req.body?.operationId),taskId=req.body?.taskId;
    if(!operation||!(operation.type==='export'||['segment','rig'].includes(operation.type)&&pending?.payload?.action==='download')||!pending||pending.id!==operation.id||pending.tabId!==session.tab?.id||!session.automationAuthorized||pending.payload?.taskId!==taskId)
      return error(res,409,'No authorized export is pending for this candidate.');
    const format=pending.payload?.sourceFormat==='FBX'&&operation.type==='export'?'FBX':'GLB';
    if(req.body?.format&&req.body.format!==format)return error(res,409,'Export format changed.');
    let bytes,transfer;
    const phase=req.body?.phase;
    for(const [id,entry] of exportTransfers)if(id!==operation.id||entry.session!==session){clearTimeout(entry.timer);exportTransfers.delete(id);}
    if(phase==='chunk'){
      const {offset,totalBytes,dataBase64}=req.body;
      if(!Number.isInteger(offset)||offset<0||!Number.isInteger(totalBytes)||totalBytes<20||totalBytes>150*1024*1024||typeof dataBase64!=='string'||dataBase64.length>1400000||!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64))return error(res,400,'Invalid export chunk.');
      const chunk=Buffer.from(dataBase64,'base64');
      if(!chunk.length||chunk.length>1024*1024||offset+chunk.length>totalBytes)return error(res,400,'Invalid export chunk bounds.');
      transfer=exportTransfers.get(operation.id);
      if(!transfer){
        if(chunk.length<20)return error(res,400,'Invalid export header.');
        const valid=format==='FBX'?isFbx(chunk)||chunk.readUInt16LE(0)===0x4b50:chunk.toString('ascii',0,4)==='glTF'&&chunk.readUInt32LE(4)===2&&chunk.readUInt32LE(8)===totalBytes;
        if(offset!==0||chunk.length<20||!valid)return error(res,409,'Export header or initial offset mismatch.');
        transfer={session:authorizedSession,taskId,totalBytes,received:0,chunks:[],timer:setTimeout(()=>exportTransfers.delete(operation.id),180000)};
        transfer.timer.unref();exportTransfers.set(operation.id,transfer);
      }
      if(transfer.taskId!==taskId||transfer.totalBytes!==totalBytes||transfer.download)return error(res,409,'Export transfer changed.');
      if(offset===transfer.received){transfer.chunks.push(chunk);transfer.received+=chunk.length;}
      else {
        // Retry a lost chunk acknowledgement only when bytes and offset match.
        let at=0;const previous=transfer.chunks.find(part=>{const match=at===offset;at+=part.length;return match;});
        if(!previous?.equals(chunk))return error(res,409,'Export chunk is out of order or changed.');
      }
      return res.json({received:transfer.received});
    }else if(phase==='finish'){
      transfer=exportTransfers.get(operation.id);
      if(!transfer||transfer.taskId!==taskId||transfer.received!==transfer.totalBytes)return error(res,409,'Export transfer is incomplete.');
      if(transfer.download)return res.json({download:transfer.download});
      const received=Buffer.concat(transfer.chunks,transfer.totalBytes);
      bytes=format==='FBX'?await fbxBuffer(received):glbBuffer(received);
    }else{
      if(phase!==undefined)return error(res,400,'Invalid export transfer phase.');
      const encoded=req.body?.dataBase64;
      if(typeof encoded!=='string'||encoded.length>44*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return error(res,400,'Invalid exported GLB bytes.');
      const received=Buffer.from(encoded,'base64');bytes=format==='FBX'?await fbxBuffer(received):glbBuffer(received);
      if(bytes.length>32*1024*1024)return error(res,413,'Export exceeds the 32 MB transfer limit.');
    }
    // Fixed names derive from the authorized task, never from page-provided paths.
    await fs.mkdir(downloadsDir,{recursive:true});
    const root=await fs.realpath(downloadsDir),folder=path.join(root,'FITA');
    await fs.mkdir(folder,{recursive:true});
    const actual=await fs.realpath(folder);
    if(path.relative(root,actual)!=='FITA')return error(res,400,'Invalid export folder.');
    expire();
    if(session!==authorizedSession||!session?.automationAuthorized||pending?.id!==operation.id||pending.tabId!==session.tab?.id)return error(res,409,'Export authorization changed.');
    const filename=path.join(actual,`${taskId}-${operation.id}.${format.toLowerCase()}`);
    try{await fs.writeFile(filename,bytes,{flag:'wx'});}
    catch(err){if(err.code!=='EEXIST')throw err;const stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||!bytes.equals(await fs.readFile(filename)))return error(res,409,'Export file already exists with different content.');}
    const download={path:filename,filename:path.basename(filename),taskId,transport:'local-export-bytes'};
    if(transfer){transfer.download=download;transfer.chunks=[];}
    res.json({download});
  });
  router.get("/status", (req, res) => res.json(status()));
  router.post("/pairing", (req, res) => {
    if (!EXTENSION_ID.test(req.body?.extensionId || "")) return error(res, 400, "Copia el ID de 32 letras que aparece en el panel de la extensión.");
    // Starting a new pairing revokes an old extension, including pending commands.
    cancelPending("Studio connection was replaced. Inspect the tab before retrying any generation.");session = null;
    pairing = { extensionId: req.body.extensionId, code: String(randomInt(0, 100000000)).padStart(8, "0"), expiresAt: now() + pairingTtlMs, attempts: 0 };
    res.json({ code: pairing.code, expiresAt: iso(pairing.expiresAt), extensionId: pairing.extensionId });
  });
  router.delete("/connection", async (req, res) => {
    cancelPending("Studio connection was revoked. Inspect the tab before retrying any generation.");pairing = null; session = null;
    await forgetDevices();
    res.json(status());
  });
  router.post("/inspect", (req, res) => {
    if (!status().controlAvailable) return error(res, 409, "Conecta una pestaña de Tripo Studio desde la extensión y espera su confirmación de lectura.");
    if (!pending) pending = { id: randomUUID(), type: "inspect", expiresAt: now() + heartbeatTtlMs, tabId: session.tab.id };
    res.status(202).json(status());
  });
  // Explicit, fixed diagnostic: the extension checks the current model through
  // four tools using only navigation and monitoring. Never records a paid job.
  router.post('/navigation-check',(req,res)=>{
    const current=status();
    if(!current.controlAvailable||!current.automationAuthorized)return error(res,409,'STUDIO_AUTHORIZE_AUTOMATION');
    if(current.adapter?.navigationCheckVersion!==1)return error(res,409,'STUDIO_NAVIGATION_CHECK_EXTENSION_REQUIRED');
    if(Object.keys(req.body||{}).length)return error(res,400,'STUDIO_NAVIGATION_CHECK_ARGUMENTS');
    if(pending)return error(res,409,'STUDIO_COMMAND_STILL_ACTIVE');
    res.status(202).json({operation:enqueue('observe',{verifyNavigation:true},{diagnostic:'navigation-check'})});
  });
  router.get('/navigation-check/:id',(req,res)=>{
    const operation=operations.get(req.params.id);
    if(operation?.context?.diagnostic!=='navigation-check')return error(res,404,'STUDIO_OPERATION_NOT_FOUND');
    res.json({operation:publicOperation(operation)});
  });
  router.post('/lifecycle-check',(req,res)=>{
    const current=status();
    if(!current.controlAvailable||!current.automationAuthorized)return error(res,409,'STUDIO_CONNECT_TAB');
    if(current.adapter?.lifecycleCheckVersion!==1)return error(res,409,'STUDIO_LIFECYCLE_EXTENSION_REQUIRED');
    if(Object.keys(req.body||{}).length)return error(res,400,'STUDIO_DIAGNOSTIC_ARGUMENTS_NOT_ALLOWED');
    if(pending)return error(res,409,'STUDIO_COMMAND_STILL_ACTIVE');
    res.status(202).json({operation:enqueue('observe',{verifyLifecycle:true},{diagnostic:'lifecycle-check'})});
  });
  router.get('/lifecycle-check/:id',(req,res)=>{
    const operation=operations.get(req.params.id);
    if(operation?.context?.diagnostic!=='lifecycle-check')return error(res,404,'STUDIO_OPERATION_NOT_FOUND');
    res.json({operation:publicOperation(operation)});
  });
  router.post('/export-preparation-check',(req,res)=>{
    const current=status();
    if(!current.controlAvailable||!current.automationAuthorized||current.adapter?.nativeQuadExportVersion!==1)return error(res,409,'STUDIO_QUAD_EXTENSION_RELOAD_REQUIRED');
    if(Object.keys(req.body||{}).length)return error(res,400,'STUDIO_DIAGNOSTIC_ARGUMENTS_NOT_ALLOWED');
    if(pending)return error(res,409,'STUDIO_COMMAND_STILL_ACTIVE');
    res.status(202).json({operation:enqueue('observe',{verifyExportPreparation:true},{diagnostic:'export-preparation-check'})});
  });
  router.get('/export-preparation-check/:id',(req,res)=>{
    const operation=operations.get(req.params.id);
    if(operation?.context?.diagnostic!=='export-preparation-check')return error(res,404,'STUDIO_OPERATION_NOT_FOUND');
    res.json({operation:publicOperation(operation)});
  });
  // Free settings check without a project: the extension restores Smart Mesh,
  // P2.0, four results, multiview, Quad and the body polygon limits, then reads
  // the price. Same command as a quote; nothing is uploaded or generated.
  router.post('/settings-check',(req,res)=>{
    const current=status();
    if(!current.controlAvailable||!current.automationAuthorized)return error(res,409,'STUDIO_CONNECT_TAB');
    if(current.adapter?.topologySettingsVersion!==1)return error(res,409,'STUDIO_TOPOLOGY_EXTENSION_REQUIRED');
    if(Object.keys(req.body||{}).length)return error(res,400,'STUDIO_DIAGNOSTIC_ARGUMENTS_NOT_ALLOWED');
    if(pending)return error(res,409,'STUDIO_COMMAND_STILL_ACTIVE');
    res.status(202).json({operation:enqueue('observe',{configureGenerationDefaults:true,faceLimits:generationLimits('body')},{diagnostic:'settings-check'})});
  });
  router.get('/settings-check/:id',(req,res)=>{
    const operation=operations.get(req.params.id);
    if(operation?.context?.diagnostic!=='settings-check')return error(res,404,'STUDIO_OPERATION_NOT_FOUND');
    res.json({operation:publicOperation(operation)});
  });
  router.post("/bridge/pair", (req, res) => {
    if (!pairing) return error(res, 401, "El código venció. Genera otro en el taller.");
    if (!safeEqual(req.body?.code, pairing.code)) {
      pairing.attempts++;
      if (pairing.attempts >= 5) pairing = null;
      return error(res, 401, "Código incorrecto o vencido. Tras cinco intentos es necesario crear otro.");
    }
    const credential=randomBytes(32).toString("hex"),device={id:randomUUID(),extensionId:pairing.extensionId,hash:digestOf(credential),createdAt:new Date(now()).toISOString(),lastUsedAt:new Date(now()).toISOString()};
    session = { extensionId: pairing.extensionId, deviceId:device.id, token: randomBytes(32).toString("hex"), expiresAt: now() + sessionTtlMs, lastSeen: null, tab: null, acknowledged: false, inspection: null };
    devices=[...devices.filter(d=>d.extensionId!==pairing.extensionId),device].slice(-5);
    pairing = null;
    void saveDevices().catch(()=>{});
    res.json({ token: session.token, expiresAt: iso(session.expiresAt), heartbeatSeconds: 30, deviceCredential: credential });
  });
  // A remembered browser resumes without a pairing code. Bounded attempts.
  router.post("/bridge/resume", (req, res) => {
    if (now() < resumeLockedUntil) return error(res, 429, "Demasiados intentos. Espera un minuto.");
    const origin=req.headers.origin,hash=digestOf(req.body?.credential||'');
    const device=typeof req.body?.credential==='string'&&/^[a-f0-9]{64}$/.test(req.body.credential)?devices.find(d=>origin===`chrome-extension://${d.extensionId}`&&safeEqual(d.hash,hash)):null;
    if (!device) {
      if(++resumeFailures>=10){resumeFailures=0;resumeLockedUntil=now()+60000;}
      return error(res, 401, "Este navegador ya no está recordado. Vuelve a emparejar.");
    }
    resumeFailures=0;
    if(session&&session.deviceId!==device.id)cancelPending("Studio connection was replaced. Inspect the tab before retrying any generation.");
    session = { extensionId: device.extensionId, deviceId:device.id, resumed:true, token: randomBytes(32).toString("hex"), expiresAt: now() + sessionTtlMs, lastSeen: null, tab: null, acknowledged: false, inspection: null };
    device.lastUsedAt=new Date(now()).toISOString();void saveDevices().catch(()=>{});
    res.json({ token: session.token, expiresAt: iso(session.expiresAt), heartbeatSeconds: 30 });
  });
  router.post("/bridge/heartbeat", (req, res) => {
    const tab = tabSummary(req.body?.tab);
    const inspection = inspectionSummary(req.body?.inspection);
    session.lastSeen = now();session.expiresAt = now() + sessionTtlMs;
    if(req.body?.suspended===true&&!tab){
      session.acknowledged=false;
      // Retain safe monitoring commands while the document/tab is unavailable.
      // A paid/uncertain command is terminal and can never be replayed on reopen.
      if(pending&&!['monitor','observe','inspect'].includes(pending.type))cancelPending('Studio document interrupted. Recover the existing task; do not repeat a paid operation.');
      return res.json({ok:true,controlAvailable:false,preparationAvailable:false,generationAvailable:false});
    }
    if(tab&&inspection&&req.body?.automationAuthorized===true&&req.body?.resumePreviousTabId===session.tab?.id&&pending){
      if(pending.type==='monitor'||pending.type==='observe'&&!pending.payload?.configureGenerationDefaults&&!pending.payload?.refreshTextureSettings&&!pending.payload?.discoverSubmissionId)pending.tabId=tab.id;
    }
    if (session.tab?.id !== tab?.id&&pending?.tabId!==tab?.id) cancelPending("The authorized Studio tab changed. Inspect it before retrying any generation.");
    session.tab = tab;
    session.acknowledged = !!(tab && inspection);
    session.automationAuthorized=req.body?.automationAuthorized===true && req.body?.adapter?.adapterVersion===2;
    session.adapter=req.body?.adapter?.adapterVersion===2 ? {
      adapterVersion:2,
      quickGenerationVersion:req.body.adapter.quickGenerationVersion===1?1:null,
      generationNavigationVersion:req.body.adapter.generationNavigationVersion===1?1:null,
      navigationCheckVersion:req.body.adapter.navigationCheckVersion===1?1:null,
      lifecycleCheckVersion:req.body.adapter.lifecycleCheckVersion===1?1:null,
      nativeQuadExportVersion:req.body.adapter.nativeQuadExportVersion===1?1:null,
      topologySettingsVersion:req.body.adapter.topologySettingsVersion===1?1:null,
      automaticCandidatesVersion:req.body.adapter.automaticCandidatesVersion===1?1:null,
      generationFailureVersion:req.body.adapter.generationFailureVersion===1?1:null,
      textureWorkflowVersion:req.body.adapter.textureWorkflowVersion===2?2:null,
      segmentWorkflowVersion:req.body.adapter.segmentWorkflowVersion===1?1:null,
      uvSaveVersion:req.body.adapter.uvSaveVersion===1?1:null,
      uvSelectionVersion:req.body.adapter.uvSelectionVersion===1?1:null,
      importOrientationVersion:req.body.adapter.importOrientationVersion===2?2:null,
      rigWorkflowVersion:req.body.adapter.rigWorkflowVersion===1?1:null,
      supported:req.body.adapter.supported===true,
      mode:["multiview","other"].includes(req.body.adapter.mode)?req.body.adapter.mode:"other",
      costLabel:typeof req.body.adapter.costLabel==="string"?req.body.adapter.costLabel.slice(0,100):null,
      modelLabel:typeof req.body.adapter.modelLabel==="string"?req.body.adapter.modelLabel.slice(0,180):null,
    }:null;
    if (!session.acknowledged) cancelPending("Studio is no longer readable. Inspect it before retrying any generation.");
    if(!session.automationAuthorized&&pending&&pending.type!=="inspect")cancelPending("Studio automation permission was revoked. Inspect the tab before retrying any generation.");
    if (inspection && tab) { session.inspection = inspection; session.inspectionAt = now(); }
    res.json({ ok: true, controlAvailable: session.acknowledged, preparationAvailable: status().preparationAvailable, generationAvailable: status().generationAvailable });
  });
  router.post("/bridge/poll", (req, res) => {
    const available=status();
    const readOnlyObserve=pending?.type==='observe'&&!pending.payload?.configureGenerationDefaults&&!pending.payload?.refreshTextureSettings&&!pending.payload?.discoverSubmissionId;
    const command=available.controlAvailable&&pending&&(pending.type==="inspect"||(readOnlyObserve||pending.type==='rig')&&available.automationAuthorized||available.preparationAvailable)?{id:pending.id,type:pending.type,tabId:pending.tabId,...(pending.payload?{payload:pending.payload}:{})}:null;
    if(command&&operations.has(command.id))operations.get(command.id).status="running";
    res.json({ command });
  });
  router.post("/bridge/result", (req, res) => {
    if (!pending || req.body?.id !== pending.id || pending.tabId !== session.tab?.id) return error(res, 409, "La inspección ya no está pendiente para esta pestaña.");
    if(pending.type!=="inspect")return error(res,400,"Use the operation-result endpoint for Studio operations.");
    const inspection = inspectionSummary(req.body?.inspection);
    if (!inspection) return error(res, 400, "La pestaña no confirmó una inspección válida.");
    session.inspection = inspection; session.inspectionAt = now(); pending = null;
    res.json({ ok: true });
  });
  router.post("/bridge/operation-result", async (req,res) => {
    const operation=operations.get(req.body?.id);
    if(!operation)return error(res,404,"Unknown Studio operation.");
    if(["succeeded","failed","unknown"].includes(operation.status))return res.json({ok:true});
    if(!pending||pending.id!==operation.id||pending.tabId!==session.tab?.id)return error(res,409,"Studio operation no longer belongs to the selected tab.");
    const result=req.body?.result;
    if(req.body?.error){operation.status=req.body?.outcome==="unknown"?"unknown":"failed";operation.error=String(req.body.error).slice(0,500);}
    else if(!result||typeof result!=="object"||!["prepared","observed","submitted","discovering","candidates-found","processing","ready","unknown","exported","requires_manual_import"].includes(result.stage))return error(res,400,"Invalid Studio operation result.");
    else {operation.status="succeeded";operation.result=structuredClone(result);}
    pending=null;
    await onOperationResult(publicOperation(operation));
    for(const listener of resultListeners)void Promise.resolve(listener(publicOperation(operation))).catch(()=>{});
    res.json({ok:true});
  });
  router.post("/bridge/disconnect", async (req, res) => {
    const extensionId=session?.extensionId;
    cancelPending("Studio connection was revoked. Inspect the tab before retrying any generation.");session = null; pairing = null;
    await forgetDevices(extensionId);
    res.json({ ok: true });
  });
  router.use((req, res) => error(res, 404, "Operación del puente no disponible."));
  router.use((err, req, res, next) => error(res, err.type === "entity.too.large" ? 413 : 400, "Petición del puente inválida."));
  app.use("/api/studio", router);
  return { status, enqueue, getOperation:(id)=>publicOperation(operations.get(id)), subscribe:listener=>{resultListeners.add(listener);return()=>resultListeners.delete(listener);} };
}

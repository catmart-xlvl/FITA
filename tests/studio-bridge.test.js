import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import fs from "node:fs/promises";
import vm from "node:vm";
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {studioGroupProvider} from '../server/studio-group-provider.js';
import { messages,translateError } from "../extension-tripo-studio/popup-i18n.js";
import * as adapterFunctions from "../extension-tripo-studio/studio-adapter.js";
import {createConnectionLoop,createCommandHeartbeat} from '../extension-tripo-studio/connection-loop.js';
import {createGroupCommands} from '../extension-tripo-studio/group-commands.js';
import {createMeshImporter} from '../extension-tripo-studio/mesh-import.js';
import {isReadOnlyStudioCall} from '../extension-tripo-studio/tab-execution.js';
import {readCandidatePreviews} from '../extension-tripo-studio/candidate-previews.js';
import {captureBatch,textureTiming} from '../extension-tripo-studio/batch-capture.js';
import {navigateStudioTask,studioNavigationControl} from '../extension-tripo-studio/studio-navigation.js';
import {observeGroupStudio} from '../extension-tripo-studio/group-adapter.js';
import {checkNavigationRecovery,checkTabLifecycle,isNavigationCheckCall,isExportPreparationCall} from '../extension-tripo-studio/navigation-check.js';
import {resumeUrl,reopenedTab} from '../extension-tripo-studio/tab-recovery.js';
import {studioWorkGuard} from '../extension-tripo-studio/studio-guard.js';
import {zipBuffers} from '../server/codex-handoff.js';
import { mountStudioBridge } from "../server/studio-bridge.js";
import {throwAdapterError,asWorker} from './page-call.js';

const ID = "a".repeat(32), OTHER = "b".repeat(32), CSRF = "test-only-ui-session";
const ORIGIN = `chrome-extension://${ID}`;
const TAB = { id: 12, url: "https://studio.tripo3d.ai/workspace?secret=must-not-persist#private", title: "Tripo Studio" };
const INSPECTION = { acknowledged: true, origin: "https://studio.tripo3d.ai", readyState: "complete", visibleButtons: 8, disabledButtons: 2, fileInputs: 1, canvases: 1 };
test('native FBX ZIP transport is scoped to the confirmed export and writes only its validated FBX',async t=>{
 const h=await harness(t),token=await h.pair(),taskId='11111111-2222-4333-8444-555555555555';
 await h.ext('heartbeat',token,{tab:TAB,inspection:INSPECTION,automationAuthorized:true,adapter:{adapterVersion:2,supported:true,nativeQuadExportVersion:1}});
 const operation=h.bridge.enqueue('export',{taskId,taskConfirmed:true,sourceFormat:'FBX'});
 const native=Buffer.from('; FBX 7.4.0 project file\nObjects: {}\n'),zip=await zipBuffers({'native/model.fbx':native,'readme.txt':Buffer.from('test')});
 const body={operationId:operation.id,taskId,format:'FBX'};
 const chunk=await h.ext('export-file',token,{...body,phase:'chunk',offset:0,totalBytes:zip.length,dataBase64:zip.toString('base64')});assert.equal(chunk.status,200,JSON.stringify(chunk.data));
 const finish=await h.ext('export-file',token,{...body,phase:'finish'});assert.equal(finish.status,200,JSON.stringify(finish.data));assert.match(finish.data.download.path,/\.fbx$/);assert.deepEqual(await fs.readFile(finish.data.download.path),native);
 assert.equal((await h.ext('export-file',token,{...body,format:'GLB',phase:'finish'})).status,409);
});

test('native FBX download requires confirmed Blender preset and switches away from Mixamo without downloading',async()=>{
 const taskId='11111111-2222-4333-8444-555555555555';let expanded=false,downloads=0,selectionBlocked=false;
 const node=innerText=>({innerText,getBoundingClientRect:()=>({width:80,height:20}),getAttribute:()=>null,disabled:false,focus(){}});
 const format=node('FBX'),preset={...node('Mixamo'),getAttribute:k=>k==='aria-expanded'?String(expanded):null,dispatchEvent:()=>{expanded=true;}};
 const option={...node('Blender'),dispatchEvent:()=>{if(!selectionBlocked){preset.innerText='Blender';expanded=false;}}};const download={...node('Export'),click:()=>downloads++};
 const dialog={...node('Export FBX Mixamo'),getAttribute:k=>k==='aria-labelledby'?'heading':null,querySelectorAll:s=>s==='[role="combobox"]'?[format,preset]:s==='button'?[download]:[]};
 const document={getElementById:()=>node('Export'),querySelectorAll:s=>s==='[role="dialog"]'?[dialog]:s==='[role="option"]'&&expanded?[option]:[]};
 const run=step=>vm.runInNewContext(`(${adapterFunctions.exportStudioControl})(${JSON.stringify({step,taskId,format:'FBX'})})`,{document,location:{origin:'https://studio.tripo3d.ai',pathname:'/workspace/generate/'+taskId},getComputedStyle:()=>({}),KeyboardEvent:class{constructor(_,init){Object.assign(this,init);}},setTimeout:fn=>queueMicrotask(fn)});
 assert.equal((await run('download')).adapterError,'FBX_BLENDER_PRESET_NOT_VERIFIED');assert.equal(downloads,0);
 assert.equal((await run('blender-preset')).stage,'blender-preset-verified');assert.equal(downloads,0);assert.equal(preset.innerText,'Blender');
 assert.equal((await run('download')).stage,'download-clicked');assert.equal(downloads,1);
 preset.innerText='Mixamo';selectionBlocked=true;assert.equal((await run('blender-preset')).adapterError,'FBX_BLENDER_PRESET_NOT_VERIFIED');assert.equal(downloads,1);
});
test('authorized lifecycle check survives document reload and a new tab ID without another pairing or paid command',async t=>{
 const h=await harness(t),id='11111111-2222-4333-8444-555555555555';let workflow='texture';
 const worker=await workerHarness(h,null,async(name,args)=>{
  if(name==='navigateTab'){workflow=new URL(args[0].url).pathname.split('/')[2];return;}
  if(name==='reloadTab')return;
  if(name==='observeGroupStudio')return {taskId:id,workflow,unsavedChanges:false,importBusy:false,importFileCount:0,links:['generate','texture','smart-uv','rigging'].map(w=>({taskId:id,workflow:w,url:`https://studio.tripo3d.ai/workspace/${w}/asset-${id}`}))};
  if(name==='observeStudioDocument')return {adapterVersion:2,lifecycleCheckVersion:1,supported:true,currentTaskId:id,workflow,modelReady:true,blockingDialog:false};
  throw Error('Unexpected action '+name);
 });
 worker.browserTabs.set(TAB.id,{...TAB,url:`https://studio.tripo3d.ai/workspace/texture/asset-${id}`,windowId:1});
 worker.delayNewTabQueries(3);
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 assert.equal((await h.ui('/lifecycle-check',{taskId:id})).status,400);
 const queued=await h.ui('/lifecycle-check',{});assert.equal(queued.status,202);await worker.message({type:'refresh'});
 const result=(await h.ui('/lifecycle-check/'+queued.data.operation.id,null,'GET')).data.operation;
 assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.result.lifecycleCheck.passed,true,JSON.stringify(result));assert.equal(result.result.lifecycleCheck.restoredInitialView,true);
 assert.equal(worker.calls.filter(c=>c.type==='close').length,1);assert.equal(worker.calls.filter(c=>c.type==='reload').length,1);assert.notEqual(worker.memory.bridge.tabId,TAB.id);
 assert.equal(worker.calls.filter(c=>c.type==='request'&&c.route==='pair').length,1);assert(!worker.calls.some(c=>c.funcName==='clickStudioGenerate'));
});

test('suspended tabs retain safe monitoring but terminate a paid command without replay',async t=>{
 const h=await harness(t),token=await h.pair(),adapter={adapterVersion:2,supported:true,topologySettingsVersion:1};
 await h.ext('heartbeat',token,{tab:TAB,inspection:INSPECTION,automationAuthorized:true,adapter});
 const paid=h.bridge.enqueue('submit',{confirmCost:true,confirmationNonce:'nonce',expectedSnapshot:{pageSignature:'proof'}});
 await h.ext('poll',token);await h.ext('heartbeat',token,{suspended:true,tab:null});
 assert.equal(h.bridge.getOperation(paid.id).status,'unknown');
 await h.ext('heartbeat',token,{tab:{...TAB,id:44},inspection:INSPECTION,automationAuthorized:true,adapter,resumePreviousTabId:TAB.id});
 assert.equal((await h.ext('poll',token)).data.command,null);
 const monitoring=h.bridge.enqueue('monitor',{taskId:'11111111-2222-4333-8444-555555555555',taskConfirmed:true});
 await h.ext('heartbeat',token,{suspended:true,tab:null});
 await h.ext('heartbeat',token,{tab:{...TAB,id:45},inspection:INSPECTION,automationAuthorized:true,adapter,resumePreviousTabId:44});
 const command=(await h.ext('poll',token)).data.command;assert.equal(command.id,monitoring.id);assert.equal(command.tabId,45);
});
async function harness(t,{devicesFile=null}={}) {
  let tick = Date.UTC(2026, 9, 9);
  const downloadsDir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-export-'));
  const app = express();
  const bridge=mountStudioBridge(app, { csrf: CSRF, downloadsDir, now: () => tick, pairingTtlMs: 1000, sessionTtlMs: 10000, heartbeatTtlMs: 100, devicesFile });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/studio`;
  async function call(route, { method = "POST", body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request(base + route, { method, headers: { Host: "127.0.0.1:4317", "Content-Type": "application/json", ...headers } }, (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => raw += chunk);
        response.on("end", () => resolve({ status: response.statusCode, headers: new Headers(response.headers), data: response.statusCode === 204 ? null : JSON.parse(raw) }));
      });
      request.on("error", reject);
      request.end(body ? JSON.stringify(body) : undefined);
    });
  }
  const ui = (route, body, method = "POST", headers = {}) => call(route, { method, body, headers: { "x-workbench-token": CSRF, Origin: "http://127.0.0.1:4317", ...headers } });
  const ext = (route, token, body = {}, headers = {}) => call(`/bridge/${route}`, { body, headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });
  async function pair() {
    const pairing = await ui("/pairing", { extensionId: ID });
    assert.equal(pairing.status, 200);
    const response = await ext("pair", null, { code: pairing.data.code });
    assert.equal(response.status, 200);
    assert.notEqual(response.data.token, pairing.data.code);
    assert.equal(response.data.token.length, 64);
    return response.data.token;
  }
  return { call, ui, ext, pair,bridge, advance: (ms) => tick += ms };
}

test("studio bridge: rejects hostile host, cross-origin UI, missing CSRF and unapproved extensions", async (t) => {
  const h = await harness(t);
  assert.equal((await h.ui("/status", null, "GET", { Host: "evil.example" })).status, 403);
  assert.equal((await h.ui("/status", null, "GET", { Origin: "https://evil.example" })).status, 403);
  assert.equal((await h.call("/status", { method: "GET" })).status, 403);
  assert.equal((await h.call("/pairing", { body: { extensionId: ID } })).status, 403);
  assert.equal((await h.ui("/pairing", { extensionId: "invalid" })).status, 400);
  const pairing = await h.ui("/pairing", { extensionId: ID });
  assert.equal((await h.ext("pair", null, { code: pairing.data.code }, { Origin: `chrome-extension://${OTHER}` })).status, 403);
  const preflight = await h.call("/bridge/pair", { method: "OPTIONS", headers: { Origin: ORIGIN } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal((await h.call("/bridge/pair", { method: "OPTIONS", headers: { Origin: "null" } })).status, 403);
});

test("studio bridge: pairing is single use, rate limited and time bounded", async (t) => {
  const h = await harness(t);
  const pairing = await h.ui("/pairing", { extensionId: ID });
  h.advance(1001);
  assert.equal((await h.ext("pair", null, { code: pairing.data.code })).status, 403);
  const second = await h.ui("/pairing", { extensionId: ID });
  const badCode = second.data.code === "00000000" ? "11111111" : "00000000";
  for (let i = 0; i < 5; i++) assert.equal((await h.ext("pair", null, { code: badCode })).status, 401);
  assert.equal((await h.ext("pair", null, { code: second.data.code })).status, 403);
  const token = await h.pair();
  assert.equal((await h.ext("pair", null, { code: token })).status, 403);
  assert.equal((await h.ext("heartbeat", "wrong-secret", {})).status, 401);
  assert.equal((await h.ext("heartbeat", token, {}, { Origin: `chrome-extension://${OTHER}` })).status, 403);
});

test("studio bridge: pairing does not claim control, only acknowledged current Studio tab allows read-only inspection", async (t) => {
  const h = await harness(t), token = await h.pair();
  let state = (await h.ui("/status", null, "GET")).data;
  assert.equal(state.paired, true);
  assert.equal(state.connected, false);
  assert.equal(state.controlAvailable, false);
  assert.equal(state.generationAvailable, false);
  assert.equal((await h.ui("/inspect", {})).status, 409);
  await h.ext("heartbeat", token, { tab: { ...TAB, url: "https://evil.example" }, inspection: INSPECTION });
  assert.equal((await h.ui("/status", null, "GET")).data.controlAvailable, false);
  await h.ext("heartbeat", token, { tab: TAB });
  assert.equal((await h.ui("/status", null, "GET")).data.controlAvailable, false);
  await h.ext("heartbeat", token, { tab: TAB, inspection: { ...INSPECTION, token: "must-not-copy", rawText: "private" } });
  state = (await h.ui("/status", null, "GET")).data;
  assert.equal(state.controlAvailable, true);
  assert.equal(state.tab.url, "https://studio.tripo3d.ai");
  assert.equal(state.inspection.loginVerified, false);
  assert.equal(state.inspection.token, undefined);
  assert.equal(state.inspection.rawText, undefined);
  assert.equal(JSON.stringify(state).includes("must-not"), false);
  assert.equal((await h.ui("/inspect", {})).status, 202);
  const command = (await h.ext("poll", token)).data.command;
  assert.equal(command.type, "inspect");
  assert.equal(command.tabId, TAB.id);
  assert.equal((await h.ext("result", token, { id: "wrong", inspection: INSPECTION })).status, 409);
  assert.equal((await h.ext("result", token, { id: command.id, inspection: INSPECTION })).status, 200);
  assert.equal((await h.ext("poll", token)).data.command, null);
  assert.equal((await h.ext("generate", token)).status, 404);
  h.advance(101);
  state = (await h.ui("/status", null, "GET")).data;
  assert.equal(state.paired, true);
  assert.equal(state.connected, false);
  assert.equal(state.controlAvailable, false);
});

test("studio bridge: UI revocation, extension revocation, replacement and expiry revoke access and pending work", async (t) => {
  const h = await harness(t);
  let token = await h.pair();
  await h.ext("heartbeat", token, { tab: TAB, inspection: INSPECTION });
  await h.ui("/inspect", {});
  assert.equal((await h.ui("/connection", null, "DELETE")).data.paired, false);
  assert.equal((await h.ext("poll", token)).status, 403);
  token = await h.pair();
  assert.equal((await h.ext("disconnect", token)).status, 200);
  assert.equal((await h.ui("/status", null, "GET")).data.paired, false);
  token = await h.pair();
  await h.ui("/pairing", { extensionId: OTHER });
  assert.equal((await h.ext("heartbeat", token)).status, 403);
  token = await h.pair();
  h.advance(10001);
  assert.equal((await h.ext("heartbeat", token)).status, 403);
  assert.equal((await h.ui("/status", null, "GET")).data.paired, false);
});

test('public Model navigation preserves locale and refuses foreign origins, unsaved work and dialogs',()=>{
 const run=(pathname,{origin='https://studio.tripo3d.ai',dialog=false,unsaved=false}={})=>throwAdapterError(vm.runInNewContext(`(${adapterFunctions.resolveStudioGenerationWorkspace.toString()})()`,{
  location:{origin,pathname},getComputedStyle:()=>({display:'block',visibility:'visible'}),
  document:{querySelectorAll:selector=>(selector==='[role="dialog"]'&&dialog||selector==='[data-trace]'&&unsaved)?[{getBoundingClientRect:()=>({width:10,height:10}),getAttribute:key=>key==='data-trace'?'studio.workspace_rigging.asset_save_button':null}]:[]},
 }));
 for(const [pathname,target] of [['/workspace/rigging','/workspace/generate'],['/es/workspace/texture/asset','/es/workspace/generate'],['/ja/workspace/image','/ja/workspace/generate'],['/zh-CN/workspace/smart-uv','/zh-CN/workspace/generate'],['/home','/workspace/generate']]){
  assert.equal(run(pathname).url,'https://studio.tripo3d.ai'+target);
 }
 assert.throws(()=>run('/workspace/rigging',{origin:'https://example.com'}),/STUDIO_ORIGIN_CHANGED/);
 assert.throws(()=>run('/workspace/rigging',{dialog:true}),/CLOSE_OTHER_DIALOGS_FIRST/);
 assert.throws(()=>run('/workspace/rigging',{unsaved:true}),/STUDIO_UNSAVED_CHANGES/);
 assert.equal(isReadOnlyStudioCall(adapterFunctions.resolveStudioGenerationWorkspace),true);
});

test('empty Rig and Image pages report navigation separately from generation readiness',async()=>{
 for(const tool of ['rigging','image','texture','smart-uv']){
  const pathname='/ja/workspace/'+tool;
  const state=await vm.runInNewContext(`(${adapterFunctions.observeStudioDocument.toString()})()`,{
   location:{origin:'https://studio.tripo3d.ai',pathname,href:'https://studio.tripo3d.ai'+pathname},
   document:{querySelectorAll:()=>[]},crypto:globalThis.crypto,TextEncoder,URL,
  });
  assert.equal(state.workflow,tool);assert.equal(state.supported,false);
  assert.equal(state.generationNavigationVersion,1);assert.equal(state.generationWorkspaceReady,false);
 }
});

test('Model navigation timeout reports a free preparation failure without uploads or a paid click',async t=>{
 const h=await harness(t);let navigation=0;
 const worker=await workerHarness(h,null,async name=>{
  if(name==='observeStudioDocument')return {adapterVersion:2,generationNavigationVersion:1,quickGenerationVersion:1,topologySettingsVersion:1,workflow:'rigging',generationWorkspaceReady:false,supported:false,blockingDialog:false};
  if(name==='resolveStudioGenerationWorkspace')return {url:'https://studio.tripo3d.ai/workspace/generate'};
  if(name==='navigateTab'){navigation++;return {};}
  assert.fail('No changes to the form or generation before Model loads: '+name);
 });
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 const quote=h.bridge.enqueue('observe',{configureGenerationDefaults:true,faceLimits:[17000,20000,23000,25000]},{});await worker.message({type:'refresh'});
 assert.equal(h.bridge.getOperation(quote.id).error,'GENERATION_WORKSPACE_NOT_LOADED');assert.equal(navigation,1);
});

for(const start of ['rigging','image','texture','smart-uv','other'])test('generation navigates from '+start+' and rechecks after another tool change',async t=>{
 const h=await harness(t);let workflow=start,arrivals=0,clicks=0,smart=false,count=1,uploads=0;
 const slots=Object.fromEntries(['front','left','right','back'].map(slot=>[slot,{found:true,occupied:false,previewVisible:false,acceptsImages:true}]));
 const worker=await workerHarness(h,null,async(name,args)=>{
  if(name==='observeStudioDocument'){
   if(workflow==='loading'&&++arrivals>=3)workflow='generate';
   const ready=workflow==='generate';
   return {adapterVersion:2,generationNavigationVersion:1,quickGenerationVersion:1,topologySettingsVersion:1,workflow,generationWorkspaceReady:ready,supported:ready,generationMode:smart?'smart-mesh':'hd',generationCount:count,mode:'multiview',slots,blockingDialog:false,generateEnabled:true,costLabel:'100',modelLabel:smart?'P2.0':'H3.1',options:{},pageSignature:JSON.stringify(slots),existingTaskIds:[],currentTaskId:null};
  }
  if(name==='resolveStudioGenerationWorkspace')return {url:'https://studio.tripo3d.ai/ja/workspace/generate'};
  if(name==='navigateTab'){assert.equal(args[0].url,'https://studio.tripo3d.ai/ja/workspace/generate');workflow='loading';arrivals=0;return {};}
  if(name==='selectStudioSmartMesh'){assert.equal(workflow,'generate');smart=true;return {};}
  if(name==='selectStudioFourResults'){count=4;return {};}
  if(name==='uploadStudioView'){uploads++;Object.assign(slots[args[0].slot],{occupied:true,previewVisible:true,files:[{sha256:'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',size:1,mimeType:'image/png'}]});return {};}
  if(name==='clickStudioGenerate'){assert.equal(workflow,'generate');clicks++;return {};}
  throw Error('Unexpected function '+name);
 });
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});
 const connected=await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});assert.equal(connected.preparationAvailable,true);
 assert.equal(h.bridge.status().generationAvailable,false);assert.equal(h.bridge.status().preparationAvailable,true);
 const passive=h.bridge.enqueue('observe',{},{});await worker.message({type:'refresh'});
 assert.equal(h.bridge.getOperation(passive.id).status,'succeeded');assert.equal(worker.calls.filter(c=>c.type==='navigate').length,0);
 const quote=h.bridge.enqueue('observe',{configureGenerationDefaults:true,faceLimits:[17000,20000,23000,25000]},{});await worker.message({type:'refresh'});
 assert.equal(h.bridge.getOperation(quote.id).status,'succeeded',h.bridge.getOperation(quote.id).error);
 assert.equal(h.bridge.getOperation(quote.id).result.costLabel,'100');assert.equal(clicks,0);assert.equal(uploads,0);
 assert.equal(worker.calls.filter(c=>c.type==='navigate').length,1);
 workflow=start;
 const paid=h.bridge.enqueue('generate',{inputs:[{slot:'front',name:'front.png',mimeType:'image/png',dataBase64:'YQ=='}],faceLimits:[17000,20000,23000,25000],confirmUpload:true,confirmCost:true,expectedCost:'100',confirmationNonce:'confirmed-price'},{});
 await worker.message({type:'refresh'});
 assert.equal(h.bridge.getOperation(paid.id).status,'succeeded',h.bridge.getOperation(paid.id).error);
 assert.equal(clicks,1);assert.equal(uploads,1);assert.equal(worker.calls.filter(c=>c.type==='navigate').length,2);
});

test('navigation capability does not bypass permission, origin or submit snapshot checks',async t=>{
 const h=await harness(t),token=await h.pair();
 const adapter={adapterVersion:2,generationNavigationVersion:1,quickGenerationVersion:1,topologySettingsVersion:1,supported:false};
 await h.ext('heartbeat',token,{tab:TAB,inspection:INSPECTION,adapter,automationAuthorized:false});
 assert.throws(()=>h.bridge.enqueue('observe',{configureGenerationDefaults:true}),/Authorize automation/);
 await h.ext('heartbeat',token,{tab:{...TAB,url:'https://example.com'},inspection:INSPECTION,adapter,automationAuthorized:true});
 assert.equal(h.bridge.status().preparationAvailable,false);
 await h.ext('heartbeat',token,{tab:TAB,inspection:INSPECTION,adapter,automationAuthorized:true});
 assert.throws(()=>h.bridge.enqueue('submit',{}),/Explicit confirmation/);
});

test('direct paid submit on Image does not navigate or click, and blocked navigation does not upload',async t=>{
 const h=await harness(t);let resolveError=null,clicks=0;
 const worker=await workerHarness(h,null,async (name,args)=>{
  if(name==='observeStudioDocument')return {adapterVersion:2,generationNavigationVersion:1,quickGenerationVersion:1,topologySettingsVersion:1,workflow:'image',generationWorkspaceReady:false,supported:false,blockingDialog:false};
  if(name==='resolveStudioGenerationWorkspace')throw Error(resolveError||'GENERATION_WORKSPACE_NOT_LOADED');
  // A blocked tool may first close Studio's own informational hints (free);
  // here there are none, so the original blocker must be reported.
  if(name==='studioNavigationControl'&&args?.[0]?.action==='close-hints')return {navigation:'not-open',hints:0};
  clicks++;throw Error('Unexpected mutation '+name);
 });
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 const paid=h.bridge.enqueue('submit',{confirmCost:true,confirmationNonce:'old-form',expectedSnapshot:{pageSignature:'old-form'}},{});await worker.message({type:'refresh'});
 assert.equal(h.bridge.getOperation(paid.id).error,'GENERATION_WORKSPACE_REQUIRED');
 for(const blocker of ['STUDIO_UNSAVED_CHANGES','CLOSE_OTHER_DIALOGS_FIRST']){
  resolveError=blocker;
  const quote=h.bridge.enqueue('observe',{configureGenerationDefaults:true,faceLimits:[17000,20000,23000,25000]},{});await worker.message({type:'refresh'});
  assert.equal(h.bridge.getOperation(quote.id).error,blocker);
 }
 assert.equal(clicks,0);assert.equal(worker.calls.filter(c=>c.type==='navigate').length,0);
});

async function workerHarness(h, fetchOverride, adapterOverride, downloads,topologyOverride,timeouts) {
  let listener;
  let removedListener,updatedListener,nextTabId=20,hiddenQueries=0;
  const browserTabs=new Map([[TAB.id,TAB]]);
  const memory = {}, localMemory={}, calls = [], alarmNames = new Set();
  let canInspect = true;
  const chrome = {
    contentSettings:{automaticDownloads:{clear:async()=>{},set:async options=>{assert.equal(options.primaryPattern,'https://studio.tripo3d.ai/*');assert.equal(options.setting,'allow');calls.push({type:'automaticDownloads',...options});},get:async()=>({setting:'allow'})}},
    ...(downloads?{downloads}:{}),
    runtime: { id: ID, getURL: (file) => `${ORIGIN}/${file}`, onMessage: { addListener: (fn) => listener = fn } },
    storage: { local:{get:async key=>({[key]:localMemory[key]}),set:async values=>Object.assign(localMemory,structuredClone(values)),remove:async key=>{delete localMemory[key];}},session: {
      get: async (key) => ({ [key]: memory[key] }),
      set: async (values) => Object.assign(memory, structuredClone(values)),
      remove: async (key) => { delete memory[key]; },
    } },
    alarms: {
      get: async (name) => alarmNames.has(name), create: async (name) => alarmNames.add(name), clear: async (name) => alarmNames.delete(name),
      onAlarm: { addListener() {} },
    },
    tabs: {
      get: async (id) => browserTabs.get(id)||({...TAB,id}), query: async () => {const tabs=[...browserTabs.values()];return tabs.some(t=>t.id>=20)&&hiddenQueries-->0?tabs.filter(t=>t.id<20):tabs;},
      create:async options=>{const tab={id:nextTabId++,windowId:1,...options};browserTabs.set(tab.id,tab);await adapterOverride?.('navigateTab',[options]);return tab;},
      reload:async id=>{calls.push({type:'reload',id});await adapterOverride?.('reloadTab');},
      remove:async id=>{browserTabs.delete(id);await removedListener?.(id);calls.push({type:'close',id});},
      update:async(id,options)=>{browserTabs.set(id,{...browserTabs.get(id),...options});calls.push({type:'navigate',id,url:options.url});await adapterOverride?.('navigateTab',[options]);},
      onRemoved: { addListener(fn) {removedListener=fn;} }, onUpdated: { addListener(fn) {updatedListener=fn;} },
    },
    scripting: { executeScript: async ({ target, world,func,args }) => {
      calls.push({ type: "executeScript", target, world,funcName:func.name });
      if (!canInspect) throw new Error("mock tab unavailable");
      if(func.name==='studioTopologyControl')return [{result:topologyOverride?await topologyOverride(args[0]):{open:true,faceLimits:args[0].faceLimits}}];
      if(func.name==='studioWorkGuard'){calls.push({type:'guard',state:args[0].state,step:args[0].step});return [{result:{guard:args[0].state}}];}
      if(adapterOverride&&func.name!=="inspectDocument")return [{result:await adapterOverride(func.name,args)}];
      return [{ result: INSPECTION }];
    } },
  };
  const fakeFetch = async (url, options) => {
    const route = new URL(url).pathname.split("/").at(-1);
    const data = JSON.parse(options.body);
    calls.push({ type: "request", route, data });
    if(fetchOverride?.before)await fetchOverride.before(route,data);
    const result = await h.ext(route, options.headers.Authorization?.slice(7), data);
    // Hold an already successful response to exercise a late completion after revocation.
    if (fetchOverride) await fetchOverride(route, data);
    return { ok: result.status < 400, status: result.status, json: async () => result.data };
  };
  const source=(await fs.readFile("extension-tripo-studio/background.js", "utf8")).replace(/^import[^\n]+\n/gm,"");
  vm.runInNewContext(source, {
    chrome, fetch: fakeFetch, AbortSignal, URL, Date, console,...adapterFunctions,readCandidatePreviews,captureBatch,textureTiming,
    createConnectionLoop:options=>createConnectionLoop({...options,schedule:()=>1,cancel:()=>{}}),createCommandHeartbeat,createGroupCommands,createMeshImporter,isReadOnlyStudioCall,navigateStudioTask,studioNavigationControl,observeGroupStudio,checkNavigationRecovery,checkTabLifecycle,isNavigationCheckCall,isExportPreparationCall,resumeUrl,reopenedTab,studioWorkGuard,__fitaTimeouts:timeouts,
    crypto:globalThis.crypto,atob,TextDecoder,setTimeout:(fn)=>setTimeout(fn,0),clearTimeout,
  });
  async function message(value) {
    return new Promise((resolve) => listener(value, { id: ID, url: `${ORIGIN}/popup.html` }, resolve));
  }
  return { message, listener: () => listener, memory,localMemory, calls,chrome,browserTabs,updated:()=>updatedListener,delayNewTabQueries:n=>{hiddenQueries=n;}, setInspect: (value) => canInspect = value };
}

test("studio extension with simulated Chromium: selected tab handshake, read-only command and secret isolation", async (t) => {
  const h = await harness(t), worker = await workerHarness(h);
  assert.equal(worker.listener()({ type: "pair" }, { id: ID, url: "https://studio.tripo3d.ai/" }, () => {}), false);
  const { data } = await h.ui("/pairing", { extensionId: ID });
  assert.equal((await worker.message({ type: "pair", code: data.code })).ok, true);
  assert.equal(worker.memory.bridge.tabId, null);
  assert.equal((await h.ui("/status", null, "GET")).data.controlAvailable, false);
  assert.equal((await worker.message({ type: "connect", tabId: TAB.id })).ok, true);
  assert.equal((await h.ui("/status", null, "GET")).data.controlAvailable, true);
  assert.equal((await worker.message({ type: "status" })).bridge.token, undefined);
  await h.ui("/inspect", {});
  assert.equal((await worker.message({ type: "refresh" })).ok, true);
  assert.equal((await h.ui("/status", null, "GET")).data.pending, null);
  assert.ok(worker.calls.some((call) => call.type === "request" && call.route === "result"));
  assert.ok(worker.calls.filter((call) => call.type === "executeScript").every((call) => call.target.tabId === TAB.id && call.world === "ISOLATED"));
  assert.equal((await worker.message({ type: "generate" })).ok, false);
  assert.equal((await worker.message({ type: "disconnect" })).ok, true);
  assert.equal(worker.memory.bridge, undefined);
  assert.equal((await h.ui("/status", null, "GET")).data.paired, false);
});

test("studio extension: disconnect during failed-tab heartbeat never restores the secret", async (t) => {
  const h = await harness(t);
  let unblock, entered;
  const arrived = new Promise((resolve) => entered = resolve);
  const held = new Promise((resolve) => unblock = resolve);
  const worker = await workerHarness(h, async (route, data) => {
    if (route === "heartbeat" && data.tab === null) { entered(); await held; }
  });
  const { data } = await h.ui("/pairing", { extensionId: ID });
  await worker.message({ type: "pair", code: data.code });
  await worker.message({ type: "connect", tabId: TAB.id });
  worker.setInspect(false);
  const ongoing = worker.message({ type: "refresh" });
  await arrived;
  await worker.message({ type: "disconnect" });
  unblock();
  await ongoing;
  assert.equal(worker.memory.bridge, undefined);
  assert.equal((await h.ui("/status", null, "GET")).data.paired, false);
});

test('a busy worker keeps the bridge alive with fresh observations without polling or executing another command',async t=>{
 const h=await harness(t);let hold=false,entered,release;
 const arrived=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 const worker=await workerHarness(h,null,async(name,args)=>{
  assert.equal(name,'observeStudioDocument');
  if(hold&&args?.[0]?.includeFileHashes){hold=false;entered();await held;}
  return {adapterVersion:2,supported:true,mode:'multiview',blockingDialog:false};
 });
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 const op=h.bridge.enqueue('observe',{},{});hold=true;
 const running=worker.message({type:'refresh'});await arrived;
 const polls=worker.calls.filter(c=>c.type==='request'&&c.route==='poll').length;
 h.advance(101);assert.equal(h.bridge.status().connected,false);
 assert.equal((await worker.message({type:'refresh'})).ok,true);
 assert.equal(h.bridge.status().connected,true);assert.equal(h.bridge.getOperation(op.id).status,'running');
 assert.equal(worker.calls.filter(c=>c.type==='request'&&c.route==='poll').length,polls);
 release();await running;assert.equal(h.bridge.getOperation(op.id).status,'succeeded');
 assert.equal(worker.calls.some(c=>c.type==='executeScript'&&/upload|Generate|submit|download/i.test(c.funcName)),false);
});

test("studio extension: all visible message keys exist for English, Spanish and Japanese", () => {
  const keys = Object.keys(messages.en).sort();
  for (const language of ["es", "ja"]) {
    assert.deepEqual(Object.keys(messages[language]).sort(), keys);
    assert.ok(Object.values(messages[language]).every((text) => typeof text === "string" && text.length > 0));
  }
});

test('connect reports adapter execution failure instead of silently accepting an unusable opt-in',async t=>{
  const h=await harness(t),worker=await workerHarness(h,null,()=>{throw new Error('mock adapter failure');});
  const {data}=await h.ui('/pairing',{extensionId:ID});
  await worker.message({type:'pair',code:data.code});
  const result=await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  assert.equal(result.ok,false);
  assert.match(result.error,/ADAPTER_EXECUTION_FAILED: mock adapter failure/);
  const popup=await worker.message({type:'status'});
  assert.equal(popup.workerRevision,adapterFunctions.STUDIO_WORKER_REVISION);
  assert.equal(popup.bridge.paired,true);
  assert.equal(popup.bridge.automationAuthorized,false);
  assert.match(popup.bridge.lastError,/mock adapter failure/);
  await worker.message({type:'refresh'});
  assert.match((await worker.message({type:'status'})).bridge.lastError,/mock adapter failure/);
  assert.equal(h.bridge.status().preparationAvailable,false);
});

test('non-generation Studio pages stay connected while paid preparation stays gated',async t=>{
  const h=await harness(t),worker=await workerHarness(h,null,()=>({adapterVersion:2,topologySettingsVersion:1,supported:false}));
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});
  const result=await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  assert.equal(result.ok,true);
  assert.equal(h.bridge.status().automationAuthorized,true);
  assert.equal(h.bridge.status().adapterVersion,2);
  assert.equal(h.bridge.status().preparationAvailable,false);
  assert.equal((await worker.message({type:'status'})).bridge.preparationAvailable,false);
});

test("studio automation requires new explicit tab consent, protects inputs and keeps command payload private",async(t)=>{
  const h=await harness(t),token=await h.pair();
  const adapter={adapterVersion:2,topologySettingsVersion:1,supported:true,mode:"multiview",costLabel:"65",modelLabel:"H3.1"};
  await h.ext("heartbeat",token,{tab:TAB,inspection:INSPECTION,adapter});
  assert.throws(()=>h.bridge.enqueue("prepare",{},{}),/Authorize automation/);
  await h.ext("heartbeat",token,{tab:TAB,inspection:INSPECTION,adapter,automationAuthorized:true});
  assert.equal(h.bridge.status().generationAvailable,true);
  assert.throws(()=>h.bridge.enqueue("submit",{confirmCost:true},{}),/Explicit confirmation/);
  assert.throws(()=>h.bridge.enqueue("monitor",{taskId:"00000000-0000-0000-0000-000000000000"},{}),/Confirm the generated/);
  const operation=h.bridge.enqueue("prepare",{inputs:[{dataBase64:"private-image-content"}]},{projectId:"test"});
  assert.equal(JSON.stringify(operation).includes("private-image-content"),false);
  assert.equal(JSON.stringify(h.bridge.getOperation(operation.id)).includes("private-image-content"),false);
  const command=(await h.ext("poll",token)).data.command;
  assert.equal(command.payload.inputs[0].dataBase64,"private-image-content");
  assert.equal(h.bridge.getOperation(operation.id).status,"running");
  assert.equal((await h.ext("operation-result",token,{id:operation.id,result:{stage:"prepared",costLabel:"65"}})).status,200);
  assert.equal(h.bridge.getOperation(operation.id).status,"succeeded");
});

test("studio adapter worker: prepare uses exact three slots; changed quote never clicks Generate; successful click is at-most-once after lost response",async(t)=>{
  const h=await harness(t);
  const slots=Object.fromEntries(["front","left","right","back"].map((slot)=>[slot,{found:true,occupied:false,previewVisible:false,acceptsImages:true}]));
  let cost="65",signature="initial",clicks=0,reportFailure=false;
  const hook=async()=>{};
  hook.before=async(route)=>{if(route==="operation-result"&&reportFailure){reportFailure=false;throw new Error("mock lost connection before ack");}};
  const worker=await workerHarness(h,hook,async(name,args)=>{
    if(name==="observeStudioDocument")return {adapterVersion:2,topologySettingsVersion:1,supported:true,generationMode:"smart-mesh",generationCount:4,mode:"multiview",slots,anyUploadOccupied:Object.values(slots).some((slot)=>slot.occupied),blockingDialog:false,generateEnabled:true,generateLabel:`Generar ${cost}`,costLabel:cost,modelLabel:"P2.0",options:{},pageSignature:signature,currentTaskId:null,existingTaskIds:[]};
    if(name==="uploadStudioView"){slots[args[0].slot].occupied=true;slots[args[0].slot].previewVisible=true;slots[args[0].slot].files=[{sha256:'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',size:1,mimeType:'image/png'}];signature="prepared";return {dispatched:true};}
    if(name==="clickStudioGenerate"){clicks++;return {clicked:true};}
    throw new Error(`Unexpected adapter function ${name}`);
  });
  const {data}=await h.ui("/pairing",{extensionId:ID});
  await worker.message({type:"pair",code:data.code});
  await worker.message({type:"connect",tabId:TAB.id,automationAuthorized:true});
  const inputs=["front","right","back"].map((slot)=>({slot,name:`${slot}.png`,mimeType:"image/png",dataBase64:"YQ=="}));
  const prepare=h.bridge.enqueue("prepare",{inputs,faceLimits:[17000,20000,23000,25000]},{});
  await worker.message({type:"refresh"});
  const prepared=h.bridge.getOperation(prepare.id);
  assert.equal(prepared.status,"succeeded");
  assert.equal(prepared.result.stage,"prepared");
  assert.equal(slots.left.occupied,false);
  assert.equal(clicks,0);
  cost="99";signature="changed";
  const invalid=h.bridge.enqueue("submit",{expectedSnapshot:prepared.result,confirmCost:true,confirmationNonce:"test-consent"},{});
  await worker.message({type:"refresh"});
  assert.notEqual(h.bridge.getOperation(invalid.id).status,"succeeded");
  assert.equal(clicks,0);
  cost="65";signature="prepared";
  const submit=h.bridge.enqueue("submit",{expectedSnapshot:prepared.result,confirmCost:true,confirmationNonce:"test-consent-2"},{});
  reportFailure=true;
  await worker.message({type:"refresh"});
  assert.equal(clicks,1);
  assert.equal(h.bridge.getOperation(submit.id).status,"running");
  await worker.message({type:"refresh"});
  assert.equal(clicks,1);
  assert.equal(h.bridge.getOperation(submit.id).status,"succeeded");
  assert.equal(h.bridge.getOperation(submit.id).result.taskNeedsConfirmation,true);
});

test('texture worker rechecks resolution and cost before the paid click; quote updates never upload or submit',async t=>{
  const h=await harness(t),sourceTaskId='10000000-0000-4000-8000-000000000001';
  const sha256='ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',slots=Object.fromEntries(['front','left','right','back'].map(slot=>[slot,{found:true,occupied:false,previewVisible:false,acceptsImages:true}]));
  let settings={resolution:'2K',removeLighting:false},clicks=0,uploads=0,desired=null,observations=0;
  const worker=await workerHarness(h,null,async(name,args)=>{
    if(name==='observeStudioDocument'){if(desired&&++observations>=3){settings=desired;desired=null;}return {adapterVersion:2,textureWorkflowVersion:2,workflow:'texture',supported:true,currentTaskId:sourceTaskId,existingTaskIds:[sourceTaskId],generationMode:'texture',mode:'multiview',slots,generateEnabled:true,costLabel:{'2K':'10','4K':'20','8K':'30'}[settings.resolution],generateLabel:'Generate Texture',options:{texture:{removeLighting:settings.removeLighting,resolution:settings.resolution}},pageSignature:JSON.stringify(settings),blockingDialog:false};}
    if(name==='selectStudioTextureSettings'){if(!desired){desired={...args[0]};observations=0;}return {settingsChanged:true};}
    if(name==='uploadStudioView'){uploads++;Object.assign(slots[args[0].slot],{occupied:true,previewVisible:true,files:[{sha256,size:1,mimeType:'image/png'}]});return {dispatched:true};}
    if(name==='clickStudioGenerate'){clicks++;return {clicked:true};}
    throw new Error('Unexpected texture mutation '+name);
  });
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const prepare=h.bridge.enqueue('prepare',{workflow:'texture',sourceTaskId,settings,inputs:[{slot:'front',name:'front.png',mimeType:'image/png',dataBase64:'YQ=='}]},{});await worker.message({type:'refresh'});
  const prepared=h.bridge.getOperation(prepare.id);assert.equal(prepared.status,'succeeded');assert.equal(prepared.result.preparationReady,true);assert.equal(uploads,1);assert.equal(clicks,0);
  const quote=h.bridge.enqueue('observe',{workflow:'texture',sourceTaskId,refreshTextureSettings:true,settings:{resolution:'8K',removeLighting:false},expectedInputs:prepared.result.expectedInputs},{});await worker.message({type:'refresh'});
  const quoted=h.bridge.getOperation(quote.id);assert.equal(quoted.result.costLabel,'30');assert.equal(uploads,1);assert.equal(clicks,0);
  const stale=h.bridge.enqueue('submit',{workflow:'texture',confirmCost:true,confirmationNonce:'fixture',expectedSnapshot:prepared.result},{});await worker.message({type:'refresh'});assert.equal(h.bridge.getOperation(stale.id).status,'failed');assert.equal(clicks,0);
  h.bridge.enqueue('submit',{workflow:'texture',confirmCost:true,confirmationNonce:'fixture2',expectedSnapshot:quoted.result},{});await worker.message({type:'refresh'});assert.equal(clicks,1);
});

test('retexturing clears a reference restored by the multiview transition, reuses proven views and never generates',async t=>{
  const h=await harness(t),sourceTaskId='10000000-0000-4000-8000-000000000001';
  const sha256='ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb';
  const slots=Object.fromEntries(['front','left','right','back'].map(slot=>[slot,{found:true,semanticBinding:'observed-multiview-card',occupied:false,previewVisible:false,acceptsImages:true,files:[]}]));
  const settings={resolution:'4K',removeLighting:false},uploads=[],clears=[];let mode='other',clearWorks=true;
  const occupy=(slot,hash)=>Object.assign(slots[slot],{occupied:true,previewVisible:true,acceptsImages:false,previewProof:{previewBytesSha256:hash},files:[{sha256:hash,size:1,mimeType:'image/png'}]});
  const worker=await workerHarness(h,null,async(name,args)=>{
    if(name==='observeStudioDocument')return structuredClone({adapterVersion:2,textureWorkflowVersion:2,workflow:'texture',supported:true,currentTaskId:sourceTaskId,existingTaskIds:[sourceTaskId],generationMode:'texture',mode,slots,generateEnabled:true,costLabel:'20',generateLabel:'Generate Texture 20',options:{texture:settings},pageSignature:'prepared',blockingDialog:false});
    if(name==='selectStudioTextureSettings')return {settingsChanged:true};
    if(name==='selectStudioMultiview'){mode='multiview';occupy('front','0'.repeat(64));return {selected:true};}
    if(name==='clearStudioView'){clears.push(args[0]);if(clearWorks)Object.assign(slots[args[0]],{occupied:false,previewVisible:false,acceptsImages:true,files:[]});return {clearClicked:true};}
    if(name==='uploadStudioView'){assert.equal(slots[args[0].slot].occupied,false);uploads.push(args[0].slot);occupy(args[0].slot,sha256);return {dispatched:true};}
    throw new Error('Unexpected mutation: '+name);
  });
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const run=async()=>{const op=h.bridge.enqueue('prepare',{workflow:'texture',sourceTaskId,settings,inputs:['front','left','right','back'].map(slot=>({slot,name:slot+'.png',mimeType:'image/png',dataBase64:'YQ=='}))},{});await worker.message({type:'refresh'});return h.bridge.getOperation(op.id);};
  let result=await run();assert.equal(result.status,'succeeded',result.error);assert.equal(result.result.preparationReady,true);assert.deepEqual(clears,['front']);assert.equal(uploads.length,4);
  result=await run();assert.equal(result.status,'succeeded',result.error);assert.equal(uploads.length,4,'same four contents must not be reuploaded');assert.equal(clears.length,1);
  occupy('right','0'.repeat(64));result=await run();assert.equal(result.status,'succeeded',result.error);assert.deepEqual(clears,['front','right']);assert.equal(uploads.length,5,'only changed image is replaced');
  clearWorks=false;occupy('back','0'.repeat(64));result=await run();assert.equal(result.status,'failed');assert.equal(result.error,'REPLACEMENT_SLOT_NOT_CLEARED_BACK');assert.equal(uploads.length,5);
  assert.equal(worker.calls.some(call=>call.funcName==='clickStudioGenerate'),false);
});

test("studio recovery verifies existing file content without re-upload and refuses a different file with identical metadata",async(t)=>{
  const h=await harness(t),sha256='ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb';
  const slots=Object.fromEntries(['front','left','right','back'].map(slot=>[slot,{found:true,occupied:slot==='front',previewVisible:slot==='front',files:slot==='front'?[{sha256,size:1,mimeType:'image/png'}]:[]}]));
  const mutations=[];
  let generationMode='smart-mesh',generationCount=4;
  const worker=await workerHarness(h,null,async(name)=>{
    if(name!=='observeStudioDocument'){mutations.push(name);throw new Error('Recovery must not mutate Studio');}
    return {adapterVersion:2,topologySettingsVersion:1,supported:true,generationMode,generationCount,mode:'multiview',slots,anyUploadOccupied:true,blockingDialog:false,generateEnabled:true,costLabel:'100',modelLabel:generationMode==='smart-mesh'?'P2.0':'H3.1',options:{},pageSignature:'recovery',existingTaskIds:[],currentTaskId:null};
  });
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const expectedInputs=[{slot:'front',sha256,size:1,mimeType:'image/png'}];
  let operation=h.bridge.enqueue('observe',{expectedInputs},{});await worker.message({type:'refresh'});
  let result=h.bridge.getOperation(operation.id).result;
  assert.equal(result.inputsVerified,true);assert.equal(result.preparationReady,true);assert.deepEqual(result.selectedSlots,['front']);
  assert.equal(result.mode,'smart-mesh');assert.equal(result.generationCount,4);assert.equal(result.costLabel,'100');
  generationMode='hd';
  operation=h.bridge.enqueue('observe',{expectedInputs},{});await worker.message({type:'refresh'});result=h.bridge.getOperation(operation.id).result;
  assert.equal(result.inputsVerified,true);assert.equal(result.preparationReady,false);assert.ok(result.readinessErrors.includes('SMART_MESH_REQUIRED'));
  generationMode='smart-mesh';generationCount=1;
  operation=h.bridge.enqueue('observe',{expectedInputs},{});await worker.message({type:'refresh'});result=h.bridge.getOperation(operation.id).result;
  assert.equal(result.preparationReady,false);assert.ok(result.readinessErrors.includes('FOUR_GENERATIONS_REQUIRED'));generationCount=4;
  slots.front.files[0].sha256='0'.repeat(64);
  operation=h.bridge.enqueue('observe',{expectedInputs},{});await worker.message({type:'refresh'});result=h.bridge.getOperation(operation.id).result;
  assert.equal(result.inputsVerified,false);assert.equal(result.preparationReady,false);assert.ok(result.readinessErrors.includes('FILE_CONTENT_MISMATCH_FRONT'));
  slots.front.files[0].sha256=sha256;slots.front.previewVisible=false;
  operation=h.bridge.enqueue('observe',{expectedInputs},{});await worker.message({type:'refresh'});result=h.bridge.getOperation(operation.id).result;
  assert.equal(result.inputsVerified,true);assert.equal(result.preparationReady,false);assert.ok(result.readinessErrors.includes('PREVIEW_NOT_OBSERVED_FRONT'));
  assert.deepEqual(mutations,[]);
});

test("studio prepares one or four explicit slots and never substitutes left with right",async(t)=>{
  for(const requested of [['left'],['front','left','right','back']])await t.test(requested.join(','),async(t)=>{
    const h=await harness(t),sha256='ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb';
    const slots=Object.fromEntries(['front','left','right','back'].map(slot=>[slot,{found:true,occupied:false,previewVisible:false,acceptsImages:true,files:[]}]));
    const uploaded=[];
    const setup=[];let generationMode='hd',generationCount=1;
    const worker=await workerHarness(h,null,async(name,args)=>{
      if(name==='observeStudioDocument')return {adapterVersion:2,topologySettingsVersion:1,supported:true,generationMode,generationCount,mode:'multiview',slots,anyUploadOccupied:uploaded.length>0,blockingDialog:false,generateEnabled:true,costLabel:'100',modelLabel:generationMode==='smart-mesh'?'P2.0':'H3.1',options:{},pageSignature:'flexible',existingTaskIds:[],currentTaskId:null};
      if(name==='selectStudioSmartMesh'){assert.equal(uploaded.length,0);setup.push('smart');generationMode='smart-mesh';return {selected:true};}
      if(name==='selectStudioFourResults'){assert.equal(uploaded.length,0);setup.push('four');generationCount=4;return {selected:true};}
      if(name==='uploadStudioView'){assert.deepEqual(setup,['smart','four']);const slot=args[0].slot;uploaded.push(slot);Object.assign(slots[slot],{occupied:true,previewVisible:true,files:[{sha256,size:1,mimeType:'image/png'}]});return {dispatched:true};}
      throw new Error('Unexpected mutation '+name);
    });
    const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
    const inputs=requested.map(slot=>({slot,name:`${slot}.png`,mimeType:'image/png',dataBase64:'YQ=='}));
    const operation=h.bridge.enqueue('prepare',{inputs,faceLimits:[17000,20000,23000,25000]},{});await worker.message({type:'refresh'});
    const result=h.bridge.getOperation(operation.id);
    assert.equal(result.status,'succeeded',result.error);assert.deepEqual(result.result.selectedSlots,requested);assert.deepEqual(uploaded,requested);
    for(const slot of ['front','left','right','back'])assert.equal(slots[slot].occupied,requested.includes(slot));
  });
});

test('adapter verifies native file bytes but never attributes sibling thumbnails or checkerboards to an empty slot',async()=>{
  const uploadSelector='[data-trace="studio.workspace_generate.upload_image_button"]';
  const visible={getBoundingClientRect:()=>({width:80,height:80})};
  let showImage=false;
  const image={...visible,complete:true,naturalWidth:256,naturalHeight:256,currentSrc:'blob:private-preview',src:'blob:private-preview'};
  const containers=['front','left','right','back'].map(slot=>{
    const icon={classList:{contains:value=>value===`i-tripo:${slot}-view`}};
    const input={accept:'image/png,image/webp,image/jpg,image/jpeg',files:slot==='front'?[{name:'front.png',size:1,type:'image/png',lastModified:0,arrayBuffer:async()=>new Uint8Array([97]).buffer}]:[]};
    const container={...visible,querySelector:selector=>selector==='input[type="file"]'?input:null,querySelectorAll:selector=>selector==='[class]'?[icon]:selector==='input[type="file"]'?[input]:[]};
    const scope={...visible,parentElement:null,querySelectorAll:selector=>selector===uploadSelector?[container]:selector==='[class]'?[icon]:selector==='img'?(slot==='front'&&showImage?[image]:[]):selector==='*'?[container]:[]};
    container.parentElement=scope;return container;
  });
  const context={location:{origin:'https://studio.tripo3d.ai',pathname:'/workspace/generate',href:'https://studio.tripo3d.ai/workspace/generate'},document:{querySelectorAll:selector=>selector===uploadSelector?containers:[]},crypto:globalThis.crypto,TextEncoder,URL,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1',backgroundImage:'url(data:image/webp;base64,checkerboard)'})};
  const observe=()=>vm.runInNewContext(`(${adapterFunctions.observeStudioDocument.toString()})({includeFileHashes:true})`,context);
  let snapshot=await observe();
  assert.equal(snapshot.slots.front.files[0].sha256,'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  assert.equal(snapshot.slots.front.previewVisible,false);assert.equal(snapshot.slots.left.occupied,false);
  assert.ok(snapshot.slots.front.diagnostic.visibleBackgroundImages>0);
  showImage=true;snapshot=await observe();
  assert.equal(snapshot.slots.front.previewVisible,false);assert.equal(snapshot.slots.front.diagnostic.directImageCount,0);assert.equal(snapshot.slots.front.diagnostic.scopeImageCount,0);
  assert.equal(JSON.stringify(snapshot).includes('blob:private-preview'),false);
});

test('confirmed task resolution requires a unique actual same-origin Studio link',()=>{
  const id='11111111-2222-3333-4444-555555555555';
  let links=[];
  const context={location:{origin:'https://studio.tripo3d.ai'},document:{querySelectorAll:s=>s==='a[href]'?links.map(href=>({href})):[]},URL};
  const resolve=()=>{const value=vm.runInNewContext(`(${adapterFunctions.resolveConfirmedStudioTask.toString()})('${id}')`,context);if(value.adapterError)throw Error(value.adapterError);return value;};
  assert.throws(resolve,/CONFIRMED_TASK_LINK_NOT_OBSERVED/);
  links=[`https://evil.example/workspace/generate/model-${id}`,`https://studio.tripo3d.ai/account/${id}`];
  assert.throws(resolve,/CONFIRMED_TASK_LINK_NOT_OBSERVED/);
  links=[`https://studio.tripo3d.ai/workspace/generate/model-${id}`];
  assert.equal(resolve().url,links[0]);
  links.push(`https://studio.tripo3d.ai/es/workspace/generate/different-${id}`);
  assert.throws(resolve,/CONFIRMED_TASK_LINK_NOT_OBSERVED/);
});

test('candidate navigation preserves unsaved UV or texture work even when the exact asset link exists',()=>{
 const id='11111111-2222-3333-4444-555555555555';
 const save={getAttribute:()=> 'studio.workspace_smart-uv.asset_save_button',getBoundingClientRect:()=>({width:80,height:30})};
 const context={location:{origin:'https://studio.tripo3d.ai'},document:{querySelectorAll:s=>s==='[data-trace]'?[save]:s==='a[href]'?[{href:`https://studio.tripo3d.ai/workspace/generate/model-${id}`}]:[]},URL,getComputedStyle:()=>({display:'block',visibility:'visible'})};
 assert.equal(vm.runInNewContext(`(${adapterFunctions.resolveConfirmedStudioTask})('${id}')`,context).adapterError,'STUDIO_UNSAVED_CHANGES');
});

test('monitor navigates only after explicit task confirmation and verifies the resulting task',async t=>{
  const h=await harness(t),taskId='11111111-2222-3333-4444-555555555555';let currentTaskId=null;
  const worker=await workerHarness(h,null,async(name,args)=>{
    if(name==='observeStudioDocument')return {adapterVersion:2,topologySettingsVersion:1,supported:true,workflow:'generate',blockingDialog:false,currentTaskId,modelReady:currentTaskId===taskId,existingTaskIds:[taskId]};
    if(name==='observeGroupStudio')return {taskId:currentTaskId,workflow:'generate',links:[{taskId,workflow:'generate',url:`https://studio.tripo3d.ai/workspace/generate/observed-${taskId}`}]};
    if(name==='resolveConfirmedStudioTask'){assert.equal(args[0],taskId);return {url:`https://studio.tripo3d.ai/workspace/generate/observed-${taskId}`};}
    if(name==='navigateTab'){currentTaskId=taskId;return {};}
    throw new Error('Unexpected mutation '+name);
  });
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  let operation=h.bridge.enqueue('monitor',{taskId,taskConfirmed:true},{});await worker.message({type:'refresh'});
  assert.equal(h.bridge.getOperation(operation.id).status,'failed');assert.equal(worker.calls.filter(call=>call.type==='navigate').length,0);
  operation=h.bridge.enqueue('monitor',{taskId,taskConfirmed:true,navigateConfirmedTask:true},{});await worker.message({type:'refresh'});
  assert.equal(h.bridge.getOperation(operation.id).result.stage,'ready');assert.equal(worker.calls.filter(call=>call.type==='navigate').length,1);
});

test('live-worker navigation diagnostic uses automatic monitor recovery for all tools without paid or recovery buttons',async t=>{
 const h=await harness(t),taskId='11111111-2222-4333-8444-555555555555';let workflow='texture';
 const links=['generate','texture','smart-uv','rigging'].map(workflow=>({taskId,workflow,url:`https://studio.tripo3d.ai/workspace/${workflow}/observed-${taskId}`}));
 const worker=await workerHarness(h,null,async(name,args)=>{
  if(name==='observeStudioDocument')return {adapterVersion:2,navigationCheckVersion:1,generationNavigationVersion:1,supported:true,currentTaskId:taskId,workflow,modelReady:workflow==='generate',blockingDialog:false};
  if(name==='observeGroupStudio')return {taskId,workflow,links,modelReady:workflow==='generate',unsavedChanges:false,importBusy:false,importFileCount:0};
  if(name==='navigateTab'){workflow=new URL(args[0].url).pathname.match(/workspace\/([^/]+)/)[1];return {};}
  throw Error('Unexpected action '+name);
 });
 assert.equal((await h.ui('/navigation-check',{})).status,409);
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 assert.equal((await h.ui('/navigation-check',{taskId})).status,400);
 const response=await h.ui('/navigation-check',{});assert.equal(response.status,202);
 assert.equal((await h.ui('/navigation-check',{})).status,409);
 await worker.message({type:'refresh'});
 const result=await h.ui('/navigation-check/'+response.data.operation.id,null,'GET'),report=result.data.operation.result.navigationCheck;
 assert.equal(report.passed,true);assert.equal(report.steps.length,4);assert(report.steps.every(s=>s.recoveredWorkflow==='generate'));assert.equal(report.restoredInitialView,true);assert.equal(workflow,'texture');
 assert.equal(worker.calls.filter(c=>c.type==='navigate').length,8);
 assert.equal(worker.calls.some(c=>c.type==='executeScript'&&/Generate|upload|studioGroupControl|studioRigControl|captureStudioExport/.test(c.funcName)),false);
 assert.equal(worker.calls.some(c=>c.type==='request'&&c.data.type==='submit'),false);
 assert.equal((await h.ui('/navigation-check/not-an-operation',null,'GET')).status,404);
});

for(const start of ['texture','rigging','image','smart-uv'])test(`candidate recovery restores Model from ${start} before inspecting the requested asset`,async t=>{
 const h=await harness(t),ids=[1,2,3,4].map(n=>`10000000-0000-4000-8000-00000000000${n}`),taskId=ids[1];
 let workflow=start,currentTaskId=start==='texture'?taskId:ids[0],blocked=true,closed=0;
 const worker=await workerHarness(h,null,async(name,args)=>{
  if(name==='observeStudioDocument')return {adapterVersion:2,generationNavigationVersion:1,supported:workflow==='generate',workflow,currentTaskId,blockingDialog:blocked,modelReady:workflow==='generate'};
  if(name==='observeGroupStudio')return {taskId:currentTaskId,workflow,blockingDialog:blocked,links:[{taskId,workflow:'generate',url:`https://studio.tripo3d.ai/workspace/generate/existing-${taskId}`}]};
  if(name==='readStudioGenerationFailures')return {failures:[],navigation:'not-open'};
  if(name==='studioNavigationControl')return {navigation:'not-open'};
  if(name==='exportStudioControl'){
   assert.equal(args[0].step,'close');assert.equal(args[0].taskId,currentTaskId);
   blocked=false;closed++;return {stage:'closed'};
  }
  if(name==='resolveConfirmedStudioTask'){assert.deepEqual(Array.from(args),[taskId,'generate']);assert.equal(blocked,false);return {url:`https://studio.tripo3d.ai/workspace/generate/existing-${taskId}`};}
  if(name==='navigateTab'){workflow='generate';currentTaskId=taskId;return {};}
  if(name==='readCandidatePreviews')return [];
  throw Error('Unexpected command '+name);
 });
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 const op=h.bridge.enqueue('monitor',{taskId,taskConfirmed:true,navigateConfirmedTask:true,batchTaskIds:ids,submissionId:'existing-batch'},{});
 await worker.message({type:'refresh'});
 assert.equal(h.bridge.getOperation(op.id).result.stage,'ready');assert.equal(closed,1);
 assert.equal(worker.calls.filter(c=>c.type==='navigate').length,1);
 assert.equal(worker.calls.some(c=>c.type==='executeScript'&&/Generate|upload|SmartMesh/.test(c.funcName)),false);
});

test('candidate recovery opens the public Model workspace when the current tool hides observed candidate links',async t=>{
 const h=await harness(t),taskId='11111111-2222-3333-4444-555555555555';let workflow='texture',currentTaskId=null;
 const worker=await workerHarness(h,null,async(name)=>{
  if(name==='observeStudioDocument')return {adapterVersion:2,supported:true,workflow,currentTaskId,blockingDialog:false,modelReady:currentTaskId===taskId};
  if(name==='observeGroupStudio')return {taskId:currentTaskId,workflow,links:workflow==='generate'?[{taskId,workflow:'generate',url:`https://studio.tripo3d.ai/es/workspace/generate/observed-${taskId}`}]:[]};
  if(name==='studioNavigationControl')return {navigation:'unavailable'};
  if(name==='resolveConfirmedStudioTask'){if(workflow!=='generate')throw Error('CONFIRMED_TASK_LINK_NOT_OBSERVED');return {url:`https://studio.tripo3d.ai/es/workspace/generate/observed-${taskId}`};}
  if(name==='resolveStudioGenerationWorkspace')return {url:'https://studio.tripo3d.ai/es/workspace/generate'};
  if(name==='navigateTab'){if(workflow==='generate')currentTaskId=taskId;workflow='generate';return {};}
  throw Error('Unexpected command '+name);
 });
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 const op=h.bridge.enqueue('monitor',{taskId,taskConfirmed:true,navigateConfirmedTask:true},{});await worker.message({type:'refresh'});
 assert.equal(h.bridge.getOperation(op.id).result.stage,'ready');
 assert.deepEqual(worker.calls.filter(c=>c.type==='navigate').map(c=>c.url),['https://studio.tripo3d.ai/es/workspace/generate',`https://studio.tripo3d.ai/es/workspace/generate/observed-${taskId}`]);
});

test('candidate failure scan closes only the notification panel it opened, including after an interrupted scan',async t=>{
 for(const interrupted of [false,true]){
  const h=await harness(t),ids=[1,2,3,4].map(n=>`10000000-0000-4000-8000-00000000000${n}`);let opened=false,closed=0;
  const worker=await workerHarness(h,null,async(name,args)=>{
   if(name==='observeStudioDocument')return {adapterVersion:2,supported:true,blockingDialog:false};
   if(name==='readStudioGenerationFailures'){
    const action=args[0].action;
    if(action==='open'){opened=true;return {failures:[],navigation:'opened'};}
    if(action==='close'){assert.equal(opened,true);opened=false;closed++;return {failures:[],navigation:'closed'};}
    if(action==='inspect'&&interrupted)throw Error('STUDIO_FAILURE_STATUS_UNAVAILABLE');
    return {failures:[],navigation:'end'};
   }
   throw Error('Unexpected command '+name);
  });
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const op=h.bridge.enqueue('observe',{verifyCandidateTaskIds:ids,pendingTaskIds:ids,submissionId:'batch',scanNotifications:true},{});await worker.message({type:'refresh'});
  assert.equal(closed,1);assert.equal(opened,false);
  assert.equal(h.bridge.getOperation(op.id).status,interrupted?'failed':'succeeded');
 }
});

test('prepare replaces A with B, changes front/right/back to front/back/left, and clears excluded slots for a body subset',async t=>{
  const h=await harness(t),slots=Object.fromEntries(['front','left','right','back'].map(slot=>[slot,{found:true,semanticBinding:'observed-multiview-card',occupied:slot!=='left',previewVisible:slot!=='left',files:[],acceptsImages:slot==='left',previewProof:null}]));
  const cleared=[],uploaded=[];
  const worker=await workerHarness(h,null,async(name,args)=>{
    if(name==='observeStudioDocument')return {adapterVersion:2,topologySettingsVersion:1,supported:true,generationMode:'smart-mesh',generationCount:4,mode:'multiview',slots,anyUploadOccupied:Object.values(slots).some(slot=>slot.occupied),blockingDialog:false,generateEnabled:true,costLabel:'100',modelLabel:'P2.0',options:{},pageSignature:JSON.stringify(slots),existingTaskIds:[],currentTaskId:null};
    if(name==='clearStudioView'){const slot=args[0];cleared.push(slot);Object.assign(slots[slot],{occupied:false,previewVisible:false,acceptsImages:true,previewProof:null});return {clearClicked:true};}
    if(name==='uploadStudioView'){
      const input=args[0],sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(atob(input.dataBase64),c=>c.charCodeAt(0))))].map(b=>b.toString(16).padStart(2,'0')).join('');
      const previewBytesSha256='f'.repeat(64);assert.equal(input.sha256,sha256);assert.match(input.operationId,/^[a-f0-9-]{36}$/);
      uploaded.push(input.slot);Object.assign(slots[input.slot],{occupied:true,previewVisible:true,acceptsImages:false,previewProof:{previewBytesSha256,width:10,height:10},receipt:{version:1,slot:input.slot,operationId:input.operationId,originalSha256:sha256,originalSize:1,mimeType:'image/png',previewBytesSha256,width:10,height:10}});return {dispatched:true};
    }
    throw new Error('Unexpected mutation '+name);
  });
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const submit=async(group,selected,encoded)=>{const operation=h.bridge.enqueue('prepare',{faceLimits:[17000,20000,23000,25000],inputs:selected.map(slot=>({slot,name:`${group}-${slot}.png`,mimeType:'image/png',dataBase64:encoded}))},{group});await worker.message({type:'refresh'});const result=h.bridge.getOperation(operation.id);assert.equal(result.status,'succeeded',result.error);assert.equal(result.result.inputsVerified,true);assert.deepEqual(result.result.selectedSlots,selected);assert.ok(result.result.expectedInputs.every(input=>input.receipt?.operationId===operation.id&&input.receipt.originalSha256===input.sha256));};
  await submit('head',['front','back','left'],'Yg==');
  assert.deepEqual([...cleared].sort(),['back','front','right']);assert.deepEqual(uploaded,['front','back','left']);assert.equal(slots.right.occupied,false);
  cleared.length=0;uploaded.length=0;
  await submit('body',['front'],'Yw==');
  assert.deepEqual(cleared,['front','left','back']);assert.deepEqual(uploaded,['front']);
  assert.equal(slots.left.occupied,false);assert.equal(slots.right.occupied,false);assert.equal(slots.back.occupied,false);
  assert.equal(worker.calls.some(call=>call.funcName==='clickStudioGenerate'),false);
});

test('recovery uses exact preview pixel proof only in a verified semantic card',async t=>{
  const h=await harness(t),pixelSha256='a'.repeat(64),expectedInputs=[{slot:'left',sha256:'b'.repeat(64),pixelSha256,width:9,height:12,mimeType:'image/png',size:99}];
  const slots=Object.fromEntries(['front','left','right','back'].map(slot=>[slot,{found:true,semanticBinding:'observed-multiview-card',occupied:slot==='left',previewVisible:slot==='left',files:[],previewProof:slot==='left'?{pixelSha256,width:9,height:12}:null}]));
  const worker=await workerHarness(h,null,async name=>{assert.equal(name,'observeStudioDocument');return {adapterVersion:2,topologySettingsVersion:1,supported:true,generationMode:'smart-mesh',generationCount:4,mode:'multiview',slots,blockingDialog:false,generateEnabled:true,costLabel:'100',modelLabel:'P2.0'};});
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const recover=async()=>{const operation=h.bridge.enqueue('observe',{expectedInputs},{});await worker.message({type:'refresh'});return h.bridge.getOperation(operation.id).result;};
  assert.equal((await recover()).preparationReady,true);
  slots.left.previewProof.width=10;assert.equal((await recover()).inputsVerified,false);
  slots.left.previewProof.width=9;slots.left.previewProof.pixelSha256='c'.repeat(64);assert.equal((await recover()).inputsVerified,false);
  slots.left.previewProof.pixelSha256=pixelSha256;slots.left.semanticBinding='observed-slot-icon';assert.equal((await recover()).inputsVerified,false);
  slots.left.semanticBinding='observed-multiview-card';slots.left.previewProof.pixelSha256='c'.repeat(64);
  assert.equal((await recover()).inputsVerified,false,'legacy transformed preview has no provenance');
  expectedInputs[0].receipt={version:1,slot:'left',operationId:'11111111-2222-3333-4444-555555555555',originalSha256:'b'.repeat(64),originalSize:99,mimeType:'image/png',pixelSha256:'c'.repeat(64),width:9,height:12};
  assert.equal((await recover()).preparationReady,true,'persisted upload receipt ties original bytes to stable transformed preview');
  slots.left.previewProof.pixelSha256='d'.repeat(64);assert.equal((await recover()).inputsVerified,false,'receipt cannot bless a changed preview');
  slots.left.previewProof.pixelSha256='c'.repeat(64);expectedInputs[0].receipt.originalSha256='e'.repeat(64);assert.equal((await recover()).inputsVerified,false,'receipt for different original bytes is invalid');
});

test('real occupied-card selectors bind slots and clear only the requested form image, never history',async()=>{
  const make=(tag,classes='',children=[])=>{
    const node={tagName:tag.toUpperCase(),children,classList:{contains:name=>classes.split(' ').includes(name)},getAttribute:name=>name==='class'?classes:null,getBoundingClientRect:()=>({width:100,height:100}),querySelector:selector=>node.querySelectorAll(selector)[0]||null,querySelectorAll:selector=>{
      const descendants=children.flatMap(child=>[child,...child.querySelectorAll('*')]);
      return descendants.filter(child=>selector==='*'||selector==='[class]'&&!!child.getAttribute('class')||selector==='img'&&child.tagName==='IMG'||selector==='img.size-full.object-contain'&&child.tagName==='IMG'&&child.classList.contains('size-full')&&child.classList.contains('object-contain')||selector==='button'&&child.tagName==='BUTTON'||selector==='div.rounded-3.flex.flex-wrap.w-full.aspect-square.relative'&&['rounded-3','flex','flex-wrap','w-full','aspect-square','relative'].every(name=>child.classList.contains(name)));
    }};for(const child of children)child.parentElement=node;return node;
  };
  const clicks={front:0,left:0,right:0,back:0,history:0};
  const cardClasses={front:'w-full h-33.5 rounded-t-3',left:'w-1/3 aspect-square rounded-bl-3 border-r-none',right:'w-1/3 aspect-square border-r-none',back:'w-1/3 aspect-square rounded-br-3'};
  const cards=Object.entries(cardClasses).map(([slot,classes])=>{
    const img=Object.assign(make('img','size-full object-contain'),{complete:true,naturalWidth:1,naturalHeight:1,currentSrc:'',src:''});
    const button=Object.assign(make('button','',[make('div','i-tripo:delete')]),{disabled:false,click:()=>clicks[slot]++});
    return make('div',classes,[make('div','group',[img,button])]);
  });
  const grid=make('div','rounded-3 flex flex-wrap w-full aspect-square relative',cards);
  const history=Object.assign(make('button','',[make('div','i-tripo:delete')]),{click:()=>clicks.history++});
  const document=make('body','',[grid,history]);
  document.createElement=()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray([10,20,30,255])})})});
  const context={document,location:{origin:'https://studio.tripo3d.ai',pathname:'/es/workspace/generate',href:'https://studio.tripo3d.ai/es/workspace/generate'},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),URL,TextEncoder,crypto:globalThis.crypto};
  const observed=await vm.runInNewContext(`(${adapterFunctions.observeStudioDocument.toString()})({includeFileHashes:true})`,context);
  const expected=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array([...new TextEncoder().encode('1:1:'),10,20,30,255])))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  assert.equal(observed.mode,'multiview');
  for(const slot of ['front','left','right','back']){assert.equal(observed.slots[slot].semanticBinding,'observed-multiview-card');assert.equal(observed.slots[slot].previewProof.pixelSha256,expected);assert.equal(observed.slots[slot].files.length,0);}
  vm.runInNewContext(`(${adapterFunctions.clearStudioView.toString()})('right')`,context);
  assert.deepEqual(clicks,{front:0,left:0,right:1,back:0,history:0});
  document.children.push(grid);
  assert.throws(()=>throwAdapterError(vm.runInNewContext(`(${adapterFunctions.clearStudioView.toString()})('front')`,context)),/MULTIVIEW_REPLACEMENT_NOT_VERIFIED/);
  assert.equal(clicks.front,0);
});

test('export recognizes the real concurrent Texture notice, reuses the verified Export dialog and blocks unknown dialogs',async()=>{
  const taskId='11111111-2222-3333-4444-555555555555';let clicks=0;
  const element=(text,extra={})=>({innerText:text,getBoundingClientRect:()=>({width:100,height:30}),getAttribute:()=>null,disabled:false,click:()=>clicks++,...extra});
  const format=element('GLB'),sendTo=element('Send To'),exportButton=element('Export');
  const exportDialog=element('Export\n\nFile Name\n\nFormat\n\nGLB\n\nSend To\n\nExport',{getAttribute:name=>name==='aria-labelledby'?'export-heading':null,querySelectorAll:selector=>selector==='[role="combobox"]'?[format]:selector==='button'?[element(''),sendTo,exportButton]:[]});
  const blankButton=element('');
  const textureDialog=element('Retry for better results\nor proceed to Texture',{querySelectorAll:selector=>selector==='button'?[blankButton]:[],querySelector:selector=>selector==='button'?blankButton:null});
  let dialogs=[textureDialog,exportDialog];
  const document={getElementById:id=>id==='export-heading'?element('Export'):null,querySelectorAll:selector=>selector==='[role="dialog"]'?dialogs:selector==='button'?[exportButton]:[]};
  const context={document,location:{origin:'https://studio.tripo3d.ai',pathname:`/workspace/generate/result-${taskId}`},getComputedStyle:()=>({display:'block',visibility:'visible'})};
  const run=step=>vm.runInNewContext(`(${adapterFunctions.exportStudioControl.toString()})(${JSON.stringify({step,taskId})})`,context);
  assert.equal((await run('inspect')).exportDialogOpen,true);assert.equal((await run('open')).stage,'already-open');assert.equal(clicks,0);
  assert.equal((await run('format')).stage,'already-glb');assert.equal((await run('download')).stage,'download-clicked');assert.equal(clicks,1);
  dialogs.push(element('Unrecognized account notice',{querySelectorAll:()=>[]}));
  const rejected=await run('download');assert.equal(rejected.adapterError,'CLOSE_OTHER_DIALOGS_FIRST');assert.equal(rejected.exportStep,'download');assert.equal(clicks,1);
  dialogs=[textureDialog,exportDialog,exportDialog];assert.equal((await run('open')).adapterError,'EXPORT_DIALOG_AMBIGUOUS');
  dialogs=[exportDialog];format.innerText='FBX';assert.equal((await run('download')).adapterError,'GLB_FORMAT_NOT_SELECTED');assert.equal(clicks,1);
  dialogs=[textureDialog];assert.equal((await run('open')).stage,'opened');assert.equal(clicks,2);
});

test('worker preserves injected structured export errors instead of hiding them as no response',async t=>{
  const h=await harness(t),taskId='11111111-2222-3333-4444-555555555555';
  const worker=await workerHarness(h,null,async name=>name==='observeStudioDocument'?{adapterVersion:2,topologySettingsVersion:1,supported:true,currentTaskId:taskId,modelReady:false,blockingDialog:true}:{adapterError:'CLOSE_OTHER_DIALOGS_FIRST',exportStep:'inspect'});
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const operation=h.bridge.enqueue('monitor',{taskId,taskConfirmed:true},{});await worker.message({type:'refresh'});
  assert.equal(h.bridge.getOperation(operation.id).error,'CLOSE_OTHER_DIALOGS_FIRST [export:inspect]');
});

test('export waits beyond animation delays, never reopens an expanded format list, and confirms GLB before downloading',async()=>{
  const taskId='11111111-2222-3333-4444-555555555555';let tick=0,expanded=false,arrowDown=0,enter=0,downloads=0,pendingSelection=null;
  const node=text=>({innerText:text,getBoundingClientRect:()=>({width:80,height:20}),getAttribute:()=>null,disabled:false,focus(){}});
  const format={...node('USD'),getAttribute:name=>name==='aria-expanded'?String(expanded):null,dispatchEvent:event=>{assert.equal(event.key,'ArrowDown');arrowDown++;expanded=true;}};
  const option={...node('GLB'),dispatchEvent:event=>{assert.equal(event.key,'Enter');enter++;pendingSelection=tick+3;}};
  const download={...node('Export'),click:()=>downloads++};
  const dialog={...node('Export File Name Format USD Send To Export'),getAttribute:name=>name==='aria-labelledby'?'heading':null,querySelectorAll:selector=>selector==='[role="combobox"]'?[format]:selector==='button'?[download]:[]};
  const document={getElementById:()=>node('Export'),querySelectorAll:selector=>selector==='[role="dialog"]'?[dialog]:selector==='[role="option"]'&&expanded&&tick>=5?[option]:[]};
  const context={document,location:{origin:'https://studio.tripo3d.ai',pathname:`/workspace/generate/model-${taskId}`},getComputedStyle:()=>({display:'block',visibility:'visible'}),KeyboardEvent:class{constructor(type,init){this.type=type;Object.assign(this,init);}},setTimeout:fn=>{tick++;if(pendingSelection!==null&&tick>=pendingSelection){format.innerText='GLB';expanded=false;pendingSelection=null;}queueMicrotask(fn);}};
  const run=step=>vm.runInNewContext(`(${adapterFunctions.exportStudioControl.toString()})(${JSON.stringify({step,taskId})})`,context);
  assert.equal((await run('format')).stage,'choose-glb');assert.ok(tick>=5,'waits for a list that takes 500ms');assert.equal(arrowDown,1);
  assert.equal((await run('format')).stage,'choose-glb');assert.equal(arrowDown,1,'does not toggle an already open list');
  assert.equal((await run('select-glb')).stage,'selected');assert.equal(enter,1);assert.equal(format.innerText,'GLB');assert.equal(expanded,false);assert.equal(downloads,0);
  assert.equal((await run('download')).stage,'download-clicked');assert.equal(downloads,1);
  format.innerText='USD';expanded=true;option.dispatchEvent=()=>{enter++;};
  assert.equal((await run('select-glb')).adapterError,'GLB_SELECTION_NOT_ACKNOWLEDGED');assert.equal(downloads,1,'failed selection does not click Export');
});

test('cleanup dismisses only a verified export dialog and waits for closure without clicking Export',async()=>{
 const taskId='11111111-2222-3333-4444-555555555555';let opened=true,unknown=false,escapes=0,downloads=0,hasState=true;
 const node=text=>({innerText:text,isConnected:true,getBoundingClientRect:()=>({width:80,height:20}),getAttribute:()=>null,disabled:false,focus(){}});
 const format=node('GLB'),download={...node('Export'),click(){downloads++;}};
 const dialog={...node('Export File Name Format GLB Export'),get isConnected(){return opened;},getAttribute:key=>key==='aria-labelledby'?'heading':key==='data-state'&&hasState?(opened?'open':'closed'):null,querySelectorAll:selector=>selector==='[role="combobox"]'?[format]:selector==='button'?[download]:[],dispatchEvent:event=>{assert.equal(event.key,'Escape');escapes++;opened=false;}};
 const other={...node('Confirm payment'),querySelectorAll:()=>[]};
 const document={getElementById:()=>node('Export'),querySelectorAll:()=>opened?[dialog,...(unknown?[other]:[])]:[]};
 const context={document,location:{origin:'https://studio.tripo3d.ai',pathname:'/workspace/generate/model-'+taskId},getComputedStyle:()=>({display:'block',visibility:'visible'}),KeyboardEvent:class{constructor(type,init){Object.assign(this,init);}},setTimeout:fn=>queueMicrotask(fn)};
 const run=()=>vm.runInNewContext(`(${adapterFunctions.exportStudioControl.toString()})(${JSON.stringify({step:'close',taskId})})`,context);
 assert.equal((await run()).stage,'closed');assert.equal(escapes,1);assert.equal(downloads,0);
 opened=true;hasState=false;assert.equal((await run()).stage,'closed');assert.equal(escapes,2,'known export works without Radix data-state');opened=true;unknown=true;assert.equal((await run()).adapterError,'CLOSE_OTHER_DIALOGS_FIRST');assert.equal(escapes,2);
});

test('captured export uses saveAs false without a native download and resumes its exact managed receipt',async t=>{
  const h=await harness(t),taskId='11111111-2222-3333-4444-555555555555';let clicks=0,armed=false;
  const originalUrl=TAB.url;TAB.url=`https://studio.tripo3d.ai/workspace/generate/model-${taskId}`;t.after(()=>{TAB.url=originalUrl;});
  const url='https://download.example/model.glb?ephemeral=secret';
  const managed={id:42,byExtensionId:ID,startTime:new Date().toISOString(),state:'in_progress',filename:`C:/Downloads/FITA/${taskId}.glb`};
  const downloads={onCreated:{},search:async()=>[managed],download:async options=>{
    assert.equal(armed,true);assert.equal(options.saveAs,false);assert.equal(options.filename,`FITA/${taskId}.glb`);
    assert.equal(options.conflictAction,'uniquify');assert.equal(options.url,url);return 42;
  }};
  const worker=await workerHarness(h,null,async(name,args)=>{
    if(name==='observeStudioDocument')return {adapterVersion:2,topologySettingsVersion:1,supported:true,currentTaskId:taskId,modelReady:true,blockingDialog:false};
    if(name==='captureStudioExport'){
      if(args[0].action==='arm'){armed=true;return {stage:'armed'};}
      if(args[0].action==='disarm'){armed=false;return {stage:'disarmed'};}
      return {stage:'captured',url};
    }
    assert.equal(name,'exportStudioControl');if(args[0].step==='download'){assert.equal(armed,true);clicks++;}
    return {stage:args[0].step==='format'?'already-glb':'opened'};
  },downloads);
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const run=async()=>{const op=h.bridge.enqueue('export',{taskId,taskConfirmed:true},{});await worker.message({type:'refresh'});return h.bridge.getOperation(op.id).result;};
  assert.equal((await run()).reason,'DOWNLOAD_PENDING_COMPLETION');assert.equal(clicks,1);assert.equal(armed,false);
  assert.equal(worker.localMemory.studioDownloadReceiptsV1[taskId].id,42);assert.equal(JSON.stringify(worker.localMemory).includes('ephemeral'),false);
  managed.state='complete';assert.equal((await run()).download.id,42);assert.equal(clicks,1);
  assert.ok(worker.calls.filter(c=>c.funcName==='captureStudioExport').every(c=>c.world==='MAIN'));
  assert.ok(worker.calls.filter(c=>c.funcName==='exportStudioControl').every(c=>c.world==='ISOLATED'));
});

test('backend-derived exact event recovery imports a saved origin-only download without touching export UI and rejects ambiguity',async t=>{
  const h=await harness(t),taskId='11111111-2222-3333-4444-555555555555';
  const originalUrl=TAB.url;TAB.url=`https://studio.tripo3d.ai/workspace/generate/model-${taskId}`;t.after(()=>{TAB.url=originalUrl;});
  const item={id:71,startTime:'2026-10-10T01:58:11.773Z',state:'complete',filename:'C:/Downloads/FITA/saved.glb',referrer:'https://studio.tripo3d.ai/'};let ambiguous=true;
  const downloads={onCreated:{addListener(){throw new Error('Must not initiate another export');}},search:async query=>query.id?[item]:ambiguous?[item,{...item,id:72}]:[item]};
  const worker=await workerHarness(h,null,async name=>{assert.equal(name,'observeStudioDocument');return {adapterVersion:2,topologySettingsVersion:1,supported:true,currentTaskId:taskId,modelReady:true,blockingDialog:false};},downloads);
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const run=async()=>{const op=h.bridge.enqueue('export',{taskId,taskConfirmed:true,downloadRecovery:{sourceOperationId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',taskId,eventStartTime:item.startTime}},{});await worker.message({type:'refresh'});return h.bridge.getOperation(op.id);};
  assert.equal((await run()).error,'DOWNLOAD_RECOVERY_NOT_UNIQUE');ambiguous=false;
  const recovered=await run();assert.equal(recovered.result.stage,'exported');assert.equal(recovered.result.download.id,71);assert.equal(worker.localMemory.studioDownloadReceiptsV1[taskId].correlation,'backend-verified-exact-event');
});

test('ambiguous captured URLs stop export and disarm without downloading either file',async t=>{
  const h=await harness(t),taskId='11111111-2222-3333-4444-555555555555';let disarmed=false;
  const originalUrl=TAB.url;TAB.url=`https://studio.tripo3d.ai/workspace/generate/model-${taskId}`;t.after(()=>{TAB.url=originalUrl;});
  const downloads={onCreated:{},search:async()=>[],download:async()=>assert.fail('No ambiguous download')};
  const worker=await workerHarness(h,null,async(name,args)=>{
    if(name==='observeStudioDocument')return {adapterVersion:2,topologySettingsVersion:1,supported:true,currentTaskId:taskId,modelReady:true,blockingDialog:false};
    if(name==='captureStudioExport'){
      if(args[0].action==='read')return {adapterError:'AMBIGUOUS_DOWNLOAD'};
      if(args[0].action==='disarm')disarmed=true;
      return {stage:args[0].action==='arm'?'armed':'disarmed'};
    }
    return {stage:args[0].step==='format'?'already-glb':'opened'};
  },downloads);
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const op=h.bridge.enqueue('export',{taskId,taskConfirmed:true},{});await worker.message({type:'refresh'});
  assert.equal(h.bridge.getOperation(op.id).result.reason,'AMBIGUOUS_DOWNLOAD');assert.equal(disarmed,true);
});

test('repairs only an ambiguous receipt consisting of its cancelled native and verified managed IDs without re-exporting',async t=>{
  const h=await harness(t),taskId='11111111-2222-3333-4444-555555555555';
  const originalUrl=TAB.url;TAB.url=`https://studio.tripo3d.ai/workspace/generate/model-${taskId}`;t.after(()=>{TAB.url=originalUrl;});
  const native={id:392,startTime:'2026-10-10T02:09:21.009Z',state:'interrupted',referrer:'https://studio.tripo3d.ai/'};
  const managed={id:393,startTime:'2026-10-10T02:09:31.224Z',state:'complete',filename:`C:/Downloads/FITA/${taskId}.glb`,byExtensionId:ID,referrer:''};
  const downloads={onCreated:{addListener(){assert.fail('No second export');}},search:async({id})=>id===392?[native]:[managed]};
  const worker=await workerHarness(h,null,async name=>{assert.equal(name,'observeStudioDocument');return {adapterVersion:2,topologySettingsVersion:1,supported:true,currentTaskId:taskId,modelReady:true,blockingDialog:false};},downloads);
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const receipt={version:1,taskId,taskPath:new URL(TAB.url).pathname,operationId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',id:393,nativeId:392,startTime:managed.startTime,nativeStartTime:native.startTime,state:'ambiguous',correlation:'managed-native-export',downloadIds:[392,393]};
  const run=async saved=>{worker.localMemory.studioDownloadReceiptsV1={[taskId]:structuredClone(saved)};const op=h.bridge.enqueue('export',{taskId,taskConfirmed:true},{});await worker.message({type:'refresh'});return h.bridge.getOperation(op.id).result;};
  assert.equal((await run({...receipt,downloadIds:[392,393,394]})).reason,'DOWNLOAD_RECEIPT_REQUIRES_REVIEW');
  managed.byExtensionId='another-extension';assert.equal((await run(receipt)).reason,'DOWNLOAD_RECEIPT_REQUIRES_REVIEW');managed.byExtensionId=ID;
  native.state='complete';assert.equal((await run(receipt)).reason,'DOWNLOAD_RECEIPT_REQUIRES_REVIEW');native.state='interrupted';
  const result=await run(receipt);assert.equal(result.stage,'exported');assert.equal(result.download.id,393);assert.equal(worker.localMemory.studioDownloadReceiptsV1[taskId].repairedManagedEventRace,true);
});

test('direct export saves actual GLB bytes without starting another browser download and resumes without exporting',async t=>{
  const h=await harness(t);let taskId='11111111-2222-3333-4444-555555555555';let clicks=0,armed=false,closedDialogs=2,opens=0,closedBeforeDownload=true;
  const originalUrl=TAB.url;TAB.url=`https://studio.tripo3d.ai/workspace/generate/model-${taskId}`;t.after(()=>{TAB.url=originalUrl;});
  const bytes=await fs.readFile('fixtures/mannequin.glb');
  const native={id:141,startTime:new Date().toISOString(),state:'in_progress',referrer:'https://studio.tripo3d.ai/',url:'https://download.example/model.glb?ephemeral=secret'};
  let prior=null,cancelled=0;
  const downloads={onCreated:{},search:async()=>prior?[prior]:[],cancel:async id=>{assert.equal(id,prior.id);cancelled++;prior.state='interrupted';},download:async()=>assert.fail('Direct transfer must never open a browser download')};
  const worker=await workerHarness(h,null,async(name,args)=>{
    if(name==='observeStudioDocument')return {adapterVersion:2,textureWorkflowVersion:2,workflow:'texture',supported:true,currentTaskId:taskId,modelReady:true,blockingDialog:false};
    if(name==='captureStudioExport'){
      if(args[0].action==='arm'){armed=true;return {stage:'armed'};}
      if(args[0].action==='disarm'){armed=false;return {stage:'disarmed'};}
      return {stage:'captured',url:native.url};
    }
    if(name==='readExportedGlb'){
      assert.equal(args[0].taskId,taskId);assert.equal(armed,true);
      if(args[0].action==='release')return {stage:'released'};
      if(args[0].action==='start'){assert.equal(args[0].url,native.url);return {totalBytes:bytes.length};}
      const part=bytes.subarray(args[0].offset,args[0].offset+1024*1024);
      return {offset:args[0].offset,length:part.length,dataBase64:part.toString('base64')};
    }
    assert.equal(name,'exportStudioControl');
    if(args[0].step==='open')opens++;
    if(args[0].step==='format'&&closedDialogs-->0)return {adapterError:'EXPORT_DIALOG_NOT_VERIFIED',exportStep:'format'};
    if(args[0].step==='download'){
      assert.equal(armed,true);
      if(closedBeforeDownload){closedBeforeDownload=false;return {adapterError:'EXPORT_DIALOG_NOT_VERIFIED',exportStep:'download'};}
      clicks++;
    }
    return {stage:args[0].step==='format'?'already-glb':'opened'};
  },downloads);
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const run=async(exportRevision)=>{const op=h.bridge.enqueue('export',{taskId,taskConfirmed:true,directExportTransfer:true,...(exportRevision?{workflow:'texture',exportRevision,processingObserved:true}:{})},{});await worker.message({type:'refresh'});return h.bridge.getOperation(op.id).result;};
  const result=await run();assert.equal(result.stage,'exported');assert.deepEqual(await fs.readFile(result.download.path),bytes);assert.equal(result.download.transport,'local-export-bytes');assert.equal(opens,4,'dialogs closed before format or download are reopened before the single download click');assert.equal(clicks,1);
  assert.equal((await run()).download.path,result.download.path);assert.equal(clicks,1);
  taskId='22222222-2222-3333-4444-555555555555';TAB.url=`https://studio.tripo3d.ai/workspace/generate/model-${taskId}`;
  const second=await run();assert.equal(second.stage,'exported');assert.notEqual(second.download.path,result.download.path);assert.deepEqual(await fs.readFile(second.download.path),bytes);assert.equal(clicks,2);assert.equal(armed,false);
  const revision='99999999-1111-4222-8333-444444444444';const textured=await run(revision);assert.equal(textured.stage,'exported');assert.notEqual(textured.download.path,second.download.path);assert.equal(clicks,3);assert.equal((await run(revision)).download.path,textured.download.path);assert.equal(clicks,3);assert.ok(worker.localMemory.studioDownloadReceiptsV1[taskId]);assert.ok(worker.localMemory.studioDownloadReceiptsV1[taskId+':texture:'+revision]);
  assert.equal(JSON.stringify(worker.localMemory).includes('ephemeral'),false);assert.equal(JSON.stringify(worker.localMemory).includes(bytes.toString('base64')),false);
  prior={id:501,state:'in_progress',startTime:new Date(Date.now()-180000).toISOString(),byExtensionId:ID};
  worker.localMemory.studioDownloadReceiptsV1[taskId]={version:1,taskId,taskPath:new URL(TAB.url).pathname,state:'waiting',correlation:'managed-native-export',id:prior.id,startTime:prior.startTime};
  const recovered=await run();assert.equal(recovered.stage,'exported');assert.equal(cancelled,1);assert.equal(clicks,4);assert.equal(worker.localMemory.studioDownloadReceiptsV1[taskId].recoveredDownload.id,501);
  assert.equal((await run()).download.path,recovered.download.path);assert.equal(clicks,4);
  prior.state='in_progress';prior.byExtensionId='another-extension';
  worker.localMemory.studioDownloadReceiptsV1[taskId]={version:1,taskId,taskPath:new URL(TAB.url).pathname,state:'waiting',correlation:'managed-native-export',id:prior.id,startTime:prior.startTime};
  assert.equal((await run()).reason,'DOWNLOAD_RECEIPT_CHANGED');assert.equal(cancelled,1);assert.equal(clicks,4);
  prior.state='complete';prior.byExtensionId=ID;
  worker.localMemory.studioDownloadReceiptsV1[taskId].state='complete';
  assert.equal((await run()).stage,'exported');assert.equal(clicks,5,'legacy completed browser receipt is replaced by a verified local transfer');assert.equal(cancelled,1,'completed original is preserved');
  assert.equal((await run()).stage,'exported');assert.equal(clicks,5);


});

test('Recover and continue delivers a segmented download through the real provider, worker and local receiver',async t=>{
 const h=await harness(t),taskId='11111111-2222-3333-4444-555555555555';
 const original=TAB.url;TAB.url='https://studio.tripo3d.ai/workspace/texture/'+taskId;t.after(()=>{TAB.url=original;});
 const bytes=await fs.readFile('fixtures/mannequin.glb'),model=Buffer.from('same segmented source');
 const project={id:'project'},group={id:'hair',asset:{id:'hair.glb'},settings:{resolution:'4K',removeLighting:false}};
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const groupKey=hash(JSON.stringify([project.id,group.id,group.asset.id,hash(model)]));
 const textureOperationId='99999999-1111-4222-8333-444444444444',operationId='22222222-2222-4333-8444-555555555555';let exports=0;
 const worker=await workerHarness(h,null,async(name,args)=>{
  if(name==='observeStudioDocument')return {adapterVersion:2,segmentWorkflowVersion:1,supported:true,currentTaskId:taskId,workflow:'texture',modelReady:true,blockingDialog:false};
  if(name==='observeGroupStudio')return {taskId,workflow:'texture'};
  if(name==='captureStudioExport')return args[0].action==='read'?{stage:'captured',url:'https://download.example/current.glb'}:{stage:args[0].action};
  if(name==='readExportedGlb'){
   if(args[0].action==='start')return {totalBytes:bytes.length};
   if(args[0].action==='release')return {stage:'released'};
   const chunk=bytes.subarray(args[0].offset,args[0].offset+1024*1024);return {offset:args[0].offset,length:chunk.length,dataBase64:chunk.toString('base64')};
  }
  assert.equal(name,'exportStudioControl');if(args[0].step==='download')exports++;return {stage:args[0].step==='format'?'already-glb':'opened'};
 },{onCreated:{},search:async()=>[],download:async()=>assert.fail('No browser download fallback')});
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 worker.localMemory['workbenchGroupOperation:'+textureOperationId]={status:'completed',step:'texture',groupKey,taskId};
 const provider=studioGroupProvider(h.bridge,{pollMs:1,store:{read:async()=>model}}).forProject(project);
 const recovered=provider.recover({operation:{id:operationId,step:'download',targetTaskId:taskId},group,previous:{operationId:textureOperationId}});
 await new Promise(resolve=>setTimeout(resolve,10));await worker.message({type:'refresh'});
 const receipt=await recovered;assert.equal(receipt.status,'completed');assert.equal(receipt.operationId,operationId);assert.equal(receipt.textureOperationId,textureOperationId);assert.deepEqual(await fs.readFile(receipt.download.path),bytes);assert.equal(exports,1);
 const again=provider.recover({operation:{id:operationId,step:'download',targetTaskId:taskId},group,previous:{operationId:textureOperationId}});
 await new Promise(resolve=>setTimeout(resolve,10));await worker.message({type:'refresh'});assert.equal((await again).download.path,receipt.download.path);assert.equal(exports,1);
});

test('export recovery is bounded and never reopens through an unknown dialog or a changed task',async()=>{
 const source=await fs.readFile('extension-tripo-studio/background.js','utf8');
 const native=source.slice(source.indexOf('async function nativeGlbExport('),source.indexOf('async function performStudioCommand('));
 const taskId='11111111-2222-3333-4444-555555555555',path='/workspace/texture/'+taskId;
 for(const kind of ['closed','unknown-dialog','task-changed']){
  let opens=0,changed=false;const writes=[];
  const context={URL,Date,STUDIO:'https://studio.tripo3d.ai',pause:async()=>{},exportStudioControl:adapterFunctions.exportStudioControl,
   chrome:{downloads:{onCreated:{},search:async()=>assert.fail('No download was started')},tabs:{get:async()=>({url:'https://studio.tripo3d.ai'+(changed?'/workspace/generate/another-task':path)})},storage:{local:{get:async()=>({}),set:async v=>writes.push(v)}}},
   runInTab:async(_bridge,fn,args)=>{
    assert.equal(fn.name,'exportStudioControl');
    if(args[0].step==='open'){opens++;return {stage:'opened'};}
    assert.equal(args[0].step,'format');
    if(kind==='task-changed')changed=true;
    throw Error(kind==='unknown-dialog'?'CLOSE_OTHER_DIALOGS_FIRST [export:format]':'EXPORT_DIALOG_NOT_VERIFIED [export:format]');
   }};
  const run=()=>vm.runInNewContext(native+';nativeGlbExport({tabId:9},'+JSON.stringify(taskId)+',{operationId:"op"})',context);
  await assert.rejects(run,new RegExp(kind==='task-changed'?'CONFIRMED_TASK_CHANGED':kind==='unknown-dialog'?'CLOSE_OTHER_DIALOGS_FIRST':'EXPORT_DIALOG_NOT_VERIFIED'));
  assert.equal(opens,kind==='closed'?3:1);assert.equal(writes.length,0,'no download intent or paid click is produced during preparation');
 }
});

test('local export receiver requires an authorized pending candidate and validates GLB, preserving existing files',async t=>{
  const h=await harness(t),token=await h.pair(),taskId='11111111-2222-3333-4444-555555555555';
  const bytes=await fs.readFile('fixtures/mannequin.glb'),dataBase64=bytes.toString('base64');
  assert.equal((await h.ext('export-file',token,{taskId,dataBase64})).status,409);
  await h.ext('heartbeat',token,{tab:TAB,inspection:INSPECTION,automationAuthorized:true,adapter:{adapterVersion:2,topologySettingsVersion:1,supported:true}});
  const op=h.bridge.enqueue('export',{taskId,taskConfirmed:true},{}),body={operationId:op.id,taskId,dataBase64};
  assert.equal((await h.ext('export-file',token,{...body,taskId:'22222222-2222-3333-4444-555555555555'})).status,409);
  assert.equal((await h.ext('export-file',token,{...body,dataBase64:Buffer.from('<html>not a model</html>').toString('base64')})).status,400);
  const saved=await h.ext('export-file',token,body);assert.equal(saved.status,200);assert.deepEqual(await fs.readFile(saved.data.download.path),bytes);
  assert.equal((await h.ext('export-file',token,body)).data.download.path,saved.data.download.path);
  await fs.writeFile(saved.data.download.path,'existing file must survive');
  assert.equal((await h.ext('export-file',token,body)).status,409);assert.equal(await fs.readFile(saved.data.download.path,'utf8'),'existing file must survive');
  await h.ext('disconnect',token);assert.equal((await h.ext('export-file',token,body)).status,403);
});

test('export byte reader validates the selected page and GLB and never sends credentials or follows redirects',async()=>{
  const source=await fs.readFile('extension-tripo-studio/background.js','utf8');
  const reader=source.slice(source.indexOf('async function readExportedGlb('),source.indexOf('async function nativeGlbExport('));
  const taskId='11111111-2222-3333-4444-555555555555',bytes=await fs.readFile('fixtures/mannequin.glb');let calls=0,body=bytes;
  const context={location:{origin:'https://studio.tripo3d.ai',pathname:`/workspace/generate/model-${taskId}`},URL,AbortSignal,btoa,fetch:async(url,options)=>{calls++;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return new Response(body);}};
  const run=(id=taskId)=>vm.runInNewContext(`${reader};readExportedGlb(${JSON.stringify({url:'https://download.example/file.glb',taskId:id})})`,context);
  assert.equal((await run('wrong')).adapterError,'CONFIRMED_TASK_CHANGED');assert.equal(calls,0);
  assert.deepEqual(Buffer.from((await run()).dataBase64,'base64'),bytes);
  body='<html>not an exported model</html>';assert.equal((await run()).adapterError,'EXPORTED_GLB_INVALID');
});

 test('automatic download permission is restricted to Studio and a browser policy refusal blocks export',async()=>{
  const source=await fs.readFile('extension-tripo-studio/background.js','utf8');
  const fn=source.slice(source.indexOf('async function ensureAutomaticDownloads()'),source.indexOf('async function runInTab('));
  let configured;
  const run=chrome=>vm.runInNewContext(`${fn};ensureAutomaticDownloads()`,{chrome,STUDIO:'https://studio.tripo3d.ai'});
  await assert.rejects(run({}),/AUTOMATIC_DOWNLOADS_EXTENSION_RELOAD_REQUIRED/);
  const api={contentSettings:{automaticDownloads:{set:async v=>configured=v,get:async()=>({setting:'block'})}}};
  await assert.rejects(run(api),/AUTOMATIC_DOWNLOADS_BLOCKED/);
  assert.equal(configured.primaryPattern,'https://studio.tripo3d.ai/*');assert.equal(configured.scope,'regular');
  api.contentSettings.automaticDownloads.get=async()=>({setting:'allow'});await run(api);
});

test('texture monitor does not export the old mesh while its same-ID source card is generating',async t=>{
  const h=await harness(t),taskId='10000000-0000-4000-8000-000000000001';let processing=true;
  const worker=await workerHarness(h,null,async name=>{assert.equal(name,'observeStudioDocument');return {adapterVersion:2,textureWorkflowVersion:2,workflow:'texture',supported:true,currentTaskId:taskId,modelReady:true,blockingDialog:false,taskCards:[{taskId,text:processing?'Cancelar Generando textura... 15s':'modelo 3D'}]};});
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const run=async()=>{const op=h.bridge.enqueue('monitor',{workflow:'texture',taskId,taskConfirmed:true,processingObserved:!processing},{});await worker.message({type:'refresh'});return h.bridge.getOperation(op.id).result;};
  assert.equal((await run()).stage,'processing');processing=false;assert.equal((await run()).stage,'ready');
});

for(const fault of ['none','price','polygons','polygons-stuck'])test('one-click worker '+({none:'uploads and submits once even after a lost reply',price:'stops if cost changes during upload',polygons:'restores polygon targets changed before submission and submits once','polygons-stuck':'stops if changed polygon targets cannot be restored before submission'}[fault]),async t=>{
  const changedPrice=fault==='price',changedPolygons=fault==='polygons-stuck',restoredPolygons=fault==='polygons';
  // Polygons drift after preparation verified them (the user moved a slider).
  let drift='off',restoreCalls=0;
  const h=await harness(t),slots=Object.fromEntries(['front','left','right','back'].map(slot=>[slot,{found:true,occupied:false,previewVisible:false,acceptsImages:true}]));
  let cost='60',clicks=0,uploads=0,smart=false,count=1,signature='empty',loseReply=false;
  const hook=async()=>{};
  hook.before=async route=>{if(route==='operation-result'&&loseReply){loseReply=false;throw Error('lost reply');}};
  const worker=await workerHarness(h,hook,async(name,args)=>{
    if(name==='observeStudioDocument')return {adapterVersion:2,quickGenerationVersion:1,topologySettingsVersion:1,supported:true,generationMode:smart?'smart-mesh':'hd',generationCount:count,mode:'multiview',slots,anyUploadOccupied:Object.values(slots).some(s=>s.occupied),blockingDialog:false,generateEnabled:true,generateLabel:'Generar '+cost,costLabel:cost,modelLabel:smart?'P2.0':'H3.1',options:{},pageSignature:signature,currentTaskId:null,existingTaskIds:[]};
    if(name==='selectStudioSmartMesh'){smart=true;return {};}
    if(name==='selectStudioFourResults'){count=4;return {};}
    if(name==='uploadStudioView'){uploads++;Object.assign(slots[args[0].slot],{occupied:true,previewVisible:true,files:[{sha256:'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',size:1,mimeType:'image/png'}]});signature='prepared';if(changedPrice)cost='99';if(changedPolygons||restoredPolygons)drift='armed';return {};}
    if(name==='clickStudioGenerate'){clicks++;return {};}
    throw Error('Unexpected function '+name);
  },undefined,({step,faceLimits})=>{
    if(drift==='armed'){drift='on';return {open:true,faceLimits};}
    if(drift==='on'){
      if(step==='configure'&&restoredPolygons){drift='off';restoreCalls++;return {open:true,pending:true,faceLimits:null};}
      return {open:true,faceLimits:[18000,20000,22500,25000]};
    }
    return {open:true,faceLimits};
  });
  const {data}=await h.ui('/pairing',{extensionId:ID});
  await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  const quote=h.bridge.enqueue('observe',{configureGenerationDefaults:true,faceLimits:[17000,20000,23000,25000]},{});await worker.message({type:'refresh'});
  assert.equal(h.bridge.getOperation(quote.id).result.costLabel,'60');assert.equal(smart,true);assert.equal(count,4);assert.equal(uploads,0);assert.equal(clicks,0);
  const inputs=['front','right','back'].map(slot=>({slot,name:slot+'.png',mimeType:'image/png',dataBase64:'YQ=='}));
  const operation=h.bridge.enqueue('generate',{inputs,faceLimits:[17000,20000,23000,25000],confirmUpload:true,confirmCost:true,expectedCost:'60',confirmationNonce:'one-click'},{});
  if(!changedPrice)loseReply=true;
  await worker.message({type:'refresh'});await worker.message({type:'refresh'});
  assert.equal(uploads,3);assert.equal(clicks,changedPrice||changedPolygons?0:1);
  const result=h.bridge.getOperation(operation.id);assert.equal(result.status,changedPrice||changedPolygons?'failed':'succeeded');
  if(changedPrice)assert.equal(result.error,'STUDIO_QUOTED_COST_CHANGED');
  else if(changedPolygons)assert.equal(result.error,'STUDIO_POLYGON_SETTINGS_NOT_VERIFIED');
  else assert.equal(result.result.stage,'submitted');
  assert.equal(restoreCalls,restoredPolygons?1:0);
});

 test('preparation waits for transient dialogs but never dismisses an unknown persistent dialog',async t=>{
  const h=await harness(t);let blocked=0,closes=0;const diagnostics=[];
  const worker=await workerHarness(h,null,async name=>{
    if(name==='observeStudioDocument')return {adapterVersion:2,topologySettingsVersion:1,supported:true,currentTaskId:'11111111-2222-3333-4444-555555555555',blockingDialog:blocked-->0,slots:{}};
    if(name==='studioNavigationControl')return {navigation:'not-open'};
    if(name==='exportStudioControl'){closes++;return {adapterError:'CLOSE_OTHER_DIALOGS_FIRST',exportStep:'close'};}
    throw Error('No input or paid actions allowed');
  },{download:async options=>{assert.equal(options.saveAs,false);assert.equal(options.filename,'FITA/studio-operation-diagnostic.json');diagnostics.push(JSON.parse(decodeURIComponent(options.url.split(',').slice(1).join(','))));return 1;}});
  const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
  blocked=3;let op=h.bridge.enqueue('observe',{},{});await worker.message({type:'refresh'});assert.equal(h.bridge.getOperation(op.id).status,'succeeded');assert.equal(closes,0);
  blocked=100;op=h.bridge.enqueue('prepare',{},{});await worker.message({type:'refresh'});assert.equal(h.bridge.getOperation(op.id).error,'CLOSE_OTHER_DIALOGS_FIRST');assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].operationId,op.id);
 });

test('read-only document transition retries empty observations without replaying paid actions',async t=>{
 const h=await harness(t);let empty=0,reads=0;
 const worker=await workerHarness(h,null,async(name,args)=>{assert.equal(name,'observeStudioDocument');reads++;if(args?.length&&empty-->0)return null;return {adapterVersion:2,topologySettingsVersion:1,supported:true,blockingDialog:false,slots:{}};});
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 empty=2;const before=reads,op=h.bridge.enqueue('observe',{},{});await worker.message({type:'refresh'});assert.equal(h.bridge.getOperation(op.id).status,'succeeded',h.bridge.getOperation(op.id).error);assert.ok(reads-before>=3);
});

for(const lost of ['before','after'])test('free generation settings recover empty replies '+lost+' the change by reading native state',async t=>{
 const h=await harness(t),attempts={},clicks={};let smart=false,count=1,mode='other',topologyCalls=0;
 const worker=await workerHarness(h,null,async name=>{
  if(name==='observeStudioDocument')return {adapterVersion:2,quickGenerationVersion:1,topologySettingsVersion:1,supported:true,workflow:'generate',generationWorkspaceReady:true,generationMode:smart?'smart-mesh':'hd',generationCount:count,mode,blockingDialog:false,costLabel:'100',modelLabel:smart?'P2.0':'H3.1',slots:{},options:{},pageSignature:'settings'};
  if(['selectStudioSmartMesh','selectStudioFourResults','selectStudioMultiview'].includes(name)){
   attempts[name]=(attempts[name]||0)+1;
   if(lost==='before'&&attempts[name]===1)return null;
   clicks[name]=(clicks[name]||0)+1;
   if(name==='selectStudioSmartMesh')smart=true;
   if(name==='selectStudioFourResults')count=4;
   if(name==='selectStudioMultiview')mode='multiview';
   return lost==='after'&&attempts[name]===1?null:{selected:true};
  }
  assert.fail('Only free settings are allowed: '+name);
 },undefined,({faceLimits})=>++topologyCalls===1?null:{faceLimits});
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 const quote=h.bridge.enqueue('observe',{configureGenerationDefaults:true,faceLimits:[17000,20000,23000,25000]},{});await worker.message({type:'refresh'});
 const result=h.bridge.getOperation(quote.id);assert.equal(result.status,'succeeded',result.error);assert.equal(result.result.costLabel,'100');
 for(const control of ['selectStudioSmartMesh','selectStudioFourResults','selectStudioMultiview']){assert.equal(clicks[control],1);assert.equal(attempts[control],lost==='before'?2:1);}
 assert.equal(topologyCalls,2);assert.equal(worker.localMemory.workbenchLastScriptFailure.function,'studioTopologyControl');
});

test('an empty paid generation reply remains uncertain and never repeats the click',async t=>{
 const h=await harness(t);let clicks=0;
 const proof={found:true,occupied:true,previewVisible:true,acceptsImages:true,files:[{sha256:'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',size:1,mimeType:'image/png'}]};
 const worker=await workerHarness(h,null,async name=>{
  if(name==='observeStudioDocument')return {adapterVersion:2,topologySettingsVersion:1,supported:true,workflow:'generate',generationWorkspaceReady:true,generationMode:'smart-mesh',generationCount:4,mode:'multiview',blockingDialog:false,costLabel:'100',modelLabel:'P2.0',slots:{front:proof},options:{generationFaceLimits:[17000,20000,23000,25000]},pageSignature:'ready',generateEnabled:true};
  if(name==='clickStudioGenerate'){clicks++;return null;}
  assert.fail('Unexpected change '+name);
 });
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 const operation=h.bridge.enqueue('submit',{confirmCost:true,confirmationNonce:'confirmed',expectedSnapshot:{pageSignature:'ready',mode:'smart-mesh',generationCount:4,costLabel:'100',options:{generationFaceLimits:[17000,20000,23000,25000]},expectedInputs:[{slot:'front',sha256:proof.files[0].sha256,size:1,mimeType:'image/png'}]}},{});
 await worker.message({type:'refresh'});await worker.message({type:'refresh'});
 const result=h.bridge.getOperation(operation.id);assert.equal(clicks,1);assert.equal(result.status,'unknown');assert.equal(result.error,'STUDIO_DID_NOT_RESPOND');
});

test('failure reader matches exact task IDs, recognizes structural status in any language and ignores old or unrelated texture notices',()=>{
 const ids=[1,2,3,4].map(n=>`10000000-0000-4000-8000-00000000000${n}`),foreign='20000000-0000-4000-8000-000000000001';
 const node=(message,attrs={})=>({innerText:message,getBoundingClientRect:()=>({width:100,height:50}),getAttribute:key=>attrs[key]||null});
 const nodes=[node(`Your Model Generation operation has failed. Error message: Invalid user input. Task ID: ${ids[0]}`),node('Fehler',{ 'data-status':'failed','data-task-id':ids[1]}),node(`Your Model Generation operation has failed. Task ID: ${foreign}`),node(`Your Texture operation has failed. Task ID: ${ids[2]}`),node('Generating 70%',{'data-task-id':ids[3]}),node(`Operation failed. Task ID: ${ids[2]} Task ID: ${foreign}`)];
 const context={location:{origin:'https://studio.tripo3d.ai'},document:{querySelectorAll:()=>nodes},URL,getComputedStyle:()=>({display:'block',visibility:'visible'})};
 const result=vm.runInNewContext(`(${adapterFunctions.readStudioGenerationFailures.toString()})(${JSON.stringify({taskIds:ids})})`,context);
 assert.deepEqual(Array.from(result.failures,f=>f.taskId),ids.slice(0,2));assert.equal(result.failures[0].code,'invalid_user_input');assert.equal(result.failures[1].source,'studio-task-status');assert.equal(JSON.stringify(result).includes(foreign),false);
 nodes.length=0;const cached=vm.runInNewContext(`(${adapterFunctions.readStudioGenerationFailures.toString()})(${JSON.stringify({taskIds:ids})})`,context);assert.equal(cached.failures.length,2);
 assert.equal(isReadOnlyStudioCall(adapterFunctions.readStudioGenerationFailures,[{action:'watch'}]),true);assert.equal(isReadOnlyStudioCall(adapterFunctions.readStudioGenerationFailures,[{action:'open'}]),false);
});

test('a provider job alias requires the same failed card to identify the confirmed model directly',()=>{
 const ids=[1,2,3,4].map(n=>`10000000-0000-4000-8000-00000000000${n}`),job='20000000-0000-4000-8000-000000000001';
 const node=(message,attrs={})=>({innerText:message,getBoundingClientRect:()=>({width:100,height:50}),getAttribute:key=>attrs[key]||null});
 const nodes=[node(`Your Model Generation operation has failed. Task ID: ${job}`,{href:`/workspace/generate/model-${ids[0]}`}),node(`Operation failed. Model: ${ids[1]} Task ID: ${job}`),node(`Operation failed. Task ID: ${job}`,{href:`https://example.com/workspace/generate/${ids[2]}`})];
 const context={location:{origin:'https://studio.tripo3d.ai'},document:{querySelectorAll:()=>nodes},URL,getComputedStyle:()=>({display:'block',visibility:'visible'})};
 const result=vm.runInNewContext(`(${adapterFunctions.readStudioGenerationFailures.toString()})(${JSON.stringify({taskIds:ids})})`,context);
 assert.equal(result.failures.length,1);assert.equal(result.failures[0].taskId,ids[0]);assert.equal(result.failures[0].providerTaskId,job);
});

test('worker verification returns native failures and never uploads, changes generation settings or submits',async t=>{
 const h=await harness(t),ids=[1,2,3,4].map(n=>`10000000-0000-4000-8000-00000000000${n}`),failure={taskId:ids[0],provider:'Tripo',status:'failed',source:'studio-notification',code:'invalid_user_input'};
 const worker=await workerHarness(h,null,async(name)=>{if(name==='observeStudioDocument')return {adapterVersion:2,supported:true,generationFailureVersion:1,blockingDialog:false};if(name==='readStudioGenerationFailures')return {failures:[failure],navigation:'none'};throw Error('Unexpected mutation '+name);});
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 const op=h.bridge.enqueue('observe',{verifyCandidateTaskIds:ids,pendingTaskIds:[ids[0]],submissionId:'batch',scanNotifications:true},{});await worker.message({type:'refresh'});assert.equal(h.bridge.getOperation(op.id).result.candidateFailures[0].taskId,ids[0]);assert.equal(worker.localMemory['workbenchFailures:batch'].length,1);
 assert.equal(worker.calls.some(c=>c.type==='executeScript'&&/upload|Generate|Topology|FourResults/.test(c.funcName)),false);
});

test('export capture suppresses native anchor and picker, holds blobs, and restores every hook',async()=>{
  const taskId='11111111-2222-3333-4444-555555555555';let clicks=0,pickers=0,listener,timer;const revoked=[];
  class Anchor {constructor(href,download=true){this.href=href;this.download=download;}hasAttribute(n){return n==='download'&&this.download;}click(){clicks++;}}
  class PageURL extends URL {}
  PageURL.createObjectURL=()=> 'blob:https://studio.tripo3d.ai/test';PageURL.revokeObjectURL=url=>revoked.push(url);
  const window={showSaveFilePicker:async()=>{pickers++;}};
  const originalClick=Anchor.prototype.click,originalPicker=window.showSaveFilePicker,originalRevoke=PageURL.revokeObjectURL;
  const location={origin:'https://studio.tripo3d.ai',pathname:'/workspace/generate/model-'+taskId,href:'https://studio.tripo3d.ai/workspace/generate/model-'+taskId};
  const document={addEventListener:(type,fn)=>{listener=fn;},removeEventListener:(type,fn)=>{assert.equal(fn,listener);listener=null;}};
  const context={window,document,location,HTMLAnchorElement:Anchor,URL:PageURL,Blob,setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;}};
  const run=(action,lease='one')=>vm.runInNewContext(`(${adapterFunctions.captureStudioExport.toString()})(${JSON.stringify({action,taskId,lease})})`,context);
  assert.equal(run('arm').stage,'armed');new Anchor('https://example.com/help',false).click();assert.equal(clicks,1);
  const blob='blob:https://studio.tripo3d.ai/test';new Anchor(blob).click();PageURL.revokeObjectURL(blob);
  assert.equal(clicks,1);assert.equal(run('read').url,blob);assert.equal(revoked.length,0);
  assert.equal(run('read','wrong').adapterError,'EXPORT_CAPTURE_EXPIRED');assert.equal(run('arm').adapterError,'EXPORT_CAPTURE_BUSY');
  run('disarm');assert.deepEqual(revoked,[blob]);assert.equal(Anchor.prototype.click,originalClick);assert.equal(window.showSaveFilePicker,originalPicker);assert.equal(PageURL.revokeObjectURL,originalRevoke);assert.equal(listener,null);assert.equal(timer,null);
  run('arm');const file=await window.showSaveFilePicker({suggestedName:'rig.glb'}),stream=await file.createWritable();
  await stream.write(new Uint8Array([1,2,3]));await stream.close();assert.equal(pickers,0);assert.equal(run('read').url,blob);run('disarm');
  run('arm');let prevented=0;const anchor=new Anchor('https://example.com/model.glb');listener({target:{closest:()=>anchor},preventDefault(){prevented++;},stopImmediatePropagation(){prevented++;}});
  assert.equal(prevented,2);assert.equal(run('read').url,anchor.href);new Anchor('https://example.com/second.glb').click();assert.equal(run('read').adapterError,'AMBIGUOUS_DOWNLOAD');
  timer();assert.equal(Anchor.prototype.click,originalClick);assert.equal(run('read').adapterError,'EXPORT_CAPTURE_EXPIRED');
  run('arm');location.pathname='/other';new Anchor('https://example.com/unrelated.glb').click();assert.equal(clicks,2);assert.equal(run('read').adapterError,'CONFIRMED_TASK_CHANGED');run('disarm');
});

test('leased export capture handles detached dispatch, typed blobs, new windows and package formats without leaking hooks',async()=>{
 for(const format of ['GLB','FBX'])for(const method of ['click','dispatch','document','window','blob-window','picker']){
  const taskId='11111111-2222-3333-4444-555555555555',extension=format==='GLB'?'glb':'zip';
  let native=0,listener,timer,serial=0;const revoked=[];
  class Target{dispatchEvent(){native++;return true;}}
  class Anchor extends Target{constructor(href,name){super();this.href=href;this.download=name;}hasAttribute(name){return name==='download'&&this.download!==undefined;}click(){native++;}}
  class PageURL extends URL{}
  PageURL.createObjectURL=()=>`blob:https://studio.tripo3d.ai/export-${++serial}`;
  PageURL.revokeObjectURL=url=>revoked.push(url);
  const window={open:()=>{native++;return {closed:false};},showSaveFilePicker:async()=>{native++;}};
  const originals={click:Anchor.prototype.click,dispatch:Anchor.prototype.dispatchEvent,create:PageURL.createObjectURL,revoke:PageURL.revokeObjectURL,open:window.open,picker:window.showSaveFilePicker};
  const location={origin:'https://studio.tripo3d.ai',pathname:'/workspace/generate/'+taskId,href:'https://studio.tripo3d.ai/workspace/generate/'+taskId};
  const document={addEventListener:(type,fn)=>listener=fn,removeEventListener:(type,fn)=>{assert.equal(listener,fn);listener=null;}};
  const context={window,document,location,HTMLAnchorElement:Anchor,URL:PageURL,Blob,setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>timer=null};
  const run=action=>vm.runInNewContext(`(${adapterFunctions.captureStudioExport.toString()})(${JSON.stringify({action,taskId,lease:'causal',format})})`,context);
  assert.equal(run('arm').stage,'armed');
  window.open('https://example.com/help');new Anchor('https://example.com/info','notes.txt').click();
  assert.equal(native,2);assert.equal(run('read').stage,'pending');
  let url=`https://cdn.example/export.${extension}?signature=never-log-this`;
  const anchor=new Anchor(url,`character.${extension}`);
  if(method==='click')anchor.click();
  if(method==='dispatch'){anchor.dispatchEvent(new Event('click',{cancelable:true}));}
  if(method==='document')listener({target:{closest:()=>anchor},preventDefault(){},stopImmediatePropagation(){}});
  if(method==='window')window.open(url,'_blank');
  if(method==='blob-window'){url=PageURL.createObjectURL(new Blob(['native model'],{type:format==='GLB'?'model/gltf-binary':'application/zip'}));window.open(url);PageURL.revokeObjectURL(url);assert.equal(revoked.length,0);}
  if(method==='picker'){const file=await window.showSaveFilePicker({suggestedName:`character.${extension}`}),writer=await file.createWritable();await writer.write(new Uint8Array([1,2]));await writer.close();url=run('read').url;}
  const result=run('read');assert.equal(result.stage,'captured',format+' '+method);assert.equal(result.url,url);assert.equal(native,2);
  assert.equal(result.diagnostic.format,format);assert(!JSON.stringify(result.diagnostic).includes('never-log-this'));
  run('disarm');
  assert.equal(Anchor.prototype.click,originals.click);assert.equal(Anchor.prototype.dispatchEvent,originals.dispatch);assert.equal(Object.hasOwn(Anchor.prototype,'dispatchEvent'),false);
  assert.equal(PageURL.createObjectURL,originals.create);assert.equal(PageURL.revokeObjectURL,originals.revoke);assert.equal(window.open,originals.open);assert.equal(window.showSaveFilePicker,originals.picker);assert.equal(listener,null);assert.equal(timer,null);
 }
});

test('local export receiver accepts rig download and rejects another task',async t=>{
  const h=await harness(t),token=await h.pair(),taskId='11111111-2222-3333-4444-555555555555';
  const dataBase64=(await fs.readFile('fixtures/mannequin.glb')).toString('base64');
  await h.ext('heartbeat',token,{tab:TAB,inspection:INSPECTION,automationAuthorized:true,adapter:{adapterVersion:2,rigWorkflowVersion:1,supported:true}});
  const op=h.bridge.enqueue('rig',{action:'download',taskId,taskConfirmed:true},{});
  const result=await h.ext('export-file',token,{operationId:op.id,taskId,dataBase64});assert.equal(result.status,200);assert.equal(result.data.download.transport,'local-export-bytes');
  assert.equal((await h.ext('export-file',token,{operationId:op.id,taskId:'22222222-2222-3333-4444-555555555555',dataBase64})).status,409);
});

 test('local receiver refuses rig monitor and submit even for the confirmed task',async t=>{
  for(const action of ['monitor','submit']){
    const h=await harness(t),token=await h.pair(),taskId='11111111-2222-3333-4444-555555555555';
    await h.ext('heartbeat',token,{tab:TAB,inspection:INSPECTION,automationAuthorized:true,adapter:{adapterVersion:2,rigWorkflowVersion:1,supported:true}});
    const op=h.bridge.enqueue('rig',{action,taskId,operationId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',confirmCost:true,expectedCost:'20'},{});
    const dataBase64=(await fs.readFile('fixtures/mannequin.glb')).toString('base64');
    assert.equal((await h.ext('export-file',token,{operationId:op.id,taskId,dataBase64})).status,409);
  }
});

test('chunked rig export accepts a GLB over 32 MiB, rejects changed/order errors and acknowledges retries',async t=>{
  const h=await harness(t),token=await h.pair(),taskId='11111111-2222-3333-4444-555555555555';
  await h.ext('heartbeat',token,{tab:TAB,inspection:INSPECTION,automationAuthorized:true,adapter:{adapterVersion:2,rigWorkflowVersion:1,supported:true}});
  const op=h.bridge.enqueue('rig',{action:'download',taskId},{});
  const fixture=await fs.readFile('fixtures/mannequin.glb'),jsonLength=fixture.readUInt32LE(12),doc=JSON.parse(fixture.toString('utf8',20,20+jsonLength));
  const binary=Buffer.alloc(34*1024*1024);fixture.copy(binary,0,28+jsonLength);doc.buffers[0].byteLength=binary.length;
  const json=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);
  const bytes=Buffer.alloc(28+padded.length+binary.length);bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(padded.length,12);bytes.writeUInt32LE(0x4e4f534a,16);padded.copy(bytes,20);bytes.writeUInt32LE(binary.length,20+padded.length);bytes.writeUInt32LE(0x004e4942,24+padded.length);binary.copy(bytes,28+padded.length);
  const send=(offset,part)=>h.ext('export-file',token,{phase:'chunk',operationId:op.id,taskId,offset,totalBytes:bytes.length,dataBase64:part.toString('base64')});
  const finish=()=>h.ext('export-file',token,{phase:'finish',operationId:op.id,taskId});
  assert.equal((await finish()).status,409);assert.equal((await send(20,bytes.subarray(20,80))).status,409);
  const first=bytes.subarray(0,1024*1024);assert.equal((await send(0,first)).data.received,first.length);
  assert.equal((await send(0,first)).data.received,first.length,'lost acknowledgement does not append twice');
  const changed=Buffer.from(first);changed[50]^=1;assert.equal((await send(0,changed)).status,409);assert.equal((await finish()).status,409);
  for(let offset=first.length;offset<bytes.length;offset+=1024*1024){const part=bytes.subarray(offset,offset+1024*1024);assert.equal((await send(offset,part)).data.received,offset+part.length);}
  const saved=await finish();assert.equal(saved.status,200);assert.deepEqual(await fs.readFile(saved.data.download.path),bytes);assert.equal((await finish()).data.download.path,saved.data.download.path);
  await h.ext('disconnect',token);assert.equal((await finish()).status,403);
});

test('isolated export reader serves bounded chunks from one fetch and releases its lease',async()=>{
  const source=await fs.readFile('extension-tripo-studio/background.js','utf8'),reader=source.slice(source.indexOf('async function readExportedGlb('),source.indexOf('async function nativeGlbExport('));
  const taskId='11111111-2222-3333-4444-555555555555',bytes=await fs.readFile('fixtures/mannequin.glb');let fetches=0;
  const context={window:{},location:{origin:'https://studio.tripo3d.ai',pathname:'/workspace/generate/model-'+taskId},URL,AbortSignal,btoa,setTimeout:()=>1,clearTimeout(){},fetch:async()=>{fetches++;return new Response(bytes);}};
  const run=(action,extra={})=>vm.runInNewContext(`${reader};readExportedGlb(${JSON.stringify({taskId,lease:'one',action,url:'https://download.example/file.glb',...extra})})`,context);
  assert.equal((await run('start')).totalBytes,bytes.length);
  assert.equal((await run('chunk',{offset:0,lease:'wrong'})).adapterError,'EXPORT_BYTES_EXPIRED');
  const result=await run('chunk',{offset:0});assert.deepEqual(Buffer.from(result.dataBase64,'base64'),bytes.subarray(0,1024*1024));assert.equal(fetches,1);
  await run('release');assert.equal((await run('chunk',{offset:0})).adapterError,'EXPORT_BYTES_EXPIRED');
});


test('popup accepts the current worker and still blocks an actually obsolete worker',async()=>{
  const manifest=JSON.parse(await fs.readFile('extension-tripo-studio/manifest.json','utf8'));
  assert(adapterFunctions.STUDIO_WORKER_REVISION.startsWith(manifest.version+'-'));
  const source=(await fs.readFile('extension-tripo-studio/popup.js','utf8')).replace(/^import[^\n]+\n/gm,'');
  for(const current of [true,false]){
    const elements=new Map(),calls=[];
    const element=()=>({value:'',hidden:false,disabled:false,textContent:'',className:'',dataset:{},addEventListener(){},setAttribute(){},replaceChildren(){this.value='';},append(option){if(!this.value)this.value=option.value;}});
    const document={documentElement:{},querySelectorAll:()=>[],getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element};
    const chrome={storage:{local:{get:async()=>({language:'en'})}},runtime:{sendMessage:async message=>{calls.push(message.type);return {ok:true,extensionId:ID,workerRevision:current?adapterFunctions.STUDIO_WORKER_REVISION:'obsolete-worker',tabs:[{id:12,title:'Tripo Studio'}],bridge:{paired:true,readable:true,preparationAvailable:true,automationAuthorized:true,tabId:12}};}}};
    await vm.runInNewContext('(async()=>{'+source+';await render();})()',{document,chrome,messages,translateError,STUDIO_WORKER_REVISION:adapterFunctions.STUDIO_WORKER_REVISION,observeStudioDocument:adapterFunctions.observeStudioDocument});
    assert.equal(elements.get('reload-extension').hidden,current);
    assert.equal(elements.get('status').textContent,current?messages.en.automationReady:messages.en.reloadWorker);
    assert(calls.every(type=>type==='status'),'Opening the popup must never pair, submit or reload');
  }
});

test('glass wall: working commands show it, pause answers monitors without touching Tripo, resume restores it',async t=>{
 const h=await harness(t),id='11111111-2222-4333-8444-555555555555';
 const worker=await workerHarness(h,null,async name=>{
  if(name==='observeStudioDocument')return {adapterVersion:2,topologySettingsVersion:1,supported:true,workflow:'generate',currentTaskId:id,existingTaskIds:[id],blockingDialog:false,modelReady:true,slots:{}};
  if(name==='readStudioGenerationFailures')return {failures:[]};
  if(name==='readCandidatePreviews')return [];
  throw Error('Unexpected '+name);
 });
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 const fromWall=action=>new Promise(resolve=>worker.listener()({type:'fita-guard',action},{id:ID,tab:{id:TAB.id},url:'https://studio.tripo3d.ai/workspace/generate'},resolve));
 const monitor=h.bridge.enqueue('monitor',{taskId:id,taskConfirmed:true},{});await worker.message({type:'refresh'});
 assert.equal(h.bridge.getOperation(monitor.id).result.stage,'ready');
 assert(worker.calls.some(c=>c.type==='guard'&&c.state==='working'&&c.step==='monitor'));
 assert.equal((await fromWall('pause')).paused,true);
 assert.equal(worker.calls.filter(c=>c.type==='guard').at(-1).state,'paused');
 const before=worker.calls.filter(c=>c.type==='executeScript'&&c.funcName==='observeStudioDocument').length;
 const waiting=h.bridge.enqueue('monitor',{taskId:id,taskConfirmed:true},{});await worker.message({type:'refresh'});
 const result=h.bridge.getOperation(waiting.id).result;
 assert.equal(result.stage,'processing');assert.equal(result.pausedByUser,true);
 // The refresh cycle inspects the tab, but the paused monitor itself reads nothing from Tripo.
 assert.equal(worker.calls.filter(c=>c.type==='executeScript'&&c.funcName==='observeStudioDocument').length-before,1);
 // A message from any other tab cannot pause or resume this one.
 assert.equal(await new Promise(resolve=>worker.listener()({type:'fita-guard',action:'resume'},{id:ID,tab:{id:TAB.id+99}},resolve)).then(r=>r.ok),false);
 assert.equal((await fromWall('resume')).paused,false);
 assert.notEqual(worker.calls.filter(c=>c.type==='guard').at(-1).state,'paused');
 assert.equal((await worker.message({type:'disconnect'})).ok,true);
 assert.equal(worker.calls.filter(c=>c.type==='guard').at(-1).state,'hidden');
});

test('free settings check restores Smart Mesh, P2.0, four results, multiview and Quad limits without a project, upload or Generate',async t=>{
 const h=await harness(t);let smart=false,model='P1.0 - Fast',count=1,multiview=false,topology=[];
 const worker=await workerHarness(h,null,async name=>{
  if(name==='observeStudioDocument')return {adapterVersion:2,quickGenerationVersion:1,topologySettingsVersion:1,supported:true,workflow:'generate',generationWorkspaceReady:true,blockingDialog:false,generationMode:smart?'smart-mesh':'hd',modelLabel:smart?model:'H3.1',generationCount:smart?count:null,mode:multiview?'multiview':'other',costLabel:'100',slots:{},options:{}};
  if(name==='selectStudioSmartMesh'){smart=true;return {selected:true};}
  if(name==='selectStudioModelVersion'){model='P2.0';return {selected:true};}
  if(name==='selectStudioFourResults'){count=4;return {selected:true};}
  if(name==='selectStudioMultiview'){multiview=true;return {selected:true};}
  throw Error('Unexpected action '+name);
 },undefined,({step,faceLimits})=>{topology.push(step);return {open:true,faceLimits};});
 assert.equal((await h.ui('/settings-check',{})).status,409);
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 assert.equal((await h.ui('/settings-check',{group:'head'})).status,400);
 const response=await h.ui('/settings-check',{});assert.equal(response.status,202);
 await worker.message({type:'refresh'});
 const operation=(await h.ui('/settings-check/'+response.data.operation.id,null,'GET')).data.operation;
 assert.equal(operation.status,'succeeded');assert.equal(operation.result.mode,'smart-mesh');assert.equal(operation.result.generationCount,4);assert.equal(operation.result.modelLabel,'P2.0');
 assert.deepEqual(Array.from(operation.result.options.generationFaceLimits),[18000,20000,22500,25000]);
 assert.deepEqual(topology,['configure']);
 assert.equal(worker.calls.some(c=>c.type==='executeScript'&&/Generate|upload/.test(c.funcName)),false);
});

test('a page call that never answers cannot freeze the worker: it times out, reports suspension and keeps polling',async t=>{
 const h=await harness(t);let hang=true,inspections=0;
 const worker=await workerHarness(h,null,async name=>{
  if(name==='observeStudioDocument'){inspections++;if(hang)return new Promise(()=>{});return {adapterVersion:2,supported:true,workflow:'generate',blockingDialog:false,slots:{}};}
  throw Error('Unexpected '+name);
 },undefined,undefined,{script:40,inspect:40,busy:200});
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});
 hang=false;await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 hang=true;const beats=()=>worker.calls.filter(c=>c.type==='request'&&c.route==='heartbeat').length,start=beats();
 // The hung page read is abandoned after its bound: the heartbeat still goes
 // out (flagging the unreadable adapter) instead of the worker staying busy.
 assert.equal((await worker.message({type:'refresh'})).ok,true);
 assert(beats()>start);
 assert.match(worker.calls.filter(c=>c.type==='request'&&c.route==='heartbeat').at(-1).data.adapterError,/STUDIO_SCRIPT_TIMEOUT/);
 assert.equal(worker.localMemory.workbenchHungScript.function,'observeStudioDocument');
 hang=false;const before=inspections;
 assert.equal((await worker.message({type:'refresh'})).ok,true);
 assert(inspections>before,'the next cycle runs normally');
});

test('watchdog releases a cycle stuck on any await and records the step it was waiting on',async t=>{
 const h=await harness(t);let stall=false;
 const hook=async()=>{};hook.before=async route=>{if(route==='poll'&&stall){stall=false;await new Promise(()=>{});}};
 const worker=await workerHarness(h,hook,undefined,undefined,undefined,{script:1000,inspect:1000,busy:150});
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});
 await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true});
 stall=true;void worker.message({type:'refresh'});
 await new Promise(resolve=>setTimeout(resolve,250));
 const polls=()=>worker.calls.filter(c=>c.type==='request'&&c.route==='poll').length,before=polls();
 assert.equal((await worker.message({type:'refresh'})).ok,true);
 assert.equal(worker.localMemory.workbenchStuckCycle.phase,'poll');
 assert(polls()>before,'a fresh cycle polls again after the stuck one is released');
});

test('a paired browser resumes without a code after a FITA restart; wrong keys are refused and Disconnect forgets it',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-devices-')),devicesFile=path.join(dir,'studio-devices.json');
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const h=await harness(t,{devicesFile});
 const pairing=await h.ui('/pairing',{extensionId:ID}),paired=await h.ext('pair',null,{code:pairing.data.code});
 const credential=paired.data.deviceCredential;assert.match(credential,/^[a-f0-9]{64}$/);
 await new Promise(resolve=>setTimeout(resolve,50));
 assert(!(await fs.readFile(devicesFile,'utf8')).includes(credential),'only a hash is written to disk');
 // A FITA restart is a new bridge reading the same file.
 const restarted=await harness(t,{devicesFile});
 assert.equal((await restarted.ui('/status',null,'GET')).data.rememberedBrowsers,1);
 const resumed=await restarted.ext('resume',null,{credential});assert.equal(resumed.status,200);
 assert.equal((await restarted.ui('/status',null,'GET')).data.resumed,true);
 // Heartbeats renew the session past its original lifetime while in use.
 for(let i=0;i<5;i++){restarted.advance(5000);assert.equal((await restarted.ext('heartbeat',resumed.data.token,{})).status,200);}
 // Wrong keys and other extensions are refused; repeated failures lock briefly.
 assert.equal((await restarted.ext('resume',null,{credential:'f'.repeat(64)})).status,401);
 assert.equal((await restarted.ext('resume',null,{credential},{Origin:'chrome-extension://'+'b'.repeat(32)})).status,403);
 for(let i=0;i<10;i++)await restarted.ext('resume',null,{credential:'e'.repeat(64)});
 assert.equal((await restarted.ext('resume',null,{credential})).status,429);
 restarted.advance(61000);
 // Disconnect in FITA forgets the browser, also for the next restart.
 assert.equal((await restarted.ui('/connection',null,'DELETE')).status,200);
 assert.equal((await restarted.ext('resume',null,{credential})).status,403);
 const again=await harness(t,{devicesFile});
 assert.equal((await again.ext('resume',null,{credential})).status,403);
});

test('a remembered browser reconnects by itself after the browser drops its session, adopting the Tripo tab',async t=>{
 const h=await harness(t),worker=await workerHarness(h,null,async name=>{
  if(name==='observeStudioDocument')return {adapterVersion:2,generationNavigationVersion:1,supported:true,workflow:'generate',blockingDialog:false,slots:{}};
  throw Error('Unexpected '+name);
 });
 const {data}=await h.ui('/pairing',{extensionId:ID});await worker.message({type:'pair',code:data.code});
 assert.match(worker.localMemory.fitaRememberedBrowser.credential,/^[a-f0-9]{64}$/);
 assert.equal((await worker.message({type:'connect',tabId:TAB.id,automationAuthorized:true})).ok,true);
 assert.equal(worker.localMemory.fitaRememberedBrowser.automationAuthorized,true);
 // Browser restart: session storage is empty, the remembered credential is not.
 delete worker.memory.bridge;
 assert.equal((await worker.message({type:'refresh'})).ok,true);
 assert.equal(worker.memory.bridge.tabId,TAB.id);assert.equal(worker.memory.bridge.automationAuthorized,true);
 const status=(await h.ui('/status',null,'GET')).data;
 assert.equal(status.paired,true);assert.equal(status.resumed,true);assert.equal(status.automationAuthorized,true);
 // Disconnect forgets it in the extension and in FITA.
 await worker.message({type:'disconnect'});
 assert.equal(worker.localMemory.fitaRememberedBrowser,undefined);
 assert.equal((await h.ui('/status',null,'GET')).data.rememberedBrowsers,0);
});

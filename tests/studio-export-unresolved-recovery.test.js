import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as adapter from '../extension-tripo-studio/studio-adapter.js';

test('an unresolved free export gets one leased recovery, retains its old intent and never touches browser files or paid controls',async()=>{
 const source=await fs.readFile('extension-tripo-studio/background.js','utf8');
 const native=source.slice(source.indexOf('async function nativeGlbExport('),source.indexOf('async function performStudioCommand('));
 const taskId='11111111-2222-4333-8444-555555555555',taskPath='/workspace/generate/'+taskId;
 for(const format of ['GLB','FBX'])for(const captureWorks of [false,true]){
  const key=format==='FBX'?taskId+':source:fbx':taskId,oldClick=Date.now()-180000;
  const old={taskId,taskPath,operationId:'old-export',state:'unresolved',correlation:'captured-export',clickAt:oldClick};
  const storage={studioDownloadReceiptsV1:{[key]:old}},calls=[];let downloads=0,backendChunks=0;
  const bridge={tabId:8,token:'same-session',automationAuthorized:true};
  const context={...adapter,readExportedGlb:function readExportedGlb(){},URL,Date,STUDIO:'https://studio.tripo3d.ai',session:async()=>bridge,pause:async()=>{},
   chrome:{runtime:{id:'fita'},tabs:{get:async()=>({url:'https://studio.tripo3d.ai'+taskPath})},downloads:{onCreated:{},search:async()=>[{id:13,filename:'unrelated.json',state:'complete',startTime:new Date(oldClick+100).toISOString()}],cancel:()=>assert.fail('Never cancel an unbound browser event'),download:()=>assert.fail('No native Save As fallback is needed')},storage:{local:{get:async()=>structuredClone(storage),set:async value=>Object.assign(storage,structuredClone(value))}}},
   request:async(_route,body)=>{assert.equal(body.taskId,taskId);if(body.phase==='chunk'){backendChunks++;return {received:body.offset+20};}return {download:{taskId,path:'validated.'+format.toLowerCase()}};},
   runInTab:async(_bridge,fn,args)=>{
    calls.push(fn.name+':'+(args[0].step||args[0].action));
    if(fn.name==='exportStudioControl'){if(args[0].step==='download')downloads++;return {stage:'ready'};}
    if(fn.name==='captureStudioExport')return args[0].action==='read'?{stage:captureWorks?'captured':'waiting',url:'https://cdn.example/native.'+format.toLowerCase()}:{stage:args[0].action};
    if(fn.name==='readExportedGlb')return args[0].action==='start'?{totalBytes:20}:args[0].action==='chunk'?{offset:0,length:20,dataBase64:'test'}:{};
    assert.fail('Unexpected or paid action '+fn.name);
   }};
  const run=()=>vm.runInNewContext(native+`;nativeGlbExport(bridge,${JSON.stringify(taskId)},${JSON.stringify({operationId:'free-recovery',directExportTransfer:true,captureWaitSeconds:1,format})})`,{...context,bridge});
  const result=await run();assert.equal(downloads,1);assert.equal(storage.studioDownloadReceiptsV1[key].freeRecoveryCount,1);
  assert.equal(storage.studioDownloadReceiptsV1[key].recoveryHistory[0].operationId,'old-export');
  assert.equal(storage.studioDownloadReceiptsV1[key].recoveryHistory[0].windowEventCount,1);
  assert.equal(calls.some(name=>/generate|upload/i.test(name)),false);
  if(captureWorks){assert.equal(result.stage,'exported',JSON.stringify(result));assert.equal(backendChunks,1);const before=calls.length;assert.equal((await run()).stage,'exported');assert.equal(calls.length,before,'reuse the completed causal receipt');}
  else {assert.equal(result.reason,'EXPORT_CAPTURE_TIMEOUT');storage.studioDownloadReceiptsV1[key].clickAt=oldClick;assert.equal((await run()).reason,'DOWNLOAD_RECEIPT_REQUIRES_REVIEW');assert.equal(downloads,1,'a second uncertain free export cannot loop');}
 }
});

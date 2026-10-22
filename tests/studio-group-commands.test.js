import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroupCommands} from '../extension-tripo-studio/group-commands.js';
import {navigateStudioTask} from '../extension-tripo-studio/studio-navigation.js';
const taskId='11111111-2222-3333-4444-555555555555',groupKey='a'.repeat(64),operationId='22222222-2222-3333-4444-555555555555';

test('automatic inspection reports the current durable UV intent without mutations or unrelated storage',async()=>{
 const values={bridge:{token:'SECRET'},['workbenchGroupOperation:'+operationId]:{step:'smartUV',taskId,clicked:true,status:'running',uvSelection:{version:1,retries:2,pendingRetry:{at:1000,remaining:1,keys:['a','b','c']},retryRecovery:{at:900,originalAt:100,remaining:3,keys:['a']}}}};
 const execute=createGroupCommands({chrome:{storage:{local:{get:async()=>structuredClone(values),set:async()=>{throw Error('Unexpected storage mutation');}}}},runInTab:async(_bridge,fn,args=[])=>{
  assert.ok(!args[0]?.action&&!args[0]?.confirm);
  if(fn.name==='observeGroupStudio')return {workflow:'smart-uv',taskId};
  if(fn.name==='controlImportOrientation')return {present:false};
  if(fn.name==='studioUvCandidatesControl')return {taskId,remaining:1};
  assert.equal(fn.name,'observeStudioDocument');return {};
 }});
 const result=await execute({},{payload:{action:'inspect',groupKey}});
 assert.equal(result.uvOperations.length,1);assert.equal(result.uvOperations[0].operationId,operationId);
 assert.equal(result.uvOperations[0].uvSelection.pendingRetry.remaining,1);assert.equal(JSON.stringify(result).includes('SECRET'),false);
});

test('a fresh empty upload retries at ten seconds exactly once, but pending file/progress prevents duplicate upload',async()=>{
 for(const busy of [false,true]){
  let time=100000,uploads=[],visible=false,ready=false;const values={},sha256='b'.repeat(64);
  const chrome={storage:{local:{get:async k=>k===null?structuredClone(values):({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}}};
  const run=createGroupCommands({chrome,now:()=>time,pause:async ms=>{time+=ms;},runInTab:async(_b,fn,args)=>{
   if(fn.name==='observeGroupStudio')return {taskId:ready?taskId:null,links:[],importAvailable:true,importFileCount:busy&&uploads.length?1:0,importBusy:busy&&uploads.length>0};
   if(fn.name==='studioGroupControl'){assert.equal(args[0].action,'import');uploads.push(time);if(uploads.length===2)visible=true;return {dispatched:true};}
   assert.equal(fn.name,'controlImportOrientation');if(args[0].confirm){ready=true;visible=false;return {confirmed:true};}return {present:visible,enabled:true};
  }});
  const job=()=>run({},{payload:{action:'import',groupKey,model:{sha256}}});
  if(busy){await assert.rejects(job,/SEG_IMPORT_UNCERTAIN/);assert.deepEqual(uploads,[100000]);}
  else{assert.equal((await job()).receipt.taskId,taskId);assert.deepEqual(uploads,[100000,110000]);}
 }
});

test('quote recovers a stale empty upload once, confirms orientation, and reads a price without paid controls',async()=>{
 const key='workbenchGroup:'+groupKey,sha256='b'.repeat(64),values={[key]:{state:'uploading',beforeIds:[taskId],sha256}};
 const next='99999999-2222-3333-4444-555555555555';let uploads=0,visible=false,confirmed=false,time=100000;
 const chrome={storage:{local:{get:async k=>k===null?structuredClone(values):({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}}};
 const execute=createGroupCommands({chrome,now:()=>time,pause:async ms=>{time+=ms;},runInTab:async(_b,fn,args)=>{
  if(fn.name==='observeGroupStudio')return {taskId:confirmed?next:taskId,links:[],workflow:'smart-uv',uv:{costLabel:'20'},importAvailable:true,importFileCount:0,importBusy:false};
  if(fn.name==='studioGroupControl'){assert.equal(args[0].action,'import');assert(time>=110000);uploads++;visible=true;return {dispatched:true};}
  assert.equal(fn.name,'controlImportOrientation');if(args[0].confirm){visible=false;confirmed=true;return {confirmed:true};}return {present:visible,enabled:true};
 }});
 const result=await execute({},{payload:{action:'quote',step:'smartUV',groupKey,model:{sha256}}});
 assert.equal(result.taskId,next);assert.equal(result.prices.smartUV,'20');assert.equal(uploads,1);
 values[key]={state:'uploading',beforeIds:[next],sha256,recoveryCount:1};
 await assert.rejects(()=>execute({},{payload:{action:'quote',step:'smartUV',groupKey,model:{sha256}}}),/SEG_IMPORT_RETRY_EXHAUSTED/);assert.equal(uploads,1);
});

test('lost import acknowledgement is observed to completion without another upload',async()=>{
 let time=100000,uploads=0,visible=false,ready=false;const values={},sha256='b'.repeat(64);
 const execute=createGroupCommands({chrome:{storage:{local:{get:async k=>({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}}},now:()=>time,pause:async ms=>{time+=ms;},runInTab:async(_b,fn,args)=>{
  if(fn.name==='observeGroupStudio')return {taskId:ready?taskId:null,links:[],importAvailable:true,importFileCount:0,importBusy:false};
  if(fn.name==='studioGroupControl'){uploads++;visible=true;throw Error('STUDIO_DID_NOT_RESPOND');}
  assert.equal(fn.name,'controlImportOrientation');if(args[0].confirm){visible=false;ready=true;return {confirmed:true};}return {present:visible,enabled:true};
 }});
 const result=await execute({},{payload:{action:'import',operationId,groupKey,model:{sha256}}});
 assert.equal(result.receipt.taskId,taskId);assert.equal(uploads,1);
});

test('an empty post-export renderer reloads once before the first upload, preserving its counter',async()=>{
 let time=100000,ready=false,imported=false,visible=false,uploads=0,reloads=0;const values={},sha256='b'.repeat(64);
 const chrome={storage:{local:{get:async k=>({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}},tabs:{reload:async id=>{assert.equal(id,9);reloads++;ready=true;}}};
 const execute=createGroupCommands({chrome,now:()=>time,pause:async ms=>{time+=ms;},runInTab:async(_b,fn,args)=>{
  if(fn.name==='observeGroupStudio')return {taskId:imported?taskId:'old',links:[],modelReady:ready,importAvailable:true,importFileCount:0,importBusy:false};
  if(fn.name==='studioGroupControl'){assert.equal(ready,true);uploads++;visible=true;return {dispatched:true};}
  if(args[0].confirm){visible=false;imported=true;return {confirmed:true};}return {present:visible,enabled:true};
 }});
 assert.equal((await execute({tabId:9},{payload:{action:'import',operationId,groupKey,model:{sha256}}})).receipt.taskId,taskId);
 assert.equal(reloads,1);assert.equal(uploads,1);
});

test('the exact exhausted v2 import can migrate once; busy UI, new results and v3 cannot bypass its limit',async()=>{
 for(const condition of ['idle-v2','busy','candidate','v3','failed-again']){
  let time=500000,uploads=0,visible=false,ready=false;
  const key='workbenchGroup:'+groupKey,sha256='b'.repeat(64),paid={status:'completed',credits:20,step:'texture'};
  const values={[key]:{state:'uploading',beforeIds:['old'],sha256,tabId:9,recoveryCount:1,createdAt:100000,importRecoveryVersion:condition==='v3'?3:2},paid};
  const chrome={storage:{local:{get:async k=>({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}}};
  const execute=createGroupCommands({chrome,now:()=>time,pause:async ms=>{time+=ms;},runInTab:async(_b,fn,args)=>{
   if(fn.name==='observeGroupStudio')return {taskId:ready?taskId:'old',links:condition==='candidate'?[{taskId}]:[],modelReady:true,importAvailable:true,importBusy:condition==='busy',importFileCount:0};
   if(fn.name==='studioGroupControl'){uploads++;if(condition!=='failed-again')visible=true;return {dispatched:true};}
   if(args[0].confirm){visible=false;ready=true;return {confirmed:true};}return {present:visible,enabled:true};
  }});
  const command={payload:{action:'recover',recoveryStep:'import',operationId,groupKey,model:{sha256}}};
  if(condition==='idle-v2'){
   assert.equal((await execute({tabId:9},command)).receipt.taskId,taskId);assert.equal(uploads,1);
   assert.equal((await execute({tabId:9},command)).receipt.taskId,taskId);assert.equal(uploads,1);
  }else{
   await assert.rejects(()=>execute({tabId:9},command),/SEG_IMPORT_(?:UNCERTAIN|RETRY_EXHAUSTED)/);
   assert.equal(uploads,condition==='failed-again'?1:0);
   if(condition==='failed-again'){
    assert.equal(values[key].legacyRecovered,true);assert.equal(values[key].recoveryCount,2);assert.equal(values[key].dispatchHistory[0].version,2);
    await assert.rejects(()=>execute({tabId:9},command),/RETRY_EXHAUSTED/);assert.equal(uploads,1);
   }
  }
  assert.deepEqual(values.paid,paid);
 }
});

test('quotation confirms its own upload and retries a proven no-click re-render race without paying',async()=>{
 const key='workbenchGroup:'+groupKey,sha256='b'.repeat(64),values={[key]:{state:'uploading',beforeIds:[],sha256}};let attempts=0,visible=true;
 const chrome={storage:{local:{get:async k=>k===null?structuredClone(values):({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}}};
 const execute=createGroupCommands({chrome,pause:async()=>{},runInTab:async(_b,fn,args)=>{
  if(fn.name==='observeGroupStudio')return {taskId,links:[],workflow:'smart-uv',uv:{costLabel:'20'}};
  assert.equal(fn.name,'controlImportOrientation');
  if(args[0].confirm){attempts++;if(attempts===1)return {present:true,confirmed:false};visible=false;return {confirmed:true};}
  return {present:visible,enabled:true};
 }});
 const result=await execute({},{payload:{action:'quote',step:'smartUV',groupKey,model:{sha256}}});
 assert.equal(result.prices.smartUV,'20');assert.equal(attempts,2);assert.equal(values[key].state,'imported');
});

test('a preview task ID cannot be treated as imported while orientation remains visible',async()=>{
 const key='workbenchGroup:'+groupKey,sha256='b'.repeat(64),values={[key]:{state:'uploading',beforeIds:[],sha256,orientationAttempted:true}};
 const chrome={storage:{local:{get:async k=>({[k]:values[k]}),set:async v=>Object.assign(values,v)}}};
 const execute=createGroupCommands({chrome,pause:async()=>{},runInTab:async(_b,fn,args)=>{
  if(fn.name==='observeGroupStudio')return {taskId,links:[]};
  assert.equal(args[0].confirm,undefined);return {present:true,enabled:true};
 }});
 await assert.rejects(()=>execute({},{payload:{action:'import',groupKey,model:{sha256}}}),/SEG_IMPORT_ORIENTATION_STUCK/);
 assert.equal(values[key].state,'uploading');
});
test('orientation is confirmed once and a timed-out upload is recovered without another upload',async()=>{
 const key='workbenchGroup:'+groupKey,sha256='b'.repeat(64),values={[key]:{state:'uploading',beforeIds:[],sha256}};
 let confirmed=0,visible=true;
 const chrome={storage:{local:{get:async k=>k===null?structuredClone(values):({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}}};
 const execute=createGroupCommands({chrome,pause:async()=>{},runInTab:async(_b,fn,args)=>{
  if(fn.name==='observeGroupStudio')return {taskId:visible?null:taskId,links:[]};
  assert.equal(fn.name,'controlImportOrientation');
  if(args[0].confirm){assert.equal(values[key].orientationAttempted,true);confirmed++;visible=false;return {confirmed:true};}
  return {present:visible,enabled:true};
 }});
 const command={payload:{action:'import',groupKey,model:{sha256}}};
 assert.equal((await execute({},command)).receipt.taskId,taskId);
 assert.equal((await execute({},command)).receipt.taskId,taskId);assert.equal(confirmed,1);
 await assert.rejects(()=>execute({},{payload:{...command.payload,model:{sha256:'changed'}}}),/SOURCE_CHANGED/);
});
test('a lost orientation reply never clicks twice on recovery',async()=>{
 const key='workbenchGroup:'+groupKey,sha256='b'.repeat(64),values={[key]:{state:'uploading',beforeIds:[],sha256}};let clicks=0;
 const chrome={storage:{local:{get:async k=>k===null?structuredClone(values):({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}}};
 const execute=createGroupCommands({chrome,pause:async()=>{},runInTab:async(_b,fn,args)=>{
  if(fn.name==='observeGroupStudio')return {taskId:null,links:[]};
  if(args[0].confirm){clicks++;throw Error('reply lost');}return {present:true,enabled:true};
 }});
 const command={payload:{action:'import',groupKey,model:{sha256}}};
 await assert.rejects(()=>execute({},command),/reply lost/);
 await assert.rejects(()=>execute({},command),/SEG_IMPORT_ORIENTATION_STUCK/);assert.equal(clicks,1);
});
function fixture(){
 const values={},calls=[],state={taskId,workflow:'smart-uv',links:[],uv:{costLabel:'20',enabled:true,downloadReady:false}};
 const chrome={storage:{local:{get:async k=>k===null?structuredClone(values):({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}},tabs:{update:async()=>{}}};
 const command=createGroupCommands({chrome,pause:async()=>{},legacy:async()=>{throw Error('Unexpected legacy action');},exportGlb:async()=>{throw Error('Unexpected export');},runInTab:async(_bridge,fn,args)=>{calls.push({name:fn.name,input:args?.[0]});if(fn.name==='observeGroupStudio')return structuredClone(state);if(fn.name==='studioUvCandidatesControl')return {taskId,pending:true,remaining:0,occupancy:75,selectedKey:'only',candidates:[{key:'only'}],busy:false};if(fn.name==='studioUvSaveControl'){if(args[0].action==='save'){state.uv.pending=false;state.uv.enabled=true;return {clicked:true};}return {pending:state.uv.pending===true,saveEnabled:state.uv.pending===true,generateEnabled:state.uv.enabled,busy:!state.uv.enabled&&!state.uv.pending};}if(fn.name==='studioGroupControl'&&args[0].action==='submitUV'){state.uv.enabled=false;return{submitted:true};}throw Error('Unexpected control');}});
 const run=p=>command({tabId:9},{id:'bridge-op',payload:{groupKey,operationId,taskId,...p}});
 return {values,calls,state,run};
}

function orientationRecovery({stuck=false,lost=false,multiple=false,receiptTabId}={}){
 const key='workbenchGroup:'+groupKey,sha256='b'.repeat(64),values={[key]:{state:'uploading',beforeIds:[],sha256,orientationAttempted:true,recoveryCount:1,...(receiptTabId?{tabId:receiptTabId}:{})}};
 let time=100000,visible=true,clicks=0;
 const chrome={storage:{local:{get:async k=>k===null?structuredClone(values):({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}}};
 const execute=createGroupCommands({chrome,now:()=>time,pause:async ms=>{time+=ms;},runInTab:async(_b,fn,args)=>{
  if(fn.name==='observeGroupStudio')return {taskId:visible?null:taskId,links:multiple?[{taskId:'99999999-2222-3333-4444-555555555555'}]:[],importAvailable:true,importBusy:false,importFileCount:0};
  assert.equal(fn.name,'controlImportOrientation','recovery must not upload or pay');
  if(args[0].confirm){assert.equal(args[0].panelId,'own-panel');clicks++;if(!stuck)visible=false;if(lost)throw Error('reply lost');return {present:visible,confirmed:true,confirmClicks:clicks};}
  return {present:visible,enabled:true,panelId:'own-panel',confirmClicks:clicks};
 }});
 return {run:()=>execute({tabId:9},{payload:{action:'import',groupKey,model:{sha256}}}),clicks:()=>clicks,values,key};
}
test('an old pending confirmation is recovered even after upload retries were exhausted',async()=>{
 const f=orientationRecovery();assert.equal((await f.run()).receipt.taskId,taskId);assert.equal(f.clicks(),1);
 assert.equal((await f.run()).receipt.taskId,taskId);assert.equal(f.clicks(),1);
});
test('a lost free confirmation response is recovered from the closed panel without another click',async()=>{
 const f=orientationRecovery({lost:true});await assert.rejects(f.run,/reply lost/);
 assert.equal((await f.run()).receipt.taskId,taskId);assert.equal(f.clicks(),1);
});
test('a stuck panel stops after three free clicks and never reuploads the mesh',async()=>{
 const f=orientationRecovery({stuck:true});await assert.rejects(f.run,/ORIENTATION_STUCK/);assert.equal(f.clicks(),3);
 await assert.rejects(f.run,/ORIENTATION_STUCK/);assert.equal(f.clicks(),3);
});
test('multiple new models or a different authorized tab cannot become an import receipt',async()=>{
 const ambiguous=orientationRecovery({multiple:true});await assert.rejects(ambiguous.run,/RESULT_AMBIGUOUS/);assert.equal(ambiguous.values[ambiguous.key].state,'uploading');
 const moved=orientationRecovery({receiptTabId:10});await assert.rejects(moved.run,/TAB_CHANGED/);assert.equal(moved.clicks(),0);
});
test('an unrelated angle window is not confirmed before this group has an upload receipt',async()=>{
 let clicks=0,uploads=0;
 const execute=createGroupCommands({chrome:{storage:{local:{get:async()=>({})}}},pause:async()=>{},runInTab:async(_b,fn,args)=>{
  if(fn.name==='observeGroupStudio')return {importAvailable:true};
  if(fn.name==='studioGroupControl'){uploads++;return {};}
  if(args[0].confirm)clicks++;return {present:true,enabled:true};
 }});
 await assert.rejects(()=>execute({tabId:9},{payload:{action:'import',groupKey,model:{sha256:'b'.repeat(64)}}}),/OTHER_UPLOAD_PENDING/);
 assert.equal(clicks,0);assert.equal(uploads,0);
});
test('a previously observed disabled panel prevents duplicate uploads even after worker restart',async()=>{
 const key='workbenchGroup:'+groupKey,sha256='b'.repeat(64),values={[key]:{state:'uploading',beforeIds:[],sha256,orientationSeen:true}};
 let time=100000;
 const execute=createGroupCommands({chrome:{storage:{local:{get:async k=>({[k]:values[k]})}}},now:()=>time,pause:async ms=>{time+=ms;},runInTab:async(_b,fn)=>{
  if(fn.name==='observeGroupStudio')return {taskId:null,links:[],importAvailable:true,importFileCount:0,importBusy:false};
  assert.equal(fn.name,'controlImportOrientation','do not reupload an observed preview');return {present:false};
 }});
 await assert.rejects(()=>execute({tabId:9},{payload:{action:'import',groupKey,model:{sha256}}}),/ORIENTATION_STUCK/);
});
test('upgrade recovers an old abandoned empty upload once, but never a busy, recent or unselected result',async()=>{
 for(const condition of ['abandoned','busy','recent','unselected']){
  const key='workbenchGroup:'+groupKey,sha256='b'.repeat(64),old='99999999-2222-3333-4444-555555555555';let time=500000,uploads=0,visible=false,ready=false;
  const values={[key]:{state:'uploading',beforeIds:[old],sha256,createdAt:condition==='recent'?time:100000,orientationAttempted:true,recoveryCount:1}};
  const chrome={storage:{local:{get:async k=>k===null?structuredClone(values):{[k]:structuredClone(values[k])},set:async v=>Object.assign(values,structuredClone(v))}}};
  const execute=createGroupCommands({chrome,now:()=>time,pause:async ms=>{time+=ms;},runInTab:async(_b,fn,args)=>{
   if(fn.name==='observeGroupStudio')return {taskId:ready?taskId:old,links:condition==='unselected'?[{taskId}]:[],importAvailable:true,importBusy:condition==='busy',importFileCount:0};
   if(fn.name==='studioGroupControl'){assert.equal(args[0].action,'import');assert(time>=510000);uploads++;visible=true;return {dispatched:true};}
   assert.equal(fn.name,'controlImportOrientation');if(args[0].confirm){visible=false;ready=true;return {confirmed:true};}return {present:visible,enabled:true};
  }});
  const job=()=>execute({tabId:9},{payload:{action:'import',groupKey,model:{sha256}}});
  if(condition==='abandoned'){
   assert.equal((await job()).receipt.taskId,taskId);assert.equal(uploads,1);assert.equal((await job()).receipt.taskId,taskId);assert.equal(uploads,1);
  }else{await assert.rejects(job,/SEG_IMPORT_UNCERTAIN/);assert.equal(uploads,0);}
 }
});
test('a recovered imported mesh waits for Smart UV pricing without importing or paying',async()=>{
 const sha256='b'.repeat(64),values={['workbenchGroup:'+groupKey]:{state:'imported',taskId,sha256}};let reads=0;
 const chrome={storage:{local:{get:async k=>({[k]:values[k]})}}};
 const execute=createGroupCommands({chrome,pause:async()=>{},runInTab:async(_b,fn)=>{
  if(fn.name==='controlImportOrientation')return {present:false};
  assert.equal(fn.name,'observeGroupStudio');reads++;return {taskId,workflow:'smart-uv',uv:{costLabel:reads>43?'20':null}};
 }});
 const result=await execute({},{payload:{action:'quote',step:'smartUV',groupKey,model:{sha256}}});
 assert.equal(result.prices.smartUV,'20');assert.equal(reads,46);
});

test('Smart UV quote tolerates a thirty-second cold price and verifies stability without paid actions',async()=>{
 const sha256='b'.repeat(64),values={['workbenchGroup:'+groupKey]:{state:'imported',taskId,sha256}};let time=0,reads=0;
 const execute=createGroupCommands({chrome:{storage:{local:{get:async k=>({[k]:values[k]})}}},now:()=>time,pause:async ms=>{time+=ms;},runInTab:async(_b,fn)=>{
  if(fn.name==='controlImportOrientation')return {present:false};
  assert.equal(fn.name,'observeGroupStudio','quotation cannot upload or generate');reads++;
  return {taskId,workflow:'smart-uv',uv:{costLabel:time<30000?null:'20'}};
 }});
 const result=await execute({},{payload:{action:'quote',step:'smartUV',groupKey,model:{sha256}}});
 assert.equal(result.prices.smartUV,'20');assert.ok(time>=30500&&time<31000);assert.ok(reads>120);
});

test('an unavailable price remains bounded and never submits UV or fabricates a tariff',async()=>{
 const sha256='b'.repeat(64);let time=0;
 const execute=createGroupCommands({chrome:{storage:{local:{get:async k=>({[k]:{state:'imported',taskId,sha256}})}}},pause:async ms=>{time+=ms;},runInTab:async(_b,fn)=>{
  if(fn.name==='controlImportOrientation')return {present:false};
  assert.equal(fn.name,'observeGroupStudio');return {taskId,workflow:'smart-uv',uv:{costLabel:null}};
 }});
 await assert.rejects(()=>execute({},{payload:{action:'quote',step:'smartUV',groupKey,model:{sha256}}}),/SEG_PRICE_PENDING/);
 assert.equal(time,90000);
});
test('requoting an earlier imported group finishes the pending later piece before navigation',async()=>{
 const pendingKey='c'.repeat(64),pendingTask='99999999-2222-3333-4444-555555555555',sha256='b'.repeat(64),events=[];
 const values={['workbenchGroup:'+groupKey]:{state:'imported',taskId,sha256},['workbenchGroup:'+pendingKey]:{state:'uploading',sha256,beforeIds:[taskId],recoveryCount:1,tabId:9}};
 let visible=true,current=taskId;
 const url=`https://studio.tripo3d.ai/es/workspace/smart-uv/${taskId}`;
 const chrome={storage:{local:{get:async k=>k===null?structuredClone(values):{[k]:structuredClone(values[k])},set:async v=>Object.assign(values,structuredClone(v))}},tabs:{update:async(_tab,{url:actual})=>{assert.equal(visible,false);assert.equal(actual,url);assert.equal(values['workbenchGroup:'+pendingKey].taskId,pendingTask);events.push('navigate');current=taskId;}}};
 const execute=createGroupCommands({chrome,pause:async()=>{},runInTab:async(_b,fn,args)=>{
  if(fn.name==='observeGroupStudio')return {taskId:current,workflow:'smart-uv',links:[{taskId,workflow:'smart-uv',url}],uv:{costLabel:'20'}};
  assert.equal(fn.name,'controlImportOrientation','only free pending confirmation is allowed');
  if(args[0].confirm){events.push('confirm');visible=false;current=pendingTask;return {confirmed:true};}
  return {present:visible,enabled:true};
 }});
 const result=await execute({tabId:9},{payload:{action:'quote',step:'smartUV',groupKey,model:{sha256}}});
 assert.equal(result.taskId,taskId);assert.equal(result.prices.smartUV,'20');assert.deepEqual(events,['confirm','navigate']);
});
test('Smart UV records its paid attempt durably, duplicate calls do not click, and recovery waits for an observed result',async()=>{
 const f=fixture();let result=await f.run({action:'smartUV',expectedCost:'20'});assert.equal(result.receipt.status,'running');assert.equal(f.calls.filter(c=>c.input?.action==='submitUV').length,1);
 result=await f.run({action:'smartUV',expectedCost:'20'});assert.equal(result.receipt.status,'running');assert.equal(f.calls.filter(c=>c.input?.action==='submitUV').length,1);
 result=await f.run({action:'recover'});assert.equal(result.receipt.status,'running');f.state.uv.downloadReady=true;f.state.uv.pending=true;
 result=await f.run({action:'recover'});assert.equal(result.receipt.status,'completed');assert.equal(result.receipt.credits,20);assert.equal(result.receipt.uvSaved,true);assert.equal(f.calls.filter(c=>c.input?.action==='save').length,1);
});
test('changed Smart UV prices stop before recording or clicking and an interrupted attempt remains unknown',async()=>{
 const f=fixture();await assert.rejects(()=>f.run({action:'smartUV',expectedCost:'19'}),/SEG_PRICE_CHANGED/);assert.equal(f.calls.filter(c=>c.input?.action==='submitUV').length,0);
 f.values['workbenchGroupOperation:'+operationId]={status:'unknown',step:'smartUV',taskId,clicked:false};
 assert.equal((await f.run({action:'recover'})).receipt.status,'unknown');await f.run({action:'smartUV',expectedCost:'20'});assert.equal(f.calls.filter(c=>c.input?.action==='submitUV').length,0);
});

test('stale submitted UVs refresh the same view once, compare existing results and Save without a paid submission',async()=>{
 let time=100000,refreshes=0,saved=false,selected=0,saves=0;const vals=[68,79,72,70];
 const values={['workbenchGroupOperation:'+operationId]:{taskId,groupKey,step:'smartUV',clicked:true,status:'running',processingObserved:true,uvSaved:false,uvSelectionVersion:1,credits:20}};
 const chrome={storage:{local:{get:async k=>({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}},tabs:{get:async()=>({url:'https://studio.tripo3d.ai/workspace/smart-uv/'+taskId}),reload:async()=>{assert.equal(values['workbenchGroupOperation:'+operationId].uvViewRecovery.refreshes,1);refreshes++;}}};
 const run=createGroupCommands({chrome,now:()=>time,pause:async ms=>{time+=ms;},legacy:async()=>assert.fail('No paid operation'),runInTab:async(_b,fn,args=[])=>{
  if(fn.name==='observeGroupStudio')return {taskId,workflow:'smart-uv',unsavedChanges:false,uv:{downloadReady:saved}};
  if(fn.name==='studioUvSaveControl'){
   if(args[0].action){assert.equal(args[0].action,'save');saves++;saved=true;}
   return {taskId,pending:refreshes>0&&!saved,saveEnabled:true,generateEnabled:!refreshes||saved,busy:false,blockingDialog:false};
  }
  assert.equal(fn.name,'studioUvCandidatesControl');if(args[0].action){assert.equal(args[0].action,'select');selected=Number(args[0].key.slice(1));}
  return {taskId,pending:true,busy:false,blockingDialog:false,remaining:0,candidates:vals.map((_,i)=>({key:'c'+i})),selectedKey:'c'+selected,occupancy:vals[selected]};
 }});
 const command={payload:{action:'recover',operationId,groupKey,taskId}};
 assert.equal((await run({tabId:9},command)).stage,'processing');assert.equal(refreshes,0);time+=30000;
 const result=await run({tabId:9},command);assert.equal(result.receipt.status,'completed');assert.equal(result.receipt.uvSaved,true);
 assert.equal(refreshes,1);assert.equal(saves,1);assert.equal(selected,1);assert.equal(result.receipt.credits,20);
});
test('switching groups follows observed history and workspace links without guessing a task URL',async()=>{
 const other='99999999-2222-3333-4444-555555555555',textureUrl=`https://studio.tripo3d.ai/es/workspace/texture/${taskId}`,uvUrl=`https://studio.tripo3d.ai/es/workspace/smart-uv/${taskId}`,visits=[],values={};
 let state={taskId:other,workflow:'texture',links:[{taskId,workflow:'texture',url:textureUrl}]};
 const chrome={storage:{local:{get:async k=>({[k]:values[k]}),set:async v=>Object.assign(values,v)}},tabs:{update:async(tab,{url})=>{visits.push(url);assert.equal(tab,9);if(url===textureUrl)state={taskId,workflow:'texture',links:[{taskId,workflow:'smart-uv',url:uvUrl}]};else{assert.equal(url,uvUrl);state={taskId,workflow:'smart-uv',links:[],uv:{costLabel:'20',enabled:true,downloadReady:false}};}}}};
 const run=createGroupCommands({chrome,pause:async()=>{},runInTab:async(b,fn,args)=>{if(fn.name==='observeGroupStudio')return structuredClone(state);assert.equal(args[0].action,'submitUV');state.uv.enabled=false;return{submitted:true};}});
 assert.equal((await run({tabId:9},{payload:{groupKey,operationId,taskId,action:'smartUV',expectedCost:'20'}})).receipt.status,'running');assert.deepEqual(visits,[textureUrl,uvUrl]);
 state={taskId:other,workflow:'texture',links:[]};
 const recovered=await navigateStudioTask({chrome,pause:async()=>{},bridge:{tabId:9},runInTab:async()=>structuredClone(state)},taskId,'smart-uv');
 assert.equal(recovered.taskId,taskId);assert.equal(recovered.workflow,'smart-uv');assert.deepEqual(visits,[textureUrl,uvUrl,uvUrl]);
});
test('export cleanup never discards a saved download or repeats an export after a lost reply',async()=>{
 const values={'workbenchGroupOperation:texture-op':{status:'completed',step:'texture',groupKey,taskId}};let exports=0,closes=0;
 const chrome={storage:{local:{get:async k=>({[k]:values[k]}),set:async v=>Object.assign(values,v)}}};
 const run=createGroupCommands({chrome,pause:async()=>{},exportGlb:async()=>{exports++;return{stage:'exported',download:{path:'saved.glb'}};},runInTab:async(b,fn)=>{if(fn.name==='observeGroupStudio')return{taskId,workflow:'texture'};assert.equal(fn.name,'exportStudioControl');closes++;throw Error('EXPORT_DIALOG_CLOSE_NOT_ACKNOWLEDGED');}});
 const command={id:'bridge-download',payload:{groupKey,operationId,taskId,action:'download',textureOperationId:'texture-op'}};
 const first=await run({tabId:9},command);assert.equal(first.receipt.status,'completed');assert.equal(first.receipt.cleanupWarning,'EXPORT_DIALOG_CLOSE_NOT_ACKNOWLEDGED');
 const again=await run({tabId:9},command);assert.equal(again.receipt.download.path,'saved.glb');assert.equal(exports,1);assert.equal(closes,1);
});

test('a closed export dialog resumes only its download from a persisted intent',async()=>{
 const textureOperationId='33333333-2222-3333-4444-555555555555';
 const values={['workbenchGroupOperation:'+textureOperationId]:{status:'completed',step:'texture',groupKey,taskId}};let exports=0;
 const chrome={storage:{local:{get:async k=>({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}}};
 const run=createGroupCommands({chrome,pause:async()=>{},legacy:async()=>assert.fail('No paid command'),runInTab:async(_b,fn)=>{if(fn.name==='observeGroupStudio')return {taskId,workflow:'texture'};assert.equal(fn.name,'exportStudioControl');return {stage:'closed'};},exportGlb:async(_b,id,options)=>{
  assert.equal(id,taskId);assert.equal(options.exportRevision,textureOperationId);assert.equal(values['workbenchGroupOperation:'+operationId].step,'download');
  if(++exports===1)throw Error('EXPORT_DIALOG_NOT_VERIFIED [export:format]');
  return {stage:'exported',download:{path:'same-texture.glb'}};
 }});
 const payload={groupKey,operationId,taskId,textureOperationId};
 await assert.rejects(()=>run({tabId:9},{id:'first',payload:{...payload,action:'download'}}),/EXPORT_DIALOG_NOT_VERIFIED/);
 assert.equal(values['workbenchGroupOperation:'+operationId].status,'running');
 const recovered=await run({tabId:9},{id:'recover',payload:{...payload,action:'recover',recoveryStep:'download'}});
 assert.equal(recovered.receipt.status,'completed');assert.equal(recovered.receipt.download.path,'same-texture.glb');
 await run({tabId:9},{id:'again',payload:{...payload,action:'recover',recoveryStep:'download'}});assert.equal(exports,2);
});

test('legacy missing download receipts recover only with an explicit download step and matching completed texture',async()=>{
 for(const kind of ['valid','missing-step','wrong-group','wrong-task','not-completed']){
  const textureOperationId='33333333-2222-3333-4444-555555555555';let exports=0;
  const texture={status:'completed',step:'texture',groupKey,taskId};
  if(kind==='wrong-group')texture.groupKey='b'.repeat(64);if(kind==='wrong-task')texture.taskId='99999999-2222-3333-4444-555555555555';if(kind==='not-completed')texture.status='running';
  const values={['workbenchGroupOperation:'+textureOperationId]:texture};
  const chrome={storage:{local:{get:async k=>({[k]:values[k]}),set:async v=>Object.assign(values,v)}}};
  const run=createGroupCommands({chrome,pause:async()=>{},runInTab:async(_b,fn)=>fn.name==='observeGroupStudio'?{taskId,workflow:'texture'}:{stage:'closed'},legacy:async()=>assert.fail('No generation'),exportGlb:async()=>{exports++;return {stage:'exported',download:{path:'recovered.glb'}};}});
  const command={id:'recover',payload:{action:'recover',groupKey,operationId,taskId,textureOperationId,...(kind==='missing-step'?{}:{recoveryStep:'download'})}};
  if(kind==='valid'){assert.equal((await run({},command)).receipt.status,'completed');assert.equal(exports,1);}
  else if(kind==='missing-step'){assert.equal((await run({},command)).receipt.status,'unknown');assert.equal(exports,0);}
  else {await assert.rejects(()=>run({},command),/SEG_TEXTURE_RECEIPT_REQUIRED/);assert.equal(exports,0);}
 }
});

test('Recover and continue restores a lost import reply from its matching source group without another upload',async()=>{
 for(const kind of ['completed','pending-file','missing-source','changed-source']){
  const sha256='b'.repeat(64),source=kind==='completed'?{state:'imported',taskId,sha256}:{state:'uploading',beforeIds:[],sha256};
  const values=kind==='missing-source'?{}:{['workbenchGroup:'+groupKey]:source};let uploads=0,time=100000;
  const chrome={storage:{local:{get:async k=>({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}}};
  const run=createGroupCommands({chrome,now:()=>time,pause:async ms=>{time+=ms;},legacy:async()=>assert.fail('No paid generation'),runInTab:async(_b,fn)=>{
   if(fn.name==='observeGroupStudio')return {taskId:null,links:[],importAvailable:true,importFileCount:1,importBusy:true};
   if(fn.name==='controlImportOrientation')return {present:false};
   uploads++;assert.fail('Existing import must not be uploaded again');
  }});
  const command={payload:{action:'recover',recoveryStep:'import',operationId,groupKey,model:{sha256:kind==='changed-source'?'c'.repeat(64):sha256}}};
  if(kind==='completed'){
   const result=await run({},command);assert.equal(result.receipt.status,'completed');assert.equal(result.receipt.step,'import');assert.equal(result.receipt.taskId,taskId);assert.equal(values['workbenchGroupOperation:'+operationId].status,'completed');
   assert.equal((await run({},command)).receipt.taskId,taskId);
  }else await assert.rejects(()=>run({},command),new RegExp(kind==='changed-source'?'SEG_IMPORT_SOURCE_CHANGED':'SEG_IMPORT_UNCERTAIN'));
  assert.equal(uploads,0);
 }
});

test('a capture timeout recovers the same free download once automatically, then yields if it still fails',async()=>{
 for(const succeeds of [true,false]){
  const textureOperationId='33333333-2222-3333-4444-555555555555';let attempts=0;
  const values={['workbenchGroupOperation:'+textureOperationId]:{status:'completed',step:'texture',groupKey,taskId}};
  const chrome={storage:{local:{get:async k=>({[k]:values[k]}),set:async v=>Object.assign(values,v)}}};
  const run=createGroupCommands({chrome,pause:async()=>{},legacy:async()=>assert.fail('No paid step'),runInTab:async(_b,fn)=>fn.name==='observeGroupStudio'?{taskId,workflow:'texture'}:{stage:'closed'},exportGlb:async(_b,id,options)=>{
   assert.equal(id,taskId);assert.equal(options.operationId,'same-bridge-operation');assert.equal(options.exportRevision,textureOperationId);assert.equal(options.captureWaitSeconds,++attempts===1?90:60);
   return succeeds&&attempts===2?{stage:'exported',download:{path:'recovered.glb'}}:{stage:'requires_manual_import',reason:'EXPORT_CAPTURE_TIMEOUT'};
  }});
  const job=()=>run({}, {id:'same-bridge-operation',payload:{action:'download',groupKey,operationId,taskId,textureOperationId}});
  if(succeeds)assert.equal((await job()).receipt.status,'completed');else await assert.rejects(job,/EXPORT_CAPTURE_TIMEOUT/);
  assert.equal(attempts,2);
 }
});

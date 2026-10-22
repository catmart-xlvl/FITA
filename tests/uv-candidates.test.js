import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {optimizeUvCandidates,studioUvCandidatesControl} from '../extension-tripo-studio/uv-candidates.js';
import {throwAdapterError,asWorker} from './page-call.js';

function fixture({values=[41.4,76.8,63,70],lost=false,stuck=false}={}){
 let time=1000,count=1,selected=0,retries=0,persisted,pending=null;
 const receipt={taskId:'asset'};
 const inspect=async()=>{
  if(pending&&!stuck&&time>=pending){count++;selected=count-1;pending=null;}
  return {taskId:'asset',pending:true,remaining:4-count,occupancy:values[selected],selectedKey:'c'+selected,candidates:Array.from({length:count},(_,i)=>({key:'c'+i})),busy:pending!==null,retryEnabled:pending===null,blockingDialog:false};
 };
 const act=async action=>{
  if(action.action==='retry'){
   assert.equal(persisted.uvSelection.pendingRetry.remaining,4-count);assert.equal(action.expectedRemaining,4-count);
   retries++;pending=time+3000;if(lost&&retries===1)throw Error('reply lost');
  }else{assert.equal(action.action,'select');selected=Number(action.key.slice(1));}
 };
 return {receipt,inspect,act,persist:async()=>{persisted=structuredClone(receipt);},pause:async ms=>{time+=ms;},now:()=>time,retries:()=>retries,selected:()=>selected,elapse:ms=>time+=ms};
}
test('compares four settled UV results and reselects the highest, even if it is not the last',async()=>{
 const f=fixture();assert.equal(await optimizeUvCandidates(f),true);assert.equal(f.retries(),3);assert.equal(f.selected(),1);
 assert.equal(f.receipt.uvSelection.selected.occupancy,76.8);assert.equal(f.receipt.uvSelection.samples.length,4);
});
test('a lost free retry reply resumes without repeating its click',async()=>{
 const f=fixture({lost:true});await assert.rejects(optimizeUvCandidates(f),/reply lost/);f.elapse(5000);
 assert.equal(await optimizeUvCandidates(f),true);assert.equal(f.retries(),3);assert.equal(f.receipt.uvSelection.retries,3);
});
test('a confirmed new result can resume after a long extension reload without another click',async()=>{
 const f=fixture({lost:true});await assert.rejects(optimizeUvCandidates(f),/reply lost/);f.elapse(300000);
 assert.equal(await optimizeUvCandidates(f),true);assert.equal(f.retries(),3);
});
test('a stuck retry yields and ultimately requests attention without clicking again',async()=>{
 const f=fixture({stuck:true});assert.equal(await optimizeUvCandidates(f),false);assert.equal(f.retries(),1);
 f.elapse(200000); // The UI can stop reporting busy without a new result.
 const original=f.inspect;f.inspect=async()=>({...await original(),busy:false});
 await assert.rejects(optimizeUvCandidates(f),/SEG_UV_RETRY_UNCERTAIN/);assert.equal(f.retries(),1);
});

test('an ignored free retry recovers once after unchanged idle evidence, then still selects the best of four',async()=>{
 const f=fixture(),act=f.act;let clicks=0,recoveredAt;
 f.act=async a=>{if(a.action==='retry'&&++clicks===1)return {clicked:true};if(a.action==='retry'&&!recoveredAt){assert.equal(f.receipt.uvSelection.retryRecoveryCount,1);recoveredAt=f.now();}return act(a);};
 assert.equal(await optimizeUvCandidates(f),false);assert.equal(clicks,1);
 f.elapse(200000);const start=f.now();
 assert.equal(await optimizeUvCandidates(f),true);assert.ok(recoveredAt-start>=15000);
 assert.equal(clicks,4);assert.equal(f.retries(),3);assert.equal(f.selected(),1);assert.equal(f.receipt.uvSelection.retryRecoveryCount,1);
});

test('an ignored recovery is durable across reload and cannot loop or dispatch a paid retry',async()=>{
 const f=fixture();let clicks=0;f.act=async a=>{assert.equal(a.action,'retry');clicks++;};
 assert.equal(await optimizeUvCandidates(f),false);f.elapse(200000);
 assert.equal(await optimizeUvCandidates(f),false);assert.equal(clicks,2);f.elapse(200000);
 await assert.rejects(optimizeUvCandidates(f),/SEG_UV_RETRY_UNCERTAIN/);assert.equal(clicks,2);
});

test('each of the three free slots has its own one-recovery limit, including an existing v0.2.49 receipt',async()=>{
 const f=fixture(),act=f.act,dropped=new Set();let clicks=0;
 f.act=async a=>{if(a.action==='retry'){clicks++;if([3,1].includes(a.expectedRemaining)&&!dropped.has(a.expectedRemaining)){dropped.add(a.expectedRemaining);return {clicked:true};}}return act(a);};
 assert.equal(await optimizeUvCandidates(f),false);f.elapse(200000);
 assert.equal(await optimizeUvCandidates(f),false);assert.equal(f.receipt.uvSelection.retryRecoveryCount,1);
 // Migrate the old single-slot audit without resetting it or losing samples.
 delete f.receipt.uvSelection.retryRecoveries;f.elapse(200000);
 assert.equal(await optimizeUvCandidates(f),true);assert.equal(clicks,5);assert.equal(f.retries(),3);assert.equal(f.selected(),1);
 assert.deepEqual(f.receipt.uvSelection.retryRecoveries.map(r=>r.remaining),[3,1]);
});

test('pending recovery refuses decremented/exhausted counters, changed results, disabled controls and busy UI',async()=>{
 for(const delta of [{remaining:2},{remaining:0},{candidates:[{key:'other'}],selectedKey:'other'},{retryEnabled:false},{busy:true}]){
  const f=fixture();f.receipt.uvSelection={version:1,samples:[{key:'c0',occupancy:41.4}],retries:0,pendingRetry:{at:0,remaining:3,keys:['c0']}};f.elapse(200000);
  const inspect=f.inspect;f.inspect=async()=>({...await inspect(),...delta});
  await assert.rejects(optimizeUvCandidates(f),/SEG_UV_RETRY_UNCERTAIN/);assert.equal(f.retries(),0);
 }
});

test('two late confirmed results reconcile one outstanding intent and only use the last remaining free retry',async()=>{
 let time=500000,count=3,selected=2,pending=0,clicks=0;const values=[68.1,70.2,62.6,69.9];
 const receipt={taskId:'asset',uvSelection:{version:1,retries:0,samples:[{key:'c0',occupancy:68.1}],pendingRetry:{at:1000,remaining:3,keys:['c0']},retryRecovery:{originalAt:1,at:1000,remaining:3,keys:['c0']},retryRecoveryCount:1}};
 const f={receipt,now:()=>time,pause:async ms=>{time+=ms;},persist:async()=>{},inspect:async()=>{
  if(pending&&time>=pending){count=4;selected=3;pending=0;}
  return {taskId:'asset',pending:true,busy:!!pending,blockingDialog:false,remaining:4-count,retryEnabled:!pending,selectedKey:'c'+selected,occupancy:values[selected],candidates:Array.from({length:count},(_,i)=>({key:'c'+i}))};
 },act:async a=>{
  if(a.action==='select'){selected=Number(a.key.slice(1));return;}
  assert.equal(a.action,'retry');assert.equal(a.expectedRemaining,1);assert.equal(receipt.uvSelection.retries,2);assert.equal(receipt.uvSelection.pendingRetry.remaining,1);clicks++;pending=time+3000;
 }};
 assert.equal(await optimizeUvCandidates(f),true);assert.equal(clicks,1);assert.equal(receipt.uvSelection.retries,3);
 assert.equal(receipt.uvSelection.samples.length,4);assert.equal(receipt.uvSelection.selected.key,'c1');assert.equal(receipt.uvSelection.selected.occupancy,70.2);
});

test('a multi-result recovery requires every old key and an exact counter delta before confirming anything',async()=>{
 for(const [keys,remaining] of [[['c0','c1','c2'],2],[['c1','c2','c3'],1],[['c0','c1','c1'],1]]){
  const f=fixture();f.elapse(200000);f.receipt.uvSelection={version:1,retries:0,samples:[{key:'c0',occupancy:41.4}],pendingRetry:{at:0,remaining:3,keys:['c0']}};
  const read=f.inspect;f.inspect=async()=>({...await read(),remaining,candidates:keys.map(key=>({key})),selectedKey:keys[0]});
  await assert.rejects(optimizeUvCandidates(f),/SEG_UV_RETRY_UNCERTAIN/);assert.equal(f.retries(),0);assert.equal(f.receipt.uvSelection.retries,0);
 }
});

test('a transient generation dialog during our free retry waits and resumes without another click',async()=>{
 const f=fixture(),read=f.inspect;
 f.inspect=async()=>{const state=await read();return {...state,blockingDialog:state.busy};};
 assert.equal(await optimizeUvCandidates(f),true);assert.equal(f.retries(),3);assert.equal(f.receipt.uvSelection.samples.length,4);
});

test('an unrelated dialog is never dismissed, and a stuck retry dialog yields then stops within its deadline',async()=>{
 const f=fixture(),read=f.inspect;f.inspect=async()=>({...await read(),blockingDialog:true});
 await assert.rejects(optimizeUvCandidates(f),/CLOSE_OTHER_DIALOGS_FIRST/);assert.equal(f.retries(),0);
 const stuck=fixture({stuck:true}),original=stuck.inspect;stuck.inspect=async()=>{const state=await original();return {...state,blockingDialog:state.busy};};
 assert.equal(await optimizeUvCandidates(stuck),false);assert.equal(stuck.retries(),1);stuck.elapse(200000);
 await assert.rejects(optimizeUvCandidates(stuck),/CLOSE_OTHER_DIALOGS_FIRST/);assert.equal(stuck.retries(),1);
});
test('temporarily unreadable candidates wait within a bounded observation window without clicks',async()=>{
 for(const invalid of [{occupancy:null},{remaining:null},{selectedKey:null},{taskId:'wrong'}]){
  const f=fixture(),read=f.inspect;f.inspect=async()=>({...await read(),...invalid});
  if(invalid.taskId)await assert.rejects(optimizeUvCandidates(f),/TASK_CHANGED/);
  else {assert.equal(await optimizeUvCandidates(f),false);assert.ok(f.receipt.uvSelection.waiting);f.elapse(180000);await assert.rejects(optimizeUvCandidates(f),/NOT_READY/);}
  assert.equal(f.retries(),0);
 }
});

test('a result selector hydrating across command slices resumes the existing best UV without any click',async()=>{
 let time=1000;
 const receipt={taskId:'asset',uvSelection:{version:1,samples:[{key:'first',occupancy:68.9},{key:'best',occupancy:69.6},{key:'third',occupancy:69.1},{key:'fourth',occupancy:69.4}],retries:3,pendingRetry:null,complete:false}};
 const f={receipt,now:()=>time,pause:async ms=>{time+=ms;},persist:async()=>{},act:async()=>assert.fail('best is already selected; no retry/selection is needed'),inspect:async()=>({taskId:'asset',pending:true,busy:false,blockingDialog:false,remaining:0,retryEnabled:false,selectedKey:time<80000?null:'best',occupancy:69.6,candidates:['first','best','third','fourth'].map(key=>({key}))})};
 assert.equal(await optimizeUvCandidates(f),false);
 assert.equal(receipt.uvSelection.waiting.since,1000);
 assert.equal(await optimizeUvCandidates(f),true);
 assert.equal(receipt.uvSelection.selected.key,'best');
 assert.equal(receipt.uvSelection.samples.length,4);
 assert.equal(receipt.uvSelection.retries,3);
 assert.equal(receipt.uvSelection.waiting,undefined);
});

test('unreadable UV readiness has a durable deadline across reload and changing wait reasons',async()=>{
 let time=1000,reads=0;
 const receipt={taskId:'asset'};
 const f={receipt,now:()=>time,pause:async ms=>{time+=ms;},persist:async()=>{},act:async()=>assert.fail('unreadable results authorize no action'),inspect:async()=>({taskId:'asset',pending:++reads%2===0,busy:false,blockingDialog:false,remaining:null,retryEnabled:false,selectedKey:null,occupancy:null,candidates:[]})};
 for(let i=0;i<3;i++){
  assert.equal(await optimizeUvCandidates(f),false);
  f.receipt=JSON.parse(JSON.stringify(f.receipt)); // serialized extension receipt
  assert.equal(f.receipt.uvSelection.waiting.since,1000);
 }
 await assert.rejects(optimizeUvCandidates(f),/SEG_UV_SELECTION_NOT_READY/);
 assert.ok(time>=181000&&time<182000);
 assert.equal(f.receipt.uvSelection.retries,0);
});

test('late occupancy and thumbnail hydration recover before the first free retry',async()=>{
 const f=fixture(),read=f.inspect;let reads=0;
 f.inspect=async()=>{const s=await read();return ++reads<12?{...s,occupancy:null,candidates:[],selectedKey:null}:s;};
 assert.equal(await optimizeUvCandidates(f),true);assert.equal(f.retries(),3);assert.equal(f.selected(),1);
});

test('an Assets view is switched to Properties once before measuring, without a paid click',async()=>{
 const f=fixture(),read=f.inspect,act=f.act;let opened=false,viewClicks=0;
 f.inspect=async()=>{const s=await read();return opened?s:{...s,candidates:[],selectedKey:null,occupancy:null,properties:{available:true,active:false}};};
 f.act=async a=>{if(a.action==='show-properties'){opened=true;viewClicks++;}else await act(a);};
 assert.equal(await optimizeUvCandidates(f),true);assert.equal(viewClicks,1);assert.equal(f.retries(),3);
});

test('transient missing Save during a result rerender waits instead of abandoning paid UVs',async()=>{
 const f=fixture(),read=f.inspect;let reads=0;
 f.inspect=async()=>{const s=await read();return ++reads<8?{...s,pending:false}:s;};
 assert.equal(await optimizeUvCandidates(f),true);assert.equal(f.retries(),3);
});

test('Property hidden after a persisted retry is restored before an expired retry is classified as uncertain',async()=>{
 const f=fixture({lost:true});await assert.rejects(optimizeUvCandidates(f),/reply lost/);f.elapse(300000);
 const read=f.inspect,act=f.act;let opened=false,opens=0;
 f.inspect=async()=>{const s=await read();return opened?s:{...s,candidates:[],selectedKey:null,occupancy:null,properties:{available:true,active:false}};};
 f.act=async a=>{if(a.action==='show-properties'){opened=true;opens++;}else await act(a);};
 assert.equal(await optimizeUvCandidates(f),true);assert.equal(opens,1);assert.equal(f.retries(),3);
 assert.equal(f.receipt.uvSelection.samples.length,4);
});

test('live Studio can report Property inactive while UV candidates are readable; do not toggle that unrelated tab',async()=>{
 const f=fixture(),read=f.inspect,act=f.act;
 f.inspect=async()=>({...await read(),properties:{available:true,active:false}});
 f.act=async a=>{assert.notEqual(a.action,'show-properties');await act(a);};
 assert.equal(await optimizeUvCandidates(f),true);assert.equal(f.retries(),3);
 assert.equal(f.receipt.uvSelection.selected.occupancy,76.8);
});
test('ties retain the first measured best and exhausted retries do not trigger paid generation',async()=>{
 const f=fixture({values:[76.8,76.8,63,70]});assert.equal(await optimizeUvCandidates(f),true);assert.equal(f.selected(),0);assert.equal(f.retries(),3);
});
test('retry adapter only clicks the exact free trace and exact remaining count',()=>{
 const id='11111111-2222-3333-4444-555555555555';let clicks=0;
 const b=(label,trace)=>({innerText:label,disabled:false,getAttribute:k=>k==='data-trace'?trace:null,getBoundingClientRect:()=>({width:40,height:30}),click:()=>clicks++});
 const save=b('Guardar','studio.workspace_smart-uv.asset_save_button');let retry=b('Reintento gratis (×3)','studio.workspace_smart-uv.free_retry_button');
 const ctx={location:{origin:'https://studio.tripo3d.ai',pathname:'/es/workspace/smart-uv/'+id},getComputedStyle:()=>({}),document:{querySelectorAll:q=>q==='button,[role="button"]'?[save,retry]:[]}};
 const run=(extra={})=>throwAdapterError(vm.runInNewContext(`(${studioUvCandidatesControl})(${JSON.stringify({taskId:id,action:'retry',expectedRemaining:3,...extra})})`,ctx));
 assert.equal(run().clicked,true);assert.equal(clicks,1);
 for(const label of ['Reintento 20','Retry 20','Desplegar UV 20','Reintento gratis (×2)','Reintento gratis (×0)']){
  retry.innerText=label;assert.throws(()=>run(),/UNVERIFIED/);
 }
 retry=b('Reintento gratis (×3)','studio.workspace_smart-uv.generate_uv_button');assert.throws(()=>run(),/UNVERIFIED/);
 assert.equal(clicks,1);
 retry=b('Reintentar 10','studio.workspace_smart-uv.free_retry_button');
 const exhausted=run({action:null});assert.equal(exhausted.remaining,0);assert.equal(exhausted.retryEnabled,false);
 assert.throws(()=>run(),/UNVERIFIED/);assert.equal(clicks,1);
});

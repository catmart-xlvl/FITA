import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverUvResultView} from '../extension-tripo-studio/uv-result-recovery.js';
const taskId='11111111-2222-3333-4444-555555555555';
function fixture(){
 let time=100000,refreshes=0;const receipt={taskId,step:'smartUV',clicked:true,processingObserved:true,credits:20};
 const state={taskId,pending:false,busy:false,generateEnabled:true,blockingDialog:false};
 const f={receipt,state,bridge:{tabId:9},now:()=>time,pause:async ms=>{time+=ms;},read:async()=>({taskId,workflow:'smart-uv',unsavedChanges:false}),inspect:async()=>({...state,pending:refreshes>0}),getTab:async()=>({url:'https://studio.tripo3d.ai/workspace/smart-uv/model-'+taskId}),persist:async()=>{},reload:async id=>{assert.equal(id,9);assert.equal(receipt.uvViewRecovery.refreshes,1);refreshes++;},elapse:ms=>{time+=ms;},refreshes:()=>refreshes};
 return f;
}
test('a stale paid UV view gets one persisted refresh after a grace period and recovers its existing result',async()=>{
 const f=fixture();assert.equal((await recoverUvResultView(f)).pending,false);assert.equal(f.refreshes(),0);
 f.elapse(30000);assert.equal((await recoverUvResultView(f)).pending,true);assert.equal(f.refreshes(),1);assert.equal(f.receipt.credits,20);assert.equal(f.receipt.clicked,true);
});
test('fresh results, active processing, dialogs and unsaved edits prevent automatic reload',async()=>{
 for(const condition of ['result','busy','dialog','unsaved']){
  const f=fixture();await recoverUvResultView(f);f.elapse(30000);
  if(condition==='result'||condition==='busy'){f.inspect=async()=>({...f.state,pending:condition==='result',busy:condition==='busy'});assert.ok(await recoverUvResultView(f));}
  if(condition==='dialog'){f.inspect=async()=>({...f.state,blockingDialog:true});await assert.rejects(recoverUvResultView(f),/CLOSE_OTHER_DIALOGS_FIRST/);}
  if(condition==='unsaved'){f.read=async()=>({taskId,workflow:'smart-uv',unsavedChanges:true});await assert.rejects(recoverUvResultView(f),/SEG_UNSAVED_CHANGES/);}
  assert.equal(f.refreshes(),0);
 }
});
test('a lost refresh acknowledgement stays recorded across recovery and cannot repeat or submit a job',async()=>{
 const f=fixture();await recoverUvResultView(f);f.elapse(30000);let calls=0;
 f.reload=async()=>{calls++;throw Error('reply lost');};await assert.rejects(recoverUvResultView(f),/reply lost/);
 assert.equal(f.receipt.uvViewRecovery.refreshes,1);await recoverUvResultView(f);f.elapse(30000);
 await assert.rejects(recoverUvResultView(f),/SEG_UV_RESULT_NOT_FOUND/);assert.equal(calls,1);
});
test('an empty refreshed result stops with a specific result error rather than another payment or reload',async()=>{
 const f=fixture();f.inspect=async()=>({...f.state});await recoverUvResultView(f);f.elapse(30000);
 await assert.rejects(recoverUvResultView(f),/SEG_UV_RESULT_NOT_FOUND/);await assert.rejects(recoverUvResultView(f),/SEG_UV_RESULT_NOT_FOUND/);assert.equal(f.refreshes(),1);
});

test('new processing restarts the idle grace period and a naturally arriving unsaved result is preserved',async()=>{
 const f=fixture();await recoverUvResultView(f);f.elapse(30000);let busy=true;const inspect=f.inspect;
 f.inspect=async()=>busy?{...f.state,busy:true}:inspect();
 assert.equal((await recoverUvResultView(f)).busy,true);busy=false;f.elapse(1000);
 await recoverUvResultView(f);assert.equal(f.refreshes(),0);f.elapse(30000);
 assert.equal((await recoverUvResultView(f)).pending,true);assert.equal(f.refreshes(),1);
 const arriving=fixture();await recoverUvResultView(arriving);arriving.elapse(30000);
 arriving.read=async()=>({taskId,workflow:'smart-uv',unsavedChanges:true});arriving.inspect=async()=>({...arriving.state,pending:true});
 assert.equal((await recoverUvResultView(arriving)).pending,true);assert.equal(arriving.refreshes(),0);
});
test('foreign tabs, another task, prior selection or Save, and unrecorded paid attempts are never refreshed',async()=>{
 for(const condition of ['foreign','task','selection','save','unclicked']){
  const f=fixture();await recoverUvResultView(f);f.elapse(30000);
  if(condition==='foreign')f.getTab=async()=>({url:'https://example.com/workspace/smart-uv/'+taskId});
  if(condition==='task')f.read=async()=>({taskId:'other',workflow:'smart-uv',unsavedChanges:false});
  if(condition==='selection')f.receipt.uvSelection={samples:[{key:'original'}]};
  if(condition==='save')f.receipt.saveAttempted=true;
  if(condition==='unclicked')f.receipt.clicked=false;
  await assert.rejects(recoverUvResultView(f),/CONFIRMED_TASK_CHANGED|SEG_UV_SAVE_NOT_VERIFIED/);assert.equal(f.refreshes(),0);
 }
});

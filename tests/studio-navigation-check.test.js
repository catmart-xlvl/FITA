import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNavigationRecovery,checkTabLifecycle,isNavigationCheckCall,isExportPreparationCall} from '../extension-tripo-studio/navigation-check.js';
const taskId='11111111-2222-4333-8444-555555555555';
test('FBX preparation diagnostic can select Blender but cannot download or run in MAIN',()=>{
 const call=(step,world)=>isExportPreparationCall({name:'exportStudioControl'},[{step,format:'FBX'}],world);
 assert.equal(call('blender-preset'),true);assert.equal(call('download'),false);assert.equal(call('open','MAIN'),false);
 assert.equal(isExportPreparationCall({name:'clickStudioGenerate'}),false);
});
test('reload and close/reopen use the same task and monitor, restore the initial view and never submit',async()=>{
 const state={taskId,workflow:'texture'},actions=[];
 const result=await checkTabLifecycle({observe:async()=>({...state}),navigate:async(id,workflow)=>{assert.equal(id,taskId);state.workflow=workflow;},monitor:async id=>{assert.equal(id,taskId);state.workflow='generate';return {stage:'ready'};},reload:async()=>actions.push('reload'),reopen:async()=>actions.push('reopen')});
 assert.equal(result.lifecycleCheck.passed,true);assert.equal(result.lifecycleCheck.restoredInitialView,true);assert.deepEqual(actions,['reload','reopen']);assert.equal(result.lifecycleCheck.paidActions,0);
});
test('lifecycle diagnostics preserve unsaved changes without even reloading',async()=>{
 const result=await checkTabLifecycle({observe:async()=>({taskId,workflow:'texture',unsavedChanges:true}),reload:()=>assert.fail('reload')});assert.equal(result.lifecycleCheck.passed,false);assert.equal(result.lifecycleCheck.steps.length,0);
});
test('lifecycle waits for the model to mount after each document change, with a bounded free monitor',async()=>{
 const state={taskId,workflow:'texture'};let pending=0,waits=0;
 const result=await checkTabLifecycle({observe:async()=>({...state}),navigate:async(_,workflow)=>{state.workflow=workflow;},reload:async()=>{pending=2;},reopen:async()=>{pending=3;},monitor:async()=>{state.workflow='generate';return {stage:pending-->0?'processing':'ready'};},pause:async()=>{waits++;}});
 assert.equal(result.lifecycleCheck.passed,true);assert.equal(waits,5);assert.equal(result.lifecycleCheck.steps.length,2);
});
test('diagnostic execution guard blocks paid actions, uploads, exports and main-world injection',()=>{
 const call=(name,arg,world)=>isNavigationCheckCall({name},arg?[arg]:[],world);
 for(const name of ['clickStudioGenerate','uploadStudioView','studioGroupControl','studioRigControl','captureStudioExport'])assert.equal(call(name,{action:'submit'}),false);
 assert.equal(call('exportStudioControl',{step:'download'}),false);
 assert.equal(call('exportStudioControl',{step:'inspect'}),true);
 assert.equal(call('studioNavigationControl',{action:'select-tool'}),true);
 assert.equal(call('observeStudioDocument',null,'MAIN'),false);
});
function harness({initial={},recover=true,processing=false,failRestore=false}={}){
 const state={taskId,workflow:'texture',unsavedChanges:false,importBusy:false,importFileCount:0,...initial},calls=[];
 let monitored=0;
 const run=()=>checkNavigationRecovery({observe:async()=>({...state}),navigate:async(id,workflow)=>{assert.equal(id,taskId);calls.push({navigate:workflow});if(failRestore&&monitored&&workflow==='texture')throw Error('STUDIO_ORIGIN_CHANGED');state.workflow=workflow;},monitor:async(id)=>{assert.equal(id,taskId);calls.push({monitor:true});monitored++;if(recover)state.workflow='generate';return {stage:processing?'processing':'ready'};},pause:async()=>{}});
 return {run,state,calls};
}
test('free diagnostic exercises the real monitor contract after each tool change and restores the original tool',async()=>{
 const h=harness(),{navigationCheck:r}=await h.run();assert.equal(r.passed,true);assert.equal(r.restoredInitialView,true);
 assert.deepEqual(r.steps.map(s=>s.enteredWorkflow),['generate','texture','smart-uv','rigging']);assert(r.steps.every(s=>s.recoveredWorkflow==='generate'&&s.taskId===taskId&&s.passed));
 assert.equal(r.paidActions,0);assert.equal(r.recoveryButtonClicks,0);assert.equal(h.calls.filter(c=>c.monitor).length,4);assert.equal(h.state.workflow,'texture');
});
test('diagnostic preserves unsaved edits and uploads instead of navigating away',async()=>{
 for(const initial of [{unsavedChanges:true},{importBusy:true},{importFileCount:1}]){const h=harness({initial}),r=(await h.run()).navigationCheck;assert.equal(r.passed,false);assert(r.error);assert.equal(h.calls.length,0);}
});
test('a ready reply on the wrong tool cannot pass, and the original view is restored',async()=>{
 const h=harness({recover:false}),r=(await h.run()).navigationCheck;assert.equal(r.passed,false);assert.equal(r.error,'STUDIO_NAVIGATION_CHECK_NOT_READY');assert.equal(r.steps.at(-1).passed,false);assert.equal(r.restoredInitialView,true);
});
test('a result that stays processing has a bounded check and never submits another operation',async()=>{
 const h=harness({processing:true}),r=(await h.run()).navigationCheck;assert.equal(r.passed,false);assert.equal(h.calls.filter(c=>c.monitor).length,150,'bounded: 150 attempts or 75 s of real time');assert.equal(r.steps.length,1);assert.equal(r.paidActions,0);
});
test('losing the selected tab during restore cannot be reported as a successful check',async()=>{
 const h=harness({failRestore:true}),r=(await h.run()).navigationCheck;assert.equal(r.passed,false);assert.equal(r.restoreError,'STUDIO_ORIGIN_CHANGED');
});

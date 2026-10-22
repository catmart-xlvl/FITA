import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateBatchFor,candidateRecoveryStep,batchHasFailedCandidates} from '../shared/studio-candidate-recovery.js';

const batch=()=>({id:'paid-once',type:'submit',status:'succeeded',candidates:[0,1,2,3].map(i=>({taskId:'task-'+i,...(i===0?{modelId:'saved-0'}:{})}))});
test('one saved candidate and no provider failures resumes the existing batch through all remaining downloads',()=>{
 const submission=batch(),operations=[submission],adapter={generationFailureVersion:1},retried=new Set();
 let operation={id:'lost-monitor',type:'monitor',status:'failed',taskId:'task-1',sourceOperationId:submission.id};
 let step=candidateRecoveryStep(operation,operations,adapter,retried);
 assert.equal(step.route,'/verify-candidates');retried.add(step.retryKey);
 operation={id:'verified',type:'observe',status:'succeeded',verificationFor:submission.id,sourceOperationId:submission.id,result:{stage:'observed',candidateFailures:[],reason:'STUDIO_RESULTS_NOT_VERIFIED'}};
 step=candidateRecoveryStep(operation,operations,adapter,retried);
 assert.deepEqual(step,{route:'/monitor',body:{operationId:submission.id}});
 for(let index=1;index<4;index++){
  operation={id:'monitor-'+index,type:'monitor',status:'succeeded',sourceOperationId:submission.id,taskId:'task-'+index,candidateIndex:index,result:{stage:'ready'}};
  assert.deepEqual(candidateRecoveryStep(operation,operations,adapter,retried),{route:'/export',body:{operationId:operation.id}});
  submission.candidates[index].modelId='saved-'+index;
  submission.generationComplete=index===3;
  operation={id:'export-'+index,type:'export',status:'succeeded',sourceOperationId:submission.id,importedModelId:'saved-'+index};
  assert.deepEqual(candidateRecoveryStep(operation,operations,adapter,retried),index===3?null:{route:'/monitor',body:{operationId:submission.id}});
 }
 assert.equal(candidateBatchFor(operation,operations),null);
 assert.equal(submission.candidates[0].modelId,'saved-0');
});
test('persistent blockers get one automatic recovery per candidate; a manual retry can reset the budget',()=>{
 const submission=batch(),op={id:'m',type:'monitor',status:'failed',sourceOperationId:submission.id,taskId:'task-1'},retried=new Set(),adapter={generationFailureVersion:1};
 const step=candidateRecoveryStep(op,[submission],adapter,retried);retried.add(step.retryKey);
 assert.equal(candidateRecoveryStep({...op,id:'m2'},[submission],adapter,retried),null);
 assert.equal(candidateRecoveryStep({...op,taskId:'task-2'},[submission],adapter,retried).route,'/verify-candidates');
 retried.clear();assert.equal(candidateRecoveryStep(op,[submission],adapter,retried).route,'/verify-candidates');
});
test('closed, complete and unrelated batches cannot trigger another generation or recovery',()=>{
 const submission=batch(),op={id:'check',type:'observe',status:'succeeded',verificationFor:submission.id,result:{candidateFailures:[]}};
 assert.equal(candidateRecoveryStep(op,[]),null);
 submission.trackingClosedAt='closed';assert.equal(candidateRecoveryStep(op,[submission]),null);
 delete submission.trackingClosedAt;submission.generationComplete=true;
 assert.deepEqual(candidateRecoveryStep(op,[submission]),{refreshId:submission.id});
 assert.equal(candidateRecoveryStep({...op,type:'submit',status:'unknown'},[]),null);
});
test('rechecking an already downloaded candidate never schedules another export',()=>{
 const submission=batch(),operation={id:'check-saved',type:'monitor',status:'succeeded',taskId:'task-0',candidateIndex:0,sourceOperationId:submission.id,result:{stage:'ready'}};
 assert.deepEqual(candidateRecoveryStep(operation,[submission]),{route:'/monitor',body:{operationId:submission.id}});
 submission.generationComplete=true;
 assert.deepEqual(candidateRecoveryStep(operation,[submission]),{refreshId:submission.id});
});
test('a legacy failure marker without failed candidates cannot advertise another paid generation',()=>{
 const submission=batch();submission.generationFailuresVerifiedAt='old-marker';
 assert.equal(batchHasFailedCandidates(submission),false);
 submission.candidates[1]={status:'failed',failureSource:'studio-observed'};
 assert.equal(batchHasFailedCandidates(submission),true);
 submission.candidates[1].modelId='recovered-file';assert.equal(batchHasFailedCandidates(submission),false);
});

test('a completed export command with no returned artifact gets one free recovery of its existing candidate',()=>{
 const submission=batch(),operations=[submission],retried=new Set(),adapter={generationFailureVersion:1};
 for(const sourceFormat of ['GLB','FBX']){
  const operation={id:'export-'+sourceFormat,type:'export',status:'succeeded',sourceFormat,sourceOperationId:submission.id,taskId:'task-1',importError:'STUDIO_EXPORT_NOT_RETURNED',result:{stage:'requires_manual_import',reason:'EXPORT_CAPTURE_TIMEOUT'}};
  const step=candidateRecoveryStep(operation,operations,adapter,retried);
  assert.equal(step.route,'/monitor');assert.equal(step.body.operationId,submission.id);
  retried.add(step.retryKey);assert.equal(candidateRecoveryStep(operation,operations,adapter,retried),null);retried.clear();
  assert.equal(candidateRecoveryStep({...operation,importError:'FBX_ZIP_MULTIPLE_MODELS'},operations,adapter,retried),null);
  assert.equal(candidateRecoveryStep({...operation,taskId:'another-task'},operations,adapter,retried),null);
  assert.deepEqual(candidateRecoveryStep({...operation,importedModelId:'already-saved'},operations,adapter,retried),{route:'/monitor',body:{operationId:submission.id}});
 }
});

test('a local dialog blocker resumes the confirmed batch without reopening provider notification history',()=>{
 const submission=batch(),op={id:'blocked',type:'monitor',status:'failed',sourceOperationId:submission.id,taskId:'task-1',error:'CLOSE_OTHER_DIALOGS_FIRST'},retried=new Set();
 const step=candidateRecoveryStep(op,[submission],{generationFailureVersion:1},retried);
 assert.equal(step.route,'/monitor');assert.equal(step.body.operationId,submission.id);
 retried.add(step.retryKey);assert.equal(candidateRecoveryStep(op,[submission],{generationFailureVersion:1},retried),null);
 assert.equal(submission.candidates[0].modelId,'saved-0');
});

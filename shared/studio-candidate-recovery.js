// Free recovery only. This state machine never quotes or submits a generation.
export function candidateBatchFor(operation,operations=[]){
 const id=operation?.verificationFor||operation?.sourceOperationId;
 const batch=operation?.type==='submit'?operation:operations.find(r=>r.id===id);
 return batch?.type==='submit'&&!batch.trackingClosedAt&&!batch.generationComplete&&batch.candidates?.some(c=>!c.modelId&&!c.failureSource)?batch:null;
}
export function batchHasFailedCandidates(batch){
 return !!(batch?.partialBatchAcceptedAt||batch?.generationFailuresVerifiedAt)&&batch.candidates?.some(c=>!c.modelId&&c.status==='failed'&&['studio-observed','user-confirmed-studio'].includes(c.failureSource))===true;
}
export function candidateRecoveryStep(operation,operations=[],adapter={},retried=new Set()){
 if(!operation)return null;
 const post=(route,operationId,extra={})=>({route,body:{operationId,...extra}});
 const batch=operations.find(r=>r.id===(operation.verificationFor||operation.sourceOperationId));
 const incompleteExport=operation.type==='export'&&!operation.importedModelId&&operation.importError==='STUDIO_EXPORT_NOT_RETURNED'&&operation.result?.stage==='requires_manual_import';
 if((['failed','unknown'].includes(operation.status)||incompleteExport)&&['monitor','export'].includes(operation.type)){
  const retryKey=operation.sourceOperationId+':'+operation.taskId;
  const owner=candidateBatchFor(operation,operations),candidate=owner?.candidates?.find(c=>c.taskId===operation.taskId);
  if(!owner||!candidate||retried.has(retryKey))return null;
  if(candidate.modelId||candidate.failureSource)return post('/monitor',owner.id);
  // A missing file or a local dialog is not provider generation-failure evidence.
  // Rebuild the exact candidate context and resume its free export directly.
  const localRecovery=incompleteExport||operation.error==='CLOSE_OTHER_DIALOGS_FIRST';
  const step=!localRecovery&&adapter.generationFailureVersion===1?post('/verify-candidates',operation.sourceOperationId):post('/monitor',operation.sourceOperationId);
  return {...step,retryKey};
 }
 if(operation.status!=='succeeded')return null;
 if(operation.type==='monitor'&&batch?.candidates?.some(c=>c.taskId===operation.taskId&&c.modelId))return batch.generationComplete?{refreshId:batch.id}:post('/monitor',batch.id);
 if(operation.verificationFor){
  if(batch?.generationComplete)return {refreshId:batch.id};
  // No failure notice does not imply failure or completion. Continue checking
  // the exact confirmed candidates and download those that are ready.
  return candidateBatchFor(operation,operations)?post('/monitor',batch.id):null;
 }
 if(operation.type==='submit'&&!operation.candidates&&adapter.automaticCandidatesVersion===1)return post('/discover-candidates',operation.id);
 if(operation.discoveryFor&&operation.result?.stage==='candidates-found')return {refreshId:operation.discoveryFor};
 if(operation.discoveryFor&&operation.result?.stage==='discovering')return post('/discover-candidates',operation.discoveryFor);
 if(operation.type==='submit'&&operation.candidates?.length===4&&!operation.generationComplete)return post('/monitor',operation.id);
 if(operation.type==='monitor'&&operation.result?.candidateFailures?.length)return batch?.generationComplete?{refreshId:batch.id}:candidateBatchFor(operation,operations)?post('/monitor',batch.id):null;
 if(operation.type==='monitor'&&operation.result?.stage==='processing')return post('/monitor',operation.sourceOperationId,{taskId:operation.taskId});
 if(operation.type==='monitor'&&operation.result?.stage==='ready'&&Number.isInteger(operation.candidateIndex))return post('/export',operation.id);
 if(operation.type==='export'&&operation.importedModelId){
  if(batch?.generationFailuresVerifiedAt)return {refreshId:batch.id};
  if(candidateBatchFor(operation,operations))return post('/monitor',batch.id);
 }
 return null;
}

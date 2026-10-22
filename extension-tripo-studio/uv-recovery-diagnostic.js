// Read-only projection of the current asset's durable UV receipt. Never include
// unrelated storage, bridge credentials, model bytes or download URLs.
export function uvRecoveryDiagnostic(saved,taskId){
 const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
 if(!uuid.test(taskId||''))return [];
 return Object.entries(saved||{}).filter(([key,r])=>key.startsWith('workbenchGroupOperation:')&&uuid.test(key.slice('workbenchGroupOperation:'.length))&&r?.step==='smartUV'&&r.taskId===taskId).map(([key,r])=>({
  operationId:key.slice('workbenchGroupOperation:'.length),taskId,
  status:r.status??null,clicked:r.clicked===true,credits:r.credits??null,
  processingObserved:r.processingObserved===true,uvSaved:r.uvSaved===true,
  saveAttempted:r.saveAttempted===true,saveAttempts:r.saveAttempts||0,
  uvViewRecovery:r.uvViewRecovery?{emptySince:r.uvViewRecovery.emptySince,refreshes:r.uvViewRecovery.refreshes,refreshedAt:r.uvViewRecovery.refreshedAt}:null,
  uvSelection:r.uvSelection?{
   version:r.uvSelection.version,complete:r.uvSelection.complete===true,retries:r.uvSelection.retries||0,retryRecoveryCount:r.uvSelection.retryRecoveryCount||0,
   retryRecovery:r.uvSelection.retryRecovery?{originalAt:r.uvSelection.retryRecovery.originalAt,at:r.uvSelection.retryRecovery.at,remaining:r.uvSelection.retryRecovery.remaining,keys:r.uvSelection.retryRecovery.keys}:null,
   retryRecoveries:(r.uvSelection.retryRecoveries||[]).map(r=>({originalAt:r.originalAt,at:r.at,remaining:r.remaining,keys:r.keys})),
   samples:(r.uvSelection.samples||[]).map(s=>({key:s.key,occupancy:s.occupancy})),
   selected:r.uvSelection.selected?{key:r.uvSelection.selected.key,occupancy:r.uvSelection.selected.occupancy}:null,
   pendingRetry:r.uvSelection.pendingRetry?{at:r.uvSelection.pendingRetry.at,remaining:r.uvSelection.pendingRetry.remaining,keys:r.uvSelection.pendingRetry.keys}:null,
   waiting:r.uvSelection.waiting?{reason:r.uvSelection.waiting.reason,at:r.uvSelection.waiting.at,since:r.uvSelection.waiting.since??r.uvSelection.waiting.at}:null
  }:null
 }));
}

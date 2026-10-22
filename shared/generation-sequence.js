// Downloaded geometry is required. Missing candidates are terminal only after
// an explicit review of provider failures; a lost connection is not evidence.
export function headCandidatesAvailable(project){
 const models=(project.models||[]).filter(m=>m.group==='head'&&!m.obsolete&&m.current!==false);
 const batches=(project.studioOperations||[]).filter(o=>o.group==='head'&&o.type==='submit'&&o.candidates?.length===4);
 if(batches.length){const batch=batches.at(-1),saved=c=>c.modelId&&models.some(m=>m.id===c.modelId);return batch.candidates.every(saved)||!!(batch.partialBatchAcceptedAt||batch.generationFailuresVerifiedAt)&&batch.generationComplete===true&&batch.candidates.some(saved)&&batch.candidates.every(c=>saved(c)||c.status==='failed'&&['studio-observed','user-confirmed-studio'].includes(c.failureSource));}
 return models.some(m=>m.id===project.groups?.head?.selectedModelId);
}
export function generationSequenceBlocker(project,group){
 if(group==='body'&&!headCandidatesAvailable(project))return 'STUDIO_HEAD_FIRST';
 if((project.studioOperations||[]).some(o=>o.type==='submit'&&!o.trackingClosedAt&&!o.generationComplete&&!['failed','abandoned'].includes(o.status)&&o.candidates?.some(c=>!c.modelId)!==false))return 'STUDIO_GENERATION_ALREADY_TRACKED';
 return null;
}
export function studioDisplayOperation(operations,group){
 const latest=(operations||[]).filter(o=>o.group===group).at(-1)||null;
 const closed=(operations||[]).find(o=>o.id===latest?.sourceOperationId&&(o.partialBatchAcceptedAt||o.generationFailuresVerifiedAt));
 return closed||latest;
}

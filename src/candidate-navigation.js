export const localPreviewModels=p=>(p?.models||[]).filter(m=>m.current&&typeof m.url==='string'&&/^\/(?!\/)|^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(m.url)&&/\.glb(?:[?#]|$)/i.test(m.url));
export function candidatePreviewId(p,id){
 const models=localPreviewModels(p);if(models.some(m=>m.id===id))return id;
 for(const group of ['head','body']){const chosen=p?.groups?.[group]?.selectedModelId;if(models.some(m=>m.id===chosen))return chosen;}
 return models[0]?.id||'';
}
export function candidateSelectionEditable(p){
 return (p?.workflowStage||0)<=2||p.workflowStage===3&&!p.segmentations?.length&&!p.textureOperations?.length&&!p.textures?.length&&!p.segmentationDeliveryId&&!p.segmentationBaseline;
}
export function candidateBatches(p,group){
 const models=p.models.filter(m=>m.group===group),submissions=(p.studioOperations||[]).filter(o=>o.type==='submit'&&o.group===group&&(o.candidates?.length||models.some(m=>m.studioSubmissionId===o.id)));
 const ids=[...new Set([...submissions.map(o=>o.id),...models.map(m=>m.studioSubmissionId).filter(Boolean)])];
 const batches=ids.map((id,i)=>({id,number:i+1,rows:[0,1,2,3].map(index=>{
  const candidate=submissions.find(o=>o.id===id)?.candidates?.find(c=>c.index===index),matches=models.filter(m=>m.studioSubmissionId===id&&(m.candidateIndex===index||m.id===candidate?.modelId));
  const model=matches.find(m=>m.current&&m.id===candidate?.modelId)||matches.find(m=>m.current)||matches[0];
  return {key:id+':'+index,number:index+1,model,candidate};
 })}));
 const imports=models.filter(m=>!m.studioSubmissionId);if(imports.length)batches.push({id:'local',number:batches.length+1,rows:imports.map((model,i)=>({key:model.id,number:Number.isInteger(model.candidateIndex)?model.candidateIndex+1:i+1,model}))});return batches;
}

// Only the current plan's durable download receipts count as generated output.
export function textureProgress(project){
 const plan=project?.segmentTexturePlan;
 if(!plan||plan.status==='completed')return null;
 const runs=(project.segmentTextureRuns||[]).filter(r=>r.planId===plan.id);
 const complete=['head','body'].every(part=>runs.some(r=>r.part===part&&r.status==='completed'&&r.operations?.some(o=>o.step==='download')&&r.operations.filter(o=>o.step==='download').every(o=>o.status==='completed'&&o.downloadAsset)));
 if(!complete)return {title:'previewPendingTitle',message:'previewPending'};
 return {title:plan.status==='attention'?'finishingInterruptedTitle':'generationReadyTitle',message:plan.status==='attention'?'finishingInterrupted':plan.status==='finishing'?'finishingTransferred':'generationReady'};
}

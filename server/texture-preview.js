import {currentPlan} from './segment-references.js';
import {currentSegmentation} from './segmentation-identity.js';
import {currentCoverageDraft} from './coverage-cleanup-review.js';

export function textureWorkingPreviews(p){
 const plan=currentPlan(p),s=currentSegmentation(p),r=s?.reconstruction,a=r?.report;
 if(!plan||plan.status==='completed'||plan.segmentationId!==s?.id||!a?.geometryPreserved||!a.cornerUvTransfer||!a.savedAndReopened)return [];
 const runs=(p.segmentTextureRuns||[]).filter(run=>run.planId===plan.id&&run.status==='completed');
 if(!['head','body'].every(part=>runs.some(run=>run.part===part&&r.runIds.includes(run.id))))return [];
 const draft=currentCoverageDraft(p,r.textureIds);
 return (p.textures||[]).filter(t=>t.supervisedPending&&t.segmentationId===s.id&&r.textureIds.includes(t.id)).map(t=>t.group==='body'&&draft?{...t,...draft.asset,coverageDraftId:draft.id}:t);
}

// Transfer outputs are working files. Only validated refinements are shown.
export function texturePreviewState(p){
 const plan=currentPlan(p),pending=(p.textures||[]).some(t=>t.supervisedPending);
 const previewPending=!!plan&&plan.status!=='completed'||pending&&!plan;
 return {previewPending,textures:previewPending?[]:(p.textures||[]).filter(t=>!t.supervisedPending)};
}

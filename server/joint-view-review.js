import {randomUUID} from 'node:crypto';
import {validateViewSet,fingerprintViewSet,validationCurrent,viewSetReady} from './view-set.js';
import {revokeApprovals,viewIds,modelCurrent,approvedCurrent} from './lineage.js';
const groups=['head','body'];
function recoverModels(p){
 for(const m of p.models){
  if(!m.obsolete||!/^Se reabrió la revisión de |^View review reopened\.$/.test(m.obsoleteReason||''))continue;
  const candidate={...m,obsolete:false};if(!modelCurrent(p,candidate))continue;
  m.obsolete=false;delete m.obsoleteReason;delete m.obsoleteAt;
 }
}
export function recoverUnchangedReview(project){
 const p=structuredClone(project);
 if(!groups.every(g=>approvedCurrent(p,g)))throw Object.assign(Error('The current views require explicit approval.'),{status:409});
 p.viewSetValidations||={};
 for(const g of groups){
  if(viewSetReady(p,g))continue;
  const report=[...(p.viewSetValidationHistory||[])].reverse().find(r=>(!r.group||r.group===g)&&validationCurrent(p,r)&&r.humanReview?.approved&&viewSetReady({...p,viewSetValidations:{...p.viewSetValidations,[g]:r}},g));
  if(!report)throw Object.assign(Error('The current views require visual review.'),{status:409});
  p.viewSetValidations[g]=report;
 }
 recoverModels(p);return p;
}
export async function reviewAllViews(project,readAsset,approved){
 if(typeof approved!=='boolean')throw Object.assign(Error('Invalid review decision.'),{status:400});
 const next=structuredClone(project);
 if(!approved){revokeApprovals(next,'View review reopened.');next.revision++;return next;}
 const fingerprints=groups.map(g=>fingerprintViewSet(project,g));
 const reports=await Promise.all(groups.map(g=>validateViewSet(next,readAsset,g)));
 if(reports.some(r=>!r.technicalValid))throw Object.assign(Error('Review the selected head and body images. Missing, duplicate or invalid files cannot be approved.'),{status:409});
 if(groups.some((g,i)=>fingerprintViewSet(project,g)!==fingerprints[i]))throw Object.assign(Error('The views changed during validation. Review them again.'),{status:409});
 const at=new Date().toISOString();
 next.viewSetValidations={};
 for(const [i,g] of groups.entries()){
  const r=reports[i];r.humanReview={approved:true,reportId:r.id,fingerprint:r.fingerprint,at};
  next.viewSetValidations[g]=r;
  next.groups[g].approval={id:randomUUID(),at,referenceId:next.reference.id,notesRevision:next.notesRevision,viewIds:viewIds(next,g)};
  next.groups[g].approved=true;next.groups[g].reviewReason=null;
 }
 next.viewSetValidation=reports[0];recoverModels(next);next.revision++;return next;
}

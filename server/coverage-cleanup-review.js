import {segFail as fail} from './segmentation-files.js';
const reject=()=>fail('REFINE_COVERAGE_REVIEW_REQUIRED');
const text=v=>typeof v==='string'&&v.trim().length>=8&&v.length<=2000;
const includes=(a,items)=>Array.isArray(a)&&items.every(v=>a.includes(v));
export const currentCoverageDraft=(p,ids)=>[...p.coverageCleanupDrafts||[]].reverse().find(d=>JSON.stringify(d.sourceTextureIds)===JSON.stringify(ids));

// This validates the agent's source-bound visual review, not an automatic
// interpretation of anatomy or of the concept image.
export function validateCoverageCleanup(report,coverage){
 const review=report.coverageReview;
 if(review?.status!=='checked'||review.conceptCompared!==true||review.modelInspected!==true||!includes(review.views,['front','left','right','back'])||!includes(review.modes,['base-color','geometry'])||!Array.isArray(review.groups)||review.groups.length!==coverage.length)reject();
 const seen=new Set(),paintedParts=new Set();
 for(const entry of review.groups){
  const source=coverage.find(g=>g.groupId===entry.groupId);
  if(!source||seen.has(entry.groupId)||entry.allAddedCoverageAccountedFor!==true||!text(entry.findings)||!Array.isArray(entry.regions)||source.status==='temporary'&&!entry.regions.some(r=>r.temporary===true))reject();
  seen.add(entry.groupId);
  for(const region of entry.regions){
   if(!text(region.name)||typeof region.temporary!=='boolean'||!['skin','original-clothing','empty','occluded'].includes(region.surface)||!['exposed-skin','original-clothing','not-visible'].includes(region.concept)||!['restored-skin','preserved-original','retained'].includes(region.action)||!text(region.reason)||!Array.isArray(region.evidence)||new Set(region.evidence).size<2||region.evidence.some(v=>typeof v!=='string'||!v.trim()||v.length>500))reject();
   const restore=region.temporary&&region.surface==='skin'&&region.concept==='exposed-skin';
   if(restore&&region.action!=='restored-skin'||region.action==='restored-skin'&&!restore)reject();
   if(region.action==='preserved-original'&&(region.temporary||region.surface!=='original-clothing'||region.concept!=='original-clothing'))reject();
   if(region.action==='retained'&&region.concept!=='not-visible')reject();
   if(restore){
    const summary=report.coverage.find(g=>g.groupId===entry.groupId);
    if(summary?.status!=='neutralized')reject();
    paintedParts.add(source.part||'body');
   }
  }
 }
 return paintedParts;
}

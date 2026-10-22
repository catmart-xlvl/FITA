export function validateScleraReview(report) {
 const r=report.scleraReview;
 const fail=()=>{throw Object.assign(Error('REFINE_SCLERA_REVIEW_REQUIRED'),{status:409});};
 if(!r||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>2000)fail();
 if(r.status==='not-applicable'){
  if(report.facialPreparation?.status!=='not-applicable')fail();
  return;
 }
 if(r.status!=='checked'||r.method!=='anatomical-rim'||!Array.isArray(r.eyes)||r.eyes.length!==2||r.eyes.some(e=>!e||typeof e!=='object')||new Set(r.eyes.map(e=>e.eye)).size!==2)fail();
 for(const e of r.eyes){
  if(!['L','R'].includes(e.eye)||!['front','oblique-inward','oblique-outward','profile','above','below'].every(v=>e.views?.includes(v))||!['base-color','wireframe'].every(v=>e.modes?.includes(v))||!['closedBoundary','noInteriorBand','noSkinSpill','irisUnoccluded'].every(k=>e[k]===true))fail();
  if(!Array.isArray(e.rim)||e.rim.length<3||e.rim.length>1024||e.rim.some(p=>!Array.isArray(p)||p.length!==3||p.some(c=>!Number.isFinite(c)))||new Set(e.rim.map(p=>JSON.stringify(p))).size!==e.rim.length)fail();
 }
}

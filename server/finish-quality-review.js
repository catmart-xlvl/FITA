const fail=()=>{throw Error('REFINE_REVIEW_REQUIRED');};
const explanation=s=>typeof s==='string'&&s.trim().length>=8&&s.length<=4000;
const includes=(a,required)=>Array.isArray(a)&&required.every(x=>a.includes(x));

// Evidence recorded by the reviewing agent; this is not an automatic artistic score.
export function validateFinishQuality(report,expectedAtlases=null){
 const joint=report?.jointReview,uv=report?.uvReview;
 if(joint?.status!=='checked'||!includes(joint.parts,['head','body','hair'])||
  !includes(joint.modes,['base-color','neutral-light'])||!includes(joint.views,['front','left','right','back'])||
  !explanation(joint.skinComparison)||!explanation(joint.paintConsistency))fail();
 if(uv?.status!=='checked'||uv.mipmaps!==true||!includes(uv.distances,['close','full-character','distant'])||
  !includes(uv.modes,['base-color','neutral-light'])||!explanation(uv.findings)||!Array.isArray(uv.atlases))fail();
 const seen=new Set();
 for(const a of uv.atlases){
  const key=a.part+':'+a.index;
  if(!['head','body'].includes(a.part)||!Number.isInteger(a.index)||a.index<0||seen.has(key)||
   !Number.isFinite(a.paddingPx)||a.paddingPx<0||!['extended','verified-existing'].includes(a.status)||!explanation(a.reason))fail();
  seen.add(key);
 }
 if(expectedAtlases&&(seen.size!==expectedAtlases.length||expectedAtlases.some(a=>!seen.has(a.part+':'+a.index))))fail();
 return report;
}

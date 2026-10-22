export async function confirmReferenceForViews(request,project){
  const next=await request('/projects/'+project.id+'/confirm-reference',{method:'POST',body:{}});
  if(next?.id!==project.id||next.reference?.id!==project.reference?.id||next.referenceState?.status!=='ready'||next.referenceState.referenceId!==next.reference.id)throw Error('Reference not confirmed.');
  return next;
}

// Move only the inspector; the canvas and surrounding page keep their position.
export function revealReferenceCodex(target,environment=globalThis){
  const inspector=target?.closest('.artist-inspector');if(!inspector)return false;
  const behavior=environment.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
  // The compact layout lets the inspector flow with the page instead of nesting
  // a scroll area. Use its actual scroll surface in that layout.
  if(environment.getComputedStyle?.(inspector).overflowY==='visible'){
    environment.scrollTo({top:Math.max(0,environment.scrollY+target.getBoundingClientRect().top-16),behavior});return true;
  }
  const heading=inspector.querySelector('.inspector-heading');
  const top=inspector.scrollTop+target.getBoundingClientRect().top-inspector.getBoundingClientRect().top-(heading?.getBoundingClientRect().height||0)-16;
  inspector.scrollTo({top:Math.max(0,top),behavior});
  return true;
}

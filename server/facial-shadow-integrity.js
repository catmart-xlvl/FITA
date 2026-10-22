const fail=detail=>{throw Object.assign(Error('FACE_INVALID: '+detail),{status:400});};
export function facialShadowNodes(doc){
 return doc.nodes.filter(n=>n.mesh!==undefined&&(/^WB_EyeShadow_[LR](?:_|\s|$)/i.test(n.name)||/^eye[ _-]?shadows?$/i.test(n.name)||doc.meshes[n.mesh].primitives.some(p=>doc.materials?.[p.material]?.extras?.workbenchFacialRole==='eyeshadow')));
}
// Existing artist-authored strips are retained, including bilateral objects.
// This checks coordination/completeness, not anatomical fit or visual quality.
export function inspectEyeShadowBindings(source,candidate,bindings,deltas,parts=[]){
 const shadows=facialShadowNodes(source.doc);
 for(const node of shadows){
  const entries=parts.filter(p=>p.mesh===node.name&&p.role==='eyeshadow'),part=entries[0],known=/^WB_EyeShadow_([LR])(?:_|\s|$)/i.exec(node.name),expected=known&&(known[1].toUpperCase()==='L'?'left':'right');
  if(entries.length!==1||!['left','right','both'].includes(part?.eye)||expected&&part.eye!==expected||typeof part.decision!=='string'||!part.decision.trim())fail('inventory eye shadow and anatomical eye: '+node.name);
  const required=['blink',...(part.eye!=='right'?['blinkLeft']:[]),...(part.eye!=='left'?['blinkRight']:[])];
  const other=candidate.doc.nodes.find(n=>n.mesh!==undefined&&n.name===node.name),mesh=candidate.doc.meshes[other?.mesh];
  for(const expression of required){
   const list=(bindings.expressions[expression]||[]).filter(e=>e.mesh===node.name);
   if(!list.some(e=>[...deltas.get(JSON.stringify([e.mesh,e.shape]))?.values()||[]].some(row=>row.some(v=>Math.abs(v)>1e-7))))fail('eye shadow must follow '+expression+': '+node.name);
   for(const entry of list){const index=mesh?.extras?.targetNames?.indexOf(entry.shape);if(!(index>=0)||!mesh.primitives.every(p=>p.targets?.[index]?.NORMAL!==undefined))fail('eye shadow morph needs NORMAL target: '+node.name);}
  }
 }
 return {checked:shadows.length>0,meshes:shadows.map(n=>n.name)};
}

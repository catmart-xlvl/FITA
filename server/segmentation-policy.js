export const SEGMENTATION_POLICY = 'head-face-hair/v2';

const faceCategories = new Set(['skin','face','facial_features','eyes','mouth','ears','eyebrows','eyelashes','teeth']);
const accessoryCategories = new Set(['accessory','accessories','earrings']);
export function prominentAccessory(group) {
 const evidence=group.visualImportance;
 return accessoryCategories.has(group.category)&&evidence?.significant===true&&
  typeof evidence.reason==='string'&&evidence.reason.trim().length>0&&
  new Set((evidence.views||[]).filter(v=>['front','left','right','back'].includes(v))).size>=2;
}

// Combine face labels only; the trusted Blender rebuild preserves all source
// faces and transforms. Small ornaments share an atlas, never new geometry.
export function normalizeHeadGroups(input) {
 const proposal=structuredClone(input),buckets={hair:[],face:[]},keep=[];
 for(const group of proposal.groups) {
  if(group.part!=='head'){keep.push(group);continue;}
  if(group.category==='hair')buckets.hair.push(group);
  else if(faceCategories.has(group.category))buckets.face.push(group);
  else if(accessoryCategories.has(group.category)&&!prominentAccessory(group))buckets[group.includeWith==='hair'?'hair':'face'].push(group);
  else keep.push(group);
 }
 const changedIds=[];
 for(const [role,members] of Object.entries(buckets)) {
  if(!members.length)continue;
  const category=role==='hair'?'hair':'skin';
  const main=members.find(g=>g.category===category)||members[0];
  if(members.length===1&&main.category===category){keep.push(main);continue;}
  const resolutions=['2K','4K','8K'];
  const resolution=resolutions[Math.max(...members.map(g=>resolutions.indexOf(g.settings?.resolution||'4K')))];
  keep.push({...main,name:role==='hair'?'Cabello completo':'Rostro',category,
   faces:members.flatMap(g=>g.faces),components:[...new Set(members.flatMap(g=>g.components||[]))],
   pending:members.some(g=>g.pending===true),referencesReviewed:false,
   settings:{resolution,removeLighting:members.every(g=>g.settings?.removeLighting===true)}});
  changedIds.push(...members.map(g=>g.id));
 }
 proposal.groups=keep.sort((a,b)=>input.groups.findIndex(g=>g.id===a.id)-input.groups.findIndex(g=>g.id===b.id));
 proposal.analysisPolicy=SEGMENTATION_POLICY;
 return {proposal,changedIds};
}

export function analysisReview(run) {
 if(!run)return {canApprove:false,reason:'SEG_REVIEW_REQUIRED',reviewCount:0};
 const reviewCount=Math.max(run.pending?.length||0,run.groups.filter(g=>g.pending).length);
 const head=run.groups.filter(g=>g.part==='head');
 let reason=null;
 if(run.manifest?.meshRepairPolicy&&(!run.meshRepair?.reviewed||run.proposal?.meshRepair?.pending?.length))reason='SEG_MESH_REPAIR_REQUIRED';
 else if(run.groups.some(g=>g.category==='unclassified')||
  !['front','left','right','back','isolated'].every(v=>run.visualReview?.views?.includes(v))||!run.visualReview?.findings?.trim())reason='SEG_ANALYSIS_INCOMPLETE';
 else if(head.filter(g=>g.category==='hair').length!==1||head.filter(g=>['skin','face'].includes(g.category)).length!==1||
  head.some(g=>!['hair','skin','face'].includes(g.category)&&!prominentAccessory(g)))reason='SEG_HEAD_GROUPS_REQUIRED';
 else if(run.groups.some(g=>g.part==='body'&&g.spatialAudit?.requiresReview))reason='SEG_BODY_GROUPS_SPREAD';
 // Classified regions marked by the analyst can be accepted by the artist.
 // This approval is for the grouping and quotation, not reference readiness.
 return {canApprove:!reason,reason,reviewCount};
}

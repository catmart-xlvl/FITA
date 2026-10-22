import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MESH_REPAIR_POLICY,REPAIR_REGIONS,REPAIR_VIEWS,validateMeshRepairReview} from '../server/mesh-repair-policy.js';
import {analysisReview} from '../server/segmentation-policy.js';
function fixture(){
 const bytes=Buffer.from([137,80,78,71,13,10,26,10]),files={},repair={policy:MESH_REPAIR_POLICY,sourceFingerprint:'a'.repeat(64),operations:[],decisions:{before:[],after:[]},pending:[],visualReview:{}};
 for(const part of ['head','body']){
  const review={findings:'Synthetic contract fixture',regions:Object.fromEntries(REPAIR_REGIONS[part].map(r=>[r,{status:'clear',reason:'Synthetic reviewed region'}])),views:{}};
  for(const view of REPAIR_VIEWS[part]){review.views[view]={};for(const phase of ['before','after']){const file=`review/${part}_${view}_${phase}.png`;files[file]=bytes;review.views[view][phase]={file,sha256:createHash('sha256').update(bytes).digest('hex')};}}
  repair.visualReview[part]=review;
 }
 return {repair,files};
}
test('hole inspection is required even with zero repair operations',()=>{
 const {repair,files}=fixture();assert.equal(validateMeshRepairReview(repair,files).length,20);
 for(const mutate of [r=>delete r.visualReview.head.regions.crown,r=>r.pending.push('gap'),r=>r.visualReview.head.regions.roots.status='pending',r=>r.policy='old',r=>delete r.decisions.after]){const r=structuredClone(repair);mutate(r);assert.throws(()=>validateMeshRepairReview(r,files),/SEG_MESH_REPAIR_REQUIRED/);}
});
test('before/after evidence cannot be missing, reused, substituted or outside review directory',()=>{
 const {repair,files}=fixture();
 for(const mutate of [r=>delete r.visualReview.head.views.interior,r=>r.visualReview.head.views.top.after.sha256='0'.repeat(64),r=>r.visualReview.body.views.front.after=r.visualReview.body.views.front.before,r=>r.visualReview.head.views.front.after.file='../source.png']){const r=structuredClone(repair);mutate(r);assert.throws(()=>validateMeshRepairReview(r,files),/SEG_MESH_REPAIR_EVIDENCE/);}
 const proof=repair.visualReview.head.views.top.after;delete files[proof.file];assert.throws(()=>validateMeshRepairReview(repair,files),/SEG_MESH_REPAIR_EVIDENCE/);
});
test('a repaired region needs an operation for that part',()=>{
 const {repair,files}=fixture();repair.visualReview.head.regions.crown={status:'repaired',reason:'Missing scalp',operationIds:['cap']};
 assert.throws(()=>validateMeshRepairReview(repair,files),/SEG_MESH_REPAIR_REQUIRED/);
 repair.operations=[{id:'cap',part:'head',region:'crown'}];assert.equal(validateMeshRepairReview(repair,files).length,20);
});
test('new grouping cannot be approved without the verified mesh repair audit; legacy history remains readable',()=>{
 const run={manifest:{meshRepairPolicy:MESH_REPAIR_POLICY},groups:[],pending:[]};assert.equal(analysisReview(run).reason,'SEG_MESH_REPAIR_REQUIRED');
 delete run.manifest;assert.equal(analysisReview(run).reason,'SEG_ANALYSIS_INCOMPLETE');
});

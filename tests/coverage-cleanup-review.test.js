import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCoverageCleanup} from '../server/coverage-cleanup-review.js';
const coverage=[{groupId:'legs',part:'body',status:'temporary'}];
const report=()=>({coverage:[{groupId:'legs',status:'neutralized'}],coverageReview:{status:'checked',conceptCompared:true,modelInspected:true,views:['front','left','right','back'],modes:['base-color','geometry'],groups:[{groupId:'legs',allAddedCoverageAccountedFor:true,findings:'Auxiliary briefs extend onto hips exposed in concept',regions:[{name:'Left and right hip skin',temporary:true,surface:'skin',concept:'exposed-skin',action:'restored-skin',reason:'Painted out the temporary cloth; original bodysuit retained',evidence:['before.png','after.png']}]}]}});
test('temporary cloth on concept-exposed skin requires restoration and matching coverage summary',()=>{
 assert.deepEqual([...validateCoverageCleanup(report(),coverage)],['body']);
 for(const mutate of [r=>r.coverageReview.groups[0].regions[0].action='retained',r=>r.coverage[0].status='preserved',r=>r.coverageReview.groups[0].regions[0].surface='original-clothing']){
  const r=report();mutate(r);assert.throws(()=>validateCoverageCleanup(r,coverage),/REFINE_COVERAGE_REVIEW_REQUIRED/);
 }
});
test('coverage review cannot omit a group, geometry inspection, a comparison, evidence or a view',()=>{
 for(const mutate of [r=>delete r.coverageReview,r=>r.coverageReview.groups=[],r=>r.coverageReview.modelInspected=false,r=>r.coverageReview.conceptCompared=false,r=>r.coverageReview.views=['front'],r=>r.coverageReview.groups[0].regions=[],r=>r.coverageReview.groups[0].regions[0].evidence=[]]){
  const r=report();mutate(r);assert.throws(()=>validateCoverageCleanup(r,coverage),/REFINE_COVERAGE_REVIEW_REQUIRED/);
 }
});
test('original clothes stay intact and ambiguous anatomy cannot be declared restored skin',()=>{
 const r=report(),region=r.coverageReview.groups[0].regions[0];Object.assign(region,{temporary:false,surface:'original-clothing',concept:'original-clothing',action:'preserved-original'});
 assert.deepEqual([...validateCoverageCleanup(r,[{...coverage[0],status:'none'}])],[]);
 region.surface='unknown';assert.throws(()=>validateCoverageCleanup(r,coverage),/REFINE_COVERAGE_REVIEW_REQUIRED/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScleraReview} from '../server/sclera-review.js';
import {scleraPatches} from '../server/sclera-patches.js';
const review=()=>({scleraReview:{status:'checked',method:'anatomical-rim',reason:'Both reviewed anatomical rims include their complete inner walls.',eyes:['L','R'].map(eye=>({eye,rim:[[0,0,0],[1,0,0],[0,1,0]],views:['front','oblique-inward','oblique-outward','profile','above','below'],modes:['base-color','wireframe'],closedBoundary:true,noInteriorBand:true,noSkinSpill:true,irisUnoccluded:true}))}});
test('sclera review requires both complete rims and the angles that reveal inner walls',()=>{
 assert.doesNotThrow(()=>validateScleraReview(review()));
 for(const update of [{views:['front']},{rim:[[0,0,0],[0,0,0],[1,0,0]]},{noInteriorBand:false},{noSkinSpill:false},{irisUnoccluded:false}]){const r=review();Object.assign(r.scleraReview.eyes[1],update);assert.throws(()=>validateScleraReview(r),/REFINE_SCLERA_REVIEW_REQUIRED/);}
 assert.throws(()=>validateScleraReview({}),/REFINE_SCLERA_REVIEW_REQUIRED/);
});
test('already prepared faces still need sclera inspection; no-eye designs can give a reason',()=>{
 const r={scleraReview:{status:'not-applicable',reason:'Synthetic geometry without eyes'},facialPreparation:{status:'already-prepared'}};
 assert.throws(()=>validateScleraReview(r),/REFINE_SCLERA_REVIEW_REQUIRED/);r.facialPreparation.status='not-applicable';assert.doesNotThrow(()=>validateScleraReview(r));
});
test('repeated sclera repair retains the legacy first correction and later corrections in order',()=>{
 const first={schema:'workbench-sclera-repair/v1'},second={schema:'workbench-sclera-repair/v2'};
 assert.deepEqual(scleraPatches({scleraPatch:first}),[first]);
 assert.deepEqual(scleraPatches({scleraPatch:second,scleraPatches:[first,second]}),[first,second]);
});

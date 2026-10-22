import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFinishQuality} from '../server/finish-quality-review.js';
const valid=()=>({jointReview:{status:'checked',parts:['head','body','hair'],modes:['base-color','neutral-light'],views:['front','left','right','back'],skinComparison:'Compared cheek, jaw, neck and arm under common lighting',paintConsistency:'Preserved intentional hair highlights and skin blush'},uvReview:{status:'checked',mipmaps:true,distances:['close','full-character','distant'],modes:['base-color','neutral-light'],findings:'Checked original resolution at three distances',atlases:[{part:'head',index:0,paddingPx:16,status:'extended',reason:'Expanded RGB without changing alpha or occupied islands'}]}});
test('joint finish review rejects missing evidence and atlas omissions or duplicate identities',()=>{
 const expected=[{part:'head',index:0}];assert(validateFinishQuality(valid(),expected));
 for(const change of [r=>delete r.jointReview,r=>r.jointReview.skinComparison='',r=>r.jointReview.modes=['neutral-light'],r=>r.uvReview.mipmaps=false,r=>r.uvReview.distances.pop(),r=>r.uvReview.atlases=[],r=>r.uvReview.atlases.push({...r.uvReview.atlases[0]}),r=>r.uvReview.atlases[0].index=1,r=>r.uvReview.atlases[0].paddingPx=-1]){
  const r=valid();change(r);assert.throws(()=>validateFinishQuality(r,expected),/REFINE_REVIEW_REQUIRED/);
 }
});

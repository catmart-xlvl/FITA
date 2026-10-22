import test from 'node:test';
import assert from 'node:assert/strict';
import {textureProgress} from '../src/texture-progress.js';

const run=part=>({part,planId:'current',status:'completed',operations:[{step:'download',status:'completed',downloadAsset:{id:part}}]});
const project=status=>({segmentTexturePlan:{id:'current',status},segmentTextureRuns:['head','body'].map(run)});
test('saved generation is distinct from pending, interrupted and validated finishing',()=>{
 assert.equal(textureProgress(project('ready-to-finish')).title,'generationReadyTitle');
 assert.equal(textureProgress(project('attention')).title,'finishingInterruptedTitle');
 assert.equal(textureProgress(project('finishing')).message,'finishingTransferred');
 assert.equal(textureProgress(project('completed')),null);
});
test('old plans, missing parts and unreceived downloads never claim generation completion',()=>{
 for(const mutate of [p=>p.segmentTextureRuns[1].planId='old',p=>p.segmentTextureRuns.pop(),p=>delete p.segmentTextureRuns[0].operations[0].downloadAsset,p=>p.segmentTextureRuns[0].status='running']){
  const p=project('attention');mutate(p);assert.equal(textureProgress(p).title,'previewPendingTitle');
 }
});

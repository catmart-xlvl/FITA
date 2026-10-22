import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHeadGroups,analysisReview} from '../server/segmentation-policy.js';
const group=(id,category,faces,extra={})=>({id,name:id,part:'head',category,faces,...extra});

test('large spatial gaps block body approval but disconnected hair still shares its atlas',()=>{
 const run={groups:[group('hair','hair',[0],{spatialAudit:{requiresReview:true}}),group('face','skin',[1]),{...group('limbs','skin',[0,1]),part:'body',spatialAudit:{requiresReview:true}}],visualReview:{views:['front','left','right','back','isolated'],findings:'reviewed'}};
 assert.equal(analysisReview(run).reason,'SEG_BODY_GROUPS_SPREAD');run.groups[2].spatialAudit.requiresReview=false;assert.equal(analysisReview(run).canApprove,true);
});
test('all hair islands share one atlas and minor ornaments join their parent atlas without losing faces',()=>{
 const source={groups:[group('hair','hair',[0]),group('ponytail','hair',[1]),group('face','skin',[2]),group('eyes','facial_features',[3]),group('earring','accessories',[4]),group('ribbon','accessories',[5],{includeWith:'hair'})]};
 const before=JSON.stringify(source),result=normalizeHeadGroups(source);assert.equal(result.proposal.groups.length,2);assert.deepEqual(result.proposal.groups.find(g=>g.category==='hair').faces,[0,1,5]);assert.deepEqual(result.proposal.groups.find(g=>g.category==='skin').faces,[2,3,4]);assert.equal(JSON.stringify(source),before);
 assert.equal(normalizeHeadGroups(result.proposal).changedIds.length,0);
});
test('separate head accessories require visual prominence in two views, never face count alone',()=>{
 const base=[group('hair','hair',[0]),group('face','skin',[1])];
 const crown=group('crown','accessories',[2],{visualImportance:{significant:true,reason:'Large crown changes the silhouette.',views:['front','back']}});
 assert.equal(normalizeHeadGroups({groups:[...base,crown]}).proposal.groups.length,3);
 const small={...crown,visualImportance:{significant:true,reason:'Many polygons.',views:['front','front']}};
 assert.equal(normalizeHeadGroups({groups:[...base,small]}).proposal.groups.length,2);
 const run={groups:[...base,crown],pending:[],visualReview:{views:['front','left','right','back','isolated'],findings:'Reviewed.'}};assert(analysisReview(run).canApprove);
 assert.equal(analysisReview({...run,groups:[...base,small]}).reason,'SEG_HEAD_GROUPS_REQUIRED');
});

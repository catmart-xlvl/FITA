import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {emptyProject} from '../server/storage.js';
import {reviewAllViews,recoverUnchangedReview} from '../server/joint-view-review.js';
import {snapshot} from '../server/lineage.js';
import {viewSetReady} from '../server/view-set.js';
import {headCandidatesAvailable,generationSequenceBlocker,studioDisplayOperation} from '../shared/generation-sequence.js';
async function fixture(){
 const p=emptyProject('Joint review');p.reference={id:'ref'};p.referenceState={status:'ready',referenceId:'ref'};
 const bytes=new Map();let index=1;
 for(const g of ['head','body']){p.groups[g].selectedViews=['front','right','back','left'];for(const v of p.groups[g].selectedViews){const id=g+'-'+v;p.groups[g].views[v]={id,referenceId:'ref',source:'imported'};bytes.set(id,await sharp({create:{width:512,height:512,channels:3,background:{r:index++*20,g:50,b:80}}}).png().toBuffer());}}
 return {p,bytes,read:a=>bytes.get(a.id)};
}
test('one review approves all eight selected images and can reopen both parts',async()=>{
 const {p,read}=await fixture();const next=await reviewAllViews(p,read,true);
 for(const g of ['head','body']){assert.equal(viewSetReady(next,g),true);assert.equal(next.groups[g].approved,true);assert.equal(next.viewSetValidations[g].items.length,4);}
 assert.equal(p.groups.head.approved,false);
 const reopened=await reviewAllViews(next,read,false);for(const g of ['head','body'])assert.equal(viewSetReady(reopened,g),false);
});
test('bad left profile or concurrent edit cannot partially approve a joint review',async()=>{
 const {p,bytes,read}=await fixture();bytes.set('body-left',Buffer.from('invalid'));await assert.rejects(reviewAllViews(p,read,true),/Missing, duplicate or invalid/);assert.equal(p.groups.head.approved,false);
 const second=await fixture();let changed=false;await assert.rejects(reviewAllViews(second.p,a=>{if(!changed){changed=true;second.p.notesRevision++;}return second.read(a);},true),/changed during/);
});
test('body remains blocked until all four current head results can be viewed',()=>{
 const p={models:[],groups:{head:{}},studioOperations:[{id:'batch',type:'submit',group:'head',status:'succeeded',candidates:[0,1,2,3].map(i=>({modelId:'m'+i}))}]};
 assert.equal(generationSequenceBlocker(p,'body'),'STUDIO_HEAD_FIRST');
 p.models=[0,1,2].map(i=>({id:'m'+i,group:'head',current:true}));assert.equal(headCandidatesAvailable(p),false);
 p.models.push({id:'m3',group:'head',current:true});assert.equal(headCandidatesAvailable(p),true);assert.equal(generationSequenceBlocker(p,'body'),null);
 p.models[0].obsolete=true;assert.equal(headCandidatesAvailable(p),false);
});

test('reviewed remote failures allow the surviving head without treating waiting or connection failures as completed',()=>{
 const p={models:[{id:'saved',group:'head',current:true}],groups:{head:{}},studioOperations:[{type:'submit',group:'head',status:'succeeded',candidates:[{modelId:'saved'},...[0,1,2].map(()=>({status:'needs-attention',error:'STUDIO_DID_NOT_RESPOND'}))]}]};
 const batch=p.studioOperations[0];assert.equal(headCandidatesAvailable(p),false);
 batch.partialBatchAcceptedAt='reviewed';assert.equal(headCandidatesAvailable(p),false);
 for(const c of batch.candidates.slice(1)){c.status='failed';c.failureSource='user-confirmed-studio';}
 batch.generationComplete=true;assert.equal(headCandidatesAvailable(p),true);assert.equal(generationSequenceBlocker(p,'body'),null);
 assert.equal(p.groups.head.selectedModelId,undefined);p.models[0].obsolete=true;assert.equal(headCandidatesAvailable(p),false);
});

test('a reviewed partial batch remains the displayed state after reload, until a new operation starts',()=>{
 const batch={id:'batch',type:'submit',group:'head',partialBatchAcceptedAt:'reviewed'},failed={id:'failed',sourceOperationId:'batch',group:'head',status:'failed'},quote={id:'quote',type:'observe',group:'head'};
 assert.equal(studioDisplayOperation([batch,failed],'head'),batch);assert.equal(studioDisplayOperation([batch,failed,quote],'head'),quote);assert.equal(studioDisplayOperation([batch,failed],'body'),null);
});
test('reapproving unchanged files recovers paid models, but changed inputs never do',async()=>{
 const {p,read}=await fixture();const approved=await reviewAllViews(p,read,true);
 approved.models.push({id:'paid',group:'body',source:'Tripo Studio',lineage:snapshot(approved)});
 const opened=await reviewAllViews(approved,read,false);assert.equal(opened.models[0].obsolete,true);
 const again=await reviewAllViews(opened,read,true);assert.equal(again.models[0].obsolete,false);
 const legacy=await reviewAllViews(approved,read,false);legacy.groups=structuredClone(approved.groups);
 assert.equal(recoverUnchangedReview(legacy).models[0].obsolete,false);
 legacy.groups.body.views.left.id='replacement';assert.throws(()=>recoverUnchangedReview(legacy),/explicit approval/);
});

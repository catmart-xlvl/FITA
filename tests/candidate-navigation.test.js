import test from 'node:test';import assert from 'node:assert/strict';
import {candidatePreviewId,localPreviewModels,candidateBatches,candidateSelectionEditable} from '../src/candidate-navigation.js';
import {restoreNavigation} from '../src/project-navigation.js';
const m=(id,group='head')=>({id,group,current:true,url:'/files/test/'+id+'.glb',studioSubmissionId:group+'-batch',candidateIndex:Number(id.slice(-1))||0});
const fixture=()=>({models:[],groups:{head:{},body:{}}});
test('first local arrival opens a preview without making a model choice; later arrivals preserve it',()=>{
 const p=fixture();assert.equal(candidatePreviewId(p,''),'');p.models.push(m('h0'));let id=candidatePreviewId(p,'');assert.equal(id,'h0');assert.equal(p.groups.head.selectedModelId,undefined);
 p.models.unshift(m('h1'));assert.equal(candidatePreviewId(p,id),'h0');id='h1';assert.equal(candidatePreviewId({...p,models:[...p.models]},id),'h1');
 p.groups.head.selectedModelId='h0';assert.equal(candidatePreviewId(p,''),'h0');assert.equal(candidatePreviewId(p,'h1'),'h1');
 p.models.find(x=>x.id==='h1').current=false;assert.equal(candidatePreviewId(p,'h1'),'h0');
});
test('unavailable and remote models never drive the local viewer; separate batches retain row identity',()=>{
 const p=fixture();p.models=[m('h0'),{...m('bad1'),url:'https://example.invalid/model.glb'},{...m('old2'),current:false},{...m('none3'),url:null}];
 assert.deepEqual(localPreviewModels(p).map(x=>x.id),['h0']);const rows=candidateBatches(p,'head');assert.equal(rows[0].rows.length,4);assert.equal(rows[0].rows[0].model.id,'h0');
 p.models.push({...m('b0','body'),studioSubmissionId:'second'});assert.equal(candidateBatches(p,'body')[0].id,'second');
});
test('changing candidates remains available until downstream work exists, whose review guards remain intact',()=>{
 const p={...fixture(),workflowStage:3};assert(candidateSelectionEditable(p));
 for(const change of [{segmentations:[{}]},{textureOperations:[{}]},{textures:[{}]},{segmentationDeliveryId:'pending-analysis'},{workflowStage:4}])assert.equal(candidateSelectionEditable({...p,...change}),false);
});
test('a project with local unchosen candidates opens 3D Form while an explicit saved stage is respected',()=>{
 const p={...fixture(),id:'qa',models:[m('h0')]};assert.equal(restoreNavigation(p,{getItem:()=>null}).stage,2);
 assert.equal(restoreNavigation(p,{getItem:()=>JSON.stringify({headModelId:null,stage:0,viewGroup:'head',studioGroup:'head'})}).stage,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {afterHeadChoice,afterViewApproval,restoreNavigation,persistNavigation,bodyPreparationMessage} from '../src/project-navigation.js';
import {translate} from '../src/i18n-core.js';

const project=()=>({id:'test',models:[{id:'chosen-head',group:'head',current:true}],groups:{head:{selectedModelId:'chosen-head'},body:{approved:true,views:{front:{}},selectedViews:['front']}},viewSetReadyByGroup:{head:true,body:false}});
test('head choice routes to the body gate, and only a ready approved body reaches Studio',()=>{
  const p=project();assert.deepEqual(afterHeadChoice(p),{stage:1,viewGroup:'body',studioGroup:'body',showSetReview:false});
  assert.match(bodyPreparationMessage(p),/Click Next/);
  p.viewSetReadyByGroup.body=true;assert.equal(afterHeadChoice(p).stage,2);
  p.groups.body.approved=false;assert.equal(afterHeadChoice(p).stage,1);assert.match(bodyPreparationMessage(p),/approve/);
  p.groups.body.views={};assert.match(bodyPreparationMessage(p),/Load and select/);
});
test('reopen and reload preserve navigation, while a newly chosen head or obsolete selection recomputes the next step',()=>{
  const p=project(),values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  assert.equal(restoreNavigation(p,storage).viewGroup,'body');
  const browsing={stage:2,viewGroup:'body',studioGroup:'head',showSetReview:false};persistNavigation(p,browsing,storage);
  assert.equal(restoreNavigation(p,storage).studioGroup,'head');
  p.groups.head.selectedModelId='new-head';p.models.push({id:'new-head',group:'head',current:true});assert.equal(restoreNavigation(p,storage).stage,1);
  p.models.forEach(m=>m.current=false);assert.equal(restoreNavigation(p,storage).stage,0);
});
test('head confirmation and each body prerequisite have EN ES JA translations',()=>{
  const p=project(),keys=['Head selected. Next: prepare the body.','Review head candidates','Continue with body',bodyPreparationMessage(p),'Model choice could not be confirmed. Please try again.'];
  p.groups.body.approved=false;keys.push(bodyPreparationMessage(p));p.groups.body.views={};keys.push(bodyPreparationMessage(p));
  for(const key of keys)for(const lang of ['en','es','ja']){const value=translate(lang,key);assert.ok(value);if(lang!=='en')assert.notEqual(value,key);}
});

test('joint view approval advances immediately only after both validated approvals and keeps the generation sequence',()=>{
 const p=project();p.groups.head.approved=true;p.viewSetReadyByGroup.body=true;
 assert.deepEqual(afterViewApproval(p),{stage:2,studioGroup:'body',showSetReview:false});
 p.models=[];assert.equal(afterViewApproval(p).studioGroup,'head');
 p.groups.body.approved=false;assert.equal(afterViewApproval(p),null);
 p.groups.body.approved=true;p.viewSetReadyByGroup.head=false;assert.equal(afterViewApproval(p),null);
 for(const lang of ['es','ja'])for(const label of ['Approve and continue','Continue to 3D form'])assert.notEqual(translate(lang,label),label);
});

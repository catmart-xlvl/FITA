import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmReferenceForViews,revealReferenceCodex} from '../src/reference-navigation.js';

const project={id:'example',reference:{id:'concept.png'}};
const ready={...project,referenceState:{status:'ready',referenceId:'concept.png'}};
test('reference continuation requires a successful validation of the same project and image',async()=>{
  const calls=[];
  assert.equal(await confirmReferenceForViews(async(...args)=>{calls.push(args);return ready;},project),ready);
  assert.deepEqual(calls,[['/projects/example/confirm-reference',{method:'POST',body:{}}]]);
  for(const next of [{...ready,id:'different'},{...ready,reference:{id:'replacement'}},{...ready,referenceState:{status:'invalid'}},{...ready,referenceState:{status:'ready',referenceId:'old'}}])await assert.rejects(confirmReferenceForViews(async()=>next,project),/Reference not confirmed/);
  await assert.rejects(confirmReferenceForViews(async()=>{throw Error('file validation failed');},project),/file validation failed/);
});
test('reference continuation scrolls only its inspector and honors reduced motion',()=>{
  const calls=[],inspector={scrollTop:80,getBoundingClientRect:()=>({top:100}),querySelector:()=>({getBoundingClientRect:()=>({height:40})}),scrollTo:value=>calls.push(value)};
  const target={closest:selector=>{assert.equal(selector,'.artist-inspector');return inspector;},getBoundingClientRect:()=>({top:600})};
  for(const reduced of [false,true])assert.equal(revealReferenceCodex(target,{matchMedia:query=>{assert.equal(query,'(prefers-reduced-motion: reduce)');return {matches:reduced};}}),true);
  assert.deepEqual(calls,[{top:524,behavior:'smooth'},{top:524,behavior:'instant'}]);
  assert.equal(revealReferenceCodex(null),false);
  assert.equal(revealReferenceCodex({closest:()=>null}),false);
});
test('compact layout follows the page scroll surface instead of an unscrollable inspector',()=>{
  const calls=[],inspector={scrollTo:()=>assert.fail('Inspector is not scrollable on compact layout')};
  const target={closest:()=>inspector,getBoundingClientRect:()=>({top:700})};
  assert.equal(revealReferenceCodex(target,{scrollY:100,getComputedStyle:()=>({overflowY:'visible'}),matchMedia:()=>({matches:true}),scrollTo:value=>calls.push(value)}),true);
  assert.deepEqual(calls,[{top:784,behavior:'instant'}]);
});

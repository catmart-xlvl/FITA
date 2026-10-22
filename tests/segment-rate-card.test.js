import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLocalBudget} from '../server/segment-rate-card.js';
import {acceptBudget,advanceChain} from '../server/segmentation-budget.js';
import {acceptGroupPlan} from '../server/segment-references.js';
const fixture=()=>({id:'seg',approval:{id:'approved'},groups:Array.from({length:6},(_,i)=>({id:'g'+i,part:i<2?'head':'body',settings:{resolution:'4K',removeLighting:false},referencesReady:true}))});
test('six segments cost 80 head + 160 body locally and remain valid beyond a Studio quote lifetime',()=>{
 const seg=fixture(),budgets=['head','body'].map(part=>prepareLocalBudget(seg,part));
 assert.deepEqual(budgets.map(b=>b.total),[80,160]);
 const args={budgetIds:Object.fromEntries(budgets.map(b=>[b.part,b.id])),total:240,confirm:true,confirmUpload:true,autoStart:true};
 assert.equal(acceptGroupPlan(seg,budgets,args).maxCredits,240);
 seg.groups[0].settings.removeLighting=true;assert.throws(()=>acceptGroupPlan(seg,budgets,args),/SEG_BUDGET_STALE/);
});
test('live price over local allowance stops before payment; lower prices complete using the extension and durable keys',async()=>{
 for(const price of [21,20,10]){
  const seg=fixture(),budget=prepareLocalBudget(seg,'head'),run=acceptBudget(seg,budget,{maxCredits:80,confirm:true,confirmSeparateAssets:true}),calls=[];
  const provider={capabilities:()=>({supported:true}),quote:async()=>({source:'studio',verified:true,credits:price,conditions:'live model settings',expiresAt:Date.now()+60000}),execute:async({operation})=>{calls.push(operation.step);return {status:'completed',credits:operation.quote.credits};}};
  await advanceChain({run,seg,provider,save:async()=>{},isCurrent:()=>true});
  if(price>20){assert.equal(run.error,'SEG_PRICE_CHANGED');assert.deepEqual(calls,['import']);assert.equal(run.committedCredits,0);}
  else{assert.equal(run.status,'completed');assert.equal(run.committedCredits,price*4);assert.equal(calls.length,8);}
 }
});

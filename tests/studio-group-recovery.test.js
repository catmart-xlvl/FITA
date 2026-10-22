import test from 'node:test';
import assert from 'node:assert/strict';
import {studioGroupProvider} from '../server/studio-group-provider.js';
const id='11111111-2222-3333-4444-555555555555',taskId='22222222-2222-3333-4444-555555555555';
function fixture({stuck=false,unknown=false}={}){
 let time=0;const commands=[];
 const bridge={status:()=>({}),enqueue:(type,payload)=>{assert.equal(type,'segment');commands.push(payload);return {id:String(commands.length)};},getOperation:()=>({status:'succeeded',result:{receipt:{taskId,status:unknown?'unknown':stuck||commands.length<4?'running':'completed',uvSaved:true,credits:20}}})};
 const provider=studioGroupProvider(bridge,{store:{read:async()=>Buffer.from('same immutable source')},now:()=>time,pause:async ms=>{time+=ms;},recoveryWaitMs:10000}).forProject({id:'project'});
 const context={operation:{id,step:'smartUV',targetTaskId:taskId},group:{id:'skirt',asset:{id:'source'},settings:{resolution:'4K',removeLighting:false}}};
 return {run:()=>provider.recover(context),commands,time:()=>time};
}
test('a slow recovered UV receipt is polled to completion with the same operation and no paid submission',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.status,'completed');assert.equal(r.operationId,id);assert.equal(f.commands.length,4);
 for(const c of f.commands){assert.equal(c.action,'recover');assert.equal(c.operationId,id);assert.equal(c.taskId,taskId);assert.equal(c.confirmCost,undefined);}
 assert.equal(f.time(),9000);
});
test('recovery waiting is bounded; an actually unknown receipt is not polled or re-submitted',async()=>{
 const f=fixture({stuck:true});assert.equal((await f.run()).status,'running');assert.equal(f.time(),10000);assert(f.commands.every(c=>c.action==='recover'));
 const u=fixture({unknown:true});assert.equal((await u.run()).status,'unknown');assert.equal(u.commands.length,1);assert.equal(u.time(),0);
});

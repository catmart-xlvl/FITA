import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createHash, randomUUID} from 'node:crypto';
import {mountStudioRig} from '../server/studio-rig.js';

// Exercise the HTTP boundary and persisted job state, including loss of the
// ephemeral extension connection. No Studio requests or paid actions occur.
async function harness(t, stage='quoted', action='prepare') {
  const bytes=Buffer.from('original complete character'), source={id:'placement',preview:{id:'original'}};
  let project={id:'project',rigStudioJobs:[{id:randomUUID(),sourcePlacementId:source.id,
    sourceHash:createHash('sha256').update(bytes).digest('hex'),taskId:randomUUID(),
    stage,action,operationId:'lost-operation',costLabel:'20',quoteToken:'quote',quoteExpiresAt:Date.now()+60000}]};
  const operations=new Map(),commands=[];
  const store={get:()=>project,save:async p=>{project=p;},read:async()=>bytes};
  const bridge={status:()=>({}),getOperation:id=>operations.get(id),subscribe:()=>{},enqueue:(type,payload,context)=>{
    const op={id:randomUUID(),status:'queued',context};operations.set(op.id,op);commands.push({type,payload});return op;
  }};
  const app=express();app.use(express.json());mountStudioRig(app,{store,bridge,editable:()=>{},riggingSource:()=>source,acceptDonor:async()=>{throw Error('Unexpected donor import');}});
  app.use((error,request,response,next)=>response.status(error.status||500).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{project={id:'project'};await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}/api/projects/project/rigging/refinement/studio`;
  return {commands,job:()=>project.rigStudioJobs[0],post:async(action,body={})=>{
    const response=await fetch(base+'/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  }};
}

test('Studio rigging requires the exact live quote and duplicate submission cannot enqueue twice',async t=>{
  const h=await harness(t);
  assert.equal((await h.post('submit',{confirmCost:true,quoteToken:'quote',expectedCost:'25'})).status,409);
  assert.equal((await h.post('submit',{confirmCost:false,quoteToken:'quote',expectedCost:'20'})).status,409);
  assert.equal(h.commands.length,0);
  const body={confirmCost:true,quoteToken:'quote',expectedCost:'20'};
  const results=await Promise.all([h.post('submit',body),h.post('submit',body)]);
  assert(results.some(r=>r.status===202));assert.equal(h.commands.length,1);
  assert.equal((await h.post('submit',body)).status,200);assert.equal(h.commands.length,1);
});

test('after connection loss a paid rig can only be checked, never implicitly resubmitted',async t=>{
  const h=await harness(t,'running','submit');
  assert.equal((await h.post('prepare')).status,409);assert.equal(h.commands.length,0);
  assert.equal((await h.post('check')).status,200);assert.equal(h.commands[0].payload.action,'monitor');
  await h.post('check');assert.equal(h.commands.length,1);
});

test('expired quotes require a fresh preparation and cannot spend credits',async t=>{
  const h=await harness(t);h.job().quoteExpiresAt=Date.now()-1;
  assert.equal((await h.post('submit',{confirmCost:true,quoteToken:'quote',expectedCost:'20'})).status,409);
  assert.equal((await h.post('prepare')).status,202);assert.equal(h.commands.length,1);
  assert.equal(h.commands[0].payload.action,'prepare');assert.equal(h.commands[0].payload.model.dataBase64,Buffer.from('original complete character').toString('base64'));
});

test('failed preparation without a task ID resumes the same job and import identity once',async t=>{
  const h=await harness(t,'attention','prepare'),jobId=h.job().id;delete h.job().taskId;
  h.job().error='RIG_UNITY_PRESET_NOT_VERIFIED';
  const results=await Promise.all([h.post('check'),h.post('check')]);
  assert(results.some(r=>r.status===200));assert.equal(h.commands.length,1);
  assert.equal(h.job().id,jobId);assert.equal(h.job().stage,'preparing');assert.equal(h.job().error,undefined);
  assert.equal(h.commands[0].payload.action,'prepare');assert.equal(h.commands[0].payload.operationId,jobId);
  assert.equal(h.commands[0].payload.groupKey,createHash('sha256').update('projectplacement'+h.job().sourceHash).digest('hex'));
});

test('preparation recovery refuses a changed source instead of uploading another model',async t=>{
  const h=await harness(t,'attention','prepare');h.job().sourceHash='a'.repeat(64);
  assert.equal((await h.post('check')).status,409);assert.equal(h.commands.length,0);
});

test('replacing an input can stop only the exact read-only monitor, preserving the remote task and spending nothing',async t=>{
 const h=await harness(t,'running','monitor'),task=h.job().taskId,body={confirm:true,jobId:h.job().id};
 assert.equal((await h.post('stop-tracking',{...body,confirm:false})).status,409);
 assert.equal((await h.post('stop-tracking',{...body,jobId:'other'})).status,409);
 const result=await h.post('stop-tracking',body);assert.equal(result.status,200);assert.equal(result.data.remoteTaskCancelled,false);assert.equal(h.job().stage,'stopped');assert.equal(h.job().taskId,task);assert.equal(h.commands.length,0);
 assert.equal((await h.post('stop-tracking',body)).status,200);
});
test('stopping tracking cannot interrupt an uncertain paid submission or a model download',async t=>{
 for(const action of ['submit','download','prepare']){
  const h=await harness(t,'running',action);assert.equal((await h.post('stop-tracking',{confirm:true,jobId:h.job().id})).status,409);assert.equal(h.job().stage,'running');assert.equal(h.commands.length,0);
 }
});

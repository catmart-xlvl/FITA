import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {Store,emptyProject} from '../server/storage.js';
import {snapshot,present} from '../server/lineage.js';
import {mountTextureWorkflow,textureCurrent,inspectTextureGlb} from '../server/texture-workflow.js';
import {placementSettings,placementCurrent} from '../server/placement.js';

test('texture endpoint excludes transfer previews until finishing is complete',async t=>{
 const h=await harness(t);h.p.textures=[{id:'intermediate',group:'head',supervisedPending:true,url:'/intermediate.glb'}];
 const hidden=await h.call('');assert.equal(hidden.data.previewPending,true);assert.deepEqual(hidden.data.textures,[]);
 h.p.textures=[];const initial=await h.call('');assert.equal(initial.data.previewPending,false);
});

async function harness(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'textures-')),store=new Store(root);await store.init();const p=emptyProject('Texture fixture');
  p.reference={id:randomUUID()+'.png'};p.referenceState={status:'ready',referenceId:p.reference.id};
  for(const group of ['head','body']){
    const view=await store.asset(p,await fs.readFile('fixtures/'+group+'-front.png'),'png','importado');p.groups[group].views.front=view;p.groups[group].selectedViews=['front'];
    const model={id:randomUUID()+'.glb',group,source:'importado',lineage:snapshot(p),studioTaskId:randomUUID()};p.models.push(model);p.groups[group].selectedModelId=model.id;
  }
  await store.save(p);const ops=new Map(),commands=[];
  const bridge={status:()=>({controlAvailable:true,pending:null}),enqueue(type,payload,context){const op={id:randomUUID(),status:'queued',type,context,createdAt:new Date().toISOString()};ops.set(op.id,op);commands.push({type,payload});return op;},getOperation:id=>ops.get(id)};
  const app=express();app.use(express.json());const workflow=mountTextureWorkflow(app,{store,bridge,gate:()=>{},editable:()=>{},presentProject:present,downloadsDir:root});app.use((e,q,r,n)=>r.status(e.status||500).json({error:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/textures${route}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  const complete=(id,result)=>Object.assign(ops.get(id),{status:'succeeded',result});
  async function prepare(resolution='2K',group='head',removeLighting=false){
    const r=await call('/prepare',{group,settings:{resolution,removeLighting},confirmUpload:true});assert.equal(r.status,202);const o=r.data.operation;
    const result={mode:'texture',stage:'prepared',preparationReady:true,inputsVerified:true,costLabel:resolution==='2K'?'10':resolution==='4K'?'20':'30',options:{texture:{removeLighting:o.settings.removeLighting,resolution:o.settings.resolution}},pageSignature:randomUUID(),snapshot:{currentTaskId:o.sourceTaskId},expectedInputs:[{slot:'front',sha256:'a'.repeat(64)}]};
    complete(o.id,result);await call('');return {...o,result};
  }
  return {p,root,store,ops,commands,call,complete,prepare,advance:()=>workflow.advance(p.id)};
}

test('automatic texture tracking queues monitor then versioned export once, retaining the initial estimate',async t=>{
 const h=await harness(t),prepared=await h.prepare(),s=await h.call('/submit',{operationId:prepared.id,confirmCost:true,expectedCost:'10',autoTrack:true});
 h.complete(s.data.operation.id,{stage:'submitted',currentTaskId:prepared.sourceTaskId,processing:true,estimatedSeconds:60});await h.advance();
 const submission=h.p.textureOperations.find(o=>o.id===s.data.operation.id),m=h.p.textureOperations.at(-1);assert.equal(m.type,'monitor');assert.equal(submission.estimate.seconds,60);assert.equal(h.commands.at(-1).payload.processingObserved,true);
 h.complete(m.id,{stage:'processing',processing:true,estimatedSeconds:20});await h.advance();assert.equal(submission.estimate.seconds,60);
 const m2=h.p.textureOperations.at(-1);h.complete(m2.id,{stage:'ready'});await Promise.all([h.advance(),h.advance()]);
 assert.equal(h.commands.filter(c=>c.type==='export').length,1);assert.equal(h.commands.at(-1).payload.exportRevision,submission.id);assert.equal(h.commands.filter(c=>c.type==='submit').length,1);
});

test('head and body can retexture at a new resolution and lighting setting, keep old assets on failure and export distinct revisions',async t=>{
 const h=await harness(t);
 const image=(await fs.readFile('fixtures/head-front.png')).toString('base64');
 const d={asset:{version:'2.0'},meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{uri:'data:image/png;base64,'+image}]};
 const text=JSON.stringify(d),json=Buffer.from(text.padEnd(Math.ceil(text.length/4)*4,' ')),b=Buffer.alloc(20+json.length);b.write('glTF');b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);
 const file=path.join(h.root,'round.glb');await fs.writeFile(file,b);
 async function round(group,resolution,removeLighting){
  const prepared=await h.prepare(resolution,group,removeLighting),s=await h.call('/submit',{operationId:prepared.id,confirmCost:true,expectedCost:prepared.result.costLabel,autoTrack:true});assert.equal(s.status,202);
  h.complete(s.data.operation.id,{stage:'submitted',currentTaskId:prepared.sourceTaskId,processing:true});await h.advance();
  h.complete(h.p.textureOperations.at(-1).id,{stage:'ready'});await h.advance();
  const exportOp=h.p.textureOperations.at(-1);assert.equal(exportOp.type,'export');assert.equal(h.commands.at(-1).payload.exportRevision,s.data.operation.id);
  h.complete(exportOp.id,{stage:'saved',download:{path:file,taskId:prepared.sourceTaskId}});await h.call('');return h.p.textures.at(-1);
 }
 const head=await round('head','2K',false),body=await round('body','2K',false),placement={sources:{head:head.id,body:body.id}};
 assert(placementCurrent(h.p,placement));
 const head2=await round('head','4K',true);assert.notEqual(head.id,head2.id);assert.equal(placementCurrent(h.p,placement),false);
 const body2=await round('body','8K',false);assert.notEqual(body.id,body2.id);assert.equal(h.p.textures.length,4);assert.equal(h.p.models.length,2);
 for(const asset of [head,body,head2,body2])assert(await fs.stat(path.join(h.root,h.p.id,asset.id)));
 const exports=h.commands.filter(c=>c.type==='export');assert.equal(new Set(exports.map(c=>c.payload.exportRevision)).size,4);
 const failed=await h.prepare('4K','body',true);Object.assign(h.ops.get(failed.id),{status:'failed',error:'fixture failure'});await h.call('');assert.equal(h.p.textures.at(-1).id,body2.id);
 assert.equal(h.commands.filter(c=>c.type==='submit').length,4);
});
test('resolution changes invalidate the old price, require observed matching settings, and consume a quote only once',async t=>{
  const h=await harness(t),p=await h.prepare();
  const next=await h.call('/quote',{operationId:p.id,settings:{resolution:'4K',removeLighting:false}});assert.equal(next.status,202);
  assert.equal((await h.call('/submit',{operationId:p.id,confirmCost:true,expectedCost:'10'})).status,409);
  const o=next.data.operation;
  h.complete(o.id,{...p.result,stage:'observed',costLabel:'20',options:{texture:o.settings},pageSignature:'new-resolution'});
  assert.equal((await h.call('/submit',{operationId:o.id,confirmCost:true,expectedCost:'10'})).status,409);
  const attempts=await Promise.all([1,2].map(()=>h.call('/submit',{operationId:o.id,confirmCost:true,expectedCost:'20'})));
  assert.deepEqual(attempts.map(x=>x.status).sort(),[202,409]);
  assert.equal(h.commands.filter(c=>c.type==='submit').length,1);
  assert.equal(h.commands.at(-1).payload.expectedSnapshot.options.texture.resolution,'4K');
  assert.equal(h.commands.at(-1).payload.workflow,'texture');
});
test('choice changes and settings mismatch cannot submit; both selections are required',async t=>{
  const h=await harness(t),p=await h.prepare();
  h.p.groups.head.selectedModelId='different';assert.equal((await h.call('/submit',{operationId:p.id,confirmCost:true,expectedCost:'10'})).data.error,'TEXTURE_SOURCE_CHANGED');
  assert.equal((await h.call('/prepare',{group:'head',settings:{resolution:'8K',removeLighting:false},confirmUpload:true})).data.error,'TEXTURE_CHOOSE_BOTH');
  h.p.groups.head.selectedModelId=p.sourceModelId;
  h.complete(p.id,{...p.result,options:{texture:{resolution:'8K',removeLighting:false}}});
  assert.equal((await h.call('/submit',{operationId:p.id,confirmCost:true,expectedCost:'10'})).status,409);
  assert.equal(h.commands.filter(c=>c.type==='submit').length,0);
});
test('texture export validates embedded color maps, imports once, preserves sources, and derived placement follows both choices',async t=>{
  const h=await harness(t),p=await h.prepare(),s=await h.call('/submit',{operationId:p.id,confirmCost:true,expectedCost:'10'}),sid=s.data.operation.id;
  h.complete(sid,{stage:'submitted',existingTaskIds:[p.sourceTaskId]});
  assert.equal((await h.call('/confirm-task',{operationId:sid,confirmTask:true,taskId:p.sourceTaskId})).status,409);
  const taskId=randomUUID();await h.call('/confirm-task',{operationId:sid,confirmTask:true,taskId});
  const m=await h.call('/monitor',{operationId:sid});h.complete(m.data.operation.id,{stage:'ready'});
  const e=await h.call('/export',{operationId:m.data.operation.id}),file=path.join(h.root,'texture.glb');
  const d={asset:{version:'2.0'},meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{uri:'data:image/png;base64,'+(await fs.readFile('fixtures/head-front.png')).toString('base64')}]};
  const json=Buffer.from(JSON.stringify(d).padEnd(Math.ceil(JSON.stringify(d).length/4)*4,' ')),b=Buffer.alloc(20+json.length);b.write('glTF');b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);
  assert.equal(inspectTextureGlb(b).verifiedBaseColor,true);
  await fs.writeFile(file,b);h.complete(e.data.operation.id,{stage:'saved',download:{path:file,taskId}});await Promise.all([h.call(''),h.call('')]);assert.equal(h.p.textures.length,1);assert.equal(h.p.models.length,2);
  const head=h.p.textures[0];assert.equal(textureCurrent(h.p,head),true);h.p.textures.push({...head,id:'body-texture',group:'body',sourceModelId:h.p.groups.body.selectedModelId,fingerprint:(await import('../server/view-set.js')).fingerprintViewSet(h.p,'body')});
  const r={sources:{head:head.id,body:'body-texture'}};assert.equal(placementCurrent(h.p,r),true);h.p.groups.body.selectedModelId='changed';assert.equal(placementCurrent(h.p,r),false);assert.equal(h.p.textures.length,2);
});
test('placement parameters are bounded numeric values and defaults preserve independent parts',()=>{
  assert.deepEqual(placementSettings().offset,[0,0,0]);
  for(const invalid of [{scale:0},{scale:'1'},{rotation:[Infinity,0,0]},{offset:[0,0,5]},{headNeck:1},{bodyNeck:-1}])assert.throws(()=>placementSettings(invalid));
});

test('successful same-source texture submission binds automatically, survives restart and scopes export to its revision',async t=>{
 const h=await harness(t),p=await h.prepare(),s=await h.call('/submit',{operationId:p.id,confirmCost:true,expectedCost:'10'}),sid=s.data.operation.id;
 h.complete(sid,{stage:'submitted',currentTaskId:p.sourceTaskId,existingTaskIds:[p.sourceTaskId]});
 const refreshed=await h.call(''),submission=refreshed.data.operations.find(o=>o.id===sid);
 assert.equal(submission.taskId,p.sourceTaskId);assert.equal(submission.taskBinding,'texture-on-selected-source');
 delete h.p.textureOperations.find(o=>o.id===sid).taskId;h.ops.delete(sid);
 await h.call('');assert.equal(h.p.textureOperations.find(o=>o.id===sid).taskId,p.sourceTaskId);
 const m=await h.call('/monitor',{operationId:sid});assert.equal(m.status,202);h.complete(m.data.operation.id,{stage:'ready'});
 const e=await h.call('/export',{operationId:m.data.operation.id});assert.equal(e.status,202);assert.equal(h.commands.at(-1).payload.exportRevision,sid);assert.equal(h.commands.at(-1).payload.taskId,p.sourceTaskId);
});

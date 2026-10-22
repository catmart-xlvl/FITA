import {workspaceFiles} from './local-workspace-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import yauzl from 'yauzl';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {slots,modelSlots,manifestFor,zipBuffers} from '../server/codex-handoff.js';

// Deliberately synthetic transport fixtures, never presented as generated character art.
const images=Object.fromEntries(await Promise.all(slots.map(async(s,i)=>[s.file,await sharp({create:{width:510,height:510,channels:4,background:{r:30+i*20,g:80,b:150,alpha:1}}}).extend({top:1,bottom:1,left:1,right:1,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer()])));
function unzip(buffer){return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(error,zip)=>{
  if(error)return reject(error);const result={};zip.on('error',reject);zip.on('end',()=>resolve(workspaceFiles(result)));
  zip.on('entry',entry=>zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const chunks=[];stream.on('error',reject);stream.on('data',b=>chunks.push(b));stream.on('end',()=>{result[entry.fileName]=Buffer.concat(chunks);zip.readEntry();});}));zip.readEntry();
}));}
async function harness(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'.codex-delivery-'));let now=Date.now();
  let instance=await createApp({dataDir:dir,providers:{image(){throw Error('No generation allowed');}},codexDeliveryOptions:{now:()=>now}}),server,base,csrf;
  async function start(){server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;csrf=(await(await fetch(base+'/api/session')).json()).token;}
  await start();t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
  async function call(route,body,method=body?'POST':'GET'){
    const response=await fetch(base+'/api'+route,{method,headers:{'x-workbench-token':csrf,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};
  }
  async function create(name='Delivery test'){
    const {data:p}=await call('/projects',{name}),form=new FormData();form.set('kind','reference');form.set('file',new Blob([images['body_front.png']]),'concept.png');
    assert.equal((await call(`/projects/${p.id}/upload`,form)).status,200);assert.equal((await call(`/projects/${p.id}/confirm-reference`,{})).status,200);return p.id;
  }
  const id=await create();
  async function issue(pid=id,replace=false,renew=false){const result=await call(`/projects/${pid}/codex/delivery`,{replace,renew});assert.equal(result.status,201,JSON.stringify(result.data));const r=await fetch(base+result.data.downloadUrl);assert.equal(r.status,200);const files=await unzip(Buffer.from(await r.arrayBuffer()));return {files,descriptor:JSON.parse(files['ENTREGA_LOCAL.json']),result:result.data};}
  async function send(g,zip,headers={}){const r=await fetch(base+`/api/codex-deliveries/${g.deliveryId}`,{method:'POST',headers:{Authorization:`Bearer ${g.token}`,'Content-Type':'application/zip',...headers},body:zip});return {status:r.status,data:await r.json()};}
  return {dir,id,call,create,issue,send,get base(){return base;},get store(){return instance.store;},p:()=>instance.store.get(id),zip:(p=instance.store.get(id),overrides={})=>zipBuffers({...images,'manifest.json':Buffer.from(JSON.stringify(manifestFor(p))),...overrides}),expire:()=>{now+=25*60*60*1000;},restart:async()=>{await new Promise(r=>server.close(r));instance=await createApp({dataDir:dir,codexDeliveryOptions:{now:()=>now}});await start();}};
}

test('downloaded standalone helper delivers all eight views over real HTTP and persists an idempotent receipt',async t=>{
  const h=await harness(t),{files,descriptor}=await h.issue(),reference=structuredClone(h.p().reference);
  assert.deepEqual(Object.keys(files).sort(),['concept.png','manifest.json','PROMPT.txt','INSTRUCCIONES.txt','ENTREGA_LOCAL.json','ENTREGAR_VISTAS.mjs','POSE_T_FRENTE.png','POSE_T.txt'].sort());
  assert.deepEqual(files['concept.png'],await h.store.read(h.p(),h.p().reference));
  for(const text of ['SIMPLIFICACIÓN PARA LAS OCHO VISTAS','microdetalles','PNG RGBA','ENTREGA AUTOMÁTICA LOCAL'])assert.ok(files['PROMPT.txt'].toString().includes(text));
  const working=path.join(h.dir,'agent-fixture');await fs.mkdir(working);
  descriptor.endpoint=h.base+new URL(descriptor.endpoint).pathname;
  await fs.writeFile(path.join(working,'ENTREGA_LOCAL.json'),JSON.stringify(descriptor));await fs.writeFile(path.join(working,'ENTREGAR_VISTAS.mjs'),files['ENTREGAR_VISTAS.mjs']);
  const zip=await h.zip();await fs.writeFile(path.join(working,'fita_views.zip'),zip);
  const run=args=>promisify(execFile)(process.execPath,[path.join(working,'ENTREGAR_VISTAS.mjs'),...args],{cwd:working});
  assert.equal(JSON.parse((await run(['--check'])).stdout).status,'WAITING');
  assert.equal(JSON.parse((await run([])).stdout).status,'IMPORTED');
  const receipt=JSON.parse(await fs.readFile(path.join(working,'ENTREGA_RECIBO.json')));assert.equal(receipt.projectId,h.id);
  assert.deepEqual(Object.keys(h.p().placementReferences).sort(),['front','left']);
  assert.equal(h.p().codexImports[0].assets.length,10);
  assert.deepEqual(h.p().reference,reference);assert.equal(h.p().models.length,0);assert.equal(h.p().jobs.length,0);
  for(const group of ['head','body']){assert.equal(Object.keys(h.p().groups[group].views).length,4);assert.equal(h.p().groups[group].approved,false);}
  const visible=await fetch(h.base+h.p().groups.head.views.front.url);assert.equal(visible.status,200);assert.equal((await sharp(Buffer.from(await visible.arrayBuffer())).metadata()).hasAlpha,true);
  assert.equal(JSON.parse((await run([])).stdout).duplicate,true);assert.equal(h.p().codexImports.length,1);
  assert.equal((await fs.readdir(path.join(h.dir,h.id))).length,11);
  await h.restart();assert.equal((await h.send(descriptor,zip)).data.duplicate,true);
});

test('authorization and project manifests prevent cross-project delivery, without leaking tokens to project state',async t=>{
  const h=await harness(t),other=await h.create('Other project'),{descriptor}=await h.issue(),before=JSON.stringify(h.store.get(other));
  assert.equal((await h.send({...descriptor,token:'0'.repeat(64)},await h.zip())).status,401);
  assert.equal((await h.send(descriptor,await h.zip(),{Origin:h.base})).status,403);
  assert.equal((await h.send(descriptor,await h.zip(h.store.get(other)))).status,409);
  assert.equal(JSON.stringify(h.store.get(other)),before);assert.equal(Object.keys(h.p().groups.head.views).length,0);
  assert.ok(!JSON.stringify(h.p()).includes(descriptor.token));assert.ok(!JSON.stringify((await h.call(`/projects/${h.id}/codex`)).data).includes(descriptor.token));
  assert.equal((await h.send(descriptor,await h.zip())).status,200);
});

test('old concept, notes, changed views, superseded, revoked and expired deliveries cannot replace current work',async t=>{
  const h=await harness(t);
  for(const mutate of [p=>p.referenceRevision++,p=>p.notesRevision++,p=>p.notes='changed',p=>{p.groups.body.views.front={id:'new.png'};}]){
    const {descriptor}=await h.issue(h.id,true),zip=await h.zip();mutate(h.p());await h.store.save(h.p());
    const before=JSON.stringify(h.p());assert.equal((await h.send(descriptor,zip)).data.error,'CODEX_DELIVERY_STALE');assert.equal(JSON.stringify(h.p()),before);
  }
  const a=await h.issue(h.id,true),b=await h.issue(h.id,true);
  assert.deepEqual(a.descriptor,b.descriptor);assert.equal(b.result.reused,true);
  await h.call(`/projects/${h.id}/codex/delivery/revoke`,{});assert.equal((await h.send(b.descriptor,await h.zip())).data.error,'CODEX_DELIVERY_REVOKED');
  const c=await h.issue(h.id,true);h.expire();assert.equal((await h.send(c.descriptor,await h.zip())).status,410);
  assert.equal((await h.call(`/projects/${h.id}/codex/delivery`,{replace:true})).data.error,'CODEX_DELIVERY_RENEW_REQUIRED');
  const renewed=await h.issue(h.id,true,true),old=await h.send(c.descriptor,await h.zip());
  assert.equal(old.data.error,'CODEX_DELIVERY_REVOKED');assert.equal(old.data.currentDelivery.id,renewed.descriptor.deliveryId);assert.equal(old.data.canReuseImages,true);
  assert.equal((await h.send(renewed.descriptor,await h.zip())).status,200);
});

test('incomplete, duplicate, corrupt, opaque and empty images leave no partial views and allow a healthy retry',async t=>{
  const h=await harness(t),{descriptor}=await h.issue();
  const opaque=await sharp(images['body_front.png']).removeAlpha().png().toBuffer(),empty=await sharp({create:{width:512,height:512,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  for(const zip of [Buffer.from('broken'),await zipBuffers({'manifest.json':Buffer.from('{}')}),await h.zip(h.p(),{'head_back.png':images['head_front.png']}),await h.zip(h.p(),{'head_back.png':Buffer.from('bad')}),await h.zip(h.p(),{'head_back.png':opaque}),await h.zip(h.p(),{'head_back.png':empty})]){
    assert.equal((await h.send(descriptor,zip)).status,400);assert.equal(Object.keys(h.p().groups.head.views).length,0);assert.equal((await fs.readdir(path.join(h.dir,h.id))).length,1);
  }
  assert.equal((await h.send(descriptor,await h.zip())).status,200);
});

test('concurrent sends commit exactly once; a used delivery rejects a different ZIP',async t=>{
  const h=await harness(t),{descriptor}=await h.issue(),zip=await h.zip();
  const results=await Promise.all([h.send(descriptor,zip),h.send(descriptor,zip)]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.deepEqual(results.map(r=>r.data.duplicate).sort(),[false,true]);
  assert.equal(h.p().codexImports.length,1);assert.equal((await h.send(descriptor,Buffer.from('different'))).data.error,'CODEX_DELIVERY_ALREADY_USED');
});

test('disk failures and active texture work preserve all original assets and permit retry',async t=>{
  const h=await harness(t),{descriptor}=await h.issue(),zip=await h.zip(),asset=h.store.asset.bind(h.store);let count=0;
  h.store.asset=async(...args)=>{if(++count===3)throw Error('Disk failure fixture');return asset(...args);};
  assert.equal((await h.send(descriptor,zip)).status,500);assert.equal((await fs.readdir(path.join(h.dir,h.id))).length,1);h.store.asset=asset;
  h.p().textureOperations=[{status:'running'}];assert.equal((await h.send(descriptor,zip)).status,409);h.p().textureOperations=[];
  assert.equal((await h.send(descriptor,zip)).status,200);
  assert.equal((await h.call(`/projects/${h.id}/codex/delivery`,{replace:false})).status,409);
});

test('project trash and restore preserve its assets, isolate siblings, and revoke outstanding deliveries',async t=>{
  const h=await harness(t),other=await h.create('Independent'),{descriptor}=await h.issue(),zip=await h.zip(),old=h.p(),reference=await h.store.read(old,old.reference),before=JSON.stringify(h.store.get(other));
  const deleted=await h.call(`/projects/${h.id}`,undefined,'DELETE');assert.equal(deleted.status,200);
  assert.equal((await h.call(`/projects/${h.id}`)).status,404);assert.equal((await h.send(descriptor,zip)).status,404);assert.equal((await h.call('/projects')).data.length,1);
  await assert.rejects(h.store.save(old),/Proyecto no encontrado/);assert.equal(JSON.stringify(h.store.get(other)),before);
  await h.restart();assert.equal((await h.call('/project-trash')).data.length,1);
  assert.equal((await h.call(`/project-trash/${deleted.data.id}/restore`,{})).status,200);assert.deepEqual(await h.store.read(h.p(),h.p().reference),reference);
  assert.equal((await h.send(descriptor,zip)).data.error,'CODEX_DELIVERY_REVOKED');assert.equal((await h.call('/project-trash')).data.length,0);
});

test('deletion refuses active jobs and operations and never bypasses local CSRF',async t=>{
  const h=await harness(t);
  for(const [key,record] of [['jobs',{status:'running'}],['textureOperations',{status:'unknown'}],['placements',{status:'queued'}],['studioOperations',{status:'running'}]]){
    h.p()[key]=[record];assert.equal((await h.call(`/projects/${h.id}`,undefined,'DELETE')).status,409);h.p()[key]=[];
  }
  assert.equal((await fetch(h.base+`/api/projects/${h.id}`,{method:'DELETE'})).status,403);assert.equal((await h.call('/projects')).data.length,1);
});

test('an outstanding package survives restart and replacement retains all previous view files',async t=>{
  const h=await harness(t),first=await h.issue(),zip=await h.zip();await h.restart();
  assert.equal((await h.send(first.descriptor,zip)).status,200);
  const old=h.p().groups.body.views.front;
  const second=await h.issue(h.id,true);assert.equal((await h.send(second.descriptor,zip)).status,200);
  assert.equal(h.p().viewHistory.length,8);assert.ok(await h.store.read(h.p(),old));assert.equal(h.p().codexImports.length,2);
});

test('deletion during staging cannot resurrect a project or alter a sibling',async t=>{
  const h=await harness(t),other=await h.create(),{descriptor}=await h.issue(),zip=await h.zip();
  const asset=h.store.asset.bind(h.store);let deleted;
  h.store.asset=async(...args)=>{const result=await asset(...args);if(!deleted)deleted=await h.store.trash(h.id);return result;};
  assert.equal((await h.send(descriptor,zip)).status,404);
  assert.throws(()=>h.p(),/Proyecto no encontrado/);assert.equal(Object.keys(h.store.get(other).groups.head.views).length,0);
  await h.store.restore(deleted.id);assert.equal(Object.keys(h.p().groups.head.views).length,0);assert.equal(h.p().codexImports?.length||0,0);
});

test('recovery rolls interrupted trash and restore asset moves back without mixing projects',async t=>{
  const h=await harness(t),old=h.p(),trashId='00000000-0000-4000-8000-000000000001',dir=path.join(h.dir,'.trash',trashId);
  await fs.mkdir(dir);await fs.writeFile(path.join(dir,'record.json'),JSON.stringify({id:trashId,projectId:old.id,name:old.name,deletedAt:new Date().toISOString()}));
  await fs.rename(path.join(h.dir,old.id),path.join(dir,'assets'));
  await h.restart();assert.ok(await h.store.read(h.p(),h.p().reference));assert.equal((await h.store.listTrash()).length,0);
  const deleted=await h.store.trash(old.id),entry=path.join(h.dir,'.trash',deleted.id);
  await fs.rename(path.join(entry,'assets'),path.join(h.dir,old.id));await h.restart();
  assert.throws(()=>h.p(),/Proyecto no encontrado/);assert.equal((await h.store.listTrash()).length,1);
  await h.store.restore(deleted.id);assert.ok(await h.store.read(h.p(),h.p().reference));
});

 test('new automatic grants require ten images; outstanding v1 grants still accept their original eight',async t=>{
  const h=await harness(t),{descriptor}=await h.issue(),legacy=manifestFor(h.p(),{legacy:true});
  const files=Object.fromEntries(modelSlots.map(s=>[s.file,images[s.file]]));files['manifest.json']=Buffer.from(JSON.stringify(legacy));const zip=await zipBuffers(files);
  assert.equal((await h.send(descriptor,zip)).status,409);assert.equal(h.p().codexImports?.length||0,0);
  // Simulate a persisted grant created by the previous application version.
  const file=path.join(h.dir,'.codex-deliveries',descriptor.deliveryId+'.json'),grant=JSON.parse(await fs.readFile(file));grant.identity=JSON.stringify(legacy);await fs.writeFile(file,JSON.stringify(grant));await h.restart();
  assert.equal((await h.send(descriptor,zip)).status,200);assert.deepEqual(h.p().placementReferences,{});
 });

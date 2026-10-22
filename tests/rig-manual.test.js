import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import {Store,emptyProject} from '../server/storage.js';
import {mountManualRig} from '../server/rig-manual.js';
import {refinementInstructions} from '../server/rig-refinement.js';

function fixture(){
  const bin=Buffer.alloc(36+12+48+64);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>bin.writeFloatLE(v,i*4));
  for(let i=0;i<3;i++)bin.writeFloatLE(1,48+i*16);
  for(const i of [0,5,10,15])bin.writeFloatLE(1,96+i*4);
  const d={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],nodes:[{name:'Hips'},{name:'Body',mesh:0,skin:0}],meshes:[{primitives:[{attributes:{POSITION:0,JOINTS_0:1,WEIGHTS_0:2}}]}],skins:[{joints:[0],inverseBindMatrices:3}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:12},{buffer:0,byteOffset:48,byteLength:48},{buffer:0,byteOffset:96,byteLength:64}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},{bufferView:1,componentType:5121,count:3,type:'VEC4'},{bufferView:2,componentType:5126,count:3,type:'VEC4'},{bufferView:3,componentType:5126,count:1,type:'MAT4'}]};
  let json=Buffer.from(JSON.stringify(d));json=Buffer.concat([json,Buffer.alloc((-json.length)&3,32)]);const h=Buffer.alloc(20),b=Buffer.alloc(8);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length+bin.length,8);h.writeUInt32LE(json.length,12);h.writeUInt32LE(0x4e4f534a,16);b.writeUInt32LE(bin.length);b.writeUInt32LE(0x004e4942,4);return Buffer.concat([h,json,b,bin]);
}

test('manual exchange binds downloads/uploads to an immutable source and retains imported versions',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'rig-manual-test-')),store=new Store(path.join(temp,'data'));await store.init();
  const p=emptyProject('Manual test'),original=fixture();p.rigDonors=[{id:'donor',sourcePlacementId:'placement',asset:await store.asset(p,original,'glb','fixture'),profile:{humanoid:{Hips:'Hips'}}}];await store.save(p);
  const calls=[];
  const app=express();app.use(express.json());mountManualRig(app,{store,editable:()=>{},riggingSource:()=>({id:'placement'}),runExchange:async(folder,job)=>{
    calls.push(job.mode);if(job.mode==='export'){await fs.writeFile(path.join(folder,'model.fbx'),'Kaydara FBX Binary');await fs.writeFile(path.join(folder,'fbx-reference.json'),'{}');}
    else{await fs.copyFile(path.join(folder,'model.glb'),job.output);await fs.writeFile(job.report,JSON.stringify({addedBones:[],reviewRequired:true}));}
  }});app.use((e,q,s,n)=>s.status(e.status||500).json({error:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(temp,{recursive:true,force:true});});
  const root=`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/rigging/manual`;
  const post=async(url,body)=>{const r=await fetch(root+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});return {status:r.status,data:await r.json()};};
  const first=await post('/prepare',{kind:'donor',id:'donor'});assert.equal(first.status,200);const id=first.data.id;
  assert.equal((await post('/prepare',{kind:'donor',id:'donor'})).data.id,id);
  const download=await fetch(root+`/${id}/model.glb`);assert((await download.arrayBuffer()).byteLength===original.length);assert.match(download.headers.get('content-disposition'),/attachment/);
  assert.equal((await post(`/${id}/fbx`)).status,200);assert.equal((await post(`/${id}/fbx`)).status,200);assert.deepEqual(calls,['export']);
  const upload=async()=>{const body=new FormData();body.append('file',new Blob([original]),'edited.glb');const r=await fetch(root+`/${id}/import`,{method:'POST',body});return {status:r.status,data:await r.json()};};
  const accepted=await upload();assert.equal(accepted.status,200);assert.equal(accepted.data.edits.length,1);assert.equal(accepted.data.edits[0].current,true);
  assert.equal((await upload()).data.duplicate,true);assert.deepEqual(calls,['export','import']);
  assert((await store.read(store.get(p.id),store.get(p.id).rigDonors[0].asset)).equals(original));
  const next=structuredClone(store.get(p.id));next.rigDonors.push({...next.rigDonors[0],id:'new-donor'});await store.save(next);
  assert.equal((await upload()).status,409);assert.equal((await fetch(root).then(r=>r.json())).edits[0].current,false);
});

test('refinement handoff fixes twenty-six support roles and explicitly defers new shape keys',async()=>{
  const profile=JSON.parse(await fs.readFile('templates/rigs/auxiliary-v1.json','utf8'));
  const names=profile.sides.flatMap(side=>profile.requiredBonesPerSide.map(b=>b.name.replace('{side}',side)));
  assert.equal(names.length,26);assert.equal(new Set(names).size,26);
  assert.equal(profile.requiredBonesPerSide.filter(b=>b.kind==='twist').length,9);
  assert.equal(profile.requiredBonesPerSide.filter(b=>b.kind==='bone-corrective').length,2);
  for(const b of profile.requiredBonesPerSide.filter(b=>b.mode==='swing-twist'))assert.equal(b.headFraction,0,'Swing must pivot at the anatomical joint');
  assert.equal(profile.requiredBonesPerSide.filter(b=>b.kind==='secondary').length,2);
  assert.equal(profile.reviewPoses.length,14);
  const text=refinementInstructions({workspace:'test',projectName:'test'});
  assert.match(text,/AUXILIARY_PROFILE.json/);assert.match(text,/Do NOT create new corrective shape keys/);assert.match(text,/opposite-leg and opposite-arm leakage/);
});

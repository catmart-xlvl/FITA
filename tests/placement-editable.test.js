import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {mountPlacementEditable} from '../server/placement-editable.js';

test('editable placement downloads preserve sources and cache by source and topology reference',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wb-editable-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const p={id:'project',placements:[{id:'placed',status:'succeeded',blend:{id:'base'},sources:{head:'head',body:'body'}}],textures:[{id:'head',segmentationId:'seg'},{id:'body',segmentationId:'seg'}],segmentations:[{id:'seg',reconstruction:{blend:{id:'reference'}}}]};
  const original=JSON.stringify(p),assets={base:Buffer.from('original placement'),reference:Buffer.from('original topology')};
  let calls=0;
  const app=express();mountPlacementEditable(app,{store:{root,get:()=>p,read:async(_,a)=>assets[a.id]},blenderPath:async()=>'/blender',convert:async(exe,file,progress,script)=>{
    calls++;assert.equal(script,'export_connected_placement.py');const job=JSON.parse(await fs.readFile(file));
    assert.deepEqual(await fs.readFile(job.input),assets.base);assert.deepEqual(await fs.readFile(job.reference),assets.reference);
    await fs.writeFile(job.blend,'connected blend');await fs.writeFile(job.fbx,'connected fbx');await fs.writeFile(job.report,'{}');
  }});
  app.use((e,q,s,n)=>s.status(e.status||500).json({error:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}/api/projects/project/placement/placed/editable/`;
  const [a,b]=await Promise.all([fetch(url+'blend'),fetch(url+'fbx')]);
  assert.equal(await a.text(),'connected blend');assert.equal(await b.text(),'connected fbx');assert.equal(calls,1);
  assert.match(b.headers.get('content-disposition'),/character-connected.fbx/);
  await fetch(url+'fbx');assert.equal(calls,1);
  assets.reference=Buffer.from('updated reference');await fetch(url+'fbx');assert.equal(calls,2);
  assert.equal((await fetch(url+'exe')).status,404);assert.equal(JSON.stringify(p),original);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Store,emptyProject} from '../server/storage.js';
import {mountPlacementReferences,placementReferences} from '../server/placement-references.js';
import {placementReferenceInstructions} from '../server/placement-reference-contract.js';
test('placement references are project-local, survive reload and never replace generation views or approval',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'placement-refs-')),store=new Store(dir);await store.init();
 const p=emptyProject('References'),other=emptyProject('Other');await store.save(p);await store.save(other);
 const untouched=JSON.stringify(p.groups),app=express();mountPlacementReferences(app,{store,editable:()=>{}});app.use((e,q,r,n)=>r.status(e.status||400).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/placement/references`;
 const send=async(side,bytes)=>{const body=new FormData();body.set('file',new Blob([bytes]),'reference.png');return fetch(base+'/'+side,{method:'POST',body});};
 const png=await fs.readFile('fixtures/head-front.png');assert.equal((await send('right',png)).status,400);assert.equal((await send('front',Buffer.from('not image'))).status,400);
 assert.equal((await send('front',png)).status,200);assert.equal((await send('left',png)).status,200);
 assert.equal(JSON.stringify(p.groups),untouched);assert.deepEqual(placementReferences(other),{front:null,left:null});
 const reopened=new Store(dir);await reopened.init();assert.deepEqual(placementReferences(reopened.get(p.id)),placementReferences(p));
 const packageResponse=await fetch(base+'/package');assert.equal(packageResponse.status,404);
});
test('old perspective placement renders are not silently used as orthographic guides',()=>{
 assert.deepEqual(placementReferences({placements:[{references:{front:{url:'old'},left:{url:'perspective'}}}]}),{front:null,left:null});
 assert.match(placementReferenceInstructions,/NO sustituyen las ocho vistas/);assert.match(placementReferenceInstructions,/una sola silueta de brazo y una de pierna/);
});

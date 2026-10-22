import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,emptyProject} from '../server/storage.js';
import {replaceManualModelFiles} from '../server/manual-model-files.js';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'single-model-files-')),store=new Store(root);await store.init();const p=emptyProject('Atomic model');await store.save(p);t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,store,p};}

test('single model replacement restores both files and project metadata on disk failure',async t=>{
 const {store,p}=await fixture(t);let assets;
 await replaceManualModelFiles(store,p,'first',{blend:Buffer.from('BLENDERfirst'),glb:Buffer.from('first-glb')},null,async a=>{assets=a;p.manualPlacement={id:'first',modelSnapshot:a};await store.save(p);});
 await assert.rejects(replaceManualModelFiles(store,p,'second',{blend:Buffer.from('BLENDERsecond'),glb:Buffer.from('second-glb')},assets,async()=>{throw Error('disk failure');}),/disk failure/);
 assert.equal((await store.read(p,assets.blend)).toString(),'BLENDERfirst');assert.equal((await store.read(p,assets.preview)).toString(),'first-glb');assert.equal(store.get(p.id).manualPlacement.id,'first');assert.deepEqual((await fs.readdir(path.join(store.root,p.id))).sort(),[assets.blend.id,assets.preview.id].sort());
});

for(const committed of [false,true])test(`startup recovers an interrupted pair replacement (${committed?'committed':'uncommitted'})`,async t=>{
 const {root,store,p}=await fixture(t),dir=path.join(root,p.id);await fs.mkdir(dir,{recursive:true});const files=['blend','glb'].map(ext=>{const id=randomUUID()+'.'+ext;return {id,staged:id+'.new',backup:id+'.rollback',hadOriginal:true};});
 p.manualPlacement={id:committed?'new-save':'old-save'};await store.save(p);
 for(const f of files){await fs.writeFile(path.join(dir,f.id),'new-'+f.id);await fs.writeFile(path.join(dir,f.backup),'old-'+f.id);}
 await fs.writeFile(path.join(dir,'manual-model-transaction.json'),JSON.stringify({manualId:'new-save',files}));
 const reload=new Store(root);await reload.init();for(const f of files)assert.equal(await fs.readFile(path.join(dir,f.id),'utf8'),(committed?'new-':'old-')+f.id);assert.deepEqual((await fs.readdir(dir)).sort(),files.map(f=>f.id).sort());assert.equal(reload.get(p.id).manualPlacement.id,committed?'new-save':'old-save');
});

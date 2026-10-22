import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {emptyProject} from '../server/storage.js';
import {workflowStage,rewindProject} from '../server/workflow-stages.js';
import {createApp} from '../server/app.js';

function project(){
 const p=emptyProject('Workflow test');
 for(const g of ['head','body'])p.groups[g]={views:{front:{id:g+'.png'}},approved:true,selectedModelId:g};
 p.models=[{id:'head'},{id:'body'}];p.segmentations=[{id:'seg',groups:[]}];p.textures=[{id:'texture'}];
 p.manualPlacement={id:'manual',transforms:{head:{scale:1.2}},heightCm:170};p.placements=[{id:'placement'}];p.riggingRuns=[{id:'rig'}];
 p.segmentTexturePlan={id:'plan'};p.textureSupervisorId='old';p.segmentationDeliveryId='old-analysis';
 return p;
}
test('rewind requires explicit confirmation and latest revision; removes only downstream active work',()=>{
 const p=project(),before=structuredClone(p);assert.equal(workflowStage(p),5);
 assert.throws(()=>rewindProject(p,{stage:1,confirm:false,expectedRevision:0}),/CONFIRMATION/);
 assert.throws(()=>rewindProject(p,{stage:1,confirm:true,expectedRevision:99}),/PROJECT_CHANGED/);
 const {next,archive}=rewindProject(p,{stage:1,confirm:true,expectedRevision:0});
 assert.deepEqual(p,before);assert.deepEqual(archive.previous,p);assert.equal(workflowStage(next),1);
 assert.deepEqual(next.groups.head.views,p.groups.head.views);assert.equal(next.groups.head.approved,false);assert.deepEqual(next.models,[]);
 for(const k of ['segmentations','textures','manualPlacement','placements','riggingRuns','textureSupervisorId','segmentationDeliveryId'])assert.equal(next[k],undefined,k);
 assert.equal(next.workflowEpoch,1);assert.equal(next.revision,1);
});
test('reopening placement retains the chosen transform as draft and invalidates approval/rig only',()=>{
 const p=project(),{next}=rewindProject(p,{stage:4,confirm:true,expectedRevision:0});
 assert.deepEqual(next.manualPlacementDraft.transforms,p.manualPlacement.transforms);
 assert.equal(next.manualPlacementDraft.baseApprovalId,null);assert.equal(next.manualPlacement,undefined);
 assert.equal(next.riggingRuns,undefined);assert.deepEqual(next.textures,p.textures);assert.deepEqual(next.models,p.models);
});
test('API archives active state and keeps asset files before returning editable views',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workflow-rewind-')),{app,store}=await createApp({dataDir:dir});
 const p=project();await store.save(p);const asset=await store.asset(p,Buffer.from('paid model preserved'),'glb','fixture');
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`,token=(await (await fetch(base+'/api/session')).json()).token;
 const res=await fetch(base+`/api/projects/${p.id}/rewind`,{method:'POST',headers:{'Content-Type':'application/json','x-workbench-token':token},body:JSON.stringify({stage:1,confirm:true,expectedRevision:p.revision})});
 assert.equal(res.status,200);assert.equal((await res.json()).workflowStage,1);
 assert.equal(await fs.readFile(path.join(dir,p.id,asset.id),'utf8'),'paid model preserved');
 const history=path.join(dir,p.id,'workflow-history'),names=await fs.readdir(history);assert.equal(names.length,1);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(history,names[0]),'utf8')).previous.riggingRuns,p.riggingRuns);
});
test('only work that may still run blocks a rewind; an old uncertain status check never locks the project',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workflow-rewind-busy-')),{app,store}=await createApp({dataDir:dir});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`,token=(await (await fetch(base+'/api/session')).json()).token;
 const rewind=p=>fetch(base+`/api/projects/${p.id}/rewind`,{method:'POST',headers:{'Content-Type':'application/json','x-workbench-token':token},body:JSON.stringify({stage:4,confirm:true,expectedRevision:p.revision})});
 const old=new Date(Date.now()-10*24*3600e3).toISOString(),now=new Date().toISOString();
 for(const [operation,status] of [[{type:'monitor',status:'unknown',createdAt:old},200],[{type:'submit',status:'unknown',createdAt:old},200],[{type:'submit',status:'unknown',createdAt:now},409],[{type:'monitor',status:'running',createdAt:old},409],[{type:'submit',status:'unknown',createdAt:now,trackingClosed:true},200]]){
  const p=project();p.textureOperations=[{id:'op',...operation}];await store.save(p);
  const res=await rewind(p);assert.equal(res.status,status,JSON.stringify(operation));
  if(status===409)assert.equal((await res.json()).error,'WORKFLOW_BUSY');
 }
});

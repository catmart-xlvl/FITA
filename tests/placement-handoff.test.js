import {workspaceFiles} from './local-workspace-helper.js';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const executeNode=promisify(execFile);
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {Store,emptyProject} from '../server/storage.js';
import {snapshot,present} from '../server/lineage.js';
import {fingerprintViewSet} from '../server/view-set.js';
import {mountPlacementHandoff,placementManifest,readPlacementZip,placementInstructions} from '../server/placement-handoff.js';
import yauzl from 'yauzl';
import {zipBuffers} from '../server/codex-handoff.js';
import {approveManual} from '../server/manual-placement.js';
import {mountPlacement,placementCurrent} from '../server/placement.js';
import {readManualModelSnapshot} from '../server/manual-model-snapshot.js';
import {placementDraft} from '../server/manual-placement.js';
import {workflowStage,rewindProject} from '../server/workflow-stages.js';
import {identityPart} from '../src/placement-math.js';
const png=await fs.readFile('fixtures/head-front.png');
function textured(){const d={asset:{version:'2.0'},meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{uri:'data:image/png;base64,'+png.toString('base64')}]};const text=JSON.stringify(d),json=Buffer.from(text.padEnd(Math.ceil(text.length/4)*4,' ')),b=Buffer.alloc(20+json.length);b.write('glTF');b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);return b;}
async function harness(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'placement-handoff-')),store=new Store(dir);await store.init();const p=emptyProject('Placement fixture');p.reference=await store.asset(p,png,'png','fixture');p.referenceState={status:'ready',referenceId:p.reference.id};
 for(const group of ['head','body']){p.groups[group].views.front=p.reference;const model={id:randomUUID()+'.glb',group,source:'importado',lineage:snapshot(p)};p.models.push(model);p.groups[group].selectedModelId=model.id;(p.textures||=[]).push({...await store.asset(p,textured(),'glb','fixture'),group,sourceModelId:model.id,fingerprint:fingerprintViewSet(p,group)});}
 await store.save(p);const app=express();app.use(express.json());let bakes=0,beforeBake=()=>{},bakeError=null;const bakeModel=async(store,project,manual)=>{bakes++;await beforeBake(project,manual);if(bakeError)throw Error(bakeError);return {'approved.blend':Buffer.from('BLENDERfixture-'+manual.id),'approved.glb':textured()};};mountPlacement(app,{store,editable:()=>{},presentProject:present,blenderPath:async()=>'fake-blender',bakeModel});const delivery=mountPlacementHandoff(app,{store,editable:()=>{},presentProject:present,bake:async()=>({'approved.blend':Buffer.from('BLENDERfixture'),'approved.glb':textured()}),validate:async()=>({approvedPlacementPreserved:true,texturesPreserved:true})});app.use('/api/placement-deliveries',delivery.router);app.use((e,q,r,n)=>r.status(e.status||400).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const manifest=await placementManifest(store,p),files={'manifest.json':Buffer.from(JSON.stringify(manifest)),'placed.glb':textured(),'placed.blend':Buffer.from('BLENDER-v500fixture'),'report.json':Buffer.from(JSON.stringify({reviewRequired:true,independentParts:true,headMeshes:1,bodyMeshes:1,artistReview:{status:'synthetic fixture only'}})),'front.png':png,'right.png':png,'back.png':png};
 const base=`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/placement`;
 const send=async files=>{const form=new FormData();form.set('file',new Blob([Buffer.isBuffer(files)?files:await zipBuffers(files)]),'result.zip');const r=await fetch(base+'/import',{method:'POST',body:form});return {status:r.status,data:await r.json()};};const save=async(extra={})=>{const live=store.get(p.id);const r=await fetch(base+'/manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sources:Object.fromEntries(live.textures.map(x=>[x.group,x.id])),transforms:{head:identityPart(),body:identityPart()},heightCm:175,confirm:true,baseApprovalId:live.manualPlacement?.id||null,...extra})});return {status:r.status,data:await r.json()};};const post=async(route,body={})=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};return {store,p,files,manifest,send,base,save,post,start:()=>post('/handoff'),cancel:()=>post('/unlock',{confirm:true,deliveryId:store.get(p.id).placementHandoff.id}),bakes:()=>bakes,onBake:fn=>beforeBake=fn,bakeError:value=>bakeError=value};
}
test('package requires manual approval; legacy result imports once and preserves original textures',async t=>{
 const h=await harness(t),before=JSON.stringify(h.p.textures);assert.equal((await fetch(h.base+'/package')).status,409);
 // A retry resends the same archive. Repacking changes ZIP timestamps/bytes.
 const upload=await zipBuffers(h.files);
 const a=await h.send(upload);assert.equal(a.status,200,JSON.stringify(a.data));assert.equal(a.data.run.source,'codex');assert.equal(a.data.run.report.reviewRequired,true);assert.equal(Object.keys(a.data.run.renders).length,3);
 const b=await h.send(upload);assert.equal(b.data.duplicate,true);assert.equal(b.data.run.id,a.data.run.id);assert.equal(JSON.stringify(h.store.get(h.p.id).textures),before);
});

test('both anatomical profiles and their references survive import; half-pairs and missing review fail atomically',async t=>{
 const h=await harness(t),before=JSON.stringify(h.store.get(h.p.id));
 const report=JSON.parse(h.files['report.json']);report.proportionReview={front:{compared:true},left:{compared:true},right:{compared:true}};
 const files={...h.files,'report.json':Buffer.from(JSON.stringify(report)),'left.png':png,'reference_front.png':png,'reference_left.png':png,'reference_right.png':png};
 for(const name of ['left.png','reference_left.png','reference_right.png']){
  const incomplete={...files};delete incomplete[name];assert.notEqual((await h.send(incomplete)).status,200);assert.equal(JSON.stringify(h.store.get(h.p.id)),before);
 }
 const invalid=structuredClone(report);delete invalid.proportionReview.left;
 assert.notEqual((await h.send({...files,'report.json':Buffer.from(JSON.stringify(invalid))})).status,200);assert.equal(JSON.stringify(h.store.get(h.p.id)),before);
 const result=await h.send(files);assert.equal(result.status,200,JSON.stringify(result.data));
 assert.deepEqual(Object.keys(result.data.run.renders).sort(),['back','front','left','right']);
 assert.deepEqual(Object.keys(result.data.run.references).sort(),['front','left','right']);
 assert.equal(result.data.run.report.reviewRequired,true);
});
test('cross-project, obsolete sources, missing review and unsafe placement ZIP entries cannot alter the project',async t=>{
 const h=await harness(t),before=JSON.stringify(h.store.get(h.p.id));
 for(const patch of [{'manifest.json':Buffer.from(JSON.stringify({...h.manifest,projectId:randomUUID()}))},{'report.json':Buffer.from('{}')},{'placed.blend':Buffer.from('not blender')},{'placed.glb':Buffer.from('not glb')},{'front.png':Buffer.from('not png')}]){assert.notEqual((await h.send({...h.files,...patch})).status,200);assert.equal(JSON.stringify(h.store.get(h.p.id)),before);}
 const old=h.files;h.p.textures[0].id=randomUUID()+'.glb';assert.notEqual((await h.send(old)).status,200);
 await assert.rejects(readPlacementZip(await zipBuffers({'manifest.json':Buffer.from('{}')})),/INVALID_PACKAGE/);
});

test('full-character references stay with their placement and invalid reference deliveries are atomic',async t=>{
 const h=await harness(t),before=JSON.stringify(h.store.get(h.p.id));
 const report=JSON.parse(h.files['report.json']);report.proportionReview={front:{compared:true},right:{compared:true},note:'Synthetic validation fixture, not visual approval'};
 const files={...h.files,'report.json':Buffer.from(JSON.stringify(report)),'reference_front.png':png,'reference_right.png':png};
 const missing={...files};delete missing['reference_right.png'];
 for(const invalid of [missing,{...files,'reference_right.png':Buffer.from('invalid PNG')},{...files,'report.json':h.files['report.json']},{...files,'unexpected.png':png}]){
  assert.notEqual((await h.send(invalid)).status,200);assert.equal(JSON.stringify(h.store.get(h.p.id)),before);
 }
 const upload=await zipBuffers(files);
 const a=await h.send(upload);assert.equal(a.status,200,JSON.stringify(a.data));assert.deepEqual(Object.keys(a.data.run.references),['front','right']);
 for(const ref of Object.values(a.data.run.references))assert.deepEqual(await h.store.read(h.store.get(h.p.id),ref),png);
 assert.equal(a.data.run.report.reviewRequired,true);assert.deepEqual(a.data.run.report.proportionReview,report.proportionReview);
 const duplicate=await h.send(upload);assert.equal(duplicate.data.duplicate,true);assert.equal(duplicate.data.run.id,a.data.run.id);assert.equal(h.store.get(h.p.id).placements.length,1);
});

test('manual package contains baked approval and height; changed approval invalidates old delivery',async t=>{
 const h=await harness(t),p=h.store.get(h.p.id),sources=Object.fromEntries(p.textures.map(x=>[x.group,x.id]));
 p.manualPlacement=approveManual(p,{sources,transforms:{head:identityPart(),body:identityPart()},heightCm:175,confirm:true});await h.store.save(p);
 assert.equal((await fetch(h.base+'/package')).status,409);assert.equal((await h.save()).status,200);
 assert.equal((await h.start()).status,200);const r=await fetch(h.base+'/package');assert.equal(r.status,200);
 assert.equal(h.bakes(),1);await fetch(h.base+'/package');assert.equal(h.bakes(),1);
 const bytes=Buffer.from(await r.arrayBuffer());const files=await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(e,z)=>{if(e)return reject(e);const result={};z.on('error',reject);z.on('end',()=>resolve(workspaceFiles(result)));z.on('entry',entry=>z.openReadStream(entry,(e,s)=>{if(e)return reject(e);const chunks=[];s.on('data',b=>chunks.push(b));s.on('end',()=>{result[entry.fileName]=Buffer.concat(chunks);z.readEntry();});}));z.readEntry();}));
 assert(files['approved.blend']&&files['approved.glb']);assert(!files['run_placement.py']);assert.equal(JSON.parse(files['manifest.json']).manual.heightCm,175);assert.equal(JSON.parse(files['manifest.json']).schema,'workbench-placement/v3');assert.match(files['INSTRUCCIONES.txt'].toString(),/No vuelvas a ajustar el cuello/);assert.deepEqual(files['approved.blend'],await h.store.read(p,p.manualPlacement.modelSnapshot.blend));assert.match(files['INSTRUCCIONES.txt'].toString(),/NO ejecutes una colocación automática/);
 const delivery={...h.files,'manifest.json':files['manifest.json'],'left.png':png};const imported=await h.send(delivery);assert.equal(imported.status,200);assert.equal(imported.data.run.manualPlacementId,p.manualPlacement.id);
 const live=h.store.get(p.id);live.manualPlacement=approveManual(live,{sources,transforms:{head:identityPart(),body:identityPart()},heightCm:180,confirm:true});await h.store.save(live);
 assert.equal((await h.send(delivery)).data.error,'PLACEMENT_SOURCE_CHANGED');
});

const pins={version:1,pins:[{id:'neck-point',part:'body',mesh:'0:0',vertex:2,center:[0,1,0],delta:[0,.01,0],radius:.08,connectedOnly:true,enabled:true}]};
test('saving materializes a persistent model while preserving editable points and freezing ZIP input independently of drafts',async t=>{
 const h=await harness(t),sources=Object.fromEntries(h.p.textures.map(x=>[x.group,x.id]));
 h.p.manualPlacementDraft=placementDraft(h.p,{sources,transforms:{head:identityPart(),body:identityPart()},heightCm:175,deformers:pins,baseApprovalId:null});
 const a=await h.save({deformers:pins});assert.equal(a.status,200,JSON.stringify(a.data));assert.deepEqual(a.data.manual.deformers,pins);assert.equal(a.data.manual.modelSnapshot.neckLocked,true);assert.equal(a.data.draft,null);
 const model=await readManualModelSnapshot(h.store,h.p,a.data.manual);const version=JSON.stringify(a.data.manual);
 h.p.manualPlacementDraft=placementDraft(h.p,{sources,transforms:{head:identityPart(),body:identityPart()},heightCm:180,deformers:{...pins,pins:pins.pins.map(p=>({...p,delta:[0,.02,0]}))},baseApprovalId:a.data.manual.id});await h.store.save(h.p);
 assert.deepEqual(await readManualModelSnapshot(h.store,h.p,h.p.manualPlacement),model);assert.equal(JSON.stringify(h.p.manualPlacement),version);assert.equal((await h.start()).data.error,'PLACEMENT_MODEL_SAVE_REQUIRED');assert.equal(h.bakes(),1);
 const reloaded=new Store(h.store.root);await reloaded.init();assert.deepEqual(reloaded.get(h.p.id).manualPlacement.deformers,pins);assert.equal(reloaded.get(h.p.id).manualPlacementDraft.heightCm,180);assert.deepEqual(await readManualModelSnapshot(reloaded,reloaded.get(h.p.id),a.data.manual),model);
 const b=await h.save({deformers:h.p.manualPlacementDraft.deformers,heightCm:180});assert.equal(b.status,200);assert.notEqual(b.data.manual.id,a.data.manual.id);assert.equal(h.p.manualModelVersions,undefined);assert.equal(b.data.manual.modelSnapshot.blend.id,a.data.manual.modelSnapshot.blend.id);assert.equal(placementCurrent(h.p,{manualPlacementId:a.data.manual.id,sources}),false);
});
test('failed bake, changed inputs, and failed persistence cannot replace the saved model or leak staged assets',async t=>{
 const h=await harness(t);assert.equal((await h.save({deformers:pins})).status,200);const prior=JSON.stringify(h.p.manualPlacement),assets=await fs.readdir(path.join(h.store.root,h.p.id));
 h.bakeError('SIMULATED_BAKE_FAILURE');assert.equal((await h.save()).status,400);h.bakeError(null);assert.equal(JSON.stringify(h.p.manualPlacement),prior);
 h.onBake(async()=>{h.p.workflowEpoch=(h.p.workflowEpoch||0)+1;});assert.equal((await h.save()).data.error,'PLACEMENT_SOURCE_CHANGED');h.p.workflowEpoch=0;h.onBake(()=>{});
 const save=h.store.save.bind(h.store);h.store.save=async()=>{throw Error('SIMULATED_DISK_FAILURE');};assert.equal((await h.save()).status,400);h.store.save=save;
 assert.equal(JSON.stringify(h.p.manualPlacement),prior);assert.deepEqual((await fs.readdir(path.join(h.store.root,h.p.id))).sort(),assets.sort());
});
test('save locks concurrent model bakes and preserves a newer editable draft arriving during Blender work',async t=>{
 const h=await harness(t);await h.save();const old=h.p.manualPlacement;
 let release,started;const began=new Promise(r=>started=r);h.onBake(async()=>{started();await new Promise(r=>release=r);});const pending=h.save({deformers:pins});await began;
 assert.equal((await h.save()).data.error,'PLACEMENT_RUNNING');
 const sources=old.sources;h.p.manualPlacementDraft=placementDraft(h.p,{sources,transforms:old.transforms,heightCm:190,deformers:pins,baseApprovalId:old.id});release();const saved=await pending;
 assert.equal(saved.status,200);assert.equal(saved.data.draft.heightCm,190);assert.equal(saved.data.draft.baseApprovalId,saved.data.manual.id);assert.deepEqual(saved.data.manual.deformers,pins);
 const stale=await h.save({baseApprovalId:old.id});assert.equal(stale.data.error,'PLACEMENT_SOURCE_CHANGED');
});
test('tampering with saved model bytes is rejected rather than rebaking an older source',async t=>{
 const h=await harness(t);await h.save();const s=h.p.manualPlacement.modelSnapshot;await fs.writeFile(path.join(h.store.root,h.p.id,s.blend.id),'BLENDERtampered');assert.equal((await fetch(h.base+'/package')).status,409);assert.equal(h.bakes(),1);
});

test('carrying the same facial overlay into a result preserves the saved baseline, but a real repair invalidates it',async t=>{
 const h=await harness(t),sources=Object.fromEntries(h.p.textures.map(x=>[x.group,x.id]));
 h.p.placements=[{id:'original-eye-repair',sources,scleraPatch:{version:1,test:'original'}}];await h.save();const before=await placementManifest(h.store,h.p);
 h.p.placements.push({id:'copied-result',sources,scleraPatch:{version:1,test:'original'}});
 assert.deepEqual(await placementManifest(h.store,h.p),before);assert.equal((await h.start()).status,200);assert.equal((await fetch(h.base+'/package')).status,200);
 h.p.placements.push({id:'new-eye-repair',sources,scleraPatch:{version:1,test:'changed'}});
 assert.equal((await fetch(h.base+'/package')).status,409);assert.equal(h.bakes(),1);
});

async function handoffFiles(h){
 const response=await fetch(h.base+'/package');assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
 const raw=await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(e,z)=>{if(e)return reject(e);const out={};z.on('error',reject);z.on('end',()=>resolve(out));z.on('entry',entry=>z.openReadStream(entry,(e,stream)=>{if(e)return reject(e);const chunks=[];stream.on('data',b=>chunks.push(b));stream.on('end',()=>{out[entry.fileName]=Buffer.concat(chunks);z.readEntry();});}));z.readEntry();}));
 return {bytes,locator:JSON.parse(raw['UBICACIONES.json']),files:await workspaceFiles(raw),names:Object.keys(raw)};
}
const machine=async(config,bytes,headers={})=>{const response=await fetch(config.endpoint,{method:bytes?'POST':'GET',headers:{Authorization:`Bearer ${config.token}`,...(bytes?{'Content-Type':'application/zip'}:{}),...headers},body:bytes});return {status:response.status,data:await response.json()};};

test('download locks placement across tabs; confirmed unlock cancels waiting and revokes the old ZIP',async t=>{
 const h=await harness(t);await h.save({deformers:pins});const first=h.p.manualPlacement,assetId=first.modelSnapshot.blend.id;
 assert.equal((await h.post('/continue')).data.error,'PLACEMENT_CODEX_RESULT_REQUIRED');
 assert.equal((await h.start()).status,200);const issued=await handoffFiles(h),config=JSON.parse(issued.files['ENTREGA_LOCAL.json']);
 assert.deepEqual(issued.names.sort(),['INSTRUCCIONES.txt','UBICACIONES.json']);assert.equal(issued.locator.entries.find(e=>e.name==='approved.blend').path,path.join(h.store.root,h.p.id,assetId));
 await assert.rejects(fs.access(path.join(issued.locator.workspace,'approved.blend')));
 assert.equal((await machine(config)).data.status,'waiting');assert.equal((await machine(config,null,{Origin:'http://127.0.0.1'})).status,403);assert.equal((await machine({...config,token:'0'.repeat(64)})).status,401);
 assert.equal((await h.save()).data.error,'PLACEMENT_WAITING_FOR_CODEX');
 assert.equal((await h.post('/draft',{sources:first.sources,transforms:first.transforms,heightCm:180,baseApprovalId:first.id})).data.error,'PLACEMENT_WAITING_FOR_CODEX');
 assert.equal((await h.post('/unlock',{confirm:false,deliveryId:config.deliveryId})).data.error,'PLACEMENT_UNLOCK_CONFIRMATION');
 assert.equal((await h.start()).data.handoff.id,config.deliveryId);assert.deepEqual((await handoffFiles(h)).bytes,issued.bytes);
 const reloaded=new Store(h.store.root);await reloaded.init();assert.equal(reloaded.get(h.p.id).placementHandoff.status,'waiting');assert.deepEqual(reloaded.get(h.p.id).manualPlacement.deformers,pins);
 const oldDelivery={...h.files,'manifest.json':issued.files['manifest.json'],'left.png':png};const oldBytes=await zipBuffers(oldDelivery);
 assert.equal((await h.cancel()).data.handoff.status,'cancelled');assert.equal((await machine(config)).data.error,'PLACEMENT_DELIVERY_CANCELLED');assert.notEqual((await machine(config,oldBytes)).status,200);
 const changed=await h.save({heightCm:182,deformers:pins});assert.equal(changed.status,200);assert.equal(changed.data.manual.modelSnapshot.blend.id,assetId);assert.equal(h.p.manualModelVersions,undefined);
 assert.equal((await h.start()).status,200);const fresh=await handoffFiles(h),newConfig=JSON.parse(fresh.files['ENTREGA_LOCAL.json']);assert.notEqual(newConfig.deliveryId,config.deliveryId);assert.equal((await machine(config)).status,401);assert.notEqual((await h.send(oldBytes)).status,200);
 assert.equal(fresh.locator.entries.find(e=>e.name==='approved.blend').path,issued.locator.entries.find(e=>e.name==='approved.blend').path);
 const modelFiles=(await fs.readdir(path.join(h.store.root,h.p.id))).filter(n=>/\.blend$/.test(n));assert.deepEqual(modelFiles,[assetId]);
});

test('automatic Codex delivery ends waiting, updates the model, enables rigging once and locks the completed stage',async t=>{
 const h=await harness(t);await h.save({deformers:pins});await h.start();const issued=await handoffFiles(h),config=JSON.parse(issued.files['ENTREGA_LOCAL.json']);
 const invalid=await zipBuffers({...h.files,'manifest.json':issued.files['manifest.json'],'left.png':png,'report.json':Buffer.from('{}')});
 assert.equal((await machine(config,invalid)).data.error,'PLACEMENT_REVIEW_REQUIRED');assert.equal(h.store.get(h.p.id).placementHandoff.status,'waiting');
 const resultBytes=await zipBuffers({...h.files,'manifest.json':issued.files['manifest.json'],'left.png':png});
 const result=await machine(config,resultBytes);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.status,'imported');const p=h.store.get(h.p.id);assert.equal(p.placementHandoff.status,'imported');assert.equal(p.placementHandoff.importId,result.data.importId);assert(p.placements.some(r=>r.id===result.data.importId&&r.preview&&r.blend));assert.equal(p.placementHandoff.lastError,null);
 const repeat=await machine(config,resultBytes);assert.equal(repeat.data.duplicate,true);assert.equal(p.placements.length,1);
 const advanced=await h.post('/continue');assert.equal(advanced.status,200);const final=h.store.get(h.p.id);assert.equal(workflowStage(final),5);assert.equal(final.placementCompleted.placementId,result.data.importId);
 assert.equal((await h.save()).data.error,'PLACEMENT_STAGE_COMPLETED');assert.equal((await h.start()).data.error,'PLACEMENT_STAGE_COMPLETED');assert.equal((await h.cancel()).data.error,'PLACEMENT_STAGE_COMPLETED');
 const rewind=rewindProject(final,{stage:4,confirm:true,expectedRevision:final.revision});assert.equal(workflowStage(rewind.next),4);assert.equal(rewind.next.placementCompleted,undefined);assert.equal(rewind.next.placementHandoff,undefined);assert.deepEqual(rewind.next.manualPlacementDraft.deformers,pins);
});

test('standalone model helper checks the local session and imports exactly once with an IMPORTED receipt',async t=>{
 const h=await harness(t);await h.save();await h.start();const issued=await handoffFiles(h),helper=path.join(issued.locator.workspace,'ENTREGAR_MODELO.mjs');
 const initial=await executeNode(process.execPath,[helper,'--check']);assert.equal(JSON.parse(initial.stdout).status,'WAITING');
 const file=path.join(issued.locator.outputDirectory,'placement_result.zip');await fs.writeFile(file,await zipBuffers({...h.files,'manifest.json':issued.files['manifest.json'],'left.png':png}));
 const imported=JSON.parse((await executeNode(process.execPath,[helper,file])).stdout);assert.equal(imported.status,'IMPORTED');assert(imported.importId);const receipt=JSON.parse(await fs.readFile(path.join(issued.locator.workspace,'ENTREGA_RECIBO.json'),'utf8'));assert.equal(receipt.importId,imported.importId);
 const repeated=JSON.parse((await executeNode(process.execPath,[helper,file])).stdout);assert.equal(repeated.duplicate,true);assert.equal(h.store.get(h.p.id).placements.length,1);
 await h.cancel();await assert.rejects(executeNode(process.execPath,[helper,'--check']),e=>e.stderr.includes('PLACEMENT_DELIVERY_CANCELLED'));
});

test('production app exposes only authenticated loopback delivery before the browser CSRF gate',async t=>{
 const h=await harness(t);await h.save();const {createApp}=await import('../server/app.js'),instance=await createApp({dataDir:h.store.root});const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const origin=`http://127.0.0.1:${server.address().port}`,root=origin+`/api/projects/${h.p.id}/placement`,token=(await (await fetch(origin+'/api/session')).json()).token;
 const issue=await fetch(root+'/handoff',{method:'POST',headers:{'Content-Type':'application/json','x-workbench-token':token},body:'{}'});assert.equal(issue.status,200);const value=await issue.json(),p=instance.store.get(h.p.id),dir=path.resolve(h.store.root,'..','projects',p.id,'codex','model-finish',value.handoff.id),config=JSON.parse(await fs.readFile(path.join(dir,'ENTREGA_LOCAL.json'),'utf8'));
 assert.equal((await fetch(config.endpoint)).status,401);assert.equal((await machine(config)).data.status,'waiting');assert.equal((await machine(config,null,{Origin:origin})).status,403);
 const cancel=await fetch(root+'/unlock',{method:'POST',headers:{'Content-Type':'application/json','x-workbench-token':token},body:JSON.stringify({confirm:true,deliveryId:value.handoff.id})});assert.equal(cancel.status,200);assert.equal((await machine(config)).data.error,'PLACEMENT_DELIVERY_CANCELLED');
});

test('single-model migration removes old saved inputs but retains original sources and Codex work products',async t=>{
 const h=await harness(t);await h.save();const current=h.p.manualPlacement.modelSnapshot,retiredBlend=await h.store.asset(h.p,Buffer.from('BLENDERretired'),'blend','Retired saved model'),retiredGlb=await h.store.asset(h.p,textured(),'glb','Retired saved model');
 h.p.manualModelVersions=[{id:'retired',modelSnapshot:{blend:retiredBlend,preview:retiredGlb}}];
 const folder=path.resolve(h.store.root,'..','projects',h.p.id,'codex','model-finish',randomUUID());await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify({projectId:h.p.id,manual:{modelSnapshot:{version:1}}}));for(const name of ['approved.blend','approved.glb','placed.blend'])await fs.writeFile(path.join(folder,name),'old input or work product');
 assert.equal((await h.save()).status,200);assert.equal(h.p.manualPlacement.modelSnapshot.blend.id,current.blend.id);assert.equal(h.p.manualModelVersions,undefined);await assert.rejects(h.store.read(h.p,retiredBlend));await assert.rejects(h.store.read(h.p,retiredGlb));await assert.rejects(fs.access(path.join(folder,'approved.blend')));await assert.rejects(fs.access(path.join(folder,'approved.glb')));assert.equal(await fs.readFile(path.join(folder,'placed.blend'),'utf8'),'old input or work product');for(const asset of h.p.textures)assert.deepEqual(await h.store.read(h.p,asset),textured());
});
test('rewinding placement preserves point editing and the single saved model path for the next save',async t=>{
 const h=await harness(t);await h.save({deformers:pins});const id=h.p.manualPlacement.modelSnapshot.blend.id;h.p.placementCompleted={manualId:h.p.manualPlacement.id};const {next}=rewindProject(h.p,{stage:4,confirm:true,expectedRevision:h.p.revision});await h.store.save(next);const saved=await h.save({deformers:next.manualPlacementDraft.deformers});assert.equal(saved.status,200);assert.equal(saved.data.manual.modelSnapshot.blend.id,id);assert.deepEqual(saved.data.manual.deformers,pins);
});

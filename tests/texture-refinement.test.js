import {workspaceFiles} from './local-workspace-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import yauzl from 'yauzl';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildGlb,parseGlb,atlasImages,replaceAtlases,verifyTextureLayout} from '../scripts/texture-layout.mjs';
import {createTextureRefinement,validateRefinementReport} from '../server/texture-refinement.js';
import {segmentIdentity} from '../server/segmentation-identity.js';
import {planIdentity} from '../server/segment-references.js';
import {Store,emptyProject} from '../server/storage.js';
import {snapshot} from '../server/lineage.js';
import {fingerprintViewSet} from '../server/view-set.js';
import {placementTexture} from '../server/texture-workflow.js';
import {zipBuffers} from '../server/codex-handoff.js';
import {validateCoverage,COVERAGE_POLICY} from '../server/texture-coverage.js';
import {refinementSkillPaths} from '../server/refinement-skill-files.js';
import {applyHairNormalPatch,positionDigest} from '../scripts/hair-normal-preparation.mjs';
import {applyFaceNormalPatch} from '../scripts/face-normal-preparation.mjs';
const png=(color='#ad8888',size=64)=>sharp({create:{width:size,height:size,channels:4,background:color}}).png().toBuffer();
async function model(){
 const image=await png(),geo=Buffer.alloc(68);new Float32Array([0,0,0,1,0,0,0,1,0]).forEach((v,i)=>geo.writeFloatLE(v,i*4));new Float32Array([0,0,1,0,0,1]).forEach((v,i)=>geo.writeFloatLE(v,36+i*4));[0,1,2].forEach((v,i)=>geo.writeUInt16LE(v,60+i*2));
 return buildGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],buffers:[{byteLength:68+image.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:6},{buffer:0,byteOffset:68,byteLength:image.length}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,count:3,type:'VEC2'},{bufferView:2,componentType:5123,count:3,type:'SCALAR'}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{bufferView:3,mimeType:'image/png'}]},Buffer.concat([geo,image]));
}
const report=()=>({faceNormals:{status:'not-applicable',reason:'Synthetic triangle has no facial surface'},coverageReview:{status:'checked',conceptCompared:true,modelInspected:true,views:['front','left','right','back'],modes:['base-color','geometry'],groups:[]},hairNormals:{status:'no-hair',reason:'Synthetic triangle has no hair'},schema:'workbench-texture-refinement-report/v1',method:'paint-existing-atlases',imageGenerationUsed:false,reviewed:true,jointReview:{status:'checked',parts:['head','body','hair'],modes:['base-color','neutral-light'],views:['front','left','right','back'],skinComparison:'Fixture colors compared under identical light',paintConsistency:'No hair in synthetic fixture; palette is consistent'},uvReview:{status:'checked',mipmaps:true,distances:['close','full-character','distant'],modes:['base-color','neutral-light'],findings:'Synthetic uniform color has no contrasting neighbors',atlases:['head','body'].map(part=>({part,index:0,paddingPx:0,status:'verified-existing',reason:'Uniform synthetic atlas covers all texels'}))},nonExplicit:true,originalClothingPreserved:true,scleraReview:{status:'not-applicable',reason:'Synthetic triangle has no eyes'},lipReview:{status:'not-applicable',reason:'Synthetic single triangle fixture has no mouth.'},eyeShadowReview:{status:'not-applicable',reason:'Synthetic triangle fixture has no eyes.'},facialPreparation:{status:'not-applicable',reason:'Synthetic single triangle fixture has no eyes or eyebrows.'},parts:Object.fromEntries(['head','body'].map(p=>[p,{views:['front','left','right','back'],changes:'Fixture atlas tint correction'}])),coverage:[],pending:[]});
test('atlas replacement preserves all geometry, UVs and transforms and rejects changes to each',async()=>{
 const original=await model(),result=replaceAtlases(original,new Map([[0,await png('#ba9696')]]));assert(verifyTextureLayout(original,result).uvPreserved);assert.notEqual(atlasImages(original)[0].sha256,atlasImages(result)[0].sha256);
 for(const change of [(j,b)=>b.writeFloatLE(2,0),(j,b)=>b.writeFloatLE(.5,36),j=>j.nodes[0].translation=[0,1,0],j=>j.materials[0].pbrMetallicRoughness.baseColorFactor=[1,0,0,1],j=>j.meshes[0].primitives[0].indices=0]){const {json,bin}=parseGlb(Buffer.from(result));change(json,bin);assert.throws(()=>verifyTextureLayout(original,buildGlb(json,bin)),/REFINE_LAYOUT_CHANGED/);}
 const {json,bin}=parseGlb(original);json.materials[0].normalTexture={index:0};const protectedGlb=buildGlb(json,bin);assert.equal(atlasImages(protectedGlb)[0].editable,false);assert.throws(()=>replaceAtlases(protectedGlb,new Map([[0,awaitNever()]])),/REFINE_LAYOUT_CHANGED/);
 function awaitNever(){return Buffer.alloc(30);}
});
test('coverage records cannot mark a head as temporary underwear, omit groups or neutralize unknown/original clothing',()=>{
 const groups=[{id:'body',part:'body'},{id:'head',part:'head'}],value={schema:COVERAGE_POLICY,groups:[{groupId:'body',status:'temporary',areas:['chest'],description:'plain opaque top'},{groupId:'head',status:'none',areas:[]}]};assert.equal(validateCoverage(value,groups),value);
 for(const mutate of [v=>v.groups.pop(),v=>v.groups[1]={...v.groups[0],groupId:'head'},v=>v.groups[0].status='unreviewed',v=>v.groups[0].groupId='other']){const v=structuredClone(value);mutate(v);assert.throws(()=>validateCoverage(v,groups),/SEG_COVERAGE_REQUIRED/);}
 const generated={...report(),imageGenerationUsed:true};assert.throws(()=>validateRefinementReport(generated,[]),/REFINE_PAINT_REQUIRED/);
 const r=report();r.coverage=[{groupId:'body',status:'neutralized',reason:'temporary top'}];assert.throws(()=>validateRefinementReport(r,[value.groups[0]]),/REFINE_REVIEW_REQUIRED/);r.parts.body.views.push('front-high');r.coverageReview.groups=[{groupId:'body',allAddedCoverageAccountedFor:true,findings:'Temporary cloth over exposed skin in fixture',regions:[{name:'Upper skin region',temporary:true,surface:'skin',concept:'exposed-skin',action:'restored-skin',reason:'Restored original exposed skin',evidence:['before.png','after.png']}]}];assert(validateRefinementReport(r,[value.groups[0]]));assert.throws(()=>validateRefinementReport(r,[{...value.groups[0],status:'unknown'}]),/REFINE_COVERAGE_INVALID/);r.parts.body.views=['front'];assert.throws(()=>validateRefinementReport(r,[]),/REFINE_REVIEW_REQUIRED/);
});
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'refinement-')),store=new Store(dir);await store.init();const p=emptyProject('refinement fixture'),bytes=await model();
 p.reference=await store.asset(p,await png(),'png','concept');p.referenceState={status:'ready',referenceId:p.reference.id};
 for(const group of ['head','body']){p.groups[group].views.front=await store.asset(p,await png(),'png','view');p.groups[group].selectedViews=['front'];}
 for(const group of ['head','body']){const m={...await store.asset(p,bytes,'glb','source'),group,source:'importado',lineage:snapshot(p)};p.models.push(m);p.groups[group].selectedModelId=m.id;(p.textures||=[]).push({...await store.asset(p,bytes,'glb','texture'),group,sourceModelId:m.id,fingerprint:fingerprintViewSet(p,group),refinementRequired:true});}
 await store.save(p);let now=Date.now();const ref=await createTextureRefinement({store,deliveryOptions:{now:()=>now,ttlMs:1000}});const app=express();app.use('/api/texture-refinement-deliveries',ref.delivery.router);app.use(express.json());ref.mount(app);app.use((e,q,r,n)=>r.status(e.status||400).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 return {store,p,bytes,ref,advance:()=>now+=2000,dir,base:`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/texture-refinement`};
}

test('supervised finish only completes after validated painted atlas delivery and still requires artist review',async t=>{
 const {p,ref,bytes}=await fixture(t);const seg={id:'supervised-seg',identity:segmentIdentity(p),approval:{id:'review'},groups:[],reconstruction:{reviewRequired:true}};
 p.segmentations=[seg];p.segmentTexturePlan={id:'plan',workflowVersion:2,identity:planIdentity(seg),status:'ready-to-finish'};
 p.textures.forEach(t=>Object.assign(t,{segmentationId:seg.id,segmentationApprovalId:'review',supervisedPending:true}));
 await assert.rejects(()=>ref.manifest(p),/REFINE_SEGMENTS_PENDING/);p.segmentTexturePlan.status='finishing';
 const manifest=await ref.manifest(p),changed=replaceAtlases(bytes,new Map([[0,await png('#b89090')]]));
 const files={'manifest.json':Buffer.from(JSON.stringify(manifest)),'report.json':Buffer.from(JSON.stringify(report())),'head.glb':bytes,'body.glb':bytes};
 await assert.rejects(async()=>ref.importPackage(p,await zipBuffers(files)),/REFINE_NO_CHANGES/);assert.equal(p.segmentTexturePlan.status,'finishing');
 const run=await ref.importPackage(p,await zipBuffers({...files,'head.glb':changed,'body.glb':changed}));assert.equal(p.segmentTexturePlan.status,'completed');assert.equal(run.reviewRequired,true);assert.equal(placementTexture(p,'head'),null);assert.equal(p.textures.at(-1).supervisedPending,false);
});

test('declared removal of temporary hip clothing requires actual body atlas changes, not only a head edit',async t=>{
 const {p,ref,bytes}=await fixture(t),seg={id:'coverage-seg',identity:segmentIdentity(p),approval:{id:'coverage-review'},groups:[{id:'legs',part:'body',coverage:{status:'temporary',areas:['pelvis'],description:'Auxiliary hip briefs'}}]};
 p.segmentations=[seg];p.textures.forEach(t=>Object.assign(t,{segmentationId:seg.id,segmentationApprovalId:seg.approval.id}));
 const manifest=await ref.manifest(p),r=report();assert.equal(manifest.coverageCleanup.required,true);
 r.coverage=[{groupId:'legs',status:'neutralized',reason:'Temporary hip coverage painted back to concept skin'}];
 r.coverageReview.groups=[{groupId:'legs',allAddedCoverageAccountedFor:true,findings:'Temporary briefs cover exposed hip skin',regions:[{name:'Left and right exposed hips',temporary:true,surface:'skin',concept:'exposed-skin',action:'restored-skin',reason:'Restored skin while preserving the original garment',evidence:['before.png','after.png']}]}];
 const changed=replaceAtlases(bytes,new Map([[0,await png('#b89292')]])),files={'manifest.json':Buffer.from(JSON.stringify(manifest)),'report.json':Buffer.from(JSON.stringify(r)),'head.glb':changed,'body.glb':bytes};
 await assert.rejects(async()=>ref.importPackage(p,await zipBuffers(files)),/REFINE_COVERAGE_UNCHANGED/);
 assert.equal(p.textures.length,2);
 const run=await ref.importPackage(p,await zipBuffers({...files,'body.glb':changed}));assert(run.reviewRequired);
});

test('coverage drafts are source-bound atlas-only checkpoints, preserve final state and travel with the next package',async t=>{
 const h=await fixture(t),{p,ref,bytes}=h,seg={id:'draft-seg',identity:segmentIdentity(p),approval:{id:'review'},groups:[{id:'legs',part:'body',coverage:{status:'temporary',areas:['pelvis'],description:'Auxiliary hip briefs'}}]};
 p.segmentations=[seg];p.textures.forEach(t=>Object.assign(t,{segmentationId:seg.id,segmentationApprovalId:seg.approval.id}));const ids=p.textures.map(t=>t.id),r=report();
 r.coverage=[{groupId:'legs',status:'neutralized',reason:'Removed temporary skin covering'}];r.coverageReview.groups=[{groupId:'legs',allAddedCoverageAccountedFor:true,findings:'Added brief over concept-exposed skin',regions:[{name:'Skin of both hip sides',temporary:true,surface:'skin',concept:'exposed-skin',action:'restored-skin',reason:'Restored skin; original bodysuit is intact',evidence:['before.png','after.png']}]}];
 const post=async(model,sourceIds=ids)=>{const form=new FormData();form.set('sourceIds',JSON.stringify(sourceIds));form.set('report',JSON.stringify(r));form.set('file',new Blob([model]),'body.glb');const response=await fetch(h.base+'/coverage-preview',{method:'POST',body:form});return {status:response.status,data:await response.json()};};
 assert.equal((await post(bytes)).data.error,'REFINE_COVERAGE_UNCHANGED');
 const changed=replaceAtlases(bytes,new Map([[0,await png('#b89292')]]));assert.equal((await post(changed,['old','old'])).data.error,'SEG_INPUTS_CHANGED');
 assert.equal((await post(replaceAtlases(bytes,new Map([[0,await png('#b8929280')]])))).data.error,'REFINE_ALPHA_CHANGED');
 const q=parseGlb(Buffer.from(changed));q.bin.writeFloatLE(2,0);assert.equal((await post(buildGlb(q.json,q.bin))).data.error,'REFINE_LAYOUT_CHANGED');
 const good=await post(changed);assert.equal(good.status,200);assert.equal(good.data.draft.preliminary,true);assert.deepEqual(p.textures.map(t=>t.id),ids);assert.equal(p.textureRefinements,undefined);
 assert.equal((await post(changed)).data.draft.id,good.data.draft.id);assert.equal(p.coverageCleanupDrafts.length,1);
 const manifest=await ref.manifest(p);assert.equal(manifest.coverageDraft.id,good.data.draft.id);
 const grant=await ref.delivery.issue(p),zip=await ref.delivery.package(p,grant.id);
 const files=await new Promise((resolve,reject)=>yauzl.fromBuffer(zip,{lazyEntries:true},(err,z)=>{if(err)return reject(err);const out={};z.on('error',reject);z.on('end',()=>resolve(workspaceFiles(out)));z.on('entry',e=>z.openReadStream(e,(err,s)=>{if(err)return reject(err);const chunks=[];s.on('data',b=>chunks.push(b));s.on('end',()=>{out[e.fileName]=Buffer.concat(chunks);z.readEntry();});}));z.readEntry();}));
 assert(files['edited/body_0.png']);assert.equal(JSON.parse(files['report.json']).reviewed,false);assert.deepEqual(JSON.parse(files['report.json']).coverageReview,r.coverageReview);
 r.coverageReview.evidenceRoot='/local/review';const correctedReport=await post(changed);assert.notEqual(correctedReport.data.draft.id,good.data.draft.id);assert.equal(correctedReport.data.draft.asset.id,good.data.draft.asset.id);
 p.textures[1]={...p.textures[1],...await h.store.asset(p,bytes,'glb','new body revision')};assert.equal((await ref.manifest(p)).coverageDraft,undefined);
});
test('refinement import rejects stale sources, wrong projects, alpha/size changes and no-op; preserves originals and waits for approval',async t=>{
 const h=await fixture(t),{p,ref,bytes}=h,m=await ref.manifest(p),changed=replaceAtlases(bytes,new Map([[0,await png('#b89090')]])),originalIds=p.textures.map(t=>t.id),files={'manifest.json':Buffer.from(JSON.stringify(m)),'report.json':Buffer.from(JSON.stringify(report())),'head.glb':changed,'body.glb':changed};
 assert.equal(placementTexture(p,'head'),null);
 const attempt=async overrides=>ref.importPackage(p,await zipBuffers({...files,...overrides}));
 await assert.rejects(()=>attempt({'head.glb':bytes,'body.glb':bytes}),/REFINE_NO_CHANGES/);
 await assert.rejects(()=>attempt({'manifest.json':Buffer.from(JSON.stringify({...m,projectId:randomUUID()}))}),/SEG_INPUTS_CHANGED/);
 const bigger=replaceAtlases(bytes,new Map([[0,await png('#b89090',128)]]));await assert.rejects(()=>attempt({'head.glb':bigger}),/REFINE_IMAGE_SIZE/);
 const alpha=replaceAtlases(bytes,new Map([[0,await png('#b8909080')]]));await assert.rejects(()=>attempt({'head.glb':alpha}),/REFINE_ALPHA_CHANGED/);
 const incomplete=report();incomplete.pending=['Coverage unresolved'];await assert.rejects(()=>attempt({'report.json':Buffer.from(JSON.stringify(incomplete))}),/REFINE_REVIEW_REQUIRED/);
 assert.equal(p.textures.length,2);
 const zip=await zipBuffers(files),run=await ref.importPackage(p,zip);assert.equal(p.textures.length,4);assert.equal(run.reviewRequired,true);assert.equal(placementTexture(p,'body'),null);assert.equal((await ref.importPackage(p,zip)).id,run.id);
 for(const id of originalIds)assert((await fs.readFile(path.join(h.store.root,p.id,id))).equals(bytes));
 let response=await fetch(h.base+'/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:run.id,confirm:true})});assert.equal(response.status,200);assert.equal(placementTexture(p,'body').refinementId,run.id);
 p.notes='changed';await assert.rejects(()=>attempt({'report.json':Buffer.from(JSON.stringify({...report(),extra:'new package'}))}),/SEG_INPUTS_CHANGED/); // Different ZIP bytes or old manifest cannot replace current sources.
});
test('package reuse, explicit expiration renewal and source changes are isolated per project',async t=>{
 const {p,ref,advance}=await fixture(t),a=await ref.delivery.issue(p);assert.equal((await ref.delivery.issue(p)).id,a.id);const bytes=await ref.delivery.package(p,a.id);assert(bytes.length>1000);advance();await assert.rejects(()=>ref.delivery.issue(p),/SEG_DELIVERY_RENEW_REQUIRED/);const b=await ref.delivery.issue(p,{renew:true});assert.notEqual(a.id,b.id);await assert.rejects(()=>ref.delivery.package(p,a.id),/SEG_DELIVERY_REPLACED/);p.notes='changed';assert.equal((await ref.delivery.status(p)).status,'stale');
});

test('new grants reject a downgraded manifest while existing v7 grants survive a server update',async t=>{
 const h=await fixture(t),grant=await h.ref.delivery.issue(h.p),filename=path.join(h.dir,'.texture-refinement-deliveries',grant.id+'.json'),g=JSON.parse(await fs.readFile(filename,'utf8'));
 const legacy=await h.ref.manifest(h.p,{refinementSkillsVersion:7}),oldReport=report();delete oldReport.faceNormals;
 const changed=replaceAtlases(h.bytes,new Map([[0,await png('#bc9988')]])),files={'manifest.json':Buffer.from(JSON.stringify(legacy)),'report.json':Buffer.from(JSON.stringify(oldReport)),'head.glb':changed,'body.glb':changed},zip=await zipBuffers(files);
 await assert.rejects(()=>h.ref.importPackage(h.p,zip,()=>{},JSON.parse(g.snapshot)),/SEG_INPUTS_CHANGED/);
 g.snapshot=JSON.stringify(legacy);await fs.writeFile(filename,JSON.stringify(g));
 const restored=await createTextureRefinement({store:h.store});
 assert.equal((await restored.delivery.status(h.p)).status,'waiting');
 assert.equal((await restored.delivery.issue(h.p)).id,grant.id);
 const run=await restored.importPackage(h.p,zip,()=>{},legacy);assert.equal(run.manifest.refinementSkillsVersion,7);assert(run.reviewRequired);
 assert.equal(JSON.parse(await fs.readFile(filename,'utf8')).hash,g.hash);
});

test('v9 requires eye shadow review while a previously issued v8 manifest keeps its original contract',async t=>{
 const h=await fixture(t),current=await h.ref.manifest(h.p),legacy=await h.ref.manifest(h.p,{refinementSkillsVersion:8});
 assert.equal(current.refinementSkillsVersion,9);assert.equal(current.eyeShadows.required,true);assert.equal(legacy.refinementSkillsVersion,8);assert.equal(legacy.eyeShadows,undefined);assert.equal(legacy.facialPreparation.scope,'sclera-iris-pupil-glints-eyebrows');
 const r=report();delete r.eyeShadowReview;const changed=replaceAtlases(h.bytes,new Map([[0,await png('#bc9988')]]));
 const files={'manifest.json':Buffer.from(JSON.stringify(current)),'report.json':Buffer.from(JSON.stringify(r)),'head.glb':changed,'body.glb':changed};
 await assert.rejects(async()=>h.ref.importPackage(h.p,await zipBuffers(files)),/REFINE_EYE_SHADOW_REVIEW_REQUIRED/);
 const run=await h.ref.importPackage(h.p,await zipBuffers({...files,'manifest.json':Buffer.from(JSON.stringify(legacy))}),()=>{},legacy);assert.equal(run.manifest.refinementSkillsVersion,8);
});
test('downloaded standalone helpers extract, edit, rebuild, package and auto-deliver to the bound project exactly once',async t=>{
 const h=await fixture(t),grant=await h.ref.delivery.issue(h.p),zip=await h.ref.delivery.package(h.p,grant.id),folder=path.join(h.dir,'handoff');await fs.mkdir(folder);
 const files=await new Promise((resolve,reject)=>yauzl.fromBuffer(zip,{lazyEntries:true},(err,z)=>{if(err)return reject(err);const out={};z.on('error',reject);z.on('end',()=>resolve(workspaceFiles(out)));z.on('entry',entry=>z.openReadStream(entry,(err,s)=>{if(err)return reject(err);const b=[];s.on('data',x=>b.push(x));s.on('end',()=>{out[entry.fileName]=Buffer.concat(b);z.readEntry();});}));z.readEntry();}));
 // Test server uses an ephemeral local port; the scoped token is unchanged.
 assert(files['SKILLS_REQUERIDAS.txt']?.includes(Buffer.from('refinamiento-texturas-anime')));
 assert(files['SKILLS_REQUERIDAS.txt'].includes(Buffer.from('normales-rostro-anime')));
 assert(files['face-normal-mask/face-normal-mask.glb'].subarray(0,4).equals(Buffer.from('glTF')));
 assert(files['face-normal-mask/face-normal-mask.blend'].length>1000);assert(files['AJUSTAR_MASCARA_ROSTRO.py']);
 assert.equal(JSON.parse(files['manifest.json']).faceNormals.required,true);
 for(const name of refinementSkillPaths){
  const filename=new URL('../'+name,import.meta.url),text=await fs.readFile(filename,'utf8');
  for(const match of text.matchAll(/\]\((references\/[^)]+)\)/g))await fs.access(new URL(match[1],filename));
 }
 const descriptor=JSON.parse(files['ENTREGA_LOCAL.json']);descriptor.endpoint=descriptor.endpoint.replace('http://127.0.0.1:4317',new URL(h.base).origin);files['ENTREGA_LOCAL.json']=Buffer.from(JSON.stringify(descriptor));
 for(const [name,b]of Object.entries(files)){await fs.mkdir(path.dirname(path.join(folder,name)),{recursive:true});await fs.writeFile(path.join(folder,name),b);}
 const exec=promisify(execFile),opts={cwd:folder,windowsHide:true};
 await exec(process.execPath,['RETOCAR_TEXTURAS.mjs','extract'],opts);await fs.mkdir(path.join(folder,'edited'));await fs.writeFile(path.join(folder,'edited','body_0.png'),await png('#b89292'));await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report()));
 await exec(process.execPath,['RETOCAR_TEXTURAS.mjs','build'],opts);await exec('python',['EMPAQUETAR_RETOQUE.py'],opts);
 // Keep this test within the short grant TTL; use a refreshed expiry for helpers.
 for(let i=0;i<2;i++){const {stdout}=await exec(process.execPath,['ENTREGAR_RETOQUE.mjs','texture_refinement.zip'],opts);const receipt=JSON.parse(stdout);assert.equal(receipt.status,'imported');assert.equal(receipt.duplicate,i===1);}
 assert.equal(h.p.textureRefinements.length,1);assert.equal(h.p.textures.length,4);assert.equal(h.p.textureRefinements[0].reviewRequired,true);
 const {stdout}=await exec(process.execPath,['ENTREGAR_RETOQUE.mjs','--check'],opts);assert.equal(JSON.parse(stdout).status,'imported');
});
test('failed persistence and concurrent imports do not discard original textures or leave staged assets',async t=>{
 const h=await fixture(t),m=await h.ref.manifest(h.p),changed=replaceAtlases(h.bytes,new Map([[0,await png('#c49c9c')]]));
 const zip=await zipBuffers({'manifest.json':Buffer.from(JSON.stringify(m)),'report.json':Buffer.from(JSON.stringify(report())),'head.glb':changed,'body.glb':changed});
 const before=await fs.readdir(path.join(h.dir,h.p.id)),ids=h.p.textures.map(t=>t.id),save=h.store.save.bind(h.store);h.store.save=async()=>{throw Error('disk fixture');};
 await assert.rejects(()=>h.ref.importPackage(h.p,zip),/disk fixture/);assert.deepEqual(h.p.textures.map(t=>t.id),ids);assert.deepEqual(await fs.readdir(path.join(h.dir,h.p.id)),before);assert.equal(h.p.textureRefinements,undefined);
 h.store.save=save;const results=await Promise.allSettled([h.ref.importPackage(h.p,zip),h.ref.importPackage(h.p,zip)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(h.p.textureRefinements.length,1);assert.equal(h.p.textures.length,4);
});

test('production delivery requires the hair review and accepts only the declared normal patch after painting',async t=>{
 const {p,ref,bytes}=await fixture(t),m=await ref.manifest(p),changed=replaceAtlases(bytes,new Map([[0,await png('#b89292')]]));
 const patch={schema:'workbench-hair-normals/v1',targets:[{mesh:0,primitive:0,positionHash:positionDigest([0,0,0,1,0,0,0,1,0]),volumes:[{type:'ellipsoid',center:[0,0,-1],radii:[1,1,1]}]}]};
 const r=report();delete r.hairNormals;
 const files={'manifest.json':Buffer.from(JSON.stringify(m)),'report.json':Buffer.from(JSON.stringify(r)),'head.glb':applyHairNormalPatch(changed,patch),'body.glb':changed};
 await assert.rejects(async()=>ref.importPackage(p,await zipBuffers(files)),/HAIR_NORMAL_PATCH_INVALID/);
 r.hairNormals={status:'prepared',reason:'Synthetic hair surface with measured single ellipsoid',patch,views:['front','left','right','back'],lightDirections:['left','right','front','back'],seamsChecked:true,baseColorPreserved:true,animation:{status:'temporary-deformation-test',evidence:['synthetic-two-bone-test']}};
 files['report.json']=Buffer.from(JSON.stringify(r));
 const run=await ref.importPackage(p,await zipBuffers(files));assert.equal(run.report.hairNormals.status,'prepared');assert(run.reviewRequired);
});

test('face normals are replayed after painting and reject undeclared geometry changes',async t=>{
 const {p,ref,store,bytes}=await fixture(t),{json:j,bin}=parseGlb(bytes);j.nodes[0].name='face';
 const pad=Buffer.alloc((4-bin.length%4)%4),normal=Buffer.alloc(36);[0,0,1,0,0,1,0,0,1].forEach((v,i)=>normal.writeFloatLE(v,i*4));
 const offset=bin.length+pad.length,view=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:offset,byteLength:36});const accessor=j.accessors.length;j.accessors.push({bufferView:view,type:'VEC3',componentType:5126,count:3});j.meshes[0].primitives[0].attributes.NORMAL=accessor;j.buffers[0].byteLength=offset+36;
 const original=buildGlb(j,Buffer.concat([bin,pad,normal])),head=p.textures.find(x=>x.group==='head');Object.assign(head,await store.asset(p,original,'glb','Synthetic face-normal source'));
 const m=await ref.manifest(p),r=report(),patch={schema:'workbench-face-normals/v1',targets:[{mesh:0,primitive:0,positionHash:positionDigest([0,0,0,1,0,0,0,1,0]),proxy:{type:'ellipsoid',center:[0,0,-1],radii:[1,1,1]},weights:[1,.5,0]}]};
 r.faceNormals={status:'prepared',reason:'Reviewed fixture mask',patch,views:['front','left','right','back'],lightDirections:['left','right','front','back'],baseColorPreserved:true,protectedFeaturesPreserved:true,proxyExported:false,seamsChecked:true};
 const omitted=structuredClone(r);delete omitted.faceNormals;assert.throws(()=>validateRefinementReport(omitted,[],{faceRequired:true}),/FACE_NORMAL/);
 const result=applyFaceNormalPatch(original,patch),body=replaceAtlases(bytes,new Map([[0,await png('#bc9988')]])),files={'manifest.json':Buffer.from(JSON.stringify(m)),'report.json':Buffer.from(JSON.stringify(r)),'head.glb':result,'body.glb':body};
 const bad=parseGlb(Buffer.from(result));bad.json.nodes[0].translation=[0,1,0];files['head.glb']=buildGlb(bad.json,bad.bin);await assert.rejects(async()=>ref.importPackage(p,await zipBuffers(files)),/REFINE_LAYOUT_CHANGED|FACE_NORMAL/);
 const skipped={...r,faceNormals:{status:'not-applicable',reason:'Trying to omit a present face'}};files['head.glb']=original;files['report.json']=Buffer.from(JSON.stringify(skipped));await assert.rejects(async()=>ref.importPackage(p,await zipBuffers(files)),/FACE_NORMAL_REVIEW_REQUIRED/);files['report.json']=Buffer.from(JSON.stringify(r));
 files['head.glb']=result;const run=await ref.importPackage(p,await zipBuffers(files));assert.equal(run.report.faceNormals.status,'prepared');assert(run.reviewRequired);
});

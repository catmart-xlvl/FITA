import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store,emptyProject} from '../server/storage.js';
import {snapshot} from '../server/lineage.js';
import {segmentIdentity} from '../server/segmentation-identity.js';
import {fingerprintViewSet} from '../server/view-set.js';
import {correctAssembly} from '../server/assembly-correction.js';

async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'assembly-correction-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store=new Store(dir);await store.init();const p=emptyProject('Correction fixture'),png=await fs.readFile('fixtures/head-front.png');
 p.reference={id:'concept'};p.referenceState={status:'ready',referenceId:'concept'};
 const data={asset:{version:'2.0'},meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{uri:'data:image/png;base64,'+png.toString('base64')}]};
 const raw=JSON.stringify(data),json=Buffer.from(raw.padEnd(Math.ceil(raw.length/4)*4,' ')),glb=Buffer.alloc(20+json.length);glb.write('glTF');glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(json.length,12);glb.writeUInt32LE(0x4e4f534a,16);json.copy(glb,20);
 p.textures=[];
 for(const group of ['head','body']){const m={...await store.asset(p,glb,'glb','model'),group,source:'importado',lineage:snapshot(p)};p.models.push(m);p.groups[group].selectedModelId=m.id;p.textures.push({...await store.asset(p,glb,'glb','texture'),group,sourceModelId:m.id,fingerprint:fingerprintViewSet(p,group),segmentationId:'segment',segmentationApprovalId:'approval'});}
 const originalBlend=await store.asset(p,Buffer.from('BLENDERoriginal'),'blend','original');
 const s={id:'segment',identity:segmentIdentity(p),approval:{id:'approval'},reconstruction:{blend:originalBlend,textureIds:p.textures.map(t=>t.id),runIds:['head-run','body-run'],reviewRequired:true}};p.segmentations=[s];await store.save(p);
 const input={segmentationId:s.id,parentBlendId:originalBlend.id,confirm:true,review:{views:['front','left','right'],findings:'Synthetic contract test; no artistic approval'}},fault={};let calls=0;
 const runner=async(mode,file)=>{calls++;assert.equal(mode,'correct_assembly');const job=JSON.parse(await fs.readFile(file));for(const group of ['head','body'])await fs.writeFile(path.join(job.directory,group+'-corrected.glb'),glb);await fs.writeFile(path.join(job.directory,'corrected.blend'),'BLENDERcorrected');await fs.writeFile(path.join(job.directory,'correction.json'),JSON.stringify({uvPreserved:true,materialsPreserved:true,topologyPreserved:true,outsideNeckPreserved:true,headLocalShapePreserved:true,independentParts:true,savedAndReopened:true,...fault}));};
 return {p,s,store,input,fault,calls:()=>calls,run:()=>correctAssembly({p,store,runner,buffer:Buffer.from('BLENDERcorrected'),input,check:()=>{}})};
}
test('corrected assembly replaces the current preview while retaining original textures and reconstruction history',async t=>{
 const h=await fixture(t),previous=structuredClone(h.s.reconstruction),oldTextures=structuredClone(h.p.textures);await h.run();
 assert.deepEqual(h.s.reconstructionHistory,[previous]);assert.deepEqual(h.p.textures.slice(0,2),oldTextures);assert.equal(h.p.textures.length,4);
 assert.deepEqual(h.s.reconstruction.textureIds,h.p.textures.slice(2).map(t=>t.id));assert.equal(h.s.reconstruction.reviewRequired,true);
 assert.notEqual(h.s.reconstruction.blend.id,previous.blend.id);assert.deepEqual(await h.store.read(h.p,previous.blend),Buffer.from('BLENDERoriginal'));
 await assert.rejects(h.run,/SEG_INPUTS_CHANGED/);assert.equal(h.calls(),1);
});
test('missing bilateral review and changed UV validation cannot publish a correction',async t=>{
 const h=await fixture(t),before=JSON.stringify(h.p);h.input.review.views=['front','right'];await assert.rejects(h.run,/SEG_BASELINE_REVIEW_REQUIRED/);assert.equal(h.calls(),0);
 h.input.review.views=['front','left','right'];h.fault.uvPreserved=false;await assert.rejects(h.run,/SEG_GEOMETRY_CHANGED/);assert.equal(JSON.stringify(h.p),before);
});
test('failed persistence rolls back correction pointers and retains the previous reconstruction',async t=>{
 const h=await fixture(t),before=JSON.stringify(h.p);h.store.save=async()=>{throw Error('disk failed');};await assert.rejects(h.run,/disk failed/);assert.equal(JSON.stringify(h.p),before);
});


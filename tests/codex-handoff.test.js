import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {manifestFor,promptFor,slots,modelSlots,zipBuffers,validatePackage,readViewZip} from '../server/codex-handoff.js';
import {placementReferences} from '../server/placement-references.js';
import {emptyProject} from '../server/storage.js';
import {translate,translateMessage} from '../src/i18n-core.js';

const images=Object.fromEntries(await Promise.all(slots.map(async(s,i)=>[s.file,await sharp({create:{width:512,height:512,channels:3,background:{r:25+i*20,g:70+i*13,b:120+i*12}}}).png().toBuffer()])));
const sample=()=>{const p=emptyProject('Concepto');p.reference={id:'concept.png'};p.referenceRevision=1;return p;};
const packageFor=(p,overrides={})=>zipBuffers({...images,'manifest.json':Buffer.from(JSON.stringify(manifestFor(p))),...overrides});
async function harness(t){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'codex-handoff-'));
  const {app,store}=await createApp({dataDir,providers:{image:()=>{throw new Error('No image generation allowed');}}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`,token=await(await fetch(base+'/api/session')).json();
  t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dataDir,{recursive:true,force:true});});
  async function call(route,body){const r=await fetch(base+'/api'+route,{method:body?'POST':'GET',headers:{'x-workbench-token':token.token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};}
  const {data:p}=await call('/projects',{name:'Codex import test'});
  const form=new FormData();form.set('kind','reference');form.set('file',new Blob([images['body_front.png']]),'concept.png');
  await call(`/projects/${p.id}/upload`,form);await call(`/projects/${p.id}/confirm-reference`,{});
  const route=`/projects/${p.id}/codex`;
  const importZip=(buffer,replace=false)=>{const f=new FormData();f.set('file',new Blob([buffer]),'fita_views.zip');f.set('replace',String(replace));return call(route+'/import',f);};
  return {store,base,call,route,importZip,p:()=>store.get(p.id),dataDir};
}
test('Codex prompt defines eight separate views, anatomical profiles, T-pose and project-bound delivery',()=>{
  const p=sample();p.notes='Conservar flequillo';const prompt=promptFor(p);
  for(const slot of slots)assert.ok(prompt.includes(slot.file));
  for(const text of ['SIN cabeza NI pelo','CON cuello','SIN cuello, hombros ni torso','Pose T','IZQUIERDO anatómico','DERECHO anatómico','manifest.json','Conservar flequillo','REGLAS FIJAS','PRIORIDAD BAJA','NUNCA a la cabeza','dos brazos','MANOS PARA RIGGING','Muñecas neutras','Cinco dedos','Amplía ambas manos'])assert.ok(prompt.includes(text),text);
  assert.ok(prompt.indexOf('REGLAS FIJAS')<prompt.indexOf('Conservar flequillo'));
  for(const text of ['UNA VISTA POR IMAGEN','una solicitud de imagen independiente','En CADA solicitud','no garantiza que el contenido visual sea correcto','repite únicamente esa imagen'])assert.ok(prompt.includes(text),text);
  assert.equal(manifestFor(p).files.length,10);assert.equal(manifestFor(p).referenceRevision,1);
});
test('ZIP validates eight decoded PNGs and rejects stale project, concept and notes manifests',async()=>{
  const p=sample(),bytes=await packageFor(p);assert.equal((await validatePackage(bytes,p)).length,10);
  for(const change of [{id:'another'},{reference:{id:'other.png'}},{referenceRevision:2},{notesRevision:2},{notes:'changed without revision'}])await assert.rejects(validatePackage(bytes,{...p,...change}),/another concept/);
});
test('ZIP rejects missing, renamed, nested, duplicate-content and invalid image files before saving',async()=>{
  const p=sample();
  const files={...images,'manifest.json':Buffer.from(JSON.stringify(manifestFor(p)))};
  const missing={...files};delete missing['head_back.png'];await assert.rejects(validatePackage(await zipBuffers(missing),p),/ten named PNG/);
  const nested={...missing,'folder/head_back.png':images['head_back.png']};await assert.rejects(validatePackage(await zipBuffers(nested),p),/unsafe files/);
  await assert.rejects(validatePackage(await packageFor(p,{'head_back.png':images['head_front.png']}),p),/identical pixels/);
  await assert.rejects(validatePackage(await packageFor(p,{'head_back.png':Buffer.from('not image')}),p),/valid PNG/);
  const jpeg=await sharp(images['head_back.png']).jpeg().toBuffer();await assert.rejects(validatePackage(await packageFor(p,{'head_back.png':jpeg}),p),/valid PNG/);
  const tiny=await sharp(images['head_back.png']).resize(64,64).png().toBuffer();await assert.rejects(validatePackage(await packageFor(p,{'head_back.png':tiny}),p),/512/);
  await assert.rejects(validatePackage(await packageFor(p,{'manifest.json':Buffer.from('null')}),p),/another concept/);
  await assert.rejects(readViewZip(Buffer.from('not ZIP')),/Invalid/);
});
test('ZIP bounds inflated entries and rejects duplicated names and traversal paths',async()=>{
  const p=sample();await assert.rejects(validatePackage(await packageFor(p,{'head_back.png':Buffer.alloc(21*1024*1024)}),p),/exceeds 20 MB/);
  const original=await packageFor(p);
  // Alter both local and central filename records without touching data or CRC.
  const replaceName=(from,to)=>{assert.equal(from.length,to.length);const copy=Buffer.from(original);let pos=0;while((pos=copy.indexOf(from,pos))>=0){copy.write(to,pos);pos+=to.length;}return copy;};
  await assert.rejects(readViewZip(replaceName('head_left.png','head_back.png')),/unsafe/);
  await assert.rejects(readViewZip(replaceName('head_back.png','../d_back.png')),/Invalid|unsafe/);
});
test('round trip exports original concept; import fills all slots but never approves or generates',async t=>{
  const h=await harness(t);const handoff=(await h.call(h.route)).data;
  assert.equal(handoff.manifest.projectId,h.p().id);
  const response=await fetch(h.base+'/api'+h.route+'/package');assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/fita_concept.zip/);
  // The input package deliberately cannot be mistaken for a completed output ZIP.
  const input=Buffer.from(await response.arrayBuffer());assert.ok(input.includes(Buffer.from('UBICACIONES.json')));assert(!input.includes(Buffer.from('concept.png')));assert.ok(input.includes(Buffer.from('INSTRUCTIONS.txt')));assert(!input.includes(Buffer.from('INSTRUCCIONES.txt')));
  assert.equal((await h.importZip(input)).status,400);
  const r=await h.importZip(await packageFor(h.p()));assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.viewSetReady,false);assert.equal(r.data.models.length,0);assert.equal(r.data.jobs.length,0);
  for(const g of ['head','body']){assert.equal(Object.keys(r.data.groups[g].views).length,4);assert.equal(r.data.groups[g].approved,false);assert.equal(r.data.groups[g].selectedViews.length,4);}
  assert.equal(r.data.codexImports.length,1);
  assert.deepEqual(Object.keys(r.data.placementReferences).sort(),['front','left']);
  const placement=(await h.call(`/projects/${h.p().id}/placement`)).data;assert.deepEqual(placement.references,r.data.placementReferences);
  assert.equal(r.data.codexImports[0].assets.length,10);
  const stored=JSON.parse(await fs.readFile(path.join(h.dataDir,h.p().id+'.json')));assert.equal(stored.codexImports.length,1);
});
test('replacement requires consent, keeps old assets and revokes approvals and model eligibility',async t=>{
  const h=await harness(t);assert.equal((await h.importZip(await packageFor(h.p()))).status,200);
  const oldGuide=h.p().placementReferences.front;
  const old=h.p().groups.body.views.front;h.p().groups.body.approval={id:'old-review'};h.p().models.push({id:'old.glb',obsolete:false});await h.store.save(h.p());
  const before=JSON.stringify(h.p()),zip=await packageFor(h.p());
  assert.equal((await h.importZip(zip)).status,409);assert.equal(JSON.stringify(h.p()),before);
  const next=await h.importZip(zip,true);assert.equal(next.status,200);
  assert.equal(h.p().viewHistory.filter(v=>v.group==='body').length,4);assert.equal(h.p().groups.body.approvalHistory.length,1);
  assert.equal(h.p().models[0].obsolete,true);assert.equal(h.p().groups.body.approval,null);
  assert.ok(await h.store.read(h.p(),old));
  assert.notEqual(h.p().placementReferences.front.id,oldGuide.id);assert.ok(await h.store.read(h.p(),oldGuide));assert.equal(h.p().placementReferenceHistory.length,1);
});
test('failed final image and failed asset write leave all current views untouched',async t=>{
  const h=await harness(t),before=JSON.stringify(h.p());
  assert.equal((await h.importZip(await packageFor(h.p(),{'head_back.png':Buffer.from('broken')}))).status,400);assert.equal(JSON.stringify(h.p()),before);
  const asset=h.store.asset.bind(h.store);let count=0;
  h.store.asset=async(...args)=>{if(++count===4)throw new Error('Simulated disk failure');return asset(...args);};
  const r=await h.importZip(await packageFor(h.p()));assert.equal(r.status,500);assert.equal(JSON.stringify(h.p()),before);
  assert.equal((await fs.readdir(path.join(h.dataDir,h.p().id))).length,1);
});
test('concurrent project changes and active texture or placement work block replacement',async t=>{
  const h=await harness(t),asset=h.store.asset.bind(h.store);let once=false;
  h.store.asset=async(...args)=>{const result=await asset(...args);if(!once){once=true;h.p().revision++;}return result;};
  assert.equal((await h.importZip(await packageFor(h.p()))).status,409);assert.equal(Object.keys(h.p().groups.head.views).length,0);
  h.store.asset=asset;
  h.p().textureOperations=[{status:'running'}];assert.equal((await h.importZip(await packageFor(h.p()))).status,409);
  h.p().textureOperations=[];h.p().placements=[{status:'queued'}];assert.equal((await h.importZip(await packageFor(h.p()))).status,409);
});
test('failed project persistence restores the previous in-memory project and discards staged files',async t=>{
  const h=await harness(t),before=JSON.stringify(h.p()),save=h.store.save.bind(h.store);
  h.store.save=async p=>{h.store.projects.set(p.id,p);throw new Error('Simulated manifest disk failure');};
  const r=await h.importZip(await packageFor(h.p()));assert.equal(r.status,500);
  assert.equal(JSON.stringify(h.p()),before);assert.equal((await fs.readdir(path.join(h.dataDir,h.p().id))).length,1);
  h.store.save=save;
});
test('simultaneous imports commit once and discard the competing staged assets',async t=>{
  const h=await harness(t),zip=await packageFor(h.p());
  const results=await Promise.all([h.importZip(zip),h.importZip(zip)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(h.p().codexImports.length,1);
  assert.equal((await fs.readdir(path.join(h.dataDir,h.p().id))).length,11);
});
test('Codex controls and import errors are translated without altering filenames',()=>{
  assert.equal(translate('es','Import views ZIP'),'Importar ZIP de vistas');
  assert.notEqual(translateMessage('ja','The project changed during import. Try again.'),'The project changed during import. Try again.');
  assert.equal(translateMessage('es','body_left.png'),'body_left.png');
});


 test('both placement guides are mandatory in v2, fully validated and never partially committed',async t=>{
  const h=await harness(t),p=h.p(),before=JSON.stringify(p),files={...images,'manifest.json':Buffer.from(JSON.stringify(manifestFor(p)))};
  for(const side of ['front','left']){
   const broken={...files};delete broken[`reference_${side}.png`];assert.equal((await h.importZip(await zipBuffers(broken))).status,400);assert.equal(JSON.stringify(h.p()),before);
  }
  assert.equal((await h.importZip(await packageFor(p,{'reference_left.png':Buffer.from('bad guide')}))).status,400);assert.equal(JSON.stringify(h.p()),before);
  const asset=h.store.asset.bind(h.store);let count=0;h.store.asset=async(...args)=>{if(++count===10)throw Error('Failure writing last guide');return asset(...args);};
  assert.equal((await h.importZip(await packageFor(p))).status,500);assert.equal(JSON.stringify(h.p()),before);assert.equal((await fs.readdir(path.join(h.dataDir,p.id))).length,1);
 });
 test('stored guides survive project reload but stop matching after a concept, notes or model view change',async t=>{
  const h=await harness(t);assert.equal((await h.importZip(await packageFor(h.p()))).status,200);
  const p=h.p();assert.ok(placementReferences(p).front);
  for(const mutate of [x=>x.reference.id='new',x=>x.notesRevision++,x=>x.groups.body.views.left.id='replacement']){const changed=structuredClone(p);mutate(changed);assert.deepEqual(placementReferences(changed),{front:null,left:null});}
  const stored=JSON.parse(await fs.readFile(path.join(h.dataDir,p.id+'.json')));assert.deepEqual(placementReferences(stored),placementReferences(p));
 });
 test('legacy eight-image archive remains readable without inventing placement guides',async t=>{
  const h=await harness(t);const files=Object.fromEntries(modelSlots.map(s=>[s.file,images[s.file]]));files['manifest.json']=Buffer.from(JSON.stringify(manifestFor(h.p(),{legacy:true})));
  const bytes=await zipBuffers(files);assert.equal((await validatePackage(bytes,h.p())).length,8);
  await assert.rejects(validatePackage(bytes,h.p(),{expectedSchema:'workbench-views/v2'}),/another concept/);
  assert.equal((await h.importZip(bytes)).status,200);assert.deepEqual(placementReferences(h.p()),{front:null,left:null});
 });

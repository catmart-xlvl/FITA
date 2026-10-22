import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yauzl from 'yauzl';
import {localInstructionPackage,instructionPackageFromCache,skillLocations} from '../server/local-instruction-package.js';
import {zipBuffers} from '../server/codex-handoff.js';
import {workspaceFiles} from './local-workspace-helper.js';
import {visualSpecification} from '../server/visual-specification.js';
import {createHash} from 'node:crypto';
const unpack=bytes=>new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(e,z)=>{if(e)return reject(e);const files={};z.on('error',reject);z.on('end',()=>resolve(files));z.on('entry',e=>z.openReadStream(e,(err,s)=>{if(err)return reject(err);const b=[];s.on('data',v=>b.push(v));s.on('end',()=>{files[e.fileName]=Buffer.concat(b);z.readEntry();});}));z.readEntry();}));
test('task ZIP has instructions only; every model/helper has an exact project-local path',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'instruction-package-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store={root:path.join(dir,'data')},p={id:'test',name:'Fixture'},files={'INSTRUCCIONES.txt':Buffer.from('Read manifest.json'),'head.glb':Buffer.from('model'),'skeleton.blend':Buffer.from('skeleton'),'references/front.png':Buffer.from('image'),'scripts/helper.py':Buffer.from('print(1)'),'skills/old/SKILL.md':Buffer.from('obsolete')};
 const zip=await localInstructionPackage(store,p,'test',files,'grant'),out=await unpack(zip),resources=await workspaceFiles(out);
 assert.deepEqual(Object.keys(out).sort(),['INSTRUCCIONES.txt','UBICACIONES.json']);assert.deepEqual(resources['head.glb'],files['head.glb']);assert(!resources['skills/old/SKILL.md']);
 const m=JSON.parse(out['UBICACIONES.json']);assert(m.workspace.startsWith(path.join(dir,'projects',p.id)));await fs.access(m.outputDirectory);
 for(const s of m.skills){await fs.access(s.entry);assert(path.isAbsolute(s.entry));}
});
test('old pending packages migrate without renewing consent or changing delivery credentials',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'instruction-cache-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store={root:path.join(dir,'data')},p={id:'test',name:'Fixture'},filename=path.join(dir,'old.zip'),descriptor=Buffer.from('{"deliveryId":"same","token":"same"}');
 await fs.writeFile(filename,await zipBuffers({'INSTRUCCIONES.txt':Buffer.from('Read skills/refinamiento-texturas-anime/SKILL.md'),'ENTREGA_LOCAL.json':descriptor,'head.glb':Buffer.from('original'),'skills/refinamiento-texturas-anime/SKILL.md':Buffer.from('outdated')}));
 const first=await instructionPackageFromCache(store,p,'texture-refinement','same',filename),files=await workspaceFiles(await unpack(first));
 assert.deepEqual(files['ENTREGA_LOCAL.json'],descriptor);assert(files['SKILLS_REQUERIDAS.txt']);assert(!files['INSTRUCCIONES.txt'].includes(Buffer.from('skills/refinamiento')));
 assert.deepEqual(await instructionPackageFromCache(store,p,'texture-refinement','same',filename),first);
});
test('active refinement and neck instructions resolve maintained skills and their linked references',async()=>{
 for(const s of skillLocations(['refinamiento-texturas-anime','refinamiento-rasgos-faciales-anime','colocacion-personaje-por-referencias'])){
  const body=await fs.readFile(s.entry,'utf8');for(const m of body.matchAll(/\]\((references\/[^)]+)\)/g))await fs.access(path.resolve(path.dirname(s.entry),m[1]));
 }
 const neck=await fs.readFile(new URL('../server/neck-handoff.js',import.meta.url),'utf8');assert(neck.includes('SKILLS_REQUERIDAS.txt'));assert(neck.includes('colocacion-personaje-por-referencias'));
 const prompts=await fs.readFile(new URL('../server/texture-refinement-prompts.js',import.meta.url),'utf8');assert(prompts.includes('SKILLS_REQUERIDAS.txt'));assert(prompts.includes('refinamiento-rasgos-faciales-anime'));
});

test('image guidance is app-owned and available even with no personal or stage skills',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'visual-guidance-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const files=await unpack(await localInstructionPackage({root:path.join(dir,'data')},{id:'p',name:'Visual'},'views',{'PROMPT.txt':Buffer.from('Stage contract')},'grant',[]));
 const m=JSON.parse(files['UBICACIONES.json']);
 assert.deepEqual(m.skills,[]);
 assert.deepEqual(m.visualSpecification,visualSpecification);
 assert.equal(m.visualSpecification.invocation,'only-when-image-generation-is-authorized');
 const skill=await fs.readFile(m.visualSpecification.entry,'utf8');
 await fs.access(m.visualSpecification.contract);
 for(const match of skill.matchAll(/\]\((references\/[^)]+)\)/g))await fs.access(path.resolve(path.dirname(m.visualSpecification.entry),match[1]));
 assert(m.visualSpecification.entry.startsWith(path.resolve('skills')+path.sep));
 assert(files['INSTRUCTIONS.txt'].includes(Buffer.from(m.visualSpecification.entry)));
 const prompt=(await workspaceFiles(files))['PROMPT.txt'].toString('utf8');
 assert(prompt.startsWith('Stage contract\n'));assert(prompt.includes('GUÍA DE POSE T — SOLO POSE'));
});

test('cached image packages update only instruction text, preserving source files, output and grants',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'appearance-cache-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store={root:path.join(dir,'data')},p={id:'test',name:'Fixture'},filename=path.join(dir,'cached.zip'),files=await unpack(await localInstructionPackage(store,p,'views',{'PROMPT.txt':Buffer.from('Stage contract'),'manifest.json':Buffer.from('{"unchanged":true}'),'ENTREGA_LOCAL.json':Buffer.from('{"token":"unchanged"}')},'grant',[])),descriptor=JSON.parse(files['UBICACIONES.json']);
 delete descriptor.productionAppearance;
 const entry=descriptor.entries.find(e=>e.name==='PROMPT.txt');await fs.writeFile(entry.path,'Stage contract\n\nACABADO DE ILUSTRACIÓN VTUBER: detalle fino moderado\n\nTRANSPARENCIA: conservar alfa');
 entry.sha256=createHash('sha256').update(await fs.readFile(entry.path)).digest('hex');
 files['UBICACIONES.json']=Buffer.from(JSON.stringify(descriptor));await fs.writeFile(filename,await zipBuffers(files));
 await fs.writeFile(path.join(descriptor.outputDirectory,'approved.png'),'approved output');
 const result=await instructionPackageFromCache(store,p,'views','grant',filename),updated=await workspaceFiles(await unpack(result));
 assert(updated['PROMPT.txt'].includes(Buffer.from('SIMPLIFICACIÓN PARA LAS OCHO VISTAS')));assert(!updated['PROMPT.txt'].includes(Buffer.from('detalle fino moderado')));
 assert.equal(updated['manifest.json'].toString(),'{"unchanged":true}');assert.equal(updated['ENTREGA_LOCAL.json'].toString(),'{"token":"unchanged"}');assert.equal(await fs.readFile(path.join(descriptor.outputDirectory,'approved.png'),'utf8'),'approved output');
 assert.deepEqual(await instructionPackageFromCache(store,p,'views','grant',filename),result);
});

test('pending finish packages receive official paint helpers without altering original UV sources or prior edits',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paint-handoff-cache-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store={root:path.join(dir,'data')},p={id:'test',name:'Fixture'},filename=path.join(dir,'old.zip'),input={'INSTRUCCIONES.txt':Buffer.from('Old face unwrap instructions'),'manifest.json':Buffer.from('{"refinementSkillsVersion":7}'),'models/head.glb':Buffer.from('original Tripo UV source'),'edited/head_0.png':Buffer.from('paint already approved'),'ENTREGA_LOCAL.json':Buffer.from('{"token":"keep-original"}')};
 const files=await unpack(await localInstructionPackage(store,p,'texture-refinement',input,'grant',[])),m=JSON.parse(files['UBICACIONES.json']);delete m.refinementGuidance;
 const instruction=m.entries.find(e=>e.name==='INSTRUCCIONES.txt');await fs.writeFile(instruction.path,'Old face unwrap instructions');
 files['UBICACIONES.json']=Buffer.from(JSON.stringify(m));await fs.writeFile(filename,await zipBuffers(files));
 const result=await instructionPackageFromCache(store,p,'texture-refinement','grant',filename),updated=await workspaceFiles(await unpack(result));
 for(const name of ['manifest.json','models/head.glb','edited/head_0.png','ENTREGA_LOCAL.json'])assert.deepEqual(updated[name],input[name]);
 assert(updated['PINTAR_TEXTURAS.py']);assert(updated['paint-runtime.json']);assert(updated['INSTRUCCIONES.txt'].includes(Buffer.from('conservar las UV de Tripo')));
 assert.deepEqual(await instructionPackageFromCache(store,p,'texture-refinement','grant',filename),result);
});

test('cached two-file packages gain visual guidance without touching workspace, output, or delivery authorization',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'visual-cache-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store={root:path.join(dir,'data')},p={id:'p',name:'Cached'},filename=path.join(dir,'cached.zip');
 const credentials=Buffer.from('{"token":"unchanged","deliveryId":"same"}');
 const current=await unpack(await localInstructionPackage(store,p,'views',{'ENTREGA_LOCAL.json':credentials,'manifest.json':Buffer.from('original')},'same',[]));
 const old=JSON.parse(current['UBICACIONES.json']);delete old.visualSpecification;
 await fs.writeFile(path.join(old.outputDirectory,'especificacion-visual.json'),'artist-approved decisions');
 await fs.writeFile(filename,await zipBuffers({'INSTRUCCIONES.txt':Buffer.from('Existing instructions'),'UBICACIONES.json':Buffer.from(JSON.stringify(old))}));
 const migrated=await instructionPackageFromCache(store,p,'views','same',filename),updated=await unpack(migrated),descriptor=JSON.parse(updated['UBICACIONES.json']);
 assert.deepEqual(descriptor.entries,old.entries);assert.equal(descriptor.workspace,old.workspace);
 assert.deepEqual((await workspaceFiles(updated))['ENTREGA_LOCAL.json'],credentials);
 assert.equal(await fs.readFile(path.join(old.outputDirectory,'especificacion-visual.json'),'utf8'),'artist-approved decisions');
 assert.equal(descriptor.visualSpecification.revision,visualSpecification.revision);
 assert.deepEqual(await instructionPackageFromCache(store,p,'views','same',filename),migrated);
});

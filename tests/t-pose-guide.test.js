import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {poseGuideFiles,tPoseGuideSha256,tPoseInstructions,tPoseAngles,withPoseGuideFiles} from '../server/t-pose-guide.js';
import {localInstructionPackage,instructionPackageFromCache} from '../server/local-instruction-package.js';
import {workspaceFiles} from './local-workspace-helper.js';
import {zipBuffers} from '../server/codex-handoff.js';
import yauzl from 'yauzl';
async function unzip(buffer){return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(error,z)=>{if(error)return reject(error);const files={};z.on('error',reject);z.on('end',()=>resolve(files));z.on('entry',e=>z.openReadStream(e,(error,s)=>{if(error)return reject(error);const chunks=[];s.on('data',b=>chunks.push(b));s.on('end',()=>{files[e.fileName]=Buffer.concat(chunks);z.readEntry();});}));z.readEntry();}));}
test('pose-only diagrams are real PNGs, keep design authority on concept, and cover exact T angles and side occlusion',async()=>{
 const files=await poseGuideFiles();
 const m=await sharp(files['POSE_T_FRENTE.png']).metadata();assert.equal(m.format,'png');assert.equal(m.width,1280);assert.equal(m.height,1280);
 assert.equal(createHash('sha256').update(files['POSE_T_FRENTE.png']).digest('hex'),tPoseGuideSha256);
 assert.equal(files['POSE_T_PERFIL.png'],undefined);
 assert.deepEqual(tPoseAngles,{shoulderAbduction:90,shoulderFlexion:0,elbowFlexion:0,elbowInternal:180,wristFlexion:0,wristDeviation:0});
 for(const phrase of ['NO es un concepto','SILUETA GRIS','no copies la anatomía','no ejecuta un rig','superpuestos en profundidad','Un antebrazo horizontal NO compensa'])assert(tPoseInstructions.includes(phrase));
 const once=await withPoseGuideFiles({'PROMPT.txt':Buffer.from('Primary concept remains authoritative')});
 const twice=await withPoseGuideFiles(once);assert(once['PROMPT.txt'].equals(twice['PROMPT.txt']));
});
test('new and cached view packages provide pose guides without changing concepts, manifest, output or delivery token',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pose-guides-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store={root:path.join(root,'data')},p={id:'fixture',name:'Pose fixture'};
 const assets={'concept.png':Buffer.from('protected concept'),'manifest.json':Buffer.from('{"unchanged":true}'),'ENTREGA_LOCAL.json':Buffer.from('{"token":"protected-fixture-token"}'),'PROMPT.txt':Buffer.from('Original design instructions'),'INSTRUCCIONES.txt':Buffer.from('Follow primary')};
 const bytes=await localInstructionPackage(store,p,'views',assets,'new-package');
 const files=await workspaceFiles(await unzip(bytes));
 for(const key of ['concept.png','manifest.json','ENTREGA_LOCAL.json'])assert(files[key].equals(assets[key]));
 assert(files['POSE_T_FRENTE.png']&&files['POSE_T.txt']);
 // Reproduce a pre-guide instruction-only cache in a different saved workspace.
 const wrapper=await unzip(bytes),descriptor=JSON.parse(wrapper['UBICACIONES.json']);
 delete descriptor.poseGuidance;descriptor.entries=descriptor.entries.filter(e=>!e.name.startsWith('POSE_T'));
 wrapper['UBICACIONES.json']=Buffer.from(JSON.stringify(descriptor));
 const filename=path.join(root,'cached.zip');await fs.writeFile(filename,await zipBuffers(wrapper));
 const output=path.join(descriptor.outputDirectory,'body_front.png');await fs.writeFile(output,'existing completed image');
 const updated=await instructionPackageFromCache(store,p,'views','new-package',filename),fresh=await workspaceFiles(await unzip(updated));
 assert(fresh['POSE_T_FRENTE.png']&&fresh['POSE_T.txt']);
 for(const key of ['concept.png','manifest.json','ENTREGA_LOCAL.json'])assert(fresh[key].equals(assets[key]));
 assert.equal(await fs.readFile(output,'utf8'),'existing completed image');
 const repeated=await instructionPackageFromCache(store,p,'views','new-package',filename);assert(updated.equals(repeated));
});

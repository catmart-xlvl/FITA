import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import yauzl from 'yauzl';
import {findBlender} from './placement.js';
import {glbBuffer} from './validation.js';

export const isFbx=bytes=>bytes.subarray(0,23).toString('ascii').startsWith('Kaydara FBX Binary  ')||/^; FBX\s/.test(bytes.subarray(0,40).toString('ascii'));
export async function fbxBuffer(bytes){
 if(bytes.length<20||bytes.length>150*1024*1024)throw Error('STUDIO_INVALID_FBX');
 if(isFbx(bytes))return bytes;
 if(bytes.readUInt16LE(0)!==0x4b50)throw Error('STUDIO_INVALID_FBX');
 // Some Studio exports wrap FBX in a ZIP. Never extract paths or execute files.
 return new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(error,zip)=>{
  if(error)return reject(error);let found=null,entries=0,total=0;
  const fail=e=>{zip.close();reject(e);};zip.on('error',fail);
  zip.on('entry',entry=>{
   if(++entries>64||entry.uncompressedSize>150*1024*1024||entry.fileName.includes('..')||entry.fileName.startsWith('/')||entry.fileName.includes('\\'))return fail(Error('STUDIO_INVALID_FBX_ARCHIVE'));
   total+=entry.uncompressedSize;if(total>200*1024*1024)return fail(Error('STUDIO_INVALID_FBX_ARCHIVE'));
   if(!/\.fbx$/i.test(entry.fileName)){zip.readEntry();return;}
   if(found)return fail(Error('STUDIO_FBX_AMBIGUOUS'));
   zip.openReadStream(entry,(err,stream)=>{if(err)return fail(err);const chunks=[];let size=0;stream.on('error',fail);stream.on('data',chunk=>{size+=chunk.length;if(size>150*1024*1024)return fail(Error('STUDIO_INVALID_FBX'));chunks.push(chunk);});stream.on('end',()=>{found=Buffer.concat(chunks);zip.readEntry();});});
  });
  zip.on('end',()=>found&&isFbx(found)?resolve(found):reject(Error('STUDIO_INVALID_FBX')));zip.readEntry();
 }));
}
export async function candidatePreview(fbx,{executable,run}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fita-candidate-'));
 try{
  const file=path.join(dir,'source.fbx');await fs.writeFile(file,fbx);
  if(run)await run(dir);else{
   executable ||= await findBlender();if(!executable)throw Error('PLACEMENT_BLENDER_NOT_FOUND');
   await new Promise((resolve,reject)=>{
    const child=spawn(executable,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',path.resolve('server/blender/candidate_preview.py'),'--',dir],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let tail='';const timer=setTimeout(()=>{child.kill();reject(Error('CANDIDATE_PREVIEW_TIMEOUT'));},180000);
    for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{tail=(tail+d).slice(-1500);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('CANDIDATE_PREVIEW_FAILED: '+tail));});
   });
  }
  const report=JSON.parse(await fs.readFile(path.join(dir,'topology.json'),'utf8'));
  if(report.version!==1||!Number.isSafeInteger(report.quads)||report.quads<1)throw Error('STUDIO_NATIVE_QUADS_MISSING');
  return {bytes:glbBuffer(await fs.readFile(path.join(dir,'preview.glb'))),report};
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}

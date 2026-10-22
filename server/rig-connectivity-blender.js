import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {findBlender} from './placement.js';

export async function validateEditableRigConnectivity(source,result,{meshNames}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wb-rig-connectivity-'));
  try{
    const executable=await findBlender();if(!executable)throw Error('PLACEMENT_BLENDER_NOT_FOUND');
    const job={source:path.join(dir,'source.blend'),result:path.join(dir,'result.blend'),report:path.join(dir,'report.json'),...(meshNames?{meshNames}:{})};
    await fs.writeFile(job.source,source);await fs.writeFile(job.result,result);const file=path.join(dir,'job.json');await fs.writeFile(file,JSON.stringify(job));
    await new Promise((resolve,reject)=>{
      const child=spawn(executable,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',path.resolve('server/blender/validate_rig_connectivity.py'),'--',file],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
      let tail='';const collect=b=>tail=(tail+b.toString()).slice(-6000);child.stdout.on('data',collect);child.stderr.on('data',collect);
      const timer=setTimeout(()=>{child.kill();reject(Error('RIG_CONNECTIVITY_TIMEOUT'));},120000);
      child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(Object.assign(Error(tail.match(/ValueError: ([^\r\n]+)/)?.[1]||'RIG_CONNECTIVITY_VALIDATION_FAILED'),{status:400}));});
    });
    return JSON.parse(await fs.readFile(job.report,'utf8'));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}

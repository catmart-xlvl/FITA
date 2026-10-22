import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import multer from 'multer';
import {findBlender} from './placement.js';
import {inspectRiggedGlb} from './rigging-validation.js';
import {inspectRigConnectivity} from './rig-connectivity.js';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function runWeightExchange(folder,job){
  const executable=await findBlender();if(!executable)fail('PLACEMENT_BLENDER_NOT_FOUND');
  const jobFile=path.join(folder,randomUUID()+'.json');await fs.writeFile(jobFile,JSON.stringify({...job,folder}));
  await new Promise((resolve,reject)=>{
    const child=spawn(executable,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',path.resolve('server/blender/rig_weight_exchange.py'),'--',jobFile],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let tail='';const timer=setTimeout(()=>{child.kill();reject(Error('RIG_EDIT_TIMEOUT'));},180000);
    const collect=b=>{tail=(tail+b.toString()).slice(-12000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(Object.assign(Error(tail.match(/ValueError: (RIG_EDIT_[^\r\n]+)/)?.[1]||'RIG_EDIT_CONVERSION_FAILED'),{status:400}));});
  });
}

export function mountManualRig(app,{store,editable,riggingSource,runExchange=runWeightExchange}){
  const root='/api/projects/:id/rigging/manual',locks=new Set();
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:150*1024*1024,files:1,fields:0}});
  const directory=(p,id)=>path.join(path.dirname(store.root),'projects',p.id,'rigging','manual',id);
  const rootCurrent=(p,s)=>{
    if(s.sourcePlacementId!==riggingSource(p)?.id)return false;
    if(s.kind==='donor')return [...(p.rigDonors||[])].reverse().find(d=>d.sourcePlacementId===s.sourcePlacementId)?.id===s.id;
    return p.rigRefinements?.some(r=>r.id===s.id&&r.version===s.version&&r.sourcePlacementId===s.sourcePlacementId)===true;
  };
  const state=p=>({edits:(p.rigWeightEdits||[]).map(e=>({...e,current:rootCurrent(p,e.rootSource)}))});
  const session=(p,id)=>p.rigWeightSessions?.find(s=>s.id===id)||fail('RIG_EDIT_SESSION_NOT_FOUND',404);
  const current=(p,s)=>{editable(p);if(!rootCurrent(p,s.rootSource))fail('RIG_EDIT_SOURCE_CHANGED',409);};
  async function locked(p,fn){editable(p);if(locks.has(p.id))fail('RIG_EDIT_BUSY',409);locks.add(p.id);try{return await fn();}finally{locks.delete(p.id);}}
  async function source(p,input){
    const placement=riggingSource(p)?.id;
    if(input.kind==='manual'){
      const e=p.rigWeightEdits?.find(e=>e.id===input.id);if(!e||!rootCurrent(p,e.rootSource))fail('RIG_EDIT_SOURCE_CHANGED',409);
      return {bytes:await store.read(p,e.asset),rootSource:e.rootSource,runtime:e.runtime};
    }
    if(input.kind==='donor'){
      const donor=[...(p.rigDonors||[])].reverse().find(d=>d.sourcePlacementId===placement);
      if(!donor||donor.id!==input.id)fail('RIG_EDIT_SOURCE_CHANGED',409);
      return {bytes:await store.read(p,donor.asset),rootSource:{kind:'donor',id:donor.id,sourcePlacementId:placement},runtime:{humanoid:donor.profile.humanoid,twists:[],correctives:[]}};
    }
    const r=p.rigRefinements?.find(r=>r.id===input.id&&r.version===input.version&&r.sourcePlacementId===placement);
    if(input.kind!=='result'||!r?.version)fail('RIG_EDIT_SOURCE_CHANGED',409);
    const file=path.join(path.dirname(store.root),'projects',p.id,'rigging',r.id,'reports',r.version,'rigged.glb');
    return {bytes:await fs.readFile(file),rootSource:{kind:'result',id:r.id,version:r.version,sourcePlacementId:placement},runtime:r.runtime};
  }
  async function ensureFbx(p,s){
    const folder=directory(p,s.id);if(hash(await fs.readFile(path.join(folder,'model.glb')))!==s.baseHash)fail('RIG_EDIT_SOURCE_CHANGED',409);if(await fs.stat(path.join(folder,'fbx-reference.json')).then(()=>true,()=>false))return;
    await runExchange(folder,{mode:'export'});
  }
  app.get(root,(q,s)=>s.json(state(store.get(q.params.id))));
  app.post(root+'/prepare',async(q,s)=>{
    const p=store.get(q.params.id);await locked(p,async()=>{
      const input={kind:q.body.kind,id:q.body.id,...(q.body.version?{version:q.body.version}:{})},key=JSON.stringify({...input,connectivityVersion:1,fbxExportVersion:2});
      const resolved=await source(p,input),baseHash=hash(resolved.bytes);
      const found=p.rigWeightSessions?.find(e=>e.key===key&&e.baseHash===baseHash);
      if(found){s.json(found);return;}
      inspectRiggedGlb(resolved.bytes,null,{baseline:true});
      const entry={id:randomUUID(),key,baseHash,rootSource:resolved.rootSource,runtime:resolved.runtime,createdAt:new Date().toISOString()};
      const folder=directory(p,entry.id);await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'model.glb'),resolved.bytes);
      if(store.get(p.id)!==p)fail('RIG_EDIT_SOURCE_CHANGED',409);
      const next=structuredClone(p);(next.rigWeightSessions||=[]).push(entry);await store.save(next);s.json(entry);
    });
  });
  app.post(root+'/:sessionId/fbx',async(q,s)=>{
    const p=store.get(q.params.id),entry=session(p,q.params.sessionId);await locked(p,async()=>{current(p,entry);await ensureFbx(p,entry);s.json({ready:true});});
  });
  app.get(root+'/:sessionId/:file',async(q,s)=>{
    const p=store.get(q.params.id),entry=session(p,q.params.sessionId);
    if(!['model.glb','model.fbx'].includes(q.params.file))fail('RIG_EDIT_FILE_NOT_FOUND',404);
    const file=path.join(directory(p,entry.id),q.params.file);if(!await fs.stat(file).then(v=>v.isFile(),()=>false))fail('RIG_EDIT_FILE_NOT_READY',409);
    s.download(file,'character-weight-edit.'+(q.params.file.endsWith('fbx')?'fbx':'glb'));
  });
  app.post(root+'/:sessionId/import',upload.single('file'),async(q,s)=>{
    const p=store.get(q.params.id),entry=session(p,q.params.sessionId);await locked(p,async()=>{
      current(p,entry);const ext=path.extname(q.file?.originalname||'').toLowerCase();
      if(!q.file||!['.glb','.fbx'].includes(ext))fail('RIG_EDIT_FORMAT');
      if(ext==='.glb')inspectRiggedGlb(q.file.buffer,null,{baseline:true});
      else if(!q.file.buffer.subarray(0,23).toString().startsWith('Kaydara FBX Binary'))fail('RIG_EDIT_FBX_BINARY');
      const folder=directory(p,entry.id),base=await fs.readFile(path.join(folder,'model.glb'));if(hash(base)!==entry.baseHash)fail('RIG_EDIT_SOURCE_CHANGED',409);
      const sourceHash=hash(q.file.buffer),duplicate=p.rigWeightEdits?.find(e=>e.sessionId===entry.id&&e.sourceHash===sourceHash);
      if(duplicate){s.json({...state(p),edit:duplicate,duplicate:true});return;}
      if(ext==='.fbx')await ensureFbx(p,entry);
      const id=randomUUID(),candidate=path.join(folder,id+ext),output=path.join(folder,id+'-validated.glb'),reportFile=path.join(folder,id+'-report.json');
      await fs.writeFile(candidate,q.file.buffer);await runExchange(folder,{mode:'import',candidate,output,report:reportFile});
      const bytes=await fs.readFile(output),report=JSON.parse(await fs.readFile(reportFile,'utf8'));
      const validation={...inspectRiggedGlb(bytes,null),...inspectRigConnectivity(base,bytes)};if(store.get(p.id)!==p)fail('RIG_EDIT_SOURCE_CHANGED',409);current(p,entry);
      const edit={id,sessionId:entry.id,sourceHash,rootSource:entry.rootSource,asset:await store.asset(p,bytes,'glb','manual-rig-weights'),runtime:entry.runtime,report,validation,filename:path.basename(q.file.originalname),createdAt:new Date().toISOString()};
      if(store.get(p.id)!==p)fail('RIG_EDIT_SOURCE_CHANGED',409);
      const next=structuredClone(p);(next.rigWeightEdits||=[]).push(edit);await store.save(next);s.json({...state(next),edit});
    });
  });
}

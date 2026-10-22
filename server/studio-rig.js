import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=m=>{throw Object.assign(Error(m),{status:409});};
export function mountStudioRig(app,{store,bridge,editable,riggingSource,acceptDonor,downloadsDir=path.join(os.homedir(),'Downloads','FITA')}){
  if(!bridge)return;
  const root='/api/projects/:id/rigging/refinement/studio',timers=new Map(),active=new Set();
  const downloadFolders=[path.resolve(downloadsDir),...(downloadsDir===path.join(os.homedir(),'Downloads','FITA')?[path.join(os.homedir(),'Downloads','LocalWorkbench')]:[])];
  const jobs=p=>p.rigStudioJobs||[],latest=p=>jobs(p).at(-1);
  const current=(p,j)=>{if(j.sourcePlacementId!==riggingSource(p)?.id)fail('The placement changed. Prepare a new rigging workspace.');};
  function schedule(id){if(timers.has(id))return;const t=setTimeout(()=>{timers.delete(id);void advance(id);},2000);t.unref();timers.set(id,t);}
  function command(p,j,action,extra={}){const op=bridge.enqueue('rig',{action,operationId:j.id,taskId:j.taskId,...extra},{workflow:'rigging',projectId:p.id,rigJobId:j.id});j.operationId=op.id;j.action=action;j.stage=action==='prepare'?'preparing':'running';}
  async function advance(id){
    if(active.has(id))return;active.add(id);
    try{
      const original=store.get(id),j0=latest(original);if(!j0||!['preparing','running'].includes(j0.stage))return;
      current(original,j0);bridge.status();const live=bridge.getOperation(j0.operationId);
      if(live&&['queued','running'].includes(live.status)){schedule(id);return;}
      const p=structuredClone(original),j=latest(p);
      if(!live||live.status!=='succeeded'){j.stage='attention';j.error=live?.error||'STUDIO_SESSION_LOST';await store.save(p);return;}
      const r=live.result;
      if(j.action==='prepare'){
        if(r.stage!=='prepared'||r.sourceSha256!==j.sourceHash||!/^Unity Humanoid(?: compatible)?$/i.test(r.preset||'')||!/^\d+(?:[.,]\d+)?$/.test(r.costLabel||'')||!/^[a-f0-9-]{36}$/i.test(r.taskId||''))fail('RIG_UNITY_PRESET_NOT_VERIFIED');
        Object.assign(j,{stage:'quoted',taskId:r.taskId,costLabel:r.costLabel,preset:r.preset,quoteToken:randomUUID(),quoteExpiresAt:Date.now()+10*60000});
      }else if(j.action==='download'){
        if(r.stage==='requires_manual_import'&&r.taskId===j.taskId&&/^[A-Z0-9_]{1,100}$/.test(r.reason||''))fail(r.reason);
        if(r.stage!=='exported'||r.taskId!==j.taskId)fail('RIG_DOWNLOAD_INCOMPLETE');
        const file=r.download?.path;if(typeof file!=='string'||!downloadFolders.includes(path.dirname(path.resolve(file)))||!file.toLowerCase().endsWith('.glb'))fail('RIG_DOWNLOAD_INCOMPLETE');
        const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>150*1024*1024||path.dirname(await fs.realpath(file))!==await fs.realpath(path.dirname(file)))fail('RIG_DOWNLOAD_INCOMPLETE');
        const donor=await acceptDonor(p,await fs.readFile(file),path.basename(file));j.donorId=donor.id;j.stage='downloaded';
      }else if(j.action==='submit'){
        if(!['submitted','processing','ready'].includes(r.stage))fail('RIG_SUBMISSION_UNCERTAIN');command(p,j,r.stage==='ready'?'download':'monitor');
      }else if(j.action==='monitor'){
        if(!['processing','ready'].includes(r.stage))fail('RIG_SUBMISSION_UNCERTAIN');command(p,j,r.stage==='ready'?'download':'monitor');
      }
      if(store.get(id)!==original)fail('RIG_PROJECT_CHANGED');current(original,j);await store.save(p);if(j.stage==='running')schedule(id);
    }catch(e){try{const p=structuredClone(store.get(id)),j=latest(p);if(j){j.stage='attention';j.error=e.message;await store.save(p);}}catch{}}
    finally{active.delete(id);}
  }
  bridge.subscribe(op=>{if(op.context?.workflow==='rigging')schedule(op.context.projectId);});
  // Replacing a rigging input may stop local read-only monitoring. Keep the
  // remote task/receipt for recovery; never cancel, submit or repeat a paid job.
  app.post(root+'/stop-tracking',async(q,s)=>{
    const original=store.get(q.params.id),old=latest(original);
    if(q.body.confirm!==true||!old||q.body.jobId!==old.id)fail('RIG_STOP_TRACKING_CONFIRMATION');
    if(active.has(original.id))fail('Rigging workspace is being prepared. Try again shortly.');
    if(old.stage==='stopped'){s.json({job:old});return;}
    if(old.action!=='monitor'||!['running','attention'].includes(old.stage))fail('Only read-only rig monitoring can be stopped here.');
    current(original,old);
    active.add(original.id);
    try{
      const p=structuredClone(original),j=latest(p);j.stage='stopped';j.stoppedAt=new Date().toISOString();j.stopReason='user-replacing-rigging-input';
      await store.save(p);
      if(timers.has(p.id)){clearTimeout(timers.get(p.id));timers.delete(p.id);}
      s.json({job:j,remoteTaskCancelled:false});
    }finally{active.delete(original.id);}
  });
  app.post(root+'/prepare',async(q,s)=>{
    const original=store.get(q.params.id);editable(original);if(active.has(original.id))fail('Rigging workspace is being prepared. Try again shortly.');active.add(original.id);
    try{
      const source=riggingSource(original);if(!source)fail('Finish placement before preparing the rigging workspace.');
      const previous=latest(original);if(previous&&previous.sourcePlacementId===source.id){
        if(['preparing','running'].includes(previous.stage)&&bridge.getOperation(previous.operationId)||previous.stage==='quoted'&&previous.quoteExpiresAt>Date.now()){s.json({job:previous});return;}
        if((previous.stage==='attention'||previous.stage==='running'&&!bridge.getOperation(previous.operationId))&&previous.action!=='prepare'&&previous.error!=='RIG_SETTINGS_OR_COST_CHANGED')fail('Check the existing rig job before preparing another.');
      }
      const bytes=await store.read(original,source.preview),sourceHash=hash(bytes),p=structuredClone(original),j={id:randomUUID(),sourcePlacementId:source.id,sourceHash,createdAt:new Date().toISOString()};
      if(store.get(p.id)!==original)fail('RIG_PROJECT_CHANGED');
      command(p,j,'prepare',{groupKey:hash(Buffer.from(p.id+source.id+sourceHash)),model:{name:'workbench-complete-character.glb',sha256:sourceHash,dataBase64:bytes.toString('base64')}});(p.rigStudioJobs||=[]).push(j);await store.save(p);schedule(p.id);s.status(202).json({job:j});
    }finally{active.delete(original.id);}
  });
  app.post(root+'/submit',async(q,s)=>{
    const original=store.get(q.params.id),p=structuredClone(original),j=latest(p);if(!j)fail('RIG_QUOTE_REQUIRED');current(p,j);
    if(['running','downloaded'].includes(j.stage)){s.json({job:j});return;}
    if(j.stage!=='quoted'||j.quoteExpiresAt<Date.now()||q.body.confirmCost!==true||q.body.quoteToken!==j.quoteToken||q.body.expectedCost!==j.costLabel)fail('STUDIO_COST_CONFIRMATION');
    if(hash(await store.read(p,riggingSource(p).preview))!==j.sourceHash||store.get(p.id)!==original)fail('RIG_PROJECT_CHANGED');
    command(p,j,'submit',{confirmCost:true,expectedCost:j.costLabel});await store.save(p);schedule(p.id);s.status(202).json({job:j});
  });
  app.post(root+'/check',async(q,s)=>{
    const original=store.get(q.params.id);editable(original);
    if(active.has(original.id))fail('Rigging workspace is being prepared. Try again shortly.');active.add(original.id);
    try{
      const p=structuredClone(original),j=latest(p);if(!j)fail('RIG_QUOTE_REQUIRED');current(p,j);
      const live=bridge.getOperation(j.operationId),inFlight=live&&['queued','running'].includes(live.status);
      if(!inFlight&&(j.stage==='attention'||['preparing','running'].includes(j.stage))){
        if(j.action==='prepare'){
          const source=riggingSource(p),bytes=await store.read(p,source.preview);
          if(hash(bytes)!==j.sourceHash||store.get(p.id)!==original)fail('RIG_PROJECT_CHANGED');
          // Same source and group key recover the saved import receipt. No new
          // paid operation or duplicate model is requested after a lost reply.
          command(p,j,'prepare',{groupKey:hash(Buffer.from(p.id+source.id+j.sourceHash)),model:{name:'workbench-complete-character.glb',sha256:j.sourceHash,dataBase64:bytes.toString('base64')}});
        }else if(j.taskId&&['submit','monitor','download'].includes(j.action))command(p,j,j.action==='download'?'download':'monitor');
        else fail('RIG_QUOTE_REQUIRED');
        delete j.error;await store.save(p);schedule(p.id);
      }
      s.json({job:j});
    }finally{active.delete(original.id);}
  });
}

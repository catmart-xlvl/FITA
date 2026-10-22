import {assertPlacementEditing,reservePlacement,placementHandoffState} from './placement-state.js';
import {saveManualModelVersion,manualModelReady} from './manual-model-snapshot.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {placementTexture as currentTexture,inspectTextureGlb} from './texture-workflow.js';
import {glbBuffer} from './validation.js';
import {placementReferences,mountPlacementReferences} from './placement-references.js';
import {approveManual,currentManual,currentDraft,placementDraft,approvedProportions} from './manual-placement.js';
import {mountPlacementEditable} from './placement-editable.js';
import {mountScleraRepair} from './sclera-repair.js';
import {mountLipRepair} from './lip-repair.js';
import {mountPlacementArtistImport} from './placement-artist-import.js';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
export async function findBlender(){
  const candidates=[process.env.WORKBENCH_BLENDER];
  const root=path.join(process.env.ProgramFiles||'C:/Program Files','Blender Foundation');
  try{for(const folder of (await fs.readdir(root)).filter(x=>/^Blender \d/.test(x)).sort().reverse())candidates.push(path.join(root,folder,'blender.exe'));}catch{}
  for(const file of candidates.filter(Boolean)){try{if(path.isAbsolute(file)&&(await fs.stat(file)).isFile())return file;}catch{}}
  return null;
}
export function placementSettings(input={}){
  const scalar=(v,low,high)=>typeof v==='number'&&Number.isFinite(v)&&v>=low&&v<=high;
  const settings={scale:input.scale??1,offset:input.offset??[0,0,0],rotation:input.rotation??[0,0,0],headNeck:input.headNeck??null,bodyNeck:input.bodyNeck??null};
  if(!scalar(settings.scale,.1,10)||!Array.isArray(settings.offset)||settings.offset.length!==3||settings.offset.some(v=>!scalar(v,-2,2))||!Array.isArray(settings.rotation)||settings.rotation.length!==3||settings.rotation.some(v=>!scalar(v,-180,180))||['headNeck','bodyNeck'].some(k=>settings[k]!==null&&!scalar(settings[k],.001,.999)))fail('PLACEMENT_INVALID_SETTINGS',400);
  return settings;
}
export function placementCurrent(p,r){return (!r.manualPlacementId||r.manualPlacementId===currentManual(p)?.id)&&['head','body'].every(g=>currentTexture(p,g)?.id===r.sources?.[g]);}
export function canRefreshPlacement(p,r){
  return !!r&&(!r.manualPlacementId||!p.manualPlacement||r.manualPlacementId===p.manualPlacement.id)&&r.status==='succeeded'&&!!r.blend&&!!r.preview&&!placementCurrent(p,r)&&['head','body'].every(g=>{
    const old=p.textures?.find(t=>t.id===r.sources?.[g]),next=currentTexture(p,g);
    return !!old&&!!next&&old.group===g&&old.sourceModelId===next.sourceModelId&&old.fingerprint===next.fingerprint;
  });
}
export function runBlender(executable,jobFile,onProgress=()=>{},script='place_parts.py'){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',path.resolve('server/blender',script),'--',jobFile],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let tail='',pending='';const timer=setTimeout(()=>{child.kill();reject(new Error('PLACEMENT_TIMEOUT'));},180000);
    child.stdout.on('data',data=>{pending+=data.toString();const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines)if(line.startsWith('WORKBENCH_PROGRESS '))onProgress(line.slice(19));tail=(tail+data).slice(-5000);});
    child.stderr.on('data',data=>{tail=(tail+data).slice(-5000);});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error([...tail.matchAll(/^(?:ValueError|RuntimeError|Exception):\s*(PLACEMENT_[A-Z_]+)\s*$/gm)].at(-1)?.[1]||'PLACEMENT_BLENDER_FAILED'));});
  });
}
export function mountPlacement(app,{store,editable,presentProject,runPlacement=runBlender,blenderPath=findBlender,bakeModel,validateArtistFiles}){
    mountPlacementArtistImport(app,{store,editable,presentProject,execute:runPlacement,blenderPath,validateFiles:validateArtistFiles});
    mountScleraRepair(app,{store,editable,presentProject,execute:runPlacement,blenderPath});
    mountLipRepair(app,{store,editable,presentProject,execute:runPlacement,blenderPath});
    mountPlacementEditable(app,{store,blenderPath});
    mountPlacementReferences(app,{store,editable});
  const active=new Set(),reserving=new Set(),runs=p=>p.placements ||= [];
  app.post('/api/projects/:id/placement/draft',async(req,res)=>{const p=store.get(req.params.id);editable(p);assertPlacementEditing(p);const before=p.manualPlacementDraft;p.manualPlacementDraft=placementDraft(p,req.body);try{await store.save(p);}catch(e){p.manualPlacementDraft=before;throw e;}res.json({draft:p.manualPlacementDraft});});
  app.post('/api/projects/:id/placement/manual',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);assertPlacementEditing(p);
    if(currentManual(p)?.externalEditing)fail('Edit this imported model in Blender and import the updated Blender and GLB files.');
    if(reserving.has(p.id)||runs(p).some(r=>active.has(r.id)||['queued','running'].includes(r.status)))fail('PLACEMENT_RUNNING');
    if(req.body.baseApprovalId!==undefined&&req.body.baseApprovalId!==(currentManual(p)?.id||null)||(req.body.workflowEpoch??p.workflowEpoch??0)!==(p.workflowEpoch||0))fail('PLACEMENT_SOURCE_CHANGED');
    const manual=approveManual(p,req.body),release=reservePlacement(store,p.id);reserving.add(p.id);
    try{
      const executable=await blenderPath();if(!executable)fail('PLACEMENT_BLENDER_NOT_FOUND');
      const saved=await saveManualModelVersion({store,p,manual,check:()=>{editable(p);assertPlacementEditing(p);},...(bakeModel?{bake:bakeModel}:{}),bakeOptions:{execute:runPlacement,executable}});
      res.json({manual:saved,draft:currentDraft(p),handoff:placementHandoffState(p)});
    }finally{reserving.delete(p.id);release();}
  });
  app.get('/api/projects/:id/placement',async(req,res)=>{
    const p=store.get(req.params.id);let changed=false;
    for(const r of runs(p))if(['queued','running'].includes(r.status)&&!active.has(r.id)){r.status='failed';r.error='PLACEMENT_INTERRUPTED';changed=true;}
    if(changed)await store.save(p);
    res.json({singleModelVersion:1,completed:!!p.placementCompleted,handoff:placementHandoffState(p),deformersVersion:1,available:!!await blenderPath(),eligible:!!currentTexture(p,'head')&&!!currentTexture(p,'body'),manual:currentManual(p),modelSaved:manualModelReady(p),savingModel:reserving.has(p.id),draft:currentDraft(p),proportions:approvedProportions(p),references:placementReferences(p),textures:Object.fromEntries(['head','body'].map(g=>[g,currentTexture(p,g)])),runs:runs(p).map(r=>({...r,current:placementCurrent(p,r),canRefreshTextures:canRefreshPlacement(p,r)}))});
  });
  app.post(['/api/projects/:id/placement','/api/projects/:id/placement/refresh-textures'],async(req,res)=>{
    const p=store.get(req.params.id);editable(p);assertPlacementEditing(p);
    const refreshing=req.path.endsWith('/refresh-textures'),parent=refreshing?runs(p).find(r=>r.id===req.body.placementId):null;
    if(refreshing&&!canRefreshPlacement(p,parent))fail('PLACEMENT_TEXTURE_REFRESH_UNAVAILABLE');
    const settings=refreshing?parent.settings:placementSettings(req.body.settings),textures=Object.fromEntries(['head','body'].map(g=>[g,currentTexture(p,g)]));
    if(!textures.head||!textures.body)fail('PLACEMENT_TEXTURES_REQUIRED');
    if(reserving.has(p.id)||runs(p).some(r=>active.has(r.id)||['queued','running'].includes(r.status)))fail('PLACEMENT_RUNNING');
    reserving.add(p.id);let executable;
    try{executable=await blenderPath();if(!executable)fail('PLACEMENT_BLENDER_NOT_FOUND');}finally{reserving.delete(p.id);}
    const r={id:randomUUID(),status:'queued',progress:'queued',settings,sources:{head:textures.head.id,body:textures.body.id},createdAt:new Date().toISOString(),sourceHashes:{},...(refreshing?{source:'texture-refresh',parentPlacementId:parent.id,manualPlacementId:parent.manualPlacementId,references:parent.references}: {})};
    // Reserve before any await so simultaneous POSTs cannot start two Blender jobs.
    active.add(r.id);runs(p).push(r);
    try{await store.save(p);}catch(e){active.delete(r.id);throw e;}
    res.status(202).json({run:r});
    void (async()=>{
      try{
        const directory=path.join(store.root,p.id,'placement-jobs',r.id);await fs.mkdir(directory,{recursive:true});
        for(const g of ['head','body']){const bytes=await store.read(p,textures[g]);inspectTextureGlb(bytes);await fs.writeFile(path.join(directory,g+'.glb'),bytes);r.sourceHashes[g]=createHash('sha256').update(bytes).digest('hex');}
        const job={head:path.join(directory,'head.glb'),body:path.join(directory,'body.glb'),settings,blend:path.join(directory,'placed.blend'),glb:path.join(directory,'placed.glb'),report:path.join(directory,'report.json')};
        if(refreshing){
          job.inputBlend=path.join(directory,'previous.blend');await fs.writeFile(job.inputBlend,await store.read(p,parent.blend));
          job.previous={};job.textures={head:job.head,body:job.body};job.previousReport=parent.report;
          for(const g of ['head','body']){const asset=p.textures.find(t=>t.id===parent.sources[g]);job.previous[g]=path.join(directory,'previous-'+g+'.glb');await fs.writeFile(job.previous[g],await store.read(p,asset));}
        }
        const jobFile=path.join(directory,'job.json');await fs.writeFile(jobFile,JSON.stringify(job));r.status='running';await store.save(p);
        await runPlacement(executable,jobFile,phase=>{r.progress=phase;void store.save(p).catch(()=>{});},refreshing?'refresh_placement_textures.py':'place_parts.py');
        const report=JSON.parse(await fs.readFile(job.report,'utf8'));
        if(!report.independentParts||!report.headMeshes||!report.bodyMeshes)fail('PLACEMENT_INVALID_RESULT');
        if(refreshing&&(!report.textureRefresh?.geometryPreserved||report.textureRefresh.before!==report.textureRefresh.after))fail('PLACEMENT_TEXTURE_GEOMETRY_CHANGED');
        if(store.get(p.id)!==p||!placementCurrent(p,r))fail('PLACEMENT_SOURCE_CHANGED');
        const previewBytes=glbBuffer(await fs.readFile(job.glb));inspectTextureGlb(previewBytes);
        const preview=await store.asset(p,previewBytes,'glb','Blender placement');
        const blend=await store.asset(p,await fs.readFile(job.blend),'blend','Blender placement');
        if(store.get(p.id)!==p||!placementCurrent(p,r))fail('PLACEMENT_SOURCE_CHANGED');
        Object.assign(r,{status:'succeeded',progress:'complete',preview,blend,report,completedAt:new Date().toISOString()});
      }catch(e){r.status='failed';r.error=e.message||'PLACEMENT_BLENDER_FAILED';}
      finally{active.delete(r.id);if(store.get(p.id)===p)await store.save(p);}
    })();
  });
}

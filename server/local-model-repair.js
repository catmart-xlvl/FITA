import {modelCurrent} from './lineage.js';
import {fail,event} from './storage.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// The selected repaired version is the authoritative original for later stages.
// Previous versions remain addressable so an explicit selection can restore them.
export function localRepairParent(project,input){
  if(input.part===undefined&&input.parentModelId===undefined)return null;
  if(!['head','body'].includes(input.part)||typeof input.parentModelId!=='string')
    fail('LOCAL_REPAIR_SOURCE_REQUIRED',400);
  const parent=project.models.find(m=>m.id===input.parentModelId&&m.group===input.part);
  if(!parent||!modelCurrent(project,parent)||project.groups[input.part].selectedModelId!==parent.id)
    fail('LOCAL_REPAIR_SOURCE_CHANGED',409);
  const plan=project.segmentTexturePlan;
  if(plan&&!['completed','stopped'].includes(plan.status))fail('SEG_BUSY',409);
  return parent;
}

export async function commitLocalRepair({project,store,model,input,check}){
  const parent=localRepairParent(project,input);
  const previous=await store.read(project,parent);
  const directory=path.join(store.root,project.id,'antiguos');
  await fs.mkdir(directory,{recursive:true});
  const filename=path.join(directory,path.basename(parent.id));
  try{await fs.writeFile(filename,previous,{flag:'wx'});}catch(e){
    if(e.code!=='EEXIST'||!(await fs.readFile(filename)).equals(previous))throw e;
  }
  check();
  if(store.get(project.id)!==project)fail('LOCAL_REPAIR_SOURCE_CHANGED',409);
  localRepairParent(project,input);
  const next=structuredClone(project),part=next.groups[input.part],at=new Date().toISOString();
  const archived=next.models.find(m=>m.id===parent.id);
  archived.supersededByModelId=model.id;
  archived.archivedAt=at;
  archived.archivePath=path.posix.join('antiguos',path.basename(parent.id));
  next.models.push(model);
  part.modelSelectionHistory ||= [];
  part.modelSelectionHistory.push({modelId:parent.id,selectedAt:part.modelSelectedAt,replacedAt:at,reason:'local-repair'});
  part.selectedModelId=model.id;
  part.modelSelectedAt=at;
  event(next,'Modelo reparado establecido como original vigente. Versión anterior conservada en antiguos e historial.');
  try{await store.save(next);}catch(e){
    if(store.get(project.id)===next)store.projects.set(project.id,project);
    throw e;
  }
  return next;
}

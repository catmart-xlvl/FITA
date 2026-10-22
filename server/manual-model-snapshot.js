import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {placementTexture,inspectTextureGlb} from './texture-workflow.js';
import {currentManual} from './manual-placement.js';
import {replaceManualModelFiles} from './manual-model-files.js';
import {bakeManual} from './neck-handoff.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{status:409});};
const parts=['head','body'];

// Changes to a draft are intentionally excluded: only another explicit Save
// refreshes the single saved model for Codex. Other source/overlay changes invalidate it.
export function manualModelOverlayIds(p){
 const sources=Object.fromEntries(parts.map(g=>[g,placementTexture(p,g)?.id]));
 return ['scleraPatch','lipPatch','bodyCoveragePatch'].map(field=>{
  const group=field==='bodyCoveragePatch'?'body':'head',runs=(p.placements||[]).filter(r=>r[field]&&r.sources?.[group]===sources[group]);
  const latest=runs.at(-1);if(!latest)return null;
  const signature=r=>JSON.stringify([r[field],field==='scleraPatch'?r.scleraPatches||null:null]);
  // Validated results carry the same overlays forward. Their new result ID
  // does not change the source repair or invalidate the saved model.
  return runs.find(r=>signature(r)===signature(latest)).id;
 });
}
export function manualModelInputKey(p){
 const sources=Object.fromEntries(parts.map(g=>[g,placementTexture(p,g)?.id]));
 const overlays=manualModelOverlayIds(p);
 const segmentIds=new Set(parts.map(g=>placementTexture(p,g)?.segmentationId).filter(Boolean));
 const reference=segmentIds.size===1?p.segmentations?.find(s=>s.id===[...segmentIds][0])?.reconstruction?.blend?.id:null;
 return hash(JSON.stringify({sources,overlays,reference:reference||null,workflowEpoch:p.workflowEpoch||0}));
}
export function manualModelReady(p,manual=currentManual(p)){
 return [1,2].includes(manual?.modelSnapshot?.version)&&manual.modelSnapshot.inputKey===manualModelInputKey(p);
}
async function sourceHashes(store,p){
 return Object.fromEntries(await Promise.all(parts.map(async g=>{const a=placementTexture(p,g);if(!a)fail('PLACEMENT_SOURCE_CHANGED');return[g,hash(await store.read(p,a))];})));
}
export async function readManualModelSnapshot(store,p,manual){
 if(!manualModelReady(p,manual))fail('PLACEMENT_MODEL_SAVE_REQUIRED');
 const s=manual.modelSnapshot,current=await sourceHashes(store,p);
 if(JSON.stringify(current)!==JSON.stringify(s.sourceHashes))fail('PLACEMENT_SOURCE_CHANGED');
 const blend=await store.read(p,s.blend),glb=await store.read(p,s.preview);
 if(hash(blend)!==s.blendSha256||hash(glb)!==s.glbSha256)fail('PLACEMENT_MODEL_SNAPSHOT_CHANGED');
 return {'approved.blend':blend,'approved.glb':glb};
}

export async function saveManualModelVersion({store,p,manual,check=()=>{},bake=bakeManual,bakeOptions={}}){
 const previousId=currentManual(p)?.id||null,inputKey=manualModelInputKey(p),draftAtStart=p.manualPlacementDraft;
 const frozen=structuredClone(p),sources=await sourceHashes(store,frozen);
 const verify=()=>{check();if(store.get(p.id)!==p||(currentManual(p)?.id||null)!==previousId||manualModelInputKey(p)!==inputKey)fail('PLACEMENT_SOURCE_CHANGED');};
 const files=await bake(store,frozen,manual,bakeOptions);verify();
 const blend=files['approved.blend'],glb=files['approved.glb'];
 if(!Buffer.isBuffer(blend)||blend.subarray(0,7).toString()!=='BLENDER')fail('PLACEMENT_INVALID_RESULT');
 inspectTextureGlb(glb);
 if(JSON.stringify(await sourceHashes(store,p))!==JSON.stringify(sources))fail('PLACEMENT_SOURCE_CHANGED');verify();
 const previous=p.manualPlacement,previousDraft=p.manualPlacementDraft,history=p.manualModelVersions,handoff=p.placementHandoff,storage=p.manualModelStorage;
 const saved=await replaceManualModelFiles(store,p,manual.id,{blend,glb},previous?.modelSnapshot||storage,async assets=>{
  verify();const snapshot={version:2,storage:'single',inputKey,sourceHashes:sources,...assets,blendSha256:hash(blend),glbSha256:hash(glb),neckLocked:true,createdAt:new Date().toISOString()};
  const saved={...manual,modelSnapshot:snapshot};p.manualModelStorage={blend:assets.blend,preview:assets.preview};p.manualPlacement=saved;delete p.manualModelVersions;delete p.placementHandoff;
  if(p.manualPlacementDraft===draftAtStart)delete p.manualPlacementDraft;
  else if(p.manualPlacementDraft)p.manualPlacementDraft={...p.manualPlacementDraft,baseApprovalId:saved.id};
  try{await store.save(p);}catch(e){p.manualPlacement=previous;p.manualPlacementDraft=previousDraft;p.manualModelVersions=history;p.placementHandoff=handoff;p.manualModelStorage=storage;throw e;}
  return saved;
 });
 // Remove only superseded saved-model assets, never originals, textures or
 // files still referenced by another active project record.
 const active=JSON.stringify(p);
 for(const v of [...history||[],previous].filter(Boolean))for(const a of [v.modelSnapshot?.blend,v.modelSnapshot?.preview])if(a&&/^[a-f0-9-]{36}\.(blend|glb)$/.test(a.id)&&!active.includes(a.id))await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});
 const workspaces=path.resolve(store.root,'..','projects',p.id,'codex','model-finish');
 for(const entry of await fs.readdir(workspaces,{withFileTypes:true}).catch(()=>[])){
  if(!entry.isDirectory()||entry.isSymbolicLink()||!/^[a-f0-9-]{36}$/.test(entry.name))continue;
  const dir=path.join(workspaces,entry.name);let old;
  try{old=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));}catch{continue;}
  if(old.projectId!==p.id||!old.manual?.modelSnapshot||old.manual.modelSnapshot.storage==='single')continue;
  for(const name of ['approved.blend','approved.glb'])await fs.unlink(path.join(dir,name)).catch(()=>{});
 }
 return saved;
}

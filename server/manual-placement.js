import {randomUUID} from 'node:crypto';
import {placementTexture} from './texture-workflow.js';
import {validManualPlacement} from '../src/placement-math.js';
import {validateDeformers} from '../shared/placement-deformers.js';
export const manualSources=p=>Object.fromEntries(['head','body'].map(g=>[g,placementTexture(p,g)?.id]));
function initialPlacement(value){
 if(value===undefined)return {};
 const fail=()=>{throw Object.assign(Error('PLACEMENT_INVALID_SETTINGS'),{status:409});};
 if(!value?.setup||JSON.stringify(value).length>16000||!Number.isFinite(value.setup.ratio)||value.setup.ratio<.08||value.setup.ratio>.5)fail();
 for(const part of ['head','body']){
  const config=value.setup[part];if(!config)continue;
  if(config.axes&&(!['X','-X','Y','-Y','Z','-Z'].includes(config.axes.up)||!['X','-X','Y','-Y','Z','-Z'].includes(config.axes.front)||config.axes.up.replace('-','')===config.axes.front.replace('-','')))fail();
  for(const p of Object.values(config.landmarks||{}))if(!Array.isArray(p)||p.length!==3||!p.every(n=>Number.isFinite(n)&&Math.abs(n)<=10000))fail();
 }
 if(value.report&&!['low','medium'].includes(value.report.confidence))fail();
 return {initialPlacement:structuredClone(value)};
}
export const currentManual=p=>p.manualPlacement&&['head','body'].every(g=>manualSources(p)[g]&&manualSources(p)[g]===p.manualPlacement.sources[g])?p.manualPlacement:null;
export function approvedProportions(p){
 const manual=p.manualPlacement,report=manual?.initialPlacement?.report;
 if(!report||!['head','body'].every(g=>{
  const previous=p.textures?.find(t=>t.id===manual.sources[g]),current=placementTexture(p,g);
  return previous&&current&&previous.sourceModelId===current.sourceModelId;
 }))return null;
 const ratio=manual.transforms.head.scale/manual.transforms.body.scale*report.cranialHeight/report.bodyHeight;
 return Number.isFinite(ratio)&&ratio>=.08&&ratio<=.5?{ratio,provenance:'approved-design-proportion'}:null;
}
export function approveManual(p,input){
 const fail=code=>{throw Object.assign(Error(code),{status:409});};
 if(!input||input.confirm!==true||!validManualPlacement(input.transforms)||!Number.isFinite(input.heightCm)||input.heightCm<30||input.heightCm>300)fail('PLACEMENT_INVALID_SETTINGS');
 const sources=manualSources(p);
 if(['head','body'].some(g=>!sources[g]||sources[g]!==input.sources?.[g]))fail('PLACEMENT_SOURCE_CHANGED');
 let deformers;try{deformers=validateDeformers(input.deformers);}catch{fail('PLACEMENT_INVALID_DEFORMERS');}
 return {id:randomUUID(),sources,transforms:structuredClone(input.transforms),heightCm:input.heightCm,...(deformers.pins.length?{deformers}:{}),...initialPlacement(input.initialPlacement),approvedAt:new Date().toISOString(),coordinateSystem:'glTF Y-up metres'};
}

export const currentDraft=p=>p.manualPlacementDraft&&['head','body'].every(g=>manualSources(p)[g]===p.manualPlacementDraft.sources[g])?p.manualPlacementDraft:null;
export function placementDraft(p,input){
 if((input.workflowEpoch||0)!==(p.workflowEpoch||0)||input.baseApprovalId!==(currentManual(p)?.id||null))throw Object.assign(Error('PLACEMENT_SOURCE_CHANGED'),{status:409});
 const value=approveManual(p,{...input,confirm:true});delete value.approvedAt;
 return {...value,workflowEpoch:p.workflowEpoch||0,baseApprovalId:currentManual(p)?.id||null,savedAt:new Date().toISOString()};
}

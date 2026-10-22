import {modelCurrent} from './lineage.js';
import {fingerprintViewSet} from './view-set.js';
const parts=['head','body'];
export const segmentationSourceIdentity=p=>JSON.stringify({referenceId:p.reference?.id,referenceRevision:p.referenceRevision,notesRevision:p.notesRevision,models:parts.map(g=>p.models.find(m=>m.group===g&&m.id===p.groups[g]?.selectedModelId&&modelCurrent(p,m))?.id),views:parts.map(g=>fingerprintViewSet(p,g))});
export const currentSegmentationBaseline=p=>p.segmentationBaseline?.sourceIdentity===segmentationSourceIdentity(p)?p.segmentationBaseline:null;
export const segmentationSource=(p,g)=>currentSegmentationBaseline(p)?.sources[g]||p.models.find(m=>m.group===g&&m.id===p.groups[g]?.selectedModelId&&modelCurrent(p,m));
export const segmentIdentity=p=>{const base=segmentationSourceIdentity(p),baseline=currentSegmentationBaseline(p);return baseline?JSON.stringify({source:base,baseline:baseline.id}):base;};
export const currentSegmentation=p=>[...p.segmentations||[]].reverse().find(r=>r.identity===segmentIdentity(p));

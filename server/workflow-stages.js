import {randomUUID} from 'node:crypto';
import {placementTexture} from './texture-workflow.js';

export function workflowStage(p){
 if(p.vrchatExports?.length)return 6;
 if(p.placementCompleted||p.facialRigRuns?.length)return 5;
 if((p.riggingRuns?.length||p.rigStudioJobs?.length||p.rigRefinements?.length))return 5;
 if(p.manualPlacement||p.manualPlacementDraft||p.placements?.length||['head','body'].every(g=>placementTexture(p,g)))return 4;
 if(p.segmentations?.length||p.textureOperations?.length||p.textures?.length||['head','body'].every(g=>p.groups[g]?.selectedModelId))return 3;
 if(p.models?.length||p.studioOperations?.length||['head','body'].every(g=>p.groups[g]?.approved))return 2;
 if(['head','body'].some(g=>Object.keys(p.groups[g]?.views||{}).length))return 1;
 return 0;
}
export function rewindProject(p,{stage,confirm,expectedRevision}){
 const fail=message=>{throw Object.assign(Error(message),{status:409});};
 if(confirm!==true||!Number.isInteger(stage)||stage<0||stage>=workflowStage(p))fail('WORKFLOW_REWIND_CONFIRMATION');
 if(expectedRevision!==p.revision)fail('WORKFLOW_PROJECT_CHANGED');
 const next=structuredClone(p),id=randomUUID(),removed={};
 const clear=keys=>{for(const k of keys){if(next[k]!==undefined){removed[k]=next[k];delete next[k];}}};
 clear(['vrchatExports']);
 if(stage<5)clear(['facialRigRuns','riggingRuns','rigDonors','rigRefinements','rigWeightSessions','rigWeightEdits','rigStudioJobs']);
 if(stage<=4){
  // Keep the user's chosen placement as an editable draft, never as consent.
  if(stage===4&&next.manualPlacement&&!next.manualPlacementDraft)next.manualPlacementDraft={...next.manualPlacement,baseApprovalId:null,savedAt:new Date().toISOString()};
  if(next.manualPlacementDraft)delete next.manualPlacementDraft.modelSnapshot;
  clear(['manualPlacement','manualModelVersions','placementHandoff','placementCompleted','placements']);
  if(stage<4)clear(['manualPlacementDraft']);else if(next.manualPlacementDraft)next.manualPlacementDraft.baseApprovalId=null;
 }
 if(stage<=3){clear(['segmentationDeliveryId','textures','textureOperations','textureRefinements','textureRefinementDeliveryId','textureSupervisorId','textureSupervisorPresence','segmentTexturePlan','segmentReferencesDeliveryId','segmentTextureRuns','segmentBudgets','segmentQuotation']);
  // A new texture pass starts from reviewed geometry, with fresh consent.
  if(stage===3){for(const s of next.segmentations||[]){delete s.reconstruction;delete s.supervisionId;for(const g of s.groups||[]){delete g.references;g.referencesReady=false;delete g.studioImport;delete g.studioPrices;}}}
 }
 if(stage<=2){clear(['segmentations','segmentationBaseline','segmentationDeliveryId']);for(const g of ['head','body'])delete next.groups[g].selectedModelId;}
 if(stage<=1){clear(['models','studioOperations','jobs','viewSetValidation','viewSetValidations','codexDelivery']);next.models=[];next.jobs=[];for(const g of ['head','body']){next.groups[g].approved=false;next.groups[g].approval=null;}}
 if(stage===0){for(const g of ['head','body']){removed[g+'Views']=next.groups[g];next.groups[g]={views:{},approved:false};}clear(['placementGuides','placementReferences','placementReferencesBinding','codexImports']);next.referenceState={status:'pending',referenceId:next.reference?.id};}
 next.workflowEpoch=(p.workflowEpoch||0)+1;if(next.manualPlacementDraft)next.manualPlacementDraft.workflowEpoch=next.workflowEpoch;next.revision++;
 return {next,archive:{id,projectId:p.id,at:new Date().toISOString(),stage,previous:structuredClone(p)},removed};
}

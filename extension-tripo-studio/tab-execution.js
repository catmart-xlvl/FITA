// Only these observations can be replayed after Chrome drops a script result.
// Classify both function and input: several adapters also contain paid actions.
export function isReadOnlyStudioCall(func,args=[]){
 const action=args[0]?.action;
 if(['observeStudioDocument','observeGroupStudio','resolveStudioGenerationWorkspace','resolveConfirmedStudioTask'].includes(func.name))return true;
 if(func.name==='studioTopologyControl')return args[0]?.step==='inspect';
 if(func.name==='readStudioGenerationFailures')return !action||['inspect','watch'].includes(action);
 if(func.name==='controlImportOrientation')return args[0]?.confirm!==true;
 if(func.name==='studioMeshImportControl')return action==='inspect';
 if(['studioUvSaveControl','studioUvCandidatesControl'].includes(func.name))return !action||action==='inspect';
 return false;
}

// Reproducible, free diagnostic. Only navigation, observation and the real
// monitor handler are supplied; no upload, export or paid action is exposed.
export function isNavigationCheckCall(func,args=[],world='ISOLATED'){
 if(world!=='ISOLATED')return false;
 if(['observeStudioDocument','observeGroupStudio','resolveStudioGenerationWorkspace'].includes(func.name))return true;
 if(func.name==='exportStudioControl')return ['inspect','close'].includes(args[0]?.step);
 if(func.name==='studioNavigationControl')return ['select-task','select-tool','close-notifications','close-hints'].includes(args[0]?.action);
 return false;
}
export function isExportPreparationCall(func,args=[],world='ISOLATED'){
 if(world!=='ISOLATED')return false;
 if(['observeStudioDocument','observeGroupStudio'].includes(func.name))return true;
 if(func.name==='studioNavigationControl')return args[0]?.action==='close-hints';
 return func.name==='exportStudioControl'&&args[0]?.format==='FBX'&&['inspect','open','format','select-fbx','blender-preset','close'].includes(args[0]?.step);
}
export async function checkNavigationRecovery({observe,navigate,monitor,pause}){
 const initial=await observe(),tools=['generate','texture','smart-uv','rigging'];
 const report={passed:false,taskId:initial.taskId,initialWorkflow:initial.workflow,steps:[],paidActions:0,recoveryButtonClicks:0,restoredInitialView:false};
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(initial.taskId||'')||!tools.includes(initial.workflow))return {stage:'observed',navigationCheck:{...report,error:'CONFIRMED_TASK_NOT_VERIFIED'}};
 if(initial.unsavedChanges||initial.importBusy||initial.importFileCount)return {stage:'observed',navigationCheck:{...report,error:initial.unsavedChanges?'SEG_UNSAVED_CHANGES':'STUDIO_NAVIGATION_CHECK_BUSY'}};
 try{
  for(const tool of tools){
   await navigate(initial.taskId,tool);
   const entered=await observe();
   if(entered.taskId!==initial.taskId||entered.workflow!==tool)throw Error('CONFIRMED_TASK_NOT_LOADED');
   let result;
   // Heavy models (e.g. a rigged 45k-triangle character) can take tens of
   // seconds to mount in a tool: re-read about every half second for up to
   // 75 s of wall-clock time, not 5 s.
   for(let attempt=0,until=Date.now()+75000;attempt<150&&Date.now()<until;attempt++){
    // This is the normal pending-monitor path, including its own automatic
    // workspace recovery. No recovery endpoint or UI button is called.
    result=await monitor(initial.taskId);
    if(result.stage==='ready')break;
    if(result.stage!=='processing')throw Error('STUDIO_NAVIGATION_CHECK_NOT_READY');
    await pause(500);
   }
   const recovered=await observe();
   const passed=result.stage==='ready'&&recovered.taskId===initial.taskId&&recovered.workflow==='generate';
   report.steps.push({enteredWorkflow:tool,recoveredWorkflow:recovered.workflow,taskId:recovered.taskId,monitorStage:result.stage,passed});
   if(!passed)throw Error('STUDIO_NAVIGATION_CHECK_NOT_READY');
  }
  report.passed=true;
 }catch(error){report.error=error.message||'STUDIO_NAVIGATION_CHECK_FAILED';}
 finally{
  try{
   await navigate(initial.taskId,initial.workflow);
   const restored=await observe();report.restoredInitialView=restored.taskId===initial.taskId&&restored.workflow===initial.workflow;
   if(!report.restoredInitialView)throw Error('CONFIRMED_TASK_NOT_LOADED');
  }catch(error){report.restoreError=error.message;report.passed=false;}
 }
 return {stage:'observed',navigationCheck:report};
}

export async function checkTabLifecycle({observe,navigate,monitor,reload,reopen,pause}){
 const initial=await observe(),report={passed:false,taskId:initial.taskId,initialWorkflow:initial.workflow,steps:[],paidActions:0,recoveryButtonClicks:0,restoredInitialView:false};
 if(!/^[0-9a-f-]{36}$/i.test(initial.taskId||'')||!['generate','texture','smart-uv','rigging'].includes(initial.workflow)||initial.unsavedChanges||initial.importBusy||initial.importFileCount)return {stage:'observed',lifecycleCheck:{...report,error:'STUDIO_LIFECYCLE_UNSAFE'}};
 try{
  for(const [name,change]of [['reload',reload],['close-reopen',reopen]]){
   await navigate(initial.taskId,initial.workflow);await change();
   let result;
   for(let attempt=0;attempt<40;attempt++){
    result=await monitor(initial.taskId);
    if(result.stage!=='processing')break;
    await pause(500);
   }
   const state=await observe();
   const passed=result.stage==='ready'&&state.taskId===initial.taskId&&state.workflow==='generate';
   report.steps.push({action:name,taskId:state.taskId,monitorStage:result.stage,passed});
   if(!passed)throw Error('STUDIO_LIFECYCLE_NOT_RECOVERED');
  }
  report.passed=true;
 }catch(error){report.error=error.message;}
 finally{try{await navigate(initial.taskId,initial.workflow);const state=await observe();report.restoredInitialView=state.taskId===initial.taskId&&state.workflow===initial.workflow;if(!report.restoredInitialView)report.passed=false;}catch(error){report.passed=false;report.restoreError=error.message;}}
 return {stage:'observed',lifecycleCheck:report};
}

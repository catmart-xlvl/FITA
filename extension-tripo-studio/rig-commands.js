import {navigateStudioTask} from './studio-navigation.js';
import {createGroupCommands} from './group-commands.js';
import {studioGroupControl,observeGroupStudio} from './group-adapter.js';
import {studioRigControl,stageRigUpload} from './rig-adapter.js';

export function createRigCommands({chrome,runInTab,pause,exportGlb}){
  const stagedRun=async(bridge,func,args=[])=>{
    if(func===studioGroupControl&&args[0]?.action==='import'){
      const model=args[0].model,data=model.dataBase64,chunkSize=4*1024*1024,total=Math.ceil(data.length/chunkSize);
      for(let index=0;index<total;index++)await runInTab(bridge,stageRigUpload,[{id:model.sha256,index,total,data:data.slice(index*chunkSize,(index+1)*chunkSize)}]);
      return runInTab(bridge,func,[{action:'import',model:{name:model.name,sha256:model.sha256,stagedId:model.sha256}}]);
    }
    return runInTab(bridge,func,args);
  };
  const imports=createGroupCommands({chrome,runInTab:stagedRun,pause,exportGlb});
  return async(bridge,command)=>{
    const p=command.payload||{},key='workbenchRigOperation:'+p.operationId;
    const get=async()=>(await chrome.storage.local.get(key))[key],save=v=>chrome.storage.local.set({[key]:v});
    const inspect=()=>runInTab(bridge,studioRigControl,[{taskId:p.taskId}]);
    const selectImported=taskId=>navigateStudioTask({chrome,runInTab,pause,bridge},taskId);
    const navigate=taskId=>navigateStudioTask({chrome,runInTab,pause,bridge},taskId,'rigging');
    if(p.action==='prepare'){
      const imported=await imports(bridge,{...command,payload:{...p,action:'import'}}),taskId=imported.receipt.taskId;
      await selectImported(taskId);
      // A task URL and the disappearance of Confirm only identify the upload.
      // Wait for the same model's viewer/export controls before leaving it.
      let ready=0;
      for(let i=0;i<120;i++){
        const s=await runInTab(bridge,observeGroupStudio);
        if(s.taskId!==taskId)throw Error('CONFIRMED_TASK_CHANGED');
        ready=s.importBusy===false&&s.modelReady===true?ready+1:0;
        if(ready>=3)break;
        await pause(1000);
      }
      if(ready<3)throw Error('RIG_UPLOAD_STILL_PROCESSING');
      await navigate(taskId);
      const transient=new Set(['RIG_CONTROL_NOT_VERIFIED','RIG_PRESET_CONTROL_REQUIRED','RIG_WORKSPACE_REQUIRED']);
      for(let i=0;i<45;i++){
        // Controls mount asynchronously after the rig workspace opens. Only
        // selection is retried here; the paid Rig action is never clicked.
        try{
          const s=await runInTab(bridge,studioRigControl,[{taskId}]);
          if(/^Unity Humanoid(?: compatible)?$/i.test(s.preset||'')&&s.costLabel&&s.enabled)return {stage:'prepared',taskId,costLabel:s.costLabel,preset:s.preset,sourceSha256:p.model.sha256};
          if(!s.preset&&!s.presetOptionsOpen)await runInTab(bridge,studioRigControl,[{taskId,action:'select-humanoid'}]);
          await runInTab(bridge,studioRigControl,[{taskId,action:'select-unity'}]);
        }catch(e){if(!transient.has(e.message))throw e;}
        await pause(1000);
      }
      throw Error('RIG_UNITY_PRESET_NOT_VERIFIED');
    }
    if(!/^[a-f0-9-]{36}$/i.test(p.operationId||''))throw Error('RIG_OPERATION_REQUIRED');
    let receipt=await get();
    await navigate(p.taskId);
    if(p.action==='submit'){
      if(receipt)return {stage:receipt.completed?'ready':receipt.clicked?'processing':'unknown',receipt};
      if(p.confirmCost!==true)throw Error('STUDIO_COST_CONFIRMATION');
      const s=await inspect();if(!/^Unity Humanoid(?: compatible)?$/i.test(s.preset||'')||s.costLabel!==p.expectedCost||!s.enabled)throw Error('RIG_SETTINGS_OR_COST_CHANGED');
      receipt={taskId:p.taskId,clicked:false,processingObserved:false,completed:false};await save(receipt);
      // Receipt precedes click. Never repeat a paid action after an uncertain reply.
      await runInTab(bridge,studioRigControl,[{taskId:p.taskId,action:'submit',expectedCost:p.expectedCost}]);
      receipt.clicked=true;await save(receipt);
      for(let i=0;i<12;i++){await pause(250);if((await inspect()).busy){receipt.processingObserved=true;await save(receipt);break;}}
      return {stage:'submitted',receipt};
    }
    if(!receipt||receipt.taskId!==p.taskId||!receipt.clicked)throw Error('RIG_SUBMISSION_UNCERTAIN');
    if(p.action==='monitor'){
      const s=await inspect();if(s.busy)receipt.processingObserved=true;
      if(receipt.processingObserved&&s.enabled&&s.hasExport)receipt.completed=true;
      await save(receipt);return {stage:receipt.completed?'ready':'processing',receipt};
    }
    if(p.action==='download'){
      if(!receipt.completed)throw Error('RIG_NOT_COMPLETED');
      return exportGlb(bridge,p.taskId,{operationId:command.id,exportRevision:p.operationId,directExportTransfer:true,requireSkeleton:true});
    }
    throw Error('RIG_ACTION_INVALID');
  };
}

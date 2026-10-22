// Local, bounded evidence for the currently selected task's own export intent.
// No signed URL, local filename or unrelated browser history is returned.
export async function exportRecoveryDiagnostic(saved,taskId,search){
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(taskId||''))return [];
 const receipts=saved.studioDownloadReceiptsV1||{},results=[];
 for(const [key,r] of Object.entries(receipts)){
  if(r?.taskId!==taskId||!(key===taskId||key===`${taskId}:source:fbx`||key.startsWith(`${taskId}:texture:`)))continue;
  const format=key.endsWith(':source:fbx')?'FBX':'GLB';
  const detail={taskId,format,state:r.state||null,correlation:r.correlation||null,operationId:r.operationId||null,clickAt:Number.isFinite(r.clickAt)?r.clickAt:null,id:Number.isInteger(r.id)?r.id:null,freeRecoveryCount:r.freeRecoveryCount||0,recoveryHistory:r.recoveryHistory||[],events:[]};
  if(typeof search==='function'&&detail.clickAt!==null){
   try{
    const items=await search({startedAfter:new Date(r.clickAt-1000).toISOString(),startedBefore:new Date(r.clickAt+90000).toISOString(),limit:100});
    for(const item of items){
     const time=Date.parse(item.startTime),extension=item.filename?.match(/\.[a-z0-9]{1,8}$/i)?.[0]?.toLowerCase();
     if(!Number.isFinite(time)||time<r.clickAt-1000||time>r.clickAt+90000)continue;
     let exactSource=false;try{const u=new URL(item.referrer);exactSource=u.origin==='https://studio.tripo3d.ai'&&u.pathname===r.taskPath;}catch{}
     detail.events.push({id:item.id,startTime:item.startTime,extension:extension||null,expectedFormat:(format==='FBX'?['.fbx','.zip']:['.glb']).includes(extension),state:item.state||null,error:item.error||null,exactSource,recordedId:item.id===r.id});
    }
   }catch{detail.unavailable=true;}
  }
  results.push(detail);
 }
 return results;
}

// Preview is read-only: seeing the latest original is independent of approving
// facial work or preparing an export. Never substitute the Tripo donor.
export const avatarLoadMessages={
  AVATAR_SERVER_UPDATE_REQUIRED:'The server is still running an older version. Close and reopen FITA using its launchers; refreshing the page is not enough. The current character can still be displayed.',
  AVATAR_LOAD_TIMEOUT:'The server did not respond in time. Use Refresh status to try again.',
};
export function rigCharacterPreview(rig,manual){
  const run=rig?.runs?.filter(r=>r.current&&r.preview?.url).at(-1);
  const edit=manual?.edits?.filter(e=>e.current&&e.rootSource?.kind==='result'&&e.rootSource.id===run?.id&&e.rootSource.version===run?.version).at(-1);
  return edit?.asset?.url||run?.preview?.url||rig?.source?.preview?.url||null;
}
export async function loadAvatarState(request,root,projectId,{timeoutMs=20000}={}){
  async function read(url){
    const controller=new AbortController();let timer;
    try{return await Promise.race([request(url,{signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('AVATAR_LOAD_TIMEOUT'));},timeoutMs);})]);}
    finally{clearTimeout(timer);}
  }
  let data=null,error='',preview=null;
  try{data=await read(root);preview=data.face?.preview||data.run?.preview||data.bodyPreview?.url||null;}
  catch(e){error=e.status===404||e.message==='Ruta no encontrada.'?'AVATAR_SERVER_UPDATE_REQUIRED':e.name==='AbortError'?'AVATAR_LOAD_TIMEOUT':e.message;}
  if(!preview){
    const results=await Promise.allSettled([read(`/projects/${projectId}/rigging/refinement`),read(`/projects/${projectId}/rigging/manual`)]);
    preview=rigCharacterPreview(results[0].status==='fulfilled'?results[0].value:null,results[1].status==='fulfilled'?results[1].value:null);
    if(!preview&&!error&&results[0].status==='rejected')error=results[0].reason.message;
  }
  return {data,preview,error};
}

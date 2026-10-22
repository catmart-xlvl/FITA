// Only free file import. Paid controls are deliberately absent from this module.
// Hash in the worker, then dispatch synchronously: a discarded async page reply
// must not be mistaken for permission to upload the same file again.
export function studioMeshImportControl(input={}){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
 if(location.origin!=='https://studio.tripo3d.ai')throw Error('STUDIO_ORIGIN_CHANGED');
 if(!/^[a-f0-9]{64}$/.test(input.sha256||'')||!/^[-a-f0-9]{36}$/.test(input.attemptId||''))throw Error('SEG_IMPORT_BYTES_INVALID');
 const records=globalThis.__workbenchMeshImportsV3 ||= new Map();
 const previous=records.get(input.attemptId);
 if(previous&&previous.sha256!==input.sha256)throw Error('SEG_IMPORT_SOURCE_CHANGED');
 const summary=record=>record?{attemptId:input.attemptId,sha256:record.sha256,phase:record.phase}:null;
 if(input.action==='inspect')return summary(previous)||{phase:'missing'};
 if(previous&&previous.phase!=='prepared')return summary(previous);
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 if([...document.querySelectorAll('[role="dialog"],[aria-busy="true"],[role="progressbar"]')].some(visible))throw Error('SEG_IMPORT_PAGE_NOT_READY');
 const fields=[...document.querySelectorAll('input[type="file"]')].filter(e=>e.accept.replace(/\s/g,'').toLowerCase()==='.fbx,.obj,.stl,.glb');
 if(fields.length!==1||fields[0].disabled)throw Error('SEG_IMPORT_CONTROL_REQUIRED');
 if(input.action==='prepare'){
  if(previous)return summary(previous);
  if(fields[0].files?.length)throw Error('SEG_IMPORT_PAGE_NOT_READY');
  const bytes=Uint8Array.from(atob(input.dataBase64),c=>c.charCodeAt(0));
  if(bytes.length!==input.size||bytes.length>32*1024*1024||String.fromCharCode(...bytes.slice(0,4))!=='glTF')throw Error('SEG_IMPORT_BYTES_INVALID');
  const transfer=new DataTransfer();transfer.items.add(new File([bytes],input.name,{type:'model/gltf-binary'}));
  const record={sha256:input.sha256,phase:'prepared',transfer};records.set(input.attemptId,record);
  // Never evict an in-flight record. Completed entries contain no file bytes.
  if(records.size>16)for(const [id,r] of records)if(id!==input.attemptId&&r.phase==='dispatched'){records.delete(id);break;}
  return summary(record);
 }
 if(input.action!=='dispatch'||!previous)throw Error('SEG_IMPORT_DISPATCH_UNCERTAIN');
 const taskId=location.pathname.match(/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i)?.[1]||null;
 if(taskId!==input.previousTaskId)throw Error('CONFIRMED_TASK_CHANGED');
 if(fields[0].files?.length)throw Error('SEG_IMPORT_PAGE_NOT_READY');
 // Durable within this document BEFORE the first event. Duplicate calls return
 // the same phase, even if a handler navigated or the script reply was lost.
 fields[0].files=previous.transfer.files;
 previous.phase='dispatching';
 fields[0].dispatchEvent(new Event('input',{bubbles:true}));
 fields[0].dispatchEvent(new Event('change',{bubbles:true}));
 previous.phase='dispatched';delete previous.transfer;
 return summary(previous);
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

export function createMeshImporter({runInTab,crypto=globalThis.crypto}){
 return async function importMesh(bridge,{model,receipt,persist,previousTaskId}){
  const bytes=Uint8Array.from(atob(model.dataBase64),c=>c.charCodeAt(0));
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.length>32*1024*1024||sha256!==model.sha256||String.fromCharCode(...bytes.slice(0,4))!=='glTF')throw Error('SEG_IMPORT_BYTES_INVALID');
  receipt.dispatch={attemptId:crypto.randomUUID(),sha256,phase:'preparing'};await persist();
  const input={attemptId:receipt.dispatch.attemptId,sha256};
  const inspect=()=>runInTab(bridge,studioMeshImportControl,[{...input,action:'inspect'}]);
  let stage;
  try{stage=await runInTab(bridge,studioMeshImportControl,[{...input,action:'prepare',size:bytes.length,name:model.name,dataBase64:model.dataBase64}]);}
  catch(error){if(error.message!=='STUDIO_DID_NOT_RESPOND')throw error;stage=await inspect();}
  if(stage.phase!=='prepared')throw Error('SEG_IMPORT_DISPATCH_UNCERTAIN');
  receipt.dispatch.phase='prepared';await persist();
  // Store the intent before dispatch; never retry a dispatch on a missing reply.
  receipt.dispatch.phase='dispatching';await persist();
  let result;
  try{result=await runInTab(bridge,studioMeshImportControl,[{...input,action:'dispatch',previousTaskId}]);}
  catch(error){if(error.message!=='STUDIO_DID_NOT_RESPOND')throw error;result=await inspect();}
  receipt.dispatch.phase=result.phase;await persist();
  if(!['dispatching','dispatched'].includes(result.phase))throw Error('SEG_IMPORT_DISPATCH_UNCERTAIN');
  return {dispatched:true,sha256,attemptId:input.attemptId};
 };
}

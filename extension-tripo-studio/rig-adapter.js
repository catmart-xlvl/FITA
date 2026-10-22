// Read/click only visible Studio controls. Rig button trace observed in the
// user's 2026-10-13 layout diagnostic; no private API or application state.
export function studioRigControl(input={}){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=='https://studio.tripo3d.ai')throw Error('STUDIO_ORIGIN_CHANGED');
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
  const buttons=[...document.querySelectorAll('button,[role="option"],[role="menuitem"],[role="combobox"]')].filter(visible);
  const taskId=location.pathname.match(/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i)?.[1];
  if(input.taskId&&taskId!==input.taskId)throw Error('CONFIRMED_TASK_CHANGED');
  const rig=buttons.filter(b=>b.getAttribute('data-trace')==='studio.workspace_rigging.rig_button');
  const presets=buttons.filter(b=>/^(Mixamo|ActorCore|Actor Core|Unity Humanoid(?: compatible)?|Unity Humanoid Compatible|BLM 1\.0 Humanoid|Unreal Engine Mega Mannequin)$/i.test(text(b)));
  const unity=presets.filter(b=>/^Unity Humanoid(?: compatible)?$/i.test(text(b)));
  const humanoid=buttons.filter(b=>/^(Humanoid|Humanoide)$/i.test(text(b)));
  const selected=presets.length===1?text(presets[0]):null;
  const state={taskId,presetOptionsOpen:presets.length>1,rigging:rig.length===1,preset:selected,costLabel:rig.length===1?text(rig[0]).match(/(\d+(?:[.,]\d+)?)\s*$/)?.[1]||null:null,enabled:rig.length===1&&!rig[0].disabled&&rig[0].getAttribute('aria-disabled')!=='true',hasExport:buttons.some(b=>/^(Export|Exportar)$/.test(text(b))&&!b.disabled),busy:rig.length===1&&(rig[0].disabled||rig[0].getAttribute('aria-disabled')==='true')};
  const click=items=>{if(items.length!==1||items[0].disabled||items[0].getAttribute('aria-disabled')==='true')throw Error('RIG_CONTROL_NOT_VERIFIED');items[0].click();};
  if(!input.action||input.action==='inspect')return state;
  if([...document.querySelectorAll('[role="dialog"]')].some(visible))throw Error('CLOSE_OTHER_DIALOGS_FIRST');
  if(!state.rigging)throw Error('RIG_WORKSPACE_REQUIRED');
  if(input.action==='select-humanoid'){click(humanoid);return {changed:true};}
  if(input.action==='select-unity'){
    if(unity.length===1){if(selected&&/^Unity/i.test(selected))return state;click(unity);return {changed:true};}
    if(presets.length!==1)throw Error('RIG_PRESET_CONTROL_REQUIRED');click(presets);return {opened:true};
  }
  if(input.action==='submit'){
    if(!state.enabled||!/^Unity Humanoid(?: compatible)?$/i.test(state.preset||'')||state.costLabel!==input.expectedCost)throw Error('RIG_SETTINGS_OR_COST_CHANGED');
    click(rig);return {clicked:true};
  }
  throw Error('RIG_ACTION_INVALID');
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

// Large GLBs are staged in bounded chunks in the authorized isolated world,
// avoiding a single >32 MB scripting argument. Content is hashed before upload.
export function stageRigUpload({id,index,total,data}){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=='https://studio.tripo3d.ai'||!/^[a-f0-9]{64}$/.test(id)||!Number.isInteger(index)||!Number.isInteger(total)||total<1||total>64||index<0||index>=total||typeof data!=='string'||data.length>4*1024*1024)throw Error('RIG_UPLOAD_INVALID');
  if(index===0)globalThis.__workbenchRigUpload={id,total,chunks:[],length:0};
  const pending=globalThis.__workbenchRigUpload;if(!pending||pending.id!==id||pending.total!==total||pending.chunks.length!==index)throw Error('RIG_UPLOAD_ORDER');
  pending.chunks.push(data);pending.length+=data.length;if(pending.length>201*1024*1024)throw Error('RIG_UPLOAD_TOO_LARGE');return {staged:index+1};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

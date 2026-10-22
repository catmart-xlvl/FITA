// These trace IDs were read from the connected Smart UV page. Save is free;
// Generate UV and Free retry are deliberately excluded from this adapter.
export function studioUvSaveControl(input={}){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=='https://studio.tripo3d.ai')throw Error('STUDIO_ORIGIN_CHANGED');
  const taskId=location.pathname.match(/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i)?.[1];
  if(taskId!==input.taskId)throw Error('CONFIRMED_TASK_CHANGED');
  if(!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/smart-uv\//.test(location.pathname))throw Error('SEG_UV_WORKSPACE_REQUIRED');
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
  const enabled=e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true';
  const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(visible);
  const saves=buttons.filter(b=>b.getAttribute('data-trace')==='studio.workspace_smart-uv.asset_save_button');
  const generate=buttons.filter(b=>b.getAttribute('data-trace')==='studio.workspace_smart-uv.generate_uv_button');
  const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
  const busy=[...document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')].some(visible);
  const state={taskId,pending:saves.length>0,saveEnabled:saves.length===1&&enabled(saves[0])&&!busy,generateEnabled:generate.length===1&&enabled(generate[0]),busy,blockingDialog:dialogs.length>0};
  if(input.action!=='save')return state;
  // Do not click a generic Save in a dialog or another editor. A blocking
  // unsaved-changes dialog must be closed, preserving its result, before retry.
  if(dialogs.length)throw Error('CLOSE_OTHER_DIALOGS_FIRST');
  if(!state.saveEnabled)throw Error('SEG_UV_SAVE_NOT_READY');
  saves[0].click();return {clicked:true,taskId};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

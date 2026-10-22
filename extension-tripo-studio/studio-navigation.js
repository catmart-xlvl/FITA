import {observeGroupStudio} from './group-adapter.js';
import {exportStudioControl,resolveStudioGenerationWorkspace} from './studio-adapter.js';
import {STUDIO_WORKSPACES,parseStudioUrl} from './studio-map.js';

// A remembered or observed asset route in any of the 12 Studio sections.
export function verifiedTaskUrl(value,taskId,workflow){
 const place=parseStudioUrl(value);
 return place.page==='workspace'&&place.clean&&place.taskId&&place.taskId===String(taskId||'').toLowerCase()&&(!workflow||place.workspace===workflow)?new URL(value).href:null;
}

// Native free navigation when asset cards have no href. Never identify assets
// by names, thumbnail similarity or card order, and never click priced actions.
export function studioNavigationControl({action,taskId,workflow}={}){
 try{
  if(location.origin!=='https://studio.tripo3d.ai')throw Error('STUDIO_ORIGIN_CHANGED');
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
  // fita-hint-v1: Studio's informational popovers (viewer help, "retry or go to
  // Texture" tip). Language independent; never a form, price or traced action.
  const studioHint=d=>{const q=s=>d.querySelector?.(s),has=n=>!!q('[class~="'+n+'"]');return !q('input,textarea,select,[role="slider"],[role="switch"],[role="combobox"],[data-price],[data-cost],[data-trace]')&&has('i-tripo:close')&&(d.querySelectorAll?.('button')||[]).length<=2&&(has('i-tripo:retry')&&has('i-tripo:texture')||!!q('.cursor-move')&&!!q('.cancel-drag'));};
  if(action==='close-hints'){
   // Only the hint's own close (X) control: dismissing, never confirming.
   const hints=[...document.querySelectorAll('[role="dialog"]')].filter(d=>visible(d)&&d.getAttribute('data-state')!=='closed'&&studioHint(d));
   for(const hint of hints){const close=hint.querySelector('[class~="i-tripo:close"]');(close.closest('button')||close).click();}
   return {navigation:hints.length?'closing':'not-open',hints:hints.length};
  }
  if(action==='close-notifications'){
   const nativeIcon=e=>String(e.getAttribute('class')||'').split(/\s+/).some(c=>/^i-tripo:(?:bell|notification)(?:-|$)/.test(c));
   const controls=[...document.querySelectorAll('[data-trace],button,[role="button"]')].filter(visible).filter(e=>/notification|notification_center/i.test(e.getAttribute('data-trace')||'')||[...e.querySelectorAll('[class]')].some(nativeIcon)).filter(e=>{
    const id=e.getAttribute('id'),controlled=(e.getAttribute('aria-controls')||'').split(/\s+/);
    return e.getAttribute('aria-expanded')==='true'||e.getAttribute('data-state')==='open'||[...document.querySelectorAll('[role="dialog"]')].some(panel=>visible(panel)&&panel.getAttribute('data-state')!=='closed'&&(controlled.includes(panel.getAttribute('id'))||id&&(panel.getAttribute('aria-labelledby')||'').split(/\s+/).includes(id)));
   });
   const unique=controls.filter(e=>!controls.some(child=>child!==e&&e.contains(child)));
   if(unique.length===1){
    const control=unique[0],id=control.getAttribute('id'),controlled=(control.getAttribute('aria-controls')||'').split(/\s+/);
    const panels=[...document.querySelectorAll('[role="dialog"]')].filter(panel=>visible(panel)&&panel.getAttribute('data-state')!=='closed'&&(controlled.includes(panel.getAttribute('id'))||id&&(panel.getAttribute('aria-labelledby')||'').split(/\s+/).includes(id)));
    if(panels.length===1){panels[0].focus();panels[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));}
    else if(panels.length===0)control.click();else return {navigation:'notification-control-unverified'};
    return {navigation:'closing'};
   }
   return {navigation:'not-open'};
  }
  if([...document.querySelectorAll('[data-trace]')].some(e=>visible(e)&&/\.asset_save_button$/.test(e.getAttribute('data-trace')||'')))throw Error('SEG_UNSAVED_CHANGES');
  if([...document.querySelectorAll('[role="dialog"]')].some(e=>visible(e)&&e.getAttribute('data-state')!=='closed'&&!studioHint(e)))throw Error('CLOSE_OTHER_DIALOGS_FIRST');
  let controls=[];
  if(action==='select-task'){
   if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(taskId||''))throw Error('CONFIRMED_TASK_NOT_VERIFIED');
   controls=[...document.querySelectorAll('[data-task-id]')].filter(e=>visible(e)&&e.getAttribute('data-task-id')?.toLowerCase()===taskId.toLowerCase());
   if(!controls.length){
    // Asset cards are links whose route ends with the asset's UUID. Several
    // cards with the same destination are one choice; prefer the wanted tool.
    const route=/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/(generate-image|generate|segmentation|fill-parts|retopology|smart-uv|texture-edit|texture-upscale|texture-pbr|texture|rigging|animate)\/(?:[^/]*?-)?([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i;
    const cards=[...document.querySelectorAll('a[href]')].filter(visible).flatMap(e=>{try{const u=new URL(e.href,location.origin),m=u.pathname.match(route);return u.origin===location.origin&&!u.search&&!u.hash&&m&&m[2].toLowerCase()===taskId.toLowerCase()?[{e,href:u.href,tool:m[1]}]:[];}catch{return [];}});
    const byHref=[...new Map(cards.map(c=>[c.href,c])).values()];
    const pick=byHref.filter(c=>c.tool===workflow).length===1?byHref.filter(c=>c.tool===workflow):byHref.filter(c=>c.tool==='generate').length===1?byHref.filter(c=>c.tool==='generate'):byHref;
    controls=pick.length===1?[pick[0].e]:pick.map(c=>c.e);
   }
  }else if(action==='select-tool'){
   const names={'generate-image':['Image','Imagen','画像'],generate:['Model','Modelo','モデル','模型'],segmentation:['Segment','Dividir'],'fill-parts':['Fill Parts','Rellenar Partes'],retopology:['Retopo','Remesh'],texture:['Texture','Textura','Texturas','テクスチャ','纹理'],'texture-edit':['Edit','Editar'],'texture-upscale':['Upscale'],'texture-pbr':['PBR'],'smart-uv':['Smart UV','UV inteligente'],rigging:['Rig','Rigging','Riggeo','Rigueo','リグ','绑定'],animate:['Animate','Animar']};
   if(!names[workflow])throw Error('SEG_WORKFLOW_INVALID');
   // The side menu marks each section link with data-state; its route names
   // the tool in every interface language and carries the open model's ID.
   const routeOf=e=>{try{return new URL(e.href,location.origin).pathname.match(/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/(generate-image|generate|segmentation|fill-parts|retopology|smart-uv|texture-edit|texture-upscale|texture-pbr|texture|rigging|animate)(?:\/([^/]+))?\/?$/);}catch{return null;}};
   const sideLinks=[...document.querySelectorAll('a[href][data-state]')].filter(e=>visible(e)&&routeOf(e)?.[1]===workflow&&(!taskId||routeOf(e)?.[2]?.toLowerCase().endsWith(String(taskId).toLowerCase())));
   controls=sideLinks.length?sideLinks:[...document.querySelectorAll('a,button,[role="button"],[role="menuitem"],[data-trace]')].filter(e=>visible(e)&&names[workflow].includes(text(e)));
  }else throw Error('STUDIO_NAVIGATION_ACTION_INVALID');
  controls=controls.filter(e=>!controls.some(child=>child!==e&&e.contains(child)));
  if(!controls.length)return {navigation:'unavailable'};
  if(controls.length!==1||controls[0].disabled||controls[0].getAttribute('aria-disabled')==='true')throw Error('STUDIO_NAVIGATION_AMBIGUOUS');
  const control=controls[0],trace=control.getAttribute('data-trace')||'';
  if(control.matches('[data-price],[data-cost]')||/generate_.*button|rig_button|asset_save_button|delete|purchase|checkout/.test(trace))throw Error('STUDIO_NAVIGATION_AMBIGUOUS');
  control.click();return {navigation:'clicked'};
 }catch(error){return {adapterError:error.message||'STUDIO_NAVIGATION_UNAVAILABLE'};}
}

// Shared by generation recovery, UV, textures and rigging: observe, navigate,
// then verify both asset and tool. Bounded free recovery; no paid retries.
export async function navigateStudioTask({chrome,runInTab,pause,bridge},taskId,workflow){
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(taskId||''))throw Error('CONFIRMED_TASK_NOT_VERIFIED');
 if(workflow&&!STUDIO_WORKSPACES.includes(workflow))throw Error('SEG_WORKFLOW_INVALID');
 const key=`workbenchNavigation:${bridge.tabId}:${taskId}`,seen=new Set();
 const stored=chrome.storage?.local?(await chrome.storage.local.get(key))[key]:null;
 let remembered=(Array.isArray(stored?.urls)?stored.urls:[]).slice(0,12).filter(u=>verifiedTaskUrl(u,taskId));
 const read=async()=>{
  const s=await runInTab(bridge,observeGroupStudio);
  const urls=(s.links||[]).filter(l=>l.taskId===taskId).map(l=>verifiedTaskUrl(l.url,taskId,l.workflow)).filter(Boolean);
  const next=[...new Set([...urls,...remembered])].slice(0,12);
  if(next.length!==remembered.length||next.some((u,i)=>u!==remembered[i])){
   remembered=next;if(chrome.storage?.local)await chrome.storage.local.set({[key]:{urls:remembered}});
  }
  return s;
 };
 // The URL changes before a client-side transition renders, so a tool counts
 // as reached only when the side menu also marks it active (when present).
 const toolShown=(s,tool)=>s.workflow===tool&&(s.activeTool==null||s.activeTool===tool);
 const arrived=s=>s.taskId===taskId&&(!workflow||toolShown(s,workflow));
 let state=await read();
 // Wall-clock bound plus an attempt bound: background-tab timers can stretch,
 // and tests may resolve pauses instantly.
 async function waitFor(done){
  for(let i=0,until=Date.now()+30000;i<150&&Date.now()<until;i++){
   await pause(200);
   try{state=await read();}catch(error){if(['AUTOMATION_NOT_AUTHORIZED','STUDIO_ORIGIN_CHANGED'].includes(error.message))throw error;continue;}
   if(done(state))return;
  }
  throw Error('CONFIRMED_TASK_NOT_LOADED');
 }
 async function clearBlocking(){
  if(state.blockingDialog){
   const notice=await runInTab(bridge,studioNavigationControl,[{action:'close-notifications'}]);
   if(['closed','closing'].includes(notice.navigation)){
    for(let i=0;i<12;i++){await pause(250);state=await read();if(!state.blockingDialog)break;}
   }
   if(state.blockingDialog)await runInTab(bridge,exportStudioControl,[{step:'close',taskId:state.taskId}]);
   state=await read();if(state.blockingDialog)throw Error('CLOSE_OTHER_DIALOGS_FIRST');
  }
 }
 for(let phase=0;phase<8;phase++){
  await clearBlocking();
  if(arrived(state))return state;
  if(state.unsavedChanges)throw Error('SEG_UNSAVED_CHANGES');
  // Fast path: Studio's own side menu and asset cards switch tool or model
  // in place, without reloading the page. Only when the rendered side menu
  // was observed and the wanted link is on screen.
  const action=state.taskId===taskId?'select-tool':'select-task',signature=action+':'+state.workflow+':'+state.taskId;
  const linked=!!state.activeTool&&(state.links||[]).some(l=>l.taskId===taskId&&(action==='select-task'||l.workflow===workflow));
  if(linked&&(action==='select-task'||workflow)&&!seen.has(signature)){
   seen.add(signature);
   const result=await runInTab(bridge,studioNavigationControl,[{action,taskId,workflow}]);
   if(result.navigation==='clicked'){
    await waitFor(s=>action==='select-task'?s.taskId===taskId:toolShown(s,workflow));continue;
   }
  }
  const all=[...new Set([...(state.links||[]).filter(l=>l.taskId===taskId).map(l=>verifiedTaskUrl(l.url,taskId,l.workflow)),...remembered])].filter(Boolean);
  const exact=all.filter(u=>verifiedTaskUrl(u,taskId,workflow));
  let url=exact.length===1?exact[0]:null;
  if(!url&&state.taskId!==taskId){
   const preferred=[state.workflow,'generate',...STUDIO_WORKSPACES].find(w=>all.filter(u=>verifiedTaskUrl(u,taskId,w)).length===1);
   if(preferred)url=all.find(u=>verifiedTaskUrl(u,taskId,preferred));
  }
  if(url&&!seen.has(url)){
   seen.add(url);await chrome.tabs.update(bridge.tabId,{url});
   const tool=new URL(url).pathname.match(/workspace\/([^/]+)/)[1];
   await waitFor(s=>s.taskId===taskId&&toolShown(s,tool));continue;
  }
  if(!seen.has(signature)){
   seen.add(signature);
   const result=await runInTab(bridge,studioNavigationControl,[{action,taskId,workflow}]);
   if(result.navigation==='clicked'){
    await waitFor(s=>action==='select-task'?s.taskId===taskId:toolShown(s,workflow));continue;
   }
  }
  // Restore the public workspace if the user left the editor or its current
  // tool hides the asset list. Asset URLs are still never constructed from IDs.
  if(!seen.has('model-workspace')&&!(state.workflow==='generate'&&!state.taskId)){
   seen.add('model-workspace');
   const target=await runInTab(bridge,resolveStudioGenerationWorkspace);
   await chrome.tabs.update(bridge.tabId,{url:target.url});
   await waitFor(s=>s.workflow==='generate');continue;
  }
  throw Error('CONFIRMED_TASK_LINK_NOT_OBSERVED');
 }
 if(arrived(state))return state;
 throw Error('CONFIRMED_TASK_NOT_LOADED');
}

export async function navigateStudioModelWorkspace({chrome,runInTab,pause,bridge}){
 let state=await runInTab(bridge,observeGroupStudio);
 if(state.workflow==='generate'&&state.importAvailable)return state;
 if(state.unsavedChanges)throw Error('SEG_UNSAVED_CHANGES');
 if(state.blockingDialog)await runInTab(bridge,exportStudioControl,[{step:'close',taskId:state.taskId}]);
 const target=await runInTab(bridge,resolveStudioGenerationWorkspace);
 await chrome.tabs.update(bridge.tabId,{url:target.url});
 for(let i=0,until=Date.now()+30000;i<150&&Date.now()<until;i++){
  await pause(200);
  try{state=await runInTab(bridge,observeGroupStudio);}catch(error){if(['AUTOMATION_NOT_AUTHORIZED','STUDIO_ORIGIN_CHANGED'].includes(error.message))throw error;continue;}
  if(state.workflow==='generate'&&state.importAvailable)return state;
 }
 throw Error('GENERATION_WORKSPACE_NOT_LOADED');
}

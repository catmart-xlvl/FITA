// Narrow imported-mesh controls. No private APIs or page application state.
// Standalone because chrome.scripting serializes the function into the tab.
export function controlImportOrientation({confirm=false,panelId:expectedPanelId}={}){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
 if(location.origin!=='https://studio.tripo3d.ai')throw Error('STUDIO_ORIGIN_CHANGED');
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const label=e=>(e?.innerText||e?.textContent||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
 const isTitle=e=>/^(?:encuentra el mejor angulo|find (?:the|your) best angle)(?:\s+(?:para\b|for\b).{0,100})?[.!:]?$/.test(label(e));
 const titles=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],p,span,div,strong')].filter(e=>visible(e)&&isTitle(e)&&!Array.from(e.children).some(c=>visible(c)&&isTitle(c)));
 if(!titles.length)return {present:false,confirmed:false};
 if(titles.length!==1)throw Error('SEG_IMPORT_ORIENTATION_AMBIGUOUS');
 let scope=titles[0],buttons=[];
 for(let depth=0;scope&&scope!==document.body&&depth<16;depth++,scope=scope.parentElement){
  buttons=[...scope.querySelectorAll('button,[role="button"]')].filter(e=>visible(e)&&['confirmar','confirm'].includes(label(e)));
  if(buttons.length)break;
 }
 if(!scope||scope===document.body||buttons.length!==1)throw Error('SEG_IMPORT_CONFIRM_REQUIRED');
 const button=buttons[0];
 // Only the free orientation confirmation, never an adjacent priced action.
 if(button.matches?.('[data-price],[data-cost]')||button.querySelector('[data-price],[data-cost]')||[...document.querySelectorAll('[role="dialog"]')].some(e=>visible(e)&&e.getAttribute?.('data-state')!=='closed'&&e!==scope&&!e.contains(scope)&&!scope.contains(e)))throw Error('SEG_IMPORT_ORIENTATION_AMBIGUOUS');
 // This state belongs to the extension's isolated DOM world. It survives a lost
 // executeScript reply and counts only this free confirmation, never Generate.
 const tracker=globalThis.__workbenchOrientationV2 ||= {panels:new WeakMap(),next:0};
 let record=tracker.panels.get(scope);
 if(!record){record={panelId:String(++tracker.next),confirmClicks:0,lastConfirmedAt:null};tracker.panels.set(scope,record);}
 if(confirm&&expectedPanelId&&expectedPanelId!==record.panelId)throw Error('SEG_IMPORT_ORIENTATION_CHANGED');
 const busy=[...scope.querySelectorAll('[aria-busy="true"],[role="progressbar"]')].some(visible);
 const enabled=!busy&&!button.disabled&&button.getAttribute('aria-disabled')!=='true';
 let confirmed=false;
 if(confirm&&enabled&&record.confirmClicks<3&&(record.lastConfirmedAt===null||Date.now()-record.lastConfirmedAt>=3000)){
  record.confirmClicks++;record.lastConfirmedAt=Date.now();button.click();confirmed=true;
 }
 return {present:true,title:label(titles[0]),enabled,busy,confirmed,...record};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

export async function studioGroupControl(input){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
 if(location.origin!=='https://studio.tripo3d.ai')throw Error('STUDIO_ORIGIN_CHANGED');
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
 const task=location.pathname.match(/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i)?.[1];
 if(input.action==='import'){
  if([...document.querySelectorAll('[role="dialog"]')].some(visible))throw Error('CLOSE_OTHER_DIALOGS_FIRST');
  const fields=[...document.querySelectorAll('input[type="file"]')].filter(e=>e.accept.replace(/\s/g,'').toLowerCase()==='.fbx,.obj,.stl,.glb');
  if(fields.length!==1||fields[0].disabled)throw Error('SEG_IMPORT_CONTROL_REQUIRED');
  const staged=input.model.stagedId?globalThis.__workbenchRigUpload:null;
  if(input.model.stagedId&&(!staged||staged.id!==input.model.stagedId||staged.chunks.length!==staged.total))throw Error('RIG_UPLOAD_INCOMPLETE');
  const bytes=Uint8Array.from(atob(staged?staged.chunks.join(''):input.model.dataBase64),c=>c.charCodeAt(0));
  if(staged)delete globalThis.__workbenchRigUpload;
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.length>(staged?150:32)*1024*1024||digest!==input.model.sha256||String.fromCharCode(...bytes.slice(0,4))!=='glTF')throw Error('SEG_IMPORT_BYTES_INVALID');
  const transfer=new DataTransfer();transfer.items.add(new File([bytes],input.model.name,{type:'model/gltf-binary'}));fields[0].files=transfer.files;fields[0].dispatchEvent(new Event('input',{bubbles:true}));fields[0].dispatchEvent(new Event('change',{bubbles:true}));return {dispatched:true,sha256:digest};
 }
 if(input.taskId&&task!==input.taskId)throw Error('CONFIRMED_TASK_CHANGED');
 if(input.action==='navigate'){
  const workflows=['smart-uv','texture','generate','rigging'];if(!workflows.includes(input.workflow))throw Error('SEG_WORKFLOW_INVALID');
  const links=[...document.querySelectorAll('a[href]')].flatMap(a=>{try{const u=new URL(a.href);return u.origin===location.origin&&!u.search&&!u.hash&&new RegExp('^/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?/)?workspace/'+input.workflow+'/').test(u.pathname)&&u.pathname.endsWith(input.taskId)?[u.href]:[];}catch{return [];}});
  const unique=[...new Set(links)];if(unique.length!==1)throw Error('CONFIRMED_TASK_LINK_NOT_OBSERVED');return {url:unique[0]};
 }
 if(input.action==='submitUV'){
  if(!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/smart-uv\//.test(location.pathname))throw Error('SEG_UV_WORKSPACE_REQUIRED');
  if([...document.querySelectorAll('[role="dialog"]')].some(visible))throw Error('CLOSE_OTHER_DIALOGS_FIRST');
  const buttons=[...document.querySelectorAll('[data-trace="studio.workspace_smart-uv.generate_uv_button"]')].filter(visible);
  if(buttons.length!==1||buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true'||text(buttons[0]).match(/(\d+(?:[.,]\d+)?)\s*$/)?.[1]!==input.expectedCost)throw Error('SEG_PRICE_CHANGED');
  buttons[0].click();return {submitted:true};
 }
 throw Error('SEG_GROUP_ACTION_INVALID');
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

export function observeGroupStudio(){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
 if(location.origin!=='https://studio.tripo3d.ai')throw Error('STUDIO_ORIGIN_CHANGED');
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
 const id=u=>u.pathname.match(/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i)?.[1]||null;
 // Same 12 section routes as studio-map.js STUDIO_ROUTE_GROUP.
 const route=/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/(generate-image|generate|segmentation|fill-parts|retopology|smart-uv|texture-edit|texture-upscale|texture-pbr|texture|rigging|animate)(?:\/|$)/;
 const links=[...document.querySelectorAll('a[href]')].flatMap(a=>{try{const u=new URL(a.href);return u.origin===location.origin&&!u.search&&!u.hash&&route.test(u.pathname)&&id(u)?[{taskId:id(u),workflow:u.pathname.match(route)[1],url:u.href,text:text(a).slice(0,180)}]:[];}catch{return [];}});
 // fita-hint-v1: Studio's informational popovers (viewer help, "retry or go to
 // Texture" tip). Language independent; never a form, price or traced action.
 const studioHint=d=>{const q=s=>d.querySelector?.(s),has=n=>!!q('[class~="'+n+'"]');return !q('input,textarea,select,[role="slider"],[role="switch"],[role="combobox"],[data-price],[data-cost],[data-trace]')&&has('i-tripo:close')&&(d.querySelectorAll?.('button')||[]).length<=2&&(has('i-tripo:retry')&&has('i-tripo:texture')||!!q('.cursor-move')&&!!q('.cancel-drag'));};
 const openDialogs=[...document.querySelectorAll('[role="dialog"]')].filter(e=>visible(e)&&e.getAttribute('data-state')!=='closed');
 // The side menu marks the rendered tool (data-state="active").
 const activeLinks=[...document.querySelectorAll('a[href][data-state="active"]')].flatMap(a=>{try{return [new URL(a.href).pathname.match(route)?.[1]].filter(Boolean);}catch{return [];}});
 const placeMatch=location.pathname.match(route),pageTrace=document.querySelector('[data-trace="home"],[data-trace="assets"]')?.getAttribute('data-trace');
 const buttons=[...document.querySelectorAll('button')].filter(visible),uv=buttons.filter(b=>b.getAttribute('data-trace')==='studio.workspace_smart-uv.generate_uv_button'),downloads=buttons.filter(b=>['Descargar','Download'].includes(b.getAttribute('aria-label'))&&[...b.querySelectorAll('[class]')].some(e=>e.classList.contains('i-tripo:download')));
 const importFields=[...document.querySelectorAll('input[type="file"]')].filter(e=>e.accept.replace(/\s/g,'').toLowerCase()==='.fbx,.obj,.stl,.glb');
 const importBusy=[...document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')].some(visible);
 const modelReady=!!id(new URL(location.href))&&[...document.querySelectorAll('canvas')].some(visible)&&buttons.filter(b=>/^(Exportar|Export)$/.test(text(b))&&!b.disabled&&b.getAttribute('aria-disabled')!=='true').length===1;
 const unsavedChanges=buttons.some(b=>/\.asset_save_button$/.test(b.getAttribute('data-trace')||''))||[...document.querySelectorAll('[role="dialog"]')].filter(visible).some(d=>/Cambios sin guardar|Unsaved changes/i.test(text(d)));
 return {blockingDialog:openDialogs.some(e=>!studioHint(e)),studioHints:openDialogs.filter(e=>studioHint(e)).length,activeTool:activeLinks.length===1?activeLinks[0]:null,page:placeMatch?'workspace':pageTrace||(/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?(?:assets\/?)?$/.test(location.pathname)?(location.pathname.replace(/\/$/,'').endsWith('assets')?'assets':'home'):'other'),unsavedChanges,modelReady,importFileCount:importFields.reduce((n,e)=>n+(e.files?.length||0),0),importBusy,taskId:id(new URL(location.href)),workflow:location.pathname.match(/workspace\/([^/]+)/)?.[1],links,importAvailable:[...document.querySelectorAll('input[type="file"]')].filter(e=>e.accept.replace(/\s/g,'').toLowerCase()==='.fbx,.obj,.stl,.glb').length===1,uv:{costLabel:uv.length===1?text(uv[0]).match(/(\d+(?:[.,]\d+)?)\s*$/)?.[1]:null,enabled:uv.length===1&&!uv[0].disabled,downloadReady:downloads.length===1&&!downloads[0].disabled},controls:buttons.filter(b=>/UV|Textur|Import|Upload|Subir|Cargar/i.test(text(b))).map(b=>({text:text(b).slice(0,150),trace:b.getAttribute('data-trace'),disabled:b.disabled})).slice(0,20)};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

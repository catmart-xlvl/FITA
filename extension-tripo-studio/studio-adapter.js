// Selectors inspected on authenticated Studio /workspace/generate (EN) and /es/workspace/generate (ES).
// No private endpoints, application stores or auth data are used. Every mutation has a separate command.
export const STUDIO_WORKER_REVISION='0.2.77-patient-navigation-check';

// Tool navigation uses the public editor route, never a guessed asset/task URL.
// Keep the current locale and exclude query/hash values from the destination.
export function resolveStudioGenerationWorkspace(){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=='https://studio.tripo3d.ai')throw Error('STUDIO_ORIGIN_CHANGED');
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  // fita-hint-v1: Studio's informational popovers (viewer help, "retry or go to
  // Texture" tip). Language independent; never a form, price or traced action.
  const studioHint=d=>{const q=s=>d.querySelector?.(s),has=n=>!!q('[class~="'+n+'"]');return !q('input,textarea,select,[role="slider"],[role="switch"],[role="combobox"],[data-price],[data-cost],[data-trace]')&&has('i-tripo:close')&&(d.querySelectorAll?.('button')||[]).length<=2&&(has('i-tripo:retry')&&has('i-tripo:texture')||!!q('.cursor-move')&&!!q('.cancel-drag'));};
  if([...document.querySelectorAll('[role="dialog"]')].some(e=>visible(e)&&e.getAttribute('data-state')!=='closed'&&!studioHint(e)))throw Error('CLOSE_OTHER_DIALOGS_FIRST');
  if([...document.querySelectorAll('[data-trace]')].some(e=>visible(e)&&/\.asset_save_button$/.test(e.getAttribute('data-trace')||'')))throw Error('STUDIO_UNSAVED_CHANGES');
  const locale=location.pathname.match(/^\/([a-z]{2}(?:-[A-Za-z]{2,4})?)(?:\/|$)/)?.[1];
  return {url:location.origin+(locale?'/'+locale:'')+'/workspace/generate'};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

// Read provider failures from rendered task cards/notifications. Only UUIDs
// requested by the current project can be returned. Old unrelated notices,
// account fields and a missing card are never evidence of generation failure.
export function readStudioGenerationFailures({taskIds=[],action='inspect'}={}){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
 try{
  if(location.origin!=='https://studio.tripo3d.ai')return {adapterError:'STUDIO_ORIGIN_CHANGED'};
  const uuid=/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/ig;
  if(!Array.isArray(taskIds)||taskIds.length!==4||new Set(taskIds).size!==4||taskIds.some(id=>!new RegExp('^'+uuid.source+'$','i').test(id)))return {adapterError:'STUDIO_CONFIRM_FOUR_CANDIDATES'};
  const targets=new Set(taskIds.map(id=>id.toLowerCase())),visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const text=el=>(el?.innerText||el?.textContent||'').replace(/<br\s*\/?\s*>/ig,' ').replace(/\s+/g,' ').trim();
  const key=taskIds.slice().sort().join(','),cache=globalThis.__fitaGenerationFailureEvidence ||= new Map();
  if(!cache.has(key)&&cache.size>=8){const oldest=cache.keys().next().value;cache.get(oldest).observer?.disconnect();cache.delete(oldest);}
  const entry=cache.get(key)||{failures:new Map()};cache.set(key,entry);
  const scan=()=>{
   for(const el of document.querySelectorAll('a[href],[data-task-id],[data-status],[role="alert"],p,span,div')){
    if(!visible(el))continue;
    const message=text(el);if(message.length>1600)continue;
    if(/texture|smart\s*uv|rigging|texturiz/i.test(message)&&!/model generation/i.test(message))continue;
    const explicitFailed=['failed','failure','error'].includes(String(el.getAttribute('data-status')||el.getAttribute('data-state')||'').toLowerCase());
    const failure=explicitFailed||/invalid user input|operation (?:has )?failed|generation (?:has )?failed|generaci[oó]n (?:ha )?fallad[oa]|operaci[oó]n (?:ha )?fallad[oa]|生成失败|生成失敗|生成に失敗|échec de la génération|generierung fehlgeschlagen/i.test(message);
    if(!failure)continue;
    const ids=[...new Set((message.match(uuid)||[]).map(id=>id.toLowerCase()))];let directTask=null;
    for(const attr of ['data-task-id','href']){const value=el.getAttribute(attr);if(!value)continue;try{if(attr==='href'){const url=new URL(value,location.origin);if(url.origin!==location.origin||url.search||url.hash||!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/generate\//.test(url.pathname))continue;}}catch{continue;}const own=(value.match(uuid)||[]).map(id=>id.toLowerCase());if(own.length===1&&targets.has(own[0]))directTask=own[0];for(const id of own)if(!ids.includes(id))ids.push(id);}
    // A provider job ID may differ from the model ID. Bind that alias only
    // when this same failed card directly identifies the requested model.
    const taskId=directTask&&ids.length<=2&&ids.filter(id=>targets.has(id)).length===1?directTask:ids.length===1&&targets.has(ids[0])?ids[0]:null;
    if(!taskId)continue;
    entry.failures.set(taskId,{taskId,...(ids.length===2?{providerTaskId:ids.find(id=>id!==taskId)}:{}),status:'failed',provider:'Tripo',code:/invalid user input/i.test(message)?'invalid_user_input':'generation_failed',source:explicitFailed?'studio-task-status':'studio-notification',observedAt:new Date().toISOString()});
   }
  };
  scan();
  if(action==='watch'&&!entry.observer&&typeof MutationObserver!=='undefined'){
   let scheduled=false;entry.observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;scan();});});
   entry.observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-status','data-state']});
  }
  let navigation='none';
  if(action==='open'||action==='close'){
   // Native icon/trace identity, independent of translated button labels.
   const nativeIcon=el=>String(el.getAttribute('class')||'').split(/\s+/).some(c=>/^i-tripo:(?:bell|notification)(?:-|$)/.test(c));
   const buttons=[...document.querySelectorAll('[data-trace],button,[role="button"]')].filter(visible).filter(el=>/notification|notification_center/i.test(el.getAttribute('data-trace')||'')||[...el.querySelectorAll('[class]')].some(nativeIcon));
   const icons=[...document.querySelectorAll('[class]')].filter(visible).filter(nativeIcon).map(icon=>icon.closest('button,[role="button"],[data-trace]')||icon.parentElement).filter(el=>el&&visible(el));
   const all=[...new Set([...buttons,...icons])],controls=all.filter(el=>!all.some(child=>child!==el&&el.contains(child)));
   if(controls.length===1){
    const control=controls[0],id=control.getAttribute('id'),controlled=(control.getAttribute('aria-controls')||'').split(/\s+/);
    // Radix may leave the trigger's state closed while its labelled dialog is
    // mounted open. Resolve that native relationship, never translated text.
    const linkedPanels=[...document.querySelectorAll('[role="dialog"]')].filter(panel=>visible(panel)&&panel.getAttribute('data-state')!=='closed'&&(controlled.includes(panel.getAttribute('id'))||id&&(panel.getAttribute('aria-labelledby')||'').split(/\s+/).includes(id)));
    const linkedOpen=linkedPanels.length===1;
    const expanded=control.getAttribute('aria-expanded')==='true'||control.getAttribute('data-state')==='open'||linkedOpen;
    if(action==='close'){
     // Only dismiss the positively identified notification popover. Never send
     // Escape or click an arbitrary dialog that could contain unsaved work.
     if(linkedOpen){
      const panel=linkedPanels[0];panel.focus();panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));navigation='closing';
     }else if(expanded){controls[0].click();navigation='closing';}else navigation='not-open';
    }else if(expanded)navigation='already-open';else{controls[0].click();navigation='opened';}
   }else navigation='notification-control-unverified';
  }
  if(action==='older'){
   const panels=[...document.querySelectorAll('[data-radix-scroll-area-viewport],[role="log"],div')].filter(visible).filter(el=>el.scrollHeight>el.clientHeight+8&&el.clientHeight>100&&/auto|scroll/.test(getComputedStyle(el).overflowY)&&/Task\s*ID|operation (?:has )?failed|invalid user input/i.test(text(el)));
   const innermost=panels.filter(el=>!panels.some(other=>other!==el&&el.contains(other)));
   if(innermost.length===1){const el=innermost[0],before=el.scrollTop;el.scrollTop=Math.min(el.scrollHeight-el.clientHeight,el.scrollTop+el.clientHeight*.8);navigation=el.scrollTop>before?'scrolled':el.querySelector('[aria-busy="true"]')?'loading':'end';}else navigation='notification-list-unverified';
  }
  if(['open','close'].includes(action))globalThis.__fitaNotificationTrace=[...(globalThis.__fitaNotificationTrace||[]),{at:Date.now(),action,navigation}].slice(-12);
  return {version:1,failures:[...entry.failures.values()],navigation};
 }catch{return {adapterError:'STUDIO_FAILURE_STATUS_UNAVAILABLE'};}
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}
export async function observeStudioDocument({includeFileHashes=false,includeLayoutDiagnostic=false}={}) {
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if (location.origin !== "https://studio.tripo3d.ai") throw new Error("STUDIO_ORIGIN_CHANGED");
  const visible = (element) => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity!=="0";
  };
  const text = (element) => (element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
  const digest = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2,"0")).join("");
  const textureWorkspace=/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/texture(?:\/|$)/.test(location.pathname);
  const smartUvWorkspace=/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/smart-uv(?:\/|$)/.test(location.pathname);
  // Generation editors also have a single descriptive slug without a task UUID.
  // Recognizing that form never assigns a model identity to the slug.
  const pathSupported = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/generate(?:\/[^/]+)?\/?$/.test(location.pathname);
  const supportedWorkspace=/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/(?:generate|texture|smart-uv|rigging)(?:\/|$)/.test(location.pathname);
  const containers = [...document.querySelectorAll('[data-trace="studio.workspace_'+(location.pathname.includes('/texture/')?'texture':'generate')+'.upload_image_button"]')];
  const bindings=globalThis.__localWorkbenchStudioSlotBindingsV2 ||= new Map();
  const fileHashes=globalThis.__localWorkbenchStudioFileHashesV2 ||= new WeakMap();
  // Same 12 section routes as studio-map.js STUDIO_ROUTE_GROUP; the asset ID
  // is the UUID that ends the route, after an optional descriptive slug.
  const taskIdFrom=(value)=>{try{const url=new URL(value,location.origin);if(url.origin!==location.origin)return null;return url.pathname.match(/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/(?:generate-image|generate|segmentation|fill-parts|retopology|smart-uv|texture-edit|texture-upscale|texture-pbr|texture|rigging|animate)\/(?:[^/]*?-)?([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i)?.[1]||null;}catch{return null;}};
  const currentTaskId=taskIdFrom(location.href);
  const existingTaskIds=[...new Set([...document.querySelectorAll('a[href]')].map((link)=>taskIdFrom(link.href)).filter(Boolean))].sort().slice(0,512);
  const taskCards=[...document.querySelectorAll('a[href]')].filter(visible).flatMap((link)=>{const taskId=taskIdFrom(link.href);return taskId?[{taskId,text:text(link).slice(0,180),title:(link.getAttribute('aria-label')||link.getAttribute('title')||'').replace(/\s+/g,' ').trim().slice(0,180)}]:[];}).slice(0,40);
  const slots = {};
  // These four direct card class combinations were observed in the user's occupied form.
  // History thumbnails are outside this unique grid. Never infer slot order from indexes.
  const gridCandidates=[...document.querySelectorAll('div.rounded-3.flex.flex-wrap.w-full.aspect-square.relative')].filter(visible);
  let cards=null;
  if(gridCandidates.length===1){
    const children=[...gridCandidates[0].children],has=(node,...names)=>names.every((name)=>node.classList.contains(name));
    const candidates={front:children.filter((node)=>has(node,'w-full','h-33.5','rounded-t-3')),left:children.filter((node)=>has(node,'w-1/3','aspect-square','rounded-bl-3')),right:children.filter((node)=>has(node,'w-1/3','aspect-square','border-r-none')&&!has(node,'rounded-bl-3')&&!has(node,'rounded-br-3')),back:children.filter((node)=>has(node,'w-1/3','aspect-square','rounded-br-3'))};
    if(Object.values(candidates).every((matches)=>matches.length===1)&&new Set(Object.values(candidates).map((matches)=>matches[0])).size===4)cards=Object.fromEntries(Object.entries(candidates).map(([slot,matches])=>[slot,matches[0]]));
  }
  for (const slot of ["front","left","right","back"]) {
    const matches = containers.filter((container) => [...container.querySelectorAll("[class]")].some((child) => child.classList.contains(`i-tripo:${slot}-view`)));
    let container = matches.length === 1 ? matches[0] : null;
    let input = container?.querySelector('input[type="file"]');
    if(container&&input)bindings.set(slot,{container,input});
    else {
      // Keep the exact DOM nodes observed before upload if only their icon disappears.
      // No index fallback: replacement/unmounted nodes must be inspected again.
      const bound=bindings.get(slot);
      if(bound?.container?.isConnected&&bound?.input?.isConnected&&bound.container.contains(bound.input)&&bound.container.matches('[data-trace="studio.workspace_'+(location.pathname.includes('/texture/')?'texture':'generate')+'.upload_image_button"]')){
        const conflicting=[...bound.container.querySelectorAll("[class]")].some((child)=>["front","left","right","back"].some((other)=>other!==slot&&child.classList.contains(`i-tripo:${other}-view`)));
        if(!conflicting){container=bound.container;input=bound.input;}
      }
    }
    // Studio replaces occupied upload controls. An ancestor with only one remaining
    // data-trace can still contain three OTHER occupied slots: never widen this binding.
    const card=cards?.[slot];
    const conflictingCard=card&&[...card.querySelectorAll('[class]')].some((child)=>['front','left','right','back'].some((other)=>other!==slot&&child.classList.contains(`i-tripo:${other}-view`)));
    const scope=card&&!conflictingCard?card:container,scopeLevel=0;
    if(card&&!conflictingCard)input=card.querySelector('input[type="file"]');
    const directImages=container?[...container.querySelectorAll("img")]:[];
    const scopeImages=scope?[...scope.querySelectorAll("img")]:[];
    const previews=scopeImages.filter((img)=>visible(img)&&img.complete&&img.naturalWidth>0&&img.naturalHeight>0);
    const backgrounds=scope?[scope,...scope.querySelectorAll("*")].filter((element)=>visible(element)&&/^url\(/i.test(getComputedStyle(element).backgroundImage||"")):[];
    const files = input ? [...(input.files || [])] : [];
    const verifiedFiles=[];
    if(includeFileHashes)for(const file of files){
      if(file.size>32*1024*1024){verifiedFiles.push({size:file.size,mimeType:file.type,sha256:null,error:"FILE_TOO_LARGE_TO_VERIFY"});continue;}
      let sha256=fileHashes.get(file);
      if(!sha256){sha256=[...new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer()))].map((byte)=>byte.toString(16).padStart(2,"0")).join("");fileHashes.set(file,sha256);}
      verifiedFiles.push({sha256,size:file.size,mimeType:file.type});
    }
    let previewProof=null;
    if(includeFileHashes&&card&&!conflictingCard&&previews.length===1){
      const img=previews[0],width=img.naturalWidth,height=img.naturalHeight;
      previewProof={width,height,pixelSha256:null,previewBytesSha256:null};
      if(width*height<=32*1024*1024){
        try{
          const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
          const ctx=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});ctx.drawImage(img,0,0);
          const pixels=ctx.getImageData(0,0,width,height).data,header=new TextEncoder().encode(`${width}:${height}:`),combined=new Uint8Array(header.length+pixels.length);combined.set(header);combined.set(pixels,header.length);
          previewProof.pixelSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',combined))].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
        }catch{previewProof.pixelError='PREVIEW_PIXELS_UNREADABLE';}
        // Only an already displayed same-origin blob may be read for an original-byte proof.
        // No remote/private endpoints or signed URLs are fetched.
        try{
          const source=img.currentSrc||img.src;
          if(source?.startsWith(`blob:${location.origin}/`)){
            const response=await fetch(source,{credentials:'omit',redirect:'error'}),blob=await response.blob();
            if(response.ok&&blob.size<=32*1024*1024)previewProof.previewBytesSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
          }
        }catch{previewProof.bytesError='PREVIEW_BYTES_UNREADABLE';}
      }
    }
    const pendingReceipt=globalThis.__localWorkbenchStudioUploadReceiptsV3?.get(slot);
    if(pendingReceipt&&!pendingReceipt.invalidated&&!pendingReceipt.receipt&&pendingReceipt.card===card&&card?.isConnected&&previewProof&&(previewProof.pixelSha256||previewProof.previewBytesSha256)&&(!pendingReceipt.width||(pendingReceipt.width===previewProof.width&&pendingReceipt.height===previewProof.height))){
      // This card was proven empty immediately before our exact native File dispatch.
      // Studio may transcode it: preserve the original-byte -> observed-preview receipt.
      pendingReceipt.receipt={version:1,operationId:pendingReceipt.operationId,slot,originalSha256:pendingReceipt.originalSha256,originalSize:pendingReceipt.originalSize,mimeType:pendingReceipt.mimeType,...previewProof};
    }
    const receipt=pendingReceipt&&!pendingReceipt.invalidated&&pendingReceipt.card===card?pendingReceipt.receipt||null:null;
    slots[slot] = {
      found: !!input||!!(card&&!conflictingCard),
      semanticBinding:card&&!conflictingCard?'observed-multiview-card':input?'observed-slot-icon':null,
      occupied: files.length > 0 || previews.length > 0,
      previewVisible:previews.length>0,
      files:verifiedFiles,
      previewProof,
      receipt,
      diagnostic:{inputCount:input?1:0,fileCount:files.length,directImageCount:directImages.length,scopeImageCount:scopeImages.length,visibleLoadedImages:previews.length,visibleBackgroundImages:backgrounds.length,scopeLevel},
      fingerprint: await digest(JSON.stringify({ files:files.map((f)=>[f.name,f.type,f.size,f.lastModified]), hashes:verifiedFiles.map((file)=>file.sha256),previewProof, images:previews.map((img)=>[img.currentSrc || img.src,img.naturalWidth,img.naturalHeight]) })),
      acceptsImages: !!input && /image\/(png|jpeg|jpg|webp)/.test(input.accept || ""),
    };
  }
  const buttons = [...document.querySelectorAll("button")].filter(visible);
  // With P1.0 selected, the AI model select also shows the lightning icon:
  // only a plain button (no ARIA role) is the HD / Smart Mesh switch.
  const smartModeButtons=buttons.filter(button=>!button.getAttribute('role')&&[button,...button.querySelectorAll('[class]')].some(child=>child.classList.contains('i-tripo:speed-bolt')));
  const hdModeButtons=buttons.filter((button)=>["HD Model","Modelo HD"].includes(text(button)));
  const smartMesh=smartModeButtons.length===1&&smartModeButtons[0].classList.contains("c-black")&&[...smartModeButtons[0].querySelectorAll("[class]")].some((child)=>child.classList.contains("i-tripo:speed-bolt"));
  const quantityGroups=[...document.querySelectorAll('[role="group"]')].filter((group)=>visible(group)&&["1","2","4"].every((value)=>group.querySelector(`button[value="${value}"][aria-pressed]`)));
  const selectedQuantities=quantityGroups.length===1?[...quantityGroups[0].querySelectorAll('button[aria-pressed="true"]')].filter((button)=>visible(button)&&["1","2","4"].includes(button.value)):[];
  const generationCount=selectedQuantities.length===1?Number(selectedQuantities[0].value):null;
  const multiButton = buttons.find((button) => [...button.querySelectorAll("[class]")].some((child)=>child.classList.contains("i-tripo:multi-view")));
  const generateMatches = smartUvWorkspace?[]:textureWorkspace?buttons.filter(button=>button.getAttribute('data-trace')==='studio.workspace_texture.generate_texture_button'):buttons.filter(button=>button.classList.contains('animate-button')&&/\d+(?:[.,]\d+)?\s*$/.test(text(button)));
  const generate = generateMatches.length===1 ? generateMatches[0] : null;
  // HD can hide multiview until Smart Mesh is selected. Recognize the native
  // mode switch and generation control before attempting that free preparation.
  // Submission still requires the fully verified Smart Mesh form and cost.
  const generationControlsRecognized=!!multiButton||(smartModeButtons.length===1&&!!generate);
  const costLabel = generate ? text(generate).match(/(\d+(?:[.,]\d+)?)\s*$/)?.[1]||null : null;
  const comboboxes = [...document.querySelectorAll('[role="combobox"]')].filter(visible).map(text);
  const modelLabel = comboboxes.find((label)=>/^[HP]\d/.test(label)) || null;
  const privacy = comboboxes.find((label)=>/compartir|sharing|private|privad|public|公開|非公開/i.test(label)) || null;
  const switches=[...document.querySelectorAll('[role="switch"]')].filter(visible).map((element,index)=>({index,label:text(element.parentElement?.parentElement),checked:element.getAttribute("aria-checked")==="true"}));
  const options = { modelLabel, privacy, switches:switches.map((item)=>({index:item.index,label:/^(Generar en Partes|Textura 8K|Generate in Parts|8K Texture)$/.test(item.label)?item.label:null,checked:item.checked})) };
  if(textureWorkspace){
    const resolutions=buttons.filter(b=>/^(2K|4K|8K)$/.test(text(b))&&b.getAttribute('aria-pressed')==='true');
    const lighting=[...document.querySelectorAll('[role="switch"]')].filter(visible).filter(e=>/Remove Lighting|Eliminar iluminación|Quitar iluminación/i.test(text(e.parentElement)));
    options.texture={resolution:resolutions.length===1?text(resolutions[0]):null,removeLighting:lighting.length===1?lighting[0].getAttribute('aria-checked')==='true':null};
  }
  const topologyDialog=dialog=>{
    if(textureWorkspace||smartUvWorkspace)return false;
    const inputs=[...dialog.querySelectorAll('input[type="text"],input[type="number"]')].filter(visible),sliders=[...dialog.querySelectorAll('[role="slider"]')].filter(visible);
    const trigger=document.getElementById(dialog.getAttribute('aria-labelledby'));
    const modes=[...dialog.querySelectorAll('button')].filter(visible).map(text);
    const linked=trigger?.getAttribute('type')==='button'&&trigger.getAttribute('aria-haspopup')==='dialog'&&trigger.getAttribute('aria-controls')===dialog.id;
    const modeIcon=name=>[...dialog.querySelectorAll('button')].filter(e=>visible(e)&&!!e.querySelector?.('[class~="i-tripo:'+name+'"]')).length;
    const nativeModal=modeIcon('quad')===1&&modeIcon('triangle')===1||modes.filter(value=>/^(?:Quad|Cuadril[aá]tero)(?:\s+(?:New|Nuevo))?$/.test(value)).length===1&&modes.filter(value=>/^(?:Triangle|Tri[aá]ngulo)$/.test(value)).length===1;
    // Quad allows 500-25000 faces and Triangle 500-50000 (observed 2026-10-21).
    return (linked||nativeModal)&&[1,2,4].includes(inputs.length)&&sliders.length===inputs.length&&sliders.every(e=>e.getAttribute('aria-valuemin')==='500'&&['25000','50000'].includes(e.getAttribute('aria-valuemax')))&&dialog.querySelectorAll('[role="switch"]').length<=1;
  };
  // fita-hint-v1: Studio's informational popovers (viewer help, "retry or go to
  // Texture" tip). Language independent; never a form, price or traced action.
  const studioHint=d=>{const q=s=>d.querySelector?.(s),has=n=>!!q('[class~="'+n+'"]');return !q('input,textarea,select,[role="slider"],[role="switch"],[role="combobox"],[data-price],[data-cost],[data-trace]')&&has('i-tripo:close')&&(d.querySelectorAll?.('button')||[]).length<=2&&(has('i-tripo:retry')&&has('i-tripo:texture')||!!q('.cursor-move')&&!!q('.cancel-drag'));};
  const snapshot = {
    adapterVersion:2,
    quickGenerationVersion:1,
    generationNavigationVersion:1,
    navigationCheckVersion:1,
    lifecycleCheckVersion:1,nativeQuadExportVersion:1,
    topologySettingsVersion:1,
    automaticCandidatesVersion:1,
    generationFailureVersion:1,
    textureWorkflowVersion:2,
    segmentWorkflowVersion:1,
    uvSaveVersion:1,
    uvSelectionVersion:1,
    importOrientationVersion:2,
    rigWorkflowVersion:1,
    workflow:location.pathname.match(/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/([^/]+)/)?.[1]||'other',
    generationWorkspaceReady:pathSupported&&generationControlsRecognized,
    generationMode:smartUvWorkspace?'smart-uv':textureWorkspace?'texture':smartMesh?"smart-mesh":hdModeButtons.some((button)=>button.classList.contains("c-black"))?"hd":"unknown",
    generationCount,
    supported: supportedWorkspace&&((pathSupported && generationControlsRecognized) || !!currentTaskId),
    supportedLocale:location.pathname.match(/^\/([a-z]{2}(?:-[A-Za-z]{2,4})?)\/workspace(?:\/|$)/)?.[1]||'default',
    currentTaskId,
    existingTaskIds,
    taskCards,
    blockingDialog:[...document.querySelectorAll('[role="dialog"]')].some(dialog=>{const box=dialog.getBoundingClientRect(),style=getComputedStyle(dialog);return dialog.getAttribute('data-state')!=='closed'&&box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&!topologyDialog(dialog)&&!studioHint(dialog);}),
    anyUploadOccupied:Object.values(slots).some((slot)=>slot.occupied)||containers.some((container)=>!!container.querySelector("img")||[...container.querySelectorAll('input[type="file"]')].some((input)=>input.files?.length)),
    modelReady:!!currentTaskId&&[...document.querySelectorAll("canvas")].some(visible)&&buttons.filter((button)=>/^(Exportar|Export)$/.test(text(button))&&!button.disabled).length===1,
    mode: Object.values(slots).every((slot)=>slot.found) ? "multiview" : "other",
    slots,
    costLabel,
    modelLabel,
    options,
    generateEnabled: !!generate && !generate.disabled && generate.getAttribute("aria-disabled")!=="true",
    generateLabel: generate ? text(generate) : null,
  };
  if(smartUvWorkspace){
    // Observed on the user's imported GLB. Read only: this does not enable
    // paid Smart UV submission or prove completion of a UV operation.
    const uv=buttons.filter(button=>button.getAttribute('data-trace')==='studio.workspace_smart-uv.generate_uv_button');
    snapshot.smartUV={taskId:currentTaskId,costLabel:uv.length===1?text(uv[0]).match(/(\d+(?:[.,]\d+)?)\s*$/)?.[1]||null:null,enabled:uv.length===1&&!uv[0].disabled&&uv[0].getAttribute('aria-disabled')!=='true',submissionSupported:false};
  }
  let layoutDiagnostic;
  if(includeLayoutDiagnostic){
    const classes=(element)=>String(element?.getAttribute?.("class")||"").split(/\s+/).filter((value)=>/^[A-Za-z0-9_:./!#[\]()%=-]{1,100}$/.test(value)).slice(0,12).join(' ').slice(0,160);
    const knownLabel=(value)=>/^(front|left|right|back|frente|frontal|izquierda|derecha|espalda|trasera|posterior|Smart Mesh|HD Model|Malla Smart|Modelo HD)$/i.test(value||"")?value:null;
    const actionLabel=(value)=>/^(remove|delete|clear|close|eliminar|quitar|borrar|cerrar)(?:\s+(?:image|imagen|view|vista))?$/i.test(value||'')?value:null;
    const describe=(element)=>({tag:String(element?.tagName||"").toLowerCase(),classes:classes(element),role:(element?.getAttribute?.("role")||'').slice(0,24)||null,label:knownLabel(text(element))||actionLabel(text(element)),ariaLabel:knownLabel(element?.getAttribute?.('aria-label'))||actionLabel(element?.getAttribute?.('aria-label')),icons:[element,...element?.querySelectorAll?.('[class]')||[]].flatMap((child)=>String(child?.getAttribute?.('class')||'').split(/\s+/).filter((value)=>/^i-tripo:[a-z0-9-]+$/.test(value))).slice(0,6),slotIcons:[...element?.querySelectorAll?.('[class]')||[]].flatMap((child)=>["front","left","right","back"].filter((slot)=>child.classList.contains(`i-tripo:${slot}-view`))).slice(0,4),imageCount:element?.querySelectorAll?.('img')?.length||0,fileInputCount:element?.querySelectorAll?.('input[type="file"]')?.length||0});
    const nodes=[],nodeIds=new Map();
    const nodeId=(element)=>{if(!element)return null;if(nodeIds.has(element))return nodeIds.get(element);if(nodes.length>=48)return null;const id=nodes.length;nodeIds.set(element,id);nodes.push({id,...describe(element)});return id;};
    const ancestors=(element)=>{const result=[];for(let node=element?.parentElement,depth=0;node&&depth<4;node=node.parentElement,depth++){const id=nodeId(node);if(id===null)break;result.push(id);}return result;};
    const uploadControls=containers.slice(0,4).map((container)=>({node:nodeId(container),ancestors:ancestors(container)}));
    const uploadRegions=containers.map((container)=>{let region=container;for(let i=0;i<4&&region.parentElement;i++)region=region.parentElement;return region;});
    const images=[...new Set(uploadRegions.flatMap((region)=>[...region.querySelectorAll('img')]))].filter((img)=>visible(img)&&img.naturalWidth>256&&img.naturalHeight>256).slice(0,8).map((img)=>({node:nodeId(img),loaded:img.complete===true,width:img.naturalWidth,height:img.naturalHeight,ancestors:ancestors(img)}));
    const modeButtons=buttons.filter((button)=>/smart|mesh|malla|^HD |^Modelo HD/i.test(text(button))||[...button.querySelectorAll('[class]')].some((child)=>child.classList.contains('i-tripo:speed-bolt'))).slice(0,6).map((button)=>({...describe(button),text:text(button).slice(0,100),ariaPressed:button.getAttribute('aria-pressed'),dataState:button.getAttribute('data-state')}));
    const fileInputs=[...document.querySelectorAll('input[type="file"]')].slice(0,8).map((input)=>({node:nodeId(input),accept:(input.accept||'').slice(0,200),multiple:input.multiple===true,fileCount:input.files?.length||0,ancestors:ancestors(input)}));
    for(const [element,id] of [...nodeIds])nodes[id].children=[...element.children||[]].slice(0,10).map(nodeId).filter((value)=>value!==null);
    const uploadActions=[...new Set(uploadRegions.flatMap((region)=>[...region.querySelectorAll('button,[role="button"]')]))].slice(0,20).map((button)=>({...describe(button),visible:visible(button),disabled:button.disabled===true}));
    const safeControlText=(element)=>text(element).replace(/https?:\/\/\S+/g,'[link]').slice(0,400);
    const exportDialogs=[...document.querySelectorAll('[role="dialog"]')].filter(dialog=>{const box=dialog.getBoundingClientRect(),style=getComputedStyle(dialog);return box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&dialog.getAttribute('data-state')!=='closed';}).slice(0,5).map((dialog)=>({state:dialog.getAttribute('data-state'),modal:dialog.getAttribute('aria-modal'),shellOpacity:getComputedStyle(dialog).opacity,linkedTriggers:(dialog.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)).filter(Boolean).map(trigger=>({tag:trigger.tagName,state:trigger.getAttribute('data-state'),expanded:trigger.getAttribute('aria-expanded'),trace:trigger.getAttribute('data-trace'),icons:[...trigger.querySelectorAll('[class]')].flatMap(e=>String(e.getAttribute('class')||'').split(/\s+/).filter(c=>/^i-tripo:/.test(c))).slice(0,6)})),name:(dialog.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map((id)=>safeControlText(document.getElementById(id))).join(' ').slice(0,100),text:safeControlText(dialog),comboboxes:[...dialog.querySelectorAll('[role="combobox"]')].filter(visible).slice(0,6).map(safeControlText),buttons:[...dialog.querySelectorAll('button')].filter(visible).slice(0,10).map((button)=>({text:safeControlText(button),pressed:button.getAttribute('aria-pressed'),state:button.getAttribute('data-state'),disabled:button.disabled===true}))}));
    // Opt-in local diagnostic only. Report relevant visible control labels, never
    // input values, credentials, cookies, hidden state, or network traffic.
    const workflowControls=[...document.querySelectorAll('button,[role="button"],[role="tab"],[role="menuitem"],[role="combobox"]')].filter(visible).filter(el=>/\buv\b|import|upload|cargar|subir|textur|retop|smart|modelo 3d|3d model/i.test(text(el)||el.getAttribute('aria-label')||'')).slice(0,40).map(el=>({...describe(el),text:safeControlText(el).slice(0,140),ariaLabel:(el.getAttribute('aria-label')||'').slice(0,140),disabled:el.disabled===true||el.getAttribute('aria-disabled')==='true'}));
    const toolbarControls=[...document.querySelectorAll('button,[role="button"],[role="menuitem"]')].filter(visible).filter(el=>[...el.querySelectorAll('[class]')].some(c=>/i-tripo:/.test(c.className||''))).slice(0,100).map(el=>({...describe(el),text:safeControlText(el).slice(0,140),title:(el.getAttribute('title')||'').slice(0,140),ariaLabel:(el.getAttribute('aria-label')||'').slice(0,140),trace:(el.getAttribute('data-trace')||'').slice(0,180),disabled:el.disabled===true||el.getAttribute('aria-disabled')==='true'}));
    const visibleActions=[...document.querySelectorAll('button,[role="button"]')].filter(visible).slice(0,100).map(el=>({text:safeControlText(el).slice(0,140),ariaLabel:(el.getAttribute('aria-label')||'').slice(0,140),trace:el.getAttribute('data-trace'),disabled:el.disabled===true,classes:classes(el)}));
    const orientationControls=[...document.querySelectorAll('input[type="number"],input[type="range"]')].filter(visible).slice(0,24).map(el=>({type:el.type,label:(el.getAttribute('aria-label')||el.parentElement?.innerText||'').slice(0,120),value:el.value,min:el.min,max:el.max}));
    // Some import previews use a custom overlay instead of role=dialog.
    // Ground this diagnostic in the title reported by the artist; no controls are clicked.
    const angleTitle=value=>/encuentra el mejor [áa]ngulo|find (?:the|your) best angle/i.test(value);
    const angleLabels=[...document.querySelectorAll('h1,h2,h3,h4,p,span,div')].filter(el=>visible(el)&&angleTitle(text(el))&&![...el.children].some(c=>angleTitle(text(c)))).slice(0,3);
    const orientationPanels=angleLabels.map(el=>{const ancestors=[];for(let scope=el,depth=0;scope&&scope!==document.body&&depth<6;scope=scope.parentElement,depth++){ancestors.push({...describe(scope),text:safeControlText(scope).slice(0,400),controls:[...scope.querySelectorAll('button,[role="button"],input,[tabindex],[data-trace]')].filter(visible).slice(0,20).map(c=>({...describe(c),text:safeControlText(c).slice(0,100),trace:c.getAttribute('data-trace'),type:c.getAttribute('type'),disabled:c.disabled===true}))});}return {title:text(el),ancestors};});
    const embeddedFrames=[...document.querySelectorAll('iframe')].filter(visible).map(frame=>{try{const u=new URL(frame.src,location.href);return {origin:u.origin,path:u.pathname,title:frame.title};}catch{return {title:frame.title};}});
    // Numeric settings diagnostics are scoped to the 1/2/4 generation control
    // and paired 500..25000 sliders. Never collect arbitrary input contents.
    const topologyElement=el=>{
      const box=el.getBoundingClientRect(),style=getComputedStyle(el);
      return {tag:el.tagName,role:el.getAttribute('role'),type:el.getAttribute('type'),hasPopup:el.getAttribute('aria-haspopup'),expanded:el.getAttribute('aria-expanded'),state:el.getAttribute('data-state'),controls:el.getAttribute('aria-controls'),labelledBy:el.getAttribute('aria-labelledby'),classes:classes(el),visible:visible(el),box:{width:box.width,height:box.height},style:{display:style.display,visibility:style.visibility,opacity:style.opacity,pointerEvents:style.pointerEvents}};
    };
    const quantityGroups=[...document.querySelectorAll('[role="group"]')].filter(group=>['1','2','4'].every(value=>group.querySelector(`button[value="${value}"][aria-pressed]`))).slice(0,3);
    const topologyTriggers=quantityGroups.map(group=>{
      const ancestors=[];
      for(let scope=group.parentElement,depth=0;scope&&scope!==document.body&&depth<3;scope=scope.parentElement,depth++)ancestors.push({...topologyElement(scope),controls:[...scope.querySelectorAll('button,[aria-haspopup]')].slice(0,20).map(el=>({...topologyElement(el),icons:describe(el).icons}))});
      return {ancestors};
    });
    const topologySliders=[...document.querySelectorAll('[role="slider"]')].filter(el=>el.getAttribute('aria-valuemin')==='500'&&el.getAttribute('aria-valuemax')==='25000').slice(0,8).map(el=>{
      let scope=el.parentElement;
      for(let depth=0;scope&&scope!==document.body&&depth<4;scope=scope.parentElement,depth++){
        const fields=[...scope.querySelectorAll('input[type="text"],input[type="number"]')];
        if(fields.length===1){const field=fields[0],value=Number(field.value);return {...topologyElement(el),value:el.getAttribute('aria-valuenow'),field:{...topologyElement(field),value:Number.isInteger(value)&&value>=500&&value<=25000?value:null,focused:document.activeElement===field}};}
      }
      return {...topologyElement(el),value:el.getAttribute('aria-valuenow')};
    });
    const topologyTrace=Array.isArray(globalThis.__localWorkbenchTopologyTrace)?globalThis.__localWorkbenchTopologyTrace.slice(-16):[];
    layoutDiagnostic={notificationTrace:globalThis.__fitaNotificationTrace||[],version:6,focus:'upload-controls-and-imported-mesh-workflow',nodes,images,modeButtons,fileInputs,uploadControls,uploadActions,exportDialogs,workflowControls,toolbarControls,visibleActions,orientationControls,orientationPanels,embeddedFrames,topology:{triggers:topologyTriggers,sliders:topologySliders,trace:topologyTrace}};
  }
  // Task-history changes do not affect a paid confirmation, but reference fingerprints and options do.
  const {existingTaskIds:ignored,taskCards:ignoredCards,...confirmationSnapshot}=snapshot;
  confirmationSnapshot.slots=Object.fromEntries(Object.entries(slots).map(([slot,{diagnostic,...value}])=>[slot,value]));
  return { ...snapshot,...(layoutDiagnostic?{layoutDiagnostic}:{}), pageSignature:await digest(JSON.stringify(confirmationSnapshot)) };
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

export function selectStudioSmartMesh() {
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=="https://studio.tripo3d.ai")throw new Error("STUDIO_ORIGIN_CHANGED");
  const matches=[...document.querySelectorAll("button")].filter((button)=>{
    const box=button.getBoundingClientRect(),style=getComputedStyle(button);
    // The P1.0 model select also carries this icon; it is a combobox, not the switch.
    return box.width>0&&box.height>0&&style.visibility!=="hidden"&&style.display!=="none"&&!button.getAttribute('role')&&[button,...button.querySelectorAll('[class]')].some(child=>child.classList.contains('i-tripo:speed-bolt'));
  });
  if(matches.length!==1||matches[0].disabled)throw new Error("SMART_MESH_CONTROL_NOT_VERIFIED");
  if(!matches[0].classList.contains("c-black"))matches[0].click();
  return {selected:true};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

export function selectStudioFourResults() {
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=="https://studio.tripo3d.ai")throw new Error("STUDIO_ORIGIN_CHANGED");
  const groups=[...document.querySelectorAll('[role="group"]')].filter((group)=>{const box=group.getBoundingClientRect();return box.width>0&&box.height>0&&["1","2","4"].every((value)=>group.querySelector(`button[value="${value}"][aria-pressed]`));});
  const matches=groups.length===1?[...groups[0].querySelectorAll('button[value="4"][aria-pressed]')]:[];
  const button=matches[0],box=button?.getBoundingClientRect();
  if(matches.length!==1||button.disabled||!box?.width||!box?.height||getComputedStyle(button).visibility==="hidden")throw new Error("GENERATION_COUNT_CONTROL_NOT_VERIFIED");
  if(button.getAttribute("aria-pressed")!=="true")button.click();
  return {selected:true};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

// Only visible generation controls are used. Each call makes at most one change
// so the caller can wait for React to acknowledge it before reading again.
export async function studioTopologyControl({step='inspect',faceLimits,configurationId='local'}={}){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=='https://studio.tripo3d.ai'||!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/generate(?:\/|$)/.test(location.pathname))throw Error('GENERATION_WORKSPACE_REQUIRED');
  const visible=e=>{const box=e.getBoundingClientRect(),style=getComputedStyle(e);return box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0';};
  const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
  const inputSelector='input[type="text"],input[type="number"]';
  const evidence=(result,action)=>{
    const previous=Array.isArray(globalThis.__localWorkbenchTopologyTrace)?globalThis.__localWorkbenchTopologyTrace:[];
    globalThis.__localWorkbenchTopologyTrace=[...previous,{at:Date.now(),step,action,...result}].slice(-16);
    return result;
  };
  // Animation-shell opacity is not evidence that a mounted dialog is closed.
  // Its native children can already be active while the shell is entering.
  // fita-hint-v1: Studio's informational popovers (viewer help, "retry or go to
  // Texture" tip). Language independent; never a form, price or traced action.
  const studioHint=d=>{const q=s=>d.querySelector?.(s),has=n=>!!q('[class~="'+n+'"]');return !q('input,textarea,select,[role="slider"],[role="switch"],[role="combobox"],[data-price],[data-cost],[data-trace]')&&has('i-tripo:close')&&(d.querySelectorAll?.('button')||[]).length<=2&&(has('i-tripo:retry')&&has('i-tripo:texture')||!!q('.cursor-move')&&!!q('.cancel-drag'));};
  const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(e=>{const box=e.getBoundingClientRect(),style=getComputedStyle(e);return box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&e.getAttribute('data-state')!=='closed'&&!studioHint(e);});
  // Quad and Triangle are identified by their native icons in any language,
  // with the EN/ES labels as a fallback. Quad allows 500-25000 faces per
  // model and Triangle 500-50000 (observed 2026-10-21).
  const modeButton=(scope,name,label)=>[...scope.querySelectorAll('button')].filter(e=>visible(e)&&(!!e.querySelector?.('[class~="i-tripo:'+name+'"]')||label.test(text(e))));
  const quadLabel=/^(?:Quad|Cuadril[aá]tero)(?:\s+(?:New|Nuevo))?$/,triangleLabel=/^(?:Triangle|Tri[aá]ngulo)$/;
  // The popover trigger/content relationship and slider bounds identify this
  // control in any interface language. Never accept a dialog by title alone.
  const panels=dialogs.filter(panel=>{
    const trigger=document.getElementById(panel.getAttribute('aria-labelledby'));
    const sliders=[...panel.querySelectorAll('[role="slider"]')].filter(visible);
    const fields=[...panel.querySelectorAll(inputSelector)].filter(visible);
    const linked=trigger?.getAttribute('type')==='button'&&trigger.getAttribute('aria-haspopup')==='dialog'&&trigger.getAttribute('aria-controls')===panel.id;
    const nativeModal=modeButton(panel,'quad',quadLabel).length===1&&modeButton(panel,'triangle',triangleLabel).length===1;
    return (linked||nativeModal)&&[1,2,4].includes(fields.length)&&sliders.length===fields.length&&sliders.every(e=>e.getAttribute('aria-valuemin')==='500'&&['25000','50000'].includes(e.getAttribute('aria-valuemax')))&&panel.querySelectorAll('[role="switch"]').length<=1;
  });
  if(panels.length>1)throw Error('STUDIO_TOPOLOGY_CONTROL_NOT_VERIFIED');
  const panel=panels[0];
  if(panel&&dialogs.some(dialog=>dialog!==panel))throw new Error('CLOSE_OTHER_DIALOGS_FIRST');
  if(!panel){
    if(step==='inspect')return evidence({open:false,faceLimits:null},'closed');
    if(dialogs.length)throw Error('CLOSE_OTHER_DIALOGS_FIRST');
    // The dedicated native button beside the 1/2/4 controls opens the same
    // popover. Clicking its DIV anchor can leave the popover closed.
    const quantityGroups=[...document.querySelectorAll('[role="group"]')].filter(group=>visible(group)&&['1','2','4'].every(value=>group.querySelector(`button[value="${value}"][aria-pressed]`)));
    if(quantityGroups.length>1)throw Error('STUDIO_TOPOLOGY_CONTROL_NOT_VERIFIED');
    let controls=[];
    for(let scope=quantityGroups[0]?.parentElement,depth=0;scope&&scope!==document.body&&depth<3;scope=scope.parentElement,depth++){
      controls=[...scope.children].filter(element=>element.tagName==='BUTTON'&&element.getAttribute('type')==='button'&&!element.hasAttribute('role')&&!element.hasAttribute('aria-pressed')&&visible(element)&&[...element.querySelectorAll('[class]')].some(child=>child.classList.contains('i-tripo:angle')));
      if(controls.length)break;
    }
    // One generation hides that button; its General Settings row opens the
    // same popover.
    if(!controls.length)controls=[...document.querySelectorAll('[type="button"][aria-haspopup="dialog"]')].filter(e=>visible(e)&&/^(?:Topology|Topolog[ií]a|トポロジー)$/.test(text(e)));
    if(controls.length!==1||controls[0].disabled||controls[0].getAttribute('aria-disabled')==='true')throw Error('STUDIO_TOPOLOGY_CONTROL_NOT_VERIFIED');
    controls[0].click();return evidence({open:false,pending:true,faceLimits:null},'open-native-button');
  }
  const quads=modeButton(panel,'quad',quadLabel),triangles=modeButton(panel,'triangle',triangleLabel);
  // A Topology popover without a recognizable Quad/Triangle choice is never
  // accepted as Quad.
  {
    if(quads.length!==1||triangles.length!==1)throw Error('STUDIO_TOPOLOGY_CONTROL_NOT_VERIFIED');
    const selected=e=>e.getAttribute('aria-pressed')==='true'||e.getAttribute('data-state')==='on';
    const unselected=e=>e.getAttribute('aria-pressed')==='false'||e.getAttribute('data-state')==='off';
    if(!selected(quads[0])||!unselected(triangles[0])){
      if(step!=='configure')return evidence({open:true,pending:true,faceLimits:null,topology:selected(triangles[0])?'triangle':'unknown'},'quad-not-verified');
      if(!selected(triangles[0])||!unselected(quads[0])||quads[0].disabled||quads[0].getAttribute('aria-disabled')==='true')throw Error('STUDIO_TOPOLOGY_CONTROL_NOT_VERIFIED');
      quads[0].click();return evidence({open:true,pending:true,faceLimits:null},'select-quad');
    }
  }
  const switches=[...panel.querySelectorAll('[role="switch"]')].filter(visible);
  if(switches.length===1&&switches[0].getAttribute('aria-checked')==='true'){
    if(step==='configure'){switches[0].click();return evidence({open:true,pending:true,faceLimits:null},'independent-counts');}
    return evidence({open:true,shared:true,faceLimits:null},'shared');
  }
  const inputs=[...panel.querySelectorAll(inputSelector)].filter(visible);
  if(inputs.length!==4)throw Error('STUDIO_FOUR_POLYGON_CONTROLS_REQUIRED');
  const rows=inputs.map(input=>{
    for(let row=input.parentElement;row&&row!==panel;row=row.parentElement){
      if(row.querySelectorAll(inputSelector).length!==1)break;
      const labels=[...row.querySelectorAll('p,label,legend,[role="heading"]')].map(e=>text(e).match(/(?:^|\D)0?([1-4])\s*$/)?.[1]).filter(Boolean);
      const slider=[...row.querySelectorAll('[role="slider"]')].filter(visible);
      if(labels.length===1&&slider.length===1)return {input,index:Number(labels[0]),slider:slider[0]};
    }
    return null;
  });
  if(rows.some(r=>!r)||new Set(rows.map(r=>r.index)).size!==4)throw Error('STUDIO_POLYGON_ORDER_NOT_VERIFIED');
  rows.sort((a,b)=>a.index-b.index);
  const edits=globalThis.__localWorkbenchTopologyEdits ||= new WeakMap();
  const observed=rows.map(({input})=>Number(input.value));
  const committed=rows.every(({input,slider})=>Number(input.value)===Number(slider.getAttribute('aria-valuenow')));
  if(step!=='configure')return evidence({open:true,faceLimits:committed?observed:null,pending:!committed},'read-back');
  if(!Array.isArray(faceLimits)||faceLimits.length!==4||faceLimits.some(n=>!Number.isInteger(n)||n<500||n>25000))throw Error('STUDIO_INVALID_POLYGON_LIMITS');
  for(let i=0;i<4;i++)if(observed[i]!==faceLimits[i]||Number(rows[i].slider.getAttribute('aria-valuenow'))!==faceLimits[i]){
    const {input,slider}=rows[i],min=Number(slider.getAttribute('aria-valuemin')),max=Number(slider.getAttribute('aria-valuemax')),stride=input.step===''||input.step==='any'?null:Number(input.step);
    if(input.disabled||input.readOnly||faceLimits[i]<min||faceLimits[i]>max||(stride>0&&(faceLimits[i]-min)%stride!==0))throw Error('STUDIO_POLYGON_VALUE_UNSUPPORTED');
    const now=Number(slider.getAttribute('aria-valuenow')),previous=edits.get(input);
    if(!Number.isInteger(now)||now<min||now>max)throw Error('STUDIO_TOPOLOGY_CONTROL_NOT_VERIFIED');
    if(previous?.configurationId===configurationId&&previous.target===faceLimits[i]&&now!==faceLimits[i]){
      // A field whose displayed value changed but whose paired slider did not
      // commit must not be written repeatedly. Use the native accessible
      // slider, learn its real increment, and observe every key's effect.
      if(slider.getAttribute('aria-disabled')==='true'||slider.getAttribute('tabindex')!=='0'||typeof slider.focus!=='function')throw Error('STUDIO_TOPOLOGY_CONTROL_NOT_VERIFIED');
      slider.focus();
      const started=Date.now(),values=()=>rows.map(row=>Number(row.input.value));
      // Yield to the DOM event loop between acknowledged keys. MessageChannel
      // works without relying on animation frames or background-tab timers.
      const channel=new MessageChannel();
      let resume;
      channel.port1.onmessage=()=>resume?.();
      const yieldDOM=()=>globalThis.scheduler?.postTask?globalThis.scheduler.postTask(()=>{},{priority:'background'}):new Promise(resolve=>{resume=resolve;channel.port2.postMessage(null);});
      try{
        for(let batch=0;batch<128&&Date.now()-started<1000;batch++){
          if(location.origin!=='https://studio.tripo3d.ai'||!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/generate(?:\/|$)/.test(location.pathname))throw Error('GENERATION_WORKSPACE_REQUIRED');
          if(input.isConnected===false||slider.isConnected===false||panel.getAttribute('data-state')==='closed'||!visible(input)||!visible(slider))return evidence({open:true,pending:true,faceLimits:values()},'control-remounted');
          if([...document.querySelectorAll('[role="dialog"]')].some(dialog=>{const box=dialog.getBoundingClientRect(),style=getComputedStyle(dialog);return dialog!==panel&&dialog.getAttribute('data-state')!=='closed'&&box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&!studioHint(dialog);}))throw Error('CLOSE_OTHER_DIALOGS_FIRST');
          const current=Number(slider.getAttribute('aria-valuenow')),edit=edits.get(input);
          if(!Number.isInteger(current)||current<min||current>max)throw Error('STUDIO_TOPOLOGY_CONTROL_NOT_VERIFIED');
          if(current===faceLimits[i])return evidence({open:true,pending:true,faceLimits:values(),changingIndex:i},'keyboard-target-reached');
          if(edit.method==='keyboard'){
            if(current===edit.before){
              // Never send another key until the previous effect is visible.
              if(batch===0&&++edit.waits>=3){evidence({open:true,pending:true,faceLimits:values(),changingIndex:i},'slider-not-acknowledged');throw Error('STUDIO_POLYGON_SETTINGS_NOT_VERIFIED');}
              return evidence({open:true,pending:true,faceLimits:values(),changingIndex:i},'await-slider-ack');
            }
            if(edit.key.startsWith('Arrow'))edit.increment=Math.abs(current-edit.before);
          }
          const difference=faceLimits[i]-current,increment=edit.increment;
          if(increment&&Math.abs(difference)%increment!==0)throw Error('STUDIO_POLYGON_VALUE_UNSUPPORTED');
          let key;
          const anchor=faceLimits[i]>(min+max)/2?max:min;
          if(edit.method==='field'&&Math.abs(anchor-faceLimits[i])<Math.abs(difference))key=anchor===max?'End':'Home';
          else if(increment&&Math.abs(difference)>=10*increment)key=difference>0?'PageUp':'PageDown';
          else key=difference>0?'ArrowRight':'ArrowLeft';
          edits.set(input,{configurationId,target:faceLimits[i],method:'keyboard',before:current,key,increment,waits:0});
          slider.dispatchEvent(new KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true}));
          slider.dispatchEvent(new KeyboardEvent('keyup',{key,code:key,bubbles:true,cancelable:true}));
          evidence({open:true,pending:true,faceLimits:values(),changingIndex:i,key,before:current},'keyboard-count');
          await yieldDOM();
        }
        return evidence({open:true,pending:true,faceLimits:values(),changingIndex:i},'keyboard-batch');
      }finally{channel.port1.close();channel.port2.close();}
    }
    // Native focus/blur also emits focusout, used by delegated form handlers.
    // A synthetic non-bubbling blur does not commit those controls.
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(faceLimits[i]));
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();
    edits.set(input,{configurationId,target:faceLimits[i],method:'field',before:now});
    return evidence({open:true,pending:true,faceLimits:observed,sliderValues:rows.map(row=>Number(row.slider.getAttribute('aria-valuenow'))),changingIndex:i},'write-count');
  }
  return evidence({open:true,faceLimits:observed},'verified');
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

// Smart Mesh's AI model select (P2.0 / P1.0). Observed 2026-10-21: an option
// commits on Enter (a synthetic click does not). In a background tab Tripo's
// close animation never ends, so the list can stay mounted with
// data-state="closed" and no longer reopen on pointerdown; its options still
// accept Enter, and the keyboard (ArrowDown on the trigger) still opens it.
// Free setting; only the option named P2.0 is ever chosen.
export async function selectStudioModelVersion({version='P2.0'}={}) {
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=="https://studio.tripo3d.ai")throw new Error("STUDIO_ORIGIN_CHANGED");
  if(version!=='P2.0')throw new Error('SMART_MESH_REQUIRED');
  const visible=e=>{const box=e.getBoundingClientRect(),style=getComputedStyle(e);return box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden';};
  const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
  const wanted=value=>/^P2\.0(?:\s|$)/.test(value);
  const boxes=[...document.querySelectorAll('[role="combobox"]')].filter(e=>visible(e)&&/^P\d/.test(text(e)));
  if(boxes.length!==1||boxes[0].disabled||boxes[0].getAttribute('aria-disabled')==='true')throw new Error('SMART_MESH_REQUIRED');
  if(wanted(text(boxes[0])))return {selected:true};
  // Mounted model options in any state: a list whose every option is a P-model.
  const options=()=>[...document.querySelectorAll('[role="listbox"]')].filter(list=>{const items=[...list.querySelectorAll('[role="option"]')];return items.length>1&&items.every(item=>/^P\d/.test(text(item)));}).flatMap(list=>[...list.querySelectorAll('[role="option"]')]);
  const until=Date.now()+2000;
  if(!options().length){
    boxes[0].focus();
    boxes[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',bubbles:true,cancelable:true}));
    while(!options().length&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(!options().length){
    boxes[0].dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse',isPrimary:true}));
    while(!options().length&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));
  }
  const matches=options().filter(e=>wanted(text(e)));
  // Not an error yet: the caller re-reads the label and retries a bounded number of times.
  if(matches.length!==1||matches[0].getAttribute('aria-disabled')==='true'||matches[0].hasAttribute('data-disabled'))return {selected:false,modelOptions:options().length,modelMatches:matches.length};
  matches[0].focus();
  matches[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
  return {selected:true,pending:true};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

export function selectStudioMultiview() {
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if (location.origin !== "https://studio.tripo3d.ai") throw new Error("STUDIO_ORIGIN_CHANGED");
  const matches=[...document.querySelectorAll("button")].filter((button)=>[...button.querySelectorAll("[class]")].some((child)=>child.classList.contains("i-tripo:multi-view")));
  if(matches.length!==1 || matches[0].disabled)throw new Error("MULTIVIEW_CONTROL_NOT_VERIFIED");
  matches[0].click();
  return {selected:true};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

// Texture controls inspected in the authenticated texture workspace. Changes are
// confined to this form; the paid Generate control is handled separately.
export function selectStudioTextureSettings({resolution,removeLighting}) {
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=='https://studio.tripo3d.ai'||!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/texture\//.test(location.pathname))throw new Error('TEXTURE_WORKSPACE_REQUIRED');
  const visible=e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&getComputedStyle(e).visibility!=='hidden';};
  const text=e=>(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();
  const buttons=[...document.querySelectorAll('button')].filter(visible);
  const mode=buttons.filter(b=>[...b.querySelectorAll('[class]')].some(e=>e.classList.contains('i-tripo:geometry')));
  // After an in-page switch the URL changes before the Texture panel mounts:
  // report "not yet" so the caller re-reads instead of failing the step.
  if(!mode.length)return {pending:true};
  if(mode.length!==1||mode[0].disabled)throw new Error('TEXTURE_MULTIVIEW_NOT_VERIFIED');
  if(!mode[0].classList.contains('c-black')){mode[0].click();return {modeChanged:true};}
  const size=buttons.filter(b=>text(b)===resolution&&b.hasAttribute('aria-pressed'));
  const lighting=buttons.filter(b=>b.getAttribute('role')==='switch'&&/Remove Lighting|Eliminar iluminación|Quitar iluminación/i.test(text(b.parentElement)));
  if(!['2K','4K','8K'].includes(resolution)||typeof removeLighting!=='boolean')throw new Error('TEXTURE_SETTINGS_NOT_VERIFIED');
  if(!size.length||!lighting.length)return {pending:true};
  if(size.length!==1||lighting.length!==1||size[0].disabled||lighting[0].disabled)throw new Error('TEXTURE_SETTINGS_NOT_VERIFIED');
  if(size[0].getAttribute('aria-pressed')!=='true')size[0].click();
  if((lighting[0].getAttribute('aria-checked')==='true')!==removeLighting)lighting[0].click();
  return {settingsChanged:true};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

export async function uploadStudioView(inputData) {
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=="https://studio.tripo3d.ai")throw new Error("STUDIO_ORIGIN_CHANGED");
  if(!["front","left","right","back"].includes(inputData.slot))throw new Error("UNSUPPORTED_SLOT");
  const matches=[...document.querySelectorAll('[data-trace="studio.workspace_'+(location.pathname.includes('/texture/')?'texture':'generate')+'.upload_image_button"]')].filter((container)=>[...container.querySelectorAll("[class]")].some((child)=>child.classList.contains(`i-tripo:${inputData.slot}-view`)));
  if(matches.length!==1)throw new Error("UPLOAD_CONTROL_NOT_VERIFIED");
  const container=matches[0], input=container.querySelector('input[type="file"]');
  if(!input || input.disabled || input.files?.length || container.querySelector("img"))throw new Error("UPLOAD_SLOT_NOT_EMPTY");
  if(!["image/png","image/jpeg","image/webp"].includes(inputData.mimeType))throw new Error("UNSUPPORTED_IMAGE_FORMAT");
  const decoded=atob(inputData.dataBase64), bytes=Uint8Array.from(decoded,(char)=>char.charCodeAt(0));
  if(!/^[0-9a-f-]{36}$/i.test(inputData.operationId||'')||!/^[0-9a-f]{64}$/i.test(inputData.sha256||''))throw new Error('UPLOAD_PROVENANCE_REQUIRED');
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
  if(sha256!==inputData.sha256.toLowerCase())throw new Error('APPROVED_IMAGE_HASH_MISMATCH');
  const grid=container.closest('div.rounded-3.flex.flex-wrap.w-full.aspect-square.relative');
  if(!grid)throw new Error('UPLOAD_PROVENANCE_CARD_NOT_VERIFIED');
  let card=container;while(card.parentElement&&card.parentElement!==grid)card=card.parentElement;
  const classes={front:['w-full','h-33.5','rounded-t-3'],left:['w-1/3','aspect-square','rounded-bl-3'],right:['w-1/3','aspect-square','border-r-none'],back:['w-1/3','aspect-square','rounded-br-3']}[inputData.slot];
  if(card.parentElement!==grid||!classes.every((name)=>card.classList.contains(name))||(inputData.slot==='right'&&(card.classList.contains('rounded-bl-3')||card.classList.contains('rounded-br-3')))||card.querySelector('img'))throw new Error('UPLOAD_PROVENANCE_CARD_NOT_EMPTY');
  const file=new File([bytes],inputData.name,{type:inputData.mimeType,lastModified:0});
  const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
  const assigned=input.files?.[0];
  if(!assigned||input.files.length!==1||assigned.size!==bytes.length||assigned.type!==inputData.mimeType)throw new Error('NATIVE_FILE_ASSIGNMENT_FAILED');
  const assignedSha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await assigned.arrayBuffer()))].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
  if(assignedSha!==sha256||input.files?.length!==1||input.files[0]!==assigned||!input.isConnected||!card.isConnected)throw new Error('NATIVE_FILE_ASSIGNMENT_MISMATCH');
  const receipts=globalThis.__localWorkbenchStudioUploadReceiptsV3 ||= new Map();
  receipts.set(inputData.slot,{card,input,operationId:inputData.operationId,originalSha256:sha256,originalSize:bytes.length,mimeType:inputData.mimeType,width:inputData.width,height:inputData.height,receipt:null,invalidated:false});
  if(!globalThis.__localWorkbenchStudioReceiptChangeListenerV3){
    for(const eventType of ['change','drop','paste'])document.addEventListener(eventType,(event)=>{if(event.isTrusted)for(const receipt of receipts.values())if(event.target===receipt.input||receipt.card.contains(event.target))receipt.invalidated=true;},true);
    globalThis.__localWorkbenchStudioReceiptChangeListenerV3=true;
  }
  input.dispatchEvent(new Event("change",{bubbles:true}));
  return {slot:inputData.slot,dispatched:true,originalSha256:sha256};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

export function clearStudioView(slot) {
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=="https://studio.tripo3d.ai"||!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/(?:generate|texture)(?:\/|$)/.test(location.pathname)||!["front","left","right","back"].includes(slot))throw new Error("REPLACEMENT_SCOPE_NOT_VERIFIED");
  const grids=[...document.querySelectorAll('div.rounded-3.flex.flex-wrap.w-full.aspect-square.relative')].filter((element)=>{const box=element.getBoundingClientRect();return box.width>0&&box.height>0;});
  if(grids.length!==1)throw new Error("MULTIVIEW_REPLACEMENT_NOT_VERIFIED");
  const children=[...grids[0].children],has=(node,...names)=>names.every((name)=>node.classList.contains(name));
  const candidates={front:children.filter((node)=>has(node,'w-full','h-33.5','rounded-t-3')),left:children.filter((node)=>has(node,'w-1/3','aspect-square','rounded-bl-3')),right:children.filter((node)=>has(node,'w-1/3','aspect-square','border-r-none')&&!has(node,'rounded-bl-3')&&!has(node,'rounded-br-3')),back:children.filter((node)=>has(node,'w-1/3','aspect-square','rounded-br-3'))};
  if(!Object.values(candidates).every((matches)=>matches.length===1)||new Set(Object.values(candidates).map((matches)=>matches[0])).size!==4)throw new Error("MULTIVIEW_REPLACEMENT_NOT_VERIFIED");
  const card=candidates[slot][0];
  if([...card.querySelectorAll('[class]')].some((child)=>['front','left','right','back'].some((other)=>other!==slot&&child.classList.contains(`i-tripo:${other}-view`))))throw new Error("REPLACEMENT_SLOT_IDENTITY_CHANGED");
  const images=[...card.querySelectorAll('img.size-full.object-contain')],buttons=[...card.querySelectorAll('button')].filter((button)=>[...button.querySelectorAll('[class]')].some((child)=>child.classList.contains('i-tripo:delete')));
  if(images.length!==1||buttons.length!==1||buttons[0].disabled)throw new Error("REPLACEMENT_DELETE_CONTROL_NOT_VERIFIED");
  const box=buttons[0].getBoundingClientRect(),style=getComputedStyle(buttons[0]);
  if(!box.width||!box.height||style.display==='none'||style.visibility==='hidden')throw new Error("REPLACEMENT_DELETE_CONTROL_NOT_VISIBLE");
  globalThis.__localWorkbenchStudioUploadReceiptsV3?.delete(slot);
  buttons[0].click();return {slot,clearClicked:true};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

export function clickStudioGenerate(expectedLabel) {
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  if(location.origin!=="https://studio.tripo3d.ai")throw new Error("STUDIO_ORIGIN_CHANGED");
  if(!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/(?:generate|texture)(?:\/|$)/.test(location.pathname))throw new Error('GENERATION_WORKSPACE_REQUIRED');
  const text=(element)=>(element.innerText||element.textContent||"").replace(/\s+/g," ").trim();
  const matches=[...document.querySelectorAll("button")].filter((button)=>text(button)===expectedLabel);
  if(matches.length!==1 || matches[0].disabled || matches[0].getAttribute("aria-disabled")==="true")throw new Error("GENERATE_CONTROL_CHANGED");
  // This function is called only after a fresh identical snapshot and a consumed explicit-confirmation command.
  matches[0].click();
  return {clicked:true};
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

export function resolveConfirmedStudioTask(taskId,workflow='generate') {
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  try{
  if(location.origin!=="https://studio.tripo3d.ai"||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(taskId||""))throw new Error("CONFIRMED_TASK_NOT_VERIFIED");
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  if([...document.querySelectorAll('[data-trace]')].some(e=>visible(e)&&/\.asset_save_button$/.test(e.getAttribute('data-trace')||'')))throw Error('STUDIO_UNSAVED_CHANGES');
  const matches=[...new Set([...document.querySelectorAll('a[href]')].flatMap((link)=>{
    try{
      const url=new URL(link.href,location.origin);
      const observedId=url.pathname.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i)?.[1];
      const route=workflow==='smart-uv'?/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/smart-uv\/[0-9a-f-]{36}\/?$/i:new RegExp('^/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?/)?workspace/'+workflow+'/');
      return url.origin===location.origin&&['generate','texture','smart-uv','rigging'].includes(workflow)&&route.test(url.pathname)&&observedId?.toLowerCase()===taskId.toLowerCase()&&!url.search&&!url.hash?[url.href]:[];
    }catch{return [];}
  }))];
  if(matches.length!==1)throw new Error("CONFIRMED_TASK_LINK_NOT_OBSERVED");
  return {url:matches[0]};
  }catch(error){return {adapterError:error.message||'CONFIRMED_TASK_LINK_NOT_OBSERVED'};}
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

export async function exportStudioControl({step,taskId,format='GLB'}) {
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  try {
  if(!['GLB','FBX'].includes(format))throw Error('EXPORT_FORMAT_UNSUPPORTED');
  if(location.origin!=="https://studio.tripo3d.ai"||!location.pathname.endsWith(taskId))throw new Error("CONFIRMED_TASK_CHANGED");
  const visible=(element)=>{const box=element.getBoundingClientRect(),style=getComputedStyle(element);return box.width>0&&box.height>0&&style.display!=="none"&&style.visibility!=="hidden";};
  const text=(element)=>(element?.innerText||element?.textContent||"").replace(/\s+/g," ").trim();
  const exact=(root,selector,label)=>[...root.querySelectorAll(selector)].filter((element)=>visible(element)&&(Array.isArray(label)?label.includes(text(element)):text(element)===label));
  const clickUnique=(elements)=>{if(elements.length!==1||elements[0].disabled)throw new Error("EXPORT_CONTROL_NOT_VERIFIED");elements[0].click();};
  const waitFor=async(check,error)=>{const deadline=Date.now()+5000;for(let attempt=0;attempt<50;attempt++){const value=check();if(value)return value;if(Date.now()>=deadline)break;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(error);};
  const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(dialog=>dialog.getAttribute('data-state')!=='closed'&&visible(dialog));
  const formatsIn=(dialog)=>[...dialog.querySelectorAll('[role="combobox"]')].filter((element)=>visible(element)&&/^(USD|FBX|OBJ|STL|GLB|3MF)$/.test(text(element)));
  const namedExport=(dialog)=>{
    const name=(dialog.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map((id)=>text(document.getElementById(id))).join(' ').trim();
    return /^(Exportar|Export)$/.test(name)&&formatsIn(dialog).length===1&&exact(dialog,'button',['Exportar','Export']).length===1;
  };
  const textureNotice=(dialog)=>text(dialog)==='Retry for better results or proceed to Texture'&&dialog.querySelectorAll('[role="combobox"],input').length===0&&[...dialog.querySelectorAll('button')].length===1&&text(dialog.querySelector('button'))==='';
  const topologyPanel=dialog=>{
    const trigger=document.getElementById(dialog.getAttribute('aria-labelledby'));
    const inputs=[...dialog.querySelectorAll('input[type="text"],input[type="number"]')].filter(visible),sliders=[...dialog.querySelectorAll('[role="slider"]')].filter(visible);
    const modes=[...dialog.querySelectorAll('button')].filter(visible).map(text);
    const linked=trigger?.getAttribute('type')==='button'&&trigger.getAttribute('aria-haspopup')==='dialog'&&trigger.getAttribute('aria-controls')===dialog.id;
    const nativeModal=modes.filter(value=>/^Quad(?:\s+New)?$/.test(value)).length===1&&modes.filter(value=>value==='Triangle').length===1;
    return (linked||nativeModal)&&[1,4].includes(inputs.length)&&inputs.length===sliders.length&&sliders.every(slider=>slider.getAttribute('aria-valuemin')==='500'&&slider.getAttribute('aria-valuemax')==='25000')&&dialog.querySelectorAll('[role="switch"]').length===1;
  };
  const exportDialogs=dialogs.filter(namedExport);
  const topologyDialogs=dialogs.filter(topologyPanel);
  if(exportDialogs.length>1)throw new Error('EXPORT_DIALOG_AMBIGUOUS');
  if(topologyDialogs.length>1||dialogs.some((dialog)=>!exportDialogs.includes(dialog)&&!textureNotice(dialog)&&!topologyDialogs.includes(dialog)))throw new Error('CLOSE_OTHER_DIALOGS_FIRST');
  if(step==='inspect')return {stage:'inspected',exportDialogOpen:exportDialogs.length===1,knownTextureNotice:dialogs.some(textureNotice),topologyDialogOpen:topologyDialogs.length===1};
  if(topologyDialogs.length){
    if(!['open','close'].includes(step))throw new Error('CLOSE_OTHER_DIALOGS_FIRST');
    const panel=topologyDialogs[0];
    const close=[...panel.querySelectorAll('button')].filter(button=>visible(button)&&button.getAttribute('aria-disabled')!=='true'&&[...button.querySelectorAll('[class]')].some(child=>child.classList.contains('i-tripo:close')));
    clickUnique(close);
    await waitFor(()=>!panel.isConnected||!visible(panel)||panel.getAttribute('data-state')==='closed','TOPOLOGY_DIALOG_CLOSE_NOT_ACKNOWLEDGED');
  }
  if(step==='close'){
    if(!exportDialogs.length)return {stage:'closed'};
    const dialog=exportDialogs[0];
    // Only the positively identified Export dialog may be dismissed. Never click
    // unknown confirmation, payment, deletion or generation dialogs.
    const close=[...dialog.querySelectorAll('button')].filter(button=>visible(button)&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&(/^(close|cerrar)$/i.test(button.getAttribute('aria-label')||text(button))||[...button.querySelectorAll?.('[class]')||[]].some(child=>child.classList.contains('i-tripo:close'))));
    if(close.length===1)close[0].click();
    else if(close.length>1)throw new Error('EXPORT_CLOSE_CONTROL_AMBIGUOUS');
    else {
      const triggers=dialog.id?[...document.querySelectorAll('[aria-controls]')].filter(trigger=>visible(trigger)&&trigger.getAttribute('aria-haspopup')==='dialog'&&trigger.getAttribute('aria-expanded')==='true'&&(trigger.getAttribute('aria-controls')||'').split(/\s+/).includes(dialog.id)&&trigger.getAttribute('aria-disabled')!=='true'&&!trigger.disabled&&[...trigger.querySelectorAll?.('[class]')||[]].some(child=>child.classList.contains('i-tripo:download'))):[];
      if(triggers.length===1)triggers[0].click();
      else if(triggers.length>1)throw new Error('EXPORT_CLOSE_CONTROL_AMBIGUOUS');
      else {dialog.focus();dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));}
    }
    await waitFor(()=>!dialog.isConnected||!visible(dialog)||dialog.getAttribute('data-state')==='closed','EXPORT_DIALOG_CLOSE_NOT_ACKNOWLEDGED');
    return {stage:'closed'};
  }
  if(step==="open"){
    if(exportDialogs.length===1)return {stage:'already-open'};
    clickUnique(exact(document,"button",["Exportar","Export"]));return {stage:"opened"};
  }
  if(exportDialogs.length!==1)throw new Error("EXPORT_DIALOG_NOT_VERIFIED");
  const dialog=exportDialogs[0],formats=formatsIn(dialog);
  const blenderChoice=()=>exact(dialog,'[role="radio"],button[aria-pressed],button[data-state]','Blender');
  const selected=e=>e.getAttribute('aria-checked')==='true'||e.getAttribute('aria-pressed')==='true'||['on','checked','active'].includes(e.getAttribute('data-state'));
  const blenderSelected=()=>{
    const combos=[...dialog.querySelectorAll('[role="combobox"]')].filter(e=>visible(e)&&text(e)==='Blender'&&e.getAttribute('aria-expanded')!=='true');
    const choices=blenderChoice();return combos.length===1||choices.length===1&&selected(choices[0]);
  };
  if(step==='include-skeleton'){
    const switches=[...dialog.querySelectorAll('[role="switch"],[role="checkbox"],input[type="checkbox"]')].filter(e=>visible(e)&&/export skeleton|exportar esqueleto|incluir esqueleto/i.test(text(e.closest('label')||e.parentElement)));
    if(switches.length!==1)throw Error('RIG_EXPORT_SKELETON_CONTROL_REQUIRED');
    const control=switches[0],checked=()=>control.checked===true||control.getAttribute('aria-checked')==='true'||control.getAttribute('data-state')==='checked';
    if(!checked())clickUnique([control]);await waitFor(checked,'RIG_EXPORT_SKELETON_NOT_ENABLED');return {stage:'skeleton-enabled'};
  }
  if(step==='blender-preset'){
    if(format!=='FBX'||formats.length!==1||text(formats[0])!=='FBX')throw Error('FBX_FORMAT_NOT_SELECTED');
    const choices=blenderChoice();
    if(choices.length===1){if(!selected(choices[0]))clickUnique(choices);await waitFor(blenderSelected,'FBX_BLENDER_PRESET_NOT_VERIFIED');return {stage:'blender-preset-verified'};}
    const presets=[...dialog.querySelectorAll('[role="combobox"]')].filter(e=>visible(e)&&/^(Blender|Mixamo|3ds\s*Max|Maya|Unity|Unreal(?: Engine)?)$/i.test(text(e)));
    if(presets.length!==1)throw Error('FBX_BLENDER_PRESET_NOT_VERIFIED');
    const preset=presets[0];
    if(text(preset)!=='Blender'){
      preset.focus();preset.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',bubbles:true,cancelable:true}));
      const option=await waitFor(()=>{const options=exact(document,'[role="option"]','Blender');return options.length===1&&options[0].getAttribute('aria-disabled')!=='true'?options[0]:null;},'FBX_BLENDER_PRESET_NOT_VERIFIED');
      option.focus();option.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
    }
    await waitFor(()=>text(preset)==='Blender'&&preset.getAttribute('aria-expanded')!=='true','FBX_BLENDER_PRESET_NOT_VERIFIED');
    return {stage:'blender-preset-verified'};
  }
  if(step==="select-glb"||step==='select-fbx'){
    if(step!==`select-${format.toLowerCase()}`)throw Error('EXPORT_FORMAT_UNSUPPORTED');
    const option=await waitFor(()=>{const options=exact(document,'[role="option"]',format);return options.length===1&&!options[0].disabled&&options[0].getAttribute('aria-disabled')!=='true'?options[0]:null;},`${format}_OPTION_NOT_VISIBLE`);
    option.focus();option.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
    await waitFor(()=>{const current=formatsIn(dialog);return current.length===1&&text(current[0])===format&&current[0].getAttribute('aria-expanded')!=='true';},`${format}_SELECTION_NOT_ACKNOWLEDGED`);
    return {stage:"selected"};
  }
  if(formats.length!==1)throw new Error("EXPORT_FORMAT_CONTROL_NOT_VERIFIED");
  if(step==="format"){
    if(text(formats[0])===format&&formats[0].getAttribute('aria-expanded')!=='true')return {stage:`already-${format.toLowerCase()}`};
    if(formats[0].getAttribute('aria-expanded')!=='true'){
      formats[0].focus();formats[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',bubbles:true,cancelable:true}));
    }
    await waitFor(()=>{const options=exact(document,'[role="option"]',format);return formats[0].getAttribute('aria-expanded')==='true'&&options.length===1;},'EXPORT_FORMAT_LIST_NOT_READY');
    return {stage:`choose-${format.toLowerCase()}`};
  }
  if(step==="download"){
    if(text(formats[0])!==format)throw new Error(`${format}_FORMAT_NOT_SELECTED`);
    if(formats[0].getAttribute('aria-expanded')==='true')throw new Error('EXPORT_FORMAT_LIST_STILL_OPEN');
    if(format==='FBX'){
      if(!blenderSelected())throw Error('FBX_BLENDER_PRESET_NOT_VERIFIED');
    }
    clickUnique(exact(dialog,"button",["Exportar","Export"]));return {stage:"download-clicked"};
  }
  throw new Error("UNSUPPORTED_EXPORT_STEP");
  } catch(error) {
    // Chrome may replace an uncaught injected exception with an empty result.
    return {adapterError:String(error?.message||'EXPORT_OPERATION_FAILED'),exportStep:step};
  }
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}


// MAIN-world, one-command lease. Capture only the export emitted by Studio;
// never construct an asset URL or change the user's browser download settings.
export function captureStudioExport({action,taskId,lease,format='GLB'}){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
  try {
  const key='__workbenchExportCaptureV1',old=window[key];
  if(action==='disarm'){
    if(old?.lease===lease)old.restore();
    return {stage:'disarmed'};
  }
  if(location.origin!=='https://studio.tripo3d.ai'||!location.pathname.endsWith(taskId))throw Error('CONFIRMED_TASK_CHANGED');
  if(action==='read'){
    if(!old||old.lease!==lease)throw Error('EXPORT_CAPTURE_EXPIRED');
    if(old.ambiguous)throw Error('AMBIGUOUS_DOWNLOAD');
    const diagnostic={format:old.format,events:old.events.slice(-16)};
    return old.url?{stage:'captured',url:old.url,diagnostic}:{stage:'pending',diagnostic};
  }
  if(action!=='arm'||!lease||old)throw Error('EXPORT_CAPTURE_BUSY');
  if(!['GLB','FBX'].includes(format))throw Error('EXPORT_FORMAT_UNSUPPORTED');
  const path=location.pathname,click=HTMLAnchorElement.prototype.click,dispatch=HTMLAnchorElement.prototype.dispatchEvent,dispatchOwn=Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype,'dispatchEvent'),revoke=URL.revokeObjectURL,create=URL.createObjectURL,picker=window.showSaveFilePicker,open=window.open;
  const state={lease,format,url:null,ambiguous:false,events:[],blobs:new Map(),deferred:new Set(),timer:null,restore:null};
  const active=()=>window[key]===state&&location.pathname===path;
  const suffix=value=>String(value||'').match(/\.[a-z0-9]{1,8}(?=$|[?#])/i)?.[0]?.toLowerCase()||null;
  const expected=format==='FBX'?/\.(?:fbx|zip)$/i:/\.glb$/i;
  const blobType=type=>format==='FBX'?/^(?:application\/(?:zip|x-zip-compressed|octet-stream|x-fbx)|model\/fbx)$/i.test(type):/^(?:model\/gltf-binary|application\/octet-stream)$/i.test(type);
  const exportUrl=value=>{try{const u=new URL(value,location.href);return expected.test(u.pathname)||(u.protocol==='blob:'&&u.origin===location.origin&&blobType(state.blobs.get(u.href)?.type||''));}catch{return false;}};
  const note=(method,matched,value)=>{let kind='other',extension=null;try{const u=new URL(value,location.href);kind=['https:','blob:'].includes(u.protocol)?u.protocol.slice(0,-1):'other';extension=suffix(u.pathname);}catch{}state.events.push({method,matched,kind,extension});if(state.events.length>32)state.events.shift();};
  const capture=url=>{
    if(!active())throw Error('CONFIRMED_TASK_CHANGED');
    const source=new URL(url,location.href);
    if(source.protocol!=='https:'&&!(source.protocol==='blob:'&&source.origin===location.origin))throw Error('EXPORT_DOWNLOAD_URL_UNSUPPORTED');
    if(state.url&&state.url!==source.href)state.ambiguous=true;
    state.url=source.href;
  };
  const matches=a=>{
    if(!active()||!(a instanceof HTMLAnchorElement)||!a.href)return false;
    if(a.hasAttribute('download')){const name=typeof a.download==='string'?a.download:'';return !suffix(name)||expected.test(name);}
    return exportUrl(a.href);
  };
  function interceptedClick(){const matched=matches(this);note('anchor-click',matched,this.href);if(matched){capture(this.href);return;}return click.call(this);}
  function interceptedDispatch(event){if(event?.type==='click'){const matched=matches(this);note('anchor-dispatch',matched,this.href);if(matched){capture(this.href);if(event.cancelable)event.preventDefault();return !event.defaultPrevented;}}return dispatch.call(this,event);}
  function onClick(event){const a=event.target?.closest?.('a');if(a){const matched=matches(a);note('document-click',matched,a.href);if(matched){event.preventDefault();event.stopImmediatePropagation();capture(a.href);}}}
  function interceptedCreate(blob){const url=create.call(URL,blob);if(active()&&blob instanceof Blob&&blobType(blob.type)&&state.blobs.size<16)state.blobs.set(url,{type:blob.type,size:blob.size});return url;}
  function interceptedOpen(url,...args){const matched=active()&&typeof url==='string'&&exportUrl(url);note('window-open',matched,url);if(matched){capture(url);return null;}return open.call(window,url,...args);}
  function interceptedRevoke(url){if(active()&&url===state.url){state.deferred.add(url);return;}return revoke.call(URL,url);}
  // Some exporters use File System Access instead of a download anchor. Supply
  // a bounded in-memory writable during this export, so no OS picker opens.
  async function interceptedPicker(options){
    if(!active())return picker.call(window,options);
    const name=options?.suggestedName||`model.${format.toLowerCase()}`;
    if(suffix(name)&&!expected.test(name))return picker.call(window,options);
    note('file-picker',true,name);
    const parts=[];let size=0,closed=false;
    return {kind:'file',name,createWritable:async()=>({
      write:async data=>{
        if(closed||!active())throw Error('EXPORT_CAPTURE_EXPIRED');
        if(data?.type==='write'){if(data.position!==undefined&&data.position!==size)throw Error('EXPORT_STREAM_SEEK_UNSUPPORTED');data=data.data;}
        else if(data?.type==='seek'||data?.type==='truncate')throw Error('EXPORT_STREAM_SEEK_UNSUPPORTED');
        const part=new Blob([data]);size+=part.size;if(size>150*1024*1024)throw Error('EXPORTED_GLB_TOO_LARGE');parts.push(part);
      },
      close:async()=>{if(closed)throw Error('EXPORT_STREAM_CLOSED');if(!active())throw Error('EXPORT_CAPTURE_EXPIRED');closed=true;const url=URL.createObjectURL(new Blob(parts,{type:format==='GLB'?'model/gltf-binary':'application/octet-stream'}));capture(url);state.deferred.add(url);},
      abort:async()=>{closed=true;parts.length=0;},
    })};
  }
  state.restore=()=>{
    clearTimeout(state.timer);document.removeEventListener('click',onClick,true);
    if(HTMLAnchorElement.prototype.click===interceptedClick)HTMLAnchorElement.prototype.click=click;
    if(HTMLAnchorElement.prototype.dispatchEvent===interceptedDispatch){if(dispatchOwn)Object.defineProperty(HTMLAnchorElement.prototype,'dispatchEvent',dispatchOwn);else delete HTMLAnchorElement.prototype.dispatchEvent;}
    if(URL.revokeObjectURL===interceptedRevoke)URL.revokeObjectURL=revoke;
    if(URL.createObjectURL===interceptedCreate)URL.createObjectURL=create;
    if(window.open===interceptedOpen)window.open=open;
    if(window.showSaveFilePicker===interceptedPicker)window.showSaveFilePicker=picker;
    for(const url of state.deferred)revoke.call(URL,url);
    if(window[key]===state)delete window[key];
  };
  window[key]=state;
  try{
    HTMLAnchorElement.prototype.click=interceptedClick;URL.revokeObjectURL=interceptedRevoke;
    if(typeof dispatch==='function')HTMLAnchorElement.prototype.dispatchEvent=interceptedDispatch;
    if(typeof create==='function')URL.createObjectURL=interceptedCreate;
    if(typeof open==='function')window.open=interceptedOpen;
    document.addEventListener('click',onClick,true);
    if(typeof picker==='function')window.showSaveFilePicker=interceptedPicker;
    if(HTMLAnchorElement.prototype.click!==interceptedClick||typeof dispatch==='function'&&HTMLAnchorElement.prototype.dispatchEvent!==interceptedDispatch||typeof create==='function'&&URL.createObjectURL!==interceptedCreate||typeof open==='function'&&window.open!==interceptedOpen||typeof picker==='function'&&window.showSaveFilePicker!==interceptedPicker)throw Error('EXPORT_CAPTURE_UNAVAILABLE');
    state.timer=setTimeout(state.restore,180000);
    return {stage:'armed'};
  }catch(error){state.restore();throw error;}
  }catch(error){return {adapterError:String(error?.message||'EXPORT_CAPTURE_FAILED')};}
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

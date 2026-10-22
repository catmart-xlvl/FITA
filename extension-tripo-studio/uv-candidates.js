// Injected, DOM-only adapter. No network calls or framework/internal state.
export function studioUvCandidatesControl(input={}){
  // fita-guarded: a throw inside executeScript arrives as an empty result.
  try{
 const taskId=location.pathname.match(/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i)?.[1];
 if(location.origin!=='https://studio.tripo3d.ai'||taskId!==input.taskId)throw Error('CONFIRMED_TASK_CHANGED');
 if(!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/smart-uv\//.test(location.pathname))throw Error('SEG_UV_WORKSPACE_REQUIRED');
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
 const enabled=e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true';
 const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(visible);
 const saves=buttons.filter(e=>e.getAttribute('data-trace')==='studio.workspace_smart-uv.asset_save_button');
 const retries=buttons.filter(e=>e.getAttribute('data-trace')==='studio.workspace_smart-uv.free_retry_button');
 const retryLabel=retries.length===1?text(retries[0]):'';
 const retryMatch=retryLabel.match(/\(\s*[×x]\s*(\d+)\s*\)\s*$/i)||retryLabel.match(/^(?:Reintento gratis|Free retry|Free retries)\s*\(\s*(\d+)\)$/i);
 // Observed after the third free retry: the SAME trace becomes "Reintentar 10".
 // This is evidence that free retries are exhausted, never permission to click.
 const paidRetry=/^(?:Reintentar|Retry)\s+\d+(?:[.,]\d+)?(?:\s*(?:credits?|créditos))?$/i.test(retryLabel);
 let remaining=retryMatch?Number(retryMatch[1]):paidRetry?0:null;
 const normalized=e=>text(e).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[:：]\s*$/,'').trim();
 // Labels can contain their percentage, an English rate/ratio suffix, or an
 // inline info icon. Match a short semantic label, never a random page percent.
 const occupancyLabel=/^(?:(?:ocupacion|uso|utilizacion)(?:\s+del?)?(?:\s+espacio)?\s+UV|UV\s+(?:space\s+)?(?:utili[sz]ation|occupancy|usage|packing|coverage)(?:\s+(?:rate|ratio))?|UV\s*(?:空間)?(?:使用率|占有率))(?:\s*[:：]?\s*\d{1,3}(?:[.,]\d+)?\s*%)?\s*$/i;
 const labelNodes=[...document.querySelectorAll('span,p,div,label,strong,dt')].filter(visible);
 // Live English Studio also uses the bare label "Utilization". Accept it only
 // inside the named Smart UV result panel containing its unique Save control.
 const bareLabel=/^utili[sz]ation(?:\s*[:：]?\s*\d{1,3}(?:[.,]\d+)?\s*%)?\s*$/i;
 const panelFor=node=>{
  const requireHeading=bareLabel.test(normalized(node));
  for(let e=node.parentElement,depth=0;e&&e!==document.body&&depth<10;e=e.parentElement,depth++){
   if(saves.length===1&&e.contains(saves[0])&&(!requireHeading||labelNodes.some(heading=>e.contains(heading)&&/^Smart UV$/i.test(normalized(heading)))))return e;
  }
  return null;
 };
 const labels=labelNodes.filter(e=>{
  const value=normalized(e);if(value.length>100)return false;
  if(occupancyLabel.test(value))return !!panelFor(e);
  if(!bareLabel.test(value))return false;
  return !!panelFor(e);
 });
 const leafLabels=labels.filter(e=>!labels.some(other=>other!==e&&e.contains(other)));
 const label=leafLabels.length===1?leafLabels[0]:null;
 let occupancy=null;
 for(let e=label,depth=0;e&&depth<5;e=e.parentElement,depth++){
  const matches=[...text(e).matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*%/g)];
  if(matches.length===1){const value=Number(matches[0][1].replace(',','.'));if(value>=0&&value<=100)occupancy=value;break;}
 }
 const panel=label?panelFor(label):null;
 const fingerprint=value=>{let h=2166136261;for(const ch of value)h=Math.imul(h^ch.charCodeAt(0),16777619);return (h>>>0).toString(16);};
 const selected=e=>{
  const classes=e.getAttribute('class')||'',tokens=new Set(classes.split(/\s+/));
  // Studio's native thumbnail track has no ARIA selection or purple border.
  // Require both its item and active marker, inside the verified UV panel;
  // a generic "active" class elsewhere is never evidence of a selected UV.
  return e.getAttribute('aria-selected')==='true'||e.getAttribute('aria-pressed')==='true'||e.getAttribute('data-state')==='active'||tokens.has('workspace-thumbnail-item')&&tokens.has('workspace-thumbnail-active')||/(?:^|\s)(?:border|ring)-(?:purple|violet|primary)(?:-|\s|$)/.test(classes);
 };
 const candidates=[];
 for(const img of panel?.querySelectorAll('img')||[]){
  const box=img.getBoundingClientRect();if(!visible(img)||box.width<24||box.height<24||box.width>128||box.height>128)continue;
  let control=null;
  for(let e=img,depth=0;e&&e!==panel&&depth<4;e=e.parentElement,depth++){
   const r=e.getBoundingClientRect();if(r.width>140||r.height>140)break;
   if(e.matches('button,[role="button"],[role="tab"]')||/(?:^|\s)cursor-pointer(?:\s|$)/.test(e.getAttribute('class')||'')||selected(e))control=e;
  }
  if(!control)continue;
  const raw=img.currentSrc||img.getAttribute('src')||'';if(!raw)continue;
  let identity=raw;try{const u=new URL(raw,location.href);identity=u.origin+u.pathname;}catch{}
  candidates.push({key:fingerprint(identity),selected:selected(control)||[...control.querySelectorAll('[class],[aria-selected]')].some(selected),control});
 }
 const unique=new Set(candidates.map(c=>c.key)).size===candidates.length;
 // Four distinct results already reach the local limit. A translated paid
 // retry label needs no interpretation: stop retrying and compare these four.
 if(remaining===null&&unique&&candidates.length===4)remaining=0;
 const chosen=candidates.filter(c=>c.selected);
 const busy=[...document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')].some(visible);
 const blockingDialog=[...document.querySelectorAll('[role="dialog"]')].some(visible);
 const propertyTabs=buttons.filter(e=>e.getAttribute('role')==='tab'&&/^(?:property|properties|propiedad|propiedades|プロパティ|属性)$/i.test(text(e)));
 const properties={available:propertyTabs.length===1,active:propertyTabs.length===1&&(propertyTabs[0].getAttribute('aria-selected')==='true'||propertyTabs[0].getAttribute('data-state')==='active')};
 // One visible candidate is unambiguous even if Studio omits its active class.
 const selectedKey=chosen.length===1?chosen[0].key:unique&&candidates.length===1?candidates[0].key:null;
 const state={taskId,occupancy,pending:saves.length===1,remaining,retryLabel,retryEnabled:retries.length===1&&enabled(retries[0])&&remaining>0&&!busy,selectedKey,candidates:unique?candidates.map(({key,selected})=>({key,selected})):[],busy,blockingDialog,properties};
 if(input.diagnostic)state.diagnostic={labelFound:!!label,panelFound:!!panel,occupancyLabels:labelNodes.filter(e=>/UV|ocupacion|utili[sz]ation|occupancy/i.test(normalized(e))&&normalized(e).length<=140).slice(-16).map(normalized),propertyTabs:propertyTabs.map(e=>({text:text(e),selected:e.getAttribute('aria-selected'),state:e.getAttribute('data-state')})),images:[...panel?.querySelectorAll('img')||[]].slice(0,8).map(img=>({width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height,ancestors:[img,img.parentElement,img.parentElement?.parentElement,img.parentElement?.parentElement?.parentElement].filter(Boolean).map(e=>({tag:e.tagName,classes:e.getAttribute('class'),role:e.getAttribute('role'),selected:e.getAttribute('aria-selected')}))}))};
 if(!input.action)return state;
 if(blockingDialog||busy||!state.pending)throw Error('SEG_UV_SELECTION_NOT_READY');
 if(input.action==='show-properties'){
  if(!properties.available||!enabled(propertyTabs[0]))throw Error('SEG_UV_PROPERTIES_UNAVAILABLE');
  if(!properties.active)propertyTabs[0].click();
  return {taskId,opened:true};
 }
 if(input.action==='retry'){
  // Exact free control + exact remaining counter: a changed price/control can
  // never fall back to the paid Generate button.
  if(!state.retryEnabled||remaining!==input.expectedRemaining||remaining>3)throw Error('SEG_UV_FREE_RETRY_UNVERIFIED');
  retries[0].click();return {clicked:true,taskId,remaining};
 }
 if(input.action==='select'){
  const target=unique&&candidates.find(c=>c.key===input.key);
  if(!target||!enabled(target.control))throw Error('SEG_UV_SELECTION_NOT_READY');
  target.control.click();return {clicked:true,taskId,key:target.key};
 }
 throw Error('SEG_GROUP_ACTION_INVALID');
}catch(error){return {adapterError:error?.message||'STUDIO_ADAPTER_ERROR'};}
}

// Durable state machine. Retry intents are saved BEFORE clicking. If the
// reply is lost, recover the resulting candidate before considering any action.
// One recovery per unchanged FREE retry slot is allowed only after its deadline
// and a fresh, stable idle observation. Paid UV generation is never dispatched here.
export async function optimizeUvCandidates({receipt,inspect,act,persist,pause,now=Date.now}){
 const end=now()+60000;
 const selection=receipt.uvSelection||={version:1,samples:[],retries:0,pendingRetry:null,selected:null,complete:false};
 let stableKey=null,stable=0,openedProperties=false,propertyOpenAttempts=0,idleRetrySignature=null,idleRetrySince=null;
 async function waiting(reason){
  // A command's one-minute slice is not the UI's readiness deadline. Carry
  // continuous unreadability across recovery calls/reloads and reason changes;
  // otherwise a late panel fails spuriously, or every new call resets its wait.
  const since=selection.waiting?.since??selection.waiting?.at??now();
  if(!selection.pendingRetry&&now()-since>=180000)throw Error('SEG_UV_SELECTION_NOT_READY');
  if(selection.waiting?.reason!==reason||selection.waiting?.since===undefined){selection.waiting={reason,at:now(),since};await persist();}
  await pause(750);
 }
 while(now()<end){
  const s=await inspect();
  if(s.taskId!==receipt.taskId)throw Error('CONFIRMED_TASK_CHANGED');
  if(s.blockingDialog){
   idleRetrySignature=null;idleRetrySince=null;
   // A generation overlay can briefly be a dialog. Wait only while our own
   // persisted free retry is outstanding; never dismiss or click the dialog.
   if(selection.pendingRetry&&now()-selection.pendingRetry.at<=180000){await waiting('retry-progress-dialog');continue;}
   throw Error('CLOSE_OTHER_DIALOGS_FIRST');
  }
  if(s.busy&&selection.pendingRetry&&now()-selection.pendingRetry.at>180000)throw Error('SEG_UV_RETRY_UNCERTAIN');
  if(s.busy){idleRetrySignature=null;idleRetrySince=null;await pause(750);continue;}
  if(!s.pending){idleRetrySignature=null;idleRetrySince=null;await waiting('result-panel-loading');continue;}
  // A free retry can switch Studio from Property to Assets. Restore the
  // observation panel BEFORE interpreting a persisted retry as missing.
  if(s.properties?.active)openedProperties=false;
  const candidatesReadable=s.candidates.length>0&&!!s.selectedKey&&Number.isFinite(s.occupancy)&&s.remaining!==null;
  if(!candidatesReadable&&s.properties?.available&&!s.properties.active){
   if(!openedProperties){
    if(++propertyOpenAttempts>4)throw Error('SEG_UV_SELECTION_NOT_READY');
    openedProperties=true;await act({action:'show-properties'});stableKey=null;stable=0;
   }
   await waiting('property-panel-loading');continue;
  }
  if(selection.pendingRetry){
   const pending=selection.pendingRetry;
   const added=s.candidates.filter(c=>!pending.keys.includes(c.key));
   // A delayed original retry and its bounded free recovery may both finish
   // before the next observation. Reconcile the exact counter/result delta;
   // never infer completion from the counter alone or discard prior results.
   const confirmedAdded=candidatesReadable&&added.length>0&&added.length<=pending.remaining&&s.remaining===pending.remaining-added.length&&s.candidates.length<=4&&new Set(s.candidates.map(c=>c.key)).size===s.candidates.length&&pending.keys.every(key=>s.candidates.some(c=>c.key===key))&&s.candidates.length===pending.keys.length+added.length&&selection.retries+added.length<=3;
   if(confirmedAdded){selection.pendingRetry=null;selection.retries+=added.length;selection.selected=null;await persist();}
   else{
    if(now()-pending.at>180000){
     const keys=s.candidates.map(c=>c.key);
     const unchangedFree=candidatesReadable&&s.retryEnabled===true&&s.remaining===pending.remaining&&s.remaining>=1&&s.remaining<=3&&keys.length===pending.keys.length&&new Set(keys).size===keys.length&&keys.every(k=>pending.keys.includes(k))&&pending.keys.includes(s.selectedKey);
     const recoveries=selection.retryRecoveries|| (selection.retryRecovery?[selection.retryRecovery]:[]);
     if(!unchangedFree||recoveries.length>=3||recoveries.some(r=>r.remaining===pending.remaining))throw Error('SEG_UV_RETRY_UNCERTAIN');
     const signature=JSON.stringify([keys.slice().sort(),s.selectedKey,s.occupancy,s.remaining]);
     if(signature!==idleRetrySignature){idleRetrySignature=signature;idleRetrySince=now();}
     if(now()-idleRetrySince<15000){await pause(750);continue;}
     // Persist the limit and prior intent BEFORE the exact free control is
     // tried once more. A lost acknowledgement/reload cannot repeat recovery.
     selection.retryRecovery={originalAt:pending.at,at:now(),remaining:pending.remaining,keys:[...pending.keys]};
     selection.retryRecoveries=[...recoveries,selection.retryRecovery];
     selection.retryRecoveryCount=selection.retryRecoveries.length;
     pending.at=now();await persist();
     await act({action:'retry',expectedRemaining:s.remaining});
     idleRetrySignature=null;idleRetrySince=null;stableKey=null;stable=0;
    }
    await pause(750);continue;
   }
  }
  if(s.remaining!==null&&(s.remaining<0||s.remaining>3)||s.candidates.length>4)throw Error('SEG_UV_SELECTION_NOT_READY');
  if(!s.candidates.length||!s.selectedKey||!Number.isFinite(s.occupancy)||s.remaining===null){
   await waiting(!s.candidates.length?'candidate-panel-loading':!s.selectedKey?'candidate-selection-loading':!Number.isFinite(s.occupancy)?'occupancy-loading':'retry-counter-loading');continue;
  }
  if(selection.waiting){delete selection.waiting;await persist();}
  if(selection.samples.some(sample=>!s.candidates.some(c=>c.key===sample.key)))throw Error('SEG_UV_CANDIDATES_CHANGED');
  // A candidate switch must settle before its percentage can be recorded.
  const signature=s.selectedKey+':'+s.occupancy;
  if(signature!==stableKey){stableKey=signature;stable=0;}
  if(++stable<4){await pause(750);continue;}
  if(!selection.samples.some(sample=>sample.key===s.selectedKey)){
   selection.samples.push({key:s.selectedKey,occupancy:s.occupancy});await persist();
  }
  const unmeasured=s.candidates.find(c=>!selection.samples.some(sample=>sample.key===c.key));
  if(unmeasured){await act({action:'select',key:unmeasured.key});stableKey=null;stable=0;await pause(750);continue;}
  if(s.remaining>0){
   if(!s.retryEnabled){await pause(750);continue;}
   if(selection.retries>=3||s.candidates.length>=4)throw Error('SEG_UV_FREE_RETRY_UNVERIFIED');
   selection.pendingRetry={at:now(),remaining:s.remaining,keys:s.candidates.map(c=>c.key)};await persist();
   await act({action:'retry',expectedRemaining:s.remaining});stableKey=null;stable=0;await pause(750);continue;
  }
  const best=selection.samples.reduce((a,b)=>b.occupancy>a.occupancy?b:a);
  if(s.selectedKey!==best.key){await act({action:'select',key:best.key});stableKey=null;stable=0;await pause(750);continue;}
  if(s.occupancy!==best.occupancy)throw Error('SEG_UV_CANDIDATES_CHANGED');
  selection.selected=best;selection.complete=true;await persist();return true;
 }
 await persist();
 // Yield while the exact same paid result is still hydrating. The caller
 // monitors its durable receipt; it must not submit UV or reserve credits again.
 return false;
}

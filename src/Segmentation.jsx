import React,{useEffect,useRef,useState} from 'react';
import {useI18n} from './i18n';
import {chosenModel} from './project-navigation';
import {segmentationCopy,segmentationText} from './segmentation-locales';
import './segmentation.css';
import {DetailsLink} from './Help';
import {analysisZipBlob} from './analysis-download';
import {analysisGate} from './analysis-wait';

export default function Segmentation({project,request,activeGroup,onPreview,onReviewRequired,onCurrent,partSelector}){
 const {t,language}=useI18n(),s=(k,p)=>segmentationText(language,k,p),root=`/projects/${project.id}/segmentation`;
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[partViews,setPartViews]=useState({head:{mode:'texture',isolate:''},body:{mode:'texture',isolate:''}}),[approved,setApproved]=useState(false),[downloaded,setDownloaded]=useState(false);
 const {mode,isolate}=partViews[activeGroup];
 const setMode=mode=>setPartViews(v=>({...v,[activeGroup]:{...v[activeGroup],mode}})),setIsolate=isolate=>setPartViews(v=>({...v,[activeGroup]:{...v[activeGroup],isolate}}));
 const downloadUrls=useRef([]);useEffect(()=>()=>downloadUrls.current.forEach(url=>URL.revokeObjectURL(url)),[]);
 const waitKey='fitaAnalysisWait:'+project.id;
 const [waitReceipt,setWaitReceipt]=useState(()=>{try{return JSON.parse(localStorage.getItem(waitKey)||'null');}catch{return null;}});
 const deliveryError=data?.delivery?.lastError||'';
 const gate=analysisGate(data,waitReceipt,error||deliveryError);
 function rememberWait(value){setWaitReceipt(value);try{localStorage.setItem(waitKey,JSON.stringify(value));}catch{}}
 const lock=useRef(false),current=data?.current,groups=current?.groups.filter(g=>g.part===activeGroup)||[],group=groups.find(g=>g.id===isolate);
 const generated=group&&data?.projectId===project.id&&data?.runs?.filter(r=>r.planId===data?.plan?.id).flatMap(r=>r.operations).find(o=>o.groupId===group.id&&o.step==='download'&&o.status==='completed'&&o.downloadAsset?.url)?.downloadAsset;
 async function refresh(){const d=await request(root);setData({...d,projectId:project.id});return d;}
 useEffect(()=>{let alive=true;const load=()=>request(root).then(d=>{if(alive)setData({...d,projectId:project.id});}).catch(e=>{if(alive)setError(e.message);});load();const id=setInterval(load,3000);return()=>{alive=false;clearInterval(id);};},[project.id]);
 useEffect(()=>{setPartViews({head:{mode:'texture',isolate:''},body:{mode:'texture',isolate:''}});setApproved(false);},[current?.id,project.id]);
 useEffect(()=>{setDownloaded(false);},[project.id,project.groups.head.selectedModelId,project.groups.body.selectedModelId]);
 useEffect(()=>{onPreview(mode==='original'?{...chosenModel(project,activeGroup),colorLabels:false}:mode==='isolated'&&group?{...group.asset,colorLabels:false}:mode==='generated'&&generated?{...generated,colorLabels:false,generated:true,projectId:project.id}:null);},[mode,group?.asset?.id,generated?.id,current?.id,activeGroup,project.id,chosenModel(project,activeGroup)?.id]);
 useEffect(()=>{onReviewRequired(!!current?.reconstruction?.reviewRequired);},[current?.reconstruction?.reviewRequired]);
 useEffect(()=>{onCurrent?.(current||null);},[current?.id,current?.identity,current?.reconstruction?.blend?.id]);
 async function command(route,body={},after){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const result=await request(root+'/'+route,{method:'POST',body});await refresh();if(after)await after(result);return result;}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}}
 async function importZip(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;const form=new FormData();form.set('file',file);await command('import',form,()=>setMode('texture'));}
 const delivery=data?.delivery,activeRuns=data?.runs?.filter(r=>['pending','running','attention'].includes(r.status))||[],blocked=busy||activeRuns.length>0||data?.quotation?.status==='running';
 const review=current?.review;
 async function downloadPackage(options={}){setDownloaded(false);await command('package',{...options,supervised:true},async result=>{if(!result?.downloadUrl)throw Error('The analysis ZIP could not be downloaded. Try again.');const blob=await analysisZipBlob(result.downloadUrl);const url=URL.createObjectURL(blob);downloadUrls.current.push(url);const link=document.createElement('a');link.href=url;link.download='fita_segmentation.zip';document.body.appendChild(link);link.click();link.remove();rememberWait({deliveryId:result.id||result.delivery?.id,cancelled:false});setDownloaded(true);});}
 async function approve(){await command('approve',{id:current.id,confirm:approved,confirmReviewedRegions:approved});}
 async function updateSettings(groupId,settings){await command('settings',{id:current.id,groupId,settings},current.approval?async()=>{await request(root+'/quote-all',{method:'POST',body:{}});await refresh();}:undefined);}
 return <section className="segmentation-panel" aria-label={s('title')}>
  <div className="seg-heading"><span className="seg-number">01</span><h3>{s('title')}</h3>{current&&<span className="seg-badge">{s('groups',{count:current.groups.length})}</span>}</div>
  {!data?.eligible&&<p>{t('Choose a head and a body before texturing.')}</p>}
  <button className="button primary" disabled={blocked||!data?.eligible} onClick={()=>downloadPackage({renew:delivery?.status==='expired',correction:!!current})}>{s(busy?'working':delivery?.status==='expired'?'renew':'download')}</button>
  {delivery?.status==='expired'&&<small>{s('SEG_DELIVERY_EXPIRED')}</small>}
  {!current&&(delivery?.status==='stale'||data?.history.length>0)&&<p role="status">{s('stale')}</p>}
  <details><summary>{s('manualImport')}</summary><label className="button secondary codex-upload">{s('import')}<input type="file" accept=".zip" disabled={blocked||!data?.eligible} onChange={importZip}/></label></details>
  {downloaded&&delivery?.status!=='imported'&&<p role="status">{t('Attach this ZIP in your local Codex and say “Follow the instructions.” Codex sends the results back to FITA.')}</p>}
  {gate.showWaiting&&<p role="status" className="analysis-wait"><span aria-hidden="true">•••</span> {t('Waiting for analysis results.')}</p>}
  {gate.awaiting&&<button className="button subtle" onClick={()=>rememberWait({...waitReceipt,cancelled:true})}>{t('Cancel waiting')}</button>}
  {error&&<p className="error" role="alert">{segmentationCopy[error]?s(error):s('genericError',{code:error})}</p>}
  {!error&&deliveryError&&<p className="error" role="alert">{segmentationCopy[deliveryError]?s(deliveryError):s('genericError',{code:deliveryError})}</p>}
  <fieldset className="seg-analysis-fields" disabled={gate.groupsLocked} aria-label={t('Textures')}>
  {partSelector}
  {current&&<>
   {!current.approval&&<p role="status">{s('received')}</p>}
   <div className="seg-preview-controls">{['original','texture'].map(k=><button key={k} className={mode===k?'selected':''} aria-pressed={mode===k} onClick={()=>setMode(k)}>{s(k==='texture'?'preview':k)}</button>)}</div>
   {!groups.length&&<p>{t('No segments for this part yet.')}</p>}
   <div className="seg-groups" role="tabpanel" aria-label={t(activeGroup==='head'?'Head':'Body')}>{groups.map(g=><article key={g.id} className={isolate===g.id&&mode==='isolated'?'seg-group selected':'seg-group'}>
    <div className="seg-group-heading"><strong>{g.name}</strong>{g.pending&&!current.approval&&<small>{s('pending')}</small>}</div>
    <button className="button secondary" aria-pressed={isolate===g.id&&mode==='isolated'} onClick={()=>{setIsolate(g.id);setMode('isolated');}}>{s('isolated')}</button>
    {data?.projectId===project.id&&data?.plan&&data.runs.filter(r=>r.planId===data.plan.id).some(r=>r.operations.some(o=>o.groupId===g.id&&o.step==='download'&&o.status==='completed'&&o.downloadAsset?.url))&&<button className="button secondary" aria-pressed={isolate===g.id&&mode==='generated'} onClick={()=>{setIsolate(g.id);setMode('generated');}}>{s('viewGenerated')}</button>}
    <details><summary>{g.settings.resolution} · {s('settings')}</summary><div className="seg-group-settings"><label>{t('Texture resolution')}<select value={g.settings.resolution} disabled={blocked} onChange={e=>updateSettings(g.id,{...g.settings,resolution:e.target.value})}>{['2K','4K','8K'].map(v=><option key={v}>{v}</option>)}</select></label><label><input type="checkbox" checked={g.settings.removeLighting} disabled={blocked} onChange={e=>updateSettings(g.id,{...g.settings,removeLighting:e.target.checked})}/>{t('Remove lighting')}</label></div></details>
   </article>)}</div>
   {!current.approval&&<div className="seg-approval">{!!review?.reviewCount&&<small>{s('reviewCount',{count:review.reviewCount})}</small>}<label><input type="checkbox" checked={approved} disabled={blocked} onChange={e=>setApproved(e.target.checked)}/>{s('approveCheck')}</label>{review?.reason&&<p role="status">{s(review.reason)}</p>}<button className="button primary" disabled={!approved||blocked||review?.canApprove===false} onClick={approve}>{s('approve')}</button></div>}
   {current.approval&&<GroupBudget {...{data,current,activeGroup,busy,command,s,t}}/>}
   {current.workflowVersion!==2&&['head','body'].every(part=>data.runs.some(r=>r.part===part&&r.status==='completed'))&&!current.reconstruction&&<button className="button primary" disabled={busy} onClick={()=>command('reconstruct',{},()=>setMode('texture'))}>{s('reconstruct')}</button>}
   {current.reconstruction?.reviewRequired&&!current.reconstruction?.refinementRequired&&<div className="seg-approval"><p>{s('reconstructionReview')}</p><button className="button primary" disabled={busy} onClick={()=>command('approve-reconstruction',{id:current.id,confirm:true})}>{s('acceptResult')}</button></div>}
  </>}
  {!current?.approval&&<section className="seg-texture-wait"><div className="seg-heading"><span className="seg-number">02</span><h3>{s('texture')}</h3></div><button className="button primary" disabled>{s('generateTextures')}</button></section>}
  </fieldset>
 </section>;
}
const priced=q=>q?.source==='rate-card'||q?.verified&&q.expiresAt>Date.now();
const stepKey=op=>op.step==='smartUV'?'uv':op.step==='texture'?'texture':op.step==='import'?'uploadingGroup':'downloadingGroup';
export function GroupBudget({data,current,busy,command,s,t}){
 const budgets=Object.fromEntries(['head','body'].map(part=>[part,data.budgets.filter(b=>b.part===part).at(-1)]));
 const [consent,setConsent]=useState(false),[explain,setExplain]=useState(false),attempt=useRef(null),plan=data.plan,delivery=data.referencesDelivery;
 useEffect(()=>setConsent(false),[budgets.head?.id,budgets.body?.id,current.id]);
 const quoting=data.quotation?.status==='running',active=plan&&['running','reconstructing'].includes(plan.status);
 const verified=['head','body'].every(part=>budgets[part]?.complete&&budgets[part].rows.every(r=>['smartUV','texture'].every(k=>priced(r[k]))));
 const total=verified?budgets.head.total+budgets.body.total:null;
 const priceKey=JSON.stringify([current.id,current.groups.map(g=>[g.id,g.asset?.id,g.settings])]);
 // Local tariff calculation never needs a connected extension or an upload.
 useEffect(()=>{
  if(verified){attempt.current=null;return;}
  if(busy||quoting||active||plan||data.quotation?.error||attempt.current===priceKey)return;
  attempt.current=priceKey;void command('quote-all');
 },[priceKey,verified,busy,quoting,active,!!plan,data.quotation?.error]);
 const download=result=>{if(!result?.downloadUrl)return;const a=document.createElement('a');a.href=result.downloadUrl;a.download='fita_texture_references.zip';document.body.appendChild(a);a.click();a.remove();};
 async function acceptAndDownload(){const accepted=await command('accept-plan',{budgetIds:{head:budgets.head?.id,body:budgets.body?.id},total,confirm:consent,confirmUpload:consent,autoStart:consent});if(accepted&&current.workflowVersion!==2)await command('references/package',{},download);}
 return <section className="seg-budget"><div className="seg-heading"><span className="seg-number">02</span><h3>{s('texture')}</h3></div>
  {plan&&(['references-ready','running'].includes(plan.status)||plan.status==='attention'&&!['head','body'].every(part=>data.runs.some(r=>r.part===part&&r.status==='completed')))&&!data.capabilities.supported&&<p role="status">{s('SEG_EXTENSION_RELOAD_REQUIRED')}</p>}
  {data.quotation?.error&&<p className="error" role="alert">{segmentationCopy[data.quotation.error]?s(data.quotation.error):s('genericError',{code:data.quotation.error})}</p>}
  {!plan&&<label><input type="checkbox" checked={consent} disabled={busy||!verified||quoting} onChange={e=>setConsent(e.target.checked)}/>{s('combinedBudgetCheck')}</label>}
  <div className="seg-generate-price"><button className="button primary" disabled={!!plan||busy||!consent||!verified||quoting} onClick={acceptAndDownload}>{s('generateTextures')}</button><strong role="status">{plan?s('credits',{credits:plan.total}):verified?s('credits',{credits:total}):s(quoting?'calculatingPrice':'costPending')}</strong></div>
  {quoting&&data.quotation.progress&&<small role="status">{t(data.quotation.progress.part==='head'?'Head':'Body')} · {data.quotation.progress.groupName} · {data.quotation.progress.index}/{data.quotation.progress.count}</small>}
  <div className="seg-price-parts">{['head','body'].filter(part=>plan||budgets[part]?.complete&&budgets[part].rows.every(r=>['smartUV','texture'].every(k=>priced(r[k])))).map(part=><span key={part}>{t(part==='head'?'Head':'Body')}: {s('credits',{credits:plan?plan.budgets.find(b=>b.part===part)?.total:budgets[part].total})}</span>)}</div>
  <DetailsLink label={s('whyCost')} title={s('whyCost')}><p className="popup-text">{s('costExplanation')}</p><p className="popup-text">{s(current.workflowVersion===2?'supervisedSingleZip':'generateReferencesFirst')}</p></DetailsLink>
  {data.quotation?.error&&!plan&&<button className="button secondary" disabled={busy||quoting} onClick={()=>command('quote-all')}>{s('retry')}</button>}
  {plan&&<>{plan.workflowVersion!==2&&['waiting-references','references-ready'].includes(plan.status)&&<><button className="button primary" disabled={busy} onClick={()=>command('references/package',{renew:delivery?.status==='expired'},download)}>{s('downloadReferences')}</button><p>{s('referenceDeliveryHint')}</p>{delivery&&<small>{s('until',{date:new Date(delivery.expiresAt).toLocaleString()})}</small>}</>}
   {plan.workflowVersion===2&&plan.status==='waiting-references'&&<div className="seg-codex-next" role="status" aria-live="polite"><strong>{s('tellCodexTitle')}</strong><p>{s('supervisedReferenceApproval')}</p><blockquote>{s('tellCodexMessage')}</blockquote><small>{s('referencesBeforeUpload')}</small></div>}
   {plan.referencesReceipt&&plan.status!=='completed'&&<p>{s('referencesReceived')}</p>}
   <p role="status">{s(plan.status==='ready-to-finish'?'supervisedFinish':plan.status==='finishing'?'supervisedPainting':plan.status==='completed'?'completed':plan.status==='attention'?'attention':plan.status==='waiting-references'?'waitingReferences':'working')}</p>
   {plan.error&&<p className="error">{segmentationCopy[plan.error]?s(plan.error):s('genericError',{code:plan.error})}</p>}
   {plan.status==='attention'&&<button className="button secondary" disabled={busy} onClick={()=>command('resume-plan')}>{s('resume')}</button>}
  </>}
  {data.runs.length>0&&<div className="seg-runs">{data.runs.map(run=>{const done=run.operations.filter(op=>op.status==='completed').length,total=run.operations.length,next=run.operations.find(op=>op.status!=='completed');
   return <div className="seg-run" key={run.id}><div className="seg-run-line"><strong>{t(run.part==='head'?'Head':'Body')}</strong><span>{done}/{total}</span><span>{s('credits',{credits:run.committedCredits+'/'+run.maxCredits})}</span></div><div className="seg-run-bar" aria-hidden="true"><i style={{width:(total?done/total*100:0)+'%'}}/></div>{next&&<small>{current.groups.find(g=>g.id===next.groupId)?.name} · {s(stepKey(next))}</small>}</div>;})}
   <DetailsLink title={s('texture')}>{data.runs.map(run=><div className="seg-run-detail" key={run.id}><strong>{t(run.part==='head'?'Head':'Body')}</strong><p>{s('committed',{credits:run.committedCredits,max:run.maxCredits})}</p><ul>{run.operations.map(op=><li key={op.id}>{current.groups.find(g=>g.id===op.groupId)?.name} · {s(stepKey(op))} · {s(op.status==='completed'?'completed':'working')}</li>)}</ul></div>)}</DetailsLink></div>}
 </section>;
}

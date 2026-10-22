import React,{useEffect,useRef,useState} from 'react';
import {ArrowRight,Download,ExternalLink,LoaderCircle,Plug,ShieldCheck,TriangleAlert} from 'lucide-react';
import {useI18n} from './i18n';
import {workflowText} from './studio-workflow-locales';
import {preparationBlocker} from './studio-readiness';
import {generationLimits,matchingGenerationLimits} from '../shared/generation-profile.js';
import {studioDisplayOperation} from '../shared/generation-sequence.js';
import {candidateBatchFor,candidateRecoveryStep,batchHasFailedCandidates} from '../shared/studio-candidate-recovery.js';

const finalStatuses=new Set(['succeeded','failed','unknown','abandoned']);
const viewLabels={front:'Front',right:'Right profile',back:'Back',left:'Left profile'};
export default function StudioWorkflow({request,project,onConnections,onProjectChange,onReview,group='head',enabled=true}) {
  const {language,message}=useI18n(),t=(key,values)=>workflowText(language,key,values);
  const [status,setStatus]=useState(null),[operation,setOperation]=useState(null),[historyLoaded,setHistoryLoaded]=useState(false),
    [busy,setBusy]=useState(false),[error,setError]=useState(''),[connectionError,setConnectionError]=useState(false),
    [stopConsent,setStopConsent]=useState(false);
  const selection=useRef(''),onChange=useRef(onProjectChange),recoveryRetries=useRef(new Set());
  onChange.current=onProjectChange;
  selection.current=project.id+':'+group;
  const endpoint='/projects/'+project.id+'/studio';
  const fingerprint=project.viewSetFingerprints?.[group];
  const chosenViews=project.groups[group].selectedViews||['front','right','back'].filter(v=>project.groups[group].views[v]);
  useEffect(()=>{
    let active=true;
    const refresh=async()=>{try{const next=await request('/studio/status');if(active){setStatus(next);setConnectionError(false);}}catch{if(active)setConnectionError(true);}};
    refresh();const timer=setInterval(refresh,2000);return()=>{active=false;clearInterval(timer);};
  },[request]);
  useEffect(()=>{
    let active=true;setHistoryLoaded(false);setOperation(null);setError('');recoveryRetries.current.clear();
    request(endpoint+'/operations').then(result=>{if(active){setOperation(studioDisplayOperation(result.operations,group));setHistoryLoaded(true);}}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[endpoint,group,request]);
  async function perform(route,body,{automatic=false}={}) {
    if(!automatic)recoveryRetries.current.clear();
    const selected=selection.current;setBusy(true);setError('');
    try{
      const result=await request(endpoint+route,{method:'POST',body});
      if(selection.current===selected){setOperation(result.operation);setStopConsent(false);if(result.project)onChange.current?.(result.project);}
      return result;
    }catch(e){if(selection.current===selected)setError(e.message);}
    finally{if(selection.current===selected)setBusy(false);}
  }
  async function refreshOperation(id=operation?.id) {
    if(!id)return;
    const selected=selection.current;
    try{
      const next=await request(endpoint+'/operation/'+id);
      if(selection.current===selected){setOperation(next.operation);if(next.project)onChange.current?.(next.project);}
    }catch(e){if(selection.current===selected)setError(e.message);}
  }
  useEffect(()=>{
    if(!operation||finalStatuses.has(operation.status))return;
    let active=true;const selected=selection.current;
    const poll=async()=>{try{
      const next=await request(endpoint+'/operation/'+operation.id);
      if(active&&selection.current===selected){setOperation(next.operation);if(next.project)onChange.current?.(next.project);}
    }catch(e){if(active)setError(e.message);}};
    poll();const timer=setInterval(poll,2000);return()=>{active=false;clearInterval(timer);};
  },[endpoint,operation?.id,operation?.status,request]);
  useEffect(()=>{
    if(!operation||!status?.controlAvailable||connectionError||busy||error)return;
    const step=candidateRecoveryStep(operation,project.studioOperations,status.adapter,recoveryRetries.current);
    if(!step)return;
    const timer=setTimeout(()=>{
      if(step.retryKey)recoveryRetries.current.add(step.retryKey);
      if(step.refreshId)void refreshOperation(step.refreshId);
      else void perform(step.route,step.body,{automatic:true});
    },operation.type==='monitor'&&operation.result?.stage==='processing'?2000:100);return()=>clearTimeout(timer);
  },[operation?.id,operation?.status,operation?.result?.stage,operation?.candidatesConfirmedAt,operation?.importedModelId,status?.controlAvailable,connectionError,busy,error]);
  const ready=!!(project.viewSetReadyByGroup?.[group]??project.viewSetReady)&&!project.demo;
  const connected=!!status?.controlAvailable&&!connectionError;
  const active=!!operation&&!finalStatuses.has(operation.status);
  const blocker=!enabled?'STUDIO_HEAD_FIRST':preparationBlocker({project,group,status,connectionError,busy,active,uploadConsent:true});
  const observed=['prepare','observe'].includes(operation?.type)&&operation.status==='succeeded'&&['prepared','observed'].includes(operation.result?.stage)?operation.result:null;
  const obsoleteTopology=operation?.quoteOnly&&operation.status==='succeeded'&&!matchingGenerationLimits(group,observed?.options?.generationFaceLimits);
  const quoteReady=operation?.quoteOnly&&operation.status==='succeeded'&&!obsoleteTopology&&observed?.mode==='smart-mesh'&&observed.generationCount===4&&/^P2\.0(?:\s|$)/.test(observed.modelLabel||'')&&!!observed.costLabel?.trim()&&!operation.consumedAt&&operation.fingerprint===fingerprint;
  const quoteExpired=quoteReady&&Date.now()-Date.parse(operation.createdAt)>300000;
  const quickAvailable=status?.adapter?.quickGenerationVersion===1;
  const topologyAvailable=status?.adapter?.topologySettingsVersion===1;
  const nativeAvailable=status?.adapter?.nativeQuadExportVersion===1;
  const candidateBatch=candidateBatchFor(operation,project.studioOperations);
  const batchSummary=candidateBatch||(operation?.type==='submit'&&operation.generationComplete?operation:null);
  useEffect(()=>{
    if(!historyLoaded||!ready||!connected||!quickAvailable||!topologyAvailable||busy||active||error||blocker||operation?.discoveryFor||candidateBatch||operation?.verificationFor)return;
    if(operation&&!(operation.status==='succeeded'&&['prepare','observe'].includes(operation.type)&&!operation.quoteOnly)&&operation.status!=='abandoned')return;
    void perform('/quote',{group});
  },[historyLoaded,ready,connected,quickAvailable,topologyAvailable,busy,active,error,blocker,operation?.id,operation?.status,group]);
  const completed=operation?.type==='monitor'&&operation.status==='succeeded'&&operation.result?.stage==='ready';
  const saved=project.models.find(model=>model.id===operation?.importedModelId);
  const failure=operation?.error||operation?.importError||operation?.result?.errorCode;
  return <section className="studio-generation studio-workflow">
    <div className="studio-bridge-heading"><h2>{t(group==='head'?'Head':'Body')}</h2><span className="pill">{t(connected?(status.preparationAvailable?'Ready to prepare':'Connected · preparation unavailable'):'Connection unavailable')}</span></div>
    {!ready&&<p>{t(project.demo?'STUDIO_DEMO_BLOCKED':'Approve the selected views for this part first.')}</p>}
    {!connected&&<button className="button secondary" onClick={onConnections}><Plug size={15}/>{t('Connect your browser')}</button>}
    <div className="views-grid studio-upload-preview">
      {chosenViews.map(view=>{const asset=project.groups[group].views[view];return <figure className="view-card" key={view} style={{margin:0}}>
        {asset&&<img src={asset.url} alt={t(group==='head'?'Head':'Body')+' · '+t(viewLabels[view])} style={{width:'100%',height:70,objectFit:'contain'}}/>}
        <figcaption style={{padding:8,fontSize:11}}>{t(viewLabels[view])}</figcaption>
      </figure>;})}
    </div>
    {!active&&!completed&&!saved&&!candidateBatch&&!operation?.verificationFor&&!operation?.discoveryFor&&(operation?.type!=='submit'||operation.status==='failed'&&operation.includesPreparation)&&operation?.type!=='monitor'&&<>
      <p><strong>Smart Mesh P2 · 4 {t('candidates')}</strong></p>
      <p>{t('Polygon targets: {counts}',{counts:generationLimits(group).map(n=>(n/1000)+'k').join(' · ')})}</p>
      <button className="button primary" aria-describedby={'studio-prepare-reason-'+group} disabled={!!blocker||!quoteReady||quoteExpired||!quickAvailable||!topologyAvailable||!nativeAvailable} onClick={()=>perform('/generate',{operationId:operation.id,expectedCost:observed.costLabel,confirmUpload:true,confirmCost:true})}><ArrowRight size={16}/>{t(group==='head'?'Generate head · 4 models · {cost}':'Generate body · 4 models · {cost}',{cost:quoteReady?observed.costLabel:'—'})}</button>
      <div id={'studio-prepare-reason-'+group} role="status" className={blocker?'prepare-blocker':''}>
        <p>{t(blocker||(!quickAvailable?'STUDIO_QUICK_EXTENSION_REQUIRED':!topologyAvailable?'STUDIO_TOPOLOGY_EXTENSION_REQUIRED':!nativeAvailable?'STUDIO_QUAD_EXTENSION_RELOAD_REQUIRED':quoteExpired?'STUDIO_QUOTE_EXPIRED':quoteReady?'Ready: upload and generation in one step.':error||failure?'Operation needs attention':'Reading the price from Studio…'))}</p>
        {blocker==='PREPARE_REVIEW'&&<button className="button secondary" onClick={onReview}>{t('Review selected views')}</button>}
        {connected&&['PREPARE_ADAPTER','PREPARE_PERMISSION','PREPARE_PAIR','PREPARE_TAB','PREPARE_HEARTBEAT','PREPARE_CAPABILITY','PREPARE_STATUS_ERROR'].includes(blocker)&&<button className="button secondary" onClick={onConnections}>{t('Connection details')}</button>}
        {blocker==='PREPARE_WORKSPACE'&&<a className="button secondary" href="https://studio.tripo3d.ai/workspace/generate" target="_blank" rel="noreferrer">{t('Open supported workspace')}</a>}
      </div>
      {quickAvailable&&topologyAvailable&&connected&&!blocker&&(quoteExpired||obsoleteTopology||operation?.status==='failed')&&<button className="button secondary" disabled={busy} onClick={()=>perform('/quote',{group})}>{t('Refresh price')}</button>}
    </>}
    {active&&<p role="status"><LoaderCircle className="spin" size={16}/> {t(operation.quoteOnly?'Reading the price from Studio…':operation.includesPreparation?'Uploading views and generating four models…':'Preparing or checking the selected tab…')}</p>}
    {operation?.type==='submit'&&operation.status==='succeeded'&&operation.confirmedTaskId&&<p role="status">{t('Submission sent once. Tracking this generation only.')}</p>}
    {((operation?.type==='submit'&&operation.status==='succeeded'&&!operation.candidates)||operation?.discoveryFor)&&<div role="status"><p>{t(status?.adapter?.automaticCandidatesVersion===1?'Identifying the four new models automatically…':'STUDIO_AUTOMATIC_IDS_EXTENSION_REQUIRED')}</p>{operation?.status==='failed'&&<button className="button secondary" disabled={busy||!connected} onClick={()=>perform('/discover-candidates',{operationId:operation.discoveryFor||operation.id})}>{t('Retry automatic identification')}</button>}</div>}
    {operation?.type==='monitor'&&operation.result?.stage==='processing'&&<p role="status">{t('Checking generation progress…')} {Number.isFinite(operation.result.progress)?`${operation.result.progress}%`:''}</p>}
    {completed&&!Number.isInteger(operation.candidateIndex)&&<div className="studio-bridge-actions"><ShieldCheck size={18}/><strong>{t('Model ready in Studio')}</strong><button className="button primary" disabled={busy||!connected} onClick={()=>perform('/export',{operationId:operation.id})}><Download size={15}/>{t('Save GLB to this project')}</button></div>}
    {saved&&<div className="studio-bridge-actions"><ShieldCheck size={18}/><strong>{t('Model saved locally')}</strong><a className="button primary" href={saved.sourceTopology?.asset?.url||saved.url} download><Download size={15}/>{t(saved.sourceTopology?'Download FBX':'Download GLB')}</a></div>}
    {batchHasFailedCandidates(operation)&&<div role="status"><p>{t('Tripo reported generation failures. Valid models are preserved. No retry has been sent.')}</p><p>{t('To retry, request a fresh quote. This creates a new batch of four and keeps the saved candidates. Generation requires separate cost approval.')}</p><button className="button secondary" disabled={busy||!connected||!enabled} onClick={()=>perform('/quote',{group})}>{t('Check price for a new batch of four')}</button></div>}
    {operation?.verificationFor&&operation.result?.reason&&<p role="status">{t(operation.result.reason)}</p>}
    {(error||failure||operation?.status==='unknown'||operation?.result?.stage==='unknown')&&<div role="alert" className="error-text"><TriangleAlert size={17}/><strong>{t('Operation needs attention')}</strong><p>{t(message(error||failure||'STUDIO_NO_TRACKED_GENERATION'))}</p>{!['prepare','observe'].includes(operation?.type)&&<p>{t('Do not submit again until you check Studio. A lost response does not prove the paid request failed.')}</p>}</div>}
    {operation&&!operation.quoteOnly&&['unknown','failed','succeeded'].includes(operation.status)&&(operation.type!=='prepare'||operation.status!=='succeeded')&&!saved&&<details>
      <summary>{t('Stop local tracking')}</summary><label className="consent"><input type="checkbox" checked={stopConsent} onChange={event=>setStopConsent(event.target.checked)}/><span>{t('I checked Studio. Closing local tracking does not cancel its task or refund credits. I will verify the remote result before any new generation.')}</span></label>
      <button className="button secondary" disabled={busy||!stopConsent} onClick={()=>perform('/stop-tracking',{operationId:operation.id,confirmStopTracking:true})}>{t('Stop local tracking')}</button>
    </details>}
    {operation?.status==='abandoned'&&<><p>{t('Local tracking closed. The Studio task was not cancelled.')}</p><button className="button secondary" onClick={()=>{setOperation(null);}}>{t('Prepare again')}</button></>}
    <div className="studio-bridge-actions">
      {batchSummary&&<p role="status">{t('Existing candidates: {saved}/{total} saved locally.',{saved:batchSummary.candidates.filter(c=>c.modelId).length,total:batchSummary.candidates.length})}</p>}
      {candidateBatch&&!active&&<button className="button secondary" disabled={busy||!connected} onClick={()=>perform('/verify-candidates',{operationId:candidateBatch.id})}>{t('Check failures in Tripo')}</button>}
      {candidateBatch&&!active&&<button className="button secondary" disabled={busy||!connected} onClick={()=>perform('/monitor',{operationId:candidateBatch.id})}>{t('Resume candidate downloads')}</button>}
      {operation&&<button className="button subtle" disabled={busy} onClick={()=>candidateBatch&&!active&&connected?perform('/monitor',{operationId:candidateBatch.id}):refreshOperation()}>{t('Refresh status')}</button>}
      {operation?.type==='submit'&&operation.status==='succeeded'&&operation.confirmedTaskId&&<button className="button secondary" disabled={busy||!connected} onClick={()=>perform('/monitor',{operationId:operation.id})}>{t('Check the same generation')}</button>}
      <a className="button subtle" href="https://studio.tripo3d.ai/workspace/generate" target="_blank" rel="noreferrer"><ExternalLink size={14}/>{t('Open Tripo Studio')}</a>
    </div>
  </section>;
}

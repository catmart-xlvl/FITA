import React,{useEffect,useRef,useState} from 'react';
import {useI18n} from './i18n';
import {chosenModel} from './project-navigation';
import Viewer from './Viewer';
import {ArtistCanvas} from './ArtistWorkspace';
import {workflowText} from './studio-workflow-locales';
import {useStudio} from './StudioConnection';
import {preparationBlocker} from './studio-readiness';
import Segmentation from './Segmentation';
import TextureRefinement from './TextureRefinement';
import {segmentationText} from './segmentation-locales';
import {textureProgress} from './texture-progress';

const errorText=(language,t,error)=>workflowText(language,error)!==error?workflowText(language,error):t(error);
const sameSettings=(a,b)=>!!a&&!!b&&a.resolution===b.resolution&&typeof a.removeLighting==='boolean'&&a.removeLighting===b.removeLighting;

export function Textures({project,request,onProject,onContinue,onConnections}){
  const {t,language}=useI18n(),[data,setData]=useState({operations:[],textures:[],previewPending:true}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [activeGroup,setActiveGroup]=useState('head');
  const [analysisPreview,setAnalysisPreview]=useState(null),[analysisReview,setAnalysisReview]=useState(false);
  const [refinementReview,setRefinementReview]=useState(false);


  const {status, error:connectionError}=useStudio(request),commandPending=useRef(false);
  useEffect(()=>{if(status?.preparationAvailable)setError('');},[status?.preparationAvailable]);
  const previewTexture=[...data.textures].reverse().find(x=>x.group===activeGroup&&x.current),preview=previewTexture||chosenModel(project,activeGroup);
  const previewPending=data.project?.id!==project.id||data.previewPending||project.texturePreviewPending;
  const finishing=textureProgress(data.project?.id===project.id?data.project:project);
  const scopedAnalysis=analysisPreview?.part===activeGroup&&analysisPreview.projectId===project.id?analysisPreview:null;
  const generatedPreview=scopedAnalysis?.generated===true;
  const workingPreview=data.project?.id===project.id&&data.workingPreviews?.find(x=>x.group===activeGroup&&x.preliminary);
  const displayPreview=previewPending?(generatedPreview?scopedAnalysis:workingPreview):(scopedAnalysis||preview);

  const both=['head','body'].every(g=>chosenModel(project,g));
  async function refresh(){const d=await request(`/projects/${project.id}/textures`);setData(d);onProject(d.project);return d;}
  useEffect(()=>{let alive=true;const load=()=>request(`/projects/${project.id}/textures`).then(d=>{if(alive){setData(d);onProject(d.project);}}).catch(e=>{if(alive)setError(e.message);});load();const timer=setInterval(load,2500);return()=>{alive=false;clearInterval(timer);};},[project.id]);
  async function command(route,body){if(commandPending.current)return;commandPending.current=true;setBusy(true);setError('');try{await request(`/projects/${project.id}/textures/${route}`,{method:'POST',body});await refresh();}catch(e){setError(e.message);}finally{commandPending.current=false;setBusy(false);}}
  const pending=data.operations.some(o=>['queued','running'].includes(o.status));
  const activeTexture=[...data.operations].reverse().find(o=>o.group===activeGroup&&o.sourceModelId===chosenModel(project,activeGroup)?.id&&o.type==='submit'&&['queued','running','succeeded'].includes(o.status)&&!o.closedAt&&!data.operations.some(e=>e.submissionId===o.id&&e.assetId));
  const textureInterrupted=activeTexture&&['failed','unknown'].includes(data.operations.filter(o=>o.submissionId===activeTexture.id).at(-1)?.status);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(!activeTexture)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[activeTexture?.id]);
  const remaining=activeTexture?.estimate?Math.max(0,Math.ceil(activeTexture.estimate.seconds-(now-Date.parse(activeTexture.estimate.observedAt))/1000)):null;
  const progress=activeTexture&&!textureInterrupted?data.operations.some(o=>o.submissionId===activeTexture.id&&o.type==='export')?t('Downloading texture…'):remaining===null?t('Texturing in Studio…'):remaining>0?t('Studio estimate: {seconds}s remaining',{seconds:remaining}):t('Estimate elapsed. Waiting for Studio…'):null;
  return <section className="finishing"><h2>{t('Textures')}</h2>
    <ArtistCanvas title={t(activeGroup==='head'?'Head':'Body')} subtitle={generatedPreview?segmentationText(language,'generatedPreview'):previewPending&&workingPreview?segmentationText(language,'workingPreview'):previewPending?segmentationText(language,finishing?.title||'previewPendingTitle'):t(previewTexture?'Texture preview':'Geometry preview')}>{previewPending&&!displayPreview?<Viewer url={preview?.url} hologram processing={segmentationText(language,finishing?.title||'previewPendingTitle')}/>:displayPreview?.url?<Viewer url={displayPreview.url} colorLabels={scopedAnalysis?.colorLabels===true&&!previewPending} processing={progress}/>:<div className="canvas-empty"><p>{t('No local model for this part yet.')}</p></div>}</ArtistCanvas>
    <Segmentation {...{project,request,activeGroup}} partSelector={<div className="part-switch" role="tablist" aria-label={t('Textures')}>{['head','body'].map(g=><button role="tab" aria-selected={activeGroup===g} key={g} onClick={()=>{setActiveGroup(g);setAnalysisPreview(null);}}>{t(g==='head'?'Head':'Body')}{data.textures.some(x=>x.group===g&&x.current)&&<span> ✓</span>}</button>)}</div>} onPreview={value=>setAnalysisPreview(value?{...value,part:activeGroup,projectId:project.id}:null)} onReviewRequired={setAnalysisReview}/>
    {generatedPreview&&<p className="info-strip" role="status">{segmentationText(language,'generatedPreview')}</p>}
    {!generatedPreview&&previewPending&&workingPreview&&<p className="info-strip" role="status">{segmentationText(language,'workingPreview')}</p>}

    <TextureRefinement {...{project,request}} onReviewRequired={setRefinementReview}/>
    <details className="whole-part-texture" open={pending||!!activeTexture||undefined}><summary>{segmentationText(language,'legacy')}</summary>{['head','body'].map(group=><TexturePart key={group+project.groups[group].selectedModelId} {...{group,project,data,command,status,connectionError,onConnections,error}} hidden={activeGroup!==group} busy={busy||pending} disabled={!both}/>)}</details>
    <button className="button primary" disabled={analysisReview||refinementReview||!['head','body'].every(g=>data.textures.some(x=>x.group===g&&x.current))} onClick={onContinue}>{t('Continue to placement')}</button>
  </section>;
}
function TexturePart({group,project,data,command,busy,disabled,hidden,status,connectionError,onConnections,error}){
  const {t,language}=useI18n(),model=chosenModel(project,group),records=data.operations.filter(o=>o.group===group&&o.sourceModelId===model?.id&&o.fingerprint===project.viewSetFingerprints?.[group]);
  const latest=records.at(-1),prepared=latest&&['prepare','observe'].includes(latest.type)&&latest.status==='succeeded'&&latest.result?.preparationReady&&!latest.consumedAt?latest:null;
  const actionError=error||(!busy&&(latest?.error||latest?.importError));
  const [settings,setSettings]=useState(()=>{
    const previous=[...project.textureOperations||[]].reverse().find(o=>o.group===group&&o.sourceModelId===model?.id);
    // Preserve an unfinished operation; a completed texture starts a new draft.
    return {resolution:'2K',...previous?.settings,removeLighting:previous&&!previous.assetId&&!previous.closedAt?previous.settings?.removeLighting??false:false};
  }),[taskId,setTaskId]=useState('');
  const submission=[...records].reverse().find(o=>o.type==='submit'&&!o.closedAt),monitor=[...records].reverse().find(o=>o.type==='monitor'&&o.submissionId===submission?.id),texture=[...data.textures].reverse().find(x=>x.group===group&&x.current);
  const tracked=submission&&!records.some(r=>r.type==='export'&&r.submissionId===submission.id&&r.assetId);
  useEffect(()=>{if(latest?.assetId&&!tracked)setSettings(current=>({...current,removeLighting:false}));},[latest?.assetId,!!tracked]);
  const activePreparation=[...data.operations].reverse().find(o=>['prepare','observe'].includes(o.type));
  const quote=!busy&&prepared&&activePreparation?.id===prepared.id&&sameSettings(prepared.settings,settings)&&sameSettings(prepared.result.options?.texture,settings)?prepared:null;
  const blocker=preparationBlocker({project,group,status,connectionError,busy,active:!!tracked,uploadConsent:true});
  const connectionBlocked=blocker&&['PREPARE_PAIR','PREPARE_HEARTBEAT','PREPARE_TAB','PREPARE_ADAPTER','PREPARE_PERMISSION','PREPARE_WORKSPACE','PREPARE_CAPABILITY','PREPARE_STATUS_ERROR'].includes(blocker);
  const change=next=>{setSettings(next);if(quote&&!blocker&&!tracked)command('quote',{operationId:quote.id,settings:next});};
  return <section className="texture-part" hidden={hidden}><h3>{t(group==='head'?'Head':'Body')}</h3>
    <label>{t('Texture resolution')}<select disabled={busy||disabled||!!tracked} value={settings.resolution} onChange={e=>change({...settings,resolution:e.target.value})}>{['2K','4K','8K'].map(v=><option key={v}>{v}</option>)}</select></label>
    <label><input type="checkbox" checked={settings.removeLighting} disabled={busy||disabled||!!tracked} onChange={e=>change({...settings,removeLighting:e.target.checked})}/>{t('Remove lighting')}</label>
    <p role="status">{t('Current Studio cost')}: <strong>{quote?quote.result.costLabel+' '+t('credits'):t(busy?'Checking Studio…':'Prepare this part to read its price.')}</strong></p>
    {blocker&&<div className="texture-action-notice" role="status"><strong>{t(connectionBlocked?'Studio connection required':'Preparation status')}</strong><p>{workflowText(language,blocker)}</p>{connectionBlocked&&<button className="button secondary" onClick={onConnections}>{t('Open connection settings')}</button>}</div>}
    <button className="button secondary" disabled={disabled||!!blocker} aria-busy={busy} onClick={()=>command('prepare',{group,settings,confirmUpload:true})}>{t(busy?'Preparing texture references…':texture?'Prepare retexturing':'Prepare texture references')}</button>
    {actionError&&<div className="texture-action-notice error" role="alert"><strong>{t('Preparation could not continue')}</strong><p>{errorText(language,t,actionError)}</p></div>}
    {quote&&!tracked&&!blocker&&<><p role="status">{t('References and settings verified. Ready to create textures.')}</p><button className="button primary" disabled={busy||disabled} onClick={()=>command('submit',{operationId:quote.id,confirmCost:true,expectedCost:quote.result.costLabel,autoTrack:true})}>{t(texture?'Retexture':'Create textures')} · {settings.resolution} · {quote.result.costLabel} {t('credits')}</button></>}
    {latest&&!actionError&&<p role="status">{t(latest.assetId?'Current texture saved':tracked&&latest.status==='succeeded'?'Texturing in Studio…':latest.status)}</p>}
    {tracked&&submission.status==='succeeded'&&!submission.taskId&&<div><p>{t('Confirm the new texture task shown in Studio. Do not select the original model task.')}</p><input aria-label={t('Texture task ID')} value={taskId} onChange={e=>setTaskId(e.target.value)} placeholder={submission.result?.candidateTaskId||'UUID'}/><button disabled={busy||!taskId.trim()} onClick={()=>command('confirm-task',{operationId:submission.id,taskId:taskId.trim(),confirmTask:true})}>{t('Confirm task')}</button></div>}
    {tracked&&submission.autoTrack&&<p role="status">{t('Progress, download and import are automatic. Keep Studio connected.')}</p>}
    {tracked&&submission.taskId&&(!submission.autoTrack||latest?.error||latest?.importError)&&<button disabled={busy} onClick={()=>command('monitor',{operationId:submission.id})}>{t('Check texture progress')}</button>}
    {tracked&&!submission.autoTrack&&monitor?.result?.stage==='ready'&&<button disabled={busy} onClick={()=>command('export',{operationId:monitor.id})}>{t('Download textured GLB')}</button>}
    {tracked&&['succeeded','failed','unknown'].includes(submission.status)&&<button disabled={busy} onClick={()=>command('close',{operationId:submission.id,confirmStopTracking:true})}>{t('Stop local tracking')}</button>}
    {texture&&<a className="button secondary" href={texture.url} download>{t('Download textured GLB')}</a>}
  </section>;
}
export {default as Placement} from './ManualPlacement';

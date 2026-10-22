import React,{useEffect,useMemo,useState} from 'react';
import {Download,Upload,FolderOpen,RefreshCw,ExternalLink,PersonStanding,Smile} from 'lucide-react';
import {ArtistCanvas} from './ArtistWorkspace';
import {useI18n} from './i18n';
import Viewer from './Viewer';
import RigWeightEditor from './RigWeightEditor';
import AvatarDelivery from './AvatarDelivery';
import './rigging.css';

export default function Rigging(props){
  const {t}=useI18n(),[section,setSection]=useState('body');
  // Folder-style tabs: the active tab joins the panel that holds all of its controls.
  const sections=[['body',PersonStanding,'Body rig','Bones and weights'],['face',Smile,'Facial expressions','Blinks and gestures']];
  const move=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const next=section==='body'?'face':'body';setSection(next);document.getElementById('rig-tab-'+next)?.focus();};
  return <div className={'rig-sections is-'+section}>
    <div className="rig-section-tabs" role="tablist" aria-label={t('Rigging')}>{sections.map(([id,Icon,label,hint])=><button key={id} id={'rig-tab-'+id} role="tab" aria-selected={section===id} aria-controls="rig-section-panel" tabIndex={section===id?0:-1} onKeyDown={move} onClick={()=>setSection(id)}><Icon size={18}/><span><strong>{t(label)}</strong><small>{t(hint)}</small></span></button>)}</div>
    <div className="rig-section-panel" id="rig-section-panel" role="tabpanel" aria-labelledby={'rig-tab-'+section}>{section==='body'?<BodyRigging {...props}/>:<AvatarDelivery {...props}/>}</div>
  </div>;
}
function BodyRigging({project,request}){
  const {t}=useI18n(),root=`/projects/${project.id}/rigging/refinement`;
  const [data,setData]=useState(null),[legacy,setLegacy]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[view,setView]=useState('character'),[selected,setSelected]=useState('');
  const [manualId,setManualId]=useState('');
  async function load(){let state=await request(root);if(state.donor&&!state.runs.some(r=>r.current))state=await request(root+'/prepare',{method:'POST',body:{}});state.manualEdits=(await request(`/projects/${project.id}/rigging/manual`)).edits;return state;}
  useEffect(()=>{let alive=true;setData(null);setSelected('');setManualId('');setView('character');setError('');(async()=>{try{const state=await load(),old=await request(`/projects/${project.id}/rigging`);if(alive){setData(state);setLegacy(old.runs);const r=[...state.runs].reverse().find(r=>r.current),manual=state.manualEdits.filter(e=>e.current).at(-1);setSelected(r?.id||'');if(manual){setManualId(manual.id);setView('manual');}else if(r?.preview)setView('result');}}catch(e){if(alive)setError(e.message);}})();return()=>{alive=false;};},[project.id]);
  useEffect(()=>{if(!['preparing','running'].includes(data?.studioJob?.stage))return;let alive=true;const timer=setTimeout(async()=>{try{const state=await load();if(alive){setData(state);setSelected(s=>s||state.runs.at(-1)?.id||'');}}catch(e){if(alive)setError(e.message);}},2500);return()=>{alive=false;clearTimeout(timer);};},[data]);
  const run=data?.runs.find(r=>r.id===selected),old=legacy.find(r=>r.id===selected),job=data?.studioJob;
  const manual=data?.manualEdits?.find(e=>e.id===manualId)||data?.manualEdits?.filter(e=>e.current).at(-1);
  const preview=view==='manual'?manual?.asset.url:view==='donor'?data?.donor.asset.url:view==='result'?run?.preview?.url:view==='legacy'?old?.preview?.url:data?.source?.preview?.url;
  const configKey=JSON.stringify(view==='manual'?manual?.runtime||{}:view==='donor'?{humanoid:data?.donor.profile.humanoid}:run?.runtime||{}),rigConfig=useMemo(()=>JSON.parse(configKey),[configKey]);
  const editSource=view==='legacy'?null:view==='manual'&&manual?.current?{kind:'manual',id:manual.id}:view!=='donor'&&run?.current&&run?.preview?{kind:'result',id:run.id,version:run.version}:data?.donor?{kind:'donor',id:data.donor.id}:null;
  const running=['preparing','running'].includes(job?.stage),canSend=data?.studio?.controlAvailable&&data?.studio?.automationAuthorized&&data?.studio?.adapter?.rigWorkflowVersion===1;
  async function action(fn){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const refresh=()=>action(async()=>{const state=await load();setData(state);setSelected(s=>s||state.runs.at(-1)?.id||'');});
  const studio=command=>action(async()=>{await request(root+'/studio/'+command,{method:'POST',body:command==='submit'?{confirmCost:true,quoteToken:job.quoteToken,expectedCost:job.costLabel}:{}});setData(await load());});
  const importDonor=file=>action(async()=>{const body=new FormData();body.append('file',file);await request(root+'/donor',{method:'POST',body});const state=await load();setData(state);setSelected(state.runs.at(-1)?.id||'');setView('donor');});
  const importResult=()=>action(async()=>{setData(await request(root+`/runs/${run.id}/import`,{method:'POST',body:{}}));setView('result');});
  return <section className="finishing rigging-panel">
    <ArtistCanvas title={t('Rigging')} subtitle={t(view==='manual'?'Manual weight edit':view==='donor'?'Rig donor · reference only':view==='result'?'Review the weighted character in motion':'Original character')}><Viewer url={preview} rigControls={view!=='character'} rigConfig={rigConfig}/></ArtistCanvas>
    <div className="rigging-tabs" role="group" aria-label={t('Rig preview')}>
      {['character',...(data?.donor?['donor']:[]),...(run?.preview?['result']:[]),...(manual?['manual']:[])].map(value=><button key={value} className={'button secondary'+(view===value?' active':'')} aria-pressed={view===value} onClick={()=>setView(value)}>{t({character:'Original character',donor:'Rig donor · reference only',result:'Refined original',manual:'Manual weight edit'}[value])}</button>)}
    </div>
    {!data&&<p role="status">{t('Loading…')}</p>}
    {data&&!data.eligible&&<p>{t('Finish placement before preparing the rigging workspace.')}</p>}
    {data?.eligible&&<>
      <div className="codex-handoff"><h3>{t('1. Rig in Tripo Studio')}</h3>
        <span className="pill">Unity Humanoid compatible</span>
        <div><button className="button primary" disabled={busy||running||!canSend} onClick={()=>studio('prepare')}><Upload size={16}/>{t('Send character to Tripo')}</button><button className="button secondary" disabled={busy} onClick={refresh}><RefreshCw size={15}/>{t('Refresh status')}</button></div>
        {!canSend&&<p>{t(data.studio?.connected?'Reload the extension to enable the Rigging workflow.':'Connect the Tripo tab in the extension to send this character.')}</p>}
        {running&&<p role="status">{t(job.stage==='preparing'?'Uploading and checking the rig settings…':'Rigging and downloading in Tripo…')}</p>}
        {job?.stage==='quoted'&&<button className="button primary" disabled={busy} onClick={()=>studio('submit')}>{t('Confirm rigging · {credits} credits',{credits:job.costLabel})}</button>}
        {job?.stage==='attention'&&<><p role="alert">{t(job.error)}</p>{(job.taskId||job.action==='prepare')&&<button className="button secondary" disabled={busy||!canSend} onClick={()=>studio('check')}>{t(job.action==='prepare'?'Resume upload and rig setup':'Check existing rig job')}</button>}</>}
        <details><summary>{t('Import an existing Tripo result')}</summary><label className={'button secondary'+(busy||running?' disabled':'')}><Upload size={15}/>{t('Import donor GLB')}<input type="file" accept=".glb" disabled={busy||running} hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)importDonor(file);}}/></label><a className="button secondary" href={data.source.preview.url} download><Download size={15}/>{t('Download original')}</a><a className="button secondary" href="https://studio.tripo3d.ai" target="_blank" rel="noreferrer"><ExternalLink size={15}/>{t('Open Tripo Studio')}</a></details>
        {data.donor&&<p title={data.donor.filename}>{t('{count} bones',{count:data.donor.profile.validation.bones})}</p>}
      </div>
      <div className="codex-handoff"><h3>{t('2. Transfer and refine with Codex')}</h3>
        {run?.current?<><a className="button primary" href={`/api${root}/runs/${run.id}/package`} download><Download size={16}/>{t('Download refinement ZIP')}</a><button className="button secondary" disabled={busy} onClick={importResult}><RefreshCw size={16}/>{t('Load refined result')}</button><details className="rig-workspace"><summary><FolderOpen size={14}/>{t('Local workspace')}</summary><code>{run.workspace}</code></details></>:<p>{t('The refinement ZIP becomes available after receiving the donor rig.')}</p>}
      </div>
    </>}
    {run?.preview&&<div className="rigging-result"><a className="button secondary" href={run.preview.url} download>{t('Download model')}</a><a className="button secondary" href={`/api${root}/runs/${run.id}/rigged.blend`} download>{t('Download editable Blender file')}</a><details><summary>{t('Rigging review')}</summary>{[...(run.report?.observations||[]),...(run.report?.limitations||[])].map((note,i)=><p key={i}>{String(note)}</p>)}</details></div>}
    {data?.eligible&&editSource&&<RigWeightEditor projectId={project.id} source={editSource} label={t(editSource.kind==='manual'?'Manual weight edit':editSource.kind==='result'?'Refined original':'Rig donor · reference only')} request={request} onImported={async edit=>{setData(await load());setManualId(edit.id);setView('manual');}}/>}
    {data?.eligible&&view==='manual'&&manual&&<p role="status">{t('Validated manual edit · {count} bones',{count:manual.validation.bones})}{manual.report.addedBones?.length>0?' · '+t('New bones follow their parents. Independent corrective motion needs a runtime setup.'):''}</p>}
    {!!data?.manualEdits?.length&&<details><summary>{t('Manual weight edit')}</summary>{[...data.manualEdits].reverse().map(e=><button key={e.id} className="button secondary" onClick={()=>{setManualId(e.id);setView('manual');}}>{e.filename} · {t(e.current?'Current':'Previous version')}</button>)}</details>}
    <details><summary>{t('Rigging history')}</summary>{[...(data?.runs||[])].reverse().map((r,i)=><button key={r.id} className="button secondary" onClick={()=>{setSelected(r.id);setView(r.preview?'result':'character');}}>{t('Attempt {number}',{number:data.runs.length-i})} · {t(r.current?'Current':'Previous version')}</button>)}{legacy.map((r,i)=><div key={r.id}><span>{t('Previous template workflow')} · {i+1}</span>{r.preview&&<button className="button secondary" onClick={()=>{setSelected(r.id);setView('legacy');}}>{t('Rigged result')}</button>}</div>)}</details>
    {error&&<p role="alert">{t(error)}</p>}
  </section>;
}


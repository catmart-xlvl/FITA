import React,{useEffect,useState} from 'react';
import {Download,RefreshCw,ArrowRight,Check} from 'lucide-react';
import {ArtistCanvas} from './ArtistWorkspace';
import {DetailsLink} from './Help';
import {useI18n} from './i18n';
import Viewer from './Viewer';
import {facialExpressions} from '../shared/facial-profile';
import {loadAvatarState,avatarLoadMessages} from './avatar-state';

export default function AvatarDelivery({project,request,mode='face',onContinue,onProject}){
  const {t}=useI18n(),isFace=mode==='face',root=`/projects/${project.id}/${isFace?'rigging/face':'export/vrchat'}`;
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[values,setValues]=useState({}),[reviewed,setReviewed]=useState(false);
  const [loading,setLoading]=useState(true),[bodyPreview,setBodyPreview]=useState(null);
  const load=()=>loadAvatarState(request,root,project.id);
  useEffect(()=>{let alive=true;setLoading(true);setData(null);setError('');setBodyPreview(null);load().then(result=>{if(alive){setData(result.data);setBodyPreview(result.preview);setError(result.error);}}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[root]);
  const run=data?.run,face=isFace?run:data?.face;
  const preview=face?.preview||data?.bodyPreview?.url||bodyPreview;
  const refresh=()=>action(async()=>{const result=await load();setData(result.data);setBodyPreview(result.preview);if(result.error)throw Error(result.error);return result.data;});
  async function action(fn){if(busy)return;setBusy(true);setError('');try{const next=await fn();setData(next);setReviewed(false);setValues({});if(onProject)onProject(await request('/projects/'+project.id));}catch(e){setError(e.message);}finally{setBusy(false);}}
  const post=(suffix,body={})=>action(()=>request(root+suffix,{method:'POST',body}));
  return <section className="finishing rigging-panel avatar-delivery">
    <ArtistCanvas title={t(isFace?'Facial expressions':'Export for VRChat')} subtitle={t(face?.approval?'Approved facial rig':face?.version?'Review required':'Current character')}><Viewer url={preview} facialPose={isFace?{bindings:face?.bindings,values}:null}/></ArtistCanvas>
    <div className="codex-handoff"><h3>{t(isFace?'3. Anime facial expressions':'Export for VRChat')}</h3>
      {!isFace&&<span className="pill">VRChat · PC</span>}
      {loading&&<p role="status">{t('Loading…')}</p>}
      {data&&!data.eligible&&<p role="status">{t(isFace?'Refine the original body rig before preparing facial expressions.':'Review and approve facial expressions in Rigging first.')}</p>}
      {data?.eligible&&!run&&<>
        {isFace&&<label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>{t('I reviewed the body weights and deformation.')}</label>}
        <button className="button primary" disabled={busy||(isFace&&!reviewed)} onClick={()=>post('/prepare',isFace?{confirmBodyReview:true}:{})}>{t(isFace?'Prepare facial handoff':'Prepare VRChat export')}</button>
      </>}
      {run&&<>
        <a className="button primary" href={`/api${root}/runs/${run.id}/package`} download><Download size={16}/>{t(isFace?'Download facial instructions ZIP':'Download VRChat instructions ZIP')}</a>
        <p className="delivery-notice" role="status">{t('Give this ZIP to your Codex to continue this project.')}</p>
        <button className="button secondary" disabled={busy} onClick={()=>post(`/runs/${run.id}/${isFace?'import':'report'}`)}><RefreshCw size={15}/>{t(isFace?'Load facial result':'Load delivery report')}</button>
        <DetailsLink label={t('Local workspace')} title={t('Local workspace')}><code className="workspace-path">{run.workspace}</code><p>{t('The ZIP contains instructions and exact paths. Project assets stay on this computer.')}</p></DetailsLink>
      </>}
      <DetailsLink label={t('Workflow details')} title={t(isFace?'Facial expressions':'Export for VRChat')}><p>{t(isFace?'Create coordinated shape keys for eyelids, lashes, eyes, brows and anime lip motion. Body bones and weights stay unchanged. Review intermediate poses and combinations before approval.':'Codex prepares the Unity avatar, materials, facial controls and physics, checks the SDK, and guides Build & Test and the VRChat test. Publishing requires your authorization. A downloaded ZIP is not a published avatar.')}</p></DetailsLink>
    </div>
    {isFace&&run?.version&&<div className="codex-handoff"><h3>{t('Review facial motion')}</h3>
      <button className="button secondary" onClick={()=>setValues({})}>{t('Reset expressions')}</button>
      <div className="face-sliders">{facialExpressions.filter(e=>e!=='vrc.v_sil').map(name=><label key={name}><span>{t(name)}</span><input type="range" aria-label={t(name)} min="0" max="1" step=".05" value={values[name]||0} onChange={e=>setValues(v=>({...v,[name]:Number(e.target.value)}))}/><output>{Math.round((values[name]||0)*100)}%</output></label>)}</div>
      <DetailsLink label={t('Review notes')}><ul>{(run.report?.limitations||[]).map((v,i)=><li key={i}>{String(v)}</li>)}</ul><p>{t('Structural checks do not replace a visual review.')}</p></DetailsLink>
      {!run.approval?<><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>{t('I reviewed blinks, gaze, brows, visemes and their combinations from several angles.')}</label><button className="button primary" disabled={busy||!reviewed} onClick={()=>post(`/runs/${run.id}/approve`,{confirm:true,version:run.version})}><Check size={15}/>{t('Approve facial expressions')}</button></>:<p role="status">{t('Approved facial rig')}</p>}
      {run.approval&&<button className="button primary" onClick={onContinue}><ArrowRight size={15}/>{t('Continue to Export')}</button>}
    </div>}
    {!isFace&&run?.report&&<div className="codex-handoff"><h3>{t('Reported delivery milestones')}</h3><p>{t('These are the results reported by Codex; pending checks remain pending.')}</p><ul>{run.report.checks.map(c=><li key={c.id}><strong>{t(c.id)}</strong> · {t(c.status)}<p>{c.notes}</p></li>)}</ul><DetailsLink label={t('Review notes')}><code className="workspace-path">{run.report.unityProject}</code>{run.report.limitations.map((v,i)=><p key={i}>{String(v)}</p>)}</DetailsLink></div>}
    <button className="button secondary" disabled={busy||loading} onClick={refresh}><RefreshCw size={15}/>{t('Refresh status')}</button>
    {busy&&<p role="status">{t('Loading…')}</p>}{error&&<p role="alert">{t(avatarLoadMessages[error]||error)}</p>}
  </section>;
}

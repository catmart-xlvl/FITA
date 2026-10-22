import React,{useEffect,useRef,useState} from 'react';
import {useI18n} from './i18n';
import {segmentationText,segmentationCopy} from './segmentation-locales';
import {DetailsLink} from './Help';
export default function TextureRefinement({project,request,onReviewRequired}){
 const {language}=useI18n(),s=(key,args)=>segmentationText(language,key,args),root=`/projects/${project.id}/texture-refinement`;
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reviewed,setReviewed]=useState(false),lock=useRef(false);
 useEffect(()=>{let live=true;const load=()=>request(root).then(d=>{if(live)setData(d);}).catch(e=>{if(live)setError(e.message);});load();const timer=setInterval(load,3000);return()=>{live=false;clearInterval(timer);};},[project.id]);
 useEffect(()=>{onReviewRequired(!!data?.required);},[data?.required]);
 useEffect(()=>setReviewed(false),[data?.current?.id,project.id]);
 async function command(route,body={}){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const result=await request(root+'/'+route,{method:'POST',body});setData(await request(root));return result;}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}}
 async function download(){const d=await command('package',{renew:data?.delivery?.status==='expired'});if(d?.downloadUrl){const a=document.createElement('a');a.href=d.downloadUrl;a.download='fita_texture_refinement.zip';document.body.appendChild(a);a.click();a.remove();}}
 async function upload(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;const form=new FormData();form.set('file',file);await command('import',form);}
 if(!data?.eligible&&!data?.waitingForSegments)return null;
 return <section className="segmentation-panel"><div className="seg-heading"><span className="seg-number">03</span><h3>{s('refineTitle')}</h3></div>
  <DetailsLink label={s('finishingHelpTitle')}><p className="popup-text">{s('finishingHelp')}</p></DetailsLink>
  {data.waitingForSegments?<p role="status">{s(data.planStatus==='ready-to-finish'?'supervisedFinish':'REFINE_SEGMENTS_PENDING')}</p>:data.current?<p role="status">{s(data.current.reviewRequired?'refineReceived':'refineApproved')}</p>:<p role="status">{s('refineWaiting')}</p>}
  {!data.supervised&&<><button className="button primary" disabled={busy||!data.eligible} onClick={download}>{s(data.delivery?.status==='expired'?'refineRenew':'refineDownload')}</button>
  <details><summary>{s('manualImport')}</summary><label className="button secondary codex-upload">{s('import')}<input type="file" accept=".zip" disabled={busy||!data.eligible} onChange={upload}/></label></details></>}
  {data.current?.reviewRequired&&<div className="seg-approval"><label><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>{s('refineReview')}</label><button className="button primary" disabled={busy||!reviewed} onClick={()=>command('approve',{id:data.current.id,confirm:reviewed})}>{s('acceptResult')}</button></div>}
  {error&&<p className="error" role="alert">{segmentationCopy[error]?s(error):s('genericError',{code:error})}</p>}
 </section>;
}

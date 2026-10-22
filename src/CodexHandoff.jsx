import React,{useEffect,useState} from 'react';
import {Download,Upload,PackageOpen,LoaderCircle,Lock} from 'lucide-react';
import {useI18n} from './i18n';
import {HelpLink} from './Help';

// locked: presentation-only gate until the reference passes validation.
export default function CodexHandoff({project,request,disabled,notesDirty,onImport,locked=false,lockReason=''}) {
  const {t,message}=useI18n(),[handoff,setHandoff]=useState(null),[error,setError]=useState(''),[replace,setReplace]=useState(false),[loading,setLoading]=useState(false),[downloadUrl,setDownloadUrl]=useState(null);
  const base=`/projects/${project.id}/codex`;
  const ready=project.referenceState?.status==='ready'&&project.referenceState.referenceId===project.reference?.id;
  const existing=['head','body'].some(g=>Object.keys(project.groups[g].views).length);
  useEffect(()=>{
    let live=true;setHandoff(null);setError('');setReplace(false);setDownloadUrl(null);
    const refresh=()=>request(base).then(data=>{if(live)setHandoff(data);}).catch(e=>{if(live)setError(e.message);});
    let timer;if(ready){refresh();timer=setInterval(refresh,3000);}
    return()=>{live=false;clearInterval(timer);};
  },[base,ready,project.reference?.id,project.notesRevision]);
  async function downloadPackage(renew=false){
    setLoading(true);setError('');
    try{
      const result=await request(base+'/delivery',{method:'POST',body:{replace,renew:renew===true}});
      setHandoff(current=>({...current,delivery:result.delivery}));setDownloadUrl(result.downloadUrl);
      const link=document.createElement('a');link.href=result.downloadUrl;link.download='fita_concept.zip';link.click();
    }catch(e){setError(e.message);}finally{setLoading(false);}
  }
  async function revokeDelivery(){try{const result=await request(base+'/delivery/revoke',{method:'POST',body:{}});setHandoff(current=>({...current,delivery:result.delivery}));setDownloadUrl(null);}catch(e){setError(e.message);}}
  async function importFile(e){
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    setLoading(true);setError('');
    try{if(file.size>150*1024*1024)throw new Error('The ZIP must be smaller than 150 MB.');await onImport(file,replace);setReplace(false);}
    catch(e){setError(e.message);}finally{setLoading(false);}
  }
  const blocked=disabled||loading||notesDirty||!handoff;
  if(locked)return <section className="codex-handoff is-locked" aria-disabled="true">
    <div className="reference-step-label"><PackageOpen size={15}/> CODEX</div>
    <h2>{t('Create views with Codex')}</h2>
    <p className="codex-lock"><Lock size={14}/>{t(lockReason)}</p>
  </section>;
  return <section className="codex-handoff is-open">
    <div className="reference-step-label"><PackageOpen size={15}/> CODEX</div>
    <h2>{t('Create views with Codex')}</h2>
    <div className="codex-view-map"><span>{t('Body')}<b>4</b></span><span>{t('Head')}<b>4</b></span><span>{t('Placement guides')}<b>2</b></span></div>
    <HelpLink topic="codex"/>
    {!ready&&<p className="codex-status">{t('Confirm the reference before preparing a Codex package.')}</p>}
    {notesDirty&&<p className="codex-status">{t('Save your design notes before copying or importing.')}</p>}
    <div className="codex-instructions">
        {existing&&<label className="codex-replace"><input type="checkbox" checked={replace} disabled={disabled||loading} onChange={e=>setReplace(e.target.checked)}/><span>{t('Replace existing views and review again. Previous views and models stay in history.')}</span></label>}
        <button className="button primary" disabled={blocked||(existing&&!replace&&handoff?.delivery?.status!=='waiting')||handoff?.delivery?.status==='expired'} onClick={()=>downloadPackage()}><Download size={15}/>{t(handoff?.delivery?.status==='waiting'?'Download the same package again':'Download concept package')}</button>
        {handoff?.delivery?.status==='expired'&&<button className="button secondary" disabled={blocked||existing&&!replace} onClick={()=>downloadPackage(true)}>{t('Renew delivery authorization')}</button>}
      <p>{t('Attach the ZIP in Codex and ask it to follow INSTRUCTIONS.txt.')}</p>
      <p>{t('Codex returns the finished images to FITA when it has local access.')}</p>
        {['expired','revoked'].includes(handoff?.delivery?.status)&&<small>{t('Keep the generated images. A matching manifest can be delivered with the renewed package without generating again.')}</small>}
        {handoff?.delivery&&<div role="status" className="codex-status" title={t('Current delivery')+': '+handoff.delivery.id+' · '+t('Valid until')+': '+new Date(handoff.delivery.expiresAt).toLocaleString()}><p>{t('Delivery: '+handoff.delivery.status)}</p>{handoff.delivery.lastError&&<p>{message(handoff.delivery.lastError)}</p>}{handoff.delivery.status==='waiting'&&<button className="button subtle" onClick={revokeDelivery}>{t('Revoke automatic delivery')}</button>}</div>}
        <details className="codex-manual"><summary>{t('Import manually')}</summary><label className={'button secondary codex-upload'+(blocked||existing&&!replace?' disabled':'')}>{loading?<LoaderCircle className="spin" size={15}/>:<Upload size={15}/>} {t(loading?'Checking ten images…':'Import views ZIP')}<input type="file" accept=".zip,application/zip" disabled={blocked||existing&&!replace} onChange={importFile}/></label></details>
    </div>
    {error&&<p role="alert" className="codex-status">{message(error)}</p>}
  </section>;
}

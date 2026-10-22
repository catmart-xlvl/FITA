import React, { useEffect, useState } from 'react';
import { ExternalLink, Plug, ShieldCheck } from 'lucide-react';
import { useI18n } from './i18n';
import { HelpLink } from './Help';
import { studioText } from './studio-locales';

const studioUrl = 'https://studio.tripo3d.ai/workspace/generate';
export function useStudio(request) {
  const [status,setStatus] = useState(null), [error,setError] = useState(false), [checkedAt,setCheckedAt]=useState(0);
  useEffect(()=>{
    let active = true;
    const refresh = async()=>{const startedAt=Date.now();try {const value=await request('/studio/status'); if(active){setStatus(value);setCheckedAt(startedAt);setError(false);}} catch {if(active)setError(true);}};
    refresh(); const timer=setInterval(refresh,3000);
    return ()=>{active=false;clearInterval(timer);};
  },[request]);
  return {status,setStatus,error,checkedAt};
}
function statusText(status,error) { return error ? 'Connection status unavailable' : !status ? 'Checking connection…' : status.preparationAvailable ? 'Connected · project commands' : status.controlAvailable ? 'Connected · read only' : status.paired ? 'Paired · waiting for tab' : 'Not connected'; }
function StudioLink({t}) {return <a className="button subtle" href={studioUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/>{t('Open Tripo Studio')}</a>;}

export function StudioConnection({request}) {
  const {language,message} = useI18n(), t=(text)=>studioText(language,text);
  const {status,setStatus,error,checkedAt} = useStudio(request);
  const [extensionInfo,setExtensionInfo]=useState({extensionFolder:'FITA Extension'}),[copyStatus,setCopyStatus]=useState('');
  useEffect(()=>{let live=true;request('/distribution/info').then(info=>{if(live&&info.extensionFolder)setExtensionInfo(info);}).catch(()=>{});return()=>{live=false;};},[request]);
  async function copyFolder(){try{await navigator.clipboard.writeText(extensionInfo.extensionFolder);setCopyStatus('Folder path copied');}catch{setCopyStatus('Select and copy the folder path above.');}}
  const [extensionId,setExtensionId]=useState(''),[pairing,setPairing]=useState(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[clock,setClock]=useState(Date.now());
  useEffect(()=>{if(status?.paired)setPairing(null);},[status?.paired]);
  useEffect(()=>{if(!pairing)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[pairing]);
  const expired=!!pairing&&(clock>=Date.parse(pairing.expiresAt)||(!error&&checkedAt>pairing.issuedAt&&status?.pairingExpiresAt!==pairing.expiresAt));
  async function perform(fn){setBusy(true);setFailure('');try{await fn();}catch(e){setFailure(e.message);}finally{setBusy(false);}}
  return <section className="studio-connection">
    <div className="studio-bridge-heading"><div><Plug size={18}/><h3>{t('Browser connection')}</h3></div><span className="pill">{t(statusText(status,error))}</span></div>
    <HelpLink topic="connections"/>
    <StudioLink t={t}/>
    <section className="extension-install" aria-labelledby="extension-install-title"><h4 id="extension-install-title">{t('Install the browser extension once')}</h4>
      <ol><li>{t('In the browser you use for Tripo (Brave, Chrome or Edge), open Extensions and enable Developer mode.')}</li><li>{t('Choose Load unpacked and select FITA Extension beside Open FITA.cmd.')}</li><li>{t('Open the extension popup and pair it below. Allow project commands only when you intend to use them.')}</li></ol>
      <code>{extensionInfo.extensionFolder}</code><button type="button" className="button subtle" onClick={copyFolder}>{t('Copy folder path')}</button>
      {extensionInfo.extensionVersion&&<small>{t('Included extension version')}: {extensionInfo.extensionVersion}</small>}
      {copyStatus&&<small role="status">{t(copyStatus)}</small>}
      <p>{t('After an update, click Reload for the existing extension when idle. Keep this folder in place and do not remove the extension.')}</p>
    </section>
    {!status?.paired && <form onSubmit={e=>{e.preventDefault();perform(async()=>{const value=await request('/studio/pairing',{method:'POST',body:{extensionId:extensionId.trim()}});setPairing({...value,issuedAt:Date.now()});setClock(Date.now());setStatus(current=>({...current,paired:false,extensionId:value.extensionId,pairingExpiresAt:value.expiresAt}));});}}>
      <label htmlFor="extension-id">{t('Extension ID')}</label><input id="extension-id" autoComplete="off" spellCheck={false} value={extensionId} onChange={e=>setExtensionId(e.target.value)} maxLength={32}/>
      <button className="button secondary" disabled={busy||!/^[a-p]{32}$/.test(extensionId.trim())}>{t(expired?'Create a new code':'Create pairing code')}</button>
    </form>}
    {pairing&&<div className="pairing-code" aria-live="polite"><strong aria-disabled={expired}>{expired?'— — — —':pairing.code}</strong><small>{t(expired?'This code expired or is no longer active. Create a new code above and enter it in the extension.':'Code expires in two minutes. Enter it only in the local extension.')}</small></div>}
    {pairing&&!expired&&<div className="pairing-guide"><p>{t('Where to enter this code')}</p><ol><li>{t('In your browser toolbar, open the puzzle-piece Extensions menu and choose FITA · Tripo Studio Bridge.')}</li><li>{t('In its popup, paste this code into step 2, Enter the code shown in FITA, then click Pair.')}</li><li>{t('In step 3, choose your Tripo Studio tab and click Connect selected tab. If it is not listed, open Tripo Studio first.')}</li></ol></div>}
    {status?.paired&&!status?.controlAvailable&&!error&&<p>{t('Pairing succeeded. In the extension popup, choose your Tripo Studio tab in step 3 and click Connect selected tab.')}</p>}
    {(status?.paired||pairing)&&<div className="studio-bridge-actions"><button className="button secondary" disabled={busy||error||!status?.controlAvailable||!!status?.pending} onClick={()=>perform(async()=>setStatus(await request('/studio/inspect',{method:'POST'})))}>{t(status?.pending?'Inspection pending…':'Inspect tab')}</button><button className="button subtle" disabled={busy} onClick={()=>perform(async()=>{setStatus(await request('/studio/connection',{method:'DELETE'}));setPairing(null);})}>{t(status?.rememberedBrowsers?'Disconnect and forget this browser':'Disconnect')}</button></div>}
    {status?.rememberedBrowsers>0&&!error&&<p className="bridge-proof"><ShieldCheck size={16}/>{t('This browser is remembered: it reconnects by itself after restarting FITA or the browser.')}</p>}
    {status?.controlAvailable&&status?.inspection&&!error&&<p className="bridge-proof"><ShieldCheck size={16}/>{t('Tab responded. Sign-in and generation have not been verified.')}</p>}
    {status?.controlAvailable&&!error&&<p className="bridge-limitation">{t(status.preparationAvailable?'Browser commands are available. Paid generation and the complete upload-to-download flow have not been tested with your account.':'This tab is read-only or its Studio page is unsupported. Authorize project commands in the extension and open the Studio generation workspace.')}</p>}
    {(failure||error)&&<p role="alert" className="error-text">{failure?message(failure):t('The local bridge could not be reached. Reload the app and try again.')}</p>}
  </section>;
}
export function StudioGeneration({request,ready,onConnections}) {
  const {language}=useI18n(),t=(text)=>studioText(language,text),{status,error}=useStudio(request);
  return <section className="studio-generation">
    <div className="studio-bridge-heading"><div><Plug size={18}/><h2>{t('Tripo Studio')}</h2></div><span className="pill">{t(statusText(status,error))}</span></div>
    <h3>{t('Use your browser session')}</h3><p>{t(ready?'Views ready. You can download them and work in Tripo Studio, then import the exported GLB here.':'Approve the head and body views before preparing a 3D generation.')}</p>
    <p id="studio-generation-action-help">{t('For now, this button opens browser connection setup. It does not upload images, submit a generation or spend credits.')}</p>
    <div className="studio-bridge-actions"><button className="button primary" disabled={!ready} aria-describedby="studio-generation-action-help" onClick={onConnections}><Plug size={14}/>{t('Generate 3D model')}</button><StudioLink t={t}/></div>
    <small>{t('Opening the website does not connect it to this app.')}</small>
    <p className="bridge-limitation">{t('Browser commands are available. Paid generation and the complete upload-to-download flow have not been tested with your account.')}</p>
    {error&&<p role="alert">{t('The local bridge could not be reached. Reload the app and try again.')}</p>}
  </section>;
}

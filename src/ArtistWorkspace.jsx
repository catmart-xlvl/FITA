import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Maximize2,Minimize2,Scan,Minus,Plus,Image as ImageIcon,Settings2} from 'lucide-react';
import {useI18n} from './i18n';
import Particles from './Particles';

const CanvasContext=createContext(null);
// Recording mode (?grabacion=1): presentation only, for video captures. Hides the completed-stage notice and dimming; controls stay inert.
export const RECORDING=typeof location!=='undefined'&&new URLSearchParams(location.search).has('grabacion');
export function ArtistWorkspace({children,locked=false,onReopen,onContinue,continueLabel}){
  const {t}=useI18n(),[target,setTarget]=useState(null),[focused,setFocused]=useState(false),[confirming,setConfirming]=useState(false),[reopening,setReopening]=useState(false);
  const showLock=locked&&!RECORDING;
  useEffect(()=>{const escape=e=>{if(e.key==='Escape')setFocused(false);};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[]);
  return <CanvasContext.Provider value={target}><div className={'artist-workspace'+(focused?' is-focused':'')}>
    <section className="artist-canvas" aria-label={t('Visual workspace')}>
      <div className="canvas-portal" ref={setTarget}/>
      <Particles className="canvas-particles" density={0.6}/>
      <button className="canvas-focus" aria-pressed={focused} title={t(focused?'Exit focus · Esc':'Focus canvas')} aria-label={t(focused?'Exit focus · Esc':'Focus canvas')} onClick={()=>setFocused(v=>!v)}>{focused?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
    </section>
    <aside className="artist-inspector" aria-label={t('Properties')} hidden={focused}><header className="inspector-heading"><Settings2 size={15}/><strong>{t('Properties')}</strong></header>{showLock&&<div className="stage-lock-notice" role="status"><strong>{t('Stage completed')}</strong><p>{t('This stage is read-only because the project has advanced.')}</p>{onContinue&&<button className="button primary" onClick={onContinue}>{t(continueLabel)}</button>}<button className="button secondary" onClick={()=>setConfirming(true)}>{t('Return to edit this stage')}</button></div>}<div className={showLock?'stage-controls-locked':''} inert={locked?true:undefined}>{children}</div></aside>
    {confirming&&createPortal(<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={t('Return to edit this stage')}><h2>{t('Return to edit this stage')}</h2><p>{t('Return to this stage? All later stages will be removed from the active workflow. This does not refund spent credits.')}</p><div className="view-actions"><button autoFocus className="button secondary" disabled={reopening} onClick={()=>setConfirming(false)}>{t('Cancel')}</button><button className="button primary" disabled={reopening} onClick={async()=>{setReopening(true);try{await onReopen();setConfirming(false);}finally{setReopening(false);}}}>{t('Return to edit this stage')}</button></div></section></div>,document.body)}
  </div></CanvasContext.Provider>;
}
export function ArtistCanvas({children,title,subtitle,strip}){
  const target=useContext(CanvasContext);
  return target?createPortal(<div className="canvas-scene"><header className="canvas-heading"><strong>{title}</strong>{subtitle&&<span>{subtitle}</span>}</header><div className="canvas-content">{children}</div>{strip&&<div className="canvas-strip">{strip}</div>}</div>,target):null;
}
export function ImageCanvas({url,alt,children}){
  const {t}=useI18n(),host=useRef(),drag=useRef(null),[view,setView]=useState({scale:1,x:0,y:0});
  const reset=()=>setView({scale:1,x:0,y:0});
  const zoom=amount=>setView(v=>({...v,scale:Math.max(.25,Math.min(6,v.scale*amount))}));
  useEffect(reset,[url]);
  useEffect(()=>{const element=host.current;if(!element)return;const wheel=e=>{e.preventDefault();setView(v=>({...v,scale:Math.max(.25,Math.min(6,v.scale*Math.exp(-e.deltaY*.001)))}));};element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);},[]);
  return <div className={'image-canvas'+(!url?' is-empty':'')} ref={host} onDoubleClick={reset}
    onPointerDown={e=>{if(!url||e.target.closest('button,a,input,label'))return;drag.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{if(!drag.current)return;const dx=e.clientX-drag.current.x,dy=e.clientY-drag.current.y;drag.current={x:e.clientX,y:e.clientY};setView(v=>({...v,x:v.x+dx,y:v.y+dy}));}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
    {url?<img key={url} src={url} alt={alt} draggable={false} style={{transform:`translate(${view.x}px,${view.y}px) scale(${view.scale})`}}/>:<div className="canvas-empty"><ImageIcon size={44} strokeWidth={1}/>{children||<p>{t('Import or generate this view')}</p>}</div>}
    {url&&<><div className="image-tools"><button aria-label={t('Zoom out')} title={t('Zoom out')} onClick={()=>zoom(1/1.2)}><Minus size={16}/></button><span>{Math.round(view.scale*100)}%</span><button aria-label={t('Zoom in')} title={t('Zoom in')} onClick={()=>zoom(1.2)}><Plus size={16}/></button><button aria-label={t('Fit image')} title={t('Fit image')} onClick={reset}><Scan size={16}/></button></div><small className="image-gesture">{t('Drag to pan · Scroll to zoom · Double-click to fit')}</small></>}
  </div>;
}

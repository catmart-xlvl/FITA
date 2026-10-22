import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CircleHelp,X,Info,List} from 'lucide-react';
import {useI18n} from './i18n';
import {helpTopics} from './help-locales';
import {riggingHelp} from './rigging-locales';
import {exportHelp} from './avatar-locales';

// Small "How does this step work?" link. Explanations live in the dialog, not in the panel.
export function HelpLink({topic,label,className=''}){
  const {t,language}=useI18n(),[open,setOpen]=useState(false);
  const content=topic==='export'?(exportHelp[language]||exportHelp.en):topic==='rigging'?(riggingHelp[language]||riggingHelp.en):(helpTopics[language]||helpTopics.en)[topic]||helpTopics.en[topic];
  return <>
    <button type="button" className={'help-link '+className} onClick={()=>setOpen(true)} aria-haspopup="dialog"><CircleHelp size={14}/><span>{label||t('How does this step work?')}</span></button>
    {open&&content&&<Popup title={content.title} onClose={()=>setOpen(false)}>
      <ol className="help-steps">{content.steps.map((step,i)=><li key={i} style={{'--i':i}}><span>{i+1}</span><p>{step}</p></li>)}</ol>
      {content.notes.length>0&&<ul className="help-notes">{content.notes.map((note,i)=><li key={i}><Info size={14}/><p>{note}</p></li>)}</ul>}
    </Popup>}
  </>;
}

// Secondary information (long lists, explanations) behind a small link.
export function DetailsLink({label,title,children,className=''}){
  const {t}=useI18n(),[open,setOpen]=useState(false);
  return <>
    <button type="button" className={'help-link '+className} onClick={()=>setOpen(true)} aria-haspopup="dialog"><List size={14}/><span>{label||t('View details')}</span></button>
    {open&&<Popup title={title||label||t('View details')} onClose={()=>setOpen(false)}>{children}</Popup>}
  </>;
}

export function Popup({title,onClose,children}){
  const {t}=useI18n(),ref=useRef();
  useEffect(()=>{
    const previous=document.activeElement;ref.current?.focus();
    const key=e=>{
      if(e.key==='Escape'){e.stopPropagation();onClose();}
      if(e.key==='Tab'){const list=ref.current.querySelectorAll('button,a[href],input,select,textarea');const first=list[0],last=list[list.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    };
    document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('keydown',key,true);previous?.focus();};
  },[]);
  return createPortal(<div className="modal-backdrop help-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="modal help-modal">
      <header><h2>{title}</h2><button className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={18}/></button></header>
      {children}
      <div className="modal-actions"><button className="button primary" onClick={onClose}>{t('Got it')}</button></div>
    </section>
  </div>,document.body);
}

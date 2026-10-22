import React,{useEffect,useRef} from 'react';
import {Bot,Box,Puzzle,Shapes,ExternalLink,ArrowRight} from 'lucide-react';
import {useI18n} from './i18n';
import {TOOL_LINKS} from './creator';

// Full-screen "tools you need" screen, shown when a project is created (DIS-004).
// Presentation only: links open the official pages; the extension button opens FITA's Connections dialog.
const tools=[
  ['codex',Bot,'Codex','Views, textures and rig refinement',TOOL_LINKS.codex],
  ['tripo',Box,'Tripo Studio','3D models and rigging',TOOL_LINKS.tripo],
  ['extension',Puzzle,'FITA extension','Connects FITA with Tripo Studio',null],
  ['blender',Shapes,'Blender','Placement, weights and export',TOOL_LINKS.blender],
];

export default function ToolsIntro({onClose,onConnections}){
  const {t}=useI18n(),start=useRef();
  useEffect(()=>{
    start.current?.focus();
    const key=e=>{if(e.key==='Escape')onClose();};
    addEventListener('keydown',key);return()=>removeEventListener('keydown',key);
  },[onClose]);
  return <div className="tools-intro" role="dialog" aria-modal="true" aria-labelledby="tools-intro-title">
    <div className="tools-intro-inner">
      <span className="eyebrow">{t('Before you start')}</span>
      <h1 id="tools-intro-title">{t('Do you have the tools you need?')}</h1>
      <p>{t('FITA works together with these tools.')}</p>
      <div className="tools-grid">
        {tools.map(([id,Icon,name,use,url],i)=><article key={id} className={'tool-card tool-'+id} style={{'--i':i}}>
          <span className="tool-icon"><Icon size={26}/></span>
          <strong>{t(name)}</strong>
          <small>{t(use)}</small>
          {url
            ?<a className="button secondary" href={url} target="_blank" rel="noopener noreferrer">{t('Open page')}<ExternalLink size={14}/></a>
            :<button className="button secondary" onClick={onConnections}>{t('How to connect')}<ArrowRight size={14}/></button>}
        </article>)}
      </div>
      <button ref={start} className="button primary large" onClick={onClose}>{t('I have them · Start')}<ArrowRight size={17}/></button>
    </div>
  </div>;
}

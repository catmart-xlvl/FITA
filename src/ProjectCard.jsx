import React,{useRef} from 'react';
import {ArrowRight,Trash2,Save,UserRound,Image as ImageIcon,ScanFace,Box,Sparkles,Layers3,PersonStanding,Download} from 'lucide-react';
import {useI18n} from './i18n';
import {effectsEnabled,warpFrom} from './effects';

// Lobby project as a collectible card (DIS-002). Presentation only: same data and actions as the old .project-entry.
// The card theme follows the workflow stage (server workflowStage):
// concept = no colour · views = green · 3D form = blue · textures = celeste foil ·
// placement = celeste→gold · rigging = mostly gold · export = gold with effects.
export const cardStages=[
  ['concept',ImageIcon,'Concept'],['views',ScanFace,'Views'],['volume',Box,'3D form'],['textures',Sparkles,'Textures'],
  ['placement',Layers3,'Placement'],['rigging',PersonStanding,'Rigging'],['export',Download,'Export'],
];
// Older servers do not send workflowStage: approximate it from the list summary.
export function cardStage(pr){
  if(Number.isInteger(pr.workflowStage))return Math.max(0,Math.min(6,pr.workflowStage));
  if(pr.models)return 2;
  return pr.approved?1:0;
}
// 7 stages = 3 stars filled in halves (concept…rigging) + export as a whole fourth star. Values: 0 empty, 1 half, 2 full.
export const cardStars=stage=>[0,1,2].map(k=>Math.max(0,Math.min(2,stage+1-2*k))).concat(stage>=6?2:0);
// Stable collector number from the project id (does not change when the list is re-sorted).
const serial=id=>'No. '+String(parseInt(String(id).replace(/[^0-9a-f]/gi,'').slice(0,6)||'0',16)%1000).padStart(3,'0');

export default function ProjectCard({project:pr,index=0,busy,onOpen,onDelete,onSave}){
  const {t}=useI18n(),face=useRef();
  const stage=cardStage(pr),[theme,Icon,label]=cardStages[stage];
  // Tilt + light follow the pointer. Written straight to CSS variables (no React re-render).
  const tilt=e=>{
    if(e.pointerType==='touch'||!effectsEnabled())return;
    const el=face.current,box=el.getBoundingClientRect(),x=(e.clientX-box.left)/box.width,y=(e.clientY-box.top)/box.height;
    el.style.setProperty('--mx',(x*100).toFixed(1)+'%');el.style.setProperty('--my',(y*100).toFixed(1)+'%');
    el.style.setProperty('--rx',((.5-y)*9).toFixed(2)+'deg');el.style.setProperty('--ry',((x-.5)*11).toFixed(2)+'deg');
  };
  const rest=()=>{for(const k of ['--mx','--my','--rx','--ry'])face.current?.style.removeProperty(k);};
  const stats=pr.demo?t('Procedural demo'):pr.models?t('{count} model(s) in this revision',{count:pr.models}):pr.approved?t('{count}/2 groups approved',{count:pr.approved}):pr.reference?t('No approved views'):t('Empty project');
  return <article className={'tcg-card stage-'+theme+(pr.demo?' is-demo':'')} style={{'--i':Math.min(index,10)}}>
    <button ref={face} className="tcg-face" disabled={busy} title={pr.name} onClick={e=>{warpFrom(e.clientX||innerWidth/2,e.clientY||innerHeight/2);onOpen();}} onPointerMove={tilt} onPointerLeave={rest}>
      <span className="tcg-inner">
        <span className="tcg-head"><strong className="tcg-name">{pr.name}</strong><span className="tcg-pips" aria-hidden="true">{cardStars(stage).map((n,i)=><i key={i} className={['','half','on'][n]} style={{'--s':i}}/>)}</span></span>
        <span className="tcg-art">{pr.reference?<img alt="" src={pr.reference.url} loading="lazy" draggable="false"/>:<UserRound size={54} strokeWidth={1}/>}</span>
        <span className="tcg-type"><Icon size={14}/>{t(label)}</span>
        <span className="tcg-stats">{stats}</span>
        <span className="tcg-foot"><span>{serial(pr.id)}</span><span className="tcg-open">{t('Open studio')}<ArrowRight size={13}/></span></span>
      </span>
      <span className="tcg-foil" aria-hidden="true"/><span className="tcg-glare" aria-hidden="true"/><span className="tcg-sparks" aria-hidden="true"/>
    </button>
    <button className="project-save-button" disabled={busy||!onSave} aria-label={t('Save {name} as a .fita file',{name:pr.name})} title={t('Save as .fita')} onClick={onSave}><Save size={15}/></button>
    <button className="project-trash-button" disabled={busy} aria-label={t('Delete project: {name}',{name:pr.name})} title={t('Move to trash')} onClick={onDelete}><Trash2 size={15}/></button>
  </article>;
}

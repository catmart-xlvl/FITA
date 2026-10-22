import React,{useState} from 'react';
import {Check,ArrowRight,ArrowLeft,TriangleAlert} from 'lucide-react';
import {useI18n} from './i18n';
import {HelpLink} from './Help';
import {ArtistCanvas,ImageCanvas} from './ArtistWorkspace';
const reasons={missing_view:'Missing image',stale_reference:'This image belongs to another reference.',demo_asset:'Demo image cannot replace your own view.',unreadable_file:'Saved file could not be read.',file_too_large:'Image exceeds 20 MB.',invalid_format:'Use a non-animated PNG, JPEG or WebP.',low_resolution:'Resolution is below the technical minimum.',decode_failed:'Image pixels could not be decoded.'};
export default function ViewSetReview({project,busy,onBack,onConfirm,onContinue}){
 const {t}=useI18n(),[checked,setChecked]=useState(false),[active,setActive]=useState(0),r=project.viewSetValidation;
 const names={head:t('Head'),body:t('Body'),front:t('Front'),right:t('Right profile'),back:t('Back'),left:t('Left profile')};
 const ready=r?.group?project.viewSetReadyByGroup?.[r.group]:project.viewSetReady;
 if(!r||!project.validationCurrent)return <section className="set-report"><ArtistCanvas title={t('Visual review')}><ImageCanvas url={project.reference?.url} alt={t('Reference concept')}/></ArtistCanvas><p role="alert">{t('Validation is no longer current. Return to the views and run Next again.')}</p><button className="button secondary" onClick={()=>onBack()}>{t('Back to views')}</button></section>;
 return <section className="set-report">
  <ArtistCanvas title={t('Visual review')} subtitle={names[r.items[active]?.group]} strip={r.items.map((item,i)=><button key={item.group+item.view} className={'asset-thumb'+(i===active?' active':'')} aria-pressed={i===active} onClick={()=>setActive(i)}>{project.groups[item.group].views[item.view]&&<img src={project.groups[item.group].views[item.view].url} alt=""/>}<span>{names[item.view]}</span>{item.status==='valid'?<Check size={12}/>:<TriangleAlert size={12}/>}</button>)}><ImageCanvas url={project.groups[r.items[active]?.group]?.views[r.items[active]?.view]?.url} alt={names[r.items[active]?.view]||t('Visual review')}/></ArtistCanvas>
  <header><div><small>{t('Technical validation')}{r.group?' · '+names[r.group]:''}</small><h2>{t(ready?'Files ready for 3D':r.technicalValid?'Visual review':'Corrections needed')}</h2></div>{r.technicalValid?<Check size={24}/>:<TriangleAlert size={24}/>}</header>
  <HelpLink topic="review"/>
  {r.reasonCode==='reference_unconfirmed'&&<p role="alert">{t('Confirm the reference before validating this set.')}</p>}
  {r.reasonCode==='no_selection'&&<p role="alert">{t('Select at least one image for this part.')}</p>}
  <div className="set-review-grid">{r.items.map(item=>{
   const asset=project.groups[item.group].views[item.view],name=names[item.group]+' · '+names[item.view];
   return <article key={item.group+item.view} className={item.status}>
    {asset?<a href={asset.url} target="_blank" rel="noreferrer" title={name}><img src={asset.url} alt={name}/></a>:<div className="missing-thumbnail"><TriangleAlert size={20}/></div>}
    <div><strong>{name}</strong><small>{item.width?`${item.width} × ${item.height} px`:''}</small><p>{item.status==='valid'?t('Valid file'):item.reasonCode==='duplicate_view'?t('Duplicate of {view}. Repeating a front image does not create another angle.',{view:names[item.duplicateOf.group]+' · '+names[item.duplicateOf.view]}):t(reasons[item.reasonCode]||'Saved file could not be read.')}</p>
    {item.status!=='valid'&&<button className="link-button" onClick={()=>onBack(item.group)}>{t('Review files')}</button>}</div>
   </article>;
  })}</div>
  {r.technicalValid&&!ready&&<label className="human-review-check"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/><span>{t('I checked every selected image: correct views, same character and outfit, consistent proportions.')}</span></label>}
  <footer><button className="button subtle" onClick={()=>onBack(r.group)}><ArrowLeft size={15}/>{t('Back to views')}</button>{ready?<button className="button primary rgb-accent" onClick={onContinue}>{t('Continue to 3D')}<ArrowRight size={15}/></button>:r.technicalValid&&<button className="button primary rgb-accent" disabled={busy||!checked} onClick={()=>onConfirm(r.id)}>{t('Confirm visual review')}<Check size={15}/></button>}</footer>
 </section>;
}

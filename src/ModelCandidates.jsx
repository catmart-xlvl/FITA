import React from 'react';
import {Eye,Check} from 'lucide-react';
import {useI18n} from './i18n';
import {candidateBatches,localPreviewModels} from './candidate-navigation.js';
export default function ModelCandidates({project,previewId,onPreview,onSelect,busy}){
 const {t,message}=useI18n(),ids=new Set(localPreviewModels(project).map(m=>m.id)),names={head:t('Head'),body:t('Body')};
 const states={waiting:'Waiting',checking:'Processing',queued:'Waiting',running:'Processing',processing:'Processing',pending:'Waiting',ready:'Ready to download',downloading:'Downloading model…',exporting:'Downloading model…',importing:'Downloading model…',failed:'Could not load candidate',error:'Could not load candidate','needs-attention':'Could not load candidate'};
 return <section className="model-candidates compact-candidates" aria-label={t('Compare candidates')}>{['head','body'].map(group=>{
  const batches=candidateBatches(project,group),chosen=project.groups[group].selectedModelId;
  return <div key={group}><h3 id={'candidates-'+group}>{names[group]}</h3>{!batches.length?<small>{t('No model chosen')}</small>:<table aria-labelledby={'candidates-'+group}>{batches.map(batch=><tbody key={batch.id}>
   {batches.length>1&&<tr className="candidate-batch-label"><th colSpan={2}>{t('Candidate batch {number}',{number:batch.number})}</th></tr>}
   {batch.rows.map(({key,number,model,candidate})=>{
    const available=ids.has(model?.id),isChosen=available&&model.id===chosen,isPreview=available&&model.id===previewId,label=names[group]+' '+number;
    const preview=t('Preview {name}',{name:label})+(batches.length>1?' · '+t('Candidate batch {number}',{number:batch.number}):'');
    return <tr key={key} className={(isChosen?' chosen':'')+(isPreview?' previewing':'')}><th scope="row"><div className="candidate-row-name"><span>{label}</span><button type="button" className="icon-button" disabled={!available} aria-label={preview} title={preview} aria-pressed={isPreview} onClick={()=>onPreview(model.id)}><Eye size={15}/></button></div><small role="status">{isChosen?<><Check size={11}/>{t('Chosen model')}</>:isPreview?t('Preview only'):available?t('Ready to preview'):model?t(model.current?'Could not load candidate':'Previous revision'):['studio-observed','user-confirmed-studio'].includes(candidate?.failureSource)?t('Failed in Tripo'):t(states[candidate?.status]||'Waiting for Studio')}</small>{!available&&candidate?.error&&<small role="alert">{message(candidate.error)}</small>}</th><td><button className="button secondary" disabled={busy||!available||isChosen} onClick={()=>onSelect(group,model.id)}>{t('Use this model')}</button></td></tr>;
   })}
  </tbody>)}</table>}</div>;
 })}</section>;
}

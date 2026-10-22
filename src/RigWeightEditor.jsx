import React,{useRef,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {useI18n} from './i18n';
import {DetailsLink} from './Help';

export default function RigWeightEditor({projectId,source,label,request,onImported}){
  const {t}=useI18n(),session=useRef(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const root=`/projects/${projectId}/rigging/manual`;
  async function prepare(){
    const key=JSON.stringify(source);if(session.current?.key===key)return session.current.value;
    const value=await request(root+'/prepare',{method:'POST',body:source});session.current={key,value};return value;
  }
  async function action(work){if(busy||!source)return;setBusy(true);setError('');try{await work();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const download=format=>action(async()=>{
    const s=await prepare();if(format==='fbx')await request(root+`/${s.id}/fbx`,{method:'POST',body:{}});
    const link=document.createElement('a');link.href=`/api${root}/${s.id}/model.${format}`;link.download=`character-weight-edit.${format}`;document.body.appendChild(link);link.click();link.remove();
  });
  const upload=file=>action(async()=>{
    const s=await prepare(),body=new FormData();body.append('file',file);
    const result=await request(root+`/${s.id}/import`,{method:'POST',body});await onImported(result.edit);
  });
  return <div className="codex-handoff rig-weight-editor">
    <h3>{t('Edit weights in Blender or Maya')} <span className="pill">{t('Optional')}</span></h3>
    <p>{t('Editing source')}: {label}</p>
    <DetailsLink title={t('Edit weights in Blender or Maya')}><p className="popup-text">{t('Download this rig, edit its weights and upload the GLB or binary FBX. Keep every vertex, face, UV and existing bone. Additional bones are allowed.')}</p><p className="popup-text">{t('Export in rest pose, without animation, remeshing or leaf bones. FBX conversion uses local Blender in the background.')}</p><p className="popup-text">{t('Only validated weights and new bones are applied. The original mesh, materials, textures and existing shape keys are retained.')}</p></DetailsLink>
    <div className="rigging-tabs">
      <button className="button secondary" disabled={busy||!source} onClick={()=>download('glb')}><Download size={15}/>{t('Download GLB')}</button>
      <button className="button secondary" disabled={busy||!source} onClick={()=>download('fbx')}><Download size={15}/>{t('Download FBX')}</button>
      <label className={'button primary'+(busy||!source?' disabled':'')}><Upload size={15}/>{t('Upload edited weights')}<input aria-label={t('Upload edited weights')} type="file" accept=".glb,.fbx" disabled={busy||!source} hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)upload(file);}}/></label>
    </div>
    {busy&&<p role="status">{t('Preparing or validating the rig locally…')}</p>}
    {error&&<p role="alert">{t(error.split(':')[0])}{error.includes(':')?': '+error.split(':').slice(1).join(':'):''}</p>}
  </div>;
}

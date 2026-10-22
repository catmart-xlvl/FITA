import React from 'react';
import {useI18n} from './i18n';
import './placement-deformers.css';
const words={
 en:{edit:'Edit mesh',done:'Finish mesh editing',add:'Add point',adding:'Click the mesh to add a point',select:'Select a point or add one on the surface.',point:'Point',radius:'Influence radius',connected:'Connected geometry only',enabled:'Enable this point',move:'Offset',undo:'Undo',redo:'Redo',hint:'Select a point and move its arrows. Press Delete to remove the point and its deformation.',scope:'Radius is a percentage of body height. Turn off connected geometry to affect all meshes in range.',limit:'Maximum 32 points.'},
 es:{edit:'Editar malla',done:'Terminar edición de malla',add:'Añadir punto',adding:'Haz clic en la malla para añadir un punto',select:'Selecciona un punto o añade uno sobre la superficie.',point:'Punto',radius:'Radio de influencia',connected:'Solo geometría conectada',enabled:'Activar este punto',move:'Desplazamiento',undo:'Deshacer',redo:'Rehacer',hint:'Selecciona un punto y mueve sus flechas. Supr elimina el punto y su deformación.',scope:'El radio es un porcentaje de la altura corporal. Desactiva geometría conectada para afectar todas las mallas dentro del radio.',limit:'Máximo 32 puntos.'},
 ja:{edit:'メッシュを編集',done:'メッシュ編集を終了',add:'ポイントを追加',adding:'メッシュをクリックしてポイントを追加',select:'ポイントを選択するか表面に追加してください。',point:'ポイント',radius:'影響半径',connected:'接続されたジオメトリのみ',enabled:'このポイントを有効にする',move:'移動量',undo:'元に戻す',redo:'やり直す',hint:'ポイントを選択して矢印を動かします。Deleteでポイントとその変形を削除します。',scope:'半径は胴体の高さに対する割合です。接続制限を解除すると半径内の全メッシュに影響します。',limit:'最大32ポイント。'}
};
export default function PlacementDeformers({value,tool,onTool,onChange,onDelete,onUndo,onRedo,canUndo,canRedo}){
 const {language}=useI18n(),t=words[language]||words.en,selected=value.pins.find(p=>p.id===tool.selected);
 const update=patch=>onChange({...value,pins:value.pins.map(p=>p.id===tool.selected?{...p,...patch}:p)});
 return <div className={'mesh-editor'+(tool.enabled?' is-open':'')} onKeyDown={e=>{if(e.key==='Delete'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){e.preventDefault();onDelete();}}}>
  <button className="mesh-editor-toggle" aria-expanded={!!tool.enabled} onClick={()=>onTool({...tool,enabled:!tool.enabled,adding:false})}>{tool.enabled?t.done:t.edit}</button>
  {tool.enabled&&<section aria-label={t.edit} className="mesh-editor-panel">
   <label className="mesh-editor-check"><input type="checkbox" checked={!!tool.compact} onChange={e=>onTool({...tool,compact:e.target.checked})}/>{language==='es'?'Vista discreta · puntos pequeños y sin radio':language==='ja'?'コンパクト表示・小さいポイント、半径なし':'Compact view · small points, no radius'}</label>
   <button className="button secondary" aria-pressed={!!tool.adding} disabled={value.pins.length>=32} onClick={()=>onTool({...tool,adding:!tool.adding})}>{tool.adding?t.adding:t.add}</button>
   <div className="mesh-point-list" aria-label={t.point}>{value.pins.map((pin,i)=><button key={pin.id} aria-pressed={pin.id===tool.selected} onClick={()=>onTool({...tool,adding:false,selected:pin.id})}>{t.point} {i+1}{!pin.enabled?' ○':''}</button>)}</div>
   {!selected&&<p>{value.pins.length>=32?t.limit:t.select}</p>}
   {selected&&<>
    <label>{t.radius} · {Number((selected.radius*100).toFixed(1))}%<input aria-label={t.radius} type="range" min="0.1" max="100" step="0.1" value={selected.radius*100} onChange={e=>update({radius:Number(e.target.value)/100})}/></label>
    <label className="mesh-editor-check"><input type="checkbox" checked={selected.connectedOnly} onChange={e=>update({connectedOnly:e.target.checked})}/>{t.connected}</label>
    <label className="mesh-editor-check"><input type="checkbox" checked={selected.enabled} onChange={e=>update({enabled:e.target.checked})}/>{t.enabled}</label>
    <fieldset><legend>{t.move}</legend><div className="mesh-editor-vector">{['X','Y','Z'].map((axis,i)=><label key={axis}>{axis}<input aria-label={t.move+' '+axis} type="number" step="0.005" value={selected.delta[i]} onChange={e=>{const n=Number(e.target.value);if(!Number.isFinite(n)||Math.abs(n)>10000)return;update({delta:selected.delta.map((v,j)=>i===j?n:v)});}}/></label>)}</div></fieldset>
   </>}
   <div className="mesh-editor-history"><button disabled={!canUndo} onClick={onUndo}>{t.undo}</button><button disabled={!canRedo} onClick={onRedo}>{t.redo}</button></div>
   <p>{t.hint}</p><small>{t.scope}</small>
  </section>}
 </div>;
}

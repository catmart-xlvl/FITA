import React,{useState} from 'react';
import {useI18n} from './i18n';
export default function DistributionUpdates({request}){
  const {language}=useI18n(),[result,setResult]=useState(null),[busy,setBusy]=useState(false);
  const text=(en,es,ja)=>language==='es'?es:language==='ja'?ja:en;
  async function check(){setBusy(true);try{setResult(await request('/distribution/updates'));}catch(error){setResult({status:'unavailable',message:error.message});}finally{setBusy(false);}}
  return <section aria-live="polite">
    <p>{text('Check the configured GitHub release without changing your files.','Consulta la versión de GitHub sin cambiar tus archivos.','ファイルを変更せずにGitHubのリリースを確認します。')}</p>
    <button className="button secondary" disabled={busy} onClick={check}>{busy?text('Checking…','Consultando…','確認中…'):text('Check for updates','Buscar actualizaciones','更新を確認')}</button>
    {result&&<p role="status">{result.status==='current'?text('FITA is up to date.','FITA está actualizado.','FITAは最新です。'):result.status==='available'?text('New version available: ','Nueva versión disponible: ','新しいバージョン: ')+result.targetVersion:result.message}</p>}
    <p>{text('To install an update, finish active tasks, close FITA and double-click Update FITA.cmd in your installation folder. Previous versions and project files are retained.','Para instalar, termina las tareas activas, cierra FITA y abre Update FITA.cmd en la carpeta de instalación. Se conservan las versiones anteriores y los proyectos.','更新するには作業を完了し、FITAを閉じてインストール先のUpdate FITA.cmdを実行します。旧版とプロジェクトは保持されます。')}</p>
    <p>{text('The repository is currently private and has no published release. Automatic downloading requires a public release.','El repositorio sigue privado y no tiene una versión publicada. La descarga automática requiere una versión pública.','リポジトリは現在非公開で、公開リリースはありません。自動ダウンロードには公開リリースが必要です。')}</p>
  </section>;
}

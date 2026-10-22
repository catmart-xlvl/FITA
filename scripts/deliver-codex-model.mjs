// Standalone local placement delivery. No provider or spending credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const folder=path.dirname(fileURLToPath(import.meta.url));
try{
 const config=JSON.parse(await fs.readFile(path.join(folder,'ENTREGA_LOCAL.json'),'utf8')),url=new URL(config.endpoint);
 if(config.schema!=='workbench-placement-delivery/v1'||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!==`/api/placement-deliveries/${config.deliveryId}`||url.search||url.hash||url.username||url.password||!/^[a-f0-9]{64}$/.test(config.token))throw Error('Configuración de entrega inválida. Descarga un ZIP nuevo desde FITA.');
 const check=process.argv[2]==='--check';let bytes;
 if(!check){const file=path.resolve(process.argv[2]||'placement_result.zip'),stat=await fs.stat(file);if(!stat.isFile()||stat.size>300*1024*1024)throw Error('Resultado inválido: máximo 300 MB.');bytes=await fs.readFile(file);}
 let receipt;
 for(let attempt=0;attempt<3;attempt++){
  let response;try{response=await fetch(url,{method:check?'GET':'POST',redirect:'error',headers:{Authorization:`Bearer ${config.token}`,...(!check?{'Content-Type':'application/zip'}:{})},body:bytes,signal:AbortSignal.timeout(180000)});}catch{if(attempt===2)throw Error('Abre FITA y reintenta el mismo comando. Conserva tu resultado.');await new Promise(r=>setTimeout(r,1000));continue;}
  const value=await response.json();if(!response.ok)throw Error(value.error||'FITA rechazó la entrega.');
  if(value.projectId!==config.projectId||!['waiting','imported'].includes(value.status))throw Error('Respuesta inesperada.');receipt=value;break;
 }
 if(!check){if(receipt.status!=='imported'||!receipt.importId)throw Error('No se confirmó la importación.');await fs.writeFile(path.join(folder,'ENTREGA_RECIBO.json'),JSON.stringify(receipt,null,2));}
 console.log(JSON.stringify({status:receipt.status.toUpperCase(),projectId:receipt.projectId,importId:receipt.importId||null,duplicate:!!receipt.duplicate}));
}catch(error){console.error(error.message);process.exitCode=1;}

// Portable Node 22+ helper. Only delivers the result ZIP to the bound local project.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
try{
 const folder=path.dirname(fileURLToPath(import.meta.url)),c=JSON.parse(await fs.readFile(path.join(folder,'ENTREGA_LOCAL.json'),'utf8')),url=new URL(c.endpoint);
 if(c.schema!=='workbench-segmentation-delivery/v1'||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!==`/api/segmentation-deliveries/${c.deliveryId}`||url.search||url.hash||url.username||url.password||!/^[a-f0-9]{64}$/.test(c.token))throw Error('Configuración de entrega inválida.');
 const checking=process.argv[2]==='--check',file=path.resolve(process.argv[2]||'segmentation_result.zip');let bytes;
 if(!checking){const s=await fs.stat(file);if(!s.isFile()||s.size>300*1024*1024)throw Error('ZIP inválido o mayor de 300 MB.');bytes=await fs.readFile(file);}
 let result;
 for(let attempt=0;attempt<3;attempt++){
  let response;try{response=await fetch(url,{method:checking?'GET':'POST',redirect:'error',headers:{Authorization:`Bearer ${c.token}`,...(!checking?{'Content-Type':'application/zip'}:{})},body:bytes,signal:AbortSignal.timeout(240000)});}catch{if(attempt===2)throw Error('Abre FITA y repite esta entrega. Conserva el ZIP; no rehagas la segmentación.');continue;}
  result=await response.json();if(!response.ok)throw Error(result.error||'Entrega rechazada.');break;
 }
 if(result.projectId!==c.projectId||!['waiting','imported'].includes(result.status))throw Error('Respuesta inesperada.');
 if(!checking)await fs.writeFile(path.join(folder,'ENTREGA_RECIBO.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}catch(e){console.error(e.message);process.exitCode=1;}

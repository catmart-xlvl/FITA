// Standalone Node.js 22+ helper. No dependencies or access to Tripo/LLM credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const folder=path.dirname(fileURLToPath(import.meta.url));
try{
  const config=JSON.parse(await fs.readFile(path.join(folder,'ENTREGA_LOCAL.json'),'utf8'));
  const url=new URL(config.endpoint);
  if(config.schema!=='workbench-delivery/v1'||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!==`/api/codex-deliveries/${config.deliveryId}`||url.search||url.hash||url.username||url.password||!/^[a-f0-9]{64}$/.test(config.token))throw Error('Configuración de entrega local inválida. Descarga un paquete nuevo.');
  const check=process.argv[2]==='--check';
  const filename=path.resolve(process.argv[2]||'fita_views.zip');
  let bytes;
  if(!check){const stat=await fs.stat(filename);if(!stat.isFile()||stat.size>150*1024*1024)throw Error('El ZIP debe ser un archivo de hasta 150 MB.');bytes=await fs.readFile(filename);}
  let receipt;
  for(let attempt=0;attempt<3;attempt++){
    let response;
    try{response=await fetch(url,{method:check?'GET':'POST',redirect:'error',headers:{Authorization:`Bearer ${config.token}`,...(!check?{'Content-Type':'application/zip'}:{})},body:bytes,signal:AbortSignal.timeout(120000)});}
    catch{if(attempt===2)throw Error('No se pudo contactar al FITA local. Ábrelo y vuelve a ejecutar el mismo comando; conserva el ZIP.');await new Promise(r=>setTimeout(r,1000));continue;}
    const value=await response.json();
    if(!response.ok){
      const recovery=value.currentDelivery?` Entrega vigente: ${value.currentDelivery.id} (${value.currentDelivery.status}), vence ${value.currentDelivery.expiresAt}.`:'';
      const reuse=value.canReuseImages?' Puedes conservar las imágenes y el ZIP: el manifiesto coincide. Descarga o renueva el paquete vigente en FITA y ejecuta su ENTREGAR_VISTAS.mjs sobre este mismo ZIP; no vuelvas a generar imágenes.':'';
      throw Error((value.error||`FITA rechazó la entrega (${response.status}).`)+recovery+reuse);
    }
    if(value.projectId!==config.projectId||!['waiting','imported'].includes(value.status))throw Error('Respuesta de entrega inesperada. Conserva el ZIP y revisa FITA.');
    receipt=value;break;
  }
  if(!check){if(receipt.status!=='imported'||!receipt.importId)throw Error('No se confirmó la importación.');await fs.writeFile(path.join(folder,'ENTREGA_RECIBO.json'),JSON.stringify(receipt,null,2));}
  console.log(JSON.stringify({status:receipt.status.toUpperCase(),projectId:receipt.projectId,importId:receipt.importId||null,duplicate:receipt.duplicate||false}));
}catch(error){console.error(error.message);process.exitCode=1;}

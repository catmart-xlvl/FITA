import {instructionPackageFromCache} from './local-instruction-package.js';
import {localInstructionPackage} from './local-instruction-package.js';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {fail} from './storage.js';
import {referenceReady} from './lineage.js';
import {manifestFor,promptFor,instructionsFor,zipBuffers,importViewPackage,conceptFiles} from './codex-handoff.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const identity=p=>JSON.stringify(manifestFor(p));
const matchingIdentity=(p,g)=>g?.identity===identity(p)||g?.identity===JSON.stringify(manifestFor(p,{legacy:true}));
const viewState=p=>JSON.stringify(['head','body'].map(g=>p.groups[g].views));
const active=p=>(p.textureOperations||[]).some(o=>!o.trackingClosed&&['queued','running','unknown'].includes(o.status))||(p.placements||[]).some(o=>['queued','running'].includes(o.status));
const deliveryInstructions=`
ENTREGA AUTOMÁTICA LOCAL:
El workspace local del proyecto contiene ENTREGA_LOCAL.json y ENTREGAR_VISTAS.mjs; UBICACIONES.json indica sus rutas exactas. El JSON contiene una autorización temporal para entregar únicamente estas diez imágenes (ocho vistas y dos guías de colocación) a este proyecto. No muestres su token ni lo incluyas en el ZIP final.
1. Trabaja en una carpeta propia para esta entrega. Conserva el concepto y manifest.json originales.
2. Puedes comprobar la conexión, sin cambiar nada, con: node ENTREGAR_VISTAS.mjs --check
3. Después de generar y revisar las diez imágenes, crea fita_views.zip según el contrato de PROMPT.txt y ejecuta: node ENTREGAR_VISTAS.mjs "ruta/al/fita_views.zip"
4. El script envía el ZIP al FITA que esté abierto en ESTE equipo y guarda ENTREGA_RECIBO.json. Solo afirma que se importó cuando el script confirme IMPORTED con el proyecto e importación correspondientes.
5. Si FITA está cerrado, conserva el ZIP y explica que debe abrirse para reintentar. Si caducó, usa Renovar autorización de entrega. Si fue sustituida, comprueba el ID vigente que informa el script. Conserva las imágenes ya generadas: si manifest.json coincide con el paquete vigente, ejecuta su nuevo ENTREGAR_VISTAS.mjs con el mismo ZIP, sin regenerar. Si cambió el concepto o las notas, no alteres el manifiesto para forzar la entrega. Volver a descargar sin cambios devuelve el mismo paquete y no revoca su autorización.
6. Si estás en un entorno remoto sin acceso al localhost del usuario, entrega el ZIP como respaldo; no publiques el servidor ni expongas credenciales. No subas nada a Tripo ni apruebes las vistas automáticamente.
La importación es completa o no se aplica. La aplicación detectará las diez imágenes y actualizará sus casillas; el artista mantiene la revisión y aprobación visual.
`;

export async function createCodexDelivery({store,editable,now=Date.now,ttlMs=24*60*60*1000,baseUrl='http://127.0.0.1:4317'}) {
  const dir=path.join(store.root,'.codex-deliveries'),grants=new Map(),locks=new Map();
  await fs.mkdir(dir,{recursive:true});
  for(const name of await fs.readdir(dir))if(/^[a-f0-9-]{36}\.json$/.test(name))try{const g=JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));if(name===g.id+'.json'&&/^[a-f0-9]{64}$/.test(g.tokenHash)&&Number.isFinite(g.expiresAt))grants.set(g.id,g);}catch{}
  async function persist(g){const tmp=path.join(dir,g.id+'.'+randomUUID()+'.tmp');await fs.writeFile(tmp,JSON.stringify(g));await fs.rename(tmp,path.join(dir,g.id+'.json'));}
  async function locked(key,fn){const previous=locks.get(key)||Promise.resolve();const result=previous.catch(()=>{}).then(fn);locks.set(key,result);try{return await result;}finally{if(locks.get(key)===result)locks.delete(key);}}
  function receipt(p,id){return p.codexImports?.find(i=>i.deliveryId===id);}
  function check(g,p){
    if(!g||p.codexDelivery?.id!==g.id||p.codexDelivery.status==='revoked')fail('CODEX_DELIVERY_REVOKED',409);
    if(now()>=g.expiresAt)fail('CODEX_DELIVERY_EXPIRED',410);
    if(!matchingIdentity(p,g)||viewState(p)!==g.views)fail('CODEX_DELIVERY_STALE',409);
  }
  function status(p){
    const g=grants.get(p.codexDelivery?.id);if(!g)return null;
    const done=receipt(p,g.id);let state=done?'imported':'waiting';
    if(!done)try{check(g,p);}catch(e){state=({'CODEX_DELIVERY_EXPIRED':'expired','CODEX_DELIVERY_STALE':'stale','CODEX_DELIVERY_REVOKED':'revoked'})[e.message]||'unavailable';}
    return {id:g.id,projectId:p.id,status:state,expiresAt:new Date(g.expiresAt).toISOString(),downloadUrl:state==='waiting'?`/api/projects/${p.id}/codex/delivery/${g.id}/package`:null,importId:done?.id||null,lastError:state==='waiting'?g.lastError||null:null};
  }
  const router=express.Router();
  // Dedicated machine endpoint: no browser Origin and no ambient cookies/CSRF secret.
  router.use((req,res,next)=>{
    if(!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host||'')||req.headers.origin)return res.status(403).json({error:'CODEX_DELIVERY_ORIGIN'});
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});next();
  });
  function authenticate(req,res,next){
    const g=grants.get(req.params.deliveryId),token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if(!g||!token||!timingSafeEqual(Buffer.from(hash(token)),Buffer.from(g.tokenHash)))return res.status(401).json({error:'CODEX_DELIVERY_UNAUTHORIZED'});
    req.delivery=g;next();
  }
  router.get('/:deliveryId',authenticate,(req,res)=>{
    const g=req.delivery,p=store.get(g.projectId),done=receipt(p,g.id);
    if(!done)check(g,p);
    res.json({projectId:p.id,status:done?'imported':'waiting',importId:done?.id||null,expiresAt:new Date(g.expiresAt).toISOString()});
  });
  router.post('/:deliveryId',authenticate,express.raw({type:'application/zip',limit:'150mb'}),async(req,res)=>{
    const g=req.delivery;
    const value=await locked(g.projectId,async()=>{
      let p=store.get(g.projectId);
      if(!Buffer.isBuffer(req.body)||!req.body.length)fail('CODEX_DELIVERY_ZIP_REQUIRED',400);
      const packageHash=hash(req.body),done=receipt(p,g.id);
      if(done){if(done.packageHash!==packageHash)fail('CODEX_DELIVERY_ALREADY_USED',409);return {status:'imported',projectId:p.id,importId:done.id,duplicate:true};}
      check(g,p);
      try{
        p=await importViewPackage({store,projectId:p.id,editable,buffer:req.body,replace:g.replace,receipt:{id:g.id,packageHash},requireTransparency:true,expectedSchema:JSON.parse(g.identity).schema,beforeCommit:current=>check(g,current)});
        return {status:'imported',projectId:p.id,importId:receipt(p,g.id).id,duplicate:false};
      }catch(error){g.lastError=error.message;await persist(g).catch(()=>{});throw error;}
    });
    res.json(value);
  });
  router.use((error,req,res,next)=>{
    let recovery={};try{if(req.delivery){const p=store.get(req.delivery.projectId);recovery={currentDelivery:status(p),canReuseImages:identity(p)===req.delivery.identity};}}catch{}
    res.status(error.status||500).json({error:error.message||'CODEX_DELIVERY_FAILED',...recovery});
  });
  return {router,status,
    async issue(project,replace,{renew=false}={}){return locked(project.id,async()=>{
      const p=store.get(project.id);if(!referenceReady(p))fail('Confirm the reference before preparing a Codex package.',409);editable(p);if(active(p))fail('Finish the active operation before replacing views.',409);
      const pending=grants.get(p.codexDelivery?.id),state=status(p);
      if(state?.status==='waiting')return {delivery:state,downloadUrl:state.downloadUrl,reused:true};
      if(state?.status==='expired'&&matchingIdentity(p,pending)&&pending.views===viewState(p)&&!renew)fail('CODEX_DELIVERY_RENEW_REQUIRED',409);
      if(['head','body'].some(g=>Object.keys(p.groups[g].views).length)&&!replace)fail('Confirm replacement of the existing views before importing.',409);
      const token=randomBytes(32).toString('hex'),g={id:randomUUID(),projectId:p.id,identity:identity(p),views:viewState(p),replace,tokenHash:hash(token),expiresAt:now()+ttlMs};
      const descriptor={schema:'workbench-delivery/v1',projectId:p.id,deliveryId:g.id,endpoint:`${baseUrl}/api/codex-deliveries/${g.id}`,token,expiresAt:new Date(g.expiresAt).toISOString()};
      const zip=await localInstructionPackage(store,p,'views',{...await conceptFiles(store,p),'manifest.json':Buffer.from(JSON.stringify(manifestFor(p),null,2)),
        'PROMPT.txt':Buffer.from(promptFor(p)+deliveryInstructions),'INSTRUCCIONES.txt':Buffer.from(instructionsFor(p)+deliveryInstructions),
        'ENTREGA_LOCAL.json':Buffer.from(JSON.stringify(descriptor,null,2)),
        'ENTREGAR_VISTAS.mjs':await fs.readFile(new URL('../scripts/deliver-codex-views.mjs',import.meta.url))});
      if(store.get(p.id)!==p||!matchingIdentity(p,g)||viewState(p)!==g.views)fail('CODEX_DELIVERY_STALE',409);
      editable(p);if(active(p))fail('Finish the active operation before replacing views.',409);
      await persist(g);await fs.writeFile(path.join(dir,g.id+'.zip'),zip);grants.set(g.id,g);
      const next=structuredClone(p);next.codexDelivery={id:g.id,status:'waiting',createdAt:new Date(now()).toISOString(),supersedes:pending?.id||null};
      try{await store.save(next);}catch(e){if(store.projects.get(p.id)===next)store.projects.set(p.id,p);grants.delete(g.id);throw e;}
      return {delivery:status(next),downloadUrl:`/api/projects/${p.id}/codex/delivery/${g.id}/package`};
    });},
    async package(p,id){const g=grants.get(id);if(g?.projectId!==p.id)fail('CODEX_DELIVERY_UNAUTHORIZED',404);check(g,p);return instructionPackageFromCache(store,p,'views',id,path.join(dir,id+'.zip'));},
    async revoke(p){return locked(p.id,async()=>{const next=structuredClone(store.get(p.id));if(next.codexDelivery)next.codexDelivery.status='revoked';await store.save(next);return {delivery:status(next)};});}
  };
}

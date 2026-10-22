import express from 'express';
import {reservePlacement,placementHandoffState} from './placement-state.js';
import {readManualModelSnapshot,manualModelOverlayIds} from './manual-model-snapshot.js';
import {localInstructionPackage,skillInstructions} from './local-instruction-package.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID,randomBytes,timingSafeEqual} from 'node:crypto';
import multer from 'multer';
import yauzl from 'yauzl';
import {zipBuffers} from './codex-handoff.js';
import {placementTexture as currentTexture,inspectTextureGlb} from './texture-workflow.js';
import {currentManual} from './manual-placement.js';
import {currentSegmentation} from './segmentation-identity.js';
import {bakeManual,validateNeckResult,savedModelInstructions} from './neck-handoff.js';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=b=>createHash('sha256').update(b).digest('hex');
const slots=['head','body'];
const deliveryDirectory=(store,p,id)=>path.resolve(store.root,'..','projects',p.id,'codex','model-finish',id);

export async function placementManifest(store,p){
  const sources={};for(const g of slots){const asset=currentTexture(p,g);if(!asset)fail('PLACEMENT_TEXTURES_REQUIRED',409);const bytes=await store.read(p,asset);inspectTextureGlb(bytes);sources[g]={id:asset.id,sha256:hash(bytes)};}
  const manual=currentManual(p),overlayIds=manual?.modelSnapshot?manualModelOverlayIds(p):null,eyeRepair=[...p.placements||[]].reverse().find(r=>r.scleraPatch&&r.sources?.head===sources.head.id),lipRepair=[...p.placements||[]].reverse().find(r=>r.lipPatch&&r.sources?.head===sources.head.id),coverageRepair=[...p.placements||[]].reverse().find(r=>r.bodyCoveragePatch&&r.sources?.body===sources.body.id);return {schema:manual?.modelSnapshot?'workbench-placement/v3':manual?'workbench-placement/v2':'workbench-placement/v1',projectId:p.id,sources,...(manual?.modelSnapshot?.storage==='single'&&p.placementHandoff?.manualId===manual.id&&['waiting','imported'].includes(p.placementHandoff.status)?{handoffId:p.placementHandoff.id}: {}),...(manual?{manual}: {}),...(eyeRepair?{facialRepairId:overlayIds?overlayIds[0]:eyeRepair.id}: {}),...(lipRepair?{lipRepairId:overlayIds?overlayIds[1]:lipRepair.id}: {}),...(coverageRepair?{coverageRepairId:overlayIds?overlayIds[2]:coverageRepair.id}: {})};
}
export const placementInstructions=`FITA · COLOCACIÓN CON CODEX
Lee SKILLS_REQUERIDAS.txt, localiza colocacion-personaje-por-referencias y aplica su referencia de revisión. Esa skill dirige el juicio visual y el orden colocación → cuello → copia. Los scripts suministrados automatizan tareas repetitivas; no aprueban la anatomía.

ENTRADAS: head.glb y body.glb, concept.png y vistas aprobadas. Conserva manifest.json y originales. Trabaja en una carpeta nueva, con Blender en segundo plano (--background --factory-startup --disable-autoexec --python-exit-code 1). No uses Tripo ni operaciones pagadas. Estas fuentes ya tienen texturas: conserva topología, UV, imágenes y materiales.

1. Prepara o revisa reference_front.png, reference_left.png y reference_right.png: personaje completo, una vista por PNG, mismo lienzo cuadrado amplio o 4:3 horizontal, misma escala, pose T con brazos/manos completos. Izquierda/derecha anatómicas; nunca espejes un perfil. No acortes brazos para encajarlos ni midas con una referencia deformada.
2. Ejecuta run_placement.py como estimación inicial. Ajusta settings.json desde las fuentes inmutables; no acumules multiplicaciones de escala. Revisa primero proporción y posición rígida de toda la cabeza desde frente y ambos perfiles, después alarga solo el tubo superior del cuello, conservando ancho, grosor, base, trapecios y hombros exactamente. No uses una deformación amplia que arrastre el torso. Registra medidas y dudas en report.proportionReview, con front, left y right, y el avance nariz/barbilla/oído respecto al cuello en profileAlignment. Usa deformación Connected Only para cabello cuando corresponda, según la skill.
3. Guarda placed.blend sin compresión. Define settings.neckReview={center:[x,y,z],span:altura} en unidades de Blender, centrado en mandíbula/cuello. Ejecuta review_placement.py, abre front.png, left.png, right.png, back.png y neck_front/left/right.png. Compara cada perfil con la referencia de ese MISMO lado. Si la unión está oculta por pelo o collar, inspecciona la superficie por separado. Corrige antes de continuar; un script sin errores no es aprobación.
4. Completa placement-review.json siguiendo la skill y ejecuta python <ruta-de-la-skill>/scripts/check_review.py . Conserva ese registro y review-evidence.json en la carpeta. Copia los hallazgos al report.json en artistReview; reviewRequired permanece true y la aprobación final corresponde al artista. Los renders, hashes, .blend y .glb deben proceder de la misma revisión final.
5. Entrega placement_result.zip con EXACTAMENTE once archivos en la raíz: manifest.json original, placed.blend, placed.glb, report.json, front.png, left.png, right.png, back.png, reference_front.png, reference_left.png, reference_right.png. No incluyas scripts o fuentes duplicadas. Importa mediante «Importar colocación de Codex»; no escribas en data de FITA. Esta entrega de colocación no autoriza resegmentar un proyecto ya texturizado.
`;

export function readPlacementZip(buffer){return new Promise((resolve,reject)=>{
  if(!buffer?.length||buffer.length>300*1024*1024)return reject(new Error('PLACEMENT_PACKAGE_SIZE'));
  yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
    if(error)return reject(new Error('PLACEMENT_INVALID_PACKAGE'));
    const required=['manifest.json','placed.blend','placed.glb','report.json','front.png','right.png','back.png'],references=['reference_front.png','reference_right.png'],bilateral=['left.png','reference_left.png'];
    const allowed=new Set([...required,...references,...bilateral]),files={};let total=0,done=false;
    const stop=()=>{if(!done){done=true;zip.close();reject(new Error('PLACEMENT_INVALID_PACKAGE'));}};
    zip.on('error',stop);zip.on('end',()=>{if(!done){if(required.some(name=>!files[name])||references.some(name=>!!files[name]!==!!files[references[0]])||(files['reference_left.png']&&!files['left.png']))return stop();done=true;resolve(files);}});
    // Legacy 7/9-file results remain readable; new results include both anatomical profiles.
    if(![required.length,required.length+1,required.length+references.length,allowed.size].includes(zip.entryCount))return stop();
    zip.on('entry',entry=>{
      const limit=entry.fileName.endsWith('.json')?1024*1024:entry.fileName.endsWith('.png')?20*1024*1024:150*1024*1024;
      if(!allowed.has(entry.fileName)||files[entry.fileName]||(entry.externalFileAttributes>>>16&0xf000)===0xa000||entry.generalPurposeBitFlag&1||entry.uncompressedSize>limit||(total+=entry.uncompressedSize)>300*1024*1024)return stop();
      zip.openReadStream(entry,(err,stream)=>{if(err)return stop();const chunks=[];let n=0;stream.on('error',stop);stream.on('data',b=>{if((n+=b.length)>limit){stream.destroy();stop();}else chunks.push(b);});stream.on('end',()=>{if(!done){files[entry.fileName]=Buffer.concat(chunks);zip.readEntry();}});});
    });zip.readEntry();
  });
});}

export function mountPlacementHandoff(app,{store,editable,presentProject,bake=bakeManual,validate=validateNeckResult,baseUrl}){
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:300*1024*1024,files:1}});
 async function receive(p,buffer){
  editable(p);const staged=[];
  try{
      const files=await readPlacementZip(buffer),manifest=await placementManifest(store,p),provided=JSON.parse(files['manifest.json']);
      if(JSON.stringify(provided)!==JSON.stringify(manifest))fail('PLACEMENT_SOURCE_CHANGED',409);
      const packageHash=hash(buffer),existing=p.placements?.find(r=>r.packageHash===packageHash);if(existing)return {run:existing,project:presentProject(p),duplicate:true};
      if(p.manualPlacement?.modelSnapshot?.storage==='single'&&(p.placementHandoff?.status!=='waiting'||p.placementHandoff.manualId!==p.manualPlacement.id))fail('PLACEMENT_DELIVERY_CANCELLED',409);
      inspectTextureGlb(files['placed.glb']);if(files['placed.blend'].subarray(0,7).toString()!=='BLENDER')fail('PLACEMENT_INVALID_RESULT');
      const report=JSON.parse(files['report.json']);if(report.reviewRequired!==true||!report.independentParts||!(report.headMeshes>0)||!(report.bodyMeshes>0)||!report.artistReview)fail('PLACEMENT_REVIEW_REQUIRED');
      const hasReferences=!!files['reference_front.png'],hasLeft=!!files['left.png'];
      if(!manifest.manual&&hasLeft&&!['front','left','right'].every(v=>report.proportionReview?.[v]))fail('PLACEMENT_REVIEW_REQUIRED');
      if(hasReferences&&(!report.proportionReview||typeof report.proportionReview!=='object'||Array.isArray(report.proportionReview)))fail('PLACEMENT_REVIEW_REQUIRED');
      for(const name of ['front','right','back',...(hasLeft?['left',...(hasReferences?['reference_left']:[])]:[]),...(hasReferences?['reference_front','reference_right']:[])]){const sharp=(await import('sharp')).default;const meta=await sharp(files[name+'.png']).metadata();if(meta.format!=='png'||meta.width<256||meta.height<256)fail('PLACEMENT_INVALID_RESULT');}
      if(manifest.manual){if(!hasLeft)fail('PLACEMENT_REVIEW_REQUIRED');report.lockedPlacementValidation=await validate(files,manifest.manual.modelSnapshot?await readManualModelSnapshot(store,p,manifest.manual):await bake(store,p,manifest.manual),manifest.manual);
       const cleanup=report.lockedPlacementValidation.bodyCoverageCleanup;
       if(cleanup){const group=currentSegmentation(p)?.groups?.find(g=>g.id==='piel-superior');if(group?.coverage?.status!=='temporary'||!group.coverage.areas?.includes('chest')||cleanup.patch?.conceptId!==p.reference?.id)fail('PLACEMENT_LOCKED_RESULT_CHANGED',409);}
      }
      const before=JSON.stringify(manifest),next=structuredClone(p),save=async(name,ext)=>{const asset=await store.asset(next,files[name],ext,'Codex placement');staged.push(asset);return asset;};
      const preview=await save('placed.glb','glb'),blend=await save('placed.blend','blend'),renders={};for(const name of ['front','right','back',...(hasLeft?['left']:[])])renders[name]=await save(name+'.png','png');
      const references={};if(hasReferences)for(const name of ['front','right',...(hasLeft?['left']:[])])references[name]=await save('reference_'+name+'.png','png');
      if(store.get(p.id)!==p||JSON.stringify(await placementManifest(store,p))!==before)fail('PLACEMENT_SOURCE_CHANGED',409);editable(p);
      const run={id:randomUUID(),source:'codex',status:'succeeded',manualPlacementId:manifest.manual?.id,sources:Object.fromEntries(slots.map(g=>[g,manifest.sources[g].id])),sourceHashes:Object.fromEntries(slots.map(g=>[g,manifest.sources[g].sha256])),packageHash,preview,blend,renders,references,report,createdAt:new Date().toISOString(),completedAt:new Date().toISOString()};
      // A validated neck/hair edit already contains the facial overlays baked
      // into its approved source. Preserve their replay history for later fixes.
      if(manifest.manual){
       const eyes=[...p.placements||[]].reverse().find(r=>r.id===manifest.facialRepairId),lips=[...p.placements||[]].reverse().find(r=>r.id===manifest.lipRepairId);
       if(eyes){run.scleraPatch=eyes.scleraPatch;if(eyes.scleraPatches)run.scleraPatches=eyes.scleraPatches;}
       if(lips)run.lipPatch=lips.lipPatch;
       const coverage=report.lockedPlacementValidation.bodyCoverageCleanup;if(coverage)run.bodyCoveragePatch=coverage.patch;
      }
      (next.placements||=[]).push(run);if(next.placementHandoff?.status==='waiting')next.placementHandoff={...next.placementHandoff,status:'imported',importId:run.id,packageHash,completedAt:new Date().toISOString(),lastError:null};await store.save(next);staged.length=0;return {run,project:presentProject(next),duplicate:false};
  }finally{for(const asset of staged)await fs.unlink(path.join(store.root,p.id,asset.id)).catch(()=>{});}
 }
 async function checked(p,h){
  if(!h||p.placementHandoff?.id!==h.id||!['waiting','imported'].includes(h.status))fail('PLACEMENT_DELIVERY_CANCELLED',409);
  if(currentManual(p)?.id!==h.manualId||(p.workflowEpoch||0)!==h.workflowEpoch)fail('PLACEMENT_SOURCE_CHANGED',409);
  if(hash(JSON.stringify(await placementManifest(store,p)))!==h.manifestHash)fail('PLACEMENT_SOURCE_CHANGED',409);
  await readManualModelSnapshot(store,p,currentManual(p));
 }
 async function prepare(p,requestBaseUrl){
  editable(p);if(p.placementCompleted)fail('PLACEMENT_STAGE_COMPLETED',409);const manual=currentManual(p);if(!manual||manual.modelSnapshot?.storage!=='single')fail('PLACEMENT_MODEL_SAVE_REQUIRED',409);
  if(p.placementHandoff?.status==='waiting'){await checked(p,p.placementHandoff);return;}
  if(p.manualPlacementDraft)fail('PLACEMENT_MODEL_SAVE_REQUIRED',409);const model=await readManualModelSnapshot(store,p,manual),previous=p.placementHandoff;
  const token=randomBytes(32).toString('hex'),h={id:randomUUID(),status:'waiting',manualId:manual.id,workflowEpoch:p.workflowEpoch||0,tokenHash:hash(token),createdAt:new Date().toISOString()};
  p.placementHandoff=h;
  try{
   const manifest=await placementManifest(store,p);h.manifestHash=hash(JSON.stringify(manifest));
   const instructions=savedModelInstructions+`\nENTREGA AUTOMÁTICA: antes de empezar ejecuta node ENTREGAR_MODELO.mjs --check. Trabaja en una copia dentro de output; no sobrescribas approved.blend/approved.glb. Al terminar crea el ZIP interno de resultado y ejecuta node ENTREGAR_MODELO.mjs \"ruta/al/placement_result.zip\". Espera el recibo IMPORTED. Una entrega cancelada por el usuario queda revocada: detén ese trabajo y solicita el nuevo ZIP, sin reutilizar su manifiesto. No continúes editando al cancelarse.\n`;
   const files={'manifest.json':Buffer.from(JSON.stringify(manifest,null,2)),'INSTRUCCIONES.txt':Buffer.from(instructions),'SKILLS_REQUERIDAS.txt':skillInstructions(['colocacion-personaje-por-referencias']),
    'ENTREGA_LOCAL.json':Buffer.from(JSON.stringify({schema:'workbench-placement-delivery/v1',projectId:p.id,deliveryId:h.id,endpoint:`${baseUrl||requestBaseUrl}/api/placement-deliveries/${h.id}`,token},null,2)),
    'ENTREGAR_MODELO.mjs':await fs.readFile(new URL('../scripts/deliver-codex-model.mjs',import.meta.url))};
   if(p.reference)files['concept.png']=await store.read(p,p.reference);
   for(const g of slots)for(const v of ['front','left','right','back'])if(p.groups[g].views[v])files[g+'_'+v+'.png']=await store.read(p,p.groups[g].views[v]);
   for(const name of ['mesh_connectivity.py','finalize_neck_height.py','review_placement.py','export_evaluated_parts.py','manual_hair_clearance.py','connected_falloff.py'])files[name]=await fs.readFile(new URL('./blender/'+name,import.meta.url));
   const linked=[{name:'approved.blend',path:path.join(store.root,p.id,manual.modelSnapshot.blend.id)},{name:'approved.glb',path:path.join(store.root,p.id,manual.modelSnapshot.preview.id)}];
   const zip=await localInstructionPackage(store,p,'model-finish',files,h.id,['colocacion-personaje-por-referencias'],linked);
   // No input models are copied into the workspace or outgoing ZIP.
   if(!model['approved.blend'].equals(await store.read(p,manual.modelSnapshot.blend))||!model['approved.glb'].equals(await store.read(p,manual.modelSnapshot.preview))||p.manualPlacementDraft||store.get(p.id)!==p||hash(JSON.stringify(await placementManifest(store,p)))!==h.manifestHash)fail('PLACEMENT_SOURCE_CHANGED',409);
   await fs.writeFile(path.join(deliveryDirectory(store,p,h.id),'INSTRUCCIONES_CODEX.zip'),zip);await store.save(p);
  }catch(e){p.placementHandoff=previous;throw e;}
 }
 app.post('/api/projects/:id/placement/handoff',async(req,res)=>{
  const p=store.get(req.params.id),release=reservePlacement(store,p.id);try{await prepare(p,`http://127.0.0.1:${req.socket.localPort}`);res.json({handoff:placementHandoffState(p),downloadUrl:`/api/projects/${p.id}/placement/package`});}finally{release();}
 });
 app.get('/api/projects/:id/placement/package',async(req,res)=>{
  const p=store.get(req.params.id),release=reservePlacement(store,p.id);try{
   if(p.placementHandoff?.status!=='waiting')fail('PLACEMENT_DELIVERY_REQUIRED',409);await checked(p,p.placementHandoff);
   res.type('application/zip').attachment('fita_model_finish.zip').send(await fs.readFile(path.join(deliveryDirectory(store,p,p.placementHandoff.id),'INSTRUCCIONES_CODEX.zip')));
  }finally{release();}
 });
 app.post('/api/projects/:id/placement/unlock',async(req,res)=>{
  const p=store.get(req.params.id),release=reservePlacement(store,p.id);try{
   editable(p);if(req.body.confirm!==true||!p.placementHandoff||req.body.deliveryId!==p.placementHandoff.id)fail('PLACEMENT_UNLOCK_CONFIRMATION',409);
   if(p.placementCompleted)fail('PLACEMENT_STAGE_COMPLETED',409);
   const previous=p.placementHandoff;p.placementHandoff={...previous,status:'cancelled',cancelledAt:new Date().toISOString()};
   try{await store.save(p);}catch(e){p.placementHandoff=previous;throw e;}
   res.json({handoff:placementHandoffState(p)});
  }finally{release();}
 });
 app.post('/api/projects/:id/placement/import',upload.single('file'),async(req,res)=>{
  const p=store.get(req.params.id),release=reservePlacement(store,p.id);try{res.json(await receive(p,req.file?.buffer));}finally{release();}
 });
 app.post('/api/projects/:id/placement/continue',async(req,res)=>{
  const p=store.get(req.params.id),release=reservePlacement(store,p.id);try{
   editable(p);const m=currentManual(p),h=p.placementHandoff,run=[...p.placements||[]].reverse().find(r=>['codex','artist-import'].includes(r.source)&&r.status==='succeeded'&&r.manualPlacementId===m?.id);
   if(!m||!run||p.manualPlacementDraft||h?.status==='waiting'||m.modelSnapshot?.storage==='single'&&(h?.status!=='imported'||h.importId!==run.id))fail('PLACEMENT_CODEX_RESULT_REQUIRED',409);
   const next=structuredClone(p);next.placementCompleted={manualId:m.id,placementId:run.id,completedAt:new Date().toISOString()};await store.save(next);res.json({project:presentProject(next)});
  }finally{release();}
 });
 const router=express.Router();
 router.use((req,res,next)=>{if(!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host||'')||req.headers.origin)return res.status(403).json({error:'PLACEMENT_LOCAL_ONLY'});res.set('Cache-Control','no-store');next();});
 router.use('/:deliveryId',(req,res,next)=>{
  const p=[...store.projects.values()].find(p=>p.placementHandoff?.id===req.params.deliveryId),h=p?.placementHandoff,token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!h||!token||!timingSafeEqual(Buffer.from(hash(token)),Buffer.from(h.tokenHash)))return res.status(401).json({error:'PLACEMENT_DELIVERY_UNAUTHORIZED'});req.project=p;next();
 });
 router.get('/:deliveryId',async(req,res)=>{const p=req.project,h=p.placementHandoff;await checked(p,h);res.json({projectId:p.id,status:h.status,importId:h.importId||null});});
 router.post('/:deliveryId',express.raw({type:'application/zip',limit:'300mb'}),async(req,res)=>{
  const p=req.project,release=reservePlacement(store,p.id);try{
   const h=p.placementHandoff;await checked(p,h);if(!Buffer.isBuffer(req.body))fail('PLACEMENT_INVALID_PACKAGE',400);
   const value=await receive(p,req.body);res.json({status:'imported',projectId:p.id,importId:value.run.id,duplicate:value.duplicate});
  }catch(e){if(store.get(p.id)===p&&p.placementHandoff?.status==='waiting'){p.placementHandoff.lastError=e.message;await store.save(p).catch(()=>{});}throw e;}finally{release();}
 });
 router.use((e,q,r,n)=>r.status(e.status||400).json({error:e.message}));return {router};
}

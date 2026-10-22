import {localInstructionPackage} from './local-instruction-package.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import {selectedSource,inspectTextureGlb} from './texture-workflow.js';
import {fingerprintViewSet} from './view-set.js';
import {findBlender} from './placement.js';
import {glbBuffer} from './validation.js';
import {zipBuffers} from './codex-handoff.js';
import {segmentationDelivery} from './segmentation-delivery.js';
import {readSegmentationZip,segFail as fail} from './segmentation-files.js';
import {prepareLocalBudget,SEGMENT_RATE_CARD} from './segment-rate-card.js';
import {validSettings,acceptBudget,advanceChain,studioGroupProvider,budgetIdentity} from './segmentation-budget.js';
import {segmentIdentity,currentSegmentation,segmentationSource,currentSegmentationBaseline} from './segmentation-identity.js';
import {importSegmentationBaseline} from './segmentation-baseline.js';
import {correctRejectedGroup} from './segment-texture-retry.js';
import {correctAssembly} from './assembly-correction.js';
import {SEGMENTATION_POLICY,normalizeHeadGroups,analysisReview} from './segmentation-policy.js';
import {headSegmentationRule} from './segmentation-head-instructions.js';
import {createSegmentReferences,acceptGroupPlan,currentPlan,planIdentity} from './segment-references.js';
import {validateFaceUvProfile} from './face-uv.js';
import {MESH_REPAIR_POLICY,meshRepairInstructions,validateMeshRepairReview} from './mesh-repair-policy.js';
import {cleanBoundaryInstructions} from './segmentation-boundary-instructions.js';
export {segmentIdentity,currentSegmentation} from './segmentation-identity.js';
const hash=b=>createHash('sha256').update(b).digest('hex'),parts=['head','body'];
export async function segmentManifest(store,p){
 const sources={};for(const part of parts){const m=segmentationSource(p,part);if(!m)fail('SEG_CHOOSE_BOTH');sources[part]={id:m.id,sha256:hash(await store.read(p,m))};}
 return {...(p.textureWorkflowVersion===2?{workflowVersion:2,cleanupPolicy:'exact-duplicate-faces/v1'}:{}),meshRepairPolicy:MESH_REPAIR_POLICY,schema:'workbench-segmentation/v1',analysisPolicy:SEGMENTATION_POLICY,projectId:p.id,identity:segmentIdentity(p),sources};
}
export const segmentationInstructions=`FITA · ANÁLISIS Y SEGMENTACIÓN LOCAL
Trabaja en una carpeta nueva con estas copias. No uses Tripo, no subas activos y no gastes créditos. Usa Blender en segundo plano con --disable-autoexec. No hace falta una API de Codex ni dejar un agente conectado.
PIEZAS INDEPENDIENTES: analiza copias de la cabeza y del cuerpo tal como se entregan. NO hagas colocación, escalado, ajuste del cuello ni unión. Conserva los datos existentes. La única excepción topológica previa es la limpieza de duplicados y la reparación ADITIVA de huecos declarada y verificada abajo, ANTES de asignar IDs; la copia reparada será la base de segmentación y transferencia. Las fuentes del workspace local indicado por UBICACIONES.json permanecen intactas. La colocación será posterior al texturizado y la aprobará manualmente el usuario. En proyectos antiguos con baseline conserva esa fuente histórica; no crees una baseline nueva.
${meshRepairInstructions}
${cleanBoundaryInstructions}
1. Lee manifest.json, concept.png y las vistas aprobadas. Ejecuta Blender --background --factory-startup --disable-autoexec --python segment_mesh.py -- analyze job.json. Completa primero la limpieza y reparación obligatorias de arriba y ejecuta prepare. Revisa analysis.json y source.blend reparados. El script detecta objetos, componentes y materiales, NO decide la semántica.
2. Inspecciona también los componentes aislados. Distingue componente geométrico, categoría semántica y grupo de textura. CABEZA: exactamente dos grupos principales, cabello completo (category:hair) y rostro (category:skin). TODO el cabello, flequillo, coletas y mechones pertenece a UN SOLO grupo, aunque contenga islas desconectadas. Rostro incluye piel, orejas, ojos, labios, cejas, pestañas y detalles faciales; no cobres UV/textura aparte para cada rasgo. Los accesorios pequeños comparten el grupo del rostro o del cabello que corresponda. Solo separa accesorios con gran presencia visual o impacto claro en la silueta, comprobado en al menos dos vistas: category:accessories, visualImportance:{significant:true,reason:justificación visual concreta,views:[front,left,...]}. No uses el número de polígonos como prueba de importancia. Si entregas un accesorio pequeño por separado, includeWith:hair|face identifica su atlas principal; por defecto se incorpora al rostro. CUERPO: grupos por prendas/materiales coherentes, sin cantidad fija y sin un grupo por botón, cordón o fragmento pequeño. Cabeza y cuerpo nunca comparten grupo. Usa nombres cortos; guarda explicaciones en los campos técnicos, no en nombres de grupos.
${headSegmentationRule}
CUERPO — PROXIMIDAD Y RESOLUCIÓN: no agrupes únicamente por color/material. Dos regiones desconectadas con un hueco considerable deben ser segmentos distintos para no desperdiciar encuadre ni resolución de textura. Ejemplo: cuello/torso superior/brazos y caderas/piernas, cuando falta toda la zona intermedia, van por separado. Polera y falda pueden compartir un grupo compacto; brazaletes, grilletes, guantes y adornos de muñeca van con brazos/manos cercanos, NUNCA alejados en el grupo de la polera. Incorpora accesorios pequeños al segmento anatómico próximo, sin crear un atlas por adorno. No muevas piezas para acercarlas. No dividas por cada costura UV, vértice duplicado o fragmento casi en contacto. El cabello completo sigue siendo un solo grupo.
3. Edita proposal.json: schema workbench-segmentation-result/v1, groups [{id:slug único,name,part:head|body,category,faces:[IDs de la base reparada],components:[IDs de analysis.json],pending:boolean,referencesReviewed:boolean}], pending:[{reason,faces,part}], warnings:[texto], visualReview:{views:[front,left,right,back,isolated],findings:texto}. Cada cara debe aparecer exactamente una vez; no cambies sus IDs. En regiones fusionadas o ambiguas conserva la superficie y marca pending, con explicación e imágenes de referencia. No cortes silenciosamente. No inventes cuerpo oculto, grosor ni tapas ajenas al diseño. Los únicos polígonos nuevos permitidos son las reparaciones de huecos ya declaradas y verificadas en prepare. No hagas remallado global, rig, física ni animación. Conserva meshRepair completo en proposal.json.
4. Ejecuta ... --python segment_mesh.py -- build job.json. El script conserva las fuentes, guarda segmented.blend con atributos de caras, lo reabre, exporta grupos en las coordenadas originales y correspondence.json. Revisa los grupos aislados y renders frontal/posterior con materiales originales. Los IDs de caras son datos internos: NO prepares láminas coloreadas ni imágenes de IDs para la interfaz. Corrige proposal.json y repite solo el build si hace falta. No modifiques posiciones, UV ni materiales fuente: son el respaldo. No abras scripts externos incluidos en archivos Blender.
COMPROBACIÓN ESPACIAL: build escribe spatialAudit en validated.json para cada grupo del cuerpo, con clusters, bounds, surfaceArea, areaFraction y faces. Si requiresReview=true, separa las regiones grandes distantes o reasigna los accesorios pequeños al segmento anatómico vecino; inspecciona los renders y vuelve a ejecutar build. No basta con cambiar la etiqueta o borrar el aviso: la aplicación recalcula el diagnóstico sobre la geometría original al importar. No modifica caras ni cobra por las divisiones automáticamente.
5. Entrega primero el ANÁLISIS de partes para cotizar cabeza y cuerpo por separado. No generes imágenes nuevas para completar este análisis; deja referencesReviewed=false cuando falten. En el flujo supervisado espera la aceptación de Generar texturas en FITA, verificada con SUPERVISAR_TEXTURAS.mjs. Después solicita references y sigue su workspace: exactamente tres PNG front/right/back por segmento. Las guías del build son geometría real, no recortes conceptuales ni referencias de textura terminadas. Los PNG front/back ya existentes se conservan como material histórico; no sustituyen las tres referencias requeridas por el plan actual.
6. Abre segmented.blend guardado; revisa etiquetas, cobertura y ocho vistas de las dos partes. Crea segmentation_result.zip SOLO con manifest.json original, result.json (copia de proposal.json), segmented.blend, references/<id>_front.png y _back.png si existen, y las 20 capturas obligatorias de reparación antes/después en review/<nombre>.png; puedes incluir hasta 32 capturas en total. Incluye capturas de cualquier región ambigua y referencia sus nombres en warnings/pending/visualReview. No incluyas scripts, tokens ni fuentes duplicadas en el resultado.
7. Ejecuta node ENTREGAR_SEGMENTACION.mjs ruta/al/segmentation_result.zip. --check consulta la entrega. Guarda el recibo IMPORTED; no escribas directamente en data de FITA. También puede importarse el ZIP en Texturas. No vuelvas a segmentar por una entrega interrumpida: reutiliza el mismo ZIP. La importación NO aprueba etiquetas, referencias ni presupuesto; el artista debe revisar y confirmar.
Para corregir una propuesta anterior, usa previous-result.json como punto de partida conservando IDs de caras y aplica las reglas actuales de cabeza. Una división de grupo exige inspección visual nueva. La aplicación no ofrece combinación manual de grupos. Las notas warnings/pending/visualReview son registros técnicos para Codex; la interfaz muestra solo el estado y las partes. Revisa también el contexto técnico al corregir el paquete. No inventes precios ni declares aprobación del artista.
`;
export const segmentationErrorCode=tail=>[...tail.matchAll(/^ValueError:\s*(SEG_[A-Z_]+)\s*$/gm)].at(-1)?.[1]||'SEG_BLENDER_FAILED';
export function runSegmentation(mode,job,{executable}={}){return new Promise(async(resolve,reject)=>{
 try{executable ||= await findBlender();if(!executable)fail('PLACEMENT_BLENDER_NOT_FOUND');}catch(e){reject(e);return;}
 const child=spawn(executable,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',path.resolve('server/blender/segment_mesh.py'),'--',mode,job],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let tail='';const timer=setTimeout(()=>{child.kill();reject(Error('SEG_VALIDATION_TIMEOUT'));},240000);
 const collect=b=>tail=(tail+b).slice(-8000);child.stdout.on('data',collect);child.stderr.on('data',collect);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',async code=>{clearTimeout(timer);if(code!==0){reject(Error(segmentationErrorCode(tail)));return;}try{resolve();}catch(e){reject(e);}});
});}
export async function createSegmentation({store,editable,gate,presentProject,bridge,provider=studioGroupProvider(bridge,{store}),runner=runSegmentation,deliveryOptions={}}){
 for(const p of store.projects.values()){const plan=currentPlan(p);if(plan?.workflowVersion===2&&['references-ready','running','reconstructing'].includes(plan.status)){plan.status='attention';plan.error='SEG_OPERATION_UNKNOWN';await store.save(p);}}
 const locks=new Set(),chainLocks=new Set(),planLocks=new Set(),quoteLocks=new Set();let delivery,supervisor;
 const providerFor=p=>provider.forProject?provider.forProject(p):provider;
 const ensure=p=>{editable(p);for(const g of parts){if(!selectedSource(p,g))fail('SEG_CHOOSE_BOTH');gate(p,g);}};
 const idle=p=>{ensure(p);if(chainLocks.has(p.id)||quoteLocks.has(p.id)||(p.segmentTextureRuns||[]).some(r=>['pending','running','attention'].includes(r.status)))fail('SEG_BUSY');};
 const publicRun=r=>r?{...r,groups:r.groups.map(({faces,spatialAudit,...g})=>({...g,faceCount:faces.length,spatialAudit:spatialAudit?{version:spatialAudit.version,requiresReview:spatialAudit.requiresReview}:undefined})),review:analysisReview(r),pending:undefined,warnings:undefined,visualReview:undefined,reviewImages:undefined,colored:undefined,proposal:undefined}:null;
 async function makePackage(p,manifest,descriptor,{correction=false}={}){
  ensure(p);const files={'mesh_connectivity.py':await fs.readFile(new URL('./blender/mesh_connectivity.py',import.meta.url)),'manifest.json':Buffer.from(JSON.stringify(manifest,null,2)),'INSTRUCCIONES.txt':Buffer.from(segmentationInstructions),'segment_mesh.py':await fs.readFile(new URL('./blender/segment_mesh.py',import.meta.url)),
  'job.json':Buffer.from(JSON.stringify({meshRepairPolicy:manifest.meshRepairPolicy,...(manifest.cleanupPolicy?{cleanupPolicy:manifest.cleanupPolicy}:{}),sources:{head:'head.glb',body:'body.glb'},directory:'.',proposal:'proposal.json'},null,2)),'ENTREGA_LOCAL.json':Buffer.from(JSON.stringify(descriptor,null,2)),'ENTREGAR_SEGMENTACION.mjs':await fs.readFile(new URL('../scripts/deliver-segmentation.mjs',import.meta.url)),
  'mesh_hole_repair.py':await fs.readFile(new URL('./blender/mesh_hole_repair.py',import.meta.url)),'REPARAR_HUECOS.md':await fs.readFile(new URL('../docs/REPARAR_HUECOS.md',import.meta.url))};
  if(manifest.workflowVersion===2){files['clean_duplicate_faces.py']=await fs.readFile(new URL('./blender/clean_duplicate_faces.py',import.meta.url));if(supervisor)Object.assign(files,await supervisor.issue(p));files['INSTRUCCIONES.txt']=Buffer.from(segmentationInstructions+'\nLee FLUJO_SUPERVISADO.txt. Usa cleanupPolicy de job.json antes de analizar; conserva ese campo en proposal.json.');}
  for(const g of parts){files[g+'.glb']=await store.read(p,segmentationSource(p,g));for(const [v,a] of Object.entries(p.groups[g].views))files[g+'_'+v+'.png']=await store.read(p,a);}
  if(p.reference)files['concept.png']=await store.read(p,p.reference);
  const old=currentSegmentation(p);if(old){files['previous-result.json']=Buffer.from(JSON.stringify(old.proposal,null,2));if(correction)files['previous-segmented.blend']=await store.read(p,old.blend);}
  return localInstructionPackage(store,p,'segmentation',files,descriptor.deliveryId);
 }
 async function importPackage(p,buffer,beforeCommit=()=>{},override=null){
  idle(p);if(locks.has(p.id))fail('SEG_BUSY');locks.add(p.id);let dir;const staged=[];const identity=segmentIdentity(p);
  try{
   const manifest=await segmentManifest(store,p),files=override?.files||await readSegmentationZip(buffer),digest=hash(buffer);
   if(JSON.stringify(JSON.parse(files['manifest.json']))!==JSON.stringify(manifest))fail('SEG_INPUTS_CHANGED');
   const duplicate=p.segmentations?.find(r=>r.packageHash===digest&&r.identity===identity);if(duplicate)return duplicate;
   const proposal=JSON.parse(files['result.json']);if(manifest.cleanupPolicy&&proposal.cleanupPolicy!==manifest.cleanupPolicy)fail('SEG_CLEANUP_POLICY');if(proposal.schema!=='workbench-segmentation-result/v1'||!Array.isArray(proposal.groups)||proposal.groups.length>64||!Array.isArray(proposal.pending)||!Array.isArray(proposal.warnings))fail('SEG_PACKAGE_INVALID',400);
   validateMeshRepairReview(proposal.meshRepair,files);
   if(!files['segmented.blend']||files['segmented.blend'].subarray(0,7).toString()!=='BLENDER')fail('SEG_PACKAGE_INVALID',400);
   for(const g of proposal.groups){if(!/^[a-z0-9_-]{1,64}$/.test(g.id)||!validSettings(g.settings||{resolution:'4K',removeLighting:false}))fail('SEG_GROUPS_INVALID',400);}
   const reviews=Object.keys(files).filter(n=>/^review\/[a-z0-9_-]{1,64}\.png$/.test(n));if(reviews.length>32)fail('SEG_PACKAGE_INVALID',400);
   const permitted=new Set(['manifest.json','result.json','segmented.blend',...reviews,...proposal.groups.flatMap(g=>['front','back'].map(v=>`references/${g.id}_${v}.png`))]);if(Object.keys(files).some(n=>!permitted.has(n)))fail('SEG_PACKAGE_INVALID',400);
   dir=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-segment-'));
   const sources={};for(const g of parts){sources[g]=path.join(dir,g+'.glb');await fs.writeFile(sources[g],await store.read(p,segmentationSource(p,g)));}
   await fs.mkdir(path.join(dir,'review'));for(const name of reviews)await fs.writeFile(path.join(dir,name),files[name]);
   const job={meshRepairPolicy:manifest.meshRepairPolicy,...(manifest.cleanupPolicy?{cleanupPolicy:manifest.cleanupPolicy}:{}),sources,directory:dir,proposal:path.join(dir,'proposal.json'),inputBlend:path.join(dir,'input.blend'),render:false};await fs.writeFile(job.proposal,files['result.json']);await fs.writeFile(job.inputBlend,files['segmented.blend']);const jobFile=path.join(dir,'job.json');await fs.writeFile(jobFile,JSON.stringify(job));
   await runner(override?'build':'verify',jobFile);
   // Verify the delivered labels first; only then consolidate trusted original
   // face sets. References of changed groups must be prepared again.
   const normalized=normalizeHeadGroups(proposal);
   if(normalized.changedIds.length){
    for(const id of normalized.changedIds)for(const view of ['front','back'])delete files[`references/${id}_${view}.png`];
    await fs.writeFile(job.proposal,JSON.stringify(normalized.proposal));await runner('build',jobFile);
   }
   const verified=JSON.parse(await fs.readFile(path.join(dir,'validated.json'),'utf8'));
   if(!verified.geometryPreserved||!verified.savedAndReopened)fail('SEG_GEOMETRY_CHANGED');
   if(verified.meshRepair?.policy!==MESH_REPAIR_POLICY||verified.meshRepair.reviewed!==true)fail('SEG_MESH_REPAIR_REQUIRED');
   const save=async(bytes,ext,label)=>{const a=await store.asset(p,bytes,ext,label);staged.push(a);return a;};
   const groups=[];
   for(const g of verified.groups){
    const asset=await save(glbBuffer(await fs.readFile(path.join(dir,g.id+'.glb'))),'glb','Segmented group'),references={};
    for(const v of ['front','back'])if(files[`references/${g.id}_${v}.png`]){const b=files[`references/${g.id}_${v}.png`],info=await sharp(b).metadata();if(info.format!=='png'||info.width<256||info.height<256||info.width*info.height>40000000)fail('SEG_REFERENCE_INVALID');await sharp(b).stats();references[v]=await save(b,'png','Segmentation texture reference');}
    groups.push({...g,settings:g.settings||{resolution:'4K',removeLighting:false},asset,references,referencesReady:g.referencesReviewed===true&&!!references.front&&!!references.back});
   }
   const colored={};for(const g of parts)colored[g]=await save(glbBuffer(await fs.readFile(path.join(dir,g+'-ids.glb'))),'glb','Segmentation ID preview');
   const blend=await save(await fs.readFile(path.join(dir,'segmented.blend')),'blend','Segmentation editable');
   const correspondence=await save(await fs.readFile(path.join(dir,'correspondence.json')),'json','Segmentation correspondence');
   const reviewImages=[];for(const name of reviews){const info=await sharp(files[name]).metadata();if(info.format!=='png'||info.width*info.height>40000000)fail('SEG_REFERENCE_INVALID');await sharp(files[name]).stats();reviewImages.push({...await save(files[name],'png','Segmentation review'),name});}
   await beforeCommit();if(store.get(p.id)!==p||identity!==segmentIdentity(p)||JSON.stringify(await segmentManifest(store,p))!==JSON.stringify(manifest))fail('SEG_INPUTS_CHANGED');ensure(p);
   const run={id:randomUUID(),identity,manifest,workflowVersion:manifest.workflowVersion,cleanupPolicy:manifest.cleanupPolicy,cleanup:verified.cleanup,meshRepair:verified.meshRepair,supervisionId:manifest.workflowVersion===2?p.textureSupervisorId:null,packageHash:digest,proposal:normalized.proposal,groups,counts:verified.counts,pending:verified.pending,warnings:verified.warnings,visualReview:verified.visualReview,blend,colored,correspondence,reviewImages,approval:null,createdAt:new Date().toISOString()};
   const previous=p.segmentations;p.segmentations=[...previous||[],run];try{await store.save(p);}catch(e){p.segmentations=previous;throw e;}staged.length=0;return run;
  }finally{locks.delete(p.id);for(const a of staged)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});if(dir)await fs.rm(dir,{recursive:true,force:true});}
 }
 delivery=await segmentationDelivery({store,snapshot:p=>segmentManifest(store,p),makePackage,importPackage,...deliveryOptions});
 async function saveRun(p,run){
  for(const op of run.operations)if(op.step==='download'&&op.status==='completed'&&!op.downloadAsset){const bytes=await provider.resultBytes(op.receipt);op.downloadAsset=await store.asset(p,bytes,'glb','Original Studio group result');}
  await store.save(p);
 }
 async function launch(p,run){if(chainLocks.has(p.id))return;chainLocks.add(p.id);try{const seg=currentSegmentation(p);if(!seg||seg.id!==run.segmentationId)fail('SEG_INPUTS_CHANGED');await advanceChain({run,seg,provider:providerFor(p),save:()=>saveRun(p,run),isCurrent:()=>store.get(p.id)===p&&currentSegmentation(p)?.id===seg.id});}catch(e){run.status='attention';run.error=e.message;if(store.get(p.id)===p)await store.save(p);}finally{chainLocks.delete(p.id);}}
 async function quoteAll(p){
  idle(p);const s=currentSegmentation(p);if(!s?.approval)fail('SEG_APPROVAL_REQUIRED');quoteLocks.add(p.id);const identity=planIdentity(s);
  p.segmentQuotation={identity,rateCardId:SEGMENT_RATE_CARD.id,status:'running',part:'head',error:null,startedAt:new Date().toISOString()};
  try{await store.save(p);for(const part of parts){
   p.segmentQuotation.part=part;await store.save(p);
   const b=prepareLocalBudget(s,part);
   if(currentSegmentation(p)!==s||identity!==planIdentity(s))fail('SEG_INPUTS_CHANGED');(p.segmentBudgets||=[]).push(b);await store.save(p);
   if(!b.complete)fail(b.rows.flatMap(r=>[r.smartUV,r.texture]).find(q=>!q.verified)?.reason||'SEG_PRICE_PENDING');
  }p.segmentQuotation.status='completed';}
  catch(e){p.segmentQuotation.status='attention';p.segmentQuotation.error=e.message;}
  finally{quoteLocks.delete(p.id);await store.save(p);}
 }
 async function launchPlan(p){
  const plan=currentPlan(p);if(!plan?.referencesReceipt||!['references-ready','running'].includes(plan.status)||planLocks.has(p.id))return;
  planLocks.add(p.id);plan.status='running';await store.save(p);
  try{
   if(plan.requiresSupervisor&&plan.supervisorVerified?.planId!==plan.id)fail('SUPERVISOR_CONSENT_CHECK_REQUIRED');
   for(const part of parts){
    if(currentPlan(p)!==plan)fail('SEG_INPUTS_CHANGED');const s=currentSegmentation(p),b=plan.budgets.find(b=>b.part===part);
    let run=p.segmentTextureRuns?.find(r=>r.planId===plan.id&&r.part===part);
    if(!run){run=acceptBudget(s,b,{maxCredits:b.total,confirm:true,confirmSeparateAssets:true});run.planId=plan.id;(p.segmentTextureRuns||=[]).push(run);plan.runIds.push(run.id);await store.save(p);}
    await launch(p,run);if(run.status!=='completed')fail(run.error||'SEG_OPERATION_UNKNOWN');
   }
   if(plan.workflowVersion===2){plan.status='ready-to-finish';}
   else{plan.status='reconstructing';await store.save(p);await reconstruct(p);plan.status='completed';}
  }catch(e){plan.status='attention';plan.error=e.message;}
  finally{planLocks.delete(p.id);await store.save(p);}
 }
 async function resumePlan(p){
  const plan=currentPlan(p);if(!plan?.referencesReceipt||plan.status!=='attention'||planLocks.has(p.id)||chainLocks.has(p.id))fail('SEG_BUSY');
  plan.status='references-ready';plan.error=null;await store.save(p);void launchPlan(p);return plan;
 }
 const references=await createSegmentReferences({store,runner,ensure,idle,deliveryOptions,afterImport:launchPlan});
 async function reconstruct(p){
    const s=currentSegmentation(p);ensure(p);if(!s?.approval||locks.has(p.id))fail('SEG_APPROVAL_REQUIRED');
    const runs=parts.map(part=>[...p.segmentTextureRuns||[]].reverse().find(r=>r.part===part&&r.status==='completed'&&r.identity===budgetIdentity(s,part)));if(runs.some(r=>!r))fail('SEG_RESULTS_REQUIRED');
    const runIds=runs.map(r=>r.id),approvalId=s.approval.id,identities=parts.map(part=>budgetIdentity(s,part));
    if(JSON.stringify(s.reconstruction?.runIds)===JSON.stringify(runIds))return {project:presentProject(p),reconstruction:s.reconstruction};
    const check=()=>{if(store.get(p.id)!==p||currentSegmentation(p)!==s||approvalId!==s.approval?.id||parts.some((part,i)=>budgetIdentity(s,part)!==identities[i]))fail('SEG_INPUTS_CHANGED');};
    locks.add(p.id);let dir;const staged=[];try{dir=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-reconstruct-'));const job={...(s.manifest?.meshRepairPolicy?{meshRepairPolicy:s.manifest.meshRepairPolicy}:{}),...(s.cleanupPolicy?{cleanupPolicy:s.cleanupPolicy}:{}),directory:dir,sources:{},results:{},proposal:path.join(dir,'proposal.json')};await fs.writeFile(job.proposal,JSON.stringify(s.proposal));for(const part of parts){job.sources[part]=path.join(dir,part+'.glb');await fs.writeFile(job.sources[part],await store.read(p,segmentationSource(p,part)));}
     for(const group of s.groups){const op=runs.flatMap(r=>r.operations).find(o=>o.groupId===group.id&&o.step==='download'&&o.status==='completed');if(!op)fail('SEG_RESULTS_REQUIRED');const bytes=op.downloadAsset?await store.read(p,op.downloadAsset):await provider.resultBytes(op.receipt);check();if(!op.downloadAsset){op.downloadAsset=await store.asset(p,glbBuffer(bytes),'glb','Original Studio group result');await store.save(p);}inspectTextureGlb(bytes);job.results[group.id]=path.join(dir,group.id+'-result.glb');await fs.writeFile(job.results[group.id],bytes);}
     const file=path.join(dir,'job.json');await fs.writeFile(file,JSON.stringify(job));await runner('reconstruct',file);check();
     const report=JSON.parse(await fs.readFile(path.join(dir,'reconstruction.json'),'utf8'));if(!report.geometryPreserved||!report.cornerUvTransfer||!report.savedAndReopened)fail('SEG_GEOMETRY_CHANGED');
     if(s.manifest?.meshRepairPolicy&&(!report.meshRepair?.reviewed||report.meshRepair.repairedFingerprint!==s.meshRepair?.repairedFingerprint))fail('SEG_MESH_REPAIR_REQUIRED');
     const save=async(bytes,ext,label)=>{const a=await store.asset(p,bytes,ext,label);staged.push(a);return a;},textures=[];
     for(const part of parts){const bytes=glbBuffer(await fs.readFile(path.join(dir,part+'-textured.glb')));inspectTextureGlb(bytes);textures.push({...await save(bytes,'glb','Segmented Studio texture'),group:part,sourceModelId:selectedSource(p,part).id,fingerprint:fingerprintViewSet(p,part),segmentationId:s.id,segmentationApprovalId:approvalId,refinementRequired:true,...(s.workflowVersion===2?{supervisedPending:true}:{})});}
     const blend=await save(await fs.readFile(path.join(dir,'textured.blend')),'blend','Segmented texture reconstruction');check();
     const previousTextures=p.textures,previousResult=s.reconstruction;p.textures=[...previousTextures||[],...textures];s.reconstruction={blend,report,runIds,textureIds:textures.map(t=>t.id),reviewRequired:true,refinementRequired:true};
     try{await store.save(p);}catch(e){p.textures=previousTextures;s.reconstruction=previousResult;throw e;}staged.length=0;return {project:presentProject(p),reconstruction:s.reconstruction};
    }catch(e){if(store.get(p.id)===p){(s.reconstructionAttempts||=[]).push({at:new Date().toISOString(),runIds,error:e.message});await store.save(p);}throw e;}
    finally{locks.delete(p.id);for(const a of staged)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});if(dir)await fs.rm(dir,{recursive:true,force:true});}
 }
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:300*1024*1024,files:1}});
 return {delivery,references,importPackage,resumePlan,setSupervisor:value=>{supervisor=value;},async finishForAgent(p){const plan=currentPlan(p);if(plan?.workflowVersion!==2||!['ready-to-finish','finishing'].includes(plan.status)||planLocks.has(p.id))fail('SUPERVISOR_STAGE_MISMATCH');planLocks.add(p.id);try{await reconstruct(p);plan.status='finishing';plan.error=null;await store.save(p);}catch(e){plan.status='attention';plan.error=e.message;await store.save(p);throw e;}finally{planLocks.delete(p.id);}},isBusy:id=>locks.has(id)||chainLocks.has(id)||quoteLocks.has(id)||planLocks.has(id),
  async normalizeExisting(p){
   const old=currentSegmentation(p);if(!old||!normalizeHeadGroups(old.proposal).changedIds.length)return old;
   const files={'manifest.json':Buffer.from(JSON.stringify(await segmentManifest(store,p))),'result.json':Buffer.from(JSON.stringify({...old.proposal,analysisPolicy:SEGMENTATION_POLICY})),'segmented.blend':await store.read(p,old.blend)};
   for(const g of old.groups)for(const [view,asset] of Object.entries(g.references||{}))files[`references/${g.id}_${view}.png`]=await store.read(p,asset);
   for(const asset of old.reviewImages||[])files[asset.name]=await store.read(p,asset);
   // Import performs full verification before relabeling copies, and appends a
   // new version. Previous analysis, approvals and paid results are untouched.
   return importPackage(p,await zipBuffers(files));
  },
  mount(app){const root='/api/projects/:id/segmentation';
   app.post(root+'/face-uv-profile',async(req,res)=>{
    const p=store.get(req.params.id);ensure(p);idle(p);const s=currentSegmentation(p);
    if(!s||req.body.id!==s.id||s.reconstruction||locks.has(p.id)||planLocks.has(p.id))fail('SEG_INPUTS_CHANGED');
    const profile=validateFaceUvProfile(req.body.profile),previous=s.faceUvProfile;s.faceUvProfile=profile;
    try{await store.save(p);}catch(e){s.faceUvProfile=previous;throw e;}
    res.json({id:s.id,profile});
   });
   app.post(root+'/resume-supervision',async(req,res)=>{const p=store.get(req.params.id);idle(p);if(!supervisor||locks.has(p.id)||planLocks.has(p.id))fail('SEG_BUSY');res.type('application/zip').attachment('fita_resume_textures.zip').send(await supervisor.resumePackage(p));});
   app.post(root+'/correct-rejected-references',multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:3}}).fields([{name:'front',maxCount:1},{name:'right',maxCount:1},{name:'back',maxCount:1}]),async(req,res)=>{const p=store.get(req.params.id);ensure(p);if(locks.has(p.id)||chainLocks.has(p.id)||planLocks.has(p.id)||quoteLocks.has(p.id))fail('SEG_BUSY');locks.add(p.id);try{res.json(await correctRejectedGroup({p,store,provider,input:JSON.parse(req.body.input||'{}'),files:req.files,check:()=>ensure(p)}));}finally{locks.delete(p.id);}});
   app.post(root+'/baseline',upload.single('file'),async(req,res)=>{
    const p=store.get(req.params.id);idle(p);if(locks.has(p.id)||planLocks.has(p.id))fail('SEG_BUSY');locks.add(p.id);
    try{const input=JSON.parse(req.body.manifest||'{}');const baseline=await importSegmentationBaseline({p,store,runner,buffer:req.file?.buffer,input,check:()=>{if(store.get(p.id)!==p)fail('SEG_INPUTS_CHANGED');ensure(p);}});res.json({baseline});}finally{locks.delete(p.id);}
   });
   app.get(root+'/baseline',async(req,res)=>res.json({baseline:currentSegmentationBaseline(store.get(req.params.id))}));
   app.get(root,async(req,res)=>{const p=store.get(req.params.id),current=currentSegmentation(p);
    if(current?.approval&&!currentPlan(p)&&!quoteLocks.has(p.id)&&!(p.segmentTextureRuns||[]).some(r=>['pending','running','attention'].includes(r.status))&&(p.segmentQuotation?.identity!==planIdentity(current)||p.segmentQuotation?.rateCardId!==SEGMENT_RATE_CARD.id))await quoteAll(p);
    if(p.segmentQuotation?.status==='running'&&!quoteLocks.has(p.id)){p.segmentQuotation={...p.segmentQuotation,status:'attention',error:'SEG_QUOTE_INTERRUPTED'};await store.save(p);}
    res.json({supervision:supervisor?.summary(p),eligible:parts.every(g=>!!selectedSource(p,g)),current:publicRun(current),history:(p.segmentations||[]).map(r=>({id:r.id,current:r.id===current?.id,createdAt:r.createdAt,groups:r.groups.length})),delivery:await delivery.status(p),referencesDelivery:await references.status(p),quotation:p.segmentQuotation,plan:currentPlan(p),capabilities:provider.capabilities(),budgets:(p.segmentBudgets||[]).filter(b=>b.identity===(current?budgetIdentity(current,b.part):null)),runs:(p.segmentTextureRuns||[]).filter(r=>r.segmentationId===current?.id)});});
   app.post(root+'/quote-all',async(req,res)=>{const p=store.get(req.params.id);idle(p);if(!currentSegmentation(p)?.approval)fail('SEG_APPROVAL_REQUIRED');await quoteAll(p);res.json({status:p.segmentQuotation.status,error:p.segmentQuotation.error});});
   app.get(root+'/studio-inspect',async(req,res)=>res.json(await provider.inspect()));
   // Repair/verify only the free Save phase of an existing UV operation. Never
   // resume the paid chain here, and never relabel an already-downloaded texture
   // as having used the UV layout the user has just saved manually.
   app.post(root+'/recover-uv-save',async(req,res)=>{
    const p=store.get(req.params.id);ensure(p);
    if(chainLocks.has(p.id)||planLocks.has(p.id)||locks.has(p.id)||quoteLocks.has(p.id))fail('SEG_BUSY');
    const run=p.segmentTextureRuns?.find(r=>r.operations.some(o=>o.id===req.body.operationId&&o.step==='smartUV'));
    const operation=run?.operations.find(o=>o.id===req.body.operationId),seg=p.segmentations?.find(s=>s.id===run?.segmentationId),group=seg?.groups.find(g=>g.id===operation?.groupId);
    if(!operation||!group)fail('SEG_OPERATION_MISSING');
    locks.add(p.id);
    try{
     const receipt=await provider.forProject(p).recover({operation:{...operation,optimizeUV:req.body.optimizeUV===true},group});
     const audit={operationId:operation.id,groupId:group.id,at:new Date().toISOString(),receipt,existingTextureRequiresReview:run.operations.some(o=>o.groupId===group.id&&o.step==='texture'&&o.status==='completed')};
     (p.uvSaveAudits||=[]).push(audit);await store.save(p);res.json({audit});
    }finally{locks.delete(p.id);}
   });
   app.post(root+'/accept-plan',async(req,res)=>{const p=store.get(req.params.id);idle(p);if(currentPlan(p))fail('SEG_BUSY');const s=currentSegmentation(p),plan=acceptGroupPlan(s,p.segmentBudgets||[],req.body);p.segmentTexturePlan=plan;await store.save(p);res.json({plan});});
   app.post(root+'/references/package',async(req,res)=>{const p=store.get(req.params.id);idle(p);res.json(await references.issue(p,req.body||{}));});
   app.get(root+'/references/delivery/:deliveryId',async(req,res)=>res.type('application/zip').attachment('fita_texture_references.zip').send(await references.package(store.get(req.params.id),req.params.deliveryId)));
   app.post(root+'/resume-plan',async(req,res)=>{const p=store.get(req.params.id);res.status(202).json({plan:await resumePlan(p)});});
   app.post(root+'/package',async(req,res)=>{const p=store.get(req.params.id);idle(p);if(req.body.supervised===true&&p.textureWorkflowVersion!==2){p.textureWorkflowVersion=2;await store.save(p);}res.json(await delivery.issue(p,req.body||{}));});
   app.get(root+'/delivery/:deliveryId',async(req,res)=>res.type('application/zip').attachment('fita_segmentation.zip').send(await delivery.package(store.get(req.params.id),req.params.deliveryId)));
   app.post(root+'/import',upload.single('file'),async(req,res)=>{const p=store.get(req.params.id),run=await importPackage(p,req.file?.buffer);res.json({run:publicRun(run)});});
   app.post(root+'/approve',async(req,res)=>{const p=store.get(req.params.id);idle(p);const s=currentSegmentation(p),review=analysisReview(s);if(!s||s.id!==req.body.id||req.body.confirm!==true)fail('SEG_REVIEW_REQUIRED');if(!review.canApprove)fail(review.reason);if(review.reviewCount&&req.body.confirmReviewedRegions!==true)fail('SEG_REVIEW_REQUIRED');const previous=s.approval;s.approval||={id:randomUUID(),at:new Date().toISOString(),reviewedRegions:review.reviewCount};try{await store.save(p);}catch(e){s.approval=previous;throw e;}await quoteAll(p);res.json({run:publicRun(s)});});
   // Retired endpoint also rejects stale browser tabs; no hidden merge action.
   app.post(root+'/merge',async(req,res)=>res.status(410).json({error:'SEG_COMBINE_REMOVED'}));
   app.post(root+'/settings',async(req,res)=>{const p=store.get(req.params.id),s=currentSegmentation(p),g=s?.groups.find(g=>g.id===req.body.groupId);idle(p);if(!s||s.id!==req.body.id||!g||!validSettings(req.body.settings))fail('SEG_SETTINGS_INVALID');g.settings={resolution:req.body.settings.resolution,removeLighting:req.body.settings.removeLighting};s.proposal.groups.find(x=>x.id===g.id).settings=g.settings;await store.save(p);res.json({run:publicRun(s)});});
   app.post(root+'/budget',async(req,res)=>{const p=store.get(req.params.id),s=currentSegmentation(p);ensure(p);if(!s||!parts.includes(req.body.part))fail('SEG_APPROVAL_REQUIRED');const budget=prepareLocalBudget(s,req.body.part);if(currentSegmentation(p)!==s)fail('SEG_INPUTS_CHANGED');(p.segmentBudgets||=[]).push(budget);await store.save(p);res.json({budget});});
   app.post(root+'/texture',async(req,res)=>{const p=store.get(req.params.id);ensure(p);if(!provider.capabilities().supported)fail('SEG_STUDIO_VALIDATION_REQUIRED');const s=currentSegmentation(p),b=p.segmentBudgets?.find(b=>b.id===req.body.budgetId);if(!s)fail('SEG_APPROVAL_REQUIRED');if((p.segmentTextureRuns||[]).some(r=>['pending','running','attention'].includes(r.status)))fail('SEG_BUSY');const run=acceptBudget(s,b,req.body);(p.segmentTextureRuns||=[]).push(run);await store.save(p);res.status(202).json({run});void launch(p,run);});
   app.post(root+'/resume',async(req,res)=>{const p=store.get(req.params.id),run=p.segmentTextureRuns?.find(r=>r.id===req.body.runId);if(!run)fail('SEG_OPERATION_MISSING');res.status(202).json({run});void launch(p,run);});
   app.post(root+'/stop',async(req,res)=>{const p=store.get(req.params.id),run=p.segmentTextureRuns?.find(r=>r.id===req.body.runId);if(!run||run.status!=='attention'||chainLocks.has(p.id)||req.body.confirmStop!==true)fail('SEG_BUSY');run.status='stopped';run.stoppedAt=new Date().toISOString();await store.save(p);res.json({run});});
   app.post(root+'/approve-reconstruction',async(req,res)=>{const p=store.get(req.params.id),s=currentSegmentation(p);ensure(p);if(!s?.reconstruction||s.id!==req.body.id||req.body.confirm!==true)fail('SEG_REVIEW_REQUIRED');s.reconstruction.reviewRequired=false;s.reconstruction.reviewedAt=new Date().toISOString();await store.save(p);res.json({run:publicRun(s)});});
   app.post(root+'/reapprove-budget',async(req,res)=>{const p=store.get(req.params.id),s=currentSegmentation(p),run=p.segmentTextureRuns?.find(r=>r.id===req.body.runId),budget=p.segmentBudgets?.find(b=>b.id===req.body.budgetId);if(!s||!run||run.status!=='attention'||run.identity!==budget?.identity||chainLocks.has(p.id))fail('SEG_BUDGET_STALE');const approved=acceptBudget(s,budget,req.body);if(approved.maxCredits<run.committedCredits)fail('SEG_BUDGET_EXCEEDED');run.budget=approved.budget;run.maxCredits=approved.maxCredits;run.error=null;await store.save(p);res.json({run});});
   app.post(root+'/reconstruct',async(req,res)=>{const p=store.get(req.params.id);if(currentPlan(p)?.workflowVersion===2)fail('SUPERVISOR_STAGE_MISMATCH');res.json(await reconstruct(p));});
   app.post(root+'/correct-assembly',upload.single('file'),async(req,res)=>{
    const p=store.get(req.params.id);idle(p);if(locks.has(p.id))fail('SEG_BUSY');locks.add(p.id);
    try{const result=await correctAssembly({p,store,runner,buffer:req.file?.buffer,input:JSON.parse(req.body.manifest||'{}'),check:()=>{if(store.get(p.id)!==p)fail('SEG_INPUTS_CHANGED');ensure(p);}});res.json({...result,project:presentProject(p)});}finally{locks.delete(p.id);}
   });
  }
 };
}

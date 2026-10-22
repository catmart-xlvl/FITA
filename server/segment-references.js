import {textureReferenceAppearance} from './production-appearance.js';
import {localInstructionPackage} from './local-instruction-package.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {zipBuffers} from './codex-handoff.js';
import {currentSegmentation} from './segmentation-identity.js';
import {budgetIdentity} from './segmentation-budget.js';
import {budgetPrice} from './segment-rate-card.js';
import {segmentationDelivery} from './segmentation-delivery.js';
import {readSegmentationZip,segFail as fail} from './segmentation-files.js';
import {skinReferenceInstructions,segmentReferencePrompt} from './segment-reference-prompts.js';
import {COVERAGE_POLICY,validateCoverage} from './texture-coverage.js';
const parts=['head','body'],views=['front','right','back'];
const hash=b=>createHash('sha256').update(b).digest('hex');
export const planIdentity=s=>JSON.stringify(parts.map(part=>budgetIdentity(s,part)));
export function acceptGroupPlan(s,budgets,input){
 if(!s?.approval||input.confirm!==true||input.confirmUpload!==true||input.autoStart!==true)fail('SEG_BUDGET_CONFIRMATION');
 const selected=parts.map(part=>budgets.find(b=>b.id===input.budgetIds?.[part]&&b.part===part));
 if(selected.some((b,i)=>!b||b.identity!==budgetIdentity(s,parts[i])||!b.complete||!b.rows.length||b.rows.some(r=>!budgetPrice(r.smartUV)||!budgetPrice(r.texture))))fail('SEG_BUDGET_STALE');
 const totals=Object.fromEntries(selected.map(b=>[b.part,b.rows.reduce((n,r)=>n+r.smartUV.credits+r.texture.credits,0)]));
 if(input.total!==totals.head+totals.body)fail('SEG_BUDGET_CONFIRMATION');
 return {...(s.workflowVersion===2?{workflowVersion:2}:{}),requiresSupervisor:s.workflowVersion===2&&!!s.supervisionId,coveragePolicy:COVERAGE_POLICY,id:randomUUID(),identity:planIdentity(s),segmentationId:s.id,budgets:structuredClone(selected),totals,total:input.total,maxCredits:input.total,autoStart:true,status:'waiting-references',createdAt:new Date().toISOString(),runIds:[]};
}
export function currentPlan(p){const s=currentSegmentation(p);return s&&p.segmentTexturePlan?.identity===planIdentity(s)?p.segmentTexturePlan:null;}
export const referenceInstructions=`FITA · REFERENCIAS DE TEXTURA POR SEGMENTO
Lee también prompts/<id>.txt para cada segmento. Las piezas de piel y torso usan esta regla adicional:
${skinReferenceInstructions}
El artista ya aprobó las piezas y el presupuesto. Tu tarea es crear imágenes; FITA ejecutará Tripo, una pieza por turno, dentro del presupuesto aceptado. NO uses Tripo ni pulses operaciones pagadas desde Codex. No cambies modelos, UV, nombres, grupos, manifiesto ni ajustes.
Lee manifest.json y concept.png. Cada grupo tiene models/<id>.glb y tres guías guides/<id>_front.png, _right.png, _back.png. Las guías son renders de la geometría, NO son la entrega final. Usa las vistas originales y el concepto como referencias de materiales, colores y diseño. Genera exactamente TRES imágenes independientes POR GRUPO; una pieza y una vista por archivo, sin collages, hojas de vistas, texto, cuadrículas o marcadores.
Mantén exactamente la orientación, encuadre, silueta, proporciones y partes visibles de las guías. Front=frente; right=perfil derecho del personaje, no el del observador; back=posterior. No incluyas el cuerpo en las referencias del rostro/cabello ni otros grupos. No inventes superficie oculta ni cierres huecos. TODO el cabello pertenece al mismo grupo, incluidos mechones desconectados. El rostro incluye sus rasgos y accesorios pequeños que el análisis ya le asignó.
${textureReferenceAppearance} Fondo TRANSPARENTE real, RGBA PNG, mínimo 1024 por lado; bordes limpios sin halo. Usa la herramienta de generación de imágenes disponible; no sustituyas las referencias finales por renders automáticos o recortes improvisados.
CONTINUIDAD DE PATRONES: antes de generar, registra el número, ancho, separación, orden de colores y altura de rayas y bandas respecto a rodilla, tobillo, codo, muñeca y costuras. Repite ese mapa de diseño en CADA solicitud de imagen. Sigue cada franja alrededor de la prenda: frente, perfiles y espalda coinciden en sus límites compartidos, sin saltos, franjas duplicadas ni cambios de altura. Conserva logos, motivos y tirantes en su lado anatómico; no espejes asimetrías. Prolonga de forma coherente los patrones ocultos. Compara bordes laterales y alturas anatómicas entre todas las vistas antes de entregar; corrige solo las imágenes incoherentes.
Guarda references/<id>_front.png, references/<id>_right.png y references/<id>_back.png. Verifica visualmente cada PNG y su correspondencia con la guía del mismo grupo/vista antes de entregar. Corrige solo los archivos defectuosos, conservando los aprobados. No cambies el manifest.json original.
Ejecuta python EMPAQUETAR_REFERENCIAS.py para crear texture_references.zip con manifest.json, coverage.json y las 3 imágenes de cada grupo. Completa coverage.json para TODOS los segmentos: none si no añadiste ropa temporal, temporary solo para cobertura añadida (areas chest/pelvis y description). No confundas prendas originales con cobertura temporal. No dejes status unreviewed. Después ejecuta node ENTREGAR_REFERENCIAS.mjs texture_references.zip. El helper entrega a la aplicación local y guarda un recibo imported. Ante una interrupción, reutiliza el mismo ZIP; --check consulta su estado. No escribas en data ni busques credenciales. FITA verifica todas las imágenes antes de iniciar la cola y vuelve a comprobar los precios antes de cada gasto. Si cambió el proyecto/presupuesto, conserva las imágenes y solicita una autorización nueva.
`;
export async function createSegmentReferences({store,runner,ensure,idle,afterImport,deliveryOptions={}}){
 async function manifest(p){
  const s=currentSegmentation(p),plan=currentPlan(p);if(!plan||!s?.approval)fail('SEG_BUDGET_CONFIRMATION');
  return {...(plan.coveragePolicy?{coveragePolicy:plan.coveragePolicy}:{}),schema:'workbench-segment-references/v1',projectId:p.id,segmentationId:s.id,planId:plan.id,identity:plan.identity,views,groups:await Promise.all(s.groups.map(async g=>({id:g.id,name:g.name,part:g.part,settings:g.settings,modelSha256:hash(await store.read(p,g.asset)),files:views.map(v=>`references/${g.id}_${v}.png`)})))};
 }
 const delivery=await segmentationDelivery({store,kind:'segment-references',snapshot:manifest,...deliveryOptions,afterImport,
  async makePackage(p,m,descriptor){
   ensure(p);const s=currentSegmentation(p),dir=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-group-guides-'));
   try{
    const job={directory:dir,groups:[]},files={'manifest.json':Buffer.from(JSON.stringify(m,null,2)),'INSTRUCCIONES.txt':Buffer.from(referenceInstructions),'ENTREGA_LOCAL.json':Buffer.from(JSON.stringify(descriptor,null,2)),'ENTREGAR_REFERENCIAS.mjs':await fs.readFile(new URL('../scripts/deliver-segment-references.mjs',import.meta.url)),'EMPAQUETAR_REFERENCIAS.py':await fs.readFile(new URL('../scripts/package-segment-references.py',import.meta.url))};
    if(m.coveragePolicy)files['coverage.json']=Buffer.from(JSON.stringify({schema:COVERAGE_POLICY,groups:m.groups.map(g=>({groupId:g.id,status:'unreviewed',areas:[],description:''}))},null,2));
    if(p.reference)files['concept.png']=await store.read(p,p.reference);
    for(const part of parts)for(const [v,a] of Object.entries(p.groups[part].views))files[`originals/${part}_${v}.png`]=await store.read(p,a);
    for(const g of s.groups){const model=await store.read(p,g.asset),file=path.join(dir,g.id+'.glb');await fs.writeFile(file,model);files[`models/${g.id}.glb`]=model;files[`prompts/${g.id}.txt`]=Buffer.from(segmentReferencePrompt(g));job.groups.push({id:g.id,file});}
    const jobFile=path.join(dir,'job.json');await fs.writeFile(jobFile,JSON.stringify(job));await runner('guides',jobFile);
    for(const g of s.groups)for(const v of views)files[`guides/${g.id}_${v}.png`]=await fs.readFile(path.join(dir,`${g.id}_${v}.png`));
    return localInstructionPackage(store,p,'segment-references',files,descriptor.deliveryId);
   }finally{await fs.rm(dir,{recursive:true,force:true});}
  },
  async importPackage(p,buffer,beforeCommit=()=>{}){
   idle(p);const wanted=await manifest(p),files=await readSegmentationZip(buffer,{referencesOnly:true});
   if(!files['manifest.json']||JSON.stringify(JSON.parse(files['manifest.json']))!==JSON.stringify(wanted))fail('SEG_INPUTS_CHANGED');
   const coverage=wanted.coveragePolicy?validateCoverage(JSON.parse(files['coverage.json']||'null'),wanted.groups):null;
   const expected=[...wanted.groups.flatMap(g=>g.files),...(wanted.coveragePolicy?['coverage.json']:[])];if(Object.keys(files).length!==expected.length+1||expected.some(n=>!files[n]))fail('SEG_REFERENCES_REQUIRED');
   const plan=currentPlan(p);if(plan.referencesReceipt){if(plan.referencesReceipt.hash!==hash(buffer))fail('SEG_DELIVERY_USED');return plan.referencesReceipt;}
   const staged=[],refs={},fingerprints=new Set();let committed=false;
   try{
    for(const g of wanted.groups){refs[g.id]={};for(const v of views){const bytes=files[`references/${g.id}_${v}.png`],info=await sharp(bytes).metadata();if(info.format!=='png'||info.pages>1||info.width<256||info.height<256||info.width*info.height>40000000||!info.hasAlpha)fail('SEG_REFERENCE_INVALID');const stats=await sharp(bytes).stats();if(stats.channels[3]?.min===255||stats.channels[3]?.max===0)fail('SEG_REFERENCE_TRANSPARENCY');const pixelHash=hash(await sharp(bytes).ensureAlpha().raw().toBuffer());if(fingerprints.has(pixelHash))fail('SEG_REFERENCE_DUPLICATE');fingerprints.add(pixelHash);const a=await store.asset(p,bytes,'png','Segment texture reference');staged.push(a);refs[g.id][v]=a;}}
    await beforeCommit();if(JSON.stringify(await manifest(p))!==JSON.stringify(wanted)||currentPlan(p)!==plan)fail('SEG_INPUTS_CHANGED');
    const s=currentSegmentation(p),previous=s.groups.map(g=>({references:g.references,referencesReady:g.referencesReady,coverage:g.coverage}));
    for(const g of s.groups){g.references=refs[g.id];g.referencesReady=true;g.coverage=coverage?.groups.find(e=>e.groupId===g.id)||{groupId:g.id,status:'unknown',areas:[]};}
    const receipt={id:randomUUID(),hash:hash(buffer),at:new Date().toISOString()};plan.referencesReceipt=receipt;plan.status='references-ready';
    try{await store.save(p);}catch(e){s.groups.forEach((g,i)=>Object.assign(g,previous[i]));delete plan.referencesReceipt;plan.status='waiting-references';throw e;}
    committed=true;return receipt;
   }finally{if(!committed)for(const a of staged)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});}
  }
 });
 return delivery;
}

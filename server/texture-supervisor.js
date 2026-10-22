import {localInstructionPackage} from './local-instruction-package.js';
import express from 'express';
import fs from 'node:fs/promises';
import {refinementSkillFiles} from './refinement-skill-files.js';
import path from 'node:path';
import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {segmentIdentity,currentSegmentation} from './segmentation-identity.js';
import {currentPlan} from './segment-references.js';
import {budgetIdentity} from './segmentation-budget.js';
import {budgetPrice} from './segment-rate-card.js';
import {segFail as fail} from './segmentation-files.js';
import {zipBuffers} from './codex-handoff.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function supervisorState(p,id){
 const s=currentSegmentation(p),bound=s?.supervisionId===id,plan=bound?currentPlan(p):null;let stage='analysis',error=null,totals=null;
 if(bound&&s.approval){const budgets=['head','body'].map(part=>[...p.segmentBudgets||[]].reverse().find(b=>b.part===part&&b.identity===budgetIdentity(s,part)&&b.complete&&b.rows.length&&b.rows.every(r=>budgetPrice(r.smartUV)&&budgetPrice(r.texture))));if(budgets.every(Boolean))totals=Object.fromEntries(budgets.map(b=>[b.part,b.total]));}
 if(s?.supervisionId===id){
  stage=!s.approval?'awaiting-review':!plan?'awaiting-consent':plan.status==='waiting-references'?'references-required':plan.status==='ready-to-finish'?'finish-required':plan.status==='finishing'?'finishing':plan.status==='completed'?'completed':plan.status==='attention'?'attention':'texturing';
  if(!plan&&s.approval&&!totals)stage='quoting';
  error=plan?(plan.error||null):(p.segmentQuotation?.error||null);if(error)stage='attention';
 }
 const consent=bound&&plan?{accepted:true,planId:plan.id,segmentationId:s.id,acceptedAt:plan.createdAt,total:plan.total,maxCredits:plan.maxCredits,totals:plan.totals}:{accepted:false};
 const progress=plan?(p.segmentTextureRuns||[]).filter(r=>r.planId===plan.id).map(r=>({part:r.part,status:r.status,error:r.error||null,committedCredits:r.committedCredits,operations:r.operations.map(o=>({id:o.id,groupId:o.groupId,step:o.step,status:o.status,error:o.error||null,createdAt:o.createdAt}))})):[];
 const data={progress,projectId:p.id,stage,error,consent,segmentationId:bound?s.id:null,planId:plan?.id||null,totals:plan?.totals||totals,maxCredits:plan?.maxCredits??null};
 return {...data,cursor:hash(JSON.stringify(data))};
}
export async function createTextureSupervisor({store,segmentation,refinement,baseUrl='http://127.0.0.1:4317',now=Date.now,ttlMs=7*86400000}){
 const dir=path.join(store.root,'.texture-supervisors'),grants=new Map(),busy=new Set();await fs.mkdir(dir,{recursive:true});
 for(const n of await fs.readdir(dir))if(/^[a-f0-9-]{36}\.json$/.test(n))try{const g=JSON.parse(await fs.readFile(path.join(dir,n),'utf8'));if(g.id+'.json'===n&&/^[a-f0-9]{64}$/.test(g.hash))grants.set(g.id,g);}catch{}
 const router=express.Router();
 function check(g){const p=store.get(g.projectId);if(p.textureSupervisorId!==g.id||segmentIdentity(p)!==g.identity)fail('SEG_INPUTS_CHANGED');if(now()>=g.expiresAt)fail('SEG_DELIVERY_EXPIRED');return p;}
 router.use((q,r,next)=>{if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(q.headers.host||'')||q.headers.origin)return r.status(403).json({error:'SEG_LOCAL_ONLY'});r.set('Cache-Control','no-store');next();});
 router.use('/:id',async(q,r,next)=>{try{const g=grants.get(q.params.id),token=q.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!g||!token||!timingSafeEqual(Buffer.from(hash(token)),Buffer.from(g.hash)))fail('SEG_DELIVERY_UNAUTHORIZED',401);q.supervision={g,p:check(g)};next();}catch(e){next(e);}});
 router.get('/:id/events',async(q,r)=>{
  const {g,p}=q.supervision;p.textureSupervisorPresence={id:g.id,lastSeen:new Date(now()).toISOString()};
  const deadline=now()+Math.min(25000,Math.max(0,Number(q.query.waitMs)||0));let value=supervisorState(p,g.id);
  while(value.cursor===q.query.after&&now()<deadline&&!r.destroyed){await new Promise(done=>setTimeout(done,500));check(g);value=supervisorState(p,g.id);}
  if(!r.destroyed)r.json(value);
 });
 router.post('/:id/resume',express.json({limit:'2kb'}),async(q,r)=>{
  const {g,p}=q.supervision,state=supervisorState(p,g.id);
  if(state.stage!=='attention'||!state.consent.accepted||q.body.planId!==state.planId)fail('SUPERVISOR_STAGE_MISMATCH');
  const plan=currentPlan(p);plan.supervisorVerified={planId:plan.id,at:new Date(now()).toISOString()};await store.save(p);
  await segmentation.resumePlan(p);r.status(202).json(supervisorState(p,g.id));
 });
 router.post('/:id/package',express.json({limit:'2kb'}),async(q,r)=>{
  const {g,p}=q.supervision;if(busy.has(p.id))fail('SEG_BUSY');busy.add(p.id);
  try{
   const state=supervisorState(p,g.id);let workflow;
   if(q.body.kind==='references'&&state.stage==='references-required')workflow=segmentation.references;
   else if(q.body.kind==='finish'&&['finish-required','finishing'].includes(state.stage)){await segmentation.finishForAgent(p);check(g);workflow=refinement.delivery;}
   else fail('SUPERVISOR_STAGE_MISMATCH');
   const grant=await workflow.issue(p,{renew:q.body.renew===true});check(g);
   const bytes=await workflow.package(p,grant.id);check(g);
   if(q.body.kind==='references'){const plan=currentPlan(p);if(plan?.id!==state.planId)fail('SUPERVISOR_STAGE_MISMATCH');plan.supervisorVerified={planId:plan.id,at:new Date(now()).toISOString()};await store.save(p);}
   r.type('application/zip').send(bytes);
  }finally{busy.delete(p.id);}
 });
 router.use((e,q,r,n)=>r.status(e.status||409).json({error:e.message}));
 async function issue(p){
  const token=randomBytes(32).toString('hex'),g={id:randomUUID(),projectId:p.id,identity:segmentIdentity(p),hash:hash(token),expiresAt:now()+ttlMs};
  await fs.writeFile(path.join(dir,g.id+'.json'),JSON.stringify(g));grants.set(g.id,g);p.textureSupervisorId=g.id;await store.save(p);
  return {'SUPERVISION_LOCAL.json':Buffer.from(JSON.stringify({schema:'workbench-texture-supervisor/v1',projectId:p.id,id:g.id,token,endpoint:`${baseUrl}/api/texture-supervisors/${g.id}`,expiresAt:new Date(g.expiresAt).toISOString()},null,2)),
   'SUPERVISAR_TEXTURAS.mjs':await fs.readFile(new URL('../scripts/supervise-textures.mjs',import.meta.url)),
   'FLUJO_SUPERVISADO.txt':await fs.readFile(new URL('../docs/supervised-texturing.txt',import.meta.url)),
   ...await refinementSkillFiles()};
 }
 return {router,issue,summary:p=>p.textureSupervisorId?supervisorState(p,p.textureSupervisorId):null,
 async resumePackage(p){
  const s=currentSegmentation(p),plan=currentPlan(p);
  if(!s?.approval||!plan||!['completed','ready-to-finish','finishing'].includes(plan.status)||!plan.referencesReceipt||!s.reconstruction?.report?.geometryPreserved||!s.reconstruction.report.cornerUvTransfer||!s.reconstruction.report.savedAndReopened)fail('SEG_RESULTS_REQUIRED');
  const runs=['head','body'].map(part=>p.segmentTextureRuns?.find(r=>r.part===part&&r.planId===plan.id&&r.status==='completed'));
  if(runs.some(r=>!r)||JSON.stringify(runs.map(r=>r.id))!==JSON.stringify(s.reconstruction.runIds)||runs.some(r=>s.groups.filter(g=>g.part===r.part).some(g=>!r.operations.some(o=>o.groupId===g.id&&o.step==='download'&&o.status==='completed'&&o.downloadAsset))))fail('SEG_RESULTS_REQUIRED');
  if(p.textureRefinements?.some(r=>r.manifest?.sources?.some(source=>s.reconstruction.textureIds.includes(source.id))))fail('SUPERVISOR_STAGE_MISMATCH');
  const files=await issue(p);s.supervisionId=p.textureSupervisorId;plan.workflowVersion=2;plan.status='ready-to-finish';plan.error=null;
  await store.save(p);
  files['CONTINUAR.txt']=Buffer.from('CONTINUACIÓN SIN GASTO: el análisis, consentimiento, referencias, Smart UV, texturizado y descargas ya terminaron. NO repitas esas etapas ni elimines caras adicionales. Ejecuta node SUPERVISAR_TEXTURAS.mjs status y después finish. La transferencia ya verificada se reutiliza; sigue el acabado y entrega automática de FLUJO_SUPERVISADO.txt. Conserva cabeza/cuerpo, fuentes, segmentación y geometría histórica. No se autorizan nuevas operaciones de Tripo.');
  files['estado-previo.json']=Buffer.from(JSON.stringify({projectId:p.id,planId:plan.id,totals:plan.totals,runIds:plan.runIds,reconstruction:s.reconstruction.report},null,2));
  return localInstructionPackage(store,p,'resume-textures',files);
 }};
}

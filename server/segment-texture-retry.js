import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {segFail as fail} from './segmentation-files.js';
import {currentSegmentation} from './segmentation-identity.js';
import {currentPlan} from './segment-references.js';
import {validateCoverage,COVERAGE_POLICY} from './texture-coverage.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function correctRejectedGroup({p,store,provider,input,files,check=()=>{}}){
 const s=currentSegmentation(p),plan=currentPlan(p),run=p.segmentTextureRuns?.find(r=>r.id===input.runId),g=s?.groups.find(g=>g.id===input.groupId);
 if(!g||!plan||run?.planId!==plan.id||run.part!==g.part||plan.status!=='attention'||run.status!=='attention'||run.error!=='TEXTURE_IMAGE_REQUIRED'||input.confirmRejected!==true)fail('SEG_RETRY_NOT_SAFE');
 const texture=run.operations.find(o=>o.id===input.textureOperationId&&o.groupId===g.id&&o.step==='texture'),download=run.operations.find(o=>o.groupId===g.id&&o.step==='download');
 if(texture?.status!=='completed'||download?.status!=='completed'||download.downloadAsset||!run.operations.some(o=>o.groupId===g.id&&o.step==='smartUV'&&o.status==='completed'))fail('SEG_RETRY_NOT_SAFE');
 // A real downloaded GLB without embedded texture is mandatory evidence. Never
 // reset an uncertain in-flight click or silently replace a valid paid texture.
 let invalid=false;try{await provider.resultBytes(download.receipt);}catch(e){if(e.message==='TEXTURE_IMAGE_REQUIRED')invalid=true;else throw e;}if(!invalid)fail('SEG_RETRY_NOT_SAFE');
 const extra=texture.quote.credits;if(!Number.isFinite(extra)||input.acceptedExtraCredits!==extra||input.confirmRetry!==true)fail('SEG_BUDGET_CONFIRMATION');
 const coverage=validateCoverage({schema:COVERAGE_POLICY,groups:[input.coverage]},[g]).groups[0];
 const refs={},staged=[],seen=new Set(),oldRefs=g.references,oldCoverage=g.coverage,oldReady=g.referencesReady,oldRun=structuredClone(run),oldPlan=structuredClone(plan);
 try{
  for(const view of ['front','right','back']){const bytes=files?.[view]?.[0]?.buffer;if(!bytes)fail('SEG_REFERENCES_REQUIRED');const m=await sharp(bytes).metadata();if(m.format!=='png'||m.width<256||m.height<256||m.width*m.height>40000000||!m.hasAlpha)fail('SEG_REFERENCE_INVALID');const stats=await sharp(bytes).stats();if(stats.channels[3].min===255||stats.channels[3].max===0)fail('SEG_REFERENCE_TRANSPARENCY');const key=hash(await sharp(bytes).raw().toBuffer());if(seen.has(key))fail('SEG_REFERENCE_DUPLICATE');seen.add(key);refs[view]=await store.asset(p,bytes,'png','Corrected covered segment reference');staged.push(refs[view]);}
  await check();if(store.get(p.id)!==p||currentSegmentation(p)!==s||currentPlan(p)!==plan||JSON.stringify(run)!==JSON.stringify(oldRun)||g.references!==oldRefs)fail('SEG_INPUTS_CHANGED');
  (run.retryHistory||=[]).push({at:new Date().toISOString(),groupId:g.id,reason:'User confirmed rejection; downloaded GLB has no texture',operations:run.operations.filter(o=>o.groupId===g.id&&['texture','download'].includes(o.step)),references:oldRefs,coverage:oldCoverage,acceptedExtraCredits:extra});
  run.operations=run.operations.filter(o=>o.groupId!==g.id||!['texture','download'].includes(o.step));run.maxCredits+=extra;run.error=null;
  plan.total+=extra;plan.maxCredits+=extra;plan.totals[g.part]+=extra;plan.budgets.find(b=>b.part===g.part).total+=extra;plan.error=null;
  g.references=refs;g.referencesReady=true;g.coverage=coverage;
  try{await store.save(p);}catch(e){for(const k of Object.keys(run))delete run[k];Object.assign(run,oldRun);for(const k of Object.keys(plan))delete plan[k];Object.assign(plan,oldPlan);g.references=oldRefs;g.coverage=oldCoverage;g.referencesReady=oldReady;throw e;}
  staged.length=0;return {groupId:g.id,references:refs,extraCredits:extra,maxPlanCredits:plan.maxCredits};
 }finally{for(const a of staged)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});}
}

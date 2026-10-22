import {randomUUID,createHash} from 'node:crypto';
import {segFail as fail} from './segmentation-files.js';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const validSettings=s=>s&&['2K','4K','8K'].includes(s.resolution)&&typeof s.removeLighting==='boolean';
export const budgetIdentity=(seg,part)=>digest({id:seg.id,approval:seg.approval?.id,part,groups:seg.groups.filter(g=>g.part===part).map(g=>({id:g.id,settings:g.settings}))});
export function verifiedPrice(q){return q?.source==='studio'&&q.verified===true&&Number.isFinite(q.credits)&&q.credits>=0&&typeof q.conditions==='string'&&q.conditions.length>0&&Number.isFinite(q.expiresAt)&&q.expiresAt>Date.now();}
export async function prepareBudget(seg,part,provider,{previous=[],onProgress=async()=>{}}={}){
 if(!seg.approval)fail('SEG_APPROVAL_REQUIRED');const groups=seg.groups.filter(g=>g.part===part),rows=[];
 for(const g of groups){const row={groupId:g.id,name:g.name,settings:g.settings};for(const step of ['smartUV','texture']){
  await onProgress({part,groupId:g.id,groupName:g.name,index:rows.length+1,count:groups.length,step});
  const prior=[...previous].reverse().filter(b=>b.identity===budgetIdentity(seg,part)).map(b=>b.rows.find(r=>r.groupId===g.id)?.[step]).find(verifiedPrice);
  const q=prior||await provider.quote({group:g,step,part});row[step]=verifiedPrice(q)?q:{source:'studio',verified:false,credits:null,reason:q?.reason||'SEG_PRICE_PENDING'};
 }rows.push(row);}
 const complete=rows.every(r=>verifiedPrice(r.smartUV)&&verifiedPrice(r.texture));
 return {id:randomUUID(),identity:budgetIdentity(seg,part),segmentationId:seg.id,part,rows,verifiedTotal:rows.reduce((sum,r)=>sum+(verifiedPrice(r.smartUV)?r.smartUV.credits:0)+(verifiedPrice(r.texture)?r.texture.credits:0),0),complete,total:complete?rows.reduce((sum,r)=>sum+r.smartUV.credits+r.texture.credits,0):null,createdAt:new Date().toISOString()};
}
export function acceptBudget(seg,budget,input){
 if(!budget||budget.identity!==budgetIdentity(seg,budget.part))fail('SEG_BUDGET_STALE');
 const max=input.maxCredits;
 if(input.confirm!==true||input.confirmSeparateAssets!==true||typeof max!=='number'||!Number.isFinite(max)||max<=0||max>100000||max<budget.verifiedTotal||(!budget.complete&&input.acceptProvisional!==true))fail('SEG_BUDGET_CONFIRMATION');
 return {id:randomUUID(),segmentationId:seg.id,part:budget.part,identity:budget.identity,budget:structuredClone(budget),maxCredits:max,committedCredits:0,status:'pending',operations:[],createdAt:new Date().toISOString()};
}
export async function advanceChain({run,seg,provider,save,isCurrent}){
 if(!['pending','running','attention'].includes(run.status))return;
 const check=()=>{if(!isCurrent()||run.identity!==budgetIdentity(seg,run.part))fail('SEG_INPUTS_CHANGED');};
 check();if(!provider.capabilities().supported)fail('SEG_STUDIO_VALIDATION_REQUIRED');
 run.status='running';run.error=null;await save();
 try{
  for(const group of seg.groups.filter(g=>g.part===run.part)){
   if(!group.referencesReady)fail('SEG_REFERENCES_REQUIRED');
   for(const step of ['import','smartUV','texture','download']){
    check();let op=run.operations.find(o=>o.groupId===group.id&&o.step===step);
    if(op?.status==='completed'&&!(step==='smartUV'&&provider.capabilities().requiresUvSave&&op.receipt?.uvSaved!==true))continue;
    if(op?.status==='failed')fail('SEG_OPERATION_FAILED');
    const prior=run.operations.filter(o=>o.groupId===group.id&&o.status==='completed').at(-1);
    // Unknown/running operations recover by the durable key; NEVER submit again.
    if(op){
      const receipt=await provider.recover({operation:op,group,previous:prior?.receipt});check();
      if(step==='smartUV'&&provider.capabilities().requiresUvSave&&receipt?.status==='completed'&&receipt.uvSaved!==true)fail('SEG_UV_SAVE_NOT_VERIFIED');
      if(!receipt||receipt.status!=='completed'){op.status=receipt?.status==='running'?'running':'unknown';run.status='attention';await save();return;}
      op.status='completed';op.error=null;op.receipt=receipt;op.actualCredits=Number.isFinite(receipt.credits)?receipt.credits:null;
      if(op.actualCredits!==null&&op.actualCredits>op.quote.credits){run.status='attention';run.error='SEG_PRICE_CHANGED';run.committedCredits+=op.actualCredits-op.quote.credits;await save();return;}
      await save();continue;
    }
    const paid=['smartUV','texture'].includes(step);let quote={source:'studio',verified:true,credits:0,conditions:'local-transfer',expiresAt:Date.now()+60000};
    if(paid){
      quote=await provider.quote({group,step,part:run.part,previous:prior?.receipt,fresh:true});check();
      if(!verifiedPrice(quote))fail('SEG_PRICE_PENDING');
      if(quote.taskId&&prior?.receipt?.taskId&&quote.taskId!==prior.receipt.taskId)fail('CONFIRMED_TASK_CHANGED');
      const accepted=run.budget.rows.find(r=>r.groupId===group.id)?.[step];
      if(accepted?.source==='rate-card'&&quote.credits>accepted.credits)fail('SEG_PRICE_CHANGED');
      if(accepted?.verified&&(accepted.credits!==quote.credits||accepted.conditions!==quote.conditions))fail('SEG_PRICE_CHANGED');
      if(run.committedCredits+quote.credits>run.maxCredits)fail('SEG_BUDGET_EXCEEDED');
    }
    op={id:randomUUID(),groupId:group.id,step,status:'prepared',targetTaskId:prior?.receipt?.taskId||quote.taskId||group.studioImport?.taskId||null,quote,createdAt:new Date().toISOString()};
    run.operations.push(op);run.committedCredits+=quote.credits;
    // Reserve the maximum quoted cost and persist BEFORE handing off a click.
    await save();check();op.status='running';await save();
    let receipt;
    try{receipt=await provider.execute({operation:op,group,previous:prior?.receipt,expectedQuote:quote});}
    catch(e){op.status='unknown';op.error=e.message;run.error=e.message;run.status='attention';await save();return;}
    check();op.receipt=receipt;
    if(step==='smartUV'&&provider.capabilities().requiresUvSave&&receipt?.status==='completed'&&receipt.uvSaved!==true)fail('SEG_UV_SAVE_NOT_VERIFIED');
    if(receipt?.status!=='completed'){op.status=receipt?.status==='running'?'running':'unknown';run.status='attention';await save();return;}
    op.status='completed';op.actualCredits=Number.isFinite(receipt.credits)?receipt.credits:null;
    if(op.actualCredits!==null&&op.actualCredits>quote.credits){run.status='attention';run.error='SEG_PRICE_CHANGED';run.committedCredits+=op.actualCredits-quote.credits;await save();return;}
    await save();
   }
  }
  run.status='completed';run.completedAt=new Date().toISOString();await save();
 }catch(e){run.status='attention';run.error=e.message;await save();}
}

export {studioGroupProvider} from './studio-group-provider.js';

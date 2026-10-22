import {randomUUID} from 'node:crypto';
import {budgetIdentity,validSettings,verifiedPrice} from './segmentation-budget.js';
import {segFail as fail} from './segmentation-files.js';

// Local, versioned tariff: observed Studio receipts, not a live Studio quote.
// Add another preset only after its price has been checked. Never import to price it.
export const SEGMENT_RATE_CARD=Object.freeze({id:'studio-observed-2026-10-13-v1',smartUV:20,texture:Object.freeze({'4K:false':20})});
export function localPrice(q){return q?.source==='rate-card'&&q.rateCardId===SEGMENT_RATE_CARD.id&&Number.isFinite(q.credits)&&q.credits>=0;}
export const budgetPrice=q=>localPrice(q)||verifiedPrice(q);
export function prepareLocalBudget(seg,part){
 if(!seg?.approval)fail('SEG_APPROVAL_REQUIRED');
 const groups=seg.groups.filter(g=>g.part===part);if(!groups.length)fail('SEG_APPROVAL_REQUIRED');
 const rows=groups.map(g=>{
  if(!validSettings(g.settings))fail('SEG_SETTINGS_INVALID');
  const texture=SEGMENT_RATE_CARD.texture[`${g.settings.resolution}:${g.settings.removeLighting}`];
  if(!Number.isFinite(texture))fail('SEG_LOCAL_RATE_REQUIRED');
  const quote=(step,credits)=>({source:'rate-card',rateCardId:SEGMENT_RATE_CARD.id,credits,conditions:JSON.stringify({step,settings:g.settings})});
  return {groupId:g.id,name:g.name,settings:structuredClone(g.settings),smartUV:quote('smartUV',SEGMENT_RATE_CARD.smartUV),texture:quote('texture',texture)};
 });
 const total=rows.reduce((n,r)=>n+r.smartUV.credits+r.texture.credits,0);
 return {id:randomUUID(),identity:budgetIdentity(seg,part),segmentationId:seg.id,part,source:'rate-card',rateCardId:SEGMENT_RATE_CARD.id,rows,complete:true,total,verifiedTotal:total,createdAt:new Date().toISOString()};
}

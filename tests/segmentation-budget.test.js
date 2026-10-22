import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBudget,acceptBudget,advanceChain,budgetIdentity,studioGroupProvider} from '../server/segmentation-budget.js';
import {segmentationCopy} from '../src/segmentation-locales.js';
const settings={resolution:'4K',removeLighting:false};
const fixture=()=>({id:'seg1',approval:{id:'approval1'},groups:[{id:'hair',part:'head',name:'Hair',settings:{...settings},referencesReady:true},{id:'face',part:'head',name:'Face',settings:{...settings},referencesReady:true},{id:'clothes',part:'body',name:'Clothes',settings:{...settings},referencesReady:true}]});
function provider(){const calls=[],p={calls,capabilities:()=>({supported:true}),quote:async({step})=>({source:'studio',verified:true,credits:step==='texture'?20:5,conditions:'fixture-only-4K',expiresAt:Date.now()+60000}),execute:async({operation})=>{calls.push(structuredClone(operation));return{status:'completed',credits:operation.quote.credits,taskId:operation.id};},recover:async({operation})=>({status:'completed',taskId:operation.id,credits:operation.quote.credits})};return p;}
const consent={maxCredits:50,confirm:true,confirmSeparateAssets:true};

test('download recovery sends its exact stage and completed texture identity to the extension',async()=>{
 let sent;const operation={id:'download-id',step:'download',targetTaskId:'task-id'};
 const bridge={status:()=>({}),enqueue:(_type,payload)=>{sent=payload;return {id:'bridge-id'};},getOperation:()=>({status:'succeeded',result:{receipt:{status:'completed',step:'download'}}})};
 const provider=studioGroupProvider(bridge,{store:{read:async()=>Buffer.from('model')}}).forProject({id:'project'});
 await provider.recover({operation,group:{id:'hair',asset:{id:'hair.glb'},settings},previous:{operationId:'paid-texture-id'}});
 assert.equal(sent.action,'download');assert.equal(sent.recoveryStep,'download');assert.equal(sent.textureOperationId,'paid-texture-id');assert.equal(sent.operationId,'download-id');assert.equal(sent.taskId,'task-id');
});

test('Studio group price cache survives provider restart and is bound to the exact model and settings',async()=>{
 let calls=0;const settings={resolution:'4K',removeLighting:false},taskId='11111111-2222-3333-4444-555555555555';
 const bridge={status:()=>({preparationAvailable:true,controlAvailable:true,adapter:{segmentWorkflowVersion:1,importOrientationVersion:2,uvSaveVersion:1,uvSelectionVersion:1}}),enqueue:()=>{calls++;return{id:'op'};},getOperation:()=>({status:'succeeded',result:{taskId,settings,prices:{smartUV:'20',texture:'30'}}})};
 const store={read:async()=>Buffer.from('same immutable model'),save:async()=>{}},project={id:'project'},group={id:'torso',asset:{id:'mesh.glb'},settings};
 const first=studioGroupProvider(bridge,{store}).forProject(project);assert.equal((await first.quote({group,step:'smartUV'})).credits,20);assert.equal(calls,1);
 const restarted=studioGroupProvider(bridge,{store}).forProject(project);assert.equal((await restarted.quote({group:structuredClone(group),step:'texture'})).credits,30);assert.equal(calls,1);
 group.asset.id='replacement.glb';await restarted.quote({group,step:'smartUV'});assert.equal(calls,2);
 group.studioPrices.expiresAt=0;await studioGroupProvider(bridge,{store}).forProject(project).quote({group,step:'texture'});assert.equal(calls,3);
});

test('unchanged verified quotes are reused instantly, but expired prices and changed settings are read again',async()=>{
 const seg=fixture(),p=provider(),b=await prepareBudget(seg,'head',p);let calls=0;const original=p.quote;p.quote=async args=>{calls++;return original(args);};
 const progress=[];const reused=await prepareBudget(seg,'head',p,{previous:[b],onProgress:async value=>progress.push(value)});
 assert.equal(calls,0);assert.equal(reused.total,50);assert.equal(progress.length,4);
 b.rows[0].texture.expiresAt=0;await prepareBudget(seg,'head',p,{previous:[b]});assert.equal(calls,1);
 seg.groups[0].settings.resolution='8K';await prepareBudget(seg,'head',p,{previous:[b]});assert.equal(calls,5);
});
test('an older connected extension must reload before any group import or quote',async()=>{
 let calls=0;
 const p=studioGroupProvider({status:()=>({preparationAvailable:true,controlAvailable:true,adapter:{segmentWorkflowVersion:1}}),enqueue:()=>{calls++;throw Error('must not dispatch');}});
 assert.equal(p.capabilities().supported,false);assert.equal(p.capabilities().reason,'SEG_EXTENSION_RELOAD_REQUIRED');
 const quote=await p.forProject({id:'project'}).quote({group:{},step:'smartUV'});
 assert.equal(quote.verified,false);assert.equal(calls,0);
});

test('analysis budget totals per group, rejects stale settings/approval and uses real verified quotes only',async()=>{
 const seg=fixture(),p=provider(),b=await prepareBudget(seg,'head',p);assert.equal(b.total,50);assert.equal(b.rows.length,2);
 assert.throws(()=>acceptBudget(seg,b,{...consent,maxCredits:49}),/SEG_BUDGET_CONFIRMATION/);
 assert.throws(()=>acceptBudget(seg,b,{...consent,confirmSeparateAssets:false}),/SEG_BUDGET_CONFIRMATION/);
 seg.groups[0].settings.resolution='8K';assert.throws(()=>acceptBudget(seg,b,consent),/SEG_BUDGET_STALE/);
 seg.groups[0].settings.resolution='4K';seg.approval.id='new';assert.notEqual(b.identity,budgetIdentity(seg,'head'));
 const unknown=await prepareBudget(seg,'head',studioGroupProvider({status:()=>({controlAvailable:true})}));assert.equal(unknown.total,null);assert.equal(unknown.complete,false);assert.equal(unknown.verifiedTotal,0);assert(unknown.rows.every(r=>r.smartUV.credits===null&&r.texture.credits===null));
 assert.throws(()=>acceptBudget(seg,unknown,consent),/SEG_BUDGET_CONFIRMATION/);assert(acceptBudget(seg,unknown,{...consent,acceptProvisional:true}));
});
test('group chain persists every paid reservation before executing, then skips completed operations',async()=>{
 const seg=fixture(),p=provider(),run=acceptBudget(seg,await prepareBudget(seg,'head',p),consent);let saved;
 const execute=p.execute;p.execute=async args=>{assert(saved.operations.some(o=>o.id===args.operation.id&&o.status==='running'));assert(saved.committedCredits>=args.expectedQuote.credits);return execute(args);};
 const args={seg,run,provider:p,save:async()=>{saved=structuredClone(run);},isCurrent:()=>true};await advanceChain(args);assert.equal(run.status,'completed');assert.equal(run.committedCredits,50);assert.equal(p.calls.length,8);await advanceChain(args);assert.equal(p.calls.length,8);
});
test('provisional price remains gated, max budget and changed conditions stop before any paid click',async()=>{
 for(const reason of ['unknown','maximum','conditions']){
  const seg=fixture(),p=provider(),b=await prepareBudget(seg,'head',p);
  if(reason==='maximum')for(const row of b.rows){row.smartUV={verified:false};row.texture={verified:false};}b.complete=reason!=='maximum';b.verifiedTotal=reason==='maximum'?0:50;
  const run=acceptBudget(seg,b,{...consent,maxCredits:reason==='maximum'?4:50,acceptProvisional:true});
  if(reason==='unknown')p.quote=async()=>({verified:false,credits:null});
  if(reason==='conditions')p.quote=async()=>({source:'studio',verified:true,credits:5,conditions:'changed',expiresAt:Date.now()+60000});
  await advanceChain({seg,run,provider:p,save:async()=>{},isCurrent:()=>true});assert.equal(run.status,'attention');assert.equal(p.calls.filter(o=>o.quote.credits>0).length,0);assert.match(run.error,/SEG_PRICE_PENDING|SEG_BUDGET_EXCEEDED|SEG_PRICE_CHANGED/);
 }
});
test('lost paid reply recovers durable operation after restart and never pays twice',async()=>{
 const seg=fixture(),p=provider(),run=acceptBudget(seg,await prepareBudget(seg,'head',p),consent),execute=p.execute;let lost=true;
 p.execute=async args=>{const result=await execute(args);if(args.operation.step==='smartUV'&&lost){lost=false;throw Error('lost reply');}return result;};
 await advanceChain({seg,run,provider:p,save:async()=>{},isCurrent:()=>true});assert.equal(run.status,'attention');assert.equal(run.operations.at(-1).status,'unknown');
 const restarted=JSON.parse(JSON.stringify(run));await advanceChain({seg,run:restarted,provider:p,save:async()=>{},isCurrent:()=>true});assert.equal(restarted.status,'completed');assert.equal(p.calls.filter(o=>o.groupId==='hair'&&o.step==='smartUV').length,1);assert.equal(restarted.committedCredits,50);
});

test('Recover and continue repairs only the failed download and clears its resolved error',async()=>{
 const seg=fixture(),p=provider(),run=acceptBudget(seg,await prepareBudget(seg,'head',p),consent),execute=p.execute;let lost=true;
 p.execute=async args=>{if(args.operation.step==='download'&&lost){lost=false;throw Error('EXPORT_DIALOG_NOT_VERIFIED');}return {...await execute(args),step:args.operation.step,operationId:args.operation.id};};
 await advanceChain({seg,run,provider:p,save:async()=>{},isCurrent:()=>true});
 const failed=run.operations.at(-1),id=failed.id,paidCalls=p.calls.filter(o=>['smartUV','texture'].includes(o.step)&&o.groupId==='hair').length;
 assert.equal(failed.step,'download');assert.equal(run.status,'attention');let recovered=0;
 const priorTexture=run.operations.find(o=>o.groupId==='hair'&&o.step==='texture');
 p.recover=async({operation,previous})=>{assert.equal(operation.id,id);assert.equal(previous.step,'texture');assert.equal(previous.operationId,priorTexture.id);recovered++;return {status:'completed',step:'download',credits:0};};
 await advanceChain({seg,run,provider:p,save:async()=>{},isCurrent:()=>true});
 assert.equal(run.status,'completed');assert.equal(recovered,1);assert.equal(failed.id,id);assert.equal(failed.error,null);
 assert.equal(p.calls.filter(o=>['smartUV','texture'].includes(o.step)&&o.groupId==='hair').length,paidCalls);
 assert.equal(run.committedCredits,50);
});
test('missing references and source changes stop spending; unsupported adapter stays disabled',async()=>{
 const seg=fixture(),p=provider(),run=acceptBudget(seg,await prepareBudget(seg,'head',p),consent);seg.groups[0].referencesReady=false;
 await advanceChain({seg,run,provider:p,save:async()=>{},isCurrent:()=>true});assert.equal(run.error,'SEG_REFERENCES_REQUIRED');assert.equal(p.calls.length,0);
 seg.groups[0].referencesReady=true;await assert.rejects(()=>advanceChain({seg,run,provider:p,save:async()=>{},isCurrent:()=>false}),/SEG_INPUTS_CHANGED/);
 assert.equal(studioGroupProvider({status:()=>({controlAvailable:true})}).capabilities().supported,false);
});
test('all analysis copy includes matching English, Spanish and Japanese placeholders',()=>{
 for(const [key,row] of Object.entries(segmentationCopy)){assert.equal(row.length,3,key);for(const text of row){assert(text.trim(),key);assert.deepEqual([...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...row[0].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),key);}}
});

test('the chain blocks texturing when a provider calls an unsaved UV preview completed',async()=>{
 const seg=fixture(),p=provider(),run=acceptBudget(seg,await prepareBudget(seg,'head',p),consent);
 p.capabilities=()=>({supported:true,requiresUvSave:true});
 await advanceChain({seg,run,provider:p,save:async()=>{},isCurrent:()=>true});
 assert.equal(run.error,'SEG_UV_SAVE_NOT_VERIFIED');assert.equal(p.calls.filter(o=>o.step==='texture').length,0);
});

test('a legacy completed UV step is recovered before continuing rather than charged again',async()=>{
 const seg=fixture(),p=provider(),run=acceptBudget(seg,await prepareBudget(seg,'head',p),consent);
 await advanceChain({seg,run,provider:p,save:async()=>{},isCurrent:()=>true});
 run.status='attention';p.capabilities=()=>({supported:true,requiresUvSave:true});let recovered=0;
 p.recover=async({operation})=>{recovered++;return {...operation.receipt,uvSaved:true};};
 const calls=p.calls.length,credits=run.committedCredits;
 await advanceChain({seg,run,provider:p,save:async()=>{},isCurrent:()=>true});
 assert.equal(recovered,2);assert.equal(p.calls.length,calls);assert.equal(run.committedCredits,credits);assert.equal(run.status,'completed');
});

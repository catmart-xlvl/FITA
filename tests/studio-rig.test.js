import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRigCommands} from '../extension-tripo-studio/rig-commands.js';
import {studioRigControl,stageRigUpload} from '../extension-tripo-studio/rig-adapter.js';
import {observeStudioDocument} from '../extension-tripo-studio/studio-adapter.js';
import {throwAdapterError,asWorker} from './page-call.js';
const taskId='11111111-2222-3333-4444-555555555555',id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
function preparationHarness({neverReady=false}={}){
  const groupKey='a'.repeat(64),sha256='b'.repeat(64),stored={['workbenchGroup:'+groupKey]:{state:'imported',taskId,sha256}};
  let elapsed=0,workflow='generate',navigationAt=null,rigAt=null,paid=0;
  const chrome={storage:{local:{get:async key=>({[key]:stored[key]}),set:async data=>Object.assign(stored,data)}},tabs:{update:async()=>{navigationAt=elapsed;workflow='rigging';rigAt=elapsed;}}};
  const execute=createRigCommands({chrome,pause:async ms=>{elapsed+=ms;},runInTab:async(b,fn,args=[])=>{
    if(fn.name==='controlImportOrientation')return {present:false};
    if(fn.name==='studioNavigationControl')return {navigation:'unavailable'};
    if(fn.name==='observeGroupStudio')return {taskId,workflow,importBusy:neverReady||elapsed<20000,modelReady:!neverReady&&elapsed>=22000,links:[{taskId,workflow:'rigging',url:'https://studio.tripo3d.ai/workspace/rigging/'+taskId}]};
    assert.equal(fn,studioRigControl,'the existing upload must not be dispatched again');
    if(args[0]?.action==='submit')paid++;
    if(elapsed-rigAt<12000)throw Error('RIG_WORKSPACE_REQUIRED');
    return {preset:'Unity Humanoid compatible',costLabel:'20',enabled:true};
  }});
  return {run:()=>execute({tabId:1},{payload:{action:'prepare',operationId:id,groupKey,model:{sha256}}}),state:()=>({elapsed,navigationAt,paid})};
}
test('rig preparation waits for upload readiness before navigation and delayed preset mounting',async()=>{
  const h=preparationHarness();assert.equal((await h.run()).stage,'prepared');
  assert(h.state().navigationAt>=24000);assert(h.state().elapsed>=36000);assert.equal(h.state().paid,0);
});
test('an unfinished rig upload times out recoverably without navigating or spending',async()=>{
  const h=preparationHarness({neverReady:true});await assert.rejects(h.run(),/RIG_UPLOAD_STILL_PROCESSING/);
  assert.equal(h.state().navigationAt,null);assert.equal(h.state().paid,0);assert.equal(h.state().elapsed,120000);
});

test('preparation returns to its uploaded model through observed history before opening rigging',async()=>{
  const groupKey='a'.repeat(64),sha256='b'.repeat(64),stored={['workbenchGroup:'+groupKey]:{state:'imported',taskId,sha256}},visited=[];
  let current='99999999-2222-3333-4444-555555555555',workflow='smart-uv';
  const card='https://studio.tripo3d.ai/es/workspace/smart-uv/observed-slug-'+taskId,rig='https://studio.tripo3d.ai/es/workspace/rigging/observed-slug-'+taskId;
  const chrome={storage:{local:{get:async k=>({[k]:stored[k]}),set:async data=>Object.assign(stored,structuredClone(data))}},tabs:{update:async(tab,{url})=>{visited.push(url);current=taskId;workflow=url===card?'smart-uv':'rigging';}}};
  const execute=createRigCommands({chrome,pause:async()=>{},runInTab:async(b,fn)=>{
    if(fn.name==='controlImportOrientation')return {present:false};
    if(fn.name==='observeGroupStudio')return {taskId:current,workflow,importBusy:false,modelReady:true,links:[{taskId,workflow:'smart-uv',url:card},...(current===taskId?[{taskId,workflow:'rigging',url:rig}]:[])]};
    assert.equal(fn,studioRigControl);return {preset:'Unity Humanoid',costLabel:'20',enabled:true};
  }});
  assert.equal((await execute({tabId:1},{payload:{action:'prepare',operationId:id,groupKey,model:{sha256}}})).taskId,taskId);
  assert.deepEqual(visited,[card,rig]);
});

test('recovery never substitutes another model when the saved model has no observed link',async()=>{
  const groupKey='a'.repeat(64),sha256='b'.repeat(64);
  const execute=createRigCommands({chrome:{storage:{local:{get:async k=>({[k]:{taskId,sha256}}),set:async()=>{}}},tabs:{update:async()=>assert.fail('must not guess a URL')}},pause:async()=>{},runInTab:async(b,fn)=>{
    if(fn.name==='controlImportOrientation')return {present:false};
    if(fn.name==='studioNavigationControl')return {navigation:'unavailable'};
    assert.equal(fn.name,'observeGroupStudio');return {taskId:null,workflow:'generate',links:[]};
  }});
  await assert.rejects(execute({tabId:1},{payload:{action:'prepare',operationId:id,groupKey,model:{sha256}}}),/CONFIRMED_TASK_LINK_NOT_OBSERVED/);
});
function harness(){
  const stored={},calls=[];let price='20',busy=false,loseClick=false;
  const chrome={storage:{local:{get:async key=>({[key]:stored[key]}),set:async data=>Object.assign(stored,structuredClone(data))}},tabs:{update:async()=>{throw Error('No navigation expected');}}};
  const execute=createRigCommands({chrome,pause:async()=>{},exportGlb:async(b,t,opts)=>{calls.push({export:opts});return {stage:'exported',taskId:t};},runInTab:async(b,fn,args=[])=>{
    if(fn.name==='observeGroupStudio')return {taskId,workflow:'rigging',links:[]};
    assert.equal(fn,studioRigControl);
    if(args[0]?.action==='submit'){calls.push({clicked:true});busy=true;if(loseClick)throw Error('reply lost');return {clicked:true};}
    return {taskId,preset:'Unity Humanoid compatible',costLabel:price,enabled:!busy,busy,hasExport:true};
  }});
  const command=action=>execute({tabId:1},{id:'transport',payload:{action,taskId,operationId:id,expectedCost:'20',confirmCost:true}});
  return {calls,stored,command,setPrice:v=>price=v,complete:()=>busy=false,lose:()=>loseClick=true};
}
test('rig submission refuses a changed cost and never replays an uncertain paid click',async()=>{
  const h=harness();h.setPrice('25');await assert.rejects(h.command('submit'),/SETTINGS_OR_COST_CHANGED/);assert.equal(h.calls.length,0);
  h.setPrice('20');h.lose();await assert.rejects(h.command('submit'),/reply lost/);assert.equal(h.calls.length,1);assert.equal((await h.command('submit')).stage,'unknown');assert.equal(h.calls.length,1);
});
test('rig download requires a processing-to-ready transition and explicitly requests skeleton export',async()=>{
  const h=harness();await assert.rejects(h.command('download'),/SUBMISSION_UNCERTAIN/);await h.command('submit');await assert.rejects(h.command('download'),/NOT_COMPLETED/);h.complete();assert.equal((await h.command('monitor')).stage,'ready');assert.equal((await h.command('download')).stage,'exported');assert.equal(h.calls.at(-1).export.requireSkeleton,true);assert.equal(h.calls.at(-1).export.directExportTransfer,true);assert.equal(h.calls.filter(c=>c.clicked).length,1);
});
test('large rig uploads are bounded, ordered and bound to the exact source hash',()=>{
  const ctx=vm.createContext({location:{origin:'https://studio.tripo3d.ai'}}),run=input=>throwAdapterError(vm.runInContext(`(${stageRigUpload})(${JSON.stringify(input)})`,ctx));
  assert.equal(run({id:'a'.repeat(64),index:0,total:2,data:'abcd'}).staged,1);
  assert.throws(()=>run({id:'b'.repeat(64),index:1,total:2,data:'abcd'}),/ORDER/);
  assert.equal(run({id:'a'.repeat(64),index:1,total:2,data:'efgh'}).staged,2);
  assert.throws(()=>run({id:'a'.repeat(64),index:2,total:2,data:'efgh'}),/INVALID/);
});
test('English and Spanish rigging pages identify their task independently of generation controls',async()=>{
  for(const prefix of ['','/es']){
    const pathname=prefix+'/workspace/rigging/miku-'+taskId,origin='https://studio.tripo3d.ai',context={location:{origin,pathname,href:origin+pathname},document:{querySelectorAll:()=>[]},crypto:globalThis.crypto,TextEncoder,URL};
    const result=await vm.runInNewContext(`(${observeStudioDocument})()`,context);
    assert.equal(result.currentTaskId,taskId);assert.equal(result.workflow,'rigging');assert.equal(result.supported,true);assert.equal(result.generateEnabled,false);assert.equal(result.rigWorkflowVersion,1);
  }
});

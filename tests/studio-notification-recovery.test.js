import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {studioNavigationControl} from '../extension-tripo-studio/studio-navigation.js';
import {readStudioGenerationFailures} from '../extension-tripo-studio/studio-adapter.js';
import {exportRecoveryDiagnostic} from '../extension-tripo-studio/export-recovery-diagnostic.js';

test('both failure inspection and shared navigation close a native labelled notification panel with stale trigger state',()=>{
 for(const fn of [studioNavigationControl,readStudioGenerationFailures])for(const relation of ['aria-controls','aria-labelledby']){
  let clicks=0,escapes=0,open=true;
  const node=attrs=>({getAttribute:k=>attrs[k]??null,getBoundingClientRect:()=>({width:100,height:30}),contains:()=>false,querySelectorAll:()=>[],click:()=>{clicks++;open=false;}});
  const trigger=node({id:'native-bell','data-trace':'studio.notification_center','data-state':'closed',[relation==='aria-controls'?'aria-controls':'unused']:'native-messages'});
  const panel=node({id:'native-messages','aria-labelledby':relation==='aria-labelledby'?'native-bell':null,'data-state':'open'});
  panel.focus=()=>{};panel.dispatchEvent=event=>{assert.equal(event.key,'Escape');escapes++;open=false;};
  const document={querySelectorAll:s=>s==='[role="dialog"]'?(open?[panel]:[]):s==='[data-trace],button,[role="button"]'?[trigger]:[]};
  class KeyEvent{constructor(type,options){Object.assign(this,options);}}
  const context={KeyboardEvent:KeyEvent,location:{origin:'https://studio.tripo3d.ai'},document,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'0'})};
  const input=fn===studioNavigationControl?{action:'close-notifications'}:{taskIds:[1,2,3,4].map(n=>`10000000-0000-4000-8000-00000000000${n}`),action:'close'};
  const run=()=>vm.runInNewContext(`(${fn})(${JSON.stringify(input)})`,context);
  assert.equal(run().navigation,'closing');assert.equal(clicks,0);assert.equal(escapes,1);
  assert.equal(run().navigation,'not-open');assert.equal(clicks,0,'a second close must never reopen the panel');
  open=true;panel.getAttribute=k=>k==='data-state'?'open':null;
  assert.equal(run().navigation,'not-open');assert.equal(clicks,0,'an unrelated dialog cannot justify toggling notifications');
 }
});

test('export evidence is bounded to one task, its recorded intent and expected format without filenames or signed URLs',async()=>{
 const taskId='11111111-2222-4333-8444-555555555555',clickAt=Date.now(),path='/workspace/generate/model-'+taskId;
 const receipt={taskId,taskPath:path,clickAt,state:'unresolved',operationId:'export-one'};
 const items=[{id:7,startTime:new Date(clickAt+500).toISOString(),filename:'C:/private/head.zip',referrer:'https://studio.tripo3d.ai'+path+'?token=secret',url:'https://cdn.example/private?token=secret',state:'complete'},{id:8,startTime:new Date(clickAt+500).toISOString(),filename:'diagnostic.json',state:'complete'},{id:9,startTime:new Date(clickAt+91000).toISOString(),filename:'later.zip'}];
 const result=await exportRecoveryDiagnostic({studioDownloadReceiptsV1:{[taskId+':source:fbx']:receipt,unrelated:{...receipt,taskId:'other'}}},taskId,async query=>{assert.equal(query.limit,100);return items;});
 assert.equal(result.length,1);assert.equal(result[0].events.length,2);assert.equal(result[0].events[1].expectedFormat,false);assert.equal(result[0].events[0].exactSource,true);
 assert.equal(result[0].events[0].id,7);assert.doesNotMatch(JSON.stringify(result),/secret|private|cdn\.example/);
 assert.deepEqual(await exportRecoveryDiagnostic({},'invalid',()=>{throw Error('must not query');}),[]);
});

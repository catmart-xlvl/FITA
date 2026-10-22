import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createGroupCommands} from '../extension-tripo-studio/group-commands.js';
import {studioUvSaveControl} from '../extension-tripo-studio/smart-uv-save.js';
import {navigateStudioTask} from '../extension-tripo-studio/studio-navigation.js';
import {throwAdapterError,asWorker} from './page-call.js';
const taskId='11111111-2222-3333-4444-555555555555',operationId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',groupKey='a'.repeat(64);
function fixture({lost=false,stuck=false,pending=true,legacy=false}={}){
 let clock=100000,saveTime=null,saves=0;
 const key='workbenchGroupOperation:'+operationId,values={[key]:{step:'smartUV',taskId,groupKey,clicked:true,processingObserved:true,status:legacy?'completed':'running',credits:20}};
 const chrome={storage:{local:{get:async k=>({[k]:structuredClone(values[k])}),set:async v=>Object.assign(values,structuredClone(v))}}};
 const run=createGroupCommands({chrome,now:()=>clock,pause:async ms=>{clock+=ms;},runInTab:async(b,fn,args=[])=>{
  const dirty=pending&&(saveTime===null||stuck||clock-saveTime<1500);
  if(fn.name==='observeGroupStudio')return {taskId,workflow:'smart-uv',unsavedChanges:dirty,uv:{enabled:!dirty,downloadReady:true}};
  assert.equal(fn,studioUvSaveControl,'recovery may not generate or upload');
  if(args[0].action==='save'){saves++;saveTime=clock;if(lost&&saves===1)throw Error('Save reply lost');return {clicked:true};}
  return {taskId,pending:dirty,saveEnabled:dirty,generateEnabled:!dirty,busy:false,blockingDialog:false};
 }});
 return {values,key,saves:()=>saves,elapse:ms=>clock+=ms,run:()=>run({tabId:1},{payload:{action:'recover',operationId,groupKey,taskId}})};
}
test('UV preview/download availability is not completion: Save must finish first',async()=>{
 const f=fixture();const r=await f.run();assert.equal(r.stage,'ready');assert.equal(r.receipt.uvSaved,true);assert.equal(f.saves(),1);assert(r.receipt.savedAt>=102500);
});
test('a lost free Save reply recovers its acknowledgement without another UV charge or Save click',async()=>{
 const f=fixture({lost:true});await assert.rejects(f.run(),/Save reply lost/);assert.equal(f.values[f.key].saveAttempted,true);assert.notEqual(f.values[f.key].status,'completed');f.elapse(2000);
 assert.equal((await f.run()).receipt.uvSaved,true);assert.equal(f.saves(),1);
});
test('an older completed UV receipt does not bypass missing Save evidence',async()=>{
 const f=fixture({legacy:true,pending:false});await assert.rejects(f.run(),/SEG_UV_SAVE_NOT_VERIFIED/);assert.equal(f.saves(),0);
 const pending=fixture({legacy:true});assert.equal((await pending.run()).receipt.uvSaved,true);assert.equal(pending.saves(),1);
});
test('a persistently visible Save cannot be marked complete and free retries are bounded',async()=>{
 const f=fixture({stuck:true});await assert.rejects(f.run(),/SEG_UV_SAVE_NOT_VERIFIED/);assert.equal(f.saves(),3);assert.notEqual(f.values[f.key].uvSaved,true);
});
test('texturing cannot prepare references or click Generate without a matching saved UV receipt',async()=>{
 let actions=0;const run=createGroupCommands({chrome:{storage:{local:{get:async()=>({})}}},pause:async()=>{},runInTab:async()=>{actions++;},legacy:async()=>{actions++;}});
 await assert.rejects(run({},{payload:{action:'texture',taskId,groupKey,operationId}}),/SEG_UV_SAVE_NOT_VERIFIED/);assert.equal(actions,0);
});
test('navigation preserves unsaved changes in another asset instead of discarding them',async()=>{
 const state={taskId:'other',workflow:'smart-uv',unsavedChanges:true,links:[{taskId,workflow:'texture',url:'https://studio.tripo3d.ai/es/workspace/texture/'+taskId}]};
 await assert.rejects(navigateStudioTask({bridge:{tabId:1},chrome:{tabs:{update:()=>assert.fail('must preserve draft')}},pause:async()=>{},runInTab:async()=>state},taskId,'texture'),/SEG_UNSAVED_CHANGES/);
});
test('the UV adapter only clicks the observed free Smart UV Save, never an unrelated Save or priced control',()=>{
 let clicks=0;
 const button=(label,trace)=>({innerText:label,disabled:false,getAttribute:k=>k==='data-trace'?trace:null,getBoundingClientRect:()=>({width:10,height:10}),click:()=>clicks++});
 const uvSave=button('Guardar','studio.workspace_smart-uv.asset_save_button'),priced=button('Desplegar UV 20','studio.workspace_smart-uv.generate_uv_button');
 let buttons=[uvSave,priced],dialogs=[];
 const ctx={location:{origin:'https://studio.tripo3d.ai',pathname:'/es/workspace/smart-uv/'+taskId},getComputedStyle:()=>({}),document:{querySelectorAll:s=>s==='button,[role="button"]'?buttons:s==='[role="dialog"]'?dialogs:[]}};
 const run=input=>throwAdapterError(vm.runInNewContext(`(${studioUvSaveControl})(${JSON.stringify({taskId,...input})})`,ctx));
 assert.equal(run({}).pending,true);assert.equal(run({action:'save'}).clicked,true);assert.equal(clicks,1);
 for(const label of ['保存','Enregistrer','Speichern']){uvSave.innerText=label;assert.equal(run({action:'save'}).clicked,true);}
 assert.equal(clicks,4);
 buttons=[button('Guardar',null),priced];assert.throws(()=>run({action:'save'}),/NOT_READY/);assert.equal(clicks,4);
 buttons=[uvSave,priced];dialogs=[button('Unknown dialog',null)];assert.throws(()=>run({action:'save'}),/CLOSE_OTHER_DIALOGS/);
 assert.throws(()=>run({action:'save',taskId:'other'}),/CONFIRMED_TASK_CHANGED/);assert.equal(clicks,4);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {studioMeshImportControl,createMeshImporter} from '../extension-tripo-studio/mesh-import.js';
import {isReadOnlyStudioCall} from '../extension-tripo-studio/tab-execution.js';
import {throwAdapterError,asWorker} from './page-call.js';
const taskId='11111111-2222-3333-4444-555555555555',attemptId='22222222-2222-3333-4444-555555555555';
const bytes=Buffer.from('glTFtest-file'),model={name:'skirt.glb',sha256:createHash('sha256').update(bytes).digest('hex'),dataBase64:bytes.toString('base64')};
test('only observations can replay an empty Chrome reply; file, confirmation, Save, retry and paid actions cannot',()=>{
 const named=name=>({[name](){}})[name];
 for(const name of ['observeStudioDocument','observeGroupStudio'])assert.equal(isReadOnlyStudioCall(named(name)),true);
 assert.equal(isReadOnlyStudioCall(named('controlImportOrientation'),[{}]),true);
 assert.equal(isReadOnlyStudioCall(named('controlImportOrientation'),[{confirm:true}]),false);
 assert.equal(isReadOnlyStudioCall(named('studioMeshImportControl'),[{action:'inspect'}]),true);
 for(const name of ['studioMeshImportControl','studioUvSaveControl','studioUvCandidatesControl','studioGroupControl'])for(const action of ['prepare','dispatch','save','retry','submitUV','texture','import'])assert.equal(isReadOnlyStudioCall(named(name),[{action}]),false);
 assert.equal(isReadOnlyStudioCall(named('clickStudioGenerate')),false);
});
function page(){
 const events=[];
 const field={accept:'.fbx,.obj,.stl,.glb',files:[],disabled:false,dispatchEvent:e=>{events.push(e.type);return true;}};
 const context=vm.createContext({location:{origin:'https://studio.tripo3d.ai',pathname:'/workspace/texture/'+taskId},document:{querySelectorAll:q=>q==='input[type="file"]'?[field]:[]},getComputedStyle:()=>({}),atob,Uint8Array,File,Event,DataTransfer:class{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}}});
 const run=input=>throwAdapterError(vm.runInContext(`(${studioMeshImportControl})(${JSON.stringify({attemptId,sha256:model.sha256,...input})})`,context));
 return {run,field,events,context};
}
test('file preparation has no UI effect, synchronous dispatch is idempotent after a lost reply',()=>{
 const p=page();const prepared=p.run({action:'prepare',...model,size:bytes.length});
 assert.equal(prepared.phase,'prepared');assert.equal(p.field.files.length,0);assert.deepEqual(p.events,[]);
 assert.equal(p.run({action:'dispatch',previousTaskId:taskId}).phase,'dispatched');
 assert.equal(p.run({action:'inspect'}).phase,'dispatched');
 assert.equal(p.run({action:'dispatch',previousTaskId:taskId}).phase,'dispatched');
 assert.deepEqual(p.events,['input','change']);assert.equal(p.field.files[0].name,'skirt.glb');
});
test('changed source or route stops before any file event',()=>{
 const p=page();p.run({action:'prepare',...model,size:bytes.length});
 assert.throws(()=>p.run({action:'dispatch',previousTaskId:'other'}),/TASK_CHANGED/);
 assert.throws(()=>p.run({action:'dispatch',previousTaskId:taskId,sha256:'c'.repeat(64)}),/SOURCE_CHANGED/);
 assert.deepEqual(p.events,[]);assert.equal(p.field.files.length,0);
});
test('an event handler failure leaves a non-repeatable dispatch intent',()=>{
 const p=page();p.run({action:'prepare',...model,size:bytes.length});
 p.field.dispatchEvent=e=>{p.events.push(e.type);throw Error('page rerender');};
 assert.throws(()=>p.run({action:'dispatch',previousTaskId:taskId}),/page rerender/);
 assert.equal(p.run({action:'inspect'}).phase,'dispatching');
 assert.equal(p.run({action:'dispatch',previousTaskId:taskId}).phase,'dispatching');
 assert.deepEqual(p.events,['input']);
});
test('worker validates bytes before page access and verifies lost preparation/dispatch acknowledgements',async()=>{
 for(const lostAction of ['prepare','dispatch']){
  const p=page(),receipt={},saved=[];let lost=false;
  const importer=createMeshImporter({runInTab:async(_b,fn,[input])=>{
   const result=vm.runInContext(`(${fn})(${JSON.stringify(input)})`,p.context);
   if(input.action===lostAction&&!lost){lost=true;throw Error('STUDIO_DID_NOT_RESPOND');}
   return result;
  }});
  const result=await importer({},{model,receipt,persist:async()=>saved.push(structuredClone(receipt)),previousTaskId:taskId});
  assert.equal(result.dispatched,true);assert.equal(receipt.dispatch.phase,'dispatched');
  assert.deepEqual(p.events,['input','change']);assert.equal(saved[0].dispatch.phase,'preparing');
  assert(saved.some(s=>s.dispatch.phase==='dispatching'));
 }
 let calls=0;
 const importer=createMeshImporter({runInTab:async()=>{calls++;}});
 await assert.rejects(()=>importer({},{model:{...model,sha256:'f'.repeat(64)},receipt:{},persist:async()=>{},previousTaskId:taskId}),/BYTES_INVALID/);
 assert.equal(calls,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {observeStudioDocument,resolveConfirmedStudioTask,clickStudioGenerate} from '../extension-tripo-studio/studio-adapter.js';
import {throwAdapterError,asWorker} from './page-call.js';
const id='ac900bcd-249f-4204-811b-543f783237b2',origin='https://studio.tripo3d.ai';
function context(pathname){
 const uv={innerText:'Desplegar UV 20',disabled:false,getBoundingClientRect:()=>({width:80,height:30}),getAttribute:k=>k==='data-trace'?'studio.workspace_smart-uv.generate_uv_button':null,querySelectorAll:()=>[],classList:{contains:()=>false}};
 return {location:{origin,pathname,href:origin+pathname},document:{querySelectorAll:selector=>selector==='button'?[uv]:[]},crypto:globalThis.crypto,TextEncoder,URL,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};
}
test('observed Spanish and English Smart UV routes identify the imported model without enabling a paid click',async()=>{
 for(const prefix of ['/es',''])for(const slug of ['', 'goth-punk-outfit-']){
  const ctx=context(prefix+'/workspace/smart-uv/'+slug+id),s=await vm.runInNewContext(`(${observeStudioDocument})()`,ctx);
  assert.equal(s.supported,true);assert.equal(s.workflow,'smart-uv');assert.equal(s.currentTaskId,id);
  assert.equal(s.smartUV.costLabel,'20');assert.equal(s.smartUV.enabled,true);assert.equal(s.smartUV.submissionSupported,false);
  assert.equal(s.generateEnabled,false);assert.equal(s.generateLabel,null);assert.equal(s.costLabel,null);
  assert.throws(()=>throwAdapterError(vm.runInNewContext(`(${clickStudioGenerate})('Desplegar UV 20')`,ctx)),/GENERATION_WORKSPACE_REQUIRED/);
 }
});
test('similar unsupported paths are not mistaken for a Studio task',async()=>{
 for(const route of ['/something/workspace/smart-uv/'+id,'/es/workspace/smart-uv/not-a-task','/es/workspace/smart-uv/nested/'+id]){
  const s=await vm.runInNewContext(`(${observeStudioDocument})()`,context(route));assert.equal(s.supported,false);assert.equal(s.currentTaskId,null);
 }
});
test('Smart UV navigation requires an observed exact link; does not invent URLs or reuse signed links',()=>{
 let links=[];const ctx={location:{origin},document:{querySelectorAll:s=>s==='a[href]'?links.map(href=>({href})):[]},URL};
 const resolve=()=>{const value=vm.runInNewContext(`(${resolveConfirmedStudioTask})('${id}','smart-uv')`,ctx);if(value.adapterError)throw Error(value.adapterError);return value;};
 assert.throws(resolve,/LINK_NOT_OBSERVED/);links=[origin+'/es/workspace/smart-uv/'+id];assert.equal(resolve().url,links[0]);
 links=[links[0]+'?token=private'];assert.throws(resolve,/LINK_NOT_OBSERVED/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {navigateStudioTask,navigateStudioModelWorkspace,studioNavigationControl,verifiedTaskUrl} from '../extension-tripo-studio/studio-navigation.js';
const id='11111111-2222-4333-8444-555555555555',other='99999999-2222-4333-8444-555555555555',origin='https://studio.tripo3d.ai';
const route=w=>`${origin}/es/workspace/${w}/observed-${id}`;
function harness(initial,{control,visit,pause}={}){
 let state=structuredClone(initial);const stored={},calls=[];
 const chrome={storage:{local:{get:async k=>({[k]:stored[k]}),set:async v=>Object.assign(stored,structuredClone(v))}},tabs:{update:async(tab,{url})=>{
  calls.push({url});assert.equal(tab,7);
  if(visit)return visit(url,state,next=>state=next);
  state={...state,taskId:url.endsWith(id)?id:null,workflow:new URL(url).pathname.match(/workspace\/([^/]+)/)[1],importAvailable:true};
 }}};
 const context={chrome,bridge:{tabId:7},pause:async()=>{pause?.(state);},runInTab:async(_b,fn,args=[])=>{
  if(fn.name==='observeGroupStudio')return structuredClone(state);
  if(fn.name==='resolveStudioGenerationWorkspace')return {url:origin+'/es/workspace/generate'};
  if(fn.name==='studioNavigationControl'){calls.push(args[0]);return control?.(args[0],state)||{navigation:'unavailable'};}
  if(fn.name==='exportStudioControl')throw Error('CLOSE_OTHER_DIALOGS_FIRST');
  throw Error('Unexpected action '+fn.name);
 }};
 return {context,calls,stored,set:s=>state=structuredClone(s),run:(workflow)=>navigateStudioTask(context,id,workflow)};
}
for(const start of ['image','generate','texture','smart-uv','rigging'])for(const destination of ['generate','texture','smart-uv','rigging'])test(`shared navigation ${start} -> ${destination} selects and verifies the exact model`,async()=>{
 const h=harness({workflow:start,taskId:other,links:[{taskId:id,workflow:destination,url:route(destination)}]});
 const result=await h.run(destination);assert.equal(result.taskId,id);assert.equal(result.workflow,destination);
 // Without the rendered side menu, the observed route loads directly.
 assert.deepEqual(h.calls,[{url:route(destination)}]);
});
for(const destination of ['generate','texture','smart-uv','rigging','animate','texture-pbr'])test(`in-page navigation to ${destination} uses Studio's own links without reloading`,async()=>{
 const h=harness({workflow:'generate-image',taskId:other,activeTool:'generate-image',links:[{taskId:id,workflow:'generate',url:route('generate')},{taskId:other,workflow:destination,url:route(destination).replace(id,other)}]},{control:(input,state)=>{
  if(input.action==='select-task'){state.taskId=id;state.workflow='generate';state.activeTool='generate';state.links=[{taskId:id,workflow:destination,url:route(destination)}];}
  else {state.workflow=input.workflow;state.activeTool='generate';}
  return {navigation:'clicked'};
 },pause:state=>{if(state.workflow===destination)state.activeTool=destination;}});
 const result=await h.run(destination);assert.equal(result.taskId,id);assert.equal(result.workflow,destination);assert.equal(result.activeTool,destination);
 assert.equal(h.calls.some(c=>c.url),false,'no page reload');
});
test('previously observed routes survive disappearing links and a worker restart, without inventing asset URLs',async()=>{
 const h=harness({workflow:'generate',taskId:id,links:[{taskId:id,workflow:'texture',url:route('texture')}]});
 await h.run('generate');h.set({workflow:'image',taskId:null,links:[]});
 await h.run('texture');assert.deepEqual(h.calls,[{url:route('texture')}]);
 const before=JSON.stringify(h.stored);h.set({workflow:'rigging',taskId:other,links:[]});
 await navigateStudioTask({...h.context},id,'texture');assert.equal(JSON.stringify(h.stored),before);
 assert(h.calls.every(c=>c.url===route('texture')));
});
test('with no asset URLs, native task cards and tool controls restore both identity and workflow',async()=>{
 const h=harness({workflow:'image',taskId:null,links:[]},{control:(input,state)=>{
  if(input.action==='select-task'){state.taskId=id;state.workflow='generate';}
  else {assert.equal(input.workflow,'smart-uv');state.workflow='smart-uv';}
  return {navigation:'clicked'};
 }});
 const result=await h.run('smart-uv');assert.equal(result.taskId,id);assert.equal(result.workflow,'smart-uv');
 assert.deepEqual(h.calls.map(c=>c.action),['select-task','select-tool']);
});
test('an empty context is rebuilt from Model before finding its exact asset and tool',async()=>{
 const h=harness({workflow:'image',taskId:null,links:[]},{control:(input,state)=>{
  if(state.workflow==='image')return {navigation:'unavailable'};
  if(input.action==='select-task')state.taskId=id;else state.workflow=input.workflow;
  return {navigation:'clicked'};
 }});
 const result=await h.run('rigging');assert.equal(result.taskId,id);assert.equal(result.workflow,'rigging');
 assert.deepEqual(h.calls.filter(c=>c.url),[{url:origin+'/es/workspace/generate'}]);
});
test('same-ID transitions wait for the requested tool instead of accepting the previous frame',async()=>{
 let polls=0;
 const h=harness({workflow:'generate',taskId:id,links:[{taskId:id,workflow:'texture',url:route('texture')}]},{visit:()=>{},pause:state=>{if(++polls===4)state.workflow='texture';}});
 const result=await h.run('texture');assert.equal(result.workflow,'texture');assert.equal(polls,4);
});

test('a notification dismissal waits for DOM acknowledgement without toggling the trigger again',async()=>{
 let polls=0;
 const h=harness({workflow:'generate',taskId:id,blockingDialog:true,links:[]},{control:input=>{assert.equal(input.action,'close-notifications');return {navigation:'closing'};},pause:state=>{if(++polls===4)state.blockingDialog=false;}});
 assert.equal((await h.run('generate')).taskId,id);
 assert.equal(polls,4);assert.deepEqual(h.calls,[{action:'close-notifications'}]);
});
test('unsaved edits, unknown dialogs, invalid destinations and unresolved identities cannot trigger another action',async()=>{
 for(const changes of [{unsavedChanges:true},{blockingDialog:true}]){
  const h=harness({workflow:'texture',taskId:other,links:[{taskId:id,workflow:'generate',url:route('generate')}],...changes});
  await assert.rejects(()=>h.run('generate'),/SEG_UNSAVED_CHANGES|CLOSE_OTHER_DIALOGS_FIRST/);assert.equal(h.calls.some(c=>c.url||c.action!=='close-notifications'),false);
 }
 const h=harness({workflow:'generate',taskId:null,links:[]});
 await assert.rejects(()=>h.run('generate'),/CONFIRMED_TASK_LINK_NOT_OBSERVED/);
 assert.equal(h.calls.some(c=>c.url),false);
 await assert.rejects(()=>h.run('checkout'),/SEG_WORKFLOW_INVALID/);
});
test('route memory refuses signed URLs, foreign origins, another task and unrelated paths',()=>{
 for(const url of [route('texture')+'?token=private',route('texture')+'#secret',route('texture').replace('studio.tripo3d.ai','evil.example'),route('texture').replace(id,other),origin+'/account/'+id,origin+'/workspace/texture/nested/model-'+id])assert.equal(verifiedTaskUrl(url,id),null);
 assert.equal(verifiedTaskUrl(route('texture'),id,'texture'),route('texture'));
});
test('starting an import from another tool restores the Model workspace without uploading or generating',async()=>{
 const h=harness({workflow:'image',taskId:null,links:[],importAvailable:false});
 const result=await navigateStudioModelWorkspace(h.context);assert.equal(result.workflow,'generate');assert(result.importAvailable);
 assert.deepEqual(h.calls,[{url:origin+'/es/workspace/generate'}]);
});
test('native controls support href-less cards, but refuse ambiguous or priced controls',()=>{
 let clicks=0,buttons=[],cards=[];
 const element=(label,attributes={})=>({innerText:label,disabled:false,contains:()=>false,getBoundingClientRect:()=>({width:50,height:20}),getAttribute:k=>attributes[k]??null,matches:()=>!!attributes['data-price'],click:()=>clicks++});
 const context={location:{origin},document:{querySelectorAll:s=>s==='[data-task-id]'?cards:s.startsWith('a,button')?buttons:[]},getComputedStyle:()=>({display:'block',visibility:'visible'})};
 const control=input=>vm.runInNewContext(`(${studioNavigationControl})(${JSON.stringify(input)})`,context);
 cards=[element('same name',{'data-task-id':other}),element('same name',{'data-task-id':id})];
 assert.equal(control({action:'select-task',taskId:id}).navigation,'clicked');assert.equal(clicks,1);
 buttons=[element('Smart UV')];assert.equal(control({action:'select-tool',workflow:'smart-uv'}).navigation,'clicked');assert.equal(clicks,2);
 for(const list of [[element('Rig',{'data-trace':'studio.workspace_rigging.rig_button'})],[element('Rig',{'data-price':'20'})],[element('Rig'),element('Rig')]]){
  buttons=list;assert.equal(control({action:'select-tool',workflow:'rigging'}).adapterError,'STUDIO_NAVIGATION_AMBIGUOUS');
 }
 assert.equal(clicks,2);
});

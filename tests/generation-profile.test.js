import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {generationLimits,matchingGenerationLimits} from '../shared/generation-profile.js';
import {studioTopologyControl,observeStudioDocument,exportStudioControl} from '../extension-tripo-studio/studio-adapter.js';
import {createProviders} from '../server/providers.js';
import {throwAdapterError,asWorker} from './page-call.js';

test('four polygon targets are distinct by part and cannot be overwritten by callers',async()=>{
  assert.deepEqual(generationLimits('body'),[18000,20000,22500,25000]);
  assert.deepEqual(generationLimits('head'),[17000,20000,23000,25000]);
  const limits=generationLimits('head');limits[0]=500;
  assert.equal(generationLimits('head')[0],17000);
  assert(!matchingGenerationLimits('body',generationLimits('head')));
  assert(!matchingGenerationLimits('head',[20000,17000,23000,25000]));
  await assert.rejects(async()=>generationLimits('other'));
});

test('generation preparation recognizes HD before multiview mounts, without relying on translated button labels',async()=>{
  const origin='https://studio.tripo3d.ai',rect=()=>({width:100,height:30});
  let clicks=0;
  const button=(label,classes=[],icons=[])=>({innerText:label,disabled:false,getBoundingClientRect:rect,getAttribute:()=>null,classList:{contains:name=>classes.includes(name)},querySelectorAll:selector=>selector==='[class]'?icons.map(icon=>({classList:{contains:name=>name===icon}})):[],click:()=>{clicks++;}});
  for(const locale of ['','es','ja','zh-CN','de','fr'])for(const suffix of ['', '/character-editor-with-tail-']){
    const smart=button('モード',[],['i-tripo:speed-bolt']),generate=button('生成 60',['animate-button']);
    let buttons=[smart,generate];
    const pathname='/'+(locale?locale+'/':'')+'workspace/generate'+suffix;
    const ctx={location:{origin,pathname,href:origin+pathname},document:{querySelectorAll:s=>s==='button'?buttons:[]},crypto:globalThis.crypto,TextEncoder,URL,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};
    const observe=()=>vm.runInNewContext('('+observeStudioDocument.toString()+')()',ctx);
    const result=await observe();assert.equal(result.supported,true);assert.equal(result.mode,'other');assert.equal(result.generationCount,null);assert.equal(result.currentTaskId,null);
    assert.equal(result.generationMode,'unknown');assert.equal(clicks,0);
    buttons=[generate];assert.equal((await observe()).supported,false);
    buttons=[smart,button('別モード',[],['i-tripo:speed-bolt']),generate];assert.equal((await observe()).supported,false);
    buttons=[smart,generate,generate];assert.equal((await observe()).supported,false);
    buttons=[smart,generate];ctx.location.pathname=pathname+'/nested/other';assert.equal((await observe()).supported,false);
    ctx.location.pathname='/pricing';assert.equal((await observe()).supported,false);
  }
});
function topologyFixture({labels=['Model 01','Model 02','Model 03','Model 04'],values=[500,500,500,500],step='',ack=true,ackEvent='change',shared=false,open=true,otherDialog=false,locale='',modal=false,shellOpacity='1',quad=true,modeAck=true,keyboardAck=false,keyboardIncrement=500,keyboardDelay=0,keyboardAsync=false,keyboardInterruptAfter=0,useScheduler=false}={}){
  const rect=()=>({width:100,height:20}),inputSelector='input[type="text"],input[type="number"]';
  const state={open,shared,quad,otherDialog,clicks:0,anchorClicks:0,modeClicks:0,keys:[],pending:[]};
  class Input{
    constructor(value){this._value=String(value);this.step=step;this.type='text';this.events=[];}
    get value(){return this._value;}
    set value(v){this._value=v;}
    getAttribute(key){return key==='type'?this.type:null;}
    getBoundingClientRect(){return rect();}
    focus(){document.activeElement=this;}
    blur(){if(document.activeElement===this){document.activeElement=null;this.dispatchEvent({type:'blur'});this.dispatchEvent({type:'focusout'});}}
    dispatchEvent(e){this.events.push(e.type);if(ack&&e.type===ackEvent)this.slider.value=this.value;}
  }
  const inputs=values.map(v=>new Input(v));
  const sliders=values.map((value,index)=>({value:String(value),getBoundingClientRect:rect,focus(){document.activeElement=this;},getAttribute(key){return {'aria-valuemin':'500','aria-valuemax':'25000','aria-valuenow':this.value,tabindex:'0'}[key]??null;},dispatchEvent(event){
    if(event.type!=='keydown')return;
    state.keys.push({index,key:event.key});
    if(keyboardInterruptAfter&&state.keys.length===keyboardInterruptAfter)state.otherDialog=true;
    if(!keyboardAck)return;
    const before=Number(this.value),next=event.key==='Home'?500:event.key==='End'?25000:before+({ArrowRight:1,ArrowLeft:-1,PageUp:10,PageDown:-10}[event.key]||0)*keyboardIncrement;
    const commit=()=>{this.value=String(Math.max(500,Math.min(25000,next)));inputs[index].value=this.value;};
    if(keyboardDelay)state.pending.push({remaining:keyboardDelay,commit});else if(keyboardAsync)setImmediate(commit);else commit();
  }}));
  const toggle={getBoundingClientRect:rect,getAttribute:key=>key==='aria-checked'?String(state.shared):null,click:()=>{state.shared=false;state.clicks++;}};
  const modeButton=(isQuad)=>({innerText:isQuad?'Quad New':'Triangle',getBoundingClientRect:rect,querySelectorAll:()=>[],getAttribute:key=>key==='aria-pressed'?String(isQuad===state.quad):null,click:()=>{state.modeClicks++;if(modeAck)state.quad=isQuad;}});
  const modes=[modeButton(true),modeButton(false)];
  const panel={id:'dynamic-panel',getBoundingClientRect:rect,getAttribute:key=>({'aria-labelledby':modal?'native-heading':'dynamic-trigger','data-state':'open'}[key]??null),querySelectorAll(selector){return selector==='button'?modes:selector===inputSelector?(state.shared?inputs.slice(0,1):inputs):selector==='[role="slider"]'?(state.shared?sliders.slice(0,1):sliders):selector==='[role="switch"]'?[toggle]:[];}};
  inputs.forEach((input,i)=>{
    input.slider=sliders[i];
    const row={parentElement:panel,querySelectorAll:selector=>selector===inputSelector?[input]:selector==='[role="slider"]'?[sliders[i]]:selector==='p,label,legend,[role="heading"]'?[{innerText:labels[i]}]:[]};
    sliders[i].parentElement=row;
    input.parentElement={parentElement:row,querySelectorAll:selector=>selector===inputSelector?[input]:selector==='[role="slider"]'?[sliders[i]]:[]};
  });
  const trigger={querySelectorAll:()=>[],getBoundingClientRect:rect,getAttribute:key=>({'type':'button','aria-haspopup':'dialog','aria-controls':panel.id}[key]??null),click:()=>{state.anchorClicks++;}};
  const customize={tagName:'BUTTON',getBoundingClientRect:rect,getAttribute:key=>key==='type'?'button':null,hasAttribute:()=>false,querySelectorAll:selector=>selector==='[class]'?[{classList:{contains:name=>name==='i-tripo:angle'}}]:[],click:()=>{state.open=true;state.clicks++;}};
  const settings={children:[customize],parentElement:null};
  const quantityGroup={parentElement:{children:[],parentElement:{children:[],parentElement:settings}},getBoundingClientRect:rect,querySelector:()=>({}),querySelectorAll:()=>[]};
  for(let scope=quantityGroup.parentElement;scope;scope=scope.parentElement)Object.assign(scope,{getBoundingClientRect:rect,getAttribute:()=>null,querySelectorAll:()=>[]});
  const unknown={getBoundingClientRect:rect,getAttribute:()=>null,querySelectorAll:()=>[]};
  const document={getElementById:id=>id==='dynamic-trigger'?trigger:null,querySelectorAll:selector=>selector==='[role="group"]'?[quantityGroup]:selector==='[role="slider"]'?sliders:selector==='[role="dialog"]'?[...(state.open?[panel]:[]),...(state.otherDialog?[unknown]:[])]:selector==='div[type="button"][aria-haspopup="dialog"]'?[trigger]:[]};
  const getComputedStyle=el=>({opacity:el===panel?shellOpacity:'1'});
  class TestEvent{constructor(type,options={}){this.type=type;Object.assign(this,options);}}
  const context=vm.createContext({document,location:{origin:'https://studio.tripo3d.ai',pathname:'/'+(locale?locale+'/':'')+'workspace/generate',href:'https://studio.tripo3d.ai/'+(locale?locale+'/':'')+'workspace/generate'},getComputedStyle,HTMLInputElement:Input,Event:TestEvent,KeyboardEvent:TestEvent,MessageChannel:globalThis.MessageChannel,...(useScheduler?{scheduler:{postTask:callback=>new Promise(resolve=>setImmediate(()=>resolve(callback())))}}:{}),crypto:globalThis.crypto,TextEncoder,URL});
  const fn=asWorker(vm.runInContext('('+studioTopologyControl.toString()+')',context));
  const observe=vm.runInContext('('+observeStudioDocument.toString()+')',context);
  const advance=()=>{state.pending=state.pending.filter(p=>{if(--p.remaining>0)return true;p.commit();return false;});};
  return {fn,inputs,sliders,state,observe,document,panel,getComputedStyle,advance};
}

test('native Quad/Triangle modal is recognized without the former popover trigger, including entering animation shells',async()=>{
 for(const shellOpacity of ['0','1']){
  const f=topologyFixture({modal:true,shellOpacity,quad:false,values:generationLimits('body')}),head=generationLimits('head');
  assert.equal((await f.observe()).blockingDialog,false);
  assert.equal((await f.fn({step:'inspect'})).faceLimits,null);
  assert.equal(f.state.modeClicks,0);
  assert.equal((await f.fn({step:'configure',faceLimits:head})).pending,true);
  assert.equal(f.state.modeClicks,1);assert.equal(f.state.quad,true);
  for(let i=0;i<3;i++)(await f.fn({step:'configure',faceLimits:head}));
  assert.deepEqual(Array.from((await f.fn({step:'inspect'})).faceLimits),head);
  assert.equal(f.state.clicks,0);assert.equal(f.state.anchorClicks,0);
 }
});

test('unconfirmed Quad selection and unrelated dialogs cannot advance to verified polygon settings',async()=>{
 const f=topologyFixture({modal:true,quad:false,modeAck:false,values:generationLimits('head')});
 for(let i=0;i<12;i++)assert.equal((await f.fn({step:'configure',faceLimits:generationLimits('head')})).pending,true);
 assert.equal((await f.fn({step:'inspect'})).faceLimits,null);
 assert(f.inputs.every(input=>input.events.length===0));
 const other=topologyFixture({modal:true,otherDialog:true,shellOpacity:'0'});
 assert.equal((await other.observe()).blockingDialog,true);
 await assert.rejects(async()=>(await other.fn({step:'configure',faceLimits:generationLimits('head')})),/CLOSE_OTHER_DIALOGS_FIRST/);
 assert.equal(other.state.modeClicks,0);
});

test('native focus lifecycle commits fields that save only on delegated focusout',async()=>{
 const f=topologyFixture({modal:true,ackEvent:'focusout'}),limits=generationLimits('body');
 for(let i=0;i<4;i++)(await f.fn({step:'configure',faceLimits:limits}));
 assert.deepEqual(Array.from((await f.fn({step:'inspect'})).faceLimits),limits);
 assert.equal(f.document.activeElement,null);
});

test('failed topology preparation leaves bounded read-only evidence and excludes nonnumeric field contents',async()=>{
  const f=topologyFixture({ack:false}),limits=generationLimits('head');
  for(let i=0;i<20;i++)(await f.fn({step:'configure',faceLimits:limits,configurationId:'attempt-'+i}));
  f.inputs[1].value='private unrelated text';
  const before=f.inputs.map(input=>input.events.length);
  const result=await f.observe({includeLayoutDiagnostic:true});
  const diagnostic=result.layoutDiagnostic.topology;
  assert.equal(diagnostic.trace.length,16);
  assert(diagnostic.trace.every(entry=>entry.action==='write-count'&&entry.changingIndex===0));
  assert.equal(diagnostic.sliders[0].field.value,17000);
  assert.equal(diagnostic.sliders[0].value,'500');
  assert.equal(diagnostic.sliders[1].field.value,null);
  assert(!JSON.stringify(diagnostic).includes('private unrelated text'));
  assert.deepEqual(f.inputs.map(input=>input.events.length),before);
});

test('real text fields and paired sliders are ordered by ordinal, committed one at a time and read back',async()=>{
  for(const [locale,prefix] of [['','Model'],['es','Modelo'],['ja','モデル'],['zh-CN','模型'],['de','Modell'],['fr','Modèle']]){
    const {fn,inputs}=topologyFixture({locale,labels:[3,1,4,2].map(n=>prefix+' 0'+n)}),faceLimits=generationLimits('body');
    for(let i=0;i<4;i++)assert.equal((await fn({step:'configure',faceLimits})).pending,true);
    const result=(await fn({step:'configure',faceLimits}));assert.equal(result.pending,undefined);assert.deepEqual(Array.from(result.faceLimits),faceLimits);
    assert.deepEqual(inputs.map(i=>Number(i.value)),[22500,18000,25000,20000]);
    assert(inputs.every(i=>i.events.join(',')==='input,change,blur,focusout'));
  }
});

test('ambiguous ordinals, unsupported increments and unrelated dialogs stop before submission',async()=>{
  await assert.rejects(async()=>(await topologyFixture({labels:['Model 01','Model 01','Model 03','Model 04']}).fn({step:'configure',faceLimits:generationLimits('head')})),/ORDER_NOT_VERIFIED/);
  const {fn}=topologyFixture({values:[17000,20000,21000,25000],step:'1000'});
  await assert.rejects(async()=>(await fn({step:'configure',faceLimits:generationLimits('head')})),/VALUE_UNSUPPORTED/);
  const unknown=topologyFixture({otherDialog:true});await assert.rejects(async()=>(await unknown.fn({step:'configure',faceLimits:generationLimits('head')})),/CLOSE_OTHER_DIALOGS/);assert(unknown.inputs.every(i=>i.events.length===0));
});

test('an input write alone never proves the application committed the polygon settings',async()=>{
  const {fn,inputs,state}=topologyFixture({ack:false});
  for(let i=0;i<4;i++){const result=(await fn({step:'configure',faceLimits:generationLimits('head')}));assert.equal(result.pending,true);assert(!matchingGenerationLimits('head',Array.from(result.faceLimits)));}
  await assert.rejects(async()=>(await fn({step:'configure',faceLimits:generationLimits('head')})),/POLYGON_SETTINGS_NOT_VERIFIED/);
  assert.equal(inputs[0].events.length,4);assert.equal(state.keys.length,1);
  assert.equal((await fn({step:'inspect'})).faceLimits,null);
});

test('uncommitted fields reconcile through native slider keys for both groups and discovered increments',async()=>{
 for(const group of ['head','body'])for(const keyboardIncrement of [1,100,500]){
  const f=topologyFixture({modal:true,ack:false,keyboardAck:true,keyboardIncrement}),limits=generationLimits(group);
  let result;
  for(let i=0;i<80;i++){result=(await f.fn({step:'configure',faceLimits:limits}));if(!result.pending)break;}
  assert.deepEqual(Array.from(result.faceLimits),limits);
  assert(!result.pending);
  assert(f.inputs.every(input=>input.events.length===4));
  assert(f.state.keys.some(({key})=>key==='End'));
  assert(f.state.keys.some(({key})=>key==='PageDown'));
  assert.deepEqual(f.sliders.map(slider=>Number(slider.value)),limits);
 }
});

test('delayed slider acknowledgements do not replay keys or rewrite text and still recover after a lost reply',async()=>{
 const f=topologyFixture({ack:false,keyboardAck:true,keyboardDelay:2,values:[18000,20000,23000,25000]}),limits=generationLimits('head');
 (await f.fn({step:'configure',faceLimits:limits}));
 (await f.fn({step:'configure',faceLimits:limits})); // Drop the reply after its key was dispatched.
 assert.equal(f.state.keys.length,1);
 assert.equal((await f.fn({step:'configure',faceLimits:limits})).pending,true);f.advance();
 assert.equal(f.state.keys.length,1);
 assert.equal((await f.fn({step:'configure',faceLimits:limits})).pending,true);f.advance();
 let result;
 for(let i=0;i<10;i++){result=(await f.fn({step:'configure',faceLimits:limits}));f.advance();if(!result.pending)break;}
 assert(!result.pending);assert.deepEqual(Array.from(result.faceLimits),limits);
 assert.equal(f.inputs[0].events.length,4);assert.equal(f.state.keys.length,2);
});

test('a native keyboard increment that cannot reach the requested value stops without inventing committed values',async()=>{
 const f=topologyFixture({ack:false,keyboardAck:true,keyboardIncrement:1000,values:[18000,20000,22500,25000]}),limits=generationLimits('head');
 await assert.rejects(async()=>{for(let i=0;i<20;i++)(await f.fn({step:'configure',faceLimits:limits}));},/POLYGON_VALUE_UNSUPPORTED/);
 assert.notDeepEqual(f.sliders.map(slider=>Number(slider.value)),limits);
 assert.equal(f.state.clicks,0);
});

test('slider recovery also converges on varied native budgets, starting values and row order without character-specific targets',async()=>{
 let seed=731;
 const budget=()=>{seed=(seed*1664525+1013904223)>>>0;return 500+(seed%50)*500;};
 for(let caseIndex=0;caseIndex<64;caseIndex++){
  const limits=[budget(),budget(),budget(),budget()],initial=[budget(),budget(),budget(),budget()];
  const f=topologyFixture({modal:caseIndex%2===0,ack:false,keyboardAck:true,keyboardIncrement:caseIndex%8===0?1:500,values:initial,labels:['Model 03','Model 01','Model 04','Model 02']});
  let result;
  for(let attempt=0;attempt<80;attempt++){result=(await f.fn({step:'configure',faceLimits:limits}));if(!result.pending)break;}
  assert(!result.pending,'case '+caseIndex+' must converge');
  assert.deepEqual(Array.from(result.faceLimits),limits);
  assert.deepEqual(f.sliders.map(slider=>Number(slider.value)),[limits[2],limits[0],limits[3],limits[1]]);
 }
});

test('unit-increment native sliders commit through deferred DOM events in bounded acknowledged batches',async()=>{
 const f=topologyFixture({modal:true,ack:false,keyboardAck:true,keyboardIncrement:1,keyboardAsync:true,useScheduler:true}),limits=generationLimits('head');
 let result;
 for(let attempt=0;attempt<80;attempt++){
  const before=f.state.keys.length;
  result=await f.fn({step:'configure',faceLimits:limits});
  assert(f.state.keys.length-before<=128);
  await new Promise(setImmediate);
  if(!result.pending)break;
 }
 assert(!result.pending);assert.deepEqual(Array.from(result.faceLimits),limits);
 assert(f.inputs.every(input=>input.events.length===4));
});

test('a dialog appearing between acknowledged keys interrupts the free batch before further input',async()=>{
 const f=topologyFixture({ack:false,keyboardAck:true,keyboardIncrement:1,keyboardInterruptAfter:3}),limits=generationLimits('head');
 await f.fn({step:'configure',faceLimits:limits});
 await assert.rejects(()=>f.fn({step:'configure',faceLimits:limits}),/CLOSE_OTHER_DIALOGS_FIRST/);
 assert.equal(f.state.keys.length,3);
});

test('native settings button and shared switch work without localized button labels',async()=>{
  const {fn,state}=topologyFixture({open:false,shared:true,locale:'ja'}),faceLimits=generationLimits('head');
  assert.equal((await fn({step:'inspect'})).open,false);assert.equal(state.clicks,0);
  assert.equal((await fn({step:'configure',faceLimits})).pending,true);assert.equal(state.open,true);
  assert.equal((await fn({step:'configure',faceLimits})).pending,true);assert.equal(state.shared,false);
  for(let i=0;i<4;i++)(await fn({step:'configure',faceLimits}));
  assert.deepEqual(Array.from((await fn({step:'inspect'})).faceLimits),faceLimits);assert.equal(state.clicks,2);assert.equal(state.anchorClicks,0);
});

test('the topology popover is not a blocking modal but unknown dialogs remain blocked in every supported route',async()=>{
  for(const locale of ['','es','ja','zh-CN','fr','de']){
    assert.equal((await topologyFixture({locale}).observe()).blockingDialog,false);
    assert.equal((await topologyFixture({locale,otherDialog:true}).observe()).blockingDialog,true);
  }
});

test('reopening after head export switches to body targets even when the DIV anchor does not open the panel',async()=>{
 const head=generationLimits('head'),body=generationLimits('body');
 const {fn,state,inputs}=topologyFixture({open:false,values:head});
 assert.equal((await fn({step:'configure',faceLimits:body})).pending,true);
 for(let i=0;i<3;i++)(await fn({step:'configure',faceLimits:body}));
 assert.deepEqual(Array.from((await fn({step:'inspect'})).faceLimits),body);
 assert.equal(state.anchorClicks,0);assert.equal(state.clicks,1);
 assert.deepEqual(inputs.map(input=>input.events.length),[4,0,4,0]);
});

test('API sends each requested polygon budget exactly and rejects invalid limits before any request',async()=>{
  const requests=[],provider=createProviders(async(url,options)=>{requests.push(JSON.parse(options.body));return Response.json({code:0,data:{task_id:'mock'}});});
  for(const faceLimit of new Set([...generationLimits('head'),...generationLimits('body')]))await provider.mesh('test-key',[],{faceLimit});
  assert.deepEqual(requests.map(r=>r.face_limit),[17000,20000,23000,25000,18000,22500]);
  const count=requests.length;for(const faceLimit of [0,NaN,25001,'20000',22500.5])await assert.rejects(()=>provider.mesh('test-key',[],{faceLimit}));assert.equal(requests.length,count);
});

test('export closes only the structurally verified topology panel and waits for closure before opening Export',async()=>{
 for(const modal of [false,true])for(const condition of ['normal','unrelated-dialog','close-not-acknowledged']){
  const f=topologyFixture({values:generationLimits('body'),otherDialog:condition==='unrelated-dialog',locale:'ja',modal,shellOpacity:'0'});let closes=0,exports=0;
  const rect=()=>({width:100,height:20});
  const close={getBoundingClientRect:rect,getAttribute:()=>null,disabled:false,querySelectorAll:()=>[{classList:{contains:name=>name==='i-tripo:close'}}],click:()=>{closes++;if(condition!=='close-not-acknowledged')f.state.open=false;}};
  const originalPanelQuery=f.panel.querySelectorAll.bind(f.panel);f.panel.querySelectorAll=selector=>selector==='button'?[...originalPanelQuery(selector),close]:originalPanelQuery(selector);
  Object.defineProperty(f.panel,'isConnected',{get:()=>f.state.open});
  const exportButton={innerText:'Export',getBoundingClientRect:rect,getAttribute:()=>null,click:()=>exports++};
  const originalDocumentQuery=f.document.querySelectorAll;f.document.querySelectorAll=selector=>selector==='button'?[exportButton]:originalDocumentQuery(selector);
  const taskId='11111111-2222-3333-4444-555555555555';
  const run=vm.runInNewContext('('+exportStudioControl.toString()+')',{document:f.document,location:{origin:'https://studio.tripo3d.ai',pathname:'/ja/workspace/generate/'+taskId},getComputedStyle:f.getComputedStyle,setTimeout:fn=>queueMicrotask(fn)});
  if(condition==='normal'){
   assert.equal((await run({step:'inspect',taskId})).topologyDialogOpen,true);assert.equal(closes,0);
   assert.equal((await run({step:'open',taskId})).stage,'opened');assert.equal(closes,1);assert.equal(exports,1);
  }else{
   const result=await run({step:'open',taskId});assert.equal(result.adapterError,condition==='unrelated-dialog'?'CLOSE_OTHER_DIALOGS_FIRST':'TOPOLOGY_DIALOG_CLOSE_NOT_ACKNOWLEDGED');assert.equal(exports,0);assert.equal(closes,condition==='unrelated-dialog'?0:1);
  }
  assert.deepEqual(f.inputs.map(i=>Number(i.value)),generationLimits('body'));assert(f.inputs.every(i=>i.events.length===0));
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {STUDIO_ROUTE_GROUP,STUDIO_WORKSPACES,parseStudioUrl} from '../extension-tripo-studio/studio-map.js';
import {resumeUrl} from '../extension-tripo-studio/tab-recovery.js';
import {verifiedTaskUrl,studioNavigationControl} from '../extension-tripo-studio/studio-navigation.js';
import {observeGroupStudio} from '../extension-tripo-studio/group-adapter.js';
import {studioTopologyControl,selectStudioModelVersion,observeStudioDocument,selectStudioSmartMesh} from '../extension-tripo-studio/studio-adapter.js';
import {studioWorkGuard} from '../extension-tripo-studio/studio-guard.js';
import {throwAdapterError,asWorker} from './page-call.js';

const origin='https://studio.tripo3d.ai',id='457a0632-325c-4937-8117-0b33d0a64564';
const slug='red-jacket-black-shirt-gray-cargo-pants-worn-by-a-stylized-human-cha-'+id;

test('the map knows the 12 Studio sections, Home and Assets, in any locale',()=>{
 assert.equal(STUDIO_WORKSPACES.length,12);
 assert.deepEqual([...STUDIO_ROUTE_GROUP.split('|')].sort(),[...STUDIO_WORKSPACES].sort());
 for(const workspace of STUDIO_WORKSPACES)for(const locale of ['','es/','ja/']){
  assert.deepEqual(parseStudioUrl(`${origin}/${locale}workspace/${workspace}`),{page:'workspace',locale:locale?locale.slice(0,2):null,workspace,taskId:null,slug:null,clean:true});
  const place=parseStudioUrl(`${origin}/${locale}workspace/${workspace}/${slug}`);
  assert.equal(place.workspace,workspace);assert.equal(place.taskId,id);
 }
 assert.equal(parseStudioUrl(origin+'/').page,'home');
 assert.equal(parseStudioUrl(origin+'/?category=featured').page,'home');
 assert.equal(parseStudioUrl(origin+'/es/assets').page,'assets');
 assert.equal(parseStudioUrl(origin+'/pricing').page,'other');
 assert.equal(parseStudioUrl('https://evil.example/workspace/generate').page,'outside');
 assert.equal(parseStudioUrl(origin+'/workspace/generate/descriptive-slug').taskId,null,'a slug without a UUID is never an identity');
});

test('page functions embed exactly the map route group',()=>{
 for(const fn of [observeGroupStudio,studioNavigationControl])assert(fn.toString().includes(STUDIO_ROUTE_GROUP),fn.name);
 const adapter=fs.readFileSync(new URL('../extension-tripo-studio/studio-adapter.js',import.meta.url),'utf8');
 assert(adapter.includes(STUDIO_ROUTE_GROUP));
});

test('every copy of the informational-hint classifier is identical',()=>{
 const dir=new URL('../extension-tripo-studio/',import.meta.url),copies=new Set();let count=0;
 for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.js'))){
  for(const line of fs.readFileSync(new URL(file,dir),'utf8').split(/\r?\n/))if(line.includes('const studioHint=')){copies.add(line.trim());count++;}
 }
 assert.equal(count,5);assert.equal(copies.size,1);
});

test('the authorized tab may resume in any section, never with query, fragment or foreign origin',()=>{
 for(const workspace of STUDIO_WORKSPACES){
  assert.equal(resumeUrl(`${origin}/es/workspace/${workspace}/${slug}`),`${origin}/es/workspace/${workspace}/${slug}`);
  assert.equal(resumeUrl(`${origin}/workspace/${workspace}`),`${origin}/workspace/${workspace}`);
 }
 for(const bad of [origin+'/',origin+'/assets',`${origin}/workspace/animate/${slug}?t=1`,`${origin}/workspace/animate/${slug}#x`,`https://evil.example/workspace/animate/${slug}`])assert.equal(resumeUrl(bad),null);
 assert.equal(verifiedTaskUrl(`${origin}/workspace/animate/${slug}`,id,'animate'),`${origin}/workspace/animate/${slug}`);
 assert.equal(verifiedTaskUrl(`${origin}/workspace/animate/${slug}`,id,'rigging'),null);
});

// Minimal DOM for page functions: elements with classes, attributes and children.
function el(tag,{cls=[],attrs={},text='',children=[],onclick}={}){
 const node={tagName:tag.toUpperCase(),classList:{contains:c=>cls.includes(c)},children,parentElement:null,_text:text,attrs:{...attrs},
  get innerText(){return [this._text,...this.children.map(c=>c.innerText)].filter(Boolean).join(' ');},
  getAttribute(k){return k==='class'?cls.join(' '):this.attrs[k]??null;},hasAttribute(k){return k in this.attrs;},
  getBoundingClientRect:()=>({width:10,height:10}),click(){this.clicks=(this.clicks||0)+1;onclick?.(this);},
  closest(sel){for(let n=this;n;n=n.parentElement)if(matches(n,sel))return n;return null;},
  querySelectorAll(sel){const out=[];const walk=n=>{for(const c of n.children){if(sel.split(',').some(s=>matches(c,s.trim())))out.push(c);walk(c);}};walk(this);return out;},
  querySelector(sel){return this.querySelectorAll(sel)[0]||null;}};
 for(const c of children)c.parentElement=node;
 return node;
}
function matches(n,sel){
 const cls=sel.match(/^\[class~="([^"]+)"\]$/);if(cls)return n.classList.contains(cls[1]);
 if(sel.startsWith('.'))return n.classList.contains(sel.slice(1));
 const attr=sel.match(/^(\w+)?\[([\w-]+)(?:="([^"]*)")?\]$/);
 if(attr)return (!attr[1]||n.tagName===attr[1].toUpperCase())&&(attr[3]===undefined?n.attrs[attr[2]]!=null:n.attrs[attr[2]]===attr[3]);
 return /^[a-z]+$/.test(sel)&&n.tagName===sel.toUpperCase();
}
const icon=name=>el('div',{cls:['i-tripo:'+name]});
const docOf=(roots)=>{const body=el('body',{children:roots});return {body,documentElement:body,querySelectorAll:s=>body.querySelectorAll(s),querySelector:s=>body.querySelector(s),getElementById:()=>null};};
const run=(fn,args,document,pathname='/es/workspace/generate/'+slug)=>throwAdapterError(vm.runInNewContext(`(${fn})(${JSON.stringify(args)})`,{document,location:{origin,pathname,href:origin+pathname},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),URL,Error,MessageChannel,KeyboardEvent:class{constructor(type,o){Object.assign(this,o,{type});}},PointerEvent:class{constructor(type,o){Object.assign(this,o,{type});}},setTimeout}));

test('Studio hints (viewer help, retry-or-texture tip) do not block and are dismissed only by their X',()=>{
 const tipClose=el('button',{children:[icon('close')]});
 const tip=el('div',{attrs:{role:'dialog','data-state':'open'},children:[el('span',{text:'Reintenta para mejores resultados'}),icon('retry'),icon('texture'),tipClose]});
 const help=el('div',{attrs:{role:'dialog','data-state':'open'},children:[el('div',{cls:['cursor-move'],children:[icon('close')]}),el('div',{cls:['cancel-drag']}),el('button',{text:'OK'})]});
 const doc=docOf([tip,help]);
 const state=run(observeGroupStudio,undefined,doc);
 assert.equal(state.blockingDialog,false);assert.equal(state.studioHints,2);assert.equal(state.page,'workspace');
 const closed=run(studioNavigationControl,{action:'close-hints'},doc);
 assert.equal(closed.hints,2);assert.equal(tipClose.clicks,1);
 assert.equal(help.querySelector('button').clicks,undefined,'OK is never pressed');
 // A dialog with a form or a priced action is never a hint.
 const priced=el('div',{attrs:{role:'dialog','data-state':'open'},children:[icon('close'),icon('retry'),icon('texture'),el('button',{attrs:{'data-price':'10'}})]});
 assert.equal(run(observeGroupStudio,undefined,docOf([priced])).blockingDialog,true);
});

function topologyDom({triangle=false,shared=true}={}){
 const state={triangle,shared};
 const max=()=>state.triangle?'50000':'25000';
 const slider=()=>({...el('div',{attrs:{role:'slider','aria-valuemin':'500',tabindex:'0'}}),getAttribute(k){return {role:'slider','aria-valuemin':'500','aria-valuemax':max(),'aria-valuenow':'5000',tabindex:'0'}[k]??null;}});
 const quad=el('button',{text:'Cuadrilátero',children:[icon('quad')],onclick:()=>{state.triangle=false;}});
 const tri=el('button',{text:'Triángulo',children:[icon('triangle')],onclick:()=>{state.triangle=true;}});
 for(const [b,isQuad] of [[quad,true],[tri,false]])Object.defineProperty(b.attrs,'aria-pressed',{get:()=>String(isQuad!==state.triangle),enumerable:true});
 const sw=el('button',{attrs:{role:'switch','aria-checked':String(shared)}});
 const field=el('input',{attrs:{type:'text'}});field.value='5000';
 const row=el('div',{children:[field,slider()]});
 const panel=el('div',{attrs:{role:'dialog','data-state':'open',id:'p'},children:[el('button',{children:[icon('close')]}),quad,tri,sw,row]});
 return {state,doc:docOf([panel])};
}

test('Triangle (500-50000) is recognized in Spanish and switched back to Quad with one free click',async()=>{
 const {state,doc}=topologyDom({triangle:true});
 const inspect=await run(studioTopologyControl,{step:'inspect'},doc,'/es/workspace/generate');
 assert.equal(inspect.topology,'triangle');assert.equal(inspect.faceLimits,null);
 const fix=await run(studioTopologyControl,{step:'configure',faceLimits:[18000,20000,22500,25000]},doc,'/es/workspace/generate');
 assert.equal(fix.pending,true);assert.equal(state.triangle,false);
 const after=await run(studioTopologyControl,{step:'inspect'},doc,'/es/workspace/generate');
 assert.equal(after.shared,true,'Quad verified; the shared count is the next free step');
});

test('a Topology popover without a recognizable Quad/Triangle choice is never accepted as Quad',async()=>{
 const {doc}=topologyDom();
 const panel=doc.body.children[0];panel.children.splice(1,2);
 await assert.rejects(async()=>run(studioTopologyControl,{step:'configure',faceLimits:[18000,20000,22500,25000]},doc,'/workspace/generate'),/CLOSE_OTHER_DIALOGS_FIRST|STUDIO_TOPOLOGY_CONTROL_NOT_VERIFIED/);
});

test('the AI model select only ever chooses P2.0, also when a background tab left its list half closed',async()=>{
 const scenario=async({mounted})=>{
  const events=[];
  const option=label=>{const o=el('div',{attrs:{role:'option'},text:label});o.focus=()=>events.push('focus:'+label);o.dispatchEvent=e=>{events.push(e.type+':'+label);if(e.key==='Enter')box._text=label;};return o;};
  // A background tab can keep the list mounted with data-state="closed".
  const list=el('div',{attrs:{role:'listbox','data-state':'closed'},children:[option('P2.0'),option('P1.0 - Rápido')]});
  const box=el('button',{attrs:{role:'combobox'},text:'P1.0 - Rápido'});
  let open=mounted;box.focus=()=>events.push('focus:trigger');box.dispatchEvent=e=>{events.push(e.type+':'+(e.key||''));if(e.key==='ArrowDown')open=true;};
  const document={querySelectorAll:s=>s==='[role="combobox"]'?[box]:s==='[role="listbox"]'&&open?[list]:[]};
  const result=await run(selectStudioModelVersion,{},document);
  assert.equal(result.selected,true);assert.equal(box._text,'P2.0');
  return events;
 };
 assert.deepEqual(await scenario({mounted:true}),['focus:P2.0','keydown:P2.0']);
 assert.deepEqual(await scenario({mounted:false}),['focus:trigger','keydown:ArrowDown','focus:P2.0','keydown:P2.0']);
 const box=el('button',{attrs:{role:'combobox'},text:'P1.0'});box.dispatchEvent=()=>{};box.focus=()=>{};
 await assert.rejects(async()=>run(selectStudioModelVersion,{version:'P1.0'},{querySelectorAll:s=>s==='[role="combobox"]'?[box]:[]}),/SMART_MESH_REQUIRED/);
});

test('the glass wall is invisible to adapters and stops only real user input',()=>{
 const listeners={},added=[];
 const shadow={innerHTML:'',querySelector:s=>({textContent:'',classList:{add(){},remove(){}},hidden:false,offsetWidth:1,addEventListener(){},dataset:{}}),querySelectorAll:()=>[]};
 const host={style:{},attachShadow:o=>{assert.equal(o.mode,'closed');return shadow;},isConnected:true};
 const document={documentElement:{lang:'es'},body:{appendChild:n=>added.push(n)},createElement:()=>host,activeElement:null};
 const window={addEventListener:(type,fn,capture)=>{assert.equal(capture,true);listeners[type]=fn;}};
 let expire;const context={document,window,location:{origin},navigator:{language:'es'},chrome:{runtime:{sendMessage(){}}},globalThis:{},Date,setInterval:fn=>{expire=fn;return 1;}};
 context.globalThis=context;
 assert.equal(JSON.stringify(vm.runInNewContext(`(${studioWorkGuard})({state:'working',step:'prepare'})`,context)),'{"guard":"working"}');
 assert.equal(added.length,1);
 let stopped=0;const key=isTrusted=>({isTrusted,target:{},preventDefault(){},stopImmediatePropagation(){stopped++;}});
 listeners.keydown(key(false));assert.equal(stopped,0,'synthetic keys from the extension pass');
 listeners.keydown(key(true));assert.equal(stopped,1,'real keys are stopped while working');
 vm.runInNewContext(`(${studioWorkGuard})({state:'paused'})`,context);
 listeners.keydown(key(true));assert.equal(stopped,1,'paused: the user has control again');
 vm.runInNewContext(`(${studioWorkGuard})({state:'working'})`,context);
 context.globalThis.__fitaWorkGuardV1.seenAt-=61000;expire();
 listeners.keydown(key(true));assert.equal(stopped,1,'a wall the worker stopped renewing releases Tripo by itself');
});

test('with P1.0 the lightning icon on the model select is not mistaken for the Smart Mesh switch',async()=>{
 const rect=()=>({width:100,height:20});let clicks=0;
 const button=(label,{classes=[],icons=[],role=null}={})=>({innerText:label,disabled:false,getBoundingClientRect:rect,getAttribute:k=>k==='role'?role:null,classList:{contains:n=>classes.includes(n)},querySelectorAll:sel=>sel==='[class]'?icons.map(i=>({classList:{contains:n=>n===i}})):[],click:()=>clicks++});
 const smart=button('Smart Mesh',{classes:['c-black'],icons:['i-tripo:speed-bolt']}),hd=button('HD Model');
 // Observed 2026-10-21: "P1.0 - Fast" carries i-tripo:speed-bolt and there is no 1/2/4 group.
 const select=button('P1.0 - Fast',{icons:['i-tripo:speed-bolt'],role:'combobox'}),generate=button('Generate 35',{classes:['animate-button']});
 const buttons=[hd,smart,select,generate];
 const ctx={location:{origin,pathname:'/workspace/generate',href:origin+'/workspace/generate'},document:{querySelectorAll:s=>s==='button'?buttons:s==='[role="combobox"]'?[select]:[]},crypto:globalThis.crypto,TextEncoder,URL,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};
 const state=await vm.runInNewContext('('+observeStudioDocument+')()',ctx);
 assert.equal(state.generationMode,'smart-mesh');assert.equal(state.modelLabel,'P1.0 - Fast');assert.equal(state.generationCount,null);
 assert.equal(JSON.stringify(vm.runInNewContext('('+selectStudioSmartMesh+')()',ctx)),'{"selected":true}');assert.equal(clicks,0,'already selected: no click');
});

test('every page function keeps its error code: a throw inside executeScript would arrive empty',async()=>{
 const modules={'studio-adapter.js':await import('../extension-tripo-studio/studio-adapter.js'),'group-adapter.js':await import('../extension-tripo-studio/group-adapter.js'),'mesh-import.js':await import('../extension-tripo-studio/mesh-import.js'),'rig-adapter.js':await import('../extension-tripo-studio/rig-adapter.js'),'smart-uv-save.js':await import('../extension-tripo-studio/smart-uv-save.js'),'uv-candidates.js':await import('../extension-tripo-studio/uv-candidates.js')};
 const worker=new Set(['optimizeUvCandidates','createMeshImporter','STUDIO_WORKER_REVISION']);
 for(const [file,mod] of Object.entries(modules))for(const [name,value] of Object.entries(mod)){
  if(typeof value!=='function'||worker.has(name))continue;
  assert(value.toString().includes('fita-guarded'),file+' '+name+' must return {adapterError} instead of throwing');
 }
 const {selectStudioTextureSettings}=modules['studio-adapter.js'];
 const result=vm.runInNewContext(`(${selectStudioTextureSettings})({resolution:'2K',removeLighting:false})`,{location:{origin,pathname:'/workspace/texture/'+slug},document:{querySelectorAll:()=>[]},getComputedStyle:()=>({visibility:'visible'})});
 assert.equal(JSON.stringify(result),'{"pending":true}','the Texture panel not mounted yet is "not yet", not a failure');
 assert.equal(vm.runInNewContext(`(${selectStudioTextureSettings})({resolution:'2K',removeLighting:false})`,{location:{origin,pathname:'/workspace/generate'},document:{querySelectorAll:()=>[]},getComputedStyle:()=>({})}).adapterError,'TEXTURE_WORKSPACE_REQUIRED');
});

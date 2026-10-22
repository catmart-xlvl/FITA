import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {exportStudioControl} from '../extension-tripo-studio/studio-adapter.js';

const taskId='11111111-2222-4333-8444-555555555555';
function fixture({icon=false,trigger=false,unknown=false,duplicate=false,throttled=false}={}){
 let opened=true,time=0,timers=0,closes=0,exports=0,escapes=0;
 const node=text=>({innerText:text,isConnected:true,getBoundingClientRect:()=>({width:80,height:20}),getAttribute:()=>null,disabled:false,querySelectorAll:()=>[],focus(){}});
 const glyph=name=>({classList:{contains:expected=>name===expected}});
 const close={...node(''),querySelectorAll:()=>icon?[glyph('i-tripo:close')]:[],click(){closes++;opened=false;}};
 const download={...node('Export'),click(){exports++;}};
 const dialog={...node('Export File Name Format GLB Export'),id:'verified-export',get isConnected(){return opened;},getAttribute:key=>key==='aria-labelledby'?'heading':null,querySelectorAll:selector=>selector==='[role="combobox"]'?[node('GLB')]:selector==='button'?[close,download,...(duplicate?[close]:[])]:[],dispatchEvent(){escapes++;}};
 const toggle={...node(''),getAttribute:key=>({'aria-controls':'verified-export','aria-haspopup':'dialog','aria-expanded':'true'})[key]||null,querySelectorAll:()=>[glyph('i-tripo:download')],click(){closes++;opened=false;}};
 const other={...node('Confirm payment')};
 const document={getElementById:()=>node('Export'),querySelectorAll:selector=>selector==='[role="dialog"]'?[dialog,...(unknown?[other]:[])]:selector==='[aria-controls]'&&trigger?[toggle]:[]};
 class Clock extends Date{static now(){return time;}}
 const run=vm.runInNewContext('('+exportStudioControl.toString()+')',{document,location:{origin:'https://studio.tripo3d.ai',pathname:'/workspace/texture/'+taskId},Date:Clock,getComputedStyle:()=>({display:'block',visibility:'visible'}),KeyboardEvent:class{},setTimeout:fn=>{time+=throttled?60000:100;timers++;queueMicrotask(fn);}});
 return {run:()=>run({step:'close',taskId}),state:()=>({closes,exports,escapes,timers})};
}

test('Export closes through its scoped icon or exact linked trigger without using Export or an unrelated button',async()=>{
 for(const options of [{icon:true},{trigger:true}]){
  const f=fixture(options);assert.equal((await f.run()).stage,'closed');assert.deepEqual(f.state(),{closes:1,exports:0,escapes:0,timers:0});
 }
 for(const options of [{icon:true,unknown:true},{icon:true,duplicate:true}]){
  const f=fixture(options);assert((await f.run()).adapterError);assert.equal(f.state().closes,0);assert.equal(f.state().exports,0);
 }
});

test('background-tab timer throttling ends Export readiness at the wall-clock deadline instead of fifty delayed ticks',async()=>{
 const f=fixture({throttled:true});assert.equal((await f.run()).adapterError,'EXPORT_DIALOG_CLOSE_NOT_ACKNOWLEDGED');
 assert.deepEqual(f.state(),{closes:0,exports:0,escapes:1,timers:1});
});

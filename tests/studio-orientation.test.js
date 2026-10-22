import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {controlImportOrientation} from '../extension-tripo-studio/group-adapter.js';
import {throwAdapterError,asWorker} from './page-call.js';
function page({title='Encuentra el mejor ángulo',button='Confirmar',duplicate=false,disabled=false,priced=false,pricedSelf=false,otherDialog=false,busy=false,nestedTitle=false}={}){
 let clicks=0,time=10000;
 const node=text=>({innerText:text,children:[],getBoundingClientRect:()=>({width:50,height:20}),contains:()=>false});
 const heading=node(title),body=node(''),scope=node(title+' '+button),confirm={...node(button),disabled,getAttribute:()=>null,matches:()=>pricedSelf,querySelector:()=>priced?{}:null,click:()=>clicks++};
 heading.parentElement=scope;heading.querySelectorAll=()=>[];scope.parentElement=body;scope.querySelectorAll=s=>s==='button,[role="button"]'?(duplicate?[confirm,confirm]:[confirm]):busy?[node('loading')]:[];
 let headings=[heading];
 if(nestedTitle){const parent=node(title);parent.children=[heading];headings.push(parent);}
 const document={body,querySelectorAll:s=>s==='[role="dialog"]'?(otherDialog?[node('otro')]:[]):headings};
 const ctx=vm.createContext({document,location:{origin:'https://studio.tripo3d.ai'},getComputedStyle:()=>({display:'block',visibility:'visible'}),Date:{now:()=>time}});
 const run=args=>{ctx.args=args;return throwAdapterError(vm.runInContext('('+controlImportOrientation.toString()+')(args)',ctx));};
 return {run,clicks:()=>clicks,advance:ms=>time+=ms};
}
test('orientation confirmation requires its exact title and unpriced unique button',()=>{
 const p=page();assert.equal(p.run({}).enabled,true);assert.equal(p.clicks(),0);assert.equal(p.run({confirm:true}).confirmed,true);assert.equal(p.clicks(),1);
 for(const options of [{title:'Exportar'},{button:'Confirmar 20'},{duplicate:true},{priced:true},{pricedSelf:true},{otherDialog:true},{disabled:true},{busy:true}]){
  const f=page(options);try{f.run({confirm:true});}catch(e){assert.match(e.message,/SEG_IMPORT_/);}assert.equal(f.clicks(),0);
 }
});
test('localized angle headings with suffixes, punctuation and nested labels are recognized',()=>{
 for(const title of ['Encuentra el mejor ángulo para tu modelo','Find your best angle!','Find the best angle for your model:']){
  const p=page({title,nestedTitle:true});assert.equal(p.run({confirm:true}).confirmed,true);assert.equal(p.clicks(),1);
 }
});
test('the isolated DOM marker debounces a lost reply and limits free confirmation retries',()=>{
 const p=page(),panelId=p.run({}).panelId;
 assert.equal(p.run({confirm:true,panelId}).confirmClicks,1);
 assert.equal(p.run({confirm:true,panelId}).confirmed,false);assert.equal(p.clicks(),1);
 for(let i=0;i<2;i++){p.advance(3000);assert.equal(p.run({confirm:true,panelId}).confirmed,true);}
 p.advance(3000);assert.equal(p.run({confirm:true,panelId}).confirmed,false);assert.equal(p.clicks(),3);
 assert.throws(()=>p.run({confirm:true,panelId:'different'}),/ORIENTATION_CHANGED/);
});

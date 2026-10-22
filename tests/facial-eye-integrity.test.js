import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectBlinkEyeIntegrity} from '../server/facial-eye-integrity.js';

function fixture({standard=true,small=false,parent=false}={}){
  const values=[],doc={scene:0,scenes:[{nodes:[0,1,2]}],nodes:[],meshes:[]};
  const names=standard?['WB_Iris_L export','WB_Pupil_L export','WB_Glint_L_1 export']:['Colour disc','Dark disc','White detail'];
  const add=rows=>(values.push(rows),values.length-1),size=small?.001:.01;
  for(let i=0;i<3;i++){
    doc.nodes.push({name:names[i],mesh:i});
    doc.meshes.push({primitives:[{attributes:{_WORKBENCH_VERTEX:add([[0],[1],[2],[3]]),POSITION:add([[-size,-size,i*.0002],[size,-size,i*.0002],[size,size,i*.0002],[-size,size,i*.0002]]),NORMAL:add(Array.from({length:4},()=>[0,0,1]))}}]});
  }
  if(parent){doc.nodes.push({name:'Eye parent',children:[0,1,2],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[2,.5,1]});doc.scenes[0].nodes=[3];}
  const source={doc,read:i=>values[i]},parts=names.map((mesh,i)=>({mesh,role:['iris','pupil','glint'][i],eye:'left'})),bindings={expressions:{blink:[],blinkLeft:[],blinkRight:[]}},deltas=new Map();
  function motion(expression,fn,key='close'){
    for(let i=0;i<names.length;i++){
      bindings.expressions[expression].push({mesh:names[i],shape:key,weight:1});deltas.set(JSON.stringify([names[i],key]),new Map([0,1,2,3].map(id=>[id,fn(i,id)])));
    }
  }
  return {source,bindings,deltas,parts,motion};
}
const check=f=>inspectBlinkEyeIntegrity(f.source,f.bindings,f.deltas,f.parts);

test('blink leaves ocular geometry still, or retreats every layer together without changing its size',()=>{
  const f=fixture();assert.equal(check(f).checked,true);f.motion('blink',()=>[0,0,-.0003]);f.motion('blinkLeft',()=>[0,0,-.0003]);
  const r=check(f);assert.equal(r.parts,3);assert.equal(r.checks.length,4);assert(r.checks.every(c=>Math.abs(c.translationMetres[2])<=.0003));
});
test('blink rejects flattening, scaling, rotation and one displaced ocular vertex at intermediate poses too',()=>{
  for(const fn of [(i,id)=>[0,id*.0002,0],(i,id)=>[id*.0001,0,0],(i,id)=>[0,0,id===3?-.0003:0]]){
    const f=fixture();f.motion('blink',fn);assert.throws(()=>check(f),/must not shrink or deform/);
  }
});
test('pupil/glints cannot retreat independently, excessively, forward or sideways',()=>{
  const apart=fixture();apart.motion('blink',i=>[0,0,i===0?0:-.0003]);assert.throws(()=>check(apart),/move iris, pupil and glints together/);
  for(const delta of [[0,0,-.0012],[0,0,.0003],[.0003,0,0]]){
    const f=fixture();f.motion('blink',()=>delta);assert.throws(()=>check(f),/retreat exceeds|must be inward/);
  }
  const small=fixture({small:true});small.motion('blink',()=>[0,0,-.0003]);assert.throws(()=>check(small),/retreat exceeds/);
});
test('simultaneous bilateral and unilateral blink keys cannot double the eye retreat',()=>{
  const f=fixture();f.motion('blink',()=>[0,0,-.0006],'both');f.motion('blinkLeft',()=>[0,0,-.0006],'left');assert.throws(()=>check(f),/retreat exceeds/);
});
test('world-space validation respects parent rotation, scale and semantic inventory for custom mesh names',()=>{
  const f=fixture({standard:false,parent:true});f.motion('blink',()=>[0,0,-.0003]);assert.equal(check(f).checked,true);
  f.parts[0].eye=undefined;assert.throws(()=>check(f),/ocular role\/eye required/);
});
test('standard FITA iris meshes cannot bypass validation by omitting or mislabelling inventory',()=>{
  const f=fixture();f.parts=[];f.motion('blink',(i,id)=>[0,id*.0002,0]);assert.throws(()=>check(f),/must not shrink or deform/);
  f.parts=[{mesh:'WB_Iris_L export',role:'pupil',eye:'right'}];assert.throws(()=>check(f),/ocular role\/eye required/);
});

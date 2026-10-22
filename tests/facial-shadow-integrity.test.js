import test from 'node:test';import assert from 'node:assert/strict';
import {inspectEyeShadowBindings} from '../server/facial-shadow-integrity.js';
function fixture(){
 const doc={nodes:[{name:'eye_shadows',mesh:0}],meshes:[{extras:{targetNames:['Blink_L','Blink_R']},primitives:[{targets:[{POSITION:0,NORMAL:1},{POSITION:2,NORMAL:3}]}]}]};
 const L={mesh:'eye_shadows',shape:'Blink_L',weight:1},R={mesh:'eye_shadows',shape:'Blink_R',weight:1},bindings={expressions:{blink:[L,R],blinkLeft:[L],blinkRight:[R]}};
 const deltas=new Map([[JSON.stringify([L.mesh,L.shape]),new Map([[0,[0,0,-.01]]])],[JSON.stringify([R.mesh,R.shape]),new Map([[1,[0,0,-.01]]])]]),parts=[{mesh:'eye_shadows',role:'eyeshadow',eye:'both',decision:'Follows its corresponding upper lid; neutral geometry and alpha retained.'}];
 return {doc,bindings,deltas,parts};
}
test('bilateral manual eye shadows require their own bilateral/unilateral blink bindings and normal morphs',()=>{
 const f=fixture(),check=()=>inspectEyeShadowBindings({doc:f.doc},{doc:f.doc},f.bindings,f.deltas,f.parts);assert.deepEqual(check().meshes,['eye_shadows']);
 f.bindings.expressions.blinkLeft=[];assert.throws(check,/must follow blinkLeft/);f.bindings.expressions.blinkLeft=f.bindings.expressions.blink.slice(0,1);f.parts=[];assert.throws(check,/inventory eye shadow/);
});
test('a fixed shadow or missing normal target cannot pass; characters without eye shadows keep their existing contract',()=>{
 const f=fixture(),check=()=>inspectEyeShadowBindings({doc:f.doc},{doc:f.doc},f.bindings,f.deltas,f.parts);f.doc.meshes[0].primitives[0].targets[1]={POSITION:2};assert.throws(check,/NORMAL target/);f.doc.meshes[0].primitives[0].targets[1].NORMAL=3;f.deltas.get('["eye_shadows","Blink_L"]').set(0,[0,0,0]);assert.throws(check,/must follow/);
 assert.equal(inspectEyeShadowBindings({doc:{nodes:[],meshes:[]}},null,{expressions:{}},new Map()).checked,false);
});

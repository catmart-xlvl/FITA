import test from 'node:test';
import assert from 'node:assert/strict';
import {promptFor,instructionsFor,conceptFiles,extraReferenceName,extraReferenceLimit} from '../server/codex-handoff.js';

const project=extra=>({id:'p',name:'Demo',notes:'',reference:{id:'main.png'},referenceRevision:1,notesRevision:0,extraReferences:extra,groups:{head:{views:{}},body:{views:{}}}});

test('extra concept images are optional and only mentioned when present',()=>{
  assert.ok(!promptFor(project([])).includes('REFERENCIAS ADICIONALES'));
  assert.ok(!instructionsFor(project(undefined)).includes('concept_extra_1.png'));
  const p=project([{id:'a.png'},{id:'b.png'}]),prompt=promptFor(p);
  assert.ok(prompt.indexOf('REFERENCIAS ADICIONALES')<prompt.indexOf('REGLAS FIJAS'));
  assert.ok(prompt.includes('concept_extra_1.png, concept_extra_2.png'));
  assert.ok(prompt.includes('manda concept.png'));
  assert.ok(instructionsFor(p).includes('concept_extra_2.png'));
});

test('the package carries the main concept plus at most four extras',async()=>{
  const extras=Array.from({length:6},(_,i)=>({id:`e${i}.png`}));
  const store={read:async(_,asset)=>Buffer.from(asset.id)};
  const files=await conceptFiles(store,project(extras));
  assert.equal(String(files['concept.png']),'main.png');
  assert.equal(Object.keys(files).length,1+extraReferenceLimit);
  assert.equal(String(files[extraReferenceName(0)]),'e0.png');
  assert.ok(!(extraReferenceName(4) in files));
});

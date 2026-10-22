import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {studioMessages,studioText} from '../src/studio-locales.js';

test('Studio UI has matching local language catalogs and explicit generation limitation',async()=>{
  const keys=Object.keys(studioMessages.en);
  for(const lang of ['es','ja']){
    assert.deepEqual(Object.keys(studioMessages[lang]),keys);
    for(const key of keys)assert.ok(studioText(lang,key).length);
  }
  const source=await fs.readFile(new URL('../src/StudioConnection.jsx',import.meta.url),'utf8');
  for(const match of source.matchAll(/\bt\('([^']+)'\)/g))assert.ok(keys.includes(match[1]),match[1]);
  assert.match(source,/Paid generation and the complete upload-to-download flow have not been tested/);
  assert.doesNotMatch(source,/request\([^\n]*(?:\/generate|\/quote|\/submit)/);
});

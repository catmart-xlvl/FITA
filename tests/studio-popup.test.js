import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {messages,translateError} from '../extension-tripo-studio/popup-i18n.js';
import {STUDIO_WORKER_REVISION} from '../extension-tripo-studio/studio-adapter.js';

test('new popup identifies stale worker and does not claim a checked consent was registered',async()=>{
  const elements=new Map(),calls=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,events:{},addEventListener(k,fn){this.events[k]=fn;},setAttribute(){},replaceChildren(){},append(){},select(){}});return elements.get(id);};
  const document={documentElement:{},getElementById:element,querySelectorAll:()=>[],createElement:()=>({})};
  const chrome={storage:{local:{get:async()=>({language:'en'}),set:async()=>{}}},runtime:{sendMessage:async message=>{
    calls.push(message);return {ok:true,extensionId:'a'.repeat(32),tabs:[{id:12,title:'Studio'}],bridge:{paired:true,readable:true}};
  }}};
  const source=(await fs.readFile('extension-tripo-studio/popup.js','utf8')).replace(/^import[^\n]+\n/gm,'');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('document','chrome','messages','translateError','STUDIO_WORKER_REVISION',source)(document,chrome,messages,translateError,STUDIO_WORKER_REVISION);
  await new Promise(setImmediate);
  assert.equal(element('status').textContent,messages.en.reloadWorker);
  element('automation').checked=true;element('tabs').value='12';element('connect').events.click();
  await new Promise(setImmediate);
  assert.equal(calls.some(value=>value.type==='connect'),false);
  assert.equal(element('status').textContent,messages.en.reloadWorker);
  assert.match(messages.en.reloadWorker,/may clear pairing/);
});

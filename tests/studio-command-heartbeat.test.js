import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandHeartbeat} from '../extension-tripo-studio/connection-loop.js';

test('long-command heartbeat reads fresh state, is bounded and single-flight, and never dispatches work',async()=>{
 let time=0,generation=1,reads=0,sends=0,release;
 const bridge={token:'test-session',tabId:12,automationAuthorized:true};
 const held=new Promise(resolve=>release=resolve);
 const pulse=createCommandHeartbeat({session:async()=>({...bridge}),epoch:()=>generation,now:()=>time,inspect:async id=>{assert.equal(id,12);reads++;if(reads===1)await held;return {tab:{id},inspection:{readyState:'complete'}};},send:async(snapshot,token)=>{assert.equal(token,bridge.token);assert.equal(snapshot.inspection.readyState,'complete');assert.equal(snapshot.automationAuthorized,true);sends++;}});
 const first=pulse();await Promise.resolve();await Promise.resolve();time=30000;
 assert.equal(await pulse(),false,'one observation at a time even after the interval');release();assert.equal(await first,true);
 assert.equal(await pulse(),true);assert.equal(sends,2);
 time+=19999;assert.equal(await pulse(),false);time++;assert.equal(await pulse(),true);assert.equal(reads,3);
});

test('long-command heartbeat cannot send after disconnect, tab replacement, permission change or epoch change',async()=>{
 for(const change of ['disconnect','token','tab','permission','epoch']){
  let bridge={token:'test-session',tabId:12,automationAuthorized:true},generation=1;
  const pulse=createCommandHeartbeat({session:async()=>bridge&&({...bridge}),epoch:()=>generation,inspect:async()=>{if(change==='disconnect')bridge=null;else if(change==='token')bridge.token='replacement';else if(change==='tab')bridge.tabId=13;else if(change==='permission')bridge.automationAuthorized=false;else generation++;return {};},send:async()=>assert.fail('No heartbeat after revocation/replacement')});
  assert.equal(await pulse(),false,change);
 }
});

test('failed long-command observation does not cancel, replay, or claim a healthy document',async()=>{
 let time=0,reads=0;
 const pulse=createCommandHeartbeat({session:async()=>({token:'test',tabId:12}),epoch:()=>1,now:()=>time,inspect:async()=>{reads++;throw Error('tab loading');},send:async()=>assert.fail('Never manufacture a successful/suspended observation')});
 assert.equal(await pulse(),false);assert.equal(await pulse(),false);assert.equal(reads,1);time=20000;assert.equal(await pulse(),false);assert.equal(reads,2);
});

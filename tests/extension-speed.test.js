import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnectionLoop} from '../extension-tripo-studio/connection-loop.js';

function harness(run,connected=async()=>true){
  const timers=new Map();let id=0;
  const loop=createConnectionLoop({run,connected,schedule:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},cancel:key=>timers.delete(key)});
  async function tick(){const [key,value]=timers.entries().next().value;timers.delete(key);await value.fn();}
  return {loop,timers,tick};
}
test('connected bridge dispatches again after one second, not the fallback alarm period',async()=>{
  let calls=0;const h=harness(async()=>{calls++;});h.loop.start();await h.tick();
  assert.equal(calls,1);assert.equal([...h.timers.values()][0].delay,1000);
  await h.tick();assert.equal(calls,2);h.loop.stop();assert.equal(h.timers.size,0);
});
test('disconnect during an in-flight operation cannot resurrect its timer',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>resolve=r));h.loop.start();
  const running=h.tick();await new Promise(setImmediate);h.loop.stop();resolve();await running;
  assert.equal(h.timers.size,0);
});
test('offline bridge backs off and missing session stops without executing commands',async()=>{
  const h=harness(async()=>{throw Error('offline');});h.loop.start();await h.tick();
  assert.equal([...h.timers.values()][0].delay,10000);
  let called=false;const absent=harness(async()=>{called=true;},async()=>false);absent.loop.start();await absent.tick();
  assert.equal(called,false);assert.equal(absent.timers.size,0);
});

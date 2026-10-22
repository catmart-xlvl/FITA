import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalRequest} from '../src/local-request.js';
test('stale local session refreshes once after a pre-execution rejection and preserves the POST body',async()=>{
 const calls=[],api=createLocalRequest(async(url,options)=>{calls.push({url,options:structuredClone(options)});return url==='/api/session'?Response.json({token:'new'}):options.headers['x-workbench-token']==='new'?Response.json({ok:true}):Response.json({error:'Sesión local inválida. Recarga la página.'},{status:403});});
 api.setToken('old');const input={method:'POST',body:{confirm:true}};assert.equal((await api.request('/approve',input)).ok,true);assert.equal(calls.length,3);assert.equal(calls[0].options.body,calls[2].options.body);assert.deepEqual(input.body,{confirm:true});
});
test('uncertain paid responses, network failures and unrelated forbidden requests are never replayed',async()=>{
 for(const kind of ['network','unknown','forbidden']){let calls=0;const api=createLocalRequest(async()=>{calls++;if(kind==='network')throw Error('lost reply');return Response.json({error:'different'},{status:kind==='unknown'?500:403});});await assert.rejects(()=>api.request('/submit',{method:'POST',body:{}}));assert.equal(calls,1);}
});

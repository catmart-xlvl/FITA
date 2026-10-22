import test from 'node:test';
import assert from 'node:assert/strict';
import {uvRecoveryDiagnostic} from '../extension-tripo-studio/uv-recovery-diagnostic.js';
test('UV diagnostic preserves pending retry evidence only for the current asset and never exports credentials',()=>{
 const taskId='11111111-2222-3333-4444-555555555555',operationId='22222222-2222-3333-4444-555555555555';
 const receipt={step:'smartUV',taskId,status:'running',clicked:true,credits:20,token:'SECRET',uvSelection:{version:1,retries:1,samples:[{key:'a',occupancy:68.1,secret:'SECRET'}],pendingRetry:{at:1000,remaining:2,keys:['a','b'],secret:'SECRET'}}};
 const saved={bridge:{token:'SECRET'},['workbenchGroupOperation:'+operationId]:receipt,['workbenchGroupOperation:33333333-2222-3333-4444-555555555555']:{...receipt,taskId:'44444444-2222-3333-4444-555555555555'}};
 const original=structuredClone(saved),result=uvRecoveryDiagnostic(saved,taskId);
 assert.equal(result.length,1);assert.equal(result[0].operationId,operationId);assert.deepEqual(result[0].uvSelection.pendingRetry,{at:1000,remaining:2,keys:['a','b']});
 assert.equal(JSON.stringify(result).includes('SECRET'),false);assert.deepEqual(saved,original);
 assert.deepEqual(uvRecoveryDiagnostic(saved,null),[]);
});

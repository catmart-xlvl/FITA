import test from 'node:test';import assert from 'node:assert/strict';
import {analysisGate} from '../src/analysis-wait.js';import {analysisZipBlob} from '../src/analysis-download.js';
test('download success requires ZIP bytes; rejection never becomes a successful download',async()=>{
 const zip=new Uint8Array(22);zip.set([80,75,3,4]);assert.equal((await analysisZipBlob('/local',{request:async()=>new Response(zip)})).size,22);
 for(const response of [new Response('failed',{status:500}),new Response('<html>not ZIP</html>')])await assert.rejects(analysisZipBlob('/local',{request:async()=>response}),/could not be downloaded/);
 await assert.rejects(analysisZipBlob('/local',{request:async()=>{throw Error('offline');}}),/offline/);
});
test('download alone never unlocks groups; cancellation is local and late current valid results unlock safely',()=>{
 const receipt={deliveryId:'current',cancelled:false},data={delivery:{id:'current',status:'waiting'},current:null};
 assert.deepEqual(analysisGate(data,receipt),{awaiting:true,showWaiting:true,groupsLocked:true});
 assert.deepEqual(analysisGate(data,{...receipt,cancelled:true}),{awaiting:false,showWaiting:false,groupsLocked:true});
 assert.equal(analysisGate(data,receipt,'rejected').showWaiting,false);assert.equal(analysisGate(data,receipt,'rejected').groupsLocked,true);
 assert.equal(analysisGate({...data,current:{id:'old-valid',groups:[]}},receipt).groupsLocked,true);
 assert.equal(analysisGate({...data,current:{id:'old-valid',groups:[]}},{...receipt,cancelled:true}).groupsLocked,false);
 assert.equal(analysisGate({delivery:{id:'current',status:'imported'},current:{id:'late-validated',groups:[]}},receipt).groupsLocked,false);
 assert.equal(analysisGate({delivery:{id:'current',status:'stale'},current:null},receipt).groupsLocked,true);
 assert.equal(analysisGate(data,{deliveryId:'another-project'}).showWaiting,false);
});

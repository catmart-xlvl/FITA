import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {preparationBlocker} from '../src/studio-readiness.js';
import {workflowMessages} from '../src/studio-workflow-locales.js';

const ready={project:{viewSetReady:true,demo:false},uploadConsent:true,status:{paired:true,connected:true,controlAvailable:true,adapterVersion:2,automationAuthorized:true,adapter:{supported:true},preparationAvailable:true,pending:null}};

test('navigation can prepare from Image or Rig without claiming a ready paid form',()=>{
 const status={...ready.status,adapter:{supported:false,generationNavigationVersion:1},preparationAvailable:true,generationAvailable:false};
 assert.equal(preparationBlocker({...ready,status}),null);
 assert.equal(preparationBlocker({...ready,status:{...status,automationAuthorized:false}}),'PREPARE_PERMISSION');
 assert.equal(preparationBlocker({...ready,status:{...status,preparationAvailable:false}}),'PREPARE_CAPABILITY');
});
test('connected read-only session reports missing adapter, not missing cost or pairing',()=>{
  const live={...ready,status:{...ready.status,adapterVersion:null,adapter:null,automationAuthorized:false,preparationAvailable:false}};
  assert.equal(preparationBlocker(live),'PREPARE_ADAPTER');
  assert.equal(preparationBlocker({...live,status:{...ready.status,automationAuthorized:false,preparationAvailable:false}}),'PREPARE_PERMISSION');
  assert.equal(preparationBlocker({...ready,status:{...ready.status,adapter:{supported:false},preparationAvailable:false}}),'PREPARE_WORKSPACE');
});
test('upload readiness never requires a quote or a cost consent; each other gate has a distinct reason',()=>{
  assert.equal(preparationBlocker(ready),null);
  for(const [change,reason] of [
    [{uploadConsent:false},'PREPARE_CONSENT'],[{busy:true},'PREPARE_BUSY'],
    [{project:{viewSetReady:false}},'PREPARE_REVIEW'],[{connectionError:true},'PREPARE_STATUS_ERROR'],
    [{status:null},'PREPARE_CHECKING'],[{status:{...ready.status,paired:false}},'PREPARE_PAIR'],
    [{status:{...ready.status,connected:false}},'PREPARE_HEARTBEAT'],
    [{status:{...ready.status,controlAvailable:false}},'PREPARE_TAB'],
    [{status:{...ready.status,pending:{type:'prepare'}}},'PREPARE_BUSY'],
    [{status:{...ready.status,preparationAvailable:false}},'PREPARE_CAPABILITY'],
  ]) {assert.equal(preparationBlocker({...ready,...change}),reason);for(const language of ['en','es','ja'])assert(workflowMessages[language][reason]);}
});
test('3D UI removes manual GLB import while retaining generated result workflow',async()=>{
  const source=await fs.readFile('src/main.jsx','utf8');
  assert.doesNotMatch(source,/accept="\.glb"|t\("Import GLB"\)|Import your own GLB/);
  assert.match(source,/<StudioWorkflow/);
  assert.match(await fs.readFile('server/studio-workflow.js','utf8'),/glbBuffer\(source\)/);
});

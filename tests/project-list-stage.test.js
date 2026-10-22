import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {emptyProject} from '../server/storage.js';

// DIS-002 v03: the lobby cards are themed by stage, so the list carries workflowStage (read-only summary).
test('the project list reports each project workflow stage',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'project-list-stage-'));
  const {app,store}=await createApp({dataDir:root});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`,token=(await(await fetch(base+'/api/session')).json()).token;
  const concept=emptyProject('Concept only');await store.save(concept);
  const exported=emptyProject('Exported');exported.vrchatExports=[{id:'x'}];await store.save(exported);
  const list=await(await fetch(base+'/api/projects',{headers:{'x-workbench-token':token}})).json();
  const stage=name=>list.find(p=>p.name===name).workflowStage;
  assert.equal(stage('Concept only'),0);
  assert.equal(stage('Exported'),6);
});

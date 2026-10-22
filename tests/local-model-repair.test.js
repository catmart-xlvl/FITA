import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {emptyProject} from '../server/storage.js';
import {snapshot} from '../server/lineage.js';
import {selectedSource,textureCurrent} from '../server/texture-workflow.js';
import {segmentationSource,segmentIdentity,currentSegmentation} from '../server/segmentation-identity.js';
import {fingerprintViewSet} from '../server/view-set.js';
import {placementCurrent} from '../server/placement.js';
import {riggingSource} from '../server/rigging.js';

test('local repair becomes the current original, archives its parent and invalidates downstream sources until rebuilt',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'local-model-repair-'));
  const {app,store}=await createApp({dataDir:root});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`,token=(await(await fetch(base+'/api/session')).json()).token;
  let p=emptyProject('Local repair fixture');const bytes=await fs.readFile('fixtures/mannequin.glb');
  p.reference={id:'reference.png'};p.referenceState={status:'ready',referenceId:p.reference.id};
  for(const part of ['head','body']){
    const m={...await store.asset(p,bytes,'glb','importado'),group:part,lineage:snapshot(p)};
    p.models.push(m);p.groups[part].selectedModelId=m.id;
  }
  await store.save(p);
  const beforeHead=p.groups.head.selectedModelId,beforeBody=p.groups.body.selectedModelId;
  const identity=segmentIdentity(p);
  p.segmentations=[{id:'old-analysis',identity,groups:[]}];
  p.textures=['head','body'].map(group=>({id:group+'-texture',group,sourceModelId:selectedSource(p,group).id,fingerprint:fingerprintViewSet(p,group)}));
  const placement={id:'old-placement',status:'succeeded',sources:{head:'head-texture',body:'body-texture'},preview:{id:'preview'},blend:{id:'blend'}};
  p.placements=[placement];
  assert.equal(placementCurrent(p,placement),true);assert.equal(riggingSource(p)?.id,placement.id);
  async function upload(part,parent){
    const f=new FormData();f.set('kind','model');f.set('part',part);f.set('parentModelId',parent);f.set('file',new Blob([bytes]),'repaired.glb');
    const r=await fetch(base+`/api/projects/${p.id}/upload`,{method:'POST',headers:{'x-workbench-token':token},body:f});return {status:r.status,body:await r.json()};
  }
  const wrong=await upload('head',beforeBody);assert.equal(wrong.status,409);assert.equal(p.models.length,2);
  const result=await upload('head',beforeHead);assert.equal(result.status,200,JSON.stringify(result.body));
  p=store.get(p.id);
  const newHead=result.body.models.at(-1);assert.equal(newHead.group,'head');assert.equal(newHead.parentModelId,beforeHead);assert.equal(newHead.current,true);
  assert.equal(p.models.length,3);assert.equal(p.groups.head.selectedModelId,newHead.id);assert.equal(p.groups.body.selectedModelId,beforeBody);
  assert.deepEqual(await store.read(p,p.models[0]),bytes);
  assert.deepEqual(await fs.readFile(path.join(root,p.id,'antiguos',beforeHead)),bytes);
  assert.equal(p.models[0].supersededByModelId,newHead.id);
  assert.equal(p.groups.head.modelSelectionHistory.at(-1).modelId,beforeHead);
  assert.equal(selectedSource(p,'head').id,newHead.id);assert.equal(segmentationSource(p,'head').id,newHead.id);
  assert.equal(currentSegmentation(p),undefined);assert.equal(textureCurrent(p,p.textures[0]),false);
  assert.equal(textureCurrent(p,p.textures[1]),true);assert.equal(placementCurrent(p,placement),false);assert.equal(riggingSource(p),undefined);
  const stale=await upload('head',beforeHead);assert.equal(stale.status,409);assert.equal(p.models.length,3);
  // A persistence failure must not publish a new original in memory or on disk.
  const save=store.save.bind(store),modelCount=p.models.length;
  store.save=async next=>{store.projects.set(next.id,next);throw Error('simulated disk failure');};
  assert.equal((await upload('head',newHead.id)).status,500);store.save=save;
  assert.equal(store.get(p.id),p);assert.equal(p.models.length,modelCount);assert.equal(selectedSource(p,'head').id,newHead.id);
  const persisted=JSON.parse(await fs.readFile(path.join(root,p.id+'.json')));
  assert.equal(persisted.groups.head.selectedModelId,newHead.id);
  const files=await fs.readdir(path.join(root,p.id));assert.equal(files.filter(f=>f.endsWith('.glb')).length,3);
  // The previous original is recoverable only through an explicit choice.
  const selection=await fetch(base+`/api/projects/${p.id}/select-model`,{method:'POST',headers:{'x-workbench-token':token,'content-type':'application/json'},body:JSON.stringify({group:'head',modelId:beforeHead})});
  assert.equal(selection.status,200);assert.equal(selectedSource(p,'head').id,beforeHead);assert.equal(p.groups.body.selectedModelId,beforeBody);
  assert.equal(currentSegmentation(p)?.id,'old-analysis');assert.equal(placementCurrent(p,placement),true);
  p.segmentTexturePlan={id:'approved-plan',status:'references-required'};
  assert.equal((await upload('body',beforeBody)).status,409);assert.equal(p.models.length,3);
});

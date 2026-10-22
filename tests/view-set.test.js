import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fingerprintViewSet, validateViewSet, viewSetReady, selectedViews, VIEW_SET_CRITERIA } from '../server/view-set.js';

const slots = ['head','body'].flatMap(group => ['front','right','back'].map(view => [group,view]));
async function sampleSet() {
  const project = {
    reference: {id:'reference-1'}, referenceRevision:1, notesRevision:0, demo:false,
    referenceState:{status:'ready',referenceId:'reference-1'},
    groups:{head:{views:{},approved:false},body:{views:{},approved:false}},
  };
  const buffers = new Map();
  for (const [index,[group,view]] of slots.entries()) {
    const id = `${group}-${view}`;
    project.groups[group].views[view] = {id,referenceId:'reference-1',notesRevision:0,source:'importado'};
    buffers.set(id,await sharp({create:{width:500,height:600,channels:3,background:{r:20+index*30,g:60,b:100}}}).png().toBuffer());
  }
  return {project,buffers,readAsset:asset => buffers.get(asset.id)};
}
function approveReport(project, report) {
  project.viewSetValidation = report;
  report.humanReview = {approved:true,reportId:report.id,fingerprint:report.fingerprint};
}

test('six current decoded views pass technical checks but need explicit report-bound human approval', async () => {
  const {project,readAsset} = await sampleSet();
  const before = structuredClone(project);
  const report = await validateViewSet(project,readAsset);
  assert.deepEqual(project,before, 'Validation must not modify approvals or project data');
  assert.equal(report.technicalValid,true);
  assert.equal(report.humanReview,null);
  assert.deepEqual(report.criteria,VIEW_SET_CRITERIA);
  assert.equal(report.items.length,6);
  assert(report.items.every(item => item.status === 'valid' && item.width === 500 && item.height === 600));
  project.viewSetValidation = report;
  assert.equal(viewSetReady(project),false);
  report.humanReview = {approved:true,fingerprint:report.fingerprint};
  assert.equal(viewSetReady(project),false, 'Approval must identify the exact technical report');
  approveReport(project,report);
  assert.equal(viewSetReady(project),true);
  assert.equal(project.groups.head.approved,false,'Combined review does not mutate legacy group approvals');
});

test('lossless re-encoding cannot hide exact duplicates across head and body', async () => {
  const {project,buffers,readAsset} = await sampleSet();
  const first = buffers.get('head-front');
  const reencoded = await sharp(first).webp({lossless:true}).toBuffer();
  assert.notDeepEqual(first,reencoded);
  buffers.set('body-back',reencoded);
  const report = await validateViewSet(project,readAsset);
  assert.equal(report.technicalValid,false);
  const front = report.items.find(item => item.assetId === 'head-front');
  const back = report.items.find(item => item.assetId === 'body-back');
  assert.equal(front.reasonCode,'duplicate_view');
  assert.equal(back.reasonCode,'duplicate_view');
  assert.deepEqual(back.duplicateOf,{group:'head',view:'front',assetId:'head-front'});
  assert.deepEqual(front.duplicateOf,{group:'body',view:'back',assetId:'body-back'});
  approveReport(project,report);
  assert.equal(viewSetReady(project),false);
});

test('missing files, invalid bytes, stale references and too-small images cannot pass', async () => {
  const {project,buffers,readAsset} = await sampleSet();
  delete project.groups.head.views.front;
  buffers.delete('head-right');
  buffers.set('head-back',Buffer.from('not an image'));
  project.groups.body.views.front.referenceId = 'old-reference';
  buffers.set('body-right',await sharp({create:{width:128,height:2048,channels:3,background:'#fa1234'}}).png().toBuffer());
  buffers.set('body-back',await sharp({create:{width:400,height:400,channels:3,background:'#fe9988'}}).png().toBuffer());
  const report = await validateViewSet(project,readAsset);
  assert.equal(report.technicalValid,false);
  assert.deepEqual(report.items.map(item => item.reasonCode),['missing_view','unreadable_file','decode_failed','stale_reference','low_resolution','low_resolution']);
  assert(report.items.every(item => item.status === 'invalid'));
});

test('supported formats are checked by decoded content, and unsupported formats are rejected', async () => {
  const {project,buffers,readAsset} = await sampleSet();
  buffers.set('head-front',await sharp(buffers.get('head-front')).jpeg().toBuffer());
  buffers.set('head-right',await sharp(buffers.get('head-right')).webp().toBuffer());
  assert.equal((await validateViewSet(project,readAsset)).technicalValid,true);
  buffers.set('body-back',await sharp(buffers.get('body-back')).tiff().toBuffer());
  const invalid = await validateViewSet(project,readAsset);
  assert.equal(invalid.technicalValid,false);
  assert.equal(invalid.items.at(-1).reasonCode,'invalid_format');
});

test('reference, notes, view identity, and confirmation changes revoke readiness; group booleans do not grant it', async () => {
  const {project,readAsset} = await sampleSet();
  const report = await validateViewSet(project,readAsset);
  approveReport(project,report);
  const originalFingerprint = fingerprintViewSet(project);
  for (const mutate of [
    p => {p.reference.id='reference-2';},
    p => {p.referenceRevision++;},
    p => {p.notesRevision++;},
    p => {p.groups.head.views.front.id='replacement';},
    p => {p.groups.body.views.back.referenceId='reference-2';},
    p => {p.referenceState.status='pending';},
    p => {p.referenceState.referenceId='reference-2';},
  ]) {
    const changed = structuredClone(project);
    mutate(changed);
    assert.notEqual(fingerprintViewSet(changed),originalFingerprint);
    assert.equal(viewSetReady(changed),false);
  }
  project.groups.head.approved = true;
  project.groups.body.approved = true;
  project.groups.head.approval = {id:'new-legacy-approval'};
  assert.equal(fingerprintViewSet(project),originalFingerprint);
  report.humanReview = null;
  assert.equal(viewSetReady(project),false);
});

test('changed notes can reuse files after a new technical report and explicit human review', async () => {
  const {project,readAsset} = await sampleSet();
  approveReport(project,await validateViewSet(project,readAsset));
  project.notesRevision++;
  assert.equal(viewSetReady(project),false);
  const renewed = await validateViewSet(project,readAsset);
  assert.equal(renewed.technicalValid,true);
  project.viewSetValidation = renewed;
  assert.equal(viewSetReady(project),false);
  approveReport(project,renewed);
  assert.equal(viewSetReady(project),true);
});

test('unconfirmed references and procedural assets in a real project never become ready', async () => {
  const {project,readAsset} = await sampleSet();
  project.referenceState.status = 'pending';
  const pending = await validateViewSet(project,readAsset);
  assert.equal(pending.reasonCode,'reference_unconfirmed');
  assert.equal(pending.technicalValid,false);
  approveReport(project,pending);
  assert.equal(viewSetReady(project),false);
  project.referenceState.status = 'ready';
  project.groups.head.views.front.source = 'demo procedural';
  const demo = await validateViewSet(project,readAsset);
  assert.equal(demo.technicalValid,false);
  assert.equal(demo.items[0].reasonCode,'demo_asset');
});

test('async inspection returns the captured identity; a concurrent edit cannot authorize the new revision', async () => {
  const {project,readAsset} = await sampleSet();
  const original = fingerprintViewSet(project);
  let edited = false;
  const report = await validateViewSet(project,async asset => {
    if (!edited) {project.notesRevision++;edited=true;}
    return readAsset(asset);
  });
  assert.equal(report.fingerprint,original);
  assert.notEqual(report.fingerprint,fingerprintViewSet(project));
  approveReport(project,report);
  assert.equal(viewSetReady(project),false);
});

test('one explicit left view validates independently; unselected bad files and the other part are ignored',async()=>{
 const {project,buffers,readAsset}=await sampleSet();
 project.groups.head.views.left={...project.groups.head.views.front,id:'head-left'};
 buffers.set('head-left',buffers.get('head-front'));
 project.groups.head.selectedViews=['left'];
 buffers.set('head-front',Buffer.from('invalid unselected file'));
 project.groups.body.views={};
 const report=await validateViewSet(project,readAsset,'head');
 assert.equal(report.technicalValid,true);assert.equal(report.items.length,1);assert.equal(report.items[0].view,'left');
 assert.equal(report.humanReview,null);approveReport(project,report);
 assert.equal(viewSetReady(project,'head'),true);assert.equal(viewSetReady(project,'body'),false);assert.equal(viewSetReady(project),true);
 const fp=fingerprintViewSet(project,'head');project.groups.body.views.front={id:'body-other'};
 assert.equal(fingerprintViewSet(project,'head'),fp);assert.equal(viewSetReady(project,'head'),true);
 project.groups.head.selectedViews=[];assert.notEqual(fingerprintViewSet(project,'head'),fp);assert.equal(viewSetReady(project,'head'),false);
 const empty=await validateViewSet(project,readAsset,'head');assert.equal(empty.technicalValid,false);assert.equal(empty.reasonCode,'no_selection');
});

test('four selected slots detect duplicate pixels; legacy selection never invents or selects a left image',async()=>{
 const {project,buffers,readAsset}=await sampleSet();
 const legacy=fingerprintViewSet(project);const oldReport=await validateViewSet(project,readAsset);approveReport(project,oldReport);
 project.groups.head.views.left={...project.groups.head.views.front,id:'head-left'};
 buffers.set('head-left',buffers.get('head-front'));
 assert.deepEqual(selectedViews(project,'head'),['front','right','back']);assert.equal(fingerprintViewSet(project),legacy);
 assert.equal(viewSetReady(project,'head'),true,'Existing six-view confirmation stays valid without selecting left');
 project.groups.head.selectedViews=['front','left','right','back'];
 assert.notEqual(fingerprintViewSet(project),legacy);assert.equal(viewSetReady(project,'head'),false);
 const duplicate=await validateViewSet(project,readAsset,'head');assert.equal(duplicate.items.length,4);assert.equal(duplicate.technicalValid,false);assert.equal(duplicate.items.find(x=>x.view==='left').reasonCode,'duplicate_view');
 buffers.set('head-left',await sharp({create:{width:512,height:512,channels:3,background:'#abcdef'}}).png().toBuffer());
 const report=await validateViewSet(project,readAsset,'head');assert.equal(report.technicalValid,true);approveReport(project,report);assert.equal(viewSetReady(project,'head'),true);
 project.groups.head.selectedViews=['left'];assert.equal(viewSetReady(project,'head'),false,'Selection changes require new explicit review');
});

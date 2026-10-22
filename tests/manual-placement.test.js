import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticPlacement,placementEstimate,identityPart,validManualPlacement,outdatedAutomaticPlacement} from '../src/placement-math.js';
import {placementGeometry,placementOrientation,framePlacementAssembly} from '../src/placement-anatomy.js';
import {Group,Mesh,BoxGeometry,MeshBasicMaterial,Box3} from 'three';
import {approveManual,currentManual,placementDraft,currentDraft,approvedProportions} from '../server/manual-placement.js';
import {emptyProject} from '../server/storage.js';
import {snapshot} from '../server/lineage.js';
import {fingerprintViewSet} from '../server/view-set.js';
function fixture(){const p=emptyProject('Manual');p.reference={id:'reference'};p.referenceState={status:'ready',referenceId:'reference'};for(const g of ['head','body']){const m={id:g,group:g,source:'importado',lineage:snapshot(p)};p.models.push(m);p.groups[g].selectedModelId=g;(p.textures||=[]).push({id:g+'-texture',group:g,sourceModelId:g,fingerprint:fingerprintViewSet(p,g)});}return p;}
const transforms=()=>({head:{...identityPart(),scale:.8,position:[0,1.1,.04]},body:identityPart()});
const input=()=>({transforms:transforms(),heightCm:170,sources:{head:'head-texture',body:'body-texture'},confirm:true});
test('automatic seed is deterministic and does not mutate either source',()=>{
 const h={min:[-1,-2,-1],max:[1,2,1],anatomy:{min:[-1,-2,-1],max:[1,2,1]}},b={min:[-2,-1,-.5],max:[2,9,.5],anatomy:{min:[-2,-1,-.5],max:[2,9,.5]}},before=JSON.stringify([h,b]);
 const a=automaticPlacement(h,b);assert.deepEqual(a,automaticPlacement(h,b));assert.equal(a.head.scale,.4);assert.equal(b.min[1]+a.body.position[1],0);assert.equal(JSON.stringify([h,b]),before);
});
test('when a face group is available long hair does not determine head scale or chin anchor',()=>{
 const body={min:[-2,0,-1],max:[2,10,1],anatomy:{min:[-.5,0,-.4],max:[.5,10,.4]}},face={min:[-.5,4,-.5],max:[.5,5,.5]};
 const a=automaticPlacement({min:[-1,0,-1],max:[1,6,1],face},body),b=automaticPlacement({min:[-1,-20,-1],max:[1,6,1],face},body);
 assert.deepEqual(a,b);assert.equal(a.head.scale,1.6);assert.equal(a.head.position[1]+4*a.head.scale,10);
});

test('unidentified anatomy never silently uses the entire hair box as a skull',()=>{
 const result=placementEstimate({min:[-1,-20,-1],max:[1,8,1]},{min:[-1,0,-1],max:[1,10,1]});
 assert.equal(result.transforms,null);assert.equal(result.report.confidence,'low');assert.equal(result.report.reason,'regions-required');
});

test('geometry measurements respect node transforms, semantic tags, source units and exclude long hair and tails',()=>{
 const head=new Group(),body=new Group(),make=(parent,size,position,role,name)=>{const m=new Mesh(new BoxGeometry(...size),new MeshBasicMaterial());m.position.set(...position);if(role)m.material.userData.workbenchSurfaceRole=role;if(name)m.name=name;parent.add(m);return m;};
 const face=make(head,[2,3,2],[10,5,0],'skin','unknown'),hair=make(head,[7,50,3],[10,-10,0],'hair','unknown');
 const torso=make(body,[4,10,2],[0,5,0],null,'torso'),tail=make(body,[1,100,60],[0,5,-30],'skin','tail');
 face.scale.setScalar(2);const bytes=face.geometry.attributes.position.array.slice();
 const a=placementGeometry(head,'head'),b=placementGeometry(body,'body');
 assert.equal(a.anatomy.max[1]-a.anatomy.min[1],6);assert.equal(b.anatomy.max[1]-b.anatomy.min[1],10);
 const estimate=placementEstimate(a,b,{ratio:.2,provenance:'user-defined-proportion'});assert.equal(estimate.transforms.head.scale,2/6);
 hair.position.y-=500;tail.scale.setScalar(10);assert.deepEqual(placementGeometry(head,'head').anatomy,a.anatomy);assert.deepEqual(placementGeometry(body,'body').anatomy,b.anatomy);
 assert.deepEqual(face.geometry.attributes.position.array,bytes);
 // Display normalization and existing manual edits must never accumulate in measurements.
 const wrapper=new Group();wrapper.add(head);wrapper.position.set(5,8,9);wrapper.scale.setScalar(12);wrapper.updateMatrixWorld(true);const measured=placementGeometry(head,'head').anatomy;for(const key of ['min','max'])for(let i=0;i<3;i++)assert(Math.abs(measured[key][i]-a.anatomy[key][i])<1e-10);
 for(const m of [face,hair,torso,tail]){m.geometry.dispose();m.material.dispose();}
});

test('user landmarks override region estimates; independent axis settings rotate rigidly without reflection',()=>{
 const scene=new Group(),m=new Mesh(new BoxGeometry(2,2,6),new MeshBasicMaterial());scene.add(m);
 const settings={head:{axes:{up:'Z',front:'-Y'},landmarks:{chin:[0,0,-3],crown:[0,0,3],anchor:[0,0,-2]}}};
 const a=placementGeometry(scene,'head',settings);assert.equal(a.method,'user-landmarks');assert.equal(a.anatomy.max[1]-a.anatomy.min[1],6);assert(Math.abs(placementOrientation(settings.head.axes).matrix.determinant()-1)<1e-10);
 assert.throws(()=>placementOrientation({up:'Y',front:'-Y'}),/AXES_INVALID/);m.geometry.dispose();m.material.dispose();
});

test('a dressed segmented body uses soles and torso even when only the legs have a recognized name',()=>{
 const body=new Group();for(const [name,size,position] of [['boots',[.2,.5,.15],[0,.25,0]],['legs',[.2,.2,.1],[0,.6,0]],['outfit',[.3,.4,.15],[0,.8,0]],['arm-left',[.4,.1,.1],[.4,.9,0]]]){const m=new Mesh(new BoxGeometry(...size),new MeshBasicMaterial());m.name=name;m.position.set(...position);body.add(m);}
 const measured=placementGeometry(body,'body');assert.equal(measured.ground,0);assert(measured.anatomy.max[1]>.95);assert.equal(measured.anatomy.min[1],0);
 const result=placementEstimate({anatomy:{min:[-.4,0,-.3],max:[.4,.7,.3]}},measured);assert(result.transforms.head.scale>.2);assert(result.transforms.head.position[1]>.9);assert(Math.abs(result.transforms.body.position[1])<1e-12);
 body.traverse(m=>{m.geometry?.dispose();m.material?.dispose();});
});

test('only an untouched version-one automatic draft is recalculated; artist changes and approvals are preserved',()=>{
 const result=placementEstimate({anatomy:{min:[-.3,.05,-.2],max:[.3,.75,.4]}},{anatomy:{min:[-.08,.45,-.07],max:[.08,.64,.05]}});
 const draft={transforms:result.transforms,initialPlacement:{report:{...result.report,version:1}}};assert.equal(outdatedAutomaticPlacement(draft,null),true);
 assert.equal(outdatedAutomaticPlacement(draft,{id:'artist-approved'}),false);
 const changed=structuredClone(draft);changed.transforms.head.position[1]+=.001;assert.equal(outdatedAutomaticPlacement(changed,null),false);
 changed.transforms=structuredClone(draft.transforms);changed.initialPlacement.editedByUser=true;assert.equal(outdatedAutomaticPlacement(changed,null),false);
 draft.initialPlacement.report.version=2;assert.equal(outdatedAutomaticPlacement(draft,null),false);assert.equal(outdatedAutomaticPlacement({transforms:draft.transforms},null),false);
});

test('framing always grounds the body, handles offset source origins and never accumulates normalization',()=>{
 const root=new Group(),body=new Mesh(new BoxGeometry(2,10,2),new MeshBasicMaterial()),head=new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial());body.position.set(4,100,0);head.position.set(4,-100,0);root.add(body,head);
 const before=body.geometry.attributes.position.array.slice(),part=body.position.toArray();framePlacementAssembly(root,body);assert(Math.abs(new Box3().setFromObject(body).min.y)<1e-10);
 const position=root.position.toArray(),scale=root.scale.x;framePlacementAssembly(root,body);assert.deepEqual(root.position.toArray(),position);assert.equal(root.scale.x,scale);assert.deepEqual(body.position.toArray(),part);assert.deepEqual(body.geometry.attributes.position.array,before);
 for(const m of [body,head]){m.geometry.dispose();m.material.dispose();}
});

test('initial estimation audit persists with drafts and manual approval, with finite bounded controls',()=>{
 const p=fixture(),metadata={setup:{ratio:.16,provenance:'explicit-anime-preset',head:{axes:{up:'Y',front:'Z'},landmarks:{anchor:[0,1,0]}}},report:{confidence:'low',reason:'estimated-regions'}};
 const draft=placementDraft(p,{...input(),baseApprovalId:null,initialPlacement:metadata});assert.deepEqual(draft.initialPlacement,metadata);assert.equal(draft.approvedAt,undefined);
 assert.deepEqual(approveManual(p,{...input(),initialPlacement:metadata}).initialPlacement,metadata);
 assert.throws(()=>approveManual(p,{...input(),initialPlacement:{...metadata,setup:{ratio:.16,head:{axes:{up:'Y',front:'Y'}}}}}),/INVALID_SETTINGS/);
});

test('approved proportions follow the actual manually approved scale and are never reused for a different source model',()=>{
 const p=fixture(),v=input();v.initialPlacement={setup:{ratio:.16},report:{confidence:'low',cranialHeight:2,bodyHeight:8}};
 p.manualPlacement=approveManual(p,v);assert.equal(approvedProportions(p).ratio,.2);
 p.textures.push({...p.textures[0],id:'new-head-texture'});assert.equal(currentManual(p),null);assert.equal(approvedProportions(p).ratio,.2);
 p.models.push({id:'different-model',group:'head',source:'importado',lineage:snapshot(p)});p.groups.head.selectedModelId='different-model';p.textures.at(-1).sourceModelId='different-model';assert.equal(approvedProportions(p),null);
});
test('manual approval binds exact transforms and height to current source versions',()=>{
 const p=fixture(),v=input();p.manualPlacement=approveManual(p,v);assert.deepEqual(p.manualPlacement.transforms,v.transforms);assert.equal(currentManual(p).heightCm,170);
 v.transforms.head.position[1]=99;assert.equal(p.manualPlacement.transforms.head.position[1],1.1);
 p.textures.push({...p.textures[0],id:'new-head'});assert.equal(currentManual(p),null);assert.throws(()=>approveManual(p,input()),/SOURCE_CHANGED/);
});

test('deformer points persist with drafts and approvals while old placements remain compatible',()=>{
 const p=fixture(),deformers={version:1,pins:[{id:'point-1',part:'head',mesh:'0:0',vertex:2,center:[0,1,0],delta:[.01,0,0],radius:.08,connectedOnly:true,enabled:true}]},v={...input(),deformers};
 const draft=placementDraft(p,{...v,baseApprovalId:null});assert.deepEqual(draft.deformers,deformers);assert.equal(draft.approvedAt,undefined);
 const approved=approveManual(p,v);assert.deepEqual(approved.deformers,deformers);deformers.pins[0].delta[0]=10;assert.equal(approved.deformers.pins[0].delta[0],.01);
 assert.equal(approveManual(p,input()).deformers,undefined);assert.throws(()=>approveManual(p,{...v,deformers:{version:99,pins:[]}}),/INVALID_DEFORMERS/);
 p.textures.push({...p.textures[0],id:'new-source'});assert.throws(()=>approveManual(p,v),/SOURCE_CHANGED/);
});
test('invalid transforms, missing consent and heights cannot create approval',()=>{
 const p=fixture();for(const patch of [{heightCm:0},{heightCm:NaN},{heightCm:301},{confirm:false},{transforms:{head:{...identityPart(),scale:-1},body:identityPart()}},{transforms:{head:{...identityPart(),position:[0,Infinity,0]},body:identityPart()}}])assert.throws(()=>approveManual(p,{...input(),...patch}));
 assert.equal(validManualPlacement({head:identityPart()}),false);assert.equal(p.manualPlacement,undefined);
});


test('draft is persistent editable data, never approval; rejects late saves after approval or rewind',()=>{
 const p=fixture();p.manualPlacementDraft=placementDraft(p,{...input(),baseApprovalId:null});
 assert.equal(currentManual(p),null);assert.equal(currentDraft(p).heightCm,170);assert.equal(p.manualPlacementDraft.approvedAt,undefined);
 assert.deepEqual(currentDraft(JSON.parse(JSON.stringify(p))).transforms,transforms());
 p.manualPlacement=approveManual(p,input());assert.throws(()=>placementDraft(p,{...input(),baseApprovalId:null}),/SOURCE_CHANGED/);
 assert.equal(placementDraft(p,{...input(),baseApprovalId:p.manualPlacement.id}).baseApprovalId,p.manualPlacement.id);
 p.workflowEpoch=1;assert.throws(()=>placementDraft(p,{...input(),baseApprovalId:p.manualPlacement.id,workflowEpoch:0}),/SOURCE_CHANGED/);
 p.textures.push({...p.textures[0],id:'updated-head'});assert.equal(currentDraft(p),null);
});

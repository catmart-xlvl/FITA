import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRefinementReport} from '../server/texture-refinement.js';
import {reviewFaceUvAudit} from '../server/face-uv.js';
const base=()=>({schema:'workbench-texture-refinement-report/v1',method:'paint-existing-atlases',imageGenerationUsed:false,reviewed:true,nonExplicit:true,originalClothingPreserved:true,pending:[],coverage:[],parts:Object.fromEntries(['head','body'].map(p=>[p,{views:['front','left','right','back'],changes:'Reviewed'}]))});
test('new finishing contract cannot substitute a generic head review for lip registration',()=>{
 const report=base();assert.throws(()=>validateRefinementReport(report,[],{lipRequired:true}),/REFINE_LIP_REVIEW_REQUIRED/);
 report.lipReview={status:'checked',reason:'Compared mouth opening and upper/lower lip paint with geometry.',views:['front','threequarter-left','threequarter-right','profile-left','profile-right'],modes:['base-color','geometry'],landmarks:[[-1,0,0],[0,0,0],[1,0,0]],creaseAligned:true,oldTraceRemoved:true,lowerLipRegistered:true,uvOverlapChecked:true};
 assert.equal(validateRefinementReport(report,[],{lipRequired:true}),report);
 for(const update of [{views:['front']},{modes:['base-color']},{oldTraceRemoved:false},{lowerLipRegistered:false},{uvOverlapChecked:false},{landmarks:[[0,0,0]]},{landmarks:[[NaN,0,0],[0,0,0],[1,0,0]]}])assert.throws(()=>validateRefinementReport({...report,lipReview:{...report.lipReview,...update}},[],{lipRequired:true}),/REFINE_LIP_REVIEW_REQUIRED/);
});
test('characters without mouths need an explicit reason, not a blank exemption',()=>{
 const report=base();report.lipReview={status:'not-applicable',reason:'This character has no mouth.'};assert(validateRefinementReport(report,[],{lipRequired:true}));report.lipReview.reason='';assert.throws(()=>validateRefinementReport(report,[],{lipRequired:true}),/REFINE_LIP_REVIEW_REQUIRED/);
});
test('small island counts do not excuse overlapping face UVs',()=>{
 const input={positions:[[0,0,0],[1,0,0],[0,1,0]],triangles:[0,1,2]},audit={skinIslands:1,newIslands:1,skinIslandFaces:[1],overlappingTexels:8};
 assert.throws(()=>reviewFaceUvAudit(input,audit),/FACE_UV_REVIEW_REQUIRED/);audit.overlappingTexels=0;assert(reviewFaceUvAudit(input,audit));
});

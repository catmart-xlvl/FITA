import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {buildGlb,parseGlb,atlasImages} from '../scripts/texture-layout.mjs';
import {applyFacialPatch,verifyFacialPreparation} from '../scripts/facial-preparation.mjs';
import {validateRefinementReport} from '../server/texture-refinement.js';
import {validateEyeShadowReview,verifyEyeShadows} from '../server/eye-shadow-review.js';

export async function facialFixture(){
 const white=await sharp({create:{width:8,height:8,channels:3,background:'#ffffff'}}).png().toBuffer(),bin=Buffer.alloc(120+white.length);white.copy(bin,120);
 const pos=[0,0,0,.1,0,0,0,.1,0,1,1,1];pos.forEach((v,i)=>bin.writeFloatLE(v,i*4));[0,0,1,0,0,1,1,1].forEach((v,i)=>bin.writeFloatLE(v,48+i*4));
 const ids=[0,1,2,...Array.from({length:5},()=>[1,2,3]).flat()];ids.forEach((v,i)=>bin.writeUInt16LE(v,80+i*2));
 const j={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'head-face',mesh:0}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:48},{buffer:0,byteOffset:48,byteLength:32},{buffer:0,byteOffset:80,byteLength:36},{buffer:0,byteOffset:120,byteLength:white.length}],accessors:[{bufferView:0,componentType:5126,count:4,type:'VEC3'},{bufferView:1,componentType:5126,count:4,type:'VEC2'},{bufferView:2,componentType:5123,count:18,type:'SCALAR'}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{bufferView:3,mimeType:'image/png'}]};
 const patch={schema:'workbench-facial-preparation/v1',whiteTexture:white.toString('base64'),removals:[{mesh:0,primitive:0,triangles:[0],regions:[{min:[-.01,-.01,-.01],max:[.2,.2,.1]}]}],pieces:[]};
 for(const eye of ['L','R'])for(const role of ['iris','pupil','glint','eyebrow','sclera'])patch.pieces.push({name:`WB_${role[0].toUpperCase()+role.slice(1)}_${eye}`,eye,role,positions:[0,0,.001,.08,0,.001,0,.08,.001],normals:[0,0,1,0,0,1,0,0,1],uv:[0,0,1,0,0,1],indices:[0,1,2],...(['glint','sclera'].includes(role)?{white:true}:{texture:white.toString('base64')})});
 return {original:buildGlb(j,bin),patch};
}
test('facial patch changes only reviewed indices and adds separate UV/material pieces',async()=>{
 const {original,patch}=await facialFixture(),result=applyFacialPatch(original,patch),audit=verifyFacialPreparation(original,result,patch);
 assert.equal(audit.removedFaces,1);assert.equal(audit.pieces,10);assert.equal(atlasImages(result).length,11);
 const {json:j}=parseGlb(result);assert(j.materials.filter(m=>m.extras?.workbenchFacialRole==='glint').every(m=>m.extensions.KHR_materials_unlit));
 for(const change of [(j,b)=>b.writeFloatLE(.5,0),j=>j.nodes[0].translation=[1,0,0],j=>j.materials.at(-1).doubleSided=false]){const {json,bin}=parseGlb(Buffer.from(result));change(json,bin);assert.throws(()=>verifyFacialPreparation(original,buildGlb(json,bin),patch));}
});
test('facial selection rejects hair, excess deletion, invalid index and wrong zones; glints cannot declare colored textures',async()=>{
 const {original,patch}=await facialFixture();
 for(const change of [p=>p.removals[0].triangles=[0,1],p=>p.removals[0].triangles=[99],p=>p.removals[0].regions[0].max=[9,9,9],p=>p.pieces[0].positions[0]=9,p=>p.pieces.find(x=>['glint','sclera'].includes(x.role)).texture=p.whiteTexture,p=>p.pieces.shift()]){const p=structuredClone(patch);change(p);assert.throws(()=>applyFacialPatch(original,p),/REFINE_FACIAL/);}
 const {json,bin}=parseGlb(original);json.nodes[0].name='head-hair';assert.throws(()=>applyFacialPatch(buildGlb(json,bin),patch),/REFINE_FACIAL/);
});
test('new facial reports require inspection evidence and reject silent omissions',()=>{
 const r={schema:'workbench-texture-refinement-report/v1',method:'paint-existing-atlases',imageGenerationUsed:false,reviewed:true,nonExplicit:true,originalClothingPreserved:true,pending:[],coverage:[],parts:Object.fromEntries(['head','body'].map(p=>[p,{views:['front','left','right','back'],changes:'Paint'}]))};
 assert.throws(()=>validateRefinementReport(r,[],{facialRequired:true}),/REFINE_FACIAL_REVIEW/);
 r.facialPreparation={status:'prepared',reason:'Prepared'};assert.throws(()=>validateRefinementReport(r,[],{facialRequired:true}),/REFINE_FACIAL_REVIEW/);
 r.facialPreparation={status:'not-applicable',reason:'Creature with no eyes or brows.'};assert(validateRefinementReport(r,[],{facialRequired:true}));
});

// JSON reports normalize -0 to 0. The binary geometry must remain reproducible.
test('facial patches produce identical buffers before and after JSON zero normalization',async()=>{
 const {original,patch}=await facialFixture();
 patch.pieces[0].positions[0]=-0;patch.pieces[0].normals[0]=-0;patch.pieces[0].uv[0]=-0;
 const result=applyFacialPatch(original,patch),roundtrip=JSON.parse(JSON.stringify(patch));
 assert.deepEqual(result,applyFacialPatch(original,roundtrip));
 assert(verifyFacialPreparation(original,result,roundtrip).protectedGeometryPreserved);
});

export function shadowPieces(){return ['L','R'].map(eye=>{
 const positions=[],uv=[],normals=[],indices=[];
 for(let row=0;row<2;row++)for(let x=0;x<8;x++){positions.push(x*.01,row*.02,.001);uv.push(x/7,row);normals.push(0,0,1);}
 for(let x=0;x<7;x++)indices.push(x,x+1,x+9,x,x+9,x+8);
 return {name:`WB_EyeShadow_${eye}`,role:'eyeshadow',eye,positions,normals,uv,indices,white:true,opacity:.25};
});}
const shadowReview=()=>({status:'checked',reason:'Curved upper strips checked around both eyes',views:['front','threequarter-left','threequarter-right','profile-left','profile-right'],modes:['original','base-color','mtoon'],eyes:['L','R'].map(eye=>({eye,surfaceFitted:true,noFloating:true,noClipping:true,glintsVisible:true,smoothContour:true}))});
test('sparse translucent shadows integrate with the facial patch and preserve original geometry and UV buffers',async()=>{
 const {original,patch}=await facialFixture();patch.pieces.push(...shadowPieces());
 const result=applyFacialPatch(original,patch),audit=verifyFacialPreparation(original,result,patch),{json:j}=parseGlb(result);
 assert.equal(audit.pieces,12);assert(audit.protectedGeometryPreserved);verifyEyeShadows(result,shadowReview());
 const shadows=j.materials.filter(m=>m.extras?.workbenchFacialRole==='eyeshadow');assert.equal(shadows.length,2);
 for(const m of shadows){assert.deepEqual(m.pbrMetallicRoughness.baseColorFactor,[0,0,0,.25]);assert.equal(m.alphaMode,'BLEND');assert(m.extensions.KHR_materials_unlit);}
 for(const mutate of [p=>p.pieces.at(-1).opacity=1,p=>p.pieces.at(-1).opacity=0,p=>p.pieces.at(-1).name='WB_Glint_R',p=>p.pieces.at(-1).positions[0]=99]){const bad=structuredClone(patch);mutate(bad);assert.throws(()=>applyFacialPatch(original,bad),/REFINE_FACIAL/);}
 for(const mutate of [m=>m.alphaMode='OPAQUE',m=>m.pbrMetallicRoughness.baseColorFactor[0]=1,m=>m.pbrMetallicRoughness.baseColorFactor[3]=1]){const bad=parseGlb(result);mutate(bad.json.materials.at(-1));assert.throws(()=>verifyEyeShadows(buildGlb(bad.json,bad.bin),shadowReview()),/REFINE_EYE_SHADOW/);}
});
test('adding only missing eye shadows preserves already prepared iris, pupil, glint and brow pieces',async()=>{
 const {original,patch}=await facialFixture(),prepared=applyFacialPatch(original,patch);
 const add={schema:patch.schema,removals:[],whiteTexture:patch.whiteTexture,regions:[{min:[-.001,-.001,-.001],max:[.1,.1,.01]}],pieces:shadowPieces()},result=applyFacialPatch(prepared,add);
 assert(verifyFacialPreparation(prepared,result,add).protectedGeometryPreserved);
 const before=parseGlb(prepared),after=parseGlb(result);assert(after.bin.subarray(0,before.bin.length).equals(before.bin));assert.deepEqual(after.json.nodes.slice(0,before.json.nodes.length),before.json.nodes);
 assert.throws(()=>applyFacialPatch(result,add),/REFINE_FACIAL/);assert.throws(()=>applyFacialPatch(original,add),/REFINE_FACIAL/);
});
test('eye shadow review requires both fitted eyes, all views/modes and preserved glints',()=>{
 assert.throws(()=>validateEyeShadowReview({}),/REFINE_EYE_SHADOW/);
 const good=shadowReview();assert(validateEyeShadowReview({eyeShadowReview:good}));
 for(const mutate of [r=>r.eyes.pop(),r=>r.modes.pop(),r=>r.views.pop(),r=>r.eyes[0].glintsVisible=false,r=>r.eyes[1].noFloating=false]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>validateEyeShadowReview({eyeShadowReview:bad}),/REFINE_EYE_SHADOW/);}
});

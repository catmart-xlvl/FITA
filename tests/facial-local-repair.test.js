import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateFacialLocalRepair} from '../server/facial-local-repair.js';
import {buildGlb,parseGlb} from '../scripts/texture-layout.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const d={asset:{version:'2.0'},nodes:[{name:'head-face',mesh:0},{name:'body',mesh:1}],meshes:[],accessors:[],bufferViews:[],buffers:[],materials:[],images:[],textures:[]};let bin=Buffer.alloc(0);
 const add=(rows,type)=>{const bytes=Buffer.alloc(rows.flat().length*4);rows.flat().forEach((v,i)=>bytes.writeFloatLE(v,i*4));d.bufferViews.push({buffer:0,byteOffset:bin.length,byteLength:bytes.length});bin=Buffer.concat([bin,bytes]);d.accessors.push({bufferView:d.bufferViews.length-1,count:rows.length,type,componentType:5126});return d.accessors.length-1;};
 const positions=Array.from({length:4},(_,j)=>[[j,0,0],[j+1,0,0],[j,1,0]]).flat(),uvs=Array.from({length:4},()=>[[0,0],[1,0],[0,1]]).flat();
 const p={attributes:{POSITION:add(positions,'VEC3'),TEXCOORD_0:add(uvs,'VEC2'),_WORKBENCH_VERTEX:add(Array.from({length:12},(_,i)=>[i]),'SCALAR')},indices:add(Array.from({length:12},(_,i)=>[i]),'SCALAR')};
 d.meshes=[{primitives:[p]},{primitives:[structuredClone(p)]}];d.buffers=[{byteLength:bin.length}];const source=buildGlb(d,bin);
 const incoming=structuredClone(d);const index=add(Array.from({length:9},(_,i)=>[i]),'SCALAR');incoming.bufferViews=d.bufferViews;incoming.accessors=d.accessors;incoming.meshes[0].primitives[0].indices=index;incoming.buffers=[{byteLength:bin.length}];const repaired=buildGlb(incoming,bin);
 const editable=Buffer.from('connected base'),recipe=Buffer.from(JSON.stringify({schema:'malfoid-mouth-loop-layout/v1',removedTriangles:[[9,10,11]]})),grant={schema:'fita-reviewed-facial-repair/v1',scope:'mouth-topology-and-crease-paint',projectId:'p',runId:'r',sourceSha256:hash(source),repairedSha256:hash(repaired),editableSha256:hash(editable),recipeSha256:hash(recipe),audit:{passed:true,outsideMouthGeometryUVPreserved:true,unmaskedPaintPreserved:true}};

 return {source,repaired,editable,recipe,grant};
}
test('local repair is disabled by default and binds reviewed source, editable base, recipe and run',()=>{
 const f=fixture(),args=[f.source,f.repaired,f.editable,f.recipe,f.grant];assert.throws(()=>validateFacialLocalRepair(...args),/authorization/);
 const options={allow:true,projectId:'p',runId:'r'};assert.equal(validateFacialLocalRepair(...args,options).authorizedLocalRepair,true);
 assert.throws(()=>validateFacialLocalRepair(...args,{...options,runId:'other'}),/authorization/);
 assert.throws(()=>validateFacialLocalRepair(f.source,f.repaired,Buffer.from('other'),f.recipe,f.grant,options),/artifact changed/);
});
test('review grants cannot permit a different body mesh or mutation of original binary',()=>{
 const f=fixture(),b=parseGlb(f.repaired);b.json.meshes[1].name='changed';let changed=buildGlb(b.json,b.bin);let grant={...f.grant,repairedSha256:hash(changed)};assert.throws(()=>validateFacialLocalRepair(f.source,changed,f.editable,f.recipe,grant,{allow:true,projectId:'p',runId:'r'}),/non-face/);
 const otherBin=Buffer.from(b.bin);otherBin[0]^=1;changed=buildGlb(b.json,otherBin);grant={...grant,repairedSha256:hash(changed)};assert.throws(()=>validateFacialLocalRepair(f.source,changed,f.editable,f.recipe,grant,{allow:true,projectId:'p',runId:'r'}),/binary/);
});

test('interior-only revision retains every original face and protects the exterior lip UVs',()=>{
 const f=fixture(),recipe=Buffer.from(JSON.stringify({schema:'malfoid-mouth-interior-preserve-lips/v2',originalLipGeometryAndUVRestored:true,removedTriangles:[],interiorTriangles:[[9,10,11]]}));
 function uvChange(vertex){
  const {json:d,bin}=parseGlb(f.source),values=Array.from({length:4},()=>[[0,0],[1,0],[0,1]]).flat();values[vertex][0]+=.2;const bytes=Buffer.alloc(12*2*4);values.flat().forEach((v,i)=>bytes.writeFloatLE(v,i*4));d.bufferViews.push({buffer:0,byteOffset:bin.length,byteLength:bytes.length});d.accessors.push({bufferView:d.bufferViews.length-1,componentType:5126,count:12,type:'VEC2'});d.meshes[0].primitives[0].attributes.TEXCOORD_0=d.accessors.length-1;d.buffers[0].byteLength=bin.length+bytes.length;return buildGlb(d,Buffer.concat([bin,bytes]));
 }
 function check(bytes){const grant={...f.grant,repairedSha256:hash(bytes),recipeSha256:hash(recipe)};return validateFacialLocalRepair(f.source,bytes,f.editable,recipe,grant,{allow:true,projectId:'p',runId:'r'});}
 assert.equal(check(uvChange(9)).originalLipGeometryAndUVPreserved,true);
 assert.throws(()=>check(uvChange(0)),/protected face corner/);
 const grant={...f.grant,recipeSha256:hash(recipe)};assert.throws(()=>validateFacialLocalRepair(f.source,f.repaired,f.editable,recipe,grant,{allow:true,projectId:'p',runId:'r'}),/unapproved face removal|interior recipe/);
});
test('reviewed visual revision permits only a source-bound shadow alpha material, never shadow geometry or body edits',()=>{
 const f=fixture(),{json:d,bin}=parseGlb(f.source);d.nodes[1].name='eye_shadows';d.nodes.push({name:'body',mesh:2});d.meshes.push(structuredClone(d.meshes[1]));const source=buildGlb(d,bin),png=Buffer.from('reviewed alpha gradient bytes');d.bufferViews.push({buffer:0,byteOffset:bin.length,byteLength:png.length});d.images.push({mimeType:'image/png',bufferView:d.bufferViews.length-1});d.samplers=[{wrapS:33071,wrapT:33071}];d.textures.push({source:0,sampler:0});d.materials.push({pbrMetallicRoughness:{baseColorFactor:[0,0,0,.25],baseColorTexture:{index:0}},alphaMode:'BLEND',extensions:{KHR_materials_unlit:{}}});d.meshes[1].primitives[0].material=0;d.buffers[0].byteLength=bin.length+png.length;
 const recipe=Buffer.from(JSON.stringify({schema:'malfoid-facial-visual-review/v3',originalLipGeometryAndUVRestored:true,removedTriangles:[],interiorTriangles:[[9,10,11]],shadowGradient:{mesh:'eye_shadows',textureSha256:hash(png)}}));
 const args={allow:true,projectId:'p',runId:'r'},audit={...f.grant.audit,facialMaterialReview:{skinColor:true,shadowGradient:true,lipPigmentPreserved:true}};
 function check(doc,review=audit){const repaired=buildGlb(doc,Buffer.concat([bin,png])),grant={...f.grant,sourceSha256:hash(source),repairedSha256:hash(repaired),recipeSha256:hash(recipe),audit:review};return validateFacialLocalRepair(source,repaired,f.editable,recipe,grant,args);}
 assert.equal(check(d).originalLipGeometryAndUVPreserved,true);assert.throws(()=>check(d,f.grant.audit),/visual material review/);
 const geometry=structuredClone(d);geometry.meshes[1].primitives[0].attributes.TEXCOORD_0=0;assert.throws(()=>check(geometry),/shadow geometry or UV/);
 const body=structuredClone(d);body.meshes[2].name='edited';assert.throws(()=>check(body),/non-face/);
 const opaque=structuredClone(d);opaque.materials[0].pbrMetallicRoughness.baseColorFactor[3]=1;assert.throws(()=>check(opaque),/shadow alpha material/);
 const texture=structuredClone(d);texture.bufferViews.at(-1).byteLength-=1;assert.throws(()=>check(texture),/shadow alpha texture/);
});

test('shared skin review permits only reviewed color textures on named skin domains and keeps body geometry and other channels exact',()=>{
 const f=fixture(),{json:d,bin}=parseGlb(f.source),names=['head-face','body-left-hand','body-right-hand','body-uniform'];
 d.nodes=[...names.map((name,mesh)=>({name,mesh})),{name:'eye_shadows',mesh:4}];d.meshes=Array.from({length:5},()=>structuredClone(d.meshes[0]));d.materials=[{name:'original',doubleSided:true,pbrMetallicRoughness:{baseColorTexture:{index:0},roughnessFactor:.9,metallicFactor:0}}];d.textures=[{source:0}];
 for(const mesh of d.meshes)mesh.primitives[0].material=0;
 const source=buildGlb(d,bin),skin=Buffer.from('reviewed skin derivative'),shadow=Buffer.from('reviewed alpha');
 function image(bytes,offset){d.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});d.images.push({mimeType:'image/png',bufferView:d.bufferViews.length-1});d.textures.push({source:d.images.length-1});return d.textures.length-1;}
 const ti=image(skin,bin.length),materials={};
 for(const name of names){const node=d.nodes.find(n=>n.name===name),material=structuredClone(d.materials[0]);material.name=name+' filter';material.pbrMetallicRoughness.baseColorTexture.index=ti;d.meshes[node.mesh].primitives[0].material=d.materials.length;d.materials.push(material);materials[name]={sourceMaterialIndex:0,materialName:material.name,evaluatedSha256:hash(skin)};}
 const sti=image(shadow,bin.length+skin.length);d.samplers=[{wrapS:33071,wrapT:33071}];d.textures[sti].sampler=0;d.meshes[4].primitives[0].material=d.materials.length;d.materials.push({pbrMetallicRoughness:{baseColorFactor:[0,0,0,.25],baseColorTexture:{index:sti}},alphaMode:'BLEND',extensions:{KHR_materials_unlit:{}}});d.buffers[0].byteLength=bin.length+skin.length+shadow.length;
 const recipe=Buffer.from(JSON.stringify({schema:'malfoid-shared-skin-filter/v4',originalLipGeometryAndUVRestored:true,removedTriangles:[],interiorTriangles:[[9,10,11]],shadowGradient:{mesh:'eye_shadows',textureSha256:hash(shadow)},skinFilter:{strength:.9,materials}})),audit={...f.grant.audit,facialMaterialReview:{skinColor:true,shadowGradient:true,lipPigmentPreserved:true},skinFilterReview:{editableNodes:true,originalTexturesUnchanged:true,strength:.9}};
 function check(doc,review=audit){const repaired=buildGlb(doc,Buffer.concat([bin,skin,shadow])),grant={...f.grant,sourceSha256:hash(source),repairedSha256:hash(repaired),recipeSha256:hash(recipe),audit:review};return validateFacialLocalRepair(source,repaired,f.editable,recipe,grant,{allow:true,projectId:'p',runId:'r'});}
 assert.equal(check(d).authorizedLocalRepair,true);
 const geometry=structuredClone(d);geometry.meshes[1].primitives[0].attributes.POSITION=0;geometry.meshes[1].name='changed';assert.throws(()=>check(geometry),/skin geometry or UV/);
 const rough=structuredClone(d);rough.materials[2].pbrMetallicRoughness.roughnessFactor=.1;assert.throws(()=>check(rough),/skin material channels/);
 const png=structuredClone(d);png.bufferViews.at(-2).byteLength-=1;assert.throws(()=>check(png),/skin filter texture/);
 assert.throws(()=>check(d,{...audit,skinFilterReview:{}}),/shared skin filter review/);
 const missing=structuredClone(d);missing.meshes[3].primitives[0].material=0;assert.throws(()=>check(missing),/skin filtered material missing/);
});

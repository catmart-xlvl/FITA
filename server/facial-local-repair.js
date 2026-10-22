import {createHash} from 'node:crypto';
import {parseGlb} from '../scripts/texture-layout.mjs';
import {parseRigGlb} from './rig-connectivity.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=detail=>{throw Object.assign(Error('FACE_LOCAL_REPAIR_INVALID: '+detail),{status:400});};

// An exception is tied to an independently reviewed local artifact, outside the
// import folder. Ordinary facial imports retain their exact-source contract.
export function validateFacialLocalRepair(source,repaired,editable,recipe,grant,{allow=false,projectId,runId}={}){
 if(!allow||grant?.schema!=='fita-reviewed-facial-repair/v1'||grant.projectId!==projectId||grant.runId!==runId||grant.scope!=='mouth-topology-and-crease-paint')fail('reviewed authorization required');
 for(const [key,bytes] of Object.entries({sourceSha256:source,repairedSha256:repaired,editableSha256:editable,recipeSha256:recipe}))if(grant[key]!==hash(bytes))fail('artifact changed: '+key);
 if(grant.audit?.passed!==true||grant.audit?.outsideMouthGeometryUVPreserved!==true||grant.audit?.unmaskedPaintPreserved!==true)fail('scoped audit required');
 const a=parseGlb(source),b=parseGlb(repaired),ad=a.json,bd=b.json,layout=JSON.parse(recipe),sharedSkin=layout.schema==='malfoid-shared-skin-filter/v4',visual=sharedSkin||layout.schema==='malfoid-facial-visual-review/v3';
 if(visual&&(!grant.audit.facialMaterialReview?.skinColor||!grant.audit.facialMaterialReview?.shadowGradient||!grant.audit.facialMaterialReview?.lipPigmentPreserved))fail('visual material review required');
 const skinNames=['head-face','body-left-hand','body-right-hand','body-uniform'];
 if(sharedSkin&&(!grant.audit.skinFilterReview?.editableNodes||!grant.audit.skinFilterReview?.originalTexturesUnchanged||grant.audit.skinFilterReview?.strength!==.9||layout.skinFilter?.strength!==.9||!same(Object.keys(layout.skinFilter?.materials||{}).sort(),[...skinNames].sort())))fail('shared skin filter review required');
 function skinMaterial(name,index){
  const row=layout.skinFilter.materials[name],old=ad.materials[row.sourceMaterialIndex],material=bd.materials[index],expected=structuredClone(old);
  if(!old||!material||index<ad.materials.length)fail('skin material inventory');
  expected.name=row.materialName;expected.pbrMetallicRoughness.baseColorTexture={...expected.pbrMetallicRoughness.baseColorTexture,index:material.pbrMetallicRoughness?.baseColorTexture?.index};
  if(!same(expected,material))fail('skin material channels changed');
  const texture=bd.textures[material.pbrMetallicRoughness.baseColorTexture.index],image=bd.images[texture?.source],view=bd.bufferViews[image?.bufferView];
  if(!view||image.mimeType!=='image/png'||hash(b.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength))!==row.evaluatedSha256)fail('skin filter texture');
 }
 if(!b.bin.subarray(0,a.bin.length).equals(a.bin))fail('original binary changed');
 for(const key of ['nodes','skins','animations','scenes','scene'])if(!same(ad[key],bd[key]))fail('protected '+key);
 if(!same(ad.samplers||[],visual?(bd.samplers||[]).slice(0,(ad.samplers||[]).length):bd.samplers||[]))fail('protected samplers');
 for(const key of ['accessors','bufferViews','materials','images','textures'])if(!same(ad[key]||[],(bd[key]||[]).slice(0,(ad[key]||[]).length)))fail('original '+key);
 const face=ad.nodes.find(n=>n.name==='head-face');if(!face||ad.meshes.length!==bd.meshes.length)fail('face inventory');
 const shadow=visual&&ad.nodes.find(n=>n.name==='eye_shadows'&&n.mesh!==undefined);
 if(visual&&(!shadow||layout.shadowGradient?.mesh!==shadow.name))fail('reviewed shadow inventory required');
 for(let i=0;i<ad.meshes.length;i++)if(i!==face.mesh&&!same(ad.meshes[i],bd.meshes[i])){
  const skin=sharedSkin&&ad.nodes.find(n=>skinNames.includes(n.name)&&n.name!=='head-face'&&n.mesh===i);
  if(skin){
   const protectedMesh=structuredClone(bd.meshes[i]);if(protectedMesh.primitives.length!==ad.meshes[i].primitives.length)fail('skin geometry');
   for(let j=0;j<protectedMesh.primitives.length;j++){const p=protectedMesh.primitives[j];if(ad.meshes[i].primitives[j].material!==layout.skinFilter.materials[skin.name].sourceMaterialIndex)fail('skin source material');skinMaterial(skin.name,p.material);p.material=ad.meshes[i].primitives[j].material;}
   if(!same(protectedMesh,ad.meshes[i]))fail('skin geometry or UV changed');
   continue;
  }
  if(!visual||i!==shadow.mesh)fail('non-face mesh changed');
  const protectedMesh=structuredClone(bd.meshes[i]);if(protectedMesh.primitives.length!==ad.meshes[i].primitives.length)fail('shadow geometry');
  for(let j=0;j<protectedMesh.primitives.length;j++){
   const p=protectedMesh.primitives[j],material=bd.materials[p.material],pbr=material?.pbrMetallicRoughness,texture=bd.textures[pbr?.baseColorTexture?.index],image=bd.images[texture?.source],view=bd.bufferViews[image?.bufferView],sampler=bd.samplers[texture?.sampler];
   if(p.material<(ad.materials||[]).length||!same(pbr?.baseColorFactor,[0,0,0,.25])||material.alphaMode!=='BLEND'||!material.extensions?.KHR_materials_unlit||!view||image.mimeType!=='image/png'||sampler?.wrapS!==33071||sampler?.wrapT!==33071)fail('shadow alpha material');
   if(hash(b.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength))!==layout.shadowGradient.textureSha256)fail('shadow alpha texture');
   p.material=ad.meshes[i].primitives[j].material;
  }
  if(!same(protectedMesh,ad.meshes[i]))fail('shadow geometry or UV changed');
 }
 if(sharedSkin){
  for(const name of skinNames){const node=ad.nodes.find(n=>n.name===name&&n.mesh!==undefined),row=layout.skinFilter.materials[name];if(!node)fail('skin mesh inventory');const matches=bd.meshes[node.mesh].primitives.filter(p=>bd.materials[p.material]?.name===row.materialName);if(!matches.length)fail('skin filtered material missing');for(const p of matches)skinMaterial(name,p.material);}
 }
 const ar=parseRigGlb(source),br=parseRigGlb(repaired),removed=new Set((layout.removedTriangles||[]).map(t=>[...t].sort((x,y)=>x-y).join(',')));
 const preserveLips=visual||layout.schema==='malfoid-mouth-interior-preserve-lips/v2',interior=new Set((layout.interiorTriangles||[]).map(t=>[...t].sort((x,y)=>x-y).join(',')));
 if(preserveLips){if(removed.size||!interior.size||interior.size>500||layout.originalLipGeometryAndUVRestored!==true)fail('lip preservation recipe');}
 else if(layout.schema!=='malfoid-mouth-loop-layout/v1'||!removed.size||removed.size>1000)fail('mouth recipe');
 function triangles(asset,mesh){const out=new Map();for(const p of mesh.primitives){const ids=asset.read(p.attributes._WORKBENCH_VERTEX).flat(),positions=asset.read(p.attributes.POSITION),uv=asset.read(p.attributes.TEXCOORD_0),indices=asset.read(p.indices).flat();for(let i=0;i<indices.length;i+=3){const ii=indices.slice(i,i+3),key=ii.map(j=>ids[j]).sort((x,y)=>x-y).join(',');out.set(key,{ids:ii.map(j=>ids[j]),positions:ii.map(j=>positions[j]),uv:ii.map(j=>uv[j])});}}return out;}
 const before=triangles(ar,ad.meshes[face.mesh]),after=triangles(br,bd.meshes[face.mesh]);let retained=0;
 for(const key of interior)if(!before.has(key)||!after.has(key))fail('interior recipe does not match topology');
 for(const key of removed)if(!before.has(key)||after.has(key))fail('removal recipe does not match topology');
 for(const [key,t] of before){if(removed.has(key))continue;const q=after.get(key);if(!q)fail('unapproved face removal');for(let j=0;j<3;j++){const k=q.ids.indexOf(t.ids[j]);if(k<0||t.positions[j].some((v,c)=>Math.abs(v-q.positions[k][c])>2e-6)||(!interior.has(key)&&t.uv[j].some((v,c)=>Math.abs(v-q.uv[k][c])>2e-6)))fail('protected face corner changed');}retained++;}
 if(retained<before.size*.70)fail('repair too broad');
 return {authorizedLocalRepair:true,scope:grant.scope,sourceSha256:hash(source),repairedSha256:hash(repaired),retainedTriangles:retained,removedTriangles:removed.size,...(preserveLips?{originalLipGeometryAndUVPreserved:true,interiorUVFaces:interior.size}:{}),audit:grant.audit};
}

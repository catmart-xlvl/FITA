import {parseGlb} from '../scripts/texture-layout.mjs';
const fail=()=>{throw Error('REFINE_EYE_SHADOW_REVIEW_REQUIRED');};
const views=['front','threequarter-left','threequarter-right','profile-left','profile-right'];
export function validateEyeShadowReview(report){
 const r=report.eyeShadowReview;
 if(!r||!['checked','not-applicable'].includes(r.status)||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>2000)fail();
 if(r.status==='not-applicable')return r;
 if(!views.every(v=>r.views?.includes(v))||!['original','base-color','mtoon'].every(m=>r.modes?.includes(m))||!Array.isArray(r.eyes)||r.eyes.length!==2)fail();
 for(const eye of ['L','R']){
  const e=r.eyes.find(e=>e.eye===eye);
  if(!e||e.surfaceFitted!==true||e.noFloating!==true||e.noClipping!==true||e.glintsVisible!==true||e.smoothContour!==true)fail();
 }
 return r;
}
export function verifyEyeShadows(bytes,review){
 if(review.status==='not-applicable')return;
 const {json:j}=parseGlb(bytes),found=new Set();
 for(const n of j.nodes||[]){
  const match=/^WB_EyeShadow_([LR])(?:_\d+)?$/.exec(n.name||'');if(!match)continue;
  if(found.has(match[1]))fail();found.add(match[1]);
  const mesh=j.meshes?.[n.mesh];if(!mesh?.primitives?.length)fail();let triangles=0;
  for(const p of mesh.primitives){
   const m=j.materials?.[p.material],f=m?.pbrMetallicRoughness?.baseColorFactor,a=j.accessors?.[p.indices];
   if((p.mode??4)!==4||!a||a.count%3||m?.extras?.workbenchFacialRole!=='eyeshadow'||m.alphaMode!=='BLEND'||!m.extensions?.KHR_materials_unlit||!f||f.length!==4||f.slice(0,3).some(v=>v!==0)||!(f[3]>0&&f[3]<1))fail();
   triangles+=a.count/3;
  }
  if(triangles<2||triangles>128)fail();
 }
 if(found.size!==2)fail();
}

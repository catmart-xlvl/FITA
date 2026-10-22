// Reviewed face-skin normal transfer; mandatory in new FITA finish packages. The proxy is data,
// never a mesh in the exported character. Positions, UV, paint and rig are fixed.
import {createHash} from 'node:crypto';
import {parseGlb,buildGlb,verifyTextureLayout} from './texture-layout.mjs';
import {positionDigest} from './hair-normal-preparation.mjs';
const fail=()=>{throw Error('FACE_NORMAL_PATCH_INVALID');};
const hash=b=>createHash('sha256').update(b).digest('hex');
function floats(j,b,index,size=3){
 const a=j.accessors?.[index],v=j.bufferViews?.[a?.bufferView];if(!a||!v||v.buffer!==0||a.componentType!==5126||a.type!==`VEC${size}`||a.sparse||a.normalized||a.count<1||a.count>2000000)fail();
 const stride=v.byteStride||size*4,start=(v.byteOffset||0)+(a.byteOffset||0);if(stride<size*4||start<0||start+(a.count-1)*stride+size*4>(v.byteOffset||0)+v.byteLength||start+(a.count-1)*stride+size*4>b.length)fail();
 const values=Array.from({length:a.count*size},(_,i)=>b.readFloatLE(start+Math.floor(i/size)*stride+i%size*4));if(values.some(x=>!Number.isFinite(x)))fail();return values;
}
function unit(p){const n=Math.hypot(...p);if(!Number.isFinite(n)||n<1e-9)fail();return p.map(x=>x/n);}
export function faceFieldNormals(positions,original,target){
 const {proxy,weights}=target,n=positions.length/3;if(original.length!==positions.length||!Array.isArray(weights)||weights.length!==n||weights.some(w=>!Number.isFinite(w)||w<0||w>1)||!weights.some(w=>w>0)||proxy?.type!=='ellipsoid'||![proxy.center,proxy.radii].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))||proxy.radii.some(x=>x<=0))fail();
 const q=proxy.rotation||[0,0,0,1];if(!Array.isArray(q)||q.length!==4||q.some(v=>!Number.isFinite(v))||Math.abs(Math.hypot(...q)-1)>1e-5)fail();
 const rotate=(v,inverse=false)=>{const [x,y,z,w]=inverse?[-q[0],-q[1],-q[2],q[3]]:q,t=[2*(y*v[2]-z*v[1]),2*(z*v[0]-x*v[2]),2*(x*v[1]-y*v[0])];return v.map((a,k)=>a+w*t[k]+[y*t[2]-z*t[1],z*t[0]-x*t[2],x*t[1]-y*t[0]][k]);};
 const result=original.slice();for(let i=0;i<n;i++){const w=weights[i];if(!w)continue;const p=positions.slice(i*3,i*3+3),local=rotate(p.map((x,k)=>x-proxy.center[k]),true),field=unit(rotate(local.map((x,k)=>x/(proxy.radii[k]**2)))),old=original.slice(i*3,i*3+3),normal=unit(field.map((x,k)=>x*w+old[k]*(1-w)));result.splice(i*3,3,...normal);}return result;
}
export function applyFaceNormalPatch(source,patch){
 if(patch?.schema!=='workbench-face-normals/v1'||!Array.isArray(patch.targets)||!patch.targets.length||patch.targets.length>32)fail();
 const {json:j,bin}=parseGlb(source);let length=bin.length;const chunks=[bin];
 const append=(values,size=3)=>{const bytes=Buffer.alloc(values.length*4);values.forEach((v,i)=>bytes.writeFloatLE(v,i*4));const pad=Buffer.alloc((4-length%4)%4);chunks.push(pad,bytes);length+=pad.length;const view=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length});length+=bytes.length;const index=j.accessors.length;j.accessors.push({bufferView:view,componentType:5126,count:values.length/size,type:`VEC${size}`});return index;};
 const seen=new Set();
 for(const t of patch.targets){
  const key=t.mesh+':'+t.primitive,p=j.meshes?.[t.mesh]?.primitives?.[t.primitive];if(seen.has(key)||!Number.isInteger(t.mesh)||!Number.isInteger(t.primitive)||!p||(p.mode??4)!==4||p.targets?.length||p.extensions||!j.nodes.some(n=>n.mesh===t.mesh&&(['face','head-face'].includes(n.name)||/^WB_(Iris|Pupil|Glint|Sclera|Eyebrow|EyeShadow)_[LR](?:_|$)/.test(n.name))))fail();seen.add(key);
  const positions=floats(j,bin,p.attributes.POSITION);if(positionDigest(positions)!==t.positionHash)fail();const old=floats(j,bin,p.attributes.NORMAL),normals=faceFieldNormals(positions,old,t);p.attributes.NORMAL=append(normals);
  if(p.attributes.TANGENT!==undefined){const values=floats(j,bin,p.attributes.TANGENT,4);if(values.length!==positions.length/3*4)fail();for(let i=0;i<t.weights.length;i++){if(!t.weights[i])continue;const n=normals.slice(i*3,i*3+3),v=values.slice(i*4,i*4+3),dot=v.reduce((s,x,k)=>s+x*n[k],0);let tangent=v.map((x,k)=>x-dot*n[k]);if(Math.hypot(...tangent)<1e-8){const axis=Math.abs(n[0])<.9?[1,0,0]:[0,1,0],d=axis.reduce((s,x,k)=>s+x*n[k],0);tangent=axis.map((x,k)=>x-d*n[k]);}values.splice(i*4,3,...unit(tangent));}p.attributes.TANGENT=append(values,4);}
  for(const n of j.nodes.filter(n=>n.mesh===t.mesh))n.extras={...n.extras,workbenchFaceNormals:{version:1}};
 }
 j.buffers[0].byteLength=length;return buildGlb(j,Buffer.concat(chunks));
}
export function verifyFaceNormalPreparation(source,result,patch){
 const expected=applyFaceNormalPatch(source,patch);verifyTextureLayout(expected,result);const a=parseGlb(expected),b=parseGlb(result);if(hash(a.bin)!==hash(b.bin)||JSON.stringify(a.json)!==JSON.stringify(b.json))fail();return{faceNormalsPrepared:true,geometryUvsTexturesSkinAnimationsPreserved:true,proxyExported:false};
}
export function validateFaceNormalReview(r){
 if(r?.status==='not-applicable'&&typeof r.reason==='string'&&r.reason.trim()&&r.reason.length<=4000&&!r.patch)return;
 if(!r||r.status!=='prepared'||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>4000||!r.patch||!['front','left','right','back'].every(v=>r.views?.includes(v))||!['left','right','front','back'].every(v=>r.lightDirections?.includes(v))||r.baseColorPreserved!==true||r.protectedFeaturesPreserved!==true||r.proxyExported!==false||r.seamsChecked!==true)fail();
}

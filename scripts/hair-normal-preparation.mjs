// Portable production normal stage. Never re-export positions, UVs or skin data.
import {createHash} from 'node:crypto';
import {parseGlb,buildGlb,verifyTextureLayout} from './texture-layout.mjs';
const fail=()=>{throw Error('HAIR_NORMAL_PATCH_INVALID');};
const hash=b=>createHash('sha256').update(b).digest('hex');
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const unit=v=>{const n=Math.hypot(...v);if(n<1e-10||!Number.isFinite(n))fail();return v.map(x=>x/n);};
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
function floats(j,bin,index,size=3){
 const a=j.accessors?.[index],v=j.bufferViews?.[a?.bufferView];
 if(!a||!v||v.buffer!==0||a.componentType!==5126||a.type!==`VEC${size}`||a.sparse||a.normalized||a.count<1||a.count>2000000)fail();
 const stride=v.byteStride||size*4,start=(v.byteOffset||0)+(a.byteOffset||0);
 if(stride<size*4||start<0||start+(a.count-1)*stride+size*4>(v.byteOffset||0)+v.byteLength||start+(a.count-1)*stride+size*4>bin.length)fail();
 const values=Array.from({length:a.count*size},(_,i)=>bin.readFloatLE(start+Math.floor(i/size)*stride+i%size*4));
 if(values.some(x=>!Number.isFinite(x)))fail();return values;
}
const packed=values=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));return b;};
export function positionDigest(values){return hash(packed(values));}
function volumeNormal(p,v){
 if(v.type==='ellipsoid'){
  if(!vec(v.center)||!vec(v.radii)||v.radii.some(x=>x<=0))fail();
  return unit(p.map((x,i)=>(x-v.center[i])/(v.radii[i]*v.radii[i])));
 }
 if(v.type!=='tube'||!Array.isArray(v.points)||v.points.length<2||v.points.length>256||!v.points.every(vec))fail();
 let best=Infinity,out;
 for(let k=1;k<v.points.length;k++){
  const a=v.points[k-1],d=sub(v.points[k],a),dd=dot(d,d);if(dd<1e-16)fail();
  const t=Math.max(0,Math.min(1,dot(sub(p,a),d)/dd)),r=p.map((x,i)=>x-a[i]-t*d[i]),dist=dot(r,r);
  if(dist<best){best=dist;out=r;}
 }return unit(out);
}
// Explicit regional weights avoid assuming symmetry, a fixed hair count or X axis.
export function fieldNormals(positions,profile,original){
 const n=positions.length/3,volumes=profile?.volumes;
 if(!Number.isInteger(n)||!n||!Array.isArray(volumes)||!volumes.length||volumes.length>32)fail();
 const protectedIds=profile.protectedVertices;
 if(protectedIds!==undefined&&(!Array.isArray(protectedIds)||!protectedIds.length||protectedIds.length>=n||new Set(protectedIds).size!==protectedIds.length||protectedIds.some(i=>!Number.isInteger(i)||i<0||i>=n)||!Array.isArray(original)||original.length!==positions.length||original.some(v=>!Number.isFinite(v))))fail();
 const protectedSet=new Set(protectedIds||[]);
 for(const v of volumes)if(v.weights!==undefined&&(!Array.isArray(v.weights)||v.weights.length!==n||v.weights.some(w=>!Number.isFinite(w)||w<0||w>1)))fail();
 const out=[];
 for(let i=0;i<n;i++){
  const p=positions.slice(i*3,i*3+3),sum=[0,0,0];let total=0;
  if(protectedSet.has(i)){out.push(...original.slice(i*3,i*3+3));continue;}
  for(const v of volumes){const w=v.weights?.[i]??1;if(!w)continue;const normal=volumeNormal(p,v);normal.forEach((x,k)=>sum[k]+=x*w);total+=w;}
  if(total<=0)fail();out.push(...unit(sum));
 }return out;
}
export function hairNormalInventory(source){
 const {json:j,bin}=parseGlb(source);
 return (j.meshes||[]).flatMap((m,mesh)=>m.primitives.map((p,primitive)=>({mesh,primitive,name:m.name||'',nodes:j.nodes.filter(n=>n.mesh===mesh).map(n=>n.name||''),positionHash:positionDigest(floats(j,bin,p.attributes.POSITION)),vertices:j.accessors[p.attributes.POSITION].count,morphTargets:p.targets?.length||0,skinned:j.nodes.some(n=>n.mesh===mesh&&n.skin!==undefined)})));
}
export function applyHairNormalPatch(source,patch){
 if(patch?.schema!=='workbench-hair-normals/v1'||!Array.isArray(patch.targets)||!patch.targets.length||patch.targets.length>128)fail();
 const {json:j,bin}=parseGlb(source);let length=bin.length;const chunks=[bin],seen=new Set(),meshes=new Set();
 const append=(values,size=3)=>{
  const bytes=packed(values),pad=Buffer.alloc((4-length%4)%4);chunks.push(pad,bytes);length+=pad.length;
  const view=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length});length+=bytes.length;
  const index=j.accessors.length;j.accessors.push({bufferView:view,componentType:5126,count:values.length/size,type:size===1?'SCALAR':`VEC${size}`});return index;
 };
 for(const t of patch.targets){
  const key=`${t.mesh}:${t.primitive}`,p=j.meshes?.[t.mesh]?.primitives?.[t.primitive];
  if(!Number.isInteger(t.mesh)||!Number.isInteger(t.primitive)||!p||seen.has(key)||(p.mode??4)!==4||p.extensions)fail();seen.add(key);meshes.add(t.mesh);
  const positions=floats(j,bin,p.attributes.POSITION);
  if(positionDigest(positions)!==t.positionHash)fail();
  if(t.protectedVertices!==undefined&&!Array.isArray(t.protectedVertices))fail();
  const protectedSet=new Set(t.protectedVertices||[]);
  // A reviewed mixed primitive can keep complete accessory components intact.
  // Shared boundary triangles need a separate preparation and are not inferred.
  if(t.protectedVertices!==undefined){
   if(p.targets?.length||!Number.isInteger(p.indices))fail();
   const a=j.accessors[p.indices],v=j.bufferViews[a?.bufferView],size={5123:2,5125:4}[a?.componentType];
   if(!v||!size||a.type!=='SCALAR'||a.sparse||v.byteStride||a.count%3)fail();
   const start=(v.byteOffset||0)+(a.byteOffset||0);if(start+a.count*size>bin.length)fail();
   for(let i=0;i<a.count;i+=3){const ids=[0,1,2].map(k=>size===2?bin.readUInt16LE(start+(i+k)*size):bin.readUInt32LE(start+(i+k)*size));if(ids.some(i=>i>=positions.length/3)||new Set(ids.map(i=>protectedSet.has(i))).size!==1)fail();}
  }
  const original=p.attributes.NORMAL!==undefined?floats(j,bin,p.attributes.NORMAL):undefined;
  const normals=fieldNormals(positions,t,original);p.attributes.NORMAL=append(normals);
  if(t.protectedVertices!==undefined)p.attributes._WORKBENCH_HAIR_MASK=append(Array.from({length:positions.length/3},(_,i)=>protectedSet.has(i)?0:1),1);
  if(p.attributes.TANGENT!==undefined){
   const tangents=floats(j,bin,p.attributes.TANGENT,4);if(tangents.length!==positions.length/3*4)fail();
   for(let i=0;i<positions.length/3;i++){
    if(protectedSet.has(i))continue;
    const n=normals.slice(i*3,i*3+3),old=tangents.slice(i*4,i*4+3),d=dot(old,n);let v=old.map((x,k)=>x-n[k]*d);
    if(Math.hypot(...v)<1e-8){const axis=Math.abs(n[0])<.9?[1,0,0]:[0,1,0];v=sub(axis,n.map(x=>x*dot(axis,n)));}
    tangents.splice(i*4,3,...unit(v));
   }p.attributes.TANGENT=append(tangents,4);
  }
  // Morph normals must be authored for each changed shape, never stale deltas.
  for(const [k,target]of (p.targets||[]).entries()){
   if(!t.morphProfiles?.[k]||target.TANGENT!==undefined)fail();
   const delta=target.POSITION!==undefined?floats(j,bin,target.POSITION):positions.map(()=>0);if(delta.length!==positions.length)fail();
   const shaped=fieldNormals(positions.map((x,i)=>x+delta[i]),t.morphProfiles[k]);
   target.NORMAL=append(shaped.map((x,i)=>x-normals[i]));
  }
 }
 for(const mesh of meshes){
  // A marker never classifies unprocessed primitives as hair.
  if(j.meshes[mesh].primitives.some((_,i)=>!seen.has(`${mesh}:${i}`)))fail();
  const mixed=patch.targets.some(t=>t.mesh===mesh&&t.protectedVertices!==undefined);
  for(const n of j.nodes.filter(n=>n.mesh===mesh))n.extras={...n.extras,workbenchHairNormals:{version:1,...(mixed?{mixed:true}:{})}};
 }
 j.buffers[0].byteLength=length;return buildGlb(j,Buffer.concat(chunks));
}
export function verifyHairNormalPreparation(source,result,patch){
 const expected=applyHairNormalPatch(source,patch);verifyTextureLayout(expected,result);
 // Unlike an atlas-only comparison, this stage also protects all image bytes.
 const a=parseGlb(expected),b=parseGlb(result);
 if(hash(a.bin)!==hash(b.bin)||JSON.stringify(a.json)!==JSON.stringify(b.json))fail();
 return {normalsPrepared:true,geometryUvsTexturesSkinAnimationsPreserved:true,targets:patch.targets.length};
}
export function validateHairNormalReview(r){
 if(!r||!['prepared','no-hair'].includes(r.status)||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>4000)fail();
 if(r.status==='no-hair'){if(r.patch)fail();return;}
 if(!r.patch||!['front','left','right','back'].every(v=>r.views?.includes(v))||!['left','right','front','back'].every(v=>r.lightDirections?.includes(v))||r.seamsChecked!==true||r.baseColorPreserved!==true||!['tested-rig','temporary-deformation-test'].includes(r.animation?.status)||!Array.isArray(r.animation?.evidence)||!r.animation.evidence.length||r.animation.evidence.some(e=>typeof e!=='string'||!e.trim()||e.length>1000))fail();
}

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {faceUvInput,applyFaceUv,verifyFaceUv} from '../scripts/face-uv.mjs';
import {findBlender,runBlender} from './placement.js';

export const faceGeometryHash=input=>createHash('sha256').update(JSON.stringify({positions:input.positions,triangles:input.triangles})).digest('hex');
export function validateFaceUvProfile(profile,input){
 if(profile?.schema!=='workbench-face-uv-regions/v1'||!/^[a-f0-9]{64}$/.test(profile.geometryHash||'')||!profile.regions||Array.isArray(profile.regions))throw Error('FACE_UV_PROFILE_INVALID');
 const names=Object.keys(profile.regions),seen=new Set();
 if(!names.length||names.some(n=>!['ear-left','ear-right','eye-left','eye-right'].includes(n)))throw Error('FACE_UV_PROFILE_INVALID');
 for(const faces of Object.values(profile.regions)){
  if(!Array.isArray(faces)||!faces.length||faces.length>100000)throw Error('FACE_UV_PROFILE_INVALID');
  for(const f of faces){if(!Number.isSafeInteger(f)||f<0||f>1000000||seen.has(f)||input&&f>=input.triangles.length/3)throw Error('FACE_UV_PROFILE_INVALID');seen.add(f);}
 }
 if(input&&profile.geometryHash!==faceGeometryHash(input))throw Error('FACE_UV_PROFILE_STALE');
 return {schema:profile.schema,geometryHash:profile.geometryHash,regions:profile.regions};
}

export function reviewFaceUvAudit(input,audit){
 // Count edge-connected sheets after positional welding and splitting
 // ambiguous nonmanifold edges, exactly as the temporary proxy does.
 // UV seams and faces that meet only at a vertex are not surface joins.
 const vertices=new Map(),ids=input.positions.map(p=>{
  const key=p.map(v=>Math.round(v*1e7)).join(',');
  if(!vertices.has(key))vertices.set(key,vertices.size);return vertices.get(key);
 }),count=input.triangles.length/3,parent=Array.from({length:count},(_,i)=>i),edges=new Map();
 const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(let f=0;f<count;f++)for(let k=0;k<3;k++){
  const a=ids[input.triangles[f*3+k]],b=ids[input.triangles[f*3+(k+1)%3]],key=a<b?`${a}:${b}`:`${b}:${a}`;
  if(!edges.has(key))edges.set(key,[]);edges.get(key).push(f);
 }
 for(const faces of edges.values())if(faces.length===2)parent[root(faces[0])]=root(faces[1]);
 const geometryComponents=new Set(parent.map((_,i)=>root(i))).size;
 // Each disconnected detail needs at least one island. Allow 31 additional
 // seams (the previous 32-island limit on one connected surface), while
 // keeping the independent skin continuity guards.
 const allowedTotalIslands=Math.max(32,geometryComponents+31);
 // Triangle density varies wildly between skin, lashes and jewellery. For
 // new audits, verify the actual source area of the continuous skin domain
 // instead of requiring an arbitrary fraction of all decorative triangles.
 let skinSurfaceFraction;
 if(audit?.skinSourceFaces!==undefined){
  const faces=audit.skinSourceFaces;
  if(audit.layout!=='single-face-island/v1'||audit.skinIslands!==1||audit.uvFoldChecked!==true||!Array.isArray(faces)||faces.length!==audit.skinIslandFaces?.[0]||new Set(faces).size!==faces.length||faces.some(f=>!Number.isInteger(f)||f<0||f>=count))throw Error('FACE_UV_REVIEW_REQUIRED');
  const selected=new Set(faces);let total=0,skin=0;
  for(let f=0;f<count;f++){
   const [a,b,c]=input.triangles.slice(f*3,f*3+3).map(v=>input.positions[v]),u=b.map((v,k)=>v-a[k]),v=c.map((n,k)=>n-a[k]);
   const area=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
   total+=area;if(selected.has(f))skin+=area;
  }
  skinSurfaceFraction=skin/total;
  if(!Number.isFinite(skinSurfaceFraction)||skinSurfaceFraction<.4)throw Error('FACE_UV_REVIEW_REQUIRED');
 }
 if(audit?.layout==='single-face-island/v1'&&(audit.skinIslands!==1||audit.uvOverlapChecked!==true||audit.overlappingTexels!==0))throw Error('FACE_UV_REVIEW_REQUIRED');
 if(audit?.overlappingTexels>0)throw Error('FACE_UV_REVIEW_REQUIRED');
 if(!Number.isInteger(audit?.skinIslands)||audit.skinIslands<1||audit.skinIslands>8
  ||!Number.isInteger(audit?.newIslands)||audit.newIslands<1||audit.newIslands>allowedTotalIslands
  ||!Number.isFinite(audit?.skinIslandFaces?.[0])||(skinSurfaceFraction===undefined&&audit.skinIslandFaces[0]<count*.4))throw Error('FACE_UV_REVIEW_REQUIRED');
 return {geometryComponents,allowedTotalIslands,...(skinSurfaceFraction===undefined?{}:{skinSurfaceFraction})};
}

export async function rebuildFaceUv(bytes,{directory,execute=runBlender,executable,nodeName='head-face',profile}={}){
 const input=faceUvInput(bytes,nodeName),own=!directory,dir=directory||await fs.mkdtemp(path.join(os.tmpdir(),'workbench-face-uv-'));
 if(profile)input.semanticRegions=validateFaceUvProfile(profile,input).regions;
 await fs.mkdir(dir,{recursive:true});
 try{
  executable ||= await findBlender();if(!executable)throw Error('PLACEMENT_BLENDER_NOT_FOUND');
  const image=path.join(dir,'source.png'),file=path.join(dir,'input.json'),job=path.join(dir,'job.json');
  await fs.writeFile(image,input.image.bytes);delete input.image;await fs.writeFile(file,JSON.stringify(input));
  await fs.writeFile(job,JSON.stringify({directory:dir,input:file,image}));
  await execute(executable,job,()=>{},'rebuild_face_uv.py');
  const patch=JSON.parse(await fs.readFile(path.join(dir,'face-uv-patch.json'),'utf8')),png=await fs.readFile(path.join(dir,'face-rebaked.png'));
  const review=reviewFaceUvAudit(input,patch.audit);
  const result=applyFaceUv(bytes,patch,png);const validation=verifyFaceUv(bytes,result,patch);
  return {bytes:result,patch,report:{...patch.audit,...review,...validation,sourceHash:input.sourceHash}};
 }finally{if(own)await fs.rm(dir,{recursive:true,force:true});}
}

export async function rebuildReconstructedFace(jobFile){
 const job=JSON.parse(await fs.readFile(jobFile,'utf8')),proposal=JSON.parse(await fs.readFile(job.proposal,'utf8'));
 const group=proposal.groups.find(g=>g.part==='head'&&(['face','skin','facial_features'].includes(g.category)||g.id==='head-face'));
 if(!group)return;
 const dir=job.directory,head=path.join(dir,'head-textured.glb'),uvdir=path.join(dir,'face-uv');
 const result=await rebuildFaceUv(await fs.readFile(head),{directory:uvdir,nodeName:group.id,profile:job.faceUvProfile});
 await fs.copyFile(head,path.join(dir,'head-tripo-uv-backup.glb'));await fs.writeFile(head,result.bytes);
 const sync=path.join(dir,'face-uv-sync.json');await fs.writeFile(sync,JSON.stringify({blend:path.join(dir,'textured.blend'),head,nodeName:group.id}));
 await runBlender(await findBlender(),sync,()=>{},'sync_face_uv_blend.py');
 const reportFile=path.join(dir,'reconstruction.json'),report=JSON.parse(await fs.readFile(reportFile,'utf8'));report.faceUv=result.report;await fs.writeFile(reportFile,JSON.stringify(report));
}

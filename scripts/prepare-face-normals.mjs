import fs from 'node:fs/promises';import path from 'node:path';import{fileURLToPath}from'node:url';
import{applyFaceNormalPatch,verifyFaceNormalPreparation,validateFaceNormalReview}from'./face-normal-preparation.mjs';
import{hairNormalInventory}from'./hair-normal-preparation.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
try{
 const source=await fs.readFile(path.join(root,'result/head.glb'));
 if(process.argv[2]==='inspect'){console.log(JSON.stringify(hairNormalInventory(source),null,2));}
 else{
  const review=JSON.parse(await fs.readFile(path.join(root,'face-normal-review.json'),'utf8'));validateFaceNormalReview(review);
  const report=JSON.parse(await fs.readFile(path.join(root,'report.json'),'utf8'));
  if(!['prepared','already-prepared','not-applicable'].includes(report.facialPreparation?.status)||!['prepared','no-hair'].includes(report.hairNormals?.status))throw Error('FACE_REQUIRES_FACIAL_AND_HAIR_STAGES');
  if(review.status==='prepared'){
   const result=applyFaceNormalPatch(source,review.patch),audit=verifyFaceNormalPreparation(source,result,review.patch);
   await fs.copyFile(path.join(root,'result/head.glb'),path.join(root,'result/head-before-face-normals.glb'));
   await fs.writeFile(path.join(root,'result/head.glb'),result);console.log(JSON.stringify(audit));
  }
  report.faceNormals=review;await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
 }
}catch(e){console.error(e.message);process.exitCode=1;}

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyHairNormalPatch,verifyHairNormalPreparation,hairNormalInventory,validateHairNormalReview} from './hair-normal-preparation.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
try{
 const source=await fs.readFile(path.join(root,'result/head.glb'));
 if(process.argv[2]==='inspect'){console.log(JSON.stringify(hairNormalInventory(source),null,2));}
 else{
  const report=JSON.parse(await fs.readFile(path.join(root,'report.json'),'utf8'));
  const review=JSON.parse(await fs.readFile(path.join(root,'hair-normal-review.json'),'utf8'));validateHairNormalReview(review);
  if(!['prepared','already-prepared','not-applicable'].includes(report.facialPreparation?.status))throw Error('HAIR_REQUIRES_FACIAL_STAGE');
  if(review.status==='prepared'){
   const result=applyHairNormalPatch(source,review.patch);const audit=verifyHairNormalPreparation(source,result,review.patch);
   await fs.copyFile(path.join(root,'result/head.glb'),path.join(root,'result/head-before-hair.glb'));
   await fs.writeFile(path.join(root,'result/head.glb'),result);console.log(JSON.stringify(audit));
  }
  report.hairNormals=review;await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
 }
}catch(e){console.error(e.message);process.exitCode=1;}

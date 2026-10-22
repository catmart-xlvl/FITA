import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyFacialPatch,verifyFacialPreparation} from './facial-preparation.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
try{
 const patch=JSON.parse(await fs.readFile(path.join(root,'facial-patch.json'),'utf8'));
 const original=await fs.readFile(path.join(root,'models/head.glb')),painted=await fs.readFile(path.join(root,'result/head.glb'));
 const result=applyFacialPatch(painted,patch);const audit=verifyFacialPreparation(original,result,patch);
 const report=JSON.parse(await fs.readFile(path.join(root,'report.json'),'utf8'));report.facialPreparation={...report.facialPreparation,status:'prepared',patch};
 await fs.writeFile(path.join(root,'result/head.glb'),result);await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(audit));
}catch(e){console.error(e.message);process.exitCode=1;}

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {zipBuffers} from './codex-handoff.js';
import yauzl from 'yauzl';
import {withVisualSpecification} from './visual-specification.js';
import {tPoseGuideVersion,withPoseGuideFiles} from './t-pose-guide.js';
import {withProductionAppearance,productionAppearanceVersion} from './production-appearance.js';
import {refinementSupportFiles,refinementGuidanceVersion} from './refinement-resources.js';
const appRoot=fileURLToPath(new URL('../',import.meta.url));
export function skillLocations(names){return names.map(name=>({name,entry:path.join(appRoot,'skills',name,'SKILL.md'),installedEntry:path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'skills',name,'SKILL.md')}));}
export const skillInstructions=names=>Buffer.from('SKILLS REQUERIDAS (no vienen dentro del ZIP)\n'+skillLocations(names).map(s=>`- ${s.name}: lee primero ${s.entry}. Alternativa instalada: ${s.installedEntry}. Usa la versión mantenida por esta aplicación si difieren.`).join('\n')+'\nResuelve sus referencias relativas desde la carpeta de esa skill. Si no existe ninguna copia, informa cuál falta y detén ese paso; no improvises ni marques la revisión como completada.\n');

// The downloadable views entry point is English. Legacy resource names inside
// the local workspace remain exact, so old helpers and outstanding grants work.
function viewInstructions(files){
 const descriptor=JSON.parse(files['UBICACIONES.json']);
 const first=['CONTINUAR.txt','INSTRUCCIONES.txt','INSTRUCTIONS.txt','PROMPT.txt'].filter(n=>descriptor.entries.some(e=>e.name===n));
 let text=`FITA · LOCAL INSTRUCTIONS · ${descriptor.projectName}\nProject: ${descriptor.projectId}\n\nRead UBICACIONES.json first and verify projectId. Exact workspace: ${descriptor.workspace}\nThis ZIP contains instructions and paths only. The images, manifest, helpers and maintained skills are in this local FITA installation.\n\n1. Read these workspace files in order: ${first.map(n=>path.join(descriptor.workspace,n)).join(', ')}. Read SKILLS_REQUERIDAS.txt if listed in entries. Each entry supplies its exact path and checksum; do not search the whole disk.\n2. Before authorized image generation, read ${descriptor.visualSpecification.entry} and ${descriptor.visualSpecification.contract}. Follow the stage contract and pose-only guides in the workspace; concept.png remains the design authority. Save and reuse especificacion-visual.json in the output directory. Inspect each result against the concept and stage contract.\n3. Work from the exact workspace. Keep source images, manifests, IDs and authorizations unchanged. Save results in ${descriptor.outputDirectory} unless a helper specifies another exact output path.\n4. After generating and reviewing the images, use ENTREGAR_VISTAS.mjs as instructed in the workspace. Keep FITA open on this computer and wait for its IMPORTED receipt before claiming delivery. Do not approve views, submit Tripo jobs or approve costs.\n5. If local paths or localhost are unavailable, stop and explain the missing local access; do not guess paths, expose credentials or publish the local server. If FITA is closed or authorization expired, keep finished images and follow the workspace recovery instructions without regenerating.\n`;
 if(descriptor.kind==='segmentation')text=text.replace('Follow the stage contract and pose-only guides in the workspace; concept.png remains the design authority.','Follow the analysis contract and maintained skills listed in the workspace. Preserve the chosen meshes and segment identities; do not perform placement or rigging.').replace('After generating and reviewing the images, use ENTREGAR_VISTAS.mjs as instructed in the workspace.','After completing and validating the analysis, use the delivery helper named in the workspace instructions.');
 const {'INSTRUCCIONES.txt':legacy,...rest}=files;
 return {...rest,'INSTRUCTIONS.txt':Buffer.from(text)};
}

// Previously issued grants keep their identity/token but no longer download assets.
export async function instructionPackageFromCache(store,p,kind,id,filename){
 const bytes=await fs.readFile(filename);
 const files=await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,strictFileNames:true},(err,z)=>{
  if(err)return reject(err);const out={};let total=0;z.on('error',reject);z.on('end',()=>resolve(out));
  z.on('entry',e=>{if((total+=e.uncompressedSize)>1024*1024*1024){z.close();return reject(Error('Cached package too large'));}if(e.fileName.endsWith('/'))return z.readEntry();z.openReadStream(e,(err,s)=>{if(err)return reject(err);const b=[];s.on('error',reject);s.on('data',v=>b.push(v));s.on('end',()=>{out[e.fileName]=Buffer.concat(b);z.readEntry();});});});z.readEntry();
 }));
 if(files['UBICACIONES.json']&&Object.keys(files).length===2){
  let updated=withVisualSpecification(files);
  if(kind==='views'){
   const descriptor=JSON.parse(updated['UBICACIONES.json']);
   const parent=path.resolve(store.root,'..','projects',p.id,'codex',kind),expected=path.resolve(descriptor.workspace);
   // Older grants used a distinct random workspace ID. Preserve that locator;
   // require an immediate child of this project's views folder, not the grant ID.
   if(descriptor.kind!=='views'||descriptor.projectId!==p.id||path.dirname(expected)!==parent||! /^[\w-]+$/.test(path.basename(expected)))throw Error('Invalid pose guide workspace');
   if(descriptor.poseGuidance?.revision!==tPoseGuideVersion){
    const texts={};for(const name of ['PROMPT.txt','INSTRUCCIONES.txt']){
     const entry=descriptor.entries.find(e=>e.name===name);
     if(entry){if(path.resolve(entry.path)!==path.join(expected,name))throw Error('Invalid pose guide resource');texts[name]=await fs.readFile(entry.path);}
    }
    const resources=await withPoseGuideFiles(texts);
    descriptor.entries=descriptor.entries.filter(e=>!['POSE_T_FRENTE.png','POSE_T_PERFIL.png','POSE_T.txt'].includes(e.name));
    for(const [name,bytes] of Object.entries(resources)){
     const target=path.join(expected,name);await fs.writeFile(target,bytes);
     const entry={name,path:target,sha256:createHash('sha256').update(bytes).digest('hex')};
     descriptor.entries=descriptor.entries.filter(e=>e.name!==name);descriptor.entries.push(entry);
    }
    descriptor.poseGuidance={revision:tPoseGuideVersion,role:'pose-only',designAuthority:'concept.png'};
    const instructionName=updated['INSTRUCTIONS.txt']?'INSTRUCTIONS.txt':'INSTRUCCIONES.txt';
    updated={...updated,'UBICACIONES.json':Buffer.from(JSON.stringify(descriptor,null,2)),[instructionName]:Buffer.concat([updated[instructionName],Buffer.from('\nLee POSE_T.txt y adjunta la guía correspondiente solo como referencia de pose. concept.png sigue definiendo el personaje.\n')])};
   }
  }
  if(['views','segment-references'].includes(kind)){
   const descriptor=JSON.parse(updated['UBICACIONES.json']);
   if(descriptor.productionAppearance?.revision!==productionAppearanceVersion){
    const parent=path.resolve(store.root,'..','projects',p.id,'codex',kind),workspace=path.resolve(descriptor.workspace);
    if(descriptor.kind!==kind||descriptor.projectId!==p.id||path.dirname(workspace)!==parent||! /^[\w-]+$/.test(path.basename(workspace)))throw Error('Invalid appearance workspace');
    const texts={};for(const entry of descriptor.entries){
     if(!['PROMPT.txt','INSTRUCCIONES.txt'].includes(entry.name)&&!(kind==='segment-references'&&/^prompts\/[\w-]+\.txt$/.test(entry.name)))continue;
     if(path.resolve(entry.path)!==path.resolve(workspace,entry.name))throw Error('Invalid appearance resource');
     texts[entry.name]=await fs.readFile(entry.path);
    }
    const resources=withProductionAppearance(texts,kind);
    for(const [name,content] of Object.entries(resources))if(!content.equals(texts[name])){
     const entry=descriptor.entries.find(e=>e.name===name);await fs.writeFile(entry.path,content);entry.sha256=createHash('sha256').update(content).digest('hex');
    }
    descriptor.productionAppearance={revision:productionAppearanceVersion};
    updated={...updated,'UBICACIONES.json':Buffer.from(JSON.stringify(descriptor,null,2))};
   }
  }
  if(kind==='texture-refinement'){
   const descriptor=JSON.parse(updated['UBICACIONES.json']);
   if(descriptor.refinementGuidance!==refinementGuidanceVersion){
    const parent=path.resolve(store.root,'..','projects',p.id,'codex',kind),workspace=path.resolve(descriptor.workspace);
    if(descriptor.kind!==kind||descriptor.projectId!==p.id||path.dirname(workspace)!==parent||! /^[\w-]+$/.test(path.basename(workspace)))throw Error('Invalid refinement workspace');
    const resources=await refinementSupportFiles();
    resources['SKILLS_REQUERIDAS.txt']=skillInstructions(['refinamiento-texturas-anime','refinamiento-rasgos-faciales-anime','normales-cabello-anime','normales-rostro-anime']);
    for(const [name,content] of Object.entries(resources)){
     const target=path.resolve(workspace,name);if(!target.startsWith(workspace+path.sep))throw Error('Invalid refinement resource');
     await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content);
     descriptor.entries=descriptor.entries.filter(e=>e.name!==name);descriptor.entries.push({name,path:target,sha256:createHash('sha256').update(content).digest('hex')});
    }
    descriptor.refinementGuidance=refinementGuidanceVersion;
    updated={...updated,'UBICACIONES.json':Buffer.from(JSON.stringify(descriptor,null,2))};
   }
  }
  if(['views','segmentation'].includes(kind)){
   const english=viewInstructions(updated);
   if(!updated['INSTRUCCIONES.txt']&&updated['INSTRUCTIONS.txt']?.equals(english['INSTRUCTIONS.txt'])&&updated===files)return bytes;
   updated=english;
  }
  if(updated===files)return bytes;
  const result=await zipBuffers(updated),temporary=filename+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temporary,result);await fs.rename(temporary,filename);return result;
 }
 const skills=['neck-finish','model-finish'].includes(kind)?['colocacion-personaje-por-referencias']:['refinamiento-texturas-anime','refinamiento-rasgos-faciales-anime','normales-cabello-anime','normales-rostro-anime'];
 files['SKILLS_REQUERIDAS.txt']=skillInstructions(skills);
 // Old instructions used a bundled skills/ prefix. Point these at the maintained copy.
 for(const name of Object.keys(files))if(/\.(txt|md)$/.test(name)&&!name.startsWith('skills/'))files[name]=Buffer.from(files[name].toString('utf8').replace(/skills\/(colocacion-personaje-por-referencias|refinamiento-texturas-anime|refinamiento-rasgos-faciales-anime)\//g,(_,skill)=>path.join(appRoot,'skills',skill)+path.sep));
 const result=await localInstructionPackage(store,p,kind,files,id);
 const temporary=filename+'.'+randomUUID()+'.tmp';await fs.writeFile(temporary,result);await fs.rename(temporary,filename);return result;
}

export async function localInstructionPackage(store,p,kind,files,id=randomUUID(),requiredSkills=['refinamiento-texturas-anime','refinamiento-rasgos-faciales-anime','normales-cabello-anime','normales-rostro-anime','colocacion-personaje-por-referencias'],linkedFiles=[]){
 if(!/^[\w-]+$/.test(kind)||!/^[\w-]+$/.test(id)||!/^[\w-]+$/.test(p.id))throw Error('Invalid local workspace');
 if(kind==='texture-refinement')files={...files,...await refinementSupportFiles()};
 if(kind==='views')files=await withPoseGuideFiles(files);
 files=withProductionAppearance(files,kind);
 const workspace=path.resolve(store.root,'..','projects',p.id,'codex',kind,id),entries=[];
 await fs.mkdir(workspace,{recursive:true});
 for(const [name,bytes] of Object.entries(files)){
  // Skills are maintained once in the application. Never embed duplicate copies.
  if(name.startsWith('skills/'))continue;
  const target=path.resolve(workspace,name);if(!target.startsWith(workspace+path.sep))throw Error('Invalid workspace resource');
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);
  entries.push({name,path:target,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 for(const entry of linkedFiles){
  const source=path.resolve(entry.path),projectRoot=path.resolve(store.root,p.id);
  if(!/^[\w.-]+$/.test(entry.name)||entries.some(e=>e.name===entry.name)||path.dirname(source)!==projectRoot)throw Error('Invalid linked model resource');
  entries.push({name:entry.name,path:source,sha256:createHash('sha256').update(await fs.readFile(source)).digest('hex')});
 }
 const first=['CONTINUAR.txt','INSTRUCCIONES.txt','INSTRUCTIONS.txt','PROMPT.txt'].filter(n=>entries.some(e=>e.name===n));
 const descriptor={schema:'workbench-local-instructions/v1',projectId:p.id,projectName:p.name,kind,workspace,outputDirectory:path.join(workspace,'output'),entries,skills:skillLocations(requiredSkills)};
 if(kind==='views')descriptor.poseGuidance={revision:tPoseGuideVersion,role:'pose-only',designAuthority:'concept.png'};
 if(['views','segment-references'].includes(kind))descriptor.productionAppearance={revision:productionAppearanceVersion};
 if(kind==='texture-refinement')descriptor.refinementGuidance=refinementGuidanceVersion;
 await fs.mkdir(descriptor.outputDirectory,{recursive:true});
 const instructions=`FITA · INSTRUCCIONES LOCALES · ${p.name}\nProyecto: ${p.id}\nEtapa: ${kind}\nEste ZIP contiene SOLO instrucciones y rutas. No contiene modelos, texturas, referencias, scripts ni skills. Todo está guardado en el proyecto local de la aplicación.\n\n1. Abre UBICACIONES.json y comprueba projectId. Directorio de trabajo EXACTO: ${workspace}\n2. Lee ${first.map(n=>path.join(workspace,n)).join(', ')} en ese orden. Si existe SKILLS_REQUERIDAS.txt en entries, léelo antes de trabajar. Cada nombre en entries identifica un archivo concreto y su ruta absoluta; no busques por todo el disco.\n3. Ejecuta los helpers indicados desde ese directorio. Los caminos relativos de las instrucciones se resuelven allí, no junto al ZIP descargado. Conserva entradas, manifiestos e identificadores. Guarda los resultados en ${descriptor.outputDirectory}, salvo que un helper indique otro nombre exacto de salida en workspace.\n4. Usa el helper ENTREGAR indicado en las instrucciones para devolver el resultado a FITA y espera su recibo imported. Si esa etapa usa importación desde la interfaz, sigue ese paso concreto. Los ZIP de resultados que esos helpers construyen son el protocolo interno de validación, no otro paquete que el usuario deba adjuntar a Codex. No escribas directamente en el almacén de activos ni apruebes costes por el usuario.\n5. Si una ruta no existe (otra máquina, proyecto movido o paquete antiguo), solicita regenerar este ZIP desde FITA; no adivines rutas ni uses otro proyecto.\n`;
 const wrapper=withVisualSpecification({'INSTRUCCIONES.txt':Buffer.from(instructions),'UBICACIONES.json':Buffer.from(JSON.stringify(descriptor,null,2))});
 return zipBuffers(['views','segmentation'].includes(kind)?viewInstructions(wrapper):wrapper);
}

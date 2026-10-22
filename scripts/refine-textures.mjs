import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {atlasImages,replaceAtlases} from './texture-layout.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
try{
 const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
 if(manifest.schema!=='workbench-texture-refinement/v1')throw Error('Manifest inválido');
 const mode=process.argv[2];if(!['extract','build'].includes(mode))throw Error('Usa extract o build');
 const catalog=[];
 await fs.mkdir(path.join(root,mode==='extract'?'atlases':'result'),{recursive:true});
 for(const part of ['head','body']){
  const source=await fs.readFile(path.join(root,'models',part+'.glb')),images=atlasImages(source),replacements=new Map();
  for(const im of images){const name=`${part}_${im.index}.${im.mime==='image/png'?'png':'jpg'}`;catalog.push({part,index:im.index,file:name,editable:im.editable,sha256:im.sha256});
   if(mode==='extract')await fs.writeFile(path.join(root,'atlases',name),im.bytes);
   else {const file=path.join(root,'edited',name);try{const bytes=await fs.readFile(file);if(!im.editable)throw Error('Mapa protegido: '+name);replacements.set(im.index,bytes);}catch(e){if(e.code!=='ENOENT')throw e;}}
  }
  if(mode==='build')await fs.writeFile(path.join(root,'result',part+'.glb'),replaceAtlases(source,replacements));
 }
 await fs.writeFile(path.join(root,'atlas-index.json'),JSON.stringify(catalog,null,2));
 console.log(mode==='extract'?'Atlas originales extraídos; guarda solo cambios en edited/.':'GLB creados en result/ conservando malla, UV y transformaciones.');
}catch(e){console.error(e.message);process.exitCode=1;}

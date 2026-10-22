import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {spawnSync} from 'node:child_process';
import yazl from 'yazl';
import {hash,safePath,verifyTree,listFiles} from './manager.mjs';
import {extensionDirectory,extensionInventory,extensionManifest} from './extension-folder.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output=path.resolve(process.argv[2]||path.join(root,'..','packages'));
const trial=process.argv.includes('--trial');
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const audit=spawnSync(process.execPath,[path.join(root,'distribution','audit.mjs')],{cwd:root,encoding:'utf8',windowsHide:true});
if(audit.status!==0)throw Error('Publication audit failed. No new package was created.\n'+audit.stdout+audit.stderr);
await fs.mkdir(output,{recursive:true});
const allow=JSON.parse(await fs.readFile(path.join(root,'distribution','source-files.json'),'utf8'));
const source=[];
for(const rel of allow){safePath(rel);const stat=await fs.lstat(path.join(root,rel));if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid source entry: '+rel);source.push({path:rel,bytes:await fs.readFile(path.join(root,rel))});}
// Only canonical, positively allowed extension assets enter either distribution.
const extensionFiles=source.filter(item=>item.path.startsWith('extension-tripo-studio/')).map(item=>({...item,path:item.path.slice('extension-tripo-studio/'.length)}));
const extension=[...extensionFiles,{path:extensionInventory,bytes:Buffer.from(JSON.stringify(extensionManifest(extensionFiles),null,2)+'\n')}];
const runtime=source.filter(item=>!item.path.startsWith('tests/')&&!['Iniciar.ps1','Detener.ps1','Preparar-Extension.ps1'].includes(item.path));
for(const rel of await listFiles(path.join(root,'dist')))runtime.push({path:'dist/'+rel,bytes:await fs.readFile(path.join(root,'dist',rel))});
const files=runtime.map(({path:rel,bytes})=>({path:rel,bytes:bytes.length,sha256:hash(bytes)})).sort((a,b)=>a.path.localeCompare(b.path));
const build=version+'-'+hash(Buffer.from(JSON.stringify(files))).slice(0,12);
const manifest={schema:1,launcherProtocol:1,version,build,files};
const manifestBuffer=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
async function zip(name,items){
  const file=path.join(output,name);const archive=new yazl.ZipFile();
  for(const item of items)archive.addBuffer(item.bytes,item.path);
  archive.end();await pipeline(archive.outputStream,createWriteStream(file,{flags:'wx'}));
  return {name,bytes:(await fs.stat(file)).size,sha256:hash(await fs.readFile(file))};
}
const appFiles=[...runtime,{path:'release-manifest.json',bytes:manifestBuffer}];
const reports=[];
if(!trial)reports.push(await zip('FITA-source.zip',[...source,...extension.map(item=>({...item,path:extensionDirectory+'/'+item.path}))]));
reports.push(await zip(trial?'FITA-trial-update.zip':'FITA-update.zip',appFiles));
const launchers=['Open FITA.cmd','Close FITA.cmd','Update FITA.cmd','FITA.ps1'];
const portable=[...appFiles.map(item=>({...item,path:'FITA/versions/'+build+'/'+item.path})),...source.filter(item=>launchers.includes(item.path)).map(item=>({...item,path:'FITA/'+item.path})),...extension.map(item=>({...item,path:'FITA/'+extensionDirectory+'/'+item.path})),{path:'FITA/active.json',bytes:Buffer.from(JSON.stringify({schema:1,version:build},null,2)+'\n')},{path:'FITA/README.txt',bytes:Buffer.from('FITA Windows release\r\n\r\nDouble-click Open FITA.cmd. First launch downloads required components.\r\nClose FITA.cmd stops the local server. Close only when all operations are idle.\r\nUpdate FITA.cmd checks stable published releases from catmart-xlvl/FITA.\r\nProject files live in user-data. Keep this folder when updating.\r\n\r\nTripo browser extension (one-time setup)\r\n1. In the browser used for Tripo, open Extensions and enable Developer mode.\r\n2. Choose Load unpacked and select FITA Extension beside this file.\r\n3. Open FITA Connections and the extension popup to pair and authorize commands.\r\nAfter updates, click Reload for the existing extension when idle. Keep this folder in place; do not remove the extension.\r\nSee versions/'+build+'/INSTALL.md for details.\r\n')}];
if(!trial)reports.push(await zip('FITA-Windows-x64.zip',portable));
await fs.writeFile(path.join(output,'SHA256SUMS.txt'),reports.map(r=>r.sha256+'  '+r.name).join('\n')+'\n',{flag:'wx'});
const config=JSON.parse(await fs.readFile(path.join(root,'distribution','config.json'),'utf8'));
await fs.writeFile(path.join(output,'package-report.json'),JSON.stringify({version,build,repository:config.repository,publication:trial?'pending-user-test':'prepared-for-authorized-publication',packages:reports,sourceFiles:source.length,runtimeFiles:files.length},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({version,build,packages:reports},null,2));

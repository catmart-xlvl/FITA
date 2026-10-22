import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import net from 'node:net';
import yauzl from 'yauzl';
import {prepareExtensionFolder,ensureExtensionFolder} from './extension-folder.mjs';

const appRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mutable=new Set(['data','projects','.runtime','node_modules','.git','FITA Extension']);
const maxBytes=512*1024**2;
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
export function normalizeInstallationRoot(root){
  if(typeof root!=='string'||!path.win32.isAbsolute(root))throw Error('Invalid installation location marker. Keep your project data and restore the original installation folder.');
  return path.win32.normalize(root).replace(/\\+$/,'').toLowerCase();
}
export async function assertInstallationLocation(root){
  let marker;try{marker=await readJson(path.join(root,'runtime','install-location.json'));}catch(error){if(error.code==='ENOENT')return null;throw Error('The installation location marker could not be read. Keep your project data and restore the original installation folder.');}
  if(marker.schema!==1||typeof marker.installedRoot!=='string')throw Error('Invalid installation location marker. Keep your project data and restore the original installation folder.');
  if(normalizeInstallationRoot(marker.installedRoot)!==normalizeInstallationRoot(path.resolve(root))){
    throw Error('This FITA installation was moved.\nOriginal folder: '+marker.installedRoot+'\nCurrent folder: '+path.resolve(root)+'\nOpening and updating are blocked. Move the entire FITA folder back to its original location to open it and export your projects. To use a different location, install a fresh copy there and import your .fita backups. Keep this folder and user-data until all projects are backed up. No files were migrated or deleted.');
  }
  return marker;
}
export async function rememberInstallationLocation(root){
  const previous=await assertInstallationLocation(root);if(previous)return previous;
  const marker={schema:1,installedRoot:path.resolve(root)};
  await fs.mkdir(path.join(root,'runtime'),{recursive:true});
  await atomicJson(path.join(root,'runtime','install-location.json'),marker);return marker;
}
export function safePath(name){
  if(typeof name!=='string'||!name||name.length>240||name.includes('\\')||/[\x00-\x1f:]/.test(name)||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error('Unsafe release path.');
  return name;
}
export async function listFiles(root,skip=new Set()){
  const out=[];
  async function visit(dir,prefix=''){
    for(const item of await fs.readdir(dir,{withFileTypes:true})){
      if(!prefix&&skip.has(item.name))continue;
      const rel=prefix+item.name,abs=path.join(dir,item.name);
      if(item.isSymbolicLink())throw Error('Unexpected link: '+rel);
      if(item.isDirectory())await visit(abs,rel+'/');else if(item.isFile())out.push(rel);
      else throw Error('Unsupported file: '+rel);
    }
  }
  await visit(root);return out.sort();
}
export async function verifyTree(root,manifest){
  if(manifest.schema!==1||!Array.isArray(manifest.files)||manifest.files.length>10000)throw Error('Invalid release manifest.');
  const expected=new Map(),folded=new Set();
  for(const item of manifest.files){
    safePath(item.path);
    if(mutable.has(item.path.split('/')[0])||expected.has(item.path)||folded.has(item.path.toLowerCase())||!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('Invalid manifest file.');
    expected.set(item.path,item);folded.add(item.path.toLowerCase());
  }
  const actual=await listFiles(root,mutable);
  for(const rel of actual){
    if(rel==='release-manifest.json')continue;
    const item=expected.get(rel);if(!item)throw Error('Unexpected or modified installation file: '+rel);
    const bytes=await fs.readFile(path.join(root,rel));
    if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw Error('Checksum mismatch: '+rel);
    expected.delete(rel);
  }
  if(expected.size)throw Error('Missing release file: '+expected.keys().next().value);
  return true;
}
export async function extractRelease(zipFile,dest){
  await fs.mkdir(dest,{recursive:false});
  const zip=await new Promise((ok,no)=>yauzl.open(zipFile,{lazyEntries:true,autoClose:true},(e,z)=>e?no(e):ok(z)));
  let total=0,count=0;const names=new Set();
  await new Promise((ok,no)=>{
    zip.on('error',no);zip.on('end',ok);
    zip.on('entry',entry=>{(async()=>{
      const name=entry.fileName,dir=name.endsWith('/'),rel=dir?name.slice(0,-1):name;
      safePath(rel);const key=rel.toLowerCase();
      if(names.has(key))throw Error('Duplicate ZIP path.');names.add(key);
      const mode=(entry.externalFileAttributes>>>16)&0xf000;
      if(mode&&mode!==0x8000&&mode!==0x4000)throw Error('Links and special files are forbidden.');
      if(++count>10000||(total+=entry.uncompressedSize)>maxBytes||entry.generalPurposeBitFlag&1)throw Error('Release ZIP exceeds limits or is encrypted.');
      if(mutable.has(rel.split('/')[0]))throw Error('Mutable directories cannot be shipped in a release.');
      const target=path.join(dest,...rel.split('/'));
      if(dir)await fs.mkdir(target,{recursive:true});else{
        await fs.mkdir(path.dirname(target),{recursive:true});
        const stream=await new Promise((yes,fail)=>zip.openReadStream(entry,(e,s)=>e?fail(e):yes(s)));
        await pipeline(stream,createWriteStream(target,{flags:'wx'}));
      }
      zip.readEntry();
    })().catch(e=>{zip.close();no(e);});});
    zip.readEntry();
  });
  const manifest=await readJson(path.join(dest,'release-manifest.json'));
  await verifyTree(dest,manifest);return manifest;
}
async function atomicJson(file,value){
  const tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await fs.rename(tmp,file);
}
async function active(root){
  const pointer=await readJson(path.join(root,'active.json'));
  if(pointer.schema!==1||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(pointer.version))throw Error('Invalid installation pointer.');
  return {pointer,dir:path.join(root,'versions',pointer.version)};
}
export function processMatches(record,observed){
  const normalized=value=>typeof value==='string'&&path.win32.isAbsolute(value)?path.win32.normalize(value).toLowerCase():null;
  const executable=normalized(record.executable),entry=normalized(record.entry),args=observed.Arguments;
  return !!executable&&!!entry&&normalized(observed.ExecutablePath)===executable&&Array.isArray(args)&&args.length===2&&normalized(args[0])===executable&&normalized(args[1])===entry;
}
export function inspectWindowsProcess(processId){
  const query=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(appRoot,'distribution','process-info.ps1'),'-ProcessId',String(processId)],{encoding:'utf8',windowsHide:true,timeout:15000});
  if(query.error||query.status!==0)throw Error('Cannot verify FITA process ownership. No process was stopped.');
  if(!query.stdout.trim())return null;
  return JSON.parse(query.stdout);
}
export async function processState(root){
  let record;try{record=await readJson(path.join(root,'runtime','server.json'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(!Number.isInteger(record.pid)||record.pid<=0)throw Error('Invalid process record.');
  if(process.platform!=='win32')throw Error('This launcher supports Windows only.');
  // PID reuse must never allow this launcher to close another installation.
  const observed=inspectWindowsProcess(record.pid);if(!observed)return null;
  if(!processMatches(record,observed))throw Error('The saved process does not match this FITA installation. No process was stopped.');
  return record;
}
async function linkedData(root,dir){
  for(const [name,target] of [['data','user-data/data'],['projects','user-data/projects'],['.runtime','runtime']]){
    const dest=path.join(root,target),link=path.join(dir,name);await fs.mkdir(dest,{recursive:true});
    try{const resolved=await fs.realpath(link);if(resolved.toLowerCase()!==(await fs.realpath(dest)).toLowerCase())throw Error('Unexpected data path: '+name);}
    catch(e){
      if(e.code!=='ENOENT')throw e;
      try{const existing=await fs.lstat(link);if(existing.isSymbolicLink())throw Error('This installation moved after setup. Restore its previous folder or import a .fita project into a fresh installation. No project data was replaced.');throw Error('Unexpected existing data directory.');}
      catch(check){if(check.code!=='ENOENT')throw check;}
      await fs.symlink(dest,link,'junction');
    }
  }
}
async function lock(root,callback){
  await fs.mkdir(path.join(root,'runtime'),{recursive:true});
  let handle;try{handle=await fs.open(path.join(root,'runtime','manager.lock'),'wx');}catch(e){if(e.code==='EEXIST')throw Error('Another FITA launcher is busy. If it crashed, close all FITA launcher windows before removing runtime/manager.lock.');throw e;}
  try{return await callback();}finally{await handle.close();await fs.unlink(path.join(root,'runtime','manager.lock'));}
}
async function npmInstall(dir){
  const cli=process.env.FITA_NPM_CLI;if(!cli)throw Error('Use Update FITA.cmd to install updates.');
  await new Promise((ok,no)=>{const child=spawn(process.execPath,[cli,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:dir,stdio:'inherit',windowsHide:true});child.on('error',no);child.on('exit',code=>code===0?ok():no(Error('Component installation failed; previous version remains active.')));});
  await fs.access(path.join(dir,'node_modules','sharp','package.json'));
  const probe=spawnSync(process.execPath,['-e',"require('sharp');require('express');require('yauzl')"],{cwd:dir,windowsHide:true});
  if(probe.status!==0)throw Error('Installed components could not load; previous version remains active.');
  await fs.writeFile(path.join(dir,'node_modules','.fita-lock-sha256'),hash(await fs.readFile(path.join(dir,'package-lock.json')))+'\n');
}
export async function installArchive(root,zipFile,{prepare=npmInstall,isRunning=processState,expectedVersion,activatePointer=atomicJson}={}){
  await assertInstallationLocation(root);
  const current=await active(root);
  if(await isRunning(root))throw Error('Close FITA before updating. Projects and active tasks must be idle.');
  await verifyTree(current.dir,await readJson(path.join(current.dir,'release-manifest.json')));
  const staging=path.join(root,'versions','staging-'+randomUUID());
  const manifest=await extractRelease(zipFile,staging);
  if(expectedVersion&&manifest.version!==expectedVersion)throw Error('Release tag and manifest version do not match.');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(manifest.build)||manifest.build===current.pointer.version)throw Error('Release build is invalid or already installed.');
  if(manifest.launcherProtocol!==1)throw Error('This release requires a new launcher. Download it separately.');
  await fs.access(path.join(staging,'dist','index.html'));
  await prepare(staging);await verifyTree(staging,manifest);
  const extension=await prepareExtensionFolder(root,staging);
  const dest=path.join(root,'versions',manifest.build);await fs.rename(staging,dest);
  try{
    await linkedData(root,dest);await extension.activate();
    await activatePointer(path.join(root,'active.json'),{schema:1,version:manifest.build,previous:current.pointer.version});
  }catch(error){
    await extension.rollback();
    // Retain the failed version under its original staging path, so a retry can
    // use the same release build without deleting folders or changing user data.
    await fs.rename(dest,staging);throw error;
  }
  return manifest;
}
async function download(url,file,expected){
  if(!/^https:\/\//.test(url)||!/^sha256:[a-f0-9]{64}$/.test(expected||''))throw Error('The release has no supported SHA-256 digest.');
  const response=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!response.ok||!response.body)throw Error('Release download failed: '+response.status);
  let bytes=0;const digest=createHash('sha256'),out=createWriteStream(file,{flags:'wx'});
  async function* checked(){for await(const chunk of response.body){bytes+=chunk.length;if(bytes>maxBytes)throw Error('Release download exceeds size limit.');digest.update(chunk);yield chunk;}}
  await pipeline(checked(),out);
  if('sha256:'+digest.digest('hex')!==expected)throw Error('Release checksum mismatch; previous version remains active.');
}
export async function checkForUpdates(root,{request=fetch}={}){
  await assertInstallationLocation(root);
  let dir=root;try{({dir}=await active(root));}catch(e){if(e.code!=='ENOENT')throw e;}
  const config=await readJson(path.join(dir,'distribution','config.json'));
  // A user-supplied origin lives outside app files and survives updates.
  let settings={};try{settings=await readJson(path.join(root,'settings.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const repository=settings.repository??config.repository;
  if(!repository)throw Error('GitHub repository is not configured yet. No update was downloaded.');
  if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))throw Error('Repository must be OWNER/REPOSITORY.');
  const response=await request(`https://api.github.com/repos/${repository}/releases/latest`,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('GitHub release is unavailable ('+response.status+'). Private repositories need a different distribution plan.');
  const release=await response.json();if(release.draft||release.prerelease)throw Error('A stable published release is required.');
  let installed;try{installed=await readJson(path.join(dir,'release-manifest.json'));}catch(e){if(e.code!=='ENOENT')throw e;installed={version:'0.1.0-preview.1'};}
  if(release.tag_name==='v'+installed.version)return {status:'current',version:installed.version,repository};
  const stable=/^v(\d+)\.(\d+)\.(\d+)$/.exec(release.tag_name||'');
  if(!stable)throw Error('The release tag must use vMAJOR.MINOR.PATCH.');
  const current=/^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(installed.version);
  if(!current)throw Error('The installed version is invalid.');
  let order=0;for(let i=1;i<=3;i++){order=Math.sign(Number(stable[i])-Number(current[i]));if(order)break;}
  if(order<0||(order===0&&!current[4]))return {status:'current',version:installed.version,repository};
  const item=release.assets?.find(a=>a.name===config.assetName);if(!item)throw Error('The Windows release asset is missing.');
  if(!/^sha256:[a-f0-9]{64}$/.test(item.digest||''))throw Error('The release has no supported SHA-256 digest.');
  return {status:'available',version:installed.version,targetVersion:release.tag_name.slice(1),repository,item};
}
export async function update(root){
  await assertInstallationLocation(root);
  if(await processState(root))throw Error('Close FITA before updating.');
  const result=await checkForUpdates(root);
  if(result.status==='current'){console.log('FITA is up to date.');return;}
  const item=result.item;
  const file=path.join(root,'runtime','update-'+randomUUID()+'.zip');await download(item.browser_download_url,file,item.digest);
  const manifest=await installArchive(root,file,{expectedVersion:result.targetVersion});console.log('Updated FITA to '+manifest.version+'. Previous version retained. When idle, click Reload for the existing FITA extension in your browser. Keep its FITA Extension folder and do not remove it.');
}
export async function command(action,root){
  root=path.resolve(root);
  if(action==='open'||action==='update')await assertInstallationLocation(root);
  return lock(root,async()=>{
    if(action==='update'){try{await active(root);}catch{throw Error('Automatic updates require the portable Windows release. Source checkouts are updated manually.');}return update(root);}
    if(action==='status'){console.log(await processState(root)?'FITA is running.':'FITA is closed.');return;}
    if(action==='close'){
      const record=await processState(root);if(!record){console.log('FITA is already closed.');return;}
      // Express cannot know whether an external paid operation is idle. Closing is explicit.
      process.kill(record.pid);await fs.unlink(path.join(root,'runtime','server.json'));console.log('FITA closed. Saved projects remain on disk.');return;
    }
    if(action!=='open')throw Error('Unknown launcher action.');
    const running=await processState(root);
    let dir=appRoot;try{({dir}=await active(root));await linkedData(root,dir);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!running)await ensureExtensionFolder(root,dir);
    const port=Number(process.env.PORT||4317);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local port.');
    const url=`http://127.0.0.1:${port}`;
    if(!running){
      await new Promise((ok,no)=>{const probe=net.createServer();probe.once('error',()=>no(Error('The local port is already in use by another installation. Close that installation first.')));probe.listen(port,'127.0.0.1',()=>probe.close(ok));});
      const log=await fs.open(path.join(root,'runtime','server.log'),'a'),entry=path.join(dir,'server','index.js');
      const child=spawn(process.execPath,[entry],{cwd:dir,env:{...process.env,FITA_INSTALL_ROOT:root},detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
      await new Promise((ok,no)=>{child.once('spawn',ok);child.once('error',no);});child.unref();await log.close();
      await atomicJson(path.join(root,'runtime','server.json'),{pid:child.pid,entry,executable:process.execPath,port});
      let ready=false;for(let i=0;i<60;i++){try{const result=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});const info=await result.json();if(info.ok&&info.app==='fita'){ready=true;break;}}catch{}await new Promise(ok=>setTimeout(ok,500));}
      if(!ready)throw Error('FITA did not start. Check runtime/server.log.');
    }
    await rememberInstallationLocation(root);
    const openUrl=`http://127.0.0.1:${running?.port||port}`;
    console.log('FITA is ready: '+openUrl);
    if(process.env.FITA_NO_BROWSER!=='1'){
      const browser=spawnSync('powershell.exe',['-NoProfile','-Command',`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Start-Process -FilePath '${openUrl}' -ErrorAction Stop`],{encoding:'utf8',windowsHide:true,timeout:15000});
      const opened=!browser.error&&browser.status===0;
      await atomicJson(path.join(root,'runtime','browser-open.json'),{at:new Date().toISOString(),url:openUrl,requestSucceeded:opened,exitCode:browser.status,error:browser.error?.message||browser.stderr?.trim()||null});
      if(!opened)throw Error('FITA is running, but the browser could not open automatically. Open '+openUrl+' in your browser. Details: runtime/browser-open.json.');
      console.log('Browser open request sent.');
    }
  });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{await command(process.argv[2]||'open',process.argv[3]||appRoot);}catch(error){console.error('FITA: '+error.message);process.exitCode=1;}
}

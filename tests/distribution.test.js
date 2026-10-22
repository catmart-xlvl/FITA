import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';
import yazl from 'yazl';
import {hash,safePath,verifyTree,extractRelease,installArchive,update,checkForUpdates,normalizeInstallationRoot,assertInstallationLocation,rememberInstallationLocation,command,processMatches,inspectWindowsProcess,processState} from '../distribution/manager.mjs';
import {createApp} from '../server/app.js';
import {ensureExtensionFolder,prepareExtensionFolder,extensionDirectory,extensionInventory,extensionFolderInfo} from '../distribution/extension-folder.mjs';

async function workspace(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'fita-distribution-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
function manifest(files,build='new'){return {schema:1,launcherProtocol:1,version:'0.2.0',build,files:Object.entries(files).map(([p,b])=>({path:p,bytes:Buffer.byteLength(b),sha256:hash(Buffer.from(b))}))};}
async function tree(root,files,build){await fs.mkdir(root,{recursive:true});for(const [p,b]of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,p)),{recursive:true});await fs.writeFile(path.join(root,p),b);}const m=manifest(files,build);await fs.writeFile(path.join(root,'release-manifest.json'),JSON.stringify(m));return m;}
async function zip(file,files,m=manifest(files)){const z=new yazl.ZipFile();for(const [p,b]of Object.entries({...files,'release-manifest.json':JSON.stringify(m)}))z.addBuffer(Buffer.from(b),p);z.end();await pipeline(z.outputStream,createWriteStream(file));return file;}
const extensionFixture=(version='0.2.77')=>({'extension-tripo-studio/manifest.json':JSON.stringify({manifest_version:3,version}),'extension-tripo-studio/background.js':'// '+version});
async function installed(root){await tree(path.join(root,'versions','old'),{'dist/index.html':'old','distribution/config.json':JSON.stringify({repository:null}),...extensionFixture()},'old');await fs.writeFile(path.join(root,'active.json'),JSON.stringify({schema:1,version:'old'}));await fs.mkdir(path.join(root,'user-data'),{recursive:true});await fs.writeFile(path.join(root,'user-data','sentinel.txt'),'private project');}

test('release paths reject traversal, drive paths, Windows aliases and alternate streams',()=>{
 for(const p of ['../data','a/../b','/absolute','C:/x','a\\b','a:stream','a//b','CON','a/nul.txt','file.','file '])assert.throws(()=>safePath(p));
 assert.equal(safePath('server/example.js'),'server/example.js');
});
test('release verification catches missing, altered and unexpected application files',async t=>{
 const root=await workspace(t),m=await tree(root,{'app.txt':'approved'});
 await verifyTree(root,m);await fs.writeFile(path.join(root,'app.txt'),'tampered');await assert.rejects(verifyTree(root,m),/Checksum/);
 await fs.writeFile(path.join(root,'app.txt'),'approved');await fs.writeFile(path.join(root,'extra.txt'),'x');await assert.rejects(verifyTree(root,m),/Unexpected/);
 await fs.unlink(path.join(root,'extra.txt'));await fs.unlink(path.join(root,'app.txt'));await assert.rejects(verifyTree(root,m),/Missing/);
});
test('a valid ZIP extracts only after every manifest hash is checked',async t=>{
 const root=await workspace(t),archive=await zip(path.join(root,'release.zip'),{'dist/index.html':'new'});
 assert.equal((await extractRelease(archive,path.join(root,'staged'))).build,'new');
});
test('ZIP files cannot introduce project data or unsigned additional files',async t=>{
 const root=await workspace(t),archive=await zip(path.join(root,'release.zip'),{'data/private.json':'x'});
 await assert.rejects(extractRelease(archive,path.join(root,'staged')),/Mutable/);
 const extra=await zip(path.join(root,'extra.zip'),{'a':'x','extra':'y'},manifest({a:'x'}));await assert.rejects(extractRelease(extra,path.join(root,'extra')),/Unexpected/);
});
test('manifest rejects Windows case collisions and mutable directory entries',async t=>{
 const root=await workspace(t);for(const files of [{A:'a',a:'b'},{'projects/private':'x'}])await assert.rejects(verifyTree(root,manifest(files)),/Invalid manifest/);
});
test('a dependency failure leaves the active pointer and private data unchanged',async t=>{
 const root=await workspace(t);await installed(root);const archive=await zip(path.join(root,'update.zip'),{'dist/index.html':'new'});
 await assert.rejects(installArchive(root,archive,{isRunning:async()=>null,prepare:async()=>{throw Error('simulated npm failure');}}),/simulated/);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'active.json'))).version,'old');assert.equal(await fs.readFile(path.join(root,'user-data','sentinel.txt'),'utf8'),'private project');
});
test('active FITA blocks updates before extraction or dependency installation',async t=>{
 const root=await workspace(t);await installed(root);await assert.rejects(installArchive(root,'absent.zip',{isRunning:async()=>({pid:1}),prepare:async()=>assert.fail()}),/Close FITA/);
});
test('local application modifications are preserved and block automatic replacement',async t=>{
 const root=await workspace(t);await installed(root);await fs.writeFile(path.join(root,'versions','old','dist','index.html'),'custom');await assert.rejects(installArchive(root,'absent.zip',{isRunning:async()=>null}),/Checksum/);
 assert.equal(await fs.readFile(path.join(root,'versions','old','dist','index.html'),'utf8'),'custom');
});
test('successful activation retains previous version and shares the existing project folder',async t=>{
 const root=await workspace(t);await installed(root);const archive=await zip(path.join(root,'update.zip'),{'dist/index.html':'new',...extensionFixture('0.2.78')});
 await ensureExtensionFolder(root,path.join(root,'versions','old'));
 const stable=path.join(root,extensionDirectory);await fs.mkdir(path.join(root,'runtime'),{recursive:true});
 const devices=Buffer.from('{"remembered":"unchanged fixture, not a credential"}');await fs.writeFile(path.join(root,'runtime','studio-devices.json'),devices);
 await installArchive(root,archive,{isRunning:async()=>null,prepare:async()=>{}});
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'active.json'))),{schema:1,version:'new',previous:'old'});
 assert.equal(await fs.readFile(path.join(root,'versions','old','dist','index.html'),'utf8'),'old');
 assert.equal(await fs.realpath(path.join(root,'versions','new','data')),await fs.realpath(path.join(root,'user-data','data')));
 assert.equal(await fs.readFile(path.join(root,'user-data','sentinel.txt'),'utf8'),'private project');
 assert.equal((await fs.lstat(stable)).isSymbolicLink(),false);
 assert.equal(JSON.parse(await fs.readFile(path.join(stable,'manifest.json'))).version,'0.2.78');
 assert.deepEqual(await fs.readFile(path.join(root,'runtime','studio-devices.json')),devices);
 assert.equal((await extensionFolderInfo(root,path.join(root,'versions','new'))).extensionFolder,stable);
});

test('root extension setup is idempotent and preserves its actual directory and file times',async t=>{
 const root=await workspace(t);await installed(root);const dir=path.join(root,'versions','old');
 assert.equal(await ensureExtensionFolder(root,dir),true);
 const file=path.join(root,extensionDirectory,'manifest.json'),before=await fs.stat(file);
 assert.equal(await ensureExtensionFolder(root,dir),false);
 assert.equal((await fs.stat(file)).mtimeMs,before.mtimeMs);
 assert.equal((await fs.realpath(path.join(root,extensionDirectory))),path.join(root,extensionDirectory));
});

test('local extension edits or unknown files block replacement and preserve active app and browser records',async t=>{
 const root=await workspace(t);await installed(root);await ensureExtensionFolder(root,path.join(root,'versions','old'));
 const stable=path.join(root,extensionDirectory),file=path.join(stable,'background.js');
 await fs.writeFile(file,'local custom change');
 const archive=await zip(path.join(root,'update.zip'),{'dist/index.html':'new',...extensionFixture('0.2.78')});
 await assert.rejects(installArchive(root,archive,{isRunning:async()=>null,prepare:async()=>{}}),/local changes/);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'active.json'))).version,'old');
 assert.equal(await fs.readFile(file,'utf8'),'local custom change');
 await fs.writeFile(file,extensionFixture()['extension-tripo-studio/background.js']);await fs.writeFile(path.join(stable,'unrecognized.txt'),'keep');
 await assert.rejects(ensureExtensionFolder(root,path.join(root,'versions','old')),/local changes/);
});

test('failed app activation rolls back the real extension directory and keeps both file sets',async t=>{
 const root=await workspace(t);await installed(root);await ensureExtensionFolder(root,path.join(root,'versions','old'));
 const archive=await zip(path.join(root,'update.zip'),{'dist/index.html':'new',...extensionFixture('0.2.78')});
 await assert.rejects(installArchive(root,archive,{isRunning:async()=>null,prepare:async()=>{},activatePointer:async()=>{throw Error('simulated pointer failure');}}),/simulated pointer/);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'active.json'))).version,'old');
 assert.equal(JSON.parse(await fs.readFile(path.join(root,extensionDirectory,'manifest.json'))).version,'0.2.77');
 assert((await fs.readdir(path.join(root,'runtime'))).some(n=>n.startsWith('extension-unactivated-')));
 await installArchive(root,archive,{isRunning:async()=>null,prepare:async()=>{}});
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'active.json'))).version,'new');
 assert.equal(JSON.parse(await fs.readFile(path.join(root,extensionDirectory,'manifest.json'))).version,'0.2.78');
});

test('extension setup refuses linked destinations and detects edits after preparation',async t=>{
 const root=await workspace(t);await installed(root);const appDir=path.join(root,'versions','old');await ensureExtensionFolder(root,appDir);
 const next=path.join(root,'next');await tree(next,extensionFixture('0.2.78'),'next');
 const transaction=await prepareExtensionFolder(root,next);
 await fs.writeFile(path.join(root,extensionDirectory,'background.js'),'changed during preparation');
 await assert.rejects(transaction.activate(),/local changes/);
 const linkedRoot=path.join(root,'linked');await fs.mkdir(linkedRoot);await fs.symlink(path.join(root,extensionDirectory),path.join(linkedRoot,extensionDirectory),'junction');
 await assert.rejects(ensureExtensionFolder(linkedRoot,appDir),/real directory/);
});

test('opening after an interrupted folder swap restores the active version at the same path',async t=>{
 const root=await workspace(t);await installed(root);const appDir=path.join(root,'versions','old');await ensureExtensionFolder(root,appDir);
 const next=path.join(root,'next');await tree(next,extensionFixture('0.2.78'),'next');
 const change=await prepareExtensionFolder(root,next);await change.activate();
 // Simulate stopping before active.json changed; next startup trusts the active app.
 await ensureExtensionFolder(root,appDir);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,extensionDirectory,'manifest.json'))).version,'0.2.77');
 await fs.rename(path.join(root,extensionDirectory),path.join(root,'runtime','interrupted-backup'));
 await ensureExtensionFolder(root,appDir);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,extensionDirectory,'manifest.json'))).version,'0.2.77');
 await fs.access(path.join(root,extensionDirectory,extensionInventory));
});
test('missing GitHub configuration stops without network or production actions',async t=>{
 const root=await workspace(t);await installed(root);await assert.rejects(update(root),/not configured/);
});
test('release lookup covers unchanged, newer, older and failed network responses without writes',async t=>{
 const root=await workspace(t);await installed(root);const config=path.join(root,'versions','old','distribution','config.json');await fs.writeFile(config,JSON.stringify({repository:'example/fita',assetName:'FITA-update.zip'}));
 const reply=tag=>async()=>({ok:true,json:async()=>({tag_name:tag,assets:[{name:'FITA-update.zip',digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://example.invalid/fixture.zip'}]})});
 assert.equal((await checkForUpdates(root,{request:reply('v0.2.0')})).status,'current');
 assert.equal((await checkForUpdates(root,{request:reply('v0.3.0')})).status,'available');
 assert.equal((await checkForUpdates(root,{request:reply('v0.1.0')})).status,'current');
 await assert.rejects(checkForUpdates(root,{request:async()=>{throw Error('simulated offline');}}),/simulated offline/);
 await assert.rejects(checkForUpdates(root,{request:async()=>({ok:false,status:404})}),/unavailable/);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'active.json'))).version,'old');
});
test('a release tag mismatch cannot activate a valid but different archive',async t=>{
 const root=await workspace(t);await installed(root);const archive=await zip(path.join(root,'update.zip'),{'dist/index.html':'new'});
 await assert.rejects(installArchive(root,archive,{isRunning:async()=>null,prepare:async()=>{},expectedVersion:'99.0.0'}),/do not match/);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'active.json'))).version,'old');
});
test('distribution routes use the installation path and expose no release download capability',async t=>{
 const root=await workspace(t),{app}=await createApp({dataDir:path.join(root,'data'),distribution:{extensionFolder:path.join(root,'extension-tripo-studio'),check:async()=>({status:'available',targetVersion:'1.0.0',item:{secret:'not sent'}})}});
 const server=app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));t.after(()=>new Promise(ok=>server.close(ok)));
 const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await(await fetch(base+'/api/distribution/info')).json()).extensionFolder,path.join(root,'extension-tripo-studio'));
 assert.deepEqual(await(await fetch(base+'/api/distribution/updates')).json(),{status:'available',targetVersion:'1.0.0'});
 const blocked=await fetch(base+'/api/distribution/info',{headers:{Origin:'https://example.invalid'}});assert.equal(blocked.status,403);
});
test('installation roots normalize Windows case, separators and trailing separators',()=>{
 assert.equal(normalizeInstallationRoot('C:\\Chosen folder\\FITA\\'),normalizeInstallationRoot('c:/chosen folder/./FITA'));
 assert.equal(normalizeInstallationRoot('D:\\Folder\\nested\\..\\FITA'),normalizeInstallationRoot('d:/folder/fita/'));
 assert.throws(()=>normalizeInstallationRoot('relative/folder'),/Invalid installation/);
});
test('an untouched extracted folder has no registered location until setup succeeds',async t=>{
 const root=await workspace(t);assert.equal(await assertInstallationLocation(root),null);
 await assert.rejects(fs.access(path.join(root,'runtime')),{code:'ENOENT'});
});
test('first successful setup remembers the chosen root and internal version changes preserve it',async t=>{
 const parent=await workspace(t),root=path.join(parent,'Chosen ñ 日本');await fs.mkdir(root);
 const marker=await rememberInstallationLocation(root),file=path.join(root,'runtime','install-location.json'),bytes=await fs.readFile(file);
 assert.equal(marker.installedRoot,path.resolve(root));assert.deepEqual(await assertInstallationLocation(root),marker);
 await fs.writeFile(path.join(root,'active.json'),JSON.stringify({schema:1,version:'new-internal-version'}));
 assert.deepEqual(await rememberInstallationLocation(root),marker);assert.deepEqual(await fs.readFile(file),bytes);
});
test('moving an installation blocks open and updates before any writes or downloads and preserves data',async t=>{
 const parent=await workspace(t),root=path.join(parent,'First ñ 日本'),moved=path.join(parent,'Moved ñ 日本');await fs.mkdir(root);
 await rememberInstallationLocation(root);await fs.mkdir(path.join(root,'user-data'));await fs.writeFile(path.join(root,'user-data','project.txt'),'preserve this project');
 const marker=await fs.readFile(path.join(root,'runtime','install-location.json'));await fs.rename(root,moved);
 for(const action of ['open','update'])await assert.rejects(command(action,moved),/This FITA installation was moved/);
 await assert.rejects(update(moved),/original location/);
 await assert.rejects(checkForUpdates(moved,{request:async()=>assert.fail('Network must not be called')}),/\.fita backups/);
 await assert.rejects(installArchive(moved,'missing.zip',{isRunning:async()=>assert.fail('No update preparation allowed')}),/user-data/);
 assert.deepEqual(await fs.readFile(path.join(moved,'runtime','install-location.json')),marker);
 assert.equal(await fs.readFile(path.join(moved,'user-data','project.txt'),'utf8'),'preserve this project');
 assert.deepEqual(await fs.readdir(path.join(moved,'runtime')),['install-location.json']);
});
test('process matching requires the exact executable and complete script argument',()=>{
 const record={executable:'C:\\Program Files\\nodejs\\node.exe',entry:'F:\\FITA\\server\\index.js'};
 const observed={ExecutablePath:record.executable,Arguments:[record.executable,record.entry]};
 assert(processMatches(record,observed));
 for(const bad of [{...observed,Arguments:[record.executable,record.entry+'.other']},{...observed,Arguments:[record.executable,'F:\\Other\\server\\index.js']},{...observed,Arguments:[record.executable,record.entry,'--extra']},{...observed,ExecutablePath:'F:\\Other\\node.exe'},{...observed,ExecutablePath:null},{...observed,Arguments:[]}])assert.equal(processMatches(record,bad),false);
});
for(const folder of ['WithoutSpaces','Spaces ñ 日本'])test('native process ownership works for '+folder,async t=>{
 const parent=await workspace(t),root=path.join(parent,folder),entry=path.join(root,'server','index.js');await fs.mkdir(path.dirname(entry),{recursive:true});await fs.writeFile(entry,'setInterval(()=>{},1000);');
 const child=spawn(process.execPath,[entry],{windowsHide:true,stdio:'ignore'});await new Promise((ok,no)=>{child.once('spawn',ok);child.once('error',no);});t.after(()=>{if(child.exitCode===null)child.kill();});
 await fs.mkdir(path.join(root,'runtime'));const record={pid:child.pid,entry,executable:process.execPath};await fs.writeFile(path.join(root,'runtime','server.json'),JSON.stringify(record));
 const observed=inspectWindowsProcess(child.pid);assert.deepEqual(observed.Arguments,[process.execPath,entry]);assert.equal((await processState(root)).pid,child.pid);
 await fs.writeFile(path.join(root,'runtime','server.json'),JSON.stringify({...record,entry:path.join(root,'unrelated.js')}));
 await assert.rejects(command('close',root),/No process was stopped/);assert.equal(child.exitCode,null);process.kill(child.pid,0);
});

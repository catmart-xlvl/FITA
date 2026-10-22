import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Store,emptyProject} from '../server/storage.js';
import {exportProject,importProject} from '../server/project-archive.js';
import {publishArchive} from '../server/archive-publication.js';
async function env(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'archive-publication-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new Store(path.join(root,'data'));await store.init();return {root,store};}
async function staged(e){const project=emptyProject('Pending import'),staging=path.join(e.store.root,'.import-'+randomUUID());for(const area of ['data','workspace']){await fs.mkdir(path.join(staging,area),{recursive:true});await fs.writeFile(path.join(staging,area,'sentinel.txt'),area+' preserved');}return {project,staging};}
test('reimport after trash reserves the old identity and never overwrites its workspace or trash',async t=>{
 const e=await env(t),p=emptyProject('Archive original'),other=emptyProject('Keep other project');await e.store.save(p);await e.store.save(other);
 const asset=await e.store.asset(p,Buffer.from('original asset'),'glb','fixture'),workspace=path.join(e.root,'projects',p.id);await fs.mkdir(workspace,{recursive:true});await fs.writeFile(path.join(workspace,'work.txt'),'old workspace');
 const archive=path.join(e.root,'original.fita');await exportProject({store:e.store,id:p.id,dest:archive});
 const trash=await e.store.trash(p.id),before=await fs.readFile(path.join(e.store.root,'.trash',trash.id,'project.json'));
 const result=await importProject({store:e.store,file:archive});assert(result.copied);assert.notEqual(result.id,p.id);
 assert.equal(await fs.readFile(path.join(workspace,'work.txt'),'utf8'),'old workspace');assert.deepEqual(await fs.readFile(path.join(e.store.root,'.trash',trash.id,'project.json')),before);
 assert.equal(await fs.readFile(path.join(e.store.root,result.id,asset.id),'utf8'),'original asset');assert.equal(await fs.readFile(path.join(e.root,'projects',result.id,'work.txt'),'utf8'),'old workspace');
 assert.equal(e.store.get(other.id).name,other.name);assert.equal((await e.store.listTrash()).length,1);
 const restored=await e.store.restore(trash.id);assert.equal(restored.id,p.id);assert(e.store.get(result.id));assert(e.store.get(other.id));
});
test('a workspace-only collision also forces a separate project identity',async t=>{
 const source=await env(t),target=await env(t),p=emptyProject('Workspace collision');await source.store.save(p);await source.store.asset(p,Buffer.from('file'),'glb','fixture');
 const workspace=path.join(target.root,'projects',p.id);await fs.mkdir(workspace,{recursive:true});await fs.writeFile(path.join(workspace,'keep.txt'),'existing work');
 const file=path.join(source.root,'a.fita');await exportProject({store:source.store,id:p.id,dest:file});const imported=await importProject({store:target.store,file});
 assert(imported.copied);assert.equal(await fs.readFile(path.join(workspace,'keep.txt'),'utf8'),'existing work');
});
test('EPERM after assets move rolls back both areas without registering a partial project',async t=>{
 const e=await env(t),{project,staging}=await staged(e);let moves=0;
 await assert.rejects(publishArchive({store:e.store,project,staging,move:async(a,b)=>{if(++moves===2)throw Object.assign(Error('private path'),{code:'EPERM'});await fs.rename(a,b);}}),error=>error.message==='FITA_ARCHIVE_STORAGE_BLOCKED'&&!error.message.includes(staging));
 assert.equal(e.store.projects.has(project.id),false);
 for(const area of ['data','workspace'])assert.equal(await fs.readFile(path.join(staging,area,'sentinel.txt'),'utf8'),area+' preserved');
 await assert.rejects(fs.access(path.join(e.store.root,project.id)),{code:'ENOENT'});await assert.rejects(fs.access(path.join(e.root,'projects',project.id)),{code:'ENOENT'});await assert.rejects(fs.access(path.join(e.store.root,project.id+'.json')),{code:'ENOENT'});
 const restarted=new Store(e.store.root);await restarted.init();assert.equal(restarted.projects.has(project.id),false);await fs.access(path.join(staging,'data','sentinel.txt'));
});
test('a record-write failure unregisters adopt memory state and preserves staged files',async t=>{
 const e=await env(t),{project,staging}=await staged(e);e.store.adopt=async p=>{e.store.projects.set(p.id,p);throw Object.assign(Error('disk write denied'),{code:'EPERM'});};
 await assert.rejects(publishArchive({store:e.store,project,staging}),/FITA_ARCHIVE_STORAGE_BLOCKED/);assert.equal(e.store.projects.has(project.id),false);await fs.access(path.join(staging,'data','sentinel.txt'));await fs.access(path.join(staging,'workspace','sentinel.txt'));
});
test('startup recovers an interrupted move by directory identity and leaves old unowned staging alone',async t=>{
 const e=await env(t),{project,staging}=await staged(e),stat=await fs.lstat(path.join(staging,'data'),{bigint:true});
 const journal={schema:1,id:project.id,phase:'prepared',areas:[{name:'data',owner:{directory:true,ino:String(stat.ino),dev:String(stat.dev)}}]};await fs.writeFile(path.join(staging,'import-transaction.json'),JSON.stringify(journal));await fs.rename(path.join(staging,'data'),path.join(e.store.root,project.id));
 const legacy=path.join(e.store.root,'.import-'+randomUUID());await fs.mkdir(legacy);await fs.writeFile(path.join(legacy,'keep'),'unowned existing staging');
 const restarted=new Store(e.store.root);await restarted.init();assert.equal(restarted.projects.has(project.id),false);await fs.access(path.join(staging,'data','sentinel.txt'));assert.equal(await fs.readFile(path.join(legacy,'keep'),'utf8'),'unowned existing staging');
});

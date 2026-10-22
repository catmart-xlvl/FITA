import {recoverManualModelFiles} from './manual-model-files.js';
import {recoverArchivePublications} from './archive-publication.js';
import {purgeTrashEntry} from './trash-purge.js';
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { migrate, syncApprovals } from "./lineage.js";
export const views = ["front", "right", "back", "left"];
export const groups = ["head", "body"];
export const labels = {
  head: "Cabeza",
  body: "Cuerpo",
  front: "Frente",
  right: "Perfil derecho",
  left: "Perfil izquierdo",
  back: "Espalda",
};
export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function validId(id) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || "")) fail("Identificador inválido.");
  return id;
}
export function event(p, message, level = "info") {
  p.events.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    message,
    level,
  });
  p.events = p.events.slice(-300);
}
export function emptyProject(name) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: name.trim().slice(0, 80) || "Untitled",
    createdAt: now,
    updatedAt: now,
    revision: 0,
    schemaVersion: 2,
    referenceRevision: 0,
    notesRevision: 0,
    referenceState: { status: "empty", referenceId: null },
    reference: null,
    notes: "",
    demo: false,
    groups: {
      head: { views: {}, approved: false },
      body: { views: {}, approved: false },
    },
    models: [],
    jobs: [],
    events: [],
  };
}
export class Store {
  constructor(root) {
    this.root = root;
    this.projects = new Map();
    this.writes = new Map();
    this.unavailable = new Set();
    this.assetWrites = new Map();
    this.restoring = new Set();
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(path.join(this.root,'.trash'),{recursive:true});
    await recoverArchivePublications(this);
    // Recover a move interrupted between the asset and manifest renames.
    for(const name of await fs.readdir(path.join(this.root,'.trash'))){
      if(!/^[a-f0-9-]{36}$/.test(name))continue;
      const dir=path.join(this.root,'.trash',name);
      try{
        const record=JSON.parse(await fs.readFile(path.join(dir,'record.json'),'utf8'));
        validId(record.projectId);
        const manifest=path.join(this.root,record.projectId+'.json');
        const rootExists=await fs.stat(manifest).then(()=>true,()=>false);
        const trashed=await fs.stat(path.join(dir,'project.json')).then(()=>true,()=>false);
        if(rootExists&&!trashed){
          await fs.rename(path.join(dir,'assets'),path.join(this.root,record.projectId)).catch(e=>{if(e.code!=='ENOENT')throw e;});
          await fs.unlink(path.join(dir,'record.json'));await fs.rmdir(dir);
        }else if(trashed&&!rootExists){
          const assetsExist=await fs.stat(path.join(dir,'assets')).then(()=>true,()=>false);
          if(!assetsExist)await fs.rename(path.join(this.root,record.projectId),path.join(dir,'assets')).catch(e=>{if(e.code!=='ENOENT')throw e;});
          this.unavailable.add(record.projectId);
        }
      }catch(e){console.warn('No se pudo recuperar una entrada de papelera; se conservó en disco.');}
    }
    for (const file of await fs.readdir(this.root)) {
      if (!file.endsWith(".json")) continue;
      try {
        const p = JSON.parse(
          await fs.readFile(path.join(this.root, file), "utf8"),
        );
        await this.adopt(p);
      } catch {
        console.warn(
          "Un archivo de proyecto no se pudo abrir. Se conservó en disco.",
        );
      }
    }
  }
  // Normalizes a project record read from disk (startup or an imported .fita)
  // and registers it.
  async adopt(p) {
    validId(p.id);
    await recoverManualModelFiles(this.root,p);
    migrate(p);
    if (p.referenceState.status === "validating")
      p.referenceState.status = "pending";
    syncApprovals(p);
    for (const j of p.jobs)
      if (["running", "queued"].includes(j.status)) {
        j.status = "paused";
        j.message = j.taskId
          ? "Servidor reiniciado. Reanuda la consulta de la misma tarea, sin crear otra."
          : "Operación interrumpida. Comprueba el proveedor antes de repetir: podría haberse facturado.";
      }
    this.projects.set(p.id, p);
    await this.save(p);
    return p;
  }
  get(id) {
    validId(id);
    if(this.unavailable.has(id))fail('Proyecto no encontrado.',404);
    const p = this.projects.get(id);
    if (!p) fail("Proyecto no encontrado.", 404);
    return p;
  }
  async save(p) {
    validId(p.id);
    if(this.unavailable.has(p.id))fail('Proyecto no encontrado.',404);
    p.updatedAt = new Date().toISOString();
    const file = path.join(this.root, p.id + ".json");
    const snapshot = JSON.stringify(p, null, 2);
    this.projects.set(p.id, p);
    const write = (this.writes.get(p.id) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const tmp = file + ".tmp";
        await fs.writeFile(tmp, snapshot);
        await fs.rename(tmp, file);
      });
    this.writes.set(p.id, write);
    await write;
    return p;
  }
  async asset(p, buffer, ext, source) {
    validId(p.id);
    if(this.unavailable.has(p.id))fail('Proyecto no encontrado.',404);
    const name = randomUUID() + "." + ext;
    const dir = path.join(this.root, p.id);
    const pending=this.assetWrites.get(p.id)||new Set();this.assetWrites.set(p.id,pending);
    const write=(async()=>{await fs.mkdir(dir, { recursive: true });await fs.writeFile(path.join(dir, name), buffer);})();
    pending.add(write);try{await write;}finally{pending.delete(write);}
    return {
      id: name,
      url: `/files/${p.id}/${name}`,
      source,
      bytes: buffer.length,
      createdAt: new Date().toISOString(),
    };
  }
  read(p, a) {
    return fs.readFile(path.join(this.root, validId(p.id), a.id));
  }
  async trash(id) {
    const p=this.get(id),trashId=randomUUID(),dir=path.join(this.root,'.trash',trashId);
    this.unavailable.add(id);
    let assetsMoved=false,manifestMoved=false;
    try{
      await this.writes.get(id);
      await Promise.allSettled([...(this.assetWrites.get(id)||[])]);
      await fs.mkdir(dir,{recursive:true});
      const record={id:trashId,projectId:id,name:p.name,deletedAt:new Date().toISOString()};
      await fs.writeFile(path.join(dir,'record.json'),JSON.stringify(record));
      try{await fs.rename(path.join(this.root,id),path.join(dir,'assets'));assetsMoved=true;}catch(e){if(e.code!=='ENOENT')throw e;}
      await fs.rename(path.join(this.root,id+'.json'),path.join(dir,'project.json'));manifestMoved=true;
      this.projects.delete(id);return record;
    }catch(e){
      if(!manifestMoved&&assetsMoved)await fs.rename(path.join(dir,'assets'),path.join(this.root,id));
      this.unavailable.delete(id);throw e;
    }
  }
  async listTrash(){
    const results=[];
    for(const id of await fs.readdir(path.join(this.root,'.trash'))){
      if(!/^[a-f0-9-]{36}$/.test(id))continue;
      try{
        const dir=path.join(this.root,'.trash',id),record=JSON.parse(await fs.readFile(path.join(dir,'record.json'),'utf8'));
        const deleting=await fs.stat(path.join(dir,'purge.json')).then(()=>true,()=>false);
        if(!deleting)await fs.access(path.join(dir,'project.json'));results.push({...record,deletionPending:deleting});
      }catch{}
    }
    return results.sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));
  }
  async restore(trashId){
    validId(trashId);
    if(this.restoring.has(trashId))fail('PROJECT_RESTORE_CONFLICT',409);
    this.restoring.add(trashId);
    try{return await this.restoreEntry(trashId);}finally{this.restoring.delete(trashId);}
  }
  async restoreEntry(trashId){
    const dir=path.join(this.root,'.trash',trashId);
    if(await fs.lstat(path.join(dir,'purge.json')).then(()=>true,()=>false))fail('FITA_TRASH_DELETE_FAILED',409);
    let p;try{p=JSON.parse(await fs.readFile(path.join(dir,'project.json'),'utf8'));}catch(e){if(e.code==='ENOENT')fail('Proyecto no encontrado.',404);throw e;}
    validId(p.id);
    if(this.projects.has(p.id))fail('PROJECT_RESTORE_CONFLICT',409);
    if(p.codexDelivery)p.codexDelivery.status='revoked';
    if(p.placementHandoff)p.placementHandoff.status='cancelled';
    // Persist revocation before exposing the restored project, including after a crash.
    await fs.writeFile(path.join(dir,'project.json.tmp'),JSON.stringify(p,null,2));
    await fs.rename(path.join(dir,'project.json.tmp'),path.join(dir,'project.json'));
    // Asset folder first, manifest last. A failed restore leaves its trash manifest intact.
    let assetsMoved=false,workspaceMoved=false;
    const workspace=path.join(path.dirname(this.root),'projects',p.id),savedWorkspace=path.join(dir,'workspace');
    const ownsWorkspace=await fs.lstat(savedWorkspace).then(s=>{if(s.isSymbolicLink()||!s.isDirectory())fail('FITA_TRASH_PATH_UNSAFE',409);return true;},e=>{if(e.code==='ENOENT')return false;throw e;});
    if(ownsWorkspace&&await fs.lstat(workspace).then(()=>true,()=>false))fail('PROJECT_RESTORE_CONFLICT',409);
    try{
      try{await fs.rename(path.join(dir,'assets'),path.join(this.root,p.id));assetsMoved=true;}catch(e){if(e.code!=='ENOENT')throw e;}
      if(ownsWorkspace){await fs.mkdir(path.dirname(workspace),{recursive:true});await fs.rename(savedWorkspace,workspace);workspaceMoved=true;}
      await fs.rename(path.join(dir,'project.json'),path.join(this.root,p.id+'.json'));
    }catch(e){if(workspaceMoved)await fs.rename(workspace,savedWorkspace);if(assetsMoved)await fs.rename(path.join(this.root,p.id),path.join(dir,'assets'));throw e;}
    this.unavailable.delete(p.id);this.projects.set(p.id,p);
    await this.save(p);
    await fs.unlink(path.join(dir,'record.json')).catch(()=>{});await fs.rmdir(dir).catch(()=>{});
    return p;
  }
  async purge(trashId,options){
    if(this.restoring.has(trashId))fail('FITA_TRASH_DELETE_BUSY',409);
    this.restoring.add(trashId);
    try{return await purgeTrashEntry(this,trashId,options);}catch(cause){if(cause.status)throw cause;throw Object.assign(Error('FITA_TRASH_DELETE_FAILED'),{status:409,cause});}finally{this.restoring.delete(trashId);}
  }
}

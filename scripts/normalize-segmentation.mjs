// Run with FITA stopped, or against an isolated QA data directory.
// node scripts/normalize-segmentation.mjs DATA_DIRECTORY PROJECT_ID
import fs from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../server/storage.js';
import {createSegmentation,currentSegmentation} from '../server/segmentation.js';
const [directory,projectId]=process.argv.slice(2);
if(!directory||!/^[a-f0-9-]{36}$/.test(projectId||''))throw Error('Usage: normalize-segmentation.mjs DATA_DIRECTORY PROJECT_ID');
const store=new Store(path.resolve(directory));await store.init();const project=store.get(projectId);
const before=currentSegmentation(project),models=JSON.stringify(project.models),source=await fs.readFile(path.join(store.root,projectId+'.json'));
const backup=path.resolve('.runtime','segmentation-backups',projectId+'-'+Date.now()+'.json');await fs.mkdir(path.dirname(backup),{recursive:true});await fs.writeFile(backup,source);
const segmentation=await createSegmentation({store,editable:p=>{if(p!==project)throw Error('PROJECT_CHANGED');},gate:()=>{},presentProject:p=>p,bridge:{status:()=>({controlAvailable:false})}});
const result=await segmentation.normalizeExisting(project);
if(JSON.stringify(project.models)!==models)throw Error('SOURCE_MODELS_CHANGED');
console.log(JSON.stringify({projectId,previous:before?.id,current:result?.id,changed:before?.id!==result?.id,groups:result?.groups.map(g=>({id:g.id,part:g.part,category:g.category,faces:g.faces.length})),approval:result?.approval,backup}));

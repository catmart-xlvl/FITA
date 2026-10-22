import {instructionPackageFromCache} from './local-instruction-package.js';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {segFail as fail} from './segmentation-files.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
// Same local, project-bound ZIP handoff as views; distinct capability/route so
// this token cannot modify concepts, approve segmentation or authorize spending.
export async function segmentationDelivery({store,snapshot,makePackage,importPackage,now=Date.now,ttlMs=86400000,baseUrl='http://127.0.0.1:4317',kind='segmentation',afterImport}){
 const [property,route]=({segmentation:['segmentationDeliveryId','segmentation'],'segment-references':['segmentReferencesDeliveryId','segmentation/references'],'texture-refinement':['textureRefinementDeliveryId','texture-refinement']})[kind]||[];
 if(!property)throw Error('Unknown delivery kind');
 const dir=path.join(store.root,`.${kind}-deliveries`),grants=new Map(),locks=new Map();await fs.mkdir(dir,{recursive:true});
 for(const name of await fs.readdir(dir))if(/^[a-f0-9-]{36}\.json$/.test(name))try{const g=JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));if(g.id+'.json'===name&&/^[a-f0-9]{64}$/.test(g.hash))grants.set(g.id,g);}catch{}
 async function save(g){const tmp=path.join(dir,g.id+'.tmp');await fs.writeFile(tmp,JSON.stringify(g));await fs.rename(tmp,path.join(dir,g.id+'.json'));}
 async function locked(key,fn){const before=locks.get(key)||Promise.resolve(),work=before.catch(()=>{}).then(fn);locks.set(key,work);try{return await work;}finally{if(locks.get(key)===work)locks.delete(key);}}
 async function check(g){const p=store.get(g.projectId);if(p[property]!==g.id)fail('SEG_DELIVERY_REPLACED');if(now()>=g.expiresAt)fail('SEG_DELIVERY_EXPIRED',410);let current;try{current=await snapshot(p,JSON.parse(g.snapshot));}catch{fail('SEG_INPUTS_CHANGED');}if(JSON.stringify(current)!==g.snapshot)fail('SEG_INPUTS_CHANGED');if((p.segmentations?.at(-1)?.id??null)!==g.baseSegmentationId)fail('SEG_DELIVERY_REPLACED');return p;}
 async function status(p){const g=grants.get(p[property]);if(!g)return null;let state=g.receipt?'imported':'waiting';if(!g.receipt)try{await check(g);}catch(e){state=e.message==='SEG_DELIVERY_EXPIRED'?'expired':'stale';}return{id:g.id,status:state,expiresAt:new Date(g.expiresAt).toISOString(),...(g.lastError?{lastError:g.lastError}:{}),downloadUrl:state==='waiting'?`/api/projects/${p.id}/${route}/delivery/${g.id}`:null};}
 const router=express.Router();router.use((req,res,next)=>{if(!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host||'')||req.headers.origin)return res.status(403).json({error:'SEG_LOCAL_ONLY'});res.set('Cache-Control','no-store');next();});
 router.use('/:id',async(req,res,next)=>{const g=grants.get(req.params.id),token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!g||!token||!timingSafeEqual(Buffer.from(hash(token)),Buffer.from(g.hash)))return res.status(401).json({error:'SEG_DELIVERY_UNAUTHORIZED'});req.grant=g;next();});
 router.get('/:id',async(req,res)=>{const g=req.grant;if(!g.receipt)await check(g);res.json({status:g.receipt?'imported':'waiting',projectId:g.projectId,importId:g.receipt?.id});});
 router.post('/:id',express.raw({type:'application/zip',limit:'300mb'}),async(req,res)=>{
   const g=req.grant;const result=await locked(g.projectId,async()=>{
     if(!Buffer.isBuffer(req.body))fail('SEG_PACKAGE_INVALID',400);const digest=hash(req.body);
     if(g.receipt){if(g.receipt.hash!==digest)fail('SEG_DELIVERY_USED');return {...g.receipt,duplicate:true};}
     const p=await check(g),run=await importPackage(p,req.body,()=>check(g),JSON.parse(g.snapshot));g.receipt={id:run.id,hash:digest};delete g.lastError;await save(g);return g.receipt;
   });res.json({status:'imported',projectId:g.projectId,importId:result.id,duplicate:!!result.duplicate});
   if(afterImport)void Promise.resolve(afterImport(store.get(g.projectId))).catch(()=>{});
 });
 router.use(async(e,q,r,n)=>{const code=/^SEG_[A-Z_]+$/.test(e.message)?e.message:'SEG_PACKAGE_INVALID';if(q.grant&&!q.grant.receipt){q.grant.lastError=code;await save(q.grant).catch(()=>{});}r.status(e.status||400).json({error:code});});
 return {router,status,
  async issue(p,{renew=false,correction=false}={}){return locked(p.id,async()=>{
    const existing=await status(p);if(existing?.status==='waiting'&&!renew)return existing;
    if(existing?.status==='expired'&&!renew)fail('SEG_DELIVERY_RENEW_REQUIRED');
    const snapshotValue=await snapshot(p),token=randomBytes(32).toString('hex'),g={id:randomUUID(),projectId:p.id,baseSegmentationId:p.segmentations?.at(-1)?.id??null,snapshot:JSON.stringify(snapshotValue),hash:hash(token),expiresAt:now()+ttlMs};
    const descriptor={schema:`workbench-${kind}-delivery/v1`,projectId:p.id,deliveryId:g.id,endpoint:`${baseUrl}/api/${kind}-deliveries/${g.id}`,token,expiresAt:new Date(g.expiresAt).toISOString()};
    const bytes=await makePackage(p,snapshotValue,descriptor,{correction});if(store.get(p.id)!==p||JSON.stringify(await snapshot(p))!==g.snapshot)fail('SEG_INPUTS_CHANGED');
    await fs.writeFile(path.join(dir,g.id+'.zip'),bytes);await save(g);grants.set(g.id,g);const previous=p[property];p[property]=g.id;try{await store.save(p);}catch(e){p[property]=previous;throw e;}return status(p);
  });},
  async package(p,id){const g=grants.get(id);if(g?.projectId!==p.id)fail('SEG_DELIVERY_UNAUTHORIZED',404);await check(g);return instructionPackageFromCache(store,p,kind,id,path.join(dir,id+'.zip'));}
 };
}

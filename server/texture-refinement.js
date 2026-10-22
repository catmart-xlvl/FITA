import {verifyHairNormalPreparation,validateHairNormalReview} from '../scripts/hair-normal-preparation.mjs';
import {applyHairNormalPatch} from '../scripts/hair-normal-preparation.mjs';
import {verifyFaceNormalPreparation,validateFaceNormalReview} from '../scripts/face-normal-preparation.mjs';
import {validateFinishQuality} from './finish-quality-review.js';
import {localInstructionPackage} from './local-instruction-package.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import {currentTexture,inspectTextureGlb} from './texture-workflow.js';
import {currentSegmentation,segmentationSource} from './segmentation-identity.js';
import {currentPlan} from './segment-references.js';
import {segmentationDelivery} from './segmentation-delivery.js';
import {readSegmentationZip,segFail as fail} from './segmentation-files.js';
import {zipBuffers} from './codex-handoff.js';
import {atlasImages,verifyTextureLayout,replaceAtlases,parseGlb} from '../scripts/texture-layout.mjs';
import {verifyFacialPreparation,applyFacialPatch} from '../scripts/facial-preparation.mjs';
import {refinementInstructions} from './texture-refinement-prompts.js';
import {refinementSkillFiles} from './refinement-skill-files.js';
import {rebuildFaceUv} from './face-uv.js';
import {validateScleraReview} from './sclera-review.js';
import {validateEyeShadowReview,verifyEyeShadows} from './eye-shadow-review.js';
import {validateCoverageCleanup,currentCoverageDraft} from './coverage-cleanup-review.js';
const parts=['head','body'],hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sources=p=>parts.map(part=>currentTexture(p,part));
const currentRun=p=>[...p.textureRefinements||[]].reverse().find(r=>same(r.textureIds,sources(p).map(t=>t?.id)));
const waitingForSegments=p=>{const plan=currentPlan(p);return !!plan&&!['completed','finishing'].includes(plan.status);};
export function validateRefinementReport(report,coverage,{facialRequired=false,lipRequired=false,scleraRequired=false,qualityRequired=false,hairRequired=false,faceRequired=false,coverageRequired=false,eyeShadowRequired=false}={}){
 if(report?.method!=='paint-existing-atlases'||report.imageGenerationUsed!==false)fail('REFINE_PAINT_REQUIRED');
 if(report?.schema!=='workbench-texture-refinement-report/v1'||report.reviewed!==true||report.nonExplicit!==true||report.originalClothingPreserved!==true||!Array.isArray(report.pending)||report.pending.length||!Array.isArray(report.coverage)||report.coverage.length!==coverage.length)fail('REFINE_REVIEW_REQUIRED');
 for(const part of parts){const p=report.parts?.[part];if(!p||!['front','left','right','back'].every(v=>p.views?.includes(v))||typeof p.changes!=='string'||!p.changes.trim()||p.changes.length>4000)fail('REFINE_REVIEW_REQUIRED');}
 const seen=new Set();for(const item of report.coverage){const source=coverage.find(g=>g.groupId===item.groupId);if(!source||seen.has(item.groupId)||!['preserved','neutralized'].includes(item.status)||typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>1200||item.status==='neutralized'&&source.status!=='temporary')fail('REFINE_COVERAGE_INVALID');
  if(source.status==='temporary'&&source.areas?.includes('chest')&&!report.parts.body.views.includes('front-high'))fail('REFINE_REVIEW_REQUIRED');seen.add(item.groupId);}
 if(coverageRequired||report.coverageReview||coverage.some(g=>g.status==='temporary'))validateCoverageCleanup(report,coverage);
 if(facialRequired||report.facialPreparation){const f=report.facialPreparation;
  if(!f||!['prepared','already-prepared','not-applicable'].includes(f.status)||typeof f.reason!=='string'||!f.reason.trim()||f.reason.length>2000)fail('REFINE_FACIAL_REVIEW_REQUIRED');
  if(f.status==='prepared'&&(!f.patch||f.baseWithoutPupilOrGlints!==true||f.whiteGlints!==true||f.noRig!==true||!['front','threequarter-left','threequarter-right','profile-left','profile-right','isolated-base'].every(v=>f.views?.includes(v))))fail('REFINE_FACIAL_REVIEW_REQUIRED');
  if(f.status!=='prepared'&&f.patch)fail('REFINE_FACIAL_REVIEW_REQUIRED');
 }
 if(hairRequired||report.hairNormals)validateHairNormalReview(report.hairNormals);
 if(faceRequired||report.faceNormals)validateFaceNormalReview(report.faceNormals);
 if(lipRequired||report.lipReview){const l=report.lipReview;
  if(!l||!['checked','not-applicable'].includes(l.status)||typeof l.reason!=='string'||!l.reason.trim()||l.reason.length>2000)fail('REFINE_LIP_REVIEW_REQUIRED');
  if(l.status==='checked'&&(!['front','threequarter-left','threequarter-right','profile-left','profile-right'].every(v=>l.views?.includes(v))||!['base-color','geometry'].every(v=>l.modes?.includes(v))||l.creaseAligned!==true||l.oldTraceRemoved!==true||l.lowerLipRegistered!==true||l.uvOverlapChecked!==true||!Array.isArray(l.landmarks)||l.landmarks.length<3||l.landmarks.length>32||l.landmarks.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)))))fail('REFINE_LIP_REVIEW_REQUIRED');
 }
 if(scleraRequired||report.scleraReview)validateScleraReview(report);
 if(eyeShadowRequired||report.eyeShadowReview)validateEyeShadowReview(report);
 if(qualityRequired||report.jointReview||report.uvReview)validateFinishQuality(report);
 return report;
}
export async function createTextureRefinement({store,ensure=()=>{},deliveryOptions={}}){
 const locks=new Set();
 async function manifest(p,issued){
  const current=sources(p);if(current.some(t=>!t))fail('REFINE_TEXTURES_REQUIRED');if(waitingForSegments(p))fail('REFINE_SEGMENTS_PENDING');
  const s=currentSegmentation(p),usesSeg=!!s&&current.some(t=>t.segmentationId===s.id);
  const coverage=usesSeg?s.groups.map(g=>({groupId:g.id,part:g.part,...g.coverage,status:g.coverage?.status||'unknown'})):[];
  const draft=currentCoverageDraft(p,current.map(t=>t.id));
  const version=issued?.refinementSkillsVersion??9,legacy=version===7,eyeShadows=version>=9;
  return {schema:'workbench-texture-refinement/v1',refinementSkillsVersion:version,...(eyeShadows?{eyeShadows:{required:true,version:1,reference:'sparse-curved-upper-eye-strips'}}:{}),...(!legacy?{faceNormals:{required:true,version:1,proxy:'reusable-hemisphere'}}:{}),coverageCleanup:{required:true,version:1,rule:'restore-concept-exposed-skin'},...(draft?{coverageDraft:{id:draft.id,sha256:draft.sha256}}:{}),hairNormals:{required:true,version:1},finishQuality:{required:true,version:1},scleraReview:{required:true,version:1},lipReview:{required:true,version:1},facialPreparation:{required:true,version:eyeShadows?2:1,scope:'sclera-iris-pupil-glints-eyebrows'+(eyeShadows?'-eyeshadows':'')},projectId:p.id,conceptId:p.reference?.id||null,notes:p.notes||'',coverage,
   sources:await Promise.all(current.map(async t=>({part:t.group,id:t.id,sha256:hash(await store.read(p,t))}))),
   references:parts.flatMap(part=>Object.entries(p.groups[part].views).map(([v,a])=>({part,view:v,id:a.id}))),
   segmentReferences:usesSeg?s.groups.map(g=>({groupId:g.id,references:Object.fromEntries(Object.entries(g.references||{}).map(([v,a])=>[v,a.id]))})):[],
   settings:usesSeg?s.groups.map(g=>({groupId:g.id,part:g.part,settings:g.settings})):current.map(t=>({part:t.group,settings:t.settings||null}))};
 }
 async function importPackage(p,bytes,beforeCommit=()=>{},issued){
  ensure(p);if(locks.has(p.id))fail('SEG_BUSY');locks.add(p.id);const staged=[];
  try{
   const digest=hash(bytes),existing=(p.textureRefinements||[]).find(r=>r.packageHash===digest);
   if(existing){if(currentRun(p)?.id!==existing.id)fail('SEG_INPUTS_CHANGED');return existing;}
   const files=await readSegmentationZip(bytes,{refinement:true}),wanted=await manifest(p,issued),originals=sources(p);
   if(Object.keys(files).length!==4||!same(JSON.parse(files['manifest.json']||'null'),wanted))fail('SEG_INPUTS_CHANGED');
   const report=validateRefinementReport(JSON.parse(files['report.json']||'null'),wanted.coverage,{coverageRequired:wanted.coverageCleanup?.required,facialRequired:wanted.facialPreparation?.required,lipRequired:wanted.lipReview?.required,scleraRequired:wanted.scleraReview?.required,qualityRequired:wanted.finishQuality?.required,hairRequired:wanted.hairNormals?.required,faceRequired:wanted.faceNormals?.required,eyeShadowRequired:wanted.eyeShadows?.required});
   const requiredPaint=validateCoverageCleanup(report,wanted.coverage),paintedParts=new Set();
   let changed=0;const expectedAtlases=[];
   for(const part of parts){const source=await store.read(p,originals.find(t=>t.group===part)),result=files[part+'.glb'];if(!result)fail('REFINE_TEXTURES_REQUIRED');inspectTextureGlb(result);
    if(part==='head'&&wanted.eyeShadows?.required)verifyEyeShadows(result,report.eyeShadowReview);
    if(part==='head'&&wanted.faceNormals?.required&&report.faceNormals?.status==='not-applicable'&&parseGlb(source).json.nodes?.some(n=>n.name==='face'))fail('FACE_NORMAL_REVIEW_REQUIRED');
    if(part==='head'&&report.faceNormals?.status==='prepared'){
     const beforeImages=atlasImages(source),afterImages=atlasImages(result);
     let prepared=replaceAtlases(source,new Map(beforeImages.filter((im,i)=>im.sha256!==afterImages[i]?.sha256).map(im=>[im.index,afterImages[im.index].bytes])));
     if(report.facialPreparation?.status==='prepared')prepared=applyFacialPatch(prepared,report.facialPreparation.patch);
     if(report.hairNormals?.status==='prepared')prepared=applyHairNormalPatch(prepared,report.hairNormals.patch);
     verifyFaceNormalPreparation(prepared,result,report.faceNormals.patch);
    }else if(part==='head'&&report.hairNormals?.status==='prepared'){
     const beforeImages=atlasImages(source),afterImages=atlasImages(result);
     let prepared=replaceAtlases(source,new Map(beforeImages.filter((im,i)=>im.sha256!==afterImages[i]?.sha256).map(im=>[im.index,afterImages[im.index].bytes])));
     if(report.facialPreparation?.status==='prepared')prepared=applyFacialPatch(prepared,report.facialPreparation.patch);
     verifyHairNormalPreparation(prepared,result,report.hairNormals.patch);
    }else if(part==='head'&&report.facialPreparation?.status==='prepared')verifyFacialPreparation(source,result,report.facialPreparation.patch);else verifyTextureLayout(source,result);
    const before=atlasImages(source),after=atlasImages(result);
    expectedAtlases.push(...before.filter(im=>im.editable).map(im=>({part,index:im.index})));
    for(let i=0;i<before.length;i++){if(before[i].sha256===after[i].sha256)continue;
     const a=await sharp(before[i].bytes,{limitInputPixels:100000000}).metadata(),b=await sharp(after[i].bytes,{limitInputPixels:100000000}).metadata();
     if(b.pages>1||a.width!==b.width||a.height!==b.height||a.space!==b.space||a.depth!==b.depth)fail('REFINE_IMAGE_SIZE');
     const alpha=async im=>sharp(im.bytes).ensureAlpha().extractChannel(3).raw().toBuffer();
     if(!(await alpha(before[i])).equals(await alpha(after[i])))fail('REFINE_ALPHA_CHANGED');
     const pixels=async im=>sharp(im.bytes).removeAlpha().raw().toBuffer();if(!(await pixels(before[i])).equals(await pixels(after[i]))){changed++;paintedParts.add(part);}
    }
    for(let i=before.length;i<after.length;i++){
     const image=sharp(after[i].bytes,{limitInputPixels:16777216}),meta=await image.metadata();if(meta.pages>1||meta.width>4096||meta.height>4096||meta.space!=='srgb'||meta.depth!=='uchar')fail('REFINE_IMAGE_SIZE');
     if(['glint','sclera','eyeshadow'].includes(report.facialPreparation.patch.pieces[i-before.length].role)){
      const pixels=await image.ensureAlpha().raw().toBuffer();if(pixels.some(v=>v!==255))fail('REFINE_GLINT_NOT_WHITE');
     }
    }
   }
   validateFinishQuality(report,expectedAtlases);
   if([...requiredPaint].some(part=>!paintedParts.has(part)))fail('REFINE_COVERAGE_UNCHANGED');
   if(!changed&&report.facialPreparation?.status!=='prepared')fail('REFINE_NO_CHANGES');
   const check=async()=>{ensure(p);await beforeCommit();if(store.get(p.id)!==p||!same(await manifest(p,wanted),wanted))fail('SEG_INPUTS_CHANGED');};await check();
   const run={id:randomUUID(),createdAt:new Date().toISOString(),packageHash:digest,manifest:wanted,report,changedAtlases:changed,facialPrepared:report.facialPreparation?.status==='prepared',reviewRequired:true,textureIds:[]};
   for(const source of originals){const a=await store.asset(p,files[source.group+'.glb'],'glb','Local anime texture refinement');staged.push({...source,...a,refinementRequired:true,refinementId:run.id,refinedFrom:source.id,supervisedPending:false});}
   await check();run.textureIds=staged.map(t=>t.id);const oldTextures=p.textures,oldRuns=p.textureRefinements;p.textures=[...oldTextures||[],...staged];p.textureRefinements=[...oldRuns||[],run];
   const plan=currentPlan(p),oldStatus=plan?.status;if(plan?.workflowVersion===2)plan.status='completed';
   try{await store.save(p);}catch(e){p.textures=oldTextures;p.textureRefinements=oldRuns;if(plan)plan.status=oldStatus;throw e;}staged.length=0;return run;
  }finally{locks.delete(p.id);for(const a of staged)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});}
 }
 const delivery=await segmentationDelivery({store,kind:'texture-refinement',snapshot:manifest,importPackage,...deliveryOptions,
  async makePackage(p,m,descriptor){
   ensure(p);const files={'manifest.json':Buffer.from(JSON.stringify(m,null,2)),'INSTRUCCIONES.txt':Buffer.from(refinementInstructions),'coverage.json':Buffer.from(JSON.stringify(m.coverage,null,2)),'ENTREGA_LOCAL.json':Buffer.from(JSON.stringify(descriptor,null,2))};
   Object.assign(files,await refinementSkillFiles());
   for(const name of ['docs/preparacion-facial-acabado.md'])files[name]=await fs.readFile(new URL('../'+name,import.meta.url));
   for(const t of sources(p))files[`models/${t.group}.glb`]=await store.read(p,t);
   const supervised=currentPlan(p)?.workflowVersion===2;if(supervised){const seg=currentSegmentation(p);files['transfer-audit.json']=Buffer.from(JSON.stringify(seg?.reconstruction?.report,null,2));files['cleanup-audit.json']=Buffer.from(JSON.stringify(seg?.cleanup||{},null,2));for(const part of parts){const source=segmentationSource(p,part);files['source-backups/'+part+'.glb']=await store.read(p,source);}for(const run of p.segmentTextureRuns.filter(r=>r.planId===currentPlan(p).id))for(const op of run.operations)if(op.step==='download'&&op.downloadAsset)files['returned-segments/'+op.groupId+'.glb']=await store.read(p,op.downloadAsset);}
   if(p.reference)files['concept.png']=await store.read(p,p.reference);
   for(const part of parts)for(const [view,a]of Object.entries(p.groups[part].views))files[`originals/${part}_${view}.png`]=await store.read(p,a);
   const s=currentSegmentation(p);if(s&&m.coverage.length)for(const g of s.groups)for(const [view,a]of Object.entries(g.references||{}))files[`segment-references/${g.id}_${view}.png`]=await store.read(p,a);
   const draft=currentCoverageDraft(p,sources(p).map(t=>t.id));
   if(draft)for(const atlas of draft.atlases)files['edited/'+atlas.file]=await store.read(p,atlas.asset);
   files['report.json']=Buffer.from(JSON.stringify({schema:'workbench-texture-refinement-report/v1',method:'paint-existing-atlases',imageGenerationUsed:false,reviewed:false,coverageReview:draft?.report.coverageReview||{status:'pending',conceptCompared:false,modelInspected:false,views:[],modes:[],groups:m.coverage.map(g=>({groupId:g.groupId,allAddedCoverageAccountedFor:false,findings:'',regions:[]}))},faceNormals:{status:'pending',reason:'Importar la máscara reutilizable, ajustar al rostro y revisar normales sin exportar el proxy'},hairNormals:{status:'pending',reason:'Inspeccionar peinado, ajustar volúmenes y comprobar deformación después de los rasgos faciales'},jointReview:{status:'pending'},uvReview:{status:'pending'},nonExplicit:false,originalClothingPreserved:false,scleraReview:{status:'pending',reason:'Identificar el borde anatómico y comprobar cobertura completa en ambos ojos'},lipReview:{status:'pending',reason:'Comparar labios con abertura real, UV sin solapamientos y cinco vistas'},eyeShadowReview:{status:'pending',reason:'Crear o conservar franjas curvas de sombra ocular y revisar transparencia, encaje y brillos en ambos ojos'},facialPreparation:{status:'pending',reason:'Revisar esclerótica, iris, pupila, brillos, cejas y sombras oculares'},parts:{head:{views:[],changes:''},body:{views:[],changes:''}},coverage:draft?.report.coverage||m.coverage.map(g=>({groupId:g.groupId,status:'preserved',reason:''})),pending:['Revisión visual pendiente']},null,2));
   return localInstructionPackage(store,p,'texture-refinement',files,descriptor.deliveryId);
  }
 });
 return {delivery,manifest,importPackage,isBusy:id=>locks.has(id),mount(app){
  const root='/api/projects/:id/texture-refinement',upload=multer({storage:multer.memoryStorage(),limits:{fileSize:300*1024*1024,files:1}});
  app.post(root+'/coverage-preview',upload.single('file'),async(req,res)=>{
   const p=store.get(req.params.id);ensure(p);if(locks.has(p.id)||waitingForSegments(p))fail('SEG_BUSY');locks.add(p.id);const staged=[];
   try{
    const original=sources(p),ids=original.map(t=>t?.id),submitted=JSON.parse(req.body.sourceIds||'null');
    if(original.some(t=>!t)||!same(ids,submitted)||!req.file)fail('SEG_INPUTS_CHANGED');
    const wanted=await manifest(p),report=JSON.parse(req.body.report||'null'),required=validateCoverageCleanup(report,wanted.coverage);
    if(!required.has('body')||required.has('head'))fail('REFINE_COVERAGE_REVIEW_REQUIRED');
    const result=req.file.buffer,digest=hash(result),existing=currentCoverageDraft(p,ids);
    if(existing?.sha256===digest&&same(existing.report,report))return res.json({draft:existing,reused:true});
    const source=await store.read(p,original.find(t=>t.group==='body'));inspectTextureGlb(result);verifyTextureLayout(source,result);
    const before=atlasImages(source),after=atlasImages(result),edits=[];
    for(let i=0;i<before.length;i++){
     if(before[i].sha256===after[i].sha256)continue;
     const a=await sharp(before[i].bytes).metadata(),b=await sharp(after[i].bytes).metadata();
     if(b.pages>1||a.width!==b.width||a.height!==b.height||a.space!==b.space||a.depth!==b.depth)fail('REFINE_IMAGE_SIZE');
     const raw=async(im,alpha=false)=>alpha?sharp(im.bytes).ensureAlpha().extractChannel(3).raw().toBuffer():sharp(im.bytes).removeAlpha().raw().toBuffer();
     if(!(await raw(before[i],true)).equals(await raw(after[i],true)))fail('REFINE_ALPHA_CHANGED');
     if(!(await raw(before[i])).equals(await raw(after[i])))edits.push({index:i,file:`body_${i}.${before[i].mime==='image/png'?'png':'jpg'}`,bytes:after[i].bytes});
    }
    if(!edits.length)fail('REFINE_COVERAGE_UNCHANGED');
    const check=()=>{ensure(p);if(store.get(p.id)!==p||!same(ids,sources(p).map(t=>t?.id))||wanted.conceptId!==(p.reference?.id||null))fail('SEG_INPUTS_CHANGED');};check();
    let asset=existing?.sha256===digest?existing.asset:null,atlases=existing?.sha256===digest?existing.atlases:[];
    if(!asset){asset=await store.asset(p,result,'glb','Preliminary local coverage cleanup');staged.push(asset);
     for(const edit of edits){const asset=await store.asset(p,edit.bytes,edit.bytes[0]===137?'png':'jpg','Local coverage atlas draft');staged.push(asset);atlases.push({index:edit.index,file:edit.file,asset});}
    }
    check();const draft={id:randomUUID(),createdAt:new Date().toISOString(),sourceTextureIds:ids,sha256:digest,asset,atlases,report,preliminary:true};
    const previous=p.coverageCleanupDrafts;p.coverageCleanupDrafts=[...previous||[],draft];
    try{await store.save(p);}catch(e){p.coverageCleanupDrafts=previous;throw e;}staged.length=0;res.json({draft,reused:false});
   }finally{locks.delete(p.id);for(const a of staged)await fs.unlink(path.join(store.root,p.id,a.id)).catch(()=>{});}
  });
  // Local UV-only maintenance for already finished projects. No remote job,
  // new art, or relaxation of the normal texture/facial import validators.
  app.post(root+'/repair-face-uv',async(req,res)=>{
   const p=store.get(req.params.id);ensure(p);const source=currentTexture(p,'head'),before=currentRun(p),manual=p.manualPlacement;
   if(locks.has(p.id)||waitingForSegments(p))fail('SEG_BUSY');
   if(!source||req.body.sourceId!==source.id||req.body.confirm!==true)fail('SEG_INPUTS_CHANGED');
   if(source.faceUv?.uvRebuilt)return res.json({run:before,texture:source,reused:true});
   locks.add(p.id);let asset;
   try{
    const result=await rebuildFaceUv(await store.read(p,source));
    if(store.get(p.id)!==p||currentTexture(p,'head')!==source||currentRun(p)!==before)fail('SEG_INPUTS_CHANGED');ensure(p);
    asset=await store.asset(p,result.bytes,'glb','Local face UV rebake');
    const run={id:randomUUID(),createdAt:new Date().toISOString(),manifest:await manifest(p),report:{faceUv:result.report},changedAtlases:1,facialPrepared:before?.facialPrepared||false,reviewRequired:before?.reviewRequired??true,textureIds:[asset.id,currentTexture(p,'body')?.id]};
    const texture={...source,...asset,refinementId:run.id,refinedFrom:source.id,faceUv:result.report};
    const oldTextures=p.textures,oldRuns=p.textureRefinements;p.textures=[...oldTextures,texture];p.textureRefinements=[...oldRuns||[],run];
    // Exact corner geometry was verified, so user positioning is still valid.
    if(manual?.sources.head===source.id)p.manualPlacement={...manual,sources:{...manual.sources,head:asset.id}};
    try{await store.save(p);}catch(e){p.textures=oldTextures;p.textureRefinements=oldRuns;p.manualPlacement=manual;throw e;}
    asset=null;res.json({run,texture});
   }finally{locks.delete(p.id);if(asset)await fs.unlink(path.join(store.root,p.id,asset.id)).catch(()=>{});}
  });
  app.get(root,async(req,res)=>{const p=store.get(req.params.id),current=currentRun(p),waiting=waitingForSegments(p);res.json({supervised:currentPlan(p)?.workflowVersion===2,planStatus:currentPlan(p)?.status,eligible:!waiting&&sources(p).every(Boolean),waitingForSegments:waiting,required:waiting||sources(p).some(t=>t?.refinementRequired)&&(!current||current.reviewRequired),current:current?{id:current.id,reviewRequired:current.reviewRequired,changedAtlases:current.changedAtlases}:null,delivery:await delivery.status(p)});});
  app.post(root+'/package',async(req,res)=>res.json(await delivery.issue(store.get(req.params.id),req.body||{})));
  app.get(root+'/delivery/:deliveryId',async(req,res)=>res.type('application/zip').attachment('fita_texture_refinement.zip').send(await delivery.package(store.get(req.params.id),req.params.deliveryId)));
  app.post(root+'/import',upload.single('file'),async(req,res)=>{if(!req.file)fail('REFINE_TEXTURES_REQUIRED');res.json({run:await importPackage(store.get(req.params.id),req.file.buffer)});});
  app.post(root+'/approve',async(req,res)=>{const p=store.get(req.params.id),run=currentRun(p);ensure(p);if(waitingForSegments(p))fail('REFINE_SEGMENTS_PENDING');if(locks.has(p.id))fail('SEG_BUSY');if(!run||run.id!==req.body.id||req.body.confirm!==true)fail('REFINE_REVIEW_REQUIRED');
   const s=currentSegmentation(p),previous=run.reviewRequired,oldReview=s?.reconstruction?.reviewRequired;run.reviewRequired=false;
   if(s?.reconstruction&&sources(p).every(t=>t.segmentationId===s.id))s.reconstruction.reviewRequired=false;
   try{await store.save(p);}catch(e){run.reviewRequired=previous;if(s?.reconstruction)s.reconstruction.reviewRequired=oldReview;throw e;}res.json({id:run.id,reviewRequired:false});
  });
 }};
}


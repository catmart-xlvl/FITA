import multer from 'multer';
import sharp from 'sharp';
import {guideBinding} from './placement-reference-contract.js';
export function placementReferences(p){
 if(p.placementReferencesBinding&&JSON.stringify(p.placementReferencesBinding)!==JSON.stringify(guideBinding(p)))return {front:null,left:null};
 return Object.fromEntries(['front','left'].map(side=>[side,p.placementReferences?.[side]||null]));
}
export function mountPlacementReferences(app,{store,editable}){
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1}});
 app.post('/api/projects/:id/placement/references/:side',upload.single('file'),async(req,res)=>{
  const p=store.get(req.params.id);editable(p);const side=req.params.side;
  if(!['front','left'].includes(side)||!req.file)throw Object.assign(Error('Referencia inválida'),{status:400});
  let bytes;try{bytes=await sharp(req.file.buffer,{limitInputPixels:40e6}).rotate().png().toBuffer();}catch{throw Object.assign(Error('Imagen inválida'),{status:400});}
  const bindingBefore=p.placementReferencesBinding;
  const asset=await store.asset(p,bytes,'png','placement-reference'),before=p.placementReferences;
  p.placementReferences={...placementReferences(p),[side]:asset};p.placementReferencesBinding=guideBinding(p);try{await store.save(p);}catch(e){p.placementReferences=before;p.placementReferencesBinding=bindingBefore;throw e;}
  res.json({references:placementReferences(p)});
 });
}

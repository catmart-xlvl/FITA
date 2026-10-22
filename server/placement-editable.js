import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {findBlender,runBlender} from './placement.js';

// Cache immutable derivatives by BOTH source files and conversion policy.
export function mountPlacementEditable(app,{store,convert=runBlender,blenderPath=findBlender}){
  const pending=new Map();
  app.get('/api/projects/:id/placement/:placementId/editable/:format',async(req,res)=>{
    const p=store.get(req.params.id),r=p.placements?.find(r=>r.id===req.params.placementId&&r.status==='succeeded');
    const format=req.params.format;
    if(!r?.blend||!['blend','fbx'].includes(format))throw Object.assign(Error('PLACEMENT_INVALID_RESULT'),{status:404});
    const input=await store.read(p,r.blend);
    const segmentationIds=new Set(Object.values(r.sources||{}).map(id=>p.textures?.find(t=>t.id===id)?.segmentationId).filter(Boolean));
    const reference=segmentationIds.size===1?p.segmentations?.find(s=>s.id===[...segmentationIds][0])?.reconstruction?.blend:null;
    const referenceBytes=reference?await store.read(p,reference):null;
    const key=createHash('sha256').update('editable-connectivity/v1').update(input).update(referenceBytes||'').digest('hex');
    const dir=path.join(store.root,p.id,'placement-editable',key),report=path.join(dir,'report.json');
    if(!await fs.stat(report).then(()=>true,()=>false)){
      if(!pending.has(dir))pending.set(dir,(async()=>{
        const executable=await blenderPath();if(!executable)throw Error('PLACEMENT_BLENDER_NOT_FOUND');
        await fs.mkdir(dir,{recursive:true});
        const job={input:path.join(dir,'source.blend'),blend:path.join(dir,'character-connected.blend'),fbx:path.join(dir,'character-connected.fbx'),report};
        await fs.writeFile(job.input,input);
        if(referenceBytes){job.reference=path.join(dir,'reference.blend');await fs.writeFile(job.reference,referenceBytes);}
        const file=path.join(dir,'job.json');await fs.writeFile(file,JSON.stringify(job));
        await convert(executable,file,()=>{},'export_connected_placement.py');
      })().finally(()=>pending.delete(dir)));
      await pending.get(dir);
    }
    res.download(path.join(dir,'character-connected.'+format),'character-connected.'+format);
  });
}

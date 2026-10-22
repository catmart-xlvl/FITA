// Only combine results belonging to the currently bound pretexture baseline.
export function textureAssembly(project,textures,currentSegmentation=null){
 const baseline=project.segmentationBaseline;
 if(!baseline)return null;
 const parts=['head','body'].map(group=>[...textures].reverse().find(t=>t.group===group&&t.current));
 if(parts.some(t=>!t)||parts[0].segmentationId!==parts[1].segmentationId)return null;
 const segment=currentSegmentation?.id===parts[0].segmentationId?currentSegmentation:project.segmentations?.find(s=>s.id===parts[0].segmentationId);
 let identity;try{identity=JSON.parse(segment?.identity||'null');}catch{return null;}
 if(identity?.baseline!==baseline.id||!segment?.reconstruction||!parts.every(t=>segment.reconstruction.textureIds.includes(t.id)))return null;
 return {head:parts[0],body:parts[1],blend:segment.reconstruction.blend};
}

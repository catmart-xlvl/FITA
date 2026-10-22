import {TextureLoader} from 'three';

// Local, opt-in comparison. The production asset is never rewritten.
export async function loadTextureTrial(root,url,study) {
  const sources=new Map();root.traverse(o=>{if(o.isMesh)for(const m of [o.material].flat())if(m.map)sources.set(m.name,m);});
  const response=await fetch(url);if(!response.ok)throw Error('TEXTURE_TRIAL_SOURCE_UNAVAILABLE');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==study.sourceSha256)throw Error('TEXTURE_TRIAL_SOURCE_CHANGED');
  for(const entry of study.maps)if(!sources.has(entry.material))throw Error('TEXTURE_TRIAL_MATERIAL_MISSING');
  const loaded=await Promise.allSettled(study.maps.map(async entry=>({entry,texture:await new TextureLoader().loadAsync(entry.url)})));
  const ok=loaded.filter(x=>x.status==='fulfilled').map(x=>x.value);
  const dispose=()=>ok.forEach(({texture})=>texture.dispose());
  if(loaded.some(x=>x.status==='rejected')){dispose();throw Error('TEXTURE_TRIAL_IMAGE_UNAVAILABLE');}
  for(const {entry,texture} of ok){const source=sources.get(entry.material).map;if(source.image.width!==texture.image.width||source.image.height!==texture.image.height){dispose();throw Error('TEXTURE_TRIAL_RESOLUTION_CHANGED');}}
  return {maps:new Map(ok.map(({entry,texture})=>[entry.material,texture])),dispose};
}

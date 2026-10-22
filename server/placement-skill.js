import fs from 'node:fs/promises';

export const placementSkillName='colocacion-personaje-por-referencias';
export async function placementSkillFiles(){
  const names=['SKILL.md','references/revision.md','references/cabello-costuras.md','scripts/check_review.py'];
  const files=Object.fromEntries(await Promise.all(names.map(async name=>[
    `skills/${placementSkillName}/${name}`,
    await fs.readFile(new URL(`../skills/${placementSkillName}/${name}`,import.meta.url))
  ])));
  for(const name of ['mesh_connectivity.py','finalize_neck_height.py','run_placement.py','place_parts.py','review_placement.py','export_evaluated_parts.py','hair_connected.py','manual_hair_clearance.py','connected_falloff.py','neck_subdivision.py']){
    files[`skills/${placementSkillName}/scripts/${name}`]=await fs.readFile(new URL('./blender/'+name,import.meta.url));
  }
  return files;
}

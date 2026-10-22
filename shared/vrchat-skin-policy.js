// Destination-authoring contract. These IDs do not depend on menu language.
export const vrchatSkinRevision='2026-10-20-skin-v1';
export const vrchatSkinControls=[
  {parameter:'FITA_SkinBrightness',labelKey:'skinBrightness',properties:['_LightingMinLightBrightness','_LightingCap']},
  {parameter:'FITA_SkinSpecular',labelKey:'skinSpecular',properties:['_MochieSpecularStrength']},
].map(control=>({...control,parameterType:'Float',menuControl:'RadialPuppet',defaultValue:.5,animatorDefault:.5,saved:true,networkSynced:true,sampleValues:[0,.5,1]}));

// Validate reported authoring, not Unity execution. Actual runtime evidence is
// required by the delivery route and remains separate from the client gate.
export function validateVrchatSkinReport(report){
  const fail=()=>{throw Object.assign(Error('VRCHAT_SKIN_CONTROLS_REQUIRED'),{status:409});};
  if(report?.schema!=='fita-vrchat-skin-controls/v1'||report.revision!==vrchatSkinRevision||report.sourceAlbedoPreserved!==true||report.nonSkinUnaffected!==true||!Array.isArray(report.skinMaterials)||!report.skinMaterials.length||!Array.isArray(report.skinRenderers)||!report.skinRenderers.length||!Array.isArray(report.controls)||report.controls.length!==2||report.controls.some(c=>!c))fail();
  for(const list of [report.skinMaterials,report.skinRenderers])if(list.some(x=>typeof x!=='string'||!x.trim())||new Set(list).size!==list.length)fail();
  for(const expected of vrchatSkinControls){
    const rows=report.controls.filter(c=>c.parameter===expected.parameter);if(rows.length!==1)fail();const c=rows[0];
    for(const key of ['parameterType','menuControl','defaultValue','animatorDefault','saved','networkSynced'])if(c[key]!==expected[key])fail();
    if(c.onlySkin!==true||c.lockedShaderVerified!==true||!Array.isArray(c.samples)||c.samples.length!==3)fail();
    for(const value of expected.sampleValues){const samples=c.samples.filter(s=>s?.value===value);if(samples.length!==1||samples[0].passed!==true||!Array.isArray(samples[0].evidence)||!samples[0].evidence.length)fail();}
  }
  return report.controls.flatMap(c=>c.samples.flatMap(s=>s.evidence));
}

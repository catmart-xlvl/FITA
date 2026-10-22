import test from 'node:test';
import assert from 'node:assert/strict';
import {vrchatPreparationFiles} from '../server/vrchat-preparation-resources.js';
import {validateVrchatSkinReport,vrchatSkinRevision} from '../shared/vrchat-skin-policy.js';

function observed(){return {schema:'fita-vrchat-skin-controls/v1',revision:vrchatSkinRevision,sourceAlbedoPreserved:true,nonSkinUnaffected:true,skinMaterials:['Assets/Skin.mat'],skinRenderers:['Face','Hands'],controls:['FITA_SkinBrightness','FITA_SkinSpecular'].map(parameter=>({parameter,parameterType:'Float',menuControl:'RadialPuppet',defaultValue:.5,animatorDefault:.5,saved:true,networkSynced:true,onlySkin:true,lockedShaderVerified:true,samples:[0,.5,1].map(value=>({value,passed:true,evidence:[`review/${parameter}-${value}.txt`]}))}))};}

test('every VRChat handoff carries adaptive skin policy and both localized default controls',async()=>{
  const files=await vrchatPreparationFiles(),profile=JSON.parse(files['VRCHAT_PC_REFERENCE_PROFILE.json']),skin=profile.materials.skinAppearance;
  assert(files[skin.guide]?.length);assert.equal(skin.requiredForEveryFitaPcAvatar,true);
  assert.equal(skin.preserveApprovedAlbedo,true);assert.equal(skin.forceUniversalPalePalette,false);assert.equal(skin.referenceOnly.notUniversal,true);
  assert.equal(skin.revision,vrchatSkinRevision);
  assert.deepEqual(skin.controls.map(c=>c.parameter),['FITA_SkinBrightness','FITA_SkinSpecular']);
  for(const c of skin.controls){assert.equal(c.required,true);assert.equal(c.defaultValue,.5);assert.equal(c.animatorDefault,.5);assert.equal(c.saved,true);assert.equal(c.networkSynced,true);assert.equal(c.onlySkin,true);for(const lang of ['en','es'])assert(profile.facial.menuLanguage.labels[lang][c.labelKey]);}
  assert.equal(skin.menu.reservedExpressionBits,16);assert.equal(skin.menu.maxControlsPerMenu,8);
});

test('materials cannot be reported complete with omitted, unsafe or untested skin controls',()=>{
  assert.equal(validateVrchatSkinReport(observed()).length,6);
  const bad=[undefined,...[
    r=>r.controls.pop(),r=>r.controls[1].parameter='FITA_SkinBrightness',r=>r.controls[1].saved=false,
    r=>r.controls[0].defaultValue=1,r=>r.controls[0].lockedShaderVerified=false,r=>r.nonSkinUnaffected=false,
    r=>r.sourceAlbedoPreserved=false,r=>r.controls[0].samples[1].passed=false,r=>r.controls[1].samples.pop(),
    r=>r.skinRenderers=[],r=>r.controls[0].samples[0].evidence=[],
  ].map(change=>{const r=observed();change(r);return r;})];
  for(const report of bad)assert.throws(()=>validateVrchatSkinReport(report),e=>e.status===409&&e.message==='VRCHAT_SKIN_CONTROLS_REQUIRED');
});

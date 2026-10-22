import {Color,DataTexture,RGBAFormat,UnsignedByteType,LinearFilter,MathUtils} from 'three';

// Linear working-space factors: shared response, independent source albedos.
export const skinShading=Object.freeze({shade:[.78,.57,.60],toony:.94,shift:-.12});
export function surfaceProfile(mesh,material,overrides={}){
 const authored=material.userData?.workbenchSurfaceRole;
 if(['skin','hair','other'].includes(authored))return {role:authored};
 if(material.userData?.workbenchFacialRole)return {role:material.userData.workbenchFacialRole};
 // Older exports may omit extras. Recover only explicit facial piece names.
 const facial=/^WB_(Glint|Sclera|Iris|Pupil|Eyebrow|EyeShadow)_[LR](?:_|\b)/i.exec(material.name||'');
 if(facial)return {role:facial[1].toLowerCase()};
 for(let n=mesh;n;n=n.parent){if(n.userData?.workbenchHairNormals?.version===1)return {role:'hair'};const p=overrides[n.userData?.workbenchSourceName];if(p)return p;}
 return namedSkin(mesh)||{role:'other'};
}

// Fallback for exports without workbenchSurfaceRole: explicit part names given in
// segmentation (rostro, piel-*, mano-*, head-face, body-skin...). Names only, never colour guessing.
const skinNames=/^(rostro|cara|face|head[-_]face|body[-_]skin|skin(?:[-_][a-z]+)*|piel(?:[-_][a-z]+)*|manos?(?:[-_][a-z]+)*|hands?(?:[-_][a-z]+)*)$/i;
const mixedNames=/^(piernas?|legs?|brazos?|arms?)$/i;
export function namedSkin(mesh){
 for(let n=mesh,depth=0;n&&depth<3;n=n.parent,depth++){
  const name=String(n.userData?.workbenchSourceName||n.name||'').replace(/[ _]export(?:[._]\d+)?$/i,'').replace(/\.\d+$/,'');
  if(skinNames.test(name))return {role:'skin'};
  if(mixedNames.test(name))return {role:'skin-mixed'};
 }
 return null;
}

// Only for explicitly reviewed mixed-skin domains, never a global skin detector.
export const skinMaskGLSL=`float wbSkinMask(vec3 c) {
 float peak = max(c.r, max(c.g,c.b));
 float warm = smoothstep(-.04,.02,c.r-max(c.g,c.b));
 float saturated = smoothstep(.30,.55,min(c.g,c.b)/max(c.r,.00001));
 return smoothstep(.08,.30,peak)*warm*saturated;
}`;
export function mixedSkinMask([r,g,b]){
 return MathUtils.smoothstep(Math.max(r,g,b),.08,.30)*MathUtils.smoothstep(r-Math.max(g,b),-.04,.02)*MathUtils.smoothstep(Math.min(g,b)/Math.max(r,.00001),.30,.55);
}

export function hairHighlightTexture(){
 const size=128,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=(x+.5)/size*2-1,v=(y+.5)/size*2-1;
  const band=Math.exp(-Math.pow((v+.22+.10*u*u)/.13,2))*Math.max(0,1-Math.pow(Math.abs(u),6));
  const i=4*(y*size+x),c=Math.round(255*band);data.set([c,c,c,255],i);
 }
 const map=new DataTexture(data,size,size,RGBAFormat,UnsignedByteType);
 map.minFilter=LinearFilter;map.magFilter=LinearFilter;map.needsUpdate=true;return map;
}

// vNormal is produced by Three/MToon AFTER morphing, skinning and normalMatrix.
// A volume field on thin double-sided cards must not flip with faceDirection.
export function patchHairNormals(shader,uniform){
 patchVolumeNormals(shader,uniform,'workbenchHairStrength');
}
export function patchFaceNormals(shader){
 patchVolumeNormals(shader,{value:1},'workbenchFaceStrength');
}
function patchVolumeNormals(shader,uniform,key){
 shader.uniforms[key]=uniform;
 shader.fragmentShader=`uniform float ${key};\n`+shader.fragmentShader;
 const code=`
 #ifndef FLAT_SHADED
 if(${key}>0.0){
  vec3 fieldNormal=normalize(vNormal);
  vec3 blended=mix(normal,fieldNormal,${key});
  normal=length(blended)>.00001?normalize(blended):fieldNormal;
 }
 #endif
 `;
 const marker=shader.fragmentShader.includes('// #include <emissivemap_fragment>')?'// #include <emissivemap_fragment>':'#include <normal_fragment_maps>';
 shader.fragmentShader=shader.fragmentShader.replace(marker,marker+code);
}

// Soft warm skin glow: added after the preview's albedo clamp so it
// survives in lit areas. Base lift + fresnel edge, tinted by the skin texture itself.
export const skinGlow=Object.freeze({color:[1,.62,.64],base:.07,edge:.5,power:2.4});
function addSkinGlow(material,mask){
 material.uniforms.workbenchSkinGlow={value:new Color(...skinGlow.color)};
 material.fragmentShader='uniform vec3 workbenchSkinGlow;\n'+material.fragmentShader.replace('col += totalEmissiveRadiance;',
  `col += totalEmissiveRadiance;
  {
    float wbRim = pow( saturate( 1.0 - dot( viewDir, normal ) ), ${skinGlow.power.toFixed(2)} );
    col += diffuseColor.rgb * workbenchSkinGlow * ( ${skinGlow.base.toFixed(3)} + ${skinGlow.edge.toFixed(3)} * wbRim ) * ${mask};
  }`);
}
export function configureSkin(material,profile){
 if(!['skin','skin-mixed'].includes(profile.role))return;
 material.shadingToonyFactor=skinShading.toony;material.shadingShiftFactor=skinShading.shift;
 const warm=material.color.clone().multiply(new Color(...skinShading.shade));
 if(profile.role==='skin'){material.shadeColorFactor.copy(warm);addSkinGlow(material,'1.0');return;}
 material.uniforms.workbenchSkinShade={value:warm};
 material.fragmentShader='uniform vec3 workbenchSkinShade;\n'+skinMaskGLSL+'\n'+material.fragmentShader.replace('material.shadeColor = shadeColorFactor;',
  'material.shadeColor = mix(shadeColorFactor,workbenchSkinShade,wbSkinMask(diffuseColor.rgb));');
 addSkinGlow(material,'wbSkinMask(diffuseColor.rgb)');
}

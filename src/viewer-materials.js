import {Color, MeshStandardMaterial, MeshBasicMaterial, LinearFilter, LinearMipmapLinearFilter,LineSegments,LineBasicMaterial} from 'three';
import {nativeTopology} from './native-topology.js';
import {MToonMaterial} from '@pixiv/three-vrm-materials-mtoon';
import {surfaceProfile,configureSkin,hairHighlightTexture,patchHairNormals,patchFaceNormals} from './viewer-surface-profiles.js';
import {splitPreparedMixedHair} from './viewer-mixed-hair.js';

// Rendering-only materials. Maps are shared, never repainted or written to the GLB.
export function animeMaterial(source) {
  const color=source.color?.clone() || new Color(1,1,1);
  const material=new MToonMaterial({
    name: source.name + ' · MToon preview',
    color,
    map: source.map || null,
    shadeColorFactor: color.clone().multiply(new Color(.56,.5,.72)), // Lighter, violet-tinted anime shadow.
    shadeMultiplyTexture: source.map || null,
    shadingToonyFactor: .94,
    shadingShiftFactor: -.12,
    giEqualizationFactor: 1,
    parametricRimColorFactor: color.clone().multiplyScalar(.06),
    rimMultiplyTexture: source.map || null,
    parametricRimFresnelPowerFactor: 4,
    rimLightingMixFactor: 0,
    toneMapped: false,
    normalMap: source.normalMap || null,
    normalScale: source.normalScale?.clone(),
    emissive: source.emissive?.clone() || new Color(0,0,0),
    emissiveMap: source.emissiveMap || null,
    emissiveIntensity: source.emissiveIntensity ?? 1,
    opacity: source.opacity, transparent: source.transparent,
    alphaTest: source.alphaTest, side: source.side,
    depthWrite: source.depthWrite, vertexColors: source.vertexColors,ignoreVertexColor:!source.vertexColors,
    wireframe: source.wireframe,
  });
  // FITA color preview: bound illumination to the albedo's peak with a
  // single RGB scale (no per-channel clipping). Extra exposure fills the toon
  // shadow toward the actual texture, instead of applying a filmic white curve.
  // Keep this in the material shader so wireframe clones retain the same policy.
  material.uniforms.workbenchExposure={value:1};
  material.uniforms.workbenchLightBalance={value:1};
  material.fragmentShader='uniform float workbenchExposure;\nuniform float workbenchLightBalance;\n'+material.fragmentShader.replace(
    'col += totalEmissiveRadiance;',
    `col /= workbenchLightBalance;
    float previewPeak = max( col.r, max( col.g, col.b ) );
    float albedoPeak = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
    col *= min( 1.0, albedoPeak / max( previewPeak, 0.000001 ) );
    if ( workbenchExposure <= 1.0 ) {
      col *= workbenchExposure;
    } else {
      col = mix( col, diffuseColor.rgb, .35 * ( 1.0 - exp( -2.0 * ( workbenchExposure - 1.0 ) ) ) );
    }
    col += totalEmissiveRadiance;`);
  return material;
}

export const hairHighlightDefault=.15;

export function previewMaterials(root,{colorLabels=false,facetedGeometry=false,surfaces={},hairNormalNode=null}={}) {
  const restoreMixedHair=splitPreparedMixedHair(root);
  const filtered=new Map(),textures=new Map();
  const filteredSource=m=>{if(filtered.has(m))return filtered.get(m);const copy=m.clone();for(const [key,value] of Object.entries(m)){if(!value?.isTexture||key==='envMap')continue;if(!textures.has(value)){const t=value.clone();if(!t.isCompressedTexture&&!t.isDataTexture&&!t.isRenderTargetTexture&&!t.mipmaps.length){t.generateMipmaps=true;t.minFilter=LinearMipmapLinearFilter;t.magFilter=LinearFilter;}t.anisotropy=1;t.needsUpdate=true;textures.set(value,t);}copy[key]=textures.get(value);}filtered.set(m,copy);return copy;};
  const originals=new Map(),generated=new Map(),clays=new Map(),flatColors=new Map(),offsets=new Map(),overlays=new Map();
  root.traverse(o=>{if(o.isMesh)originals.set(o,o.material);});
  const nativeFaces=facetedGeometry&&[...originals.keys()].every(mesh=>mesh.geometry.getAttribute('_wb_face'));
  const isGeometry=!colorLabels&&(facetedGeometry||![...originals.values()].flat().some(m=>m.map||m.vertexColors));
  let mode='original',wire=false,exposure=1,lightBalance=1,highlight=hairHighlightDefault;
  const normalStrength={value:0},profiles=new Map(),normalMaterials=new Set(),faceNormalMaterials=new Set(),faceNormalUse=new Map(),highlightMap=hairHighlightTexture();
  const trialMaps=new Map();let trialAfter=false;
  for(const [mesh,original] of originals)for(const source of [original].flat()){
    const m=filteredSource(source),profile=surfaceProfile(mesh,source,surfaces);
    // A shared material spanning differently classified meshes is ambiguous.
    // Do not tint an unreviewed region just because another mesh shares it.
    profiles.set(m,profiles.has(m)&&profiles.get(m).role!==profile.role?{role:'other'}:profile);
    if(profile.role==='hair'){let n=mesh;while(n&&!n.userData?.workbenchHairNormals&&(!hairNormalNode||n.userData.workbenchSourceName!==hairNormalNode))n=n.parent;if(n){normalMaterials.add(m);if(n.userData?.workbenchHairNormals?.version===1)normalStrength.value=1;}}
    let facePrepared=false;for(let n=mesh;n;n=n.parent)if(n.userData?.workbenchFaceNormals?.version===1){facePrepared=true;break;}
    faceNormalUse.set(m,(faceNormalUse.get(m)??true)&&facePrepared);
  }
  for(const m of normalMaterials)if(profiles.get(m)?.role!=='hair')normalMaterials.delete(m);
  for(const [m,prepared]of faceNormalUse)if(prepared)faceNormalMaterials.add(m);
  const patchStandard=(m,face=false)=>{m.onBeforeCompile=shader=>face?patchFaceNormals(shader):patchHairNormals(shader,normalStrength);m.customProgramCacheKey=()=>face?'workbench-face-deformed-v1':'workbench-hair-deformed-v2';};
  for(const m of normalMaterials)if(m.isMeshStandardMaterial)patchStandard(m);
  for(const m of faceNormalMaterials)if(m.isMeshStandardMaterial)patchStandard(m,true);
  const convert=m=>{if(!generated.has(m)){
    const value=animeMaterial(m),profile=profiles.get(m)||{};configureSkin(value,profile);
    if(profile.role==='hair'){value.matcapTexture=highlightMap;value.matcapFactor.setRGB(highlight,highlight,highlight);value.rimLightingMixFactor=1;}
    if(normalMaterials.has(m))patchHairNormals(value,normalStrength);
    if(faceNormalMaterials.has(m))patchFaceNormals(value);
    generated.set(m,value);
  }return generated.get(m);};
  const clay=m=>{
    if(!clays.has(m))clays.set(m,new MeshStandardMaterial({name:'Studio clay preview',color:0xb5b7ba,roughness:.34,metalness:0,envMapIntensity:1,side:m.side,flatShading:!nativeFaces&&(facetedGeometry||m.flatShading),normalMap:facetedGeometry?null:m.normalMap,normalScale:m.normalScale?.clone(),alphaMap:m.alphaMap,alphaTest:m.alphaTest,transparent:m.transparent,opacity:m.opacity,depthWrite:m.depthWrite}));
    return clays.get(m);
  };
  const flat=m=>{
    if(!flatColors.has(m))flatColors.set(m,new MeshBasicMaterial({name:'Base color preview',color:m.color?.clone()||new Color(1,1,1),map:m.map,vertexColors:m.vertexColors,toneMapped:false,side:m.side,alphaMap:m.alphaMap,alphaTest:m.alphaTest,transparent:m.transparent,opacity:m.opacity,depthWrite:m.depthWrite}));
    return flatColors.get(m);
  };
  const surface=source=>{
    const m=filteredSource(source);
    // Authored eye glints must stay white even with dark studio lighting/MToon.
    // GLTFLoader preserves material extras and KHR_materials_unlit metadata.
    const shadow=profiles.get(m)?.role==='eyeshadow';
    const glint=['glint','sclera','eyeshadow'].includes(profiles.get(m)?.role);
    const base=glint?flat(m):isGeometry?clay(m):mode==='mtoon'?convert(m):mode==='basecolor'?flat(m):m;
    // Curved, double-sided eye cards must blend once and never occlude other
    // transparent layers by writing depth. Preview only; source stays intact.
    if(shadow){base.depthWrite=false;base.forceSinglePass=true;}
    if(base.isMToonMaterial){base.uniforms.workbenchExposure.value=exposure;base.uniforms.workbenchLightBalance.value=lightBalance;}
    if(!wire)return base;
    // Push only the preview surface back slightly, leaving source materials intact.
    if(!offsets.has(base)){const copy=base.clone();if(normalMaterials.has(m)||faceNormalMaterials.has(m)){if(copy.isMToonMaterial){if(normalMaterials.has(m))copy.uniforms.workbenchHairStrength=normalStrength;}else if(copy.isMeshStandardMaterial)patchStandard(copy,faceNormalMaterials.has(m));}copy.polygonOffset=true;copy.polygonOffsetFactor=1;copy.polygonOffsetUnits=1;offsets.set(base,copy);}
    return offsets.get(base);
  };
  function overlay(mesh){
    if(overlays.has(mesh))return overlays.get(mesh);
    const topology=facetedGeometry?nativeTopology(mesh.geometry):null;
    if(topology){
      const lines=new LineSegments(topology.geometry,new LineBasicMaterial({color:0x171c25,transparent:true,opacity:.22,depthTest:true,depthWrite:false,toneMapped:false}));
      lines.name='Native polygon edges';lines.userData.workbenchOwnedGeometry=true;lines.renderOrder=mesh.renderOrder+1;lines.raycast=()=>{};mesh.add(lines);overlays.set(mesh,lines);return lines;
    }
    // Clone the mesh type to retain skinning/morphs, but share its geometry.
    const lines=mesh.clone(false),source=Array.isArray(originals.get(mesh))?originals.get(mesh):[originals.get(mesh)];
    lines.name='Topology overlay';lines.position.set(0,0,0);lines.quaternion.identity();lines.scale.set(1,1,1);lines.updateMatrix();
    const make=m=>new MeshBasicMaterial({color:0x171c25,wireframe:true,transparent:true,opacity:.22,depthTest:true,depthWrite:false,side:m.side,forceSinglePass:true,alphaMap:m.alphaMap,alphaTest:m.alphaTest,toneMapped:false});
    lines.material=Array.isArray(originals.get(mesh))?source.map(make):make(source[0]);
    lines.renderOrder=mesh.renderOrder+1;lines.raycast=()=>{};
    mesh.add(lines);overlays.set(mesh,lines);return lines;
  }
  function apply(){for(const [mesh,original] of originals){mesh.material=Array.isArray(original)?original.map(surface):surface(original);if(wire)overlay(mesh).visible=true;else if(overlays.has(mesh))overlays.get(mesh).visible=false;}}
  function compareTextures(after){
    trialAfter=!!after;
    for(const [m,{before,after:painted}] of trialMaps){
      const map=trialAfter?painted:before;
      const bases=[m,generated.get(m),flatColors.get(m)].filter(Boolean);
      for(const material of [...bases,...bases.map(b=>offsets.get(b)).filter(Boolean)]){
        for(const key of ['map','shadeMultiplyTexture','rimMultiplyTexture'])if(material[key]===before||material[key]===painted)material[key]=map;
        material.needsUpdate=true;
      }
    }
    apply();
  }
  return {
    isGeometry,
    textureTrial(replacements){
      if(trialMaps.size)throw Error('TEXTURE_TRIAL_ALREADY_ATTACHED');
      for(const [source,m] of filtered){const replacement=replacements.get(source.name);if(!replacement||!m.map)continue;
        const painted=m.map.clone();painted.source=replacement.source;painted.needsUpdate=true;
        trialMaps.set(m,{before:m.map,after:painted});
      }
      compareTextures(trialAfter);return trialMaps.size>0;
    },
    compareTextures,
    get hasHair(){return [...profiles.values()].some(p=>p.role==='hair');},
    hairNormals(value){normalStrength.value=Math.max(0,Math.min(1,Number(value)||0));},
    hairHighlight(value){highlight=Math.max(0,Math.min(.6,Number(value)||0));for(const m of [...generated.values(),...offsets.values()])if(m.isMToonMaterial&&m.matcapTexture===highlightMap)m.matcapFactor.setRGB(highlight,highlight,highlight);},
    set(value){mode=colorLabels?'basecolor':value;apply();},
    exposure(value){exposure=value;for(const m of [...generated.values(),...offsets.values()])if(m.isMToonMaterial)m.uniforms.workbenchExposure.value=value;},
    intensity(value){lightBalance=Math.max(1,value);for(const m of [...generated.values(),...offsets.values()])if(m.isMToonMaterial)m.uniforms.workbenchLightBalance.value=lightBalance;},
    wire(value){wire=!!value;apply();},
    update(delta){for(const m of [...generated.values(),...offsets.values()])if(m.isMToonMaterial)m.update(delta);for(const [mesh,lines] of overlays)if(mesh.morphTargetInfluences)lines.morphTargetInfluences=mesh.morphTargetInfluences;},
    dispose(){for(const [mesh,original] of originals)mesh.material=original;for(const lines of overlays.values()){lines.removeFromParent();if(lines.userData.workbenchOwnedGeometry)lines.geometry.dispose();for(const m of [lines.material].flat())m.dispose();}for(const cache of [generated,clays,flatColors,offsets,filtered,textures]){for(const m of cache.values())m.dispose();cache.clear();}for(const {after} of trialMaps.values())after.dispose();trialMaps.clear();overlays.clear();highlightMap.dispose();restoreMixedHair();},
  };
}

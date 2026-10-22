import {ShaderMaterial,Color,AdditiveBlending,DoubleSide} from 'three';

// Preview-only "in progress" hologram (DIS-001 v07). Replaces mesh materials while active
// and restores whatever the preview materials assigned. Never touches the GLB.
// Each source material gets a hologram twin that reads its base-colour map, so faces and
// eyes stay recognisable through the effect.
const vertexShader=`
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying vec3 vN; varying vec3 vView; varying vec3 vWorld; varying vec2 vHoloUv;
void main(){
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vN = normalize( transformedNormal );
  vView = -mvPosition.xyz;
  vWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vHoloUv = uv;
}`;
const fragmentShader=`
uniform float uTime; uniform float uHeight; uniform vec3 uLow; uniform vec3 uHigh;
#ifdef USE_HOLO_MAP
  uniform sampler2D uMap;
#endif
varying vec3 vN; varying vec3 vView; varying vec3 vWorld; varying vec2 vHoloUv;
void main(){
  vec3 n = normalize( vN ), v = normalize( vView );
  float h = clamp( vWorld.y / max( uHeight, 0.001 ), 0.0, 1.0 );
  float fres = pow( 1.0 - abs( dot( n, v ) ), 2.2 );
  float lines = 0.66 + 0.34 * sin( vWorld.y / max( uHeight, 0.001 ) * 420.0 - uTime * 3.0 );
  float sweep = fract( uTime * 0.22 );
  float band = smoothstep( 0.06, 0.0, abs( h - sweep ) );
  float flicker = 0.94 + 0.06 * sin( uTime * 31.0 ) * sin( uTime * 7.3 );
  vec3 col = mix( uLow, uHigh, h );
  float body = 0.16;
  #ifdef USE_HOLO_MAP
    vec3 tex = texture2D( uMap, vHoloUv ).rgb;
    float luma = dot( tex, vec3( .299, .587, .114 ) );
    col = col * ( 0.28 + 0.95 * luma ) + tex * 0.16;
    body = 0.08 + 0.20 * luma;
  #endif
  float alpha = ( body + 0.55 * fres ) * lines * flicker + band * 0.35;
  gl_FragColor = vec4( col * ( 0.6 + 1.0 * fres ) + vec3( band * 0.45 ), clamp( alpha, 0.0, 1.0 ) );
}`;

export function hologramLayer(){
  const shared={uTime:{value:0},uHeight:{value:2.8},uLow:{value:new Color('#3baeff')},uHigh:{value:new Color('#6b83ff')}};
  const base=new ShaderMaterial({name:'FITA hologram preview',vertexShader,fragmentShader,uniforms:shared,
    transparent:true,depthWrite:false,blending:AdditiveBlending,side:DoubleSide,toneMapped:false});
  const twins=new Map(),holos=new Set([base]);
  const twin=src=>{
    if(!src?.map)return base;
    if(twins.has(src))return twins.get(src);
    const m=base.clone();m.uniforms={...shared,uMap:{value:src.map}};m.defines={USE_HOLO_MAP:''};
    twins.set(src,m);holos.add(m);return m;
  };
  const saved=new Map(),still=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let active=false;
  const isHolo=m=>Array.isArray(m)?m.every(x=>holos.has(x)):holos.has(m);
  return {
    get active(){return active;},
    apply(model,height){
      shared.uHeight.value=height||2.8;
      model.traverse(o=>{if(!o.isMesh||isHolo(o.material))return;saved.set(o,o.material);o.material=Array.isArray(o.material)?o.material.map(twin):twin(o.material);});
      active=true;
    },
    restore(){for(const [o,m] of saved)o.material=m;saved.clear();active=false;},
    forget(){saved.clear();active=false;}, // materials were reassigned elsewhere; do not restore stale ones
    tick(seconds){if(active&&!still)shared.uTime.value=seconds;},
    dispose(){for(const m of holos)m.dispose();twins.clear();holos.clear();saved.clear();},
  };
}

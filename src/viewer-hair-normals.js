import {Vector3,CatmullRomCurve3,Float32BufferAttribute,MathUtils} from 'three';

function tube(points){
 const curve=new CatmullRomCurve3(points.map(p=>new Vector3(...p)));
 return curve.getPoints(96);
}
function tubeNormal(p,line){
 let closest,dist=Infinity;
 for(let i=1;i<line.length;i++){
  const a=line[i-1],d=line[i].clone().sub(a),q=a.clone().addScaledVector(d,MathUtils.clamp(p.clone().sub(a).dot(d)/d.lengthSq(),0,1)),r=p.distanceToSquared(q);
  if(r<dist){dist=r;closest=q;}
 }
 return p.clone().sub(closest).normalize();
}

// A preview study explicitly fitted to a source mesh. No geometry/UV/export edits.
export function hairNormalPreview(mesh,profile){
 const source=mesh.geometry,p=source.getAttribute('position'),original=source.getAttribute('normal');
 if(!p||!original||original.count!==p.count||source.morphAttributes.normal?.length)throw Error('NORMAL_STUDY_UNSUPPORTED');
 const center=new Vector3(...profile.cap.center),r=new Vector3(...profile.cap.radii),lines=profile.tails.map(tube);
 if(lines.length!==2||[r.x,r.y,r.z].some(v=>!Number.isFinite(v)||v<=0))throw Error('NORMAL_STUDY_INVALID');
 const targets=new Float32Array(p.count*3),point=new Vector3(),normal=new Vector3();
 for(let i=0;i<p.count;i++){
  point.fromBufferAttribute(p,i);normal.fromBufferAttribute(original,i).normalize();
  const cap=point.clone().sub(center).divide(r).divide(r).normalize();
  const tail=tubeNormal(point,lines[point.x<0?0:1]);
  const w=(1-MathUtils.smoothstep(Math.abs(point.x),...profile.cap.blendX))*MathUtils.smoothstep(point.y,...profile.cap.blendY);
  const target=tail.lerp(cap,w).normalize();
  // Keep one continuous field across duplicated seams and thin strands.
  // Per-vertex hemisphere flips would introduce new discontinuities.
  target.toArray(targets,i*3);
 }
 const geometry=source.clone(),targetAttribute=new Float32BufferAttribute(targets,3),n=new Vector3(),v=new Vector3(),tangent=new Vector3();
 geometry.setAttribute('workbenchHairNormal',targetAttribute);
 geometry.setAttribute('workbenchOriginalNormal',original.clone());
 const originalTangent=source.getAttribute('tangent');
 let active=false;
 function set(strength){
  strength=MathUtils.clamp(Number.isFinite(strength)?strength:0,0,1);
  if(!strength){mesh.geometry=source;active=false;return;}
  const out=geometry.getAttribute('normal'),t=geometry.getAttribute('tangent');
  for(let i=0;i<p.count;i++){
   n.fromBufferAttribute(original,i).normalize();v.fromBufferAttribute(targetAttribute,i);n.lerp(v,strength);if(n.lengthSq()<1e-12)n.copy(v);n.normalize();out.setXYZ(i,n.x,n.y,n.z);
   if(t&&originalTangent){tangent.fromBufferAttribute(originalTangent,i);tangent.addScaledVector(n,-tangent.dot(n));
    if(tangent.lengthSq()<1e-10)tangent.set(Math.abs(n.x)<.9?1:0,Math.abs(n.x)<.9?0:1,0).cross(n);
    tangent.normalize();t.setXYZW(i,tangent.x,tangent.y,tangent.z,originalTangent.getW(i));}
  }
  out.needsUpdate=true;if(t)t.needsUpdate=true;mesh.geometry=geometry;active=true;
 }
 return {set,get active(){return active;},dispose(){mesh.geometry=source;geometry.dispose();}};
}

export async function attachHairNormalStudy(root,study){
 if(!study)return null;
 const matches=[];root.traverse(o=>{if(o.isMesh&&o.userData.workbenchSourceName===study.node)matches.push(o);});
 if(matches.length!==1)return null;
 const mesh=matches[0],p=mesh.geometry.getAttribute('position');
 if(!p||p.isInterleavedBufferAttribute)return null;
 const bytes=new Uint8Array(p.array.buffer,p.array.byteOffset,p.array.byteLength);
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 if(hash!==study.positionHash)return null;
 return hairNormalPreview(mesh,study);
}

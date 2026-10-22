import {Vector3,Matrix4,Euler,Box3} from 'three';

// Presentation transform only: the body soles define the viewport floor even
// if a separate head/hair has a lower source origin. Part transforms stay exact.
export function framePlacementAssembly(root,body=null){
 root.position.set(0,0,0);root.scale.setScalar(1);root.updateMatrixWorld(true);
 const bounds=new Box3().setFromObject(root),size=bounds.getSize(new Vector3()),center=bounds.getCenter(new Vector3());
 const scale=2.8/Math.max(size.x,size.y,size.z,.001),ground=body?new Box3().setFromObject(body).min.y:bounds.min.y;
 root.scale.setScalar(scale);root.position.set(-center.x*scale,-ground*scale,-center.z*scale);root.updateMatrixWorld(true);
 return size.multiplyScalar(scale);
}

const axes={X:[1,0,0],Y:[0,1,0],Z:[0,0,1],'-X':[-1,0,0],'-Y':[0,-1,0],'-Z':[0,0,-1]};
export function placementOrientation({up='Y',front='Z'}={}){
 const u=new Vector3(...(axes[up]||[])),f=new Vector3(...(axes[front]||[]));
 if(!axes[up]||!axes[front]||Math.abs(u.dot(f))>.001)throw Error('PLACEMENT_AXES_INVALID');
 const m=new Matrix4().makeBasis(new Vector3().crossVectors(u,f),u,f).transpose();
 return {matrix:m,rotation:new Euler().setFromRotationMatrix(m,'XYZ').toArray().slice(0,3)};
}
const box=points=>points.length?points.reduce((b,p)=>({min:b.min.map((n,i)=>Math.min(n,p[i])),max:b.max.map((n,i)=>Math.max(n,p[i]))}),{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}):null;
const quantile=(values,q)=>{const a=values.slice().sort((a,b)=>a-b);return a[Math.floor((a.length-1)*q)];};
function role(mesh){
 for(let n=mesh;n;n=n.parent){
  if(n.userData?.workbenchPlacementRegion==='craniofacial')return 'craniofacial';
  if(n.userData?.workbenchPlacementRegion==='body')return 'body';
  if(n.userData?.workbenchHairNormals)return 'hair';
 }
 for(let n=mesh;n;n=n.parent)if(/^(hair|cabello|pelo|tail|cola|accessor|accesor|horn|cuerno|hat|sombrero)(?:\b|[-_])/i.test(String(n.userData?.workbenchSourceName||n.name||'')))return 'excluded';
 const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material],tags=materials.map(m=>m?.userData?.workbenchSurfaceRole).filter(Boolean);
 if(tags.length&&tags.every(t=>t==='hair'))return 'hair';
 if(tags.length&&tags.every(t=>t==='skin'))return 'skin';
 for(let n=mesh;n;n=n.parent){
  const name=String(n.userData?.workbenchSourceName||n.name||'').replace(/[ _]export(?:[._]\d+)?$/i,'').replace(/\.\d+$/,'');
  if(/^(hair|cabello|pelo|tail|cola|accessor|accesor|horn|cuerno|hat|sombrero)(?:\b|[-_])/i.test(name))return 'excluded';
  if(/^(face|rostro|cara|head[-_]face|piel[-_]rostro)(?:\b|[-_])/i.test(name))return 'face-name';
  if(/^(body|cuerpo|torso|legs?|piernas?|arms?|brazos?|hands?|manos?|skin|piel|jacket|chaqueta|clothing|ropa|vestuario)(?:\b|[-_])/i.test(name))return 'body-name';
 }
 return 'unknown';
}
// Geometry is read after scene/node transforms. No vertices, normals, UVs or
// source transforms are written. Seam copies contribute only once per position.
export function placementGeometry(scene,part,settings={}){
 const {matrix,rotation}=placementOrientation(settings[part]?.axes),all=[],regions=[],bodyFallback=[],seen=new Set(),regionSeen=new Set(),fallbackSeen=new Set();
 const point=new Vector3();let tagged=false,named=false;
 scene.updateMatrixWorld(true);
 const toSource=scene.parent?scene.parent.matrixWorld.clone().invert():new Matrix4();
 scene.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
  for(let n=mesh;n;n=n.parent)if(n.visible===false)return;
  const kind=role(mesh),positions=mesh.geometry.attributes.position;
  const selected=part==='head'?['craniofacial','skin','face-name'].includes(kind):['body','skin','body-name'].includes(kind);
  if(selected){tagged ||= ['craniofacial','body','skin'].includes(kind);named ||= kind.endsWith('name');}
  const indices=mesh.geometry.index,used=indices?new Set(indices.array):Array.from({length:positions.count},(_,i)=>i);
  for(const i of used){
   point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).applyMatrix4(toSource).applyMatrix4(matrix);
   if(!point.toArray().every(Number.isFinite))throw Error('PLACEMENT_INVALID_HEIGHT');
   const p=point.toArray(),key=p.map(n=>n.toPrecision(10)).join(',');
   if(!seen.has(key)){all.push(p);seen.add(key);}
   if(part==='body'&&!['hair','excluded'].includes(kind)&&!fallbackSeen.has(key)){bodyFallback.push(p);fallbackSeen.add(key);}
   if(selected&&!regionSeen.has(key)){regions.push(p);regionSeen.add(key);}
  }
 });
 const landmarks=settings[part]?.landmarks||{},convert=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)?new Vector3(...p).applyMatrix4(matrix).toArray():null;
 const low=convert(landmarks[part==='head'?'chin':'bottom']),high=convert(landmarks[part==='head'?'crown':'top']);
 let anatomy=null,method='unidentified',confidence='low',anchorPoints=regions;
 const ground=part==='body'&&bodyFallback.length?box(bodyFallback).min[1]:null;
 if(low&&high&&high[1]>low[1]){anatomy=box([low,high]);method='user-landmarks';confidence='medium';}
 else if(regions.length||part==='body'&&bodyFallback.length){
  // The central vertical body excludes extended T-pose arms from its anchor.
  // Semantic labels exclude known tails/hair/accessories before this crop.
  // A named skin/leg group may cover only a fraction of a dressed body. Its
  // boots and torso still determine height even when their names are unknown.
  let points=part==='body'?bodyFallback:regions;
  if(part==='body'){
   const y=points.map(p=>p[1]),h=quantile(y,.995)-quantile(y,.005),x=quantile(points.map(p=>p[0]),.5);
   const central=points.filter(p=>Math.abs(p[0]-x)<=h*.18);
   if(central.length>8)points=central;
  }
  const min=[0,1,2].map(i=>quantile(points.map(p=>p[i]),.005)),max=[0,1,2].map(i=>quantile(points.map(p=>p[i]),.995));
  if(part==='body')min[1]=ground;
  anatomy={min,max};anchorPoints=points;method=part==='body'?'body-geometry-core-estimate':tagged?'semantic-region-estimate':named?'named-region-estimate':'geometry-core-estimate';
 }
 let anchor=convert(landmarks.anchor);
 if(!anchor&&anatomy&&anchorPoints.length){
  const h=anatomy.max[1]-anatomy.min[1],cx=(anatomy.min[0]+anatomy.max[0])/2;
  const near=anchorPoints.filter(p=>Math.abs(p[0]-cx)<=h*(part==='body'?.045:.3)&&(part==='body'?p[1]>=anatomy.max[1]-h*.035:p[1]<=anatomy.min[1]+h*.035));
  if(near.length)anchor=[quantile(near.map(p=>p[0]),.5),part==='body'?quantile(near.map(p=>p[1]),.9):quantile(near.map(p=>p[1]),.1),quantile(near.map(p=>p[2]),.5)];
 }
 return {...box(all),anatomy,anchor,ground,rotation,confidence,method,axes:settings[part]?.axes||{up:'Y',front:'Z'},orientationProvenance:settings[part]?.axes?'user-defined':'glTF-coordinate-contract',namedFallback:named};
}

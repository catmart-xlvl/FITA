// Rendering-only partition of a reviewed mixed primitive. Export buffers, skin,
// UVs and original materials remain untouched; accessories retain their shading.
export function splitPreparedMixedHair(root){
 const candidates=[];root.traverse(mesh=>{if(mesh.isMesh&&mesh.geometry.getAttribute('_workbench_hair_mask'))candidates.push(mesh);});
 const splits=[];
 for(const mesh of candidates){
  const source=mesh.geometry,mask=source.getAttribute('_workbench_hair_mask'),position=source.getAttribute('position'),index=source.index;
  if(!position||mask.itemSize!==1||mask.count!==position.count||!index||index.count%3||source.groups.length>1)continue;
  const hair=[],accessories=[];let valid=true;
  for(let i=0;i<index.count;i+=3){const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)],weights=ids.map(id=>mask.getX(id));if(weights.some(v=>v!==0&&v!==1)||weights.some(v=>v!==weights[0])){valid=false;break;}(weights[0]?hair:accessories).push(...ids);}
  if(!valid||!hair.length||!accessories.length)continue;
  const hairGeometry=source.clone(),accessoryGeometry=source.clone();hairGeometry.clearGroups();accessoryGeometry.clearGroups();hairGeometry.setIndex(hair);accessoryGeometry.setIndex(accessories);
  const accessory=mesh.clone(false);accessory.name=mesh.name+' · preserved accessories';accessory.geometry=accessoryGeometry;
  const copyMaterial=m=>{const copy=m.clone();copy.userData={...copy.userData,workbenchSurfaceRole:'other'};return copy;};
  accessory.material=Array.isArray(mesh.material)?mesh.material.map(copyMaterial):copyMaterial(mesh.material);
  delete accessory.userData.workbenchHairNormals;accessory.userData.workbenchMixedHairAccessory=true;
  accessory.position.set(0,0,0);accessory.quaternion.identity();accessory.scale.set(1,1,1);accessory.updateMatrix();
  mesh.geometry=hairGeometry;mesh.add(accessory);splits.push({mesh,source,hairGeometry,accessory,accessoryGeometry});
 }
 return ()=>{for(const s of splits){s.mesh.geometry=s.source;s.mesh.remove(s.accessory);s.hairGeometry.dispose();s.accessoryGeometry.dispose();for(const m of [s.accessory.material].flat())m.dispose();}};
}

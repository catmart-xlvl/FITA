import * as THREE from 'three';
// These planes live in world space, outside the editable model and its export.
export function placementOverlay(scene){
 let version=0,meshes={},anchor=null,side='front',enabled=true,settings={scale:1,x:0,y:0},disposed=false;
 const overlayScene=new THREE.Scene(),group=new THREE.Group();overlayScene.add(group);
 function clear(){for(const m of Object.values(meshes)){m.geometry.dispose();m.material.map.dispose();m.material.dispose();group.remove(m);}meshes={};}
 function update(){
  for(const [key,m] of Object.entries(meshes)){
   m.visible=enabled&&key===side&&!!anchor;
   if(!anchor)continue;
   const height=anchor.height*settings.scale;
   m.scale.set(height*m.userData.aspect,height,1);
   m.rotation.y=key==='left'?Math.PI/2:0;
   m.position.copy(anchor.center);
   m.position.y+=settings.y*anchor.height;
   if(key==='left')m.position.z-=settings.x*anchor.height;else m.position.x+=settings.x*anchor.height;
  }
 }
 return {
  async load(refs){const generation=++version;clear();await Promise.all(Object.entries(refs||{}).filter(([s,r])=>['front','left'].includes(s)&&r?.url).map(async([s,r])=>{
   let texture;try{texture=await new THREE.TextureLoader().loadAsync(r.url);}catch{return;}
   if(disposed||generation!==version){texture.dispose();return;}
   texture.colorSpace=THREE.SRGBColorSpace;
   const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.5,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
   const m=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);m.userData.aspect=texture.image.width/texture.image.height;m.renderOrder=100;meshes[s]=m;group.add(m);update();
  }));},
  anchor(box){anchor={center:box.getCenter(new THREE.Vector3()),height:box.getSize(new THREE.Vector3()).y};update();},
  view(value){side=value;update();},
  settings(value){settings=value;enabled=value.enabled!==false;update();},
  align(camera,target){const d=camera.position.clone().sub(target).normalize();group.visible=side==='front'?d.dot(new THREE.Vector3(0,0,1))>.9999:side==='left'?d.dot(new THREE.Vector3(1,0,0))>.9999:false;},
  render(renderer,camera){const before=renderer.autoClear;try{renderer.autoClear=false;renderer.render(overlayScene,camera);}finally{renderer.autoClear=before;}},
  dispose(){disposed=true;version++;clear();overlayScene.remove(group);}
 };
}

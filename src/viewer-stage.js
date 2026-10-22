import {CanvasTexture,SRGBColorSpace,Mesh,PlaneGeometry,MeshBasicMaterial,Group} from 'three';

// Viewport backdrop: neutral dark-grey studio gradient with a vignette (no UI tint: the model keeps its own colours).
// Static canvas texture (no per-frame cost). Presentation only; never exported.
export function stageBackground(){
  const size=512,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const g=canvas.getContext('2d');
  const base=g.createRadialGradient(size*.5,size*.4,size*.04,size*.5,size*.48,size*.78);
  base.addColorStop(0,'#2a2a2a');base.addColorStop(.45,'#1a1a1a');base.addColorStop(1,'#0b0b0b');
  g.fillStyle=base;g.fillRect(0,0,size,size);
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;return texture;
}

function radial(stops){
  const size=128,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const g=canvas.getContext('2d'),grad=g.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
  for(const [at,color] of stops)grad.addColorStop(at,color);
  g.fillStyle=grad;g.fillRect(0,0,size,size);
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;return texture;
}

// Soft neutral contact shadow under the feet (y = 0). No coloured floor glow (DIS-005).
export function floorAccent(){
  const group=new Group();group.name='FITA floor accent';
  const shadowMap=radial([[0,'rgba(0,0,0,.75)'],[.5,'rgba(0,0,0,.35)'],[1,'rgba(0,0,0,0)']]);
  const shadow=new Mesh(new PlaneGeometry(1,1),new MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false,toneMapped:false}));
  shadow.rotation.x=-Math.PI/2;shadow.raycast=()=>{};shadow.position.y=.002;shadow.renderOrder=-1;
  group.add(shadow);group.visible=false;
  return {
    object:group,
    fit(size){const w=Math.max(Math.min(size.x,size.y*.32),.4),d=Math.max(size.z*1.3,.4);shadow.scale.set(w,d,1);group.visible=true;},
    dispose(){shadow.geometry.dispose();shadow.material.map.dispose();shadow.material.dispose();},
  };
}

export const studioLighting=Object.freeze({intensity:1,fill:.4,rotation:0,exposure:1});
export const lightingControls=[
  {key:'intensity',label:'Light intensity',min:0,max:2,step:.05},
  {key:'fill',label:'Fill light',min:0,max:1.5,step:.05},
  {key:'rotation',label:'Light rotation',min:-180,max:180,step:5},
  {key:'exposure',label:'Exposure',min:.4,max:1.8,step:.05},
];
export function normalizeLighting(value){return Object.fromEntries(lightingControls.map(({key,min,max})=>[key,typeof value?.[key]==='number'&&Number.isFinite(value[key])?Math.min(max,Math.max(min,value[key])):studioLighting[key]]));}
export function readLighting(storage){try{return normalizeLighting(JSON.parse(storage.getItem('workbench.preview.lighting')));}catch{return {...studioLighting};}}
export function applyLighting({ambient,key,fill,rim,renderer,scene},settings,anime=false){
  const s=normalizeLighting(settings),angle=s.rotation*Math.PI/180;
  const position=(light,x,y,z)=>light.position.set(x*Math.cos(angle)+z*Math.sin(angle),y,z*Math.cos(angle)-x*Math.sin(angle));
  position(key,3,4,5);position(fill,-4,2,4);position(rim,-2,4,-4);
  ambient.color.set(anime?0xffffff:0xf5f7ff);ambient.groundColor.set(anime?0xffffff:0x9ea7b5);
  key.color.set(0xffffff);fill.color.set(0xffffff);
  ambient.intensity=s.intensity*(anime?.22:.48);
  key.intensity=s.intensity*(anime?2.65:1.32);
  fill.intensity=s.intensity*s.fill*(anime?.18:1.08);
  rim.intensity=s.intensity*(anime?.06:.39);
  if(scene){scene.environmentIntensity=anime?0:s.intensity*.39;scene.environmentRotation.y=angle;}
  renderer.toneMappingExposure=s.exposure;
}

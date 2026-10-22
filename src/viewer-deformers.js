import {Group,Mesh,SphereGeometry,MeshBasicMaterial,Vector3,Matrix4,Matrix3,Raycaster,Vector2,Object3D} from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {createDeformationSurface} from '../shared/placement-deformers.js';

export function viewportDeformers({parts,model,scene,camera,renderer,orbit,state,tool,onChange,onSelect,onAdd,onDelete,onGesture,onError}){
 const meshes=[];
 parts.forEach((part,index)=>part.traverse(mesh=>{if(!mesh.isMesh)return;const key=mesh.userData.placementMeshKey;if(!key)return;mesh.geometry=mesh.geometry.clone();const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,ids=Object.entries(mesh.geometry.attributes).find(([name])=>name.toLowerCase()==='_workbench_vertex')?.[1],array=attribute=>Float32Array.from({length:attribute.count*3},(_,i)=>attribute[['getX','getY','getZ'][i%3]](Math.floor(i/3)));meshes.push({mesh,part:index===0?'head':'body',key,positions:array(p),normals:n?array(n):null,indices:mesh.geometry.index?Array.from(mesh.geometry.index.array):null,vertexIds:ids?Array.from({length:ids.count},(_,i)=>ids.getX(i)):null});}));
 let surface,records=[],current=state(),currentTool=tool(),selectedCenter,down,disposed=false,dragging=false,lastResult;
 const markers=new Group();scene.add(markers);const sphere=new SphereGeometry(1,20,12),markerMaterial=new MeshBasicMaterial({color:0xf2f2f2,depthTest:false}),selectedMaterial=new MeshBasicMaterial({color:0xffdb85,depthTest:false}),radiusMaterial=new MeshBasicMaterial({color:0xd9d9d9,wireframe:true,transparent:true,opacity:.15,depthTest:true});
 const radius=new Mesh(sphere,radiusMaterial);scene.add(radius);radius.visible=false;
 const proxy=new Object3D();scene.add(proxy);const gizmo=new TransformControls(camera,renderer.domElement);gizmo.setMode('translate');gizmo.setSpace('world');gizmo.setSize(.65);scene.add(gizmo.getHelper());
 gizmo.addEventListener('dragging-changed',e=>{dragging=e.value;orbit.enabled=!e.value;onGesture(e.value);if(!e.value)apply(current);});
 gizmo.addEventListener('objectChange',()=>{if(!selectedCenter||!currentTool.enabled)return;const delta=model.worldToLocal(proxy.position.clone()).sub(selectedCenter).toArray().map(n=>Math.abs(n)<1e-10?0:Number(n.toPrecision(10)));onChange(current.pins.map(p=>p.id===currentTool.selected?{...p,delta}:p));});
 function rebuild(){model.updateMatrixWorld(true);const inverse=new Matrix4().copy(model.matrixWorld).invert();records=meshes.map(item=>({...item,matrix:inverse.clone().multiply(item.mesh.matrixWorld).toArray()}));surface=createDeformationSurface(records);}
 function apply(value){
  if(disposed)return;current=value;try{
   if(!surface)rebuild();const result=surface.apply(value);lastResult=result;
   for(const {record,positions} of result.output){const mesh=record.mesh,attribute=mesh.geometry.attributes.position;attribute.array.set(positions);attribute.needsUpdate=true;
    if(record.normals){const normal=mesh.geometry.attributes.normal,target=surface.lookup.get(record.part+'/'+record.key),toWorld=new Matrix3().getNormalMatrix(target.matrix),toLocal=toWorld.clone().invert(),n=new Vector3();
     for(let i=0;i<target.count;i++){n.fromArray(record.normals,i*3);const j=result.fields.get(target.start+i);if(j)n.applyMatrix3(toWorld).applyMatrix3(new Matrix3().set(...j).invert().transpose()).applyMatrix3(toLocal).normalize();normal.setXYZ(i,n.x,n.y,n.z);}normal.needsUpdate=true;}
    mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
   }
   draw();
  }catch(error){onError(error.message);}
 }
 function draw(){
  markers.clear();radius.visible=false;selectedCenter=null;
  if(!currentTool.enabled){gizmo.detach();return;}
  model.updateMatrixWorld(true);
  for(const pin of current.pins){const target=surface.lookup.get(pin.part+'/'+pin.mesh),position=lastResult.world[target.start+pin.vertex].clone(),selected=pin.id===currentTool.selected,marker=new Mesh(sphere,selected?selectedMaterial:markerMaterial);marker.position.copy(model.localToWorld(position.clone()));marker.scale.setScalar(currentTool.compact?.004:.018);marker.renderOrder=100;marker.userData.pin=pin.id;markers.add(marker);
   if(selected){selectedCenter=position.sub(new Vector3(...(pin.enabled?pin.delta:[0,0,0])));radius.position.copy(marker.position);radius.scale.setScalar(surface.height*pin.radius*model.scale.x);radius.visible=!currentTool.compact;if(!dragging){proxy.position.copy(marker.position);proxy.updateMatrixWorld(true);}gizmo.attach(proxy);}
  }
  if(!selectedCenter)gizmo.detach();
 }
 const ray=new Raycaster(),ndc=new Vector2(),canvas=renderer.domElement;
 const cast=e=>{const r=canvas.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(ndc,camera);};
 const onDown=e=>{if(currentTool.enabled)canvas.focus({preventScroll:true});down={x:e.clientX,y:e.clientY,button:e.button,gizmo:gizmo.axis!==null||gizmo.dragging};};
 const onUp=e=>{const start=down;down=null;if(!currentTool.enabled||!start||start.button!==0||start.gizmo||Math.hypot(start.x-e.clientX,start.y-e.clientY)>4)return;cast(e);const marker=ray.intersectObject(markers,true)[0];if(marker){onSelect(marker.object.userData.pin);return;}if(!currentTool.adding){onSelect(null);return;}
  const hit=ray.intersectObjects(meshes.map(item=>item.mesh),false)[0];if(!hit)return;const item=meshes.find(item=>item.mesh===hit.object),local=hit.object.worldToLocal(hit.point.clone()),vertices=[hit.face.a,hit.face.b,hit.face.c],vertex=vertices.reduce((a,b)=>new Vector3().fromBufferAttribute(item.mesh.geometry.attributes.position,a).distanceToSquared(local)<new Vector3().fromBufferAttribute(item.mesh.geometry.attributes.position,b).distanceToSquared(local)?a:b);
  // Anchor new pins to the original surface, so a later edit cannot accumulate
  // the already deformed position into the source.
  const center=Array.from(item.positions.slice(vertex*3,vertex*3+3));
  onAdd({id:crypto.randomUUID(),part:item.part,mesh:item.key,vertex,center,delta:[0,0,0],radius:.08,connectedOnly:true,enabled:true});
 };
 const onKey=e=>{if(currentTool.enabled&&e.key==='Delete'&&currentTool.selected){e.preventDefault();onDelete();}};
 canvas.tabIndex=0;canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointerup',onUp);canvas.addEventListener('keydown',onKey);
 return {apply,tool(value){currentTool=value;if(lastResult)draw();},transforms(){surface=null;apply(current);},dispose(){disposed=true;canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointerup',onUp);canvas.removeEventListener('keydown',onKey);gizmo.dispose();scene.remove(gizmo.getHelper(),proxy,markers,radius);sphere.dispose();markerMaterial.dispose();selectedMaterial.dispose();radiusMaterial.dispose();}};
}

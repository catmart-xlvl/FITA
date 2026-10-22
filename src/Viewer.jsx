import { useI18n } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {placementEstimate,identityPart} from './placement-math';
import {placementGeometry,framePlacementAssembly} from './placement-anatomy';
import {placementOverlay} from './placement-overlay';
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RotateCcw, Grid2X2, Scan, Box, Grid3X3, Sun, X } from "lucide-react";
import {previewMaterials,hairHighlightDefault} from './viewer-materials';
import {nativeTopology} from './native-topology.js';
import {silhouettePreview} from './viewer-silhouette';
import {stageBackground,floorAccent} from './viewer-stage';
import {hologramLayer} from './viewer-hologram';
import {studioLighting,lightingControls,readLighting,normalizeLighting,applyLighting} from './viewer-lighting';
import {attachHairNormalStudy} from './viewer-hair-normals';
import hairNormalStudies from './hair-normal-studies.json';
import garmentPaintStudies from './garment-paint-studies.json';
import {loadTextureTrial} from './viewer-texture-trial';
import {rigPreview} from './viewer-rigging';
import {motionLibrary,motionLibraries,idolMotionLibrary} from './animation-retarget';
import {keepAnimatedMeshesVisible} from './viewer-visibility';
import {applyFacialPose} from './viewer-facial';
import {viewportDeformers} from './viewer-deformers';
import {emptyDeformers} from '../shared/placement-deformers';
import {watchViewerSize} from './viewer-resize';
export default function Viewer({ url, companionUrl=null, processing=null, colorLabels=false, facetedGeometry=false, placement=null, onPlacementChange=null, onPlacementBounds=null, autoPlacementKey=0, placementSetup=null, onPlacementAnalysis=null, placementPick=null, onPlacementPoint=null, editHead=false, placementLocked=false, references=null, onHeadScale=null, deformers=null,deformerTool=null,onDeformersChange=null,onDeformerSelect=null,onDeformerAdd=null,onDeformerDelete=null,onDeformerGesture=null,meshEditorPanel=null, rigControls=false, rigConfig=null, facialPose=null, hologram=false }) {
  const { t, language, message } = useI18n();
  const facialRef=useRef(facialPose);facialRef.current=facialPose;
  const hologramRef=useRef(hologram);hologramRef.current=hologram;
  useEffect(()=>{api.current?.hologram?.(hologram);},[hologram]);
  const host = useRef(),
    api = useRef(),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [geometryOnly,setGeometryOnly]=useState(false),
    [wire, setWire] = useState(false),
    [showGrid,setShowGrid]=useState(true),
    [headSelected,setHeadSelected]=useState(false),
    [stats, setStats] = useState(null);
  const [garmentAvailable,setGarmentAvailable]=useState(false),[garmentAfter,setGarmentAfter]=useState(false),[garmentError,setGarmentError]=useState('');
  useEffect(()=>{api.current?.facial?.(facialPose);},[facialPose]);
  useEffect(()=>{api.current?.materials?.compareTextures(garmentAfter);},[garmentAfter]);
  const [hairHighlightAvailable,setHairHighlightAvailable]=useState(false),[hairHighlight,setHairHighlight]=useState(hairHighlightDefault);
  useEffect(()=>{api.current?.materials?.hairHighlight(hairHighlight);},[hairHighlight]);
  const [shading,setShading]=useState(()=>{try{const value=localStorage.getItem('workbench.preview.shading');return ['mtoon','basecolor'].includes(value)?value:'original';}catch{return 'original';}});
  const shadingRef=useRef(shading);
  const [rigAvailable,setRigAvailable]=useState(false),[rigClips,setRigClips]=useState([]),[pose,setPose]=useState('Idle'),[paused,setPaused]=useState(false),[showBones,setShowBones]=useState(true);
  const [physicsAvailable,setPhysicsAvailable]=useState(false),[physicsEnabled,setPhysicsEnabled]=useState(false),[physicsStrength,setPhysicsStrength]=useState(.7),[motionState,setMotionState]=useState('loading');
  useEffect(()=>{api.current?.rig?.physics.enable(physicsEnabled);},[physicsEnabled]);
  useEffect(()=>{api.current?.rig?.physics.strength(physicsStrength);},[physicsStrength]);
  useEffect(()=>{api.current?.rig?.select(pose);api.current?.rig?.pause(paused);},[pose]);
  useEffect(()=>{api.current?.rig?.pause(paused);},[paused]);
  useEffect(()=>{if(api.current?.rig)api.current.rig.helper.visible=showBones;},[showBones]);
  const placementLockRef=useRef(placementLocked);placementLockRef.current=placementLocked;
  useEffect(()=>{if(placementLocked)api.current?.hideHeadGizmo?.();},[placementLocked]);
  const placementRef=useRef(placement),changeRef=useRef(onPlacementChange);
  const deformRef=useRef(),deformToolRef=useRef(),deformCallbacks=useRef();deformRef.current=deformers||emptyDeformers();deformToolRef.current=deformerTool||{};deformCallbacks.current={change:onDeformersChange,select:onDeformerSelect,add:onDeformerAdd,delete:onDeformerDelete,gesture:onDeformerGesture};
  useEffect(()=>{api.current?.deformers?.apply(deformRef.current);},[deformers]);
  useEffect(()=>{api.current?.deformers?.tool(deformToolRef.current);if(deformerTool?.enabled)api.current?.hideHeadGizmo?.();},[deformerTool]);
  const pendingAuto=useRef(false);
  const setupRef=useRef(placementSetup),analysisRef=useRef(onPlacementAnalysis),pickRef=useRef(placementPick),pointRef=useRef(onPlacementPoint);
  setupRef.current=placementSetup;analysisRef.current=onPlacementAnalysis;pickRef.current=placementPick;pointRef.current=onPlacementPoint;
  const [referenceSide,setReferenceSide]=useState('front'),[overlaySettings,setOverlaySettings]=useState({front:{scale:1,x:0,y:0,enabled:true},left:{scale:1,x:0,y:0,enabled:true}});
  const referencesRef=useRef(references),overlayRef=useRef(overlaySettings);referencesRef.current=references;overlayRef.current=overlaySettings;
  useEffect(()=>{api.current?.references(references);},[JSON.stringify(references)]);
  useEffect(()=>{api.current?.overlay(overlaySettings[referenceSide]||overlaySettings.front);},[overlaySettings,referenceSide]);
  placementRef.current=placement;changeRef.current=onPlacementChange;
  useEffect(()=>{api.current?.placement(placement);},[placement]);
  useEffect(()=>{if(autoPlacementKey){pendingAuto.current=true;if(api.current?.sourceKey===JSON.stringify([url,companionUrl]))api.current.automatic();}},[autoPlacementKey]);
  const [lighting,setLighting]=useState(()=>readLighting(globalThis.localStorage)),[lightingOpen,setLightingOpen]=useState(false);
  const lightingRef=useRef(lighting);
  useEffect(()=>{lightingRef.current=lighting;api.current?.lighting(lighting);try{localStorage.setItem('workbench.preview.lighting',JSON.stringify(lighting));}catch{}},[lighting]);
  useEffect(()=>{shadingRef.current=shading;api.current?.shading(shading);try{localStorage.setItem('workbench.preview.shading',shading);}catch{}},[shading]);
  useEffect(() => {
    if (!host.current) return;
    let disposed = false,
      frame,
      model,materials,rig,hairStudy,garmentTrial;
    setGarmentAvailable(false);setGarmentAfter(false);setGarmentError('');
    setHairHighlightAvailable(false);setHairHighlight(hairHighlightDefault);
    setRigAvailable(false);setRigClips([]);setPose('Idle');setPaused(false);setShowBones(true);setPhysicsAvailable(false);setPhysicsEnabled(false);setMotionState('loading');
    setError("");
    setLoaded(false);
    setGeometryOnly(false);
    setWire(false);
    setShowGrid(true);
    setHeadSelected(false);
    setStats(null);
    const scene = new THREE.Scene();
    const backdrop=stageBackground(),floor=floorAccent(),holo=hologramLayer();
    scene.background = backdrop;
    scene.add(floor.object);
    const camera = editHead?new THREE.OrthographicCamera(-2,2,2,-2,.001,100):new THREE.PerspectiveCamera(35, 1, .01, 100);
    camera.aspect=1;camera.fov=35;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError(
        t("WebGL is unavailable in this browser. You can still download the GLB."),
      );
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    const silhouette=silhouettePreview(renderer);
    const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
    const environment=pmrem.fromScene(room,.04);
    scene.environment=environment.texture;
    room.dispose();pmrem.dispose();
    host.current.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    const referenceOverlay=editHead?placementOverlay(scene):null;referenceOverlay?.load(referencesRef.current);
    let parts=[],originalBoxes=[],gizmo,proxy,deformEditor,proxyCenter=new THREE.Vector3(),syncing=false,stopPicking=null;
    function syncProxy(){if(!proxy||!model)return;model.updateMatrixWorld(true);new THREE.Box3().setFromObject(parts[0]).getCenter(proxyCenter);proxy.position.copy(proxyCenter);proxy.updateMatrixWorld(true);}
    function applyPlacement(value){
      if(!value||parts.length!==2)return;
      for(const [i,g] of ['head','body'].entries()){
        parts[i].position.fromArray(value[g].position);parts[i].rotation.set(...value[g].rotation);parts[i].scale.setScalar(value[g].scale);
      }
      model?.updateMatrixWorld(true);
      deformEditor?.transforms();
      syncProxy();
    }
    function fitAssembly(){
      if(!model)return;
      modelSize.copy(framePlacementAssembly(model,placementRef.current&&parts.length===2?parts[1]:null));
      floor.fit(modelSize);syncProxy();referenceOverlay?.anchor(new THREE.Box3().setFromObject(model));
    }
    function automatic(){if(parts.length===2){pendingAuto.current=false;try{
      const result=placementEstimate(...parts.map((p,i)=>placementGeometry(p.children[0],i===0?'head':'body',setupRef.current||{})),setupRef.current||{});
      analysisRef.current?.(result.report);
      if(result.transforms){applyPlacement(result.transforms);fitAssembly();changeRef.current?.(result.transforms,result.report);center('front');}
    }catch(e){setError(e.message);analysisRef.current?.({confidence:'low',reason:e.message});}}}
    controls.enableDamping = true;
    controls.zoomToCursor = true;
    const ambient=new THREE.HemisphereLight(0xf2f5ff, 0x38383e, .45);
    scene.add(ambient);
    const light = new THREE.DirectionalLight(0xfff8f0, 2.6);
    light.position.set(3, 6, 4);
    scene.add(light);
    const fill = new THREE.DirectionalLight(0xe5edff, .4);
    fill.position.set(-4, 2, -3);
    scene.add(fill);
    const rim=new THREE.DirectionalLight(0xffffff,.8);scene.add(rim);
    const lights={ambient,key:light,fill,rim,renderer,scene};
    const grid = new THREE.GridHelper(8, 32, 0x363636, 0x222222);
    scene.add(grid);
    const origin = new THREE.AxesHelper(0.5);
    scene.add(origin);
    let modelSize=new THREE.Vector3(2.8,2.8,2.8),direction=new THREE.Vector3(3.2,1.3,4.2).normalize();
    function center(view='perspective') {
      setReferenceSide(view);referenceOverlay?.view(view);referenceOverlay?.settings(overlayRef.current[view]||overlayRef.current.front);
      const currentBox=editHead&&model?new THREE.Box3().setFromObject(model):null;
      if(currentBox)currentBox.getSize(modelSize);
      // Anatomical sides for a character facing +Z in glTF (Blender faces -Y).
      direction=new THREE.Vector3(...(view==='front'?[0,0,1]:view==='right'?[-1,0,0]:view==='left'?[1,0,0]:view==='back'?[0,0,-1]:[3.2,1.3,4.2])).normalize();
      const halfAngle=THREE.MathUtils.degToRad(camera.fov*.5),width=['left','right'].includes(view)?modelSize.z:modelSize.x;
      const distance=Math.max(modelSize.y/(2*Math.tan(halfAngle)),width/(2*Math.tan(halfAngle)*camera.aspect),modelSize.z)*1.35;
      if(camera.isOrthographicCamera){const span=Math.max(modelSize.y,width/camera.aspect)*1.25;camera.top=span/2;camera.bottom=-span/2;camera.left=-span*camera.aspect/2;camera.right=span*camera.aspect/2;camera.updateProjectionMatrix();}
      if(currentBox)currentBox.getCenter(controls.target);else controls.target.set(0, modelSize.y*.5, 0);
      camera.position.copy(controls.target).addScaledVector(direction,distance);
      controls.update();
    }
    center();
    api.current = {
      sourceKey:JSON.stringify([url,companionUrl]),
      center,
      grid,
      placement:applyPlacement,automatic,
      references(value){referenceOverlay?.load(value);},overlay(value){referenceOverlay?.settings(value);},
      shading(value){materials?.set(value);materials?.exposure(lightingRef.current.exposure);materials?.intensity(lightingRef.current.intensity);applyLighting(lights,lightingRef.current,value==='mtoon'&&!materials?.isGeometry);if(hologramRef.current&&model){holo.forget();holo.apply(model,modelSize.y);}},
      hologram(on){if(!model)return;if(on){holo.apply(model,modelSize.y);}else{holo.restore();api.current?.shading(shadingRef.current);}},
      lighting(value){materials?.exposure(value.exposure);materials?.intensity(value.intensity);applyLighting(lights,value,shadingRef.current==='mtoon'&&!materials?.isGeometry);},
      wire(value) {
        materials?.wire(value);
      },
    };
    api.current.lighting(lightingRef.current);
    if (url)
      Promise.all([url,...(companionUrl?[companionUrl]:[])].map(path=>new GLTFLoader().loadAsync(path))).then(
        (loadedParts) => {
          if (disposed) return;
          // Frame the assembly once; never normalize its individual parts.
          model = new THREE.Group();
          for(const part of loadedParts){
            keepAnimatedMeshesVisible(part.scene);
            part.scene.traverse(n=>{const association=part.parser.associations.get(n),index=association?.nodes;if(index!==undefined)n.userData.workbenchSourceName=part.parser.json.nodes[index]?.name;if(n.isMesh){let ancestor=n,nodeIndex;while(ancestor&&nodeIndex===undefined){nodeIndex=part.parser.associations.get(ancestor)?.nodes;ancestor=ancestor.parent;}if(nodeIndex!==undefined)n.userData.placementMeshKey=nodeIndex+':'+(association?.primitives??0);}});
            if(rigControls){
              rig=rigPreview(part.scene,rigConfig||{});
              if(rig){
                const activeRig=rig;api.current.rig=rig;rig.select('Idle');setRigClips(rig.clips.filter(c=>c.tracks.length).map(c=>c.name));setRigAvailable(true);setPhysicsAvailable(rig.physics.available);
                Promise.allSettled(motionLibraries.map(async descriptor=>{
                  const library=await new GLTFLoader().loadAsync(descriptor.url);
                  try{if(!disposed){activeRig.addMotionLibrary(library.scene,library.animations,descriptor);setRigClips(activeRig.clips.filter(c=>c.tracks.length).map(c=>c.name));}}
                  finally{library.scene.traverse(n=>{n.geometry?.dispose();for(const m of Array.isArray(n.material)?n.material:n.material?[n.material]:[])m.dispose();});}
                })).then(results=>{if(!disposed)setMotionState(results.every(r=>r.status==='fulfilled')?'ready':results.every(r=>r.status==='rejected')?'failed':'partial');});
              }
            }
            const wrapper=new THREE.Group();wrapper.add(part.scene);parts.push(wrapper);model.add(wrapper);const b=new THREE.Box3().setFromObject(wrapper);originalBoxes.push({min:b.min.toArray(),max:b.max.toArray()});
          }
          if(placementRef.current&&parts.length===2)applyPlacement(placementRef.current);
          if(editHead&&parts.length===2){
            onPlacementBounds?.(originalBoxes[0]);
            const value=placementRef.current||{head:identityPart(),body:identityPart()};applyPlacement(value);
            proxy=new THREE.Object3D();scene.add(proxy);gizmo=new TransformControls(camera,renderer.domElement);gizmo.setMode('translate');gizmo.setSpace('world');gizmo.setSize(.8);scene.add(gizmo.getHelper());
            api.current.hideHeadGizmo=()=>{gizmo.detach();setHeadSelected(false);};
            gizmo.addEventListener('dragging-changed',e=>{controls.enabled=!e.value;});
            // The gizmo appears only after clicking the head; clicking elsewhere hides it. Orbit drags are ignored.
            const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),canvas=renderer.domElement;let down=null,hoverFrame=0;
            const hitsHead=e=>{const r=canvas.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(ndc,camera);return ray.intersectObject(parts[0],true).length>0;};
            const onDown=e=>{down={x:e.clientX,y:e.clientY,button:e.button,onGizmo:!!gizmo.object&&(gizmo.axis!==null||gizmo.dragging)};};
            const onUp=e=>{const start=down;down=null;if(placementLockRef.current||!start||start.button!==0||start.onGizmo||Math.hypot(e.clientX-start.x,e.clientY-start.y)>4)return;
              if(deformToolRef.current.enabled){gizmo.detach();setHeadSelected(false);return;}
              if(pickRef.current){const r=canvas.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(ndc,camera);const pick=pickRef.current,index=pick.part==='head'?0:1,hit=ray.intersectObject(parts[index],true)[0];if(hit)pointRef.current?.(pick,parts[index].worldToLocal(hit.point.clone()).toArray());return;}
              if(hitsHead(e)){syncProxy();gizmo.attach(proxy);setHeadSelected(true);canvas.style.cursor='';}else{gizmo.detach();setHeadSelected(false);}};
            const onMove=e=>{if(placementLockRef.current||down||gizmo.object||hoverFrame)return;hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;canvas.style.cursor=hitsHead(e)?'pointer':'';});};
            canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointerup',onUp);canvas.addEventListener('pointermove',onMove);
            stopPicking=()=>{cancelAnimationFrame(hoverFrame);canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointerup',onUp);canvas.removeEventListener('pointermove',onMove);};
            gizmo.addEventListener('objectChange',()=>{if(syncing||placementLockRef.current)return;syncing=true;const delta=model.worldToLocal(proxy.position.clone()).sub(model.worldToLocal(proxyCenter.clone()));parts[0].position.add(delta);syncProxy();const h=parts[0],next={head:{position:h.position.toArray(),rotation:[h.rotation.x,h.rotation.y,h.rotation.z],scale:h.scale.x},body:placementRef.current?.body||identityPart()};changeRef.current?.(next);syncing=false;});
          }
          fitAssembly();
          if(placementRef.current&&parts.length===2){deformEditor=viewportDeformers({parts,model,scene,camera,renderer,orbit:controls,state:()=>deformRef.current,tool:()=>deformToolRef.current,onChange:pins=>deformCallbacks.current.change?.({version:1,pins}),onSelect:id=>deformCallbacks.current.select?.(id),onAdd:pin=>deformCallbacks.current.add?.(pin),onDelete:()=>deformCallbacks.current.delete?.(),onGesture:active=>deformCallbacks.current.gesture?.(active),onError:setError});api.current.deformers=deformEditor;deformEditor.apply(deformRef.current);}
          let polygons=0,nativeMeshes=0;
          let triangles = 0,
            meshes = 0;
          model.traverse((o) => {
            if (o.isMesh) {
              meshes++;
              if(facetedGeometry){const topology=nativeTopology(o.geometry);if(topology){polygons+=topology.polygons;nativeMeshes++;topology.geometry.dispose();}}
              triangles +=
                (o.geometry.index?.count ||
                  o.geometry.attributes.position?.count ||
                  0) / 3;
            }
          });
          scene.add(model);
          api.current.facial=pose=>applyFacialPose(model,pose?.bindings,pose?.values);
          api.current.facial(facialRef.current);
          const study=hairNormalStudies[url?.split('/').pop()?.split('?')[0]];
          if(study?.approved)attachHairNormalStudy(model,study).then(result=>{
            if(disposed){result?.dispose();return;}
            hairStudy=result;
            if(result){result.set(1);materials?.hairNormals(1);}
          }).catch(()=>{if(!disposed)setError(language==='es'?'No se pudieron preparar las normales del cabello.':'Hair normals could not be prepared.');});
          referenceOverlay?.anchor(new THREE.Box3().setFromObject(model));
          syncProxy();
          if(pendingAuto.current)automatic();
          materials=previewMaterials(model,{colorLabels,facetedGeometry,surfaces:study?.surfaces||{},hairNormalNode:hairStudy?.node||study?.node});
          api.current.materials=materials;setHairHighlightAvailable(materials.hasHair);
          const garment=garmentPaintStudies[url?.split('/').pop()?.split('?')[0]];
          if(garment&&!rigControls&&!editHead&&!colorLabels)loadTextureTrial(model,url,garment).then(result=>{if(disposed){result.dispose();return;}garmentTrial=result;setGarmentAvailable(materials.textureTrial(result.maps));}).catch(()=>{if(!disposed)setGarmentError(language==='es'?'Prueba de ropa no disponible; se conserva el original.':'Clothing trial unavailable; original preserved.');});
          api.current.frameGarment=()=>{const box=new THREE.Box3();model.traverse(o=>{if(o.isMesh&&o.userData.workbenchSourceName==='vestuario export')box.expandByObject(o);});if(box.isEmpty())return;const size=box.getSize(new THREE.Vector3()),target=box.getCenter(new THREE.Vector3()),distance=Math.max(size.y,size.x/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.2;controls.target.copy(target);camera.position.copy(target).add(new THREE.Vector3(0,0,distance));controls.update();};
          setGeometryOnly(materials.isGeometry);
          api.current.shading(shadingRef.current);
          setStats({ triangles: Math.round(triangles), meshes,polygons:nativeMeshes===meshes?polygons:null });
          setLoaded(true);
          center(editHead?'front':'perspective');
        },
        () => {
          if (!disposed)
            setError(
              t("This GLB could not be displayed. It may need an unsupported extension or texture. You can download the original file."),
            );
        },
      );
    const resize=watchViewerSize(host.current,renderer,camera);
    const clock=new THREE.Clock();
    function tick() {
      frame = requestAnimationFrame(tick);
      resize.pixelRatio();
      const delta=Math.min(clock.getDelta(),.1);
      materials?.update(delta);
      rig?.update(delta);
      controls.update();
      referenceOverlay?.align(camera,controls.target);
      if(hologramRef.current&&model)holo.apply(model,modelSize.y); // re-cover meshes whose material was reassigned
      holo.tick(performance.now()/1000);
      if(model&&!holo.active&&!colorLabels&&shadingRef.current==='mtoon'&&!materials?.isGeometry)silhouette.render(scene,camera,model,[grid,origin,floor.object]);
      else renderer.render(scene, camera);
      referenceOverlay?.render(renderer,camera);
    }
    tick();
    return () => {
      disposed = true;
      api.current=null;
      cancelAnimationFrame(frame);
      resize.dispose();
      controls.dispose();
      stopPicking?.();
      deformEditor?.dispose();
      gizmo?.dispose();
      referenceOverlay?.dispose();
      materials?.dispose();
      hairStudy?.dispose();
        garmentTrial?.dispose();
      rig?.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material)
          for (const m of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
            m.dispose();
          }
      });
      environment.dispose();
      silhouette.dispose();
      floor.dispose();backdrop.dispose();holo.restore();holo.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url,companionUrl,colorLabels,facetedGeometry,editHead,rigControls,rigConfig]);
  return (
    <div className={'viewer'+(processing?' is-processing':'')+(hologram?' is-hologram':'')}>
      <div ref={host} className="canvas-host" />
      {editHead&&loaded&&meshEditorPanel}
      {rigControls&&rigAvailable&&<div className="rig-preview-tools">
        <select aria-label={t('Test animation')} value={pose} onChange={e=>setPose(e.target.value)}>{['Rest pose',...rigClips].map(name=><option key={name} value={name}>{t(name)}</option>)}</select>
        <button className="button secondary" aria-pressed={paused} onClick={()=>setPaused(!paused)}>{t(paused?'Play':'Pause')}</button>
        {pose===idolMotionLibrary.selection[0]?.[1]&&<button className="button secondary" onClick={()=>{api.current?.rig?.select(pose);api.current?.rig?.pause(false);setPaused(false);}}>{t('Restart animation')}</button>}
        <button className="button secondary" aria-pressed={showBones} onClick={()=>setShowBones(!showBones)}>{t('Show skeleton')}</button>
        {physicsAvailable&&<>
          <button className="button secondary" aria-pressed={physicsEnabled} onClick={()=>setPhysicsEnabled(!physicsEnabled)}>{t('Preview physics')}</button>
          {physicsEnabled&&<><label className="physics-strength">{t('Physics strength')} <input aria-label={t('Physics strength')} type="range" min="0" max="1" step=".05" value={physicsStrength} onChange={e=>setPhysicsStrength(Number(e.target.value))}/></label><button className="button secondary" disabled={paused} onClick={()=>api.current?.rig?.physics.impulse()}>{t('Test impulse')}</button></>}
        </>}
        <span className="rig-preview-note" role="status">{motionState==='failed'?t('Natural animations could not be loaded.'):motionState==='partial'?t('Some animations could not be loaded.'):motionState==='loading'?t('Loading natural animations…'):pose.includes('Quaternius')?<a href={motionLibrary.source} target="_blank" rel="noreferrer">Quaternius · CC0</a>:null}{physicsEnabled&&' · '+t('Local physics preview; destination settings remain separate.')}</span>
      </div>}
      <div className="viewport-label">
        <Box size={14} /> {editHead?(language==='es'?'ORTOGRÁFICA':'ORTHOGRAPHIC'):t("PERSPECTIVE")} <span>GLB 2.0</span>
      </div>
      {!loaded && !error && (
        <div className="viewer-message">
          {url
            ? t("Loading geometry…")
            : t("Import or generate a model to inspect it.")}
        </div>
      )}
      {error && <div className="viewer-message error">{message(error)}</div>}
      {processing&&<div className="texture-progress" role="status"><span className="texture-progress-dot"/>{processing}</div>}
      {processing&&<div className="texture-scan" aria-hidden="true"/>}
      <div className="viewer-toolbar">
        <select aria-label={t('Preview shading')} title={t('Preview only. Original textures and files stay unchanged.')} value={colorLabels?'basecolor':geometryOnly?'original':shading} disabled={geometryOnly||colorLabels} onChange={e=>setShading(e.target.value)}><option value="original">{t(geometryOnly?'Studio gray':'Original material')}</option><option value="basecolor">{t('Base color')}</option><option value="mtoon">{t('Anime · MToon')}</option></select>
        <button aria-label={t('Studio lighting')} title={t('Studio lighting')} aria-expanded={lightingOpen} className={lightingOpen?'selected':''} onClick={()=>setLightingOpen(!lightingOpen)}><Sun size={17}/></button>
        <button className={editHead?'view-named':''} aria-label={t('Front view')} title={t('Front view')} onClick={()=>api.current?.center('front')}>{editHead?(language==='es'?'Frontal':'Front'):'F'}</button>
        {editHead?<button className="view-named" aria-label="Lateral izquierda" title="Lateral izquierda" onClick={()=>api.current?.center('left')}>{language==='es'?'Lateral izquierda':'Left side'}</button>:<><button aria-label={t('Right view')} title={t('Right view')} onClick={()=>api.current?.center('right')}>R</button><button aria-label={t('Back view')} title={t('Back view')} onClick={()=>api.current?.center('back')}>B</button></>}
        <button aria-label={t("Frame model")} title={t("Frame model")} onClick={() => api.current?.center()}>
          <Scan size={17} />
        </button>
        <button aria-label={t('Show grid')} title={t('Show grid')} aria-pressed={showGrid} onClick={()=>{if(api.current)api.current.grid.visible=!showGrid;setShowGrid(!showGrid);}}><Grid3X3 size={17}/></button>
        <button
          className={wire ? "selected" : ""}
          aria-label={t("Toggle wireframe")} aria-pressed={wire} title={t("Toggle wireframe")}
          onClick={() => {
            api.current?.wire(!wire);
            setWire(!wire);
          }}
        >
          <Grid2X2 size={17} />
        </button>
        <button aria-label={t("Reset view")} title={t("Reset view")} onClick={() => api.current?.center()}>
          <RotateCcw size={17} />
        </button>
      </div>
      {(hairHighlightAvailable||garmentAvailable||garmentError)&&<div className="hair-normal-study" aria-label={language==='es'?'Comparación de acabado':'Finish comparison'}>
        {garmentAvailable&&<><label>{language==='es'?'Ropa · pintura provisional':'Clothing · provisional paint'} <select aria-label="Garment texture comparison" value={garmentAfter?'after':'before'} onChange={e=>setGarmentAfter(e.target.value==='after')}><option value="before">{language==='es'?'Antes':'Before'}</option><option value="after">{language==='es'?'Después · prueba':'After · trial'}</option></select></label><button className="button secondary" onClick={()=>api.current?.frameGarment()}>{language==='es'?'Ver ropa':'Frame clothing'}</button></>}
        {garmentError&&<small role="status">{garmentError}</small>}
        {hairHighlightAvailable&&<label>{language==='es'?'Brillo del cabello · vista previa':'Hair highlight · preview'} {Math.round(hairHighlight*100)}% <input aria-label="Hair highlight strength" type="range" min="0" max="0.6" step="0.05" value={hairHighlight} disabled={shading!=='mtoon'} onChange={e=>setHairHighlight(Number(e.target.value))}/></label>}
        <small>{language==='es'?'Solo vista previa. Compara con material original o Anime y gira la luz.':'Preview only. Compare with original material or Anime and rotate the light.'}</small>
      </div>}
      {editHead&&!placementLocked&&loaded&&!headSelected&&!deformerTool?.enabled&&<div className="placement-hint" role="status">{language==='es'?'Haz clic en la cabeza para moverla':'Click the head to move it'}</div>}
      {editHead&&!placementLocked&&loaded&&!deformerTool?.enabled&&<div className="placement-view-tools">
        <label>{language==='es'?'Escala de cabeza':'Head scale'} <input aria-label="Head scale in viewport" type="number" min="0.00001" max="10000" step="0.01" value={placement?.head?.scale||1} onChange={e=>{const n=Number(e.target.value);if(n>0&&n<=10000)onHeadScale?.(n);}}/></label>
        <div><button onClick={()=>onHeadScale?.((placement?.head?.scale||1)/1.05)}>−5%</button><button onClick={()=>onHeadScale?.((placement?.head?.scale||1)*1.05)}>+5%</button></div>
        {['front','left'].includes(referenceSide)&&<>
          {references?.[referenceSide]?<>
            <label><input type="checkbox" checked={overlaySettings[referenceSide].enabled} onChange={e=>setOverlaySettings(v=>({...v,[referenceSide]:{...v[referenceSide],enabled:e.target.checked}}))}/>{language==='es'?'Referencia · 50 %':'Reference · 50%'}</label>
            {['scale','x','y'].map(k=><label key={k}>{k==='scale'?(language==='es'?'Tamaño de guía':'Guide size'):k.toUpperCase()}<input aria-label={'Reference '+k} type="number" step={k==='scale'?.05:.01} value={overlaySettings[referenceSide][k]} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&(k!=='scale'||n>0))setOverlaySettings(v=>({...v,[referenceSide]:{...v[referenceSide],[k]:n}}));}}/></label>)}
          </>:<small>{language==='es'?'Esta guía no está incluida en las vistas del proyecto.':'This guide is not included in the project’s views.'}</small>}
        </>}
      </div>}
      {lightingOpen&&<section className="viewer-lighting" aria-label={t('Studio lighting')} onKeyDown={e=>{if(e.key==='Escape')setLightingOpen(false);}}>
        <div className="viewer-lighting-heading"><strong>{t('Studio lighting')}</strong><button aria-label={t('Close lighting')} onClick={()=>setLightingOpen(false)}><X size={15}/></button></div>
        {lightingControls.map(({key,label,min,max,step})=><label key={key}><span>{t(label)} <output>{key==='rotation'?lighting[key]+'°':lighting[key].toFixed(2)}</output></span><input aria-label={t(label)} type="range" min={min} max={max} step={step} value={lighting[key]} onChange={e=>setLighting(current=>normalizeLighting({...current,[key]:Number(e.target.value)}))}/></label>)}
        <button className="button secondary" onClick={()=>setLighting({...studioLighting})}>{t('Reset studio lighting')}</button>
        <small>{t('Lighting affects the preview only.')}</small>
        {shading==='mtoon'&&!geometryOnly&&<small>{t('Anime exposure lifts shadows toward the texture color without whitening it.')}</small>}
        {shading==='basecolor'&&!geometryOnly&&<small>{t('Base color shows the texture without studio lighting.')}</small>}
      </section>}
      <div className="viewport-bottom">
        <span>
          {t("Drag to orbit · Scroll to zoom · Right-drag to pan")}
        </span>
        {stats && (
          <span>
            {stats.polygons!=null?`${stats.polygons.toLocaleString(language)} ${language==='es'?'polígonos originales':'native polygons'} · ${stats.meshes} ${language==='es'?'mallas':'meshes'}`:t("{triangles} triangles · {meshes} meshes", {triangles:stats.triangles.toLocaleString(language), meshes:stats.meshes})}
          </span>
        )}
      </div>
    </div>
  );
}

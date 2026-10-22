"""Reopen the saved result and render both anatomical profiles without moving geometry."""
import bpy, json, math, sys, hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
script_dir=Path(__file__).resolve().parent
root=Path(sys.argv[sys.argv.index('--')+1]).resolve() if '--' in sys.argv else script_dir
sys.path.insert(0,str(script_dir))
from export_evaluated_parts import export_evaluated_parts
bpy.ops.wm.open_mainfile(filepath=str(root/'placed.blend'),load_ui=False,use_scripts=False)
parts={g:[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('workbench_part')==g] for g in ['head','body']}
if not all(parts.values()):raise ValueError('PLACEMENT_PART_TAGS_REQUIRED')
deps=bpy.context.evaluated_depsgraph_get()
def geometry(objects):
    vertices=[];triangles=[]
    for o in objects:
        evaluated=o.evaluated_get(deps);mesh=evaluated.to_mesh();mesh.calc_loop_triangles();offset=len(vertices)
        vertices.extend(evaluated.matrix_world@v.co for v in mesh.vertices)
        triangles.extend(tuple(offset+i for i in t.vertices) for t in mesh.loop_triangles);evaluated.to_mesh_clear()
    return vertices,triangles
geometries={g:geometry(objects) for g,objects in parts.items()}
trees={g:BVHTree.FromPolygons(*value,all_triangles=True) for g,value in geometries.items()}
overlaps=len(trees['head'].overlap(trees['body']))
pts=[v for pair in geometries.values() for v in pair[0]]
low=Vector([min(p[i] for p in pts) for i in range(3)]);high=Vector([max(p[i] for p in pts) for i in range(3)])
center=(low+high)*.5;size=high-low;extent=max(size)
scene=bpy.context.scene
engines=scene.render.bl_rna.properties['engine'].enum_items.keys()
scene.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
scene.render.resolution_x=1024;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.world=bpy.data.worlds.new('Review neutral');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.055,.055,.065,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
camera_data=bpy.data.cameras.new('Review camera');camera=bpy.data.objects.new('Review camera',camera_data);scene.collection.objects.link(camera);scene.camera=camera;camera_data.type='ORTHO';camera_data.ortho_scale=extent*1.15;camera_data.clip_end=extent*20
for name,delta in [('Key',(2,-3,4)),('Fill',(-3,-1,2)),('Back',(1,3,3))]:
    light_data=bpy.data.lights.new(name,'AREA');light_data.energy=350*extent*extent;light_data.shape='DISK';light_data.size=extent*2
    light=bpy.data.objects.new(name,light_data);scene.collection.objects.link(light);light.location=center+Vector(delta)*extent;light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler()
directions={'front':(0,-1,0),'left':(1,0,0),'right':(-1,0,0),'back':(0,1,0)}
def render(name,direction,target,span):
    camera_data.ortho_scale=span
    camera.location=target+Vector(direction)*extent*3;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(root/(name+'.png'));bpy.ops.render.render(write_still=True)
def evidence_file(name):
    return {'file':name,'sha256':hashlib.sha256((root/name).read_bytes()).hexdigest()}
for name,direction in directions.items():render(name,direction,center,extent*1.15)
# Anatomical neck focus is supplied after inspecting the model, never inferred from hair bounds.
settings=json.loads((root/'settings.json').read_text(encoding='utf-8')) if (root/'settings.json').exists() else {}
neck=settings.get('neckReview');neck_files={}
if neck:
    target=neck['center'];span=neck['span']
    if len(target)!=3 or not all(math.isfinite(x) for x in target) or not math.isfinite(span) or span<=0:raise ValueError('PLACEMENT_NECK_CAMERA_INVALID')
    for view in ('front','left','right'):
        render('neck_'+view,directions[view],Vector(target),span)
        neck_files[view]=evidence_file('neck_'+view+'.png')
coverage_files={};coverage=settings.get('coverageReview')
if coverage:
    target=coverage['center'];span=coverage['span'];tilt=coverage.get('tilt',.35)
    if len(target)!=3 or not all(math.isfinite(x) for x in target) or not math.isfinite(span) or span<=0 or not math.isfinite(tilt) or not .1<=tilt<=.65:raise ValueError('PLACEMENT_COVERAGE_CAMERA_INVALID')
    overrides=[]
    for material in bpy.data.materials:
        if not material.use_nodes:continue
        nodes=material.node_tree.nodes;links=material.node_tree.links;bsdf=nodes.get('Principled BSDF');output=next((n for n in nodes if n.type=='OUTPUT_MATERIAL'),None)
        if not bsdf or not output or not output.inputs['Surface'].is_linked:continue
        original=output.inputs['Surface'].links[0].from_socket;em=nodes.new('ShaderNodeEmission');colour=bsdf.inputs['Base Color']
        if colour.is_linked:links.new(colour.links[0].from_socket,em.inputs['Color'])
        else:em.inputs['Color'].default_value=colour.default_value
        links.new(em.outputs[0],output.inputs['Surface']);overrides.append((material,output,original,em))
    render('coverage_front_high',(0,-1,tilt),Vector(target),span)
    for material,output,original,em in overrides:material.node_tree.links.new(original,output.inputs['Surface']);material.node_tree.nodes.remove(em)
    coverage_files['front-high']={**evidence_file('coverage_front_high.png'),'mode':'base-color'}
evidence={'scene':evidence_file('placed.blend'),'coordinateConvention':'Z up, character faces -Y; left/right are anatomical',
          'renders':{name:{**evidence_file(name+'.png'),'anatomicalView':name,'cameraDirection':list(direction)} for name,direction in directions.items()},
          'references':{name:evidence_file('reference_'+name+'.png') for name in ('front','left','right') if (root/('reference_'+name+'.png')).exists()},'necks':neck_files,'coverage':coverage_files}
(root/'review-evidence.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
report=json.loads((root/'report.json').read_text(encoding='utf-8')) if (root/'report.json').exists() else {}
report.update(reviewRequired=True,independentParts=True,headMeshes=len(parts['head']),bodyMeshes=len(parts['body']),overlappingTrianglePairs=overlaps,collisionCaveat='Surface intersection candidates only. Includes legitimate neck contact; requires visual review.',renders=[name+'.png' for name in directions],reviewEvidence=evidence)
(root/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
# Export evaluated modifiers, excluding review-only camera/lights. Keep the editable blend intact.
export_evaluated_parts(root/'placed.glb',[o for objects in parts.values() for o in objects])

"""A fresh synthetic character, UV export -> Placement -> weighted rig.
No production project is opened or modified.
"""
import bpy,sys,json,runpy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server/blender'))
from mesh_connectivity import stamp
from place_parts import import_part
from export_evaluated_parts import export_evaluated_parts
from validate_rig_connectivity import validate

folder=Path(sys.argv[sys.argv.index('--')+1]).resolve();folder.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('Garment');mesh.from_pydata([(0,0,0),(1,0,0),(1,0,1),(0,0,1)],[],[(0,1,2),(0,2,3)]);mesh.update()
obj=bpy.data.objects.new('Garment',mesh);bpy.context.collection.objects.link(obj)
uv=mesh.uv_layers.new(name='UVMap')
for face in mesh.polygons:
 for loop in face.loop_indices:
  v=mesh.vertices[mesh.loops[loop].vertex_index].co;uv.data[loop].uv=(v.x*.4+face.index*.5,v.z)
material=bpy.data.materials.new('Garment');material.use_nodes=True
image=bpy.data.images.new('Color',width=2,height=2);image.pixels[:]=[.2,.4,.6,1]*4;image.pack()
node=material.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;material.node_tree.links.new(node.outputs['Color'],material.node_tree.nodes.get('Principled BSDF').inputs['Base Color']);mesh.materials.append(material)
stamp(mesh)
bpy.ops.export_scene.gltf(filepath=str(folder/'textured.glb'),export_format='GLB',export_attributes=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
objects,meshes=import_part(str(folder/'textured.glb'),'body');obj=meshes[0]
assert len(obj.data.vertices)==4
bpy.ops.wm.save_as_mainfile(filepath=str(folder/'original.blend'),compress=False)
export_evaluated_parts(folder/'original.glb',meshes)
# Weight the actual connected editable source, not a raw GLB import.
arm=bpy.data.armatures.new('Rig');rig=bpy.data.objects.new('Rig',arm);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for name,x in [('Hips',0),('Arm',1)]:
 bone=arm.edit_bones.new(name);bone.head=(x,0,0);bone.tail=(x,0,1)
bpy.ops.object.mode_set(mode='OBJECT')
modifier=obj.modifiers.new('Armature','ARMATURE');modifier.object=rig
hips=obj.vertex_groups.new(name='Hips');hips.add(list(range(4)),.75,'REPLACE')
arm_group=obj.vertex_groups.new(name='Arm');arm_group.add(list(range(4)),.25,'REPLACE')
obj.name='Garment export'
bpy.ops.wm.save_as_mainfile(filepath=str(folder/'rigged.blend'),compress=False)
bpy.ops.export_scene.gltf(filepath=str(folder/'rigged.glb'),export_format='GLB',export_attributes=True,export_def_bones=False,export_animations=False,export_influence_nb=4)
assert validate(str(folder/'original.blend'),str(folder/'rigged.blend'))['editableConnectivityPreserved']
# A visually identical result with UV-split editable vertices must be rejected.
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(folder/'rigged.glb'),merge_vertices=False)
bpy.ops.wm.save_as_mainfile(filepath=str(folder/'split.blend'),compress=False)
try:validate(str(folder/'original.blend'),str(folder/'split.blend'))
except ValueError as e:assert 'SPLIT_EDITABLE_MESH' in str(e)
else:raise AssertionError('Disconnected editable rig accepted')
# Exercise the same FBX/weights exchange used by the application.
import shutil
shutil.copyfile(folder/'rigged.glb',folder/'model.glb')
script=Path('server/blender/rig_weight_exchange.py').resolve()
for mode in ['export','import']:
 job={'mode':mode,'folder':str(folder),'candidate':str(folder/'model.fbx'),'output':str(folder/'manual.glb'),'report':str(folder/'manual-report.json')}
 file=folder/(mode+'.json');file.write_text(json.dumps(job));sys.argv=['test','--',str(file)];runpy.run_path(str(script),run_name='__main__')
print('RIG_CONNECTIVITY_PIPELINE_OK: connected Placement source, weighted GLB, connected editable rig, split result rejected, FBX weight round trip')

"""Unpaid cleanup regression; protected sources and nonduplicate surfaces."""
import bpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server/blender'))
from clean_duplicate_faces import clean
bpy.ops.wm.read_factory_settings(use_empty=True)
points=[(0,0,0),(1,0,0),(0,1,0)]*6
faces=[(0,1,2),(3,4,5),(8,7,6),(9,10,11),(12,13,14),(15,16,17)]
mesh=bpy.data.meshes.new('original');mesh.from_pydata(points,[],faces);mesh.update()
obj=bpy.data.objects.new('source',mesh);bpy.context.scene.collection.objects.link(obj)
for name in ['skin','clothing']:mesh.materials.append(bpy.data.materials.new(name))
mesh.polygons[3].material_index=1
uv=mesh.uv_layers.new(name='UVMap');uv.data[12].uv=(.25,.5)
mesh.vertices[15].co.z=.00001
copy=obj.copy();copy.data=mesh.copy();bpy.context.scene.collection.objects.link(copy)
before=[tuple(v.co) for v in mesh.vertices];matrix=copy.matrix_world.copy()
report=clean([copy]);assert report['removedCount']==1,report
assert report['objects'][0]['removedFaceIndices']==[1]
assert len(mesh.polygons)==6 and len(copy.data.polygons)==5
assert before==[tuple(v.co) for v in copy.data.vertices] and copy.matrix_world==matrix
assert clean([copy])['removedCount']==0
# Different explicit corner normals must protect an otherwise exact duplicate.
normal_mesh=bpy.data.meshes.new('normals');normal_mesh.from_pydata(points[:6],[],faces[:2]);normal_mesh.update()
normal_obj=bpy.data.objects.new('normal seams',normal_mesh);bpy.context.scene.collection.objects.link(normal_obj)
normal_mesh.normals_split_custom_set([(0,0,1)]*3+[(0,.6,.8)]*3)
assert clean([normal_obj])['removedCount']==0
print('DUPLICATE_CLEANUP_OK: exact copies removed; sources, positions, winding, materials, UV seams, normals and nearby surfaces preserved')

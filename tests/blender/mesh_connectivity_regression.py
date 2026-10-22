"""Blender --background --python tests/blender/mesh_connectivity_regression.py"""
import bpy,sys,tempfile,json,struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server/blender'))
from mesh_connectivity import stamp,import_connected_glb,restore

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('Seamed garment')
# Two connected triangles with a UV seam; a coincident but independent triangle
# must stay separate even though its geometry, normals and UVs are identical.
mesh.from_pydata([(0,0,0),(1,0,0),(1,1,0),(0,1,0),(0,0,0),(1,0,0),(1,1,0)],[],[(0,1,2),(0,2,3),(4,5,6)])
obj=bpy.data.objects.new('Seamed garment',mesh);bpy.context.collection.objects.link(obj)
uv=mesh.uv_layers.new(name='UVMap')
for face in mesh.polygons:
    for loop in face.loop_indices:
        v=mesh.vertices[mesh.loops[loop].vertex_index].co
        uv.data[loop].uv=(v.x+(.25 if face.index==1 else 0),v.y)
stamp(mesh)
directory=Path(tempfile.mkdtemp(prefix='wb-connectivity-'));file=directory/'seams.glb'
bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',export_attributes=True)
raw=file.read_bytes();doc=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
print('ATTRIBUTES',doc['meshes'][0]['primitives'][0]['attributes'])
bpy.ops.wm.read_factory_settings(use_empty=True)
objects=import_connected_glb(file);m=next(o.data for o in objects if o.type=='MESH')
assert len(m.vertices)==7, ('source identity lost',len(m.vertices))
faces=[set(f.vertices) for f in m.polygons]
assert len(faces[0]&faces[1])==2 and not faces[0]&faces[2]
assert sorted(tuple(v.uv) for v in m.uv_layers.active.data)==sorted([(0.,0.),(1.,0.),(1.,1.),(.25,0.),(1.25,1.),(.25,1.),(0.,0.),(1.,0.),(1.,1.)])
# Repeated serialization remains idempotent.
bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',export_attributes=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
objects=import_connected_glb(file);assert len(next(o.data for o in objects if o.type=='MESH').vertices)==7
obj=next(o for o in objects if o.type=='MESH')
try:restore(obj,[0]*7)
except ValueError as e:assert str(e)=='PLACEMENT_CONNECTIVITY_CONFLICT'
else:raise AssertionError('moved vertices merged')
print('CONNECTIVITY_TESTS_OK: UV seam restored, independent coincident layer retained, UVs retained, round trip stable, conflicting positions rejected')

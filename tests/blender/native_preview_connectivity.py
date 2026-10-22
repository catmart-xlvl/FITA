"""Blender background regression: preserve coincident faces and UV/normal fans."""
import bpy, sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'server/blender'))
from mesh_connectivity import restore_native_preview

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new('Native preview')
# Same IDs authorize joining all four faces. Two duplicates have the same
# winding, one has opposite winding. None may disappear during connectivity.
mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)] * 4, [], [(0,1,2),(3,4,5),(6,8,7),(9,10,11)])
obj = bpy.data.objects.new('Native preview', mesh)
bpy.context.collection.objects.link(obj)
for name, values in [('_workbench_vertex', [0,1,2]*4), ('_wb_face', [0]*3+[1]*3+[2]*3+[3]*3)]:
    attr = mesh.attributes.new(name, 'FLOAT', 'POINT')
    attr.data.foreach_set('value', values)
uv = mesh.uv_layers.new(name='UVMap')
for i, item in enumerate(uv.data):
    item.uv = (i / 12, (i % 3) / 3)
before_uv = [tuple(v.uv) for v in uv.data]
before_normals = [tuple(n.vector) for n in mesh.corner_normals]
assert restore_native_preview(obj) == 9
assert len(obj.data.vertices) == 3
assert [tuple(f.vertices) for f in obj.data.polygons] == [(0,1,2),(0,1,2),(0,2,1),(0,1,2)]
assert [tuple(v.uv) for v in obj.data.uv_layers.active.data] == before_uv
assert all(sum((a-b)**2 for a,b in zip(n,actual.vector))**.5 < .018 for n,actual in zip(before_normals,obj.data.corner_normals))
assert '_wb_face' not in {a.name.lower() for a in obj.data.attributes}
assert len(mesh.vertices) == 12 and len(mesh.polygons) == 4, 'input mesh remains unchanged'

# IDs at conflicting positions must stop before replacing the mesh.
bad = mesh.copy()
bad.vertices[3].co.x += .1
obj.data = bad
try:
    restore_native_preview(obj)
except ValueError as error:
    assert str(error) == 'PLACEMENT_CONNECTIVITY_CONFLICT'
else:
    raise AssertionError('conflicting identities accepted')
assert obj.data == bad

# Real imported previews: no edits/exports to the project or child workspace.
if '--' in sys.argv:
    result = []
    for filename in sys.argv[sys.argv.index('--')+1:]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(Path(filename).resolve()))
        for obj in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
            original = obj.data
            before = (len(original.vertices),len(original.polygons),len(original.loops))
            print('NATIVE_ATTRIBUTES',[(a.name,a.domain,a.data_type) for a in original.attributes])
            restore_native_preview(obj)
            after = (len(obj.data.vertices),len(obj.data.polygons),len(obj.data.loops))
            assert before[1:] == after[1:]
            assert len(original.polygons) == before[1]
            result.append({'file':Path(filename).name,'before':before,'after':after})
    print('REAL_NATIVE_PREVIEW_CONNECTIVITY',json.dumps(result))
print('NATIVE_PREVIEW_CONNECTIVITY_OK')

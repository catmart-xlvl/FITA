"""Smooth painting guides while retaining flat source shading and geometry."""
import bpy, sys, tempfile, hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server/blender'))
import segment_mesh
from mesh_connectivity import stamp

root=Path(tempfile.mkdtemp(prefix='fita-smooth-guides-'))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=12)
obj=bpy.context.object
for p in obj.data.polygons:p.use_smooth=False
for e in obj.data.edges:e.use_edge_sharp=True
obj.data.normals_split_custom_set([p.normal for p in obj.data.polygons for _ in p.loop_indices])
stamp(obj.data)
source_file=root/'faceted.glb'
segment_mesh.export(source_file,[obj])
source_hash=hashlib.sha256(source_file.read_bytes()).hexdigest()
_,meshes=segment_mesh.import_glb(str(source_file))
obj=meshes[0]
source=obj.data

def geometry(mesh):
    return ([tuple(v.co) for v in mesh.vertices],
            [tuple(p.vertices) for p in mesh.polygons],
            [[tuple(v.uv) for v in layer.data] for layer in mesh.uv_layers],
            [p.material_index for p in mesh.polygons])

original_geometry=geometry(source)
original_normals=[tuple(n.vector) for n in source.corner_normals]
original_smooth=[p.use_smooth for p in source.polygons]
original_sharp=[e.use_edge_sharp for e in source.edges]

def check_preview(mesh):
    assert mesh!=source
    assert geometry(mesh)==original_geometry
    assert all(p.use_smooth for p in mesh.polygons)
    assert not any(e.use_edge_sharp for e in mesh.edges)
    # UV/normal splits do not cause a shading seam: the sphere normals should
    # point radially instead of following each flat polygon.
    alignment=[n.vector.dot(mesh.vertices[loop.vertex_index].co.normalized())
               for loop,n in zip(mesh.loops,mesh.corner_normals)]
    assert min(alignment)>.97,min(alignment)
    assert any((n.vector-p.normal).length>.05 for p in mesh.polygons
               for n in [mesh.corner_normals[p.loop_start]])

with segment_mesh.smooth_reference_preview([obj]):
    check_preview(obj.data)
assert obj.data==source
try:
    with segment_mesh.smooth_reference_preview([obj]):
        check_preview(obj.data)
        raise RuntimeError('render fixture failed')
except RuntimeError:
    pass
assert obj.data==source
assert geometry(source)==original_geometry
assert [tuple(n.vector) for n in source.corner_normals]==original_normals
assert [p.use_smooth for p in source.polygons]==original_smooth
assert [e.use_edge_sharp for e in source.edges]==original_sharp

# Legacy additive patches can inherit a repeated default ID at distinct
# positions. They must still render, without blending unrelated locations.
identity=next(a for a in source.attributes if a.name.lower()=='_workbench_vertex')
original_ids=[item.value for item in identity.data]
for item in identity.data:item.value=0
with segment_mesh.smooth_reference_preview([obj]):
    check_preview(obj.data)
assert [item.value for item in identity.data]==[0]*len(identity.data)
for item,value in zip(identity.data,original_ids):item.value=value

# Exercise the actual package renderer, not just the normal calculation.
segment_mesh.guides({'directory':str(root),'groups':[{'id':'smooth','file':str(source_file)}]})
assert all((root/('smooth_'+v+'.png')).exists() for v in ('front','right','back'))
assert hashlib.sha256(source_file.read_bytes()).hexdigest()==source_hash
print('SMOOTH_TEXTURE_GUIDES_OK',root)

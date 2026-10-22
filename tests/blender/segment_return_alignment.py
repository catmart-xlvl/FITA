"""Unpaid regression: normalized Studio exports, seams and unsafe returns."""
import bpy,sys,json
from pathlib import Path
from mathutils import Matrix,Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server/blender'))
import segment_mesh as seg
bpy.ops.wm.read_factory_settings(use_empty=True)
points=[(0,0,0),(1.3,0,0),(.1,.8,0),(.2,.1,1.7),(.3,-.6,.4)]
polys=[(0,1,2),(0,3,1),(1,3,2),(2,3,0),(0,4,1)]
def mesh(name,ps,fs):
 d=bpy.data.meshes.new(name);d.from_pydata(ps,[],fs);d.update();o=bpy.data.objects.new(name,d);bpy.context.scene.collection.objects.link(o);return o
source=mesh('unchanged master',points,polys);source.location=(.12,-.3,2);bpy.context.view_layer.update()
rotation=Matrix.Rotation(1.5707963267948966,3,'Z');scale=3.72;shift=Vector((2,-5,1))
# Split every triangle into independent vertices, reverse triangle and corner order.
ps=[];fs=[];expected={}
for pi,poly in reversed(list(enumerate(polys))):
 fs.append(tuple(range(len(ps),len(ps)+3)))
 for vi in reversed(poly):
  q=rotation@(source.matrix_world@Vector(points[vi]))*scale+shift
  ps.append([round(x,5) for x in q]);expected[pi,vi]=(.1+vi*.12,.2+pi*.1)
returned=mesh('Studio export',ps,fs);returned.data.materials.append(bpy.data.materials.new('returned material'))
uv=returned.data.uv_layers.new(name='SmartUV')
for p,(pi,poly) in zip(returned.data.polygons,reversed(list(enumerate(polys)))):
 for loop,vi in zip(p.loop_indices,reversed(poly)):uv.data[loop].uv=expected[pi,vi]
before=[tuple(v.co) for v in source.data.vertices];matrix=source.matrix_world.copy()
assert seg.transfer_uv([source],[returned])==len(polys)
assert before==[tuple(v.co) for v in source.data.vertices] and matrix==source.matrix_world
for pi,p in enumerate(source.data.polygons):
 for loop,vi in zip(p.loop_indices,p.vertices):assert (source.data.uv_layers.active.data[loop].uv-Vector(expected[pi,vi])).length<1e-6
def rejected(change):
 backup=[v.co.copy() for v in returned.data.vertices];change()
 try:seg.transfer_uv([source],[returned])
 except ValueError as e:assert str(e) in ('SEG_TRANSFER_TOPOLOGY_CHANGED','SEG_TRANSFER_ALIGNMENT_AMBIGUOUS')
 else:raise AssertionError('Unsafe return accepted')
 finally:
  for v,co in zip(returned.data.vertices,backup):v.co=co
rejected(lambda:setattr(returned.data.vertices[0].co,'x',returned.data.vertices[0].co.x+.02))
rejected(lambda:[setattr(v.co,'x',v.co.x*1.03) for v in returned.data.vertices])
rejected(lambda:[setattr(v.co,'x',-v.co.x) for v in returned.data.vertices])
print('SEGMENT_RETURN_ALIGNMENT_OK: normalization, quantization, reordered seams; master unchanged; deformation/nonuniform scale/reflection rejected')

# Studio drops exact duplicate triangles, but the master's geometry must remain
# intact. A single returned triangle supplies corner UVs to all its source copies.
duplicate=mesh('coincident master',points,polys+[polys[0],tuple(reversed(polys[1]))]);duplicate.matrix_world=source.matrix_world.copy();bpy.context.view_layer.update()
before=[tuple(p.vertices) for p in duplicate.data.polygons]
assert seg.transfer_uv([duplicate],[returned])==len(before)
assert before==[tuple(p.vertices) for p in duplicate.data.polygons]
assert json.loads(duplicate['workbench_uv_return_alignment'])['coincidentSourceFaces']==2
for p,pi in zip(duplicate.data.polygons,list(range(len(polys)))+[0,1]):
 for loop,vi in zip(p.loop_indices,p.vertices):assert (duplicate.data.uv_layers.active.data[loop].uv-Vector(expected[pi,vi])).length<1e-6
# Ambiguous returned duplicates are not equivalent to deduplication of sources.
clone=returned.copy();clone.data=returned.data.copy();bpy.context.scene.collection.objects.link(clone)
try:seg.transfer_uv([duplicate],[returned,clone])
except ValueError as e:assert str(e)=='SEG_TRANSFER_AMBIGUOUS'
else:raise AssertionError('Ambiguous returned duplicates accepted')
print('COINCIDENT_SOURCE_TRANSFER_OK: original faces preserved, unique returned UVs copied, ambiguous returned faces rejected')

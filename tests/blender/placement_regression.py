"""Run with Blender --background --factory-startup --python-exit-code 1 --python this-file."""
import bpy, importlib.util, math
from pathlib import Path

spec=importlib.util.spec_from_file_location('placement',Path(__file__).resolve().parents[2]/'server/blender/place_parts.py')
placement=importlib.util.module_from_spec(spec);spec.loader.exec_module(placement)
settings={'scale':1,'offset':[0,0,0],'rotation':[0,0,0],'headNeck':None,'bodyNeck':None}

def cylinder(radius,depth,location):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=radius,depth=depth,location=location)
    return bpy.context.object

def cube(location,scale):
    bpy.ops.mesh.primitive_cube_add(size=2,location=location)
    o=bpy.context.object;o.scale=scale;bpy.context.view_layer.update();return o

bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
# Different origins, a real neck, and raised sleeves at the same height.
head=[cylinder(.2,.6,(12,5,8.1)),cube((12,5,8.85),(.5,.45,.55))]
body=[cylinder(.3,1.9,(3,-4,1.95)),cylinder(.1,.4,(3,-4,3.1))]
body += [cube((3+side*.7,-4,3.1),(.5,.3,.15)) for side in [-1,1]]
ha,ba,bh,scale,method,warnings=placement.placement_anchors(head,body,settings)
assert method=='mesh-cross-sections' and not warnings,(method,warnings)
assert math.isclose(scale,.5,rel_tol=1e-4),scale
assert abs(ba['center'][0]-3)<1e-5 and abs(ba['center'][1]+4)<1e-5,ba
assert ba['center'][2]>2.9,ba

# No neck: wide open garment. A narrow lower torso must never be the neck.
for o in body: bpy.data.objects.remove(o,do_unlink=True)
body=[cylinder(.07,1.6,(3,-4,.8)),cylinder(.3,.6,(3,-4,1.8))]
body += [cube((3+side*.7,-4,2),(.5,.2,.1)) for side in [-1,1]]
ha,ba,bh,scale,method,warnings=placement.placement_anchors(head,body,settings)
assert method=='proportion-estimate' and warnings==['PLACEMENT_NECK_NOT_MEASURABLE']
assert ba['center'][2]>2.0 and ba['radius'] is None,ba
lo,hi=placement.bounds(placement.points(head))
assert math.isclose(scale*(hi[2]-lo[2])/bh,.22,rel_tol=1e-6)

# Manual anatomical sections override the automatic fallback; a scale tweak
# is applied once and neither path changes any source object's transform.
before=[o.matrix_world.copy() for o in head+body]
custom={**settings,'headNeck':.1,'bodyNeck':.94,'scale':1.2}
*_,manual_scale,method,warnings=placement.placement_anchors(head,body,custom)
assert method=='mesh-cross-sections' and not warnings
assert math.isclose(manual_scale,1.8,rel_tol=1e-4),manual_scale
assert all(o.matrix_world==matrix for o,matrix in zip(head+body,before))
print('PASS: independent neck contours, raised sleeves, absent neck fallback, manual override, source preservation')

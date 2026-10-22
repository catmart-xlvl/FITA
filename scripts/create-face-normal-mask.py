"""Build FITA's reusable unit front hemisphere. Run in isolated Blender."""
import bpy, json, math
from pathlib import Path
from mathutils import Vector

root = Path(__file__).resolve().parents[1] / 'resources' / 'face-normals'
root.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
# glTF +Y up, front +Z. Blender conversion is (x, -z, y).
verts, faces = [(0, -1, 0)], []
steps, segments = 32, 96
for i in range(1, steps + 1):
    theta = (math.pi / 2) * i / steps
    for k in range(segments):
        phi = 2 * math.pi * k / segments
        x, y, z = math.sin(theta)*math.cos(phi), math.sin(theta)*math.sin(phi), math.cos(theta)
        verts.append((x, -z, y))
for k in range(segments):
    faces.append((0, 1+k, 1+(k+1)%segments))
for i in range(steps - 1):
    a, b = 1+i*segments, 1+(i+1)*segments
    for k in range(segments):
        n = (k+1)%segments
        faces.append((a+k, b+k, b+n, a+n))
mesh=bpy.data.meshes.new('FITA_FaceNormalMask_UnitHemisphere')
mesh.from_pydata(verts, [], faces)
mesh.update()
for poly in mesh.polygons:
    poly.use_smooth=True
obj=bpy.data.objects.new('FITA_FaceNormalMask', mesh)
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active=obj
obj.select_set(True)
obj['purpose']='Temporary normals donor only; never export with the character'
# Radial analytic corner normals, matching the field evaluated by the GLB helper.
mesh.normals_split_custom_set_from_vertices([Vector(v).normalized() for v in verts])
mat=bpy.data.materials.new('FITA_NormalMask_Gray')
mat.diffuse_color=(.40,.50,.58,1)
obj.data.materials.append(mat)
bpy.ops.wm.save_as_mainfile(filepath=str(root/'face-normal-mask.blend'))
bpy.ops.export_scene.gltf(filepath=str(root/'face-normal-mask.glb'), export_format='GLB',
                          use_selection=True, export_normals=True, export_yup=True)
(root/'template.json').write_text(json.dumps({
    'schema':'workbench-face-mask-template/v1', 'name':obj.name,
    'gltfAxes':{'up':'+Y','front':'+Z'}, 'center':[0,0,0], 'radii':[1,1,1],
    'rotation':[0,0,0,1], 'units':'normalized, not a physical face measurement',
    'provenance':'FITA procedural template; unit dimensions chosen for reuse', 'openBack':True, 'exportWithCharacter':False,
    'fit':'Scale, rotate and place per character; review skin weights separately'
}, indent=2), encoding='utf-8')
print('FITA_FACE_MASK_CREATED', len(mesh.vertices), len(mesh.polygons))

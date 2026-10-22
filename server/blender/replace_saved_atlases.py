"""Replace packed image bindings in an already saved model; never re-export meshes."""
import bpy, sys, json, hashlib
from pathlib import Path
from array import array
sys.path.insert(0, str(Path(__file__).resolve().parent))
from refresh_placement_textures import geometry_state

def state():
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    digest = hashlib.sha256(geometry_state(objects).encode())
    for obj in sorted(objects, key=lambda o:o.name):
        mesh = obj.data
        for layer in mesh.uv_layers:
            values = array('f', [0]) * (len(layer.data)*2)
            layer.data.foreach_get('uv', values)
            digest.update(layer.name.encode()); digest.update(values.tobytes())
        values = array('f', [0]) * (len(mesh.corner_normals)*3)
        mesh.corner_normals.foreach_get('vector', values)
        digest.update(values.tobytes())
        digest.update(json.dumps([[v.index,[(g.group,g.weight) for g in v.groups]] for v in mesh.vertices]).encode())
        digest.update(json.dumps([p.material_index for p in mesh.polygons]).encode())
    return digest.hexdigest()

job=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf-8'))
bpy.ops.wm.open_mainfile(filepath=job['inputBlend'],load_ui=False,use_scripts=False)
before=state(); replacements={r['sha256']:r for r in job['images']}; found=set(); bindings=0
for image in list(bpy.data.images):
    if not image.packed_file: continue
    sha=hashlib.sha256(bytes(image.packed_file.data)).hexdigest()
    if sha not in replacements: continue
    replacement=bpy.data.images.load(replacements[sha]['path'],check_existing=False)
    replacement.colorspace_settings.name=image.colorspace_settings.name
    replacement.alpha_mode=image.alpha_mode
    replacement.pack()
    for material in bpy.data.materials:
        if not material.node_tree: continue
        for node in material.node_tree.nodes:
            if node.type=='TEX_IMAGE' and node.image==image:
                node.image=replacement; bindings+=1
    found.add(sha)
assert found==set(replacements), 'ATLAS_SAVED_IMAGE_NOT_FOUND'
assert before==state(), 'ATLAS_SAVED_GEOMETRY_CHANGED'
bpy.ops.wm.save_as_mainfile(filepath=job['outputBlend'],compress=False)
bpy.ops.wm.open_mainfile(filepath=job['outputBlend'],load_ui=False,use_scripts=False)
after=state(); assert before==after, 'ATLAS_SAVED_GEOMETRY_CHANGED'
Path(job['report']).write_text(json.dumps({'geometryUvNormalsWeightsTransformsPreserved':True,'before':before,'after':after,'savedAndReopened':True,'imageBindingsUpdated':bindings}),encoding='utf-8')

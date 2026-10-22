"""Update only facial loop UVs/materials in the reconstruction's editable copy."""
import bpy,sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from segment_mesh import import_glb
from face_uv_identity import identity_correspondence


def transfer_identity_uv(target,returned):
    def ids(mesh,source=False):
        attr=next((a for a in mesh.attributes if a.name.lower()=='_workbench_vertex'),None)
        if attr is None:return list(range(len(mesh.vertices))) if source else None
        if attr.domain!='POINT' or attr.data_type!='FLOAT':raise ValueError('PLACEMENT_FACE_UV_IDENTITY_INVALID')
        return [v.value for v in attr.data]
    def points(o):return [list(o.matrix_world@v.co) for v in o.data.vertices]
    a,b=target.data,returned.data
    assignments=identity_correspondence(points(target),[list(f.vertices) for f in a.polygons],ids(a,True),points(returned),[list(f.vertices) for f in b.polygons],ids(b))
    if not b.uv_layers.active or any(f.material_index>=len(b.materials) or b.materials[f.material_index] is None for f in b.polygons):raise ValueError('PLACEMENT_FACE_UV_IDENTITY_INVALID')
    # All correspondences are verified before changing the editable copy.
    a.materials.clear()
    for material in b.materials:a.materials.append(material)
    for layer in list(a.uv_layers):a.uv_layers.remove(layer)
    for layer in b.uv_layers:a.uv_layers.new(name=layer.name)
    for f,g,order in assignments:
        old,new=a.polygons[f],b.polygons[g]
        for layer in b.uv_layers:
            for loop,k in zip(old.loop_indices,order):a.uv_layers[layer.name].data[loop].uv=layer.data[list(new.loop_indices)[k]].uv
        old.material_index=new.material_index
    a.uv_layers.active=a.uv_layers[b.uv_layers.active.name];a.uv_layers.active.active_render=True

def run(job):
    bpy.ops.wm.open_mainfile(filepath=job['blend'],load_ui=False,use_scripts=False)
    targets=[o for o in bpy.context.scene.objects if o.type=='MESH' and (o.name==job['nodeName'] or o.get('workbench_texture_group')==job['nodeName'])]
    if len(targets)!=1:raise ValueError('FACE_UV_TARGET_AMBIGUOUS')
    target=targets[0]
    def geometry():return ([tuple(v.co) for v in target.data.vertices],[tuple(f.vertices) for f in target.data.polygons],list(target.matrix_world))
    before=geometry();original_name=target.name;target.name='UV destination temporary name'
    imported,meshes=import_glb(job['head']);returned=[o for o in meshes if o.name==job['nodeName']]
    if len(returned)!=1:raise ValueError('FACE_UV_TARGET_AMBIGUOUS')
    transfer_identity_uv(target,returned[0])
    for o in imported:bpy.data.objects.remove(o,do_unlink=True)
    target.name=original_name
    if geometry()!=before:raise ValueError('FACE_UV_GEOMETRY_CHANGED')
    bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=job['blend'],compress=False)
    bpy.ops.wm.open_mainfile(filepath=job['blend'],load_ui=False,use_scripts=False)
    target=bpy.data.objects[original_name]
    if geometry()!=before:raise ValueError('FACE_UV_GEOMETRY_CHANGED')

if __name__=='__main__':run(json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf-8-sig')))

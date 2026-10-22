"""Versioned editable downloads; never overwrite the approved source artifact."""
import bpy, sys, json, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mesh_connectivity import reference_tables, restore_from_reference, restore, stamp


def components(mesh):
    parent=list(range(len(mesh.vertices)))
    def root(i):
        while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
        return i
    for edge in mesh.edges:
        a,b=edge.vertices;parent[root(a)]=root(b)
    return len({root(p.vertices[0]) for p in mesh.polygons})


def surface(mesh):
    # Face-corner layout is independent of index encoding, but includes UVs and
    # custom normals. A repair cannot move geometry or repaint the surface.
    rows=[]
    for face in mesh.polygons:
        corners=[]
        for i in face.loop_indices:
            values=[tuple(mesh.vertices[mesh.loops[i].vertex_index].co),
                    *[tuple(uv.data[i].uv) for uv in mesh.uv_layers]]
            corners.append(str(values))
        rows.append(str((face.material_index, min(tuple(corners[i:]+corners[:i]) for i in range(len(corners))))))
    return hashlib.sha256(str(sorted(rows)).encode()).hexdigest()


def run(job):
    tables={}
    if job.get('reference'):
        bpy.ops.wm.open_mainfile(filepath=job['reference'],load_ui=False,use_scripts=False)
        tables=reference_tables(bpy.context.scene.objects)
    bpy.ops.wm.open_mainfile(filepath=job['input'],load_ui=False,use_scripts=False)
    report=[]
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH':continue
        before=surface(obj.data);count=components(obj.data)
        table=tables.get(obj.name)
        result=restore_from_reference(obj,table) if table else {'mergedVertices':restore(obj)}
        if surface(obj.data)!=before:raise ValueError('PLACEMENT_CONNECTIVITY_SURFACE_CHANGED')
        stamp(obj.data)
        report.append({'mesh':obj.name,'componentsBefore':count,'componentsAfter':components(obj.data),**result,'surfacePreserved':True})
    bpy.ops.wm.save_as_mainfile(filepath=job['blend'],compress=False)
    bpy.ops.wm.open_mainfile(filepath=job['blend'],load_ui=False,use_scripts=False)
    for row in report:
        if components(bpy.data.objects[row['mesh']].data)!=row['componentsAfter']:
            raise ValueError('PLACEMENT_CONNECTIVITY_SAVE_FAILED')
    bpy.ops.export_scene.fbx(filepath=job['fbx'],object_types={'MESH'},use_mesh_modifiers=True,
        bake_anim=False,path_mode='COPY',embed_textures=True,axis_forward='-Z',axis_up='Y')
    Path(job['report']).write_text(json.dumps({'schema':'workbench-connectivity/v1','meshes':report},indent=2))

if __name__=='__main__':
    run(json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf-8')))

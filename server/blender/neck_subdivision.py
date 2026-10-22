"""Optional, reproducible one/two cuts on reviewed upper-neck edges, before deformation."""
import bpy,bmesh,json
from mathutils import Vector

def subdivide_upper_neck(obj,edges,cuts=1):
    if obj.get('workbench_part')!='body' or cuts not in (1,2) or obj.get('workbench_neck_subdivision'):raise ValueError('PLACEMENT_NECK_SUBDIVISION_INVALID')
    body=[o.matrix_world@v.co for o in bpy.context.scene.objects if o.type=='MESH' and o.get('workbench_part')=='body' for v in o.data.vertices]
    height=max(p.z for p in body)-min(p.z for p in body);top=max(p.z for p in body)
    cap=[p for p in body if p.z>top-height*.01];lo=Vector([min(p[k] for p in cap) for k in range(3)]);hi=Vector([max(p[k] for p in cap) for k in range(3)])
    selected={tuple(sorted(e)) for e in edges}
    if not selected or len(selected)!=len(edges) or len(selected)>128:raise ValueError('PLACEMENT_NECK_SUBDIVISION_INVALID')
    bm=bmesh.new();bm.from_mesh(obj.data);bm.verts.ensure_lookup_table();bm.edges.ensure_lookup_table()
    chosen=[e for e in bm.edges if tuple(sorted(v.index for v in e.verts)) in selected]
    if len(chosen)!=len(selected):raise ValueError('PLACEMENT_NECK_SUBDIVISION_INVALID')
    touched={v for e in chosen for f in e.link_faces for v in f.verts}
    for v in touched:
        p=obj.matrix_world@v.co
        if not (p.z>top-height*.012 and lo.x-1e-5<=p.x<=hi.x+1e-5 and lo.y-1e-5<=p.y<=hi.y+1e-5):raise ValueError('PLACEMENT_NECK_SUBDIVISION_OUTSIDE_TUBE')
    original=set(bm.verts);ids=bm.verts.layers.float.get('_workbench_vertex')
    if ids is None:raise ValueError('PLACEMENT_NECK_VERTEX_IDS_REQUIRED')
    next_id=max(v[ids] for v in original)+1
    bmesh.ops.subdivide_edges(bm,edges=chosen,cuts=cuts,use_grid_fill=True,smooth=0)
    for v in bm.verts:
        if v not in original:v[ids]=next_id;next_id+=1
    bm.to_mesh(obj.data);bm.free();obj.data.update()
    obj['workbench_neck_subdivision']=json.dumps({'edges':edges,'cuts':cuts})

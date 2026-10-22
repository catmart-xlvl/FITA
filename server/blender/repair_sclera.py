"""Rebuild reviewed eye interiors only; replay against the saved placement."""
import bpy,bmesh,json,sys,math
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from correct_assembly import snapshot
from export_evaluated_parts import export_evaluated_parts
from sclera_boundary import validate_replacement

def require(ok):
    if not ok:raise ValueError('PLACEMENT_SCLERA_PATCH_INVALID')

def repair(patch):
    require(patch.get('schema') in ['workbench-sclera-repair/v1','workbench-sclera-repair/v2'] and len(patch.get('eyes',[]))==2)
    require({e.get('eye') for e in patch['eyes']}=={'L','R'})
    before=snapshot();face=bpy.data.objects.get('rostro');require(face is not None and face.get('workbench_part')=='head')
    point=lambda p:Vector((p[0],-p[2],p[1]))
    key=lambda p:tuple(round(c,5) for c in p)
    facekey=lambda pts:tuple(sorted(key(p) for p in pts))
    def corners(mesh,poly):
        return (poly.material_index,tuple((tuple(mesh.vertices[mesh.loops[i].vertex_index].co),tuple(tuple(l.data[i].uv) for l in mesh.uv_layers)) for i in poly.loop_indices))
    original_faces={facekey(face.data.vertices[i].co for i in f.vertices):corners(face.data,f) for f in face.data.polygons}
    removed=set();boundary_reports=[]
    for eye in patch['eyes']:
        obj=bpy.data.objects.get('WB_Sclera_'+eye['eye']);require(obj is not None and obj.get('workbench_part')=='head')
        old=[v.co for v in obj.data.vertices];low=Vector([min(v[k] for v in old) for k in range(3)]);high=Vector([max(v[k] for v in old) for k in range(3)]);margin=max(high-low)*.22
        def valid(p):return len(p)==3 and all(math.isfinite(c) for c in p) and all(low[k]-margin<=p[k]<=high[k]+margin for k in range(3))
        positions=eye.get('positions',[]);triangles=eye.get('triangles',[]);drops=eye.get('removeTriangles',[])
        require(16<=len(positions)<=3000 and 16<=len(triangles)<=5000 and len(drops)<=256)
        require(all(valid(point(p)) for p in positions))
        require(all(len(t)==3 and len(set(t))==3 and all(isinstance(i,int) and 0<=i<len(positions) for i in t) for t in triangles))
        for t in drops:
            require(len(t)==3 and all(valid(point(p)) for p in t));k=facekey(point(p) for p in t);require(k in original_faces and k not in removed);removed.add(k)
        if patch['schema']=='workbench-sclera-repair/v2':
            remaining=[list(f.vertices) for f in face.data.polygons if facekey(face.data.vertices[i].co for i in f.vertices) not in removed]
            boundary_reports.append(validate_replacement([list(v.co) for v in face.data.vertices],remaining,[list(point(p)) for p in positions],triangles,[list(point(p)) for p in eye.get('boundary',[])]))
        # Existing white unlit material is retained and checked, never global lighting.
        require(len(obj.data.materials)==1);mat=obj.data.materials[0]
        require(mat.use_nodes and any(n.type=='EMISSION' or n.type=='MIX_SHADER' for n in mat.node_tree.nodes))
        mesh=bpy.data.meshes.new(obj.name+'_Rebuilt');mesh.from_pydata([point(p) for p in positions],[],triangles);mesh.materials.append(mat);mesh.uv_layers.new(name='UVMap');obj.data=mesh
        identity=mesh.attributes.new('_workbench_vertex','FLOAT','POINT')
        for i,v in enumerate(identity.data):v.value=i
        for f in mesh.polygons:f.use_smooth=True
    bm=bmesh.new();bm.from_mesh(face.data);drop=[f for f in bm.faces if facekey(v.co for v in f.verts) in removed];require(len(drop)==len(removed))
    bmesh.ops.delete(bm,geom=drop,context='FACES_ONLY');bm.to_mesh(face.data);bm.free();face.data.update()
    require(len(face.data.polygons)==len(original_faces)-len(removed))
    require(all(corners(face.data,f)==original_faces[facekey(face.data.vertices[i].co for i in f.vertices)] for f in face.data.polygons))
    after=snapshot();require(before.keys()==after.keys())
    for name,old in before.items():
        new=after[name];require(old['matrix']==new['matrix'])
        if name not in ['rostro','WB_Sclera_L','WB_Sclera_R']:require(old==new)
        if name=='rostro':require(old['local']==new['local'] and old['materials']==new['materials'])
    return {'interiorsRebuilt':True,'boundaryValidation':boundary_reports,'removedInteriorFaces':len(removed),'neckShouldersTrapeziusPreserved':True,'irisLashesBrowsPreserved':True,'remainingFaceCornersAndUvsPreserved':True,'independentParts':True,'headMeshes':sum(v['part']=='head' for v in after.values()),'bodyMeshes':sum(v['part']=='body' for v in after.values())}

if __name__=='__main__':
    job=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf-8'))
    bpy.ops.wm.open_mainfile(filepath=job['input'],load_ui=False,use_scripts=False)
    report=repair(job['patch']);bpy.ops.wm.save_as_mainfile(filepath=job['blend'],compress=False)
    bpy.ops.wm.open_mainfile(filepath=job['blend'],load_ui=False,use_scripts=False)
    export_evaluated_parts(job['glb'],[o for o in bpy.context.scene.objects if o.type=='MESH'])
    Path(job['report']).write_text(json.dumps(report),encoding='utf-8')

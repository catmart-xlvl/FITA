"""Replay a locally reviewed source/result-bound hair, eye and neck-paint repair.

This module is reachable only through scoped_finish_repair's local hash registry.
It does not accept permissions or repair instructions from an uploaded archive.
"""
import bpy,json,hashlib,math
from pathlib import Path
from collections import Counter
from mathutils import Vector

def check(ok,message='Scoped hair/eye repair invalid'):
    if not ok:raise ValueError(message)

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def disk_check(old,spec,eye):
    rim=eye['rim'];check(len(rim)>=12 and len(set(rim))==len(rim))
    edge=lambda a,b:tuple(sorted((a,b)))
    barrier={edge(a,b) for a,b in zip(rim,rim[1:]+rim[:1])}
    source_edges={tuple(sorted(e.vertices)) for e in old.edges}
    check(barrier<=source_edges,'Eye cut must follow existing mesh edges')
    remaining=Counter()
    removed=set(spec['removeFaces'])
    for f in old.polygons:
        if f.index not in removed:
            for a,b in zip(list(f.vertices),list(f.vertices)[1:]+list(f.vertices)[:1]):remaining[edge(a,b)]+=1
    check(all(remaining[e]==1 for e in barrier),'Eye rim must end on retained facial mesh')
    faces=eye['addedFaces'];edges=Counter(edge(a,b) for f in faces for a,b in zip(f,f[1:]+f[:1]))
    check({e for e,n in edges.items() if n==1}==barrier and max(edges.values())==2,'New sclera must share the facial rim')
    verts={i for f in faces for i in f};check(len(verts)-len(edges)+len(faces)==1,'Sclera must be one disk')
    pending={0};seen=set()
    while pending:
        fi=pending.pop();seen.add(fi);vs=set(faces[fi])
        pending.update(j for j,f in enumerate(faces) if j not in seen and vs.intersection(f))
    check(len(seen)==len(faces),'Disconnected sclera')

def rebuild(obj,spec):
    old=obj.data;nv,nf=len(old.vertices),len(old.polygons)
    check(nv==spec['originalVertices'] and nf==spec['originalFaces'])
    check(len(old.uv_layers)==1 and not obj.modifiers and not old.shape_keys)
    removed=set(spec['removeFaces']);check(len(removed)==len(spec['removeFaces']) and all(type(i)==int and 0<=i<nf for i in removed))
    check(len(spec['vertices'])<800 and len(spec['faces'])<1800)
    check(len(spec['uv'])==len(spec['faces'])==len(spec['normals']))
    check(len({i for i,co in spec['positions']})==len(spec['positions']))
    points=[v.co.copy() for v in old.vertices];changes=dict(spec['positions'])
    for i,co in changes.items():
        check(type(i)==int and 0<=i<nv and len(co)==3 and all(math.isfinite(c) for c in co))
        world=obj.matrix_world@points[i]
        if obj.name=='head-face':
            check(1.014<world.z<1.035 and -.05<world.x<.05 and world.y<-.04)
            check((points[i]-Vector(co)).length*.55<.006,'Only local inside-eye rim smoothing is allowed')
        else:check((points[i]-Vector(co)).length*.55<.32,'Excessive hair movement')
        points[i]=Vector(co)
    for i in removed:
        world=[obj.matrix_world@old.vertices[v].co for v in old.polygons[i].vertices]
        if obj.name=='head-face':check(all(1.004<p.z<1.046 and -.058<p.x<.053 and p.y<-.025 for p in world),'Removed geometry outside local eye repair')
        else:check(all(p.z<.86 for p in world),'Hair cuts must be confined to the reviewed lower branches')
    if obj.name=='head-face':
        check(len(spec['eyes'])==2 and {e['side'] for e in spec['eyes']}=={'L','R'})
        check(set(i for e in spec['eyes'] for i in e['removeFaces'])==removed)
        check(set(changes)<={i for e in spec['eyes'] for i in e['rim']})
        for eye in spec['eyes']:disk_check(old,spec,eye)
    else:check(0<len(removed)<2200)
    for co in spec['vertices']:check(len(co)==3 and all(math.isfinite(c) for c in co));points.append(Vector(co))
    for f,uv,norm in zip(spec['faces'],spec['uv'],spec['normals']):
        check(len(f)==len(uv)==len(norm)==3 and len(set(f))==3 and all(type(i)==int and 0<=i<len(points) for i in f))
        check(all(len(v)==2 and all(math.isfinite(c) and 0<=c<=1 for c in v) for v in uv))
    kept=[f for f in old.polygons if f.index not in removed];faces=[list(f.vertices) for f in kept]+spec['faces']
    source_used={v for f in old.polygons for v in f.vertices};used=sorted({v for f in faces for v in f}|(set(range(nv))-source_used));indexmap={v:i for i,v in enumerate(used)}
    mesh=bpy.data.meshes.new(old.name+' scoped repair');mesh.from_pydata([points[i] for i in used],[],[[indexmap[v] for v in f] for f in faces]);mesh.update()
    for mat in old.materials:mesh.materials.append(mat)
    for i,f in enumerate(mesh.polygons):f.material_index=kept[i].material_index if i<len(kept) else 0;f.use_smooth=kept[i].use_smooth if i<len(kept) else True
    layer=mesh.uv_layers.new(name=old.uv_layers[0].name);uv=[old.uv_layers[0].data[i].uv.copy() for f in kept for i in f.loop_indices]+[Vector(v) for tri in spec['uv'] for v in tri]
    for dest,value in zip(layer.data,uv):dest.uv=value
    for attr in old.attributes:
        if attr.domain=='POINT' and attr.data_type in ('FLOAT','INT','BOOLEAN'):
            values=[d.value for d in attr.data];a=mesh.attributes.new(attr.name,attr.data_type,'POINT');extra=[max(values)+1+i for i in range(len(spec['vertices']))] if attr.name.lower()=='_workbench_vertex' else [0]*len(spec['vertices'])
            combined=values+extra
            for d,i in zip(a.data,used):d.value=combined[i]
    normals=[old.corner_normals[i].vector.copy() for f in kept for i in f.loop_indices]+[Vector(v) for tri in spec['normals'] for v in tri]
    sharp={tuple(sorted(e.vertices)):old.attributes['sharp_edge'].data[e.index].value for e in old.edges} if 'sharp_edge' in old.attributes else {}
    if sharp:
        attr=mesh.attributes.new('sharp_edge','BOOLEAN','EDGE')
        for e in mesh.edges:attr.data[e.index].value=sharp.get(tuple(sorted(used[v] for v in e.vertices)),False)
    obj.data=mesh;mesh.normals_split_custom_set(normals)
    check(all((layer.data[j].uv-v).length<1e-7 for j,v in enumerate(uv)))
    errors=[];untouched=[]
    for fi,f in enumerate(kept):
        if f.area==0:continue # Preserve the source's existing degenerate triangles.
        check(mesh.polygons[fi].area>0,'Repair introduced a degenerate triangle')
        for j in mesh.polygons[fi].loop_indices:
            err=(mesh.corner_normals[j].vector-normals[j]).length;errors.append(err)
            if not set(f.vertices).intersection(changes):untouched.append(err)
    for f in list(mesh.polygons)[len(kept):]:check(f.area>0,'New repair triangle is degenerate: '+obj.name+' '+str(f.index)+' '+str(list(f.vertices)))
    error=max(errors,default=0);fixed_error=max(untouched,default=0)
    print('NORMAL_REPLAY',obj.name,error,fixed_error)
    check(fixed_error<.0004,'Untouched custom normals changed')
    check(error<.025,'Edited-region custom normals discrepancy')
    return {'removedFaces':len(removed),'addedFaces':len(spec['faces']),'addedVertices':len(spec['vertices']),'removedUnusedCutVertices':len(points)-len(used),'retainedVertexIdentitiesPreserved':True,'retainedUVsPreserved':True,'retainedNormalMaxError':error,'untouchedNormalMaxError':fixed_error}

def apply_patch(path):
    path=Path(path).resolve();p=json.loads(path.read_text());check(p['schema']=='fita-scoped-hair-eye-paint/v2')
    check(set(p['objects'])=={'head-face','head-hair'} and p['deleteObjects']==['WB_Sclera_R','WB_Sclera_L'])
    result={}
    for name,spec in p['objects'].items():
        obj=bpy.data.objects[name];check(obj.type=='MESH' and obj.get('workbench_part')=='head');matrix=obj.matrix_world.copy();result[name]=rebuild(obj,spec);check(obj.matrix_world==matrix)
    for name in p['deleteObjects']:
        obj=bpy.data.objects[name];check(obj.type=='MESH' and obj.get('workbench_part')=='head');bpy.data.objects.remove(obj,do_unlink=True)
    check(len(p['images'])==3 and {x['object'] for x in p['images']}=={'head-face','head-hair','body-uniform'})
    # Paint is packed into the existing material. No shader or material changes.
    for spec in p['images']:
        file=(path.parent/spec['file']).resolve();original=(path.parent/spec['originalFile']).resolve();mask=(path.parent/spec['maskFile']).resolve()
        check(file.parent==original.parent==mask.parent==path.parent)
        check(digest(file)==spec['sha256'] and digest(original)==spec['originalSha256'] and digest(mask)==spec['maskSha256'])
        obj=bpy.data.objects[spec['object']];im=next(n.image for n in obj.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE' and n.image)
        check(im.packed_file is not None and hashlib.sha256(bytes(im.packed_file.data)).hexdigest()==spec['originalSha256'])
        im.pack(data=file.read_bytes(),data_len=file.stat().st_size);im.reload()
    return {'schema':p['schema'],'projectId':p['projectId'],'objects':result,'neckGeometryPreserved':True,'headPlacementPreserved':True,'faceUVsPreservedOutsideNewSclera':True,'oldSclerasRemoved':True,'scleraConnectedToFace':True,'review':p['review']}

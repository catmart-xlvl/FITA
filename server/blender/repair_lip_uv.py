"""Replay a bounded, reviewed lip UV/albedo repair on an immutable placement."""
import bpy,json,sys,math,hashlib,numpy as np
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from correct_assembly import snapshot
from export_evaluated_parts import export_evaluated_parts

def require(ok):
    if not ok:raise ValueError('PLACEMENT_LIP_PATCH_INVALID')

from uv_overlap import raster_overlap


def repair_coverage(patch,image):
    """Bounded atlas-only cleanup of documented temporary upper coverage."""
    require(patch.get('schema')=='workbench-local-body-atlas/v1' and patch.get('purpose')=='temporary-chest-coverage' and patch.get('object')=='piel-superior')
    before=snapshot();o=bpy.data.objects.get('piel-superior');require(o is not None and o.get('workbench_part')=='body');m=o.data
    require(len(m.uv_layers)==1 and len(m.materials)==1 and patch.get('material')==0)
    mat=m.materials[0];nodes=[n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE'];require(len(nodes)==1 and nodes[0].image.packed_file is not None and mat.users==1)
    original=nodes[0].image;require(hashlib.sha256(original.packed_file.data).hexdigest()==patch.get('imageSha256'))
    key=lambda p:tuple(round(float(c),6) for c in p)
    fkey=lambda ps:tuple(sorted(key(p) for p in ps))
    table={fkey(m.vertices[i].co for i in f.vertices):f for f in m.polygons}
    entries=patch.get('faces',[]);require(1<=len(entries)<=len(m.polygons)*.30)
    selected=[];seen=set();points=[]
    for row in entries:
        require(len(row)==3 and all(len(p)==3 and all(math.isfinite(c) for c in p) for p in row))
        ps=[Vector((p[0],-p[2],p[1])) for p in row];k=fkey(ps);require(k in table and k not in seen);seen.add(k);selected.append(table[k]);points.extend(ps)
    extent=np.ptp(np.array([v.co[:] for v in m.vertices]),axis=0);span=np.ptp(np.array(points),axis=0)
    require(span[2]<=extent[2]*.5)
    im=bpy.data.images.load(image,check_existing=False);require(list(im.size)==list(original.size));im.colorspace_settings.name=original.colorspace_settings.name
    old=np.empty(len(original.pixels),np.float32);new=np.empty(len(im.pixels),np.float32);original.pixels.foreach_get(old);im.pixels.foreach_get(new);old=old.reshape(im.size[1],im.size[0],4);new=new.reshape(old.shape)
    require(np.max(abs(old[:,:,3]-new[:,:,3]))<1e-6)
    allowed=np.zeros((im.size[1],im.size[0]),bool)
    for f in selected:
        xy=np.array([m.uv_layers.active.data[i].uv[:] for i in f.loop_indices])*np.array(im.size)-.5;lo=np.maximum(np.floor(xy.min(0)).astype(int),0);hi=np.minimum(np.ceil(xy.max(0)).astype(int)+1,np.array(im.size));matrix=np.stack([xy[1]-xy[0],xy[2]-xy[0]],1)
        if np.any(hi<=lo) or abs(np.linalg.det(matrix))<1e-8:continue
        yy,xx=np.mgrid[lo[1]:hi[1],lo[0]:hi[0]];q=(np.stack([xx,yy],-1)-xy[0])@np.linalg.inv(matrix).T;inside=(q[:,:,0]>=-1e-6)&(q[:,:,1]>=-1e-6)&(q.sum(-1)<=1.000001);allowed[yy[inside],xx[inside]]=True
    for _ in range(8):allowed=allowed|np.roll(allowed,1,0)|np.roll(allowed,-1,0)|np.roll(allowed,1,1)|np.roll(allowed,-1,1)
    delta=np.max(abs(new[:,:,:3]-old[:,:,:3]),axis=2);changed=delta>2/255
    require(np.any(changed) and not np.any(changed&~allowed))
    im.pack();nodes[0].image=im;o['workbench_coverage_patch']=json.dumps(patch)
    after=snapshot();require(before.keys()==after.keys())
    for name,a in before.items():
        b=after[name]
        if name!=o.name:require(a==b)
        else:require(a['matrix']==b['matrix'] and a['local']==b['local'] and a['topology']==b['topology'] and a['uv']==b['uv'])
    return {'bodyCoverageRepaired':True,'geometryPreserved':True,'uvPreserved':True,'outsideSelectedAtlasPixelsPreserved':True,'changedPixels':int(changed.sum()),'selectedFaces':len(selected),'patch':patch}

def repair(patch,image):
    require(patch.get('schema')=='workbench-local-face-uv/v1' and patch.get('purpose')=='lip-registration' and patch.get('object')=='rostro')
    before=snapshot();o=bpy.data.objects.get('rostro');require(o is not None and o.get('workbench_part')=='head');m=o.data
    require(len(m.uv_layers)==1 and len(m.materials)==1 and patch.get('material')==0)
    material=m.materials[0];nodes=[n for n in material.node_tree.nodes if n.type=='TEX_IMAGE'];require(len(nodes)==1 and nodes[0].image.packed_file is not None)
    require(hashlib.sha256(nodes[0].image.packed_file.data).hexdigest()==patch.get('imageSha256'))
    # Reject other maps: their tangent basis would need a separate rebake.
    require(all(l.to_socket.name=='Base Color' for l in material.node_tree.links if l.from_node==nodes[0]))
    entries=patch.get('faces',[]);require(1<=len(entries)<=min(2000,len(m.polygons)*.35))
    key=lambda p:tuple(round(c,6) for c in p)
    fkey=lambda pts:tuple(sorted(key(p) for p in pts))
    table={fkey(m.vertices[i].co for i in f.vertices):f for f in m.polygons};require(len(table)==len(m.polygons))
    selected={};points=[]
    for row in entries:
        ps=[Vector((p[0],-p[2],p[1])) for p in row['corners']];uv=row['uv'];require(len(ps)==3 and len(uv)==3 and all(len(q)==2 and all(math.isfinite(c) and 0<=c<=1 for c in q) for q in uv));k=fkey(ps)
        require(k in table and k not in selected);selected[k]=(table[k],[key(p) for p in ps],uv);points.extend(ps)
    # The declared patch must remain a small facial region, not whole-face UV replacement.
    extent=np.ptp(np.array([v.co[:] for v in m.vertices]),axis=0);span=np.ptp(np.array(points),axis=0)
    require(all(span<=extent*np.array([.30,.32,.16])))
    overlap=raster_overlap([v[2] for v in selected.values()]);require(overlap==0)
    im=bpy.data.images.load(image,check_existing=False);require(im.size[0]==im.size[1] and 512<=im.size[0]<=4096);im.colorspace_settings.name=nodes[0].image.colorspace_settings.name
    pixels=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(pixels);require(np.all(pixels.reshape(-1,4)[:,3]==1));im.pack()
    mat=material.copy();mat.name=material.name+'_LipRegistration';next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE').image=im;m.materials.append(mat)
    old_corners={f.index:[tuple(m.uv_layers.active.data[l].uv) for l in f.loop_indices] for f in m.polygons}
    changed=set()
    for f,keys,uv in selected.values():
        changed.add(f.index);f.material_index=1
        for l in f.loop_indices:m.uv_layers.active.data[l].uv=uv[keys.index(key(m.vertices[m.loops[l].vertex_index].co))]
    after=snapshot();require(before.keys()==after.keys())
    for name,a in before.items():
        b=after[name]
        if name!='rostro':require(a==b)
        else:
            require(a['matrix']==b['matrix'] and a['local']==b['local'] and a['topology'][0]==b['topology'][0] and a['materials']==b['materials'][:1])
    require(all(f.material_index==0 and old_corners[f.index]==[tuple(m.uv_layers.active.data[l].uv) for l in f.loop_indices] for f in m.polygons if f.index not in changed))
    return {'lipRegistrationRepaired':True,'localUvFaces':len(changed),'overlappingTexels':overlap,'geometryPreserved':True,'unselectedUvAndOriginalAtlasPreserved':True,'neckShouldersTrapeziusPreserved':True,'irisLashesBrowsScleraPreserved':True,'independentParts':True,'headMeshes':sum(v['part']=='head' for v in after.values()),'bodyMeshes':sum(v['part']=='body' for v in after.values())}

if __name__=='__main__':
    job=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf-8'));bpy.ops.wm.open_mainfile(filepath=job['input'],load_ui=False,use_scripts=False)
    if job.get('coverageSource'):
        bpy.ops.wm.open_mainfile(filepath=job['coverageSource'],load_ui=False,use_scripts=False);o=bpy.data.objects['piel-superior'];patch=json.loads(o['workbench_coverage_patch']);im=next(n.image for n in o.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE');image=Path(job['report']).with_suffix('.png');image.write_bytes(im.packed_file.data)
        bpy.ops.wm.open_mainfile(filepath=job['input'],load_ui=False,use_scripts=False);report=repair_coverage(patch,str(image))
    else:report=repair(job['patch'],job['image'])
    bpy.ops.wm.save_as_mainfile(filepath=job['blend'],compress=False);bpy.ops.wm.open_mainfile(filepath=job['blend'],load_ui=False,use_scripts=False)
    export_evaluated_parts(job['glb'],[o for o in bpy.context.scene.objects if o.type=='MESH']);Path(job['report']).write_text(json.dumps(report),encoding='utf-8')

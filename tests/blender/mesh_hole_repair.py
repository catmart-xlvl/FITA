"""Real Blender regression: reviewed additive repairs survive ID assignment,
saved-file verification, UV transfer, reconstruction and source protection.
Synthetic evidence tests the contract, not artistic approval of any character.
"""
import bpy, copy, hashlib, sys, tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server/blender'))
import segment_mesh as seg
import mesh_hole_repair as repair

def rejects(code,fn):
    try:fn()
    except ValueError as e:assert str(e)==code,(code,str(e))
    else:raise AssertionError('Accepted '+code)

def cube(name):
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata([(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)],[],
                     [(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(bpy.data.materials.new(name+'-material'))
    layer=mesh.uv_layers.new(name='UVMap')
    for p in mesh.polygons:
        for i,li in enumerate(p.loop_indices):layer.data[li].uv=((i%2)*.5,(i//2)*.5)
    return obj

with tempfile.TemporaryDirectory(prefix='fita-hole-repair-') as folder:
    root=Path(folder);bpy.ops.wm.read_factory_settings(use_empty=True)
    job={'meshRepairPolicy':repair.POLICY,'cleanupPolicy':'exact-duplicate-faces/v1','sources':{},'directory':str(root),
         'proposal':str(root/'proposal.json'),'inputBlend':str(root/'submitted.blend'),'render':False}
    original={}
    for part in ('head','body'):
        obj=cube(part);file=root/(part+'.glb');seg.export(file,[obj]);job['sources'][part]=str(file)
        original[part]=hashlib.sha256(file.read_bytes()).hexdigest();bpy.data.objects.remove(obj,do_unlink=True)
    seg.analyze(job);inspection=seg.read(root/'mesh-inspection.json');spec=seg.read(root/'mesh-repair.json')
    assert len(inspection['boundaries'])==2,inspection
    rejects('SEG_MESH_REPAIR_REQUIRED',lambda:seg.build(job))
    parts=seg.load_sources({**job,'_inspection':True});baseline=repair.inspect(parts)
    assert baseline['sourceFingerprint']==spec['sourceFingerprint']
    for part,objects in parts.items():
        obj=objects[0];positions=[tuple(v.co) for v in obj.data.vertices];indices={p:i for i,p in reversed(list(enumerate(positions)))}
        top=[indices[p] for p in [(1.,1.,1.),(-1.,1.,1.),(-1.,-1.,1.),(1.,-1.,1.)]]
        center=len(positions);region='crown' if part=='head' else 'body'
        spec['operations'].append({'id':part+'-cap','part':part,'object':0,'region':region,'reason':'Synthetic cube missing top face',
                                   'vertices':[[0.,0.,1.]],'faces':[{'vertices':[a,b,center],'material':0,
                                   'uv':{layer.name:[[.1,.1],[.9,.1],[.5,.9]] for layer in obj.data.uv_layers}} for a,b in zip(top,top[1:]+top[:1])]})
    bad=copy.deepcopy(spec);bad['sourceFingerprint']='0'*64
    rejects('SEG_MESH_REPAIR_STALE',lambda:repair.apply_operations(parts,bad))
    bad=copy.deepcopy(spec);bad['operations'][0]['vertices'][0][2]=100
    rejects('SEG_MESH_REPAIR_OUTSIDE',lambda:repair.apply_operations(parts,bad))
    # Opposite winding and different indices do not make a duplicate permissible.
    bad=copy.deepcopy(spec);face=list(parts['head'][0].data.polygons[0].vertices)
    bad['operations'][0]['faces']=[{'vertices':face[::-1],'material':0,'uv':{'UVMap':[[0,0]]*3}}]
    rejects('SEG_MESH_REPAIR_DUPLICATE',lambda:repair.apply_operations(parts,bad))
    bad=copy.deepcopy(spec)
    for row in bad['operations'][0]['faces']:row['vertices'].reverse()
    rejects('SEG_MESH_REPAIR_WINDING',lambda:repair.apply_operations(parts,bad))
    before,after,added=repair.apply_operations(parts,spec)
    assert added==8 and not after['boundaries']
    for part in parts:
        assert len(parts[part][0].data.polygons)==14
    # Geometric seams duplicated by GLB export were ignored, not filled/welded.
    assert all(b['closedLoop'] for b in before['boundaries'])
    spec['decisions']={'before':[{'id':b['id'],'status':'repaired','reason':'Top missing on synthetic cube','operationIds':[b['part']+'-cap']} for b in before['boundaries']],'after':[]}
    spec['pending']=[]
    (root/'review').mkdir()
    for part in repair.VIEWS:
        review=spec['visualReview'][part];review['findings']='Synthetic cube contract regression, not artistic review'
        for region,row in review['regions'].items():row.update(status='repaired' if region==('crown' if part=='head' else 'body') else 'not-applicable',reason='Synthetic geometric fixture')
        review['regions']['crown' if part=='head' else 'body']['operationIds']=[part+'-cap']
        for view in repair.VIEWS[part]:
            for phase in ('before','after'):
                file='review/'+part+'_'+view+'_'+phase+'.png'
                image=bpy.data.images.new(file,width=16,height=16);image.generated_color=(.3,.6,.9,1);image.filepath_raw=str(root/file);image.file_format='PNG';image.save();bpy.data.images.remove(image)
                review['views'][view][phase]={'file':file,'sha256':hashlib.sha256((root/file).read_bytes()).hexdigest()}
    assert repair.validate_review(spec,before,after,root)['reviewed']
    bad=copy.deepcopy(spec);bad['visualReview']['head']['regions']['crown']['status']='pending'
    rejects('SEG_MESH_REPAIR_REQUIRED',lambda:repair.validate_review(bad,before,after,root))
    bad=copy.deepcopy(spec);bad['decisions']['before']=[]
    rejects('SEG_MESH_REPAIR_REQUIRED',lambda:repair.validate_review(bad,before,after,root))
    bad=copy.deepcopy(spec);bad['visualReview']['head']['views']['top']['after']['sha256']='0'*64
    rejects('SEG_MESH_REPAIR_EVIDENCE',lambda:repair.validate_review(bad,before,after,root))
    # Calling a hole 'repaired' without changing it must fail even with evidence.
    rejects('SEG_MESH_REPAIR_UNRESOLVED',lambda:repair.validate_review(spec,before,before,root))
    seg.write(root/'mesh-repair.json',spec);seg.preview_repair(job);seg.prepare(job)
    proposal=seg.read(job['proposal']);assert proposal['meshRepair']==spec
    for group in proposal['groups']:group.update(id=group['part']+'-surface',category='fixture',pending=False)
    proposal['pending']=[];seg.write(job['proposal'],proposal);seg.build(job)
    report=seg.read(root/'validated.json');assert report['meshRepair']['addedFaces']==8 and report['counts']=={'head':14,'body':14}
    (root/'submitted.blend').write_bytes((root/'segmented.blend').read_bytes());seg.verify(job)
    # An unauthorized face deletion in the delivered Blend is rejected.
    bpy.ops.wm.open_mainfile(filepath=job['inputBlend'],load_ui=False,use_scripts=False)
    target=next(o for o in bpy.data.objects if o.type=='MESH');target.data.vertices[0].co.x+=.1
    damaged=root/'damaged.blend';bpy.ops.wm.save_as_mainfile(filepath=str(damaged),compress=False)
    rejects('SEG_GEOMETRY_CHANGED',lambda:seg.verify({**job,'inputBlend':str(damaged)}))
    job['results']={group['id']:str(root/(group['id']+'.glb')) for group in proposal['groups']}
    seg.reconstruct(job)
    reconstruction=seg.read(root/'reconstruction.json');assert reconstruction['geometryPreserved'] and all(g['facesTransferred']==14 for g in reconstruction['groups'])
    assert all(hashlib.sha256(Path(job['sources'][part]).read_bytes()).hexdigest()==sha for part,sha in original.items())
    # An intentional opening can remain, but needs decisions before AND after.
    parts=seg.load_sources({**job,'_inspection':True});inspection=repair.inspect(parts)
    keep=copy.deepcopy(spec);keep['operations']=[]
    keep['decisions']={phase:[{'id':b['id'],'status':'intentional','reason':'Synthetic open container rim'} for b in inspection['boundaries']] for phase in ('before','after')}
    for review in keep['visualReview'].values():
        for region in review['regions'].values():region.update(status='intentional',reason='Synthetic intentional open rim');region.pop('operationIds',None)
    b,a,n=repair.apply_operations(parts,keep);assert n==0 and len(a['boundaries'])==2
    repair.validate_review(keep,b,a,root)
print('MESH_HOLE_REPAIR_OK: missing review, stale sources, remote/duplicate polygons, pending regions, unreviewed borders, forged evidence and unresolved holes rejected; repaired head/body survive saved verification and UV reconstruction; intentional openings and original sources preserved')

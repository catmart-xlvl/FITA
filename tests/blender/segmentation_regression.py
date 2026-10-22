"""Real Blender checks; no network, Studio, or credit use."""
import bpy,sys,json,tempfile,copy
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server'/'blender'))
import segment_mesh as seg

def raises(code,fn):
    try:fn()
    except ValueError as e:assert str(e)==code,(code,str(e))
    else:raise AssertionError('Expected '+code)

def mesh(name,vertices,polygons):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],polygons);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(obj);return obj

with tempfile.TemporaryDirectory(prefix='workbench-segmentation-regression-') as folder:
    root=Path(folder);bpy.ops.wm.read_factory_settings(use_empty=True)
    job={'sources':{},'directory':str(root),'proposal':str(root/'proposal.json'),'inputBlend':str(root/'submitted.blend'),'render':False}
    cleanup='--cleanup' in sys.argv
    if cleanup:job['cleanupPolicy']='exact-duplicate-faces/v1'
    for part,z in [('head',2),('body',0)]:
        o=mesh(part,[(0,0,0),(1,0,0),(0,1,0),(3,0,0),(4,0,0),(3,1,0)]+([(0,0,0),(1,0,0),(0,1,0)] if cleanup else []),[(0,1,2),(3,4,5)]+([(6,7,8)] if cleanup else []))
        o.location=(.1,.2,z);uv=o.data.uv_layers.new(name='OriginalUV')
        for loop in uv.data:loop.uv=(.25,.75)
        for i,color in enumerate([(.7,.2,.1,1),(.1,.3,.8,1)]):
            mat=bpy.data.materials.new(part+str(i));mat.use_nodes=True;image=bpy.data.images.new(part+str(i),width=16,height=16);image.generated_color=color;image.pack()
            tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;mat.node_tree.links.new(tex.outputs['Color'],mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color']);o.data.materials.append(mat)
        o.data.polygons[1].material_index=1;bpy.context.view_layer.update()
        file=root/(part+'.glb');seg.export(file,[o]);job['sources'][part]=str(file);bpy.data.objects.remove(o,do_unlink=True)
    seg.analyze(job)
    analysis=seg.read(root/'analysis.json');assert all(len(p['components'])==2 for p in analysis['parts'].values())
    if cleanup:assert all(r['removedCount']==1 for r in analysis['cleanup'].values()),analysis['cleanup']
    proposal=seg.read(job['proposal']);proposal['pending']=[];proposal['visualReview']={'views':['front','left','right','back','isolated'],'findings':'Synthetic two-island fixture, not artistic approval.'}
    for g in proposal['groups']:g.update(id=g['part']+'-surface',name=g['part']+' surface',category='fixture',pending=False,referencesReviewed=False)
    seg.write(job['proposal'],proposal);seg.build(job)
    report=seg.read(root/'validated.json');assert report['savedAndReopened'] and report['counts']=={'head':2,'body':2}
    assert all(len(g['components'])==2 for g in report['groups'])
    (root/'submitted.blend').write_bytes((root/'segmented.blend').read_bytes());seg.verify(job)
    for corruption,code in [('duplicate','SEG_FACE_DUPLICATE_OR_INVALID'),('missing','SEG_FACE_COVERAGE')]:
        bad=copy.deepcopy(proposal)
        if corruption=='duplicate':bad['groups'][0]['faces'].append(0)
        else:bad['groups'][0]['faces'].pop()
        raises(code,lambda:seg.validate_groups(bad,report['counts']))
    bpy.ops.wm.open_mainfile(filepath=job['inputBlend'],load_ui=False,use_scripts=False)
    meshes=[o for o in bpy.data.objects if o.type=='MESH'];meshes[0].data.vertices[0].co.x+=.03;bpy.ops.wm.save_as_mainfile(filepath=str(root/'damaged.blend'),compress=False)
    raises('SEG_GEOMETRY_CHANGED',lambda:seg.verify({**job,'inputBlend':str(root/'damaged.blend')}))
    # Reordered vertices/faces and fresh per-corner UVs; preserve material separation.
    job['results']={}
    for group in proposal['groups']:
        bpy.ops.wm.read_factory_settings(use_empty=True);_,ms=seg.import_glb(root/(group['id']+'.glb'));source=ms[0]
        coords=[list(source.matrix_world@v.co) for v in source.data.vertices];n=len(coords)
        face_vertices=[list(p.vertices) for p in source.data.polygons]
        returned=mesh('returned',list(reversed(coords)),[list(reversed([n-1-v for v in poly])) for poly in reversed(face_vertices)])
        for mat in source.data.materials:returned.data.materials.append(mat)
        uv=returned.data.uv_layers.new(name='SmartUV')
        for p,old in zip(returned.data.polygons,reversed(source.data.polygons)):
            p.material_index=old.material_index
            for loop in p.loop_indices:
                vertex=returned.data.vertices[returned.data.loops[loop].vertex_index];uv.data[loop].uv=((vertex.co.x%2)*.3+.1,(vertex.co.y%2)*.3+.2)
        target=source.copy();target.data=source.data.copy();bpy.context.scene.collection.objects.link(target)
        before=[list(target.matrix_world@v.co) for v in target.data.vertices];count=seg.transfer_uv([target],[returned]);assert count==2
        assert before==[list(target.matrix_world@v.co) for v in target.data.vertices];assert len(target.data.materials)==2
        assert [l.name for l in target.data.uv_layers]==['SmartUV'];assert target.data.uv_layers.active.name=='SmartUV'
        for p in target.data.polygons:
            for loop in p.loop_indices:
                vertex=target.matrix_world@target.data.vertices[target.data.loops[loop].vertex_index].co;wanted=Vector(((vertex.x%2)*.3+.1,(vertex.y%2)*.3+.2))
                assert (target.data.uv_layers.active.data[loop].uv-wanted).length<1e-5
        clone=returned.copy();clone.data=returned.data.copy();bpy.context.scene.collection.objects.link(clone)
        raises('SEG_TRANSFER_AMBIGUOUS',lambda:seg.transfer_uv([source],[returned,clone]))
        bpy.data.objects.remove(clone,do_unlink=True)
        returned.data.vertices[0].co.x+=.01
        raises('SEG_TRANSFER_TOPOLOGY_CHANGED',lambda:seg.transfer_uv([source],[returned]))
        returned.data.vertices[0].co.x-=.01
        file=root/(group['id']+'-textured.glb');seg.export(file,[returned]);job['results'][group['id']]=str(file)
    seg.reconstruct(job)
    final=seg.read(root/'reconstruction.json');assert final['geometryPreserved'] and final['cornerUvTransfer'] and final['savedAndReopened']
    bpy.ops.wm.open_mainfile(filepath=str(root/'textured.blend'),load_ui=False,use_scripts=False)
    assert set(o.get('workbench_part') for o in bpy.data.objects if o.type=='MESH')=={'head','body'}
    assert all(img.packed_file for img in bpy.data.images if img.type=='IMAGE')
    for part in ('head','body'):
        b=(root/(part+'-textured.glb')).read_bytes();size=int.from_bytes(b[12:16],'little');gltf=json.loads(b[20:20+size]);assert len(gltf['materials'])==2 and len(gltf['images'])==2
    print('SEGMENTATION_REGRESSION_OK: saved/reopened, complete face coverage, original geometry/transforms, 2 materials/images, reordered corner UVs, rejected ambiguity/topology changes')

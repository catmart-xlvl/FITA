"""Background regression: seam-safe deformation and importer replay, no Tripo."""
import bpy, json, sys, runpy
from pathlib import Path
from mathutils import Matrix

root=Path(__file__).resolve().parents[2]
helpers=root/'server/blender'
sys.path.insert(0,str(helpers))
from manual_hair_clearance import clear_hair
from connected_falloff import uv_seam_pairs
from correct_assembly import snapshot
from hair_connected import deform_connected_hair

out=root/'.runtime/hair-seams-regression';out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
def mesh(name,part,points,faces):
    m=bpy.data.meshes.new(name);m.from_pydata(points,[],faces);m.update()
    o=bpy.data.objects.new(name,m);bpy.context.scene.collection.objects.link(o);o['workbench_part']=part
    uv=m.uv_layers.new(name='UVMap')
    for i,loop in enumerate(uv.data):loop.uv=((i%3)/2,(i%2))
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    image=bpy.data.images.new(name,2,2);image.pixels=[.2,.4,.6,1]*4;image.pack()
    node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
    mat.node_tree.links.new(node.outputs['Color'],mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    m.materials.append(mat)
    return o

mesh('body','body',[(-.2,0,0),(.2,0,0),(0,0,1.5)],[(0,1,2)])
hair=mesh('hair','head',[(0,0,.3),(.1,0,.3),(0,0,.5),(.1,0,.3),(0,0,.3),(.1,0,.1),
    (0,.001,.3),(.1,.001,.3),(0,.001,.5),(0,0,1.8),(.1,0,1.8),(0,0,1.7)],
    [(0,1,2),(3,4,5),(6,7,8),(9,10,11)])
bpy.context.view_layer.update();original=snapshot()
points=[hair.matrix_world@v.co for v in hair.data.vertices];edges=[tuple(e.vertices) for e in hair.data.edges]
indices=list(range(6));seams=uv_seam_pairs(points,edges,indices)
for helper in [clear_hair,deform_connected_hair]:
    try:helper(hair,indices=indices,seeds=[0],radius=.3,displacement=[0,.03,0])
    except ValueError as e:assert 'UV seam' in str(e)
    else:raise AssertionError('Omitted seam was accepted')
    assert not hair.data.shape_keys
    assert all((v.co-p).length==0 for v,p in zip(hair.data.vertices,points))

approved=out/'approved.blend';bpy.ops.wm.save_as_mainfile(filepath=str(approved))
result=clear_hair(hair,indices=indices,seeds=[0],radius=.3,displacement=[0,.03,0],seam_pairs=seams)
assert result['verifiedSeamLinks']==2
assert (hair.data.vertices[0].co-hair.data.vertices[4].co).length<1e-7
assert (hair.data.vertices[1].co-hair.data.vertices[3].co).length<1e-7
assert all((hair.data.vertices[i].co-points[i]).length==0 for i in range(6,12))
factor=1.7/1.8
for o in bpy.context.scene.objects:
    if o.type=='MESH':o.matrix_world=Matrix.Scale(factor,4)@o.matrix_world
bpy.context.view_layer.update()
prepared=out/'prepared.blend';bpy.ops.wm.save_as_mainfile(filepath=str(prepared))
job={'approved':str(approved),'input':str(prepared),'heightCm':170,'glb':str(out/'verified.glb'),'report':str(out/'report.json')}
jobfile=out/'job.json';jobfile.write_text(json.dumps(job))
sys.argv=['validate','--',str(jobfile)]
runpy.run_path(str(helpers/'validate_neck_finish.py'),run_name='__main__')
report=json.loads((out/'report.json').read_text());assert report['verifiedHairSeamLinks']['hair']==2
bpy.ops.wm.open_mainfile(filepath=str(prepared),load_ui=False,use_scripts=False)
steps=json.loads(bpy.data.objects['hair']['workbench_hair_clearance']);steps[0].pop('seamPairs')
bpy.data.objects['hair']['workbench_hair_clearance']=json.dumps(steps)
bad=out/'missing-evidence.blend';bpy.ops.wm.save_as_mainfile(filepath=str(bad))
job['input']=str(bad);jobfile.write_text(json.dumps(job))
try:runpy.run_path(str(helpers/'validate_neck_finish.py'),run_name='__main__')
except ValueError:pass
else:raise AssertionError('Importer accepted missing seam evidence')
print('HAIR_SEAMS_OK: no tear, detached strand and roots preserved, UV/textures preserved, importer replay verified; omitted seam rejected before mutation and on import')

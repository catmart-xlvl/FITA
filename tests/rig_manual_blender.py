"""Real Blender round trips and adversarial uploads; synthetic meshes only."""
import bpy, json, sys, runpy, struct
from pathlib import Path

folder=Path(sys.argv[sys.argv.index('--')+1]).resolve();folder.mkdir(parents=True,exist_ok=True)
script=Path('server/blender/rig_weight_exchange.py').resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
arm=bpy.data.armatures.new('Rig');rig=bpy.data.objects.new('Rig',arm);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
a=arm.edit_bones.new('Hips');a.head=(0,0,0);a.tail=(0,0,1)
b=arm.edit_bones.new('Head');b.head=(0,0,1);b.tail=(0,0,2);b.parent=a
bpy.ops.object.mode_set(mode='OBJECT')
mesh=bpy.data.meshes.new('Body');mesh.from_pydata([(0,0,0),(1,0,0),(1,0,1),(0,0,1)],[],[(0,1,2),(0,2,3)]);mesh.update()
body=bpy.data.objects.new('Body',mesh);bpy.context.collection.objects.link(body);body.parent=rig
modifier=body.modifiers.new('Armature','ARMATURE');modifier.object=rig
uv=mesh.uv_layers.new(name='UVMap')
for loop in mesh.loops:uv.data[loop.index].uv=(mesh.vertices[loop.vertex_index].co.x,mesh.vertices[loop.vertex_index].co.z)
material=bpy.data.materials.new('Material');material.use_nodes=True;mesh.materials.append(material)
g=body.vertex_groups.new(name='Hips');g.add(list(range(4)),1,'REPLACE');body.vertex_groups.new(name='Head')
def export(file):bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',export_animations=False,export_rest_position_armature=True,export_def_bones=False,export_extras=True,export_attributes=True,export_apply=False,export_influence_nb=4)
export(folder/'model.glb')
def exchange(mode,candidate=None):
    job={'mode':mode,'folder':str(folder),'candidate':str(candidate),'output':str(folder/'accepted.glb'),'report':str(folder/'report.json')}
    f=folder/'job.json';f.write_text(json.dumps(job),encoding='utf-8');sys.argv=['test','--',str(f)];runpy.run_path(str(script),run_name='__main__')
def candidate(name,change):
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(folder/'model.glb'),merge_vertices=False)
    body=bpy.data.objects['Body'];rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');change(body,rig)
    file=folder/(name+'.glb');export(file);return file
def parse(file):
    data=file.read_bytes();n=struct.unpack_from('<I',data,12)[0];return json.loads(data[20:20+n]),data[28+n:]
results=[]
exchange('export')
fbx_reference=json.loads((folder/'fbx-reference.json').read_text(encoding='utf-8'))
assert set(fbx_reference['meshes'])=={'Body'},'FBX export leaked a Blender bone-display helper'
results.append('FBX excludes generated bone-display helper geometry')
exchange('import',folder/'model.fbx');results.append('FBX neutral round trip')
def weights(body,rig):
    body.vertex_groups['Hips'].add([0],.6,'REPLACE');body.vertex_groups['Head'].add([0],.4,'REPLACE')
exchange('import',candidate('weights',weights))
base,bb=parse(folder/'model.glb');result,rb=parse(folder/'accepted.glb')
assert rb[:len(bb)]==bb # Original binary geometry/images/morph data never replaced.
assert result['meshes'][0]['primitives'][0]['attributes']['WEIGHTS_0']!=base['meshes'][0]['primitives'][0]['attributes']['WEIGHTS_0']
results.append('GLB weights applied with original buffers preserved')
def extra(body,rig):
    bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT');b=rig.data.edit_bones.new('Extra');b.head=(0,0,1);b.tail=(.2,0,1);b.parent=rig.data.edit_bones['Head'];bpy.ops.object.mode_set(mode='OBJECT')
    body.vertex_groups['Hips'].add([0],.75,'REPLACE');g=body.vertex_groups.new(name='Extra');g.add([0],.25,'REPLACE')
exchange('import',candidate('extra',extra));assert json.loads((folder/'report.json').read_text())['addedBones']==['Extra'];results.append('Additional weighted bone accepted')
def move(body,rig):body.data.vertices[0].co.x+=.1
def remove(body,rig):
    bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT');rig.data.edit_bones.remove(rig.data.edit_bones['Head']);bpy.ops.object.mode_set(mode='OBJECT')
def uv_edit(body,rig):body.data.uv_layers.active.data[0].uv.x+=.1
def shape(body,rig):body.shape_key_add(name='Basis');body.shape_key_add(name='Unrequested').data[0].co.x+=.1
def color(body,rig):body.active_material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(1,0,0,1)
for name,change,expected in [('moved',move,'GEOMETRY'),('missing',remove,'MISSING_BONES'),('uv',uv_edit,'TOPOLOGY'),('shape',shape,'MORPHS'),('color',color,'MATERIALS')]:
    file=candidate(name,change)
    try:exchange('import',file);raise AssertionError(name+' was accepted')
    except ValueError as error:
        assert 'RIG_EDIT_'+expected in str(error) or name=='uv' and 'RIG_EDIT_GEOMETRY' in str(error) or name=='shape' and 'RIG_EDIT_POSE' in str(error),(name,str(error));results.append('Rejected '+name)
# The same module is importable for Codex's body-weight refinement without opening a file.
helpers=runpy.run_path(str(script),run_name='workbench_weight_helpers')
bpy.ops.wm.read_factory_settings(use_empty=True)
arm=bpy.data.armatures.new('RegionRig');rig=bpy.data.objects.new('RegionRig',arm);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for name in ['Left','Right','Helper','Rigid']:
    b=arm.edit_bones.new(name);b.head=(0,0,0);b.tail=(0,0,1)
bpy.ops.object.mode_set(mode='OBJECT')
mesh=bpy.data.meshes.new('Regions');mesh.from_pydata([(0,0,0),(1,0,0),(2,0,0),(0,.001,0),(1,.001,0),(4,0,0)],[(0,1),(1,2),(3,4)],[])
obj=bpy.data.objects.new('Regions',mesh);bpy.context.collection.objects.link(obj)
for name in ['Left','Right','Helper','Rigid','NonBoneTag']:obj.vertex_groups.new(name=name)
for name,ids,w in [('Left',[0],.6),('Right',[0],.4),('Left',[1],.8),('Helper',[1],.2),('Helper',[2],1),('Right',[3,4],1),('Rigid',[5],1),('NonBoneTag',[0,1,2,3,4,5],.7)]:obj.vertex_groups[name].add(ids,w,'REPLACE')
def read_weights():return [{obj.vertex_groups[g.group].name:round(g.weight,6) for g in v.groups} for v in obj.data.vertices]
before=read_weights();coords=[tuple(v.co) for v in mesh.vertices]
regions=[dict(name='left limb',vertices=[0,1,2],allowedBones=['Left','Helper'],fallbackBone='Left',lockedVertices=[2])]
audit=helpers['refine_regions'](obj,rig,regions)
after=read_weights()
assert all('Right' not in after[i] for i in [0,1,2])
assert after[3:]==before[3:] # No transfer across nearby but disconnected surfaces.
assert after[2]==before[2] # Smoothing lock retained.
assert all(abs(sum(w for n,w in after[i].items() if n!='NonBoneTag')-1)<1e-5 for i in range(6))
assert all(after[i]['NonBoneTag']==.7 for i in range(6))
assert [tuple(v.co) for v in mesh.vertices]==coords
assert audit['regions'][0]['removedDisallowedWeight']>.39
snapshot=read_weights()
try:
    helpers['refine_regions'](obj,rig,regions+[dict(name='overlap',vertices=[0],allowedBones=['Left'],fallbackBone='Left')])
    raise AssertionError('Overlapping region accepted')
except ValueError:pass
assert snapshot==read_weights() # Whole plan preflight: failure cannot partially paint.
results.append('Connected regional cleanup removes contralateral leakage and preserves unrelated regions')

# Editing one mesh must not reconstruct unchanged, coincident source corners.
helpers['load'](folder/'model.glb')
body=bpy.data.objects['Body'];rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
mesh=bpy.data.meshes.new('Coincident')
mesh.from_pydata([(0,0,0),(1,0,0),(0,0,1)]*2,[],[(0,1,2),(3,4,5)]);mesh.update()
coincident=bpy.data.objects.new('Coincident',mesh);bpy.context.collection.objects.link(coincident);coincident.parent=rig
coincident.modifiers.new('Armature','ARMATURE').object=rig
uv=mesh.uv_layers.new(name='UVMap')
for loop in mesh.loops:uv.data[loop.index].uv=(mesh.vertices[loop.vertex_index].co.x,mesh.vertices[loop.vertex_index].co.z)
coincident.vertex_groups.new(name='Hips').add([0,1,2],1,'REPLACE')
coincident.vertex_groups.new(name='Head').add([3,4,5],1,'REPLACE')
ambiguous_source=folder/'coincident-source.glb';export(ambiguous_source)
helpers['load'](ambiguous_source);before=helpers['snapshot']()
body=bpy.data.objects['Body'];weights(body,rig)
after=helpers['snapshot']();mapping={name:{i:i for i in range(len(data['points']))} for name,data in before['meshes'].items()}
accepted=folder/'coincident-preserved.glb'
helpers['patch_original'](ambiguous_source,before,after,mapping,accepted)
base,bb=parse(ambiguous_source);result,rb=parse(accepted)
def attributes(document,name):
    node=next(n for n in document['nodes'] if n.get('name')==name)
    return document['meshes'][node['mesh']]['primitives'][0]['attributes']
assert attributes(base,'Coincident')==attributes(result,'Coincident')
assert rb[:len(bb)]==bb
results.append('Untouched coincident weights remain byte-identical while another mesh is edited')
coincident=bpy.data.objects['Coincident']
coincident.vertex_groups['Hips'].add([0],.5,'REPLACE');coincident.vertex_groups['Head'].add([0],.5,'REPLACE')
changed=helpers['snapshot']()
helpers['patch_original'](ambiguous_source,before,changed,mapping,folder/'coincident-resolved.glb')
results.append('Original named weights distinguish edited coincident layers without averaging')
# With identical original weights, distinct source IDs still retain six vertices,
# but position/UV/weight matching cannot choose between different new weights.
coincident.vertex_groups['Head'].remove(list(range(6)))
coincident.vertex_groups['Hips'].add(list(range(6)),1,'REPLACE')
from mesh_connectivity import stamp
stamp(coincident.data)
indistinguishable_source=folder/'indistinguishable-source.glb';export(indistinguishable_source)
helpers['load'](indistinguishable_source);before=helpers['snapshot']()
coincident=bpy.data.objects['Coincident'];assert len(coincident.data.vertices)==6
coincident.vertex_groups['Hips'].add([0],.5,'REPLACE')
(coincident.vertex_groups.get('Head') or coincident.vertex_groups.new(name='Head')).add([0],.5,'REPLACE')
changed=helpers['snapshot']();mapping={name:{i:i for i in range(len(data['points']))} for name,data in before['meshes'].items()}
try:
    helpers['patch_original'](indistinguishable_source,before,changed,mapping,folder/'must-not-accept.glb')
    raise AssertionError('An ambiguous changed corner was accepted')
except ValueError as error:
    assert 'RIG_EDIT_AMBIGUOUS' in str(error),str(error)
results.append('Ambiguous changed coincident weights remain rejected')
(folder/'tests.json').write_text(json.dumps({'passed':results},indent=2),encoding='utf-8')
print('RIG_MANUAL_TESTS_OK',len(results))

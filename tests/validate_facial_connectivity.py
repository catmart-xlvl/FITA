"""Run with background Blender; never touches an open user's scene."""
import bpy, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server' / 'blender'))
from validate_rig_connectivity import validate

with tempfile.TemporaryDirectory(prefix='facial-connectivity-') as folder:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mesh=bpy.data.meshes.new('Face');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)])
    obj=bpy.data.objects.new('Face',mesh);bpy.context.collection.objects.link(obj)
    attr=mesh.attributes.new('_workbench_vertex','INT','POINT')
    for i,v in enumerate(attr.data):v.value=i
    donor=bpy.data.objects.new('Hidden donor',mesh.copy());bpy.context.collection.objects.link(donor)
    donor.data.attributes.remove(donor.data.attributes['_workbench_vertex']);donor.hide_render=True
    source=str(Path(folder)/'source.blend');result=str(Path(folder)/'result.blend')
    bpy.ops.wm.save_as_mainfile(filepath=source)
    obj.shape_key_add(name='Basis');key=obj.shape_key_add(name='Blink');key.data[0].co.z=.01
    bpy.ops.wm.save_as_mainfile(filepath=result)
    assert validate(source,result,['Face'])['meshes']==1
    assert validate(source,result,['Face export'])['meshes']==1
    try:validate(source,result,['Missing face'])
    except ValueError as e:assert 'TARGET_MESH_MISSING' in str(e)
    else:raise AssertionError('Missing target was accepted')
    bpy.ops.wm.open_mainfile(filepath=result,load_ui=False,use_scripts=False)
    bpy.data.objects['Face'].data.attributes['_workbench_vertex'].data[1].value=0
    bpy.ops.wm.save_as_mainfile(filepath=result)
    try:validate(source,result,['Face'])
    except ValueError as e:assert 'SPLIT_EDITABLE_MESH' in str(e)
    else:raise AssertionError('Split identity was accepted')
print('FACIAL_CONNECTIVITY_OK')

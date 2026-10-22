"""Run with Blender --background --factory-startup --python-exit-code 1 --python this.py."""
import bpy,sys,json,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server'/'blender'))
from refresh_placement_textures import refresh,geometry_state,signature,imported,source_matches

with tempfile.TemporaryDirectory(prefix='workbench-texture-refresh-') as folder:
    root=Path(folder);bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    job={'previous':{},'textures':{},'inputBlend':str(root/'source.blend'),'blend':str(root/'new.blend'),'glb':str(root/'new.glb'),'report':str(root/'report.json')}
    for group in ('head','body'):
        bpy.ops.mesh.primitive_cube_add();o=bpy.context.object;o.name=group
        mat=bpy.data.materials.new(group);mat.use_nodes=True;o.data.materials.append(mat)
        for version,color in [('previous',(.3,.1,.1,1)),('textures',(.1,.6,.2,1))]:
            mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=color
            job[version][group]=str(root/(group+'-'+version+'.glb'))
            bpy.ops.export_scene.gltf(filepath=job[version][group],export_format='GLB',use_selection=True)
        bpy.data.objects.remove(o,do_unlink=True)
    parts=[]
    for i,group in enumerate(('head','body')):
        objects,meshes=imported(job['previous'][group]);o=meshes[0];o['workbench_part']=group
        o.location=(i,.2,1.5);o.scale=(.7,.8,.9);o.shape_key_add(name='Basis');key=o.shape_key_add(name='Approved hair correction');key.data[0].co.y+=.12;key.value=1
        parts.append(o)
    bpy.context.view_layer.update();before=geometry_state(parts)
    bpy.ops.wm.save_as_mainfile(filepath=job['inputBlend'],compress=False)
    refresh(job)
    bpy.ops.wm.open_mainfile(filepath=job['blend'],load_ui=False,use_scripts=False)
    parts=sorted([o for o in bpy.context.scene.objects if o.get('workbench_part')],key=lambda o:('head','body').index(o['workbench_part']))
    assert geometry_state(parts)==before
    for o in parts:
        assert len(o.data.shape_keys.key_blocks)==2
        color=o.data.materials[0].node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value
        assert abs(color[1]-.6)<.0001
    report=json.loads(Path(job['report']).read_text());assert report['textureRefresh']['geometryPreserved']
    # Same face corners, different vertex indexing: safe to reuse.
    source=parts[0];copy=source.copy();copy.data=source.data.copy();bpy.context.scene.collection.objects.link(copy)
    assert signature(source,True)==signature(copy,True)
    # Left/right prepared eyes may have identical UVs. Disambiguate using
    # unchanged local corner geometry, not object order or name suffixes.
    other=source.copy();other.data=source.data.copy();bpy.context.scene.collection.objects.link(other)
    for v in other.data.vertices:v.co.x+=3
    assert signature(other)==signature(source)
    assert source_matches(source,[other,copy])==[copy]
    assert len(source_matches(source,[source,copy]))==2  # Truly ambiguous stays rejected.
    # Changed positions must fail; Smart UV may change UVs without moving a face.
    for kind in ('position','uv'):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        objects,meshes=imported(job['textures']['body']);o=meshes[0]
        if kind=='position':o.data.vertices[0].co.x+=.1
        else:o.data.uv_layers.active.data[0].uv.x+=.1
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True)
        altered=str(root/(kind+'.glb'));bpy.ops.export_scene.gltf(filepath=altered,export_format='GLB',use_selection=True)
        update={**job,'textures':{**job['textures'],'body':altered}}
        if kind=='uv':
            refresh(update)
            assert geometry_state([o for o in bpy.context.scene.objects if o.get('workbench_part')])==before
        else:
            try:refresh(update)
            except ValueError as e:assert str(e)=='PLACEMENT_TEXTURE_GEOMETRY_MISMATCH'
            else:raise AssertionError('Unsafe geometry change accepted')
    print('TEXTURE_REFRESH_REGRESSION_OK: saved shape keys, transforms, materials; accepted new UVs; rejected geometry changes')

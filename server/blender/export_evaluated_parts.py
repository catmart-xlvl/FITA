"""Bake the visible corrections only in export copies, retain editable .blend."""
import bpy
from mesh_connectivity import stamp


def export_evaluated_parts(filename, parts):
    deps = bpy.context.evaluated_depsgraph_get()
    copies=[]
    previous_selected=list(bpy.context.selected_objects)
    try:
        bpy.ops.object.select_all(action='DESELECT')
        for source in parts:
            evaluated=source.evaluated_get(deps)
            mesh=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=deps)
            stamp(mesh)
            obj=bpy.data.objects.new(source.name+' export',mesh)
            bpy.context.scene.collection.objects.link(obj)
            obj.matrix_world=source.matrix_world.copy()
            obj['workbench_part']=source.get('workbench_part','')
            if source.get('workbenchHairNormals') is not None:
                marker=source['workbenchHairNormals']
                obj['workbenchHairNormals']=marker.to_dict() if hasattr(marker,'to_dict') else marker
            obj.select_set(True);copies.append(obj)
        bpy.ops.export_scene.gltf(filepath=str(filename),export_format='GLB',use_selection=True,
            export_apply=True,export_attributes=True,export_extras=True,export_morph=False,export_animations=False,export_cameras=False,export_lights=False)
    finally:
        for obj in copies:
            mesh=obj.data;bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(mesh)
        for obj in previous_selected:
            obj.select_set(True)

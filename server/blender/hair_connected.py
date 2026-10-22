"""Editable connected-only proportional displacement, no lattice or armature."""
import bpy
from mathutils import Vector
from connected_falloff import connected_weights,validate_uv_seam_pairs,validate_seam_motion


def deform_connected_hair(obj, *, indices, seeds, radius, displacement,
                          name='Hair connected clearance', seam_pairs=()):
    """World-space parameters. Explicit reviewed selection; never auto-detect hair.

    Re-running the same named key is absolute from Basis, not cumulative. Protect
    face/fringe/accessories by omitting them from indices. For GLB UV-split meshes,
    pass only verified duplicate-position seam pairs within the selected strands.
    """
    if obj.type != 'MESH' or obj.data.users > 1:
        raise ValueError('Use an independent editable mesh copy')
    basis = obj.data.shape_keys.key_blocks[0] if obj.data.shape_keys else None
    points = [tuple(obj.matrix_world @ v.co) for v in (basis.data if basis else obj.data.vertices)]
    edges = [tuple(e.vertices) for e in obj.data.edges]
    indices=list(indices);seeds=list(seeds);displacement=list(displacement)
    seam_pairs=validate_uv_seam_pairs(points,edges,seam_pairs)
    weights = connected_weights(points, edges, seeds, radius, indices, seam_pairs)
    validate_seam_motion(points,edges,weights,displacement)
    delta = obj.matrix_world.inverted().to_3x3() @ Vector(displacement)
    if basis is None:
        basis=obj.shape_key_add(name='Basis')
    key = obj.data.shape_keys.key_blocks.get(name) or obj.shape_key_add(name=name)
    for i, v in enumerate(key.data):
        v.co = basis.data[i].co + delta * weights.get(i, 0)
    key.value = 1
    # Preserve editable influence for subsequent artists and reproducible checks.
    group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
    group.remove(list(range(len(points))))
    for i, weight in weights.items():
        group.add([i], weight, 'REPLACE')
    bpy.context.scene.tool_settings.use_proportional_edit = True
    bpy.context.scene.tool_settings.use_proportional_connected = True
    bpy.context.scene.tool_settings.proportional_edit_falloff = 'SMOOTH'
    bpy.context.scene.tool_settings.proportional_size = radius
    return {'method':'connected-smooth-proportional','shapeKey':name,
            'selectedVertices':len(indices),'affectedVertices':len(weights),
            'seeds':list(seeds),'radiusWorld':radius,
            'displacementWorld':list(displacement),'seamLinks':len(seam_pairs),
            'protectedVertices':len(points)-len(weights)}

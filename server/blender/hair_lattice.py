"""Helper for a reviewed hair region, never auto-selects hair from skin."""
import bpy
from mathutils import Vector

def deform_hair_region(obj, indices, center, size, displacement):
    """Coherent volume deformation in world coordinates, limited to explicit hair vertices.
    The artist/agent must identify a hair-only region before using this helper.
    Keep the modifier editable; use glTF export_apply=True for an evaluated export.
    """
    if obj.type!='MESH' or not indices or min(size)<=0: raise ValueError('Invalid reviewed hair region')
    if any(i<0 or i>=len(obj.data.vertices) for i in indices): raise ValueError('Invalid hair vertex selection')
    group=obj.vertex_groups.new(name='Reviewed_Hair_Only');group.add(list(indices),1.0,'REPLACE')
    data=bpy.data.lattices.new('Hair_Clearance');data.points_u=3;data.points_v=3;data.points_w=4
    lattice=bpy.data.objects.new('Hair_Clearance',data);bpy.context.collection.objects.link(lattice)
    low=Vector([min(p.co_deform[i] for p in data.points) for i in range(3)])
    high=Vector([max(p.co_deform[i] for p in data.points) for i in range(3)])
    span=high-low
    lattice.location=Vector(center);lattice.scale=Vector([size[i]/span[i] for i in range(3)]);lattice.display_type='WIRE'
    for p in data.points:
        # Smooth broad influence; this edits a low-resolution cage, not mesh vertices.
        normalized_z=(p.co_deform.z-low.z)/span.z
        weight=max(0,1-abs(normalized_z-.5)*2)**2
        p.co_deform+=Vector([displacement[i]/lattice.scale[i] for i in range(3)])*weight
    modifier=obj.modifiers.new('Hair volume clearance','LATTICE');modifier.object=lattice;modifier.vertex_group=group.name
    return lattice,modifier

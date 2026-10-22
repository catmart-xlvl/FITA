"""Local connected Smooth deformation with replayable evidence; preserves UV/topology."""
import json
from mathutils import Vector
from connected_falloff import connected_weights,validate_uv_seam_pairs,validate_seam_motion,rotate_connected_points


def rotate_hair(obj, *, indices, seeds, radius, pivot, axis, angle, protected_indices, seam_pairs=()):
    """Rotate an isolated reviewed strand, protecting central hair and reviewed anchors.

    World-space pivot/axis/radius before final height scaling; angle in radians.
    Use small successive steps with visual checks, not accumulated translations.
    """
    if obj.get('workbench_part')!='head' or not any(w in obj.name.lower() for w in ('hair','cabello','pelo')) or obj.modifiers or obj.data.shape_keys or obj.data.users>1:
        raise ValueError('A separate editable hair mesh is required')
    points=[obj.matrix_world@v.co for v in obj.data.vertices];edges=[tuple(e.vertices) for e in obj.data.edges]
    indices=list(indices);seeds=list(seeds);protected_indices=list(protected_indices)
    if not protected_indices or any(type(i)!=int or not 0<=i<len(points) for i in protected_indices):raise ValueError('Identify protected central hair and roots')
    if not set(range(len(points)))-set(indices)<=set(protected_indices):raise ValueError('Protect every vertex outside the selected strand')
    seams=validate_uv_seam_pairs(points,edges,seam_pairs)
    weights=connected_weights(points,edges,seeds,radius,indices,seams)
    result=rotate_connected_points(points,edges,weights,pivot,axis,angle,protected_indices)
    inverse=obj.matrix_world.inverted()
    for i,w in weights.items():
        if w>0:obj.data.vertices[i].co=inverse@Vector(result[i])
    step=dict(method='rotation',indices=indices,seeds=seeds,radius=radius,pivot=list(pivot),axis=list(axis),angle=angle,protectedIndices=protected_indices,seamPairs=[list(p) for p in seams])
    steps=json.loads(obj.get('workbench_hair_clearance','[]'));steps.append(step);obj['workbench_hair_clearance']=json.dumps(steps);obj.data.update()
    return {'method':'connected-rotation','affectedVertices':sum(w>0 for w in weights.values()),'protectedVertices':len(protected_indices)}

def clear_hair(obj, *, indices, seeds, radius, displacement, seam_pairs=()):
    """Select reviewed hair only; never face, fringe, roots or accessories.

    Call before global height scaling. Displacements and radius are world units.
    Uses graph distance (Connected Only), no lattice and no spatial neighbours.
    """
    if obj.get('workbench_part')!='head' or not any(w in obj.name.lower() for w in ('hair','cabello','pelo')):
        raise ValueError('A separate, identified hair mesh is required')
    if obj.modifiers or obj.data.shape_keys or obj.data.users>1:
        raise ValueError('Use independent mesh without modifiers or shape keys')
    points=[obj.matrix_world@v.co for v in obj.data.vertices]
    edges=[tuple(e.vertices) for e in obj.data.edges]
    indices=list(indices);seeds=list(seeds);displacement=list(displacement)
    seam_pairs=validate_uv_seam_pairs(points,edges,seam_pairs)
    weights=connected_weights(points,edges,seeds,radius,indices,seam_pairs)
    validate_seam_motion(points,edges,weights,displacement)
    delta=obj.matrix_world.inverted().to_3x3()@Vector(displacement)
    for i,w in weights.items():obj.data.vertices[i].co+=delta*w
    steps=json.loads(obj.get('workbench_hair_clearance','[]'))
    step=dict(indices=list(indices),seeds=list(seeds),radius=radius,displacement=list(displacement))
    if seam_pairs:step['seamPairs']=[list(pair) for pair in seam_pairs]
    steps.append(step)
    obj['workbench_hair_clearance']=json.dumps(steps)
    obj.data.update()
    return {'method':'connected-only-smooth','affectedVertices':len(weights),'verifiedSeamLinks':len(seam_pairs)}

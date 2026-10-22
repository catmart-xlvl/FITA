"""Replay the viewport's approved surface deformation on the editable source."""
from mathutils import Vector, Matrix


def apply_deformers(meshes, entries):
    if not entries:
        return
    def key(point):
        # Match JavaScript Math.round, including negative half values.
        import math
        return tuple(math.floor(n * 1e6 + .5) for n in point)
    table = {key(e['before']): e for e in entries if 'vertexId' not in e}
    identified = {(e['sourceName'],e['vertexId']): e for e in entries if 'vertexId' in e}
    for obj in meshes:
        mesh = obj.data
        world = obj.matrix_world.copy()
        inverse = world.inverted()
        normal_to_world = world.to_3x3().inverted().transposed()
        normal_to_local = normal_to_world.inverted()
        normals = [n.vector.copy() for n in mesh.corner_normals]
        identities = next((a for a in mesh.attributes if a.name.lower()=='_workbench_vertex'),None)
        matched = []
        for vertex in mesh.vertices:
            point = world @ vertex.co
            entry = identified.get((obj.name,identities.data[vertex.index].value)) if identities else None
            if entry is None:
                entry = table.get(key(point))
            if entry is None:
                # Float matrix evaluation can cross a quantization boundary.
                # Accept only an unambiguous source match at float precision.
                k=key(point)
                candidates=[table.get((k[0]+x,k[1]+y,k[2]+z)) for x in (-1,0,1) for y in (-1,0,1) for z in (-1,0,1)]
                candidates=[e for e in candidates if e and (Vector(e['before'])-point).length < 2e-7]
                if candidates and all((Vector(e['after'])-Vector(candidates[0]['after'])).length < 2e-7 for e in candidates):
                    entry=candidates[0]
            if entry is None or (Vector(entry['before']) - point).length > 2e-7:
                raise ValueError('PLACEMENT_DEFORMER_SOURCE_CHANGED')
            matched.append(entry)
        for loop in mesh.loops:
            values = matched[loop.vertex_index]['normalMatrix']
            matrix = Matrix(tuple(tuple(values[c * 3 + r] for c in range(3)) for r in range(3)))
            normals[loop.index] = (normal_to_local @ matrix @ normal_to_world @ normals[loop.index]).normalized()
        for vertex, entry in zip(mesh.vertices, matched):
            vertex.co = inverse @ Vector(entry['after'])
        mesh.update()
        mesh.normals_split_custom_set(normals)

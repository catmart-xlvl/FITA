"""Keep editable vertex identity across glTF's per-corner UV/normal splits.

Never weld by distance: exported source IDs authorize each join. Legacy glTFs
use Blender's attribute-aware importer (positions, normals, skin and morphs).
"""
import bpy, bmesh, json, struct
import math
from pathlib import Path

VERTEX_ID = '_workbench_vertex'


def stamp(mesh):
    attr = next((a for a in mesh.attributes if a.name.lower() == VERTEX_ID), None)
    if attr is None:
        attr = mesh.attributes.new(VERTEX_ID, 'FLOAT', 'POINT')
        for v in mesh.vertices:
            attr.data[v.index].value = v.index


def restore_native_preview(obj):
    """Reindex static native-preview corners without BMesh collapsing faces.

    Coincident and opposite-winding faces remain separate for the subsequent
    explicit cleanup policy. Identity authorizes joins; position never does.
    Rigged/legacy imports continue to use restore's deformation-aware path.
    """
    source = obj.data
    attrs = {a.name.lower(): a for a in source.attributes}
    identity, native = attrs.get(VERTEX_ID), attrs.get('_wb_face')
    if not identity or not native or any(a.domain != 'POINT' or a.data_type != 'FLOAT' for a in (identity, native)):
        raise ValueError('NATIVE_PREVIEW_IDENTITY_INVALID')
    if source.shape_keys or any(v.groups for v in source.vertices):
        raise ValueError('NATIVE_PREVIEW_DEFORMATION_UNSUPPORTED')
    uv_names = {layer.name for layer in source.uv_layers}
    allowed = {'position', VERTEX_ID, '_wb_face', 'sharp_edge', 'sharp_face', 'custom_normal', 'material_index'} | {n.lower() for n in uv_names}
    if any(not a.name.startswith('.') and a.name.lower() not in allowed for a in source.attributes):
        raise ValueError('NATIVE_PREVIEW_ATTRIBUTES_UNSUPPORTED')
    identities = [a.value for a in identity.data]
    if any(not math.isfinite(v) or v < 0 or v != round(v) for v in identities):
        raise ValueError('NATIVE_PREVIEW_IDENTITY_INVALID')
    owners, positions, remap = {}, [], []
    for vertex, value in zip(source.vertices, identities):
        key = int(value)
        if key not in owners:
            owners[key] = len(positions)
            positions.append(vertex.co.copy())
        target = owners[key]
        if (positions[target] - vertex.co).length > 1e-7:
            raise ValueError('PLACEMENT_CONNECTIVITY_CONFLICT')
        remap.append(target)
    faces = [tuple(remap[v] for v in face.vertices) for face in source.polygons]
    if any(len(set(face)) != len(face) for face in faces):
        raise ValueError('PLACEMENT_CONNECTIVITY_FACE_CHANGED')
    normals = [tuple(n.vector) for n in source.corner_normals]
    uv_values = [[tuple(item.uv) for item in layer.data] for layer in source.uv_layers]
    target = bpy.data.meshes.new(source.name + '_connected')
    try:
        target.from_pydata(positions, [], faces)
        target.update()
        if len(target.polygons) != len(faces) or len(target.loops) != len(normals):
            raise ValueError('PLACEMENT_CONNECTIVITY_FACE_CHANGED')
        for face, expected in zip(target.polygons, faces):
            if tuple(face.vertices) != expected:
                raise ValueError('PLACEMENT_CONNECTIVITY_FACE_CHANGED')
        for material in source.materials:
            target.materials.append(material)
        for before, after in zip(source.polygons, target.polygons):
            after.material_index = before.material_index
            after.use_smooth = before.use_smooth
        for name, values in zip([layer.name for layer in source.uv_layers], uv_values):
            layer = target.uv_layers.new(name=name)
            for item, uv in zip(layer.data, values):
                item.uv = uv
        for edge in target.edges:
            edge.use_edge_sharp = True
        target.normals_split_custom_set(normals)
        for old, actual in zip(normals, target.corner_normals):
            if sum((a-b)**2 for a,b in zip(old, actual.vector))**.5 > .018:
                raise ValueError('PLACEMENT_CONNECTIVITY_NORMAL_CHANGED')
        stamp(target)
    except Exception:
        bpy.data.meshes.remove(target)
        raise
    obj.data = target
    return len(source.vertices) - len(target.vertices)


def restore(obj, identities=None, preserve_source_ids=False):
    mesh = obj.data
    attr = next((a for a in mesh.attributes if a.name.lower() == VERTEX_ID), None)
    if identities is None:
        if attr is None:
            return 0
        identities = [int(round(a.value)) for a in attr.data]
    if len(identities) != len(mesh.vertices):
        raise ValueError('PLACEMENT_CONNECTIVITY_INVALID')
    groups = {}
    for i, identity in enumerate(identities):
        if identity is not None:
            groups.setdefault(identity, []).append(i)
    merges = {i:indices[0] for indices in groups.values() for i in indices[1:]}
    if not merges:
        return 0
    keys = mesh.shape_keys.key_blocks if mesh.shape_keys else []
    def weights(i):
        return sorted((g.group, g.weight) for g in mesh.vertices[i].groups)
    # Conflicting deformation data must be repaired deliberately, not averaged.
    for a, b in merges.items():
        if (mesh.vertices[a].co-mesh.vertices[b].co).length > 1e-7 or weights(a) != weights(b):
            raise ValueError('PLACEMENT_CONNECTIVITY_CONFLICT')
        if any((key.data[a].co-key.data[b].co).length > 1e-7 for key in keys):
            raise ValueError('PLACEMENT_CONNECTIVITY_CONFLICT')
    normals = [tuple(n.vector) for n in mesh.corner_normals]
    marker = mesh.attributes.new('_wb_loop_order', 'INT', 'CORNER')
    for i, item in enumerate(marker.data):
        item.value = i
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh); bm.verts.ensure_lookup_table()
        bmesh.ops.weld_verts(bm, targetmap={bm.verts[a]:bm.verts[b] for a,b in merges.items()})
        bm.to_mesh(mesh)
    finally:
        bm.free()
    order = [v.value for v in mesh.attributes['_wb_loop_order'].data]
    if len(order) != len(normals):
        raise ValueError('PLACEMENT_CONNECTIVITY_FACE_CHANGED')
    # Rebuild each corner's encoding independently after UV fans are joined.
    # Explicit custom normals retain the original smooth appearance.
    for edge in mesh.edges:
        edge.use_edge_sharp = True
    mesh.normals_split_custom_set([normals[i] for i in order])
    normal_error = max((sum((a-b)**2 for a,b in zip(normals[old], mesh.corner_normals[i].vector))**.5
                        for i,old in enumerate(order)), default=0)
    # Blender stores custom normals in its tangent-space representation. Bound
    # the conversion error rather than requiring bitwise float equality.
    if normal_error > .018:
        def direction(n):
            length = sum(v*v for v in n)**.5
            return tuple(v/length for v in n) if length > 1e-12 else (0,0,0)
        # A non-unit imported vector may be normalized by Blender. Check
        # direction only for normals that exceeded the original error bound.
        for i,old in enumerate(order):
            actual = tuple(mesh.corner_normals[i].vector)
            if sum((a-b)**2 for a,b in zip(normals[old],actual))**.5 <= .018:
                continue
            if sum((a-b)**2 for a,b in zip(direction(normals[old]),direction(actual)))**.5 > .018:
                raise ValueError('PLACEMENT_CONNECTIVITY_NORMAL_CHANGED')
    mesh.attributes.remove(mesh.attributes['_wb_loop_order'])
    if preserve_source_ids and attr is not None:
        return len(merges)
    # Re-stamp the now connected editable mesh before the next export.
    for a in list(mesh.attributes):
        if a.name.lower() == VERTEX_ID:
            mesh.attributes.remove(a)
    stamp(mesh)
    return len(merges)


def import_connected_glb(filename, reference=None, preserve_source_ids=False):
    raw = Path(filename).read_bytes()
    document = json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
    encoded_ids = any(VERTEX_ID.upper() in p.get('attributes', {})
        for m in document.get('meshes', []) for p in m['primitives'])
    before = set(bpy.data.objects)
    options = dict(filepath=str(filename), merge_vertices=not encoded_ids and not reference)
    # Blender's glTF importer otherwise creates a hidden Icosphere for drawing
    # bones. FBX does not honour glTF's helper-collection exclusion and exports
    # that unweighted display mesh as part of the character.
    if 'disable_bone_shape' in bpy.ops.import_scene.gltf.get_rna_type().properties:
        options['disable_bone_shape'] = True
    bpy.ops.import_scene.gltf(**options)
    objects = [o for o in bpy.data.objects if o not in before]
    for obj in objects:
        if obj.type == 'MESH':
            if encoded_ids:
                restore(obj, preserve_source_ids=preserve_source_ids)
            elif reference and obj.name in reference:
                restore_from_reference(obj,reference[obj.name])
            stamp(obj.data)
    return objects


def reference_tables(objects):
    """Source-space triangles identify original vertex IDs, including UV seams."""
    tables = {}
    for obj in objects:
        if obj.type != 'MESH':
            continue
        table = {}
        for face in obj.data.polygons:
            corners = [tuple(round(c,6) for c in obj.matrix_world @ obj.data.vertices[i].co) for i in face.vertices]
            table.setdefault(tuple(sorted(corners)), []).append(dict(zip(corners, face.vertices)))
        tables[obj.name] = table
    return tables


def restore_from_reference(obj, table):
    """Legacy repair uses saved source corners, never nearest-neighbor welding."""
    attr = obj.data.attributes.get('workbench_texture_source')
    owners = [set() for _ in obj.data.vertices]
    matched = 0
    for face in obj.data.polygons:
        corners = [tuple(round(c,6) for c in (attr.data[i].vector if attr else
            obj.matrix_world @ obj.data.vertices[obj.data.loops[i].vertex_index].co)) for i in face.loop_indices]
        candidates = table.get(tuple(sorted(corners)), [])
        if not candidates:
            continue
        # Identical coincident faces with different source vertices are ambiguous.
        if any(len({candidate[c] for candidate in candidates}) != 1 for c in corners):
            continue
        matched += 1
        for loop, corner in zip(face.loop_indices, corners):
            owners[obj.data.loops[loop].vertex_index].add(candidates[0][corner])
    if any(len(ids)>1 for ids in owners):
        raise ValueError('PLACEMENT_CONNECTIVITY_AMBIGUOUS')
    identities = [next(iter(ids)) if ids else None for ids in owners]
    positions={};conflicts=set()
    for i,identity in enumerate(identities):
        if identity is None:continue
        position=obj.data.vertices[i].co
        if identity in positions and (positions[identity]-position).length>1e-7:
            conflicts.add(identity)
        positions.setdefault(identity,position.copy())
    # A historical local edit may have moved only one copy of a UV seam. Do
    # not undo that approved edit or silently close an actual geometric gap.
    identities=[None if identity in conflicts else identity for identity in identities]
    return {'mergedVertices':restore(obj, identities), 'matchedFaces':matched,
            'unmatchedFaces':len(obj.data.polygons)-matched, 'conflictingSourceVertices':len(conflicts)}

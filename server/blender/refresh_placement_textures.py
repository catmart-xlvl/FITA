"""Transfer UVs/materials onto an approved placement, never place/deform it again."""
import bpy, json, sys, hashlib, math
from pathlib import Path
from array import array
sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_evaluated_parts import export_evaluated_parts

SOURCE_CORNERS = 'workbench_texture_source'


def require(value, error='PLACEMENT_TEXTURE_GEOMETRY_MISMATCH'):
    if not value:
        raise ValueError(error)


def signature(obj, positions=False):
    mesh = obj.data
    # Identify legacy placed meshes through unchanged face-corner layout, even
    # when their editable hair corrections changed positions or GLB split seams.
    parts = [[p.loop_total for p in mesh.polygons],
             [p.material_index for p in mesh.polygons],
             [[round(c, 5) for loop in layer.data for c in loop.uv] for layer in mesh.uv_layers]]
    if positions:
        parts.append([[round(c, 5) for c in mesh.vertices[loop.vertex_index].co] for loop in mesh.loops])
    return hashlib.sha256(json.dumps(parts, separators=(',', ':')).encode()).hexdigest()


def source_matches(target, available):
    matches = [o for o in available if signature(o) == signature(target)]
    # Prepared left/right irises and glints deliberately share a UV layout.
    # Their unchanged local corner geometry disambiguates ownership; never
    # select the first same-UV object or rely on Blender's renamed suffixes.
    if len(matches) > 1:
        matches = [o for o in matches if signature(o, True) == signature(target, True)]
    return matches


def geometry_state(objects):
    """Exact topology, coordinates, transforms and visible deformation, not UVs."""
    digest = hashlib.sha256()
    deps = bpy.context.evaluated_depsgraph_get()

    def mesh_state(mesh):
        for collection, prop, size, kind in ((mesh.vertices, 'co', 3, 'f'),
                (mesh.edges, 'vertices', 2, 'i'), (mesh.loops, 'vertex_index', 1, 'i'),
                (mesh.polygons, 'loop_start', 1, 'i'), (mesh.polygons, 'loop_total', 1, 'i')):
            values = array(kind, [0]) * (len(collection) * size)
            collection.foreach_get(prop, values)
            digest.update(str((prop, len(collection))).encode())
            digest.update(values.tobytes())

    for obj in sorted(objects, key=lambda o: o.name):
        digest.update(str([obj.name, obj.get('workbench_part'),
                           [list(row) for row in obj.matrix_world]]).encode())
        mesh_state(obj.data)
        if obj.data.shape_keys:
            for key in obj.data.shape_keys.key_blocks:
                digest.update(str([key.name, key.value, key.relative_key.name]).encode())
                values = array('f', [0]) * (len(key.data) * 3)
                key.data.foreach_get('co', values)
                digest.update(values.tobytes())
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            mesh_state(mesh)
        finally:
            evaluated.to_mesh_clear()
    return digest.hexdigest()


def imported(filename):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=filename)
    objects = [o for o in bpy.data.objects if o not in before]
    return objects, [o for o in objects if o.type == 'MESH']


def coordinate_key(point):
    require(all(math.isfinite(c) for c in point))
    return tuple(round(c, 6) for c in point)


def face_table(objects, source=False):
    result = {}
    for obj in objects:
        attr = obj.data.attributes.get(SOURCE_CORNERS) if source else None
        if source:
            require(attr is not None and attr.domain == 'CORNER' and attr.data_type == 'FLOAT_VECTOR')
        for face in obj.data.polygons:
            points = [tuple(attr.data[i].vector) if source else
                      tuple(obj.matrix_world @ obj.data.vertices[obj.data.loops[i].vertex_index].co)
                      for i in face.loop_indices]
            keys = [coordinate_key(p) for p in points]
            require(len(keys) == 3 and len(set(keys)) == 3)
            key = tuple(sorted(keys))
            require(key not in result)  # Coincident faces have ambiguous ownership.
            result[key] = (obj, face, points, keys)
    return result


def target_correspondence(targets, old):
    """Keep source-space face corners across repeated segment/UV exports."""
    if all(o.get('workbench_texture_correspondence') == 1 for o in targets):
        return face_table(targets, source=True)
    require(not any(o.get('workbench_texture_correspondence') for o in targets))
    require(len(targets) == len(old))
    available = list(old)
    result = {}
    for target in targets:
        found = source_matches(target, available)
        require(len(found) == 1)
        original = found[0]
        available.remove(original)
        for key, (_, face, points, keys) in face_table([original]).items():
            require(key not in result)
            result[key] = (target, target.data.polygons[face.index], points, keys)
    return result


def unchanged_layout(targets, old, new):
    """Exact existing layout remains unambiguous even with coincident faces.

    Ordinary retexturing must not regress on real meshes with duplicate faces.
    New UVs use geometric correspondence instead; never guess duplicate owners.
    """
    if len(targets) != len(old) or len(old) != len(new):
        return None
    available, replacements, mapping = list(old), list(new), []
    for target in targets:
        sources = source_matches(target, available)
        if len(sources) != 1:
            return None
        source = sources[0]
        matches = [o for o in replacements if signature(o, True) == signature(source, True)]
        if len(matches) != 1:
            return None
        replacement = matches[0]
        if tuple(l.name for l in replacement.data.uv_layers) != tuple(l.name for l in source.data.uv_layers):
            return None
        available.remove(source)
        replacements.remove(replacement)
        for face in source.data.polygons:
            points = [tuple(source.matrix_world @ source.data.vertices[source.data.loops[i].vertex_index].co)
                      for i in face.loop_indices]
            mapping.append((target, target.data.polygons[face.index], points,
                            replacement, replacement.data.polygons[face.index], list(range(face.loop_total))))
    return mapping


def plan_transfer(targets, old, new):
    mapping = unchanged_layout(targets, old, new)
    if mapping is None:
        originals, replacements = face_table(old), face_table(new)
        placed = target_correspondence(targets, old)
        require(set(originals) == set(replacements) == set(placed))
        mapping = []
        for key, (target, face, points, keys) in placed.items():
            source, returned, _, new_keys = replacements[key]
            mapping.append((target, face, points, source, returned, [new_keys.index(c) for c in keys]))
    schemas = {tuple(layer.name for layer in o.data.uv_layers) for o in new}
    active = {o.data.uv_layers.active.name for o in new if o.data.uv_layers.active}
    require(len(schemas) == 1 and bool(next(iter(schemas))) and len(active) == 1,
            'PLACEMENT_TEXTURE_UV_MISMATCH')
    materials, assignments = [], []
    for target, face, points, source, returned, indices in mapping:
        require(returned.material_index < len(source.data.materials), 'PLACEMENT_TEXTURE_MATERIAL_MISSING')
        material = source.data.materials[returned.material_index]
        require(material is not None, 'PLACEMENT_TEXTURE_MATERIAL_MISSING')
        if material not in materials:
            materials.append(material)
        loops = list(returned.loop_indices)
        uv = {layer.name: [tuple(layer.data[loops[i]].uv) for i in indices]
              for layer in source.data.uv_layers}
        require(all(math.isfinite(v) for corners in uv.values() for p in corners for v in p),
                'PLACEMENT_TEXTURE_UV_MISMATCH')
        assignments.append((target, face.index, points, uv, materials.index(material)))
    return targets, next(iter(schemas)), next(iter(active)), materials, assignments


def apply_transfer(plan):
    targets, schema, active, materials, assignments = plan
    for target in targets:
        # Never change vertices, topology, object transforms or shape keys.
        target.data.materials.clear()
        for material in materials:
            target.data.materials.append(material)
        for layer in list(target.data.uv_layers):
            target.data.uv_layers.remove(layer)
        for name in schema:
            target.data.uv_layers.new(name=name)
        target.data.uv_layers.active = target.data.uv_layers[active]
        target.data.uv_layers.active.active_render = True
        if not target.data.attributes.get(SOURCE_CORNERS):
            target.data.attributes.new(SOURCE_CORNERS, 'FLOAT_VECTOR', 'CORNER')
        target['workbench_texture_correspondence'] = 1
    for target, index, points, uv, material_index in assignments:
        face = target.data.polygons[index]
        face.material_index = material_index
        for n, loop in enumerate(face.loop_indices):
            target.data.attributes[SOURCE_CORNERS].data[loop].vector = points[n]
            for name, corners in uv.items():
                target.data.uv_layers[name].data[loop].uv = corners[n]


def placed_parts():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH'
            and o.get('workbench_part') in ('head', 'body')]


def refresh(job):
    bpy.ops.wm.open_mainfile(filepath=job['inputBlend'], load_ui=False, use_scripts=False)
    placed = placed_parts()
    require(all(any(o.get('workbench_part') == g for o in placed) for g in ('head', 'body')),
            'PLACEMENT_TEXTURE_PARTS_MISSING')
    # Editing shared mesh data would also change another object in the scene.
    require(all(o.data.users == 1 for o in placed))
    before = geometry_state(placed)
    temporary, plans = [], []
    try:
        # Validate BOTH parts before changing either one, including new UVs and
        # material groups. The previous .blend and GLBs are always immutable.
        for group in ('head', 'body'):
            old_objects, old = imported(job['previous'][group])
            temporary.extend(old_objects)
            new_objects, new = imported(job['textures'][group])
            temporary.extend(new_objects)
            targets = [o for o in placed if o.get('workbench_part') == group]
            plans.append(plan_transfer(targets, old, new))
        for plan in plans:
            apply_transfer(plan)
    finally:
        for obj in temporary:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()
    after = geometry_state(placed)
    require(before == after, 'PLACEMENT_TEXTURE_GEOMETRY_CHANGED')
    face_count = sum(len(plan[4]) for plan in plans)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=job['blend'], compress=False)
    # Verify the saved artifact too, not just the in-memory result.
    bpy.ops.wm.open_mainfile(filepath=job['blend'], load_ui=False, use_scripts=False)
    placed = placed_parts()
    require(before == geometry_state(placed), 'PLACEMENT_TEXTURE_GEOMETRY_CHANGED')
    export_evaluated_parts(job['glb'], placed)
    report = {**job.get('previousReport', {}), 'reviewRequired': True, 'independentParts': True,
              'headMeshes': sum(o.get('workbench_part') == 'head' for o in placed),
              'bodyMeshes': sum(o.get('workbench_part') == 'body' for o in placed),
              'textureRefresh': {'geometryPreserved': True, 'before': before, 'after': after,
                                 'cornerUvTransfer': True, 'savedAndReopened': True,
                                 'materialsUpdated': len(placed), 'facesTransferred': face_count}}
    Path(job['report']).write_text(json.dumps(report), encoding='utf-8')


if __name__ == '__main__':
    refresh(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8')))

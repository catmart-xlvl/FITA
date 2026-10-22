"""Blender regression: segmented UV/material return keeps approved placement."""
import bpy, sys, json, tempfile, hashlib
from pathlib import Path
from mathutils import Matrix
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'server' / 'blender'))
from refresh_placement_textures import (refresh, imported, geometry_state, face_table,
                                       SOURCE_CORNERS, coordinate_key)


def export(file, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(file), export_format='GLB', use_selection=True,
                             export_animations=False)


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    image = bpy.data.images.new(name, width=2, height=2)
    image.pixels[:] = list(color) * 4
    image.pack()
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = image
    mat.node_tree.links.new(tex.outputs['Color'], mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    return mat


def copy_segments(root, file, prefix, count, revision, fault=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects, meshes = imported(file)
    triangles = list(face_table(meshes).values())
    parts, expected = [], {}
    for n in range(count):
        verts, faces, uvs, records = [], [], [], []
        # Reverse face order, rotate corner order, and split every seam vertex.
        for index in reversed(range(n, len(triangles), count)):
            _, _, points, keys = triangles[index]
            if fault == 'missing' and index == 0:
                continue
            points = points[1:] + points[:1]
            keys = keys[1:] + keys[:1]
            start = len(verts)
            verts.extend(points)
            faces.append((start, start + 1, start + 2))
            uv = [(0.05 + revision * 0.08 + index * 0.005, 0.12),
                  (0.65, 0.20 + n * 0.01), (0.24, 0.75)]
            uvs.extend(uv)
            records.append((keys, uv))
        if not faces:
            continue
        if fault == 'position' and n == 0:
            verts[0] = (verts[0][0] + .1, *verts[0][1:])
        mesh = bpy.data.meshes.new(prefix + str(n))
        mesh.from_pydata(verts, [], faces)
        obj = bpy.data.objects.new(prefix + str(n), mesh)
        bpy.context.collection.objects.link(obj)
        uv_layer = mesh.uv_layers.new(name='UVMap')
        for loop, uv in zip(uv_layer.data, uvs):
            loop.uv = uv
        color = (0.15 + n * .12, .35 + revision * .1, .23, 1)
        mesh.materials.append(material(prefix + str(n), color))
        if fault == 'uv' and n == 0:
            mesh.uv_layers.remove(uv_layer)
        if fault == 'material' and n == 0:
            mesh.materials.clear()
        for keys, uv in records:
            expected[tuple(sorted(keys))] = (dict(zip(keys, uv)), color)
        parts.append(obj)
        if fault == 'duplicate' and n == 0:
            # Blender's glTF importer removes repeated faces within one mesh;
            # overlapping independent meshes must still be rejected as ambiguous.
            duplicate = obj.copy()
            duplicate.data = obj.data.copy()
            bpy.context.collection.objects.link(duplicate)
            parts.append(duplicate)
    result = root / (prefix + '.glb')
    export(result, parts)
    return str(result), expected


def check_surface(parts, expected):
    for group in ('head', 'body'):
        table = face_table([o for o in parts if o.get('workbench_part') == group], source=True)
        assert set(table) == set(expected[group])
        for key, (o, face, _, keys) in table.items():
            uv, color = expected[group][key]
            mat = o.data.materials[face.material_index]
            tex = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
            assert tex.image.packed_file and tex.image.size[0] == 2
            # The fixture image is sRGB encoded by GLB export; compare using
            # the imported source image rather than guessing its transfer curve.
            assert abs(tex.image.pixels[1] - color[1]) < .01
            for loop, corner in zip(face.loop_indices, keys):
                assert max(abs(a-b) for a,b in zip(o.data.uv_layers.active.data[loop].uv, uv[corner])) < 1e-6


with tempfile.TemporaryDirectory(prefix='workbench-segment-refresh-') as folder:
    root = Path(folder)
    job = {'previous': {}, 'textures': {}, 'inputBlend': str(root/'source.blend'),
           'blend': str(root/'refreshed.blend'), 'glb': str(root/'refreshed.glb'),
           'report': str(root/'report.json')}
    for group in ('head', 'body'):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.mesh.primitive_cube_add()
        obj = bpy.context.object
        obj.name = group
        # Imported parts can already have different node transforms.
        obj.location = (.2, -.1, .3)
        obj.scale = (1.1, .9, .8)
        obj.data.materials.append(material(group, (.3, .2, .1, 1)))
        job['previous'][group] = str(root/(group+'.glb'))
        export(job['previous'][group], [obj])
    expected = {}
    for group, count in [('head', 2), ('body', 3)]:
        job['textures'][group], expected[group] = copy_segments(root, job['previous'][group], group+'-segments', count, 1)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = []
    for n, group in enumerate(('head', 'body')):
        _, meshes = imported(job['previous'][group])
        obj = meshes[0]
        obj['workbench_part'] = group
        obj.matrix_world = Matrix.Translation((n, -.32, 1.4)) @ Matrix.Scale(.73, 4) @ obj.matrix_world
        obj.shape_key_add(name='Basis')
        key = obj.shape_key_add(name='Approved connected hair')
        key.data[0].co.y += .2
        key.value = .8
        weights = obj.vertex_groups.new(name='Protected hair selection')
        weights.add([0], .5, 'REPLACE')
        parts.append(obj)
    bpy.context.view_layer.update()
    before = geometry_state(parts)
    bpy.ops.wm.save_as_mainfile(filepath=job['inputBlend'])
    source_hash = hashlib.sha256(Path(job['inputBlend']).read_bytes()).hexdigest()
    refresh(job)
    parts = [o for o in bpy.context.scene.objects if o.get('workbench_part')]
    assert geometry_state(parts) == before
    check_surface(parts, expected)
    assert all(o.vertex_groups.get('Protected hair selection') for o in parts)
    report = json.loads(Path(job['report']).read_text())['textureRefresh']
    assert report['facesTransferred'] == 24 and report['savedAndReopened'] and report['cornerUvTransfer']
    # Exported viewer GLB also contains the approved, evaluated hair deformation.
    deps = bpy.context.evaluated_depsgraph_get()
    visible = set()
    for o in parts:
        mesh = o.evaluated_get(deps).to_mesh()
        for face in mesh.polygons:
            visible.add(tuple(sorted(coordinate_key(o.matrix_world @ mesh.vertices[mesh.loops[i].vertex_index].co) for i in face.loop_indices)))
        o.evaluated_get(deps).to_mesh_clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _, viewer = imported(job['glb'])
    assert set(face_table(viewer)) == visible
    # Repeat from the updated .blend; previous texture GLBs now have 2/3 meshes,
    # while the original placed head/body still have one mesh each.
    second = {**job, 'inputBlend': job['blend'], 'blend': str(root/'second.blend'),
              'glb': str(root/'second.glb'), 'report': str(root/'second.json'),
              'previous': job['textures'], 'textures': {}}
    expected2 = {}
    for group in ('head', 'body'):
        second['textures'][group], expected2[group] = copy_segments(root, job['previous'][group], group+'-again', 1, 2)
    refresh(second)
    parts = [o for o in bpy.context.scene.objects if o.get('workbench_part')]
    assert geometry_state(parts) == before
    check_surface(parts, expected2)
    # Bad return data never writes an output or changes the saved approved source.
    for fault in ('position', 'missing', 'duplicate', 'uv', 'material'):
        broken, _ = copy_segments(root, job['previous']['body'], 'bad-'+fault, 3, 1, fault)
        bad = {**job, 'blend': str(root/('bad-'+fault+'.blend')), 'glb': str(root/('bad-'+fault+'-output.glb')),
               'textures': {**job['textures'], 'body': broken}}
        try:
            refresh(bad)
        except ValueError as error:
            assert str(error).startswith('PLACEMENT_TEXTURE_'), error
        else:
            raise AssertionError('Accepted invalid return: '+fault)
        assert not Path(bad['blend']).exists() and not Path(bad['glb']).exists()
        assert hashlib.sha256(Path(job['inputBlend']).read_bytes()).hexdigest() == source_hash
    print('SEGMENT_TEXTURE_REFRESH_OK: split meshes, new UV seams, texture images, repeated refresh, saved placement and viewer geometry unchanged; invalid returns rejected')

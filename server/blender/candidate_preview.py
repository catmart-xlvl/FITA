"""Preserve the native FBX separately; derive a GPU preview with exact face IDs.
No remeshing, triangle pairing, welding, smoothing or modification of source FBX.
"""
import bpy, json, sys
from pathlib import Path

root=Path(sys.argv[sys.argv.index('--')+1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(root/'source.fbx'),use_anim=False)
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
if not meshes: raise ValueError('STUDIO_FBX_MESH_MISSING')
report={'version':1,'format':'FBX','quads':0,'triangles':0,'ngons':0,'polygons':0,'meshes':len(meshes)}
for obj in meshes:
    source=obj.data
    positions=[]; faces=[]; uv_layers=[[] for _ in source.uv_layers]; face_ids=[]; source_ids=[]
    for polygon in source.polygons:
        size=len(polygon.vertices)
        if size<3: raise ValueError('STUDIO_FBX_FACE_INVALID')
        report['polygons']+=1
        report['quads' if size==4 else 'triangles' if size==3 else 'ngons']+=1
        start=len(positions)
        for loop in polygon.loop_indices:
            positions.append(tuple(source.vertices[source.loops[loop].vertex_index].co))
            source_ids.append(float(source.loops[loop].vertex_index))
            face_ids.append(float(polygon.index))
            for index,layer in enumerate(source.uv_layers): uv_layers[index].append(tuple(layer.data[loop].uv))
        faces.append(tuple(range(start,len(positions))))
    # Each source polygon owns its corners. The GPU's internal triangulation
    # retains a face ID per corner, so its diagonal is never a topology edge.
    preview=bpy.data.meshes.new(obj.name+'_preview')
    preview.from_pydata(positions,[],faces); preview.update()
    attr=preview.attributes.new('_wb_face','FLOAT','POINT')
    attr.data.foreach_set('value',face_ids)
    identity=preview.attributes.new('_workbench_vertex','FLOAT','POINT')
    identity.data.foreach_set('value',source_ids)
    for index,layer in enumerate(source.uv_layers):
        target=preview.uv_layers.new(name=layer.name)
        for loop in preview.loops: target.data[loop.index].uv=uv_layers[index][loop.vertex_index]
    for polygon in preview.polygons: polygon.use_smooth=False
    obj.data=preview
    for modifier in list(obj.modifiers): obj.modifiers.remove(modifier)
    obj['workbenchNativeTopology']={'version':1,'format':'FBX','polygons':len(faces)}
if report['quads']==0: raise ValueError('STUDIO_NATIVE_QUADS_MISSING')
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes: obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(root/'preview.glb'),export_format='GLB',use_selection=True,export_attributes=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False)
(root/'topology.json').write_text(json.dumps(report),encoding='utf-8')

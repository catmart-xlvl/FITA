"""Conservative duplicate-face cleanup on imported working copies only."""
import bmesh

POLICY = 'exact-duplicate-faces/v1'

def clean(objects):
    report=[]
    for obj in objects:
        mesh=obj.data
        # Coincidence alone is insufficient: preserve backfaces, material layers,
        # UV seams and color attributes. No tolerance welding or overlap cutting.
        color_layers=list(mesh.color_attributes)
        seen={};removed=[];kept=[]
        for face in mesh.polygons:
            corners=[]
            for vi,li in zip(face.vertices,face.loop_indices):
                colors=tuple(tuple(a.data[li if a.domain=='CORNER' else vi].color) for a in color_layers if a.domain in ('CORNER','POINT'))
                corners.append((tuple(mesh.vertices[vi].co),tuple(tuple(uv.data[li].uv) for uv in mesh.uv_layers),colors,tuple(mesh.corner_normals[li].vector) if mesh.has_custom_normals else ()))
            oriented=min(tuple(corners[i:]+corners[:i]) for i in range(len(corners)))
            key=(face.material_index,face.use_smooth,oriented)
            if key in seen:removed.append(face.index);kept.append(seen[key])
            else:seen[key]=face.index
        if removed:
            bm=bmesh.new();bm.from_mesh(mesh);bm.faces.ensure_lookup_table()
            bmesh.ops.delete(bm,geom=[bm.faces[i] for i in removed],context='FACES_ONLY')
            bm.to_mesh(mesh);bm.free();mesh.update()
        report.append({'object':obj.name,'removedFaceIndices':removed,'retainedFaceIndices':kept,'removedCount':len(removed),'remainingFaces':len(mesh.polygons)})
    return {'policy':POLICY,'removedCount':sum(r['removedCount'] for r in report),'objects':report}

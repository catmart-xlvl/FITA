"""Unwrap a welded *temporary* face proxy; return corner UVs and an Emit bake.

The source GLB is never re-exported. face-uv.mjs applies only the checked UV
patch and image, preserving every source corner position and normal.
"""
import bpy, bmesh, json, sys, math, time
import numpy as np
from pathlib import Path
from collections import defaultdict
sys.path.insert(0,str(Path(__file__).resolve().parent))
from uv_overlap import raster_overlap
from face_uv_topology import disk_seams,split_vertex_fans,convex_chart,chart_folded

def components(mesh, uv=None):
    edges=defaultdict(list)
    for f in mesh.polygons:
        ls=list(f.loop_indices)
        for i,l in enumerate(ls):
            r=ls[(i+1)%len(ls)]
            ends=[(mesh.loops[k].vertex_index, tuple(round(x,6) for x in uv.data[k].uv) if uv else ()) for k in (l,r)]
            edges[tuple(sorted(ends))].append(f.index)
    graph=[set() for _ in mesh.polygons]
    for fs in edges.values():
        for f in fs:graph[f].update(fs)
    unseen=set(range(len(graph)));out=[]
    while unseen:
        stack=[unseen.pop()];group=set(stack)
        while stack:
            for f in graph[stack.pop()] & unseen:unseen.remove(f);group.add(f);stack.append(f)
        out.append(group)
    return out

def run(job):
    started=time.perf_counter()
    root=Path(job['directory']);d=json.loads(Path(job['input']).read_text(encoding='utf-8'))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    verts=[];unique={};ids=[]
    for p in d['positions']:
        key=tuple(round(x,7) for x in p)
        if key not in unique:unique[key]=len(verts);verts.append(p)
        ids.append(unique[key])
    triangles=d['triangles'];faces=[tuple(ids[v] for v in triangles[i:i+3]) for i in range(0,len(triangles),3)]
    if any(len(set(f))!=3 for f in faces):raise ValueError('FACE_UV_DEGENERATE')
    mesh=bpy.data.meshes.new('Face UV temporary proxy');mesh.from_pydata(verts,[],faces);mesh.update()
    # Positional welding can join several source surfaces along one edge.
    # Split only these ambiguous edges on the disposable unwrap proxy; retain
    # source face/corner identity so the authoritative GLB never changes.
    bm=bmesh.new();bm.from_mesh(mesh);face_id=bm.faces.layers.int.new('source_face_id')
    bm.faces.ensure_lookup_table()
    for face in bm.faces:face[face_id]=face.index
    ambiguous=[e for e in bm.edges if len(e.link_faces)>2]
    repaired_edges=len(ambiguous)
    if ambiguous:bmesh.ops.split_edges(bm,edges=ambiguous)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(mesh);bm.free();mesh.update()
    face_ids=[v.value for v in mesh.attributes['source_face_id'].data]
    if sorted(face_ids)!=list(range(len(faces))):raise ValueError('FACE_UV_PROXY_IDENTITY_CHANGED')
    proxy_vertices,proxy_faces,split_fans=split_vertex_fans([tuple(v.co) for v in mesh.vertices],[list(f.vertices) for f in mesh.polygons])
    if split_fans:
        old=mesh;mesh=bpy.data.meshes.new('Face UV separated surface fans');mesh.from_pydata(proxy_vertices,[],proxy_faces);mesh.update();bpy.data.meshes.remove(old)
    verts=[tuple(v.co) for v in mesh.vertices];corner_ids=[]
    for face in mesh.polygons:
        original=[d['positions'][triangles[face_ids[face.index]*3+i]] for i in range(3)]
        matched=[]
        for loop in face.loop_indices:
            point=np.array(verts[mesh.loops[loop].vertex_index]);distances=[np.linalg.norm(point-np.array(p)) for p in original]
            corner=int(np.argmin(distances))
            if distances[corner]>2e-7 or corner in matched:raise ValueError('FACE_UV_PROXY_IDENTITY_CHANGED')
            matched.append(corner)
        corner_ids.append(matched)
    obj=bpy.data.objects.new('Face UV temporary proxy',mesh);bpy.context.collection.objects.link(obj);obj.select_set(True);bpy.context.view_layer.objects.active=obj
    src=mesh.uv_layers.new(name='SourceUV')
    for f in mesh.polygons:
        for i,l in enumerate(f.loop_indices):u,v=d['uv'][triangles[face_ids[f.index]*3+corner_ids[f.index][i]]];src.data[l].uv=(u,1-v)
    original_islands=components(mesh,src)
    image=bpy.data.images.load(job['image']);pix=np.empty(len(image.pixels),np.float32);image.pixels.foreach_get(pix);pix=pix.reshape(image.size[1],image.size[0],4)
    # Surface identity, not albedo brightness, determines the facial domain.
    # Freckles, brows, shadows and lips must not cut the skin into UV islands.
    surfaces=components(mesh)
    skin=max(surfaces,key=len)
    region_by_source={f:name for name,fs in d.get('semanticRegions',{}).items() for f in fs}
    labels={f.index:region_by_source.get(face_ids[f.index],'skin' if f.index in skin else 'detail') for f in mesh.polygons}
    skin={f for f in skin if labels[f]=='skin'}
    adjacent=defaultdict(list)
    for f in mesh.polygons:
        for edge in f.edge_keys:adjacent[tuple(sorted(edge))].append(f.index)
    neighbours=[set() for _ in mesh.polygons]
    for fs in adjacent.values():
        for f in fs:neighbours[f].update(set(fs)-{f})
    # A reviewed outline may leave tiny isolated skin fragments inside an eye
    # or ear domain. Assign those fragments to the surrounding semantic region,
    # keeping the facial skin connected without removing a single triangle.
    unseen=set(skin);skin_groups=[]
    while unseen:
        stack=[unseen.pop()];group=set(stack)
        while stack:
            for f in neighbours[stack.pop()]&unseen:unseen.remove(f);group.add(f);stack.append(f)
        skin_groups.append(group)
    main_skin=max(skin_groups,key=len)
    for group in skin_groups:
        if group is main_skin:continue
        if len(group)>len(main_skin)*.02:raise ValueError('PLACEMENT_FACE_UV_REGION_REVIEW')
        surrounding=[labels[n] for f in group for n in neighbours[f] if n not in group and labels[n]!='skin']
        if not surrounding:raise ValueError('PLACEMENT_FACE_UV_REGION_REVIEW')
        label=max(set(surrounding),key=surrounding.count)
        for f in group:labels[f]=label;region_by_source[face_ids[f]]=label
    skin=main_skin
    dark=set(range(len(mesh.polygons)))-skin
    dst=mesh.uv_layers.new(name='FaceUV');mesh.uv_layers.active=dst
    seams=set()
    unseen=set(range(len(mesh.polygons)));domains=[]
    while unseen:
        stack=[unseen.pop()];group=set(stack)
        while stack:
            f=stack.pop()
            for n in neighbours[f]&unseen:
                if labels[n]==labels[f]:unseen.remove(n);group.add(n);stack.append(n)
        domains.append(group)
    for group in domains:
        # A single rear path can split a mask or leave an ear handle closed.
        # This cut graph keeps each whole surface connected as one UV disk.
        seams.update(disk_seams(verts,[list(mesh.polygons[f].vertices) for f in sorted(group)]))
    for edge,fs in adjacent.items():
        if len({labels[f] for f in fs})>1:seams.add(edge)
    for edge in mesh.edges:edge.use_seam=tuple(sorted(edge.vertices)) in seams
    bpy.context.tool_settings.mesh_select_mode=(False,False,True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.unwrap(method='ANGLE_BASED',margin=.02);bpy.ops.object.mode_set(mode='OBJECT');dst=mesh.uv_layers.get('FaceUV')
    # Pack the two domains separately with a large empty gutter. Small dark
    # pieces cannot become a neighbour of cheek/forehead skin in mip levels.
    def pack_domains():
        dst=mesh.uv_layers.get('FaceUV')
        for want_dark,box in ((False,(.025,.025,.71,.95)),(True,(.82,.04,.15,.92))):
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT');bpy.ops.object.mode_set(mode='OBJECT')
            for f in mesh.polygons:f.select=(f.index in dark)==want_dark
            if not any(f.select for f in mesh.polygons):continue
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.hide(unselected=True);bpy.ops.uv.select_all(action='SELECT');bpy.ops.uv.average_islands_scale();bpy.ops.uv.pack_islands(rotate=True,margin_method='FRACTION',margin=.025);bpy.ops.mesh.reveal();bpy.ops.object.mode_set(mode='OBJECT');dst=mesh.uv_layers.get('FaceUV')
            loops=[l for f in mesh.polygons if (f.index in dark)==want_dark for l in f.loop_indices]
            values=np.array([dst.data[l].uv[:] for l in loops]);lo=values.min(axis=0);hi=values.max(axis=0);scale=min(box[2]/max(hi[0]-lo[0],1e-8),box[3]/max(hi[1]-lo[1],1e-8))
            for l in loops:dst.data[l].uv=(np.array(dst.data[l].uv[:])-lo)*scale+np.array(box[:2])
        return dst
    dst=pack_domains();repaired_faces=set();repair_passes=0
    overlap,involved=raster_overlap([[dst.data[l].uv[:] for l in f.loop_indices] for f in mesh.polygons],size=2048,return_faces=True)
    overlap_history=[overlap]
    convex_report=[]
    def folded(chart):return chart_folded([[dst.data[l].uv[:] for l in mesh.polygons[f].loop_indices] for f in sorted(chart)])
    charts=components(mesh,dst)
    if overlap or any(folded(chart) for chart in charts):
        # One bounded solve per affected chart; never retry fragmentation.
        for chart in charts:
            if chart & involved or folded(chart):
                report=convex_chart(mesh,dst,chart,preserve_boundary=True)
                if folded(chart) or raster_overlap([[dst.data[l].uv[:] for l in mesh.polygons[f].loop_indices] for f in sorted(chart)],size=2048):report=convex_chart(mesh,dst,chart)
                report['faces']=len(chart);convex_report.append(report)
                repaired_faces.update(chart);repair_passes=1
        dst=pack_domains()
        overlap,involved=raster_overlap([[dst.data[l].uv[:] for l in f.loop_indices] for f in mesh.polygons],size=2048,return_faces=True)
        overlap_history.append(overlap)
    unwrap_seconds=time.perf_counter()-started
    if overlap:
        diagnostics=[]
        for group in components(mesh):
            edge_counts=defaultdict(int);vertices=set()
            for face_index in group:
                face=mesh.polygons[face_index];vertices.update(face.vertices)
                for edge in face.edge_keys:edge_counts[tuple(sorted(edge))]+=1
            coords=np.array([verts[v] for v in vertices])
            diagnostics.append({'faces':len(group),'skinFaces':sum(f not in dark for f in group),'boundaryEdges':sum(n==1 for n in edge_counts.values()),'nonManifoldEdges':sum(n>2 for n in edge_counts.values()),'min':coords.min(0).tolist(),'max':coords.max(0).tolist(),'overlap512':raster_overlap([[dst.data[l].uv[:] for l in mesh.polygons[f].loop_indices] for f in sorted(group)],size=512)})
        uv_charts=components(mesh,dst);skin_charts=[g for g in uv_charts if any(f not in dark for f in g)]
        (root/'overlap-diagnostic.json').write_text(json.dumps({'overlap':overlap,'overlapHistory':overlap_history,'newIslands':len(uv_charts),'skinIslands':len(skin_charts),'skinIslandFaces':sorted([len(g) for g in skin_charts],reverse=True),'components':diagnostics}),encoding='utf-8')
        bpy.ops.wm.save_as_mainfile(filepath=str(root/'face-uv-overlap.blend'))
        raise ValueError("PLACEMENT_FACE_UV_OVERLAP")
    new_islands=components(mesh,dst)
    skin_islands=[g for g in new_islands if any(f not in dark for f in g)]
    if len(skin_islands)!=1 or any(folded(chart) for chart in new_islands):raise ValueError('PLACEMENT_FACE_UV_REVIEW_REQUIRED')
    # Keep material-driven appearance, bake only the image (not lights/factors).
    mat=bpy.data.materials.new('Source albedo');mat.use_nodes=True;nodes=mat.node_tree.nodes;nodes.clear();links=mat.node_tree.links
    uv=nodes.new('ShaderNodeUVMap');uv.uv_map='SourceUV';tex=nodes.new('ShaderNodeTexImage');tex.image=image;tex.interpolation='Linear';links.new(uv.outputs['UV'],tex.inputs['Vector'])
    em=nodes.new('ShaderNodeEmission');out=nodes.new('ShaderNodeOutputMaterial');links.new(tex.outputs['Color'],em.inputs['Color']);links.new(em.outputs[0],out.inputs['Surface'])
    target=bpy.data.images.new('Face rebaked albedo',width=4096,height=4096,alpha=False);target.colorspace_settings.name='sRGB'
    baked=nodes.new('ShaderNodeTexImage');baked.image=target;nodes.active=baked;mesh.materials.append(mat)
    mesh.uv_layers.active=dst;dst.active_render=True
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1;scene.render.bake.use_selected_to_active=False;scene.render.bake.margin=32;scene.render.bake.margin_type='EXTEND'
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.bake(type='EMIT');target.filepath_raw=str(root/'face-rebaked.png');target.file_format='PNG';target.save()
    patch={k:d[k] for k in ('schema','sourceHash','nodeName','mesh','primitive')};patch['uv']=[None]*len(triangles)
    for f in mesh.polygons:
        for i,l in enumerate(f.loop_indices):patch['uv'][face_ids[f.index]*3+corner_ids[f.index][i]]=[float(dst.data[l].uv.x),float(1-dst.data[l].uv.y)]
    patch['audit']={'overlappingTexels':overlap,'uvOverlapChecked':True,'oldIslands':len(original_islands),'newIslands':len(new_islands),'skinIslands':len(skin_islands),'skinIslandFaces':sorted([len(g) for g in skin_islands],reverse=True),'darkFaces':len(dark),'marginPixels':32,'resolution':4096,'domainGap':.085,'proxySplitEdges':repaired_edges,'proxySourceCornersPreserved':True,'localOverlapRepairFaces':len(repaired_faces),'localOverlapRepairPasses':repair_passes,'overlapHistory':overlap_history,'method':'continuous rear seams, connected facial surface + emission rebake'}
    patch['audit']['convexFallback']=convex_report
    patch['audit']['unwrapSeconds']=round(unwrap_seconds,3)
    patch['audit']['totalSeconds']=round(time.perf_counter()-started,3)
    patch['audit']['layout']='single-face-island/v1'
    patch['audit']['semanticRegions']={name:{'faces':len(fs),'islands':sum(any(region_by_source.get(face_ids[f])==name for f in group) for group in new_islands)} for name,fs in d.get('semanticRegions',{}).items()}
    patch['audit']['proxySplitVertexFans']=split_fans
    patch['audit']['skinSourceFaces']=sorted(face_ids[f] for f in skin)
    patch['audit']['method']='topological disk cut graph, continuous facial surface + emission rebake'
    patch['audit']['uvFoldChecked']=True
    (root/'face-uv-patch.json').write_text(json.dumps(patch),encoding='utf-8');print(json.dumps(patch['audit']),flush=True)
    # A diagnostic proxy only; not a replacement for the original head.
    bpy.ops.wm.save_as_mainfile(filepath=str(root/'face-uv-proxy.blend'))

if __name__=='__main__':run(json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf-8-sig')))

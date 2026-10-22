"""Portable segmentation/verification. Blender --background --disable-autoexec
--python segment_mesh.py -- analyze|preview_repair|prepare|build|verify|reconstruct job.json
Reviewed additive repairs precede IDs. Afterwards only labels/materials/UV change.
"""
import bpy, bmesh, json, sys, colorsys
import math
from contextlib import contextmanager
from pathlib import Path
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mesh_connectivity import stamp,restore_native_preview

PARTS=('head','body')
FACE_ID='workbench_face_id'
GROUP_ID='workbench_texture_group'
PALETTE=[(.82,.19,.31,1),(.10,.65,.76,1),(.79,.53,.13,1),(.37,.69,.30,1),(.58,.31,.81,1),(.92,.46,.22,1),(.30,.47,.90,1),(.80,.35,.65,1)]

def require(ok,code):
    if not ok: raise ValueError(code)

def read(file): return json.loads(Path(file).read_text(encoding='utf-8'))
def write(file,value): Path(file).write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')

def import_glb(file):
    before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(file))
    objects=[o for o in bpy.data.objects if o not in before]
    # New native-FBX previews split polygon corners only for faceted rendering.
    # Join only explicit original vertex IDs before hole/region analysis;
    # never infer connectivity by distance or alter legacy imported sources.
    for obj in objects:
        if obj.type=='MESH':
            native=next((a for a in obj.data.attributes if a.name.lower()=='_wb_face'),None)
            identity=next((a for a in obj.data.attributes if a.name.lower()=='_workbench_vertex'),None)
            if native and identity:
                restore_native_preview(obj)
    require(all(o.type in ('MESH','EMPTY') for o in objects),'SEG_UNSUPPORTED_OBJECT')
    return objects,[o for o in objects if o.type=='MESH']

def faces(meshes):
    result={}
    for o in meshes:
        ids=o.data.attributes.get(FACE_ID)
        require(ids is not None and ids.domain=='FACE','SEG_FACE_IDS_MISSING')
        for p in o.data.polygons:
            fid=ids.data[p.index].value
            require(fid not in result,'SEG_FACE_DUPLICATE')
            corners=[list(o.matrix_world@o.data.vertices[o.data.loops[i].vertex_index].co) for i in p.loop_indices]
            uv=[[list(layer.data[i].uv) for i in p.loop_indices] for layer in o.data.uv_layers]
            result[fid]={'object':o,'polygon':p,'corners':corners,'uv':uv,'material':p.material_index}
    return result

def load_sources(job):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts={}
    for part in PARTS:
        _,meshes=import_glb(job['sources'][part]);offset=0
        if job.get('cleanupPolicy'):
            from clean_duplicate_faces import clean,POLICY
            require(job['cleanupPolicy']==POLICY,'SEG_CLEANUP_POLICY')
            job.setdefault('cleanupReport',{})[part]=clean(meshes)
        parts[part]=meshes
    if job.get('meshRepairPolicy'):
        from mesh_hole_repair import POLICY,inspect,apply_operations,validate_review
        require(job['meshRepairPolicy']==POLICY,'SEG_MESH_REPAIR_REQUIRED')
        if job.get('_inspection'):
            job['meshInspection']=inspect(parts)
        else:
            repair=job.get('_meshRepair')
            if repair is None:
                require(Path(job['proposal']).is_file(),'SEG_MESH_REPAIR_REQUIRED')
                repair=read(job['proposal']).get('meshRepair')
            require(isinstance(repair,dict),'SEG_MESH_REPAIR_REQUIRED')
            before,after,added=apply_operations(parts,repair);job['meshInspection']=after
            if not job.get('_previewRepair'):
                job['meshRepairAudit']=validate_review(repair,before,after,job['directory'],check_evidence=not job.get('_reconstruction'))
            job['_meshRepair']=repair
    for part,meshes in parts.items():
        offset=0
        for i,o in enumerate(meshes):
            o['workbench_part']=part;o['workbench_source_object']=i
            ids=o.data.attributes.get(FACE_ID) or o.data.attributes.new(FACE_ID,'INT','FACE')
            for f in o.data.polygons:ids.data[f.index].value=offset+f.index
            offset+=len(o.data.polygons)
        require(offset>0,'SEG_EMPTY_MESH')
    bpy.context.view_layer.update()
    return parts

def components(meshes):
    results=[]
    for obj in meshes:
        # Face connectivity through shared edges. UV seam duplicates remain
        # distinct components; semantic texture groups may combine them.
        edges={};adj=[set() for p in obj.data.polygons]
        for p in obj.data.polygons:
            for edge in p.edge_keys:
                edge=tuple(sorted(edge));others=edges.setdefault(edge,[])
                for q in others:adj[p.index].add(q);adj[q].add(p.index)
                others.append(p.index)
        seen=set();ids=obj.data.attributes[FACE_ID]
        for p in obj.data.polygons:
            if p.index in seen:continue
            stack=[p.index];seen.add(p.index);region=[];polygon_indices=[]
            while stack:
                i=stack.pop();region.append(ids.data[i].value);polygon_indices.append(i)
                for j in adj[i]-seen:seen.add(j);stack.append(j)
            points=[];area=0
            for polygon_index in polygon_indices:
                face=obj.data.polygons[polygon_index]
                corners=[obj.matrix_world@obj.data.vertices[i].co for i in face.vertices];points.extend(corners)
                area+=sum((corners[i]-corners[0]).cross(corners[i+1]-corners[0]).length*.5 for i in range(1,len(corners)-1))
            results.append({'id':f"{obj['workbench_part']}-component-{len(results)}",'object':obj.name,'faces':region,
                            'bounds':[[min(v[i] for v in points) for i in range(3)],[max(v[i] for v in points) for i in range(3)]],'surfaceArea':area})
    return results

def spatial_audit(regions,height):
    """Conservative spatial clusters, not semantic labels. Near seams stay together.
    Use bounds rather than face counts so tessellation cannot define importance.
    Never move geometry to fill gaps or automatically charge for extra groups.
    """
    from math import sqrt
    gap=max(height*.035,1e-8);parent=list(range(len(regions)))
    def root(i):
        while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
        return i
    order=sorted(range(len(regions)),key=lambda i:regions[i]['bounds'][0][0])
    for k,i in enumerate(order):
        a=regions[i]['bounds']
        for j in order[k+1:]:
            b=regions[j]['bounds']
            if b[0][0]>a[1][0]+gap:break
            distance=sqrt(sum(max(0,a[0][axis]-b[1][axis],b[0][axis]-a[1][axis])**2 for axis in range(3)))
            if distance<=gap:parent[root(j)]=root(i)
    clusters={}
    for i,r in enumerate(regions):
        c=clusters.setdefault(root(i),{'faces':[],'surfaceArea':0,'bounds':[list(r['bounds'][0]),list(r['bounds'][1])]})
        c['faces'].extend(r['faces']);c['surfaceArea']+=r['surfaceArea']
        c['bounds']=[[min(c['bounds'][0][a],r['bounds'][0][a]) for a in range(3)],[max(c['bounds'][1][a],r['bounds'][1][a]) for a in range(3)]]
    total=sum(c['surfaceArea'] for c in clusters.values())
    for c in clusters.values():c['areaFraction']=c['surfaceArea']/total if total else 0
    # Ignore only negligible disconnected debris, not a small wrist cuff.
    significant=[c for c in clusters.values() if c['areaFraction']>=.002]
    return {'version':1,'gapThreshold':gap,'requiresReview':len(significant)>1,'clusters':list(clusters.values())}

def validate_groups(proposal,counts):
    groups=proposal.get('groups',[]);require(0<len(groups)<=64,'SEG_GROUPS_INVALID')
    names=set();covered={p:set() for p in PARTS}
    for g in groups:
        gid=g.get('id','');require(isinstance(gid,str) and 0<len(gid)<=64 and all(c in 'abcdefghijklmnopqrstuvwxyz0123456789_-' for c in gid),'SEG_GROUP_ID_INVALID')
        require(gid not in names and g.get('part') in PARTS,'SEG_GROUPS_INVALID');names.add(gid)
        require(isinstance(g.get('name'),str) and 0<len(g['name'])<=120 and isinstance(g.get('category'),str),'SEG_GROUPS_INVALID')
        require(isinstance(g.get('faces'),list) and len(g['faces'])>0,'SEG_EMPTY_GROUP')
        for fid in g['faces']:
            require(type(fid)==int and 0<=fid<counts[g['part']] and fid not in covered[g['part']],'SEG_FACE_DUPLICATE_OR_INVALID')
            covered[g['part']].add(fid)
    require(all(len(covered[p])==counts[p] for p in PARTS),'SEG_FACE_COVERAGE')
    return groups

def export(file,objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
        if o.type=='MESH':stamp(o.data)
    bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',export_attributes=True,use_selection=True,export_animations=False,export_cameras=False,export_lights=False)

def subset(source,ids,name):
    o=source.copy();o.data=source.data.copy();o.name=name;bpy.context.scene.collection.objects.link(o)
    # Keep world coordinates even when the source has an imported parent.
    world=source.matrix_world.copy();o.parent=None;o.matrix_world=world
    bm=bmesh.new();bm.from_mesh(o.data);layer=bm.faces.layers.int[FACE_ID]
    bmesh.ops.delete(bm,geom=[f for f in bm.faces if f[layer] not in ids],context='FACES')
    bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
    bm.to_mesh(o.data);bm.free();return o

def color_material(i):
    color=PALETTE[i] if i<len(PALETTE) else (*colorsys.hsv_to_rgb((i*.61803398875)%1,.67,.85),1)
    m=bpy.data.materials.new('ID '+str(i));m.diffuse_color=color;m.use_nodes=True
    m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=m.diffuse_color
    m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.85
    return m

def render_views(objects,folder,prefix,views=('front','left','right','back')):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    visibility={o:o.hide_render for o in bpy.context.scene.objects if o.type=='MESH'}
    for o in visibility:o.hide_render=o not in objects
    pts=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
    lo=Vector([min(p[i] for p in pts) for i in range(3)]);hi=Vector([max(p[i] for p in pts) for i in range(3)]);center=(lo+hi)*.5;size=max(*(hi-lo),.001)
    scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=768;scene.render.resolution_y=768;scene.render.resolution_percentage=100;scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.world=scene.world or bpy.data.worlds.new('Review world');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
    camera_data=bpy.data.cameras.new('Review camera');camera=bpy.data.objects.new('Review camera',camera_data);scene.collection.objects.link(camera);scene.camera=camera;camera_data.type='ORTHO';camera_data.ortho_scale=size*1.15
    lamps=[]
    for name,pos,power in [('Key',(2,-3,4),900),('Fill',(-3,-2,2),600)]:
        # Scale lamp power with area: a tiny face must not receive the same
        # absolute watts as the whole character at a fraction of the distance.
        data=bpy.data.lights.new(name,'AREA');data.energy=power*size*size*.12;data.shape='DISK';data.size=size*3
        lamp=bpy.data.objects.new(name,data);scene.collection.objects.link(lamp);lamp.location=center+Vector(pos)*size;lamp.rotation_euler=(center-lamp.location).to_track_quat('-Z','Y').to_euler();lamps.append(lamp)
    try:
        for view in views:
            # Z up, character faces -Y: anatomical right is -X. Keep this
            # convention in analysis, repair review and texture guides alike;
            # changing camera sides must never mirror the model or its marks.
            direction={'front':(0,-1,0),'back':(0,1,0),'right':(-1,0,0),'left':(1,0,0),'top':(0,-.01,1),'threequarter-left':(1,-1,.2),'threequarter-right':(-1,-1,.2)}[view]
            camera.location=center+Vector(direction)*size*3;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(folder/(prefix+'_'+view+'.png'));bpy.ops.render.render(write_still=True)
    finally:
        scene.camera=None
        for o in [camera,*lamps]:bpy.data.objects.remove(o,do_unlink=True)
        for o,value in visibility.items():o.hide_render=value

def analyze(job):
    job['_inspection']=not bool(job.get('_meshRepair'))
    parts=load_sources(job);out=Path(job['directory']);out.mkdir(parents=True,exist_ok=True)
    report={'schema':'workbench-segmentation-analysis/v1','parts':{},'groups':[],'pending':[{'reason':'Semantic classification and visual review required'}]}
    for part,meshes in parts.items():
        fs=faces(meshes);report['parts'][part]={'faces':len(fs),'components':components(meshes),'objects':[{'name':o.name,'vertices':len(o.data.vertices),'materials':[m.name if m else None for m in o.data.materials]} for o in meshes]}
        report['groups'].append({'id':part+'-unclassified','part':part,'name':'Unclassified '+part,'category':'unclassified','faces':list(fs),'components':[],'pending':True,'referencesReviewed':False})
        if job.get('render',True):render_views(meshes,out/'analysis-preview',part)
    report['cleanup']=job.get('cleanupReport')
    proposal={'schema':'workbench-segmentation-result/v1','cleanupPolicy':job.get('cleanupPolicy'),'groups':report['groups'],'pending':report['pending'],'warnings':[],'visualReview':None}
    if job.get('meshRepairPolicy'):
        from mesh_hole_repair import template
        write(out/'mesh-inspection.json',job['meshInspection'])
        if job.get('_meshRepair'):proposal['meshRepair']=job['_meshRepair']
        else:
            # Never silently overwrite a partially authored repair on re-analysis.
            file=out/'mesh-repair.json'
            if not file.exists():write(file,template(job['meshInspection']))
        report['meshRepair']=job.get('meshRepairAudit')
    write(out/'analysis.json',report);write(out/'proposal.json',proposal)
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'),compress=False)

def preview_repair(job):
    job['_inspection']=False;job['_reconstruction']=False
    job['_meshRepair']=read(Path(job['directory'])/'mesh-repair.json');job['_previewRepair']=True
    parts=load_sources(job);out=Path(job['directory']);write(out/'mesh-inspection-after.json',job['meshInspection'])
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'repair-preview.blend'),compress=False)
    if job.get('render',True):
        for part,meshes in parts.items():render_views(meshes,out/'review','repair-'+part,('front','left','right','back','top','threequarter-left','threequarter-right'))

def prepare(job):
    job['_reconstruction']=False;job.pop('_previewRepair',None)
    job['_meshRepair']=read(Path(job['directory'])/'mesh-repair.json')
    analyze(job)

def build(job):
    job['_inspection']=False;job.pop('_meshRepair',None);job.pop('_previewRepair',None)
    job['_reconstruction']=False
    parts=load_sources(job);out=Path(job['directory']);out.mkdir(parents=True,exist_ok=True)
    proposal=read(job['proposal']);counts={p:len(faces(ms)) for p,ms in parts.items()};groups=validate_groups(proposal,counts)
    found={p:components(ms) for p,ms in parts.items()}
    for g in groups:
        ids=set(g['faces'])
        g['components']=[c['id'] for c in found[g['part']] if ids.intersection(c['faces'])]
    for part,meshes in parts.items():
        assignment={fid:i for i,g in enumerate(groups) if g['part']==part for fid in g['faces']}
        for o in meshes:
            labels=o.data.attributes.get(GROUP_ID) or o.data.attributes.new(GROUP_ID,'INT','FACE')
            for face in o.data.polygons:labels.data[face.index].value=assignment[o.data.attributes[FACE_ID].data[face.index].value]
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'segmented.blend'),compress=False)
    # Reopen the actual file; exports derive from this validated saved geometry.
    bpy.ops.wm.open_mainfile(filepath=str(out/'segmented.blend'),load_ui=False,use_scripts=False)
    parts={p:[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('workbench_part')==p] for p in PARTS}
    assets=[];maps={}
    body_points=[o.matrix_world@v.co for o in parts['body'] for v in o.data.vertices]
    body_height=max(v.z for v in body_points)-min(v.z for v in body_points)
    for i,g in enumerate(groups):
        group_objs=[]
        for source in parts[g['part']]:
            selected=set(g['faces'])&set(faces([source]))
            if selected:group_objs.append(subset(source,selected,g['id']))
        for o in group_objs:o['workbench_texture_group']=g['id']
        if g['part']=='body':g['spatialAudit']=spatial_audit(components(group_objs),body_height)
        export(out/(g['id']+'.glb'),group_objs)
        maps[g['id']]=[{'faceId':fid,'corners':f['corners']} for fid,f in faces(group_objs).items()]
        if job.get('render',True):render_views(group_objs,out,g['id'],('front','back'))
        idmat=color_material(i)
        for o in group_objs:
            o.data.materials.clear();o.data.materials.append(idmat)
            for face in o.data.polygons:face.material_index=0
        assets.extend(group_objs)
    for part in PARTS:export(out/(part+'-ids.glb'),[o for o in assets if o.get('workbench_part')==part])
    write(out/'correspondence.json',maps)
    write(out/'validated.json',{'schema':'workbench-segmentation-validation/v1','cleanup':job.get('cleanupReport'),'meshRepair':job.get('meshRepairAudit'),'counts':counts,'geometryPreserved':True,'savedAndReopened':True,'groups':groups,'pending':proposal.get('pending',[]),'warnings':proposal.get('warnings',[]),'visualReview':proposal.get('visualReview')})

def verify(job):
    job['_inspection']=False;job.pop('_meshRepair',None);job.pop('_previewRepair',None)
    job['_reconstruction']=False
    originals=load_sources(job);expected={p:faces(m) for p,m in originals.items()}
    transforms={(p,o['workbench_source_object']):[list(row) for row in o.matrix_world] for p,ms in originals.items() for o in ms}
    # Store numeric data, not Blender references, across opening a new file.
    expected={p:{fid:{k:f[k] for k in ('corners','uv','material')} for fid,f in fs.items()} for p,fs in expected.items()}
    groups=validate_groups(read(job['proposal']),{p:len(fs) for p,fs in expected.items()})
    bpy.ops.wm.open_mainfile(filepath=job['inputBlend'],load_ui=False,use_scripts=False)
    require(all(o.type in ('MESH','EMPTY') for o in bpy.context.scene.objects),'SEG_UNSUPPORTED_OBJECT')
    require(all(o.get('workbench_part') in PARTS for o in bpy.context.scene.objects if o.type=='MESH'),'SEG_UNEXPECTED_MESH')
    for part in PARTS:
        meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('workbench_part')==part]
        require(all(not o.modifiers and not o.data.shape_keys for o in meshes),'SEG_GEOMETRY_CHANGED')
        require(len(meshes)==sum(1 for p,i in transforms if p==part),'SEG_GEOMETRY_CHANGED')
        for o in meshes:
            key=(part,o.get('workbench_source_object'));require(key in transforms,'SEG_GEOMETRY_CHANGED')
            require(all(abs(a-b)<1e-6 for row,wanted in zip(o.matrix_world,transforms[key]) for a,b in zip(row,wanted)),'SEG_TRANSFORM_CHANGED')
        actual=faces(meshes);require(set(actual)==set(expected[part]),'SEG_FACE_COVERAGE')
        labels={fid:i for i,g in enumerate(groups) if g['part']==part for fid in g['faces']}
        for fid,f in actual.items():
            wanted=expected[part][fid]
            require(len(f['corners'])==len(wanted['corners']),'SEG_GEOMETRY_CHANGED')
            require(all((Vector(a)-Vector(b)).length<1e-6 for a,b in zip(f['corners'],wanted['corners'])),'SEG_GEOMETRY_CHANGED')
            require(f['uv']==wanted['uv'] and f['material']==wanted['material'],'SEG_BACKUP_UV_CHANGED')
            attr=f['object'].data.attributes.get(GROUP_ID)
            require(attr is not None and attr.data[f['polygon'].index].value==labels[fid],'SEG_LABEL_MISMATCH')
    # Derive every display/export from original sources + checked labels, not
    # arbitrary assets included by the external agent.
    build(job)

def geometric_key(corners):
    return tuple(sorted(tuple(round(v,6) for v in c) for c in corners))

def triangle_correspondence(targets,returned):
    """Match all triangles after an optional export-axis rotation and uniform scale.
    Never moves target geometry. UV seam vertex splits and reorderings are allowed;
    changed geometry, reflections, nonuniform scale and ambiguous symmetry are not.
    """
    import itertools
    from mathutils import Matrix
    from mathutils.kdtree import KDTree
    def rows(objects, allow_coincident=False):
        result=[];seen=set()
        for o in objects:
            for p in o.data.polygons:
                require(len(p.loop_indices)==3,'SEG_TRANSFER_TRIANGLES_REQUIRED')
                corners=[o.matrix_world@o.data.vertices[o.data.loops[i].vertex_index].co for i in p.loop_indices]
                key=tuple(sorted(tuple(c) for c in corners));require(allow_coincident or key not in seen,'SEG_TRANSFER_AMBIGUOUS');seen.add(key)
                result.append((o,p,corners))
        return result
    source,incoming=rows(targets,allow_coincident=True),rows(returned)
    require(len(source)>0 and len(incoming)>0,'SEG_TRANSFER_TOPOLOGY_CHANGED')
    positions=list(dict.fromkeys(tuple(c) for _,_,cs in source for c in cs));ids={c:i for i,c in enumerate(positions)}
    tree=KDTree(len(positions))
    for i,c in enumerate(positions):tree.insert(c,i)
    tree.balance()
    def bounds(points):
        lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
        return (lo+hi)*.5,hi-lo
    # Studio's normalized export quantizes coordinates. Permit at most 0.005%
    # of the group diagonal, still requiring a unique match for every triangle.
    center,size=bounds(positions);tolerance=max(size.length*5e-5,1e-8)
    a={}
    for o,p,cs in source:
        indices=tuple(ids[tuple(c)] for c in cs);key=tuple(sorted(indices))
        require(len(set(indices))==3,'SEG_TRANSFER_AMBIGUOUS')
        # Studio can deduplicate exactly coincident source triangles. Preserve
        # every original face and give its coincident copies the same corner UVs.
        a.setdefault(key,[]).append((o,p,indices))
    require(len(a)==len(incoming),'SEG_TRANSFER_TOPOLOGY_CHANGED')
    raw=list(dict.fromkeys(tuple(c) for _,_,cs in incoming for c in cs))
    def match(matrix,scale,offset):
        mapped={};max_error=0
        for c in raw:
            q=(matrix@Vector(c))*scale+offset
            nearby=sorted(tree.find_range(q,tolerance),key=lambda item:item[2])
            if not nearby:return None
            _,index,distance=nearby[0]
            if len(nearby)>1 and nearby[1][2]-distance<max(tolerance*1e-4,1e-10):return None
            mapped[c]=index;max_error=max(max_error,distance)
        b={}
        for o,p,cs in incoming:
            indices=tuple(mapped[tuple(c)] for c in cs);key=tuple(sorted(indices))
            if key not in a or key in b:return None
            b[key]=(o,p,indices)
        if set(a)!=set(b):return None
        return b,{'coincidentSourceFaces':len(source)-len(a),'scale':scale,'rotation':[list(r) for r in matrix],'translation':list(offset),'maximumDeviation':max_error,'tolerance':tolerance}
    identity=match(Matrix.Identity(3),1,Vector((0,0,0)))
    if identity:return a,*identity
    valid=[]
    for permutation in itertools.permutations(range(3)):
        for signs in itertools.product((-1,1),repeat=3):
            matrix=Matrix([[signs[i] if j==permutation[i] else 0 for j in range(3)] for i in range(3)])
            if matrix.determinant()<0:continue
            other_center,other_size=bounds([matrix@Vector(c) for c in raw])
            axis=max(range(3),key=lambda i:size[i])
            if other_size[axis]<=0:continue
            scale=size[axis]/other_size[axis]
            if any(abs(other_size[i]*scale-size[i])>tolerance for i in range(3)):continue
            found=match(matrix,scale,center-other_center*scale)
            if found:valid.append(found)
    require(len(valid)>0,'SEG_TRANSFER_TOPOLOGY_CHANGED')
    require(len(valid)==1,'SEG_TRANSFER_ALIGNMENT_AMBIGUOUS')
    return a,*valid[0]

def transfer_uv(targets,returned):
    """Unique triangle correspondence independent of vertex/face order.
    Face-corner matching preserves UV seams. Coincident faces are ambiguous.
    """
    a,b,alignment=triangle_correspondence(targets,returned)
    materials=[];by_material={}
    for o in returned:
        for m in o.data.materials:
            if m not in by_material:by_material[m]=len(materials);materials.append(m)
    assignments=[]
    # A single exported mesh must have the same UV schema across its materials.
    # Otherwise splitting is required; do not leave some face corners unassigned.
    schemas={tuple(layer.name for layer in o.data.uv_layers) for o in returned}
    require(len(schemas)==1,'SEG_TRANSFER_UV_SCHEMA_MISMATCH')
    active_names={o.data.uv_layers.active.name for o in returned if o.data.uv_layers.active}
    require(len(active_names)==1,'SEG_TRANSFER_UV_MISSING')
    for key,coincident in a.items():
        obj,p,new_corners=b[key];require(len(obj.data.uv_layers)>0,'SEG_TRANSFER_UV_MISSING')
        for target,face,corners in coincident:
            indices=[]
            for corner in corners:
                matches=[i for i,new in enumerate(new_corners) if corner==new]
                require(len(matches)==1,'SEG_TRANSFER_AMBIGUOUS');indices.append(matches[0])
            assignments.append((target,face,obj,p,indices))
    for target in targets:
        target.data.materials.clear()
        for m in materials:target.data.materials.append(m)
        # Original UVs remain in the source GLBs and segmented.blend backup.
        # Only the copied reconstruction uses the returned UV layout.
        for layer in list(target.data.uv_layers):target.data.uv_layers.remove(layer)
        for name in next(iter(schemas)):target.data.uv_layers.new(name=name)
        target.data.uv_layers.active=target.data.uv_layers[next(iter(active_names))]
        target.data.uv_layers.active.active_render=True
    for target,face,obj,p,indices in assignments:
        for layer in obj.data.uv_layers:
            dest=target.data.uv_layers.get(layer.name) or target.data.uv_layers.new(name=layer.name)
            for loop,index in zip(face.loop_indices,indices):dest.data[loop].uv=layer.data[list(p.loop_indices)[index]].uv
        require(p.material_index<len(obj.data.materials) and obj.data.materials[p.material_index] is not None,'SEG_TRANSFER_MATERIAL_MISSING')
        face.material_index=by_material[obj.data.materials[p.material_index]]
    for target in targets:target['workbench_uv_return_alignment']=json.dumps(alignment)
    return len(assignments)

@contextmanager
def smooth_reference_preview(objects):
    """Temporary shading only; never export or mutate approved mesh data.

    glTF splits corners at UV/normal seams. Explicit source vertex identities
    allow their shading normals to agree without welding any geometry. For
    legacy meshes without those identities use actual vertex connectivity.
    """
    originals=[]
    try:
        for obj in objects:
            source=obj.data;mesh=source.copy();originals.append((obj,source,mesh));obj.data=mesh
            attr=next((a for a in mesh.attributes if a.name.lower()=='_workbench_vertex'),None)
            keys=[v.index for v in mesh.vertices]
            if attr:
                require(attr.domain=='POINT' and attr.data_type=='FLOAT','SEG_GUIDE_VERTEX_IDENTITY_INVALID')
                values=[a.value for a in attr.data]
                require(all(math.isfinite(v) and v>=0 and v==round(v) for v in values),'SEG_GUIDE_VERTEX_IDENTITY_INVALID')
                # Older additive repairs may have a default ID shared by
                # several new vertices. For shading only, an ID never joins
                # different positions. Geometry and stored IDs stay untouched.
                keys=[(int(value),tuple(vertex.co)) for vertex,value in zip(mesh.vertices,values)]
            normals={key:Vector((0,0,0)) for key in keys}
            for polygon in mesh.polygons:
                polygon.use_smooth=True
                vertices=list(polygon.vertices)
                for i,vi in enumerate(vertices):
                    a=mesh.vertices[vertices[i-1]].co-mesh.vertices[vi].co
                    b=mesh.vertices[vertices[(i+1)%len(vertices)]].co-mesh.vertices[vi].co
                    angle=math.atan2(a.cross(b).length,a.dot(b))
                    normals[keys[vi]]+=polygon.normal*angle
            for edge in mesh.edges:edge.use_edge_sharp=False
            mesh.normals_split_custom_set_from_vertices([normals[key].normalized() for key in keys])
            mesh.update()
        yield
    finally:
        for obj,source,mesh in originals:
            obj.data=source
            bpy.data.meshes.remove(mesh)

def guides(job):
    for group in job['groups']:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        _, meshes = import_glb(group['file'])
        # A faceted candidate is useful for topology inspection, but its
        # polygon lighting must not become painted Base Color in ImageGen.
        with smooth_reference_preview(meshes):
            render_views(meshes, job['directory'], group['id'], ('front', 'right', 'back'))

def reconstruct(job):
    job['_inspection']=False;job.pop('_meshRepair',None);job.pop('_previewRepair',None)
    job['_reconstruction']=True
    parts=load_sources(job);proposal=read(job['proposal']);groups=validate_groups(proposal,{p:len(faces(m)) for p,m in parts.items()})
    def geometry(objects):
        return sorted(tuple(sorted(tuple(o.matrix_world@o.data.vertices[i].co) for i in p.vertices)) for o in objects for p in o.data.polygons)
    original={part:geometry(objects) for part,objects in parts.items()}
    assembled=[];report=[]
    for g in groups:
        selected=[]
        for source in parts[g['part']]:
            ids=set(g['faces'])&set(faces([source]))
            if ids:selected.append(subset(source,ids,g['id']))
        imported_objects,returned=import_glb(job['results'][g['id']])
        count=transfer_uv(selected,returned)
        for o in imported_objects:bpy.data.objects.remove(o,do_unlink=True)
        for o in selected:o['workbench_texture_group']=g['id']
        assembled.extend(selected);report.append({'groupId':g['id'],'facesTransferred':count,'returnAlignment':json.loads(selected[0]['workbench_uv_return_alignment'])})
    for meshes in parts.values():
        for o in meshes:bpy.data.objects.remove(o,do_unlink=True)
    out=Path(job['directory']);out.mkdir(parents=True,exist_ok=True)
    bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(out/'textured.blend'),compress=False)
    bpy.ops.wm.open_mainfile(filepath=str(out/'textured.blend'),load_ui=False,use_scripts=False)
    for part in PARTS:
        objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('workbench_part')==part]
        require(geometry(objects)==original[part],'SEG_GEOMETRY_CHANGED')
        export(out/(part+'-textured.glb'),objects)
    write(out/'reconstruction.json',{'geometryPreserved':True,'cornerUvTransfer':True,'uvPolicy':'preserve-tripo/v1','savedAndReopened':True,'reviewRequired':True,'meshRepair':job.get('meshRepairAudit'),'groups':report})

def baseline(job):
    """Validate a pretexture copy: rigid head placement and bounded neck edits only."""
    original=load_sources(job);saved={}
    for part,objects in original.items():
        saved[part]=[{'local':[v.co.copy() for v in o.data.vertices],
                      'world':[o.matrix_world@v.co for v in o.data.vertices],
                      'faces':[tuple(p.vertices) for p in o.data.polygons]} for o in objects]
    body_points=[v for o in saved['body'] for v in o['world']]
    lo=Vector([min(v[i] for v in body_points) for i in range(3)])
    hi=Vector([max(v[i] for v in body_points) for i in range(3)])
    height=hi.z-lo.z;center=(hi+lo)/2
    bpy.ops.wm.open_mainfile(filepath=job['inputBlend'],load_ui=False,use_scripts=False)
    require(not any(o.type=='ARMATURE' for o in bpy.data.objects),'SEG_BASELINE_INVALID')
    parts={p:[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('workbench_part')==p] for p in PARTS}
    require(sum(map(len,parts.values()))==sum(o.type=='MESH' for o in bpy.context.scene.objects),'SEG_BASELINE_INVALID')
    changed=0;max_move=0
    for part,objects in parts.items():
        require(len(objects)==len(saved[part]),'SEG_BASELINE_INVALID')
        for o,source in zip(objects,saved[part]):
            require(not o.modifiers and not o.animation_data and not o.data.shape_keys,'SEG_BASELINE_INVALID')
            require(len(o.data.vertices)==len(source['local']) and [tuple(p.vertices) for p in o.data.polygons]==source['faces'],'SEG_GEOMETRY_CHANGED')
            require(all(__import__('math').isfinite(x) for v in o.data.vertices for x in v.co),'SEG_BASELINE_INVALID')
            if part=='head':
                require(all((v.co-source['local'][i]).length<1e-7 for i,v in enumerate(o.data.vertices)),'SEG_BASELINE_HEAD_CHANGED')
                matrix=o.matrix_world.to_3x3();lengths=[matrix.col[i].length for i in range(3)]
                require(min(lengths)>0 and max(lengths)-min(lengths)<1e-5 and matrix.determinant()>0,'SEG_BASELINE_INVALID')
                require(all(abs(matrix.col[i].dot(matrix.col[j]))<1e-5 for i in range(3) for j in range(i)),'SEG_BASELINE_INVALID')
            else:
                for i,v in enumerate(o.data.vertices):
                    old=source['world'][i];new=o.matrix_world@v.co;delta=(new-old).length
                    if delta<1e-7:continue
                    require(old.z>hi.z-.10*height and abs(old.x-center.x)<.12*height and abs(old.y-center.y)<.18*height and delta<.10*height,'SEG_BASELINE_OUTSIDE_NECK')
                    changed+=1;max_move=max(max_move,delta)
    out=Path(job['directory'])
    for part,objects in parts.items():export(out/(part+'-baseline.glb'),objects)
    write(out/'baseline-validation.json',{'topologyPreserved':True,'outsideNeckPreserved':True,'headLocalShapePreserved':True,'independentParts':True,'neckVerticesChanged':changed,'maximumNeckDisplacement':max_move,'reviewRequired':True})

if __name__=='__main__':
    mode,file=sys.argv[sys.argv.index('--')+1:];job=read(file);root=Path(file).resolve().parent
    for key in ('sources','results'):
        if key in job:job[key]={k:str((root/v).resolve()) for k,v in job[key].items()}
    for key in ('directory','proposal','inputBlend','sourceBlend'):
        if key in job:job[key]=str((root/job[key]).resolve())
    if mode=='correct_assembly':
        sys.path.insert(0,str(Path(__file__).resolve().parent))
        from correct_assembly import run
        run(job)
    elif mode in ('analyze','preview_repair','prepare','build','verify','guides','reconstruct','baseline'):
        globals()[mode](job)
    else:
        require(False,'SEG_INVALID_MODE')

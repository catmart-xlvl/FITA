"""Reviewed, additive repairs before face IDs. Never infer which holes to fill.
The same declarative patch is replayed by build, verification and reconstruction.
"""
import bmesh, hashlib, json, math, re
from pathlib import Path
from mathutils import Vector

POLICY='reviewed-hole-repair/v1'
VIEWS={'head':('front','left','right','back','top','interior'),'body':('front','left','right','back')}
REGIONS={'head':('roots','crown','nape','face'),'body':('body',)}

def require(ok,code='SEG_MESH_REPAIR_INVALID'):
    if not ok:raise ValueError(code)

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def inspect(parts):
    """Exact positional edge incidence ignores UV splits without welding vertices.
    Reports all boundary components, including branching ones. Visual gaps between
    closed locks require the mandatory visual review, not a topology guess.
    """
    boundaries=[];objects=[];source=[]
    for part,meshes in parts.items():
        for index,obj in enumerate(meshes):
            mesh=obj.data;positions=[tuple(v.co) for v in mesh.vertices];edges={};representative={}
            for i,p in enumerate(positions):representative.setdefault(p,i)
            for face in mesh.polygons:
                points=[positions[v] for v in face.vertices]
                for a,b in zip(points,points[1:]+points[:1]):
                    if a!=b:edges.setdefault(tuple(sorted((a,b))),[]).append(face.index)
            open_edges={e for e,uses in edges.items() if len(uses)==1};adj={}
            for a,b in open_edges:adj.setdefault(a,set()).add(b);adj.setdefault(b,set()).add(a)
            remaining=set(adj)
            while remaining:
                seed=min(remaining);stack=[seed];region={seed};remaining.remove(seed)
                while stack:
                    for p in adj[stack.pop()]-region:
                        region.add(p);remaining.discard(p);stack.append(p)
                boundary_edges=sorted(e for p in region for q in adj[p] if p<q for e in [(p,q)])
                key=digest([part,index,boundary_edges])
                boundaries.append({'id':key,'part':part,'object':index,'edges':[[representative[a],representative[b]] for a,b in boundary_edges],
                                   'closedLoop':all(len(adj[p])==2 for p in region)})
            objects.append({'part':part,'object':index,'name':obj.name,'vertices':len(positions),'faces':len(mesh.polygons),
                            'nonManifoldEdges':sum(len(uses)>2 for uses in edges.values())})
            source.append([part,index,[list(row) for row in obj.matrix_world],positions,[list(p.vertices) for p in mesh.polygons],
                           [p.material_index for p in mesh.polygons],[[tuple(v.uv) for v in layer.data] for layer in mesh.uv_layers]])
    return {'policy':POLICY,'sourceFingerprint':digest(source),'objects':objects,'boundaries':boundaries,
            'note':'Boundary detection is not a visual hair/scalp coverage test.'}

def template(inspection):
    return {'policy':POLICY,'sourceFingerprint':inspection['sourceFingerprint'],'operations':[],
            'decisions':{'before':[{'id':b['id'],'status':'pending','reason':''} for b in inspection['boundaries']],'after':[]},
            'visualReview':{part:{'findings':'','regions':{r:{'status':'pending','reason':''} for r in REGIONS[part]},
                                  'views':{v:{'before':None,'after':None} for v in VIEWS[part]}} for part in VIEWS},
            'pending':['Inspect and repair unintended holes before assigning face IDs.']}

def apply_operations(parts,repair):
    require(repair.get('policy')==POLICY,'SEG_MESH_REPAIR_REQUIRED')
    before=inspect(parts);require(repair.get('sourceFingerprint')==before['sourceFingerprint'],'SEG_MESH_REPAIR_STALE')
    ops=repair.get('operations');require(isinstance(ops,list) and len(ops)<=256)
    ids=set();added=0;original_bounds={};budgets={}
    for part,meshes in parts.items():
        for index,obj in enumerate(meshes):
            points=[v.co for v in obj.data.vertices]
            lo=Vector([min(p[a] for p in points) for a in range(3)]);hi=Vector([max(p[a] for p in points) for a in range(3)])
            original_bounds[(part,index)]=(lo,hi,(hi-lo).length)
            budgets[(part,index)]=min(20000,max(256,2*len(obj.data.polygons)))
    for op in ops:
        require(isinstance(op,dict) and isinstance(op.get('id'),str) and re.fullmatch(r'[a-z0-9_-]{1,64}',op['id']) and op['id'] not in ids)
        ids.add(op['id']);part=op.get('part');index=op.get('object');require(part in parts and type(index)==int and 0<=index<len(parts[part]))
        require(isinstance(op.get('reason'),str) and op['reason'].strip() and op.get('region') in REGIONS[part])
        obj=parts[part][index];mesh=obj.data;require(not obj.modifiers and not mesh.shape_keys)
        vertices=op.get('vertices',[]);rows=op.get('faces');require(isinstance(vertices,list) and isinstance(rows,list) and 0<len(rows)<=20000 and len(vertices)<=10000)
        budgets[(part,index)]-=len(rows);require(budgets[(part,index)]>=0)
        old_positions=[tuple(v.co) for v in mesh.vertices];old_faces=[tuple(p.vertices) for p in mesh.polygons]
        old_uv=[[[tuple(layer.data[i].uv) for i in p.loop_indices] for p in mesh.polygons] for layer in mesh.uv_layers]
        old_material=[p.material_index for p in mesh.polygons];old_smooth=[p.use_smooth for p in mesh.polygons]
        old_normals=[tuple(n.vector) for n in mesh.corner_normals] if mesh.has_custom_normals else None
        lo,hi,diagonal=original_bounds[(part,index)]
        require(diagonal>0)
        for p in vertices:
            require(isinstance(p,list) and len(p)==3 and all(type(x) in (int,float) and math.isfinite(x) for x in p))
            require(all(lo[a]-diagonal*.05<=p[a]<=hi[a]+diagonal*.05 for a in range(3)),'SEG_MESH_REPAIR_OUTSIDE')
        positions=old_positions+[tuple(p) for p in vertices];seen={tuple(sorted(old_positions[v] for v in f)) for f in old_faces};edge_uses={}
        for f in old_faces:
            points=[old_positions[v] for v in f]
            for a,b in zip(points,points[1:]+points[:1]):edge_uses.setdefault(tuple(sorted((a,b))),[]).append((a,b))
        for row in rows:
            vs=row.get('vertices');material=row.get('material');uv=row.get('uv')
            require(isinstance(vs,list) and len(vs)==3 and all(type(v)==int and 0<=v<len(positions) for v in vs) and len(set(vs))==3)
            require(type(material)==int and 0<=material<max(1,len(mesh.materials)))
            require(isinstance(uv,dict) and set(uv)==set(layer.name for layer in mesh.uv_layers))
            for coords in uv.values():require(isinstance(coords,list) and len(coords)==3 and all(isinstance(p,list) and len(p)==2 and all(type(x) in (int,float) and math.isfinite(x) for x in p) for p in coords))
            points=[Vector(positions[v]) for v in vs];require((points[1]-points[0]).cross(points[2]-points[0]).length>diagonal*diagonal*1e-12)
            key=tuple(sorted(tuple(p) for p in points));require(key not in seen,'SEG_MESH_REPAIR_DUPLICATE');seen.add(key)
            coords=[tuple(p) for p in points]
            for a,b in zip(coords,coords[1:]+coords[:1]):
                uses=edge_uses.setdefault(tuple(sorted((a,b))),[])
                require(len(uses)<2 and (not uses or uses[0]==(b,a)),'SEG_MESH_REPAIR_WINDING');uses.append((a,b))
        require(set(range(len(old_positions),len(positions)))<=set(v for row in rows for v in row['vertices']))
        bm=bmesh.new()
        try:
            bm.from_mesh(mesh);bm.verts.ensure_lookup_table();bv=list(bm.verts)
            for p in vertices:bv.append(bm.verts.new(p))
            for row in rows:
                face=bm.faces.new([bv[i] for i in row['vertices']]);face.material_index=row['material'];face.smooth=True
                for name,coords in row['uv'].items():
                    layer=bm.loops.layers.uv[name]
                    for loop,coord in zip(face.loops,coords):loop[layer].uv=coord
            bm.to_mesh(mesh);mesh.update()
        finally:bm.free()
        # Preserve all existing corners, seams and shading. Do not accept arbitrary
        # edits embedded in the supplied Blend; verify later against this replay.
        require([tuple(v.co) for v in mesh.vertices[:len(old_positions)]]==old_positions,'SEG_GEOMETRY_CHANGED')
        require([tuple(p.vertices) for p in mesh.polygons[:len(old_faces)]]==old_faces,'SEG_GEOMETRY_CHANGED')
        require([p.material_index for p in mesh.polygons[:len(old_faces)]]==old_material,'SEG_BACKUP_UV_CHANGED')
        for layer,expected in zip(mesh.uv_layers,old_uv):require([[tuple(layer.data[i].uv) for i in p.loop_indices] for p in mesh.polygons[:len(old_faces)]]==expected,'SEG_BACKUP_UV_CHANGED')
        for p,smooth in zip(mesh.polygons,old_smooth):p.use_smooth=smooth
        if old_normals is not None:mesh.normals_split_custom_set(old_normals+[(0,0,0)]*(len(mesh.loops)-len(old_normals)))
        added+=len(rows)
    return before,inspect(parts),added

def validate_review(repair,before,after,root,check_evidence=True):
    require(repair.get('pending')==[],'SEG_MESH_REPAIR_REQUIRED')
    operations={o['id']:o for o in repair['operations']};used=set()
    for phase,inspection in [('before',before),('after',after)]:
        decisions=repair.get('decisions',{}).get(phase);require(isinstance(decisions,list),'SEG_MESH_REPAIR_REQUIRED')
        require(len(decisions)==len(inspection['boundaries']) and {r.get('id') for r in decisions}=={b['id'] for b in inspection['boundaries']},'SEG_MESH_REPAIR_REQUIRED')
        for row in decisions:
            require(isinstance(row.get('reason'),str) and row['reason'].strip(),'SEG_MESH_REPAIR_REQUIRED')
            if row.get('status')=='repaired' and phase=='before':
                require(row.get('operationIds') and all(i in operations for i in row['operationIds']))
                # A repaired topological boundary must actually disappear.
                edges=next(b['edges'] for b in before['boundaries'] if b['id']==row['id'])
                boundary=next(b for b in before['boundaries'] if b['id']==row['id'])
                require(all(operations[i]['part']==boundary['part'] and operations[i]['object']==boundary['object'] for i in row['operationIds']))
                remaining={tuple(e) for b in after['boundaries'] if b['part']==boundary['part'] and b['object']==boundary['object'] for e in b['edges']}
                require(not any(tuple(e) in remaining for e in edges),'SEG_MESH_REPAIR_UNRESOLVED')
            else:require(row.get('status')=='intentional','SEG_MESH_REPAIR_REQUIRED')
    for part in VIEWS:
        review=repair.get('visualReview',{}).get(part,{});require(isinstance(review.get('findings'),str) and review['findings'].strip(),'SEG_MESH_REPAIR_REQUIRED')
        for region in REGIONS[part]:
            row=review.get('regions',{}).get(region,{})
            require(row.get('status') in ('clear','repaired','intentional','not-applicable') and isinstance(row.get('reason'),str) and row['reason'].strip(),'SEG_MESH_REPAIR_REQUIRED')
            if row['status']=='repaired':require(row.get('operationIds') and all(i in operations and operations[i]['part']==part and operations[i]['region']==region for i in row['operationIds']))
        for view in VIEWS[part]:
            for phase in ('before','after'):
                proof=review.get('views',{}).get(view,{}).get(phase,{}) or {};name=proof.get('file','');sha=proof.get('sha256','')
                require(re.fullmatch(r'review/[a-z0-9_-]{1,64}\.png',name) and re.fullmatch(r'[a-f0-9]{64}',sha) and name not in used,'SEG_MESH_REPAIR_EVIDENCE');used.add(name)
                if check_evidence:
                    file=Path(root)/name;require(file.is_file(),'SEG_MESH_REPAIR_EVIDENCE');data=file.read_bytes()
                    require(data[:8]==b'\x89PNG\r\n\x1a\n' and hashlib.sha256(data).hexdigest()==sha,'SEG_MESH_REPAIR_EVIDENCE')
    return {'policy':POLICY,'reviewed':True,'sourceFingerprint':before['sourceFingerprint'],'repairedFingerprint':after['sourceFingerprint'],
            'addedFaces':sum(len(o['faces']) for o in repair['operations']),'boundariesBefore':len(before['boundaries']),'intentionalBoundariesAfter':len(after['boundaries'])}

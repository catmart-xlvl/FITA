"""Offline weight-only exchange. Never use the uploaded mesh as the output mesh."""
import bpy, json, sys, struct, math, hashlib
from pathlib import Path
from collections import Counter, defaultdict
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mesh_connectivity import import_connected_glb

EPS = 0.00001
C = Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1))) # Blender to glTF

def fail(code, detail=''):
    raise ValueError('RIG_EDIT_' + code + (': ' + detail if detail else ''))

def load(file):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if file.suffix.lower() == '.fbx':
        bpy.ops.import_scene.fbx(filepath=str(file), use_image_search=False, ignore_leaf_bones=False, automatic_bone_orientation=False, use_anim=False)
    else:
        import_connected_glb(file)
    bpy.context.view_layer.update()

def snapshot():
    meshes, bones = {}, {}
    import numpy as np
    image_hashes={}
    def material_signature(material):
        if not material: return None
        nodes=material.node_tree.nodes if material.use_nodes else []
        bsdf=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
        values={}
        if bsdf:
            for key in ['Base Color','Metallic','Roughness','Alpha']:
                socket=bsdf.inputs.get(key)
                if socket and not socket.is_linked:
                    value=socket.default_value
                    values[key]=[round(float(x),4) for x in value] if hasattr(value,'__iter__') else round(float(value),4)
        images=[]
        for node in nodes:
            if node.type!='TEX_IMAGE' or not node.image: continue
            image=node.image
            if image.name not in image_hashes:
                pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels)
                image_hashes[image.name]=hashlib.sha256(np.rint(np.clip(pixels,0,1)*255).astype(np.uint8).tobytes()).hexdigest()
            images.append(image_hashes[image.name])
        return {'values':values,'images':sorted(images)}
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(rigs) != 1: fail('SKELETON', 'Expected one armature')
    rig = rigs[0]
    for bone in rig.data.bones:
        m = C @ rig.matrix_world @ bone.matrix_local
        bones[bone.name] = {'parent':bone.parent.name if bone.parent else None, 'matrix':[m[r][c] for c in range(4) for r in range(4)]}
    for o in bpy.context.scene.objects:
        if o.type != 'MESH': continue
        if o.name in meshes: fail('MESHES', 'Duplicate names')
        mesh = o.data
        if len(mesh.vertices)>2000000: fail('LIMIT')
        mesh.calc_loop_triangles()
        world = C @ o.matrix_world
        uv = mesh.uv_layers.active
        points = [list(world @ v.co) for v in mesh.vertices]
        weights = []
        for v in mesh.vertices:
            pairs = sorted([[o.vertex_groups[g.group].name,g.weight] for g in v.groups if g.weight>1e-8 and o.vertex_groups[g.group].name in bones])
            weights.append(pairs)
        faces = []
        for tri in mesh.loop_triangles:
            faces.append({'v':list(tri.vertices), 'uv':[[uv.data[i].uv.x,1-uv.data[i].uv.y] for i in tri.loops] if uv else [], 'material':o.material_slots[tri.material_index].name if tri.material_index<len(o.material_slots) else ''})
        morphs={}
        if mesh.shape_keys:
            for key in list(mesh.shape_keys.key_blocks)[1:]:
                if abs(key.value)>1e-6: fail('POSE', o.name)
                morphs[key.name]=[list(world.to_3x3() @ (v.co-mesh.vertices[i].co)) for i,v in enumerate(key.data)]
        meshes[o.name]={'points':points,'faces':faces,'weights':weights,'morphs':morphs,'materials':[material_signature(slot.material) for slot in o.material_slots]}
    if not meshes: fail('MESHES')
    return {'meshes':meshes,'bones':bones}

def cyclic(values):
    return min(tuple(values),tuple(values[1:]+values[:1]),tuple(values[2:]+values[:2]))

def match_mesh(before, after, name):
    # GLB writers can merge identical encoded seam vertices. Accept that format
    # change only when every rest triangle/corner is unchanged; output always
    # retains the exact original vertex buffers and connectivity.
    def tree(points):
        kd=KDTree(len(points))
        for i,p in enumerate(points): kd.insert(Vector(p),i)
        kd.balance();return kd
    kd,base_kd=tree(after['points']),tree(before['points'])
    def uvs(mesh):
        values=[set() for _ in mesh['points']]
        for face in mesh['faces']:
            for k,i in enumerate(face['v']):
                if face['uv']:values[i].add(tuple(face['uv'][k]))
        return values
    au,bu=uvs(before),uvs(after)
    close_uv=lambda a,b: len(a)==len(b) and all(abs(x-y)<=EPS for x,y in zip(a,b))
    same_order=len(before['points'])==len(after['points']) and all((Vector(p)-Vector(q)).length<=EPS for p,q in zip(before['points'],after['points'])) and Counter(cyclic(f['v']) for f in before['faces'])==Counter(cyclic(f['v']) for f in after['faces'])
    mapping={}
    for i,p in enumerate(before['points']):
        candidates=[i] if same_order else [j for _,j,d in kd.find_range(Vector(p),EPS) if len(au[i])==len(bu[j]) and all(any(close_uv(a,b) for b in bu[j]) for a in au[i])]
        if not candidates: fail('GEOMETRY',name)
        variants={tuple((n,round(w,6)) for n,w in after['weights'][j]) for j in candidates}
        if len(variants)>1:fail('AMBIGUOUS',name)
        mapping[i]=min(candidates)
    clusters=[min(j for _,j,d in base_kd.find_range(Vector(p),EPS)) for p in before['points']]
    base_uv=defaultdict(set)
    for i,values in enumerate(au):base_uv[clusters[i]].update(values)
    def faces(mesh,is_base):
        result=[]
        for f in mesh['faces']:
            corners=[]
            for k,i in enumerate(f['v']):
                if is_base:cluster=clusters[i]
                else:
                    found=[clusters[j] for _,j,d in base_kd.find_range(Vector(mesh['points'][i]),EPS)]
                    if not found:fail('GEOMETRY',name)
                    cluster=min(found)
                uv=f['uv'][k] if f['uv'] else ()
                matches=sorted(a for a in base_uv[cluster] if close_uv(a,uv)) if uv else [()]
                if not matches:fail('TOPOLOGY',name)
                corners.append((cluster,matches[0],f['material']))
            result.append(cyclic(corners))
        return Counter(result)
    if faces(before,True)!=faces(after,False): fail('TOPOLOGY',name)
    # A unique additional/removed point is never treated as an encoding seam.
    for i,p in enumerate(after['points']):
        if not any(len(bu[i])==len(au[j]) and all(any(close_uv(a,b) for a in au[j]) for b in bu[i]) for _,j,d in base_kd.find_range(Vector(p),EPS)):fail('VERTICES',name)
    if set(before['morphs'])!=set(after['morphs']):fail('MORPHS',name)
    for key,points in before['morphs'].items():
        if any((Vector(p)-Vector(after['morphs'][key][mapping[i]])).length>EPS for i,p in enumerate(points)):fail('MORPHS',name)
    return mapping

def compare(before,after):
    if set(before['meshes'])!=set(after['meshes']): fail('MESHES')
    missing=set(before['bones'])-set(after['bones'])
    if missing: fail('MISSING_BONES', ', '.join(sorted(missing)))
    for name,bone in before['bones'].items():
        other=after['bones'][name]
        if bone['parent']!=other['parent']: fail('HIERARCHY',name)
        if max(abs(x-y) for x,y in zip(bone['matrix'],other['matrix']))>0.0001: fail('BONE_REST',name)
    for name,bone in after['bones'].items():
        if name not in before['bones'] and not bone['parent']: fail('HIERARCHY',name)
    for name,mesh in before['meshes'].items():
        if mesh.get('materials')!=after['meshes'][name].get('materials'): fail('MATERIALS',name)
    return {name:match_mesh(mesh,after['meshes'][name],name) for name,mesh in before['meshes'].items()}

def glb(file):
    data=file.read_bytes();length=struct.unpack_from('<I',data,12)[0]
    return json.loads(data[20:20+length]),data[28+length:]

def patch_original(base_file, before, after, mapping, destination):
    doc,binary=glb(base_file);binary=bytearray(binary)
    def append(values,kind,fmt,width):
        while len(binary)%4: binary.append(0)
        start=len(binary)
        for row in values: binary.extend(struct.pack('<'+fmt*width,*row))
        doc.setdefault('bufferViews',[]).append({'buffer':0,'byteOffset':start,'byteLength':len(binary)-start})
        doc.setdefault('accessors',[]).append({'bufferView':len(doc['bufferViews'])-1,'componentType':5126 if fmt=='f' else 5123,'count':len(values),'type':kind})
        return len(doc['accessors'])-1
    def read(index):
        a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
        if a.get('sparse'): fail('FORMAT','Sparse source accessors')
        fmt={5126:'f',5123:'H',5121:'B',5125:'I'}[a['componentType']];width={'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];size=struct.calcsize(fmt)
        start=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',size*width)
        return [struct.unpack_from('<'+fmt*width,binary,start+i*stride) for i in range(a['count'])]
    def matrix(values): return Matrix([values[i::4] for i in range(4)])
    worlds={}
    def visit(index,parent):
        n=doc['nodes'][index]
        if 'matrix' in n: local=matrix(n['matrix'])
        else:
            from mathutils import Quaternion
            q=n.get('rotation',[0,0,0,1]);local=Matrix.LocRotScale(Vector(n.get('translation',[0,0,0])),Quaternion((q[3],*q[:3])),Vector(n.get('scale',[1,1,1])))
        worlds[index]=parent@local
        for child in n.get('children',[]): visit(child,worlds[index])
    for index in doc['scenes'][doc.get('scene',0)]['nodes']: visit(index,Matrix.Identity(4))
    joint_ids=set(j for skin in doc['skins'] for j in skin['joints']);names={doc['nodes'][i]['name']:i for i in joint_ids}
    added=set(after['bones'])-set(before['bones'])
    pending=set(added)
    while pending:
        ready=[name for name in sorted(pending) if after['bones'][name]['parent'] in names]
        if not ready: fail('HIERARCHY')
        for name in ready:
            b=after['bones'][name];parent=names[b['parent']];world=matrix(b['matrix']);local=worlds[parent].inverted()@world
            index=len(doc['nodes']);doc['nodes'].append({'name':name,'matrix':[local[r][c] for c in range(4) for r in range(4)]});doc['nodes'][parent].setdefault('children',[]).append(index)
            names[name]=index;worlds[index]=world;pending.remove(name)
    # New inverse binds are derived from the original mesh space. All original
    # geometry/accessors/materials/images/morph targets remain byte-for-byte.
    primitive_total=0
    for node_index,node in list(enumerate(doc['nodes'])):
        if 'mesh' not in node: continue
        name=node.get('name');bm=before['meshes'].get(name)
        if bm is None: fail('MESHES',str(name))
        # Keep the original skin accessors when this mesh was not edited.
        # Coincident source corners may intentionally carry distinct weights;
        # unchanged data needs no spatial reconstruction or ambiguity resolution.
        if not added and all(bm['weights'][i] == after['meshes'][name]['weights'][mapping[name][i]]
                             for i in range(len(bm['points']))):
            continue
        skin=doc['skins'][node['skin']];old_joints=list(skin['joints']);joints=old_joints+[names[n] for n in sorted(added) if names[n] not in old_joints]
        # A separate skin prevents shared-skin inverse binds from being patched twice.
        ibms=read(skin['inverseBindMatrices'])+[tuple((worlds[names[n]].inverted()@worlds[node_index])[r][c] for c in range(4) for r in range(4)) for n in sorted(added) if names[n] not in old_joints]
        node['skin']=len(doc['skins']);doc['skins'].append({**skin,'joints':joints,'inverseBindMatrices':append(ibms,'MAT4','f',16)})
        lookup={doc['nodes'][j]['name']:i for i,j in enumerate(joints)}
        kd=KDTree(len(bm['points']))
        for i,p in enumerate(bm['points']): kd.insert(Vector(p),i)
        kd.balance()
        uv_by_vertex=[set() for _ in bm['points']]
        for face in bm['faces']:
            for k,i in enumerate(face['v']):
                if face['uv']: uv_by_vertex[i].add(tuple(round(x,5) for x in face['uv'][k]))
        for primitive in doc['meshes'][node['mesh']]['primitives']:
            attr=primitive['attributes'];pos=read(attr['POSITION']);uv=read(attr['TEXCOORD_0']) if 'TEXCOORD_0' in attr else None
            source_joints=read(attr['JOINTS_0']);source_weights=read(attr['WEIGHTS_0'])
            js,ws=[],[]
            for row,p in enumerate(pos):
                point=worlds[node_index]@Vector(p);uvkey=tuple(round(x,5) for x in uv[row]) if uv else None
                candidates=[i for _,i,d in kd.find_range(point,EPS) if uvkey is None or uvkey in uv_by_vertex[i]]
                variants=[after['meshes'][name]['weights'][mapping[name][i]] for i in candidates]
                if len({json.dumps(v) for v in variants})>1:
                    # Original named weights can distinguish coincident layers
                    # that have identical positions and UVs. Never average them.
                    original_weights=defaultdict(float)
                    for joint,weight in zip(source_joints[row],source_weights[row]):
                        if weight>1e-8: original_weights[doc['nodes'][old_joints[joint]]['name']]+=weight
                    def same_original_weights(index):
                        previous=dict(bm['weights'][index])
                        return all(abs(previous.get(n,0)-original_weights.get(n,0))<=EPS
                                   for n in previous.keys()|original_weights.keys())
                    variants=[after['meshes'][name]['weights'][mapping[name][i]] for i in candidates if same_original_weights(i)]
                if not variants or len({json.dumps(v) for v in variants})!=1: fail('AMBIGUOUS',name)
                pairs=variants[0];total=sum(v for n,v in pairs)
                if not pairs or len(pairs)>4 or abs(total-1)>.002 or any(not math.isfinite(v) or v<0 or v>1 for n,v in pairs): fail('WEIGHTS',name)
                if any(n not in lookup for n,v in pairs): fail('SKELETON',name)
                js.append([lookup[n] for n,v in pairs]+[0]*(4-len(pairs)));ws.append([v/total for n,v in pairs]+[0]*(4-len(pairs)))
            for key in list(attr):
                if key.startswith(('JOINTS_','WEIGHTS_')): del attr[key]
            attr['JOINTS_0']=append(js,'VEC4','H',4);attr['WEIGHTS_0']=append(ws,'VEC4','f',4);primitive_total+=1
    doc['buffers'][0]['byteLength']=len(binary)
    encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode();encoded+=b' '*(-len(encoded)%4);binary+=b'\x00'*(-len(binary)%4)
    destination.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)
    return {'addedBones':sorted(added),'meshes':len(before['meshes']),'vertices':sum(len(m['points']) for m in before['meshes'].values()),'originalMeshBytesPreserved':True,'reviewRequired':True}

def refine_regions(obj, armature, regions, iterations=3, strength=0.35):
    """Refine explicitly fitted regions on the connected original, never infer sides.

    Each region: name, vertices (source mesh indices), allowedBones, fallbackBone,
    optional lockedVertices, smooth (false for rigid parts). Build ALL bones and
    initial helper/chain weights before calling. No proximity-based neighbors.
    Returns measured cleanup statistics; pose/visual review is still required.
    """
    if obj.type != 'MESH' or armature.type != 'ARMATURE' or obj.mode != 'OBJECT':
        fail('REFINE_INPUT', 'Use the original mesh in Object mode and its armature')
    if not isinstance(iterations, int) or not 0 <= iterations <= 20 or not 0 <= strength <= 1:
        fail('REFINE_SETTINGS')
    bone_names = set(armature.data.bones.keys())
    rows = [{obj.vertex_groups[g.group].name: g.weight for g in v.groups
             if obj.vertex_groups[g.group].name in bone_names and g.weight > 0}
            for v in obj.data.vertices]
    plans, assigned = [], set()
    # Validate the full plan before changing any vertex group.
    for region in regions:
        ids = set(region['vertices']); allowed = set(region['allowedBones'])
        locked = set(region.get('lockedVertices', [])); fallback = region['fallbackBone']
        if (not region.get('name') or not ids or assigned & ids or not allowed <= bone_names
                or fallback not in allowed or not locked <= ids
                or any(type(i) is not int or i < 0 or i >= len(rows) for i in ids)):
            fail('REFINE_REGION', region.get('name', 'unnamed'))
        assigned.update(ids); plans.append((region, ids, allowed, locked, fallback))
    neighbors = [set() for _ in rows]
    for edge in obj.data.edges:
        a, b = edge.vertices; neighbors[a].add(b); neighbors[b].add(a)
    def normalized(weights, fallback):
        weights = {n: w for n, w in weights.items() if math.isfinite(w) and w > 1e-8}
        total = sum(weights.values())
        return {n: w / total for n, w in weights.items()} if total else {fallback: 1.0}
    def metrics(ids):
        return dict(vertices=len(ids), unweighted=sum(not rows[i] for i in ids),
                    overFour=sum(len(rows[i]) > 4 for i in ids),
                    unnormalized=sum(abs(sum(rows[i].values())-1) > .002 for i in ids))
    audit = []
    for region, ids, allowed, locked, fallback in plans:
        before = metrics(ids)
        leakage = sum(sum(w for n, w in rows[i].items() if n not in allowed) for i in ids)
        for i in ids:
            rows[i] = normalized({n: w for n, w in rows[i].items() if n in allowed}, fallback)
        if region.get('smooth', True):
            for _ in range(iterations):
                changes = {}
                for i in ids - locked:
                    adjacent = neighbors[i] & ids
                    if not adjacent: continue
                    mean = defaultdict(float)
                    for j in adjacent:
                        for n, w in rows[j].items(): mean[n] += w / len(adjacent)
                    changes[i] = normalized({n: (1-strength)*rows[i].get(n, 0)+strength*mean.get(n, 0)
                                             for n in rows[i].keys() | mean.keys()}, fallback)
                for i, weights in changes.items(): rows[i] = weights
        for i in ids:
            # Strongest local support is always retained; stable ties are deterministic.
            rows[i] = normalized(dict(sorted(rows[i].items(), key=lambda x: (-x[1], x[0]))[:4]), fallback)
        audit.append(dict(region=region['name'], before=before, after=metrics(ids),
                          removedDisallowedWeight=leakage, allowedBones=sorted(allowed)))
    for name in bone_names:
        group = obj.vertex_groups.get(name)
        if group and assigned: group.remove(sorted(assigned))
    for i in assigned:
        for name, weight in rows[i].items():
            group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
            group.add([i], weight, 'REPLACE')
    return dict(mesh=obj.name, regions=audit, untouchedVertices=len(rows)-len(assigned),
                method='connected-region-smoothing', poseReviewRequired=True)


def main():
    job = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
    folder = Path(job['folder'])
    load(folder/'model.glb')
    before=snapshot()
    if job['mode']=='export':
        bpy.ops.export_scene.fbx(filepath=str(folder/'model.fbx'),use_selection=False,object_types={'ARMATURE','MESH'},use_mesh_modifiers=False,add_leaf_bones=False,use_armature_deform_only=False,bake_anim=False,path_mode='COPY',embed_textures=True,axis_forward='-Z',axis_up='Y')
        load(folder/'model.fbx');reference=snapshot()
        # Establish the exact conversion baseline once, for later FBX validation.
        (folder/'fbx-reference.json').write_text(json.dumps(reference,separators=(',',':')),encoding='utf-8')
    else:
        candidate=Path(job['candidate']);load(candidate);after=snapshot()
        if candidate.suffix.lower()=='.fbx':
            reference=json.loads((folder/'fbx-reference.json').read_text(encoding='utf-8'))
            fbmap=compare(reference,after)
            bridge={n:match_mesh(m,reference['meshes'][n],n) for n,m in before['meshes'].items()}
            mapping={n:{i:fbmap[n][j] for i,j in mapping.items()} for n,mapping in bridge.items()}
        else: mapping=compare(before,after)
        report=patch_original(folder/'model.glb',before,after,mapping,Path(job['output']))
        Path(job['report']).write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('RIG_EDIT_OK')

if __name__ == '__main__':
    main()

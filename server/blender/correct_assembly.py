"""Validate a textured placement revision; retain topology, UVs and materials exactly."""
import bpy, json, hashlib, math
from pathlib import Path
from array import array
from export_evaluated_parts import export_evaluated_parts


def require(value):
    if not value: raise ValueError('SEG_ASSEMBLY_CORRECTION_INVALID')


def collection_hash(items, prop, count, kind='f'):
    values=array(kind,[0])*(len(items)*count);items.foreach_get(prop,values)
    return hashlib.sha256(values.tobytes()).hexdigest()


def material_state(material):
    def value(v):
        if isinstance(v,(str,float,int,bool)):return v
        try:return list(v)
        except TypeError:return str(v)
    nodes=[]
    if material.use_nodes:
        for n in material.node_tree.nodes:
            image=getattr(n,'image',None)
            packed=[hashlib.sha256(p.data).hexdigest() for p in ([image.packed_file] if image and image.packed_file else [])]
            require(not image or bool(packed))
            nodes.append([n.name,n.bl_idname,[(s.identifier,value(s.default_value)) for s in n.inputs if hasattr(s,'default_value')],packed,str(getattr(image,'colorspace_settings',None).name) if image else None])
    return [material.name,material.use_nodes,list(material.diffuse_color),nodes,[(l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier) for l in material.node_tree.links] if material.use_nodes else []]


def snapshot():
    result={}
    for o in bpy.context.scene.objects:
        if o.type!='MESH':continue
        require(o.get('workbench_part') in ['head','body'] and not o.modifiers and not o.data.shape_keys and not o.animation_data)
        m=o.data
        require(all(math.isfinite(c) for v in m.vertices for c in v.co))
        result[o.name]={'part':o['workbench_part'],'matrix':o.matrix_world.copy(),'local':[v.co.copy() for v in m.vertices],
          'world':[o.matrix_world@v.co for v in m.vertices],
          'topology':[[tuple(p.vertices) for p in m.polygons],[p.material_index for p in m.polygons]],
          'uv':[(layer.name,collection_hash(layer.data,'uv',2)) for layer in m.uv_layers],
          'materials':[material_state(mat) for mat in m.materials]}
    require(result and {s['part'] for s in result.values()}=={'head','body'})
    return result


def run(job):
    bpy.ops.wm.open_mainfile(filepath=job['sourceBlend'],load_ui=False,use_scripts=False);source=snapshot()
    bpy.ops.wm.open_mainfile(filepath=job['inputBlend'],load_ui=False,use_scripts=False);current=snapshot()
    require(source.keys()==current.keys());counts={};head_delta=None
    body=[p for s in source.values() if s['part']=='body' for p in s['world']]
    low=min(p.z for p in body);high=max(p.z for p in body);height=high-low
    cx=(min(p.x for p in body)+max(p.x for p in body))/2;cy=(min(p.y for p in body)+max(p.y for p in body))/2
    for name,a in source.items():
        b=current[name];require(a['part']==b['part'] and a['topology']==b['topology'] and a['uv']==b['uv'] and a['materials']==b['materials'] and len(a['local'])==len(b['local']))
        if a['part']=='head':
            require(all((x-y).length<1e-7 for x,y in zip(a['local'],b['local'])))
            delta=b['matrix']@a['matrix'].inverted();linear=delta.to_3x3();sizes=[linear.col[i].length for i in range(3)]
            require(linear.determinant()>0 and min(sizes)>.5 and max(sizes)<2 and max(sizes)-min(sizes)<1e-5 and all(abs(linear.col[i].dot(linear.col[j]))<1e-5 for i in range(3) for j in range(i)))
            if head_delta is not None:require(max(abs(delta[i][j]-head_delta[i][j]) for i in range(4) for j in range(4))<1e-5)
            head_delta=delta
        counts[name]=0
        for old,new in zip(a['world'],b['world']):
            if (new-old).length<1e-7:continue
            counts[name]+=1
            if a['part']=='body':
                # Neck bounds scale with body height, so this also works for non-normalized exports.
                require(old.z>high-.12*height and abs(old.x-cx)<.12*height and abs(old.y-cy)<.18*height and (new-old).length<.12*height)
    root=Path(job['directory']);bpy.ops.wm.save_as_mainfile(filepath=str(root/'corrected.blend'),compress=False)
    bpy.ops.wm.open_mainfile(filepath=str(root/'corrected.blend'),load_ui=False,use_scripts=False);reopened=snapshot()
    for name,b in current.items():
        a=reopened[name];require(a['uv']==b['uv'] and a['materials']==b['materials'] and a['topology']==b['topology'] and all((x-y).length<1e-7 for x,y in zip(a['world'],b['world'])))
    for part in ['head','body']:export_evaluated_parts(root/(part+'-corrected.glb'),[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('workbench_part')==part])
    (root/'correction.json').write_text(json.dumps({'uvPreserved':True,'materialsPreserved':True,'topologyPreserved':True,'headLocalShapePreserved':True,'outsideNeckPreserved':True,'independentParts':True,'savedAndReopened':True,'changedVertices':counts,'headTransform':[list(r) for r in head_delta],'reviewRequired':True},indent=2))

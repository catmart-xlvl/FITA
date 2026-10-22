"""Place independent copies using horizontal mesh cross-sections; never weld geometry."""
import bpy, json, sys, math
from mathutils import Matrix, Vector, Euler
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mesh_connectivity import import_connected_glb

def progress(value):
    print('WORKBENCH_PROGRESS '+value, flush=True)

def import_part(filename, name, reference=None, preserve_source_ids=False):
    objects=import_connected_glb(filename,reference,preserve_source_ids=preserve_source_ids)
    meshes=[o for o in objects if o.type=='MESH']
    if not meshes: raise ValueError('PLACEMENT_EMPTY_MESH')
    for o in objects: o['workbench_part']=name
    return objects, meshes

def points(meshes):
    return [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]

def bounds(pts):
    return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]

def section(meshes,z):
    # Build separate contours so arms, earrings and clothing fragments do not
    # inflate a neck radius. Quantization joins UV seams for analysis only.
    pts={}; adjacent={}
    low,high=bounds(points(meshes));height=high[2]-low[2]
    tolerance=max(height*1e-5,1e-9);axis=(low[0]+high[0])*.5
    for o in meshes:
        vertices=[o.matrix_world @ v.co for v in o.data.vertices]
        cuts={}
        for e in o.data.edges:
            a,b=[vertices[i] for i in e.vertices]
            if (a.z<z<=b.z) or (b.z<z<=a.z):
                p=a+(b-a)*((z-a.z)/(b.z-a.z))
                key=tuple(round(v/tolerance) for v in p)
                cuts[tuple(sorted(e.vertices))]=key;pts[key]=p;adjacent.setdefault(key,set())
        for face in o.data.polygons:
            keys=[cuts[tuple(sorted(e))] for e in face.edge_keys if tuple(sorted(e)) in cuts]
            for key in keys: adjacent[key].update(k for k in keys if k!=key)
    seen=set();contours=[]
    for key in pts:
        if key in seen: continue
        queue=[key];seen.add(key);group=[]
        while queue:
            current=queue.pop();group.append(pts[current])
            for neighbor in adjacent[current]-seen: seen.add(neighbor);queue.append(neighbor)
        if len(group)<8: continue
        lo,hi=bounds(group)
        if not lo[0]-tolerance<=axis<=hi[0]+tolerance: continue
        x,y=(lo[0]+hi[0])*.5,(lo[1]+hi[1])*.5
        distances=sorted(math.hypot(p.x-x,p.y-y) for p in group)
        radius=distances[int(len(distances)*.8)]
        if radius>1e-7: contours.append({'center':[x,y,z],'radius':radius,'samples':len(group)})
    # The main central contour takes precedence over pendants and inner seams.
    return max(contours,key=lambda s:s['radius']) if contours else None

def anchor(meshes,kind,fraction):
    low,high=bounds(points(meshes));height=high[2]-low[2]
    if height<=1e-7: raise ValueError('PLACEMENT_INVALID_HEIGHT')
    levels=[fraction] if fraction is not None else ([.04+i*.012 for i in range(20)] if kind=='head' else [.88+i*.01 for i in range(11)])
    sections=[]
    for f in levels:
        cut=section(meshes,low[2]+height*f)
        if cut: sections.append({**cut,'fraction':f})
    if not sections: raise ValueError('PLACEMENT_NECK_SECTION_NOT_FOUND')
    return min(sections,key=lambda s:s['radius']),height

def placement_anchors(head,body,settings):
    ha,hh=anchor(head,'head',settings.get('headNeck'))
    ba,bh=anchor(body,'body',settings.get('bodyNeck'))
    method='mesh-cross-sections';warnings=[]
    if settings.get('bodyNeck') is None and (ba['fraction']<.88 or ba['radius']/bh>.06):
        # An open garment has no anatomical neck circumference to match. Do
        # not silently use its waist/shoulders as a neck. This editable preset
        # is explicitly reported as a proportion estimate, not a measured fit.
        pts=points(body);lo,hi=bounds(pts);x=(lo[0]+hi[0])*.5
        central=[p for p in pts if abs(p.x-x)<bh*.04 and p.z>lo[2]+bh*.85]
        if not central: raise ValueError('PLACEMENT_NECK_SECTION_NOT_FOUND')
        top=max(p.z for p in central)
        rim=[p for p in central if p.z>top-bh*.025]
        y=(min(p.y for p in rim)+max(p.y for p in rim))*.5
        ba={'center':[x,y,top-bh*.015],'radius':None,'fraction':(top-lo[2])/bh-.015,'samples':len(rim)}
        scale=.22*bh/hh
        method='proportion-estimate';warnings=['PLACEMENT_NECK_NOT_MEASURABLE']
    else:
        scale=ba['radius']/ha['radius']
    return ha,ba,bh,scale*settings['scale'],method,warnings

def main():
    job=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf-8'))
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    progress('importing')
    body_objects,body=import_part(job['body'],'body');head_objects,head=import_part(job['head'],'head')
    settings=job['settings'];progress('finding-neck-sections')
    ha,ba,bh,scale,method,warnings=placement_anchors(head,body,settings)
    if not .02<=scale<=50: raise ValueError('PLACEMENT_SCALE_OUT_OF_RANGE')
    offset=Vector([n*bh for n in settings['offset']])
    rotation=Euler([math.radians(n) for n in settings['rotation']],'XYZ').to_matrix().to_4x4()
    transform=Matrix.Translation(Vector(ba['center'])+offset)@rotation@Matrix.Scale(scale,4)@Matrix.Translation(-Vector(ha['center']))
    # Apply once to roots; child hierarchies retain their original relationships.
    for o in head_objects:
        if o.parent not in head_objects: o.matrix_world=transform@o.matrix_world
    bpy.context.view_layer.update();progress('saving')
    bpy.context.scene['workbench_review_required']=True
    bpy.context.scene['workbench_method']=method
    bpy.context.scene['workbench_warnings']=';'.join(warnings)
    bpy.ops.wm.save_as_mainfile(filepath=job['blend'], compress=False)
    bpy.ops.export_scene.gltf(filepath=job['glb'],export_format='GLB',export_attributes=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False)
    report={'method':method,'warnings':warnings,'reviewRequired':True,'headAnchor':ha,'bodyAnchor':ba,'bodyHeight':bh,'headScale':scale,'headMatrix':[list(row) for row in transform],'headMeshes':len(head),'bodyMeshes':len(body),'independentParts':True}
    Path(job['report']).write_text(json.dumps(report),encoding='utf-8');progress('complete')

if __name__=='__main__': main()

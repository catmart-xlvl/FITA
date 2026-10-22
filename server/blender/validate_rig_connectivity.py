"""Validate actual editable mesh connections, not merely visible triangles."""
import bpy,json,sys
from pathlib import Path

def snapshot(filename, names=None):
    bpy.ops.wm.open_mainfile(filepath=filename,load_ui=False,use_scripts=False)
    result={}
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH':continue
        name=obj.name
        if names is not None:
            if name not in names and name.endswith(' export') and name[:-7] in names:name=name[:-7]
            if name not in names and name+' export' in names:name=name+' export'
            if name not in names:continue # Hidden donor references are not targets.
        mesh=obj.data
        attr=next((a for a in mesh.attributes if a.name.lower()=='_workbench_vertex'),None)
        if attr is None:raise ValueError('RIG_CONNECTIVITY_IDENTITIES_MISSING: '+name)
        ids=[int(round(a.value)) for a in attr.data]
        if len(set(ids))!=len(ids):raise ValueError('RIG_CONNECTIVITY_SPLIT_EDITABLE_MESH: '+name)
        faces=[]
        for face in mesh.polygons:
            values=[ids[i] for i in face.vertices]
            faces.append(min(tuple(values[i:]+values[:i]) for i in range(len(values))))
        if name in result:raise ValueError('RIG_CONNECTIVITY_AMBIGUOUS_MESH: '+name)
        result[name]={'vertices':sorted(ids),'faces':sorted(faces)}
    return result

def validate(source,result,mesh_names=None):
    before=snapshot(source,set(mesh_names) if mesh_names is not None else None)
    if mesh_names is not None and set(before)!=set(mesh_names):raise ValueError('RIG_CONNECTIVITY_TARGET_MESH_MISSING')
    after=snapshot(result,set(before))
    if before!=after:raise ValueError('RIG_CONNECTIVITY_TOPOLOGY_CHANGED')
    return {'editableConnectivityPreserved':True,'meshes':len(before)}

if __name__=='__main__':
    job=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text())
    report=validate(job['source'],job['result'],job.get('meshNames'))
    Path(job['report']).write_text(json.dumps(report))

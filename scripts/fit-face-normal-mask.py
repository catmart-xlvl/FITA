"""Prepare an editable mask-fit .blend, or export its reviewed local transform.
blender --background --factory-startup --disable-autoexec --python this.py -- prepare fit.json
blender --background --factory-startup output/face-mask-fit.blend --disable-autoexec --python this.py -- export fit.json
fit.json: {mesh, primitive, positionHash, proxy:{center,radii,rotation?}, objectName?:'face'}
This helper never edits or exports the character GLB, nor chooses skin weights.
"""
import bpy, json, sys, math
from pathlib import Path
from mathutils import Matrix, Quaternion

root=Path(__file__).resolve().parent
args=sys.argv[sys.argv.index('--')+1:]
if len(args)!=2 or args[0] not in ('prepare','export'):
    raise ValueError('Use -- prepare|export fit.json')
mode, config_file=args
config=json.loads(Path(config_file).resolve().read_text(encoding='utf-8'))
if not all(k in config for k in ('mesh','primitive','positionHash','proxy')):
    raise ValueError('Inspect the current head and supply mesh, primitive, positionHash and proxy')
basis=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
name='FITA_FaceNormalMask'
if mode=='prepare':
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(root/'result'/'head.glb'))
    face=bpy.data.objects.get(config.get('objectName','face'))
    if face is None or face.type!='MESH':
        raise ValueError('Choose the actual imported face objectName; no approximate match')
    bpy.ops.import_scene.gltf(filepath=str(root/'face-normal-mask'/'face-normal-mask.glb'))
    mask=bpy.data.objects.get(name)
    if mask is None: raise ValueError('Reusable mask missing')
    p=config['proxy']; c=p['center']; r=p['radii']; q=p.get('rotation',[0,0,0,1])
    if len(c)!=3 or len(r)!=3 or len(q)!=4 or not all(math.isfinite(v) for v in c+r+q) or min(r)<=0 or abs(sum(v*v for v in q)-1)>1e-5:
        raise ValueError('Invalid mask transform')
    transform=Matrix.Translation(c) @ Quaternion((q[3],q[0],q[1],q[2])).to_matrix().to_4x4() @ Matrix.Diagonal((*r,1))
    mask.matrix_world=face.matrix_world @ basis @ transform @ basis.inverted()
    mask['targetObject']=face.name
    mask['fitConfig']=json.dumps(config)
    mask.display_type='WIRE'
    mask.hide_render=True
    bpy.ops.object.select_all(action='DESELECT')
    mask.select_set(True); bpy.context.view_layer.objects.active=mask
    output=root/'output'/'face-mask-fit.blend'
    output.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    print('FACE_MASK_FIT_READY', output)
else:
    mask=bpy.data.objects.get(name)
    if mask is None or 'fitConfig' not in mask: raise ValueError('Open the prepared fit .blend')
    bound=json.loads(mask['fitConfig'])
    if any(config[k]!=bound[k] for k in ('mesh','primitive','positionHash')):
        raise ValueError('Fit source identity changed')
    face=bpy.data.objects.get(mask['targetObject'])
    if face is None: raise ValueError('Fit target missing')
    matrix=basis.inverted() @ face.matrix_world.inverted() @ mask.matrix_world @ basis
    center, rotation, radii=matrix.decompose()
    rebuilt=Matrix.Translation(center) @ rotation.to_matrix().to_4x4() @ Matrix.Diagonal((*radii,1))
    if min(radii)<=0 or max(abs(matrix[i][j]-rebuilt[i][j]) for i in range(4) for j in range(4))>1e-5:
        raise ValueError('Use positive scale and rotation only; no shear or mirrored mask')
    result={k:config[k] for k in ('mesh','primitive','positionHash')}
    result.update(schema='workbench-face-mask-fit/v1',proxy={'type':'ellipsoid','center':list(center),'radii':list(radii),'rotation':[rotation.x,rotation.y,rotation.z,rotation.w]})
    output=root/'output'/'face-mask-fit.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print('FACE_MASK_TRANSFORM_EXPORTED',output)

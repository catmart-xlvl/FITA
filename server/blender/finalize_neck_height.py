"""Run AFTER the local neck edit. Uniformly scale the WHOLE character to metres."""
import bpy,json,sys
from pathlib import Path
from mathutils import Matrix
root=Path(sys.argv[sys.argv.index('--')+1]).resolve() if '--' in sys.argv else Path(__file__).resolve().parent
sys.path.insert(0,str(Path(__file__).resolve().parent))
from export_evaluated_parts import export_evaluated_parts
manifest=json.loads((root/'manifest.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(root/('model-edited.blend' if manifest.get('manual',{}).get('modelSnapshot',{}).get('neckLocked') else 'neck-edited.blend')),load_ui=False,use_scripts=False)
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
lo=min(v.z for v in points);hi=max(v.z for v in points)
factor=(manifest['manual']['heightCm']/100)/(hi-lo)
transform=Matrix.Scale(factor,4)@Matrix.Translation((0,0,-lo))
for o in bpy.context.scene.objects:
 if o.parent is None:o.matrix_world=transform@o.matrix_world
bpy.context.view_layer.update();bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1
bpy.ops.wm.save_as_mainfile(filepath=str(root/'placed.blend'),compress=False)
export_evaluated_parts(root/'placed.glb',meshes)

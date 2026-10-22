"""Bake the artist's absolute glTF transforms, with no estimation or anatomy edits."""
import bpy,json,sys,math
from pathlib import Path
from mathutils import Matrix,Euler,Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from place_parts import import_part
from export_evaluated_parts import export_evaluated_parts
from mesh_connectivity import reference_tables
from placement_deformers import apply_deformers
job=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text())
reference=None
if job.get('connectivityReference'):
 bpy.ops.wm.open_mainfile(filepath=job['connectivityReference'],load_ui=False,use_scripts=False)
 reference=reference_tables(bpy.context.scene.objects)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
C=Matrix.Rotation(math.pi/2,4,'X')
for g in ('head','body'):
 objects,meshes=import_part(job[g],g,reference,preserve_source_ids=True);p=job['transforms'][g]
 apply_deformers(meshes,job.get('deformations',{}).get(g))
 M=Matrix.Translation(Vector(p['position']))@Euler(p['rotation'],'XYZ').to_matrix().to_4x4()@Matrix.Scale(p['scale'],4)
 for o in objects:
  if o.parent not in objects:o.matrix_world=C@M@C.inverted()@o.matrix_world
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=job['blend'],compress=False)
export_evaluated_parts(job['glb'],[o for o in bpy.context.scene.objects if o.type=='MESH'])

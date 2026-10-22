"""Reject changes to artist-approved placement, textures, or non-neck geometry."""
import bpy,json,sys
from pathlib import Path
from mathutils import Matrix,Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from correct_assembly import snapshot,require
from connected_falloff import connected_weights,validate_uv_seam_pairs,validate_seam_motion,rotate_connected_points
from export_evaluated_parts import export_evaluated_parts
from neck_subdivision import subdivide_upper_neck
from repair_lip_uv import repair_coverage
from scoped_finish_repair import replay_authorized
job=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text())
bpy.ops.wm.open_mainfile(filepath=job['input'],load_ui=False,use_scripts=False)
subdivisions={o.name:json.loads(o['workbench_neck_subdivision']) for o in bpy.context.scene.objects if o.type=='MESH' and o.get('workbench_neck_subdivision')}
coverage=None;coverage_pixels=None
skin=bpy.data.objects.get('piel-superior')
if skin is not None and skin.get('workbench_coverage_patch'):
 coverage=json.loads(skin['workbench_coverage_patch']);im=next(n.image for n in skin.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE');coverage_pixels=bytes(im.packed_file.data)
require(len(subdivisions)<=1)
bpy.ops.wm.open_mainfile(filepath=job['approved'],load_ui=False,use_scripts=False)
approved_subdivisions={o.name:json.loads(o['workbench_neck_subdivision']) for o in bpy.context.scene.objects if o.type=='MESH' and o.get('workbench_neck_subdivision')}
if job.get('lockNeck'):require(subdivisions==approved_subdivisions)
for name,step in ({} if job.get('lockNeck') else subdivisions).items():
 require(name in bpy.data.objects);subdivide_upper_neck(bpy.data.objects[name],step['edges'],step['cuts'])
coverage_report=None
if coverage:
 skin=bpy.data.objects['piel-superior']
 if skin.get('workbench_coverage_patch'):
  require(json.loads(skin['workbench_coverage_patch'])==coverage)
  original_image=next(n.image for n in skin.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE');require(bytes(original_image.packed_file.data)==coverage_pixels)
  coverage_report={'bodyCoverageRepaired':True,'geometryPreserved':True,'uvPreserved':True,'outsideSelectedAtlasPixelsPreserved':True,'patch':coverage,'reused':True}
 else:
  require(not job.get('lockNeck'))
  image=Path(job['report']).with_suffix('.png');image.write_bytes(coverage_pixels);coverage_report=repair_coverage(coverage,str(image))
scoped_repair=replay_authorized(job)
approved_hair_steps={o.name:json.loads(o.get('workbench_hair_clearance','[]')) for o in bpy.context.scene.objects if o.type=='MESH'}
before=snapshot()
allpoints=[p for o in before.values() for p in o['world']];lo=min(p.z for p in allpoints);hi=max(p.z for p in allpoints);factor=(job['heightCm']/100)/(hi-lo)
body=[p for o in before.values() if o['part']=='body' for p in o['world']];height=max(p.z for p in body)-min(p.z for p in body);top=max(p.z for p in body);cx=(min(p.x for p in body)+max(p.x for p in body))/2;cy=(min(p.y for p in body)+max(p.y for p in body))/2
cap=[p for p in body if p.z>top-.01*height]
tube_min=Vector([min(p[k] for p in cap) for k in range(3)]);tube_max=Vector([max(p[k] for p in cap) for k in range(3)])
edges={o.name:[tuple(e.vertices) for e in o.data.edges] for o in bpy.context.scene.objects if o.type=='MESH'}
identities={o.name:[v.value for v in attr.data] for o in bpy.context.scene.objects if o.type=='MESH'
            for attr in o.data.attributes if attr.name.lower()=='_workbench_vertex'}
bpy.ops.wm.open_mainfile(filepath=job['input'],load_ui=False,use_scripts=False);after=snapshot();require(before.keys()==after.keys())
points=[p for o in after.values() for p in o['world']];require(abs(max(p.z for p in points)-min(p.z for p in points)-job['heightCm']/100)<.001)
hair_changes={};seam_links={}
for name,a in before.items():
 b=after[name];require(a['part']==b['part'] and a['topology']==b['topology'] and a['uv']==b['uv'] and a['materials']==b['materials'] and len(a['world'])==len(b['world']))
 if name in identities:
  attr=next((v for v in bpy.data.objects[name].data.attributes if v.name.lower()=='_workbench_vertex'),None)
  require(attr is not None and [v.value for v in attr.data]==identities[name])
 expected_matrix=Matrix.Scale(factor,4)@Matrix.Translation((0,0,-lo))@a['matrix']
 require(max(abs(expected_matrix[i][j]-b['matrix'][i][j]) for i in range(4) for j in range(4))<max(1e-5,height*factor*1e-5))
 hair=[p.copy() for p in a['world']]
 steps=json.loads(bpy.data.objects[name].get('workbench_hair_clearance','[]'))
 require(isinstance(steps,list) and len(steps)<=20)
 if job.get('lockNeck'):
  history=approved_hair_steps.get(name,[]);require(steps[:len(history)]==history);steps=steps[len(history):]
 if steps:
  require(a['part']=='head' and any(w in name.lower() for w in ('hair','cabello','pelo')))
  hair_top=max(p.z for p in hair);hair_bottom=min(p.z for p in hair)
  protected_z=hair_top-(hair_top-hair_bottom)*.30
  for step in steps:
   require(0<step['radius']<height*.5)
   # Verify against approved geometry, never against moved vertices supplied
   # by a result. Extra links cannot connect unrelated nearby strands.
   seams=validate_uv_seam_pairs(a['world'],edges[name],step.get('seamPairs',[]))
   weights=connected_weights(hair,edges[name],step['seeds'],step['radius'],step['indices'],seams)
   seam_links[name]=seam_links.get(name,0)+len(seams)
   if step.get('method')=='rotation':
    protected=step.get('protectedIndices',[]);require(protected and all(type(i)==int and 0<=i<len(hair) for i in protected))
    require(set(range(len(hair)))-set(step['indices'])<=set(protected))
    selected=[a['world'][i] for i in step['indices']];pivot=Vector(step['pivot'])
    require(pivot.z>=max(p.z for p in selected)-(max(p.z for p in selected)-min(p.z for p in selected))*.15)
    hair=[Vector(p) for p in rotate_connected_points(hair,edges[name],weights,step['pivot'],step['axis'],step['angle'],protected)]
   else:
    require(all(hair[i].z<protected_z for i,w in weights.items() if w>.001))
    delta=Vector(step['displacement']);require(delta.length<height*.08)
    validate_seam_motion(a['world'],edges[name],weights,delta)
    for i,w in weights.items():hair[i]+=delta*w
  require(all((old-new).length<height*.12 for old,new in zip(a['world'],hair)))
  if any(step.get('method')=='rotation' for step in steps):
   for i,j in edges[name]:
    old=(a['world'][i]-a['world'][j]).length
    if old>1e-6:require(.80<=(hair[i]-hair[j]).length/old<=1.20)
  hair_changes[name]=len(steps)
 for old,hair_point,new in zip(a['world'],hair,b['world']):
  expected=hair_point.copy();expected.z-=lo;expected*=factor
  if (new-expected).length<max(.00001,height*factor*1e-5):continue
  require(not job.get('lockNeck'))
  restored=new/factor+Vector((0,0,lo))
  require(a['part']=='body' and old.z>top-.012*height and tube_min.x-1e-5<=old.x<=tube_max.x+1e-5 and tube_min.y-1e-5<=old.y<=tube_max.y+1e-5 and abs(restored.x-old.x)<1e-5 and abs(restored.y-old.y)<1e-5 and restored.z>=old.z-1e-5 and (new-expected).length<height*factor*.12)
export_evaluated_parts(job['glb'],[o for o in bpy.context.scene.objects if o.type=='MESH'])
Path(job['report']).write_text(json.dumps({'approvedPlacementPreserved':True,'texturesPreserved':not bool(scoped_repair),'bodyCoverageCleanup':coverage_report,'savedNeckPreserved':bool(job.get('lockNeck')),'topologyPreserved':not bool(scoped_repair) and (bool(job.get('lockNeck')) or not bool(subdivisions)),'scopedProjectRepair':scoped_repair,'controlledNeckSubdivisions':subdivisions,'trapeziusAndShouldersPreserved':True,'neckWidthPreserved':True,'vertexIdentitiesPreserved':len(identities)==len(before),'neckAndConnectedHairOnly':not bool(scoped_repair and scoped_repair.get('pupilDepthReview')),'hairOperations':hair_changes,'verifiedHairSeamLinks':seam_links,'heightCm':job['heightCm'],'uniformScale':factor}))

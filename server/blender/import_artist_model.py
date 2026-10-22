"""Validate an explicit artist replacement, including its newly added meshes."""
import bpy,json,sys,math,hashlib
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.kdtree import KDTree

job=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf-8'))
def require(ok,reason):
 if not ok:raise ValueError('PLACEMENT_ARTIST_'+reason)
def image_hash(im):
 pixels=np.empty(len(im.pixels),dtype=np.float32);im.pixels.foreach_get(pixels)
 return hashlib.sha256(np.clip(np.rint(pixels*255),0,255).astype(np.uint8).tobytes()).hexdigest()
def capture():
 result={}
 for o in bpy.context.scene.objects:
  if o.type!='MESH':continue
  require(not o.modifiers and not o.data.shape_keys,'APPLY_MODIFIERS_FIRST')
  m=o.data;m.calc_loop_triangles();points=[o.matrix_world@v.co for v in m.vertices]
  require(points and all(math.isfinite(c) for p in points for c in p),'INVALID_GEOMETRY')
  require(m.uv_layers.active is not None,'UV_REQUIRED')
  result[o.name]={'points':points,'triangles':len(m.loop_triangles),'images':{image_hash(n.image) for mat in m.materials if mat and mat.use_nodes for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image and n.image.packed_file}}
 return result

bpy.ops.wm.open_mainfile(filepath=job['input'],load_ui=False,use_scripts=False)
source=capture();require(len(source)>1,'PARTS_REQUIRED')
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=job['preview']);preview=capture()
require(set(source)==set(preview),'PAIR_OBJECT_MISMATCH')
max_error=0
for name,a in source.items():
 b=preview[name];require(a['triangles']==b['triangles'],'PAIR_TOPOLOGY_MISMATCH')
 for lhs,rhs in [(a['points'],b['points']),(b['points'],a['points'])]:
  tree=KDTree(len(rhs))
  for i,p in enumerate(rhs):tree.insert(p,i)
  tree.balance();error=max(tree.find(p)[2] for p in lhs);max_error=max(max_error,error);require(error<.00001,'PAIR_GEOMETRY_MISMATCH')
 require(a['images']==b['images'],'PAIR_PAINT_MISMATCH_'+name)

bpy.ops.wm.open_mainfile(filepath=job['input'],load_ui=False,use_scripts=False)
head=[];body=[];new_ids=[]
for o in bpy.context.scene.objects:
 if o.type!='MESH':continue
 part=o.get('workbench_part')
 if part not in ['head','body']:part='head' if o.name.startswith(('head-','WB_')) else 'body';o['workbench_part']=part
 (head if part=='head' else body).append(o)
 attr=next((a for a in o.data.attributes if a.name.lower()=='_workbench_vertex'),None)
 if attr is None:
  attr=o.data.attributes.new('_workbench_vertex','INT','POINT')
  for i,d in enumerate(attr.data):d.value=i
  new_ids.append(o.name)
 else:require(attr.domain=='POINT' and attr.data_type in ['INT','FLOAT'] and all(math.isfinite(d.value) and d.value==int(d.value) for d in attr.data),'INVALID_VERTEX_IDENTITIES_'+o.name+'_'+attr.data_type)
require(head and body,'PARTS_REQUIRED')
points=[o.matrix_world@v.co for o in head+body for v in o.data.vertices];bottom=min(p.z for p in points);height=max(p.z for p in points)-bottom
require(.05<height<100,'INVALID_HEIGHT');scale=job['heightCm']/100/height
for o in head+body:
 matrix=o.matrix_world.copy()
 for row in range(3):
  for col in range(4):matrix[row][col]*=scale
 matrix.translation.z-=bottom*scale;o.matrix_world=matrix
for image in bpy.data.images:
 if image.users and image.source in {'FILE','GENERATED'} and image.has_data:image.pack()
bpy.ops.wm.save_as_mainfile(filepath=job['blend'],compress=False)
restore=[]
for mat in bpy.data.materials:
 if not mat.use_nodes or not mat.node_tree.nodes.get('Culling_For_Cycles'):continue
 out=next(n for n in mat.node_tree.nodes if n.type=='OUTPUT_MATERIAL' and n.is_active_output);bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');restore.append((mat,out,out.inputs[0].links[0].from_socket));mat.node_tree.links.new(bsdf.outputs[0],out.inputs[0])
bpy.ops.export_scene.gltf(filepath=job['glb'],export_format='GLB',export_apply=False,export_animations=False,export_cameras=False,export_lights=False,export_extras=True,export_attributes=True)
for mat,out,socket in restore:mat.node_tree.links.new(socket,out.inputs[0])
report={'schema':'fita-artist-model-import/v1','pairVerified':True,'maxPairVertexError':max_error,'reviewRequired':True,'independentParts':True,'headMeshes':len(head),'bodyMeshes':len(body),'objects':{o.name:{'vertices':len(o.data.vertices),'faces':len(o.data.polygons)} for o in head+body},'artistReview':{'source':'explicit artist Blender mesh and texture edits','approval':'visual review remains with artist'},'uniformHeightScale':scale,'heightCm':job['heightCm'],'newVertexIdentities':new_ids,'localMeshAndUVUnchanged':True,'texturePixelsPreserved':True}
Path(job['report']).write_text(json.dumps(report,indent=2),encoding='utf-8')

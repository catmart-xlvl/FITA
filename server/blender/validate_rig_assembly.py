import bpy,sys,json,hashlib,math
import numpy as np
from pathlib import Path
from mathutils.kdtree import KDTree
job=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text())
def require(ok,why):
 if not ok:raise ValueError('PLACEMENT_RIG_ASSEMBLY_'+why)
def pixel_hash(im):
 pixels=np.empty(len(im.pixels),dtype=np.float32);im.pixels.foreach_get(pixels);return hashlib.sha256(np.clip(np.rint(pixels*255),0,255).astype(np.uint8).tobytes()).hexdigest()
def capture():
 out={}
 for o in bpy.context.scene.objects:
  if o.type!='MESH':continue
  m=o.data;require(not o.modifiers and not m.shape_keys,'STATIC_SOURCE_REQUIRED');m.calc_loop_triangles()
  ids=next((a for a in m.attributes if a.name.lower()=='_workbench_vertex'),None);require(ids is not None,'IDENTITIES_REQUIRED')
  values=[d.value for d in ids.data];require(len(set(values))==len(m.vertices),'CONNECTED_SOURCE_REQUIRED');require(m.uv_layers.active is not None,'UV_REQUIRED')
  image_hashes={pixel_hash(n.image) for mat in m.materials if mat and mat.use_nodes for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image}
  editable={'points':[list(v.co) for v in m.vertices],'faces':[list(f.vertices) for f in m.polygons],'uv':[[list(x.uv) for x in uv.data] for uv in m.uv_layers],'ids':values,'matrix':[list(row) for row in o.matrix_world]}
  out[o.name]={'editable':editable,'points':[o.matrix_world@v.co for v in m.vertices],'triangles':len(m.loop_triangles),'images':image_hashes}
 return out
bpy.ops.wm.open_mainfile(filepath=job['source'],load_ui=False,use_scripts=False);source=capture()
bpy.ops.wm.open_mainfile(filepath=job['input'],load_ui=False,use_scripts=False);assembly=capture()
require(set(assembly)==set(source)|set(job['additions']) and not set(source)&set(job['additions']),'MESH_SET')
for name,before in source.items():require(before['editable']==assembly[name]['editable'] and before['images']==assembly[name]['images'],'ORIGINAL_CHANGED')
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=job['preview'])
preview={o.name:o for o in bpy.context.scene.objects if o.type=='MESH'};require(set(preview)==set(assembly),'PAIR_MESH_SET')
for name,before in assembly.items():
 o=preview[name];o.data.calc_loop_triangles();require(len(o.data.loop_triangles)==before['triangles'],'PAIR_FACES')
 points=[o.matrix_world@v.co for v in o.data.vertices]
 for a,b in [(points,before['points']),(before['points'],points)]:
  tree=KDTree(len(a))
  for i,p in enumerate(a):tree.insert(p,i)
  tree.balance();require(all(tree.find(p)[2]<1e-5 for p in b),'PAIR_POINTS')
 images={pixel_hash(n.image) for m in o.data.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image};require(images==before['images'],'PAIR_TEXTURES')
Path(job['report']).write_text(json.dumps({'pairVerified':True,'originalEditablePreserved':True,'originalMeshes':len(source),'additionalMeshes':job['additions']}))

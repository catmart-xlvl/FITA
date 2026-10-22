"""Replay an explicitly reviewed, hash-bound project repair; default imports stay strict."""
import bpy,json,hashlib,math,uuid
from pathlib import Path
from mathutils import Vector

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def check(ok,message='Scoped model repair invalid'):
 if not ok:raise ValueError(message)

def apply_patch(patch_path):
 path=Path(patch_path).resolve();p=json.loads(path.read_text())
 if p.get('schema')=='fita-scoped-hair-eye-paint/v2':
  from scoped_hair_eye_paint import apply_patch as apply_hair_eye_paint
  return apply_hair_eye_paint(path)
 check(p['schema']=='fita-project-hair-neck-repair/v1')
 h=bpy.data.objects['hair'];old=h.data;patch=p['hair'];nv,nf=len(old.vertices),len(old.polygons)
 check(nv==patch['originalVertices'] and nf==patch['originalFaces']);check(0<len(patch['vertices'])<500 and 0<len(patch['faces'])<1000)
 points=[v.co.copy() for v in old.vertices];old_normals=[n.vector.copy() for n in old.corner_normals];faces=[list(f.vertices) for f in old.polygons]
 layers={l.name:[d.uv.copy() for d in l.data] for l in old.uv_layers};check(len(layers)==1)
 mats=list(old.materials);smooth=[f.use_smooth for f in old.polygons];material=[f.material_index for f in old.polygons]
 attrs={a.name:(a.data_type,[v.value for v in a.data]) for a in old.attributes if a.domain=='POINT' and a.data_type in ['FLOAT','INT','BOOLEAN']}
 edge_sharp={tuple(sorted(e.vertices)):old.attributes['sharp_edge'].data[e.index].value for e in old.edges} if 'sharp_edge' in old.attributes else {}
 newpoints=[Vector(v) for v in patch['vertices']];check(all(math.isfinite(c) for v in newpoints for c in v));addedfaces=[[nv+i for i in face] for face in patch['faces']]
 check(all(len(set(face))==3 and all(nv<=i<nv+len(newpoints) for i in face) for face in addedfaces));check(len(patch['uv'])==len(addedfaces))
 mesh=bpy.data.meshes.new(old.name+' repaired');mesh.from_pydata(points+newpoints,[tuple(e.vertices) for e in old.edges],faces+addedfaces);mesh.update()
 for mat in mats:mesh.materials.append(mat)
 for i,f in enumerate(mesh.polygons):f.material_index=material[i] if i<nf else 0;f.use_smooth=smooth[i] if i<nf else True
 for name,uv in layers.items():
  layer=mesh.uv_layers.new(name=name)
  values=uv+[Vector(v) for tri in patch['uv'] for v in tri];check(len(values)==len(mesh.loops))
  for d,v in zip(layer.data,values):d.uv=v
 for name,(kind,values) in attrs.items():
  a=mesh.attributes.new(name,kind,'POINT');extra=[max(values)+1+i for i in range(len(newpoints))] if name.lower()=='_workbench_vertex' else [0]*len(newpoints)
  for d,v in zip(a.data,values+extra):d.value=v
 if edge_sharp:
  a=mesh.attributes.get('sharp_edge') or mesh.attributes.new('sharp_edge','BOOLEAN','EDGE')
  for e in mesh.edges:a.data[e.index].value=edge_sharp.get(tuple(sorted(e.vertices)),False)
 h.data=mesh
 normal_matrix=h.matrix_world.to_3x3().transposed();newnormals=[]
 for face in addedfaces:
  for i in face:
   world=h.matrix_world@(points+newpoints)[i];n=Vector((world.x-.0037,world.y-.024,(world.z-1.052)*.82)).normalized();newnormals.append((normal_matrix@n).normalized())
 mesh.normals_split_custom_set(old_normals+newnormals)
 # Exact existing data preservation (including original custom corner normals).
 check(all((a.co-b.co).length==0 for a,b in zip(old.vertices,mesh.vertices)))
 check(all(tuple(a.vertices)==tuple(b.vertices) for a,b in zip(old.polygons,mesh.polygons)))
 check(all((a-b).length<1e-7 for name,uv in layers.items() for a,b in zip(uv,[v.uv for v in mesh.uv_layers[name].data])))
 errors=sorted((a-b.vector).length for a,b in zip(old_normals,mesh.corner_normals));print('NORMAL_ERROR',errors[-1],errors[len(errors)//2]);check(errors[-1]<.0003,'Existing normal discrepancy')
 # Project-specific oral finish: tiny/degenerate internal UVs must not sample
 # neighbouring skin/iris pixels. Dedicated constant albedos retain every UV.
 if p.get('mouthMaterials'):
  face=bpy.data.objects['face'];assigned=set();check(len(p['mouthMaterials'])==4)
  for spec in p['mouthMaterials']:
   check(spec['region'] in ['upper','lower','tongue','cavity'])
   indices=spec['faces'];check(indices and not assigned.intersection(indices));assigned.update(indices)
   check(all(type(i)==int and 0<=i<len(face.data.polygons) for i in indices))
   check(len(spec['rgb'])==3 and all(type(c)==int and 0<=c<=255 for c in spec['rgb']))
   mat=face.data.materials[0].copy();mat.name=spec['name'];nodes=mat.node_tree.nodes
   for node in nodes:
    if node.type=='TEX_IMAGE':
     for output in node.outputs:
      for link in list(output.links):mat.node_tree.links.remove(link)
   bsdf=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
   def linear(c):
    s=c/255;return s/12.92 if s<=.04045 else ((s+.055)/1.055)**2.4
   rgba=tuple(linear(c) for c in spec['rgb'])+(1,)
   image_path=path.parent/spec['imageFile'];check(image_path.parent==path.parent and digest(image_path)==spec['imageSha256'])
   image=bpy.data.images.load(str(image_path),check_existing=True);image.colorspace_settings.name='sRGB';image.pack()
   tex=nodes.new('ShaderNodeTexImage');tex.name='FITA Oral Albedo';tex.image=image
   bsdf.inputs['Base Color'].default_value=(1,1,1,1);mat.diffuse_color=rgba
   mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
   bsdf.inputs['Roughness'].default_value=.65
   face.data.materials.append(mat);slot=len(face.data.materials)-1
   for i in indices:face.data.polygons[i].material_index=slot
 for spec in p['images']:
  check(spec['object'] in ['hair','outfit'])
  file=path.parent/spec['file'];check(file.parent==path.parent and digest(file)==spec['sha256'])
  obj=bpy.data.objects[spec['object']];im=next(n.image for n in obj.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE' and n.image)
  check(bytes(im.packed_file.data)==(path.parent/spec['originalFile']).read_bytes());im.pack(data=file.read_bytes(),data_len=file.stat().st_size);im.reload()
 if p.get('pupilLayerChanges'):
  check(len(p['pupilLayerChanges'])<=8);seen=set()
  for step in p['pupilLayerChanges']:
   name=step['name'];check(name not in seen and name.startswith(('WB_Pupil_','WB_Glint_')));seen.add(name)
   o=bpy.data.objects.get(name);delta=Vector(step['displacement']);check(o is not None and o.type=='MESH' and o.get('workbench_part')=='head')
   check(all(math.isfinite(c) for c in delta) and 0<=delta.length<.001)
   matrix=o.matrix_world.copy();matrix.translation+=delta;o.matrix_world=matrix
  colour=p['pupilColour'];file=path.parent/colour['file'];check(file.parent==path.parent and digest(file)==colour['sha256'])
  image=bpy.data.images.load(str(file),check_existing=True);image.colorspace_settings.name='sRGB';image.pack()
  for name in seen:
   if not name.startswith('WB_Pupil_'):continue
   for material in bpy.data.objects[name].data.materials:
    for node in material.node_tree.nodes:
     if node.type=='TEX_IMAGE':node.image=image
  bpy.context.view_layer.update()
 return {'projectId':p['projectId'],'addedHairVertices':len(newpoints),'addedHairTriangles':len(addedfaces),'existingTopologyPreserved':True,'existingUVsPreserved':True,'existingHairNormalsPreserved':True,'neckGeometryPreserved':True,'hairMoved':False,'neckPaint':p['neckPaint'],'mouthPaint':p.get('mouthPaint'),'pupilDepthReview':p.get('pupilDepthReview')}

def find_reviewed_patch(job,repo):
 registry=Path(repo)/'.runtime'/'placement-repair-authorizations';source=digest(job['approved']);result=digest(job['input'])
 if not registry.exists():return None
 for entry in registry.glob('*.json'):
  try:grant=json.loads(entry.read_text())
  except (ValueError,OSError):continue
  if grant.get('approvedSourceSha256')!=source or grant.get('resultSha256')!=result:continue
  check(job.get('lockNeck') is True)
  check(grant.get('schema')=='fita-reviewed-model-repair/v1')
  check(str(uuid.UUID(grant['projectId']))==grant['projectId'] and str(uuid.UUID(grant['handoffId']))==grant['handoffId'])
  root=(repo/'projects'/grant['projectId']/'codex'/'model-finish'/grant['handoffId']/'output').resolve();patch=Path(grant['patchFile']).resolve()
  check(patch.parent==root and digest(patch)==grant['patchSha256']);p=json.loads(patch.read_text());check(p['sourceSha256']==source and p['projectId']==grant['projectId'])
  return patch
 return None

def replay_authorized(job):
 patch=find_reviewed_patch(job,Path(__file__).resolve().parents[2])
 if patch is None:return None
 report=apply_patch(patch);report['authorization']='explicit user request, exact reviewed source/result/patch hashes';return report

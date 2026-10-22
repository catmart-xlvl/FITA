"""Spatial grouping checks using actual mesh geometry; no Studio or credits."""
import bpy, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server'/'blender'))
import segment_mesh as seg

def region(lo,hi,area,face):
    return {'bounds':[lo,hi],'surfaceArea':area,'faces':[face]}

# Separate UV-seam islands and ornaments in contact must keep one atlas.
near=[region([0,0,0],[1,1,1],1,0),region([1.001,0,0],[1.2,1,1],.05,1)]
assert not seg.spatial_audit(near,2)['requiresReview']
far=[region([-.8,0,1.3],[.8,.1,1.8],1,0),region([-.2,0,0],[.2,.1,.9],1,1)]
assert seg.spatial_audit(far,2)['requiresReview']
# A small cuff well away from the outfit still demands local reassignment.
cuff=region([1.4,0,1.3],[1.5,.1,1.4],.02,2)
assert seg.spatial_audit([far[1],cuff],2)['requiresReview']
debris=region([4,0,0],[4.001,.001,.001],.00001,3)
assert not seg.spatial_audit([far[1],debris],2)['requiresReview']
# Bounds/area come from transformed source geometry, not caller-supplied metadata.
bpy.ops.wm.read_factory_settings(use_empty=True)
data=bpy.data.meshes.new('islands');data.from_pydata([(0,0,0),(1,0,0),(0,1,0),(0,0,3),(1,0,3),(0,1,3)],[],[(0,1,2),(3,4,5)])
obj=bpy.data.objects.new('body',data);bpy.context.scene.collection.objects.link(obj);obj['workbench_part']='body'
ids=data.attributes.new(seg.FACE_ID,'INT','FACE')
for i,row in enumerate(ids.data):row.value=i
obj.scale=(2,2,2);bpy.context.view_layer.update()
regions=seg.components([obj]);assert len(regions)==2
assert regions[0]['surfaceArea']==2 and regions[1]['bounds'][0][2]==6
audit=seg.spatial_audit(regions,6);assert audit['requiresReview']
assert sorted(f for c in audit['clusters'] for f in c['faces'])==[0,1]
print('SEGMENTATION_SPATIAL_OK: large gaps, nearby seams, cuff locality, debris, world transforms and face coverage')

"""Analysis renders must not overwrite the approved input references."""
import bpy, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'server/blender'))
import segment_mesh

root = Path(tempfile.mkdtemp(prefix='fita-reference-preservation-'))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
source = root/'mesh.glb'
bpy.ops.export_scene.gltf(filepath=str(source),export_format='GLB')
references = {}
for part in ('head','body'):
    for view in ('front','left','right','back'):
        file = root/(part+'_'+view+'.png')
        references[file] = ('approved '+part+' '+view).encode()
        file.write_bytes(references[file])

# Rendering itself is covered by visual review; this regression exercises the
# real import/analyze/write path while recording its output destinations.
rendered = []
def render(objects, folder, prefix):
    folder = Path(folder)
    folder.mkdir(parents=True,exist_ok=True)
    for view in ('front','left','right','back'):
        file = folder/(prefix+'_'+view+'.png')
        file.write_bytes(b'geometry preview')
        rendered.append(file)
segment_mesh.render_views = render
job = {'sources':{'head':str(source),'body':str(source)},'directory':str(root)}
segment_mesh.analyze(job)
assert len(rendered) == 8
assert all(file.parent == root/'analysis-preview' for file in rendered)
assert all(file.read_bytes() == content for file,content in references.items())
assert (root/'source.blend').exists() and (root/'analysis.json').exists()
print('SEGMENTATION_REFERENCE_PRESERVATION_OK')

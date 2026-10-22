"""Render an asymmetric fixture: anatomical side, nose direction, no mirroring."""
import bpy, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'server/blender'))
import segment_mesh

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.view_settings.view_transform = 'Standard'
root = Path(tempfile.mkdtemp(prefix='fita-anatomical-guides-'))

def emission(name, color):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    light = nodes.new('ShaderNodeEmission')
    light.inputs['Color'].default_value = (*color, 1)
    material.node_tree.links.new(light.outputs[0], output.inputs['Surface'])
    return material

red = emission('Anatomical right (-X)', (1, 0, 0))
green = emission('Anatomical left (+X)', (0, 1, 0))
gray = emission('Other surfaces', (.25, .25, .25))
yellow = emission('Nose points forward (-Y)', (1, 1, 0))
bpy.ops.mesh.primitive_cube_add()
head = bpy.context.object
head.scale = (.5, .5, .7)
for material in (gray, red, green):
    head.data.materials.append(material)
for polygon in head.data.polygons:
    polygon.material_index = 1 if polygon.normal.x < -.9 else 2 if polygon.normal.x > .9 else 0
bpy.ops.mesh.primitive_cube_add(location=(0, -.7, 0), scale=(.15, .2, .15))
nose = bpy.context.object
nose.data.materials.append(yellow)
objects = [head, nose]
before = [(obj.matrix_world.copy(), [v.co.copy() for v in obj.data.vertices]) for obj in objects]
segment_mesh.render_views(objects, root, 'fixture', ('front','right','left','back','threequarter-right','threequarter-left'))
for obj, (matrix, vertices) in zip(objects, before):
    assert obj.matrix_world == matrix
    assert all(v.co == old for v, old in zip(obj.data.vertices, vertices))

for side in ('right', 'left', 'threequarter-right', 'threequarter-left'):
    image = bpy.data.images.load(str(root/('fixture_'+side+'.png')))
    pixels = list(image.pixels)
    width = image.size[0]
    red_pixels = green_pixels = 0
    nose_x = []
    for offset in range(0, len(pixels), 4):
        r,g,b,a = pixels[offset:offset+4]
        if a < .9:
            continue
        if r > .5 and g < .1 and b < .1:
            red_pixels += 1
        if g > .5 and r < .1 and b < .1:
            green_pixels += 1
        if r > .5 and g > .5 and b < .1:
            nose_x.append((offset//4) % width)
    expected, wrong = (red_pixels, green_pixels) if side.endswith('right') else (green_pixels, red_pixels)
    assert expected > 1000 and wrong < expected*.01, (side, red_pixels, green_pixels)
    if side in ('right', 'left'):
        assert nose_x
        mean_x = sum(nose_x)/len(nose_x)
        assert (mean_x > width/2) == (side == 'right'), (side, mean_x)
print('SEGMENTATION_ANATOMICAL_GUIDES_OK', root)

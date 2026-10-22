"""Build our original, unskinned humanoid template. Run with Blender --background."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'templates' / 'rigs' / 'humanoid-v1'
OUT.mkdir(parents=True, exist_ok=True)
source = json.loads((ROOT / 'docs' / 'VRCHAT_RIG_PROFILE_V1.json').read_text(encoding='utf-8'))
points = {
    'Hips': ((0, 0, .91), (0, 0, 1.02)),
    'Spine': ((0, 0, 1.02), (0, 0, 1.20)),
    'Chest': ((0, 0, 1.20), (0, 0, 1.40)),
    'Neck': ((0, 0, 1.40), (0, 0, 1.48)),
    'Head': ((0, 0, 1.48), (0, 0, 1.70)),
    'Jaw': ((0, -.025, 1.52), (0, -.075, 1.50)),
}
bones = []
for original in source['bones']:
    bone = {k: original[k] for k in ('name', 'parent', 'unityHumanBone', 'requirementTier', 'presence')}
    name = bone['name'][3:]
    if name in points:
        head, tail = points[name]
    else:
        side = name[-1]
        sign = 1 if side == 'L' else -1
        part = name[:-2]
        limb = {
            'Eye': ((.032, -.060, 1.587), (.032, -.085, 1.587)),
            'Shoulder': ((.045, 0, 1.385), (.155, 0, 1.385)),
            'UpperArm': ((.155, 0, 1.385), (.405, .018, 1.385)),
            'LowerArm': ((.405, .018, 1.385), (.645, 0, 1.385)),
            'Hand': ((.645, 0, 1.385), (.725, 0, 1.385)),
            'UpperLeg': ((.085, 0, .91), (.095, -.025, .49)),
            'LowerLeg': ((.095, -.025, .49), (.095, 0, .085)),
            'Foot': ((.095, 0, .085), (.095, -.115, .040)),
            'Toes': ((.095, -.115, .040), (.095, -.185, .035)),
        }
        if part in limb:
            head, tail = limb[part]
        else:
            finger, segment = part.split('_')
            segment = int(segment) - 1
            depth = {'Thumb': -.047, 'Index': -.032, 'Middle': -.011, 'Ring': .013, 'Little': .034}[finger]
            length = {'Thumb': .022, 'Index': .025, 'Middle': .028, 'Ring': .026, 'Little': .021}[finger]
            start = .680 if finger == 'Thumb' else .724
            head = (start + segment * length, depth, 1.385)
            tail = (start + (segment + 1) * length, depth, 1.385)
        head, tail = tuple(sign * v if i == 0 else v for i, v in enumerate(head)), tuple(sign * v if i == 0 else v for i, v in enumerate(tail))
    bone.update(head=list(head), tail=list(tail), deform=True, role='humanoid')
    bones.append(bone)

recipes = []
for side in ('L', 'R'):
    for part, ratio in (('UpperArm', .5), ('UpperLeg', .5), ('LowerArm', .35), ('LowerArmWrist', .75)):
        core = next(b for b in bones if b['name'] == 'WB_' + ('LowerArm' if part == 'LowerArmWrist' else part) + '_' + side)
        start = .65 if part == 'LowerArmWrist' else .30
        delta = [b - a for a, b in zip(core['head'], core['tail'])]
        name = 'WB_' + ('LowerArmTwistWrist' if part == 'LowerArmWrist' else part + 'Twist') + '_' + side
        forearm = part.startswith('LowerArm')
        bones.append(dict(name=name, parent=core['name'] if forearm else core['parent'], unityHumanBone=None,
                          head=[a + start*d for a, d in zip(core['head'], delta)],
                          tail=[a + .95*d for a, d in zip(core['head'], delta)],
                          deform=True, role='twist', presence='included', requirementTier='workbench-auxiliary'))
        recipes.append(dict(bone=name, source=('WB_Hand_' + side) if forearm else core['name'],
                            type='axial-twist' if forearm else 'swing-and-reduced-twist', fraction=ratio,
                            axis='local-Y', status='prototype-revalidate-after-fitting'))

profile = dict(schema='workbench-humanoid-template/v1', id='wb-humanoid-v1', version=1,
               status='prototype', heightMeters=1.70, authoringSpace=dict(up='+Z', forward='-Y', units='meters'),
               bones=bones, twistRecipes=recipes, skinning=dict(maxInfluences=4, normalized=True),
               secondaryMotion=dict(policy='per-character chains', attachments=['WB_Head', 'WB_Chest', 'WB_Hips']),
               acceptance=dict(weights='not-generated', deformation='not-tested', unity='not-tested', trackers='not-tested'))
(OUT / 'profile.json').write_text(json.dumps(profile, indent=2) + '\n', encoding='utf-8')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
arm = bpy.data.armatures.new('WB_Humanoid')
obj = bpy.data.objects.new('WB_Humanoid', arm)
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
obj.show_in_front = True
obj['template_id'] = profile['id']
obj['template_status'] = 'Prototype: fit joints, skin and validate per character.'
bpy.ops.object.mode_set(mode='EDIT')
for spec in bones:
    bone = arm.edit_bones.new(spec['name'])
    bone.head, bone.tail = spec['head'], spec['tail']
    # A shared roll convention makes axial-Y drivers predictable in this template.
    bone.align_roll(Vector((0, 0, 1)) if abs((bone.tail-bone.head).normalized().z) < .9 else Vector((0, -1, 0)))
    bone.use_deform = True
for spec in bones:
    if spec['parent']:
        arm.edit_bones[spec['name']].parent = arm.edit_bones[spec['parent']]
    arm.edit_bones[spec['name']].use_connect = False
bpy.ops.object.mode_set(mode='POSE')
for recipe in recipes:
    pose = obj.pose.bones[recipe['bone']]
    pose.rotation_mode = 'QUATERNION'
    ratio = recipe['fraction']
    # Built-in driver expressions only: no autoexec, custom namespace or handlers.
    # q * twist(q)^(ratio-1) preserves swing while reducing axial torsion.
    angle = f'({ratio - 1})*atan2(y,w)'
    c, s = f'cos({angle})', f'sin({angle})'
    expressions = [f'w*{c}-y*{s}', f'x*{c}-z*{s}', f'w*{s}+y*{c}', f'x*{s}+z*{c}']
    if recipe['type'] == 'axial-twist':
        angle = f'{ratio}*atan2(y,w)'
        expressions = [f'cos({angle})', '0', f'sin({angle})', '0']
    for index, expression in enumerate(expressions):
        driver = pose.driver_add('rotation_quaternion', index).driver
        for key in ('w', 'x', 'y', 'z'):
            variable = driver.variables.new()
            variable.name, variable.type = key, 'TRANSFORMS'
            target = variable.targets[0]
            target.id, target.bone_target = obj, recipe['source']
            target.transform_type = 'ROT_' + key.upper()
            target.rotation_mode, target.transform_space = 'QUATERNION', 'LOCAL_SPACE'
        driver.expression = expression
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'template.blend'), compress=False)

# Portable inspection representation: explicit joints in glTF's Y-up space.
def gltf(v):
    return [v[0], v[2], -v[1]]
nodes = []
indices = {b['name']: i for i, b in enumerate(bones)}
for bone in bones:
    parent = next((b for b in bones if b['name'] == bone['parent']), None)
    origin = parent['head'] if parent else (0, 0, 0)
    nodes.append(dict(name=bone['name'], translation=gltf([a-b for a,b in zip(bone['head'],origin)]),
                      extras=dict(wbBone=True, role=bone['role'], boneTail=gltf([a-b for a,b in zip(bone['tail'],bone['head'])]))))
for i, bone in enumerate(bones):
    if bone['parent']:
        nodes[indices[bone['parent']]].setdefault('children', []).append(i)
doc = dict(asset=dict(version='2.0', generator='FITA original humanoid template'),
           scene=0, scenes=[dict(nodes=[indices['WB_Hips']])], nodes=nodes,
           extras=dict(template=profile['id'], unskinned=True))
raw = json.dumps(doc, separators=(',', ':')).encode('utf-8')
raw += b' ' * (-len(raw) % 4)
import struct
(OUT / 'template.glb').write_bytes(struct.pack('<III', 0x46546C67, 2, len(raw)+20) + struct.pack('<II', len(raw), 0x4E4F534A) + raw)
print('WORKBENCH_TEMPLATE', len(bones), str(OUT))

"""Read-only validation of the saved template and its built-in drivers."""
import bpy
import json
from pathlib import Path
from mathutils import Quaternion

root = Path(__file__).resolve().parents[1]
profile = json.loads((root/'templates/rigs/humanoid-v1/profile.json').read_text())
obj = bpy.data.objects['WB_Humanoid']
assert len(obj.data.bones) == 62
assert len(obj.animation_data.drivers) == 32
for spec in profile['bones']:
    bone = obj.data.bones[spec['name']]
    assert (bone.parent.name if bone.parent else None) == spec['parent']
    assert bone.length > .001
for source, target, expected in [
    ('WB_UpperArm_L','WB_UpperArmTwist_L',.6),
    ('WB_UpperLeg_R','WB_UpperLegTwist_R',.6),
    ('WB_Hand_L','WB_LowerArmTwistWrist_L',.9),
]:
    bone = obj.pose.bones[source]
    bone.rotation_mode = 'QUATERNION'
    bone.rotation_quaternion = Quaternion((0,1,0),1.2)
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    actual = evaluated.pose.bones[target].rotation_quaternion.angle
    assert abs(actual-expected) < .001, (source,actual,expected)
    bone.rotation_quaternion = Quaternion()
    bpy.context.view_layer.update()
assert all(curve.driver.is_valid for curve in obj.animation_data.drivers)
print('RIG_TEMPLATE_VALIDATED: 62 nonzero bones, 32 valid drivers, 3 torsion checks. No source saved.')

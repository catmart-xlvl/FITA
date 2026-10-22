"""Hash-bound exception must never be supplied or widened by an imported ZIP."""
import sys,json,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'server/blender'))
from scoped_finish_repair import find_reviewed_patch,digest
with tempfile.TemporaryDirectory() as tmp:
 r=Path(tmp);pid='61099cdb-23f1-49b3-ab40-b1f258c61914';hid='0d83e3d3-fe3e-4e44-bf0f-1f72188ba1f9';out=r/'projects'/pid/'codex/model-finish'/hid/'output';out.mkdir(parents=True)
 approved=r/'source.blend';result=r/'result.blend';approved.write_bytes(b'approved saved geometry');result.write_bytes(b'reviewed artifact');patch=out/'repair.json';patch.write_text(json.dumps({'sourceSha256':digest(approved),'projectId':pid}))
 job={'approved':str(approved),'input':str(result),'lockNeck':True}
 grant={'schema':'fita-reviewed-model-repair/v1','approvedSourceSha256':digest(approved),'resultSha256':digest(result),'projectId':pid,'handoffId':hid,'patchFile':str(patch),'patchSha256':digest(patch)}
 assert find_reviewed_patch(job,r) is None
 # An approval placed next to the submitted result has no authority.
 (out/'approval.json').write_text(json.dumps(grant));assert find_reviewed_patch(job,r) is None
 reg=r/'.runtime/placement-repair-authorizations';reg.mkdir(parents=True);file=reg/'reviewed.json';file.write_text(json.dumps(grant));assert find_reviewed_patch(job,r)==patch
 def rejected(fn):
  try:fn()
  except (ValueError,KeyError):return
  raise AssertionError('Invalid approval accepted')
 rejected(lambda:find_reviewed_patch(dict(job,lockNeck=False),r))
 result.write_bytes(b'modified UV, position or texture');assert find_reviewed_patch(job,r) is None;result.write_bytes(b'reviewed artifact')
 approved.write_bytes(b'other project source');assert find_reviewed_patch(job,r) is None;approved.write_bytes(b'approved saved geometry')
 patch.write_text('{}');rejected(lambda:find_reviewed_patch(job,r));patch.write_text(json.dumps({'sourceSha256':digest(approved),'projectId':pid}))
 grant['handoffId']='../../escape';file.write_text(json.dumps(grant));rejected(lambda:find_reviewed_patch(job,r))
print('SCOPED_REPAIR_POLICY_OK: exact source/result/patch only; default strict, submitted approval ignored, tampering and path escape rejected')

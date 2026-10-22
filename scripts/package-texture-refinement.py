"""Package the local atlas-only refinement, never the delivery token."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parent
report = json.loads((root / 'report.json').read_text(encoding='utf-8'))
assert report.get('reviewed') is True and report.get('pending') == [], 'Revisa el resultado y resuelve los pendientes'
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
if manifest.get('coverageCleanup', {}).get('required') or any(g.get('status') == 'temporary' for g in manifest.get('coverage', [])):
    review = report.get('coverageReview', {})
    assert review.get('status') == 'checked' and review.get('conceptCompared') is True and review.get('modelInspected') is True, 'Completa la revision obligatoria de cobertura temporal contra concepto y malla'
    assert {g['groupId'] for g in review.get('groups', [])} == {g['groupId'] for g in manifest.get('coverage', [])}, 'Falta revisar la cobertura de algun grupo'
with ZipFile(root / 'texture_refinement.zip', 'w', ZIP_DEFLATED) as output:
    for name in ('manifest.json', 'report.json'):
        output.write(root / name, name)
    for part in ('head', 'body'):
        output.write(root / 'result' / (part + '.glb'), part + '.glb')
print('texture_refinement.zip')

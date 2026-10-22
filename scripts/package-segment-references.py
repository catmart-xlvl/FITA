"""Build the strict image-only delivery; no external dependencies."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
assert manifest['schema'] == 'workbench-segment-references/v1'
names = [name for group in manifest['groups'] for name in group['files']]
assert len(names) == len(set(names)) == len(manifest['groups']) * 3
if manifest.get('coveragePolicy'):
    coverage = json.loads((root / 'coverage.json').read_text(encoding='utf-8'))
    assert all(g['status'] in ('none', 'temporary') for g in coverage['groups']), 'Completa coverage.json'
    names.append('coverage.json')
for name in names:
    file = (root / name).resolve()
    assert file.is_relative_to(root) and file.is_file(), name
with ZipFile(root / 'texture_references.zip', 'w', ZIP_DEFLATED) as output:
    for name in ['manifest.json', *names]:
        output.write(root / name, name)
print('texture_references.zip')

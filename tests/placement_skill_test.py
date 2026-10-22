"""Isolated contract tests; synthetic evidence is not an artistic approval."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

script = Path(__file__).resolve().parents[1] / 'skills/colocacion-personaje-por-referencias/scripts/check_review.py'
spec = importlib.util.spec_from_file_location('review', script)
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ReviewEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        def item(name):
            (self.root / name).write_bytes(('synthetic ' + name).encode())
            return {'file': name, 'sha256': review.digest(self.root / name)}
        self.evidence = {'scene': item('placed.blend'), 'renders': {}, 'references': {}, 'necks': {}}
        self.record = {'schema': 'placement-visual-review/v1', 'sceneSha256': self.evidence['scene']['sha256'], 'comparisons': {}, 'neck': {}, 'unresolved': [], 'artistApprovalPending': True}
        for view in review.VIEWS:
            self.evidence['renders'][view] = {**item(view + '.png'), 'anatomicalView': view}
            self.evidence['references'][view] = item('reference_' + view + '.png')
            self.evidence['necks'][view] = item('neck_' + view + '.png')
            self.record['comparisons'][view] = {'reference': 'reference_' + view + '.png', 'findings': 'synthetic fixture only', 'acceptable': True}
            self.record['neck'][view] = {'image': 'neck_' + view + '.png', 'findings': 'synthetic fixture only', 'acceptable': True}
        self.save()

    def save(self):
        (self.root / 'review-evidence.json').write_text(json.dumps(self.evidence), encoding='utf-8')
        (self.root / 'placement-review.json').write_text(json.dumps(self.record), encoding='utf-8')

    def test_complete_is_not_automatic_artistic_approval(self):
        self.assertFalse(review.validate(self.root)['artisticQualityAutomaticallyVerified'])

    def test_scene_change_invalidates_review(self):
        (self.root / 'placed.blend').write_bytes(b'other scene')
        with self.assertRaisesRegex(ValueError, 'Changed evidence'):
            review.validate(self.root)

    def test_wrong_side_reference_rejected(self):
        self.record['comparisons']['left']['reference'] = 'reference_right.png'
        self.save()
        with self.assertRaisesRegex(ValueError, 'Wrong-side'):
            review.validate(self.root)

    def test_missing_neck_image_rejected(self):
        (self.root / 'neck_left.png').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing'):
            review.validate(self.root)

    def test_changed_reference_rejected(self):
        (self.root / 'reference_right.png').write_bytes(b'new ref')
        with self.assertRaisesRegex(ValueError, 'Changed evidence'):
            review.validate(self.root)

    def test_hidden_unreviewed_neck_rejected(self):
        self.record['neck']['left']['acceptable'] = False
        self.save()
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            review.validate(self.root)


if __name__ == '__main__':
    unittest.main()

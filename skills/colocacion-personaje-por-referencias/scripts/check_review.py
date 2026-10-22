"""Validate evidence integrity and review completeness, never artistic quality."""
import argparse
import hashlib
import json
from pathlib import Path

VIEWS = ('front', 'left', 'right')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local(root, name):
    path = (root / name).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError('Missing or nonlocal evidence: ' + name)
    return path


def check_file(root, item):
    if digest(local(root, item['file'])) != item['sha256']:
        raise ValueError('Changed evidence: ' + item['file'])


def validate(root):
    evidence = json.loads((root / 'review-evidence.json').read_text(encoding='utf-8'))
    review = json.loads((root / 'placement-review.json').read_text(encoding='utf-8'))
    check_file(root, evidence['scene'])
    if review.get('schema') != 'placement-visual-review/v1' or review.get('sceneSha256') != evidence['scene']['sha256']:
        raise ValueError('Review belongs to a different scene')
    if review.get('artistApprovalPending') is not True or review.get('unresolved') != []:
        raise ValueError('Keep artist approval pending and resolve technical findings')
    for view in VIEWS:
        render = evidence['renders'][view]
        if render.get('anatomicalView') != view:
            raise ValueError('Mismatched anatomical view: ' + view)
        for item in (render, evidence['references'][view], evidence['necks'][view]):
            check_file(root, item)
        comparison = review['comparisons'][view]
        neck = review['neck'][view]
        if comparison.get('reference') != evidence['references'][view]['file'] or neck.get('image') != evidence['necks'][view]['file']:
            raise ValueError('Wrong-side reference or neck image: ' + view)
        for item in (comparison, neck):
            if item.get('acceptable') is not True or not str(item.get('findings', '')).strip():
                raise ValueError('Incomplete visual review: ' + view)
    return {'evidenceComplete': True, 'artisticQualityAutomaticallyVerified': False, 'artistApprovalPending': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--capture-necks', action='store_true')
    args = parser.parse_args()
    if args.capture_necks:
        path = args.directory / 'review-evidence.json'
        evidence = json.loads(path.read_text(encoding='utf-8'))
        check_file(args.directory, evidence['scene'])
        evidence['necks'] = {view: {'file': 'neck_' + view + '.png', 'sha256': digest(local(args.directory, 'neck_' + view + '.png'))} for view in VIEWS}
        path.write_text(json.dumps(evidence, indent=2), encoding='utf-8')
        print('Neck files recorded; visual review still required.')
    else:
        print(json.dumps(validate(args.directory)))


if __name__ == '__main__':
    main()

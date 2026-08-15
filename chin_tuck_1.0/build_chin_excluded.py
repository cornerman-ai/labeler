"""Bake chin_excluded.json — frames the chin labeler hides from the queue.

Fetches one labeler's Chin Labels rows from the Apps Script backend (URL
parsed from player.js) and writes the (video, round, frame) keys they
skipped as occluded / unclear / bad_box, intersected with the current
chin_frames.json samples. chin_tuck.js filters these out of everyone's
queue: a triage pass by one labeler keeps unjudgeable frames away from
the expensive reviewer. The skip labels themselves stay in the sheet —
delete chin_excluded.json (or re-run after relabeling) to bring frames back.

Usage:
  python3 build_chin_excluded.py            # triage labeler: Mathe
  python3 build_chin_excluded.py --labeler X
"""

import argparse
import json
import re
import urllib.parse
import urllib.request
import os

HERE = os.path.dirname(os.path.abspath(__file__))
EXCLUDE_REASONS = ('occluded', 'unclear', 'bad_box')


def script_url():
    src = open(os.path.join(HERE, 'player.js')).read()
    m = re.search(r"scriptUrl: '([^']+)'", src)
    if not m:
        raise SystemExit('no scriptUrl in player.js')
    return m.group(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--labeler', default='Mathe')
    args = ap.parse_args()

    with open(os.path.join(HERE, 'chin_frames.json')) as f:
        current = {v['stem']: {(s['round'], s['frame']) for s in v['samples']}
                   for v in json.load(f)['videos']}

    url = (script_url() + '?' + urllib.parse.urlencode(
        {'action': 'listChinLabels', 'labeler': args.labeler}))
    body = json.load(urllib.request.urlopen(url))
    if body.get('status') != 'ok':
        raise SystemExit('listChinLabels failed: ' + str(body))

    excluded = {}
    n = 0
    for r in body['rows']:
        reason = r.get('skip_reason')
        if reason not in EXCLUDE_REASONS:
            continue
        key = (int(r['round']), int(r['frame']))
        if key not in current.get(r['video'], set()):
            continue                     # orphan from an older playlist/sampling
        excluded.setdefault(r['video'], []).append(
            {'round': key[0], 'frame': key[1], 'reason': reason})
        n += 1

    for lst in excluded.values():
        lst.sort(key=lambda e: (e['round'], e['frame']))
    out = os.path.join(HERE, 'chin_excluded.json')
    with open(out, 'w') as f:
        json.dump({'labeler': args.labeler, 'videos': excluded}, f, indent=1)
    print(f'{n} excluded frames across {len(excluded)} videos -> {out}')


if __name__ == '__main__':
    main()

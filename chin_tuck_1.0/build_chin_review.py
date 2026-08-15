"""Build the Google-Sheet review pack for the chin-tuck queue.

For reviewers who'd rather work in a spreadsheet than the web labeler
(chin_tuck.html): number every frame in the current queue (PLAYLIST order,
triage-excluded frames removed — exactly what the page shows) and write

  chin_review.json      repo — consumed by the Apps Script function
                        buildChinReviewSheet() (MyCorner menu), which
                        renders each row as number | =IMAGE() | verdict
                        dropdown | comment. importChinReviewLabels() later
                        moves the picks into the Chin Labels sheet.
  <drive>/NNN.jpg       numbered copies of the same frames in a Drive
                        folder (default under Cornerman/data/coach_media/chin_tuck) as a
                        backup way to view them full-size — share it with
                        the reviewer alongside the sheet.

Re-running is safe: numbering is derived from the committed queue files,
so it only changes if the playlist / sampling / exclusions change (which
would orphan an in-progress review sheet — rebuild it then).

Usage:
  python3 build_chin_review.py
"""

import argparse
import json
import os
import re
import shutil
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES_BASE = 'https://cornerman-ai.github.io/labeler/chin_tuck/frames/'
DRIVE_DIR = ('/Users/mathewieme/Google Drive/My Drive/Cornerman/data/'
             'coach_media/chin_tuck/review_frames')


def playlist_from_page():
    src = open(os.path.join(HERE, 'chin_tuck.js')).read()
    m = re.search(r'const PLAYLIST = \[(.*?)\];', src, re.S)
    pairs = re.findall(r"'([^']+)'|\"([^\"]+)\"", m.group(1))
    return [a or b for a, b in pairs]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--drive-dir', default=DRIVE_DIR)
    args = ap.parse_args()

    with open(os.path.join(HERE, 'chin_frames.json')) as f:
        by_stem = {v['stem']: v for v in json.load(f)['videos']}
    excluded = {}
    exc_path = os.path.join(HERE, 'chin_excluded.json')
    if os.path.exists(exc_path):
        with open(exc_path) as f:
            for stem, lst in json.load(f)['videos'].items():
                excluded[stem] = {(e['round'], e['frame']) for e in lst}

    rows = []
    for stem in playlist_from_page():
        v = by_stem.get(stem)
        if v is None:
            raise SystemExit(f'playlist stem not in chin_frames.json: {stem}')
        for s in v['samples']:
            if (s['round'], s['frame']) in excluded.get(stem, set()):
                continue
            if s.get('rep'):
                continue          # same frame as its rep=0 original — one card is enough
            fname = f"r{s['round']}_f{s['frame']}.jpg"
            rows.append({
                'n': f'{len(rows) + 1:03d}',
                'stem': stem,
                'round': s['round'],
                'frame': s['frame'],
                'url': PAGES_BASE + urllib.parse.quote(stem) + '/' + fname,
                'local': os.path.join(HERE, 'frames', stem, fname),
            })

    os.makedirs(args.drive_dir, exist_ok=True)
    for r in rows:
        shutil.copyfile(r['local'], os.path.join(args.drive_dir, r['n'] + '.jpg'))

    out = os.path.join(HERE, 'chin_review.json')
    with open(out, 'w') as f:
        json.dump({'rows': [{k: r[k] for k in ('n', 'stem', 'round', 'frame', 'url')}
                            for r in rows]}, f, indent=1)
    print(f'{len(rows)} frames -> {out}')
    print(f'numbered copies -> {args.drive_dir}')


if __name__ == '__main__':
    main()

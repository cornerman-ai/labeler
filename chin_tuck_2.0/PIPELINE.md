# chin_tuck 2.0 — data pipeline

How the 3,791 frames in this folder were chosen. Every number below was
measured from the actual run, not estimated.

Built 2026-08-07. Source of truth for the sampling itself is
`cornerman-backend/ml/research/chin_tuck/v2/chin_sampler_v2.py`.

## Counts at every step

| # | step | videos | rounds | frames |
|---|---|---|---|---|
| 0 | Source `.mp4` files | 268 | — | — |
| 1 | Have a BlazePose cache | **206** | 472 | 810,493 |
| 2 | Covered by Combined Data (stance) | **200** | 445 | 775,629 |
| 3 | Pass the visibility gate | 200 | 445 | **767,485** |
| 4 | Selected for labeling | 200 | **426** | **3,791** |
| 5 | Exported as JPEG | 200 | 426 | 3,791 |

A **video** is one source file. A **round** is one continuously tracked segment
inside it — tracking breaks whenever the boxer leaves frame or the camera cuts,
so one video yields 1–24 rounds (125 of the 200 have exactly one).

## What happens at each step

### 0 → 1 · Pose tracking

Not part of this pipeline — the BlazePose caches already existed. 64 of the 268
videos have no cache and are therefore invisible here. Each cached round is a
trio of files: `<stem>_blazepose_r<N>.npy` (the joints), `_pts.npy` (each
frame's timestamp in seconds) and `_meta.json` (fps, span). All 472 trios are
complete.

### 1 → 2 · Stance filter

Drops **6 videos / 27 rounds** that have no row in the Combined Data sheet.

Combined Data is the only place stance is recorded, and stance decides which
shoulder is the **lead** shoulder. Every 2.0 question is asked against the lead
shoulder, so a frame whose stance cannot be looked up is not labelable — no
matter how good its pose data is.

Excluded: `15 MINUTE FAT BURNING BOXING BAG WORKOUT [FOLLOW ALONG]`,
`30 Minutes FULL Boxing Workout ｜ Follow Along`,
`Full POWER Bag Work ｜ Follow Along Session`, `IMG_6683`, `IMG_6694`,
`IMG_6743`. All six are genuine absences, not filename mismatches — normalized
matching finds no near-hit for any of them. To recover one, punch-label it in
Combined Data first.

(2 cached stems have no source video, `IMG_6683` and `IMG_6743` — both already
dropped here, so they cost nothing.)

### 2 → 3 · Visibility gate

Every frame is tested: **nose, both mouth corners, and both shoulders** must all
be present and tracked at confidence **≥ 0.6**. 767,485 of 775,629 frames pass
and form the pool to draw from. Frames where the boxer turns away, or the
tracker loses the head, are discarded here.

These 5 joints are exactly the ones that define the chin crop box, so a frame
that fails the gate could not be cropped anyway.

### 3 → 4 · Selection

Per video, from its pool:

1. shuffle into random order (seeded per video from `seed = 0`)
2. walk the shuffled list, taking each frame **unless it falls within 2.0s of
   one already taken**
3. stop at **25**
4. sort what was taken by timestamp

**All rounds of a video share one pool.** Frames are not drawn per round, so a
round is only represented if its frames happen to win draws. In 6 many-round
videos the 25 picks ran out before every round was reached — 19 rounds got
nothing, while those videos still produced a full 25 frames each. Videos with
one round cannot be affected.

**89 of 200 videos came in under 25.** 25 frames spaced 2.0s apart need ≥48s of
footage; the median video has ~90s but the short tail bottoms out at 2 frames
from 10.8s. Greedy random placement also saturates near 75% of the densest
possible packing (Rényi's constant), so ~67s is the realistic threshold, not 48s.

Worked example — *10 Minute Shadow Boxing Workout At Home*, 103.5s, 3 rounds,
3,108 eligible frames, 25 picked:

```
146.9  149.5  156.3  159.0  165.1  167.1  174.2  …  248.2  252.1
     2.6    6.8    2.7    6.1    2.0    7.1
```

Closest pair exactly 2.0s, widest 10.2s.

**Why the gap rule:** without it, random picking regularly grabs frames
hundredths of a second apart — near-identical images. That is paying a labeler
twice for one answer. 2.0s guarantees the boxer has moved.

### Stance, assigned per frame

Not per video: 18 videos carry both stances in Combined Data, and 6 of those are
genuine mid-video stance switches (the other 12 are 1–3 row typos). Each frame
takes the stance of the punch interval containing it, or of the nearest one, and
records the distance in `stance_dist`.

- **2,050 / 3,791** sit inside a labeled punch (`stance_dist = 0`)
- median 0.0s, p90 1.0s, max 53s — only 11 frames beyond 30s
- split is **3,188 Orthodox / 603 Southpaw** (84/16), inherited from the footage

Nearest-interval lookup is what makes the 12 stray stance typos harmless: a
single bad row 200s away never wins.

### 4 → 5 · Export

ffmpeg seeks each frame's timestamp in the source video and writes a
full-resolution JPEG (`-q:v 2`), seeking half a frame early so the first decoded
frame is exactly the sampled one. 3,791 extracted, 0 missing, **666 MB**.

## Parameters

| param | value | vs 1.0 |
|---|---|---|
| `vis_min` | 0.6 | was 0.5 |
| `target_per_video` | 25 (flat) | was 4–10/min, capped 40 then 20 |
| `min_gap_sec` | 2.0 | was 1.5 |
| `repeats` | 0 | was 2/video |
| `box_scale` | 1.3 | unchanged |
| `seed` | 0 | unchanged |
| stance source | `Box Labeled Data.xlsx : Combined Data` | new — 2.0 only |

A flat per-video target replaces 1.0's per-minute rate so a 20-minute
follow-along carries no more weight than a 2-minute critique clip.

The run is **deterministic**: same inputs and parameters reproduce the file
byte-for-byte (verified).

## Output

```
chin_tuck_2.0/
  chin_frames.json       the 3,791 frames to label
  exported_videos.json   the 200 stems whose JPEGs are ready
  frames/<video>/r<round>_f<frame>.jpg    666 MB
  skeletons/<video>/r<round>_f<frame>.npy 4.5 MB
  chins/chin_points.json                  3,791 derived chin points
```

The three per-frame folders use one key — `r{round}_f{frame}` — as filename and
as JSON key, so they join with no name mapping. Verified 1:1: 3,791 JPEGs,
3,791 `.npy`, 3,791 chin points, 0 unpaired.

**`skeletons/`** — the raw BlazePose-33 row for each frame, `(33, 8)` float32,
lifted verbatim from the round cache (channels x, y, z, x_world_m, y_world_m,
z_world_m, visibility, presence). Unfiltered and not subset to the 5 joints
`chin_frames.json` carries: the manifest holds what the page needs to draw a
box, this holds everything a model might want. At 4.5 MB it makes the dataset
usable without the pose cache or a Drive mount.

**`chins/chin_points.json`** — BlazePose has no jaw landmark, so the chin is
extrapolated along the nose → mouth-midpoint vector:

```
mouth = (mouth_l + mouth_r) / 2
chin  = nose + 2.25 * (mouth - nose)
```

`CHIN_COEF = 2.25` was settled in cornerman-shoulder-chin's `02_chin_point/`
(tried 3, then 2, then 2.25, each validated visually). Our implementation is
bit-exact against `lib/cornerman_chin.chin_proxy` over 2,000 random skeletons.
Coordinates are image-normalized and **unclamped** — 3 of 3,791 fall outside
`[0, 1]` where the head sits at a frame edge and the extrapolation overshoots.

`chin_frames.json` shape:

```jsonc
{
  "params": { … },
  "videos": [{
    "stem": "10 Minute Shadow Boxing Workout At Home",
    "total_sec": 103.5,
    "eligible_frames": 3108,
    "fps_by_round": {"0": 30.0, "1": 30.0, "2": 30.0},
    "stance_majority": "Orthodox",
    "stance_counts": {"Orthodox": 25},
    "samples": [{
      "round": 0, "frame": 26, "pts": 146.9,
      "stance": "Orthodox", "stance_dist": 0.61,
      "joints": {"nose": [0.5599, 0.1975], "mouth_l": [...],
                 "mouth_r": [...], "l_sh": [...], "r_sh": [...]}
    }]
  }]
}
```

`joints` are image-normalized `[x, y]` (0.5599 = 56% across the frame). The
labeler page draws the chin box from them directly — no pose detection in the
browser.

## Reproducing

```bash
python chin_tuck/v2/chin_sampler_v2.py \
  --caches "<drive>/data/skeleton_data/blazepose" \
  --combined "<path>/Box Labeled Data.xlsx" \
  --out "<repo>/chin_tuck_2.0/chin_frames.json"

# per-frame shoulder: lead by stance, the punching hand’s shoulder while
# inside a documented punch (rewrites the manifest in place)
python chin_tuck/v2/chin_annotate_shoulder.py \
  --manifest "<repo>/chin_tuck_2.0/chin_frames.json" \
  --combined "<path>/Box Labeled Data.xlsx"

python chin_tuck/v1/chin_export_frames.py \
  --manifest "<repo>/chin_tuck_2.0/chin_frames.json" \
  --videos "<drive>/data/raw_videos/full_source_videos" \
  --out "<repo>/chin_tuck_2.0/frames" \
  --hosted-name exported_videos.json \
  --ffmpeg "<path to ffmpeg>"

python chin_tuck/v2/chin_export_skeletons.py \
  --manifest "<repo>/chin_tuck_2.0/chin_frames.json" \
  --caches "<drive>/data/skeleton_data/blazepose" \
  --out "<repo>/chin_tuck_2.0/skeletons"

python chin_tuck/v2/chin_export_chin_points.py \
  --skeletons "<repo>/chin_tuck_2.0/skeletons" \
  --manifest "<repo>/chin_tuck_2.0/chin_frames.json" \
  --out "<repo>/chin_tuck_2.0/chins/chin_points.json"

# the fixed global order every labeler walks. --append keeps existing
# positions and shuffles only NEW frames to the end - labels stay attached.
python chin_tuck/v2/chin_build_queue.py \
  --manifest "<repo>/chin_tuck_2.0/chin_frames.json" \
  --chins "<repo>/chin_tuck_2.0/chins/chin_points.json" \
  --out "<repo>/chin_tuck_2.0/queue.json" --append
```

Every step is deterministic: a re-run against unchanged inputs reproduces
each file byte-for-byte (verified for the queue and the chin points after
the scripts moved into `v1/`/`v2/`).

All run from `cornerman-backend/ml/research/` (v1/ holds the shared exporter, v2/ the 2.0-only scripts). The JPEG export takes
~1 hour at ~1s/frame, Drive-streaming bound rather than decode bound; the other
two take seconds. `--hosted-name` matters: without it the exporter writes 1.0's
`chin_hosted.json`, which is the name `chin_tuck.js` fetches.

`chin_export_chin_points.py` reads `skeletons/`, not the Drive cache, so a
different coefficient reruns offline in seconds.

## Open

- ~~Taxonomy is not decided.~~ Decided and shipped: four questions
  (shoulder_ok / chin_ok / lateral_safe / frontal_safe), page at
  `chin_shoulder.html`, one `chin_shoulder_labels_<Name>` tab per labeler.
- **666 MB is uncommitted.** The repo is already ~600 MB tracked + ~607 MB
  `.git`; adding these full-res frames roughly doubles it, past GitHub's 1 GB
  soft limit, and GitHub Pages serves every one to labelers. Downscaling to
  1080p would cut it to ~200 MB — the chin box is a small fraction of a 4K frame,
  so detail is not the binding constraint.
- **Round coverage** is incidental, not guaranteed. If every round should be
  represented, seed one frame per round before distributing the remainder.

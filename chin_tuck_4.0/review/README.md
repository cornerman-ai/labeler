# Chin / shoulder model review

Read-only page: **our estimates against the labelers' clicks**, on any
variant. Pick axis (height / depth) × frames (guard / impact) × point
(chin / shoulder), and toggle the humans' clicks on or off.

Open it from the labeler index, or at
`chin_tuck_4.0/review/review.html`.

## Where the two halves come from

This follows the same split the labeling pages use — bake only what a
browser cannot compute, read the rest live:

| | source | when it changes |
|---|---|---|
| **model points** | `data/<variant>.json`, frozen by the backend | only when a correction is re-fitted or new frames are sampled |
| **labelers' clicks** | the Apps Script, fetched on load | immediately — new labels show up on reload |

The model points need the Drive pose caches *and* the boxer_facing_angle
MLP, neither of which the page can reach, which is the whole reason they
are cached. This is a stopgap: the longer-term fix is for the estimates
to be computed somewhere the page can query.

Regenerate the cache (backend, needs Drive + torch):

```bash
python ml/research/chin_tuck/lens/chin_shoulder_lens_data.py --all
```

## What is drawn

| mark | |
|---|---|
| ◯ red ring + dot | the labelers' median click (optional; "every click" shows their spread) |
| ● purple | chin = `nose + 2.25·(mouth_mid − nose)` — the shipped proxy |
| ● orange | chin = `nose + 1.47·(…)` — the x-axis refit, **depth only** |
| ● cyan | chin from the face pipeline (SCRFD + 2d106) |
| ● yellow | shoulder = the BlazePose lead-shoulder keypoint |
| ● green | shoulder = keypoint + `d·0.1006·torso`, **depth only** |

Sources that do not apply to the selected axis are not drawn — the depth
corrections are fitted for the front of the shoulder and the x axis, and
mean nothing against the height variants' shoulder-*top* clicks. A source
reads `absent` when there is no value for that frame (no face found, or
no face sidecar extracted for that variant yet — the impact variants have
none).

The numbers behind these corrections, and the cross-video tests that say
which are real, are in the backend's
`ml/research/chin_tuck/RESULTS.md`.

## Reading it

Marks land within a few pixels on a good frame, so the **magnifier**
(top-right of the frame) is the point of the page: it copies the pixels
around the active point before the marks go down and redraws them
enlarged. The error table is in pixels, in torso units, and in |dx|/torso
— the last is the one the depth rule cares about.

← → step through the labeled frames of the selected video.

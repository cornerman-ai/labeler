# chin_tuck 4.0 — the geometric generation

Labelers **click two points** per frame — the chin tip and the top of the
lead shoulder — instead of answering questions. The raw points are the
label; over/level/under is derived downstream, so the "level" band can be
tuned forever without relabeling, disagreement is a measurable distance per
point, and the clicks double as calibration for the pipeline (human
shoulder vs BlazePose's, human chin vs the nose→mouth extrapolation that
`chins/chin_points.json` bakes for 2.0).

Built after the 2026-08 inter-rater runs: 2.0's four questions came in
below trainable on three of four, and 3.0's single yes/no traded resolution
for agreement. 4.0 goes the other way — maximum resolution, with
disagreement diagnosable instead of categorical. 3.0's yes/no labels remain
valuable: on the 932 shared frames they validate the derived distance.

## The data

**Non-punch, punch-adjacent frames only.** Placing "the top of the
deltoid" only means one thing in guard — mid-punch the shoulder roll moves
it, and between rounds the boxer isn't in stance at all. Every frame here
sits in the **0.5–5s band around a labeled punch**: more than 0.5s from
every punch (out of the shoulder roll), within 5s of some punch (out of
the talking/stretching stretches), in a **round that has punch labels** (a
round with zero punch rows was never labeled, so "no punch near" would
mean nothing there — exactly 1 such round exists in the whole corpus).
Both hips must also be tracked (visibility ≥ 0.6): the derived distance is
normalized by torso height. The residual non-stance rate is measured by
the `no_stance` skip reason — that number decides whether 5s needs
tightening.

- 1,810 frames across 192 videos: **932 kept from 2.0** (already exported,
  already 3.0-labeled) **+ 878 sampled fresh**
- queue: **1,996 slots** = 1,810 + **186 planted repeats** (rep=1, ~10%,
  ≥200 slots downstream, blind) for intra-rater click scatter — the noise
  floor every inter-rater number is read against
- sampler: `cornerman-backend/ml/research/chin_tuck/v3/chin_sampler_v3.py`
  (deterministic, additive growth, same contract as v2)

**Frames live in Firebase Storage, not this repo.** 2.0's 724MB left no
Pages budget for another generation. Objects sit under
`labeler_media/chin_point/frames/<stem dir>/r<r>_f<f>.jpg` in the
`mycorner-bee6a` bucket behind a shared download token (the bucket's rules
never loosened — see `chin_upload_frames.py`). Git carries only code,
`chin_frames.json` and `queue.json`.

## The backend

Apps Script `doGetChinPoint` (own handler, `CS4_SPEC`), tabs
`chin_point_labels_<Name>` in the **`Chin Point Labels` spreadsheet**
(Drive: `Cornerman/data/labels/labeling_team/`, ID in `CS4_SPEC`) — its own
workbook, not Box Labeled Data, so append-only rows and repeat frames stay
out of the training-critical sheet.

**Append-only, latest-(video, round, frame, rep) wins.** Every save is a
new row; readers resolve latest-per-identity. Re-labels are pre/post-
coaching measurements, and `rep` in the identity is what keeps a planted
repeat from collapsing into the original's row. A row is a complete pair or
a skip — the backend refuses a lone chin, and a skip must carry its reason
(`not_visible` / `no_stance`).

## The page

`chin_tuck4.html` — 3.0's shell (same stylesheet base, name bar, optimistic
chained saves, overview grid, team panel) with the question card replaced
by point placement: click places the armed point (chin → shoulder →
disarmed), drag adjusts, `C`/`S` re-arm, zoom to 12x for precision.

The shoulder instruction is stance-as-a-prior, not a hard rule: the hint
shows the frame's stance and which shoulder is USUALLY the lead, and asks
for the one actually held forward in this frame — boxers switch stances
mid-movement. `shoulder_used` therefore records the stance-derived
expectation; which shoulder was actually clicked is derivable downstream
by matching the click against BlazePose's two shoulder points.

Two deliberate rules:

- **The machine's points are never drawn while placing.** BlazePose
  shoulders + the chin proxy appear only inside the **Peers** panel —
  a labeler who can see the pipeline's guess anchors on it, and
  independence is the whole value of the clicks. Opening Peers marks the
  frame `consulted`, same meaning as 2.0/3.0's clue.
- **Two skips, by reason.** `K` = can't see the points, `N` = not in
  boxing stance. The reasons are data: `no_stance` measures what the
  punch-proximity sampling window still lets through. `no_stance` means
  the boxer is clearly doing another exercise, or has clearly stopped
  boxing to explain something — explaining WHILE boxing (still in stance,
  still working) is normal footage and gets labeled, not skipped.
- **Per-point visibility, COCO-style.** `chin_vis`/`sh_vis` ∈ visible /
  inferred — Shift+click places an inferred point (best estimate of
  occluded anatomy, drawn as a ring), Shift+`C`/`S` toggles after. COCO's
  v=2/v=1 in words; v=0 is the `not_visible` skip. Chosen over a
  confidence slider deliberately: visibility is a fact about the frame a
  second rater can verify, sliders elicit poorly-calibrated, per-rater-
  incomparable numbers, and the real uncertainty measures here are the
  planted repeats and inter-labeler scatter. The flag exists so the
  chin-proxy calibration can exclude gloved-chin guesses.

Not ported from 3.0 (deliberately, keep the pilot small): reviewer mode /
disagreement jump, the kappa panel (kappa is meaningless here — agreement
is point distance, computed offline), comparison grid, lead-everyone,
exclude-video, frame ranges.

## Growing / rebuilding

All from `cornerman-backend/ml/research/`, in order:

```bash
# 1. fresh Combined Data (a stale export mis-measures the punch gate)
python chin_tuck/v3/fetch_combined_xlsx.py \
    --service-account <backend>/firebase_service_account.json \
    --out combined_snapshot.xlsx

# 2. sample — SELF-SEEDED from the current manifest, so existing frames,
#    their queue positions and their labels survive (additive: raise
#    --target with gates unchanged and old picks keep; changing a gate
#    drops only the frames the new gate excludes)
python chin_tuck/v3/chin_sampler_v3.py \
    --combined combined_snapshot.xlsx \
    --seed-manifest <labeler>/chin_tuck_4.0/chin_frames.json \
    --out <labeler>/chin_tuck_4.0/chin_frames.json

# 3. export new JPEGs (skips existing), then upload (skips existing)
python chin_tuck/v1/chin_export_frames.py \
    --manifest <labeler>/chin_tuck_4.0/chin_frames.json \
    --videos "<drive>/data/raw_videos/full_source_videos" \
    --out <staging dir> --hosted-name exported_videos.json
python chin_tuck/v3/chin_upload_frames.py \
    --frames <staging dir> \
    --service-account <backend>/firebase_service_account.json

# 4. queue (--append keeps positions + labels, new frames shuffle to the end)
python chin_tuck/v3/chin_build_queue_v3.py \
    --manifest <labeler>/chin_tuck_4.0/chin_frames.json \
    --out <labeler>/chin_tuck_4.0/queue.json --append
```

Then bump the cache-bust versions — `queue.json?v=` in `chin_tuck4.js` and
the `chin_tuck4.js?v=` tag in `chin_tuck4.html` — or labelers keep the
queue their browser cached.

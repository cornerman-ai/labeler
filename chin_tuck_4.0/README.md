# chin_tuck 4.0 — the geometric generation

Labelers **click two points** per frame instead of answering questions. The
raw points are the label; over/level/under is derived downstream, so the
"level" band can be tuned forever without relabeling, disagreement is a
measurable distance per point, and the clicks double as calibration for the
pipeline (human shoulder vs BlazePose's, human chin vs the nose→mouth
extrapolation that `chins/chin_points.json` bakes for 2.0).

Built after the 2026-08 inter-rater runs: 2.0's four questions came in
below trainable on three of four, and 3.0's single yes/no traded resolution
for agreement. 4.0 goes the other way — maximum resolution, with
disagreement diagnosable instead of categorical. 3.0's yes/no labels remain
valuable: on the 932 shared frames they validate the derived distance.

## Sub-labelers

Two axes, independent of each other: **which landmark pair** is clicked
(chin tip + shoulder **top**, "height", vs chin tip + shoulder's **most
frontal point**, "depth") and **which frames** are sampled (**guard** —
non-punch, punch-adjacent frames, vs **punch** — frames inside a punch).
Four combinations, one subfolder each:

| Variant | Status | Folder | Landmark pair | Frames |
| --- | --- | --- | --- | --- |
| Height guard | live | [`height_guard/`](height_guard/) | chin tip + shoulder top | non-punch, punch-adjacent |
| Depth guard | live (v1) | [`depth_guard/`](depth_guard/) | chin tip + shoulder's frontal point | non-punch, punch-adjacent (reuses height guard's set as-is for now — see `depth_guard/depth_guard.js` header) |
| Height punch | planned | [`height_punch/`](height_punch/) | chin tip + shoulder top | inside a punch |
| Depth punch | planned | [`depth_punch/`](depth_punch/) | chin tip + shoulder's frontal point | inside a punch |

[`shared/chin_frames.json`](shared/chin_frames.json) is the raw sample
manifest every variant's queue is built from — backend-only, never fetched
by a page (see "Growing / rebuilding" below).

## The data (height_guard / depth_guard)

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
- height_guard's queue: **1,996 slots** = 1,810 + **186 planted repeats**
  (rep=1, ~10%, ≥200 slots downstream, blind) for intra-rater click
  scatter — the noise floor every inter-rater number is read against
- depth_guard's queue (v1): the first **200 slots** of height_guard's
  queue, no repeats, sideways-on filtering still TODO — see
  `depth_guard/depth_guard.js`'s header comment
- sampler: `cornerman-backend/ml/research/chin_tuck/v3/chin_sampler_v3.py`
  (deterministic, additive growth, same contract as v2)

**Frames live in Firebase Storage, not this repo.** 2.0's 724MB left no
Pages budget for another generation. Objects sit under
`labeler_media/chin_point/frames/<stem dir>/r<r>_f<f>.jpg` in the
`mycorner-bee6a` bucket behind a shared download token (the bucket's rules
never loosened — see `chin_upload_frames.py`). Git carries only code,
`shared/chin_frames.json` and each variant's `*_queue.json`.

## The backend

Apps Script `doGetChinPoint` (own handler), tabs `chin_point_labels_<Name>`
(height guard, `CS4_SPEC`) / `chin_point_depth_labels_<Name>` (depth guard,
`CS4D_SPEC`) in the **`Chin Point Labels` spreadsheet** (Drive:
`Cornerman/data/labels/labeling_team/`) — its own workbook, not Box
Labeled Data, so repeat frames stay out of the training-critical sheet.
Both variants share the same `doGetChinPoint` machinery, parameterized by
spec — only the spreadsheet tab prefix and frame source differ; the row
schema (`chin_x`/`chin_y`/`sh_x`/`sh_y`) is unchanged since those columns
are just click coordinates and don't encode which landmark they are.

**Overwrite in place, keyed (video, round, frame, rep)** — same rule as
2.0/3.0: a re-label replaces the row rather than piling up history. `rep`
in the identity is what keeps a planted repeat from being read as a
re-label of the original and overwriting it. `deleteChinPoint` removes a
row entirely, no soft-delete, same as 2.0/3.0.

**Partial saves (2026-08).** A row can carry the chin alone, the shoulder
alone, both, or (a skip) neither — the one thing still refused is a BROKEN
point, an x with no y or vice versa, which the client never produces but
the backend still checks on principle. Partial is provisional by design:
`isFinished`/`hasPoints` still require the full pair, so a partial row
never counts toward "done," the same way v2's partially-answered rows
never did — it exists to be overwritten once the second point lands, not
as a lesser measurement. `chin_vis`/`sh_vis` follow the point they belong
to: blank whenever THAT point is absent, regardless of whether the other
one is present. Leaving a frame with zero points and no explicit skip is
itself a decision not to label it, so the page auto-records that as a skip
with reason `unmarked` — a third value in `CS4_SKIP_REASONS`, deliberately
kept out of the K popover (which still only offers `not_visible` /
`no_stance`) so an unattended frame never dilutes what those two reasons
measure.

## The page

`height_guard/height_guard.html` — 3.0's shell (same stylesheet base, name
bar, optimistic chained saves, overview grid) with the question card
replaced by point placement: click places the armed point (chin →
shoulder → disarmed), drag adjusts, `C`/`S` re-arm, zoom to 12x for
precision. Each click opens the seen/inferred popover beside the point it
just placed, and the point is not finished — nor the next one armed —
until that is answered. `depth_guard/depth_guard.html` is the same
machinery with the second point's landmark swapped (shoulder top →
shoulder's most frontal point).

The definitions of the landmarks are NOT on the page: they live in the
Notion guide ("How to use the chin tuck labeler 4.0"), which the page links
to. Two copies of "what counts as the top of the shoulder" drift, and the
copy the team reads before a session is the one that has to be right.

The shoulder instruction is stance-as-a-prior, not a hard rule: the hint
shows the frame's stance and which shoulder is USUALLY the lead, and asks
for the one actually held forward in this frame — boxers switch stances
mid-movement. `shoulder_used` therefore records the stance-derived
expectation; which shoulder was actually clicked is derivable downstream
by matching the click against BlazePose's two shoulder points.

Four deliberate rules:

- **Nobody else's WORK is on this page.** Not the pipeline's points
  (BlazePose shoulders + the chin proxy), not the other labelers'
  placements or answers. The peers panel was removed in 2026-08 for
  exactly that reason: whoever can see another answer anchors on it, and
  an anchored click is not a second opinion, it is the first one copied.
  (The `consulted` column, which used to mark rows saved after opening
  that panel, was dropped from the sheet along with it.) **Progress is the
  one exception**, restored later in 2026-08 as "Everyone's progress" (the
  foldable pill under the name field, ported from 3.0's `#team` panel): a
  count and which queue positions somebody has touched, never what they
  answered there — a dot on the shared bar carries no colour, no verdict,
  so there's nothing in it for a click to anchor on. Folded by default,
  each row expandable to the labeler's actual frame ranges (`[1, 100] ·
  [401, 1,100]`, via `listChinPoint` on demand), with a per-device
  hide-from-my-list control that never reaches the sheet. Deliberately
  missing 3.0's "Lead everyone" footer — every labeler getting write
  access to the whole team's sheet is an admin capability (see admin
  mode's `#lead-row`), not something this panel hands out.
- **Saving is leaving.** There is no save button: whatever points exist —
  one, both, or neither — are written when the labeler moves on — `↵`, the
  arrows, Next, the overview, anything that changes frame — because "done
  here for now" and "next frame" are one decision, and asking for the
  second gesture is how the first one's work gets lost. Writes are skipped
  when nothing changed, so walking back through finished frames costs no
  rows; the one thing that holds a labeler still is a point placed but not
  yet answered seen/inferred, which says so in the status line. Leaving a
  frame with zero points and no explicit skip still writes something — see
  Partial saves above.
- **One skip, then its reason.** `K` (or the button) opens a popover:
  1 = can't see the points, 2 = not in boxing stance, `Esc` backs out.
  Asked afterwards rather than as two buttons, so the decision to skip and
  the wording of why are separate acts. The reasons are data: `no_stance`
  measures what the punch-proximity sampling window still lets through.
  `no_stance` means the boxer is clearly doing another exercise, or has
  clearly stopped boxing to explain something — explaining WHILE boxing
  (still in stance, still working) is normal footage and gets labeled,
  not skipped.
- **Camera too low/high** (`G`, off unless ticked) — a fact about the
  SHOT, not the labeling: a phone on the floor looks up at the boxer, which
  moves the chin over the shoulder in the image without the boxer's head
  moving at all. Per frame, because one video can be filmed from the floor
  for a round and from a shelf for the next. Column `camera_bad` (named
  `camera_ground` until 2026-08), which replaced the never-used `flag`
  ("come back to this"). Disabled until both points are placed — it's a
  claim about where the chin sits relative to the shoulder, so there's
  nothing to judge it against on a frame with zero or one point down.
- **Per-point visibility, COCO-style.** `chin_vis`/`sh_vis` ∈ visible /
  inferred — asked outright by a popover the moment the point lands
  (1 = seen, 2 = inferred, `Esc` undoes the placement); an inferred point
  is drawn as a ring. Changing an answer afterwards is ONE click on the
  chip that shows it (or Shift+`C` / Shift+`S`), not a re-ask: the chip
  already says which answer the point carries, so the thing to do with it
  is contradict it, and a yes/no you can already see does not need a dialog
  to change. On a frame whose row already exists the flip is written
  immediately, since correcting an old frame and then closing the tab is
  exactly the case commit-on-leave would miss. There is
  no default and a save is refused while either answer is missing: a
  modifier-key flag (Shift+click, as this shipped first) is a thing a
  labeler forgets, and an unanswered point silently saved as `visible` is
  exactly the guess-as-observation the flag exists to catch. COCO's
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
    --seed-manifest <labeler>/chin_tuck_4.0/shared/chin_frames.json \
    --out <labeler>/chin_tuck_4.0/shared/chin_frames.json

# 3. export new JPEGs (skips existing), then upload (skips existing)
python chin_tuck/v1/chin_export_frames.py \
    --manifest <labeler>/chin_tuck_4.0/shared/chin_frames.json \
    --videos "<drive>/data/raw_videos/full_source_videos" \
    --out <staging dir>
python chin_tuck/v3/chin_upload_frames.py \
    --frames <staging dir> \
    --service-account <backend>/firebase_service_account.json

# 4. queue (--append keeps positions + labels, new frames shuffle to the end)
python chin_tuck/v3/chin_build_queue_v3.py \
    --manifest <labeler>/chin_tuck_4.0/shared/chin_frames.json \
    --out <labeler>/chin_tuck_4.0/height_guard/height_guard_queue.json --append
```

(Step 3 always writes a hosted-stems JSON next to `--out`, default name
`chin_hosted.json` — a `--hosted-name exported_videos.json` copy of this
used to live in this repo but nothing reads it: 4.0 pages fetch frames
straight from Firebase Storage, not a baked JPEG tree, so the file was
dead weight and got deleted. Point `--out` at a scratch/staging dir and
ignore whatever hosted-stems file lands next to it there.)

`depth_guard/depth_guard_queue.json` doesn't have its own build step yet —
v1 is a straight slice of `height_guard_queue.json`'s first 200 slots (see
`depth_guard/depth_guard.js`'s header comment). A real sideways-only
sampling pass is still TODO.

Then bump the cache-bust versions — the queue-file version in each
variant's `<variant>.js` (`fetch('height_guard_queue.json?v=…')` /
`fetch('depth_guard_queue.json?v=…')`) and the matching `<variant>.js?v=`
tag in that variant's `.html` — or labelers keep the queue their browser
cached.

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
non-punch, punch-adjacent frames, vs **impact** — the human-labeled IMPACT
frame of a real punch). Four combinations, one subfolder each:

| Variant | Status | Folder | Landmark pair | Frames |
| --- | --- | --- | --- | --- |
| Height guard | live | [`height_guard/`](height_guard/) | chin tip + shoulder top | non-punch, punch-adjacent |
| Depth guard | live | [`depth_guard/`](depth_guard/) | chin tip + shoulder's frontal point | non-punch, side-view only (own sample — see below) |
| Height impact | live | [`height_impact/`](height_impact/) | chin tip + shoulder top | the IMPACT frame of a real punch |
| Depth impact | live | [`depth_impact/`](depth_impact/) | chin tip + shoulder's frontal point | the IMPACT frame of a real punch, side-view only |

On the impact variants the shoulder to mark is known **exactly** — the
PUNCHING hand's shoulder (lead for a lead-hand punch, rear for a rear-hand
one), read off the punch each frame is tied to — rather than inferred from
stance the way the guard variants' hint is. See
[`height_impact/README.md`](height_impact/README.md) and
[`depth_impact/README.md`](depth_impact/README.md) for their sample sizes
and where their data actually lives (Firebase only — unlike the guard
variants, nothing but page code is committed to this repo for them).

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
- sampler: `cornerman-backend/ml/research/chin_tuck/v3/chin_sampler_v3.py`
  (deterministic, additive growth, same contract as v2)

**depth_guard has its own sample, not a slice of height_guard's.** "Most
frontal point of the shoulder" is only legible from a side-on camera — from
the front it collapses onto the same outline the labeler already can't
judge depth from — so the pool is restricted to frames the camera is
actually shooting from the side. Combined Data only tags camera angle
(`Side`/`Front`/`Back`) on punch rows, not on the empty space between them,
so a non-punch frame borrows the angle of its temporally nearest labeled
punch (recorded per sample as `angle_dist_sec`, so the inference is
auditable rather than silent).

- 1,828 frames across 36 videos, `--min-gap 0.5` (video count is capped by
  how many of the 204 punch-labeled videos have ANY `Side`-tagged punch at
  all, not by the sampler's target or gap)
- depth_guard's queue: **2,011 slots** = 1,828 + **183 planted repeats**,
  same contract as height_guard's
- sampler: `cornerman-backend/ml/research/chin_tuck/v4/sample_depth_guard.py
  --angle Side --target 150 --min-gap 0.5` — see `v4/README.md` for the two
  earlier, lower-yield attempts (the archived hand-curated side-span
  script, and this same script at `--min-gap 2.0`) this replaced

**Frames live in Firebase Storage, not this repo.** 2.0's 724MB left no
Pages budget for another generation. height_guard's objects sit under
`labeler_media/chin_tuck/v4/height_guard_v4_frames/frames/<stem dir>/r<r>
_f<f>.jpg`; depth_guard's under `labeler_media/chin_tuck/v4/
depth_guard_v4_frames/frames/<stem dir>/r<r>_f<f>.jpg` — its own prefix,
not height_guard's, because it's a genuinely different (side-view-filtered)
pool of frames. Both live in the
`mycorner-bee6a` bucket behind a shared download token (the bucket's rules
never loosened — see `chin_upload_frames.py`). Git carries only code,
each variant's raw sample manifest (`shared/chin_frames.json` for
height_guard, `depth_guard/depth_guard_frames.json` for depth_guard) and
each variant's `*_queue.json`.

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

The two impact variants reuse the exact same `doGetChinPoint` machinery and
row schema, via `CS4I_SPEC` (height impact, tabs
`chin_point_impact_labels_<Name>`) and `CS4DI_SPEC` (depth impact, tabs
`chin_point_depth_impact_labels_<Name>`) — but each in its **own**
standalone spreadsheet (given by whoever built the impact sample), not the
`Chin Point Labels` workbook above. `deriveStatsKeys()` derives every spec's
cache key from its prefix, and CacheService's script cache is shared across
every spec this script serves regardless of spreadsheet, so each variant
still needs a prefix no other spec uses.

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
  access to the whole team's sheet is an admin capability, not something
  this panel hands out. Admin mode has no built version of it either:
  `#lead-row`/`#lead-mask` are styled in the stylesheet from an earlier
  plan, but nothing in any of the four pages renders or wires them.
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

**Which two labelers "Agreement" and the three progress grids compare is
admin-changeable mid-session** (two selects at the top of the Agreement
card, `state.agreePair`/`setAgreePair()`), not a pair baked into the page —
picking a name already on the other side swaps the two rather than
comparing someone against themselves. Persisted per device (`localStorage`,
key prefixed by the variant), defaulting to `Arianne`/`John` on a device
that has never picked one. Changing it recomputes the agreement card, the
whole-queue stats, and the three progress grids' disagreement colouring
together — all four read the same `state.agreePair`.

**"Export disagreement PNG"** (admin-only, next to the Progress card
eyebrow) renders all three metric grids for the WHOLE queue — every batch,
not just what is scrolled into view — as one PNG: three long columns
(euclid | height | width) with a shared batch-number gutter, a legend, and
a timestamp, via `<canvas>` (no library). `disagreeFillColor()` mirrors
`paintOneGrid()`'s admin colouring but returns literal colour strings
instead of a CSS class, and is fixed to the light palette regardless of the
viewer's OS theme — an exported image is looked at later, by someone else,
possibly printed, and should not change depending on who opens it.

**"Refresh now"** (the small icon next to the Team progress eyebrow,
`refreshRoster()`) forces a full admin data reload — roster AND
`state.teamRows` — for a labeler added or removed by hand-editing the
spreadsheet, which is otherwise invisible for up to a minute even after the
next automatic poll: nothing in a manual sheet edit calls
`cs2InvalidateStats`, so the server's cached `stats` answer (`CS2_STATS_TTL`
= 60s) keeps serving the old roster until it naturally expires. The button
sends `force=1`, which the `stats` op treats as "skip the cache read" (still
writing the fresh result back, so it also warms the cache for everyone
else's next ordinary poll). `loadRoster()` alone only refreshes the roster
COUNTS; `refreshRoster()` also re-runs `loadTeamRows()`, since a
newly-added labeler is invisible to the disagreement grids, the
agree-pair picker, and the points list until that rebuilds too.

**Admin presence.** While admin is on a frame, every normal-mode session
polls for that and, if it's the exact frame they're looking at, shows an
amber banner above the stage: "Admin is on this frame right now — anything
you save may be overwritten." Admin broadcasts (`pingPresence()`, on every
navigation and on a `PRESENCE_LOOP_MS` (7s) timer) to a Cache Service entry
(`pingPresenceChinPoint`/`getPresenceChinPoint` and their per-variant
siblings in `doGetChinPoint`, `CS_PRESENCE_TTL` = 20s in Code.js) — no
sheet touched, nothing to clean up, the entry simply lapses if admin closes
the tab or goes idle. This is advisory, not a lock: the backend still
overwrites in place on whoever saves last, same as always, so the banner is
what makes "admin's edit wins" actually true in practice — a labeler who
sees it stops racing it, rather than the two of them being arbitrated after
the fact.

`height_impact.html`/`depth_impact.html` are the exact same page mechanics
as their guard counterparts (four deliberate rules above included) — only
the frame source, the backend spec, and the action names differ. See
[`height_impact/README.md`](height_impact/README.md) and
[`depth_impact/README.md`](depth_impact/README.md).

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

`depth_guard/depth_guard_queue.json` has its own build path — steps 2–4
above, substituted like so:

```bash
# 2. sample — side-view pool via borrowed punch angle, not chin_sampler_v3.py
python chin_tuck/v4/sample_depth_guard.py \
    --combined combined_snapshot.xlsx \
    --angle Side --target 150 --min-gap 0.5 \
    --seed-manifest <labeler>/chin_tuck_4.0/depth_guard/depth_guard_frames.json \
    --out <labeler>/chin_tuck_4.0/depth_guard/depth_guard_frames.json

# 3. export + upload — SAME scripts as height_guard, but upload under
#    depth_guard's OWN prefix so the two pools can't collide on the bucket
python chin_tuck/v1/chin_export_frames.py \
    --manifest <labeler>/chin_tuck_4.0/depth_guard/depth_guard_frames.json \
    --videos "<drive>/data/raw_videos/full_source_videos" \
    --out <staging dir>
python chin_tuck/v3/chin_upload_frames.py \
    --frames <staging dir> \
    --prefix labeler_media/chin_tuck/v4/depth_guard_v4_frames/frames \
    --service-account <backend>/firebase_service_account.json

# 4. queue
python chin_tuck/v3/chin_build_queue_v3.py \
    --manifest <labeler>/chin_tuck_4.0/depth_guard/depth_guard_frames.json \
    --out <labeler>/chin_tuck_4.0/depth_guard/depth_guard_queue.json --append
```

`depth_guard/depth_guard.js`'s `FRAME_PREFIX` constant must match whatever
`--prefix` step 3 was actually given — nothing keeps the two in step
automatically, see the comment above that constant.

Then bump the cache-bust versions — the queue-file version in each
variant's `<variant>.js` (`fetch('height_guard_queue.json?v=…')` /
`fetch('depth_guard_queue.json?v=…')`) and the matching `<variant>.js?v=`
tag in that variant's `.html` — or labelers keep the queue their browser
cached.

**height_impact / depth_impact do not follow this recipe.** Their sample and
queue were built and uploaded straight from cornerman-backend without a git
round-trip — `chin_frames.json` and `queue.json` for each sit only in
Firebase Storage (see each variant's own README for the exact paths), and
`height_impact.js`/`depth_impact.js` fetch `queue.json` from there
(`QUEUE_URL`) instead of a relative fetch of a committed file. Regrowing
either queue means re-uploading `queue.json` to that Firebase path and
bumping `QUEUE_CACHE_BUST` in that variant's `.js` — there is no local file
or `?v=` tag to touch.

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
chained saves, overview grid) with the question card replaced
by point placement: click places the armed point (chin → shoulder →
disarmed), drag adjusts, `C`/`S` re-arm, zoom to 12x for precision. Each
click opens the seen/inferred popover beside the point it just placed, and
the point is not finished — nor the next one armed — until that is answered.

The definitions of the two landmarks are NOT on the page: they live in the
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

- **Nobody else's work is on this page.** Not the pipeline's points
  (BlazePose shoulders + the chin proxy), not the other labelers'
  placements, not how far along anyone is. The peers panel and the team
  progress list were both removed in 2026-08: whoever can see another
  answer anchors on it, and an anchored click is not a second opinion, it
  is the first one copied. Comparison lives on `review.html`, which writes
  nothing. (`consulted` in the sheet is now a fossil — it marked rows saved
  after opening that panel; new rows all carry 0.)
- **Saving is leaving.** There is no save button: a finished pair is
  written when the labeler moves on — `↵`, the arrows, Next, the overview,
  anything that changes frame — because "done with this frame" and "next
  frame" are one decision, and asking for the second gesture is how the
  first one's work gets lost. Writes are skipped when nothing changed, so
  walking back through finished frames costs no rows; the one thing that
  holds a labeler still is a point placed but not yet answered
  seen/inferred, which says so in the status line.
- **One skip, then its reason.** `K` (or the button) opens a popover:
  1 = can't see the points, 2 = not in boxing stance, `Esc` backs out.
  Asked afterwards rather than as two buttons, so the decision to skip and
  the wording of why are separate acts. The reasons are data: `no_stance`
  measures what the punch-proximity sampling window still lets through.
  `no_stance` means the boxer is clearly doing another exercise, or has
  clearly stopped boxing to explain something — explaining WHILE boxing
  (still in stance, still working) is normal footage and gets labeled,
  not skipped.
- **Camera on the ground** (`G`, off unless ticked) — a fact about the
  SHOT, not the labeling: a phone on the floor looks up at the boxer, which
  moves the chin over the shoulder in the image without the boxer's head
  moving at all. Per frame, because one video can be filmed from the floor
  for a round and from a shelf for the next. Column `camera_ground`, which
  replaced the never-used `flag` ("come back to this").
- **Per-point visibility, COCO-style.** `chin_vis`/`sh_vis` ∈ visible /
  inferred — asked outright by a popover the moment the point lands
  (1 = seen, 2 = inferred, `Esc` undoes the placement), re-openable from
  the chip in the tool row; an inferred point is drawn as a ring. There is
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

## The review page

`review.html` — **read-only**, and the ONLY place any comparison happens.
Tick any set of labelers, walk the frames they share, see every placement on
the picture at once: **dot = chin, bar = shoulder**, dashed = inferred,
diamond = the pipeline's chin. Shape carries the landmark and colour carries
the person — two circles differing only by fill stopped being readable at
four labelers with repeats. **`C` / `S`** (or the two checkboxes) put one
landmark on the picture at a time, which is how you look at the half of the
disagreement the summary says is causing it; the last one on stays on, and
the chin→shoulder link only draws while both ends are shown.

Hovering a name dims everyone else. Order by most disagreement, queue
position or video; scope to frames 2+/all/any of the selection touched; or
isolate the **skip conflicts** — one labeler placed points where another
said the frame can't be judged, which measures the sampler rather than the
labeler.

It writes nothing, and it is a separate page from the labeler for the reason
in "The page" above: comparison while placing turns a second opinion into a
copy of the first. It reads `listChinPoint` (one call per labeler, every
row); `peersChinPoint` is now unused by any page.

**The number it reports** is the one the pipeline consumes: the signed
chin-above-shoulder distance in torso units, `(sh_y - chin_y) / torso_h`,
identical to `chin_tuck4.js`'s `derivedDist()`. It is vertical, so it needs
no frame aspect ratio — `queue.json` carries no width/height — and the
decomposition is therefore exact: a pair's gap in the derived number is the
difference of their chin-y gap and their shoulder-y gap, so the summary says
**which point** causes the disagreement. Horizontal spread is left to the
picture, where an eye reads it better than a median would.

Every pair of selected labelers gets median / p90 / n; every labeler with
planted repeats gets a **self row** — rep 0 against rep 1, blind, which is
the noise floor a pair number is meaningless without. Rows carrying the
fossil `consulted` flag (saved while the old peers panel existed) are tagged
in the frame list, since those measure convergence rather than independent
judgement.

Rows whose (video, round, frame) is not in the current `queue.json` are
counted and reported rather than silently dropped — that is what a resample
that moved the frames looks like from here.

### Stats mode

The **Stats** tab (or `T`) aggregates the same rows over the whole corpus
rather than one frame, for whoever is ticked:

- **Overview** — mean / median / p90 disagreement, the noise floor (median
  of the labelers' own repeat scatter), and how many frames two or more of
  them share. That last one governs the rest: under ~30 the page says so.
- **Between labelers** — per pair: n, mean, median, p90, SD, and the three
  **signed biases**. Magnitudes say how far apart they are; the signs say
  who reads what higher, which is the part `|A − B|` throws away.
- **Each labeler** — placements, skips by reason, inferred and consulted
  counts, own-repeat scatter, bias against the average of everyone else,
  and bias against the pipeline. That last group is the calibration the
  clicks exist to produce: the chin proxy and BlazePose's shoulder are what
  is being measured, so a gap there is a finding, not an error.
- **Hardest footage** — videos by mean spread, worst first, capped at 8
  (it says so when it truncates). Where the footage, not the labeler, is
  the problem.

**Sign convention**, stated once and used everywhere: y grows downward, so
every bias is reported *higher-positive* in torso units —
`chinHigher(A vs B) = (B.chin_y − A.chin_y) / torso`, likewise for the
shoulder, and `derivedBias = A.dist − B.dist = chinHigher − shHigher`. That
identity is exact, which is why all three are shown: a 10% gap because one
labeler reads the chin higher and a 10% gap because one reads the shoulder
lower are two different corrections.

### Bland–Altman, and why not correlation

Each pair also gets **bias ± 95% limits of agreement** (`bias ± 1.96·SD`) and
a **Bland–Altman plot**: one dot per frame, the difference between the two
labelers against what they averaged, with the bias solid and the limits
dashed.

Correlation is the wrong tool for agreement — two labelers can correlate
almost perfectly while one sits consistently higher, which is precisely the
failure this generation exists to catch. Bland & Altman's split is the right
one: **bias** is the systematic half (a definitional gap; one conversation
usually fixes it), the **limits** are the random half — and the limits are
what a decision actually runs into, because frames are judged one at a time,
never on average. Plotting against the mean also exposes *proportional*
bias: agreement on tucked chins but divergence on exposed ones shows as a
cloud that fans out, which no summary number reveals.

Two honest limits on it. `1.96·SD` assumes roughly normal differences, and
the limits are themselves estimates — under ~30 pairs the page labels them
*indicative* rather than printing a confident interval over a handful of
frames. And no plot can say whether the agreement is *good enough*: that
threshold comes from the use case (how much difference flips the coaching
call), which is exactly the judgement 4.0 deferred by storing raw points. That shape is the finding — no single number carries it.

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

# boxer_facing_angle

One bucketed verdict per sampled frame, picked on an 8-wedge dial: which
45°-wide compass bucket the boxer is facing, relative to the **camera** —
0° squared to it, 180° back to it, `+` toward the camera's **right**. `+`
is an image-plane convention, **not** the boxer's own right/left, and never
mirrored for stance: recorded as-shown, same reasoning as Guard Drops'
`guard_hand` (raw and auditable beats normalized and unfixable if a stance
turns out wrong).

**Discrete choice, not a rating scale.** `bladedness/README.md` in the
backend measured that a continuous angle-rating scale on this same rotation
records the labeler's visual compression (perceived slant runs ~0.56 of the
true angle) rather than the true stance, which is why that tool went
pairwise instead. A coarse fixed interval sidesteps the failure — the
compression only bites within a couple of degrees of a boundary — so a
direct wedge pick is fine here.

## The line — an assistant, not the label

Dragging on the frame (from where the boxer is standing, toward their
opponent) draws a line. Its angle is computed live and lights up the
**nearest wedge as a light-tinted suggestion** (`.wedge.suggested` — clearly
weaker than the full-strength `.on` a click actually commits, so a
suggestion never reads as a done deal). The labeler still has to click a
wedge (or the skip hole) to save anything; drawing a line never saves by
itself.

When a line IS drawn, its raw points (`base_x/y`, `end_x/y`) are saved
**alongside** whichever wedge gets clicked — for audit/calibration, the same
reason chin_tuck_4.0 keeps its own click points around. Nobody derives the
saved bucket from them; a row can have a bucket with no line (most of them,
if a labeler never bothers drawing one), a bucket with a line that happens
to disagree with it (the labeler drew one thing and then decided a
different wedge fit better), or — on `skip` — neither.

## The data

`boxer_facing_angle_frames.json`'s **2,976 real frames** — guard, punch, and
impact phases, ~1,000 each (976 impact — a handful collided with punch
frames on the same BlazePose frame and were deduped) — across 199 distinct
videos, shuffled once into final labeling order. Not this tool's own
sample: **reused wholesale from chin-point 4.0's already-sampled,
already-exported pools** (`height_guard_v4_frames`/`height_punch_v4_frames`/
`height_impact_v4_frames` — see `cornerman-backend`'s `v4/README.md`), the
same eligible-video reasoning applying here (upright, trackable boxing
footage) plus an EXTRA gate this tool cares about that chin-point never
needed: at least 4 of 8 limb joints (elbows/wrists/knees/ankles) visible,
re-checked against the raw BlazePose cache since neither source manifest
recorded them. Not all 8 — variety matters more than uniform full-body
shots, and a missing ankle/foot at a chest-height crop's bottom edge is far
more common than a missing elbow or knee. `stance` is carried over
UNCHANGED from each source sample's own v4-computed `stance_of()` result —
nothing here re-derives it. Firebase Storage objects live at their own pool
now, not chin_tuck's (`FRAME_BUCKET`/`FRAME_PREFIX`/`FRAME_TOKEN` in the JS
point at `labeler_media/boxer_facing_angle/v1/frames`, same bucket/token as
every other pool).

The reproducible build lives in `cornerman-backend`:
`ml/research/boxer_facing_angle/v1/build_dataset.py` (score guard/punch/
impact candidates for limb visibility, water-fill an equal share per video
within each phase, redistribute phase shortfall, dedupe, shuffle, copy the
already-extracted JPEGs into one combined local pool, write both this
file's shape and a full reproducibility manifest) and the manifest itself,
`boxer_facing_angle_manifest.json` (phase/stance/shoulder/limb_visible per
frame — committed there, unlike the frames/manifest convention in the
labeler repo, since it's source for an audit trail, not a build artifact).
Re-running it is deterministic (seeded RNG) given the same source pools and
BlazePose caches.

Swap `boxer_facing_angle_frames.json` for a fresh run (same shape:
`{stem, round, frame, pts, stance}[]`) if the gate or targets ever change,
and bump the `?v=` on the script tag.

⚠ The queue's LENGTH is the version stamp for the cached team ranges
(`fa_range_cache`) — a rebuilt queue of a different size drops the cache by
itself, but a rebuild that happens to keep the same count would leave stale
positions. Clear the key if that ever happens.

## The backend

`listFacingAngle` / `saveFacingAngle` / `deleteFacingAngle` /
`statsFacingAngle` in `apps_script/Code.js`.

**One Sheet tab per labeler** (`facing_angle_labels_{Name}`), not a shared
tab with a `labeler` column — the same shape as `chin_shoulder_labels_
{Name}` (see `cs2SheetName` / `getOrCreateCs2Sheet` / `cs2Stats`, which this
mirrors closely: trim + title-case the name for the tab, 3-pass header
reconciliation on every save — drop columns not in the schema, append
missing ones, reorder the block if it's drifted — and a stats action that
enumerates every sheet by prefix rather than reading one shared tab).

**Two real slowdowns fixed in that reconciliation path** (shared code —
`ensureTextColumn()`/`getOrCreateFacingAngleSheet()` in `Code.js` — so
both fixes help every labeler-tab-shaped sheet in the file, not just this
one): `ensureTextColumn()` used to `setNumberFormat('@')` the ENTIRE
column (every row, not just the header) on every single list/save/delete,
forever — a real, expensive write repeated on a request that had almost
certainly already set it correctly the first time. Now checks the
CURRENT bottom row's format first (a single-cell read) and only pays for
the column-wide write when the sheet has actually grown past where the
format was last applied. Separately, `getOrCreateFacingAngleSheet()` used
to re-read the whole header row a second time (as `now`) to check column
order, even in the by-far-most-common case where nothing had just been
dropped or added — now reuses the header it already has in memory, and
only re-reads when a write (new columns appended) actually changed it.

Rows live in the same standalone workbook the torso-angle prototype used
(`1tRcQeoqr98yvoHldY7B8o2HmuXdisDGSHi20uyYjwyI`, now
`FACING_ANGLE_SPREADSHEET_ID`) — `openById`, not `getActiveSpreadsheet()`,
for the same reason as always: the latter would silently create an orphaned
tab back in Box Labeled Data. The Web App's deploying account needs **edit**
access to that workbook.

Each tab:

```
ts | video | round | frame | pts_sec | stance | bucket | base_x | base_y | end_x | end_y
```

No `labeler` column — the tab itself carries that now. No `deleted` column
either: a re-save **overwrites the row in place** (found by matching
video/round/frame, updated with `Range.setValues`), since there's no
cross-labeler row left to preserve once the tab is the labeler.
`deleteFacingAngle` removes a row entirely, same no-soft-delete contract as
chin-point 4.0.

`stance` (`Orthodox` / `Southpaw`) is carried over UNCHANGED from the frame
manifest — never asked about, never validated server-side, same "free
string" convention chin_tuck 2.0/3.0 use for the same field
(`CS2_HEADERS`/`CS3_HEADERS` in `Code.js`): it says which fighter a row is
judging, without which a two-person frame isn't interpretable later.
`boxer_facing_angle_frames.json`'s 2,976 real frames carry it because it
was already computed by v4's own `stance_of()` on each source sample —
nothing new had to be derived, see "The data" above.

`bucket` ∈ `0 / 45 / 90 / 135 / 180 / -135 / -90 / -45 / skip` — always
required, the actual saved answer. There is **no separate skip-reason
column**: `skip` is just one more valid bucket value, not a reason layered
on top of an empty one — there was only ever one possible reason
(`hard_to_tell`), so the column never carried anything past "was this a
skip," which `skip` itself already says. (An earlier version of this tool
did have a `skip_reason` column; it's gone from the schema going forward —
any leftover values in already-labeled sheets are being cleaned up by
hand.) `base_x`/`base_y`/`end_x`/`end_y` are OPTIONAL and independent of
`bucket`: normalized `0..1` image coordinates for the drawn line, present
only when one was drawn, never validated against `bucket` server-side.

`statsFacingAngle` powers both "Everyone's progress" and the "everyone"
half of the Distribution chart: one entry per labeler tab (`n`, `skipped`,
`last_ts`, `last {video, round, frame}`, and `buckets` — that labeler's own
resolved frames tallied into the 8 compass buckets + skip, read straight
from the stored `bucket` column). Cached 60s (`CacheService`), invalidated
on every save/delete via `facingAngleInvalidateStats()` so a labeler's own
new row is visible immediately even though the cache is shared.

**Not deployed yet** at the time this was written. Until CI picks up a
push, the live endpoint answers these actions with its default success
shape — saves appear to work and write nothing. There is no deploy marker
here (unlike chin-point 4.0's `v4cb`) to catch that automatically.

## The page

`boxer_facing_angle.html` / `boxer_facing_angle.js`.

- **The dial** — the primary control, unchanged from the original design:
  eight 45°-wide SVG wedge sectors (not eight dots), boundary values on the
  spokes, the centre value inside each wedge, skip in the centre hole (the
  biggest single target, for the answer reached for most after the eight
  real ones). Geometry `x = cx + r·sinθ, y = cy + r·cosθ`. Numpad key layout
  matches `punch_directions/punch_dir_16` (`1/3/4/6/7/8/9`, `5` = 0°, `2` =
  skip) — but the SIGN convention is the opposite of that page: boxer-
  relative there, camera-relative here.
- **The stage** — full zoom/pan: wheel zooms at the cursor, double-click or
  `0` resets, `image-rendering: pixelated` past the magnification
  threshold. The two mouse buttons do two unrelated things, so there's no
  click-vs-drag ambiguity to resolve on a single button:
  - **Left** — mousedown on an existing handle grabs and moves that ONE
    point; mousedown on empty space arms a pan, at **any** zoom (including
    fit — panning used to be gated behind `!isFitted()`, which is gone).
  - **Right** — a drag draws a brand-new line, base at mousedown and end
    at mouseup, at any zoom, replacing whatever line this frame already
    had; a **stationary** right-click (`CLICK_SLOP_PX` = 4, same threshold
    height_guard's own click-vs-drag uses) opens a small delete-line menu
    when this frame has one and does nothing otherwise. The stage
    suppresses the browser's own context menu so it never fights this.
- **Placing/editing the line (assistant)** — right-drag draws it (see
  above); from there, two small handles stay grabbable (`GRAB_PX` = 12px,
  checked against their current SCREEN position so the threshold means the
  same thing at any zoom) — dragging the **base** handle moves ONLY the
  base (the end stays exactly where it was) and dragging the **end**
  handle moves ONLY the end (the base stays put), genuinely independent —
  an earlier version of this had the base handle translate the *whole*
  line instead of just itself, which read as broken since it looked like
  dragging the base couldn't change the line's direction at all. Handles
  are counter-scaled by `--inv` exactly like chin_tuck's `.hp` dots; round
  = base, square = end, same "shape says which point" convention. None of
  this saves anything by itself — see `applyLabel()`, which is what does,
  once a wedge or the skip hole is actually clicked. Right-clicking the
  line opens a menu with a single **Delete line** action — this only
  clears the currently-drawn `state.line`, since the line is never saved
  on its own; a row already saved with one keeps it until the next save
  overwrites it.
- **Rendering** — the interactive segment (base→end) is solid; a dashed
  continuation runs from the end point to the frame edge in the same
  direction, visual only — adapted from
  `cornerman-debug-viewer/js/lenses/research/bladedness.js`'s tightrope
  line (solid + dashed + endpoint dots), there read-only, here interactive.
  Both are plain SVG `<line>`s with `vector-effect="non-scaling-stroke"` so
  stroke width stays constant in screen pixels through zoom. The geometry
  needs no pixel conversion: `#marks` shares `#stage`'s aspect-ratio-
  preserving box, so a normalized-space vector's angle is never distorted
  by a non-square frame — see `angleOf()`'s comment.
- **Everyone's progress** — unchanged: roster panel, folded by default, a
  queue-position map per labeler (never their actual answer), per-device
  hiding.
- **Report a problem** — unchanged, `tool = 'boxer_facing_angle'`.
- **Frame card** — unchanged, four copyable fields.
- **Readiness gate** — the dial and the drawing gesture are inert until
  this labeler's rows have loaded, same reasoning as always: a pick made in
  that window would be discarded when the sync landed on top of it.
- **The overview grid** — green = a bucket was picked, grey = skip, light
  grey = not yet; unchanged geometry and meaning, reading straight from the
  stored `bucket`.
- **Distribution** — you-vs-everyone emphasis pairing on 8 buckets + skip,
  both series read straight from `bucket` ("you" from `state.labels`,
  "everyone" from `statsFacingAngle`'s per-labeler `buckets`, summed
  client-side). Each bar is a **percent of that series' own total**, not a
  raw count scaled against the single largest bucket — the earlier version
  did the latter, which made every OTHER bucket look tiny whenever one
  bucket dominated (90°/-90° swamp everything here) and a "2/1051" readout
  said nothing about how either person's own labeling is actually spread.
  "40% of everyone's picks are 0°, 20% of yours are" is the comparison
  that's actually useful, and it's naturally bounded to 100% with no
  shared scale to compute. Shows `—` instead of `0%` when that series has
  no labels at all yet (an honest "no data", not a misleading all-zero row).
- **Optimistic saves** — a wedge (or skip) lands and the page advances
  immediately, the write drains behind it, a failure rolls the row back.

## Admin mode

Reached the same way as chin_tuck_4.0/height_guard's: type the literal
name **"admin"** (case-insensitive) and press Start (`state.isAdmin`).
Evaluated every height_guard admin component against this tool's own
shape — one dial click per frame, no cross-labeler point-dragging — and
kept only what still made sense, primitively:

- **The per-person stack (`#admin-stack`, `buildAdminStack()`)** — an
  earlier version of this had admin pick ONE teammate to edit "as" from a
  select, mirroring the single-identity flow every normal labeler goes
  through. Replaced entirely: admin now sees **every roster member's own
  Progress grid, Distribution, and dial stacked one after another** — long
  on purpose, since reviewing the whole team against one frame at a glance
  was the actual point, not a single delegated identity. Each person's
  mini-dial (`.admin-dial`, same wedge geometry as the main dial at a
  smaller size, built by the newly-generalized `buildDialInto(svg, onPick,
  showKeys)`) is **independently clickable** — a click under "Alex" saves
  as Alex, under "John" as John — so the stack IS how admin edits, with no
  separate identity switch at all. Fetched once per login (or the Refresh
  button): one `listFacingAngle` per roster member into `state.teamRows`
  (`Map<labeler, Map<frameKey, label>>`), then every block reads its own
  slice of that for the current frame as you page through — no per-frame
  network call. Saves are optimistic per person (`applyAdminLabel()`, the
  admin-stack sibling of `applyLabel()`) but **don't auto-advance** to the
  next frame the way a normal save does — admin may still want to fix
  several OTHER people on this same frame before moving on.
- **Every labeler's line, shown together and editable (`renderAdminLines()`,
  `#admin-lines-svg`)** — the same `base_x/y`/`end_x/y` each labeler's own
  row already carries (read straight from `state.teamRows`, the same data
  the stack's dials read) is drawn on the shared stage all at once, one
  solid segment + dashed continuation + base/end dot pair per person,
  color-coded (`ADMIN_LINE_COLORS` — Apple's own 8 system accent colors,
  assigned by roster order; a swatch next to each person's name in the
  stack matches their line's color). Each is **independently draggable** —
  grabbing a dot only ever moves that ONE labeler's ONE point
  (`grabAdminHandle()`/`moveAdminDrag()`, the same base-moves-only-base/
  end-moves-only-end independence the individual flow uses), and unlike
  the individual flow — where a line-drag only rides along on the NEXT
  bucket click — an admin edit **saves immediately on release**: the
  bucket isn't changing, there's no next click to piggyback the save on,
  and the whole point of dragging someone else's line is to fix it right
  now. Dragging one **clues that person's own dial only** — the wedge
  their new angle is nearest lights up as `.suggested` and their
  `#line-read`-style readout (`Line: +45° · nearest +45°`) updates live
  during the drag (`paintAdminDial()` now takes the angle as a parameter
  and paints only the one `<svg>`/text pair it's given — never a global
  suggestion, never another labeler's), exactly like the individual flow's
  own clue, just scoped to whichever person is actually being edited. A
  bucket-only click (no line touched) now correctly **preserves** whatever
  line that person already had — an earlier version of `applyAdminLabel()`
  hard-set `base`/`end` to `null` on every save regardless, which would
  have silently deleted a labeler's line the first time admin changed
  their bucket; fixed to carry the previous row's points over unchanged
  (skip still clears them, same as the individual flow).
- **Admin's OWN scratch line — right-drag, exactly like the individual
  flow's line, but NEVER saved anywhere.** Re-enabled the same
  `state.rdown`/`drawNewLine()`/`state.line` mechanism for admin instead
  of disabling it outright: only `applyLabel()` ever sends `state.line` to
  the backend, and admin's clicks all route through `applyAdminLabel()`
  instead, which never reads it — so there was nothing to wire OFF to make
  this safe, it's already structurally disconnected from every admin save
  path. Purely a visual reference for eyeballing an angle in the moment;
  clears on every frame change (admin has no "own" row for it to be
  restored from — see `showFrame()`) and never touches any labeler's own
  colored line — except deliberately, via one more thing bolted onto the
  existing delete-line context menu: right-clicking the scratch line
  (stationary, same gesture that already opened "Delete line") also lists
  **"Assign to {name}"** for every roster member who has answered this
  frame (a real bucket, not a skip — skips never carry a line at all) but
  has no line of their own yet (`populateLineContextMenu()`, rebuilt fresh
  on every open since eligibility depends on the current frame). Someone
  who already has a line is never offered — nothing here overwrites an
  existing one. Picking a name copies the scratch line's `base`/`end`
  onto THAT person's row, their existing bucket carried over unchanged,
  and saves immediately (`assignScratchLineTo()`, the same "no debounce,
  no next-click-to-piggyback-on" reasoning as dragging an existing line —
  see the bullet above). The scratch line itself is deliberately NOT
  cleared afterward — admin may be looking at a frame where SEVERAL
  people are missing a line and want to assign the same one to each in
  turn, so it stays put (and stops appearing on the eligible list for
  whoever it was just assigned to) until admin either draws a new one or
  right-clicks it away with "Delete line".
- **No "own" identity at all.** Admin has no personal row full stop now
  (`activeLabeler()` always returns `null` for admin) — the single-
  identity dial/Progress/Distribution cards (`#angle-card`/
  `#progress-card`/`#dist-card`) are hidden outright for admin rather than
  locked, since there is nothing of admin's own for them to show; only
  `#id-card` (frame identity) and `#act-card` (prev/next nav) stay usable
  immediately, so admin can page through frames while the stack loads.
  Pan/zoom on the stage — a real bug, not a design choice — used to stay
  dead for admin entirely: `state.ready` (what the stage's own mousedown/
  wheel gating reads) was never actually set `true` on the admin path,
  only the `body.ready` CSS class was, so the stage looked unlocked but
  every drag was silently dropped at the first `if (!state.ready) return;`
  check. Fixed by setting both.
- **Agreement (moved here from every-labeler)** — two `<select>` pickers
  over the roster (`state.agreePair`, defaulting to `['Arianne', 'John']`
  — chin_tuck_4.0's own default pair — persisted the same way chin_tuck's
  own `agreePair` is). Reads **straight from `state.teamRows`**
  (`agreeForSlot()`) — the same per-labeler cache the admin stack itself
  is built from, already fully loaded for every roster member by
  `loadAllAdminData()` — rather than a separate fetch for just the two
  picked names. An earlier version DID fetch separately
  (`state.agreeRows`, two `listFacingAngle` calls per pick), and that
  second cache was a real bug, not just slower than necessary: admin
  correcting someone's answer updated `teamRows` immediately (so that
  person's own dial/progress/dist all moved right away) but the Agreement
  grid kept reading its OWN stale snapshot until the next background
  refresh caught up — sometimes several seconds later, sometimes not
  until the next manual pair-pick. Reading `teamRows` directly means
  there's nothing left to go stale: `applyAdminLabel()` now calls
  `renderAgreement()` immediately, synchronously, whenever the person it
  just edited is one of the two currently picked — the instant a wedge
  click resolves disagreement into agreement, that frame's dot is green,
  no debounce, no save round-trip to wait for. Picking a new pair is now
  instant too, for the same reason — no fetch to wait on, just a
  re-render from data that was already there. Compares the **stored
  answer directly** — nothing derived from a line — so a labeler who
  never draws one is compared exactly the same way as one who always
  does. Reuses the `.d4-grid`/`.ovn` overview machinery. Five states:
  **green** (`.agree`) = both gave the SAME bucket; **amber** (`.near`,
  `--maybe`) = two REAL buckets that are NEIGHBORS on the compass — 45°
  apart, `bucketDistance()` — a real miss, but not the kind that says the
  two labelers were reading two different sides of the boxer; **red**
  (`.disagree`) = 2+ buckets apart (90° or more), or a skip against a real
  bucket (a skip has no angular position to measure a distance against,
  so it's always a straight disagreement, never "near"); **light blue**
  (`.solo`, the same faded-accent chin_tuck_4.0 uses for its own solo
  dots) = exactly one of the two has answered; **grey** = neither has.
  Two skips on the same frame still agree (green) — "can't tell" is a
  judgment call, not a non-answer, same reasoning as before this only had
  agree/disagree. `bucketDistance()` reuses `norm180()`'s own wrap-at-180
  math, so 180° and -135° come out 1 bucket apart, not 2, matching how the
  compass actually joins up. An earlier version of this session tried a
  SECOND grid/card for the loosened comparison, sitting right below the
  first — reverted before it was ever wired up: recoloring the ONE grid
  three ways said the same thing with half the UI. `renderAgreement()`
  (the full ~3,000-frame recompute, plus the per-batch agree/near/
  disagree gutter counts, `.ovn-g`/`.ovn-y`/`.ovn-r`) only runs when the
  underlying data actually changes — picking a pair, admin correcting one
  of the two picked people (as above), or the post-save debounce for
  anyone else's edits. Frame navigation calls `moveAgreementCur()`
  instead, which only moves the `.cur` outline: an earlier version called
  the FULL recompute from `showFrame()` (to fix the outline lagging behind
  on click — a real bug, see the git history), which fixed that but meant
  every arrow-key press or admin-stack click was re-deriving agree/
  disagree colors for every frame just to move one outline.
  `agreeForSlot()` itself also dropped a closure and an array/object
  allocation it was rebuilding on every one of those ~3,000 calls per pass
  (`agreeAnswerOf()` is now a shared top-level function, and the return
  value is a plain string). No kappa panel, no threshold controls (the
  adjustable chin/shoulder thresholds and three-axis euclid/height/width
  grids don't apply — this tool's whole comparison is a bucket-distance
  check, already fully captured by the five states above).
- **Skipped — no live-collision risk to guard against.** Presence
  ping/banner exists in height_guard because admin might start dragging
  the exact point a labeler is also looking at; here admin edits one
  identity at a time, sequentially, never simultaneously with the real
  labeler, so there's nothing to warn anyone about.
- **PNG export (`#agree-export`, `exportAgreementPNG()`)** — added later,
  a single-column cut of height_guard's own `exportDisagreementPNG()`.
  That one lays out three metrics side by side with per-point chin/
  shoulder distance stats, because height_guard's agreement is a
  continuous distance on two different points; this tool's whole
  comparison is a bucket-distance check, already fully described by the
  same five states the on-screen grid and legend show, so the export is
  just that grid + legend + the same summary line rendered to a
  downloadable PNG (`<canvas>` → `toBlob` → a clicked, revoked object URL)
  — no metric to pick between, no distance stats to print. Both the
  on-screen gutter (`.ovn-g`/`.ovn-y`/`.ovn-r`, added alongside the export
  — the Progress grid's own `.ovn-g`/`.ovn-s` pattern, agree/near/
  disagree instead of labelled/skipped) and the PNG print each batch's own
  tally, computed in the SAME pass as the dot colors themselves
  (`renderAgreement()`'s loop accumulates `batchCounts` alongside painting
  each dot; the export precomputes `batchG`/`batchY`/`batchR` the same
  way) rather than a second full pass over every frame. Zero entries are
  skipped rather than printed as "0", so the eye is drawn to batches with
  something to point at. Colors are hardcoded to the light palette rather
  than read from computed styles, same reason height_guard's own exports do:
  a downloaded image has to read correctly
  regardless of the viewer's OS theme.
- **Skipped — real complexity with no clear ask.** The manual re-push
  button — nothing here holds a teammate's unsent draft row to re-send,
  every save (admin's or not) lands immediately.
- **Not admin-gated.** "Everyone's progress" stays open to every
  labeler — it's each person's own read on where the whole team stands,
  not an admin-only view.

### Sign convention vs. `punch_directions/punch_dir_16`

That page is boxer-relative ("+ = boxer's own right"); this one is
camera-relative ("+ = camera's right"). The two must never be read as the
same axis, even though both are angle labelers in the same suite.

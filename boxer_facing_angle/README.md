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

## The data (placeholder)

`boxer_facing_angle_frames.json`'s 500 frames are **borrowed wholesale from
chin_tuck_4.0's `height_guard` queue** — same stems/round/frame, same
Firebase Storage objects (`FRAME_BUCKET` / `FRAME_PREFIX` / `FRAME_TOKEN`
in the JS are copied from `chin_tuck_4.0/height_guard/height_guard.js`).
Nothing was re-exported or re-uploaded.

This tool has no sampler of its own yet — the real plan is guard / punched /
impact phases, ~2-3k frames. Swap `boxer_facing_angle_frames.json` for a
real manifest (same shape: `{stem, round, frame, pts}[]`) when that exists
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

Rows live in the same standalone workbook the torso-angle prototype used
(`1tRcQeoqr98yvoHldY7B8o2HmuXdisDGSHi20uyYjwyI`, now
`FACING_ANGLE_SPREADSHEET_ID`) — `openById`, not `getActiveSpreadsheet()`,
for the same reason as always: the latter would silently create an orphaned
tab back in Box Labeled Data. The Web App's deploying account needs **edit**
access to that workbook.

Each tab:

```
ts | video | round | frame | pts_sec | bucket | base_x | base_y | end_x | end_y | skip_reason
```

No `labeler` column — the tab itself carries that now. No `deleted` column
either: a re-save **overwrites the row in place** (found by matching
video/round/frame, updated with `Range.setValues`), since there's no
cross-labeler row left to preserve once the tab is the labeler.
`deleteFacingAngle` removes a row entirely, same no-soft-delete contract as
chin-point 4.0.

`bucket` ∈ `0 / 45 / 90 / 135 / 180 / -135 / -90 / -45` — the actual saved
label, required unless `skip_reason` is set (exactly one of the two, never
both, never neither). `base_x`/`base_y`/`end_x`/`end_y` are OPTIONAL and
independent of that choice: normalized `0..1` image coordinates for the
drawn line, present only when one was drawn, never validated against
`bucket` server-side. `skip_reason` has one value, `hard_to_tell`.

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
  threshold. **Panning is on the right mouse button** — left-drag draws the
  assistant line instead, and giving pan its own button avoids any
  ambiguity between the two gestures at any zoom level.
- **Drawing the line (assistant)** — one continuous press-drag-release:
  mousedown places the **base** point and starts a live rotate-drag;
  mousemove rotates a preview line through the cursor, live-updating both
  the line's own angle readout AND the dial's suggested-wedge highlight;
  mouseup locks the **end** point in. A drag shorter than `MIN_LINE_PX`
  (16px) is a misclick, not a degenerate line, and is discarded. Afterward,
  two small handles stay grabbable (`GRAB_PX` = 12px, checked against their
  current SCREEN position so the threshold means the same thing at any
  zoom) — dragging the **base** handle translates the whole line, dragging
  the **end** handle rotates it around the base. Handles are counter-scaled
  by `--inv` exactly like chin_tuck's `.hp` dots; round = base, square =
  end, same "shape says which point" convention. None of this saves
  anything by itself — see `applyLabel()`, which is what does, once a wedge
  or the skip hole is actually clicked.
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
- **Distribution** — unchanged card, you-vs-everyone emphasis pairing on 8
  buckets + skip, both series read straight from `bucket` ("you" from
  `state.labels`, "everyone" from `statsFacingAngle`'s per-labeler
  `buckets`, summed client-side).
- **Agreement** — new card. Two `<select>` pickers over the roster
  (`state.agreePair`, persisted the same way chin_tuck_4.0 persists its own
  `agreePair`), fetched **on demand** — two `listFacingAngle` calls, one per
  picked name — not chin_tuck's admin-only `loadTeamRows()` fan-out over
  the whole roster (this tool has no admin mode). Agreement compares the
  **stored bucket directly** — exact match, nothing derived from a line —
  so a labeler who never draws one is compared exactly the same way as one
  who always does. Reuses the `.d4-grid`/`.ovn` overview machinery, painted
  green/red/grey, plus an overall "N% agree" line. No kappa panel, no PNG
  export, no admin gating.
- **Optimistic saves** — a wedge (or skip) lands and the page advances
  immediately, the write drains behind it, a failure rolls the row back.

**Not ported** from chin_tuck_4.0 (no counterpart here): visibility
(seen/occluded) popovers, admin mode and presence broadcasting, the
three-metric disagreement grids, PNG export, planted repeats, `camera_bad`.

### Sign convention vs. `punch_directions/punch_dir_16`

That page is boxer-relative ("+ = boxer's own right"); this one is
camera-relative ("+ = camera's right"). The two must never be read as the
same axis, even though both are angle labelers in the same suite.

# torso_angle

One bucketed verdict per sampled frame: torso rotation about the vertical
axis, relative to the **camera**. Eight intervals, each 45° wide and named
by its centre — `[-22.5, 22.5)` is "0°", `[22.5, 67.5)` is "+45°", round to
180°. `+` = turned toward the camera's right: an image-plane convention,
**not** the boxer's own right/left, and never mirrored for stance —
recorded as-shown, same reasoning as Guard Drops' `guard_hand` (raw and
auditable beats normalized and unfixable if a stance turns out wrong).

Boundaries are **half-open upward**, so a frame judged exactly on 22.5°
belongs to the `+45°` bucket. Arbitrary, but it has to be decided once —
`norm180()` / `intervalText()` in the JS are where it lives.

**Discrete choice, not a rating scale.** `bladedness/README.md` in the
backend measured that a continuous angle-rating scale on this same rotation
records the labeler's visual compression (perceived slant runs ~0.56 of the
true angle) rather than the stance, which is why that tool went pairwise
instead. A coarse fixed interval sidesteps the failure — compression only
bites within a couple of degrees of a boundary — so a direct pick is fine
here. This is not the measurement bladedness rejected it for.

## The data (placeholder)

`torso_angle_frames.json`'s 50 frames are **borrowed wholesale from
chin_tuck_4.0's `height_guard` queue** — same stems/round/frame, same
Firebase Storage objects (`FRAME_BUCKET` / `FRAME_PREFIX` / `FRAME_TOKEN`
in `torso_angle.js` are copied from
`chin_tuck_4.0/height_guard/height_guard.js`). Nothing was re-exported or
re-uploaded.

This tool has no sampler of its own yet — the real plan is guard / punched /
impact phases, ~2-3k frames. Swap `torso_angle_frames.json` for a real
manifest (same shape: `{stem, round, frame, pts}[]`) when that exists and
bump the `?v=` on the script tag; nothing else changes unless the frames
move to their own Storage prefix, which is one constant.

⚠ The queue's LENGTH is the version stamp for the cached team ranges
(`ta_range_cache`) — a rebuilt queue of a different size drops the cache by
itself, but a rebuild that happens to keep the same count would leave stale
positions. Clear the key if that ever happens.

## The backend

`listTorsoAngle` / `saveTorsoAngle` / `deleteTorsoAngle` /
`statsTorsoAngle` in `apps_script/Code.js`.

Rows live in their **own standalone workbook**
(`1tRcQeoqr98yvoHldY7B8o2HmuXdisDGSHi20uyYjwyI`, `TORSO_SPREADSHEET_ID`),
not the script's bound `Box Labeled Data` — same arrangement as the chin
generations. Opened with `openById`: `getActiveSpreadsheet()` would
silently create an empty `Torso Angle Labels` tab back in Box Labeled Data
on the next save, orphaned from every row that actually lives here. The
account the Web App is deployed as needs **edit** access to that workbook,
or `openById` throws on the first request.

Tab **"Torso Angle Labels"**, created on first save (never on a read, so
opening the page can't add a sheet):

```
ts | labeler | video | round | frame | pts_sec | bucket | skip_reason | deleted
```

`video` is the frame's `stem`. Keyed by (labeler, video, round, frame); a
re-save supersedes the prior row (soft `deleted=1`) — the same contract as
the original Chin Labels sheet, which this handler mirrors closely.

`bucket` ∈ `0 / 45 / 90 / 135 / 180 / -135 / -90 / -45` — signed degree
strings, matching how the buckets were specified rather than a compass or
clock-position name. `skip_reason` has one value, `hard_to_tell`; a row
carries exactly one of the two, never both.

`deleteTorsoAngle` still exists but **nothing on the page calls it** — the
Clear button was removed, and a mistake is corrected by picking the right
bucket, which supersedes in place. It is kept for data cleanup by hand.

`statsTorsoAngle` powers the team panel: one entry per labeler with `n`,
`skipped`, `last_ts` and `last {video, round, frame}`. Unlike
`doGetChinPoint`'s stats it reads ONE flat sheet rather than a tab per
labeler, so there is no fan-out and no cache — and no `force` parameter,
because there is nothing cached to bypass.

**Not deployed yet.** The Apps Script auto-deploys from `master` via CI, and
until that lands the live endpoint answers these four actions with its
default success shape — so saves appear to work and write nothing. Unlike
chin-point 4.0 there is no `v4cb`-style deploy marker to refuse a stale
deployment; add one here if this ever ships to labelers before the script
does.

## The page

`torso_angle.html` / `torso_angle.js`. **Ported from
`chin_tuck_4.0/height_guard`**, not merely styled after it:

- **The stage** — full zoom/pan: wheel zooms at the cursor (`zoomAt`, with
  the same snap-through-fit and sub-pixel clamp), drag pans, double-click
  or `0` resets, `image-rendering: pixelated` past `SHARP_MAG` device
  pixels per source pixel but only for `SHARP_MIN_SOURCE`+ sources. A zoom
  chip appears only while zoomed. `#stage` takes the frame's own aspect
  ratio on load.
- **Everyone's progress** — the roster panel, folded by default, with the
  head count on the pill. Each row is name / count / a **map** of where in
  the queue that labeler's frames fall (`frameRuns` → positioned segments,
  not a proportional bar), expandable to 1-based inclusive ranges
  (`[1, 20] · [31, 41]`), with a per-device hide control that never reaches
  the sheet. Never shows anybody's actual answer — a position carries no
  verdict, so there is nothing in it to anchor on.
- **Report a problem** — the same disclosure pill and the same site-wide
  bug sheet (`saveBugReport`, `tool = 'torso_angle'`), deliberately
  independent of `call()`'s retry machinery so it stays copy-pasteable.
- **Frame card** — video / round / frame / timestamp, each separately
  copyable. `copyText()` adds an `execCommand` fallback and a visible
  failure state, which height_guard's version lacks: a `writeText()` that
  is refused there leaves a button that silently does nothing.
- **Readiness gate** — the dial and nav are inert until this labeler's rows
  have loaded, so a pick can't be discarded by the sync landing on top of
  it. The frame stays fully visible throughout; only the writing controls
  are disabled, and the lock says which of "no name yet" / "loading" is
  actually true.
- **Nav is prev/next only** — one segmented pair spanning the card. There
  is no Clear (pick another bucket; the save supersedes) and no
  "next unlabeled" (`start()` already lands on the first unlabeled frame).
- **The overview grid** — one dot per queue slot in queue order, same
  20-col / 9px geometry and batch-of-100 gutter as chin_tuck_4.0's, so
  progress reads as the same object in both tools. **Green** = a bucket was
  picked, **grey** = "can't tell", **light grey** = not answered yet;
  the current slot carries an outline. Built once and repainted in place —
  rebuilding thousands of nodes to move one outline is the expensive way.
  Clicking a dot jumps to that frame, and every dot's tooltip names its
  actual bucket, so colour is never the only signal.
- **Optimistic saves** — the pick lands, the page advances, the write
  drains behind it, and a failure rolls the row back so the frame
  resurfaces rather than being silently lost.

**Not ported** (no counterpart in a one-bucket-per-frame question): point
placement, seen/occluded popovers, admin mode and presence, disagreement
grids, PNG export, planted repeats, `camera_bad`.

### The dial

Eight 45° **sectors** of a ring, not eight dots — the wedge *is* the
interval, so its width on screen is the answer's width and nothing has to
explain that a bucket covers a range. The centre value sits inside each
wedge, the boundary values on the spokes that divide them, and the reading
under the dial spells out the interval the current pick stands for
(`+90° — [+67.5°, +112.5°)`). Skip lives in the hole: the largest single
target, which suits the answer reached for most after the eight real ones.

Geometry is `x = cx + r·sin θ`, `y = cy + r·cos θ`, so 0° is at the bottom
(torso squared to camera), 180° at the top (back to camera), +90° right.
That maps dial angle θ to SVG screen angle `φ = 90° − θ`, so an increasing
θ runs in SVG's *negative* sweep direction — hence sweep-flag 0 on the
outer arc and 1 on the inner one coming back. Get that backwards and every
wedge inverts.

Keys are the numpad layout `punch_directions/punch_dir_16` uses
(`1/3/4/6/7/8/9`, `5` = 0°, `2` = skip) so they mean the same thing across
this suite — but that page's **sign convention is the opposite of this
one**: it is boxer-relative ("+ = boxer's own right"), this is
camera-relative. The two must not be read as the same axis.

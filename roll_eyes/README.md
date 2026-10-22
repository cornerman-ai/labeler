# Roll eyes

Do the eyes stay up through the roll? The coach (Stafford) rates one looping clip per labeled roll: **Good** (the
eyes stay on the opponent), **Mid** (they drop for a moment at the bottom), **Bad** (looks at the floor) or
**Can't tell** — which needs a reason: the page won't save it until the comment says why (quick picks: glove over the
face, head turned away, face out of the picture, too blurry / too small, not a roll). Any rating can carry a comment.
The ratings set the cut-off of the "keep your eyes up when you roll" rule (cornerman-backend
`ml/research/roll_eyes/`).

Link to send: https://cornerman-ai.github.io/labeler/roll_eyes/roll_eyes.html?labeler=Stafford
(`?labeler=` seeds the name once; anyone else types their own in the top bar).

## What is on screen

The uppercut hand-drop labeler's page (`../uppercut_drop/`, itself the steps / punch template: `../punch/punch.css`,
`shared/player.js`, `shared/ui.js`).

- The clip, big: 0.6 s before the roll starts → 0.3 s after it ends, muted, looping. Scroll on the picture to zoom,
  drag to pan, double-click to reset.
- The timeline: a lane with the **guard** before the roll, the **roll** as labeled and a mark at its **lowest
  point** (the head lowest in the picture, where the model reads the angle).
- Transport: play / pause, ±1 and ±2 frames, the time and frame number, a 0.5× switch and the speed menu.
- Left panel: the question, the comment box, four buttons: one tap saves the rating and the comment and plays the
  next clip. ◂ Back / Next ▸ to change an earlier rating.
- Keys: `1` Good · `2` Mid · `3` Bad · `0` Can't tell · `C` the comment (Enter finishes it) · space pause ·
  `←` `→` one frame · `⇧←` `⇧→` the clip before / after · `S` 0.5× / 1× · `?` the help sheet.
- Phone: the page scrolls: the clip, which roll, the comment, the four buttons, back / next.

## Admin mode

Type the name **admin**. Nothing is rated (the Apps Script refuses admin saves). Every roll once, ordered by video and
time, with ◂ Back / Next ▸ and **Next video ▸▸** (`V`). Instead of the rating card:

- **Model**: the head angle at the bottom of the roll (how far the face points below the camera's horizontal, the
  median of the lowest frame ±4), the guard angle (0.5 s before), the change, yaw, the face score, how many of the 5
  bottom frames found a face — `admin.json`, fetched only in this mode.
- A plot of the angle on every frame of the clip (green under 30°, red at or above, grey under the face-score gate,
  orange ticks where no face was found), the roll shaded, the guard median dashed, the playhead.
- On the clip, per frame: the **six face points the angle is solved from** (yellow: nose tip, chin, outer eye
  corners, mouth corners), the other landmarks (white) and an arrow from the nose tip the way the face points, with
  the angle — `labeler_media/roll_eyes/v1/admin/<roll_id>.json`.
- **Ratings**: every rater's rating and comment on this roll.

The 30° line is for eyeballing, not a measured cut-off.

## The queue

`queue.json` (built by cornerman-backend `ml/research/roll_eyes/roll_rating/build.py`, never edited by hand): every
clip once in a fixed shuffle, plus ~10 % **blind repeats** — the same clip again 40–120 slots later, flagged `rep=1`
only in the data. Every rater gets the same order. The page resumes at the first slot the rater hasn't rated.

(2026-10-22) 2,139 clips + 214 repeats = 2,353 slots, from John's 2,156 labeled rolls placed on a cached round
(the 2026-09-26 freeze); 17 second labels of the same roll were dropped.

## Where the ratings land

Workbook **Roll eyes ratings** (Drive `Ambo/data/labels/labeling_team/`, `ROLL_EYES_SPREADSHEET_ID`), tab
`Ratings`, written by `doGetRollEyes` in `apps_script/Code.js`:

ts | rater | slot | rep | clip_id | roll_id | video_name | side | stance | training_type | roll_start | roll_end |
bottom_sec | clip_start | clip_end | rating | rating_rank | comment | speed | dwell_sec | deleted

- One live row per (rater, slot). Rating a slot again marks the old row `deleted=1` and appends the new one; read
  only `deleted` ≠ 1.
- `rating_rank`: good 3, mid 2, bad 1, blank for cant_tell. A `cant_tell` always has a `comment`.
- `clip_id` = `roll_id` (`r0000`… — the row of cornerman-backend `ml/research/roll_eyes/out/rolls.csv`; the model's
  numbers per roll are in `roll_rating/clips.csv` there).
- Self-consistency: rows with the same rater and clip_id, one `rep=0` and one `rep=1`.

## Gotchas

- Clips and the admin face files are on Firebase Storage (`labeler_media/roll_eyes/v1/clips/<roll_id>.mp4`,
  `.../admin/<roll_id>.json`), not in this repo. A clip missing there shows "clip failed to load".
- Saves go through a per-browser outbox (localStorage) and retry every 5 s; a rating is only in the Sheet once the
  status says "all saved".
- Rebuilding `queue.json` after rating has started reshuffles the slots; the rows keep `clip_id`, so they still
  join, but `slot` / `rep` stop matching the new queue.
- The admin face data ends 0.2 s after the roll (the lens data's window); the clip runs 0.1 s longer, so the last
  frames have no overlay.

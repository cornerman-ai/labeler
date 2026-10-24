# Roll shoulders

Do the shoulders rotate through the roll? The third pass on the roll clips (same clips as `../roll_eyes/` and
`../roll_legs/`, one question per pass), **frontal clips only** — the boxer facing the camera in guard (Mathé,
2026-10-24). The coach (Stafford) rates one looping clip per labeled roll:

- **Good** (`1`, rank 1) — the shoulders turn with the roll and come through
- **Bad** (`2`, rank 0) — the shoulders stay square or barely turn
- **Can't tell** (`0`) — needs a reason in the comment (quick picks: shoulders hidden, body out of the picture, too
  blurry / too small, not a roll)

Any rating can carry a comment. The ratings set the cut-off on the skeleton measure (cornerman-backend
`ml/research/roll_eyes/roll_rating/roll_shoulders.py`: the shoulder line's largest turn from guard inside the roll,
on BlazePose's 3D points).

Link to send: https://cornerman-ai.github.io/labeler/roll_shoulders/roll_shoulders.html?labeler=Stafford

## Changing the question or the scale

Edit the `PASS` block at the top of `roll_shoulders.js` (the same fields as `../roll_legs/README.md` describes); the
buttons, colours, keys, help sheet and examples follow, and the Apps Script (`doGetRollShoulders`) takes any
lower_snake rating with the rank the page sends. Then one clip per new rating in `examples.json`.

## What is on screen

The roll legs page (its stylesheet is `../roll_legs/roll_legs.css`): the clip (0.6 s before the roll → 0.3 s after
it), the timeline (guard / roll / lowest point), transport, the comment, the buttons, ◂ Back / **Examples** / Next ▸.
Keys: `1` good · `2` bad · `0` can't tell · `C` the comment · `E` examples · space · `←` `→` · `⇧←` `⇧→` · `S` · `?`.

**Examples** (`examples.json`, kept out of the queue): picked by Claude from the measure and the guard and bottom
frames, frontal clips only — **for Mathé to confirm or swap**: good r1701 (a 98° turn into the bottom), bad r0297
(dips straight down, shoulders square, 15°), can't tell r1805 (half out of the picture, blurred).

## Admin mode

Type the name **admin**: no rating; every roll once by video and time, Next roll / Next video (`V`); the measure
against guard (the shoulder line's largest turn in the roll and at the bottom, the largest shoulder dip, the hips'
turn, the shoulders turning past the hips), the shoulder line (yellow) and the hip line (blue) drawn on the clip —
`labeler_media/roll_eyes/v1/admin_body/<roll_id>.json` — the shoulder line's apparent width and tilt in the picture
plotted over the clip, and every rater's rating + comment.

## The queue and the sheet

`queue.json` and `admin.json` are built by cornerman-backend `ml/research/roll_eyes/roll_rating/shoulders_pass.py`:
the frontal roll clips — |facing| ≤ 25° in guard by the production facing model (0° = chest to the camera; the
pipeline's front window; read before the roll because the roll turns the body) — but the examples, its own fixed
shuffle, ~10 % blind repeats. (2026-10-24) 323 frontal of 2,139 clips → 320 + 32 repeats = 352 slots.

Workbook **Roll shoulders ratings** (Drive `Ambo/data/labels/labeling_team/`, `ROLL_SHOULDERS_SPREADSHEET_ID`), tab
`Ratings`, the same columns and rules as the other roll passes (`../roll_eyes/README.md`); `rating_rank` is the page's.

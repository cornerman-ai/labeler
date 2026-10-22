# Roll legs

How does the boxer get under the punch in a roll: by bending the legs or by bending the upper body? The second pass
on the roll clips (same clips as `../roll_eyes/`, one question per pass). The coach (Stafford) rates one looping clip
per labeled roll. **Draft** scale (2026-10-22, Mathé is settling it with Stafford):

- **Legs** — knees bend, the torso stays upright
- **Mostly legs** — knees bend, a little lean
- **Mostly upper body** — bends at the waist, legs fairly straight
- **Upper body** — folds forward at the waist, legs straight
- **Can't tell** — needs a reason in the comment (quick picks: legs out of the picture, body hidden, too blurry /
  too small, not a roll)

Any rating can carry a comment. The ratings set the cut-offs on the skeleton measure (cornerman-backend
`ml/research/roll_eyes/roll_rating/roll_body.py`: knee bend against forward trunk lean at the bottom of the roll).

Link to send: https://cornerman-ai.github.io/labeler/roll_legs/roll_legs.html?labeler=Stafford
(`?labeler=` seeds the name once; a second rater opens the same link with their own name and gets the same order).

## Changing the question or the scale

Edit the `PASS` block at the top of `roll_legs.js` — the question, the hint, the "watch" line, the ratings (`r` the
name stored in the sheet, lower_snake; `key` the shortcut; `rank` the sheet's `rating_rank`, a number or `''`;
`name`, `desc`) and the Can't tell reasons. The buttons, keys, help sheet, examples and colours (by position) follow.
The Apps Script (`doGetRollLegs`) takes any lower_snake rating with the rank the page sends, so it needs no change.
Then put one clip per new rating in `examples.json` (any roll id from `queue.json`). Changing the scale after
rating has started mixes two scales in one sheet: say so in the commit, and read the rows by `ts`.

## What is on screen

The roll eyes page (see `../roll_eyes/README.md`): the clip (0.6 s before the roll → 0.3 s after it), the timeline
(guard / roll / lowest point), transport, the comment, the buttons, ◂ Back / **Examples** / Next ▸.
Keys: `1`–`4` and `0` (from `PASS`) · `C` the comment · `E` examples · space · `←` `→` · `⇧←` `⇧→` · `S` · `?`.

**Examples** (`examples.json`): one clip per rating, kept out of the queue. The current five were picked by Claude
from the skeleton measure and a look at the bottom frame — **for Mathé to confirm or swap**:
legs r1594, mostly legs r2104, mostly upper body r0724, upper body r0688, can't tell r0437 (the picture stops at
the waist).

## Admin mode

Type the name **admin**: no rating; every roll once by video and time, Next roll / Next video (`V`); the skeleton
measure at the bottom against guard (knee bend, trunk lean from the camera's vertical, hip flexion, and the share of
the two that came from the legs), a plot of knee bend and trunk lean per frame, the joints drawn on the clip (legs
blue, trunk orange against a dashed vertical) — `labeler_media/roll_eyes/v1/admin_body/<roll_id>.json` — and every
rater's rating + comment.

## The queue and the sheet

`queue.json` and `admin.json` are built by cornerman-backend `ml/research/roll_eyes/roll_rating/legs_pass.py`:
every roll clip but the examples, its own fixed shuffle (not the roll eyes order), ~10 % blind repeats.
(2026-10-22) 2,134 clips + 213 repeats = 2,347 slots.

Workbook **Roll legs ratings** (Drive `Ambo/data/labels/labeling_team/`, `ROLL_LEGS_SPREADSHEET_ID`), tab `Ratings`,
the same columns and rules as Roll eyes ratings (`../roll_eyes/README.md`): one live row per (rater, slot), a re-rate
soft-deletes (`deleted=1`), `clip_id` = `roll_id`, a `cant_tell` always has a `comment`; `rating_rank` is the page's.

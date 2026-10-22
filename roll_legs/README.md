# Roll legs

Does the boxer use the legs to get under the punch in a roll? The second pass on the roll clips (same clips as
`../roll_eyes/`, one question per pass). The coach (Stafford) rates one looping clip per labeled roll:

- **Uses the legs** (`1`, rank 2) — the knees bend to take the body down
- **Mid** (`2`, rank 1) — the knees bend some; the rest comes from bending over
- **Doesn't use the legs** (`3`, rank 0) — the legs stay fairly straight; the dip comes from bending over
- **Can't tell** — needs a reason in the comment (quick picks: legs out of the picture, body hidden, too blurry /
  too small, not a roll)

(2026-10-22, Mathé: legs or not — where the head and eyes go is the roll eyes pass, so no upper-body scale here.
The first draft, Legs / Mostly legs / Mostly upper body / Upper body, was replaced before anyone rated. **Mid** was
added the same day at Stafford's request ("two is too little") after his first 15 ratings, which were made on two
answers: `uses_legs` then had rank 1 — those 13 rows were moved to rank 2 in the sheet so the ranks read the same;
`no_legs` kept key 2 until then, key 3 since.)

Any rating can carry a comment. The ratings set the cut-off on the skeleton measure (cornerman-backend
`ml/research/roll_eyes/roll_rating/roll_body.py`: the knee bend added from guard to the bottom of the roll, beside
the forward trunk lean).

Link to send: https://cornerman-ai.github.io/labeler/roll_legs/roll_legs.html?labeler=Stafford
(`?labeler=` seeds the name once; a second rater opens the same link with their own name and gets the same order).

## Changing the question or the scale

Edit the `PASS` block at the top of `roll_legs.js` — the question, the hint, the "watch" line, the ratings (`r` the
name stored in the sheet, lower_snake; `key` the shortcut; `rank` the sheet's `rating_rank`, a number or `''`;
`tone` the button's colour, `name`, `desc`) and the Can't tell reasons. The buttons, keys, help sheet and examples
follow.
The Apps Script (`doGetRollLegs`) takes any lower_snake rating with the rank the page sends, so it needs no change.
Then put one clip per new rating in `examples.json` (any roll id from `queue.json`). Changing the scale after
rating has started mixes two scales in one sheet: say so in the commit, and read the rows by `ts`.

## What is on screen

The roll eyes page (see `../roll_eyes/README.md`): the clip (0.6 s before the roll → 0.3 s after it), the timeline
(guard / roll / lowest point), transport, the comment, the buttons, ◂ Back / **Examples** / Next ▸.
Keys: `1` uses the legs · `2` mid · `3` doesn't · `0` can't tell (from `PASS`) · `C` the comment · `E` examples · space · `←` `→` · `⇧←` `⇧→` · `S` · `?`.

**Examples** (`examples.json`): one clip per rating, kept out of the queue. Picked by Claude from the skeleton
measure and a look at the bottom frame — **for Mathé to confirm or swap**: uses the legs r1594 (knees +55° from
guard), mid r1226 (knees +17°, lean +16°), doesn't use the legs r0688 (knees +1°, folds forward +26°), can't tell
r0437 (the picture stops at the waist). The page drops the examples from the queue itself, so adding one needs no
queue rebuild (r1226's slot, 463, simply goes).

## Admin mode

Type the name **admin**: no rating; every roll once by video and time, Next roll / Next video (`V`); the skeleton
measure at the bottom against guard (knee bend, trunk lean from the camera's vertical, hip flexion, and the share of
the two that came from the legs), a plot of knee bend and trunk lean per frame, the joints drawn on the clip (legs
blue, trunk orange against a dashed vertical) — `labeler_media/roll_eyes/v1/admin_body/<roll_id>.json` — and every
rater's rating + comment.

## The queue and the sheet

`queue.json` and `admin.json` are built by cornerman-backend `ml/research/roll_eyes/roll_rating/legs_pass.py`:
every roll clip but the examples, its own fixed shuffle (not the roll eyes order), ~10 % blind repeats.
(2026-10-22) 2,136 clips + 214 repeats = 2,350 slots.

Workbook **Roll legs ratings** (Drive `Ambo/data/labels/labeling_team/`, `ROLL_LEGS_SPREADSHEET_ID`), tab `Ratings`,
the same columns and rules as Roll eyes ratings (`../roll_eyes/README.md`): one live row per (rater, slot), a re-rate
soft-deletes (`deleted=1`), `clip_id` = `roll_id`, a `cant_tell` always has a `comment`; `rating_rank` is the page's.

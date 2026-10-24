# Bag bite

Does a punch on the heavy bag **snap** (hits and comes straight back) or is it **pushing** (rests on the bag, pushes
it, drifts back)? The coach rates one looping clip per punch with two buttons, **Snapping** or **Pushing** — no rating
keys, no "can't tell" (Oleksandr, 2026-10-24). Any rating can carry a comment. The ratings are what
rule 41 ("punches stuck in the bag", cornerman-backend `ml/research/bag_bite/`) is measured against: its readings
(arrival speed, pause on the bag, snap back) did not separate the punches Oleksandr marked, so the coach's eye says
what to measure.

Link to send: https://cornerman-ai.github.io/labeler/bag_bite/bag_bite.html?labeler=Stafford
(`?labeler=` seeds the name once; anyone else types their own in the top bar).

## What is on screen

The roll legs labeler's page (`../roll_legs/`, on the roll eyes / uppercut hand-drop / steps / punch template:
`../punch/punch.css`, `shared/player.js`, `shared/ui.js`), minus the examples sheet.

- The clip, big: 0.7 s before the punch starts → 0.7 s after it ends, cropped to a square around the boxer (black
  past the picture's edge), muted, looping, half speed by default. Scroll on the picture to zoom, drag to pan,
  double-click to reset.
- The skeleton on the clip (BlazePose, smoothed as rule 41 reads it; the **Skeleton** button hides it), the
  punching arm **orange** while it punches; faint bones are joints BlazePose barely sees.
- Left panel: the skeleton alone with *before / the punch / after*, and the facing model's angle as a compass seen
  from above (camera at the bottom; orange side-on, blue facing the camera or away).
- The timeline: two lanes, every punch on the clip — lead hand on top, rear below; the punch to rate is orange.
- Rating by the buttons only. The only keys: `←` `→` one frame · `⇧←` `⇧→` the clip before / after (and `?` the help
  sheet). The skeleton, the 0.5× switch and play / pause are buttons.
- Phone: the page scrolls: the clip, which punch, the skeleton, the comment, the buttons, back / next.

Nothing on the page (or in `queue.json`, or in the clip files) says which group a punch is from, which video it is,
or what rule 41 scored it.

## Admin mode

Type the name **admin**. Nothing is rated (the Apps Script refuses admin saves). Every clip once, by id, with
◂ Back / Next ▸, and every rater's rating and comment on it. The key and rule 41's readings are not here: they are in
cornerman-backend `ml/research/bag_bite/rating/clips.csv`.

## The clips and the queue

`queue.json` (built by cornerman-backend `ml/research/bag_bite/rating/build.py`, never edited by hand): `clips`
(hand, punch type, frame count, the clip's fps) and `queue` — every clip once in a fixed shuffle, plus ~10 % **blind
repeats**: the same clip again 40–120 slots later, flagged `rep=1` only in the data. Every rater gets the same order;
the page resumes at the first slot the rater hasn't rated.

(2026-10-24) 200 clips + 20 repeats = 220 slots, from the 16 bag-work test videos (`combined_pipeline/configs/
training_types.json`), 50 per group: punches from the videos and punch types Oleksandr marked as pushing, punches from
the bag-work videos he did not mention, rule 41's lowest (punch score under 40) and its highest (85 or more). The first
survey's 100 punches (the sendable `bag_punch_survey.html`, 25 per group) are among them, so the answers given there
(bites / pushing) can be set against these.

## Where the ratings land

Workbook **Bag bite ratings** (`1zJsYa5YeRfa01sj9t2ACNu50iN41HBkOr9M0CuI070Q`, Drive `Ambo/data/labels/labeling_team/`,
beside the roll workbooks), tab `Ratings`,
written by `doGetBagBite` in `apps_script/Code.js`, which makes the workbook on its first call and keeps its ID in the
script property `BAG_BITE_SPREADSHEET_ID`:

ts | rater | slot | rep | clip_id | hand | punch_type | rating | rating_rank | comment | speed | dwell_sec | deleted

- One live row per (rater, slot). Rating a slot again marks the old row `deleted=1` and appends the new one; read
  only `deleted` ≠ 1.
- `rating`: `snapping` (rating_rank 1) or `pushing` (0).
- `clip_id` (`b000`…) joins cornerman-backend `ml/research/bag_bite/rating/clips.csv`: the group, the video, the
  punch's frames, rule 41's readings and score, and `survey_id` (the punch's number in the first survey, if it was
  there).
- Self-consistency: rows with the same rater and clip_id, one `rep=0` and one `rep=1`.

## Gotchas

- Clips and data files are on Firebase Storage (`labeler_media/bag_bite/v1/clips/<id>.mp4`,
  `.../data/<id>.json`), not in this repo. A clip missing there shows "clip failed to load".
- Saves go through a per-browser outbox (localStorage) and retry every 5 s; a rating is only in the Sheet once the
  status says "all saved".
- Rebuilding `queue.json` after rating has started reshuffles the slots; the rows keep `clip_id`, so they still
  join, but `slot` / `rep` stop matching the new queue.

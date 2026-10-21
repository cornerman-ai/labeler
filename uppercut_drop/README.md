# Uppercut hand drop

How far does the punching hand drop before the uppercut? The coach (Stafford)
rates one looping clip per labeled uppercut: **Great** (fires straight from
guard), **Good** (a small dip you wouldn't correct), **Bad** (a clear drop you
would mention), **Very bad** (winds down toward the waist and telegraphs) or
**Can't tell**. The Good / Bad line ("would you correct it?") becomes the
threshold of the "keep your hand up before the uppercut" score.

Link to send: https://cornerman-ai.github.io/labeler/uppercut_drop/uppercut_drop.html?labeler=Stafford
(`?labeler=` seeds the name once; anyone else types their own in the top bar).

## What is on screen

- The clip: 0.5 s before the punch starts → 0.15 s after impact, muted, looping.
  1× / 0.5× (remembered per browser), tap the clip or press space to pause.
- The question, and which hand to watch ("Watch the **left hand** · lead uppercut").
- Five buttons, one tap → saved → next clip. ← Back to change an earlier rating.
- **Examples**: one clip per rating (`examples.json`), kept out of the queue.
- Keys: `1` Great · `2` Good · `3` Bad · `4` Very bad · `0` Can't tell ·
  space pause · `S` speed · `←` `→` back / next · `E` examples.

## The queue

`queue.json` (built by cornerman-backend
`ml/research/hand_drop/uppercut_rating/build.py`, never edited by hand): every
clip once in a fixed shuffle, plus ~10 % **blind repeats** — the same clip again
40–120 slots later, flagged `rep=1` only in the data. Every rater gets the same
order, so a **second rater** just opens the same link with their own name and
overlaps on every clip both have reached. The page resumes at the first slot
the rater hasn't rated.

(2026-10-21) 2,810 clips + 281 repeats = 3,091 slots, from the 3,030 uppercuts
in Combined Data (202 inside an Unusable span, 16 with no source video, 2 with
no usable time were left out). The 5 example clips are filtered out on the page,
so a rater sees 3,086.

## Where the ratings land

Workbook **Uppercut hand drop** (Drive `Ambo/data/labels/labeling_team/`,
`UPPERCUT_DROP_SPREADSHEET_ID`), tab `Ratings`, written by `doGetUppercutDrop`
in `apps_script/Code.js`:

ts | rater | slot | rep | clip_id | punch_uuid | video_id | video_name |
punch_type | hand | side | target | stance | punch_sec | impact_sec |
impact_known | clip_start | clip_end | rating | rating_rank | speed | dwell_sec | deleted

- One live row per (rater, slot). Rating a slot again marks the old row
  `deleted=1` and appends the new one; read only `deleted` ≠ 1.
- `rating_rank`: great 4, good 3, bad 2, very_bad 1, blank for cant_tell.
- `clip_id` = `punch_uuid` (one clip per uppercut); `video_id` is the Drive file id.
  `side` is the boxer's own left / right of the punching hand.
- `impact_known` = 0: no impact label, the clip ends at start + 0.30 s + 0.15 s.
- Self-consistency: rows with the same rater and clip_id, one `rep=0` and one `rep=1`.

## Gotchas

- Clips are on Firebase Storage (`labeler_media/uppercut_drop/v1/clips/<punch_uuid>.mp4`),
  not in this repo. A clip missing there shows "clip failed to load".
- Saves go through a per-browser outbox (localStorage) and retry every 5 s, so a
  flaky phone connection loses nothing — but a rating is only in the Sheet once
  the status says "all saved".
- Rebuilding `queue.json` after rating has started reshuffles the slots; the rows
  keep `clip_id`, so they still join, but `slot` / `rep` stop matching the new queue.
- Swapping an example: change its `id` in `examples.json` to any clip id in
  `queue.json`; the page drops it from the queue by itself.

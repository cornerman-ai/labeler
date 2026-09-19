# Unusable footage — the labeler

Where, in a video, can the skeleton not be used? The BlazePose skeleton is
extracted after the rounds and punches are labeled, so nobody can judge it
while labeling them. This is the pass that judges it: watch the video with the
skeleton drawn on top, mark every stretch where that skeleton is wrong, and
mark the video reviewed. Open it from the landing page, or directly at
`unusable/index.html`.

## The loop

1. **Pick a video** from the list (the tracking sheet's videos; "unreviewed
   only" is on by default, so what you see is what is left). With the video and
   skeleton folders connected, the file and its skeleton files open by
   themselves, exactly as in the punch labeler. The skeleton lane on the
   timeline shows where a skeleton exists at all; the **detected** lane under
   it is what those files say by themselves — red where there is no skeleton
   for 3 frames or more, a yellow tick where the skeleton jumps more than a
   torso within a quarter second (onto someone else, usually). Hints to check
   on the footage, not labels: click one to go there, then judge.
2. **Watch with the skeleton on** (`K` toggles it). Where the skeleton is not
   the boxer's, or is not there: `Enter` at the start, `Enter` at the end (or
   `S` / `E`; twice on the same frame for a one-frame problem), then the
   reason — `1` out of frame, `2` other person, `3` other
   thing (a painting, a statue, the bag), `4` frozen, `5` camera, `6` other.
   The span saves itself; `Esc` clears a half-made one. When the reason
   changes mid-stretch — the boxer walks out, then the tracker lands on
   someone else — make two spans back to back, one per reason: the end of
   the first is the start of the second. Your spans are the top lane; other
   people's show below yours, read-only.
3. **Done with the video: `R`.** The video is marked reviewed and the list
   moves on to the next unreviewed one (untick "then go to the next video" to
   stay). No name is needed on this page: spans and marks carry whatever name
   the punch labeler stored — Admin included — or none.
4. **A hopeless video: "Whole video unusable".** It shows how many labeling
   rows the video has in Combined Data Archive and in every labeler's tab, and
   on OK moves them all to the `Skeleton Problems` tab and marks the video
   reviewed. Combined Data catches up at the next rebuild.

## What is unusable

A stretch is unusable when the skeleton on screen is not the boxer doing the
round: the boxer out of the picture or hidden behind the bag, the skeleton
sitting on someone or something else, a skeleton that does not move, the camera
cutting or moving. A skeleton that is the boxer's but jittery is usable.

## Where it goes

Two tabs of the labels workbook (the punch workbook), written through the
shared Apps Script:

| tab | columns | one row per |
|---|---|---|
| `Unusable Spans` | id, video_file, labeler, reason (out_of_frame, other_person, other_thing, frozen, camera, other), start_sec, end_sec, span_uuid, ts | span |
| `Unusable Reviewed` | video_file, video_name, labeler, verdict, ts | video and labeler (`reviewed` or `whole_video_unusable`) |

Times are the sheet's `MM:SS.mmm`, source-video seconds, the same clock as
the punch labels. A retired video's rows land in `Skeleton Problems` as they
were, with the source tab, who moved them and when in columns 28–30.

## Under the hood

`app.js` is the page; the player, seek bar, minimap and zoom are
`shared/player.js`, the transport row, the timeline's scroll-zoom, the
status chips and the shortcuts sheet `shared/ui.js` (the punch page's chrome,
shared since 2026-09-19), the identity store `shared/labeler_name.js` (no name
field on this page: spans are filed under the name the punch labeler set),
the overlay
`../punch/skeleton.js` and the connected folders `../punch/video-folder.js` —
the same ids as the punch page, so a folder connected there is connected here.
The detected lane is computed in the browser from the loaded skeleton files
(`detectorHints()` in `app.js`) with the rules of cornerman-backend's
`ml/research/skeleton_usability/` (`no_skeleton.py`, and the jump rule of
`jumps.py` — not its other-person model, not `frozen.py`), so a newly
extracted video shows its hints with no export step; a threshold changed there
is changed here too.
The backend is `doGetUnusable` in `apps_script/Code.js` (actions
`listUnusable`, `addUnusable`, `updateUnusable`, `deleteUnusable`,
`listUnusableReviewed`, `markUnusableReviewed`, `retireVideo`; every write
under the punch write lock, `retireVideo` with `dry=1` for the counts).

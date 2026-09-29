# Unusable footage — the labeler

Where, in a video, can the skeleton not be used? This is **step 4 of the
label review** (`cornerman-backend/ml/label_review/REVIEW_FLOW.md`): the check
report is clean, the skeleton has been extracted for every round in the
labeling tabs, and before Mathe flips a video's rows from `Reviewing` to `yes`
the team judges its skeleton here — go through the moments where the skeleton
may have leapt onto someone or something else, and mark where it did. Open it
from the landing page, or directly at `unusable/index.html`.

## The loop

1. **Pick a video** from the list: the tracking sheet's videos, filtered to
   those whose rows are still `Reviewing` in the labeling tabs ("still
   Reviewing only", on by default — what you see is what is left; ↻ re-reads
   the sheet). With the video and skeleton folders connected, the file and its
   skeleton files open by themselves, exactly as in the punch labeler.
2. **Watch the whole video with the skeleton on** (`K`); the **moments to
   check** show where to look hardest — yellow on the timeline and the minimap,
   listed in the To check card (`J` the next, `Shift` `J` the one before, or
   click one). A moment is a jump (the skeleton moves more than a torso within a
   quarter second) or a stretch without a skeleton, a second either side —
   computed in the browser from the skeleton files. A moment is ticked once you
   move past it (per video, in this browser). Where the skeleton leaps
   onto someone or something else: mark the stretch it stays there, from the
   leap to the jump back — `Enter` at the start, `Enter` at the end (or `S` /
   `E`), then `1` other person or `2` other thing (a painting, a statue, the
   bag). Anything else wrong with the skeleton: `3` other issue, the catch-all.
   The span saves itself; `Esc` clears a half-made one. **Change your mind** as
   in the punch labeler: click one of your spans (lane or list) to select it,
   drag its edges or its middle on your lane (frame-snapped, the video follows
   the edge), ✎ to type its times or take them from the playhead, the reason
   dropdown, `Delete` or × to delete, `Z` / `⌘Z` to undo the last change.

   **Labeling mode** (the default) shows only the skeleton lane (where a
   skeleton exists — the rounds, the footage to check), the moments to check
   and your own spans. **Review mode** (the To check card) shows everything: the skeleton
   lane (where a skeleton exists at all), the **detected** lane (red for every
   frame without a skeleton, a yellow tick per jump), the **framing** lane
   (where the picture cuts the boxer: red out of frame, pink partly out, tan
   legs cut off; `F` hides it), the moments, and every labeler's spans; it
   plays the whole video.
3. **Done with the video: say so.** Its rows are flipped from `Reviewing` to
   `yes` in the sheet (step 5 of the flow, by hand) and it leaves the list;
   `N` goes to the next one meanwhile. No name is needed on this page: spans
   carry whatever name the punch labeler stored — Admin included — or none.
4. **A hopeless video: "Whole video unusable".** It shows how many labeling
   rows the video has in Combined Data Archive and in every labeler's tab, and
   on OK moves them all to the `Skeleton Problems` tab, so it leaves the list
   too. Combined Data catches up at the next rebuild.

## What is labeled

One thing (Mathe, 2026-09-29): the skeleton on the wrong target — the stretch
it sits on someone (`other_person`) or something (`other_thing`) else — and a
catch-all for any other issue (`other`; it replaced a `jump` reason the same
day, which the Apps Script still accepts from a stale page). That is what the skeleton cannot say about
itself: the other-person rule of cornerman-backend's `jumps.py` flags 383 s to
find the 46 s marked on Heavy Bag Session 2 (7 % precision).

Everything else is not labeled here. Where the picture cuts the boxer (out of
frame, partly out, legs cut off) is computed by the framing rule and goes into
training as a mask — trained with and without, to see whether it matters. A
frozen skeleton has its rule (one case on the whole shelf). Hidden behind the
bag and camera moves are not labeled for now. A skeleton that is the boxer's
but jittery is fine.

The moments are enough to find the wrong target on the one labeled sample:
every one of Admin's 19 other-thing spans on Session 2 starts and ends inside a
moment (jumps alone would miss 5 of the 19 starts), and the moments cover 8.8 %
of the footage over the shelf (~1.7 per minute of round, 2026-09-29). Admin
marked them with the detected lane on, so this may flatter the moments.

## Where it goes

Two tabs of the labels workbook (the punch workbook), written through the
shared Apps Script:

| tab | columns | one row per |
|---|---|---|
| `Unusable Spans` | id, video_file, labeler, reason (other_person, other_thing, other — the Apps Script still accepts the retired jump, out_of_frame, hidden, jump_back, frozen, camera from a page not yet reloaded), start_sec, end_sec, span_uuid, ts | span |
| `Unusable Reviewed` | video_file, video_name, labeler, verdict, ts | retirement (`whole_video_unusable`) — the review mark itself is the sheet's `yes` |

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
extracted video shows its hints with no export step. The framing lane is
`framingHints()`, the mirror of that folder's `framing.py` — the same joints,
kinds and defaults (margin 0, gaps and stretches under 0.5 s); it gave the
identical stretches on all 571 rounds of the shelf (2026-09-29). Change a rule
or a default in both places or in neither. The moments to check
(`checkMoments()`) group the detected lane's hints — hints less than 1 s apart
merged, 1 s of padding either side; the ticks are `localStorage`
`unusableChecked:<video link>`, the mode `unusableReview`. One deliberate
difference: this lane shows every missing frame, where the backend's survey
and model start counting at 3 (Mathe, 2026-09-19 — the threshold for actual
use comes later); the jump rule's thresholds are the same on both sides.
The backend is `doGetUnusable` in `apps_script/Code.js` (actions
`listReviewingVideos` — the `reviewed` column of every person's `Labeled
Data` tab — `listUnusable`, `addUnusable`, `updateUnusable`, `deleteUnusable`,
`listUnusableReviewed`, `markUnusableReviewed`, `retireVideo`; every write
under the punch write lock, `retireVideo` with `dry=1` for the counts). The
spans are read back by cornerman-backend's `ml/research/skeleton_usability/`.

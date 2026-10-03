# Footwork steps — the labeler

When does each foot step, and which way does it go? Every step inside one
20-second window per video, labeled one foot at a time. It is the ground truth
for cornerman-backend's step detector (`ml/research/footwork/`), which is meant
to answer three coaching questions: does the foot nearest the direction move
first, does the jab land as the lead foot lands, and when does the boxer step
back. Open it from the landing page, or directly at `steps/index.html`.

## The loop

1. **Type your name** (top right). Steps are compared between labelers, so a
   save without a name is refused.
2. **Pick a window** from the list. Every video has one window, the same for
   everyone (`windows.json`). With the video and skeleton folders connected,
   the file and its skeleton open by themselves, as in the punch labeler. The
   timeline zooms onto the window and playback loops inside it.
3. **Lead foot first.** Lead = the front foot (left for an orthodox boxer). For
   every step of that foot: `Enter` on the frame it leaves the floor, `Enter`
   on the frame it lands, then the direction on the pad. The step saves
   itself. Directions are the **boxer's own**: front is where he faces, left
   is his left. Facing the camera, his left is on your right. The centre key
   is a **pivot**: the foot turns on the ball without moving to a new spot. A
   bounce in place is not a step.
4. **Say the foot is done** (`Shift` `Enter`), also when it never stepped. An
   empty window then counts as zero steps, not as unlabeled. The page switches
   to the rear foot and rewinds the window.
5. **Rear foot, the same way.** Done again moves you to the next window (`N`
   does it any time).

One pass per foot because in a step-and-drag the second foot often lifts
before the first has landed. A single start/end could not hold both.

## Keys

```
Enter, Enter        the foot lifts, the foot lands (at the playhead)
Q W E / A S D / Z X C   the direction, laid out like the pad: front-left, front,
                    front-right / left, PIVOT, right / back-left, back, back-right
F                   switch the foot being labeled
Shift+Enter         this foot is done in this window (click Done again to reopen)
Esc                 clear the half-made step, or the selection
click / drag        select a step; drag its edge or middle (frame-snapped)
a pad key           with a step selected and nothing half-made: change its direction
Delete, ⌘Z          delete the selected step, undo the last change
Space, ← →          play (loops over the window), one frame (ten with Shift)
K, N, ?             skeleton overlay, next window, every key
```

## Where it is stored

The **Footwork steps** workbook (Drive `Ambo/data/labels/labeling_team/`), its
own sheet and not the punch workbook, written by `apps_script/Code.js`
`doGetSteps`:

- `Steps`: id | video_file | video_name | labeler | foot | direction | start_sec | end_sec | span_uuid | ts
- `Windows Done`: video_file | video_name | labeler | foot | window_start_sec | window_end_sec | done | ts

`foot` is `lead` / `rear`. `direction` is one of `front`, `front_right`,
`right`, `back_right`, `back`, `back_left`, `left`, `front_left`, `pivot`.
Times are source-video seconds (MM:SS.mmm text), the same clock as the punch
labels. A pass counts as finished only on a `Windows Done` row with `done` = 1.
One row per (video, labeler, foot); reopening sets it to 0.

## Gotchas

- **`windows.json` is generated, never edited.** Regenerate it with
  cornerman-backend's `ml/research/footwork/pick_step_windows.py`. A video is
  found by its name in the tracking sheet, so a renamed video drops out of the
  list.
- **Regenerating the windows after labeling has started orphans the work.**
  Steps are keyed by video, not by window, so new bounds would cut through old
  labels, and any re-run of the picker can move existing windows.
- **Your own steps only.** The page shows the steps saved under your name, to
  keep labelers independent. Everyone's rows are in the sheet.

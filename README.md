# cornerman-labeler

The labelers — the web tools the labeling team uses to produce Cornerman's
training labels. One folder per labeler; every tool saves straight to the
**Box Labeled Data** Sheet via the shared Apps Script backend (no login).

**Start here:** https://cornerman-ai.github.io/cornerman-labeler/ — the landing
page lists every labeler. First-time Sheet/Apps-Script setup: [SETUP.md](SETUP.md).

## The labelers

| Folder | What it labels | Why it exists |
|---|---|---|
| `punch/` | Punches in a round: start/end time + type per hand | **The main tool.** Its labels are the training corpus for the punch classifier |
| `impact/` | The exact impact frame of each labeled punch | Trained the impact-frame spotter |
| `punch_directions/` | 16-way (22.5°) direction of straight punches | Trained the axiality (punch-direction) model that three rules gate on |
| `bodyshot/` | Head vs body, one short clip per punch | Refines punch-type labels where head/body was ambiguous |
| `callout/` | Called-out combos in guided rounds vs what was actually thrown | Measures how well users follow the app's callouts |
| `rules/` | Form-rule spot checks on rounds | Ground truth for rules-engine tuning |
| `chin_tuck/` | Three chin-vs-shoulder questions per sampled frame | **Current chin labeling.** Repeated samples measure each labeler's self-agreement ceiling. `chin_tuck_john.html` is the earlier chin labeler, frozen for reference |
| `guard_drop/` | Hands-down moments in a round | Ground truth for the guard-drop rule |
| `hip_rotation/` | Rotation-quality rubric per punch | Ground truth behind the hip-rotation rule |
| `orientation/` | 8-bin facing direction per frame | Tuned the stance-width foreshortening correction + ankle-orientation constants. Self-contained (own config + Apps Script) |
| `bladedness/` | Pairwise "which stance is more squared?" (shoulder pairs + hip pairs), plus the **coach review** where the coach scores curated frontal frames | The too-squared/too-bladed research — pair judgements calibrate the candidate metrics; the coach review is the expert reference |
| `axiality/` | Review of ground truth vs model direction predictions | QA pass on the axiality model |

## Shared pieces

- `shared/player.js` — the video player + Sheet-posting core every video labeler uses
- `shared/style.css` — common styling
- `shared/videos.json` — which videos the video-based labelers list (regenerate with `shared/build_videos_json.py`)
- `shared/apps_script.js` — the Google Apps Script backend (deployed as a Web App — see SETUP.md); labels land in the Sheet at Drive `Cornerman/data/labels/labeling_team/`

## Conventions

- A labeler's page, JS, data, and media all live in its folder — tools are
  self-contained; only truly shared code sits in `shared/`.
- Frame/clip media that pages display is exported by the backend research
  scripts (`cornerman-backend/ml/research/<topic>/`) and committed here so
  GitHub Pages hosts it.

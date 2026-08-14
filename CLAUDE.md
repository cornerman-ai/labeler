# Labeler

Web-based video labeling tool for boxing punch annotation.

## Stack

- One folder per labeler (`punch/`, `chin_tuck/`, `bladedness/`, ...) — each holds
  its page, JS, data, and media; `shared/` holds `player.js`, `style.css`,
  `videos.json`; `apps_script/` holds the backend (`Code.js`, deployed as a
  Web App — auto-deploys from master via clasp CI, see `apps_script/README.md`,
  never edit in the Apps Script editor); root `index.html`
  is the landing page listing every labeler
- Hosted at: https://cornerman-ai.github.io/labeler/

## How It Works

- Users load videos and mark punch segments with type, start/end times, angle, stance
- Labels are saved to Google Sheets via GET requests to the Apps Script web app
- Sheet naming: "Labeled Data Software {N}" per labeler, "Combined Data" for merged view
- All CRUD operations (list/add/update/delete) go through `doGet` with URL params

## Sheet Columns

**Labeler sheets** ("Labeled Data Software {N}"):
id | video_file | training_type | stance | fighter | angle | punch_type | start_sec | end_sec

**Combined Data sheet**:
id | video_name | video_file | training_type | stance | fighter | angle | label | start_sec | end_sec

**Form Labels sheets** ("Form Labels {Name}"):
id | punch_uuid | video_file | punch_type | hand | stance | start_sec | end_sec | rule_hand_extended | rule_hand_low | rule_hand_ushape | rule_hip_rotation | rule_rear_heel_lift | rule_resting_hand | rule_extension | rule_punch_height | labeled_at

**Guard Drops sheet** (`guard_drop_label.html` — one verdict per punch on the
resting/non-punching hand):
ts | labeler | punch_uuid | video | verdict | guard_hand | skip_reason | deleted

`verdict` is one of `good` / `dropped` / `always_low`. The dropped vs
always_low split is the point of the tool — `rule_resting_hand` in Form Labels
is pass/fail and merges "guard collapsed when they threw" with "guard was
never up", which are different faults needing different drills. Keyed by
(labeler, punch_uuid); a re-save supersedes the prior row (soft `deleted=1`).
`guard_hand` (LEFT/RIGHT) is recorded as-shown so a stance mistake in Combined
Data is auditable after the fact.

**Chin Labels sheet** (`chin_tuck_john.html` — the ORIGINAL single-verdict
chin labeler, preserved under that name when `chin_tuck.html` became the
3-question chin-shoulder labeler below. NOT actively used — the page carries
an archive banner; it exists only so John's tucked/level/air answers can be
reviewed now and then. One verdict per randomly sampled frame; candidates
baked into `chin_frames.json` by cornerman-backend's `chin_tuck/chin_sampler.py`,
which also defines the chin crop box the page draws):
ts | labeler | video | round | frame | pts_sec | verdict | skip_reason | comment | deleted

`verdict` is `tucked` / `level` / `air` (provisional 3-way split pending
coach input). `round`/`frame` index the BlazePose round cache; `pts_sec` is
source-video seconds. The `bad_box` skip reason means the skeleton-derived
crop box missed the chin — it QAs the crop logic, not the boxer. `comment`
is free text the labeler can attach to a frame. Keyed by (labeler, video,
round, frame); a re-save supersedes (soft `deleted=1`).

The page walks a fixed PLAYLIST (no video picker). For playlist videos the
sampled frames are committed as JPEGs under `frames/<stem>/` (built by
cornerman-backend's `chin_export_frames.py`, listed in `chin_hosted.json`),
so remote labelers need no video files; non-hosted videos fall back to the
open-the-local-file flow. `chin_excluded.json` (built by
`build_chin_excluded.py` from one labeler's occluded/unclear/bad_box skips)
hides triage-rejected frames from everyone's queue — the skip rows stay in
the sheet; delete/rebuild the file to bring frames back.

Spreadsheet-native review path (for reviewers who prefer Sheets over the
web page), NO Apps Script involved: `build_chin_review.py` numbers the
current queue into `chin_review.json` + a matching Drive folder of
`NNN.jpg` copies (`Cornerman/data/coach_media/chin_tuck/review_frames`). The
standalone "Chin Review John" workbook in Drive (built from
chin_review.json: # | =IMAGE | verdict dropdown | comment | hidden
video/round/frame keys + READ ME tab) is what the reviewer edits;
convert it to a native Google Sheet once (File > Save as Google Sheets)
so the inline images render. Import = read the sheet and push each
verdict through the deployed saveChinLabel endpoint as labeler `John`.

**Chin Shoulder Labels sheet** (`chin_tuck.html` — THREE answers per sampled
frame, all judged against the LEAD shoulder; same candidate source and
exclusion file as Chin Labels, but the queue is EVERY hosted video, not the
10-video playlist: the 10 professionally shot ones come first, then every
other hosted stem alphabetically, built at load from chin_frames.json ∩
chin_hosted.json — all sampled frames are baked as JPEGs by
`chin_export_frames.py`, which defaults to every manifest stem):
ts | labeler | video | round | frame | pts_sec | chin_height | chin_front | kissing | skip_reason | comment | deleted

`chin_height` is `over` / `level` / `under` (chin higher than / level with /
lower than the shoulder), `chin_front` is `front` / `same` / `behind` (chin
ahead of / even with / behind the shoulder), `kissing` is `yes` / `no` (chin
close enough to almost kiss the shoulder). A row has either all three answers
or a `skip_reason` (`occluded` / `unclear`), never both. Keyed by (labeler,
video, round, frame); a re-save supersedes (soft `deleted=1`). Actions:
`listChinShoulderLabels` / `saveChinShoulderLabel` / `deleteChinShoulderLabel`.

**chin_shoulder_labels_{Name} / chin_shoulder_v3_labels_{Name}** — the two LIVE chin
generations. One code-owned tab per labeler (do not hand-add columns: the header
row is reconciled to the schema, in both membership and order, on every save).

2.0 (`chin_tuck_2.0/chin_shoulder.html`) — four questions:
ts | labeler | video | round | frame | frame_sec | stance | shoulder_used | shoulder_ok | chin_ok | lateral_safe | frontal_safe | skipped | consulted | flag | dwell_sec | reviewed

3.0 (`chin_tuck_3.0/chin_tuck3.html`) — the same frames and queue, ONE question:
ts | labeler | video | round | frame | frame_sec | stance | shoulder_used | bad_tuck | skipped | consulted | flag | dwell_sec | reviewed

`bad_tuck` is `yes` / `no` — "is this a no-brainer bad chin tuck". **Polarity is
inverted against 2.0**, where yes was always the GOOD answer; here yes means the
tuck is BAD. Anything reading this column has to remember that. The buttons are
still green-for-yes / red-for-no as everywhere else in the tool — the colour
tracks the answer, not whether the boxing is any good. No `hard_to_say`: "no"
already absorbs the ambiguous ones, and an unjudgeable frame is a skip.

Shared columns: `skipped` / `consulted` / `flag` / `reviewed` are 0/1, never
blank (`consulted` = the labeler opened the clue panel and it showed at least
one peer answer, so agreement over those rows measures convergence rather than
independence); `dwell_sec` accumulates across visits, capped at 120s per look.

Both generations run the SAME backend functions, parameterized by `CS2_SPEC` /
`CS3_SPEC` (prefix, headers, values, fields, cache keys, action suffix). Actions
are `{list,save,delete,stats,peers,agreement,overlap,leadEveryone}` + `ChinShoulderV2` or
`ChinTuck3`. Every response carries its generation's marker (`v2` / `v3`) —
doGet answers unknown actions with a success shape, so without the marker a page
talking to an older deployment would read a save as successful having written
nothing. The prefixes are what keep the two generations from seeing each other's
tabs in stats, agreement, clue and comparison.

**Lead everyone** (the button at the foot of the team panel, both generations):
every frame the caller has judged — answered or skipped — overwrites every other
labeler's row for that frame, creating one where they had none. Frames THEY
judged and the caller did not are untouched, as are their `flag` / `dwell_sec` /
`reviewed`. **Nothing is kept**: no backup tab, no column marking a row as led,
and the overwritten answer is gone. So agreement after a lead is 100% by
construction with nothing in the sheet to say so — take the inter-rater numbers
BEFORE leading. Rewrites whole sheets, so it holds the script lock for the
duration, and the page sends it WITHOUT `call()`'s retry. It is bounded by the
frame it was pressed on, in QUEUE order.

**Frame scopes over POST.** Both `leadEveryone` and `agreement` can be limited
to a set of frames the page names, because every scope worth having (up to
frame N, inside batch N) is defined by queue order and the Apps Script has never
seen `queue.json`. The page sends `{stems, keys}` with the stems interned (a
full queue is 291KB raw, 59KB packed) in a POST body via `doPost`, since no URL
carries that; the query string still holds action and labeler, and
`Content-Type: text/plain` keeps it preflight-free. `cs2DecodeScope` reads it.
For `leadEveryone` the scope is REQUIRED — a missing or malformed one refuses
rather than falling back to leading everything. For `agreement` it is optional:
no payload means the whole queue, which is what "All frames" and every older
page send, so the default request is unchanged.

3.0 has NO data of its own: it reads `../chin_tuck_2.0/queue.json` and
`../chin_tuck_2.0/frames/`. The frames are 666MB against a 1GB Pages limit, so a
copy would not fit — moving or deleting `chin_tuck_2.0/` breaks 3.0.

**Combined Form Labels sheet**:
Same columns as Form Labels + `labeler`. Built by `rebuildCombinedFormLabels()` (MyCorner > Rebuild Combined Form Labels). Dedupes by (punch_uuid, labeler) — same uuid intentionally appears across labelers (inter-rater data). Header mapping is by name, so per-labeler column-order differences are tolerated.

## Coaching review (`coach_review.html`)

Watch-only page — no labeling, no Apps Script, nothing saved. Reads
`coach_review.json` and renders the 10 professionally shot clips (left rail,
"Video N: title") beside their Google Drive player (center, `/preview`
iframe — viewers need Drive access to the files) and the coach feedback
(right): coach &rarr; comment titles &rarr; details, each collapsible, so the
video and the feedback stay visible together. Details carry the coach's full
instruction plus the "why it ranks here" and "where" notes.

Playback quality is a function of how much room the player gets: Drive's
embedded player picks its rendition from its own pixel size, and there is no
URL parameter that pins it. The raw file
(`drive.usercontent.google.com/download?id=…`) can't be used in a native
`<video>` — it answers `cross-origin-resource-policy: same-site`, so the
browser blocks it cross-site (curl gets it fine; the browser never will).
Hence the `V` / `B` panel toggles and `F` fullscreen: hiding both panels takes
the player from ~760px to full width, and fullscreen gets Drive's best
stream. Anything sharper than that means re-hosting the clips ourselves.

`coach_review.json` shape: `videos[{n, mode, title, driveId}]` and
`coaches[{name, comments: {"<videoN>": [{n, title, detail, why, where}]}}]`.
Adding a coach = append one entry to `coaches`; the page lists only the
coaches that have comments on the selected video.

## Setup

See `SETUP.md` for Google Sheets + Apps Script deployment instructions.

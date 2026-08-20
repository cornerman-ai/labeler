# depth_impact

The impact-frame counterpart to [`../depth_guard/`](../depth_guard/): the
same click (chin tip + the shoulder's most frontal point), on a different
frame set.

`depth_guard` samples the non-punch band, side-view-filtered by borrowing
the nearest labeled punch's camera angle (Combined Data only tags angle on
punch rows). `depth_impact` needs no such borrowing: every frame here **is**
the human-labeled IMPACT frame of a real punch (Impact Frames sheet, joined
to Combined Data on `punch_uuid`), so the angle==Side gate reads straight
off that same join — no inference. As with `height_impact`, the shoulder to
mark is the PUNCHING hand's shoulder, known exactly per `punch_uuid`.

- 1,842 frames across 39 videos (`target_per_video: 75`, `angle: Side`)
- queue: 2,026 slots = 1,842 + 184 planted repeats (rep=1, ~10%,
  repeat_gap=200), same contract as the other three variants

**Frames AND queue/manifest live in Firebase Storage, not this repo** — same
as `height_impact`, nothing but this page's code is committed. `queue.json`
and `chin_frames.json` sit under
`labeler_media/chin_tuck/v4/depth_impact_v4_frames/` in the `mycorner-bee6a`
bucket (frames under that prefix's `frames/` subfolder — its own prefix, not
`height_impact`'s, since it's a genuinely different side-view-filtered pool).
`depth_impact.js` fetches `queue.json` from there at load (`QUEUE_URL`).

**Own spreadsheet** ("Chin Point Labels — Depth Impact"), tabs
`chin_point_depth_impact_labels_<Name>` (`CS4DI_SPEC` in
`apps_script/Code.js`) — same row schema and `doGetChinPoint` machinery as
the other three chin-point 4.0 variants, own tab prefix.

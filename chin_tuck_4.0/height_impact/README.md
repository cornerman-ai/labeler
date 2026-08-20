# height_impact

The impact-frame counterpart to [`../height_guard/`](../height_guard/): the
same click (chin tip + top of the shoulder), on a different frame set.

`height_guard` samples the non-punch, punch-adjacent GUARD band — see its
README for why that restriction exists. `height_impact` samples the
opposite half of the four-way matrix: every frame here **is** the
human-labeled IMPACT frame of a real punch (the Impact Frames sheet,
non-deleted, non-skipped, joined to Combined Data on `punch_uuid` for its
label), gated on 7-joint pose visibility ≥0.6 at the matched cache frame.
Because every sample is tied to one `punch_uuid`, the shoulder to mark is
known **exactly** — the PUNCHING hand's shoulder (lead for a lead-hand
punch, rear for a rear-hand one) — not inferred from stance the way the
guard variants' hint is.

- 1,784 frames across 77 videos (`target_per_video: 26`)
- queue: 1,962 slots = 1,784 + 178 planted repeats (rep=1, ~10%,
  repeat_gap=200), same contract as `height_guard`'s, for intra-rater click
  scatter

**Frames AND queue/manifest live in Firebase Storage, not this repo.**
Unlike `height_guard`, nothing for this variant is committed to git except
this page's code — `chin_frames.json` (raw sample manifest) and
`queue.json` were built and uploaded straight from cornerman-backend, both
under `labeler_media/chin_tuck/v4/height_impact_v4_frames/` in the
`mycorner-bee6a` bucket (frames themselves under that prefix's `frames/`
subfolder, same layout as `height_guard`'s). `height_impact.js` fetches
`queue.json` from there at load (`QUEUE_URL`), same download token as the
frame images.

**Own spreadsheet** ("Chin Point Labels — Height Impact", given by whoever
built the sample), tabs `chin_point_impact_labels_<Name>` (`CS4I_SPEC` in
`apps_script/Code.js`) — same `chin_x`/`chin_y`/`sh_x`/`sh_y` row schema and
`doGetChinPoint` machinery as `height_guard`/`depth_guard`, own tab prefix
so its cached stats key can never collide with theirs.

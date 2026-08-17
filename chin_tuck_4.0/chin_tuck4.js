// chin_tuck4.js — chin-point labeler 4.0.
//
// GEOMETRY, not a verdict. 1.0–3.0 asked for judgements (over/level/under,
// four questions, one question) and the inter-rater runs kept coming back
// below trainable — and because the output was a category, WHY two people
// disagreed was invisible. 4.0 stores what the labeler can actually be
// precise about: click the chin tip, click the top of the lead shoulder.
// Over/level/under is DERIVED downstream from the two points; disagreement
// becomes a distance in pixels, diagnosable per point; and the clicks
// double as calibration for the pipeline (human shoulder vs BlazePose's,
// human chin vs the nose→mouth extrapolation).
//
// The frames are NON-PUNCH by construction (chin_sampler_v3.py: every frame
// sits >0.5s from every labeled punch, in a round that has punch labels).
// So the shoulder to mark is always the stance-lead shoulder, in guard —
// "top of the deltoid" means one thing on every frame in this queue.
//
// Frames come from FIREBASE STORAGE, not this repo — 2.0's 724MB of JPEGs
// left no Pages budget for another generation, so 4.0's images live in the
// project bucket behind a shared download token and git carries only code
// and queue.json. See cornerman-backend ml/research/chin_tuck/v3/.
//
// NOTHING on this page shows a labeler anyone else's work. Not the
// pipeline's points (BlazePose shoulders, extrapolated chin), not the other
// labelers' placements, not how far along anybody is. Whoever can see
// another answer anchors on it, and an anchored click is not a second
// opinion — it is the first one, copied.
//
// REPEATS: ~10% of queue slots are the same frame planted again (rep=1),
// blind, ≥200 slots downstream. rep is part of the row identity end to end
// — key(), the sheet, the backend — so the pair measures the labeler's own
// click scatter instead of collapsing into one row.
//
// The backend OVERWRITES IN PLACE (saveChinPoint), same as 2.0/3.0: a save
// for a (video,round,frame,rep) that already has a row replaces it, and only
// a new identity appends. A re-label is not kept as separate history.
//
// Position resumes from your own saved rows, never from this browser.
//
// Not ported from 3.0: reviewer mode + disagreement jump, pairwise
// agreement panel, comparison grid, lead-everyone, exclude-video,
// per-labeler frame ranges.

'use strict';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';

// Row identity fields — mirrors CS4_FIELDS in apps_script/Code.js.
const FIELDS = ['chin_x', 'chin_y', 'sh_x', 'sh_y'];
const PREFETCH = 4;

// Where the frames live. Path + one shared token — every object carries the
// same firebaseStorageDownloadTokens value, stamped at upload
// (chin_upload_frames.py). Rotating the token means re-stamping every
// object AND shipping this constant.
const FRAME_BUCKET = 'mycorner-bee6a.firebasestorage.app';
const FRAME_PREFIX = 'labeler_media/chin_point/frames';
const FRAME_TOKEN = '628dbeba-2969-4f45-b65e-5b295ef56fdc';

const MIN_ZOOM = 1 / 3;
const MAX_ZOOM = 12;
// Past this many DEVICE pixels per SOURCE pixel the frame is drawn
// pixel-for-pixel instead of smoothed — see #stage.sharp. Measured in device
// pixels so a retina laptop and a 1080p monitor agree, and against the frame's
// own resolution so a 360x640 clip and a 1080p clip are judged by how far each
// is really being stretched, not by the zoom number on top of it.
const SHARP_MAG = 1.5;
// ...and only for sources with this many pixels on the short side. Below HD
// the grid is as coarse as the anatomy being clicked (a 360x640 clip is a
// fifth of the queue's frames), and the smooth gradient says more about where
// the jaw edge lies than a field of flat squares does. A property of the
// FRAME, not of the screen: every labeler must see the same frame the same
// way, whatever monitor they are on.
const SHARP_MIN_SOURCE = 720;
const ZOOM_SPEED = 0.0018;
// A click is a click if the mouse moved less than this many screen px
// between down and up; anything longer is a pan (or a point drag).
const CLICK_SLOP_PX = 4;
// Grab an existing point when the mousedown lands within this many SCREEN
// px of it — screen, not image: at 12x a labeler aiming at a dot should not
// need 12x the precision to pick it back up.
const GRAB_PX = 10;

const DWELL_CAP_SEC = 120;

// Short forms of the two skip reasons, for the button once a frame is skipped.
const SKIP_LABELS = { not_visible: "can't see the points", no_stance: 'not in stance' };

// ── admin mode ──────────────────────────────────────────────────────────
// Reached by logging in as the literal name "admin" (any case — see
// state.isAdmin, set in start()). Shows every labeler's points at once,
// lets any of them be selected and dragged, and saves under THAT
// labeler's identity via the same saveChinPoint action everyone else
// uses — it already accepts an arbitrary `labeler` param with no
// ownership check. Every admin-only function below checks state.isAdmin
// itself (or is only ever called from a call site that does), so a normal
// login never runs any of this.
const TEAM_COLOR_COUNT = 8;          // matches the --team-color-N custom properties
// Roster (who/how-far-along) is polled — a labeler working concurrently in
// another tab should move on the Team progress bars without a reload. The
// much heavier per-labeler row data (state.teamRows) is NOT polled — an
// admin session is minutes long, and re-fetching everyone's full history on
// a timer would cost far more than it buys. Matches 3.0's TEAM_POLL_MS.
const TEAM_POLL_MS = 45000;
// 15% of torso height reads as "fully disagreeing" on the overview
// gradient — a tunable constant, not a validated statistic (see
// disagreeForSlot()).
const DISAGREE_CAP = 0.15;
const CONFLICT_RING = 'dconflict';   // deliberately not .cb (camera_bad) — unrelated facts

const state = {
  frames: [],              // queue.json order (originals + planted repeats)
  index: new Map(),        // key -> queue position
  labels: new Map(),       // key -> latest saved row (mine)
  i: 0,
  pts: { chin: null, sh: null },   // in-progress points, [x,y] normalized
  // COCO's v-flags in words, per point: 'visible' = seen and clicked,
  // 'inferred' = occluded (gloved chin), placed where the anatomy must be.
  // The v=0 case is the not_visible SKIP. Chin-proxy calibration must be
  // able to exclude the guesses, so the flag rides every save.
  // null = placed but not yet qualified — the popover is open on it, and a
  // save is refused until it is answered. There is no default: an unanswered
  // point silently saved as 'visible' is exactly the guess-as-observation
  // the flag exists to prevent.
  vis: { chin: null, sh: null },
  arm: 'chin',             // which point the next stage click places
  pop: null,               // open popover: {kind:'point', name} | {kind:'skip'}
  skipped: false,
  skipReason: null,        // 'not_visible' | 'no_stance' when skipped
  zoom: 1, panX: 0, panY: 0,
  drag: null,              // pan drag: {x, y, px, py}
  ptDrag: null,            // point drag: 'chin' | 'sh'
  down: null,              // mousedown screen pos, for click-vs-drag
  active: null,            // 'chin' | 'sh' — last-pressed point; what Del acts on
  ctxFor: null,            // point the right-click menu is currently open for
  loadingFor: null,
  loadedFor: null,
  loadToken: 0,
  inflight: new Set(),
  chains: new Map(),
  failed: new Map(),
  ready: false,
  camBad: false,           // camera shot too low/high for THIS frame
  shownAt: 0,
  ovDots: null,            // the 2k overview divs, built once

  // ── admin mode ──
  isAdmin: false,
  adminTarget: null,       // labeler currently selected for editing, or null
  roster: [],              // [{labeler,n,skipped,last_ts,last}] from statsChinPoint
  teamColor: new Map(),    // labeler -> 'var(--team-color-N)'
  teamRows: new Map(),     // labeler -> Map(slotKey -> row) — this labeler's own "state.labels"
  teamBundles: new Map(),  // labeler -> {failed, inflight, chains} — this labeler's own save bookkeeping
  disagree: new Map(),     // slotKey -> {kind, level}
  rosterPoll: null,        // setInterval id for the roster poll
  teammateClick: null,     // mousedown-to-mouseup: which teammate mark (if any) was pressed
};

const $ = (id) => document.getElementById(id);

function restoreName() {
  const el = $('labeler-input');
  if (!el || el.value.trim()) return;
  let saved = null;
  try { saved = window.CMLabeler && window.CMLabeler.get && window.CMLabeler.get(); } catch (e) {}
  if (saved) el.value = saved;
}

// rep is part of the identity: the planted repeat of a frame is a different
// queue slot, a different sheet row, and a different label.
const key = (f) => JSON.stringify([f.stem, f.round, f.frame, f.rep || 0]);
const rowKey = (r) => JSON.stringify([r.video, r.round, r.frame, r.rep || 0]);

// Mirrors chin_export_frames.frame_dir() — Windows strips trailing dots and
// spaces from directory names, so the exporter sanitized them and the
// uploader inherited its layout.
const frameDir = (stem) => stem.replace(/[. ]+$/, '');

const imgSrc = (f) => 'https://firebasestorage.googleapis.com/v0/b/'
  + FRAME_BUCKET + '/o/'
  + encodeURIComponent(`${FRAME_PREFIX}/${frameDir(f.stem)}/r${f.round}_f${f.frame}.jpg`)
  + `?alt=media&token=${FRAME_TOKEN}`;

// ── backend ────────────────────────────────────────────────────────────────
function who() { return ($('labeler-input').value || '').trim(); }

// Who a save/placement acts on right now — the logged-in name normally, or
// whichever labeler is selected in admin mode. Threading every per-frame
// function through this instead of who() directly is what lets admin mode
// reuse the entire placement/save/navigation machinery unmodified.
function activeLabeler() { return state.isAdmin ? state.adminTarget : who(); }

function api(params) {
  const url = new URL(SCRIPT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// One retry for cold-start blips; the v4cb marker refuses a deployment that
// predates these endpoints (doGet answers unknown actions with a success
// shape, so without the marker a save could "succeed" writing nothing).
async function call(params, what) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    let body;
    try {
      const res = await fetch(api(params), { redirect: 'follow' });
      body = await res.json();
    } catch (e) { last = e; continue; }
    if (body.status !== 'ok') {
      last = new Error(body.message || 'unknown error');
      continue;
    }
    if (body.v4cb !== true) {
      throw new Error('Apps Script is out of date — redeploy it '
                      + `(${params.action} fell through to the default handler)`);
    }
    return body;
  }
  throw new Error(`${what}: ${last && last.message}`);
}

// ── labels ─────────────────────────────────────────────────────────────────
function hasPoints(row) {
  return !!row && FIELDS.every((f) => row[f] !== null && row[f] !== undefined);
}

// Resolved = a complete point pair, or a deliberate skip. There is no
// partial state worth keeping: the backend refuses a lone chin.
function isResolved(row) {
  return !!row && (row.skipped === 1 || hasPoints(row));
}

function myRowsInQueue() {
  const out = [];
  for (const [k, row] of state.labels) if (state.index.has(k)) out.push(row);
  return out;
}

async function loadLabels() {
  const name = who();
  state.labels = new Map();
  state.failed = new Map();
  state.camBad = false;
  if (!name) return;
  const body = await call({ action: 'listChinPoint', labeler: name }, 'load labels');
  for (const r of (body.rows || [])) state.labels.set(rowKey(r), r);
}

function dwellFor(k) {
  const prior = state.labels.get(k);
  const before = (prior && Number(prior.dwell_sec)) || 0;
  const seg = state.shownAt ? (Date.now() - state.shownAt) / 1000 : 0;
  return Math.round((before + Math.min(Math.max(seg, 0), DWELL_CAP_SEC)) * 10) / 10;
}

// ── admin mode: team data ───────────────────────────────────────────────────
// The roster: who has ever saved a row, and how far along they are —
// filtered to n>0 same as every other labeler-picker on this site, and
// 'admin' itself never appears (filtered server-side too, in doGetChinPoint).
async function loadRoster() {
  const body = await call({ action: 'statsChinPoint' }, 'load team');
  state.roster = (body.labelers || []).filter((l) => l.n > 0);
  [...state.roster].map((l) => l.labeler).sort()
    .forEach((nm, i) => state.teamColor.set(nm, `var(--team-color-${i % TEAM_COLOR_COUNT})`));
}

// One listChinPoint call per roster labeler — every row they have, the same
// pattern the deleted review.html used for its whole-corpus stats. Needed up
// front because the disagreement gradient scores EVERY queue slot, not just
// the one on screen — see computeAllDisagree(). Each labeler also gets their
// own save bookkeeping bundle (teamBundles), mirroring state.failed/
// inflight/chains for a normal single-labeler session.
async function loadTeamRows() {
  state.teamRows = new Map();
  state.teamBundles = new Map();
  const results = await Promise.allSettled(state.roster.map(async (l) => {
    const body = await call({ action: 'listChinPoint', labeler: l.labeler }, `load ${l.labeler}`);
    const rows = new Map();
    for (const r of (body.rows || [])) rows.set(rowKey(r), r);
    state.teamRows.set(l.labeler, rows);
    state.teamBundles.set(l.labeler, { failed: new Map(), inflight: new Set(), chains: new Map() });
  }));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    status(`${failed.length} labeler(s) failed to load — ${failed[0].reason.message}`, 'err');
  }
}

// Signed chin-above-shoulder distance in torso units — ADMIN MODE ONLY.
// Positive = the chin sits above the shoulder top (more exposed). Read-only:
// never written to a row, only used for the disagreement gradient and (via
// the same formula the pipeline consumes) is what "spread" below measures.
function derivedDist(chin, sh, torsoH) {
  if (!chin || !sh || !torsoH) return null;
  return (sh[1] - chin[1]) / torsoH;
}

// Disagreement, per QUEUE SLOT (a planted repeat is scored on its own — the
// overview grid already treats one dot as one slot, not one distinct
// picture). `kind` explains WHY a slot reads the way it does; `level`
// (0 = green .. 1 = red, null when there's nothing to score) is what
// renderOverview() paints. Computed only from CONFIRMED rows in
// state.teamRows — see patchDisagree() — never from an in-progress drag, so
// the grid can't flicker a colour for a save that hasn't landed yet.
function disagreeForSlot(f) {
  const k = key(f);
  const rows = [];
  for (const rowsByKey of state.teamRows.values()) {
    const r = rowsByKey.get(k);
    if (r) rows.push(r);
  }
  if (rows.length === 0) return { kind: 'none', level: null };
  if (rows.length === 1) return { kind: 'solo', level: null };

  const placed = rows.filter(hasPoints);
  const skipped = rows.filter((r) => r.skipped === 1);

  // A disagreement about whether the frame can be judged AT ALL is more
  // fundamental than any numeric gap between placed points — the concrete
  // answer to "skipping disagreement is also disagreement."
  if (placed.length && skipped.length) return { kind: 'conflict', level: 1 };

  if (placed.length === 0) {
    // Everyone skipped. Agreeing it's unlabelable IS agreement — unless they
    // disagree about WHY, which is real information a flat "they agree"
    // would absorb.
    const reasons = new Set(skipped.map((r) => r.skip_reason || 'unspecified'));
    return reasons.size <= 1 ? { kind: 'skip-agree', level: 0 } : { kind: 'skip-mixed', level: 0.4 };
  }

  // Everyone placed. Spread = the widest gap in the derived distance across
  // responders — the same number review.html used to report, computed the
  // same way, so a spread here means what it would have meant there.
  const dists = placed
    .map((r) => derivedDist([r.chin_x, r.chin_y], [r.sh_x, r.sh_y], f.torso_h))
    .filter((d) => d !== null);
  if (dists.length < 2) return { kind: 'solo', level: null };
  const spread = Math.max(...dists) - Math.min(...dists);
  return { kind: 'scored', level: Math.min(1, spread / DISAGREE_CAP) };
}

function computeAllDisagree() {
  state.disagree = new Map();
  for (const f of state.frames) state.disagree.set(key(f), disagreeForSlot(f));
}

// Called only after a save has been CONFIRMED (save()'s success callback) —
// recomputing from an in-flight drag would show a colour for data that
// isn't actually saved yet.
function patchDisagree(f) {
  state.disagree.set(key(f), disagreeForSlot(f));
  renderOverview();
}

// --no (#ff3b30) at level=1, --yes (#34c759) at level=0 — a direct RGB lerp,
// not buckets, so "gradient from red to green" is literal.
function lerpColor(level) {
  const no = [0xff, 0x3b, 0x30], yes = [0x34, 0xc7, 0x59];
  const t = Math.max(0, Math.min(1, level));
  const mix = no.map((c, i) => Math.round(yes[i] + (c - yes[i]) * t));
  return `rgb(${mix.join(',')})`;
}

// Optimistic, chained per frame — same machinery as 3.0: the local row is
// recorded and the labeler moves on; a failure rolls the row back, paints
// the dot red and names the frame in the status line.
// `skip` is null for a point pair, or the REASON ('not_visible' /
// 'no_stance') — a skip is a statement about why the frame cannot be
// measured, and the reason is the data: it is what says whether the
// sampling window is still letting non-stance frames through.
//
// ADMIN MODE: `name` resolves to the SELECTED labeler (activeLabeler()),
// not who() — the whole point of admin mode is writing under someone
// else's identity. `labelsMap`/`failedMap`/`inflightSet`/`chainsMap` are
// captured HERE, synchronously, rather than read off `state` again inside
// the async callbacks below — admin mode swaps state.labels/failed/
// inflight/chains BY REFERENCE when the selected labeler changes
// (selectAdminTarget()), and without this capture a save still in flight
// when that swap happens would resolve into the WRONG labeler's
// bookkeeping. This ties every save to whoever it was fired for, no matter
// how many times admin switches targets before it lands.
function save({ skip = null } = {}) {
  if (!state.ready) return false;
  const name = activeLabeler();
  if (!name) {
    if (state.isAdmin) status('Select a labeler first', 'err');
    else { status('Enter your name first', 'err'); $('labeler-input').focus(); }
    return false;
  }
  if (!skip && !(state.pts.chin && state.pts.sh)) {
    status('Place both points first (or skip)', 'err');
    return false;
  }
  if (!skip && !(state.vis.chin && state.vis.sh)) {
    status('Answer seen or inferred for both points', 'err');
    return false;
  }
  const labelsMap = state.labels, failedMap = state.failed,
        inflightSet = state.inflight, chainsMap = state.chains;
  const f = state.frames[state.i];
  const k = key(f);
  const prev = labelsMap.get(k);
  // Admin is correcting someone else's frame; the clock that matters for
  // dwell_sec is THEIR labeling pace, not admin's inspection time, so the
  // stored value passes through unchanged instead of accumulating more.
  const dwell = state.isAdmin ? ((prev && Number(prev.dwell_sec)) || 0) : dwellFor(k);
  state.shownAt = Date.now();
  const params = {
    action: 'saveChinPoint', labeler: name,
    video: f.stem, round: String(f.round), frame: String(f.frame),
    rep: String(f.rep || 0),
    frame_sec: String(f.pts), stance: f.stance,
    shoulder_used: f.shoulder,
    skipped: skip ? '1' : '0',
    skip_reason: skip || '',
    camera_bad: state.camBad ? '1' : '0',
    dwell_sec: String(dwell),
  };
  if (!skip) {
    params.chin_x = state.pts.chin[0].toFixed(5);
    params.chin_y = state.pts.chin[1].toFixed(5);
    params.sh_x = state.pts.sh[0].toFixed(5);
    params.sh_y = state.pts.sh[1].toFixed(5);
    params.chin_vis = state.vis.chin;
    params.sh_vis = state.vis.sh;
  }

  const row = {
    video: f.stem, round: f.round, frame: f.frame, rep: f.rep || 0,
    skipped: skip ? 1 : 0,
    skip_reason: skip || null,
    camera_bad: state.camBad ? 1 : 0,
    dwell_sec: dwell,
    chin_x: skip ? null : Number(params.chin_x),
    chin_y: skip ? null : Number(params.chin_y),
    sh_x: skip ? null : Number(params.sh_x),
    sh_y: skip ? null : Number(params.sh_y),
    chin_vis: skip ? null : state.vis.chin,
    sh_vis: skip ? null : state.vis.sh,
  };
  labelsMap.set(k, row);
  failedMap.delete(k);
  inflightSet.add(k);
  showQueueState();

  const chain = (chainsMap.get(k) || Promise.resolve())
    .then(() => call(params, 'save'))
    .then(() => {
      inflightSet.delete(k);
      showQueueState();
      if (state.isAdmin) patchDisagree(f);
    })
    .catch((e) => {
      inflightSet.delete(k);
      if (prev) labelsMap.set(k, prev); else labelsMap.delete(k);
      failedMap.set(k, e.message);
      const at = state.index.get(k);
      status(`Frame #${at === undefined ? '?' : at + 1} did not save — ${e.message}`, 'err');
      render();
    })
    .finally(() => { if (chainsMap.get(k) === chain) chainsMap.delete(k); });
  chainsMap.set(k, chain);
  return true;
}

// Has anything changed since the row this frame already has? Skips the
// write when nothing did — a save now overwrites the row in place, so an
// identical re-write would just cost a lock/write round trip for no new
// information, and with commit-on-leave a labeler walking back through
// their work with the arrow keys would otherwise trigger one every step.
function isDirty(k) {
  const saved = state.labels.get(k);
  if (!saved || !hasPoints(saved)) return true;
  const at = (p, i) => Number(p[i].toFixed(5));
  return at(state.pts.chin, 0) !== Number(saved.chin_x)
      || at(state.pts.chin, 1) !== Number(saved.chin_y)
      || at(state.pts.sh, 0) !== Number(saved.sh_x)
      || at(state.pts.sh, 1) !== Number(saved.sh_y)
      || state.vis.chin !== saved.chin_vis
      || state.vis.sh !== saved.sh_vis
      || (state.camBad ? 1 : 0) !== (saved.camera_bad ? 1 : 0);
}

// The save. There is no save button: a finished pair is written by moving on,
// because "I'm done with this frame" and "next frame" are the same decision,
// and making them two gestures means the second one gets forgotten and the
// first one's work is lost.
//
// Returns false only when the frame is holding the labeler there — a pair
// placed but not yet qualified as seen/inferred. Everything else (nothing
// placed, already skipped, nothing changed) is a legitimate way to leave a
// frame and writes nothing.
function commitCurrent() {
  if (!state.ready || !state.frames.length) return true;
  if (state.skipped) return true;
  if (!(state.pts.chin && state.pts.sh)) return true;
  if (!(state.vis.chin && state.vis.sh)) {
    status('Answer seen or inferred for both points', 'err');
    return false;
  }
  if (!isDirty(key(state.frames[state.i]))) return true;
  return save({});
}

function setReady(on, note, isError) {
  state.ready = !!on;
  renderNameState();
  document.body.classList.toggle('ready', state.ready);
  $('q-lock').textContent = note || '';
  $('q-lock').classList.toggle('err', !!isError);
  $('q-lock').style.display = note ? 'block' : 'none';
}

function showQueueState() {
  if (state.failed.size) {
    status(`${state.failed.size} frame(s) failed to save — red in the overview`, 'err');
  } else if (state.inflight.size) {
    status(`saving ${state.inflight.size}…`);
  } else {
    status('');
  }
  renderOverview();
  // The picker's per-labeler status chip shows saving/failed too — the
  // capture fix in save() means a save can land after admin has already
  // switched away from that labeler, so this is the one place that state
  // stays visible instead of silently resolving off-screen.
  if (state.isAdmin) renderAdminPicker();
}

// ── navigation ─────────────────────────────────────────────────────────────
function firstUnlabeled(from = 0) {
  for (let i = from; i < state.frames.length; i++) {
    if (!state.labels.has(key(state.frames[i]))) return i;
  }
  return -1;
}

// Populate the in-progress editing state from a saved row (or reset to
// empty if there isn't one) — used both when arriving at a frame (go()) and
// when admin mode swaps which labeler's row is being edited
// (selectAdminTarget()), so there's exactly one restore path, not two.
function applySavedRow(saved) {
  state.skipped = !!(saved && saved.skipped);
  state.skipReason = (saved && saved.skip_reason) || null;
  state.camBad = !!(saved && saved.camera_bad);
  // A saved pair comes back editable: drag a dot, save again — the backend
  // overwrites the row in place, no history kept.
  if (saved && hasPoints(saved)) {
    state.pts = { chin: [saved.chin_x, saved.chin_y], sh: [saved.sh_x, saved.sh_y] };
    state.vis = { chin: saved.chin_vis || 'visible', sh: saved.sh_vis || 'visible' };
    state.arm = null;
  } else {
    state.pts = { chin: null, sh: null };
    state.vis = { chin: null, sh: null };
    state.arm = 'chin';
  }
}

function go(i) {
  // Leaving a finished frame is what saves it — see commitCurrent(). A frame
  // that cannot be committed keeps the labeler where they are.
  if (!commitCurrent()) { render(); return; }
  state.i = Math.max(0, Math.min(state.frames.length - 1, i));
  state.active = null;
  closePop();
  closeCtx();
  resetZoom();
  const f = state.frames[state.i];
  applySavedRow(state.labels.get(key(f)));
  state.shownAt = Date.now();
  render();
  prefetch();
}

function advance() {
  if (state.i < state.frames.length - 1) { go(state.i + 1); return; }
  // Nowhere to move, but the work still has to land: the last frame in the
  // queue is saved by pressing Next on it, not lost for being last.
  if (commitCurrent()) status('End of queue');
  render();
}

function prefetch() {
  for (let n = 1; n <= PREFETCH; n++) {
    const f = state.frames[state.i + n];
    if (f) new Image().src = imgSrc(f);
  }
}

// ── admin mode: target selection ────────────────────────────────────────
// Commit the outgoing target's edit exactly like leaving a frame does (see
// go()), then swap state.labels/failed/inflight/chains BY REFERENCE to the
// new target's bundle — every per-frame function above already reads
// through those four fields, so nothing else has to know admin mode
// exists. save() captures its own local references to the active bundle at
// call time, which is what keeps an in-flight save from landing in the
// WRONG target's bookkeeping if admin switches before it resolves.
function selectAdminTarget(name) {
  if (!state.isAdmin || name === state.adminTarget) return;
  if (!commitCurrent()) { render(); return; }
  state.adminTarget = name;
  const bundle = state.teamBundles.get(name);
  state.labels = state.teamRows.get(name);
  state.failed = bundle.failed;
  state.inflight = bundle.inflight;
  state.chains = bundle.chains;
  state.active = null;
  closePop();
  closeCtx();
  document.body.classList.toggle('no-target', !state.adminTarget);
  applySavedRow(state.labels.get(key(state.frames[state.i])));
  state.shownAt = Date.now();
  render();
}

// Hit-test a read-only teammate mark on canvas (admin mode only) — the
// click-to-select analog of grabbablePoint() for the active target's own
// point. A little more slack than GRAB_PX: teammate marks are drawn smaller
// than the active target's .hp markers, on purpose (see the CSS), so they
// need a bit more forgiveness to hit reliably.
function teammateMarkAt(clientX, clientY) {
  const GRAB = GRAB_PX + 3;
  let best = null, bestD = GRAB;
  for (const el of document.querySelectorAll('#marks .tm')) {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
    if (d <= bestD) { best = el.dataset.who; bestD = d; }
  }
  return best;
}

// ── rendering ──────────────────────────────────────────────────────────────
function render() {
  const n = state.frames.length;
  if (!n) return;
  const f = state.frames[state.i];

  $('count').innerHTML = `${state.i + 1}<small> / ${n}</small>`;
  const resolved = myRowsInQueue().filter(isResolved).length;
  $('done').textContent = `${resolved} done`;

  $('id-video').textContent = f.stem;
  $('id-round').textContent = f.round;
  $('id-frame').textContent = f.frame;

  const img = $('frame');
  if (img.dataset.k !== key(f)) { img.dataset.k = key(f); img.src = imgSrc(f); }

  for (const row of document.querySelectorAll('.tool-row')) {
    const p = row.dataset.p === 'chin' ? 'chin' : 'sh';
    row.setAttribute('aria-pressed', String(state.arm === row.dataset.p));
    // The switch only appears once the point has an answer — before that,
    // the popover is the only way to give one, so a control that does
    // nothing has no reason to be on screen.
    const sw = document.querySelector(`.vis-switch[data-p="${p}"]`);
    sw.hidden = !state.pts[p] || !state.vis[p];
    for (const seg of sw.querySelectorAll('.vis-seg')) {
      seg.setAttribute('aria-pressed', String(seg.dataset.v === state.vis[p]));
    }
  }
  // The guide cross wears the armed point's colour — see #stage-card.arm-sh.
  $('stage-card').classList.toggle('arm-sh', state.arm === 'sh');
  const skipb = $('skip-btn');
  skipb.setAttribute('aria-pressed', String(state.skipped));
  skipb.firstChild.nodeValue = state.skipped
    ? `Skipped — ${SKIP_LABELS[state.skipReason] || state.skipReason} `
    : 'Skip frame ';
  renderCam();

  placeMarks();
  renderTeamMarks();
  renderAdminPicker();
  renderOverview();
}

function placeMarks() {
  const pct = (p) => ({ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` });
  for (const [name, el] of [['chin', $('hp-chin')], ['sh', $('hp-sh')]]) {
    const p = state.pts[name];
    el.classList.toggle('set', !!p);
    el.classList.toggle('inferred', state.vis[name] === 'inferred');
    el.classList.toggle('active', state.active === name);
    if (p) Object.assign(el.style, pct(p));
  }
  const img = $('frame');
  if (img.naturalWidth && img.naturalHeight) {
    $('stage').style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  }
}

// The label is the same either way — the fact it reports does not change with
// the answer, only whether it is true, which the pressed state says.
function renderCam() {
  $('cam-btn').setAttribute('aria-pressed', String(!!state.camBad));
}

function renderNameState() {
  $('name-go').disabled = !who();
}

// ── admin mode: rendering ───────────────────────────────────────────────────
// Hovering a name (in the picker or on a mark itself) brings that
// labeler's marks to full strength and dims the rest — twelve dots on one
// jaw is unreadable otherwise. Same move the deleted review.html used for
// the identical problem.
function setTeamHover(name) {
  for (const el of document.querySelectorAll('#marks .tm, #tm-links line')) {
    el.classList.toggle('dim', !!name && el.dataset.who !== name);
  }
}

// Corpus-wide, not per-frame — called after loadRoster() and on the 45s
// poll, NOT from render(), so a frame change doesn't rebuild it for no
// reason.
function renderTeamProgress() {
  if (!state.isAdmin) return;
  const box = $('team-progress');
  box.textContent = '';
  const total = state.frames.length;
  for (const l of [...state.roster].sort((a, b) => b.n - a.n)) {
    const color = state.teamColor.get(l.labeler) || 'var(--ink-dim)';
    const row = document.createElement('div');
    row.className = 'team-n';
    row.style.setProperty('--tm-color', color);
    const sw = document.createElement('span');
    sw.className = 'sw';
    const nm = document.createElement('span');
    nm.textContent = l.labeler;
    row.append(sw, nm);
    const pct = total ? Math.round((l.n / total) * 100) : 0;
    const ct = document.createElement('div');
    ct.className = 'team-c';
    ct.textContent = `${l.n} / ${total} · ${pct}%`;
    const bar = document.createElement('div');
    bar.className = 'team-bar';
    bar.style.setProperty('--tm-color', color);
    const fill = document.createElement('i');
    fill.style.width = `${Math.min(100, pct)}%`;
    bar.appendChild(fill);
    box.append(row, ct, bar);
  }
}

// One row per roster labeler for THIS frame — click to arm their points as
// the draggable target. Rebuilt every render(); the DOM is small (labelers,
// not frames) so there's no need to diff it.
function renderAdminPicker() {
  if (!state.isAdmin) return;
  const box = $('admin-picker');
  box.textContent = '';
  const f = state.frames[state.i];
  if (!f) return;
  const k = key(f);
  for (const l of [...state.roster].sort((a, b) => a.labeler.localeCompare(b.labeler))) {
    const bundle = state.teamBundles.get(l.labeler);
    const r = state.teamRows.get(l.labeler)?.get(k);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'admin-picker-row';
    row.setAttribute('aria-pressed', String(l.labeler === state.adminTarget));
    row.style.setProperty('--tm-color', state.teamColor.get(l.labeler) || 'var(--ink-dim)');
    const sw = document.createElement('span');
    sw.className = 'sw';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = l.labeler;
    const st = document.createElement('span');
    if (bundle && bundle.inflight.has(k)) { st.className = 'st'; st.textContent = 'saving…'; }
    else if (bundle && bundle.failed.has(k)) { st.className = 'st sk'; st.textContent = 'failed'; }
    else if (r && r.skipped === 1) {
      st.className = 'st sk';
      st.textContent = `skip: ${SKIP_LABELS[r.skip_reason] || r.skip_reason || '?'}`;
    } else if (r && hasPoints(r)) { st.className = 'st dn'; st.textContent = 'placed'; }
    else { st.className = 'st'; st.textContent = '—'; }
    row.append(sw, nm, st);
    row.onclick = () => selectAdminTarget(l.labeler);
    row.onmouseenter = () => setTeamHover(l.labeler);
    row.onmouseleave = () => setTeamHover(null);
    box.appendChild(row);
  }
}

// Every roster labeler's saved points for the current slot, drawn read-only
// — EXCEPT the active target, whose points are the existing .hp markers
// (drawn by placeMarks()). Same shape language as the labeler's own two
// points: dot = chin, bar = shoulder, dashed = inferred, a thin connecting
// line — so admin mode doesn't ask anyone to learn a second vocabulary.
function renderTeamMarks() {
  const box = $('marks');
  for (const el of box.querySelectorAll('.tm')) el.remove();
  const links = $('tm-links');
  links.textContent = '';
  if (!state.isAdmin) return;
  const f = state.frames[state.i];
  if (!f) return;
  const k = key(f);
  for (const l of state.roster) {
    if (l.labeler === state.adminTarget) continue;   // that one's the .hp markers
    const r = state.teamRows.get(l.labeler)?.get(k);
    if (!r || !hasPoints(r)) continue;
    const color = state.teamColor.get(l.labeler) || 'var(--ink-dim)';
    const chin = [r.chin_x, r.chin_y], sh = [r.sh_x, r.sh_y];
    for (const [which, xy, vis] of [['chin', chin, r.chin_vis], ['sh', sh, r.sh_vis]]) {
      const d = document.createElement('div');
      d.className = `tm ${which}${vis === 'inferred' ? ' inferred' : ''}`;
      d.dataset.who = l.labeler;
      d.style.setProperty('--tm-color', color);
      d.style.left = `${xy[0] * 100}%`;
      d.style.top = `${xy[1] * 100}%`;
      d.title = `${l.labeler} — ${which === 'chin' ? 'chin' : 'shoulder'}`;
      d.onmouseenter = () => setTeamHover(l.labeler);
      d.onmouseleave = () => setTeamHover(null);
      box.appendChild(d);
    }
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', chin[0]); line.setAttribute('y1', chin[1]);
    line.setAttribute('x2', sh[0]);   line.setAttribute('y2', sh[1]);
    line.setAttribute('stroke', color);
    line.dataset.who = l.labeler;
    links.appendChild(line);
  }
}

// ── overview grid ──────────────────────────────────────────────────────────
function buildOverview() {
  const ov = $('ov4');
  ov.textContent = '';
  state.ovDots = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < state.frames.length; i++) {
    const d = document.createElement('div');
    d.className = 'd4';
    d.title = `#${i + 1}`;
    frag.appendChild(d);
    state.ovDots.push(d);
  }
  ov.appendChild(frag);
  ov.onclick = (e) => {
    const at = state.ovDots.indexOf(e.target);
    if (at >= 0) go(at);
  };
}

// Text for each disagreement kind, admin mode only — the tooltip carries
// the same information the colour does, so the grid isn't hue-only (a real
// accessibility gap for red/green colour-blind readers, and cheap to close).
function disagreeTitle(i, dg) {
  const n = `#${i + 1}`;
  switch (dg.kind) {
    case 'none': return `${n} — not labeled`;
    case 'solo': return `${n} — only one opinion so far`;
    case 'conflict': return `${n} — skip conflict: someone placed points, someone else skipped`;
    case 'skip-mixed': return `${n} — everyone skipped, but for different reasons`;
    case 'skip-agree': return `${n} — everyone agrees: can't be labeled`;
    default: return `${n} — spread ${(dg.level * DISAGREE_CAP * 100).toFixed(1)}% of torso height`;
  }
}

function renderOverview() {
  if (!state.ovDots) return;
  for (let i = 0; i < state.frames.length; i++) {
    const k = key(state.frames[i]);
    const d = state.ovDots[i];
    if (state.isAdmin) {
      const dg = state.disagree.get(k) || { kind: 'none', level: null };
      let cls = 'd4';
      d.style.background = '';
      if (dg.kind === 'solo') cls += ' solo';
      else if (dg.kind !== 'none') {
        d.style.background = lerpColor(dg.level);
        if (dg.kind === 'conflict') cls += ` ${CONFLICT_RING}`;
      }
      if (i === state.i) cls += ' cur';
      d.title = disagreeTitle(i, dg);
      if (d.className !== cls) d.className = cls;
      continue;
    }
    // Cheap insurance against a stray leftover from a prior admin-mode
    // render in this same tab (e.g. testing by retyping the name field) —
    // both are no-ops on a dot that was never touched.
    d.style.background = '';
    d.title = `#${i + 1}`;
    const row = state.labels.get(k);
    let cls = 'd4';
    if (state.failed.has(k)) cls += ' fail';
    else if (row && row.skipped) cls += ' sk';
    else if (hasPoints(row)) cls += ' dn';
    if (row && row.camera_bad) cls += ' cb';
    if (i === state.i) cls += ' cur';
    if (d.className !== cls) d.className = cls;
  }
}

// ── copy buttons / status ──────────────────────────────────────────────────
function wireCopyButtons() {
  for (const b of document.querySelectorAll('.idc')) {
    b.onclick = async () => {
      const text = $(b.dataset.copy).textContent;
      try { await navigator.clipboard.writeText(text); } catch (e) { return; }
      b.classList.add('copied');
      setTimeout(() => b.classList.remove('copied'), 900);
    };
  }
}

function status(msg, cls) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = cls || '';
}

// ── zoom / pan — verbatim from 3.0 ─────────────────────────────────────────
function applyTransform() {
  const stage = $('stage');
  stage.style.transform =
    `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  stage.style.setProperty('--inv', String(1 / state.zoom));
  stage.classList.toggle('zoomed', !isFitted());
  const mag = magnification();
  stage.classList.toggle('sharp',
    !!mag && mag.hd && mag.now >= SHARP_MAG);
  // Zooming in to check a placement is exactly when the question is open.
  if (state.pop && state.pop.kind === 'point') positionPointPop(state.pop.name);
}
// Device pixels per source pixel: `fit` is what displaying the frame at all
// costs (stage width vs the JPEG's own width), `now` folds in the zoom on top,
// and `hd` is whether the source has the resolution to be worth drawing
// pixel-exactly. null until the image reports its size — the frame's own
// resolution is half the input, so there is nothing to decide before it loads.
function magnification() {
  const w = $('stage').offsetWidth;          // layout width, pre-transform
  const img = $('frame');
  if (!w || !img.naturalWidth) return null;
  const fit = (w * (window.devicePixelRatio || 1)) / img.naturalWidth;
  return {
    fit,
    now: fit * state.zoom,
    hd: Math.min(img.naturalWidth, img.naturalHeight) >= SHARP_MIN_SOURCE,
  };
}
function isFitted() {
  return state.zoom === 1 && state.panX === 0 && state.panY === 0;
}
function resetZoom() {
  state.zoom = 1; state.panX = 0; state.panY = 0;
  applyTransform();
}
function zoomAt(px, clientX, clientY) {
  const before = state.zoom;
  let after = before * Math.exp(-px * ZOOM_SPEED);
  after = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, after));
  if ((before - 1) * (after - 1) < 0) after = 1;
  if (after === before) return;
  const r = $('stage').getBoundingClientRect();
  const k = 1 - after / before;
  state.zoom = after;
  state.panX += (clientX - r.left) * k;
  state.panY += (clientY - r.top) * k;
  if (Math.abs(state.panX) < 0.5) state.panX = 0;
  if (Math.abs(state.panY) < 0.5) state.panY = 0;
  applyTransform();
}

// ── point placement ────────────────────────────────────────────────────────
// Screen position -> image-normalized. getBoundingClientRect returns the
// stage's post-transform box, so zoom and pan are already inside it.
function stageNorm(clientX, clientY) {
  const r = $('stage').getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return [Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
          Math.min(1, Math.max(0, (clientY - r.top) / r.height))];
}

function screenPxOf(p) {
  const r = $('stage').getBoundingClientRect();
  return [r.left + p[0] * r.width, r.top + p[1] * r.height];
}

// The point whose dot sits within GRAB_PX of the cursor, nearest first.
function grabbablePoint(clientX, clientY) {
  let best = null, bestD = GRAB_PX;
  for (const name of ['chin', 'sh']) {
    const p = state.pts[name];
    if (!p) continue;
    const [sx, sy] = screenPxOf(p);
    const d = Math.hypot(clientX - sx, clientY - sy);
    if (d <= bestD) { best = name; bestD = d; }
  }
  return best;
}

function placeAt(name, clientX, clientY) {
  const p = stageNorm(clientX, clientY);
  if (!p) return;
  state.pts[name] = p;
  state.vis[name] = null;            // unanswered until the popover is answered
  state.skipped = false;
  state.skipReason = null;
  state.arm = null;                  // the popover owns the next click
  render();
  openPointPop(name);
}

// A correction, not a new placement: the visibility answer already given
// stands and is not asked again, and a popover still open on this point
// follows the dot instead.
function movePoint(name, clientX, clientY) {
  const p = stageNorm(clientX, clientY);
  if (!p) return;
  state.pts[name] = p;
  render();
  if (state.pop && state.pop.kind === 'point' && state.pop.name === name) {
    positionPointPop(name);
  }
}

// ── popovers ───────────────────────────────────────────────────────────────
// One at a time: both are a question about the click that just happened, and
// two open at once would mean two different things Enter could answer.
function closePop() {
  state.pop = null;
  $('pt-pop').hidden = true;
  $('skip-pop').hidden = true;
}

// The right-click menu is not a popover: it doesn't own the keyboard, and
// asks nothing — it's one shortcut for the labeler with no Del key (a
// touchpad-only laptop) or who just prefers a click. Opening it selects the
// point the same way pressing it does, so the highlight matches what a
// following Del would also act on.
function closeCtx() {
  $('pt-ctx').hidden = true;
  state.ctxFor = null;
}

function openCtx(name, clientX, clientY) {
  state.ctxFor = name;
  state.active = name;
  placeMarks();
  const menu = $('pt-ctx');
  const card = $('stage-card').getBoundingClientRect();
  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(card.width - w - 8, clientX - card.left))}px`;
  menu.style.top = `${Math.max(8, Math.min(card.height - h - 8, clientY - card.top))}px`;
}

function openPointPop(name) {
  if (!state.pts[name]) return;      // nothing placed, nothing to qualify
  state.pop = { kind: 'point', name };
  $('skip-pop').hidden = true;
  const pop = $('pt-pop');
  $('pt-pop-t').textContent = name === 'chin'
    ? 'The chin tip — could you see it?'
    : 'The shoulder top — could you see it?';
  pop.hidden = false;
  positionPointPop(name);
}

// Beside the point, inside the card: the labeler has to be able to look from
// the question to the pixels it is about without hunting for either.
function positionPointPop(name) {
  const pop = $('pt-pop');
  const card = $('stage-card').getBoundingClientRect();
  const [sx, sy] = screenPxOf(state.pts[name]);
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const GAP = 16;
  let left = sx - card.left + GAP;
  if (left + w > card.width - 8) left = sx - card.left - GAP - w;
  let top = sy - card.top - h / 2;
  pop.style.left = `${Math.max(8, Math.min(card.width - w - 8, left))}px`;
  pop.style.top = `${Math.max(8, Math.min(card.height - h - 8, top))}px`;
}

function choosePointVis(name, v) {
  if (!state.pts[name]) return;
  state.vis[name] = v;
  closePop();
  // Answering the chin arms the shoulder; answering the shoulder disarms. A
  // labeler doing frame after frame never touches the tool rows: click chin,
  // answer, click shoulder, answer, Enter.
  state.arm = (name === 'chin' && !state.pts.sh) ? 'sh' : null;
  render();
}

// Changing your mind about an answer already given, rather than re-opening
// the question: the switch already SHOWS which answer this point carries, so
// the thing to do with it is pick the other one — re-asking a yes/no you can
// already see is a dialog for a decision that has no third option. The
// popover is for the moment a point lands with no answer at all; these are
// for every moment after.
//
// Does not force a save — same as dragging a point, it just updates local
// state and lets commitCurrent()'s isDirty() check pick it up on the normal
// path (advance, skip, leaving the frame).
function setVis(name, v) {
  if (!state.pts[name] || !state.vis[name]) return;   // unplaced, or still being asked
  state.vis[name] = v;
  render();
}

// Shift+C / Shift+S flip whichever answer is showing, without naming one.
function toggleVis(name) {
  if (!state.pts[name] || !state.vis[name]) return;   // unplaced, or still being asked
  setVis(name, state.vis[name] === 'inferred' ? 'visible' : 'inferred');
}

// A change made on a frame whose row already exists goes NOW. Commit-on-leave
// would catch it too, but a labeler correcting an old frame is often doing
// exactly that and then closing the tab — the correction should not depend on
// a departure that may never happen.
function resaveIfWritten() {
  const saved = state.labels.get(key(state.frames[state.i]));
  if (!saved || !isResolved(saved)) return;
  if (saved.skipped) save({ skip: saved.skip_reason || 'not_visible' });
  else if (state.pts.chin && state.pts.sh && state.vis.chin && state.vis.sh) save({});
}

// Esc on the point popover undoes the placement rather than leaving a point
// with no answer behind: the click and its qualification are one act.
function cancelPoint(name) {
  state.pts[name] = null;
  state.vis[name] = null;
  if (state.active === name) state.active = null;
  state.arm = name;
  closePop();
  render();
}

// Del on the active point, or the right-click menu's own option: remove one
// point outright. Unlike cancelPoint (Esc mid-popover), this can also strip
// an answer already given — the point is being redone, not un-placed.
function deletePoint(name) {
  if (!state.pts[name]) return;
  state.pts[name] = null;
  state.vis[name] = null;
  if (state.active === name) state.active = null;
  if (state.pop && state.pop.kind === 'point' && state.pop.name === name) closePop();
  state.arm = name;
  render();
}

function openSkipPop() {
  state.pop = { kind: 'skip' };
  $('pt-pop').hidden = true;
  $('skip-pop').hidden = false;
}

function doSkip(reason) {
  closePop();
  closeCtx();
  state.pts = { chin: null, sh: null };
  state.vis = { chin: null, sh: null };
  state.active = null;
  state.skipped = true;
  state.skipReason = reason;
  if (save({ skip: reason })) advance(); else render();
}

function clearPoints() {
  closePop();
  closeCtx();
  state.pts = { chin: null, sh: null };
  state.vis = { chin: null, sh: null };
  state.active = null;
  state.arm = 'chin';
  state.skipped = false;
  state.skipReason = null;
  render();
}

// ── wiring ─────────────────────────────────────────────────────────────────
function bind() {
  for (const row of document.querySelectorAll('.tool-row')) {
    row.onclick = () => {
      // Re-arming behind an open question would leave the point it is about
      // unanswered and the popover pointing at nothing. Answer it first.
      if (state.pop) return;
      state.arm = row.dataset.p;
      render();
    };
  }
  // The switch sits right under a row whose click re-arms — stop the bubble
  // so picking an answer doesn't also re-arm the point above it.
  for (const seg of document.querySelectorAll('.vis-seg')) {
    seg.onclick = (e) => { e.stopPropagation(); setVis(seg.dataset.p, seg.dataset.v); };
  }

  // Save on a blank frame is refused, not converted to a skip: a skip now
  // carries a REASON, and "you pressed Enter without placing points" is not
  // one — save() puts the why in the status line.
  $('save-next').onclick = advance;
  // Skip asks WHY before it writes anything: the reason is the data, and a
  // frame is never skipped without one.
  $('skip-btn').onclick = () => {
    if (state.pop && state.pop.kind === 'skip') closePop(); else openSkipPop();
  };
  for (const b of $('skip-pop').querySelectorAll('.pop-opt')) {
    b.onclick = () => doSkip(b.dataset.reason);
  }
  for (const b of $('pt-pop').querySelectorAll('.pop-opt')) {
    b.onclick = () => {
      if (state.pop && state.pop.kind === 'point') choosePointVis(state.pop.name, b.dataset.v);
    };
  }
  $('pt-ctx-del').onclick = () => {
    const name = state.ctxFor;
    closeCtx();
    if (name) deletePoint(name);
  };
  // Any click outside the menu dismisses it, same as any other transient
  // popup — the delete option is the only thing on it worth a dedicated
  // Esc handler for.
  window.addEventListener('mousedown', (e) => {
    if (!$('pt-ctx').hidden && !$('pt-ctx').contains(e.target)) closeCtx();
  });

  const gotoFrame = () => {
    const el = $('goto-n');
    const n = parseInt(el.value, 10);
    if (!isFinite(n) || !state.frames.length) return;
    go(Math.max(0, Math.min(state.frames.length - 1, n - 1)));
    el.blur();
  };
  $('goto-go').onclick = gotoFrame;
  $('goto-n').onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') gotoFrame();
  };

  $('prev').onclick = () => go(state.i - 1);
  $('next').onclick = () => go(state.i + 1);

  const syncGo = () => { renderNameState(); };
  const commitName = () => {
    if (!who()) return;
    window.CMLabeler && window.CMLabeler.set && window.CMLabeler.set(who());
    syncGo();
    start();
  };
  $('labeler-input').oninput = syncGo;
  $('labeler-input').onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commitName();
  };
  $('name-go').onclick = commitName;
  $('cam-btn').onclick = () => {
    state.camBad = !state.camBad;
    renderCam();
    renderOverview();
    resaveIfWritten();
  };
  wireCopyButtons();

  const stage = $('stage');
  const card = $('stage-card');
  stage.onmouseenter = () => card.classList.add('guide');
  stage.onmouseleave = () => card.classList.remove('guide');
  stage.onmousemove = (e) => {
    const r = card.getBoundingClientRect();
    $('gx').style.top = `${e.clientY - r.top}px`;
    $('gy').style.left = `${e.clientX - r.left}px`;
    if (state.ptDrag) {
      const p = stageNorm(e.clientX, e.clientY);
      if (p) {
        state.pts[state.ptDrag] = p;
        placeMarks();
        // Nudging a point before answering its question is normal; the
        // question has to travel with it.
        if (state.pop && state.pop.kind === 'point' && state.pop.name === state.ptDrag) {
          positionPointPop(state.ptDrag);
        }
      }
      return;
    }
    if (state.drag) {
      state.panX = state.drag.px + (e.clientX - state.drag.x);
      state.panY = state.drag.py + (e.clientY - state.drag.y);
      applyTransform();
    }
  };
  stage.onmousedown = (e) => {
    // Right button is the context menu's, not the drag's — without this a
    // right-click also grabbed the point under it before oncontextmenu ever
    // saw the click.
    if (!state.ready || e.button !== 0) return;
    state.down = { x: e.clientX, y: e.clientY };
    if (state.isAdmin) {
      // A click on ANY teammate's mark selects them — "selectable" straight
      // off the canvas, not just from the picker — checked before anything
      // else so it can't be swallowed as a drag-start or a pan. With admin
      // mode on but nobody selected yet, nothing else on the stage is
      // interactive: there's no target for a placed or dragged point to
      // belong to.
      const teammate = teammateMarkAt(e.clientX, e.clientY);
      if (teammate) { state.teammateClick = teammate; e.preventDefault(); return; }
      if (!state.adminTarget) { e.preventDefault(); return; }
    }
    const grab = grabbablePoint(e.clientX, e.clientY);
    if (grab) {
      state.ptDrag = grab;
      state.active = grab;
      $(grab === 'chin' ? 'hp-chin' : 'hp-sh').classList.add('dragging');
      placeMarks();
      e.preventDefault();
      return;
    }
    if (state.active) { state.active = null; placeMarks(); }
    if (!isFitted()) {
      state.drag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
      stage.classList.add('panning');
    }
    e.preventDefault();
  };
  // Right-click a placed point for the same delete Del gives it — for a
  // touchpad with no Del key, or a labeler who'd rather click than reach for
  // one. Anywhere else on the stage keeps the browser's own menu.
  stage.oncontextmenu = (e) => {
    if (!state.ready) return;
    const grab = grabbablePoint(e.clientX, e.clientY);
    if (!grab) return;
    e.preventDefault();
    openCtx(grab, e.clientX, e.clientY);
  };
  window.addEventListener('mouseup', (e) => {
    const wasPtDrag = state.ptDrag;
    const teammateClick = state.teammateClick;
    state.teammateClick = null;
    if (state.ptDrag) {
      $('hp-chin').classList.remove('dragging');
      $('hp-sh').classList.remove('dragging');
      state.ptDrag = null;
      state.skipped = false;
      render();                    // sync tool rows + save button
    }
    const startedOnStage = !!state.down;
    const moved = state.down
      && Math.hypot(e.clientX - state.down.x, e.clientY - state.down.y) > CLICK_SLOP_PX;
    state.drag = null;
    state.down = null;
    stage.classList.remove('panning');
    if (!startedOnStage || moved) return;      // a real drag, or not ours
    if (!state.ready) return;
    if (teammateClick) { selectAdminTarget(teammateClick); return; }
    // A stationary click that landed on an existing dot always selects and
    // repositions THAT dot — never places a new one there, arm or no arm.
    // It used to be swallowed as a zero-length drag, so a 3px correction
    // moved nothing and the dots read as snapping to a grid; an armed point
    // used to win outright, so a click within GRAB_PX of an existing point
    // could still stack a second point on top of it. With one point placed
    // this fired on nearly every click, since the other slot is armed by
    // default the moment its neighbour is answered.
    if (wasPtDrag) {
      movePoint(wasPtDrag, e.clientX, e.clientY);
      return;
    }
    // A plain click on the stage places the armed point. With nothing
    // armed it does nothing — points move by drag, not by surprise. Nothing
    // is armed while a popover is open, so a stray click cannot move the
    // point the open question is about.
    if (!state.ready || !state.arm) return;
    // Belt-and-suspenders with the same check in onmousedown: nothing to
    // place a point ON when no admin target is selected.
    if (state.isAdmin && !state.adminTarget) return;
    placeAt(state.arm, e.clientX, e.clientY);
  });
  stage.ondblclick = resetZoom;
  const DELTA_PX = { 0: 1, 1: 16, 2: 400 };
  $('stage-card').addEventListener('wheel', (e) => {
    e.preventDefault();
    const px = e.deltaY * (DELTA_PX[e.deltaMode] || 1);
    zoomAt(Math.max(-200, Math.min(200, px)), e.clientX, e.clientY);
  }, { passive: false });

  // applyTransform, not just placeMarks: the new frame's own resolution is
  // half of the sharp/smooth decision, and it is only known once it loads.
  $('frame').onload = () => {
    $('frame').classList.remove('broken');
    placeMarks();
    applyTransform();
  };
  $('frame').onerror = () => {
    $('frame').classList.add('broken');
    status('Frame image did not load — check your connection', 'err');
  };

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!state.ready) return;
    // The right-click menu isn't a popover — it doesn't own the rest of the
    // keyboard — but Esc dismissing it is expected regardless.
    if (!$('pt-ctx').hidden) {
      if (e.key === 'Escape') { closeCtx(); e.preventDefault(); }
      return;
    }
    const k = e.key.toLowerCase();
    // An open popover owns the keyboard: 1/2 answer it, Esc backs out, and
    // everything else is swallowed so a reflex C or Enter cannot skip past
    // an unanswered question.
    if (state.pop) {
      if (state.pop.kind === 'point') {
        if (k === '1') choosePointVis(state.pop.name, 'visible');
        else if (k === '2') choosePointVis(state.pop.name, 'inferred');
        else if (e.key === 'Escape') cancelPoint(state.pop.name);
      } else {
        if (k === '1') doSkip('not_visible');
        else if (k === '2') doSkip('no_stance');
        else if (e.key === 'Escape') closePop();
      }
      e.preventDefault();
      return;
    }
    // Shift+C / Shift+S flip an answer already given — checked before the
    // plain keys, which the shifted ones must not also fire.
    if (e.shiftKey && k === 'c') toggleVis('chin');
    else if (e.shiftKey && k === 's') toggleVis('sh');
    else if (k === 'c') { state.arm = 'chin'; render(); }
    else if (k === 's') { state.arm = 'sh'; render(); }
    else if (e.key === 'Enter') advance();
    else if (k === 'k') openSkipPop();
    else if (e.key === 'ArrowLeft') go(state.i - 1);
    else if (e.key === 'ArrowRight') go(state.i + 1);
    else if (k === 'g') $('cam-btn').click();
    else if (e.key === 'Delete' && state.active) deletePoint(state.active);
    else if (e.key === 'Escape') clearPoints();
    else return;
    e.preventDefault();
  });
}

async function start() {
  const name = who();
  // Recomputed on every call, not cached — retyping the name field into or
  // out of "admin" mid-session (no reload) has to re-gate immediately.
  state.isAdmin = name.trim().toLowerCase() === 'admin';
  document.body.classList.toggle('admin', state.isAdmin);
  if (!name) {
    state.loadedFor = null;
    setReady(false, 'Enter your name and press Start.');
    status('');
    render();
    return;
  }
  if (state.loadingFor === name) return;
  if (state.loadedFor === name && state.ready) return;

  const token = ++state.loadToken;
  state.loadingFor = name;
  setReady(false, state.isAdmin
    ? 'Loading the team…  this can take a moment.'
    : 'Loading your saved progress…  this can take up to 30 seconds.');
  status(state.isAdmin ? 'Loading the team…' : 'Loading your labels…');

  try {
    if (state.isAdmin) {
      await loadRoster();
      await loadTeamRows();
      computeAllDisagree();
    } else {
      await loadLabels();
    }
  } catch (e) {
    if (token === state.loadToken) {
      state.loadingFor = null;
      renderNameState();
      status(e.message, 'err');
      setReady(false, 'Could not load. Press Start to try again.', true);
    }
    return;
  }
  if (token !== state.loadToken) return;
  state.loadingFor = null;
  state.loadedFor = name;
  renderNameState();
  setReady(true);

  if (state.isAdmin) {
    // No labeler picked yet — nothing to resume TO. state.labels et al.
    // point at an inert placeholder until selectAdminTarget() swaps them.
    state.adminTarget = null;
    state.labels = new Map();
    state.failed = new Map();
    state.inflight = new Set();
    state.chains = new Map();
    document.body.classList.add('no-target');
    renderTeamProgress();
    if (!state.rosterPoll) {
      state.rosterPoll = setInterval(async () => {
        try { await loadRoster(); renderTeamProgress(); renderAdminPicker(); } catch (e) { /* keep the stale roster over losing it */ }
      }, TEAM_POLL_MS);
    }
    go(0);
    status('');
    return;
  }

  if (state.rosterPoll) { clearInterval(state.rosterPoll); state.rosterPoll = null; }
  const n = firstUnlabeled(0);
  go(n < 0 ? state.frames.length - 1 : n);
  status(n < 0 ? 'All frames labeled' : '');
}

(async function init() {
  bind();
  try {
    const res = await fetch('queue.json?v=2');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const q = await res.json();
    state.frames = q.frames || [];
  } catch (e) {
    const viaFile = location.protocol === 'file:';
    const msg = viaFile
      ? 'Open this page over http (the hosted site or a local server) — not by double-clicking the file.'
      : 'Could not load queue.json (' + e.message + ').';
    setReady(false, msg, true);
    status(msg, 'err');
    return;
  }
  if (!state.frames.length) {
    setReady(false, 'queue.json loaded but contains no frames.', true);
    status('queue.json is empty', 'err');
    return;
  }
  setReady(false, 'Loading…');
  state.frames.forEach((f, i) => state.index.set(key(f), i));
  buildOverview();
  restoreName();
  render();
  await start();
})();

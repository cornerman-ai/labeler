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
// The machine's points (BlazePose shoulders, extrapolated chin) are NEVER
// drawn while placing — a labeler who can see the pipeline's guess anchors
// on it, and the whole value of the clicks is independence. They appear
// only inside the Peers panel, which also sets `consulted` on any save that
// follows, same meaning as 2.0/3.0's clue.
//
// REPEATS: ~10% of queue slots are the same frame planted again (rep=1),
// blind, ≥200 slots downstream. rep is part of the row identity end to end
// — key(), the sheet, the backend — so the pair measures the labeler's own
// click scatter instead of collapsing into one row.
//
// The backend is APPEND-ONLY (saveChinPoint): every save is a new row,
// readers resolve latest-per-(video,round,frame,rep). Re-labels are
// pre/post-coaching data, not waste.
//
// Position resumes from your own saved rows, never from this browser.
//
// Not ported from 3.0 (yet, deliberately — keep the first cut small):
// reviewer mode + disagreement jump, pairwise agreement panel, comparison
// grid, lead-everyone, exclude-video, per-labeler frame ranges. The peers
// panel is the review surface for the pilot.

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
const ZOOM_SPEED = 0.0018;
const TEAM_POLL_MS = 45000;
// A click is a click if the mouse moved less than this many screen px
// between down and up; anything longer is a pan (or a point drag).
const CLICK_SLOP_PX = 4;
// Grab an existing point when the mousedown lands within this many SCREEN
// px of it — screen, not image: at 12x a labeler aiming at a dot should not
// need 12x the precision to pick it back up.
const GRAB_PX = 10;

const DWELL_CAP_SEC = 120;

// Peer overlay colors, assigned by sorted labeler name so a color follows a
// person across frames within a session. Your own saved points keep the
// chin/shoulder colors of the placement UI and are not in this list.
const PEER_COLORS = ['#ff9f0a', '#bf5af2', '#64d2ff', '#ff6482', '#30d158',
                     '#ffd60a', '#ac8e68'];

const state = {
  frames: [],              // queue.json order (originals + planted repeats)
  index: new Map(),        // key -> queue position
  labels: new Map(),       // key -> latest saved row (mine)
  i: 0,
  pts: { chin: null, sh: null },   // in-progress points, [x,y] normalized
  arm: 'chin',             // which point the next stage click places
  skipped: false,
  skipReason: null,        // 'not_visible' | 'no_stance' when skipped
  zoom: 1, panX: 0, panY: 0,
  drag: null,              // pan drag: {x, y, px, py}
  ptDrag: null,            // point drag: 'chin' | 'sh'
  down: null,              // mousedown screen pos, for click-vs-drag
  loadingFor: null,
  loadedFor: null,
  loadToken: 0,
  inflight: new Set(),
  chains: new Map(),
  failed: new Map(),
  teamRows: null,
  teamTimer: null,
  ready: false,
  clueOpen: false,
  clueCache: new Map(),    // key -> peers payload
  consulted: new Set(),
  flag: false,
  shownAt: 0,
  teamOpen: false,
  ovDots: null,            // the 2k overview divs, built once
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

function api(params) {
  const url = new URL(SCRIPT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// One retry for cold-start blips; the v4 marker refuses a deployment that
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
    if (body.v4 !== true) {
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
  state.consulted = new Set();
  state.clueCache = new Map();
  state.failed = new Map();
  state.flag = false;
  if (!name) return;
  const body = await call({ action: 'listChinPoint', labeler: name }, 'load labels');
  for (const r of (body.rows || [])) {
    state.labels.set(rowKey(r), r);
    if (r.consulted) state.consulted.add(rowKey(r));
  }
}

function dwellFor(k) {
  const prior = state.labels.get(k);
  const before = (prior && Number(prior.dwell_sec)) || 0;
  const seg = state.shownAt ? (Date.now() - state.shownAt) / 1000 : 0;
  return Math.round((before + Math.min(Math.max(seg, 0), DWELL_CAP_SEC)) * 10) / 10;
}

// Optimistic, chained per frame — same machinery as 3.0: the local row is
// recorded and the labeler moves on; a failure rolls the row back, paints
// the dot red and names the frame in the status line.
// `skip` is null for a point pair, or the REASON ('not_visible' /
// 'no_stance') — a skip is a statement about why the frame cannot be
// measured, and the reason is the data: it is what says whether the
// sampling window is still letting non-stance frames through.
function save({ skip = null } = {}) {
  if (!state.ready) return false;
  const name = who();
  if (!name) { status('Enter your name first', 'err'); $('labeler-input').focus(); return false; }
  if (!skip && !(state.pts.chin && state.pts.sh)) {
    status('Place both points first (or skip)', 'err');
    return false;
  }
  const f = state.frames[state.i];
  const k = key(f);
  const dwell = dwellFor(k);
  state.shownAt = Date.now();
  const params = {
    action: 'saveChinPoint', labeler: name,
    video: f.stem, round: String(f.round), frame: String(f.frame),
    rep: String(f.rep || 0),
    frame_sec: String(f.pts), stance: f.stance,
    shoulder_used: f.shoulder,
    skipped: skip ? '1' : '0',
    skip_reason: skip || '',
    consulted: state.consulted.has(k) ? '1' : '0',
    flag: state.flag ? '1' : '0',
    dwell_sec: String(dwell),
  };
  if (!skip) {
    params.chin_x = state.pts.chin[0].toFixed(5);
    params.chin_y = state.pts.chin[1].toFixed(5);
    params.sh_x = state.pts.sh[0].toFixed(5);
    params.sh_y = state.pts.sh[1].toFixed(5);
  }

  const row = {
    video: f.stem, round: f.round, frame: f.frame, rep: f.rep || 0,
    skipped: skip ? 1 : 0,
    skip_reason: skip || null,
    consulted: state.consulted.has(k) ? 1 : 0,
    flag: state.flag ? 1 : 0,
    dwell_sec: dwell,
    chin_x: skip ? null : Number(params.chin_x),
    chin_y: skip ? null : Number(params.chin_y),
    sh_x: skip ? null : Number(params.sh_x),
    sh_y: skip ? null : Number(params.sh_y),
  };
  const prev = state.labels.get(k);
  state.labels.set(k, row);
  state.failed.delete(k);
  state.inflight.add(k);
  showQueueState();
  bumpMyTeamRow();

  const chain = (state.chains.get(k) || Promise.resolve())
    .then(() => call(params, 'save'))
    .then(() => {
      state.inflight.delete(k);
      state.clueCache.delete(k);
      showQueueState();
      scheduleTeamRefresh();
    })
    .catch((e) => {
      state.inflight.delete(k);
      if (prev) state.labels.set(k, prev); else state.labels.delete(k);
      state.failed.set(k, e.message);
      bumpMyTeamRow();
      const at = state.index.get(k);
      status(`Frame #${at === undefined ? '?' : at + 1} did not save — ${e.message}`, 'err');
      render();
    })
    .finally(() => { if (state.chains.get(k) === chain) state.chains.delete(k); });
  state.chains.set(k, chain);
  return true;
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
}

// ── navigation ─────────────────────────────────────────────────────────────
function firstUnlabeled(from = 0) {
  for (let i = from; i < state.frames.length; i++) {
    if (!state.labels.has(key(state.frames[i]))) return i;
  }
  return -1;
}

function go(i) {
  state.i = Math.max(0, Math.min(state.frames.length - 1, i));
  resetZoom();
  const f = state.frames[state.i];
  const saved = state.labels.get(key(f));
  state.skipped = !!(saved && saved.skipped);
  state.skipReason = (saved && saved.skip_reason) || null;
  state.flag = !!(saved && saved.flag);
  // A saved pair comes back editable: drag a dot, save again — the backend
  // appends, the history keeps the first placement.
  if (saved && hasPoints(saved)) {
    state.pts = { chin: [saved.chin_x, saved.chin_y], sh: [saved.sh_x, saved.sh_y] };
    state.arm = null;
  } else {
    state.pts = { chin: null, sh: null };
    state.arm = 'chin';
  }
  resetClue();
  state.shownAt = Date.now();
  render();
  prefetch();
}

function advance() {
  if (state.i < state.frames.length - 1) go(state.i + 1);
  else { status('End of queue'); render(); }
}

function prefetch() {
  for (let n = 1; n <= PREFETCH; n++) {
    const f = state.frames[state.i + n];
    if (f) new Image().src = imgSrc(f);
  }
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

  // Stance first, side second, and "usually" on purpose: stance says which
  // shoulder is normally the lead, but boxers switch mid-movement, so the
  // instruction is the shoulder actually held forward in THIS frame — the
  // stance line is the prior, not a hard rule. "their LEFT" is the boxer's
  // anatomical left — on the RIGHT of the image when they face the camera;
  // spelled out because every labeler trips on it exactly once.
  const side = String(f.shoulder || '').toUpperCase();
  $('side-hint').innerHTML =
    `${f.stance} — the lead is usually their <b>${side}</b> shoulder. `
    + `Mark the one actually held forward in this frame. `
    + `<span style="color:var(--ink-dim);font-weight:400">(their ${side.toLowerCase()} `
    + `= the boxer's own ${side.toLowerCase()}, not the image's)</span>`;

  const img = $('frame');
  if (img.dataset.k !== key(f)) { img.dataset.k = key(f); img.src = imgSrc(f); }

  for (const row of document.querySelectorAll('.tool-row')) {
    const p = row.dataset.p === 'chin' ? 'chin' : 'sh';
    row.setAttribute('aria-pressed', String(state.arm === row.dataset.p));
    // "not placed yet", never "not set" — the latter read as a fault
    // rather than as "waiting its turn behind the chin".
    row.querySelector('.st').textContent = state.pts[p]
      ? 'set — drag to adjust' : (state.arm === row.dataset.p ? 'click the frame' : 'not placed yet');
  }
  for (const b of document.querySelectorAll('.skipb')) {
    b.setAttribute('aria-pressed',
      String(state.skipped && state.skipReason === b.dataset.reason));
  }
  $('save').disabled = !(state.pts.chin && state.pts.sh);
  renderFlag();

  placeMarks();
  renderOverview();
}

function placeMarks() {
  const pct = (p) => ({ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` });
  for (const [name, el] of [['chin', $('hp-chin')], ['sh', $('hp-sh')]]) {
    const p = state.pts[name];
    el.classList.toggle('set', !!p);
    if (p) Object.assign(el.style, pct(p));
  }
  const img = $('frame');
  if (img.naturalWidth && img.naturalHeight) {
    $('stage').style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  }
}

function renderFlag() {
  $('flag-btn').setAttribute('aria-pressed', String(!!state.flag));
  $('flag-label').textContent = state.flag ? 'Flagged' : 'Flag';
}

function renderNameState() {
  $('name-go').disabled = !who();
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

function renderOverview() {
  if (!state.ovDots) return;
  for (let i = 0; i < state.frames.length; i++) {
    const k = key(state.frames[i]);
    const row = state.labels.get(k);
    let cls = 'd4';
    if (state.failed.has(k)) cls += ' fail';
    else if (row && row.skipped) cls += ' sk';
    else if (hasPoints(row)) cls += ' dn';
    if (row && row.flag) cls += ' fl';
    if (i === state.i) cls += ' cur';
    const d = state.ovDots[i];
    if (d.className !== cls) d.className = cls;
  }
}

// ── team panel ─────────────────────────────────────────────────────────────
function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s) || s < 0) return '';
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function setTeamOpen(open) {
  state.teamOpen = open;
  $('team-btn').setAttribute('aria-expanded', String(open));
  // 4.0's team list is a simple stack — the copied #team rule declares a
  // grid for 3.0's widget, so display is set inline to block, not grid.
  $('team').style.display = open ? 'block' : 'none';
}

async function loadTeam() {
  try {
    const body = await call({ action: 'statsChinPoint', labeler: who() || '1' }, 'team');
    state.teamRows = body.labelers || [];
    renderTeam();
  } catch (e) { /* background info — retried on the next poll */ }
}

function bumpMyTeamRow() {
  if (!state.teamRows) return;
  const name = who();
  if (!name) return;
  const mine = myRowsInQueue().filter(isResolved).length;
  const norm = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  let row = state.teamRows.find((r) => r.labeler.toLowerCase() === name.toLowerCase());
  if (!row) { row = { labeler: norm, n: 0, skipped: 0, last_ts: '' }; state.teamRows.push(row); }
  row.n = mine;
  renderTeam();
}

function renderTeam() {
  const el = $('team');
  if (!state.teamRows || !state.teamRows.length) {
    el.innerHTML = '<div id="team-empty">No labels saved yet</div>';
    return;
  }
  const total = state.frames.length || 1;
  const rows = [...state.teamRows].sort((a, b) => b.n - a.n);
  el.innerHTML = rows.map((r) => {
    const pctW = Math.min(100, 100 * r.n / total).toFixed(1);
    return `<div class="trow"><span class="tname"></span>`
      + `<span class="tcount">${r.n}<small> / ${total}</small>`
      + `${r.last_ts ? ` · ${ago(r.last_ts)}` : ''}</span>`
      + `<span class="tbar"><i style="width:${pctW}%"></i></span></div>`;
  }).join('');
  // Names are data, not markup.
  const names = el.querySelectorAll('.tname');
  rows.forEach((r, i) => { names[i].textContent = r.labeler; });
}

let teamTimerId = null;
function scheduleTeamRefresh() {
  clearTimeout(teamTimerId);
  teamTimerId = setTimeout(loadTeam, 4000);
}

// ── peers panel — everyone's points + the machine's ───────────────────────
// The review surface. Opening it draws every labeler's latest placements on
// the frame in their color, plus the pipeline's shoulder pair and chin
// proxy as diamonds — and marks the frame consulted, because any save made
// after seeing this is calibration, not independent evidence.
function setClueOpen(open) {
  state.clueOpen = open;
  $('clue-btn').setAttribute('aria-expanded', String(open));
  $('clue-wrap').classList.toggle('open', open);
  if (!open) { $('peer-marks').textContent = ''; return; }
  loadPeers();
}

function toggleClue() {
  if (!state.frames.length) return;
  setClueOpen(!state.clueOpen);
}

function resetClue() {
  state.clueOpen = false;
  $('clue-btn').setAttribute('aria-expanded', 'false');
  $('clue-wrap').classList.remove('open');
  $('peer-marks').textContent = '';
}

// Signed chin-to-shoulder distance in torso units, from two normalized
// points. Positive = the chin sits ABOVE the shoulder top (bigger = more
// exposed); negative = below it. Vertical only — the frames are upright
// phone/YouTube footage, and the raw points allow any better definition
// later without relabeling (that is the whole design).
function derivedDist(chin, sh, torsoH) {
  if (!chin || !sh || !torsoH) return null;
  return (sh[1] - chin[1]) / torsoH;
}

function fmtDist(d) {
  if (d === null) return '—';
  return `${d >= 0 ? '+' : ''}${Math.round(d * 100)}% torso`;
}

async function loadPeers() {
  const f = state.frames[state.i];
  const k = key(f);
  // Seeing peers before this frame is resolved makes the next save
  // calibrated rather than independent — allowed, recorded.
  if (!state.consulted.has(k)) {
    state.consulted.add(k);
  }
  const cached = state.clueCache.get(k);
  if (cached) { renderPeers(cached); return; }
  $('clue-note').textContent = 'Loading…';
  $('clue-body').innerHTML = '<div id="clue-note">Loading…</div>';
  try {
    const body = await call({ action: 'peersChinPoint', labeler: who() || '1',
                              video: f.stem, round: String(f.round),
                              frame: String(f.frame) }, 'peers');
    state.clueCache.set(k, body.peers || []);
    if (state.clueOpen && key(state.frames[state.i]) === k) renderPeers(body.peers || []);
  } catch (e) {
    $('clue-body').innerHTML = '<div id="clue-note"></div>';
    $('clue-body').firstChild.textContent = 'Could not load peers — ' + e.message;
  }
}

function renderPeers(peers) {
  const f = state.frames[state.i];
  const marks = $('peer-marks');
  marks.textContent = '';
  const body = $('clue-body');
  body.textContent = '';

  const myName = who().toLowerCase();
  const others = peers.filter((p) => p.labeler.toLowerCase() !== myName);
  const colorOf = new Map();
  [...new Set(others.map((p) => p.labeler))].sort()
    .forEach((nm, i) => colorOf.set(nm, PEER_COLORS[i % PEER_COLORS.length]));

  const addDot = (xy, color, cls, title) => {
    if (!xy) return;
    const d = document.createElement('div');
    d.className = 'peer-pt ' + cls;
    d.style.left = `${xy[0] * 100}%`;
    d.style.top = `${xy[1] * 100}%`;
    if (cls.includes('sh')) d.style.borderColor = color;
    else d.style.background = color;
    d.title = title;
    marks.appendChild(d);
  };

  const addRow = (color, name, detail) => {
    const row = document.createElement('div');
    row.className = 'pr';
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = color;
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = name;
    const dv = document.createElement('span');
    dv.className = 'dv';
    dv.textContent = detail;
    row.append(sw, nm, dv);
    body.appendChild(row);
  };

  // Everyone else's latest placements (every rep — two dots from the same
  // person on a planted repeat are their own scatter, worth seeing).
  for (const p of others) {
    const color = colorOf.get(p.labeler);
    const repTag = p.rep ? ` (rep ${p.rep})` : '';
    if (p.skipped) { addRow(color, p.labeler + repTag, 'skipped'); continue; }
    const chin = [p.chin_x, p.chin_y], sh = [p.sh_x, p.sh_y];
    addDot(chin, color, 'chin', `${p.labeler}${repTag} — chin`);
    addDot(sh, color, 'sh', `${p.labeler}${repTag} — shoulder`);
    addRow(color, p.labeler + repTag, fmtDist(derivedDist(chin, sh, f.torso_h)));
  }

  // Mine, from the placement UI colors.
  if (state.pts.chin && state.pts.sh) {
    addRow('color-mix(in srgb, var(--accent) 82%, transparent)', 'you',
           fmtDist(derivedDist(state.pts.chin, state.pts.sh, f.torso_h)));
  }

  // The pipeline's own idea — BlazePose shoulders and the extrapolated chin
  // — drawn as diamonds. This is the ONLY place the page shows them.
  const machineColor = 'var(--ink-dim)';
  addDot(f.chin, machineColor, 'chin machine', 'pipeline — chin proxy');
  const shKey = String(f.shoulder || '').toLowerCase() === 'left' ? 'l_sh' : 'r_sh';
  addDot(f.joints[shKey], machineColor, 'chin machine', 'pipeline — lead shoulder (BlazePose)');
  addRow(machineColor, 'pipeline',
         fmtDist(derivedDist(f.chin, f.joints[shKey], f.torso_h)));

  if (!others.length) {
    const note = document.createElement('div');
    note.id = 'peer-note';
    note.textContent = 'Nobody else has labeled this frame yet — the diamonds are the pipeline’s guess.';
    body.appendChild(note);
  }
  const note2 = document.createElement('div');
  note2.id = 'peer-note';
  note2.textContent = 'Saves made after opening this panel are recorded as consulted.';
  body.appendChild(note2);
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
  state.skipped = false;
  state.skipReason = null;
  // Placing the chin arms the shoulder; placing the shoulder disarms. A
  // labeler doing frame after frame never touches the tool rows: click
  // chin, click shoulder, Enter.
  if (name === 'chin' && !state.pts.sh) state.arm = 'sh';
  else state.arm = null;
  render();
}

function clearPoints() {
  state.pts = { chin: null, sh: null };
  state.arm = 'chin';
  state.skipped = false;
  state.skipReason = null;
  render();
}

// ── wiring ─────────────────────────────────────────────────────────────────
function bind() {
  for (const row of document.querySelectorAll('.tool-row')) {
    row.onclick = () => {
      state.arm = row.dataset.p;
      render();
    };
  }
  $('clear-pts').onclick = clearPoints;

  // Save on a blank frame is refused, not converted to a skip: a skip now
  // carries a REASON, and "you pressed Enter without placing points" is not
  // one — save() puts the why in the status line.
  $('save').onclick = () => {
    if (save({})) advance(); else render();
  };
  for (const b of document.querySelectorAll('.skipb')) {
    b.onclick = () => {
      state.pts = { chin: null, sh: null };
      state.skipped = true;
      state.skipReason = b.dataset.reason;
      if (save({ skip: b.dataset.reason })) advance(); else render();
    };
  }

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
  $('clue-btn').onclick = toggleClue;
  $('team-btn').onclick = () => setTeamOpen(!state.teamOpen);
  $('flag-btn').onclick = () => {
    state.flag = !state.flag;
    renderFlag();
    // A flag toggle on an already-saved frame is worth a row of its own —
    // same behavior as 3.0, which re-saves to persist the flag.
    const saved = state.labels.get(key(state.frames[state.i]));
    if (saved && isResolved(saved)) {
      if (saved.skipped) save({ skip: saved.skip_reason || 'not_visible' });
      else if (state.pts.chin && state.pts.sh) save({});
    }
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
      if (p) { state.pts[state.ptDrag] = p; placeMarks(); }
      return;
    }
    if (state.drag) {
      state.panX = state.drag.px + (e.clientX - state.drag.x);
      state.panY = state.drag.py + (e.clientY - state.drag.y);
      applyTransform();
    }
  };
  stage.onmousedown = (e) => {
    if (!state.ready) return;
    state.down = { x: e.clientX, y: e.clientY };
    const grab = grabbablePoint(e.clientX, e.clientY);
    if (grab) {
      state.ptDrag = grab;
      $(grab === 'chin' ? 'hp-chin' : 'hp-sh').classList.add('dragging');
      e.preventDefault();
      return;
    }
    if (!isFitted()) {
      state.drag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
      stage.classList.add('panning');
    }
    e.preventDefault();
  };
  window.addEventListener('mouseup', (e) => {
    const wasPtDrag = state.ptDrag;
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
    if (!startedOnStage || wasPtDrag || moved) return;   // a drag, or not ours
    // A plain click on the stage places the armed point. With nothing
    // armed it does nothing — points move by drag, not by surprise.
    if (!state.ready || !state.arm) return;
    placeAt(state.arm, e.clientX, e.clientY);
  });
  stage.ondblclick = resetZoom;
  const DELTA_PX = { 0: 1, 1: 16, 2: 400 };
  $('stage-card').addEventListener('wheel', (e) => {
    e.preventDefault();
    const px = e.deltaY * (DELTA_PX[e.deltaMode] || 1);
    zoomAt(Math.max(-200, Math.min(200, px)), e.clientX, e.clientY);
  }, { passive: false });

  $('frame').onload = () => { $('frame').classList.remove('broken'); placeMarks(); };
  $('frame').onerror = () => {
    $('frame').classList.add('broken');
    status('Frame image did not load — check your connection', 'err');
  };

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!state.ready) return;
    const k = e.key.toLowerCase();
    if (k === 'c') { state.arm = 'chin'; render(); }
    else if (k === 's') { state.arm = 'sh'; render(); }
    else if (e.key === 'Enter') $('save').click();
    else if (k === 'k') $('skip-nv').click();
    else if (k === 'n') $('skip-ns').click();
    else if (e.key === 'ArrowLeft') go(state.i - 1);
    else if (e.key === 'ArrowRight') go(state.i + 1);
    else if (k === 'h') toggleClue();
    else if (k === 'f') $('flag-btn').click();
    else if (e.key === 'Escape') clearPoints();
    else return;
    e.preventDefault();
  });
}

async function start() {
  const name = who();
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
  setReady(false, 'Loading your saved progress…  this can take up to 30 seconds.');
  status('Loading your labels…');
  loadTeam();

  try {
    await loadLabels();
  } catch (e) {
    if (token === state.loadToken) {
      state.loadingFor = null;
      renderNameState();
      status(e.message, 'err');
      setReady(false, 'Could not load your labels. Press Start to try again.', true);
    }
    return;
  }
  if (token !== state.loadToken) return;
  state.loadingFor = null;
  state.loadedFor = name;
  renderNameState();
  setReady(true);

  const n = firstUnlabeled(0);
  go(n < 0 ? state.frames.length - 1 : n);
  status(n < 0 ? 'All frames labeled' : '');
  if (state.teamRows) bumpMyTeamRow();
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
  setInterval(loadTeam, TEAM_POLL_MS);
})();

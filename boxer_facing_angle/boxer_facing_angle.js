// ============================================================
// boxer_facing_angle.js — boxer facing angle vs. camera, picked on a dial
//
// The PRIMARY label is a click on one of 8 compass wedges (0/45/90/135/180/
// -135/-90/-45), same discrete-bucket dial this tool always used — chosen
// over a continuous rating because bladedness/README.md measured that a
// continuous angle rating on this kind of rotation records the labeler's
// visual compression rather than the true angle.
//
// Drawing a line on the frame (from the boxer's stance toward their
// opponent) is an ASSISTANT, not the label: it computes an angle and lights
// up the nearest wedge as a light-tinted SUGGESTION (renderDial()'s
// `.suggested` class), distinct from the full-strength `.on` a click
// actually commits. The line is optional; when drawn, its raw points are
// saved ALONGSIDE whichever wedge gets clicked (for audit — nobody derives
// the saved bucket from them), never in place of it.
//
// The two mouse buttons do two UNRELATED things, so there's no click-vs-
// drag ambiguity to resolve on a single button: LEFT drag pans (any zoom,
// even at fit); RIGHT drag draws a brand new line, base at the mousedown
// point, end wherever the button comes up — replacing whatever line this
// frame already had. A LEFT mousedown that lands on an existing handle
// grabs and moves that one point instead of arming a pan — the base dot
// moves the base only (end stays put) and the end dot moves the end only
// (base stays put), same "shape says which point" idea as chin_tuck's own
// round/square dots, but now genuinely independent: dragging one point
// never drags the other along with it. A STATIONARY right-click (no real
// movement) opens a small delete menu when this frame has a line, and does
// nothing otherwise — see the stage wiring at the bottom of this file.
//
// 0° = squared to the camera, 180° = back to it, + = toward the CAMERA's
// right — an image-plane convention, not the boxer's own left/right, never
// mirrored for stance: recorded as-shown, same reasoning as Guard Drops'
// guard_hand.
//
// 2,976 real frames (boxer_facing_angle_frames.json) — guard/punch/impact,
// reused from chin-point 4.0's already-sampled+exported pools rather than a
// fresh sample of its own; see cornerman-backend
// ml/research/boxer_facing_angle/v1/ for exactly how they were picked.
//
// Backend: listFacingAngle / saveFacingAngle / deleteFacingAngle /
// statsFacingAngle in apps_script/Code.js — ONE SHEET TAB PER LABELER
// (facing_angle_labels_{Name}, header-reconciled on every save), the same
// shape as chin_shoulder_labels_{Name}.
//
// Handle coordinate math (stageNorm/screenPxOf, the --inv counter-scale,
// the click-vs-drag distinction) is ported from chin_tuck_4.0/height_guard;
// the dashed-continuation rendering is adapted from cornerman-debug-
// viewer's bladedness.js tightrope line (there read-only, here interactive
// but purely advisory).
// ============================================================

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';

// This tool's OWN pool now — 2,976 real frames (guard/punch/impact),
// reused from chin-point 4.0's already-sampled+exported height_guard/
// height_punch/height_impact pools, re-gated for arm/leg visibility on top
// of their existing head/shoulder/hip gate. Same bucket + shared download
// token as every other labeler_media pool; see
// cornerman-backend ml/research/boxer_facing_angle/v1/ for the
// reproducible build (build_dataset.py + boxer_facing_angle_manifest.json).
const FRAME_BUCKET = 'mycorner-bee6a.firebasestorage.app';
const FRAME_PREFIX = 'labeler_media/boxer_facing_angle/v1/frames';
const FRAME_TOKEN = '628dbeba-2969-4f45-b65e-5b295ef56fdc';

const BUG_REPORT_TOOL = 'boxer_facing_angle';

const MIN_ZOOM = 1 / 3;
const MAX_ZOOM = 12;
const ZOOM_SPEED = 0.0018;
const SHARP_MAG = 1.5;
const SHARP_MIN_SOURCE = 720;
// A mousedown-mouseup pair moving less than this many screen px is a CLICK,
// not a drag — the same distinction height_guard's CLICK_SLOP_PX makes.
// On the stage, that's what tells a stationary click (place a new line, or
// nothing if one already exists) apart from a real drag (pan, when
// zoomed — or adjust a handle, which is grabbed on mousedown already and
// never reaches this check at all).
const CLICK_SLOP_PX = 4;
// A handle is grabbed if the mousedown lands within this many screen px of
// its current on-screen position (handles are counter-scaled to a constant
// screen size, so this threshold means the same thing at any zoom).
const GRAB_PX = 12;

const BATCH = 100;
const BATCH_COLS = 20;

// How many frames AHEAD of the current one to warm the browser's own image
// cache for — same idea and number as height_guard's own PREFETCH. Only
// forward, never back: a frame already viewed is already cached, so there's
// nothing to warm going the other way.
const PREFETCH = 4;

const TEAM_POLL_MS = 45000;
const RANGE_FRESH_MS = 60000;
const HIDE_KEY = 'fa_hidden_labelers';
const RANGE_KEY = 'fa_range_cache';
const AGREE_KEY = 'fa_agree_pair';

// The eight intervals, in compass order. `c` is the interval's CENTRE and
// the value written to the sheet; the interval itself is [c-22.5, c+22.5),
// half-open upward. `key` is the numpad shortcut, the same layout
// punch_directions/punch_dir_16 uses (that page's SIGN convention is the
// opposite of this one — boxer-relative there, camera-relative here).
const BINS = [
  { c: 0,    key: '5' },
  { c: 45,   key: '3' },
  { c: 90,   key: '6' },
  { c: 135,  key: '9' },
  { c: 180,  key: '8' },
  { c: -135, key: '7' },
  { c: -90,  key: '4' },
  { c: -45,  key: '1' },
];
const KEY_BINS = {};
for (const b of BINS) KEY_BINS[b.key] = { store: String(b.c), skip: false };
KEY_BINS['2'] = { store: null, skip: true };

// 'skip' is stored as the bucket value itself — one more valid answer
// alongside the eight compass buckets, not a separate reason column. There
// was only ever one possible reason ('hard_to_tell'), so the column never
// carried anything past "was this a skip", which 'skip' already says.
const SKIP_BUCKET = 'skip';

// One color per roster member's line in admin mode — Apple's own 8 system
// accent colors (Apple-HIG design system this tool already uses), assigned
// by state.roster's existing order (stable, sorted by activity) so a given
// labeler keeps the same color across a session. Cycles past 8 labelers —
// an acceptable edge case for a small team, not worth a bigger palette.
const ADMIN_LINE_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759',
                           '#00c7be', '#007aff', '#5856d6', '#af52de'];

const EYE_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.6 8s2.3-3.8 6.4-3.8S14.4 8 14.4 8s-2.3 3.8-6.4 3.8S1.6 8 1.6 8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.7" stroke="currentColor" stroke-width="1.3"/></svg>';
const CHEV_SVG = '<svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2.5 4 5 6.5 7.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const state = {
  frames: [],
  index: new Map(),        // frame key -> queue position
  i: 0,
  labels: new Map(),       // frame key -> { bucket, base:[x,y]|null, end:[x,y]|null } — bucket is one of the 8 compass strings or SKIP_BUCKET
  line: null,              // { base, end } | null — the CURRENT frame's drawn line, an assistant
  ready: false,
  starting: false,
  pendingSaves: 0,
  ovDots: null,
  ovGutter: null,
  distRows: null,
  totalCounts: {},

  zoom: 1, panX: 0, panY: 0,
  drag: null,              // left-button pan drag origin
  down: null,              // left mousedown screen pos, for click-vs-drag
  draw: null,              // in-progress LEFT-button handle adjustment — see startDraw()
  rdown: null,             // in-progress RIGHT-button new-line drag origin

  roster: [],
  teamOpen: false,
  teamTimer: null,
  rosterPoll: null,
  hidden: new Set(),
  openRanges: new Set(),
  rangeCache: new Map(),
  rangePending: new Map(),

  agreePair: ['', ''],
  agreeRows: [null, null],
  agreeDots: null,

  // ── admin mode — see the header comment above start() ──
  isAdmin: false,          // typed name (who()) is literally "admin", case-insensitive
  teamRows: null,          // Map<labeler, Map<frameKey, label>> — every roster member's own rows
  adminBlocks: [],         // one { name, dialSvg, dialReadEl, ovDots, ovGutter, barTextEl, distRows } per roster member
  adminLineEls: new Map(), // labeler -> { seg, ext, baseEl, endEl, color } — persistent, built once in buildAdminStack()
  adminDrag: null,         // in-progress admin line-point drag — { name, mode, orig: {base, end} }
};

const $ = (id) => document.getElementById(id);

const key = (f) => JSON.stringify([f.stem, f.round, f.frame]);
const rowKey = (r) => JSON.stringify([r.video, Number(r.round), Number(r.frame)]);

// Mirrors chin_export_frames.frame_dir().
const frameDir = (stem) => stem.replace(/[. ]+$/, '');

const imgSrc = (f) => 'https://firebasestorage.googleapis.com/v0/b/'
  + FRAME_BUCKET + '/o/'
  + encodeURIComponent(`${FRAME_PREFIX}/${frameDir(f.stem)}/r${f.round}_f${f.frame}.jpg`)
  + `?alt=media&token=${FRAME_TOKEN}`;

// 180 is the wrap point — neither turned to the camera's right nor its
// left, so it carries no sign. 0 is signless for the same reason.
// Buckets are always whole numbers (0/45/90/…) and print as such; a line's
// computed angle is a float and rounds to 1 decimal — the raw atan2 result
// otherwise runs to full float precision ("+66.72501969638135°"), which is
// noise past the first decimal for a hand-drawn line.
const signed = (v) => {
  const n = Math.round(Number(v) * 10) / 10;
  if (Math.abs(n) === 180) return '180°';
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return (n > 0 ? '+' : '') + s + '°';
};

// Wrap to (-180, 180].
function norm180(d) {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  return x === -180 ? 180 : x;
}

// Nearest of the 8 compass buckets — what the line lights up as a
// suggestion, and what the agreement/distribution logic groups by.
function angleBucket(deg) {
  const n = norm180(deg);
  let b = Math.round(n / 45) * 45;
  if (b === -180) b = 180;
  if (b === 360) b = 0;
  return b;
}

function intervalText(c) {
  return `[${signed(norm180(c - 22.5))}, ${signed(norm180(c + 22.5))})`;
}

// The angle of a base->end vector: θ = atan2(dx, dy), so 0° is "down"
// (toward camera), +90° is "right" (camera's right), 180° is "up" (back to
// camera) — the same convention the dial's own geometry uses. Both points
// are in the SAME normalized 0..1 image space #stage and #marks share, and
// since #stage's aspect-ratio always matches the frame's own
// naturalWidth/naturalHeight, that space maps to screen pixels by the same
// factor in x and y — so this is never distorted by a non-square frame,
// with no pixel conversion needed.
function angleOf(line) {
  if (!line || !line.base || !line.end) return null;
  const dx = line.end[0] - line.base[0], dy = line.end[1] - line.base[1];
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return Math.atan2(dx, dy) * 180 / Math.PI;
}

// ── identity ───────────────────────────────────────────────────────────────
function who() { return ($('labeler-input').value || '').trim(); }

// The identity whose OWN data is actually being read/edited — who() itself
// for a normal labeler, always null for admin. Admin has no "own" row at
// all (see the admin-mode header comment above start()): every roster
// member's data is edited independently through their own dial in
// #admin-stack, never through a single delegated identity, so every
// identity-sensitive call site that used to read who() (applyLabel,
// bumpMyTeamRow, the range cache, the team panel's "you" highlight) reads
// THIS instead and correctly no-ops/shows nothing-highlighted for admin.
function activeLabeler() { return state.isAdmin ? null : who(); }

function restoreName() {
  const el = $('labeler-input');
  if (!el || el.value.trim()) return;
  let saved = null;
  try { saved = window.CMLabeler && window.CMLabeler.get && window.CMLabeler.get(); } catch (e) {}
  if (saved) el.value = saved;
}

function renderNameState() {
  $('name-go').disabled = !who();
  if (!state.ready && !$('lock').classList.contains('err')) {
    $('lock').textContent = state.starting
      ? 'Loading your labels…'
      : 'Enter your name above to start labeling.';
  }
}

function commitName() {
  if (!who()) return;
  try { window.CMLabeler && window.CMLabeler.set && window.CMLabeler.set(who()); } catch (e) {}
  $('name-row').classList.add('saved');
  renderNameState();
  start();
}

// ── backend ────────────────────────────────────────────────────────────────
function api(params) {
  const url = new URL(SCRIPT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function call(params, what) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    let body;
    try {
      const res = await fetch(api(params), { redirect: 'follow' });
      body = await res.json();
    } catch (e) { last = e; continue; }
    if (body.status !== 'ok') { last = new Error(body.message || 'unknown error'); continue; }
    return body;
  }
  throw new Error(`${what}: ${last && last.message}`);
}

const fetchRows = async (labeler) =>
  (await call({ action: 'listFacingAngle', labeler }, 'load labels')).rows || [];

// A fetched row's fields are '' (empty string) when absent, never
// null/undefined over the wire.
function rowToLabel(r) {
  const has = (a, b) => r[a] !== '' && r[a] !== undefined && r[b] !== '' && r[b] !== undefined;
  return {
    bucket: r.bucket === '' || r.bucket === undefined || r.bucket === null ? null : String(r.bucket),
    base: has('base_x', 'base_y') ? [Number(r.base_x), Number(r.base_y)] : null,
    end: has('end_x', 'end_y') ? [Number(r.end_x), Number(r.end_y)] : null,
  };
}

// ── status ─────────────────────────────────────────────────────────────────
function status(msg, cls) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = cls || '';
}

// ── zoom / pan — ported from height_guard ──────────────────────────────────
function applyTransform() {
  const stage = $('stage');
  stage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  stage.style.setProperty('--inv', String(1 / state.zoom));
  stage.classList.toggle('zoomed', !isFitted());
  $('stage-card').classList.toggle('zoomed', !isFitted());
  $('zoom-pct').textContent = Math.round(state.zoom * 100) + '%';
  const mag = magnification();
  stage.classList.toggle('sharp', !!mag && mag.hd && mag.now >= SHARP_MAG);
}

function magnification() {
  const w = $('stage').offsetWidth;
  const img = $('frame');
  if (!w || !img.naturalWidth) return null;
  const fit = (w * (window.devicePixelRatio || 1)) / img.naturalWidth;
  return { fit, now: fit * state.zoom,
           hd: Math.min(img.naturalWidth, img.naturalHeight) >= SHARP_MIN_SOURCE };
}

function isFitted() { return state.zoom === 1 && state.panX === 0 && state.panY === 0; }

function resetZoom() { state.zoom = 1; state.panX = 0; state.panY = 0; applyTransform(); }

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

// ── coordinate math — ported from height_guard ──────────────────────────────
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

// ── the dial ───────────────────────────────────────────────────────────────
// Eight 45°-wide SECTORS of a ring — the wedge IS the interval. Geometry:
// x = cx + r·sin θ, y = cy + r·cos θ, so 0° is at the bottom (facing the
// camera), 180° at the top (back to camera), +90° right. That maps dial
// angle θ to SVG screen angle φ = 90° − θ, so an increasing θ runs in
// SVG's *negative* sweep direction — hence sweep-flag 0 on the outer arc
// and 1 on the inner one coming back.
const DIAL = { cx: 130, cy: 130, rOut: 102, rIn: 44, rLabel: 74, rBound: 113 };

function polar(deg, r) {
  const a = deg * Math.PI / 180;
  return [DIAL.cx + r * Math.sin(a), DIAL.cy + r * Math.cos(a)];
}

function wedgePath(from, to) {
  const [x1o, y1o] = polar(from, DIAL.rOut);
  const [x2o, y2o] = polar(to, DIAL.rOut);
  const [x1i, y1i] = polar(from, DIAL.rIn);
  const [x2i, y2i] = polar(to, DIAL.rIn);
  return `M ${x1i} ${y1i} L ${x1o} ${y1o}`
       + ` A ${DIAL.rOut} ${DIAL.rOut} 0 0 0 ${x2o} ${y2o}`
       + ` L ${x2i} ${y2i}`
       + ` A ${DIAL.rIn} ${DIAL.rIn} 0 0 1 ${x1i} ${y1i} Z`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs) => {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  return e;
};

// Builds the 8-wedge + skip-hole SVG structure into `svg`, wiring each
// pick to `onPick(store, isSkip)` — applyLabel() itself for the single
// normal-mode dial (buildDial() below), or a per-person closure for each
// admin-stack dial (buildAdminStack()). `showKeys` prints the numpad-
// shortcut hint on each wedge; admin dials pass false since the GLOBAL
// keyboard shortcuts only ever drive the single normal-mode dial (there's
// no single "active" identity for a key press to target once multiple
// per-person dials exist), so printing key hints on every roster member's
// mini-dial would just be misleading.
function buildDialInto(svg, onPick, showKeys) {
  svg.replaceChildren();

  for (const b of BINS) {
    const g = svgEl('g');
    const path = svgEl('path', {
      class: 'wedge', d: wedgePath(b.c - 22.5, b.c + 22.5),
      role: 'button', tabindex: '0',
      'aria-label': `${signed(b.c)} — ${intervalText(b.c)}`,
    });
    path.dataset.store = String(b.c);
    const act = () => onPick(String(b.c), false);
    path.addEventListener('click', act);
    path.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); }
    });
    const title = svgEl('title');
    title.textContent = intervalText(b.c);
    path.appendChild(title);

    const [lx, ly] = polar(b.c, DIAL.rLabel);
    const label = svgEl('text', { class: 'wlabel', x: lx, y: ly - 5 });
    label.textContent = signed(b.c);
    label.dataset.store = String(b.c);
    const kb = svgEl('text', { class: 'wkey', x: lx, y: ly + 8 });
    kb.textContent = showKeys ? b.key : '';
    kb.dataset.store = String(b.c);

    g.append(path, label, kb);
    svg.appendChild(g);
  }

  for (const b of BINS) {
    const edge = b.c + 22.5;
    const [sx, sy] = polar(edge, DIAL.rIn);
    const [ex, ey] = polar(edge, DIAL.rOut);
    svg.appendChild(svgEl('line', { class: 'spoke', x1: sx, y1: sy, x2: ex, y2: ey }));
    const [bx, by] = polar(edge, DIAL.rBound);
    const t = svgEl('text', { class: 'bound', x: bx, y: by });
    t.textContent = signed(norm180(edge));
    svg.appendChild(t);
  }

  const hole = svgEl('circle', { class: 'skipw', cx: DIAL.cx, cy: DIAL.cy, r: DIAL.rIn - 3,
                                 role: 'button', tabindex: '0', 'aria-label': "Can't tell the angle" });
  const skipAct = () => onPick(null, true);
  hole.addEventListener('click', skipAct);
  hole.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); skipAct(); }
  });
  const st = svgEl('text', { class: 'skipt', x: DIAL.cx, y: DIAL.cy - 5 });
  st.textContent = "can't tell";
  const sk = svgEl('text', { class: 'skipk', x: DIAL.cx, y: DIAL.cy + 9 });
  sk.textContent = showKeys ? '2' : '';
  svg.append(hole, st, sk);
}

function buildDial() {
  buildDialInto($('dial'), applyLabel, true);
}

// Paints TWO independent signals: `.on` for the committed pick (the row
// actually saved for this frame) and `.suggested` for whichever wedge the
// CURRENTLY DRAWN line (state.line, which may not be saved yet) is nearest
// to. A wedge can carry both — CSS makes `.on` win when it does.
function renderDial() {
  const row = state.labels.get(key(state.frames[state.i]));
  const picked = row ? row.bucket : null;
  const lineAngle = angleOf(state.line);
  const suggested = lineAngle === null ? null : String(angleBucket(lineAngle));

  for (const el of $('dial').querySelectorAll('.wedge, .wlabel, .wkey')) {
    const store = el.dataset.store;
    el.classList.toggle('on', picked !== null && picked !== SKIP_BUCKET && store === picked);
    el.classList.toggle('suggested', suggested !== null && store === suggested);
  }
  for (const el of $('dial').querySelectorAll('.skipw, .skipt, .skipk')) {
    el.classList.toggle('on', picked === SKIP_BUCKET);
  }

  const read = $('dial-read');
  if (picked === null) read.innerHTML = '&mdash;';
  else if (picked === SKIP_BUCKET) read.innerHTML = '<b>Skipped</b> &mdash; angle not readable';
  else read.innerHTML = `<b>${signed(picked)}</b> &mdash; ${intervalText(Number(picked))}`;

  const lineRead = $('line-read');
  lineRead.innerHTML = lineAngle === null ? ''
    : `Line: <b>${signed(lineAngle)}</b> &middot; nearest ${signed(angleBucket(lineAngle))}`;
}

// ── the drawn line (assistant) ──────────────────────────────────────────────
// Where the base->end ray exits the unit square, for the dashed
// continuation — pure normalized-space geometry (angle-correct, see
// angleOf()'s comment).
function rayExit(base, end) {
  const dx = end[0] - base[0], dy = end[1] - base[1];
  const tx = dx > 0 ? (1 - end[0]) / dx : dx < 0 ? (0 - end[0]) / dx : Infinity;
  const ty = dy > 0 ? (1 - end[1]) / dy : dy < 0 ? (0 - end[1]) / dy : Infinity;
  const t = Math.max(0, Math.min(tx, ty));
  return [end[0] + t * dx, end[1] + t * dy];
}

function renderLine(base, end) {
  const svg = $('line-svg');
  if (!base) {
    $('hp-base').classList.remove('set');
    $('hp-end').classList.remove('set');
    svg.style.display = 'none';
    return;
  }
  svg.style.display = '';
  const b = $('hp-base'); b.classList.add('set');
  b.style.left = (base[0] * 100) + '%'; b.style.top = (base[1] * 100) + '%';
  if (!end) {
    $('hp-end').classList.remove('set');
    $('line-seg').setAttribute('x1', base[0]); $('line-seg').setAttribute('y1', base[1]);
    $('line-seg').setAttribute('x2', base[0]); $('line-seg').setAttribute('y2', base[1]);
    $('line-ext').style.display = 'none';
    return;
  }
  const e = $('hp-end'); e.classList.add('set');
  e.style.left = (end[0] * 100) + '%'; e.style.top = (end[1] * 100) + '%';
  const seg = $('line-seg');
  seg.setAttribute('x1', base[0]); seg.setAttribute('y1', base[1]);
  seg.setAttribute('x2', end[0]); seg.setAttribute('y2', end[1]);
  const ext = $('line-ext');
  const exit = rayExit(base, end);
  ext.style.display = '';
  ext.setAttribute('x1', end[0]); ext.setAttribute('y1', end[1]);
  ext.setAttribute('x2', exit[0]); ext.setAttribute('y2', exit[1]);
}

// ── delete-line context menu — right-click on a line that already exists ──
// Same fixed-position, cursor-placed menu chrome as punch/ui.js's own
// segment context menu. Deleting only clears the CURRENTLY DRAWN state —
// the line is never saved on its own (see applyLabel()), so this just
// means the next save for this frame won't carry one; a row already saved
// with a line keeps it until the next save overwrites it.
function openLineContextMenu(clientX, clientY) {
  const menu = $('line-ctx-menu');
  menu.hidden = false;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(4, Math.min(clientX, window.innerWidth - mw - 8)) + 'px';
  menu.style.top = Math.max(4, Math.min(clientY, window.innerHeight - mh - 8)) + 'px';
}
function closeLineContextMenu() {
  const menu = $('line-ctx-menu');
  if (menu) menu.hidden = true;
}
function deleteCurrentLine() {
  state.line = null;
  renderLine(null, null);
  renderDial();
  closeLineContextMenu();
}

function grabHandle(clientX, clientY) {
  if (!state.line) return null;
  const pb = screenPxOf(state.line.base), pe = screenPxOf(state.line.end);
  if (Math.hypot(clientX - pb[0], clientY - pb[1]) <= GRAB_PX) return 'base';
  if (Math.hypot(clientX - pe[0], clientY - pe[1]) <= GRAB_PX) return 'end';
  return null;
}

// Only ever called with a handle actually grabbed on the LEFT button —
// placing a BRAND NEW line is a right-button drag (see the stage wiring),
// so there's no 'new' mode here: a left-button drag on the stage always
// means adjusting one of an EXISTING line's two points, or (if nothing is
// grabbed) panning.
function startDraw(clientX, clientY) {
  const grab = grabHandle(clientX, clientY);
  if (!grab) return false;
  state.draw = { mode: grab, orig: { base: state.line.base.slice(), end: state.line.end.slice() } };
  return true;
}

// Live suggestion while dragging, not just after release — repaints the
// dial's `.suggested` wedge and the line-read text from whatever base/end
// the drag currently implies.
function updateSuggestionFrom(base, end) {
  const a = Math.atan2(end[0] - base[0], end[1] - base[1]) * 180 / Math.PI;
  if (!Number.isFinite(a)) return;
  $('line-read').innerHTML = `Line: <b>${signed(a)}</b> &middot; nearest ${signed(angleBucket(a))}`;
  const bucket = String(angleBucket(a));
  for (const el of $('dial').querySelectorAll('.wedge, .wlabel, .wkey')) {
    el.classList.toggle('suggested', el.dataset.store === bucket);
  }
}

// Each handle moves ONLY its own point — dragging the base leaves the end
// exactly where it was and vice versa, so the two are genuinely
// independent (previously the base handle translated the whole line,
// preserving the angle; that made it impossible to edit just the base).
function moveDraw(clientX, clientY) {
  const d = state.draw;
  if (!d) return;
  const p = stageNorm(clientX, clientY);
  if (d.mode === 'base') {
    renderLine(p, d.orig.end);
    updateSuggestionFrom(p, d.orig.end);
  } else if (d.mode === 'end') {
    renderLine(d.orig.base, p);
    updateSuggestionFrom(d.orig.base, p);
  }
}

function finishDraw(clientX, clientY) {
  const d = state.draw;
  state.draw = null;
  if (!d) return;
  const p = stageNorm(clientX, clientY);
  // A near-zero-length result (dragged one handle onto the other) would
  // make the angle undefined — treat it as no change rather than a
  // degenerate line.
  if (d.mode === 'base') {
    state.line = Math.hypot(p[0] - d.orig.end[0], p[1] - d.orig.end[1]) < 0.002
      ? { base: d.orig.base, end: d.orig.end }
      : { base: p, end: d.orig.end };
  } else {
    state.line = Math.hypot(p[0] - d.orig.base[0], p[1] - d.orig.base[1]) < 0.002
      ? { base: d.orig.base, end: d.orig.end }
      : { base: d.orig.base, end: p };
  }
  renderLine(state.line.base, state.line.end);
  renderDial();
}

// A brand new line, from a RIGHT-button drag (base at mousedown, end at
// mouseup) — replaces whatever line this frame already had. See the stage
// wiring below for how this is told apart from a stationary right-click
// (which opens the delete menu instead).
function drawNewLine(base, end) {
  state.line = { base, end };
  renderLine(base, end);
  renderDial();
}

// ── labeling ───────────────────────────────────────────────────────────────
// Optimistic: the pick lands and the page advances immediately, the save
// drains behind it, and a failure rolls the row back so the frame resurfaces
// on the next sweep rather than being silently lost. Whatever line is
// currently drawn for this frame (state.line) rides along as auxiliary
// data — it never decides which bucket gets saved.
function applyLabel(store, isSkip) {
  if (!state.ready) return;
  const labeler = activeLabeler();
  if (!labeler) { status('Enter your name and press Start first.', 'err'); return; }
  const f = state.frames[state.i];
  if (!f) return;
  const k = key(f);
  const prev = state.labels.get(k);
  const line = isSkip ? null : state.line;
  const row = {
    bucket: isSkip ? SKIP_BUCKET : store,
    base: line ? line.base : null,
    end: line ? line.end : null,
  };
  if (isSkip) state.line = null;

  state.labels.set(k, row);
  state.pendingSaves++;
  renderDial();
  renderLine(state.line ? state.line.base : null, state.line ? state.line.end : null);
  renderProgress();
  bumpMyTeamRow();
  status(`Saving ${isSkip ? 'skip' : signed(store)}…`);

  go(state.i + 1);

  call({
    action: 'saveFacingAngle', labeler, video: f.stem,
    round: String(f.round), frame: String(f.frame), pts_sec: String(f.pts),
    stance: f.stance || '',
    bucket: isSkip ? SKIP_BUCKET : String(store),
    base_x: row.base ? String(row.base[0]) : '', base_y: row.base ? String(row.base[1]) : '',
    end_x: row.end ? String(row.end[0]) : '', end_y: row.end ? String(row.end[1]) : '',
  }, 'save').then(() => {
    state.pendingSaves = Math.max(0, state.pendingSaves - 1);
    status(state.pendingSaves ? `${state.pendingSaves} save(s) pending…` : 'Saved.',
           state.pendingSaves ? null : 'ok');
    scheduleTeamRefresh();
  }).catch((e) => {
    state.pendingSaves = Math.max(0, state.pendingSaves - 1);
    if (prev) state.labels.set(k, prev); else state.labels.delete(k);
    renderDial();
    renderProgress();
    bumpMyTeamRow();
    status('Save failed: ' + e.message, 'err');
  });
}

// ── frame ──────────────────────────────────────────────────────────────────
function showFrame() {
  const f = state.frames[state.i];
  const img = $('frame');
  resetZoom();
  closeLineContextMenu();
  if (!f) {
    img.removeAttribute('src');
    state.line = null;
    renderDial();
    renderLine(null, null);
    return;
  }
  img.src = imgSrc(f);
  $('id-pos').textContent = `${state.i + 1} / ${state.frames.length}`;
  $('id-video').textContent = f.stem;
  $('id-round').textContent = String(f.round);
  $('id-frame').textContent = String(f.frame);
  $('id-pts').textContent = f.pts.toFixed(3);
  $('bugreport-context').textContent =
    `Attaching: "${f.stem}" · round ${f.round} · frame ${f.frame}`;
  const row = state.labels.get(key(f));
  state.line = row && row.base && row.end ? { base: row.base.slice(), end: row.end.slice() } : null;
  renderLine(state.line ? state.line.base : null, state.line ? state.line.end : null);
  renderDial();
  renderOverview();          // moves the .cur outline to this slot
  renderAllAdminBlocks();    // no-op until the stack is built — see loadAllAdminData()
  renderAdminLines();        // every labeler's line for THIS frame, color-coded
  // Moves the Agreement grid's own .cur outline to this slot too — it used
  // to only repaint on refreshAgreement() (picking a pair, or the post-save
  // debounce), so clicking a frame anywhere else left it pointing at the
  // OLD position while every admin-stack Progress grid had already moved.
  // moveAgreementCur() only touches the outline (O(1)-ish) — the actual
  // agree/disagree colors haven't changed just because the viewed frame
  // did, so this does NOT recompute them (see moveAgreementCur()'s own
  // comment for why an earlier version of this called full renderAgreement()
  // here instead, which was the actual cause of a reported color lag).
  if (state.isAdmin) moveAgreementCur();
  prefetch();
}

// Warms the browser's own image cache for the next few frames so the
// mousedown->image-load lag on Next isn't paid on every single click —
// `new Image().src` starts the request without touching the DOM; the real
// `<img>`'s later `.src =` assignment then hits an already-warm cache.
function prefetch() {
  for (let n = 1; n <= PREFETCH; n++) {
    const f = state.frames[state.i + n];
    if (f) new Image().src = imgSrc(f);
  }
}

function go(i) {
  if (!state.frames.length) return;
  const n = Math.min(state.frames.length - 1, Math.max(0, i));
  if (n === state.i) return;
  state.i = n;
  showFrame();
}

// ── progress: the overview grid ────────────────────────────────────────────
function buildOverview() {
  const ov = $('ov');
  ov.textContent = '';
  const frag = document.createDocumentFragment();
  state.ovDots = [];
  for (let i = 0; i < state.frames.length; i++) {
    const d = document.createElement('div');
    d.className = 'd4';
    if (i >= BATCH && i % BATCH < BATCH_COLS) d.dataset.batch = '1';
    frag.appendChild(d);
    state.ovDots.push(d);
  }
  ov.appendChild(frag);
  ov.onclick = (e) => {
    const at = state.ovDots.indexOf(e.target);
    if (at >= 0) go(at);
  };

  const gutter = document.querySelector('.ovn');
  const col = document.createDocumentFragment();
  state.ovGutter = [];
  for (let b = 0; b * BATCH < state.frames.length; b++) {
    const count = Math.min(BATCH, state.frames.length - b * BATCH);
    const rows = Math.ceil(count / BATCH_COLS);
    const n = document.createElement('b');
    const num = document.createElement('span');
    num.textContent = b + 1;
    const g = document.createElement('span');
    g.className = 'ovn-g';
    const s = document.createElement('span');
    s.className = 'ovn-s';
    n.append(num, g, s);
    n.style.height = `${rows * 9 + (rows - 1) * 3}px`;
    n.style.lineHeight = '9px';
    if (b) n.style.marginTop = '10px';
    col.appendChild(n);
    state.ovGutter.push({ g, s, start: b * BATCH, end: b * BATCH + count, node: n });
  }
  gutter.replaceChildren(col);
}

function paintBatchCounts() {
  if (!state.ovGutter) return;
  for (const gu of state.ovGutter) {
    let g = 0, s = 0;
    for (let i = gu.start; i < gu.end; i++) {
      const row = state.labels.get(key(state.frames[i]));
      if (!row) continue;
      if (row.bucket === SKIP_BUCKET) s++; else if (row.bucket !== null) g++;
    }
    gu.g.textContent = g || '';
    gu.s.textContent = s || '';
    gu.node.title = `frames ${gu.start + 1}–${gu.end} — ${g} labelled, ${s} skipped`;
  }
}

function renderOverview() {
  const dots = state.ovDots;
  if (!dots) return;
  for (let i = 0; i < state.frames.length; i++) {
    const row = state.labels.get(key(state.frames[i]));
    let cls = 'd4';
    let what = 'not labelled';
    if (row && row.bucket === SKIP_BUCKET) { cls += ' sk'; what = "can't tell"; }
    else if (row && row.bucket !== null) { cls += ' dn'; what = signed(row.bucket); }
    if (i === state.i) cls += ' cur';
    const t = `#${i + 1} — ${what}`;
    if (dots[i].title !== t) dots[i].title = t;
    if (dots[i].className !== cls) dots[i].className = cls;
  }
  paintBatchCounts();
}

// Two series per row — you, and everyone — as an EMPHASIS pair: your own
// progress is the point, the team total is context for it.
function buildDist() {
  const dist = $('dist');
  dist.replaceChildren();
  state.distRows = new Map();
  const rows = BINS.map((b) => ({ k: String(b.c), label: signed(b.c) }))
    .concat([{ k: 'skip', label: 'skip', skip: true }]);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'dist-row' + (r.skip ? ' skip' : '');
    const label = document.createElement('span');
    label.className = 'dist-label';
    label.textContent = r.label;
    const track = document.createElement('div');
    track.className = 'dist-track';
    const you = document.createElement('div');
    you.className = 'dist-bar you';
    const all = document.createElement('div');
    all.className = 'dist-bar all';
    track.append(you, all);
    const val = document.createElement('span');
    val.className = 'dist-val';
    const youVal = document.createElement('b');
    const slash = document.createElement('span');
    slash.className = 'dist-slash';
    slash.textContent = '/';
    const allVal = document.createElement('span');
    val.append(youVal, slash, allVal);
    row.append(label, track, val);
    dist.appendChild(row);
    state.distRows.set(r.k, { you, all, youVal, allVal });
  }
}

function bucketCounts(rows) {
  const count = {};
  for (const row of rows) {
    if (row.bucket === null || row.bucket === undefined) continue;
    count[row.bucket] = (count[row.bucket] || 0) + 1;
  }
  return count;
}

// PERCENT of each series' own total, not raw counts — a raw-count bar
// scaled against the single largest bucket (as this used to work) makes
// every OTHER bucket look tiny whenever one bucket dominates (90°/-90°
// swamping everything else here), and a "2/1051" readout says nothing
// about how either person's own labeling is actually distributed. "40% of
// everyone's picks are 0°, 20% of yours are" is the comparison that's
// actually useful, and it's naturally bounded to 100% — no shared `max`
// to compute at all.
function renderDist() {
  const mine = bucketCounts(state.labels.values());
  const total = state.totalCounts || {};
  const mineTotal = Object.values(mine).reduce((a, n) => a + n, 0);
  const totalTotal = Object.values(total).reduce((a, n) => a + n, 0);
  for (const [k, els] of state.distRows) {
    const you = mine[k] || 0;
    const all = total[k] || 0;
    const youPct = mineTotal ? 100 * you / mineTotal : 0;
    const allPct = totalTotal ? 100 * all / totalTotal : 0;
    els.you.style.width = youPct.toFixed(1) + '%';
    els.all.style.width = allPct.toFixed(1) + '%';
    els.youVal.textContent = mineTotal ? Math.round(youPct) + '%' : '—';
    els.youVal.classList.toggle('has', you > 0);
    els.allVal.textContent = totalTotal ? Math.round(allPct) + '%' : '—';
  }
}

// The team total — every labeler's rows, via statsFacingAngle's per-tab
// bucket tally (there is no single shared sheet to read unfiltered under
// the one-tab-per-labeler backend).
async function refreshTotalDist() {
  try {
    const body = await call({ action: 'statsFacingAngle' }, 'load team');
    state.roster = (body.labelers || []).filter((l) => l.n > 0);
    const total = {};
    for (const l of state.roster) {
      for (const [k, n] of Object.entries(l.buckets || {})) total[k] = (total[k] || 0) + n;
    }
    state.totalCounts = total;
    renderTeamPanel();
    renderDist();
    populateAgreeSelects();
  } catch (e) { /* keep the stale totals over losing them */ }
}

function renderProgress() {
  const N = state.frames.length;
  const done = state.labels.size;
  $('bar-text').textContent = N
    ? `${done.toLocaleString()} / ${N.toLocaleString()} labelled`
    : 'no frames';
  renderOverview();
  renderDist();
}

// ── start / sync ───────────────────────────────────────────────────────────
// ADMIN MODE. Reached by typing the literal name "admin" (case-insensitive)
// and pressing Start — same gate chin_tuck_4.0/height_guard uses. Unlike
// height_guard, admin here never edits anyone's data live on canvas: this
// tool's whole label is one dial click, so there's nothing to drag on
// someone else's behalf. Rather than picking ONE teammate to edit "as"
// (an earlier version of this did exactly that, with an "acting as"
// select), admin instead sees EVERY roster member's own Progress/
// Distribution/dial stacked one after another (#admin-stack,
// buildAdminStack()) — long, deliberately: reviewing one frame across the
// whole team at a glance was the actual point, not a single delegated
// identity. Each person's mini-dial is independently clickable — click a
// wedge under "Alex" to save AS Alex, under "John" to save AS John — so
// the stack itself is how admin edits, no separate identity switch at all.
// Admin has no "own" row at all now (activeLabeler() always returns null
// for admin), so the single dial/Progress/Distribution cards (#angle-card/
// #progress-card/#dist-card) are hidden outright rather than locked —
// there's nothing for them to show. #act-card (prev/next) stays live
// immediately so admin can page through frames while the stack loads.
//
// Deliberately NOT ported from height_guard's admin mode: manual re-push
// (nothing here holds a teammate's DRAFT row to re-send — every save,
// admin's or not, lands immediately); presence ping/banner (no live
// collision risk — admin edits one identity at a time, never simultaneous
// with the real labeler); adjustable agreement thresholds and the 3-metric
// disagreement grids (this tool's agreement is one exact bucket match, no
// continuous distance to threshold or split by axis); PNG export (real
// complexity for a "keep it primitive" ask). "Everyone's progress" stays
// open to every labeler, admin included — no admin-only duplicate needed.
async function start() {
  if (!who()) return;
  state.isAdmin = who().toLowerCase() === 'admin';
  document.body.classList.toggle('admin', state.isAdmin);
  document.body.classList.remove('ready');
  state.ready = false;
  state.starting = true;
  $('lock').classList.remove('err');

  if (state.isAdmin) {
    state.starting = false;
    state.ready = true;                // stage pan/zoom/line-drag all gate on this — see the mousedown wiring
    state.labels = new Map();          // admin never has an "own" row
    document.body.classList.add('ready');   // frame nav usable right away
    showFrame();
    startRosterPoll();
    await refreshTotalDist();          // must resolve before the stack knows who's on the roster
    await loadAllAdminData();
    refreshAgreement();                // agree-card is admin-only — see its own isAdmin guard
    return;
  }

  $('lock').textContent = 'Loading your labels…';
  try {
    const rows = await fetchRows(activeLabeler());
    state.labels = new Map();
    for (const r of rows) {
      const k = rowKey(r);
      if (!state.index.has(k)) continue;
      state.labels.set(k, rowToLabel(r));
    }
  } catch (e) {
    state.starting = false;
    $('lock').textContent = e.message;
    $('lock').classList.add('err');
    return;
  }
  state.starting = false;
  state.ready = true;
  document.body.classList.add('ready');
  renderProgress();
  const first = state.frames.findIndex((f) => !state.labels.has(key(f)));
  state.i = first === -1 ? state.frames.length - 1 : first;
  showFrame();
  status(`Loaded ${state.labels.size} of your label(s).`, 'ok');

  refreshTotalDist();
  startRosterPoll();
  if (state.teamOpen) prefetchRanges();
}

// ── admin: the per-person stack ──────────────────────────────────────────
// One listFacingAngle per roster member — the only fan-out cost admin mode
// pays, and it's paid once per login/refresh, not per frame navigated.
async function loadAllAdminData() {
  if (!state.isAdmin) return;
  const container = $('admin-stack');
  container.innerHTML = '<div id="admin-stack-status">Loading everyone&rsquo;s labels&hellip;</div>';
  try {
    const names = state.roster.map((r) => r.labeler);
    const results = await Promise.all(names.map((n) => fetchRows(n).catch(() => [])));
    const teamRows = new Map();
    names.forEach((n, i) => {
      const m = new Map();
      for (const r of results[i]) m.set(rowKey(r), rowToLabel(r));
      teamRows.set(n, m);
    });
    state.teamRows = teamRows;
    buildAdminStack();
  } catch (e) {
    container.innerHTML = `<div id="admin-stack-status">Couldn&rsquo;t load: ${e.message}</div>`;
  }
}

// Builds one block per roster member (in state.roster's existing order —
// already sorted by activity, most labels first, from statsFacingAngle)
// into #admin-stack, each with its own Progress grid, Distribution rows,
// and an independently-clickable dial — all built fresh from scratch, so
// call this again (via the Refresh button) if the roster changes mid-
// session rather than trying to diff it in place.
function buildAdminStack() {
  const container = $('admin-stack');
  container.replaceChildren();
  $('admin-lines-svg').replaceChildren();
  for (const el of $('marks').querySelectorAll('.admin-hp')) el.remove();
  state.adminBlocks = [];
  state.adminLineEls = new Map();
  state.roster.forEach((r, i) => {
    const color = ADMIN_LINE_COLORS[i % ADMIN_LINE_COLORS.length];
    const block = { name: r.labeler, color };
    state.adminLineEls.set(r.labeler, buildAdminLineElsFor(color));
    const wrap = document.createElement('div');
    wrap.className = 'admin-person';
    const heading = document.createElement('p');
    heading.className = 'admin-person-name';
    const swatch = document.createElement('span');
    swatch.className = 'admin-color-swatch';
    swatch.style.background = color;
    heading.append(swatch, document.createTextNode(r.labeler));
    wrap.appendChild(heading);

    const progCard = document.createElement('div');
    progCard.className = 'card admin-mini';
    const progEyebrow = document.createElement('p');
    progEyebrow.className = 'card-eyebrow'; progEyebrow.textContent = 'Progress';
    block.barTextEl = document.createElement('div');
    block.barTextEl.className = 'bar-text-mini';
    const ovw = document.createElement('div'); ovw.className = 'ovw';
    const ovn = document.createElement('div'); ovn.className = 'ovn';
    const ov = document.createElement('div'); ov.className = 'd4-grid';
    ovw.append(ovn, ov);
    progCard.append(progEyebrow, block.barTextEl, ovw);
    wrap.appendChild(progCard);
    const built = buildAdminOverviewInto(ov, ovn);
    block.ovDots = built.dots; block.ovGutter = built.gutter;

    const distCard = document.createElement('div');
    distCard.className = 'card admin-mini';
    const distEyebrow = document.createElement('p');
    distEyebrow.className = 'card-eyebrow'; distEyebrow.textContent = 'Distribution';
    const distEl = document.createElement('div');
    distCard.append(distEyebrow, distEl);
    wrap.appendChild(distCard);
    block.distRows = buildAdminDistInto(distEl);

    const dialCard = document.createElement('div');
    dialCard.className = 'card admin-mini';
    const dialEyebrow = document.createElement('p');
    dialEyebrow.className = 'card-eyebrow'; dialEyebrow.textContent = 'Boxer facing angle · vs. camera';
    const dialWrap = document.createElement('div'); dialWrap.className = 'dial-wrap admin-dial-wrap';
    const svg = svgEl('svg', {
      viewBox: '0 0 260 260', class: 'dial admin-dial', role: 'group',
      'aria-label': `${r.labeler}'s facing angle bucket`,
    });
    dialWrap.appendChild(svg);
    block.dialReadEl = document.createElement('p');
    block.dialReadEl.className = 'dial-read-mini';
    block.lineReadEl = document.createElement('p');
    block.lineReadEl.className = 'line-read-mini';
    dialCard.append(dialEyebrow, dialWrap, block.dialReadEl, block.lineReadEl);
    wrap.appendChild(dialCard);
    buildDialInto(svg, (store, isSkip) => applyAdminLabel(block, store, isSkip), false);
    block.dialSvg = svg;

    container.appendChild(wrap);
    state.adminBlocks.push(block);
  });
  renderAllAdminBlocks();
  renderAdminLines();
}

function renderAllAdminBlocks() {
  for (const block of state.adminBlocks) renderAdminBlock(block);
}

// ── admin: every labeler's line, shown together on the shared stage ─────
// Each labeler who's drawn a line for the CURRENT frame gets their own
// solid segment + dashed continuation + base/end dots, color-coded by
// state.adminLineEls (built once in buildAdminStack(), just
// repositioned/shown-hidden per frame here) — same rayExit()/rendering
// shape as the single-identity renderLine(), just N of them at once
// instead of one.
function buildAdminLineElsFor(color) {
  const ext = svgEl('line', { class: 'admin-line-ext', stroke: color });
  const seg = svgEl('line', { class: 'admin-line-seg', stroke: color });
  $('admin-lines-svg').append(ext, seg);
  const baseEl = document.createElement('div');
  baseEl.className = 'hp admin-hp base';
  baseEl.style.background = color;
  const endEl = document.createElement('div');
  endEl.className = 'hp admin-hp end';
  endEl.style.background = color;
  $('marks').append(baseEl, endEl);
  return { seg, ext, baseEl, endEl, color };
}

function renderAdminLines() {
  if (!state.isAdmin) return;
  const f = state.frames[state.i];
  for (const block of state.adminBlocks) {
    const els = state.adminLineEls.get(block.name);
    if (!els) continue;
    const labelsMap = state.teamRows.get(block.name);
    const row = f && labelsMap ? labelsMap.get(key(f)) : null;
    if (row && row.base && row.end) {
      els.baseEl.classList.add('set');
      els.endEl.classList.add('set');
      els.baseEl.style.left = (row.base[0] * 100) + '%';
      els.baseEl.style.top = (row.base[1] * 100) + '%';
      els.endEl.style.left = (row.end[0] * 100) + '%';
      els.endEl.style.top = (row.end[1] * 100) + '%';
      els.seg.setAttribute('x1', row.base[0]); els.seg.setAttribute('y1', row.base[1]);
      els.seg.setAttribute('x2', row.end[0]); els.seg.setAttribute('y2', row.end[1]);
      const exit = rayExit(row.base, row.end);
      els.ext.setAttribute('x1', row.end[0]); els.ext.setAttribute('y1', row.end[1]);
      els.ext.setAttribute('x2', exit[0]); els.ext.setAttribute('y2', exit[1]);
      els.seg.style.display = '';
      els.ext.style.display = '';
    } else {
      els.baseEl.classList.remove('set');
      els.endEl.classList.remove('set');
      els.seg.style.display = 'none';
      els.ext.style.display = 'none';
    }
  }
}

// Proximity-checks EVERY labeler's currently-shown line dots (screen-space,
// so it means the same thing at any zoom — same GRAB_PX as the single-
// identity grabHandle()) and returns whichever one the mousedown landed on.
function grabAdminHandle(clientX, clientY) {
  const f = state.frames[state.i];
  if (!f) return null;
  const k = key(f);
  for (const [name, els] of state.adminLineEls) {
    if (!els.baseEl.classList.contains('set')) continue;
    const labelsMap = state.teamRows.get(name);
    const row = labelsMap && labelsMap.get(k);
    if (!row || !row.base || !row.end) continue;
    const pb = screenPxOf(row.base), pe = screenPxOf(row.end);
    if (Math.hypot(clientX - pb[0], clientY - pb[1]) <= GRAB_PX) return { name, mode: 'base' };
    if (Math.hypot(clientX - pe[0], clientY - pe[1]) <= GRAB_PX) return { name, mode: 'end' };
  }
  return null;
}

function startAdminDrag(clientX, clientY) {
  const grab = grabAdminHandle(clientX, clientY);
  if (!grab) return false;
  const row = state.teamRows.get(grab.name).get(key(state.frames[state.i]));
  state.adminDrag = { name: grab.name, mode: grab.mode, orig: { base: row.base.slice(), end: row.end.slice() } };
  return true;
}

// Same independent-point behavior as the individual flow's moveDraw() —
// dragging one point never moves the other.
function moveAdminDrag(clientX, clientY) {
  const d = state.adminDrag;
  if (!d) return;
  const p = stageNorm(clientX, clientY);
  const els = state.adminLineEls.get(d.name);
  const base = d.mode === 'base' ? p : d.orig.base;
  const end = d.mode === 'end' ? p : d.orig.end;
  els.baseEl.style.left = (base[0] * 100) + '%'; els.baseEl.style.top = (base[1] * 100) + '%';
  els.endEl.style.left = (end[0] * 100) + '%'; els.endEl.style.top = (end[1] * 100) + '%';
  els.seg.setAttribute('x1', base[0]); els.seg.setAttribute('y1', base[1]);
  els.seg.setAttribute('x2', end[0]); els.seg.setAttribute('y2', end[1]);
  const exit = rayExit(base, end);
  els.ext.setAttribute('x1', end[0]); els.ext.setAttribute('y1', end[1]);
  els.ext.setAttribute('x2', exit[0]); els.ext.setAttribute('y2', exit[1]);

  // Live clue on THIS person's own dial only, while dragging — not a
  // global suggestion, and never another labeler's: paintAdminDial reads
  // whatever angle is passed in and paints only the one <svg> it's given.
  const block = state.adminBlocks.find((b) => b.name === d.name);
  if (block) {
    const row = state.teamRows.get(d.name).get(key(state.frames[state.i]));
    const angle = angleOf({ base, end });
    paintAdminDial(block.dialSvg, block.dialReadEl, block.lineReadEl, row ? row.bucket : null, angle);
  }
}

// Unlike the individual flow (a line-drag only rides along on the NEXT
// bucket click), an admin edit saves immediately on release — the bucket
// isn't changing, there's no "next click" to piggyback on, and the whole
// point of admin dragging someone else's line is to fix it right now.
function finishAdminDrag(clientX, clientY) {
  const d = state.adminDrag;
  state.adminDrag = null;
  if (!d) return;
  const f = state.frames[state.i];
  const k = key(f);
  const labelsMap = state.teamRows.get(d.name);
  const prevRow = labelsMap.get(k);
  const p = stageNorm(clientX, clientY);
  let base = d.mode === 'base' ? p : d.orig.base;
  let end = d.mode === 'end' ? p : d.orig.end;
  // A near-zero-length result (dragged one handle onto the other) would
  // make the angle undefined — same guard the individual flow uses.
  if (Math.hypot(end[0] - base[0], end[1] - base[1]) < 0.002) {
    base = d.orig.base; end = d.orig.end;
  }
  labelsMap.set(k, Object.assign({}, prevRow, { base, end }));
  renderAdminLines();
  status(`Saving ${d.name}’s line…`);

  call({
    action: 'saveFacingAngle', labeler: d.name, video: f.stem,
    round: String(f.round), frame: String(f.frame), pts_sec: String(f.pts),
    stance: f.stance || '',
    bucket: String(prevRow.bucket),
    base_x: String(base[0]), base_y: String(base[1]),
    end_x: String(end[0]), end_y: String(end[1]),
  }, 'save').then(() => {
    status(`Saved ${d.name}’s line.`, 'ok');
  }).catch((e) => {
    labelsMap.set(k, prevRow);
    renderAdminLines();
    status(`Save failed for ${d.name}: ` + e.message, 'err');
  });
}

function renderAdminBlock(block) {
  const f = state.frames[state.i];
  const labelsMap = state.teamRows.get(block.name) || new Map();
  const row = f ? labelsMap.get(key(f)) : null;
  const lineAngle = row && row.base && row.end ? angleOf(row) : null;
  paintAdminDial(block.dialSvg, block.dialReadEl, block.lineReadEl, row ? row.bucket : null, lineAngle);
  renderAdminOverview(block.ovDots, block.ovGutter, block.barTextEl, labelsMap);
  renderAdminDist(block.distRows, labelsMap);
}

// Optimistic, same shape as applyLabel() but scoped to ONE person's map
// (state.teamRows.get(block.name)) instead of state.labels, no line (admin
// isn't drawing an assistive line on someone else's behalf), and no
// auto-advance to the next frame — admin may want to fix several people on
// THIS frame before moving on.
function applyAdminLabel(block, store, isSkip) {
  const f = state.frames[state.i];
  if (!f) return;
  const k = key(f);
  let labelsMap = state.teamRows.get(block.name);
  if (!labelsMap) { labelsMap = new Map(); state.teamRows.set(block.name, labelsMap); }
  const prev = labelsMap.get(k);
  // A bucket click never touches this person's own line — admin isn't
  // drawing one for them here (see applyAdminLabel's callers vs.
  // finishAdminDrag(), which is what actually edits a line) — so whatever
  // they already had carries over unchanged, same as a skip clearing it
  // in the individual flow.
  const base = isSkip ? null : (prev ? prev.base : null);
  const end = isSkip ? null : (prev ? prev.end : null);
  labelsMap.set(k, { bucket: isSkip ? SKIP_BUCKET : store, base, end });
  renderAdminBlock(block);
  status(`Saving ${block.name}’s ${isSkip ? 'skip' : signed(store)}…`);

  call({
    action: 'saveFacingAngle', labeler: block.name, video: f.stem,
    round: String(f.round), frame: String(f.frame), pts_sec: String(f.pts),
    stance: f.stance || '',
    bucket: isSkip ? SKIP_BUCKET : String(store),
    base_x: base ? String(base[0]) : '', base_y: base ? String(base[1]) : '',
    end_x: end ? String(end[0]) : '', end_y: end ? String(end[1]) : '',
  }, 'save').then(() => {
    status(`Saved ${block.name}.`, 'ok');
    scheduleTeamRefresh();
  }).catch((e) => {
    if (prev) labelsMap.set(k, prev); else labelsMap.delete(k);
    renderAdminBlock(block);
    status(`Save failed for ${block.name}: ` + e.message, 'err');
  });
}

// ── admin: per-person Progress grid (parametrized buildOverview/renderOverview) ──
function buildAdminOverviewInto(gridEl, gutterEl) {
  const frag = document.createDocumentFragment();
  const dots = [];
  for (let i = 0; i < state.frames.length; i++) {
    const d = document.createElement('div');
    d.className = 'd4';
    if (i >= BATCH && i % BATCH < BATCH_COLS) d.dataset.batch = '1';
    frag.appendChild(d);
    dots.push(d);
  }
  gridEl.appendChild(frag);
  gridEl.onclick = (e) => {
    const at = dots.indexOf(e.target);
    if (at >= 0) go(at);
  };

  const col = document.createDocumentFragment();
  const gutter = [];
  for (let b = 0; b * BATCH < state.frames.length; b++) {
    const count = Math.min(BATCH, state.frames.length - b * BATCH);
    const rows = Math.ceil(count / BATCH_COLS);
    const n = document.createElement('b');
    const num = document.createElement('span'); num.textContent = b + 1;
    const g = document.createElement('span'); g.className = 'ovn-g';
    const s = document.createElement('span'); s.className = 'ovn-s';
    n.append(num, g, s);
    n.style.height = `${rows * 9 + (rows - 1) * 3}px`;
    n.style.lineHeight = '9px';
    if (b) n.style.marginTop = '10px';
    col.appendChild(n);
    gutter.push({ g, s, start: b * BATCH, end: b * BATCH + count, node: n });
  }
  gutterEl.replaceChildren(col);
  return { dots, gutter };
}

// No per-dot title tooltips here (unlike renderOverview()) — with a whole
// roster's worth of grids on screen at once the per-dot string-building
// cost multiplies by roster size for a hover detail this view doesn't
// really need; the colour alone is enough at a glance.
function renderAdminOverview(dots, gutter, barTextEl, labelsMap) {
  const N = state.frames.length;
  let done = 0;
  for (let i = 0; i < N; i++) {
    const row = labelsMap.get(key(state.frames[i]));
    let cls = 'd4';
    if (row && row.bucket === SKIP_BUCKET) cls += ' sk';
    else if (row && row.bucket !== null) cls += ' dn';
    if (i === state.i) cls += ' cur';
    if (row) done++;
    if (dots[i].className !== cls) dots[i].className = cls;
  }
  barTextEl.textContent = `${done.toLocaleString()} / ${N.toLocaleString()} labelled`;
  for (const gu of gutter) {
    let g = 0, s = 0;
    for (let i = gu.start; i < gu.end; i++) {
      const row = labelsMap.get(key(state.frames[i]));
      if (!row) continue;
      if (row.bucket === SKIP_BUCKET) s++; else if (row.bucket !== null) g++;
    }
    gu.g.textContent = g || '';
    gu.s.textContent = s || '';
    gu.node.title = `frames ${gu.start + 1}–${gu.end} — ${g} labelled, ${s} skipped`;
  }
}

// ── admin: per-person Distribution (parametrized buildDist/renderDist) ───
function buildAdminDistInto(distEl) {
  const rows = BINS.map((b) => ({ k: String(b.c), label: signed(b.c) }))
    .concat([{ k: 'skip', label: 'skip', skip: true }]);
  const distRows = new Map();
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'dist-row' + (r.skip ? ' skip' : '');
    const label = document.createElement('span'); label.className = 'dist-label'; label.textContent = r.label;
    const track = document.createElement('div'); track.className = 'dist-track';
    const you = document.createElement('div'); you.className = 'dist-bar you';
    const all = document.createElement('div'); all.className = 'dist-bar all';
    track.append(you, all);
    const val = document.createElement('span'); val.className = 'dist-val';
    const youVal = document.createElement('b');
    const slash = document.createElement('span'); slash.className = 'dist-slash'; slash.textContent = '/';
    const allVal = document.createElement('span');
    val.append(youVal, slash, allVal);
    row.append(label, track, val);
    frag.appendChild(row);
    distRows.set(r.k, { you, all, youVal, allVal });
  }
  distEl.replaceChildren(frag);
  return distRows;
}

function renderAdminDist(distRows, labelsMap) {
  const mine = bucketCounts(labelsMap.values());
  const total = state.totalCounts || {};
  const mineTotal = Object.values(mine).reduce((a, n) => a + n, 0);
  const totalTotal = Object.values(total).reduce((a, n) => a + n, 0);
  for (const [k, els] of distRows) {
    const you = mine[k] || 0;
    const all = total[k] || 0;
    const youPct = mineTotal ? 100 * you / mineTotal : 0;
    const allPct = totalTotal ? 100 * all / totalTotal : 0;
    els.you.style.width = youPct.toFixed(1) + '%';
    els.all.style.width = allPct.toFixed(1) + '%';
    els.youVal.textContent = mineTotal ? Math.round(youPct) + '%' : '—';
    els.youVal.classList.toggle('has', you > 0);
    els.allVal.textContent = totalTotal ? Math.round(allPct) + '%' : '—';
  }
}

// ── admin: per-person dial paint ─────────────────────────────────────────
// Mirrors renderDial()'s two-signal shape exactly, scoped to ONE person:
// `.on` for their committed pick, `.suggested` for wherever THEIR OWN
// saved line's angle points (never another labeler's, never admin's own
// scratch line — see moveAdminDrag()/finishAdminDrag(), which only ever
// pass the angle of the line belonging to `svg`'s own labeler). lineAngle
// is null whenever this person has no line at all.
function paintAdminDial(svg, dialReadEl, lineReadEl, picked, lineAngle) {
  const suggested = lineAngle === null ? null : String(angleBucket(lineAngle));
  for (const el of svg.querySelectorAll('.wedge, .wlabel, .wkey')) {
    el.classList.toggle('on', picked !== null && picked !== SKIP_BUCKET && el.dataset.store === picked);
    el.classList.toggle('suggested', suggested !== null && el.dataset.store === suggested);
  }
  for (const el of svg.querySelectorAll('.skipw, .skipt, .skipk')) {
    el.classList.toggle('on', picked === SKIP_BUCKET);
  }
  if (picked === null || picked === undefined) dialReadEl.innerHTML = '&mdash;';
  else if (picked === SKIP_BUCKET) dialReadEl.innerHTML = '<b>Skipped</b>';
  else dialReadEl.innerHTML = `<b>${signed(picked)}</b>`;

  lineReadEl.innerHTML = lineAngle === null ? ''
    : `Line: <b>${signed(lineAngle)}</b> &middot; nearest ${signed(angleBucket(lineAngle))}`;
}

// ── team data ──────────────────────────────────────────────────────────────
function startRosterPoll() {
  if (state.rosterPoll) return;
  state.rosterPoll = setInterval(refreshTotalDist, TEAM_POLL_MS);
}

function scheduleTeamRefresh() {
  clearTimeout(state.teamTimer);
  state.teamTimer = setTimeout(async () => {
    await refreshTotalDist();
    prefetchRanges();
    await refreshAgreement();
  }, 4000);
}

function bumpMyTeamRow() {
  const me = activeLabeler();
  if (!me) return;
  let mine = state.roster.find((r) => r.labeler.toLowerCase() === me.toLowerCase());
  if (!mine) { mine = { labeler: me, n: 0, skipped: 0, last_ts: '', last: null }; state.roster.push(mine); }
  mine.n = state.labels.size;
  mine.skipped = [...state.labels.values()].filter((v) => v.bucket === SKIP_BUCKET).length;
  mine.last_ts = new Date().toISOString();
  const f = state.frames[state.i];
  if (f) mine.last = { video: f.stem, round: f.round, frame: f.frame };
  state.roster.sort((a, b) => b.n - a.n);
  state.rangeCache.set(me, { n: mine.n, ranges: frameRuns(myIndices()), at: Date.now() });
  renderTeamPanel();
}

function myIndices() {
  const out = [];
  for (const k of state.labels.keys()) {
    const i = state.index.get(k);
    if (i !== undefined) out.push(i);
  }
  return out;
}

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function loadHidden() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDE_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map((s) => String(s).toLowerCase()) : []);
  } catch (e) { return new Set(); }
}
function saveHidden() {
  try { localStorage.setItem(HIDE_KEY, JSON.stringify([...state.hidden])); } catch (e) {}
}
function setNameHidden(name, hidden) {
  const k = String(name).toLowerCase();
  if (hidden) state.hidden.add(k); else state.hidden.delete(k);
  saveHidden();
  renderTeamPanel();
}

function frameRuns(indices) {
  const s = [...indices].sort((a, b) => a - b);
  const out = [];
  let start = null, prev = null;
  for (const i of s) {
    if (start === null) { start = prev = i; continue; }
    if (i === prev) continue;
    if (i === prev + 1) { prev = i; continue; }
    out.push([start, prev]);
    start = prev = i;
  }
  if (start !== null) out.push([start, prev]);
  return out;
}

function fmtRanges(runs) { return runs.map(([a, b]) => `[${a + 1}, ${b + 1}]`).join('  ·  '); }

function loadRangeCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(RANGE_KEY) || 'null');
    if (!raw || !state.frames.length || raw.q !== state.frames.length) return new Map();
    return new Map(Object.entries(raw.by || {}));
  } catch (e) { return new Map(); }
}
function saveRangeCache() {
  try {
    const by = {};
    for (const [k, v] of state.rangeCache) if (!v.error) by[k] = v;
    localStorage.setItem(RANGE_KEY, JSON.stringify({ q: state.frames.length, by }));
  } catch (e) {}
}

function prefetchRanges(force) {
  if ((!state.teamOpen && !force) || !state.frames.length) return;
  const me = (activeLabeler() || '').toLowerCase();
  for (const r of state.roster) {
    const k = r.labeler.toLowerCase();
    if (k !== me && state.hidden.has(k)) continue;
    if (state.rangeCache.has(r.labeler)) continue;
    loadRanges(r.labeler, r.n).then(() => renderTeamPanel());
  }
}

async function loadRanges(labeler, n) {
  const inflight = state.rangePending.get(labeler);
  if (inflight) return inflight;
  const p = fetchRanges(labeler, n).finally(() => state.rangePending.delete(labeler));
  state.rangePending.set(labeler, p);
  return p;
}

async function fetchRanges(labeler, n) {
  let rows;
  try {
    if (labeler.toLowerCase() === (activeLabeler() || '').toLowerCase()) {
      state.rangeCache.set(labeler, { n, ranges: frameRuns(myIndices()), at: Date.now() });
      saveRangeCache();
      return;
    }
    rows = await fetchRows(labeler);
  } catch (e) {
    const had = state.rangeCache.get(labeler);
    state.rangeCache.set(labeler, had
      ? Object.assign({}, had, { at: Date.now() })
      : { n, ranges: [], at: Date.now(), error: e.message });
    return;
  }
  const idx = [];
  for (const r of rows) {
    const i = state.index.get(rowKey(r));
    if (i !== undefined) idx.push(i);
  }
  state.rangeCache.set(labeler, { n, ranges: frameRuns(idx), at: Date.now() });
  saveRangeCache();
}

function setTeamOpen(open) {
  state.teamOpen = !!open;
  $('team').classList.toggle('on', state.teamOpen);
  $('team-btn').setAttribute('aria-expanded', String(state.teamOpen));
  if (state.teamOpen) { renderTeamPanel(); prefetchRanges(); }
  else renderTeamLabel();
}

function renderTeamLabel() {
  const n = state.roster.length;
  $('team-label').textContent = state.teamOpen
    ? 'Hide progress'
    : (n ? `Everyone’s progress (${n})` : 'Everyone’s progress');
}

function renderTeamPanel() {
  renderTeamLabel();
  const el = $('team');
  const rows = state.roster;
  if (!rows || !rows.length) {
    el.innerHTML = '<div id="team-empty">No labels saved yet</div>';
    return;
  }
  const me = (activeLabeler() || '').toLowerCase();
  const n = state.frames.length;

  const isMe = (r) => r.labeler.toLowerCase() === me;
  const shown = rows.filter((r) => isMe(r) || !state.hidden.has(r.labeler.toLowerCase()));
  const hiddenNow = rows.length - shown.length;

  const cells = [];
  const add = (cls, html) => {
    const s = document.createElement('span');
    s.className = cls;
    s.innerHTML = html;
    cells.push(s);
    return s;
  };

  shown.forEach((r) => {
    const mine = isMe(r);
    const m = mine ? ' who-me' : '';
    const pct = n ? (r.n / n) * 100 : 0;

    const name = add('who-n' + m, '');
    const open = state.openRanges.has(r.labeler);
    if (open) name.classList.add('open');
    const text = document.createElement('button');
    text.className = 'who-t';
    text.textContent = r.labeler;
    text.title = 'Show which frames ' + r.labeler + ' has done';
    text.setAttribute('aria-expanded', String(open));
    text.onclick = () => {
      if (state.openRanges.has(r.labeler)) state.openRanges.delete(r.labeler);
      else state.openRanges.add(r.labeler);
      renderTeamPanel();
    };
    const chev = document.createElement('i');
    chev.className = 'who-chev';
    chev.innerHTML = CHEV_SVG;
    name.append(text, chev);
    if (!mine) {
      const eye = document.createElement('button');
      eye.className = 'who-eye';
      eye.innerHTML = EYE_SVG;
      eye.title = `Hide ${r.labeler} from this list`;
      eye.setAttribute('aria-label', eye.title);
      eye.onclick = (e) => { e.stopPropagation(); setNameHidden(r.labeler, true); };
      name.appendChild(eye);
    }
    add('who-c' + m, `${r.n.toLocaleString()}<s> / ${n.toLocaleString()}</s>`);

    const bar = add('who-bar' + m, '');
    const runs = state.rangeCache.get(r.labeler);
    if (runs && !runs.error && runs.ranges.length && n) {
      for (const [from, to] of runs.ranges.slice(0, 400)) {
        const seg = document.createElement('i');
        seg.style.left = `${(from / n) * 100}%`;
        seg.style.width = `${((to - from + 1) / n) * 100}%`;
        bar.appendChild(seg);
      }
    } else if (r.n) {
      bar.classList.add('approx');
      const fill = document.createElement('i');
      fill.style.left = '0';
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
    }

    const at = r.last
      ? state.index.get(JSON.stringify([r.last.video, Number(r.last.round), Number(r.last.frame)]))
      : undefined;
    const detail = [`${r.n.toLocaleString()} of ${n.toLocaleString()} (${pct.toFixed(1)}%)`];
    if (r.skipped) detail.push(`${r.skipped} skipped`);
    if (at !== undefined) detail.push(`at #${at + 1}`);
    if (r.last_ts) detail.push(ago(r.last_ts));
    const tip = detail.join(' · ');
    bar.title = tip + (bar.classList.contains('approx')
      ? ' · bar shows the amount; the positions are still loading'
      : ' · the bar shows where in the queue');
    cells[cells.length - 2].title = tip;

    if (open) {
      const box = add('who-ranges' + m, '');
      const got = state.rangeCache.get(r.labeler);
      box.textContent = !got ? 'Loading…'
        : got.error ? got.error
        : got.ranges.length ? fmtRanges(got.ranges)
        : 'nothing in the current queue';
      const due = !got || (got.n !== r.n && Date.now() - (got.at || 0) > RANGE_FRESH_MS);
      if (due) loadRanges(r.labeler, r.n).then(() => renderTeamPanel());
    }
  });

  if (hiddenNow) {
    const foot = document.createElement('div');
    foot.className = 'who-hidden';
    const lbl = document.createElement('span');
    lbl.textContent = `${hiddenNow} hidden`;
    const all = document.createElement('button');
    all.className = 'who-show-all';
    all.textContent = 'Show all';
    all.onclick = () => { state.hidden.clear(); saveHidden(); renderTeamPanel(); };
    foot.append(lbl, all);
    cells.push(foot);
  }

  el.replaceChildren(...cells);
}

// ── agreement card ───────────────────────────────────────────────────────
// Two named labelers, picked from the roster, fetched on demand — not
// chin_tuck's admin-only loadTeamRows() fan-out. Agreement compares the
// STORED bucket directly (the actual label), not anything derived from a
// line — a labeler who never draws one is compared exactly the same way
// as one who always does.
// Same default pair chin_tuck_4.0 uses on a device that's never picked one
// — a sensible starting comparison, not a fixed one: picking a different
// pair below persists it here for next time, same as chin_tuck's own.
function loadAgreePair() {
  try {
    const raw = JSON.parse(localStorage.getItem(AGREE_KEY) || 'null');
    if (Array.isArray(raw) && raw.length === 2) return raw;
  } catch (e) {}
  return ['Arianne', 'John'];
}
function saveAgreePair() {
  try { localStorage.setItem(AGREE_KEY, JSON.stringify(state.agreePair)); } catch (e) {}
}

function populateAgreeSelects() {
  for (const [idx, id] of [[0, 'agree-a'], [1, 'agree-b']]) {
    const sel = $(id);
    const cur = state.agreePair[idx];
    sel.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = ''; placeholder.textContent = '— pick —';
    sel.appendChild(placeholder);
    for (const r of state.roster) {
      const opt = document.createElement('option');
      opt.value = r.labeler; opt.textContent = r.labeler;
      sel.appendChild(opt);
    }
    sel.value = cur && state.roster.some((r) => r.labeler === cur) ? cur : '';
  }
}

async function setAgreePair(idx, name) {
  state.agreePair[idx] = name;
  saveAgreePair();
  await refreshAgreement();
}

async function refreshAgreement() {
  if (!state.isAdmin) return;    // admin-only card — see #agree-card's CSS gate
  const [a, b] = state.agreePair;
  if (!a || !b) {
    state.agreeRows = [null, null];
    renderAgreement();
    return;
  }
  // A full listFacingAngle fetch for TWO people (one can have thousands of
  // rows) is slow enough that the grid would otherwise sit showing the
  // PREVIOUS pair's agree/disagree colors — a stale answer, not a loading
  // one — for a couple of seconds after picking a new pair. Clear every
  // dot back to neutral and say so immediately instead of waiting for the
  // fetch to resolve.
  $('agree-summary').textContent = 'Loading…';
  if (state.agreeDots) for (const d of state.agreeDots) d.className = 'd4';
  $('agree-grid').classList.add('loading');
  try {
    const [rowsA, rowsB] = await Promise.all([fetchRows(a), fetchRows(b)]);
    state.agreeRows = [
      new Map(rowsA.map((r) => [rowKey(r), rowToLabel(r)])),
      new Map(rowsB.map((r) => [rowKey(r), rowToLabel(r)])),
    ];
  } catch (e) {
    $('agree-grid').classList.remove('loading');
    $('agree-summary').textContent = "Couldn't load: " + e.message;
    return;
  }
  $('agree-grid').classList.remove('loading');
  renderAgreement();
}

// Four states only, by design. A SKIP is a valid answer here, same as any
// bucket — "can't tell" is a real judgment call, not a non-answer — so two
// skips on the same frame agree (both green), a skip against a bucket
// disagrees (they gave two different valid answers), and only a frame
// NEITHER labeler has touched at all counts as "neither answered".
// SKIP_BUCKET for a can't-tell row, the bucket string for a real pick,
// null for not yet answered at all. A plain top-level function, not a
// closure rebuilt inside agreeForSlot() on every one of its ~3,000 calls
// per renderAgreement() pass — see that function's own comment.
function agreeAnswerOf(r) {
  return !r || r.bucket === null || r.bucket === undefined ? null : r.bucket;
}

// Returns a plain string ('agree'/'disagree'/'solo'/'none'), not an
// object — this runs once per frame inside renderAgreement()'s full-grid
// loop (~3,000 calls per pass), so an allocation-free return here plus
// answerOf() being a shared top-level function instead of a per-call
// closure. Rebuilt is what let this go from "recomputes 3,000 frames on
// every navigation" (when renderAgreement() itself used to be called on
// every showFrame()) down to something worth calling occasionally.
function agreeForSlot(f) {
  const k = key(f);
  const ra = state.agreeRows[0] && state.agreeRows[0].get(k);
  const rb = state.agreeRows[1] && state.agreeRows[1].get(k);
  const aAns = agreeAnswerOf(ra), bAns = agreeAnswerOf(rb);
  if (aAns !== null && bAns !== null) return aAns === bAns ? 'agree' : 'disagree';
  if (aAns !== null || bAns !== null) return 'solo';
  return 'none';
}

function buildAgreeGrid() {
  const grid = $('agree-grid');
  grid.textContent = '';
  const frag = document.createDocumentFragment();
  state.agreeDots = [];
  for (let i = 0; i < state.frames.length; i++) {
    const d = document.createElement('div');
    d.className = 'd4';
    if (i >= BATCH && i % BATCH < BATCH_COLS) d.dataset.batch = '1';
    frag.appendChild(d);
    state.agreeDots.push(d);
  }
  grid.appendChild(frag);
  grid.onclick = (e) => {
    const at = state.agreeDots.indexOf(e.target);
    if (at >= 0) go(at);
  };
  const gutter = document.querySelector('#agree-card .ovn');
  const col = document.createDocumentFragment();
  state.agreeGutter = [];
  for (let b = 0; b * BATCH < state.frames.length; b++) {
    const count = Math.min(BATCH, state.frames.length - b * BATCH);
    const rows = Math.ceil(count / BATCH_COLS);
    const n = document.createElement('b');
    const num = document.createElement('span');
    num.textContent = b + 1;
    const g = document.createElement('span');
    g.className = 'ovn-g';
    const r = document.createElement('span');
    r.className = 'ovn-r';
    n.append(num, g, r);
    n.style.height = `${rows * 9 + (rows - 1) * 3}px`;
    n.style.lineHeight = '9px';
    if (b) n.style.marginTop = '10px';
    col.appendChild(n);
    state.agreeGutter.push({ g, r, start: b * BATCH, end: b * BATCH + count, node: n });
  }
  gutter.replaceChildren(col);
}

// The expensive full recompute — every frame's agree/disagree/solo color
// AND the summary line. Only actually needs to run when state.agreeRows
// itself changes (a new pair picked, or the post-save debounce), so this
// is called from refreshAgreement()'s success path, never from frame
// navigation — see moveAgreementCur() for what showFrame() calls instead.
function renderAgreement() {
  const [a, b] = state.agreePair;
  const summary = $('agree-summary');
  if (!a || !b) { summary.textContent = 'Pick two labelers to compare.'; }
  if (!state.agreeDots) return;
  let agree = 0, disagree = 0, compared = 0;
  // Per-batch agree/disagree tallies (gutter's .ovn-g/.ovn-r) — accumulated
  // in this SAME pass rather than a second loop over all ~3,000 frames.
  const batchCounts = state.agreeGutter ? state.agreeGutter.map(() => ({ g: 0, r: 0 })) : null;
  for (let i = 0; i < state.frames.length; i++) {
    const kind = agreeForSlot(state.frames[i]);
    let cls = 'd4';
    if (kind === 'agree') { cls += ' agree'; agree++; compared++; }
    else if (kind === 'disagree') { cls += ' disagree'; disagree++; compared++; }
    else if (kind === 'solo') { cls += ' solo'; }
    if (i === state.i) cls += ' cur';
    state.agreeDots[i].className = cls;
    state.agreeDots[i].title = `#${i + 1} — ${kind}`;
    if (batchCounts) {
      const bi = (i / BATCH) | 0;
      if (kind === 'agree') batchCounts[bi].g++;
      else if (kind === 'disagree') batchCounts[bi].r++;
    }
  }
  if (batchCounts) {
    state.agreeGutter.forEach((gu, bi) => {
      const { g, r } = batchCounts[bi];
      gu.g.textContent = g || '';
      gu.r.textContent = r || '';
      gu.node.title = `frames ${gu.start + 1}–${gu.end} — ${g} agree, ${r} disagree`;
    });
  }
  if (a && b) {
    summary.textContent = compared
      ? `${Math.round(100 * agree / compared)}% agree · ${compared.toLocaleString()} of ${state.frames.length.toLocaleString()} compared`
      : 'No frames both have labelled yet.';
  }
}

// The cheap per-navigation update — just moves the .cur outline, since
// the agree/disagree/solo COLORS haven't changed just because the viewed
// frame did. A full renderAgreement() pass here (~3,000 agreeForSlot()
// calls) was the actual cause of the reported "colors lagging behind" —
// it used to run on every single frame click just to move one outline.
function moveAgreementCur() {
  if (!state.agreeDots) return;
  const grid = $('agree-grid');
  const prevCur = grid.querySelector('.d4.cur');
  if (prevCur) prevCur.classList.remove('cur');
  const dot = state.agreeDots[state.i];
  if (dot) dot.classList.add('cur');
}

// Same four states/colors the on-screen CSS paints (#agree-grid .d4.agree
// etc.) — hardcoded here rather than read from computed styles since an
// exported PNG has to look right regardless of the viewer's OS theme, the
// same reason height_guard's own exports fix to the light palette.
function agreeFillColor(kind) {
  if (kind === 'agree') return '#34c759';
  if (kind === 'disagree') return '#ff3b30';
  if (kind === 'solo') return 'rgba(0,113,227,.35)';
  return 'rgba(120,120,128,.22)';
}

// A single-column, single-metric cut of height_guard's own
// exportDisagreementPNG() — that one lays out three metrics side by side
// with per-point chin/shoulder distance stats, because height_guard's
// agreement is a continuous distance on two different points. This tool's
// whole comparison is one exact bucket match, already fully described by
// the same four states the on-screen grid and legend show, so the export
// is just that grid + legend + the same summary line, rendered to a
// downloadable PNG — no metrics to pick between, no distance stats to
// print.
function exportAgreementPNG() {
  if (!state.isAdmin || !state.frames.length) return;
  const [a, b] = state.agreePair;
  if (!a || !b) { status('Pick two labelers to compare first.', 'err'); return; }

  const kinds = state.frames.map((f) => agreeForSlot(f));
  const nBatches = Math.max(1, Math.ceil(state.frames.length / BATCH));
  // Per-batch agree/disagree tallies — same idea as the on-screen gutter's
  // own .ovn-g/.ovn-r, printed into this export too.
  const batchG = new Array(nBatches).fill(0);
  const batchR = new Array(nBatches).fill(0);
  let agree = 0, compared = 0;
  kinds.forEach((kind, i) => {
    if (kind === 'agree' || kind === 'disagree') {
      compared++;
      if (kind === 'agree') { agree++; batchG[(i / BATCH) | 0]++; }
      else batchR[(i / BATCH) | 0]++;
    }
  });

  const DOT = 9, GAP = 3, GUTTER = 30, MARGIN = 16, BATCH_GAP = 12, LINE_H = 10;
  const ROWS = Math.ceil(BATCH / BATCH_COLS);
  const colW = BATCH_COLS * DOT + (BATCH_COLS - 1) * GAP;
  const batchH = ROWS * DOT + (ROWS - 1) * GAP;
  const dotsX = MARGIN + GUTTER;

  const titleY = 24, subY = 44, statY = 64, legendY = 88;
  const gridTop = legendY + 16;
  const W = MARGIN * 2 + GUTTER + colW;
  const H = gridTop + nBatches * batchH + (nBatches - 1) * BATCH_GAP + MARGIN;

  const scale = 2; // crisp on a retina display without the file ballooning
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

  ctx.fillStyle = '#f5f5f7';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#1d1d1f';
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText(`Agreement — ${a} × ${b}`, MARGIN, titleY);

  const stamp = new Date().toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  ctx.font = `400 12px ${FONT}`;
  ctx.fillStyle = '#6e6e73';
  ctx.fillText(`${state.frames.length.toLocaleString()} frames, ${nBatches} batches — exported ${stamp}`,
               MARGIN, subY);

  ctx.font = `600 12px ${FONT}`;
  ctx.fillStyle = '#1d1d1f';
  ctx.fillText(
    compared
      ? `${Math.round(100 * agree / compared)}% agree · ${compared.toLocaleString()} of ${state.frames.length.toLocaleString()} compared`
      : 'No frames both have labelled yet.',
    MARGIN, statY);

  // Same four legend entries as #agree-card's own .legend, same order.
  const legendItems = [
    ['#34c759', 'agree'], ['#ff3b30', 'disagree'],
    ['rgba(0,113,227,.35)', 'one answered'], ['rgba(120,120,128,.22)', 'neither answered'],
  ];
  let lx = MARGIN;
  ctx.font = `400 11px ${FONT}`;
  for (const [color, label] of legendItems) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(lx, legendY - 8, 8, 8, 2);
    ctx.fill();
    lx += 12;
    ctx.fillStyle = '#6e6e73';
    ctx.fillText(label, lx, legendY);
    lx += ctx.measureText(label).width + 14;
  }

  ctx.textBaseline = 'top';
  for (let bi = 0; bi < nBatches; bi++) {
    const rowTop = gridTop + bi * (batchH + BATCH_GAP);
    const start = bi * BATCH, end = Math.min(start + BATCH, state.frames.length);

    ctx.font = `600 9px ${FONT}`;
    ctx.fillStyle = '#1d1d1f';
    ctx.fillText(String(bi + 1), MARGIN, rowTop);

    // This batch's own agree/disagree tally, right-aligned just left of
    // its dot grid — zero entries skipped rather than printed as "0", so
    // the eye is drawn to batches with something to point at.
    ctx.font = `700 9px ${FONT}`;
    ctx.textAlign = 'right';
    let ty = rowTop;
    for (const [val, color] of [[batchG[bi], '#34c759'], [batchR[bi], '#ff3b30']]) {
      if (!val) continue;
      ctx.fillStyle = color;
      ctx.fillText(String(val), dotsX - 3, ty);
      ty += LINE_H;
    }
    ctx.textAlign = 'left';

    for (let i = start; i < end; i++) {
      const local = i - start;
      const col = local % BATCH_COLS, row = (local / BATCH_COLS) | 0;
      const x = dotsX + col * (DOT + GAP), y = rowTop + row * (DOT + GAP);
      ctx.fillStyle = agreeFillColor(kinds[i]);
      ctx.beginPath();
      ctx.roundRect(x, y, DOT, DOT, 2);
      ctx.fill();
    }
  }
  ctx.textBaseline = 'alphabetic';

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const stampFile = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agreement-boxer_facing_angle-${a.toLowerCase()}-${b.toLowerCase()}-${stampFile}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

// ── bug report console ─────────────────────────────────────────────────────
function setBugReportOpen(open) {
  $('bugreport-panel').classList.toggle('on', !!open);
  $('bugreport-btn').setAttribute('aria-expanded', String(!!open));
  if (open) $('bugreport-text').focus();
}

async function sendBugReport() {
  const ta = $('bugreport-text');
  const message = ta.value.trim();
  if (!message) return;
  const btn = $('bugreport-send');
  const note = $('bugreport-note');
  btn.disabled = true;
  note.textContent = '';
  note.className = '';
  const f = state.frames[state.i];
  try {
    const res = await fetch(api({
      action: 'saveBugReport',
      tool: BUG_REPORT_TOOL,
      labeler: who() || '(not signed in)',
      message,
      video: f ? f.stem : '',
      round: f ? String(f.round) : '',
      frame: f ? String(f.frame) : '',
      user_agent: navigator.userAgent,
    }), { redirect: 'follow' });
    const body = await res.json();
    if (body.status !== 'ok') throw new Error(body.message || 'unknown error');
    ta.value = '';
    note.textContent = 'Sent — thanks.';
    note.className = 'ok';
  } catch (e) {
    note.textContent = e.message || 'Could not send — try again.';
    note.className = 'err';
  } finally {
    btn.disabled = !ta.value.trim();
  }
}

// ── copy buttons ───────────────────────────────────────────────────────────
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

function wireCopyButtons() {
  for (const b of document.querySelectorAll('.idc')) {
    b.onclick = async () => {
      const ok = await copyText($(b.dataset.copy).textContent);
      b.classList.toggle('copied', ok);
      b.classList.toggle('failed', !ok);
      if (!ok) status('Could not reach the clipboard — select the text and copy manually.', 'err');
      setTimeout(() => b.classList.remove('copied', 'failed'), 900);
    };
  }
}

// ── wire-up ────────────────────────────────────────────────────────────────
async function loadFrames() {
  const res = await fetch('./boxer_facing_angle_frames.json', { cache: 'no-cache' });
  const body = await res.json();
  return body.frames || [];
}

window.addEventListener('DOMContentLoaded', async () => {
  buildDial();
  wireCopyButtons();

  state.frames = await loadFrames();
  state.frames.forEach((f, i) => state.index.set(key(f), i));
  state.hidden = loadHidden();
  state.rangeCache = loadRangeCache();
  state.agreePair = loadAgreePair();
  buildOverview();
  buildDist();
  buildAgreeGrid();
  renderProgress();
  showFrame();

  restoreName();
  renderNameState();
  if (who()) commitName();

  $('labeler-input').addEventListener('input', () => {
    $('name-row').classList.remove('saved');
    renderNameState();
  });
  $('labeler-input').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commitName();
  });
  $('name-go').addEventListener('click', commitName);

  $('prev').addEventListener('click', () => go(state.i - 1));
  $('next').addEventListener('click', () => go(state.i + 1));
  $('zoom-reset').addEventListener('click', resetZoom);

  $('line-ctx-menu').querySelector('[data-action="delete-line"]')
    .addEventListener('click', deleteCurrentLine);
  document.addEventListener('click', (e) => {
    const menu = $('line-ctx-menu');
    if (!menu.hidden && !menu.contains(e.target)) closeLineContextMenu();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLineContextMenu();
  });

  $('team-btn').addEventListener('click', () => setTeamOpen(!state.teamOpen));
  $('bugreport-btn').addEventListener('click', () => {
    setBugReportOpen(!$('bugreport-panel').classList.contains('on'));
  });
  $('bugreport-text').addEventListener('input', () => {
    $('bugreport-send').disabled = !$('bugreport-text').value.trim();
  });
  $('bugreport-send').addEventListener('click', sendBugReport);

  $('agree-a').addEventListener('change', (e) => setAgreePair(0, e.target.value));
  $('agree-b').addEventListener('change', (e) => setAgreePair(1, e.target.value));
  populateAgreeSelects();
  refreshAgreement();

  $('admin-refresh').addEventListener('click', loadAllAdminData);
  $('agree-export').addEventListener('click', exportAgreementPNG);

  // ── stage: pan, draw/adjust the assistant line, zoom ───────────────────
  // The two buttons do two unrelated things, so there's no click-vs-drag
  // ambiguity on a single button to resolve:
  //   LEFT  — mousedown on an existing handle grabs and moves that ONE
  //           point (see startDraw/moveDraw/finishDraw); mousedown on
  //           empty space arms a pan, at ANY zoom (including fit — there's
  //           always somewhere to nudge to, even if it's just a few px of
  //           slack against the card's edge).
  //   RIGHT — a drag draws a brand new line, base at mousedown and end at
  //           mouseup, replacing whatever line this frame already had,
  //           at any zoom; a STATIONARY right-click (no real movement)
  //           opens the delete-line menu when this frame has a line, and
  //           does nothing otherwise. The browser's own context menu is
  //           suppressed on the stage so it never fights this.
  const stage = $('stage');
  stage.addEventListener('mousedown', (e) => {
    if (!state.ready) return;
    if (e.button === 2) {
      // Admin gets this too — a purely EPHEMERAL scratch line for their
      // own eyeballing, using the exact same state.line/#line-svg the
      // individual flow does. It's never saved anywhere for admin: only
      // applyLabel() ever sends state.line to the backend, and admin's
      // clicks all route through applyAdminLabel() instead, which never
      // reads it — so there's nothing to wire OFF here, it's already
      // disconnected from every admin save path.
      state.rdown = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    closeLineContextMenu();
    state.down = { x: e.clientX, y: e.clientY };
    // Admin checks BOTH: a roster member's own (colored) line handle
    // first, then admin's own scratch line — grabbing one must never
    // start the other.
    if (state.isAdmin) {
      if (startAdminDrag(e.clientX, e.clientY)) { e.preventDefault(); return; }
      if (startDraw(e.clientX, e.clientY)) { e.preventDefault(); return; }
    } else if (startDraw(e.clientX, e.clientY)) { e.preventDefault(); return; }
    state.drag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (state.adminDrag) { moveAdminDrag(e.clientX, e.clientY); return; }
    if (state.draw) { moveDraw(e.clientX, e.clientY); return; }
    if (state.rdown) {
      const moved = Math.hypot(e.clientX - state.rdown.x, e.clientY - state.rdown.y) > CLICK_SLOP_PX;
      if (moved) {
        const base = stageNorm(state.rdown.x, state.rdown.y);
        const end = stageNorm(e.clientX, e.clientY);
        renderLine(base, end);
        updateSuggestionFrom(base, end);
        stage.classList.add('line-drawing');
      }
      return;
    }
    if (state.drag) {
      state.panX = state.drag.px + (e.clientX - state.drag.x);
      state.panY = state.drag.py + (e.clientY - state.drag.y);
      applyTransform();
      stage.classList.add('panning');
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (state.adminDrag) { finishAdminDrag(e.clientX, e.clientY); state.down = null; return; }
    if (state.draw) { finishDraw(e.clientX, e.clientY); state.down = null; return; }
    if (state.rdown) {
      const rd = state.rdown;
      state.rdown = null;
      stage.classList.remove('line-drawing');
      const moved = Math.hypot(e.clientX - rd.x, e.clientY - rd.y) > CLICK_SLOP_PX;
      if (moved) {
        drawNewLine(stageNorm(rd.x, rd.y), stageNorm(e.clientX, e.clientY));
      } else if (state.line) {
        openLineContextMenu(e.clientX, e.clientY);
      }
      return;
    }
    state.drag = null;
    stage.classList.remove('panning');
    state.down = null;
  });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('dblclick', resetZoom);
  const DELTA_PX = { 0: 1, 1: 16, 2: 400 };
  $('stage-card').addEventListener('wheel', (e) => {
    e.preventDefault();
    const px = e.deltaY * (DELTA_PX[e.deltaMode] || 1);
    zoomAt(Math.max(-200, Math.min(200, px)), e.clientX, e.clientY);
  }, { passive: false });

  $('frame').addEventListener('load', () => {
    const img = $('frame');
    if (img.naturalWidth && img.naturalHeight) {
      stage.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    }
    applyTransform();
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key in KEY_BINS) {
      if (state.isAdmin) return;  // no single identity to target — pick a person's own dial in the stack instead
      e.preventDefault(); const m = KEY_BINS[e.key]; applyLabel(m.store, m.skip); return;
    }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); go(state.i - 1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(state.i + 1); return; }
    if (e.key === '0') { e.preventDefault(); resetZoom(); return; }
  });
});

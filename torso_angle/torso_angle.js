// ============================================================
// torso_angle.js — torso-rotation-relative-to-camera labeler, 45° buckets
//
// One bucketed verdict per sampled frame: which 45°-wide interval the
// torso's rotation about the vertical axis falls into, relative to the
// CAMERA. Eight intervals, each named by its centre — [-22.5, 22.5) is
// "0°", [22.5, 67.5) is "+45°", and so on round to 180°. Positive is
// toward the CAMERA's right: an image-plane convention, not the boxer's
// own left/right, and never mirrored for stance — recorded as-shown, same
// reasoning as Guard Drops' guard_hand (raw + auditable beats normalized +
// unfixable if a stance turns out to be wrong).
//
// Discrete choice, not a continuous angle. bladedness/README.md measured
// that a rating scale on this same rotation records the labeler's visual
// compression (perceived slant runs ~0.56 of true) rather than the stance,
// which is why THAT tool went pairwise. A coarse fixed interval sidesteps
// it: compression only bites within a couple of degrees of a boundary.
//
// Frames are a PLACEHOLDER sample — 50 borrowed from chin_tuck_4.0's
// height_guard queue (torso_angle_frames.json), served from the same
// Firebase Storage objects. This tool's own sampler (guard / punched /
// impact phases, ~2-3k frames) doesn't exist yet — see README.md.
//
// Backend: listTorsoAngle / saveTorsoAngle / deleteTorsoAngle /
// statsTorsoAngle in apps_script/Code.js, sheet "Torso Angle Labels".
//
// Ported from chin_tuck_4.0/height_guard: the zoom/pan stage, the
// everyone's-progress panel (roster + queue-position ranges + per-device
// hiding), the bug report console, the copy buttons, the readiness gate
// and the optimistic-save pattern. NOT ported: point placement,
// visibility popovers, admin mode, disagreement grids, planted repeats —
// none of them have a counterpart in a one-bucket-per-frame question.
// ============================================================

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';

// Same bucket + objects the frames actually live at — see
// chin_tuck_4.0/height_guard/height_guard.js. Borrowed wholesale: these are
// literally the same hosted JPEGs, not a copy. Rotating the token means
// re-stamping every object AND shipping this constant.
const FRAME_BUCKET = 'mycorner-bee6a.firebasestorage.app';
const FRAME_PREFIX = 'labeler_media/chin_tuck/v4/height_guard_v4_frames/frames';
const FRAME_TOKEN = '628dbeba-2969-4f45-b65e-5b295ef56fdc';

// Stable per-page identifier for the bug sheet's `tool` column — a plain
// string, not derived from the URL or title, so it can never change out
// from under old rows if the page is renamed.
const BUG_REPORT_TOOL = 'torso_angle';

const MIN_ZOOM = 1 / 3;
const MAX_ZOOM = 12;
const ZOOM_SPEED = 0.0018;
// Past this many DEVICE pixels per SOURCE pixel the frame is drawn
// pixel-for-pixel instead of smoothed (#stage.sharp) — beyond it the
// browser is inventing pixels between the real ones.
const SHARP_MAG = 1.5;
// ...and only for sources with this many pixels on the short side: below HD
// the grid is as coarse as the anatomy being judged, and the smooth
// gradient says more than a field of flat squares. A property of the FRAME,
// not the screen, so every labeler sees the same frame the same way.
const SHARP_MIN_SOURCE = 720;
// A click is a click if the mouse moved less than this many screen px
// between down and up; anything longer is a pan.
const CLICK_SLOP_PX = 4;

// Overview grid geometry — the same BATCH/BATCH_COLS chin_tuck_4.0 uses, so
// a batch means the same number of frames in both tools.
const BATCH = 100;
const BATCH_COLS = 20;

const TEAM_POLL_MS = 45000;
// A cached range list older than this is refetched when its row is opened.
const RANGE_FRESH_MS = 60000;
const HIDE_KEY = 'ta_hidden_labelers';
const RANGE_KEY = 'ta_range_cache';

// The eight intervals, in compass order. `c` is the interval's CENTRE and
// the value written to the sheet; the interval itself is [c-22.5, c+22.5),
// half-open upward so a frame judged exactly on a boundary always belongs
// to the higher bucket — arbitrary, but it has to be decided once and
// written down. `key` is the numpad shortcut, the same layout
// punch_directions/punch_dir_16 uses, so the keys mean the same thing on
// every labeler in this suite. (That page's SIGN convention is the
// opposite of this one — it is boxer-relative, this is camera-relative.)
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

const SKIP_REASON = 'hard_to_tell';

const EYE_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.6 8s2.3-3.8 6.4-3.8S14.4 8 14.4 8s-2.3 3.8-6.4 3.8S1.6 8 1.6 8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.7" stroke="currentColor" stroke-width="1.3"/></svg>';
const CHEV_SVG = '<svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2.5 4 5 6.5 7.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const state = {
  frames: [],
  index: new Map(),        // frame key -> queue position
  i: 0,
  labels: new Map(),       // frame key -> { bucket|null, skip_reason|null }
  ready: false,
  starting: false,        // a label load is actually in flight (vs. no name yet)
  pendingSaves: 0,
  ovDots: null,           // one div per queue slot, built once by buildOverview()

  zoom: 1, panX: 0, panY: 0,
  drag: null,              // pan drag origin
  down: null,              // mousedown screen pos, for click-vs-drag

  roster: [],
  teamOpen: false,
  teamTimer: null,
  rosterPoll: null,
  hidden: new Set(),
  openRanges: new Set(),
  rangeCache: new Map(),
  rangePending: new Map(),
};

const $ = (id) => document.getElementById(id);

const key = (f) => JSON.stringify([f.stem, f.round, f.frame]);
const rowKey = (r) => JSON.stringify([r.video, Number(r.round), Number(r.frame)]);

// Mirrors chin_export_frames.frame_dir() — Windows strips trailing dots and
// spaces from directory names, so the exporter sanitized them and the
// uploader inherited its layout.
const frameDir = (stem) => stem.replace(/[. ]+$/, '');

const imgSrc = (f) => 'https://firebasestorage.googleapis.com/v0/b/'
  + FRAME_BUCKET + '/o/'
  + encodeURIComponent(`${FRAME_PREFIX}/${frameDir(f.stem)}/r${f.round}_f${f.frame}.jpg`)
  + `?alt=media&token=${FRAME_TOKEN}`;

// 180 is the wrap point — it is neither turned to the camera's right nor its
// left, so it carries no sign. Everything else does, including 0, which is
// signless for the same reason (there is no rotation to have a direction).
const signed = (v) => {
  const n = Number(v);
  if (Math.abs(n) === 180) return '180°';
  return (n > 0 ? '+' : '') + n + '°';
};

// ── identity ───────────────────────────────────────────────────────────────
function who() { return ($('labeler-input').value || '').trim(); }

function restoreName() {
  const el = $('labeler-input');
  if (!el || el.value.trim()) return;
  let saved = null;
  try { saved = window.CMLabeler && window.CMLabeler.get && window.CMLabeler.get(); } catch (e) {}
  if (saved) el.value = saved;
}

function renderNameState() {
  $('name-go').disabled = !who();
  // The gate's own explanation. Before a name is committed nothing is
  // loading — saying "Loading…" there describes a request that was never
  // made, and leaves the labeler waiting for something that will not
  // arrive on its own.
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

// One retry for cold-start blips. Apps Script's /exec intermittently serves
// an HTML error page under quick successive requests — a labeler's normal
// pace — so a transport failure is retried; a JSON-level error is a real
// answer from the backend and is not.
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
  (await call({ action: 'listTorsoAngle', labeler }, 'load labels')).rows || [];

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
  stage.classList.toggle('zoomed', !isFitted());
  $('stage-card').classList.toggle('zoomed', !isFitted());
  $('zoom-pct').textContent = Math.round(state.zoom * 100) + '%';
  const mag = magnification();
  stage.classList.toggle('sharp', !!mag && mag.hd && mag.now >= SHARP_MAG);
}

// Device pixels per source pixel: `fit` is what displaying the frame at all
// costs, `now` folds in the zoom, `hd` is whether the source has the
// resolution to be worth drawing pixel-exactly. null until the image
// reports its size.
function magnification() {
  const w = $('stage').offsetWidth;          // layout width, pre-transform
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
  if ((before - 1) * (after - 1) < 0) after = 1;   // snap through fit
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

// ── the dial ───────────────────────────────────────────────────────────────
// Eight 45°-wide SECTORS of a ring. The wedge is the interval: its angular
// width on screen is the answer's width, so nothing has to explain that a
// bucket covers a range. Boundary values sit on the spokes that divide
// them, the centre value inside each wedge.
//
// Geometry: x = cx + r·sin θ, y = cy + r·cos θ, so 0° is at the bottom
// (torso squared to camera), 180° at the top (back to camera), +90° right.
// Because that maps dial angle θ to SVG screen angle φ = 90° − θ, an
// INCREASING θ runs in SVG's negative sweep direction — hence sweep 0 on
// the outer arc and 1 on the inner one coming back.
const DIAL = { cx: 150, cy: 150, rOut: 118, rIn: 52, rLabel: 86, rBound: 130 };

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

function buildDial() {
  const dial = $('dial');
  dial.replaceChildren();

  for (const b of BINS) {
    const g = svgEl('g');
    const path = svgEl('path', {
      class: 'wedge', d: wedgePath(b.c - 22.5, b.c + 22.5),
      role: 'button', tabindex: '0',
      'aria-label': `${signed(b.c)} — ${intervalText(b.c)}`,
    });
    path.dataset.store = String(b.c);
    const act = () => applyLabel(String(b.c), false);
    path.addEventListener('click', act);
    path.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); }
    });
    const title = svgEl('title');
    title.textContent = intervalText(b.c);
    path.appendChild(title);

    const [lx, ly] = polar(b.c, DIAL.rLabel);
    const label = svgEl('text', { class: 'wlabel', x: lx, y: ly - 6 });
    label.textContent = signed(b.c);
    label.dataset.store = String(b.c);
    const kb = svgEl('text', { class: 'wkey', x: lx, y: ly + 9 });
    kb.textContent = b.key;
    kb.dataset.store = String(b.c);

    g.append(path, label, kb);
    dial.appendChild(g);
  }

  // The spokes and their values — the interval boundaries, drawn where the
  // intervals actually part. 8 of them, at every odd multiple of 22.5.
  for (const b of BINS) {
    const edge = b.c + 22.5;
    const [sx, sy] = polar(edge, DIAL.rIn);
    const [ex, ey] = polar(edge, DIAL.rOut);
    dial.appendChild(svgEl('line', { class: 'spoke', x1: sx, y1: sy, x2: ex, y2: ey }));
    const [bx, by] = polar(edge, DIAL.rBound);
    const t = svgEl('text', { class: 'bound', x: bx, y: by });
    t.textContent = signed(norm180(edge));
    dial.appendChild(t);
  }

  // Skip, in the hole — the biggest single target on the dial, which suits
  // the answer reached for most often after the eight real ones.
  const hole = svgEl('circle', { class: 'skipw', cx: DIAL.cx, cy: DIAL.cy, r: DIAL.rIn - 3,
                                 role: 'button', tabindex: '0', 'aria-label': "Can't tell the angle" });
  const skipAct = () => applyLabel(null, true);
  hole.addEventListener('click', skipAct);
  hole.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); skipAct(); }
  });
  const st = svgEl('text', { class: 'skipt', x: DIAL.cx, y: DIAL.cy - 6 });
  st.textContent = "can't tell";
  const sk = svgEl('text', { class: 'skipk', x: DIAL.cx, y: DIAL.cy + 10 });
  sk.textContent = '2';
  dial.append(hole, st, sk);
}

// Wrap a boundary to (-180, 180] so the spoke past 180 prints as -157.5
// rather than 202.5 — the sheet's own vocabulary.
function norm180(d) {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  return Math.round(x * 10) / 10;
}

function intervalText(c) {
  return `[${signed(norm180(c - 22.5))}, ${signed(norm180(c + 22.5))})`;
}

function renderDial() {
  const cur = state.labels.get(key(state.frames[state.i]) || '');
  const picked = cur ? (cur.skip_reason ? 'skip' : String(cur.bucket)) : null;
  for (const el of $('dial').querySelectorAll('.wedge, .wlabel, .wkey')) {
    el.classList.toggle('on', picked !== null && el.dataset.store === picked);
  }
  for (const el of $('dial').querySelectorAll('.skipw, .skipt, .skipk')) {
    el.classList.toggle('on', picked === 'skip');
  }
  const read = $('dial-read');
  if (picked === null) read.innerHTML = '&mdash;';
  else if (picked === 'skip') read.innerHTML = '<b>Skipped</b> &mdash; angle not readable';
  else read.innerHTML = `<b>${signed(picked)}</b> &mdash; ${intervalText(Number(picked))}`;
}

// ── frame ──────────────────────────────────────────────────────────────────
function showFrame() {
  const f = state.frames[state.i];
  const img = $('frame');
  resetZoom();
  if (!f) {
    img.removeAttribute('src');
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
  renderDial();
  renderOverview();          // moves the .cur outline to this slot
}

function go(i) {
  if (!state.frames.length) return;
  const n = Math.min(state.frames.length - 1, Math.max(0, i));
  if (n === state.i) return;
  state.i = n;
  showFrame();
}

// ── progress: the overview grid ────────────────────────────────────────────
// One dot per queue slot, built once and repainted in place — rebuilding
// 3k elements on every frame change would be the expensive way to move one
// outline. Same geometry as chin_tuck_4.0's grids.
function buildOverview() {
  const ov = $('ov');
  ov.textContent = '';
  const frag = document.createDocumentFragment();
  state.ovDots = [];
  for (let i = 0; i < state.frames.length; i++) {
    const d = document.createElement('div');
    d.className = 'd4';
    // The marker goes on the first row of each new batch, never the first.
    if (i >= BATCH && i % BATCH < BATCH_COLS) d.dataset.batch = '1';
    frag.appendChild(d);
    state.ovDots.push(d);
  }
  ov.appendChild(frag);
  ov.onclick = (e) => {
    const at = state.ovDots.indexOf(e.target);
    if (at >= 0) go(at);
  };

  // One label per batch, its height computed from the rows that batch
  // actually occupies (the last one is usually short). The 7px lead matches
  // the gap the dots take, which is what keeps a number level with its batch.
  const gutter = document.querySelector('.ovn');
  const col = document.createDocumentFragment();
  for (let b = 0; b * BATCH < state.frames.length; b++) {
    const count = Math.min(BATCH, state.frames.length - b * BATCH);
    const rows = Math.ceil(count / BATCH_COLS);
    const n = document.createElement('b');
    n.textContent = b + 1;
    n.style.height = `${rows * 9 + (rows - 1) * 3}px`;
    n.style.lineHeight = '9px';
    if (b) n.style.marginTop = '10px';
    n.title = `frames ${b * BATCH + 1}–${b * BATCH + count}`;
    col.appendChild(n);
  }
  gutter.replaceChildren(col);
}

function renderOverview() {
  const dots = state.ovDots;
  if (!dots) return;
  for (let i = 0; i < state.frames.length; i++) {
    const row = state.labels.get(key(state.frames[i]));
    let cls = 'd4';
    let what = 'not labelled';
    if (row && row.skip_reason) { cls += ' sk'; what = "can't tell"; }
    else if (row) { cls += ' dn'; what = signed(row.bucket); }
    if (i === state.i) cls += ' cur';
    // Colour is never the only signal — the tooltip says the same thing.
    const t = `#${i + 1} — ${what}`;
    if (dots[i].title !== t) dots[i].title = t;
    if (dots[i].className !== cls) dots[i].className = cls;
  }
}

function renderProgress() {
  const N = state.frames.length;
  const done = state.labels.size;
  $('bar-text').textContent = N
    ? `${done.toLocaleString()} / ${N.toLocaleString()} labelled`
    : 'no frames';
  renderOverview();

  const count = {};
  for (const v of state.labels.values()) {
    const k = v.skip_reason ? 'skip' : String(v.bucket);
    count[k] = (count[k] || 0) + 1;
  }
  const cells = [];
  for (const b of BINS) {
    const n = count[String(b.c)] || 0;
    const s = document.createElement('span');
    if (n) s.className = 'has';
    s.innerHTML = `${signed(b.c)}<b>${n}</b>`;
    cells.push(s);
  }
  const sk = document.createElement('span');
  if (count.skip) sk.className = 'has';
  sk.innerHTML = `skip<b>${count.skip || 0}</b>`;
  cells.push(sk);
  $('dist').replaceChildren(...cells);
}

// ── labeling ───────────────────────────────────────────────────────────────
// Optimistic: the pick lands and the page advances immediately, the save
// drains behind it, and a failure rolls the row back so the frame resurfaces
// on the next sweep rather than being silently lost.
function applyLabel(store, isSkip) {
  if (!state.ready) return;
  const labeler = who();
  if (!labeler) { status('Enter your name and press Start first.', 'err'); return; }
  const f = state.frames[state.i];
  if (!f) return;
  const k = key(f);
  const prev = state.labels.get(k);
  const row = isSkip ? { bucket: null, skip_reason: SKIP_REASON }
                     : { bucket: store, skip_reason: null };

  state.labels.set(k, row);
  state.pendingSaves++;
  renderDial();
  renderProgress();
  bumpMyTeamRow();
  status(`Saving ${isSkip ? 'skip' : signed(store)}…`);

  go(state.i + 1);

  call({
    action: 'saveTorsoAngle', labeler, video: f.stem,
    round: String(f.round), frame: String(f.frame), pts_sec: String(f.pts),
    bucket: isSkip ? '' : String(store),
    skip_reason: isSkip ? SKIP_REASON : '',
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

// ── start / sync ───────────────────────────────────────────────────────────
// The readiness gate: until this labeler's saved rows are in hand the dial
// is inert, because a bucket picked in that window would be overwritten by
// the sync landing on top of it. Lands the labeler on their first
// unlabeled frame, the way height_guard's start() does.
async function start() {
  if (!who()) return;
  document.body.classList.remove('ready');
  state.ready = false;
  state.starting = true;
  $('lock').classList.remove('err');
  $('lock').textContent = 'Loading your labels…';
  try {
    const rows = await fetchRows(who());
    state.labels = new Map();
    for (const r of rows) {
      const k = rowKey(r);
      if (!state.index.has(k)) continue;    // a row outside the current queue
      state.labels.set(k, {
        bucket: r.bucket === null || r.bucket === undefined ? null : String(r.bucket),
        skip_reason: r.skip_reason || null,
      });
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
  // First unlabeled frame, or the last one if the queue is finished.
  const first = state.frames.findIndex((f) => !state.labels.has(key(f)));
  state.i = first === -1 ? state.frames.length - 1 : first;
  showFrame();
  status(`Loaded ${state.labels.size} of your label(s).`, 'ok');

  try { await loadRoster(); renderTeamPanel(); } catch (e) {}
  startRosterPoll();
  if (state.teamOpen) prefetchRanges();
}

// ── team data ──────────────────────────────────────────────────────────────
async function loadRoster() {
  const body = await call({ action: 'statsTorsoAngle' }, 'load team');
  state.roster = (body.labelers || []).filter((l) => l.n > 0);
}

function startRosterPoll() {
  if (state.rosterPoll) return;
  state.rosterPoll = setInterval(async () => {
    try { await loadRoster(); renderTeamPanel(); } catch (e) { /* keep the stale roster */ }
  }, TEAM_POLL_MS);
}

// One real refresh after a burst of saves, not one per save — the stats
// call reads the whole sheet.
function scheduleTeamRefresh() {
  clearTimeout(state.teamTimer);
  state.teamTimer = setTimeout(async () => {
    try { await loadRoster(); renderTeamPanel(); prefetchRanges(); } catch (e) {}
  }, 4000);
}

// Your own row moves the instant you save, so it never waits for the poll.
function bumpMyTeamRow() {
  const me = who();
  if (!me) return;
  let mine = state.roster.find((r) => r.labeler.toLowerCase() === me.toLowerCase());
  if (!mine) { mine = { labeler: me, n: 0, skipped: 0, last_ts: '', last: null }; state.roster.push(mine); }
  mine.n = state.labels.size;
  mine.skipped = [...state.labels.values()].filter((v) => v.skip_reason).length;
  mine.last_ts = new Date().toISOString();
  const f = state.frames[state.i];
  if (f) mine.last = { video: f.stem, round: f.round, frame: f.frame };
  state.roster.sort((a, b) => b.n - a.n);
  // Our own ranges are derivable with no request at all, so they never go
  // stale behind the cache the way a teammate's do.
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

// ── team panel: hide-from-my-list ──────────────────────────────────────────
// A VIEW preference, so it lives in localStorage and never reaches the
// sheet — one person tidying their own list must not change what anybody
// else sees.
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

// ── team panel: frame ranges ───────────────────────────────────────────────
// Consecutive queue positions collapse into one run, so "1-100, 401-1100"
// is three facts rather than eleven hundred.
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

// Closed on both sides, 1-based — every number printed is a frame the
// labeler actually did, matching the position shown on the Frame card.
function fmtRanges(runs) { return runs.map(([a, b]) => `[${a + 1}, ${b + 1}]`).join('  ·  '); }

// Ranges are positions in the CURRENT queue, so a rebuilt queue makes every
// stored entry meaningless — the length rides along as a cheap version
// stamp and a mismatch drops the lot. Errors are never stored: a fetch that
// failed once is worth retrying, unlike an answer that is merely stale.
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
  } catch (e) {}                                  // quota — the cache is a luxury
}

// Warm every visible row at once when the panel OPENS: the reads are
// independent and Apps Script serves them in parallel, so the whole team
// costs about what one labeler does, and clicking a name is then instant.
function prefetchRanges(force) {
  if ((!state.teamOpen && !force) || !state.frames.length) return;
  const me = (who() || '').toLowerCase();
  for (const r of state.roster) {
    const k = r.labeler.toLowerCase();
    if (k !== me && state.hidden.has(k)) continue;
    if (state.rangeCache.has(r.labeler)) continue;
    loadRanges(r.labeler, r.n).then(() => renderTeamPanel());
  }
}

async function loadRanges(labeler, n) {
  const inflight = state.rangePending.get(labeler);
  if (inflight) return inflight;                  // a click during a prefetch
  const p = fetchRanges(labeler, n).finally(() => state.rangePending.delete(labeler));
  state.rangePending.set(labeler, p);
  return p;
}

async function fetchRanges(labeler, n) {
  let rows;
  try {
    if (labeler.toLowerCase() === (who() || '').toLowerCase()) {
      state.rangeCache.set(labeler, { n, ranges: frameRuns(myIndices()), at: Date.now() });
      saveRangeCache();
      return;                                     // already in hand, no request
    }
    rows = await fetchRows(labeler);
  } catch (e) {
    // An error must never overwrite ranges already on screen — but the
    // ATTEMPT is always stamped, on the old entry if there is one.
    const had = state.rangeCache.get(labeler);
    state.rangeCache.set(labeler, had
      ? Object.assign({}, had, { at: Date.now() })
      : { n, ranges: [], at: Date.now(), error: e.message });
    return;
  }
  const idx = [];
  for (const r of rows) {
    const i = state.index.get(rowKey(r));
    if (i !== undefined) idx.push(i);             // rows outside the queue are not shown
  }
  state.rangeCache.set(labeler, { n, ranges: frameRuns(idx), at: Date.now() });
  saveRangeCache();
}

// ── team panel: render ─────────────────────────────────────────────────────
// Name, count, and a MAP of where in the queue those frames fall — never
// anybody's actual answer. Whoever can see another answer anchors on it,
// and an anchored pick is not a second opinion; a position on a bar carries
// no verdict, so there is nothing in it to anchor on. Same rule 4.0 states
// in its own README.
function setTeamOpen(open) {
  state.teamOpen = !!open;
  $('team').classList.toggle('on', state.teamOpen);
  $('team-btn').setAttribute('aria-expanded', String(state.teamOpen));
  // Render on open rather than trusting the last poll to have left the
  // panel current — the roster can have moved (a save of our own bumps it)
  // while the panel was folded away and nothing repainted it.
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
  const me = who().toLowerCase();
  const n = state.frames.length;

  // You can never hide yourself — your own progress is the one row always
  // relevant. Counted over PRESENT rows only, so a name hidden long ago
  // that has since stopped labeling does not inflate the tally.
  const isMe = (r) => r.labeler.toLowerCase() === me;
  const shown = rows.filter((r) => isMe(r) || !state.hidden.has(r.labeler.toLowerCase()));
  const hiddenNow = rows.length - shown.length;

  // #team IS the grid, so each labeler contributes cells directly to it —
  // a wrapper would become the grid item and the columns would stop lining
  // up between labelers.
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
      // No runs yet. Fall back to a proportional fill rather than an empty
      // track: an empty bar beside "31 / 50" reads as nothing done.
      bar.classList.add('approx');
      const fill = document.createElement('i');
      fill.style.left = '0';
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
    }

    // Position is worth knowing — it is just not worth a column.
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
    cells[cells.length - 2].title = tip;           // the count cell

    if (open) {
      const box = add('who-ranges' + m, '');
      const got = state.rangeCache.get(r.labeler);
      // Whatever we have goes up straight away; only a row never read shows
      // a spinner-equivalent, so the panel never blanks what it just said.
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

// ── bug report console ─────────────────────────────────────────────────────
// Saved to one spreadsheet shared by every labeler on the site, and
// deliberately independent of call()'s retry/marker machinery — a bug
// report isn't label data, and staying independent is what keeps this block
// copy-pasteable into any future labeler. Reuses api() but does its own
// fetch. See saveBugReport / doGetBugReport in apps_script/Code.js.
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
// The async clipboard API is refused outright in some embedded/permission-
// restricted browsers, so a bare writeText().catch(return) is a button that
// silently does nothing — the labeler pastes and gets whatever was there
// before. Fall back to the execCommand path, and if BOTH fail say so rather
// than pretending it worked.
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
    // Off-screen but focusable — display:none or visibility:hidden makes
    // the selection uncopyable.
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
  const res = await fetch('./torso_angle_frames.json', { cache: 'no-cache' });
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
  buildOverview();
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

  $('team-btn').addEventListener('click', () => setTeamOpen(!state.teamOpen));
  $('bugreport-btn').addEventListener('click', () => {
    setBugReportOpen(!$('bugreport-panel').classList.contains('on'));
  });
  $('bugreport-text').addEventListener('input', () => {
    $('bugreport-send').disabled = !$('bugreport-text').value.trim();
  });
  $('bugreport-send').addEventListener('click', sendBugReport);

  // ── stage: pan / zoom ────────────────────────────────────────────────
  const stage = $('stage');
  stage.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    state.down = { x: e.clientX, y: e.clientY };
    if (!isFitted()) {
      state.drag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
      stage.classList.add('panning');
    }
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!state.drag) return;
    state.panX = state.drag.px + (e.clientX - state.drag.x);
    state.panY = state.drag.py + (e.clientY - state.drag.y);
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    state.drag = null;
    state.down = null;
    stage.classList.remove('panning');
  });
  stage.addEventListener('dblclick', resetZoom);
  // deltaMode 0/1/2 = pixels / lines / pages; normalise before scaling so a
  // line-scrolling mouse and a pixel-scrolling trackpad zoom alike.
  const DELTA_PX = { 0: 1, 1: 16, 2: 400 };
  $('stage-card').addEventListener('wheel', (e) => {
    e.preventDefault();
    const px = e.deltaY * (DELTA_PX[e.deltaMode] || 1);
    zoomAt(Math.max(-200, Math.min(200, px)), e.clientX, e.clientY);
  }, { passive: false });

  // The frame's own resolution is half the sharp/smooth decision, and it is
  // only known once the image loads — hence applyTransform here too.
  $('frame').addEventListener('load', () => {
    const img = $('frame');
    if (img.naturalWidth && img.naturalHeight) {
      stage.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    }
    applyTransform();
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key in KEY_BINS) { e.preventDefault(); const m = KEY_BINS[e.key]; applyLabel(m.store, m.skip); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); go(state.i - 1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(state.i + 1); return; }
    if (e.key === '0') { e.preventDefault(); resetZoom(); return; }
  });
});

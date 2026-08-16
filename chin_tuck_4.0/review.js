// review.js — chin-point 4.0 REVIEW. Read-only.
//
// The labeling page answers "what do I think of this frame". This page
// answers "where did everyone put their points, and where do they differ" —
// pick a set of labelers, walk the frames they share, see every placement on
// the picture at once.
//
// It writes NOTHING. That is not just tidiness: the labeler's own Peers panel
// is a review surface too, but opening it marks the frame `consulted`, which
// is the sheet's record that a save made afterwards was calibrated rather than
// independent. Reviewing a few hundred frames through that panel would stamp
// `consulted` across the corpus and quietly devalue the very rows being
// reviewed. So this page reads `listChinPoint` (per labeler, one call, every
// row) instead of `peersChinPoint` (per frame, and the panel that sets the
// flag). No new Apps Script action, no deploy.
//
// THE METRIC. Disagreement is reported as the thing the pipeline actually
// consumes: the signed chin-above-shoulder distance in torso units,
// (sh_y - chin_y) / torso_h, identical to chin_tuck4.js's derivedDist().
// It is VERTICAL, so it needs no frame aspect ratio — which the page does not
// have, since queue.json carries no width/height and the JPEGs only reveal
// theirs once loaded. That also makes the decomposition exact: a pair's
// disagreement in the derived number is the difference of their chin-y gap and
// their shoulder-y gap, so the summary can say WHICH point causes it. The
// horizontal spread is visible on the picture, where a reviewer can judge it
// better than a number can.
//
// Repeats are marks in their own right. A labeler's rep 0 and rep 1 on one
// frame is their own click scatter — the noise floor every inter-rater number
// has to be read against — so the summary carries a self row per labeler and
// the stage draws both placements.

'use strict';

// Same deployment the labeling page talks to; this page only ever calls its
// two read actions.
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';

const FRAME_BUCKET = 'mycorner-bee6a.firebasestorage.app';
const FRAME_PREFIX = 'labeler_media/chin_point/frames';
const FRAME_TOKEN = '628dbeba-2969-4f45-b65e-5b295ef56fdc';

// Assigned by sorted name over EVERY labeler in the workbook, not just the
// selected ones, so a person keeps their colour as the selection changes.
const PEER_COLORS = ['#ff9f0a', '#bf5af2', '#64d2ff', '#ff6482', '#30d158',
                     '#ffd60a', '#ac8e68'];
const MACHINE_COLOR = '#8e8e93';

const MIN_ZOOM = 1 / 3;
const MAX_ZOOM = 12;
const ZOOM_SPEED = 0.0018;
const CLICK_SLOP_PX = 4;

const SEL_KEY = 'cm_chin_review_selected';

const state = {
  images: [],              // one entry per distinct (stem, round, frame)
  byKey: new Map(),        // image key -> image
  labelers: [],            // [{labeler, n, skipped, last_ts}] from statsChinPoint
  colorOf: new Map(),      // labeler -> colour
  selected: new Set(),
  rows: new Map(),         // labeler -> Map(image key -> rows, rep-ascending)
  unmatched: 0,            // sheet rows whose frame is not in this queue
  view: [],                // images passing the filters, in sort order
  i: 0,
  sort: 'spread',
  scope: 'overlap',
  onlySkip: false,
  showMachine: true,
  hover: null,             // labeler whose marks stay lit
  skipConflicts: 0,
  zoom: 1, panX: 0, panY: 0,
  drag: null,
  imgToken: 0,
};

const $ = (id) => document.getElementById(id);

// Same identity the sheet uses, minus rep: this page groups by the PICTURE,
// and a planted repeat is the same picture judged again.
const imgKey = (stem, round, frame) => JSON.stringify([stem, Number(round), Number(frame)]);

// Mirrors chin_export_frames.frame_dir() — Windows strips trailing dots and
// spaces from directory names, so the exporter sanitized them and the uploader
// inherited its layout.
const frameDir = (stem) => stem.replace(/[. ]+$/, '');

const imgSrc = (f) => 'https://firebasestorage.googleapis.com/v0/b/'
  + FRAME_BUCKET + '/o/'
  + encodeURIComponent(`${FRAME_PREFIX}/${frameDir(f.stem)}/r${f.round}_f${f.frame}.jpg`)
  + `?alt=media&token=${FRAME_TOKEN}`;

// ── backend ────────────────────────────────────────────────────────────────
function api(params) {
  const url = new URL(SCRIPT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// One retry for cold-start blips. The v4 marker refuses a deployment that
// predates these endpoints: doGet answers an unknown action with a success
// shape, so without the marker an empty read would look like an empty sheet.
async function call(params, what) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    let body;
    try {
      const res = await fetch(api(params), { redirect: 'follow' });
      body = await res.json();
    } catch (e) { last = e; continue; }
    if (body.status !== 'ok') { last = new Error(body.message || 'unknown error'); continue; }
    if (body.v4 !== true) {
      throw new Error('Apps Script is out of date — redeploy it '
                      + `(${params.action} fell through to the default handler)`);
    }
    return body;
  }
  throw new Error(`${what}: ${last && last.message}`);
}

// ── geometry ───────────────────────────────────────────────────────────────
// Signed chin-to-shoulder distance in torso units. Positive = the chin sits
// ABOVE the shoulder top (more exposed). Verbatim from chin_tuck4.js: the two
// pages must never disagree about what the label means.
function derivedDist(chin, sh, torsoH) {
  if (!chin || !sh || !torsoH) return null;
  return (sh[1] - chin[1]) / torsoH;
}

function fmtDist(d) {
  if (d === null || d === undefined) return '—';
  return `${d >= 0 ? '+' : ''}${Math.round(d * 100)}%`;
}

const pct = (d) => (d === null || d === undefined ? '—' : `${Math.round(d * 100)}%`);

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i];
}

// ── loading ────────────────────────────────────────────────────────────────
async function loadQueue() {
  const res = await fetch('queue.json?v=2');
  if (!res.ok) throw new Error(`queue.json — HTTP ${res.status}`);
  const q = await res.json();
  const frames = (q && q.frames) || [];
  if (!frames.length) throw new Error('queue.json contains no frames');
  for (const f of frames) {
    const k = imgKey(f.stem, f.round, f.frame);
    // A planted repeat is a second queue SLOT for one picture. The picture is
    // recorded once, at its earliest slot, so queue order still means
    // "where a labeler met this frame first".
    if (state.byKey.has(k)) continue;
    const img = {
      key: k, stem: f.stem, round: f.round, frame: f.frame,
      pts: f.pts, stance: f.stance, shoulder: f.shoulder,
      torso_h: f.torso_h, chin: f.chin, joints: f.joints,
      qi: f.i === undefined ? state.images.length : f.i,
    };
    state.byKey.set(k, img);
    state.images.push(img);
  }
}

async function loadTeam() {
  const body = await call({ action: 'statsChinPoint' }, 'load team');
  state.labelers = (body.labelers || []).filter((l) => l.n > 0);
  [...state.labelers].map((l) => l.labeler).sort()
    .forEach((nm, i) => state.colorOf.set(nm, PEER_COLORS[i % PEER_COLORS.length]));
}

// One call per labeler, every row they have, resolved latest-per-identity by
// the backend. Cached for the session — the sheet is append-only and a review
// pass is minutes long, so refetching per frame would only buy staleness at
// the price of a round trip each time.
async function loadRows(name) {
  if (state.rows.has(name)) return;
  const body = await call({ action: 'listChinPoint', labeler: name }, `load ${name}`);
  const byImage = new Map();
  for (const r of (body.rows || [])) {
    const k = imgKey(String(r.video), r.round, r.frame);
    if (!state.byKey.has(k)) { state.unmatched++; continue; }
    if (!byImage.has(k)) byImage.set(k, []);
    byImage.get(k).push(r);
  }
  for (const list of byImage.values()) list.sort((a, b) => (a.rep || 0) - (b.rep || 0));
  state.rows.set(name, byImage);
}

// ── marks ──────────────────────────────────────────────────────────────────
// Every placement on one picture, in selected-labeler order, reps included.
function marksFor(img) {
  const out = [];
  for (const name of selectedNames()) {
    for (const r of (state.rows.get(name)?.get(img.key) || [])) {
      const chin = r.chin_x === null || r.chin_x === undefined ? null : [r.chin_x, r.chin_y];
      const sh = r.sh_x === null || r.sh_x === undefined ? null : [r.sh_x, r.sh_y];
      out.push({
        labeler: name, rep: r.rep || 0, chin, sh,
        chin_vis: r.chin_vis, sh_vis: r.sh_vis,
        skipped: r.skipped === 1, skip_reason: r.skip_reason,
        consulted: r.consulted === 1, flag: r.flag === 1,
        dist: derivedDist(chin, sh, img.torso_h),
        color: state.colorOf.get(name) || MACHINE_COLOR,
      });
    }
  }
  return out;
}

// The pipeline's own idea of the same two points — BlazePose's lead shoulder
// and the nose→mouth chin extrapolation. Drawn as diamonds so it can never be
// mistaken for a person, and it is exactly what the clicks exist to calibrate.
function machineMark(img) {
  const shKey = String(img.shoulder || '').toLowerCase() === 'left' ? 'l_sh' : 'r_sh';
  const sh = (img.joints || {})[shKey] || null;
  return {
    labeler: 'pipeline', rep: 0, chin: img.chin || null, sh,
    machine: true, color: MACHINE_COLOR,
    dist: derivedDist(img.chin, sh, img.torso_h),
  };
}

function selectedNames() {
  return state.labelers.map((l) => l.labeler)
    .filter((nm) => state.selected.has(nm)).sort();
}

// ── filtering + ordering ───────────────────────────────────────────────────
function recompute() {
  const sel = selectedNames();
  const need = state.scope === 'all' ? sel.length : state.scope === 'overlap' ? 2 : 1;
  const view = [];
  state.skipConflicts = 0;

  for (const img of state.images) {
    const marks = marksFor(img);
    if (!marks.length) continue;
    const placed = marks.filter((m) => m.dist !== null);
    const whoResolved = new Set(marks.map((m) => m.labeler));
    const whoPlaced = new Set(placed.map((m) => m.labeler));
    const whoSkipped = new Set(marks.filter((m) => m.skipped).map((m) => m.labeler));
    // One labeler placed points where another said the frame cannot be judged.
    // Not a distance — a disagreement about whether the frame is labelable at
    // all, which is the sampler's problem rather than the labeler's, so it is
    // filterable on its own.
    const skipConflict = whoPlaced.size > 0 && whoSkipped.size > 0;
    if (skipConflict) state.skipConflicts++;
    if (whoResolved.size < need) continue;
    if (state.onlySkip && !skipConflict) continue;
    const ds = placed.map((m) => m.dist);
    img._marks = marks;
    img._spread = ds.length > 1 ? Math.max(...ds) - Math.min(...ds) : null;
    img._skipConflict = skipConflict;
    view.push(img);
  }

  if (state.sort === 'spread') {
    // Frames nobody can be scored on (one placement, or a skip conflict with
    // no second placement) have no spread; they sort last rather than reading
    // as perfect agreement.
    view.sort((a, b) => (b._spread === null ? -1 : b._spread) - (a._spread === null ? -1 : a._spread));
  } else if (state.sort === 'queue') {
    view.sort((a, b) => a.qi - b.qi);
  } else {
    view.sort((a, b) => a.stem.localeCompare(b.stem) || a.round - b.round || a.frame - b.frame);
  }

  state.view = view;
  if (state.i >= view.length) state.i = Math.max(0, view.length - 1);
  $('skip-n').textContent = String(state.skipConflicts);
  renderPairs();
  render();
}

// ── pairwise summary ───────────────────────────────────────────────────────
// A labeler's placement on a picture, preferring rep 0 — the original judgement.
// Their repeat belongs to the self row, not to a pair.
function primary(name, img) {
  const rows = state.rows.get(name)?.get(img.key) || [];
  for (const r of rows) {
    if (r.chin_x === null || r.chin_x === undefined) continue;
    return { chin: [r.chin_x, r.chin_y], sh: [r.sh_x, r.sh_y],
             dist: derivedDist([r.chin_x, r.chin_y], [r.sh_x, r.sh_y], img.torso_h) };
  }
  return null;
}

function pairStats(a, b) {
  const d = [], dChin = [], dSh = [];
  for (const img of state.images) {
    const pa = primary(a, img), pb = primary(b, img);
    if (!pa || !pb) continue;
    d.push(Math.abs(pa.dist - pb.dist));
    dChin.push(Math.abs(pa.chin[1] - pb.chin[1]) / img.torso_h);
    dSh.push(Math.abs(pa.sh[1] - pb.sh[1]) / img.torso_h);
  }
  return { n: d.length, med: median(d), p90: quantile(d, 0.9),
           chin: median(dChin), sh: median(dSh) };
}

// Rep 0 against rep 1, same person, same picture, judged blind. This is the
// floor: two people cannot agree more closely than one person agrees with
// herself, and no crop model beats the labels it trains on.
function selfStats(name) {
  const d = [];
  const byImage = state.rows.get(name);
  if (!byImage) return { n: 0, med: null };
  for (const [k, rows] of byImage) {
    const img = state.byKey.get(k);
    const placed = rows.filter((r) => r.chin_x !== null && r.chin_x !== undefined);
    if (!img || placed.length < 2) continue;
    const ds = placed.map((r) => derivedDist([r.chin_x, r.chin_y], [r.sh_x, r.sh_y], img.torso_h));
    d.push(Math.max(...ds) - Math.min(...ds));
  }
  return { n: d.length, med: median(d) };
}

function renderPairs() {
  const box = $('pairs');
  box.textContent = '';
  const sel = selectedNames();
  const note = $('pairs-note');

  if (sel.length < 1) {
    note.textContent = 'Pick labelers above.';
    return;
  }

  const swatch = (nm) => {
    const s = document.createElement('span');
    s.className = 'sw';
    s.style.background = state.colorOf.get(nm) || MACHINE_COLOR;
    return s;
  };

  const addRow = (cls, nameEls, right, sub) => {
    const row = document.createElement('div');
    row.className = 'pair' + (cls ? ' ' + cls : '');
    const who = document.createElement('div');
    who.className = 'who2';
    for (const el of nameEls) who.appendChild(el);
    const med = document.createElement('div');
    med.className = 'med num';
    med.textContent = right;
    const s = document.createElement('div');
    s.className = 'sub';
    s.textContent = sub;
    row.append(who, med, s);
    box.appendChild(row);
  };

  const nameSpan = (t) => { const s = document.createElement('span'); s.textContent = t; return s; };

  for (let i = 0; i < sel.length; i++) {
    for (let j = i + 1; j < sel.length; j++) {
      const st = pairStats(sel[i], sel[j]);
      if (!st.n) {
        addRow('', [swatch(sel[i]), nameSpan(sel[i]), nameSpan('↔'), swatch(sel[j]), nameSpan(sel[j])],
               '—', 'no frames in common yet');
        continue;
      }
      addRow('', [swatch(sel[i]), nameSpan(sel[i]), nameSpan('↔'), swatch(sel[j]), nameSpan(sel[j])],
             pct(st.med),
             `p90 ${pct(st.p90)} · ${st.n} frames · chin ${pct(st.chin)} / shoulder ${pct(st.sh)}`);
    }
  }

  for (const nm of sel) {
    const st = selfStats(nm);
    if (!st.n) continue;
    addRow('self', [swatch(nm), nameSpan(`${nm} — own repeats`)], pct(st.med),
           `${st.n} repeated frames · the noise floor`);
  }

  note.textContent = sel.length < 2
    ? 'Median gap in the derived chin-above-shoulder distance, torso units. Pick a second labeler for a pair.'
    : 'Median gap in the derived chin-above-shoulder distance, torso units. chin / shoulder split the gap by which point moved.';
}

// ── stage ──────────────────────────────────────────────────────────────────
function applyTransform() {
  const stage = $('stage');
  stage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  stage.style.setProperty('--inv', String(1 / state.zoom));
  stage.classList.toggle('zoomed', !(state.zoom === 1 && !state.panX && !state.panY));
}

function resetZoom() {
  state.zoom = 1; state.panX = 0; state.panY = 0;
  applyTransform();
}

function zoomAt(px, clientX, clientY) {
  const before = state.zoom;
  let after = before * Math.exp(-px * ZOOM_SPEED);
  after = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, after));
  if ((before - 1) * (after - 1) < 0) after = 1;   // snap through 1:1
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

function render() {
  const marksBox = $('marks');
  const links = $('links');
  for (const el of [...marksBox.querySelectorAll('.pt')]) el.remove();
  links.textContent = '';
  $('mk-list').textContent = '';

  const img = state.view[state.i];
  const total = state.view.length;
  $('pos').innerHTML = total
    ? `${state.i + 1}<small> / ${total}</small>`
    : `—<small> / —</small>`;

  if (!img) {
    $('frame').removeAttribute('src');
    $('stage-note').style.display = 'flex';
    $('stage-note').textContent = state.selected.size
      ? 'No frames match — try a looser "Show" filter, or pick more labelers.'
      : 'Pick the labelers you want to compare.';
    for (const id of ['id-video', 'id-round', 'id-frame', 'id-stance']) $(id).textContent = '—';
    $('spread').textContent = '';
    $('mk-n').textContent = '';
    return;
  }
  $('stage-note').style.display = 'none';

  // The image, and the stage box that every mark is positioned inside.
  const token = ++state.imgToken;
  const el = $('frame');
  el.classList.remove('broken');
  el.onload = () => {
    if (token !== state.imgToken) return;
    if (el.naturalWidth && el.naturalHeight) {
      $('stage').style.aspectRatio = `${el.naturalWidth} / ${el.naturalHeight}`;
    }
  };
  el.onerror = () => {
    if (token !== state.imgToken) return;
    el.classList.add('broken');
    status(`Frame image missing — ${frameDir(img.stem)}/r${img.round}_f${img.frame}.jpg`, 'err');
  };
  el.src = imgSrc(img);
  el.alt = `${img.stem} round ${img.round} frame ${img.frame}`;

  $('id-video').textContent = img.stem;
  $('id-round').textContent = String(img.round);
  $('id-frame').textContent = String(img.frame);
  $('id-stance').textContent = `${img.stance || '—'} · lead ${String(img.shoulder || '—').toLowerCase()}`
    + (img.pts === undefined ? '' : ` · ${img.pts.toFixed(1)}s`);

  const marks = img._marks || marksFor(img);
  const drawn = state.showMachine ? [...marks, machineMark(img)] : marks;

  for (const m of drawn) {
    addDot(marksBox, m, 'chin');
    addDot(marksBox, m, 'sh');
    addLink(links, m);
    addMarkRow(m, img);
  }

  const placed = marks.filter((m) => m.dist !== null);
  $('mk-n').textContent = placed.length
    ? `${new Set(placed.map((m) => m.labeler)).size} labeled`
    : 'no placements';
  $('spread').innerHTML = img._spread === null
    ? (img._skipConflict ? 'skip conflict' : 'single placement')
    : `spread <b class="num">${pct(img._spread)}</b>${img._skipConflict ? '<br>skip conflict' : ''}`;

  applyHover();
}

function addDot(box, m, which) {
  const xy = which === 'chin' ? m.chin : m.sh;
  if (!xy) return;
  const inferred = m[which === 'chin' ? 'chin_vis' : 'sh_vis'] === 'inferred';
  const d = document.createElement('div');
  d.className = 'pt ' + which + (m.machine ? ' machine' : '') + (inferred ? ' inferred' : '');
  d.dataset.who = m.labeler;
  d.style.left = `${xy[0] * 100}%`;
  d.style.top = `${xy[1] * 100}%`;
  if (which === 'sh' || inferred) d.style.borderColor = m.color;
  if (which === 'chin' && !inferred) d.style.background = m.color;
  box.appendChild(d);
}

// The chin→shoulder line. It makes the derived distance visible as a length
// rather than a number in the sidebar, which is the whole reason to look at
// the picture instead of the spreadsheet.
function addLink(svg, m) {
  if (!m.chin || !m.sh) return;
  const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  ln.setAttribute('x1', m.chin[0]); ln.setAttribute('y1', m.chin[1]);
  ln.setAttribute('x2', m.sh[0]);   ln.setAttribute('y2', m.sh[1]);
  ln.setAttribute('stroke', m.color);
  ln.setAttribute('stroke-opacity', m.machine ? '.5' : '.7');
  if (m.machine) ln.setAttribute('stroke-dasharray', '4 3');
  ln.dataset.who = m.labeler;
  svg.appendChild(ln);
}

function addMarkRow(m, img) {
  const row = document.createElement('div');
  row.className = 'mk' + (m.machine ? ' machine' : '') + (m.skipped ? ' skip' : '');
  row.dataset.who = m.labeler;

  const sw = document.createElement('span');
  sw.className = 'sw';
  sw.style.background = m.color;
  if (m.machine) { sw.style.borderRadius = '2px'; sw.style.rotate = '45deg'; }

  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.textContent = m.labeler + (m.rep ? ` (rep ${m.rep})` : '');

  const dv = document.createElement('span');
  dv.className = 'dv';
  dv.textContent = m.skipped ? (m.skip_reason || 'skipped') : fmtDist(m.dist);

  row.append(sw, nm);
  const tag = (cls, text, title) => {
    const t = document.createElement('span');
    t.className = 'tag ' + cls;
    t.textContent = text;
    t.title = title;
    row.appendChild(t);
  };
  if (m.chin_vis === 'inferred' || m.sh_vis === 'inferred') {
    const which = m.chin_vis === 'inferred' && m.sh_vis === 'inferred' ? 'both'
      : m.chin_vis === 'inferred' ? 'chin' : 'shoulder';
    tag('inf', which === 'both' ? 'inferred' : `${which} inf`,
        'Placed as a best estimate of occluded anatomy, not a sighting');
  }
  // A consulted row was saved after its labeler looked at everyone else's
  // points. It measures convergence, not independent judgement, and must not
  // be read as agreement.
  if (m.consulted) tag('con', 'consulted', 'Saved after opening the peers panel — not independent');
  if (m.flag) tag('flg', 'flagged', 'The labeler flagged this frame');
  row.appendChild(dv);

  row.onmouseenter = () => { state.hover = m.labeler; applyHover(); };
  row.onmouseleave = () => { state.hover = null; applyHover(); };
  $('mk-list').appendChild(row);
}

// Hovering a name lights that person's marks and dims the rest — twelve dots
// on one jaw is unreadable otherwise.
function applyHover() {
  const who = state.hover;
  for (const el of document.querySelectorAll('.pt, #links line')) {
    el.classList.toggle('dim', !!who && el.dataset.who !== who);
  }
}

function status(msg, cls) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = cls || '';
}

// ── who to compare ─────────────────────────────────────────────────────────
function renderWho() {
  const box = $('who-list');
  box.textContent = '';
  for (const l of state.labelers) {
    const row = document.createElement('label');
    row.className = 'who' + (state.selected.has(l.labeler) ? '' : ' off');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(l.labeler);
    cb.onchange = () => toggleLabeler(l.labeler, cb.checked);
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = state.colorOf.get(l.labeler);
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = l.labeler;
    const ct = document.createElement('span');
    ct.className = 'ct';
    ct.textContent = `${l.n}${l.skipped ? ` · ${l.skipped} skipped` : ''}`;
    row.append(cb, sw, nm, ct);
    row.onmouseenter = () => { state.hover = l.labeler; applyHover(); };
    row.onmouseleave = () => { state.hover = null; applyHover(); };
    box.appendChild(row);
  }
  $('who-n').textContent = `${state.selected.size} of ${state.labelers.length}`;
  const bits = [];
  if (state.unmatched) {
    bits.push(`${state.unmatched} sheet row${state.unmatched === 1 ? '' : 's'} `
              + 'point at frames not in this queue — labeled before a resample, or a stem the sheet stored as a date.');
  }
  $('who-note').textContent = bits.join(' ');
  $('who-note').className = 'note' + (state.unmatched ? ' warn' : '');
}

async function toggleLabeler(name, on) {
  if (on) state.selected.add(name); else state.selected.delete(name);
  try { localStorage.setItem(SEL_KEY, JSON.stringify([...state.selected])); } catch (e) {}
  renderWho();
  if (on && !state.rows.has(name)) {
    status(`Loading ${name}…`);
    try { await loadRows(name); status(''); }
    catch (e) {
      status(e.message, 'err');
      state.selected.delete(name);
      renderWho();
      return;
    }
  }
  state.i = 0;
  recompute();
}

// ── wiring ─────────────────────────────────────────────────────────────────
function go(delta) {
  if (!state.view.length) return;
  const n = state.view.length;
  state.i = (state.i + delta + n) % n;
  resetZoom();
  render();
}

function wire() {
  $('prev').onclick = () => go(-1);
  $('next').onclick = () => go(1);
  $('sort').onchange = (e) => { state.sort = e.target.value; state.i = 0; recompute(); };
  $('scope').onchange = (e) => { state.scope = e.target.value; state.i = 0; recompute(); };
  $('only-skip').onchange = (e) => { state.onlySkip = e.target.checked; state.i = 0; recompute(); };
  $('show-machine').onchange = (e) => { state.showMachine = e.target.checked; render(); };

  const card = $('stage-card');
  card.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.deltaY, e.clientX, e.clientY);
  }, { passive: false });
  card.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    state.drag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
    $('stage').classList.add('panning');
  });
  window.addEventListener('mousemove', (e) => {
    if (!state.drag) return;
    state.panX = state.drag.px + (e.clientX - state.drag.x);
    state.panY = state.drag.py + (e.clientY - state.drag.y);
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    state.drag = null;
    $('stage').classList.remove('panning');
  });
  card.addEventListener('dblclick', resetZoom);

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'r' || e.key === 'R') resetZoom();
    else if (e.key === 'm' || e.key === 'M') {
      state.showMachine = !state.showMachine;
      $('show-machine').checked = state.showMachine;
      render();
    }
  });

  for (const b of document.querySelectorAll('.idc')) {
    b.onclick = async () => {
      const text = $(b.dataset.copy).textContent;
      try { await navigator.clipboard.writeText(text); } catch (e) { return; }
      b.classList.add('copied');
      setTimeout(() => b.classList.remove('copied'), 900);
    };
  }
}

async function boot() {
  wire();
  applyTransform();
  try {
    await loadQueue();
  } catch (e) {
    $('stage-note').textContent = `Could not load queue.json — ${e.message}`;
    status(e.message, 'err');
    return;
  }
  try {
    await loadTeam();
  } catch (e) {
    $('who-note').textContent = `Could not load the team — ${e.message}`;
    $('who-note').className = 'note warn';
    $('stage-note').textContent = 'No labelers loaded.';
    return;
  }
  if (!state.labelers.length) {
    $('who-note').textContent = 'Nobody has saved a chin-point label yet.';
    $('stage-note').textContent = 'Nothing to review yet.';
    return;
  }

  // Restore the last selection; failing that compare the two busiest labelers,
  // which is the pair a reviewer almost always wants first.
  let want = [];
  try { want = JSON.parse(localStorage.getItem(SEL_KEY) || '[]'); } catch (e) {}
  const known = new Set(state.labelers.map((l) => l.labeler));
  want = want.filter((nm) => known.has(nm));
  if (!want.length) want = state.labelers.slice(0, 2).map((l) => l.labeler);
  for (const nm of want) state.selected.add(nm);
  renderWho();

  status('Loading labels…');
  const results = await Promise.allSettled(want.map((nm) => loadRows(nm)));
  const failed = results.filter((r) => r.status === 'rejected');
  status(failed.length ? failed[0].reason.message : '', failed.length ? 'err' : '');
  renderWho();
  recompute();
}

boot();

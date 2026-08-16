// review.js — chin-point 4.0 REVIEW. Read-only.
//
// The labeling page answers "what do I think of this frame". This page
// answers "where did everyone put their points, and where do they differ" —
// pick a set of labelers, walk the frames they share, see every placement on
// the picture at once.
//
// It writes NOTHING, and it is a SEPARATE PAGE on purpose. The labeling page
// used to carry its own peers panel; it was removed in 2026-08 so that a
// labeler cannot see anyone else's points, or the pipeline's, or how far the
// others have got — comparison while placing turns a second opinion into a
// copy of the first. All of that lives here instead, where the work is
// already done and looking is the whole point. Reads `listChinPoint` (per
// labeler, one call, every row); `peersChinPoint` is now unused by any page.
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
  mode: 'frames',          // 'frames' walks the pictures, 'stats' aggregates them
  sort: 'spread',
  scope: 'overlap',
  onlySkip: false,
  showMachine: true,
  // Which landmark is on the picture. Disagreement is per POINT — the summary
  // says whether the chin or the shoulder causes it, and this is how you go
  // look at just that one instead of reading it out of a pile of both.
  showChin: true,
  showSh: true,
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

// One retry for cold-start blips. The v4cb marker refuses a deployment that
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
    if (body.v4cb !== true) {
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
// the backend. Cached for the session — this page writes nothing, and a
// review pass is minutes long, so refetching per frame would only buy a
// chance at someone else's newer save at the price of a round trip each time.
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
        flag: r.flag === 1,
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
  // Stats read the whole corpus rather than the filtered view, but the
  // SELECTION moves them, and selection changes come through here.
  if (state.mode === 'stats') renderStats();
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

// ── stats mode ─────────────────────────────────────────────────────────────
// The frame view answers "where did everyone put their points on THIS frame".
// Stats answers it over the corpus: how far apart are two labelers on average,
// and — the part a median of absolute values throws away — in which DIRECTION.
//
// SIGN CONVENTION, stated once and used everywhere. y grows downward in image
// coordinates, so "higher on screen" is a SMALLER y. Every bias below is
// reported as `higher`-positive in torso units:
//
//   chinHigher(A vs B)  = (B.chin_y - A.chin_y) / torso
//   shHigher (A vs B)   = (B.sh_y   - A.sh_y)   / torso
//   derivedBias(A vs B) = A.dist - B.dist = chinHigher - shHigher
//
// That identity is exact, not an approximation, and it is the whole reason to
// report all three: a pair can disagree by 10% torso because one of them reads
// the chin higher, or because one reads the shoulder lower, and those are two
// different corrections to make. A bias near zero with a wide spread is noise —
// coaching won't move it; a bias that IS the spread is a definitional gap, and
// one conversation fixes it. The histogram is there so that distinction is
// visible rather than inferred.
//
// Everything is vertical, in torso units, for the reason given at the top of
// this file: no frame aspect ratio exists here, and the derived label is
// vertical anyway. Horizontal scatter is left to the picture.

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }

function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}

// Every selected labeler's rep-0-preferred placement on one image, plus the
// pipeline's. One pass feeds every table below.
function primariesFor(img, names) {
  const out = new Map();
  for (const nm of names) {
    const p = primary(nm, img);
    if (p) out.set(nm, p);
  }
  return out;
}

function pairFull(a, b) {
  const diffs = [], means = [], chin = [], sh = [], keys = [];
  for (const img of state.images) {
    const pa = primary(a, img), pb = primary(b, img);
    if (!pa || !pb) continue;
    diffs.push(pa.dist - pb.dist);
    means.push((pa.dist + pb.dist) / 2);
    chin.push((pb.chin[1] - pa.chin[1]) / img.torso_h);
    sh.push((pb.sh[1] - pa.sh[1]) / img.torso_h);
    keys.push(img.key);
  }
  const abs = diffs.map(Math.abs);
  const sd = stdev(diffs);
  const bias = mean(diffs);
  // Bland–Altman limits of agreement: the interval that should contain ~95% of
  // the differences between these two on a NEW frame. Bias is the systematic
  // half (who reads higher), the limits are the random half — and the limits
  // are what a labeling decision actually runs into, since frames are judged
  // one at a time, never on average.
  //
  // 1.96·SD assumes the differences are roughly normal, and the limits
  // themselves are estimates with their own error: below ~30 pairs they are
  // too wobbly to quote, which is why the page says so rather than printing a
  // confident-looking interval over six frames.
  const loa = sd === null ? null : { lo: bias - 1.96 * sd, hi: bias + 1.96 * sd };
  return {
    a, b, n: diffs.length, diffs, means, keys,
    meanAbs: mean(abs), med: median(abs), p90: quantile(abs, 0.9),
    sd, bias, loa, chinBias: mean(chin), shBias: mean(sh),
  };
}

// One labeler against the mean of everyone else on the same frame, and against
// the pipeline. The first says whether they are the outlier; the second is the
// calibration number the whole generation exists to produce.
function labelerFull(name, names) {
  const rowsByImage = state.rows.get(name) || new Map();
  let placed = 0, skipped = 0, inferred = 0, reps = 0;
  const reasons = new Map();
  const dwell = [];
  for (const rows of rowsByImage.values()) {
    for (const r of rows) {
      if (r.rep) reps++;
      if (r.skipped === 1) {
        skipped++;
        const why = r.skip_reason || 'unspecified';
        reasons.set(why, (reasons.get(why) || 0) + 1);
      } else if (r.chin_x !== null && r.chin_x !== undefined) {
        placed++;
        if (r.chin_vis === 'inferred' || r.sh_vis === 'inferred') inferred++;
      }
      if (r.dwell_sec) dwell.push(r.dwell_sec);
    }
  }

  const vsO = { d: [], chin: [], sh: [] };
  const vsM = { d: [], chin: [], sh: [] };
  for (const img of state.images) {
    const me = primary(name, img);
    if (!me) continue;
    const others = names.filter((nm) => nm !== name)
      .map((nm) => primary(nm, img)).filter(Boolean);
    if (others.length) {
      vsO.d.push(me.dist - mean(others.map((o) => o.dist)));
      vsO.chin.push((mean(others.map((o) => o.chin[1])) - me.chin[1]) / img.torso_h);
      vsO.sh.push((mean(others.map((o) => o.sh[1])) - me.sh[1]) / img.torso_h);
    }
    const mm = machineMark(img);
    if (mm.chin && mm.sh && mm.dist !== null) {
      vsM.d.push(me.dist - mm.dist);
      vsM.chin.push((mm.chin[1] - me.chin[1]) / img.torso_h);
      vsM.sh.push((mm.sh[1] - me.sh[1]) / img.torso_h);
    }
  }

  const self = selfStats(name);
  return {
    name, placed, skipped, inferred, reps,
    reasons: [...reasons].sort((x, y) => y[1] - x[1]),
    dwellMed: median(dwell), self,
    vsOthers: { n: vsO.d.length, d: mean(vsO.d), chin: mean(vsO.chin), sh: mean(vsO.sh) },
    vsMachine: { n: vsM.d.length, d: mean(vsM.d), chin: mean(vsM.chin), sh: mean(vsM.sh) },
  };
}

// Signed difference, ± a percentage of torso, with the sign spelled out. A bare
// "-0.04" invites exactly the misreading the sign convention above exists to
// prevent.
function signed(v) {
  if (v === null || v === undefined) return '—';
  const p = Math.round(v * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`;
}

function biasCell(v, posWord, negWord, minWord) {
  const td = document.createElement('td');
  if (v === null || v === undefined) { td.textContent = '—'; return td; }
  const wrap = document.createElement('span');
  wrap.className = 'bias';
  const num = document.createElement('span');
  num.className = 'n';
  num.textContent = signed(v);
  const w = document.createElement('span');
  w.className = 'w';
  // Under half a percent of torso height is a couple of pixels — calling that
  // a direction would dress up rounding noise as a finding.
  w.textContent = Math.abs(v) < 0.005 ? minWord : v > 0 ? posWord : negWord;
  wrap.append(num, w);
  td.appendChild(wrap);
  return td;
}

// ── Bland–Altman ───────────────────────────────────────────────────────────
// Difference (A − B) against the mean of the two, with bias and the 95% limits
// of agreement drawn. Bland & Altman's point in 1986 was that CORRELATION is
// the wrong tool for agreement — two labelers can correlate almost perfectly
// while one sits consistently higher than the other — so you look at the
// differences directly and split them into a systematic part (bias) and a
// random part (the limits).
//
// Plotting against the MEAN, rather than as a bare histogram, is what exposes
// PROPORTIONAL bias: if these two agree on tucked chins and diverge on exposed
// ones, the cloud fans out to one side instead of sitting in a band. That is a
// live possibility here and no summary number would show it.
//
// What the plot cannot tell you is whether the agreement is GOOD ENOUGH — that
// threshold comes from the use case (how much difference flips the coaching
// call), which is exactly the judgement 4.0 deferred by storing raw points.
const SVGNS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  return n;
}

function blandAltman(p, w = 420, h = 210) {
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'ba' });
  if (!p.n) return svg;

  const padL = 46, padR = 62, padT = 14, padB = 30;
  const plotW = w - padL - padR, plotH = h - padT - padB;

  const xs = p.means, ys = p.diffs;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const xPad = (xMax - xMin) * 0.08 || 0.02;
  const x0 = xMin - xPad, x1 = xMax + xPad;
  // The y range must always contain the limits, or the lines that give the
  // plot its meaning fall off the top of it.
  const yCands = [...ys, 0];
  if (p.loa) yCands.push(p.loa.lo, p.loa.hi);
  const yLim = Math.max(0.02, ...yCands.map(Math.abs)) * 1.15;

  const X = (v) => padL + ((v - x0) / (x1 - x0 || 1)) * plotW;
  const Y = (v) => padT + (1 - (v + yLim) / (2 * yLim)) * plotH;

  svg.appendChild(svgEl('rect', {
    x: padL, y: padT, width: plotW, height: plotH,
    fill: 'none', stroke: 'currentColor', 'stroke-opacity': '.15',
  }));

  // The band between the limits: where ~95% of future differences should land.
  if (p.loa) {
    svg.appendChild(svgEl('rect', {
      x: padL, y: Y(p.loa.hi), width: plotW, height: Math.max(1, Y(p.loa.lo) - Y(p.loa.hi)),
      fill: 'currentColor', 'stroke-opacity': '0', opacity: '.06',
    }));
  }

  const rule = (v, cls, dash) => {
    const ln = svgEl('line', {
      x1: padL, x2: padL + plotW, y1: Y(v), y2: Y(v),
      stroke: 'currentColor', 'stroke-width': cls === 'zero' ? 1 : 1.4,
      'stroke-opacity': cls === 'zero' ? '.3' : cls === 'bias' ? '.85' : '.5',
    });
    if (dash) ln.setAttribute('stroke-dasharray', dash);
    svg.appendChild(ln);
    const t = svgEl('text', {
      x: padL + plotW + 6, y: Y(v) + 3.5, fill: 'currentColor',
      'font-size': '10', 'fill-opacity': cls === 'zero' ? '.45' : '.75',
    });
    t.textContent = cls === 'zero' ? '0' : signed(v);
    svg.appendChild(t);
  };
  rule(0, 'zero');
  if (p.loa) { rule(p.loa.hi, 'loa', '4 3'); rule(p.loa.lo, 'loa', '4 3'); }
  rule(p.bias, 'bias');

  for (let i = 0; i < xs.length; i++) {
    const c = svgEl('circle', {
      cx: X(xs[i]).toFixed(1), cy: Y(ys[i]).toFixed(1), r: 3,
      fill: 'currentColor', opacity: '.5',
    });
    const ttl = svgEl('title');
    ttl.textContent = `mean ${signed(xs[i])} · difference ${signed(ys[i])}`;
    c.appendChild(ttl);
    svg.appendChild(c);
  }

  const axis = (x, y, text, anchor, rotate) => {
    const t = svgEl('text', {
      x, y, fill: 'currentColor', 'font-size': '10', 'fill-opacity': '.5',
      'text-anchor': anchor || 'start',
    });
    if (rotate) t.setAttribute('transform', `rotate(-90 ${x} ${y})`);
    t.textContent = text;
    svg.appendChild(t);
  };
  axis(padL + plotW / 2, h - 8, `mean of the two — ${signed(x0)} to ${signed(x1)} torso`, 'middle');
  axis(12, padT + plotH / 2, `difference (${p.a} − ${p.b})`, 'middle', true);
  return svg;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function whoCell(name) {
  const td = el('td');
  const d = el('div', 'who2');
  const sw = el('span', 'sw');
  sw.style.background = state.colorOf.get(name) || MACHINE_COLOR;
  d.append(sw, el('span', null, name));
  td.appendChild(d);
  return td;
}

// A table wide enough to overflow scrolls inside its own box; the prose and
// headings around it stay put.
function tableWrap(t) {
  const w = el('div', 'tw');
  w.appendChild(t);
  return w;
}

function section(parent, title, lede) {
  const s = el('div', 'sec');
  s.appendChild(el('h3', null, title));
  if (lede) s.appendChild(el('p', 'lede', lede));
  parent.appendChild(s);
  return s;
}

function renderStats() {
  const box = $('stats-card');
  box.textContent = '';
  const names = selectedNames();

  if (names.length < 1) {
    box.appendChild(el('p', 'empty', 'Pick labelers in the panel on the right.'));
    return;
  }

  // ── headline ────────────────────────────────────────────────────────────
  const pairs = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) pairs.push(pairFull(names[i], names[j]));
  }
  const scored = pairs.filter((p) => p.n);
  const allDiffs = scored.flatMap((p) => p.diffs);
  const overlapFrames = state.images.filter((img) =>
    names.filter((nm) => primary(nm, img)).length >= 2).length;
  const floors = names.map((nm) => selfStats(nm)).filter((s) => s.n);
  const floorMed = median(floors.flatMap((s) => [s.med]));

  const head = section(box, 'Overview',
    'Every number is the derived chin-above-shoulder distance in torso units — '
    + 'the quantity the pipeline consumes. Positive means the chin sits above the shoulder top.');
  const tiles = el('div');
  tiles.id = 'tiles';
  const tile = (v, k, warn) => {
    const t = el('div', 'tile' + (warn ? ' warn' : ''));
    t.append(el('div', 'v', v), el('div', 'k', k));
    tiles.appendChild(t);
  };
  tile(allDiffs.length ? pct(mean(allDiffs.map(Math.abs))) : '—', 'mean disagreement');
  tile(allDiffs.length ? pct(median(allDiffs.map(Math.abs))) : '—', 'median disagreement');
  tile(allDiffs.length ? pct(quantile(allDiffs.map(Math.abs), 0.9)) : '—', 'p90 — the tail');
  tile(floorMed === null ? '—' : pct(floorMed),
       floors.length ? 'noise floor (own repeats)' : 'no repeats labeled yet', floorMed === null);
  // n is the caveat that governs every other tile: the 4.0 README puts ~30
  // pairs as the point where these stop being directional.
  tile(String(overlapFrames), 'frames 2+ labeled', overlapFrames > 0 && overlapFrames < 30);
  head.appendChild(tiles);
  if (overlapFrames && overlapFrames < 30) {
    head.appendChild(el('p', 'lede',
      `Only ${overlapFrames} frame${overlapFrames === 1 ? '' : 's'} have two or more of these labelers on them. `
      + 'Treat everything below as directional at best — roughly 30 is where these numbers start to mean something.'));
  }

  // ── pairwise ────────────────────────────────────────────────────────────
  const ps = section(box, 'Between labelers',
    'Disagreement is |A − B|; bias is the signed average, so it says who reads what higher. '
    + 'Bias splits exactly: derived bias = chin bias − shoulder bias.');
  if (!scored.length) {
    ps.appendChild(el('p', 'empty', names.length < 2
      ? 'Pick a second labeler to compare.'
      : 'These labelers have no frames in common yet.'));
  } else {
    const t = el('table', 'st');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of ['Pair', 'n', 'Mean', 'Median', 'p90', 'SD', 'Derived bias',
                     '95% limits', 'Chin', 'Shoulder']) hr.appendChild(el('th', null, h));
    thead.appendChild(hr);
    t.appendChild(thead);
    const tb = el('tbody');
    for (const p of scored.sort((x, y) => y.meanAbs - x.meanAbs)) {
      const tr = el('tr');
      const td0 = el('td');
      const d = el('div', 'who2');
      const s1 = el('span', 'sw'); s1.style.background = state.colorOf.get(p.a);
      const s2 = el('span', 'sw'); s2.style.background = state.colorOf.get(p.b);
      d.append(s1, el('span', null, p.a), el('span', 'dim', 'vs'), s2, el('span', null, p.b));
      td0.appendChild(d);
      tr.appendChild(td0);
      tr.appendChild(el('td', 'n', String(p.n)));
      tr.appendChild(el('td', 'n', pct(p.meanAbs)));
      tr.appendChild(el('td', 'n', pct(p.med)));
      tr.appendChild(el('td', 'n', pct(p.p90)));
      tr.appendChild(el('td', 'n', pct(p.sd)));
      // "higher" here means the first-named labeler reads the chin as further
      // above the shoulder — a more exposed chin.
      tr.appendChild(biasCell(p.bias, `${p.a} reads higher`, `${p.b} reads higher`, 'no bias'));
      // The limits, not the bias, are what a single frame runs into.
      const tdl = el('td');
      if (p.loa) {
        const wrap = el('span', 'bias');
        wrap.append(el('span', 'n', `${signed(p.loa.lo)} … ${signed(p.loa.hi)}`),
                    el('span', 'w', p.n < 30 ? `only ${p.n} — indicative` : 'on a new frame'));
        tdl.appendChild(wrap);
      } else {
        tdl.textContent = '—';
      }
      tr.appendChild(tdl);
      tr.appendChild(biasCell(p.chinBias, `${p.a} chin higher`, `${p.b} chin higher`, 'matched'));
      tr.appendChild(biasCell(p.shBias, `${p.a} shoulder higher`, `${p.b} shoulder higher`, 'matched'));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    ps.appendChild(tableWrap(t));
    ps.appendChild(el('p', 'lede',
      'Bias is the systematic half — a definitional gap one conversation usually fixes. The 95% limits '
      + 'are the random half, and they are what a single frame actually runs into: judgement happens one '
      + 'frame at a time, never on average.'));

    // ── Bland–Altman, one per pair ────────────────────────────────────────
    const bs = section(box, 'Bland–Altman',
      'Each frame is one dot: the difference between the two labelers against what they averaged. '
      + 'Solid line is the bias, dashed are the 95% limits of agreement, shaded between. A flat band '
      + 'means they disagree the same amount everywhere; a cloud that fans out means they agree about '
      + 'one end of the range and not the other.');
    const CAP = 6;
    for (const p of scored.slice(0, CAP)) {
      const holder = el('div', 'bawrap');
      const cap = el('div', 'bacap');
      const sw1 = el('span', 'sw'); sw1.style.background = state.colorOf.get(p.a);
      const sw2 = el('span', 'sw'); sw2.style.background = state.colorOf.get(p.b);
      cap.append(sw1, el('span', null, p.a), el('span', 'dim', 'minus'),
                 sw2, el('span', null, p.b), el('span', 'dim', `${p.n} frames`));
      holder.append(cap, blandAltman(p));
      bs.appendChild(holder);
    }
    if (scored.length > CAP) {
      bs.appendChild(el('p', 'lede', `Showing ${CAP} of ${scored.length} pairs — narrow the selection for the rest.`));
    }
    bs.appendChild(el('p', 'lede',
      'The plot cannot say whether the agreement is good enough — that threshold comes from the use '
      + 'case, i.e. how much difference changes the coaching call. Storing raw points is what keeps '
      + 'that decision open.'));
  }

  // ── per labeler ─────────────────────────────────────────────────────────
  const ls = section(box, 'Each labeler',
    'Against the average of everyone else selected on the same frames, and against the pipeline — '
    + 'BlazePose\'s shoulder and the nose→mouth chin proxy. The pipeline column is the calibration '
    + 'the clicks exist to produce; it is not an error, since the proxy is what is being measured.');
  const lt = el('table', 'st');
  const lh = el('tr');
  for (const h of ['Labeler', 'Placed', 'Skipped', 'Inferred', 'Own repeats',
                   'vs others', 'chin', 'shoulder', 'vs pipeline', 'chin', 'shoulder'])
    lh.appendChild(el('th', null, h));
  const lthead = el('thead'); lthead.appendChild(lh); lt.appendChild(lthead);
  const ltb = el('tbody');
  for (const nm of names) {
    const s = labelerFull(nm, names);
    const tr = el('tr');
    tr.appendChild(whoCell(nm));
    tr.appendChild(el('td', 'n', String(s.placed)));
    const sk = el('td', 'n', s.skipped
      ? `${s.skipped} (${s.reasons.map(([w, c]) => `${w.replace('_', ' ')} ${c}`).join(', ')})`
      : '0');
    tr.appendChild(sk);
    tr.appendChild(el('td', 'n', s.placed ? `${Math.round((s.inferred / s.placed) * 100)}%` : '—'));
    tr.appendChild(el('td', 'n', s.self.n ? `${pct(s.self.med)} · ${s.self.n}` : '—'));
    tr.appendChild(biasCell(s.vsOthers.d, 'reads higher', 'reads lower', 'in line'));
    tr.appendChild(biasCell(s.vsOthers.chin, 'chin higher', 'chin lower', 'matched'));
    tr.appendChild(biasCell(s.vsOthers.sh, 'shoulder higher', 'shoulder lower', 'matched'));
    tr.appendChild(biasCell(s.vsMachine.d, 'reads higher', 'reads lower', 'in line'));
    tr.appendChild(biasCell(s.vsMachine.chin, 'above proxy', 'below proxy', 'matched'));
    tr.appendChild(biasCell(s.vsMachine.sh, 'above BlazePose', 'below BlazePose', 'matched'));
    ltb.appendChild(tr);
  }
  lt.appendChild(ltb);
  ls.appendChild(tableWrap(lt));
  ls.appendChild(el('p', 'lede',
    'Own repeats is the median gap between a labeler\'s two blind passes at the same frame, and its '
    + 'frame count. It is the floor: no pair above can agree more closely than this, and no model '
    + 'trained on these labels can beat it.'));

  // ── worst footage ───────────────────────────────────────────────────────
  const perVideo = new Map();
  for (const img of state.images) {
    const ps2 = names.map((nm) => primary(nm, img)).filter(Boolean);
    if (ps2.length < 2) continue;
    const ds = ps2.map((p) => p.dist);
    const spread = Math.max(...ds) - Math.min(...ds);
    if (!perVideo.has(img.stem)) perVideo.set(img.stem, []);
    perVideo.get(img.stem).push(spread);
  }
  const vs = section(box, 'Hardest footage',
    'Videos ranked by the average spread across their shared frames — where the footage itself, '
    + 'not the labeler, is the problem.');
  if (!perVideo.size) {
    vs.appendChild(el('p', 'empty', 'Nothing shared yet.'));
  } else {
    const rows = [...perVideo].map(([stem, xs]) => ({ stem, n: xs.length, m: mean(xs) }))
      .sort((a, b) => b.m - a.m);
    const CAP = 8;
    const vt = el('table', 'st');
    const vh = el('tr');
    for (const h of ['Video', 'Frames', 'Mean spread']) vh.appendChild(el('th', null, h));
    const vthead = el('thead'); vthead.appendChild(vh); vt.appendChild(vthead);
    const vtb = el('tbody');
    for (const r of rows.slice(0, CAP)) {
      const tr = el('tr');
      tr.appendChild(el('td', null, r.stem));
      tr.appendChild(el('td', 'n', String(r.n)));
      tr.appendChild(el('td', 'n', pct(r.m)));
      vtb.appendChild(tr);
    }
    vt.appendChild(vtb);
    vs.appendChild(tableWrap(vt));
    if (rows.length > CAP) {
      vs.appendChild(el('p', 'lede', `Showing the worst ${CAP} of ${rows.length} videos with shared frames.`));
    }
  }
}

function setMode(mode) {
  state.mode = mode;
  document.body.classList.toggle('stats', mode === 'stats');
  $('mode-frames').setAttribute('aria-pressed', String(mode === 'frames'));
  $('mode-stats').setAttribute('aria-pressed', String(mode === 'stats'));
  if (mode === 'stats') renderStats();
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
  // Named imgEl, not el: `el` is the element-builder helper used by the stats
  // tables, and shadowing it inside the busiest function here is a trap.
  const imgEl = $('frame');
  imgEl.classList.remove('broken');
  imgEl.onload = () => {
    if (token !== state.imgToken) return;
    if (imgEl.naturalWidth && imgEl.naturalHeight) {
      $('stage').style.aspectRatio = `${imgEl.naturalWidth} / ${imgEl.naturalHeight}`;
    }
  };
  imgEl.onerror = () => {
    if (token !== state.imgToken) return;
    imgEl.classList.add('broken');
    status(`Frame image missing — ${frameDir(img.stem)}/r${img.round}_f${img.frame}.jpg`, 'err');
  };
  imgEl.src = imgSrc(img);
  imgEl.alt = `${img.stem} round ${img.round} frame ${img.frame}`;

  $('id-video').textContent = img.stem;
  $('id-round').textContent = String(img.round);
  $('id-frame').textContent = String(img.frame);
  $('id-stance').textContent = `${img.stance || '—'} · lead ${String(img.shoulder || '—').toLowerCase()}`
    + (img.pts === undefined ? '' : ` · ${img.pts.toFixed(1)}s`);

  const marks = img._marks || marksFor(img);
  const drawn = state.showMachine ? [...marks, machineMark(img)] : marks;

  for (const m of drawn) {
    if (state.showChin) addDot(marksBox, m, 'chin');
    if (state.showSh) addDot(marksBox, m, 'sh');
    // The link is the derived distance drawn as a length, so it only means
    // anything while both of its ends are on the picture.
    if (state.showChin && state.showSh) addLink(links, m);
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
  // Shape carries the landmark, fill carries the visibility: a placed
  // sighting is solid, a guess is a dashed outline of the same shape.
  if (inferred) d.style.borderColor = m.color;
  else d.style.background = m.color;
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

// Turning both points off leaves a picture with nothing on it and no way to
// tell that from a frame nobody labeled, so the last one on stays on: asking
// for chin-only is a click on "shoulder", not a click on each in turn.
function setPointFilter(chin, sh) {
  state.showChin = chin || !sh;
  state.showSh = sh || !chin;
  $('show-chin').checked = state.showChin;
  $('show-sh').checked = state.showSh;
  render();
}

function wire() {
  $('mode-frames').onclick = () => setMode('frames');
  $('mode-stats').onclick = () => setMode('stats');
  $('prev').onclick = () => go(-1);
  $('next').onclick = () => go(1);
  $('sort').onchange = (e) => { state.sort = e.target.value; state.i = 0; recompute(); };
  $('scope').onchange = (e) => { state.scope = e.target.value; state.i = 0; recompute(); };
  $('only-skip').onchange = (e) => { state.onlySkip = e.target.checked; state.i = 0; recompute(); };
  $('show-machine').onchange = (e) => { state.showMachine = e.target.checked; render(); };
  $('show-chin').onchange = (e) => { setPointFilter(e.target.checked, state.showSh); };
  $('show-sh').onchange = (e) => { setPointFilter(state.showChin, e.target.checked); };

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
    if (e.key === 't' || e.key === 'T') setMode(state.mode === 'stats' ? 'frames' : 'stats');
    else if (state.mode === 'stats') return;   // the rest act on the frame view
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'r' || e.key === 'R') resetZoom();
    else if (e.key === 'm' || e.key === 'M') {
      state.showMachine = !state.showMachine;
      $('show-machine').checked = state.showMachine;
      render();
    }
    else if (e.key === 'c' || e.key === 'C') setPointFilter(!state.showChin, state.showSh);
    else if (e.key === 's' || e.key === 'S') setPointFilter(state.showChin, !state.showSh);
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

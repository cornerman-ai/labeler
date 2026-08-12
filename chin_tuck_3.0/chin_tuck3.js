// chin_tuck3.js — chin-tuck labeler 3.0.
//
// 2.0 with ONE question: is this an obvious bad chin tuck?
//
// Same frames, same queue, same order — this page reads 2.0's queue.json and
// 2.0's committed JPEGs rather than copies of them. That is not tidiness: the
// frames are 666MB against a 1GB GitHub Pages limit, so a second copy would not
// fit on the site at all. Moving or deleting chin_tuck_2.0/ breaks this page.
//
// Why one question. 2.0 asks where the chin sits relative to the shoulder and
// whether the two baked points are any good; the 2026-08 inter-rater run put
// three of its four below trainable. A single yes/no on the blatant cases
// trades resolution for a label people can actually agree on.
//
// NOTE the polarity. In 2.0 "yes" was always the good answer. Here "yes" means
// the tuck IS bad, so the option colours are flipped to match — red for yes —
// and every reading of this data has to remember which way round it is.
//
// One global stream of frames, videos mixed together. There is no video
// picker and no video name on screen: the labeler sees a count and a frame.
// Hiding the video is the point — in 1.0 the queue was per-video, so a run of
// 25 frames of the same person in the same gym invited answering from memory
// of the last frame rather than from this one.
//
// Position is derived from the labeler's own saved rows, never stored
// client-side, so any browser resumes in the same place.

'use strict';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';

const FIELDS = ['bad_tuck'];
const PREFETCH = 4;        // frames to warm ahead — see prefetch()
// A batch is 100 frames laid out as five rows of 20 — see the grid CSS, which
// pins the column count so this arithmetic is possible at all, and explains why
// 20 rather than the 23 that would merely fit.
const BATCH = 100;
const BATCH_COLS = 20;

// Zoom 1 = the frame fitted to the canvas. Going BELOW 1 shrinks the frame
// inside the canvas, which is what lets a labeler pull back and read the whole
// body — stance, guard, where the punch is going — instead of only the head.
// 1/3 makes the canvas about three times the frame at full zoom-out.
const MIN_ZOOM = 1 / 3;
const MAX_ZOOM = 12;
// Zoom is continuous in the wheel delta, not a fixed step per event: a mouse
// wheel sends one ~100px event per click while a trackpad sends a stream of
// small ones, so a per-event step makes the trackpad zoom explode.
const ZOOM_SPEED = 0.0018;  // 100px of wheel ≈ 1.20x

const TEAM_POLL_MS = 45000;   // how often the team panel refreshes

// Per generation: 2.0 and 3.0 have different rosters, so hiding a name in one
// must not hide it in the other.
const HIDE_KEY = 'cs_hidden_v3';
// Frame ranges survive a reload. One unfold costs a full read of somebody's tab
// — ~3.2s, and flat in the number of rows, so it is round-trip overhead rather
// than anything shrinking the payload could fix. The only way to make it fast
// is to not be making the request when the click happens.
const RANGE_KEY = 'cs_ranges_v3';
// A cached entry is shown even when the count has moved on: a labeler who has
// added eleven frames since has ranges that are still right about the other
// eight hundred, and a correct-but-slightly-short answer now beats a perfect one
// in three seconds. The refresh happens behind the displayed text.
const RANGE_FRESH_MS = 60000;   // don't re-read a tab more often than this

const EYE_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.6 8s2.3-3.8 6.4-3.8S14.4 8 14.4 8s-2.3 3.8-6.4 3.8S1.6 8 1.6 8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.7" stroke="currentColor" stroke-width="1.3"/></svg>';
const CHEV_SVG = '<svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2.5 4 5 6.5 7.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const state = {
  frames: [],              // queue.json order
  index: new Map(),        // key -> queue position, for "who is at #N"
  labels: new Map(),       // key -> saved row
  i: 0,
  answers: {},             // in-progress answers for the current frame
  skipped: false,
  zoom: 1, panX: 0, panY: 0,
  drag: null,
  ovScrolledTo: -1,        // last index the overview was scrolled to
  cmpGutter: null,        // the comparison grid's batch-number column
  loadingFor: null,        // name whose label list is in flight
  loadedFor: null,         // name whose labels are in state.labels
  loadToken: 0,            // guards against overlapping start() runs
  inflight: new Set(),     // keys whose save request is still open
  chains: new Map(),       // key -> promise chain, serialising same-frame saves
  failed: new Map(),       // key -> why its save failed
  teamRows: null,          // last team payload, mutated locally between polls
  teamTimer: null,         // debounce for the post-save team refresh
  cmpTimer: null,          // ... and the shorter one for the comparison grid
  overlapToken: 0,         // discards an overlap read that a newer one outran
  ready: false,            // this labeler's saved rows have arrived
  clueOpen: false,         // the clue panel is expanded
  clueCache: new Map(),    // key -> peer rows, so reopening costs nothing
  consulted: new Set(),    // frames whose clue was opened — see the CSS note
  flag: false,             // is this frame flagged for a second look
  shownAt: 0,              // when the current frame went on screen (ms)
  overlap: new Map(),      // frame key -> 'a' | 'p' | 'd' | 'o' (see cs2Overlap)
  overlapPeers: 0,         // how many other labelers existed when it was read
  hidden: new Set(),       // names this device hides from the team list
  openRanges: new Set(),   // team rows unfolded to show their frame ranges
  rangeCache: new Map(),   // labeler -> { n, ranges, at } (see loadRanges)
  rangePending: new Map(), // labeler -> in-flight promise, so two asks are one read
  rangesWarmed: false,     // the one unprompted warm has been scheduled
  leading: false,          // a lead-everyone request is in flight
  teamOpen: false,         // the everyone's-progress list is expanded
  pairA: null,             // the two labelers the comparison panel is set to
  pairB: null,
  agreeBusy: false,        // a comparison is being computed right now
  agreeBody: null,         // last agreement snapshot
  agreeAt: null,           // when it was taken
};

const $ = (id) => document.getElementById(id);

// The name is remembered per device: labeler_name.js keeps it in localStorage
// and pushes it back into #labeler-input, and we start on it without asking.
// This page used to clear the field on every load, on the theory that two people
// sharing a machine could inherit each other's name — but that cost everyone a
// re-entry on every single visit to guard against a case that has not happened.
// The restored name is not hidden: it sits in the field, green, and one edit
// changes it, so a second person on the same machine can still see whose it is.
function restoreName() {
  const el = $('labeler-input');
  if (!el || el.value.trim()) return;         // already filled by labeler_name.js
  let saved = null;
  try { saved = window.CMLabeler && window.CMLabeler.get && window.CMLabeler.get(); } catch (e) {}
  if (saved) el.value = saved;
}
const key = (f) => JSON.stringify([f.stem, f.round, f.frame]);

// Windows strips trailing dots/spaces from directory names, so the exporter
// sanitized them. Mirrors chin_export_frames.frame_dir() — keep in sync.
const frameDir = (stem) => stem.replace(/[. ]+$/, '');
// 2.0's frames, by relative path. See the note at the top: a copy would not fit
// inside the Pages size limit.
const DATA = '../chin_tuck_2.0/';
const imgSrc = (f) => `${DATA}frames/${encodeURIComponent(frameDir(f.stem))}/r${f.round}_f${f.frame}.jpg`;

// ── backend ────────────────────────────────────────────────────────────────
// The name lives in the shared top bar (labeler_name.js), which hides this
// input and keeps it synced. Reading it here means the page does not care
// whether the name arrived from the bar, localStorage, or an old ?labeler= URL.
function who() { return ($('labeler-input').value || '').trim(); }

function api(params) {
  const url = new URL(SCRIPT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// Apps Script occasionally answers a cold request with a redirect to a login
// page or an empty body; one retry turns that from a lost label into a blip.
//
// The `v2` check is not paranoia. doGet answers an action it does not know with
// {status:'ok', message:'Label receiver is running'} — so against a deployment
// that predates these endpoints, a SAVE looks successful, the page advances,
// and the frame is marked done while the sheet never received a row. Every v2
// response carries v2:true; without it we refuse the response outright.
async function call(params, what) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    let body;
    try {
      const res = await fetch(api(params), { redirect: 'follow' });
      body = await res.json();
    } catch (e) { last = e; continue; }              // network / bad JSON — retry
    if (body.status !== 'ok') {
      last = new Error(body.message || 'unknown error');
      continue;
    }
    // Not retryable: the deployment simply does not have this action.
    if (body.v3 !== true) {
      throw new Error('Apps Script is out of date — redeploy it '
                      + `(${params.action} fell through to the default handler)`);
    }
    return body;
  }
  throw new Error(`${what}: ${last && last.message}`);
}

// ── labels ─────────────────────────────────────────────────────────────────
function answered(row) {
  return FIELDS.filter((f) => row && row[f]).length;
}

// "Finished" = the question answered. A skip is not finished. With a single
// question there is no partially-answered state: a row either carries the
// answer or it exists only because the frame was flagged.
function isFinished(row) {
  return !!row && !row.skipped && answered(row) === FIELDS.length;
}

// A frame you are done with: every question answered, or deliberately skipped.
// A PARTIAL answer is not — it is the one state you still have to come back to,
// so counting it as progress would overstate how much is left.
function isResolved(row) {
  return isFinished(row) || !!(row && row.skipped);
}

// Saved rows whose frame is in the CURRENT queue. A tab can hold rows that are
// not: duplicates left by the date-stem bug, probe rows, anything from a queue
// that has since been rebuilt. They are real rows, so they load — but counting
// them as progress toward 3,791 overstates it, and it made "N done" disagree
// with the grids beside it, which iterate frames and so never saw them.
function myRowsInQueue() {
  const out = [];
  for (const [k, row] of state.labels) if (state.index.has(k)) out.push(row);
  return out;
}

async function loadLabels() {
  const name = who();
  // EVERYTHING per-labeler resets together. Miss one and it leaks across a
  // name switch: an inherited `consulted` set marks the next labeler's rows as
  // having seen answers they never saw — corrupting the column that exists to
  // tell independent judgements from calibrated ones — and an inherited clue
  // cache shows them a peer list computed for somebody else (filtered to
  // exclude the wrong person).
  state.labels = new Map();
  state.overlap = new Map();      // computed FOR the previous labeler
  state.overlapPeers = 0;
  state.consulted = new Set();
  state.clueCache = new Map();
  // Only the PREVIOUS labeler's own entry is name-relative (it was computed
  // from state.labels rather than fetched); everybody else's is a fact about
  // their tab and survives, which is what makes a reload or a name change
  // instant instead of another round of reads.
  state.rangeCache = loadRangeCache();
  state.rangePending = new Map();
  // Case-insensitively: the cache is keyed by the sheet's title-cased name and
  // `name` is whatever was typed into the box.
  for (const k of [...state.rangeCache.keys()]) {
    if (k.toLowerCase() === name.toLowerCase()) state.rangeCache.delete(k);
  }
  state.openRanges = new Set();
  state.failed = new Map();
  state.flag = false;
  state.agreeBody = null;      // computed for whichever pair was last picked
  state.agreeAt = null;
  state.pairA = null;          // default the picker to the new name
  state.pairB = null;
  setAgreeOpen(false);
  if (!name) return;
  const body = await call({ action: 'listChinTuck3', labeler: name }, 'load labels');
  for (const r of (body.rows || [])) {
    const k = JSON.stringify([r.video, r.round, r.frame]);
    state.labels.set(k, r);
    // The flag lives in the sheet, so a reload — or a different machine — still
    // knows which frames were answered after looking at the team's answers.
    if (r.consulted) state.consulted.add(k);
  }
}

// Saving is OPTIMISTIC: the local row is recorded and the labeler moves on
// immediately while the request finishes in the background.
//
// A round trip to Apps Script costs ~2s for a read and ~5s for a write, and
// none of that is work the labeler should watch. Blocking on it made every
// frame a five-second pause — at 3,791 frames that is over five hours of
// waiting. The cost of optimism is that a failure surfaces AFTER the labeler
// has moved on, so a failed frame is rolled back out of state.labels, painted
// red in the overview, and named in the status line.
// A single look at a frame, in seconds. Capped because the clock cannot tell
// deliberation from a tab left open over lunch, and one abandoned afternoon
// would otherwise dominate every average taken over the column. Two minutes is
// far beyond any real decision here and still keeps the hard frames legible.
const DWELL_CAP_SEC = 120;

function dwellFor(k) {
  const prior = state.labels.get(k);
  const before = (prior && Number(prior.dwell_sec)) || 0;
  const seg = state.shownAt ? (Date.now() - state.shownAt) / 1000 : 0;
  return Math.round((before + Math.min(Math.max(seg, 0), DWELL_CAP_SEC)) * 10) / 10;
}

function save({ skip = false } = {}) {
  if (!state.ready) return false;
  const name = who();
  if (!name) { status('Enter your name first', 'err'); $('labeler-input').focus(); return false; }
  const f = state.frames[state.i];
  const k = key(f);
  const dwell = dwellFor(k);
  // Restart the segment so a second save on this frame — toggling the flag
  // after answering — adds only the time since the first, never the same
  // seconds twice.
  state.shownAt = Date.now();
  const params = {
    action: 'saveChinTuck3', labeler: name,
    video: f.stem, round: String(f.round), frame: String(f.frame),
    frame_sec: String(f.pts), stance: f.stance,
    shoulder_used: f.shoulder,
    skipped: skip ? '1' : '0',
    consulted: state.consulted.has(k) ? '1' : '0',
    flag: state.flag ? '1' : '0',
    dwell_sec: String(dwell),
  };
  // A skip is the absence of a judgement, so it never carries answers — the
  // backend rejects rows that hold both.
  for (const fld of FIELDS) params[fld] = skip ? '' : (state.answers[fld] || '');

  const row = {
    video: f.stem, round: f.round, frame: f.frame, skipped: skip ? 1 : 0,
    consulted: state.consulted.has(k) ? 1 : 0,
    flag: state.flag ? 1 : 0,
    dwell_sec: dwell,
    ...Object.fromEntries(FIELDS.map((fld) => [fld, skip ? null : (state.answers[fld] || null)])),
  };
  const prev = state.labels.get(k);
  state.labels.set(k, row);
  state.failed.delete(k);
  state.inflight.add(k);
  showQueueState();
  bumpMyTeamRow();          // your row moves now, not in 45 seconds

  // Requests for the SAME frame are chained, not fired in parallel. Two saves
  // for one frame — answer it, navigate back, change it — would otherwise race,
  // and the sheet keeps whichever HTTP response happens to land last rather
  // than the answer given last. Different frames still overlap freely, which is
  // where the speed comes from.
  const chain = (state.chains.get(k) || Promise.resolve())
    .then(() => call(params, 'save'))
    .then(() => {
      state.inflight.delete(k);
      state.clueCache.delete(k);   // this frame's peer view is now stale
      showQueueState();
      scheduleTeamRefresh();
    })
    .catch((e) => {
      state.inflight.delete(k);
      // Put the row back the way it was so the frame reads as unsaved again.
      if (prev) state.labels.set(k, prev); else state.labels.delete(k);
      state.failed.set(k, e.message);
      bumpMyTeamRow();      // the row was rolled back — the count must follow
      const at = state.index.get(k);
      status(`Frame #${at === undefined ? '?' : at + 1} did not save — ${e.message}`, 'err');
      render();
    })
    .finally(() => { if (state.chains.get(k) === chain) state.chains.delete(k); });
  state.chains.set(k, chain);
  return true;
}

// Answering is only allowed once the labeler's own rows are in hand — see the
// CSS note on #q-lock. The keyboard is gated separately, since CSS
// pointer-events cannot stop a keydown.
// Gates every control that acts on a frame. The frame itself is never hidden:
// the list can take 20+ seconds when Apps Script is cold, and a blacked-out
// stage for that long is indistinguishable from a broken tool, so the labeler
// can look and zoom while they wait — they just cannot answer yet.
function setReady(on, note, isError) {
  state.ready = !!on;
  renderNameState();
  syncPanelButtons();
  document.body.classList.toggle('ready', state.ready);
  $('q-lock').textContent = note || '';
  $('q-lock').classList.toggle('err', !!isError);
  $('q-lock').style.display = note ? 'block' : 'none';
}

// One line for everything in flight or broken, so a labeler moving fast still
// sees that something is behind them.
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
// "Unlabeled" = no saved row at all. A partially answered frame counts as
// labeled so the queue keeps moving; the overview paints it amber so it stays
// findable instead of silently vanishing.
function firstUnlabeled(from = 0) {
  for (let i = from; i < state.frames.length; i++) {
    if (!state.labels.has(key(state.frames[i]))) return i;
  }
  return -1;
}

function go(i) {
  state.i = Math.max(0, Math.min(state.frames.length - 1, i));
  // Always back to fitted: carrying a zoom across frames would leave the next
  // one showing a corner of a body with no way to know it.
  resetZoom();
  const f = state.frames[state.i];
  const saved = state.labels.get(key(f));
  state.answers = {};
  state.flag = !!(saved && saved.flag);
  state.skipped = !!(saved && saved.skipped);
  if (saved && !saved.skipped) {
    for (const fld of FIELDS) if (saved[fld]) state.answers[fld] = saved[fld];
  }
  resetClue();
  // Starts the clock for dwell_sec. Set here rather than on image load: the
  // question is how long the labeler spent deciding, and their attention moves
  // to the frame the moment it is asked for.
  state.shownAt = Date.now();
  render();
  prefetch();
}

// Consecutive frames come from different videos, so nothing is warm in cache.
// Four ahead covers a fast labeler without stampeding the connection.
function prefetch() {
  for (let n = 1; n <= PREFETCH; n++) {
    const f = state.frames[state.i + n];
    if (f) new Image().src = imgSrc(f);
  }
}

// ── rendering ──────────────────────────────────────────────────────────────
function render() {
  const n = state.frames.length;
  if (!n) return;              // queue.json failed to load — nothing to draw
  const f = state.frames[state.i];

  $('count').innerHTML = `${state.i + 1}<small> / ${n}</small>`;
  const resolved = myRowsInQueue().filter(isResolved).length;
  $('done').textContent = `${resolved} done`;

  const img = $('frame');
  if (img.dataset.k !== key(f)) { img.dataset.k = key(f); img.src = imgSrc(f); }

  for (const b of document.querySelectorAll('.opt')) {
    b.setAttribute('aria-pressed', String(state.answers[b.dataset.q] === b.dataset.v));
  }
  $('skip').setAttribute('aria-pressed', String(state.skipped));
  syncPanelButtons();
  renderFlag();
  $('save').disabled = state.skipped;

  placeMarks();
  renderOverview();
}

// Points are positioned in percentages of the rendered image, so they track
// zoom, pan and any window size without recomputation.
function placeMarks() {
  const f = state.frames[state.i];
  const pct = (p) => ({ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` });
  Object.assign($('p-chin').style, pct(f.chin));
  Object.assign($('p-l').style, pct(f.joints.l_sh));
  Object.assign($('p-r').style, pct(f.joints.r_sh));
  // Lower-cased rather than compared literally: the ring marking which shoulder
  // the questions are about must not silently switch off if the manifest's
  // casing ever changes again.
  const side = String(f.shoulder || '').toLowerCase();
  $('p-l').classList.toggle('used', side === 'left');
  $('p-r').classList.toggle('used', side === 'right');

  // Frames are not all the same shape (portrait phone clips next to 16:9
  // uploads), so the stage takes each frame's own ratio. This is what keeps
  // the marker overlay and the image the same box — see the CSS note.
  const img = $('frame');
  if (img.naturalWidth && img.naturalHeight) {
    $('stage').style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  }
}

// Scroll a dot into view WITHOUT touching anything above it in the tree.
// scrollIntoView cannot do this: it walks every scrollable ancestor, and #side
// is one — so bringing a dot into its own grid also scrolled the entire right
// panel, yanking the questions away mid-answer on every frame change. Moving
// grid.scrollTop by hand is the whole fix; nothing else can move.
function keepInView(grid, i) {
  const el = grid.children[i];
  if (!el) return;
  // The wrapper scrolls, not the grid: the batch numbers live beside the dots
  // inside it and have to move with them.
  const sc = grid.parentElement;
  const g = sc.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  if (e.top < g.top) sc.scrollTop += e.top - g.top;
  else if (e.bottom > g.bottom) sc.scrollTop += e.bottom - g.bottom;
}

// How each of my finished frames sits against everyone else's answers. Read
// alongside the team panel rather than before the labels, because the grid is
// background information: it costs a full pass over every labeler tab, and
// nothing on screen has to wait for it.
// TWO verdicts, not three. With one yes/no there is no useful middle: either
// everybody who did this frame answered as you did, or somebody did not — and
// "somebody did not" is the whole signal, whether it is one peer or all of them.
// So the endpoint's 'p' (some peers matched, some did not) is painted the same
// red as 'd' (none matched). It still reports both, and the tooltip still tells
// them apart; only the colour is collapsed, because a labeler scanning the grid
// for frames worth re-examining wants one question answered, not two.
//
// 'o' stays grey and separate. A frame nobody else has reached is not agreement
// and not disagreement — painting it either way would assert something untrue.
const CMP_CLASS = { a: 'agree', p: 'dis', d: 'dis', o: 'alone' };
const CMP_TITLE = {
  a: 'everyone who did this frame answered the same',
  p: 'at least one labeler answered differently',
  d: 'nobody who did this frame agrees with you',
  o: 'only you have finished this frame',
};

async function loadOverlap() {
  const name = who();
  if (!name) return;
  // Two of these can easily be in flight at once — the 600ms post-save refresh
  // and the 45s poll — and they do not come back in the order they were sent.
  // Without a token, a read that STARTED before your save could land after it
  // and overwrite the fresh map with pre-save verdicts, so the frame you just
  // answered lost its colour until something else happened to refresh it.
  const token = ++state.overlapToken;
  let body;
  try {
    body = await call({ action: 'overlapChinTuck3', labeler: name }, 'comparison');
  } catch (e) {
    return;                     // silent: the other two grids are still correct
  }
  if (token !== state.overlapToken) return;   // a newer read already answered
  if (name !== who()) return;   // the name changed while we were reading
  const m = new Map();
  for (const r of (body.rows || [])) m.set(JSON.stringify([r[0], r[1], r[2]]), r[3]);
  state.overlap = m;
  state.overlapPeers = body.peers || 0;
  renderOverview();
}

// One dot per frame. 3,791 dots is a legible density; a scrolling list of rows
// at that length is not.
function renderOverview() {
  const ov = $('ov');
  const fg = $('ov-flags');
  // Two grids over the same queue in the same order: label state above,
  // flagged-or-not below. Built together so a position means the same thing in
  // both and the eye can move straight down.
  const cg = $('ov-cmp');
  if (ov.childElementCount !== state.frames.length) {
    // The marker goes on the FIRST row of each batch — every dot of it, since a
    // margin on one grid item only moves that item — and never on the very
    // first batch, which needs no gap above it.
    const mk = () => state.frames.map((_, i) => {
      const el = document.createElement('i');
      if (i >= BATCH && i % BATCH < BATCH_COLS) el.dataset.batch = '1';
      el.onclick = () => go(i);
      return el;
    });
    // Heights are derived from the same geometry the dots use — 25 per row,
    // 9px tall, 3px apart — so a label cannot drift out of step with its batch.
    const numbers = () => {
      const col = document.createDocumentFragment();
      for (let b = 0; b * BATCH < state.frames.length; b++) {
        const count = Math.min(BATCH, state.frames.length - b * BATCH);
        const rows = Math.ceil(count / BATCH_COLS);
        const n = document.createElement('b');
        const num = document.createElement('span');
        num.textContent = b + 1;
        const dis = document.createElement('span');
        dis.className = 'ovn-d';
        n.append(num, dis);
        n.style.height = `${rows * 9 + (rows - 1) * 3}px`;
        n.style.lineHeight = '9px';
        // 10px, not the 7px the dots' margin adds: the pitch between batches is
        // that margin PLUS the 3px row gap the grid puts between any two rows.
        // Leaving the gap out drifted every label 3px further off than the last.
        if (b) n.style.marginTop = '10px';
        n.title = `frames ${b * BATCH + 1}\u2013${b * BATCH + count}`;
        col.appendChild(n);
      }
      return col;
    };
    for (const w of document.querySelectorAll('.ovn')) w.replaceChildren(numbers());
    // Only the comparison grid's gutter gets filled in below; the other two are
    // built from the same function so a batch label cannot drift between grids.
    state.cmpGutter = cg.parentElement.querySelector('.ovn');
    ov.replaceChildren(...mk());
    fg.replaceChildren(...mk());
    cg.replaceChildren(...mk());
  }
  let flagged = 0;
  let compared = 0;
  // One slot per batch of 100. Counted in the same pass that paints the dots, so
  // the numbers cannot say something different from the colours beside them —
  // and they refresh whenever anything does: an answer, a skip, the 45s poll,
  // the read that lands 600ms after a save.
  const disPerBatch = new Array(Math.ceil(state.frames.length / BATCH)).fill(0);
  state.frames.forEach((f, i) => {
    const row = state.labels.get(key(f));
    const el = ov.children[i];
    const k = key(f);
    // No 'part' arm: with one question a row is answered or it is not. A row
    // with no answer exists only because the frame was flagged, and flagged is
    // the grid below, not this one.
    el.className = state.failed.has(k) ? 'fail'
      : !row ? '' : row.skipped ? 'skip'
      : isFinished(row) ? 'done' : '';
    el.classList.toggle('here', i === state.i);
    el.title = `#${i + 1}`;

    const isFlag = !!(row && row.flag);
    if (isFlag) flagged++;
    const fe = fg.children[i];
    fe.className = isFlag ? 'flag' : '';
    fe.classList.toggle('here', i === state.i);
    fe.title = `#${i + 1}` + (isFlag ? ' · flagged' : '');

    // Blank until the read lands, and blank forever for frames you have not
    // judged — there is no answer of yours to compare with. A SKIP counts as
    // judged, so skipped frames are coloured here like any other.
    const v = state.overlap.get(k);
    if (v && v !== 'o') compared++;
    // Both 'p' and 'd' — anyone answering differently is a disagreement, whether
    // they differ on one question or on all of them. That is the same set the
    // grid paints as not-green-not-grey, so the count and the colours agree.
    if (v === 'p' || v === 'd') disPerBatch[Math.floor(i / BATCH)]++;
    const ce = cg.children[i];
    ce.className = CMP_CLASS[v] || '';
    ce.classList.toggle('here', i === state.i);
    ce.title = `#${i + 1}` + (v ? ' · ' + CMP_TITLE[v] : '');
  });
  if (state.cmpGutter) {
    disPerBatch.forEach((n, b) => {
      const cell = state.cmpGutter.children[b];
      if (!cell) return;
      const out = cell.lastElementChild;
      out.textContent = n ? String(n) : '';
      cell.title = `frames ${b * BATCH + 1}\u2013`
        + `${Math.min((b + 1) * BATCH, state.frames.length)}`
        + (n ? ` \u00b7 ${n} disagree` : '');
    });
  }
  $('ov-sub-n').textContent = `${flagged} flagged`;
  // Counts frames somebody else has ALSO finished — the ones the colours above
  // are actually saying something about. "only you" is not a comparison.
  $('ov-cmp-n').textContent = state.overlap.size
    ? `${compared} compared` : '— compared';
  // Only scroll when the position actually moved. render() also runs on every
  // answer click, and scrolling the overview under the cursor each time a
  // labeler picks yes/no is disorienting.
  if (state.ovScrolledTo !== state.i) {
    state.ovScrolledTo = state.i;
    for (const grid of [ov, fg, cg]) keepInView(grid, state.i);
  }
}

// ── team ───────────────────────────────────────────────────────────────────
// Nothing reports presence, so "where someone is" is derived from the frame
// they saved most recently. That is a last-known position, not a live cursor —
// worth remembering before reading two labelers as working the same frame.
async function loadTeam() {
  let rows;
  try {
    rows = (await call({ action: 'statsChinTuck3' }, 'team')).labelers;
  } catch (e) {
    // Never an error banner — the team panel is background information and a
    // failed poll must not sit on top of the labeler's status line. It does say
    // so in place, though, rather than silently showing a stale or empty list.
    $('team').innerHTML = '<div id="team-empty"></div>';
    $('team').firstElementChild.textContent = e.message;
    return;
  }
  renderTeam(rows);
  prefetchRanges();       // names the poll just learned about, warmed in parallel
  // ONE unprompted warm per session, whether or not the panel is open — the
  // first open of the day is otherwise the one that still waits, and the disk
  // cache makes every open after it free. Delayed so it queues behind the
  // frames and the first few saves rather than competing with them: Apps
  // Script gives a single user very little concurrency, so three tab reads
  // fired at load would be three saves' worth of delay.
  if (!state.rangesWarmed) {
    state.rangesWarmed = true;
    setTimeout(() => prefetchRanges(true), 8000);
  }
  // Overlay your own authoritative local numbers on top of the server's. The
  // stats read is cached for 60s server-side, so a refresh right after a burst
  // of saves can answer with pre-save counts — and the row would visibly count
  // BACKWARDS. state.labels is the same source the overview is drawn from, so
  // for your own row it is never wrong.
  if (state.ready && who()) bumpMyTeamRow();
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

// Folded like the comparison panel, and for the same reason: it answers a
// question you ask between stretches of labeling, not one you watch. The button
// carries the head count so the common question — how many of us are on this —
// needs no click at all.
function setTeamOpen(open) {
  state.teamOpen = !!open;
  $('team').classList.toggle('on', state.teamOpen);
  $('team-btn').setAttribute('aria-expanded', String(state.teamOpen));
  renderTeamLabel();
  if (state.teamOpen) prefetchRanges();
}

// Consecutive queue positions collapse into one run, so "1-100, 401-1100" is
// three facts rather than eleven hundred.
function frameRuns(indices) {
  const s = [...indices].sort((a, b) => a - b);
  const out = [];
  let start = null, prev = null;
  for (const i of s) {
    if (start === null) { start = prev = i; continue; }
    if (i === prev) continue;                  // a duplicate row for one frame
    if (i === prev + 1) { prev = i; continue; }
    out.push([start, prev]);
    start = prev = i;
  }
  if (start !== null) out.push([start, prev]);
  return out;
}

// Interval notation rather than a dash, because the dash left it open whether
// the second number was the last frame done or the first one after it. Closed
// on both sides: every number printed is a frame the labeler actually did.
// No thousands separators inside an interval — the comma in there is already
// the endpoint separator, and "[401, 1,100]" reads as three numbers.
function fmtRanges(runs) {
  return runs.map(([a, b]) => `[${a + 1}, ${b + 1}]`).join('  ·  ');
}

// Ranges are positions in the CURRENT queue, so a rebuilt queue makes every
// stored entry meaningless — the length is carried as a cheap version stamp and
// a mismatch drops the lot. Errors are never stored: a fetch that failed once is
// worth retrying next session, unlike an answer that is merely a little stale.
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
    localStorage.setItem(RANGE_KEY,
      JSON.stringify({ q: state.frames.length, by: by }));
  } catch (e) {}                                 // quota — the cache is a luxury
}

// Warm every visible row at once. The reads are independent and Apps Script
// serves them in parallel, so the whole team costs about what one labeler does;
// doing it when the panel OPENS rather than when a name is clicked is what turns
// a three-second wait into none. Only rows with nothing cached at all — a stale
// entry is already on screen and revalidates on its own schedule.
function prefetchRanges(force) {
  if ((!state.teamOpen && !force) || !state.frames.length) return;
  const me = (who() || '').toLowerCase();
  for (const r of (state.teamRows || [])) {
    const k = r.labeler.toLowerCase();
    if (k !== me && state.hidden.has(k)) continue;
    if (state.rangeCache.has(r.labeler)) continue;
    loadRanges(r.labeler, r.n).then(() => renderTeam(state.teamRows || []));
  }
}

// Fetched only for rows the panel is actually showing — this is a full read of
// one labeler's tab, far too much to pull on the 45s poll.
async function loadRanges(labeler, n) {
  const inflight = state.rangePending.get(labeler);
  if (inflight) return inflight;                 // a click during a prefetch
  const p = fetchRanges(labeler, n).finally(() => state.rangePending.delete(labeler));
  state.rangePending.set(labeler, p);
  return p;
}

async function fetchRanges(labeler, n) {
  let rows;
  try {
    if (labeler.toLowerCase() === (who() || '').toLowerCase()) {
      rows = myRowsInQueue();                  // already in hand, no request
    } else {
      const body = await call({ action: 'listChinTuck3', labeler }, 'frames');
      rows = body.rows || [];
    }
  } catch (e) {
    // An error must never overwrite ranges already on screen — but the ATTEMPT
    // is always stamped, on the old entry if there is one. Without that, a
    // refresh failing behind good ranges leaves `at` ancient, and since every
    // attempt repaints, the repaint would immediately fire the next attempt.
    const had = state.rangeCache.get(labeler);
    state.rangeCache.set(labeler, had
      ? Object.assign({}, had, { at: Date.now() })
      : { n, ranges: [], at: Date.now(), error: e.message });
    return;
  }
  const idx = [];
  for (const r of rows) {
    if (!isResolved(r)) continue;              // same set the count is over
    const i = state.index.get(JSON.stringify([r.video, r.round, r.frame]));
    if (i !== undefined) idx.push(i);          // rows outside the queue are not shown
  }
  state.rangeCache.set(labeler, { n, ranges: frameRuns(idx), at: Date.now() });
  saveRangeCache();
}

// ── lead everyone ──────────────────────────────────────────────────────────
// My answers overwrite everybody else's, on the frames I have answered. Frames
// they have answered and I have not are left alone.
//
// This is the one thing in the tool that writes to somebody else's tab, and it
// keeps NOTHING: no backup sheet, no column marking the row as led. The
// overwritten answer is gone. The dialog exists because that is irreversible,
// and it carries the real numbers rather than a generic warning — the count is
// the difference between a labeler who knows what they are about to do and one
// who does not.
//
// Worth knowing: agreement between two labelers is what this tool measures, and
// afterwards the led rows agree with the caller by construction with nothing in
// the sheet to say so. Take the agreement numbers before leading.
function askLead() {
  if (!who() || state.leading) return;
  const others = (state.teamRows || [])
    .filter((r) => r.labeler.toLowerCase() !== who().toLowerCase())
    .map((r) => r.labeler);
  if (!others.length) return;
  const n = myRowsInQueue().filter(isResolved).length;
  const list = others.length === 1 ? others[0]
    : others.slice(0, -1).join(', ') + ' and ' + others[others.length - 1];
  $('lead-what').innerHTML =
    `Your <b>${n.toLocaleString()}</b> answered frames will replace whatever `
    + `<b>${list}</b> have on those frames. Where they have nothing, a row is `
    + 'created for them.';
  $('lead-keep').textContent =
    'Frames they have answered and you have not are left alone. So are their '
    + 'flags and their time spent. Everything else is overwritten, and their '
    + 'old answers are not kept anywhere.';
  $('lead-mask').hidden = false;
  $('lead-cancel').focus();
}

function closeLead() {
  $('lead-mask').hidden = true;
  $('lead-go').disabled = false;
  $('lead-go').textContent = 'Overwrite';
}

async function doLead() {
  if (state.leading) return;
  state.leading = true;
  $('lead-go').disabled = true;
  $('lead-go').textContent = 'Overwriting\u2026';
  try {
    // NOT call(): that retries once on a failed response, and this is the only
    // request in the page that changes somebody else's data. Re-running it is
    // harmless to the answers — it writes the same values — but the retry would
    // land after the backup already exists, so a first attempt that half
    // succeeded would be finished by a second that could no longer be undone.
    const res = await fetch(api({ action: 'leadEveryoneChinTuck3', labeler: who() }),
                            { redirect: 'follow' });
    const body = await res.json();
    if (body.status !== 'ok') throw new Error(body.message || 'unknown error');
    if (body.v3 !== true) throw new Error('Apps Script is out of date — redeploy it');
    const led = body.led || [];
    const touched = led.reduce((a, x) => a + (x.updated || 0) + (x.added || 0), 0);
    status(led.length
      ? `Led ${led.length} labeler${led.length > 1 ? 's' : ''} — `
        + `${touched.toLocaleString()} rows now carry your answers`
      : 'Nothing to lead');
    closeLead();
    // Their counts, the comparison grid and their ranges have all just moved.
    state.rangeCache = new Map();
    saveRangeCache();
    await loadTeam();
    loadOverlap();
  } catch (e) {
    status('Lead failed: ' + e.message, 'err');
    closeLead();
  } finally {
    state.leading = false;
    renderTeam(state.teamRows || []);
  }
}

function renderTeamLabel() {
  const n = (state.teamRows || []).length;
  $('team-label').textContent = state.teamOpen
    ? 'Hide progress'
    : (n ? `Everyone's progress (${n})` : "Everyone's progress");
}

// Names this device has hidden from the progress list. A VIEW preference, so it
// lives in localStorage and never reaches the sheet — one person tidying their
// own list must not change what anybody else sees.
//
// Scoped to the list and nothing else. Hidden labelers still count in the
// comparison picker, the clue panel and every agreement/overlap verdict: those
// are facts about the frames, and letting a cosmetic toggle move them would
// make a green dot mean different things on different machines.
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
  renderTeam(state.teamRows || []);
}

function renderTeam(rows) {
  state.teamRows = rows;
  renderTeamLabel();
  const el = $('team');
  if (!rows || !rows.length) {
    el.innerHTML = '<div id="team-empty">No labels saved yet</div>';
    return;
  }
  const me = who().toLowerCase();
  const n = state.frames.length;

  // You can never hide yourself: your own progress is the one row that is
  // always relevant, and a missing "me" row would read as a bug rather than a
  // choice. Counted over PRESENT rows only, so names hidden long ago that have
  // since stopped labeling do not inflate the tally.
  const isMe = (r) => r.labeler.toLowerCase() === me;
  const shown = rows.filter((r) => isMe(r) || !state.hidden.has(r.labeler.toLowerCase()));
  const hiddenNow = rows.length - shown.length;

  // #team is the grid, so each labeler contributes cells directly to it rather
  // than a wrapper — a wrapper would become the grid item and the columns
  // would stop lining up between labelers.
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
      renderTeam(state.teamRows || []);
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
    const fill = document.createElement('i');
    fill.style.width = `${pct}%`;
    // The 2px min-width keeps 0.1% visible, but it also renders a sliver for
    // someone who has labeled nothing. Zero must look like zero.
    if (!r.n) fill.style.minWidth = '0';
    bar.appendChild(fill);

    // Everything that used to sit on the row now lives here, one hover away.
    // Position IS still worth knowing — it just is not worth a column.
    const at = r.last
      ? state.index.get(JSON.stringify([r.last.video, r.last.round, r.last.frame]))
      : undefined;
    const detail = [`${r.n.toLocaleString()} of ${n.toLocaleString()} (${pct.toFixed(1)}%)`];
    if (r.skipped) detail.push(`${r.skipped} skipped`);
    if (at !== undefined) detail.push(`at #${at + 1}`);
    if (r.last_ts) detail.push(ago(r.last_ts));
    const tip = detail.join(' · ');
    bar.title = tip;
    cells[cells.length - 2].title = tip;            // the count cell

    if (open) {
      const box = add('who-ranges' + m, '');
      const got = state.rangeCache.get(r.labeler);
      // Whatever we have goes up straight away. Only a row we have NEVER read
      // shows a spinner; anything else shows its last known ranges while the
      // refresh runs underneath, so the panel never blanks what it just said.
      box.textContent = !got ? 'Loading…'
        : got.error ? got.error
        : got.ranges.length ? fmtRanges(got.ranges)
        : 'nothing in the current queue';
      if (got && got.n !== r.n) box.classList.add('stale');
      // Refetch when the count has moved on, but no more often than
      // RANGE_FRESH_MS — the poll would otherwise re-read every open tab every
      // 45s for a team that is actively labeling.
      const due = !got || (got.n !== r.n && Date.now() - (got.at || 0) > RANGE_FRESH_MS);
      if (due) loadRanges(r.labeler, r.n).then(() => renderTeam(state.teamRows || []));
    }
  });

  // Last in the grid, under everything it acts on. Rendered rather than static
  // so it can never appear above an empty list — with no team there is nobody
  // to lead, and the button would be a trap.
  if (rows.length > 1) {
    const foot = document.createElement('div');
    foot.id = 'lead-row';
    const btn = document.createElement('button');
    btn.id = 'lead-btn';
    btn.type = 'button';
    btn.textContent = 'Lead everyone';
    btn.disabled = !who() || state.leading;
    btn.onclick = askLead;
    const note = document.createElement('div');
    note.id = 'lead-note';
    note.textContent = 'Replaces everyone else\u2019s answers with yours, on the '
                     + 'frames you have answered.';
    foot.append(btn, note);
    cells.push(foot);
  }

  if (hiddenNow) {
    const foot = document.createElement('div');
    foot.className = 'who-hidden';
    const lbl = document.createElement('span');
    lbl.textContent = `${hiddenNow} hidden`;
    const all = document.createElement('button');
    all.className = 'who-show-all';
    all.textContent = 'Show all';
    all.onclick = () => { state.hidden.clear(); saveHidden(); renderTeam(state.teamRows || []); };
    foot.append(lbl, all);
    cells.push(foot);
  }
  el.replaceChildren(...cells);
}

// Your own row moves the instant you save. The count is state.labels.size,
// which is already the authority for your progress, so this is not a guess —
// it is the same number the overview is drawn from. Everyone else's row waits
// for the poll, because nothing else can tell us where they are.
function bumpMyTeamRow() {
  const me = who();
  if (!me) return;
  const rows = state.teamRows || [];
  let mine = rows.find((r) => r.labeler.toLowerCase() === me.toLowerCase());
  if (!mine) { mine = { labeler: me, n: 0, skipped: 0, last_ts: '', last: null }; rows.push(mine); }
  // Same rule as the header, so the two cannot disagree. Only YOUR row can be
  // corrected this way — cs2Stats counts every row in a tab and has no idea
  // what the queue contains, so a teammate's number stays the server's.
  const mineRows = myRowsInQueue();
  mine.n = mineRows.filter(isResolved).length;
  mine.skipped = mineRows.filter((r) => r.skipped).length;
  mine.last_ts = new Date().toISOString();
  const f = state.frames[state.i];
  if (f) mine.last = { video: f.stem, round: f.round, frame: f.frame };
  rows.sort((a, b) => b.n - a.n);
  renderTeam(rows);
}

// One real refresh after a burst of saves, not one per save: the stats call
// reads every labeler sheet, and firing it per frame is what made saving slow
// in the first place.
// Two debounces, not one. They were sharing 4s, which is right for the team
// panel — stats reads every labeler tab in full and nobody is watching their
// colleagues' counters mid-keystroke — but it made the comparison grid the one
// part of the overview that visibly trailed the other two. The overlap read is
// ~1.4s against stats' ~1.5s but is the thing being looked at, so it goes as
// soon as the labeler pauses.
//
// Still debounced rather than immediate: a burst of fast saves collapses into a
// single refresh at the end instead of one request per frame.
function scheduleTeamRefresh() {
  clearTimeout(state.teamTimer);
  state.teamTimer = setTimeout(loadTeam, 4000);
  clearTimeout(state.cmpTimer);
  state.cmpTimer = setTimeout(loadOverlap, 600);
}

// ── agreement: pick TWO labelers and score that pair ───────────────────
// One pair per request, either slot free to be anyone with a tab — including
// two people who are not you. Scoring yourself against everybody, which is what
// this did before, cannot show the disagreement that matters once more than two
// people are labeling: the pair that reads a question differently may not
// include you at all.
//
// A snapshot on demand, not a live number: it reads both tabs in full, and it
// is a thing you check between stretches of labeling rather than watch.
function setAgreeOpen(open) {
  $('agree-out').classList.toggle('on', open);
  $('agree-btn').setAttribute('aria-expanded', String(open));
  $('agree-label').textContent = open ? 'Hide comparison' : 'Compare two labelers';
}

function toggleAgreement() {
  if (!state.ready) return;
  if ($('agree-out').classList.contains('on')) { setAgreeOpen(false); return; }
  setAgreeOpen(true);
  renderAgreePanel();
}

// Everyone with a tab, plus you — your own row is bumped locally the moment you
// save, so it can be present here before the team poll has ever run.
function labelerNames() {
  const names = (state.teamRows || []).map((r) => r.labeler);
  const me = who();
  if (me && !names.some((n) => n.toLowerCase() === me.toLowerCase())) names.push(me);
  return names.sort((a, b) => a.localeCompare(b));
}

// The picker persists across opens (state.pairA / pairB) so re-checking the same
// pair after more labeling is one click, not three.
function renderAgreePanel() {
  const out = $('agree-out');
  const names = labelerNames();
  out.replaceChildren();

  if (names.length < 2) {
    out.appendChild(note('Only one labeler so far — nothing to compare yet.'));
    return;
  }
  if (!state.pairA || !names.includes(state.pairA)) state.pairA = who() || names[0];
  if (!state.pairB || !names.includes(state.pairB) || state.pairB === state.pairA) {
    state.pairB = names.find((n) => n !== state.pairA) || names[0];
  }

  const pick = document.createElement('div');
  pick.id = 'ag-pick';
  const mk = (slot) => {
    const sel = document.createElement('select');
    sel.className = 'ag-sel';
    sel.setAttribute('aria-label', slot === 'pairA' ? 'First labeler' : 'Second labeler');
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n + (n.toLowerCase() === (who() || '').toLowerCase() ? ' (you)' : '');
      o.selected = state[slot] === n;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      state[slot] = sel.value;
      // Exactly one pair, and a labeler cannot be compared with themselves, so
      // the other slot steps aside rather than showing an error after the fact.
      const other = slot === 'pairA' ? 'pairB' : 'pairA';
      if (state[other] === sel.value) {
        state[other] = names.find((n) => n !== sel.value) || sel.value;
      }
      state.agreeBody = null;
      state.agreeAt = null;
      renderAgreePanel();
    };
    return sel;
  };
  const vs = document.createElement('span');
  vs.id = 'ag-vs';
  vs.textContent = 'vs';
  const go_ = document.createElement('button');
  go_.id = 'ag-go';
  go_.textContent = 'Compare';
  go_.onclick = computeAgreement;
  pick.append(mk('pairA'), vs, mk('pairB'), go_);
  out.appendChild(pick);

  const body = document.createElement('div');
  body.id = 'ag-body';
  out.appendChild(body);

  if (state.agreeBody && state.agreeBody._a === state.pairA
      && state.agreeBody._b === state.pairB) {
    renderAgreement(state.agreeBody);
  } else {
    body.appendChild(note('Press Compare.'));
  }
}

async function computeAgreement() {
  if (!state.pairA || !state.pairB) return;
  const body = $('ag-body');
  state.agreeBusy = true;
  syncPanelButtons();
  $('ag-go').disabled = true;
  body.replaceChildren(note(`Reading ${state.pairA} and ${state.pairB}\u2026`));
  try {
    const res = await call({ action: 'agreementChinTuck3',
                             labeler: who(), a: state.pairA, b: state.pairB },
                           'comparison');
    // Stamped with the pair it describes, so switching the picker cannot leave
    // last pair's numbers on screen under two new names.
    res._a = state.pairA;
    res._b = state.pairB;
    state.agreeBody = res;
    state.agreeAt = new Date();
    renderAgreement(res);
  } catch (e) {
    body.replaceChildren(note(e.message));
  } finally {
    state.agreeBusy = false;
    syncPanelButtons();
    const g = $('ag-go');
    if (g) g.disabled = false;
  }
}

function note(msg) {
  const d = document.createElement('div');
  d.className = 'ag-note';
  d.textContent = msg;
  return d;
}

// Landis & Koch bands, which is what "kappa 0.4" is usually read against:
// <0.4 poor-to-fair, 0.4-0.6 moderate, >0.6 substantial.
function kappaClass(k) {
  if (k === null || k === undefined) return '';
  if (k >= 0.6) return 'k-hi';
  if (k >= 0.4) return 'k-mid';
  return 'k-lo';
}

function renderAgreement(r) {
  const body = $('ag-body');
  if (!body) return;
  body.replaceChildren();

  if (!r.shared) {
    body.appendChild(note(r.note
      || `${r.a} and ${r.b} have not both finished any frame yet.`));
    return;
  }

  const head = document.createElement('div');
  head.className = 'ag-head';
  const who_ = document.createElement('span');
  who_.className = 'ag-who';
  who_.textContent = `${r.a} vs ${r.b}`;
  const n = document.createElement('span');
  n.className = 'ag-n';
  n.textContent = `${r.shared} frames`;
  head.append(who_, n);
  // Everything that used to be a line of prose lives here instead.
  const ind = r.independent || { shared: 0, all_four_match: 0 };
  head.title = `${r.all_four_match} of ${r.shared} frames answered the same`
    + (ind.shared
        ? ` · without the clue: ${ind.all_four_match} of ${ind.shared}`
        : ' · no clue-free shared frames yet');
  body.appendChild(head);

  for (const fld of FIELDS) {
    const q = r.questions[fld] || {};
    const pct = (q.agree === null || q.agree === undefined) ? null : q.agree * 100;

    const row = document.createElement('div');
    row.className = 'ag-row';
    row.title = pct === null ? 'not enough shared frames'
      : `${Math.round(pct)}% same answer · kappa `
        + (q.kappa === null || q.kappa === undefined ? '—' : q.kappa.toFixed(2))
        + ' (agreement beyond chance)';

    const lbl = document.createElement('span');
    lbl.className = 'ag-lbl';
    lbl.textContent = QUESTION_LABELS[fld];

    const bar = document.createElement('span');
    bar.className = 'ag-bar';
    const fill = document.createElement('i');
    fill.style.width = `${pct === null ? 0 : pct}%`;
    fill.className = pct === null ? 'k-na' : (kappaClass(q.kappa) || 'k-na');
    bar.appendChild(fill);

    const val = document.createElement('span');
    val.className = 'ag-pct';
    val.textContent = pct === null ? '—' : `${Math.round(pct)}%`;

    row.append(lbl, bar, val);
    body.appendChild(row);
  }

  const foot = document.createElement('div');
  foot.id = 'agree-foot';
  const when = document.createElement('span');
  when.id = 'agree-when';
  when.textContent = state.agreeAt
    ? 'as of ' + state.agreeAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  foot.appendChild(when);
  body.appendChild(foot);
}

// ── flag: "I answered, but come back to this" ──────────────────────────────
// Binary, like skip — but skip means the frame CANNOT be judged, while a flag
// means it was judged and deserves another look. Deliberately no reason field:
// one was tried and the presets went unused, while the free text produced
// variants nobody could filter on. The signal is the frame, not the wording.
//
// Toggling writes the row immediately and does NOT advance: a flag is a note
// about the frame in front of you, so jumping away would hide whether it took.
// Both panels read from the sheet under a labeler's name, so neither means
// anything until there is one. Comparison was the odd one out: it was clickable
// with the field empty, and answered by doing nothing at all — toggleAgreement
// returns early on a missing name, so the click looked broken rather than
// unavailable. Gated on `ready` rather than on the name alone, so it also stays
// off while the labels are still loading.
function syncPanelButtons() {
  const locked = !state.ready;
  $('clue-btn').disabled = locked;
  $('team-btn').disabled = locked;
  // agreeBusy is its own reason to stay disabled — a comparison already in
  // flight must not be fired twice — and must survive a readiness repaint.
  $('agree-btn').disabled = locked || state.agreeBusy;
}

// Green only while the box holds the name we actually loaded and the page is
// unlocked — not merely because a name was typed once. Typing a different name
// drops it back to blue, which is the honest signal: what is in the box is not
// what answers are being saved under until Start is pressed again.
function renderNameState() {
  const live = !!who() && who() === state.loadedFor && state.ready;
  $('name-row').classList.toggle('saved', live);
  $('name-go').textContent = live ? 'Saved' : 'Start';
}

function renderFlag() {
  $('flag-btn').setAttribute('aria-pressed', String(!!state.flag));
  $('flag-label').textContent = state.flag ? 'Flagged' : 'Flag';
  $('flag-btn').disabled = !state.ready;
}

function toggleFlag() {
  if (!state.ready) return;
  state.flag = !state.flag;
  renderFlag();
  save({ skip: state.skipped });
}

// ── clue: how the rest of the team answered this frame ─────────────────────
// Opened by hand, never automatically. Seeing someone else's answer before you
// commit turns two independent raters into one, and inter-rater agreement is
// the number this pipeline exists to produce — so every frame whose clue was
// opened is recorded in state.consulted and marked on screen. Nothing is
// blocked; the labeler decides, and the decision is visible afterwards.
const QUESTION_LABELS = {
  bad_tuck: 'Obviously bad',
};

function setClueOpen(open) {
  state.clueOpen = !!open;
  $('clue-wrap').classList.toggle('open', state.clueOpen);
  $('clue-btn').setAttribute('aria-expanded', String(state.clueOpen));
  $('clue-label').textContent = state.clueOpen ? 'Hide clue' : 'Clue';
}

// Collapse on every frame change: leaving it open would show the NEXT frame
// answers before the labeler has looked at it, which is the failure mode this
// whole feature has to avoid.
function resetClue() {
  setClueOpen(false);
  $('clue-btn').disabled = !state.ready;
}

async function toggleClue() {
  if (!state.ready) return;
  if (state.clueOpen) { setClueOpen(false); return; }

  const f = state.frames[state.i];
  const k = key(f);
  setClueOpen(true);

  if (state.clueCache.has(k)) { showPeers(k, state.clueCache.get(k)); return; }
  renderClueNote('Loading…');
  try {
    const body = await call({
      action: 'peersChinTuck3', labeler: who(),
      video: f.stem, round: String(f.round), frame: String(f.frame),
    }, 'clue');
    const peers = body.peers || [];
    state.clueCache.set(k, peers);
    // The labeler may have moved on while this was in flight — in which case
    // they never saw the answers, so nothing is marked.
    if (key(state.frames[state.i]) === k && state.clueOpen) showPeers(k, peers);
  } catch (e) {
    renderClueNote(e.message);
  }
}

// `consulted` means "answered after seeing someone else's answer". Opening the
// panel on a frame nobody has labeled shows nothing, so it influences nothing
// and must not be flagged — otherwise the column would mark every curious
// click and stop identifying the rows whose independence is actually in doubt.
function showPeers(k, peers) {
  if (peers.length) state.consulted.add(k);
  renderClue(peers);
}

// Nobody else has reached this frame. Deliberately warm rather than an error:
// it is the expected state early in a run, and it means the labeler is first
// here — not that anything went wrong.
function renderClueEmpty() {
  const body = $('clue-body');
  body.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'clue-empty';
  wrap.innerHTML =
    '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">'
    + '<circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="1.6"'
    + ' stroke-dasharray="3 3.4"/>'
    + '<path d="M12.4 18.4c.9-1 2.2-1.5 3.6-1.5s2.7.5 3.6 1.5" stroke="currentColor"'
    + ' stroke-width="1.6" stroke-linecap="round"/>'
    + '<circle cx="12.6" cy="13.4" r="1.15" fill="currentColor"/>'
    + '<circle cx="19.4" cy="13.4" r="1.15" fill="currentColor"/></svg>';
  const h = document.createElement('div');
  h.className = 'clue-empty-h';
  h.textContent = 'You are first here';
  const s = document.createElement('div');
  s.className = 'clue-empty-s';
  s.textContent = 'No one else has labeled this frame yet — your call sets the standard.';
  wrap.append(h, s);
  body.appendChild(wrap);
}

function renderClueNote(msg) {
  const body = $('clue-body');
  body.replaceChildren();
  const d = document.createElement('div');
  d.id = 'clue-note';
  d.textContent = msg;
  body.appendChild(d);
}

function renderClue(peers) {
  if (!peers.length) {
    renderClueEmpty();
    return;
  }
  const body = $('clue-body');
  body.replaceChildren();
  for (const p of peers) {
    const row = document.createElement('div');
    row.className = 'clue-row';

    const who_ = document.createElement('div');
    who_.className = 'clue-who';
    who_.textContent = p.labeler;
    if (p.ts) {
      const s = document.createElement('s');
      s.textContent = ago(p.ts);
      who_.appendChild(s);
    }
    row.appendChild(who_);

    if (p.skipped) {
      const sk = document.createElement('div');
      sk.className = 'clue-skip';
      sk.textContent = 'skipped this frame';
      row.appendChild(sk);
    } else {
      const dl = document.createElement('dl');
      dl.className = 'clue-ans';
      for (const fld of FIELDS) {
        const dt = document.createElement('dt');
        dt.textContent = QUESTION_LABELS[fld];
        const dd = document.createElement('dd');
        const v = p[fld];
        dd.className = v || 'none';
        dd.textContent = v ? v.replace(/_/g, ' ') : '—';
        dl.append(dt, dd);
      }
      row.appendChild(dl);
    }
    body.appendChild(row);
  }
}

function status(msg, cls) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = cls || '';
}

// ── zoom / pan ─────────────────────────────────────────────────────────────
function applyTransform() {
  const stage = $('stage');
  stage.style.transform =
    `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  // Markers live inside the scaled stage so they follow the frame; --inv
  // cancels the scale on their own transform so they stay 5px on screen.
  stage.style.setProperty('--inv', String(1 / state.zoom));
  // "Untouched" is zoom 1 AND no pan — at zoom 1 with a pan the frame is still
  // displaced, so it must stay grabbable. Keying this off zoom alone stranded
  // an off-centre frame with a crosshair cursor and no way to drag it back.
  stage.classList.toggle('zoomed', !isFitted());
}
function isFitted() {
  return state.zoom === 1 && state.panX === 0 && state.panY === 0;
}
function resetZoom() {
  state.zoom = 1; state.panX = 0; state.panY = 0;
  applyTransform();
}

// Zoom anchored at the cursor: the pixel under the pointer must stay under the
// pointer. With transform-origin 0 0, the stage's rendered top-left is its
// laid-out position plus pan, so holding the point fixed means shifting pan by
// the cursor's offset into the rendered box, scaled by how much the zoom moved.
//
// `px` is the wheel delta normalised to pixels — the zoom is continuous in it,
// so one flick of a mouse wheel and a slow trackpad drag both feel proportional.
//
// Nothing here recentres. An earlier version snapped to fit and reset the pan
// in the same step, which meant scrolling through 1x did not just change scale,
// it teleported the frame back to centre — the jump you would hit every time
// you crossed fit. Snapping now touches the SCALE only; the pan keeps whatever
// the cursor-anchored math produced, and double-click is the way back.
function zoomAt(px, clientX, clientY) {
  const before = state.zoom;
  let after = before * Math.exp(-px * ZOOM_SPEED);
  after = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, after));
  // Stop exactly on fit when a step CROSSES it, so 1x is always reachable by
  // scrolling. Deliberately not a "near 1" window: any window is larger than a
  // fine trackpad step (~0.2%), so the zoom escapes fit and is rounded back on
  // the next event — pinned at 1 no matter how much you scroll.
  if ((before - 1) * (after - 1) < 0) after = 1;
  if (after === before) return;

  const r = $('stage').getBoundingClientRect();
  const k = 1 - after / before;
  state.zoom = after;
  state.panX += (clientX - r.left) * k;
  state.panY += (clientY - r.top) * k;
  // Float drift leaves a pan of ~1e-14 where it should be zero, which would
  // keep the frame flagged as displaced forever. Only a sub-pixel pan is
  // rounded away, so this can never move anything the eye can see.
  if (Math.abs(state.panX) < 0.5) state.panX = 0;
  if (Math.abs(state.panY) < 0.5) state.panY = 0;
  applyTransform();
}

// ── wiring ─────────────────────────────────────────────────────────────────
function bind() {
  for (const b of document.querySelectorAll('.opt')) {
    b.onclick = () => {
      // Clicking the selected option again clears it — an answer can be
      // withdrawn without clearing the whole frame.
      state.answers[b.dataset.q] =
        state.answers[b.dataset.q] === b.dataset.v ? undefined : b.dataset.v;
      state.skipped = false;
      render();
    };
  }

  // No await: save() records locally and returns at once, so the queue moves at
  // the speed of the labeler rather than the speed of Apps Script.
  $('save').onclick = () => {
    // Saving a frame you answered nothing on is not a partial judgement, it is
    // no judgement — you looked and moved on. Recorded as a skip so it leaves a
    // grey dot that is DONE WITH rather than a yellow one promising a return
    // trip to a frame with nothing to return to.
    const blank = !FIELDS.some((fld) => state.answers[fld]);
    if (blank) { state.answers = {}; state.skipped = true; }
    if (save({ skip: blank })) advance(); else render();
  };
  $('skip').onclick = () => {
    // Discard any answers first. A skip means "this frame cannot be judged",
    // so it must not carry a judgement.
    state.answers = {};
    state.skipped = true;
    if (save({ skip: true })) advance(); else render();
  };
  // 1-based in, 0-based out: the labeler reads "703 / 3791" off the panel, so
  // typing 703 has to land on that frame and not the one after it.
  const gotoFrame = () => {
    const el = $('goto-n');
    const n = parseInt(el.value, 10);
    if (!isFinite(n) || !state.frames.length) return;
    go(Math.max(0, Math.min(state.frames.length - 1, n - 1)));
    el.blur();                        // so the arrow keys go back to the queue
  };
  $('goto-go').onclick = gotoFrame;
  $('goto-n').onkeydown = (e) => {
    e.stopPropagation();              // Enter here must not fire Save & next
    if (e.key === 'Enter') gotoFrame();
  };

  $('prev').onclick = () => go(state.i - 1);
  $('next').onclick = () => go(state.i + 1);
  // The name is committed deliberately — by the button or Enter — not on every
  // keystroke or blur. labeler_name.js also normalises the value ("alex" ->
  // "Alex") and re-dispatches change, so an onchange handler fired twice for a
  // single entry; commitName is idempotent and start() drops a duplicate load.
  const syncGo = () => {
    $('name-go').disabled = !who();
    renderNameState();
  };
  const commitName = () => {
    if (!who()) return;
    window.CMLabeler && window.CMLabeler.set && window.CMLabeler.set(who());
    syncGo();
    start();
  };
  $('labeler-input').oninput = syncGo;
  $('labeler-input').onkeydown = (e) => {
    e.stopPropagation();                       // shortcuts must not fire while typing
    if (e.key === 'Enter') commitName();
  };
  $('name-go').onclick = commitName;
  $('clue-btn').onclick = toggleClue;
  $('team-btn').onclick = () => setTeamOpen(!state.teamOpen);
  $('lead-cancel').onclick = closeLead;
  $('lead-go').onclick = doLead;
  // Clicking the backdrop cancels; clicking the card must not.
  $('lead-mask').onclick = (e) => { if (e.target === $('lead-mask')) closeLead(); };
  $('agree-btn').onclick = toggleAgreement;

  $('flag-btn').onclick = toggleFlag;

  const stage = $('stage');
  const card = $('stage-card');
  stage.onmouseenter = () => card.classList.add('guide');
  stage.onmouseleave = () => card.classList.remove('guide');
  stage.onmousemove = (e) => {
    // Measured against the CARD, which is never transformed. Measuring against
    // #stage put the offset in the stage's local space, so the cross drifted
    // away from the cursor by exactly the zoom factor.
    const r = card.getBoundingClientRect();
    $('gx').style.top = `${e.clientY - r.top}px`;
    $('gy').style.left = `${e.clientX - r.left}px`;
    if (state.drag) {
      state.panX = state.drag.px + (e.clientX - state.drag.x);
      state.panY = state.drag.py + (e.clientY - state.drag.y);
      applyTransform();
    }
  };
  stage.onmousedown = (e) => {
    if (isFitted()) return;                // nothing displaced, nothing to pan
    state.drag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
    stage.classList.add('panning');
    e.preventDefault();
  };
  window.addEventListener('mouseup', () => {
    state.drag = null;
    stage.classList.remove('panning');
  });
  stage.ondblclick = resetZoom;
  // deltaMode: 0 = pixels (most), 1 = lines (Firefox), 2 = pages. Normalise so
  // the same flick zooms the same amount in every browser.
  const DELTA_PX = { 0: 1, 1: 16, 2: 400 };
  $('stage-card').addEventListener('wheel', (e) => {
    e.preventDefault();
    const px = e.deltaY * (DELTA_PX[e.deltaMode] || 1);
    // One frantic scroll can deliver a single huge delta; clamping keeps a
    // flick from jumping the whole zoom range in one event.
    zoomAt(Math.max(-200, Math.min(200, px)), e.clientX, e.clientY);
  }, { passive: false });

  $('frame').onload = () => { $('frame').classList.remove('broken'); placeMarks(); };
  // A missing JPEG otherwise renders as an empty box with no explanation.
  $('frame').onerror = () => {
    $('frame').classList.add('broken');
    status('Frame image did not load — ' + $('frame').getAttribute('src'), 'err');
  };

  // One question, two answers. Q/W/A/S/D/Z/X/C are free again — but H and F
   // still may not move onto them without checking this map first, because it
   // is consulted before the panel shortcuts below.
  const KEYS = {
    '1': ['bad_tuck', 'yes'], '2': ['bad_tuck', 'no'],
  };
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$('lead-mask').hidden) {
      if (e.key === 'Escape' && !state.leading) { closeLead(); e.preventDefault(); }
      return;
    }
    if (!state.ready) return;      // CSS greys the buttons; it cannot stop a key
    const k = e.key.toLowerCase();
    if (KEYS[k]) {
      const [q, v] = KEYS[k];
      state.answers[q] = state.answers[q] === v ? undefined : v;
      state.skipped = false;
      render();
    } else if (e.key === 'Enter') $('save').click();
    else if (k === 'k') $('skip').click();
    else if (e.key === 'ArrowLeft') go(state.i - 1);
    else if (e.key === 'ArrowRight') go(state.i + 1);
    // Clue keeps H. Flag takes F — the free mnemonic letter. Neither may use a
    // letter from the KEYS map above (1/2, Q/W, A/S/D, Z/X/C): that map is
    // consulted first, so such a binding would silently never fire.
    else if (k === 'h') toggleClue();
    else if (k === 'f') toggleFlag();
    else if (e.key === 'Escape') { state.answers = {}; state.skipped = false; render(); }
    else return;
    e.preventDefault();
  });
}

function advance() {
  // Move to the next frame in queue order, not the next unlabeled one: a
  // labeler working forward expects +1, and G is there when they want to jump
  // over a stretch they already did.
  if (state.i < state.frames.length - 1) go(state.i + 1);
  else { status('End of queue'); render(); }
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
  // Changing the name starts another load while the first is still in flight.
  // Without a token the slower reply wins and one labeler's rows end up shown
  // under the other's name — and then saved against it.
  // Already loading this exact name, or already loaded it — nothing to do.
  // Without this the duplicate change event fires a second identical request
  // and the two race for the right to unlock the page.
  if (state.loadingFor === name) return;
  if (state.loadedFor === name && state.ready) return;

  const token = ++state.loadToken;
  state.loadingFor = name;
  setReady(false, 'Loading your saved progress…  this can take up to 30 seconds.');
  status('Loading your labels…');

  // Fire the team read NOW rather than after the label list. The two calls cost
  // about the same (~3s each), so queueing them made the team panel land at
  // roughly double the wait — which read as "the team panel is slow" when it
  // was simply going second. Nothing in it depends on the label list.
  loadTeam();
  loadOverlap();

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
  if (token !== state.loadToken) return;       // superseded — discard
  state.loadingFor = null;
  state.loadedFor = name;
  renderNameState();
  setReady(true);

  // Land on the first frame with no row of your own; the last frame if there
  // are none. Safe to jump unconditionally because the controls were frozen
  // until now — nothing can have been answered that this would discard.
  const n = firstUnlabeled(0);
  go(n < 0 ? state.frames.length - 1 : n);
  status(n < 0 ? 'All frames labeled' : '');
  // The team read above may have landed while `ready` was still false, which
  // skips the own-row overlay — apply it now that the count is known.
  if (state.teamRows) bumpMyTeamRow();
}

(async function init() {
  state.hidden = loadHidden();
  bind();
  try {
    const res = await fetch(`${DATA}queue.json?v=7`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const q = await res.json();
    state.frames = q.frames || [];
  } catch (e) {
    // This is the failure a labeler is most likely to hit and least likely to
    // understand, so it says what to do rather than what went wrong. Opening
    // the .html from disk is the usual cause: file:// cannot fetch queue.json
    // or the frames, and the page comes up empty with no obvious reason.
    const viaFile = location.protocol === 'file:';
    const msg = viaFile
      ? 'Open this page from the local server — http://localhost:8765/chin_tuck_2.0/chin_shoulder.html — not by double-clicking the file.'
      : 'Could not load queue.json (' + e.message + '). Is the local server still running in this folder?';
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
  // Read it here rather than trusting labeler_name.js's DOMContentLoaded to
  // have landed first — that fires during the queue.json await, and depending on
  // it would make the restore a race.
  restoreName();
  render();
  await start();          // no name yet -> frozen, asking for one
  // Polling only. save() no longer calls loadTeam directly — that doubled the
  // requests per frame for a panel nobody is watching mid-keystroke.
  // BOTH, not just the team panel. The comparison grid was refreshed only at
  // startup and four seconds after your own saves, so a teammate's answers
  // never reached it — the third panel sat on whatever it read when the page
  // opened, which is what made it look permanently behind the other two.
  setInterval(() => { loadTeam(); loadOverlap(); }, TEAM_POLL_MS);
})();

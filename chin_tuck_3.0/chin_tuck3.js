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
  loadingFor: null,        // name whose label list is in flight
  loadedFor: null,         // name whose labels are in state.labels
  loadToken: 0,            // guards against overlapping start() runs
  inflight: new Set(),     // keys whose save request is still open
  chains: new Map(),       // key -> promise chain, serialising same-frame saves
  failed: new Map(),       // key -> why its save failed
  teamRows: null,          // last team payload, mutated locally between polls
  teamTimer: null,         // debounce for the post-save refresh
  ready: false,            // this labeler's saved rows have arrived
  clueOpen: false,         // the clue panel is expanded
  clueCache: new Map(),    // key -> peer rows, so reopening costs nothing
  consulted: new Set(),    // frames whose clue was opened — see the CSS note
  flag: false,             // is this frame flagged for a second look
  shownAt: 0,              // when the current frame went on screen (ms)
  overlap: new Map(),      // frame key -> 'a' | 'p' | 'd' | 'o' (see cs2Overlap)
  overlapPeers: 0,         // how many other labelers existed when it was read
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
  const resolved = [...state.labels.values()].filter(isResolved).length;
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
  const g = grid.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  if (e.top < g.top) grid.scrollTop += e.top - g.top;
  else if (e.bottom > g.bottom) grid.scrollTop += e.bottom - g.bottom;
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
  let body;
  try {
    body = await call({ action: 'overlapChinTuck3', labeler: name }, 'comparison');
  } catch (e) {
    return;                     // silent: the other two grids are still correct
  }
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
    const mk = () => state.frames.map((_, i) => {
      const el = document.createElement('i');
      el.onclick = () => go(i);
      return el;
    });
    ov.replaceChildren(...mk());
    fg.replaceChildren(...mk());
    cg.replaceChildren(...mk());
  }
  let flagged = 0;
  let compared = 0;
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
    // finished — there is no answer of yours to compare with.
    const v = state.overlap.get(k);
    if (v && v !== 'o') compared++;
    const ce = cg.children[i];
    ce.className = CMP_CLASS[v] || '';
    ce.classList.toggle('here', i === state.i);
    ce.title = `#${i + 1}` + (v ? ' · ' + CMP_TITLE[v] : '');
  });
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
}

function renderTeamLabel() {
  const n = (state.teamRows || []).length;
  $('team-label').textContent = state.teamOpen
    ? 'Hide progress'
    : (n ? `Everyone's progress (${n})` : "Everyone's progress");
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

  rows.forEach((r) => {
    const mine = r.labeler.toLowerCase() === me;
    const m = mine ? ' who-me' : '';
    const pct = n ? (r.n / n) * 100 : 0;

    const name = add('who-n' + m, '');
    name.textContent = r.labeler;
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
    name.title = tip; bar.title = tip;
    cells[cells.length - 2].title = tip;            // the count cell
  });
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
  mine.n = [...state.labels.values()].filter(isResolved).length;
  mine.skipped = [...state.labels.values()].filter((r) => r.skipped).length;
  mine.last_ts = new Date().toISOString();
  const f = state.frames[state.i];
  if (f) mine.last = { video: f.stem, round: f.round, frame: f.frame };
  rows.sort((a, b) => b.n - a.n);
  renderTeam(rows);
}

// One real refresh after a burst of saves, not one per save: the stats call
// reads every labeler sheet, and firing it per frame is what made saving slow
// in the first place.
function scheduleTeamRefresh() {
  clearTimeout(state.teamTimer);
  state.teamTimer = setTimeout(() => { loadTeam(); loadOverlap(); }, 4000);
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
  setInterval(loadTeam, TEAM_POLL_MS);
})();

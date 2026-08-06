// ============================================================
// guard_drop_label.js — resting-hand labeler, one verdict per punch
//
// A focused duplicate of impact_frame.js. Same candidate source (Combined
// Data via listPunchesForVideo), same queue / progress / optimistic-save
// machinery, same looping clip. The only difference is the label: instead
// of picking a frame, you pick one of three verdicts about the RESTING
// (non-punching) hand.
//
//   1 good        stayed up at the chin for the whole punch
//   2 dropped     started up, fell during the punch
//   3 always_low  never up — low before, during and after
//
// The dropped / always_low split is the reason this exists. The Form Labels
// sheet's `rule_resting_hand` is pass/fail, which merges two different
// faults: a guard that collapses when you throw, and a guard that was never
// there. They need different coaching, and a detector that models "the hand
// fell during the punch" will behave differently on each.
//
// Saved to the "Guard Drops" sheet via saveGuardDrop / listGuardDrops /
// deleteGuardDrop Apps Script actions.
//
// Reuses player.js for the video chrome, sheetUrl(), and shared `state`.
// ============================================================

const VERDICTS = [
  { key: '1', value: 'good',       label: 'good',           cls: 'good', short: 'good' },
  { key: '2', value: 'dropped',    label: 'dropped',        cls: 'drop', short: 'drop' },
  { key: '3', value: 'always_low', label: 'always too low',  cls: 'low',  short: 'low' },
];

const SKIP_REASONS = [
  { key: '1', reason: 'occluded', label: 'occluded' },
  { key: '2', reason: 'unclear', label: 'unclear' },
  { key: '3', reason: 'no_punch', label: 'no punch in clip' },
];

const SPEED_CYCLE = [0.25, 0.5, 1];

// Loop the labelled punch window. 0/0 lead-in/trail-out = pure punch only,
// same as the impact labeler — the verdict is about this punch, so the clip
// must not show guard behaviour from before or after it.
const PUNCH_LEAD_IN_SEC = 0;
const PUNCH_TRAIL_OUT_SEC = 0;

Object.assign(state, {
  knownVideos: [],
  currentStem: null,
  videoFps: null,
  candidates: [],
  cursor: 0,
  doneKeys: new Set(),
  labelByKey: new Map(),     // key -> { verdict: string|null, skip_reason: string|null }
  coverageByUuid: new Map(),
  videoLoaded: false,
  labelCountsByVideo: new Map(),
  mode: 'scrub',             // 'scrub' | 'skipping'
  autoJumpOnSync: false,
  lastMediaTime: null,
});

function keyFor(c) {
  return 'p:' + c.punch_uuid;
}

function fpsNow() {
  return state.videoFps || 30;
}

function verdictMeta(v) {
  return VERDICTS.find(x => x.value === v) || null;
}

function formatVerdictLabel(v) {
  if (v === undefined || v === null) return 'unlabeled';
  if (v.skip_reason) return 'skipped: ' + v.skip_reason;
  const m = verdictMeta(v.verdict);
  return m ? m.label : String(v.verdict);
}

// Round markers are never labelable punches.
function isPunch(punchType) {
  if (!punchType) return false;
  const s = String(punchType).toLowerCase();
  return !['round_start', 'round_end', 'rest_start', 'rest_end'].includes(s);
}

// Which anatomical hand is throwing, from the punch type. Mirrors the
// jab/cross naming used throughout Combined Data.
function punchHandFromType(punchType) {
  const s = String(punchType || '').toLowerCase();
  if (s.startsWith('jab') || s.startsWith('lead')) return 'lead';
  if (s.startsWith('cross') || s.startsWith('rear')) return 'rear';
  return null;
}

// The guard hand is the one NOT throwing, and which side that is flips with
// stance. Orthodox leads with the left; southpaw leads with the right.
// Returned uppercase for the on-video badge.
function guardHandFor(punchType, stance) {
  const hand = punchHandFromType(punchType);
  if (!hand) return null;
  const southpaw = String(stance || '').toLowerCase() === 'southpaw';
  const punchingLeft = southpaw ? (hand === 'rear') : (hand === 'lead');
  return punchingLeft ? 'RIGHT' : 'LEFT';
}

function parseTimestamp(ts) {
  if (ts === null || ts === undefined || ts === '') return NaN;
  if (typeof ts === 'number') return ts;
  const s = String(ts).trim();
  const m = s.match(/^(\d+):(\d+)(?:[.,](\d+))?$/);
  if (m) {
    const mm = Number(m[1]), ss = Number(m[2]);
    const frac = m[3] ? Number('0.' + m[3]) : 0;
    return mm * 60 + ss + frac;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// ─── candidate source (Combined Data) ──────────────────────────────────────
async function fetchPunchCandidates(videoStem) {
  const url = sheetUrl({ action: 'listPunchesForVideo', video: videoStem });
  const res = await fetch(url);
  if (!res.ok) throw new Error('listPunchesForVideo HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('listPunchesForVideo: ' + (body.message || 'unknown'));
  const out = [];
  for (const r of body.punches || []) {
    if (!isPunch(r.label)) continue;
    const start = parseTimestamp(r.start_sec);
    const end   = parseTimestamp(r.end_sec);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const stance = (r.stance || '').toLowerCase();
    out.push({
      punch_uuid: r.punch_uuid,
      video_name: r.video_name,
      punch_type: r.label,
      stance,
      hand: punchHandFromType(r.label),
      guard_hand: guardHandFor(r.label, stance),
      start_sec: start,
      end_sec: end,
    });
  }
  out.sort((a, b) => a.start_sec - b.start_sec);
  return out;
}

// ─── sheet sync (Guard Drops) ──────────────────────────────────────────────
async function fetchGuardDrops(video, labeler) {
  const url = sheetUrl({ action: 'listGuardDrops', video, labeler });
  const res = await fetch(url);
  if (!res.ok) throw new Error('listGuardDrops HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('listGuardDrops: ' + (body.message || 'unknown'));
  return body.rows;
}
async function saveGuardDrop({ labeler, video, punch_uuid, verdict, skip_reason, guard_hand }) {
  const params = { action: 'saveGuardDrop', labeler, video, punch_uuid };
  params.verdict = verdict || '';
  params.skip_reason = skip_reason || '';
  params.guard_hand = guard_hand || '';
  const url = sheetUrl(params);
  const res = await fetch(url);
  if (!res.ok) throw new Error('saveGuardDrop HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('saveGuardDrop: ' + (body.message || 'unknown'));
  return body;
}
async function deleteGuardDrop({ labeler, punch_uuid }) {
  const url = sheetUrl({ action: 'deleteGuardDrop', labeler, punch_uuid });
  const res = await fetch(url);
  if (!res.ok) throw new Error('deleteGuardDrop HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('deleteGuardDrop: ' + (body.message || 'unknown'));
  return body;
}

// ─── panel plumbing ────────────────────────────────────────────────────────
function setStatus(text, cls) {
  const el = document.getElementById('gd-status');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('ok', 'err');
  if (cls) el.classList.add(cls);
}
function setCurrentLine(text) {
  const el = document.getElementById('gd-current');
  if (el) el.textContent = text;
}
function setModeBadge(text) {
  const el = document.getElementById('video-mode');
  if (el) el.textContent = text;
}

function describeCandidate(c, totalLabel, labelTxt) {
  if (!c) return '';
  const type = c.punch_type || '?';
  const stance = c.stance ? ` · ${c.stance}` : '';
  const window = `${c.start_sec.toFixed(2)}–${c.end_sec.toFixed(2)}s`;
  return `${type}${stance} · ${window} · ${labelTxt} · ${totalLabel}`;
}

function updateHud() {
  const hud = document.getElementById('gd-hud');
  if (!hud) return;
  const c = state.candidates[state.cursor];
  if (!c) { hud.textContent = '— no punch —'; return; }
  hud.textContent = `${c.punch_type} · ${c.hand || '?'} hand · ${c.stance || 'stance ?'}`;
}

// The badge that stops you watching the wrong arm.
function updateHandBadge() {
  const el = document.getElementById('gd-hand');
  if (!el) return;
  const c = state.candidates[state.cursor];
  if (!c || !c.guard_hand) { el.className = 'hidden'; el.textContent = ''; return; }
  el.className = '';
  el.textContent = `WATCH: ${c.guard_hand} HAND`;
}

function setBanner(text, cls) {
  const banner = document.getElementById('gd-banner');
  if (!banner) return;
  if (!text) { banner.className = 'hidden'; banner.textContent = ''; return; }
  banner.textContent = text;
  banner.className = cls || '';
}

function updateVerdictPanel() {
  const el = document.getElementById('gd-state');
  if (!el) return;
  for (const v of VERDICTS) {
    const btn = document.getElementById('btn-v-' + (v.value === 'always_low' ? 'low' : v.value));
    if (btn) btn.classList.remove('chosen');
  }
  if (state.mode === 'skipping') {
    el.innerHTML = 'Skip reason: <b>1</b> occluded · <b>2</b> unclear · <b>3</b> no punch in clip · <b>Esc</b> cancel';
    setBanner('SKIP — pick a reason', 'skipping');
    return;
  }
  const c = state.candidates[state.cursor];
  const existing = c ? state.labelByKey.get(keyFor(c)) : undefined;
  if (existing !== undefined) {
    const isSkip = !!existing.skip_reason;
    const m = verdictMeta(existing.verdict);
    setBanner(isSkip ? `SKIPPED: ${existing.skip_reason}` : (m ? m.label.toUpperCase() : '?'),
              isSkip ? 'skipping' : (existing.verdict || ''));
    const cls = isSkip ? 'lbl-skip' : (m ? 'lbl-' + m.cls : '');
    el.innerHTML = `Saved: <b class="${cls}">${formatVerdictLabel(existing)}</b>.<br>` +
      '<b>1/2/3</b> overwrites · <b>U</b> clears';
    if (!isSkip && m) {
      const btn = document.getElementById('btn-v-' + (m.value === 'always_low' ? 'low' : m.value));
      if (btn) btn.classList.add('chosen');
    }
  } else {
    setBanner(null);
    el.innerHTML = c
      ? 'Watch the non-punching hand for the whole loop, then press <b>1</b>, <b>2</b> or <b>3</b>.'
      : '—';
  }
}

// player.js probes this hook on every time update.
function updateVideoOverlay() {
  updateHud();
}

// ─── candidate generation ──────────────────────────────────────────────────
async function tryGenerateCandidates() {
  if (!state.currentStem) {
    setCurrentLine('— pick a video name to begin —');
    setModeBadge('no video');
    return;
  }
  if (!state.videoLoaded) {
    setCurrentLine('Video name set: "' + state.currentStem + '". Now load the local .mp4 file.');
    return;
  }
  const known = state.knownVideos.find(v => v.stem === state.currentStem);
  state.videoFps = (known && known.rounds && known.rounds[0]) ? known.rounds[0].fps : null;
  state.cursor = 0;
  state.doneKeys = new Set();
  state.labelByKey = new Map();
  state.coverageByUuid = new Map();
  enterScrub();
  setStatus('—');

  state.candidates = [];
  setModeBadge('fetching…');
  setCurrentLine('Loading punches from Combined Data for "' + state.currentStem + '"…');
  try {
    state.candidates = await fetchPunchCandidates(state.currentStem);
  } catch (e) {
    setModeBadge('error');
    setCurrentLine('Failed to load punches: ' + e.message);
    setStatus(e.message, 'err');
    return;
  }
  if (state.candidates.length === 0) {
    setModeBadge('0 punches');
    setCurrentLine('No labelled punches in Combined Data for "' + state.currentStem + '".');
    redrawProgress();
    return;
  }
  setModeBadge(state.candidates.length + ' punches');
  redrawProgress();
  state.cursor = 0;
  seekToCurrent();
  state.autoJumpOnSync = true;
  syncFromSheet();
}

async function syncFromSheet() {
  if (!state.currentStem || !state.candidates.length) return;
  const labeler = document.getElementById('labeler-input').value.trim();
  if (!labeler) {
    setStatus('Type your name above before labelling.', 'err');
    return;
  }
  try {
    setStatus('Loading existing labels…');
    const rows = await fetchGuardDrops(state.currentStem, '');
    state.doneKeys = new Set();
    state.labelByKey = new Map();
    state.coverageByUuid = new Map();
    for (const r of rows) {
      let who = state.coverageByUuid.get(r.punch_uuid);
      if (!who) { who = new Set(); state.coverageByUuid.set(r.punch_uuid, who); }
      who.add(r.labeler);
      if (r.labeler === labeler) {
        const k = 'p:' + r.punch_uuid;
        state.doneKeys.add(k);
        state.labelByKey.set(k, { verdict: r.verdict, skip_reason: r.skip_reason });
      }
    }
    setStatus(`Loaded ${state.doneKeys.size} of your label(s) · ${state.coverageByUuid.size} labeled in total.`, 'ok');
    updateOptionCount(state.currentStem, state.coverageByUuid.size);
    if (state.autoJumpOnSync && state.mode === 'scrub') {
      const firstIdx = state.candidates.findIndex(cc => !state.doneKeys.has(keyFor(cc)));
      if (firstIdx !== state.cursor) advanceToNextUnlabeled(0);
    }
    const c = state.candidates[state.cursor];
    if (c) {
      const total = `${state.cursor + 1}/${state.candidates.length}`;
      setCurrentLine(describeCandidate(c, total, formatVerdictLabel(state.labelByKey.get(keyFor(c)))));
    }
    updateVerdictPanel();
    redrawProgress();
  } catch (e) {
    setStatus("Couldn't fetch labels: " + e.message, 'err');
  }
  state.autoJumpOnSync = false;
}

function advanceToNextUnlabeled(fromIdx) {
  const N = state.candidates.length;
  if (N === 0) return;
  for (let i = 0; i < N; i++) {
    const idx = (fromIdx + i) % N;
    if (!state.doneKeys.has(keyFor(state.candidates[idx]))) {
      state.cursor = idx;
      seekToCurrent();
      return;
    }
  }
  state.cursor = N;
  setCurrentLine('All punches labelled for this video — pick another, or use Prev to review.');
}

function enterScrub() {
  state.mode = 'scrub';
  setBanner(null);
  updateVerdictPanel();
}

function seekToCurrent() {
  if (!state.candidates.length) return;
  enterScrub();
  if (state.cursor >= state.candidates.length) {
    state.loopWindow = null;
    updateHud();
    updateHandBadge();
    return;
  }
  const c = state.candidates[state.cursor];
  const video = document.getElementById('video-player');
  const start = Math.max(0, c.start_sec - PUNCH_LEAD_IN_SEC);
  let end = c.end_sec + PUNCH_TRAIL_OUT_SEC;
  if (video && !isNaN(video.duration) && video.duration > 0) end = Math.min(end, video.duration);
  state.loopWindow = { start, end };

  if (video && !isNaN(video.duration) && video.duration > 0) {
    video.currentTime = Math.min(Math.max(0, start), video.duration);
    if (video.paused) {
      const pp = video.play();
      if (pp && typeof pp.catch === 'function') pp.catch(() => {});
    }
  }
  const total = `${state.cursor + 1}/${state.candidates.length}`;
  setCurrentLine(describeCandidate(c, total, formatVerdictLabel(state.labelByKey.get(keyFor(c)))));
  updateVerdictPanel();
  updateOverviewHighlight();
  updateHud();
  updateHandBadge();
}

// ─── verdict / skip / undo ─────────────────────────────────────────────────
function requireLabeler() {
  const labeler = document.getElementById('labeler-input').value.trim();
  if (!labeler) {
    setStatus('Type your name first.', 'err');
    document.getElementById('labeler-input').focus();
    return null;
  }
  return labeler;
}

function chooseVerdict(value) {
  if (state.mode === 'skipping') return;
  const labeler = requireLabeler();
  if (!labeler) return;
  const c = state.candidates[state.cursor];
  if (!c) { setStatus('No punch selected.', 'err'); return; }
  persistLabel(labeler, { verdict: value, skip_reason: null });
}

function beginSkip() {
  if (!state.candidates[state.cursor]) return;
  state.mode = 'skipping';
  updateVerdictPanel();
}

function skipWith(reason) {
  const labeler = requireLabeler();
  if (!labeler) return;
  const c = state.candidates[state.cursor];
  if (!c) return;
  state.mode = 'scrub';
  persistLabel(labeler, { verdict: null, skip_reason: reason });
}

function cancelToScrub() {
  state.mode = 'scrub';
  updateVerdictPanel();
  setStatus('Skip cancelled.');
}

// Optimistic local update — advance immediately, save in the background,
// roll back on failure so the item resurfaces on the next sweep.
function persistLabel(labeler, label) {
  const c = state.candidates[state.cursor];
  if (!c) return;
  const k = keyFor(c);
  state.doneKeys.add(k);
  state.labelByKey.set(k, label);
  let who = state.coverageByUuid.get(c.punch_uuid);
  if (!who) { who = new Set(); state.coverageByUuid.set(c.punch_uuid, who); }
  who.add(labeler);
  state.pendingSaves = (state.pendingSaves || 0) + 1;
  redrawProgress();
  updateOptionCount(state.currentStem, state.coverageByUuid.size);
  setStatus('saving ' + formatVerdictLabel(label) + '… (' + state.pendingSaves + ' pending)');

  gotoNext();

  saveGuardDrop({
    labeler,
    video: state.currentStem,
    punch_uuid: c.punch_uuid,
    verdict: label.verdict,
    skip_reason: label.skip_reason,
    guard_hand: c.guard_hand,
  }).then(() => {
    state.pendingSaves = Math.max(0, (state.pendingSaves || 1) - 1);
    setStatus(state.pendingSaves === 0 ? 'Saved.'
      : state.pendingSaves + ' save' + (state.pendingSaves === 1 ? '' : 's') + ' pending…',
      state.pendingSaves === 0 ? 'ok' : null);
  }).catch((e) => {
    state.pendingSaves = Math.max(0, (state.pendingSaves || 1) - 1);
    state.doneKeys.delete(k);
    state.labelByKey.delete(k);
    const who2 = state.coverageByUuid.get(c.punch_uuid);
    if (who2) { who2.delete(labeler); if (who2.size === 0) state.coverageByUuid.delete(c.punch_uuid); }
    redrawProgress();
    updateOptionCount(state.currentStem, state.coverageByUuid.size);
    setStatus('Save failed for ' + k + ': ' + e.message, 'err');
  });
}

async function clearLabelAt(idx) {
  if (!state.currentStem) return;
  const labeler = document.getElementById('labeler-input').value.trim();
  if (!labeler) return;
  const c = state.candidates[idx];
  if (!c) return;
  const k = keyFor(c);
  if (!state.doneKeys.has(k)) return;
  state.doneKeys.delete(k);
  state.labelByKey.delete(k);
  const who = state.coverageByUuid.get(c.punch_uuid);
  if (who) { who.delete(labeler); if (who.size === 0) state.coverageByUuid.delete(c.punch_uuid); }
  redrawProgress();
  updateOptionCount(state.currentStem, state.coverageByUuid.size);
  if (idx === state.cursor) {
    updateVerdictPanel();
    const total = `${idx + 1}/${state.candidates.length}`;
    setCurrentLine(describeCandidate(c, total, 'unlabeled'));
  }
  try {
    await deleteGuardDrop({ labeler, punch_uuid: c.punch_uuid });
    setStatus("Cleared that punch's label — relabel it any time.", 'ok');
  } catch (e) {
    setStatus('Clear failed: ' + e.message, 'err');
  }
}

async function undoAction() {
  if (state.mode === 'skipping') {
    setStatus('Esc closes the skip menu.', null);
    return;
  }
  const c = state.candidates[state.cursor];
  if (!c) return;
  if (!state.doneKeys.has(keyFor(c))) {
    setStatus('Nothing saved for this punch yet.', null);
    return;
  }
  await clearLabelAt(state.cursor);
}

// ─── navigation ────────────────────────────────────────────────────────────
function gotoPrev() {
  state.autoJumpOnSync = false;
  if (!state.candidates.length) return;
  state.cursor = Math.max(0, Math.min(state.cursor, state.candidates.length - 1) - 1);
  seekToCurrent();
}
function gotoNext() {
  state.autoJumpOnSync = false;
  if (!state.candidates.length) return;
  if (state.cursor >= state.candidates.length - 1) {
    advanceToNextUnlabeled(0);
    return;
  }
  state.cursor += 1;
  seekToCurrent();
}
function gotoFirst() {
  state.autoJumpOnSync = false;
  if (!state.candidates.length) return;
  state.cursor = 0;
  seekToCurrent();
}
function gotoNextUnlabeled() {
  state.autoJumpOnSync = false;
  advanceToNextUnlabeled(state.cursor);
}
function cycleSpeed() {
  const video = document.getElementById('video-player');
  if (!video) return;
  const i = SPEED_CYCLE.indexOf(video.playbackRate);
  setSpeed(SPEED_CYCLE[(i + 1) % SPEED_CYCLE.length]);
}

// ─── progress + overview ───────────────────────────────────────────────────
function redrawProgress() {
  const N = state.candidates.length;
  const labelled = state.doneKeys.size;
  const bar = document.getElementById('gd-bar');
  if (bar) bar.style.width = N ? (100 * labelled / N).toFixed(1) + '%' : '0%';
  const pt = document.getElementById('gd-progress-text');
  if (pt) pt.textContent = N ? labelled + ' / ' + N + ' labelled' : 'no candidates';
  const counts = {};
  const skips = {};
  for (const v of state.labelByKey.values()) {
    if (v.skip_reason) skips[v.skip_reason] = (skips[v.skip_reason] || 0) + 1;
    else if (v.verdict) counts[v.verdict] = (counts[v.verdict] || 0) + 1;
  }
  const parts = [];
  for (const v of VERDICTS) if (counts[v.value]) parts.push(v.short + ': ' + counts[v.value]);
  for (const s of SKIP_REASONS) if (skips[s.reason]) parts.push(s.reason + ': ' + skips[s.reason]);
  document.getElementById('gd-dist').textContent = parts.length ? parts.join(' · ') : '—';
  rebuildOverview();
}

function rebuildOverview() {
  const list = document.getElementById('gd-overview');
  if (!list) return;
  list.innerHTML = '';
  if (!state.candidates.length) { list.textContent = '—'; return; }
  state.candidates.forEach((c, idx) => {
    const row = document.createElement('div');
    row.className = 'ov-row';
    row.dataset.idx = String(idx);
    const v = state.labelByKey.get(keyFor(c));
    let labelTxt = '—', labelCls = 'none';
    if (v !== undefined) {
      if (v.skip_reason) { labelTxt = 'skip:' + v.skip_reason; labelCls = 'skip'; }
      else {
        const m = verdictMeta(v.verdict);
        labelTxt = m ? m.short : String(v.verdict);
        labelCls = m ? m.cls : 'none';
      }
    }
    row.innerHTML =
      `<span class="ov-idx">${idx + 1}</span>` +
      `<span class="ov-type">${c.punch_type} · ${c.start_sec.toFixed(1)}s</span>` +
      `<span class="ov-label ${labelCls}">${labelTxt}</span>`;
    if (v !== undefined) {
      const x = document.createElement('button');
      x.className = 'ov-clear';
      x.title = 'clear this label';
      x.textContent = '✕';
      x.addEventListener('click', (e) => { e.stopPropagation(); clearLabelAt(idx); });
      row.appendChild(x);
    }
    row.addEventListener('click', () => {
      state.autoJumpOnSync = false;
      state.cursor = idx;
      seekToCurrent();
    });
    list.appendChild(row);
  });
  updateOverviewHighlight();
}

function updateOverviewHighlight() {
  const list = document.getElementById('gd-overview');
  if (!list) return;
  let currentRow = null;
  for (const row of list.querySelectorAll('.ov-row')) {
    const is = Number(row.dataset.idx) === state.cursor;
    row.classList.toggle('current', is);
    if (is) currentRow = row;
  }
  if (currentRow) currentRow.scrollIntoView({ block: 'nearest' });
}

// ─── calibration export — one CSV per labeler ──────────────────────────────
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportPerLabelerCsvs() {
  setStatus('Fetching all guard-drop labels…');
  let rows;
  try {
    rows = await fetchGuardDrops('', '');
  } catch (e) {
    setStatus('Export failed: ' + e.message, 'err');
    return;
  }
  const byLabeler = new Map();
  for (const r of rows) {
    let arr = byLabeler.get(r.labeler);
    if (!arr) { arr = []; byLabeler.set(r.labeler, arr); }
    arr.push(r);
  }
  if (!byLabeler.size) { setStatus('No labels to export.', 'err'); return; }
  for (const [labeler, arr] of byLabeler) {
    const header = ['punch_uuid', 'video', 'verdict', 'guard_hand', 'skip_reason', 'ts'];
    const lines = [header.join(',')];
    for (const r of arr) {
      lines.push([r.punch_uuid, r.video, r.verdict, r.guard_hand, r.skip_reason, r.ts]
        .map(csvCell).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'guard_drops_' + String(labeler).replace(/[^A-Za-z0-9_-]/g, '_') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
  setStatus('Exported ' + byLabeler.size + ' labeler CSV(s).', 'ok');
}

// ─── dropdown / counts ─────────────────────────────────────────────────────
async function loadVideosConfig() {
  try {
    const res = await fetch('../shared/videos.json', { cache: 'no-cache' });
    if (!res.ok) return { videos: [] };
    return await res.json();
  } catch {
    return { videos: [] };
  }
}

async function fetchTotalCounts() {
  const counts = new Map();
  try {
    const url = sheetUrl({ action: 'listGuardDrops', labeler: '' });
    const res = await fetch(url);
    if (!res.ok) return counts;
    const body = await res.json();
    if (body.status !== 'ok') return counts;
    const uuidsByVideo = new Map();
    for (const r of body.rows || []) {
      let s = uuidsByVideo.get(r.video);
      if (!s) { s = new Set(); uuidsByVideo.set(r.video, s); }
      s.add(r.punch_uuid);
    }
    for (const [video, s] of uuidsByVideo) counts.set(video, s.size);
  } catch {}
  return counts;
}

function buildOptionText(stem, baseText, count) {
  let suffix = '';
  if (count > 0) suffix = ' · ' + count + ' labeled';
  return stem + ' (' + baseText + ')' + suffix;
}

function updateOptionCount(stem, count) {
  if (!stem) return;
  state.labelCountsByVideo.set(stem, count);
  const sel = document.getElementById('video-select');
  if (!sel) return;
  for (const opt of sel.querySelectorAll('option[data-stem]')) {
    if (opt.dataset.stem !== stem) continue;
    opt.textContent = buildOptionText(stem, opt.dataset.base || '', count);
    opt.classList.toggle('labeled', count > 0);
    return;
  }
}

function populateVideoSelect(cachedVideos, counts) {
  const sel = document.getElementById('video-select');
  if (!sel) return;
  sel.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— pick a video —';
  sel.appendChild(placeholder);

  const cachedActive = cachedVideos.filter(v => !v.heldOut);
  if (!cachedActive.length) return;
  const grp = document.createElement('optgroup');
  grp.label = 'Cached videos · guard drops';
  for (const v of cachedActive.slice().sort((a, b) => a.stem.localeCompare(b.stem))) {
    const opt = document.createElement('option');
    opt.value = v.stem;
    const n = (v.rounds || []).length;
    const baseText = n + ' round' + (n === 1 ? '' : 's');
    const count = counts.get(v.stem) || 0;
    opt.dataset.stem = v.stem;
    opt.dataset.base = baseText;
    opt.textContent = buildOptionText(v.stem, baseText, count);
    if (count > 0) opt.classList.add('labeled');
    grp.appendChild(opt);
  }
  sel.appendChild(grp);
}

async function refreshCountsAndDropdown() {
  const map = await fetchTotalCounts();
  state.labelCountsByVideo = map;
  populateVideoSelect(state.knownVideos, map);
}

// ─── wire-up ───────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  setupPlayer();
  setSpeed(0.25);

  const labelerInput = document.getElementById('labeler-input');
  try { labelerInput.value = localStorage.getItem('orient_labeler_name') || ''; } catch {}
  labelerInput.addEventListener('change', async () => {
    try { localStorage.setItem('orient_labeler_name', labelerInput.value.trim()); } catch {}
    await refreshCountsAndDropdown();
    if (state.currentStem && state.candidates.length) syncFromSheet();
  });

  const cfg = await loadVideosConfig();
  state.knownVideos = cfg.videos || [];
  await refreshCountsAndDropdown();

  const selectEl = document.getElementById('video-select');
  selectEl.addEventListener('change', () => {
    state.currentStem = selectEl.value || null;
    if (!state.currentStem) { setModeBadge('no video'); return; }
    tryGenerateCandidates();
  });

  const video = document.getElementById('video-player');
  video.addEventListener('loadedmetadata', () => {
    state.videoLoaded = true;
    state.lastMediaTime = null;
    tryGenerateCandidates();
  });

  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const onFrame = (now, metadata) => {
      state.lastMediaTime = metadata.mediaTime;
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }

  // Loop the clip window while playing in scrub mode.
  video.addEventListener('timeupdate', () => {
    const lw = state.loopWindow;
    if (!lw || state.mode !== 'scrub' || video.paused) return;
    if (video.currentTime > lw.end + 0.05) video.currentTime = lw.start;
  });

  document.getElementById('btn-v-good').addEventListener('click', () => chooseVerdict('good'));
  document.getElementById('btn-v-dropped').addEventListener('click', () => chooseVerdict('dropped'));
  document.getElementById('btn-v-low').addEventListener('click', () => chooseVerdict('always_low'));
  document.getElementById('btn-undo').addEventListener('click', undoAction);
  document.getElementById('btn-skip-occluded').addEventListener('click', () => skipWith('occluded'));
  document.getElementById('btn-skip-unclear').addEventListener('click', () => skipWith('unclear'));
  document.getElementById('btn-skip-nopunch').addEventListener('click', () => skipWith('no_punch'));
  document.getElementById('btn-first').addEventListener('click', gotoFirst);
  document.getElementById('btn-prev').addEventListener('click', gotoPrev);
  document.getElementById('btn-next').addEventListener('click', gotoNext);
  document.getElementById('btn-next-unlabeled').addEventListener('click', gotoNextUnlabeled);
  document.getElementById('btn-export').addEventListener('click', exportPerLabelerCsvs);

  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('button');
    if (btn) btn.blur();
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // Skip menu is modal: 1/2/3 mean reasons there, verdicts everywhere else.
    if (state.mode === 'skipping') {
      const m = SKIP_REASONS.find(s => s.key === e.key);
      if (m) { e.preventDefault(); skipWith(m.reason); return; }
      if (e.key === 'Escape' || e.key === 's' || e.key === 'S') { e.preventDefault(); cancelToScrub(); return; }
      return;
    }

    const v = VERDICTS.find(x => x.key === e.key);
    if (v) { e.preventDefault(); chooseVerdict(v.value); return; }

    if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrames(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepFrames(1); return; }
    if (e.key === 'u' || e.key === 'U') { e.preventDefault(); undoAction(); return; }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); beginSkip(); return; }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); gotoNext(); return; }
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); gotoPrev(); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); gotoFirst(); return; }
    if (e.key === 'g' || e.key === 'G') { e.preventDefault(); gotoNextUnlabeled(); return; }
    if (e.key === 'x' || e.key === 'X') { e.preventDefault(); cycleSpeed(); return; }
  });

  setStatus('—');
  setCurrentLine('— pick a video to begin —');
});

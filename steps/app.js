// ============================================================
// app.js — Footwork step labeler
//
// Every step inside one fixed 20 s window per video (windows.json, written by
// cornerman-backend's ml/research/footwork/pick_step_windows.py — the same
// windows for every labeler, so two can be compared), one foot at a time: a
// pass for the lead foot, a pass for the rear foot, because in a step-and-drag
// the second foot often lifts before the first has landed. A step is a span
// from the frame the foot leaves the floor to the frame it lands, with the
// direction it moved in the boxer's own frame, or `pivot` (it turns on the
// ball without moving). A pass is "done" when the labeler says so — with or
// without steps, so an empty window counts as zero steps, not as unlabeled.
// Ground truth for the step detector (cornerman-backend, the footwork line):
// which foot moves first, when the lead foot lands against the jab's impact,
// and steps back.
//
// Shared pieces, as on the unusable page: the player, seek bar, minimap and
// zoom (../shared/player.js), the transport row, the name field and the
// shortcuts sheet (../shared/ui.js), the identity store
// (../shared/labeler_name.js), the skeleton overlay (../punch/skeleton.js) and
// the connected-folder auto-load (../punch/video-folder.js).
//
// Sheet (apps_script/Code.js, doGetSteps): the "Footwork steps" workbook —
//   Steps         id | video_file | video_name | labeler | foot | direction | start_sec | end_sec | span_uuid | ts
//   Windows Done  video_file | video_name | labeler | foot | window_start_sec | window_end_sec | done | ts
// Times are source-video seconds, the same clock as the punch labels.
// ============================================================

// The pad: the boxer's own directions, laid out as the keys sit on the
// keyboard (Q W E / A S D / Z X C), the pivot in the middle.
const DIRECTIONS = [
  { id: 'front_left',  label: 'Front-left',  key: 'q', arrow: '↖' },
  { id: 'front',       label: 'Front',       key: 'w', arrow: '↑' },
  { id: 'front_right', label: 'Front-right', key: 'e', arrow: '↗' },
  { id: 'left',        label: 'Left',        key: 'a', arrow: '←' },
  { id: 'pivot',       label: 'Pivot',       key: 's', arrow: '⟳' },
  { id: 'right',       label: 'Right',       key: 'd', arrow: '→' },
  { id: 'back_left',   label: 'Back-left',   key: 'z', arrow: '↙' },
  { id: 'back',        label: 'Back',        key: 'x', arrow: '↓' },
  { id: 'back_right',  label: 'Back-right',  key: 'c', arrow: '↘' },
];
const DIR_BY_ID = Object.fromEntries(DIRECTIONS.map(d => [d.id, d]));
const FEET = {
  lead: { label: 'Lead foot', color: '#4c8dff' },
  rear: { label: 'Rear foot', color: '#ff9f43' },
};
const FETCH_MS = 25000;
const LINK_DEBOUNCE_MS = 300;
const EDGE_EPS_S = 0.05;          // how far past the window a seek may land before it is pulled back

Object.assign(state, {
  videoLink: '',            // the normalized Drive link — the key every row is filed under
  pickedName: '',           // the tracking sheet's name for it (folder auto-load matches on it)
  win: null,                // this video's window {stem, angle, start_sec, end_sec, ...}
  windows: null,            // windows.json joined with the catalogue: [{stem, angle, start_sec, end_sec, link, key, n}]
  catalog: null,            // the tracking sheet's videos [{name, link, key}]
  doneAll: null,            // Map key -> [Windows Done rows] — every labeler's
  steps: [],                // every labeler's steps on this video
  foot: readFoot(),         // the foot being labeled
  draft: { start: null, end: null, direction: null },
  onlyUnfinished: true,
  selectedSpan: null,       // span_uuid of your step selected for editing
  editingSpan: null,        // span_uuid whose times are open in the list's editor
  undoStack: [],            // [{label, run}] — ⌘Z undoes the last change to your steps (this video)
  loadToken: 0,
});

// ============================================================
// helpers
// ============================================================
async function fetchJson(url, ms = FETCH_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const text = await res.text();
    try { return JSON.parse(text); } catch (_) { throw new Error('The sheet did not answer with data'); }
  } finally { clearTimeout(timer); }
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function videoEl() { return document.getElementById('video-player'); }
function me() { return labelerId() || ''; }
function fmtSec(t) { return formatTime(t); }
function setSync(text, err) {
  const el = document.getElementById('sync-chip');
  if (!el) return;
  el.hidden = !text; el.textContent = text || ''; el.classList.toggle('err', !!err);
}
function isTyping(e) { return e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName); }
function readFoot() { try { return localStorage.getItem('stepsFoot') === 'rear' ? 'rear' : 'lead'; } catch (e) { return 'lead'; } }
function needName() {
  if (me()) return false;
  showToast('Type your name first (top right) — steps are compared between labelers.', 'error');
  document.getElementById('labeler-input')?.focus();
  return true;
}

// ============================================================
// the windows: windows.json joined with the tracking sheet's catalogue by name
// ============================================================
function fetchCatalog() {
  return fetchJson(sheetUrl({ action: 'listTrackingVideos' }), FETCH_MS)
    .then(r => (Array.isArray(r && r.videos) ? r.videos : []))
    .catch(() => [])
    .then(videos => { state.catalog = videos.map(v => ({ name: v.name, link: v.link, key: normalizeDriveUrl(v.link) })); });
}
function fetchWindows() {
  return fetch('windows.json?v=' + Date.now()).then(r => r.json()).then(j => j.windows || []).catch(() => []);
}
function fetchDoneAll() {
  return fetchJson(sheetUrl({ action: 'listStepWindowsDone' }), FETCH_MS)
    .then(r => {
      if (!r || r.status !== 'ok') throw new Error('no list');
      const m = new Map();
      for (const row of r.done || []) {
        const key = normalizeDriveUrl(row.video_file);
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(row);
      }
      state.doneAll = m;
    })
    .catch(() => { state.doneAll = state.doneAll || new Map(); });
}
function joinWindows(wins) {
  const byName = new Map((state.catalog || []).map(v => [v.name, v]));
  state.windows = wins.map((w, i) => {
    const v = byName.get(w.stem);
    return { ...w, n: i + 1, link: v ? v.link : '', key: v ? v.key : '' };
  });
}
// your Done rows: which feet you have finished in a window
function doneFeet(key) {
  const mine = String(me()).toLowerCase();
  const rows = (state.doneAll && state.doneAll.get(key)) || [];
  return new Set(rows.filter(r => String(r.labeler).toLowerCase() === mine && String(r.done) === '1').map(r => r.foot));
}
function finished(key) { const d = doneFeet(key); return d.has('lead') && d.has('rear'); }
function windowsFiltered() {
  const all = (state.windows || []).filter(w => w.key);
  return state.onlyUnfinished ? all.filter(w => !finished(w.key) || w.key === state.videoLink) : all;
}

// ============================================================
// the window picker + the next-window button
// ============================================================
function setupVideoPicker() {
  const btn = document.getElementById('btn-pick-video');
  const panel = document.getElementById('video-picker-panel');
  const search = document.getElementById('video-picker-search');
  const list = document.getElementById('video-picker-list');
  const only = document.getElementById('only-unfinished');
  const count = document.getElementById('vp-count');

  function tag(w) {
    const d = doneFeet(w.key);
    let t = `<span class="vp-tag angle">${escapeHtml(w.angle)}</span>`;
    for (const f of ['lead', 'rear']) if (d.has(f)) t += `<span class="vp-tag done" style="--foot:${FEET[f].color}">${f} ✓</span>`;
    return t;
  }
  function renderList() {
    if (!state.windows) { list.innerHTML = '<div class="vp-loading">Loading windows…</div>'; return; }
    const q = search.value.trim().toLowerCase();
    const rows = windowsFiltered().filter(w => !q || w.stem.toLowerCase().includes(q));
    const missing = state.windows.filter(w => !w.key).length;
    count.textContent = `${rows.length} of ${state.windows.length}` + (missing ? ` · ${missing} not in the tracking sheet` : '');
    if (!rows.length) { list.innerHTML = `<div class="vp-empty">${state.onlyUnfinished && !q ? 'All windows finished — untick the filter to see them' : 'No windows to show'}</div>`; return; }
    list.innerHTML = rows.map(w =>
      `<button type="button" class="vp-row${w.key === state.videoLink ? ' current' : ''}" data-key="${escapeHtml(w.key)}">` +
      `<span class="vp-n">${w.n}.</span><span class="vp-name">${escapeHtml(w.stem)}</span>${tag(w)}</button>`).join('');
    list.querySelectorAll('.vp-row').forEach(el => el.addEventListener('click', () => {
      const w = state.windows.find(x => x.key === el.dataset.key);
      if (w) pickWindow(w);
      closePanel();
    }));
  }
  function openPanel() { panel.hidden = false; btn.classList.add('open'); search.value = ''; renderList(); search.focus(); }
  function closePanel() { panel.hidden = true; btn.classList.remove('open'); }
  btn.addEventListener('click', e => { e.preventDefault(); if (panel.hidden) openPanel(); else closePanel(); });
  search.addEventListener('input', renderList);
  search.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
  only.addEventListener('change', () => { state.onlyUnfinished = only.checked; renderList(); });
  document.getElementById('vp-refresh').addEventListener('click', e => {
    e.stopPropagation(); count.textContent = 'reading the sheet…';
    fetchDoneAll().then(() => { renderList(); renderWindow(); });
  });
  document.addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) closePanel(); });
  document.getElementById('btn-next-video').addEventListener('click', nextWindow);
  window._renderPickerList = renderList;
}

function pickWindow(w) {
  state.pickedName = w.stem;
  const input = document.getElementById('drive-link');
  input.value = w.link;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (typeof autoLoadVideoFromFolder === 'function') autoLoadVideoFromFolder(w.stem);
  if (typeof autoLoadSkeletonsFromFolder === 'function') autoLoadSkeletonsFromFolder(w.stem);
}

function nextWindow() {
  const rows = windowsFiltered();
  if (!rows.length) { showToast(state.windows ? 'Nothing left in the list.' : 'The windows are still loading.', 'info'); return; }
  const i = rows.findIndex(w => w.key === state.videoLink);
  const next = rows[(i + 1) % rows.length];
  if (next.key === state.videoLink) { showToast('This is the only window left in the list.', 'info'); return; }
  pickWindow(next);
}

// ============================================================
// the link: the key of every row, and what triggers the load
// ============================================================
function linkStatus(kind, detail) { if (typeof window.setLinkStatus === 'function') window.setLinkStatus(kind, detail); }
function fetchLabelsFromSheet() { loadSteps(); }   // the link chip's Retry (shared/ui.js) calls this by name

function setupDriveLink() {
  const input = document.getElementById('drive-link');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const key = normalizeDriveUrl(input.value);
      if (key === state.videoLink) return;
      state.videoLink = key;
      state.win = (state.windows || []).find(w => w.key === key) || null;
      if (state.win) state.pickedName = state.win.stem;
      clearDraft();
      renderWindow();
      fitWindow();
      loadSteps();
    }, LINK_DEBOUNCE_MS);
  });
}

async function loadSteps() {
  const token = ++state.loadToken;
  state.steps = [];
  state.selectedSpan = null; state.editingSpan = null; state.undoStack = [];
  renderSpanList(); renderTimelineOverlay();
  if (!state.videoLink) return;
  setSync('loading…'); linkStatus('syncing');
  try {
    const r = await fetchJson(sheetUrl({ action: 'listSteps', video: state.videoLink }));
    if (token !== state.loadToken) return;
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
    state.steps = (r.steps || []).map(s => ({ ...s, start_sec: Number(s.start_sec), end_sec: Number(s.end_sec) }));
    if (!state.doneAll) state.doneAll = new Map();
    state.doneAll.set(state.videoLink, r.done || []);
    setSync(''); linkStatus('ok');
  } catch (e) {
    if (token !== state.loadToken) return;
    setSync('could not load this video’s steps — ' + (e.message || e), true); linkStatus('err', 'Not loaded');
  }
  renderSpanList(); renderWindow(); renderTimelineOverlay();
}

// ============================================================
// the window: the timeline zoomed onto it, playback looping inside it
// ============================================================
function fitWindow() {
  const v = videoEl(), w = state.win;
  if (!v || !v.duration || !w) return;
  const pad = 1.0;
  state.zoomLevel = Math.max(1, v.duration / (w.end_sec - w.start_sec + 2 * pad));
  state.zoomCenter = ((w.start_sec + w.end_sec) / 2) / v.duration;
  clampZoomCenter();
  v.currentTime = w.start_sec;
  onZoomChanged();
}
// called on every time update: playing past the end loops to the start; a
// seek outside the window is pulled back to its nearer edge
function keepInWindow() {
  const v = videoEl(), w = state.win;
  if (!v || !v.duration || !w) return;
  const t = v.currentTime;
  if (!v.paused && t >= w.end_sec) { v.currentTime = w.start_sec; return; }
  if (v.paused && (t < w.start_sec - EDGE_EPS_S || t > w.end_sec + EDGE_EPS_S)) v.currentTime = t < w.start_sec ? w.start_sec : w.end_sec;
}

function renderWindow() {
  const info = document.getElementById('window-info'), count = document.getElementById('window-count');
  const doneBtn = document.getElementById('btn-done'), status = document.getElementById('done-status');
  const all = (state.windows || []).filter(w => w.key);
  const fin = all.filter(w => finished(w.key)).length;
  count.textContent = all.length ? `(${fin} of ${all.length} finished)` : '';
  document.querySelectorAll('.foot-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.foot === state.foot);
    b.setAttribute('aria-checked', b.dataset.foot === state.foot ? 'true' : 'false');
    b.style.setProperty('--foot', FEET[b.dataset.foot].color);
    b.classList.toggle('finished', !!state.win && doneFeet(state.videoLink).has(b.dataset.foot));
  });
  document.getElementById('draft-foot').textContent = `— ${FEET[state.foot].label.toLowerCase()}`;
  if (!state.videoLink) { info.textContent = 'Pick a window from the list.'; info.className = 'muted'; doneBtn.disabled = true; status.textContent = ''; return; }
  if (!state.win) { info.textContent = 'This video has no window — pick one from the list.'; info.className = 'warn'; doneBtn.disabled = true; status.textContent = ''; return; }
  const w = state.win;
  info.className = '';
  info.innerHTML = `<b>${w.n}.</b> ${escapeHtml(w.stem)}<br><span class="muted">${fmtSec(w.start_sec)} – ${fmtSec(w.end_sec)} · ${escapeHtml(w.angle)} camera</span>`;
  const done = doneFeet(state.videoLink).has(state.foot);
  doneBtn.disabled = false;
  doneBtn.classList.toggle('is-done', done);
  doneBtn.innerHTML = done ? 'Done ✓ — click to reopen' : 'This foot is done <kbd>⇧</kbd><kbd>Enter</kbd>';
  const n = state.steps.filter(s => ownSpan(s) && s.foot === state.foot).length;
  status.textContent = done ? `${n} step${n === 1 ? '' : 's'} of the ${state.foot} foot` : '';
}

function setFoot(foot) {
  state.foot = foot;
  try { localStorage.setItem('stepsFoot', foot); } catch (e) { /* this page only */ }
  clearDraft();
  renderWindow(); renderSpanList(); renderTimelineOverlay();
}

async function toggleDone() {
  if (!state.win || needName()) return;
  const foot = state.foot, key = state.videoLink;
  const was = doneFeet(key).has(foot), done = was ? 0 : 1;
  if (!was && state.draft.start != null) { showToast('Finish or clear (Esc) the half-made step first.', 'info'); return; }
  const rows = (state.doneAll.get(key) || []).filter(r => !(String(r.labeler).toLowerCase() === me().toLowerCase() && r.foot === foot));
  const before = state.doneAll.get(key) || [];
  state.doneAll.set(key, [...rows, { video_file: key, labeler: me(), foot, done: String(done) }]);
  renderWindow(); if (window._renderPickerList) window._renderPickerList();
  setSync('saving…');
  try {
    const r = await fetchJson(sheetUrl({ action: 'markStepWindowDone', video: key, videoName: state.win.stem, foot, done,
                                         window_start_sec: state.win.start_sec, window_end_sec: state.win.end_sec }));
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
    setSync('saved'); setTimeout(() => setSync(''), 1500);
    if (done) {
      const other = foot === 'lead' ? 'rear' : 'lead';
      if (!doneFeet(key).has(other)) { showToast(`${FEET[foot].label} done — now the ${other} foot.`, 'success'); setFoot(other); fitWindow(); }
      else { showToast('Both feet done — on to the next window.', 'success'); nextWindow(); }
    }
  } catch (e) {
    state.doneAll.set(key, before); renderWindow(); if (window._renderPickerList) window._renderPickerList();
    setSync('save failed — ' + (e.message || e), true);
    showToast('Could not save: ' + (e.message || e), 'error');
  }
}

// ============================================================
// the draft: lifts + lands + direction → a saved step of the current foot
// ============================================================
function renderDraft() {
  const d = state.draft;
  document.getElementById('draft-start').textContent = d.start == null ? '—' : fmtSec(d.start);
  document.getElementById('draft-end').textContent = d.end == null ? '—' : fmtSec(d.end);
  document.getElementById('btn-draft-start').classList.toggle('set', d.start != null);
  document.getElementById('btn-draft-end').classList.toggle('set', d.end != null);
  document.querySelectorAll('.dir-btn').forEach(b => {
    b.classList.toggle('armed', b.dataset.dir === d.direction);
    b.disabled = !state.win;
  });
}
function clearDraft() { state.draft = { start: null, end: null, direction: null }; renderDraft(); renderTimelineOverlay(); }
function setDraftStart() {
  const v = videoEl(); if (!v || !v.duration || !state.win) return;
  state.draft.start = v.currentTime; renderDraft(); renderTimelineOverlay(); maybeSaveDraft();
}
function setDraftEnd() {
  const v = videoEl(); if (!v || !v.duration || !state.win) return;
  state.draft.end = v.currentTime; renderDraft(); renderTimelineOverlay(); maybeSaveDraft();
}
function setDraftDirection(id) {
  if (!state.win) { showToast('Pick a window first.', 'info'); return; }
  const sel = selectedSpan();
  if (sel && state.draft.start == null) { changeSpan(sel, { direction: id }, 'direction'); return; }   // re-aim the selected step
  state.draft.direction = id; renderDraft(); maybeSaveDraft();
}
function maybeSaveDraft() {
  const d = state.draft;
  if (d.start == null || d.end == null || !d.direction) return;
  if (needName()) return;
  const a = Math.min(d.start, d.end), b = Math.max(d.start, d.end);
  const direction = d.direction;
  state.draft = { start: null, end: null, direction: null };
  renderDraft();
  saveSpan({ span_uuid: crypto.randomUUID(), labeler: me(), foot: state.foot, direction, start_sec: a, end_sec: b, ts: new Date().toISOString() });
}

// ============================================================
// changing your steps, as on the unusable page: select one, drag its edges or
// its middle, ✎ for typed times, the direction in the list (or a pad key with
// the step selected), Delete deletes it, ⌘Z undoes the last change. An add is
// undone by a delete, a delete by adding the step back under its uuid.
// ============================================================
const UNDO_MAX = 50;
function pushUndo(label, run) {
  state.undoStack.push({ label, run });
  if (state.undoStack.length > UNDO_MAX) state.undoStack.shift();
}
async function performUndo() {
  const u = state.undoStack.pop();
  if (!u) { showToast('Nothing to undo', 'info'); return; }
  showToast('Undo: ' + u.label, 'info');
  await u.run();
}
function selectedSpan() { return state.steps.find(s => s.span_uuid === state.selectedSpan) || null; }
function selectSpan(span) {
  state.selectedSpan = span ? span.span_uuid : null;
  if (!span) state.editingSpan = null;
  renderSpanList(); renderTimelineOverlay();
}
function stepParams(span) {
  return { video: state.videoLink, videoName: state.win ? state.win.stem : '', span_uuid: span.span_uuid,
           foot: span.foot, direction: span.direction, start_sec: span.start_sec, end_sec: span.end_sec };
}

async function saveSpan(span, undoable = true) {
  state.steps.push(span);
  renderSpanList(); renderTimelineOverlay(); renderWindow();
  setSync('saving…');
  try {
    const r = await fetchJson(sheetUrl({ action: 'addStep', ...stepParams(span) }));
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
    if (r.id != null) span.id = r.id;
    setSync('saved'); setTimeout(() => setSync(''), 1500);
    if (undoable) pushUndo('the new step', () => deleteSpan(span, false));
  } catch (e) {
    state.steps = state.steps.filter(s => s !== span);
    renderSpanList(); renderTimelineOverlay(); renderWindow();
    setSync('save failed — ' + (e.message || e), true);
    showToast('Could not save the step: ' + (e.message || e), 'error');
  }
}
// patch: any of direction / start_sec / end_sec; `before` defaults to the step as it is now
async function changeSpan(span, patch, what, undoable = true, before = null) {
  before = before || { direction: span.direction, start_sec: span.start_sec, end_sec: span.end_sec };
  Object.assign(span, patch);
  if (span.end_sec < span.start_sec) [span.start_sec, span.end_sec] = [span.end_sec, span.start_sec];
  if (span.direction === before.direction && span.start_sec === before.start_sec && span.end_sec === before.end_sec) {
    renderSpanList(); renderTimelineOverlay(); return;
  }
  renderSpanList(); renderTimelineOverlay();
  setSync('saving…');
  try {
    const r = await fetchJson(sheetUrl({ action: 'updateStep', ...stepParams(span) }));
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
    setSync('saved'); setTimeout(() => setSync(''), 1500);
    if (undoable) pushUndo(what, () => changeSpan(span, before, what, false));
  } catch (e) {
    Object.assign(span, before); renderSpanList(); renderTimelineOverlay();
    setSync('save failed — ' + (e.message || e), true);
    showToast(`Could not change the ${what}: ` + (e.message || e), 'error');
  }
}
async function deleteSpan(span, undoable = true) {
  state.steps = state.steps.filter(s => s !== span);
  if (state.selectedSpan === span.span_uuid) { state.selectedSpan = null; state.editingSpan = null; }
  renderSpanList(); renderTimelineOverlay(); renderWindow();
  try {
    const r = await fetchJson(sheetUrl({ action: 'deleteStep', video: state.videoLink, span_uuid: span.span_uuid }));
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
    if (undoable) {
      pushUndo('the deleted step', () => saveSpan(span, false));
      showToast('Step deleted — ⌘Z brings it back', 'info');
    }
  } catch (e) {
    state.steps.push(span); renderSpanList(); renderTimelineOverlay(); renderWindow();
    showToast('Could not delete the step: ' + (e.message || e), 'error');
  }
}

// dragging your steps on their lane: 7 px at either end moves that end, the
// middle moves the step (a chip under 22 px only moves); times snap to frames
// and the video follows the edge being moved; Esc cancels the drag
function setupSpanDragging() {
  const lanes = document.getElementById('seg-lanes'), seekBar = document.getElementById('seek-bar');
  const wrapper = document.getElementById('seek-bar-wrapper');
  if (!lanes || !seekBar) return;
  const EDGE = 7, MIN_EDGES = 22;
  let drag = null;
  const timeAt = x => { const r = seekBar.getBoundingClientRect(); return viewportPctToTime(((x - r.left) / r.width) * 100, videoEl().duration); };
  const snap = t => { const f = state.frameDuration || 1 / 30; return Math.max(0, Math.min(videoEl().duration || 0, Math.round(t / f) * f)); };
  const zoneOf = (el, x) => {
    const r = el.getBoundingClientRect();
    if (r.width < MIN_EDGES) return 'move';
    return x - r.left <= EDGE ? 'start' : r.right - x <= EDGE ? 'end' : 'move';
  };
  const spanOf = el => state.steps.find(s => s.span_uuid === el.dataset.uuid);
  lanes.addEventListener('mousemove', e => {
    if (drag) return;
    const chip = e.target.closest('.span-chip.own');
    if (chip) chip.style.cursor = zoneOf(chip, e.clientX) === 'move' ? 'grab' : 'ew-resize';
  });
  lanes.addEventListener('mousedown', e => {
    const chip = e.target.closest('.span-chip.own');
    if (!chip || e.button !== 0) return;
    const span = spanOf(chip);
    if (!span) return;
    e.preventDefault(); e.stopPropagation();
    drag = { span, zone: zoneOf(chip, e.clientX), x0: e.clientX, t0: timeAt(e.clientX), moved: false,
             before: { direction: span.direction, start_sec: span.start_sec, end_sec: span.end_sec } };
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return;
    drag.moved = true;
    const d = timeAt(e.clientX) - drag.t0, b = drag.before, s = drag.span;
    if (drag.zone === 'start') s.start_sec = Math.min(snap(b.start_sec + d), b.end_sec);
    else if (drag.zone === 'end') s.end_sec = Math.max(snap(b.end_sec + d), b.start_sec);
    else { const len = b.end_sec - b.start_sec; s.start_sec = snap(b.start_sec + d); s.end_sec = s.start_sec + len; }
    videoEl().currentTime = drag.zone === 'end' ? s.end_sec : s.start_sec;
    renderTimelineOverlay();
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    const dr = drag; drag = null;
    if (!dr.moved) { selectSpan(dr.span); const v = videoEl(); if (v && v.duration) v.currentTime = dr.span.start_sec; return; }
    state.selectedSpan = dr.span.span_uuid;
    changeSpan(dr.span, { start_sec: dr.span.start_sec, end_sec: dr.span.end_sec }, 'times', true, dr.before);
    // the click that ends a drag must not seek the video (the seek bar's own click handler)
    if (wrapper) wrapper.addEventListener('click', ev => ev.stopPropagation(), { capture: true, once: true });
  });
  document.addEventListener('keydown', e => {
    if (drag && e.key === 'Escape') {
      Object.assign(drag.span, drag.before); drag = null; renderTimelineOverlay(); e.stopPropagation();
    }
  }, true);
}

// ============================================================
// the list of your steps in this window, both feet, the current one first
// ============================================================
function ownSpan(s) { return !!me() && String(s.labeler || '').toLowerCase() === String(me()).toLowerCase(); }
function spanHolds(s, t) { const eps = (state.frameDuration || 1 / 30) / 2; return t >= s.start_sec - eps && t <= s.end_sec + eps; }
function spanTimes(s) { return s.end_sec - s.start_sec < 1e-6 ? `${fmtSec(s.start_sec)} · one frame` : `${fmtSec(s.start_sec)} – ${fmtSec(s.end_sec)}`; }
function shownSpans() {
  return state.steps.filter(ownSpan).sort((a, b) => (a.foot === state.foot ? 0 : 1) - (b.foot === state.foot ? 0 : 1) || a.start_sec - b.start_sec);
}
function renderSpanList() {
  const el = document.getElementById('span-list');
  const count = document.getElementById('span-count');
  if (!state.videoLink) { el.innerHTML = '<div class="muted">No video loaded.</div>'; count.textContent = ''; return; }
  const rows = shownSpans();
  const nl = rows.filter(s => s.foot === 'lead').length, nr = rows.length - nl;
  count.textContent = rows.length ? `(lead ${nl} · rear ${nr})` : '';
  if (!rows.length) { el.innerHTML = '<div class="muted">None yet.</div>'; return; }
  const t = videoEl() ? videoEl().currentTime : -1;
  el.innerHTML = rows.map((s, i) => {
    const dir = DIR_BY_ID[s.direction] || { label: s.direction, arrow: '?' };
    const sel = s.span_uuid === state.selectedSpan;
    const options = DIRECTIONS.map(x => `<option value="${x.id}"${x.id === s.direction ? ' selected' : ''}>${x.arrow} ${x.label}</option>`).join('');
    const head = `<div class="span-row${s.foot === state.foot ? '' : ' other-foot'}${sel ? ' selected' : ''}${spanHolds(s, t) ? ' current' : ''}" data-i="${i}" style="--reason:${FEET[s.foot] ? FEET[s.foot].color : '#9aa0a6'}">` +
      `<span class="swatch" title="${escapeHtml(FEET[s.foot] ? FEET[s.foot].label : s.foot)}"></span>` +
      `<span><span class="times">${spanTimes(s)}</span> · ${s.foot} · <select data-i="${i}" title="${escapeHtml(dir.label)}">${options}</select></span>` +
      `<span class="row-btns"><button type="button" class="edit" data-i="${i}" title="Change the times">✎</button>` +
      `<button type="button" class="del" data-i="${i}" title="Delete this step (Delete; ⌘Z undoes)">×</button></span></div>`;
    if (s.span_uuid !== state.editingSpan) return head;
    return head + `<div class="span-edit" data-i="${i}">` +
      `<label>lifts <input class="t-start" value="${fmtSec(s.start_sec)}"></label><button type="button" class="at-start" title="Lifts at the playhead">⇤ playhead</button>` +
      `<label>lands <input class="t-end" value="${fmtSec(s.end_sec)}"></label><button type="button" class="at-end" title="Lands at the playhead">playhead ⇥</button>` +
      `<button type="button" class="save-times">Save</button><button type="button" class="cancel-times">Cancel</button></div>`;
  }).join('');
  el.querySelectorAll('.span-row').forEach(row => row.addEventListener('click', e => {
    if (e.target.closest('select, button')) return;
    const s = rows[Number(row.dataset.i)];
    selectSpan(s);
    const v = videoEl(); if (v && v.duration) v.currentTime = s.start_sec;
  }));
  el.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => changeSpan(rows[Number(sel.dataset.i)], { direction: sel.value }, 'direction')));
  el.querySelectorAll('.del').forEach(b => b.addEventListener('click', () => deleteSpan(rows[Number(b.dataset.i)])));
  el.querySelectorAll('.edit').forEach(b => b.addEventListener('click', () => {
    const s = rows[Number(b.dataset.i)];
    state.selectedSpan = s.span_uuid;
    state.editingSpan = state.editingSpan === s.span_uuid ? null : s.span_uuid;
    renderSpanList(); renderTimelineOverlay();
    const input = el.querySelector('.span-edit .t-start'); if (input) input.focus();
  }));
  el.querySelectorAll('.span-edit').forEach(form => {
    const s = rows[Number(form.dataset.i)], v = videoEl();
    const start = form.querySelector('.t-start'), end = form.querySelector('.t-end');
    const save = () => {
      const a = parseTime(start.value), b = parseTime(end.value);
      if (!Number.isFinite(a) || !Number.isFinite(b)) { showToast('Times as M:SS.mmm or seconds', 'error'); return; }
      state.editingSpan = null;
      changeSpan(s, { start_sec: a, end_sec: b }, 'times');
    };
    form.querySelector('.at-start').addEventListener('click', () => { if (v) start.value = fmtSec(v.currentTime); });
    form.querySelector('.at-end').addEventListener('click', () => { if (v) end.value = fmtSec(v.currentTime); });
    form.querySelector('.save-times').addEventListener('click', save);
    form.querySelector('.cancel-times').addEventListener('click', () => { state.editingSpan = null; renderSpanList(); });
    form.querySelectorAll('input').forEach(inp => inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); state.editingSpan = null; renderSpanList(); }
    }));
  });
}

// skeleton.js calls this after a load and after a reset
function onSkeletonRoundsChanged() { renderTimelineOverlay(); }

// ============================================================
// the timeline — player.js calls renderTimelineOverlay() on zoom / metadata
// and updateVideoOverlay() on every time update
// ============================================================
function laneChips(lane, spans, duration, opts = {}) {
  const mini = lane.id === 'minimap-segments';
  for (const s of spans) {
    const dir = DIR_BY_ID[s.direction];
    const l = timeToViewportPct(s.start_sec, duration), w = Math.max(0.2, timeToViewportPct(s.end_sec, duration) - l);
    if (l + w < 0 || l > 100) continue;
    const chip = document.createElement('div');
    const own = !opts.draft && s.span_uuid && !mini;
    chip.className = 'span-chip' + (opts.draft ? ' draft' : '') + (own ? ' own' : '') + (own && s.span_uuid === state.selectedSpan ? ' selected' : '');
    if (own) chip.dataset.uuid = s.span_uuid;
    chip.style.cssText = `left:${Math.max(0, l)}%;width:${Math.min(100, l + w) - Math.max(0, l)}%;--reason:${FEET[s.foot] ? FEET[s.foot].color : '#9aa0a6'}`;
    if (!mini && dir) chip.textContent = dir.arrow;
    chip.title = `${FEET[s.foot] ? FEET[s.foot].label : s.foot} · ${dir ? dir.label : s.direction || '…'} · ${spanTimes(s)}`;
    if (own) chip.addEventListener('click', e => e.stopPropagation());   // select / drag: setupSpanDragging
    lane.appendChild(chip);
  }
}
function renderTimelineOverlay() {
  const v = videoEl(); const lanes = document.getElementById('seg-lanes');
  if (!v || !lanes) return;
  const duration = v.duration || 0;
  const playhead = document.getElementById('playhead');
  lanes.querySelectorAll('.seg-lane').forEach(n => n.remove());
  const mini = document.getElementById('minimap-segments');
  if (mini) mini.innerHTML = '';
  if (!duration) return;
  // the window — the footage to label
  const wl = document.createElement('div');
  wl.className = 'seg-lane lane-window'; wl.dataset.laneLabel = 'window';
  if (state.win) {
    const l = timeToViewportPct(state.win.start_sec, duration), w = timeToViewportPct(state.win.end_sec, duration) - l;
    const band = document.createElement('div');
    band.className = 'win-band'; band.style.cssText = `left:${Math.max(0, l)}%;width:${Math.min(100, l + w) - Math.max(0, l)}%`;
    band.title = `the window: ${fmtSec(state.win.start_sec)} – ${fmtSec(state.win.end_sec)}`;
    wl.appendChild(band);
    if (mini) { const m = band.cloneNode(); m.style.cssText = `left:${100 * state.win.start_sec / duration}%;width:${100 * (state.win.end_sec - state.win.start_sec) / duration}%`; mini.appendChild(m); }
  }
  lanes.insertBefore(wl, playhead);
  // your two feet, the one being labeled highlighted
  const mine = state.steps.filter(ownSpan);
  for (const foot of ['lead', 'rear']) {
    const lane = document.createElement('div');
    lane.className = 'seg-lane lane-foot' + (foot === state.foot ? ' lane-own active' : '');
    lane.dataset.laneLabel = foot;
    lane.style.setProperty('--foot', FEET[foot].color);
    laneChips(lane, mine.filter(s => s.foot === foot), duration);
    if (foot === state.foot) {
      const d = state.draft;
      if (d.start != null || d.end != null) {
        const a = d.start != null ? d.start : v.currentTime, b = d.end != null ? d.end : v.currentTime;
        laneChips(lane, [{ foot, direction: d.direction, start_sec: Math.min(a, b), end_sec: Math.max(a, b) }], duration, { draft: true });
      }
    }
    lanes.insertBefore(lane, playhead);
  }
  if (mini) laneChips(mini, mine, duration);
  if (typeof renderTimeTicks === 'function') renderTimeTicks();
  updateVideoOverlay();
}
function updateVideoOverlay() {
  const v = videoEl(); if (!v) return;
  keepInWindow();
  const playhead = document.getElementById('playhead');
  if (playhead && v.duration) {
    const pct = timeToViewportPct(v.currentTime, v.duration);
    playhead.hidden = pct < 0 || pct > 100;
    playhead.style.left = pct + '%';
  }
  if (typeof drawSkeletonFrame === 'function') drawSkeletonFrame(v.currentTime);
  const rows = shownSpans();
  document.querySelectorAll('#span-list .span-row').forEach(row => {
    const s = rows[Number(row.dataset.i)];
    row.classList.toggle('current', !!s && spanHolds(s, v.currentTime));
  });
  if (state.draft.start != null && state.draft.end == null) {
    const lane = document.querySelector('#seg-lanes .lane-own');
    if (lane) {
      lane.querySelectorAll('.span-chip.draft').forEach(n => n.remove());
      const a = Math.min(state.draft.start, v.currentTime), b = Math.max(state.draft.start, v.currentTime);
      laneChips(lane, [{ foot: state.foot, direction: state.draft.direction, start_sec: a, end_sec: b }], v.duration, { draft: true });
    }
  }
}

// ============================================================
// keys, buttons, boot
// ============================================================
// ? (the shortcuts sheet), ↑ / ↓ (volume) and ⌘+ / ⌘− / ⌘0 (timeline zoom) are shared/ui.js's.
function setupKeys() {
  document.addEventListener('keydown', e => {
    if (!isTyping(e) && (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault(); performUndo(); return;
    }
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('#video-picker-panel')) return;
    // A focused button would take Enter or Space as a click as well.
    if (typeof e.target.blur === 'function') e.target.blur();
    const v = videoEl();
    switch (e.key) {
      case ' ': e.preventDefault(); if (v && v.duration) togglePlay(); return;
      case 'ArrowLeft': e.preventDefault(); if (v && v.duration) stepFrames(e.shiftKey ? -10 : -1); return;
      case 'ArrowRight': e.preventDefault(); if (v && v.duration) stepFrames(e.shiftKey ? 10 : 1); return;
      case 'Enter':
        e.preventDefault();
        if (e.shiftKey) { toggleDone(); return; }
        if (state.draft.start == null) setDraftStart(); else setDraftEnd();
        return;
      case 'Escape': clearDraft(); if (state.selectedSpan) selectSpan(null); return;
      case 'Delete': case 'Backspace': {
        const sel = selectedSpan();
        if (sel && ownSpan(sel)) { e.preventDefault(); deleteSpan(sel); }
        return;
      }
      case 'n': case 'N': e.preventDefault(); nextWindow(); return;
      case 'k': case 'K': e.preventDefault(); document.getElementById('btn-toggle-skeleton')?.click(); return;
      case 'f': case 'F': e.preventDefault(); setFoot(state.foot === 'lead' ? 'rear' : 'lead'); return;
    }
    const dir = DIRECTIONS.find(d => d.key === e.key.toLowerCase());
    if (dir) { e.preventDefault(); setDraftDirection(dir.id); }
  });
}

function setupPanel() {
  const pad = document.getElementById('direction-pad');
  pad.innerHTML = DIRECTIONS.map(d =>
    `<button type="button" class="dir-btn${d.id === 'pivot' ? ' pivot' : ''}" data-dir="${d.id}" title="${d.label} (${d.key.toUpperCase()})">` +
    `<span class="arrow">${d.arrow}</span><span class="dir-label">${d.label}</span><kbd>${d.key.toUpperCase()}</kbd></button>`).join('');
  pad.querySelectorAll('.dir-btn').forEach(b => b.addEventListener('click', () => setDraftDirection(b.dataset.dir)));
  document.querySelectorAll('.foot-btn').forEach(b => b.addEventListener('click', () => setFoot(b.dataset.foot)));
  document.getElementById('btn-draft-start').addEventListener('click', setDraftStart);
  document.getElementById('btn-draft-end').addEventListener('click', setDraftEnd);
  document.getElementById('btn-done').addEventListener('click', toggleDone);
  renderDraft(); renderWindow();
}

document.addEventListener('DOMContentLoaded', () => {
  setupPlayer();
  if (typeof setupVideoFolder === 'function') setupVideoFolder();
  setupPanel();
  setupDriveLink();
  setupVideoPicker();
  setupKeys();
  setupSpanDragging();
  renderSpanList();
  Promise.all([fetchCatalog(), fetchWindows(), fetchDoneAll()]).then(([, wins]) => {
    joinWindows(wins);
    if (state.videoLink) { state.win = state.windows.find(w => w.key === state.videoLink) || null; fitWindow(); }
    if (window._renderPickerList) window._renderPickerList();
    renderWindow(); renderTimelineOverlay();
  });
  // the name decides which steps are yours: repaint when it changes
  document.getElementById('labeler-input')?.addEventListener('change', () => { renderWindow(); renderSpanList(); renderTimelineOverlay(); if (window._renderPickerList) window._renderPickerList(); });
  const v = videoEl();
  v.addEventListener('loadedmetadata', () => { fitWindow(); renderTimelineOverlay(); renderDraft(); });
});

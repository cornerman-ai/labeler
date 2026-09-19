// ============================================================
// app.js — Unusable footage labeler
//
// The team watches a video with its BlazePose skeleton drawn on top and marks
// every stretch where that skeleton cannot be used — the boxer out of the
// picture, the tracker on someone else, a frozen skeleton, a camera move — as
// a span with a reason; then marks the video reviewed and moves on to the
// next unreviewed one. The labels behind the skeleton (rounds, punches) are
// made BEFORE the skeleton exists, so this is its own pass, after extraction.
//
// Shared pieces: the player, seek bar, minimap and zoom (../shared/player.js),
// the transport row, the timeline's scroll-zoom, the name field, the status
// chips and the shortcuts sheet (../shared/ui.js — the punch page's chrome),
// the identity store (../shared/labeler_name.js), the skeleton overlay from the
// extraction's .npy/_pts.npy/_meta.json triples (../punch/skeleton.js) and the
// connected-folder auto-load of the video + its skeleton files
// (../punch/video-folder.js) — the same ids, so a folder connected in the punch
// labeler is connected here too. The detectors' hints on the timeline (no
// skeleton, jumps) are computed here from those same files — detectorHints().
//
// Sheet (apps_script/Code.js, doGetUnusable): two tabs in the labels workbook —
//   Unusable Spans     id | video_file | labeler | reason | start_sec | end_sec | span_uuid | ts
//   Unusable Reviewed  video_file | video_name | labeler | verdict | ts     (verdict: reviewed | whole_video_unusable)
// and "Whole video unusable" (action retireVideo) moves every row of the video
// from Combined Data Archive and every labeler's tab to Skeleton Problems.
// Times are source-video seconds, the same clock as the punch labels.
// ============================================================

const REASONS = [
  { id: 'out_of_frame', label: 'Out of frame', key: '1', color: '#e85a5a',
    desc: 'The boxer is out of the picture or hidden — behind the bag, someone in front' },
  { id: 'other_person', label: 'Other person', key: '2', color: '#b48cff',
    desc: 'The skeleton sits on someone who is not the boxer' },
  { id: 'other_thing',  label: 'Other thing',  key: '3', color: '#4cc9b0',
    desc: 'The skeleton sits on something that is not a person — a painting, a statue, the bag' },
  { id: 'frozen',       label: 'Frozen',       key: '4', color: '#8ab4f8',
    desc: 'The skeleton does not move — a paused frame, a stuck tracker' },
  { id: 'camera',       label: 'Camera',       key: '5', color: '#f5a23c',
    desc: 'The camera moves, cuts or zooms' },
  { id: 'other',        label: 'Other',        key: '6', color: '#9aa0a6',
    desc: 'Anything else that makes this stretch of skeleton wrong' },
];
const REASON_BY_ID = Object.fromEntries(REASONS.map(r => [r.id, r]));
const VERDICT_TEXT = { reviewed: 'reviewed', whole_video_unusable: 'whole video unusable' };
const FETCH_MS = 25000;
const LINK_DEBOUNCE_MS = 300;

Object.assign(state, {
  videoLink: '',            // the normalized Drive link — the key every row is filed under
  pickedName: '',           // the tracking sheet's name for it (folder auto-load matches on it)
  spans: [],                // every labeler's spans on this video
  reviewed: [],             // the reviewed rows of this video
  draft: { start: null, end: null, reason: null },
  catalog: null,            // the tracking sheet's videos [{name, link, key, n}]
  reviewedAll: null,        // Map key -> [{labeler, verdict, ts, video_name}]
  skeletonStems: null,      // Set of stems that have skeleton files (shared/videos.json)
  onlyUnreviewed: true,
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
function me() { return labelerId(); }
function stemOf(name) { return String(name || '').replace(/\.(mp4|mov|m4v|webm)$/i, '').replace(/_h264$/, ''); }
function fmtSec(t) { return formatTime(t); }
function setSync(text, err) {
  const el = document.getElementById('sync-chip');
  if (!el) return;
  el.hidden = !text; el.textContent = text || ''; el.classList.toggle('err', !!err);
}
function isTyping(e) { return e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName); }

// ============================================================
// the catalogue: the tracking sheet's videos, who reviewed what, which have skeletons
// ============================================================
function fetchCatalog() {
  return fetchJson(sheetUrl({ action: 'listTrackingVideos' }), FETCH_MS)
    .then(r => (Array.isArray(r && r.videos) ? r.videos : []))
    .catch(() => [])
    .then(videos => {
      state.catalog = videos.map((v, i) => ({ name: v.name, link: v.link, key: normalizeDriveUrl(v.link), n: i + 1 }));
      return state.catalog;
    });
}
function fetchReviewedAll() {
  return fetchJson(sheetUrl({ action: 'listUnusableReviewed' }), FETCH_MS)
    .then(r => {
      const m = new Map();
      for (const row of (r && r.reviewed) || []) {
        const key = normalizeDriveUrl(row.video_file);
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(row);
      }
      state.reviewedAll = m;
      return m;
    })
    .catch(() => { state.reviewedAll = state.reviewedAll || new Map(); return state.reviewedAll; });
}
function fetchSkeletonStems() {
  return fetch('../shared/videos.json').then(r => r.json())
    .then(j => { state.skeletonStems = new Set((j.videos || []).map(v => stemOf(v.stem))); })
    .catch(() => { state.skeletonStems = null; });
}
function reviewOf(key) {
  const rows = state.reviewedAll ? (state.reviewedAll.get(key) || []) : [];
  const retired = rows.find(r => r.verdict === 'whole_video_unusable');
  return retired || rows[0] || null;
}
function catalogFiltered() {
  const all = state.catalog || [];
  return state.onlyUnreviewed ? all.filter(v => !reviewOf(v.key)) : all;
}

// ============================================================
// the video picker + the next-video button
// ============================================================
function setupVideoPicker() {
  const btn = document.getElementById('btn-pick-video');
  const panel = document.getElementById('video-picker-panel');
  const search = document.getElementById('video-picker-search');
  const list = document.getElementById('video-picker-list');
  const only = document.getElementById('only-unreviewed');
  const count = document.getElementById('vp-count');

  function tag(v) {
    const rv = reviewOf(v.key);
    let t = '';
    if (rv) t += `<span class="vp-tag ${rv.verdict === 'whole_video_unusable' ? 'retired' : 'done'}" title="${escapeHtml(rv.ts || '')}">${escapeHtml(VERDICT_TEXT[rv.verdict] || rv.verdict)} · ${escapeHtml(rv.labeler)}</span>`;
    if (state.skeletonStems && !state.skeletonStems.has(stemOf(v.name))) t += '<span class="vp-tag noskel" title="No skeleton files on the shelf for this video">no skeleton</span>';
    return t;
  }
  function renderList() {
    if (!state.catalog) { list.innerHTML = '<div class="vp-loading">Loading videos…</div>'; return; }
    const q = search.value.trim().toLowerCase();
    const rows = catalogFiltered().filter(v => !q || v.name.toLowerCase().includes(q));
    count.textContent = `${rows.length} of ${state.catalog.length}`;
    if (!rows.length) { list.innerHTML = '<div class="vp-empty">No videos to show</div>'; return; }
    list.innerHTML = rows.map(v =>
      `<button type="button" class="vp-row${v.key === state.videoLink ? ' current' : ''}" data-key="${escapeHtml(v.key)}">` +
      `<span class="vp-n">${v.n}.</span><span class="vp-name">${escapeHtml(v.name)}</span>${tag(v)}</button>`).join('');
    list.querySelectorAll('.vp-row').forEach(el => el.addEventListener('click', () => {
      const v = state.catalog.find(x => x.key === el.dataset.key);
      if (v) pickVideo(v);
      closePanel();
    }));
  }
  function openPanel() { panel.hidden = false; btn.classList.add('open'); search.value = ''; renderList(); search.focus(); }
  function closePanel() { panel.hidden = true; btn.classList.remove('open'); }
  btn.addEventListener('click', e => { e.preventDefault(); if (panel.hidden) openPanel(); else closePanel(); });
  search.addEventListener('input', renderList);
  search.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
  only.addEventListener('change', () => { state.onlyUnreviewed = only.checked; renderList(); });
  document.addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) closePanel(); });
  document.getElementById('btn-next-video').addEventListener('click', nextVideo);
  window._renderPickerList = renderList;
}

function pickVideo(v) {
  state.pickedName = v.name;
  const input = document.getElementById('drive-link');
  input.value = v.link;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (typeof autoLoadVideoFromFolder === 'function') autoLoadVideoFromFolder(v.name);
  if (typeof autoLoadSkeletonsFromFolder === 'function') autoLoadSkeletonsFromFolder(v.name);
}

function nextVideo() {
  const rows = catalogFiltered();
  if (!rows.length) { showToast(state.catalog ? 'Nothing left in the list.' : 'The video list is still loading.', 'info'); return; }
  const i = rows.findIndex(v => v.key === state.videoLink);
  const next = rows[(i + 1) % rows.length];
  if (next.key === state.videoLink) { showToast('This is the only video left in the list.', 'info'); return; }
  pickVideo(next);
}

// ============================================================
// the link: the key of every row, and what triggers the load
// ============================================================
// The link chip in the source row is shared/ui.js's (setLinkStatus: Checking… /
// Saved / Not saved + Retry, hidden again while the link is being typed); its
// Retry button calls fetchLabelsFromSheet by name — here that is loadSpans.
function linkStatus(kind, detail) { if (typeof window.setLinkStatus === 'function') window.setLinkStatus(kind, detail); }
function fetchLabelsFromSheet() { loadSpans(); }

function setupDriveLink() {
  const input = document.getElementById('drive-link');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const key = normalizeDriveUrl(input.value);
      if (key === state.videoLink) return;
      state.videoLink = key;
      if (!state.pickedName || (state.catalog && !state.catalog.some(v => v.key === key && v.name === state.pickedName))) {
        const hit = state.catalog && state.catalog.find(v => v.key === key);
        state.pickedName = hit ? hit.name : '';
      }
      clearDraft();
      loadSpans();
    }, LINK_DEBOUNCE_MS);
  });
}

async function loadSpans() {
  const token = ++state.loadToken;
  state.spans = []; state.reviewed = [];
  renderSpanList(); renderReview(); renderTimelineOverlay();
  if (!state.videoLink) return;
  setSync('loading…'); linkStatus('syncing');
  try {
    const r = await fetchJson(sheetUrl({ action: 'listUnusable', video: state.videoLink }));
    if (token !== state.loadToken) return;
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
    state.spans = (r.spans || []).map(s => ({ ...s, start_sec: Number(s.start_sec), end_sec: Number(s.end_sec) }));
    state.reviewed = r.reviewed || [];
    setSync(''); linkStatus('ok');
  } catch (e) {
    if (token !== state.loadToken) return;
    setSync('could not load this video’s spans — ' + (e.message || e), true); linkStatus('err', 'Not loaded');
  }
  renderSpanList(); renderReview(); renderTimelineOverlay();
}

// ============================================================
// the draft: start + end + reason → a saved span
// ============================================================
function renderDraft() {
  const d = state.draft;
  const s = document.getElementById('draft-start'), e = document.getElementById('draft-end');
  s.textContent = d.start == null ? '—' : fmtSec(d.start);
  e.textContent = d.end == null ? '—' : fmtSec(d.end);
  document.getElementById('btn-draft-start').classList.toggle('set', d.start != null);
  document.getElementById('btn-draft-end').classList.toggle('set', d.end != null);
  document.querySelectorAll('.reason-btn').forEach(b => {
    b.classList.toggle('armed', b.dataset.reason === d.reason);
    b.disabled = !state.videoLink;
  });
}
function clearDraft() { state.draft = { start: null, end: null, reason: null }; renderDraft(); renderTimelineOverlay(); }
function setDraftStart() {
  const v = videoEl(); if (!v || !v.duration) return;
  state.draft.start = v.currentTime; renderDraft(); renderTimelineOverlay(); maybeSaveDraft();
}
function setDraftEnd() {
  const v = videoEl(); if (!v || !v.duration) return;
  state.draft.end = v.currentTime; renderDraft(); renderTimelineOverlay(); maybeSaveDraft();
}
function setDraftReason(id) {
  if (!state.videoLink) { showToast('Pick a video first.', 'info'); return; }
  state.draft.reason = id; renderDraft(); maybeSaveDraft();
}
function maybeSaveDraft() {
  const d = state.draft;
  if (d.start == null || d.end == null || !d.reason) return;
  const a = Math.min(d.start, d.end), b = Math.max(d.start, d.end);   // a == b: a one-frame span
  const reason = d.reason;
  state.draft = { start: null, end: null, reason: null };   // cleared first: saveSpan repaints the lanes
  renderDraft();
  saveSpan({ span_uuid: crypto.randomUUID(), labeler: me(), reason, start_sec: a, end_sec: b, ts: new Date().toISOString() });
}

async function saveSpan(span) {
  if (!me()) { showToast('No labeler name yet — set it in the punch labeler first.', 'error'); return; }
  state.spans.push(span);
  renderSpanList(); renderTimelineOverlay();
  setSync('saving…');
  try {
    const r = await fetchJson(sheetUrl({ action: 'addUnusable', video: state.videoLink, reason: span.reason,
                                         start_sec: span.start_sec, end_sec: span.end_sec, span_uuid: span.span_uuid }));
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
    if (r.id != null) span.id = r.id;
    setSync('saved'); setTimeout(() => setSync(''), 1500);
  } catch (e) {
    state.spans = state.spans.filter(s => s !== span);
    renderSpanList(); renderTimelineOverlay();
    setSync('save failed — ' + (e.message || e), true);
    showToast('Could not save the span: ' + (e.message || e), 'error');
  }
}
async function updateSpanReason(span, reason) {
  const before = span.reason;
  span.reason = reason; renderSpanList(); renderTimelineOverlay();
  try {
    const r = await fetchJson(sheetUrl({ action: 'updateUnusable', video: state.videoLink, span_uuid: span.span_uuid, reason,
                                         start_sec: span.start_sec, end_sec: span.end_sec }));
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
  } catch (e) {
    span.reason = before; renderSpanList(); renderTimelineOverlay();
    showToast('Could not change the reason: ' + (e.message || e), 'error');
  }
}
async function deleteSpan(span) {
  const r0 = REASON_BY_ID[span.reason];
  if (!confirm(`Delete the ${r0 ? r0.label.toLowerCase() : span.reason} span ${spanTimes(span)}?`)) return;
  state.spans = state.spans.filter(s => s !== span);
  renderSpanList(); renderTimelineOverlay();
  try {
    const r = await fetchJson(sheetUrl({ action: 'deleteUnusable', video: state.videoLink, span_uuid: span.span_uuid }));
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
  } catch (e) {
    state.spans.push(span); renderSpanList(); renderTimelineOverlay();
    showToast('Could not delete the span: ' + (e.message || e), 'error');
  }
}

// ============================================================
// the list of spans
// ============================================================
function ownSpan(s) { return String(s.labeler || '').toLowerCase() === String(me() || '').toLowerCase(); }
// A span holds a time to within half a frame, so a one-frame span (start ==
// end, Enter twice on the same frame) is found at its own frame; its times read
// as one frame rather than a zero-length range.
function spanHolds(s, t) { const eps = (state.frameDuration || 1 / 30) / 2; return t >= s.start_sec - eps && t <= s.end_sec + eps; }
function spanTimes(s) { return s.end_sec - s.start_sec < 1e-6 ? `${fmtSec(s.start_sec)} · one frame` : `${fmtSec(s.start_sec)} – ${fmtSec(s.end_sec)}`; }
function currentSpan(t) { return state.spans.find(s => spanHolds(s, t)) || null; }
function renderSpanList() {
  const el = document.getElementById('span-list');
  const count = document.getElementById('span-count');
  if (!state.videoLink) { el.innerHTML = '<div class="muted">No video loaded.</div>'; count.textContent = ''; return; }
  const rows = [...state.spans].sort((a, b) => a.start_sec - b.start_sec);
  count.textContent = rows.length ? `(${rows.length})` : '';
  if (!rows.length) { el.innerHTML = '<div class="muted">None yet — this video may be clean.</div>'; return; }
  const t = videoEl() ? videoEl().currentTime : -1;
  el.innerHTML = rows.map((s, i) => {
    const r = REASON_BY_ID[s.reason] || { label: s.reason, color: '#9aa0a6' };
    const own = ownSpan(s);
    const options = REASONS.map(x => `<option value="${x.id}"${x.id === s.reason ? ' selected' : ''}>${x.label}</option>`).join('');
    return `<div class="span-row${own ? '' : ' foreign'}${spanHolds(s, t) ? ' current' : ''}" data-i="${i}" style="--reason:${r.color}">` +
      `<span class="swatch"></span>` +
      `<span><span class="times">${spanTimes(s)}</span> · ${own ? `<select data-i="${i}">${options}</select>` : escapeHtml(r.label)}` +
      `<span class="who"> · ${escapeHtml(s.labeler || '')}</span></span>` +
      (own ? `<button type="button" class="del" data-i="${i}" title="Delete this span">×</button>` : '<span></span>') +
      `</div>`;
  }).join('');
  el.querySelectorAll('.span-row').forEach(row => row.addEventListener('click', e => {
    if (e.target.closest('select, .del')) return;
    const s = rows[Number(row.dataset.i)];
    const v = videoEl(); if (v && v.duration) v.currentTime = s.start_sec;
  }));
  el.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => updateSpanReason(rows[Number(sel.dataset.i)], sel.value)));
  el.querySelectorAll('.del').forEach(b => b.addEventListener('click', () => deleteSpan(rows[Number(b.dataset.i)])));
}

// ============================================================
// review: the verdict per video
// ============================================================
function renderReview() {
  const el = document.getElementById('review-status');
  const btn = document.getElementById('btn-reviewed');
  const retire = document.getElementById('btn-retire');
  el.className = 'muted';
  if (!state.videoLink) { el.textContent = '—'; btn.disabled = true; retire.disabled = true; return; }
  btn.disabled = false; retire.disabled = false;
  const rows = state.reviewed || [];
  const retired = rows.find(r => r.verdict === 'whole_video_unusable');
  if (retired) { el.textContent = `whole video unusable — ${retired.labeler}, ${String(retired.ts || '').slice(0, 10)}`; el.className = 'retired'; retire.disabled = true; return; }
  if (rows.length) { el.textContent = 'reviewed by ' + rows.map(r => `${r.labeler} (${String(r.ts || '').slice(0, 10)})`).join(', '); el.className = 'done'; return; }
  el.textContent = 'not reviewed yet';
}
function noteReviewed(row) {
  state.reviewed = [...state.reviewed.filter(r => r.labeler !== row.labeler), row];
  if (!state.reviewedAll) state.reviewedAll = new Map();
  const list = (state.reviewedAll.get(state.videoLink) || []).filter(r => r.labeler !== row.labeler);
  list.push(row); state.reviewedAll.set(state.videoLink, list);
  renderReview();
  if (window._renderPickerList) window._renderPickerList();
}
async function markReviewed() {
  if (!state.videoLink) return;
  if (!me()) { showToast('No labeler name yet — set it in the punch labeler first.', 'error'); return; }
  setSync('saving…');
  try {
    const r = await fetchJson(sheetUrl({ action: 'markUnusableReviewed', video: state.videoLink, videoName: state.pickedName || state.videoName || '', verdict: 'reviewed' }));
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
    noteReviewed({ video_file: state.videoLink, video_name: state.pickedName, labeler: me(), verdict: 'reviewed', ts: new Date().toISOString() });
    setSync('saved'); setTimeout(() => setSync(''), 1500);
    showToast('Marked reviewed.', 'success');
    if (document.getElementById('auto-next').checked) nextVideo();
  } catch (e) {
    setSync('could not mark reviewed — ' + (e.message || e), true);
    showToast('Could not mark the video reviewed: ' + (e.message || e), 'error');
  }
}
async function retireVideo() {
  if (!state.videoLink) return;
  if (!me()) { showToast('No labeler name yet — set it in the punch labeler first.', 'error'); return; }
  setSync('counting rows…');
  let counts;
  try {
    const r = await fetchJson(sheetUrl({ action: 'retireVideo', video: state.videoLink, videoName: state.pickedName || state.videoName || '', dry: '1', actor: me() }));
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
    counts = r.moved || {};
    setSync('');
  } catch (e) {
    setSync('could not count the rows — ' + (e.message || e), true);
    showToast('Could not look up this video’s rows: ' + (e.message || e), 'error');
    return;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const lines = Object.entries(counts).filter(([, n]) => n > 0).map(([sheet, n]) => `  ${n} from ${sheet}`).join('\n');
  const name = state.pickedName || state.videoName || state.videoLink;
  if (!confirm(`Whole video unusable: ${name}\n\nMove ${total} row${total === 1 ? '' : 's'} to Skeleton Problems?\n${lines || '  (no rows found in the labeling tabs)'}\n\nThe video is then marked reviewed. Combined Data follows at the next rebuild.`)) return;
  setSync('moving rows…');
  try {
    const r = await fetchJson(sheetUrl({ action: 'retireVideo', video: state.videoLink, videoName: name, actor: me() }), 60000);
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
    const moved = Object.values(r.moved || {}).reduce((a, b) => a + b, 0);
    noteReviewed({ video_file: state.videoLink, video_name: name, labeler: me(), verdict: 'whole_video_unusable', ts: new Date().toISOString() });
    setSync('done'); setTimeout(() => setSync(''), 1500);
    showToast(`Moved ${moved} row${moved === 1 ? '' : 's'} to Skeleton Problems.`, 'success');
    if (document.getElementById('auto-next').checked) nextVideo();
  } catch (e) {
    setSync('the move failed — ' + (e.message || e), true);
    showToast('The move failed: ' + (e.message || e), 'error');
  }
}

// ============================================================
// the detectors' hints — computed here, in the browser, from the skeleton
// files just loaded, so a newly extracted video shows them with no export
// step. The rules mirror cornerman-backend's ml/research/skeleton_usability
// (no_skeleton.py, and the jump rule of jumps.py): the cache's own
// image-normalized x/y, a torso = the round's median shoulder-mid ↔ hip-mid
// distance over its detected frames, the same thresholds — change them in
// both places or in neither.
//   NO SKELETON  a frame inside the round (the meta's start_sec … end_sec; the
//                1.5 s pre-roll is footage, not round) where no joint has a
//                finite x, in a run of at least HINT_MIN_FRAMES frames
//   JUMP         between consecutive DETECTED frames (the frames without a
//                skeleton between them skipped) the core — the mean of the two
//                shoulders and the two hips — moves more than HINT_JUMP_TORSO
//                torsos within HINT_JUMP_MAX_DT_S seconds, one end in the round
// The other-person stretches and the frozen skeleton stay in the backend's
// lens: which of two skeletons is the boxer is the labeler's call here.
// ============================================================
const HINT_MIN_FRAMES = 3;
const HINT_JUMP_TORSO = 1.0;
const HINT_JUMP_MAX_DT_S = 0.25;
const HINT_CORE_JOINTS = [11, 12, 23, 24];   // BlazePose-33: left / right shoulder, left / right hip

function detectorHints(r) {
  if (r._hints) return r._hints;
  const N = r.nFrames, J = r.nJoints, C = r.nChannels, pts = r.pts;
  const inRound = Number.isFinite(r.startSec) && Number.isFinite(r.endSec)
    ? f => pts[f] >= r.startSec && pts[f] <= r.endSec : () => true;
  const at = (f, j, ch) => r.data[f * J * C + j * C + ch];

  // no skeleton: runs of in-round frames where no joint has a finite x
  const missing = [];
  let run = -1;
  for (let f = 0; f <= N; f++) {
    let none = f < N && inRound(f);
    if (none) for (let j = 0; j < J; j++) if (Number.isFinite(at(f, j, r.xIdx))) { none = false; break; }
    if (none) { if (run < 0) run = f; continue; }
    if (run >= 0 && f - run >= HINT_MIN_FRAMES) missing.push({ s: pts[run], e: pts[f - 1], n: f - run, f0: run, f1: f - 1 });
    run = -1;
  }

  // jumps: the core's step between consecutive detected frames, in torsos
  const jumps = [];
  if (J > Math.max(...HINT_CORE_JOINTS)) {
    const cx = new Float64Array(N), cy = new Float64Array(N), torso = new Float64Array(N), det = new Uint8Array(N);
    for (let f = 0; f < N; f++) {
      const p = HINT_CORE_JOINTS.map(j => [at(f, j, r.xIdx), at(f, j, r.yIdx)]);
      if (p.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) continue;
      det[f] = 1;
      cx[f] = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4;
      cy[f] = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4;
      torso[f] = Math.hypot((p[0][0] + p[1][0]) / 2 - (p[2][0] + p[3][0]) / 2, (p[0][1] + p[1][1]) / 2 - (p[2][1] + p[3][1]) / 2);
    }
    const inr = [], all = [];
    for (let f = 0; f < N; f++) if (det[f]) { all.push(torso[f]); if (inRound(f)) inr.push(torso[f]); }
    const ref = (inr.length >= 10 ? inr : all).sort((a, b) => a - b);
    if (ref.length >= 2) {
      const h = ref.length >> 1;
      const tmed = Math.max(ref.length % 2 ? ref[h] : (ref[h - 1] + ref[h]) / 2, 1e-6);
      let i = -1;
      for (let f = 0; f < N; f++) {
        if (!det[f]) continue;
        if (i >= 0 && (inRound(i) || inRound(f))) {
          const step = Math.hypot(cx[f] - cx[i], cy[f] - cy[i]) / tmed, dt = pts[f] - pts[i];
          if (step > HINT_JUMP_TORSO && dt <= HINT_JUMP_MAX_DT_S) jumps.push({ s: pts[i], e: pts[f], f0: i, f1: f, gap: f - i, dt, step });
        }
        i = f;
      }
    }
  }
  r._hints = { missing, jumps };
  return r._hints;
}

// skeleton.js calls this after a load and after a reset: the skeleton lane
// and the hints follow the files, whichever of video and skeleton came last
function onSkeletonRoundsChanged() { renderTimelineOverlay(); }

// ============================================================
// the timeline — player.js calls renderTimelineOverlay() on zoom / metadata
// and updateVideoOverlay() on every time update
// ============================================================
function hintChips(lane, rounds, duration, pct) {
  const mini = lane.id === 'minimap-segments';
  const seek = t => { const v = videoEl(); if (v && v.duration) v.currentTime = t; };
  for (const r of rounds) {
    const h = detectorHints(r);
    for (const m of h.missing) {
      const l = pct(m.s, duration), w = Math.max(0.15, pct(m.e, duration) - l);
      if (l + w < 0 || l > 100) continue;
      const chip = document.createElement('div');
      chip.className = 'hint-chip missing';
      chip.style.cssText = `left:${Math.max(0, l)}%;width:${Math.min(100, l + w) - Math.max(0, l)}%`;
      chip.title = `no skeleton · ${fmtSec(m.s)} – ${fmtSec(m.e)} · ${m.n} frames`;
      if (!mini) chip.addEventListener('click', e => { e.stopPropagation(); seek(m.s); });
      lane.appendChild(chip);
    }
    for (const j of h.jumps) {
      const l = pct(j.e, duration);
      if (l < 0 || l > 100) continue;
      const chip = document.createElement('div');
      chip.className = 'hint-chip jump';
      chip.style.left = l + '%';
      chip.title = `jump · ${j.step.toFixed(1)} torso in ${Math.round(j.dt * 1000)} ms · lands ${fmtSec(j.e)}`;
      if (!mini) chip.addEventListener('click', e => { e.stopPropagation(); seek(j.e); });
      lane.appendChild(chip);
    }
  }
}
function laneChips(lane, spans, duration, opts = {}) {
  for (const s of spans) {
    const r = REASON_BY_ID[s.reason] || { label: s.reason, color: '#9aa0a6' };
    const l = timeToViewportPct(s.start_sec, duration), w = Math.max(0.2, timeToViewportPct(s.end_sec, duration) - l);
    if (l + w < 0 || l > 100) continue;
    const chip = document.createElement('div');
    chip.className = 'span-chip' + (opts.foreign ? ' foreign' : '') + (opts.draft ? ' draft' : '');
    chip.style.cssText = `left:${Math.max(0, l)}%;width:${Math.min(100, l + w) - Math.max(0, l)}%;--reason:${r.color}`;
    chip.title = `${r.label} · ${spanTimes(s)}${s.labeler ? ' · ' + s.labeler : ''}`;
    if (!opts.draft) chip.addEventListener('click', e => { e.stopPropagation(); const v = videoEl(); if (v && v.duration) v.currentTime = s.start_sec; });
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
  // where a skeleton exists at all — the extraction's rounds
  const skel = document.createElement('div');
  skel.className = 'seg-lane lane-skeleton'; skel.dataset.laneLabel = 'skeleton';
  for (const r of (state.skeleton && state.skeleton.rounds) || []) {
    if (!r.pts || !r.pts.length) continue;
    const l = timeToViewportPct(r.pts[0], duration), w = timeToViewportPct(r.pts[r.pts.length - 1], duration) - l;
    if (l + w < 0 || l > 100) continue;
    const band = document.createElement('div');
    band.className = 'skel-band'; band.style.cssText = `left:${Math.max(0, l)}%;width:${Math.min(100, l + w) - Math.max(0, l)}%`;
    band.title = `skeleton round ${r.round}`;
    skel.appendChild(band);
  }
  lanes.insertBefore(skel, playhead);
  // what the detectors found in those files: no skeleton, jumps
  const rounds = (state.skeleton && state.skeleton.rounds) || [];
  if (rounds.length) {
    const lane = document.createElement('div');
    lane.className = 'seg-lane lane-hints'; lane.dataset.laneLabel = 'detected';
    const nJ = rounds.reduce((a, r) => a + detectorHints(r).jumps.length, 0);
    const nM = rounds.reduce((a, r) => a + detectorHints(r).missing.length, 0);
    lane.title = `Found in the skeleton files: ${nJ} jump${nJ === 1 ? '' : 's'} (yellow — the skeleton moves more than a torso within ¼ s) `
      + `and ${nM} stretch${nM === 1 ? '' : 'es'} without a skeleton (red — 3 frames or more). Hints to check on the footage, not labels; click one to go there.`;
    hintChips(lane, rounds, duration, timeToViewportPct);
    lanes.insertBefore(lane, playhead);
  }
  // one lane per labeler, yours first
  const byLabeler = new Map();
  for (const s of state.spans) { const k = s.labeler || '?'; if (!byLabeler.has(k)) byLabeler.set(k, []); byLabeler.get(k).push(s); }
  const mine = me();
  if (mine && !byLabeler.has(mine)) byLabeler.set(mine, []);
  const order = [...byLabeler.keys()].sort((a, b) => (a === mine ? -1 : b === mine ? 1 : a.localeCompare(b)));
  for (const who of order) {
    const lane = document.createElement('div');
    const own = who === mine;
    lane.className = 'seg-lane ' + (own ? 'lane-own' : 'lane-foreign'); lane.dataset.laneLabel = who;
    laneChips(lane, byLabeler.get(who), duration, { foreign: !own });
    if (own) {
      const d = state.draft;
      if (d.start != null || d.end != null) {
        const a = d.start != null ? d.start : v.currentTime, b = d.end != null ? d.end : v.currentTime;
        laneChips(lane, [{ start_sec: Math.min(a, b), end_sec: Math.max(a, b), reason: d.reason || 'other' }], duration, { draft: true });
      }
    }
    lanes.insertBefore(lane, playhead);
  }
  if (mini) { hintChips(mini, rounds, duration, (t, d) => 100 * t / d); laneChips(mini, state.spans.filter(ownSpan), duration); }
  if (typeof renderTimeTicks === 'function') renderTimeTicks();
  updateVideoOverlay();
}
function updateVideoOverlay() {
  const v = videoEl(); if (!v) return;
  const playhead = document.getElementById('playhead');
  if (playhead && v.duration) {
    const pct = timeToViewportPct(v.currentTime, v.duration);
    playhead.hidden = pct < 0 || pct > 100;
    playhead.style.left = pct + '%';
  }
  if (typeof drawSkeletonFrame === 'function') drawSkeletonFrame(v.currentTime);
  const cur = currentSpan(v.currentTime);
  document.querySelectorAll('#span-list .span-row').forEach(row => {
    const rows = [...state.spans].sort((a, b) => a.start_sec - b.start_sec);
    row.classList.toggle('current', rows[Number(row.dataset.i)] === cur);
  });
  if (state.draft.start != null && state.draft.end == null) {
    const lane = document.querySelector('#seg-lanes .lane-own');
    if (lane) { lane.querySelectorAll('.span-chip.draft').forEach(n => n.remove());
      const a = Math.min(state.draft.start, v.currentTime), b = Math.max(state.draft.start, v.currentTime);
      laneChips(lane, [{ start_sec: a, end_sec: b, reason: state.draft.reason || 'other' }], v.duration, { draft: true }); }
  }
}

// ============================================================
// keys, buttons, boot
// ============================================================
// ? (the shortcuts sheet) and ⌘+ / ⌘− / ⌘0 (timeline zoom) are shared/ui.js's.
function setupKeys() {
  document.addEventListener('keydown', e => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('#video-picker-panel')) return;
    // A focused button would take Enter or Space as a click as well.
    if (typeof e.target.blur === 'function') e.target.blur();
    const v = videoEl();
    switch (e.key) {
      case ' ': e.preventDefault(); if (v && v.duration) togglePlay(); return;
      case 'ArrowLeft': e.preventDefault(); if (v && v.duration) stepFrames(e.shiftKey ? -10 : -1); return;
      case 'ArrowRight': e.preventDefault(); if (v && v.duration) stepFrames(e.shiftKey ? 10 : 1); return;
      case 'Enter': e.preventDefault(); if (state.draft.start == null) setDraftStart(); else setDraftEnd(); return;
      case 's': case 'S': case '[': e.preventDefault(); setDraftStart(); return;
      case 'e': case 'E': case ']': e.preventDefault(); setDraftEnd(); return;
      case 'Escape': clearDraft(); return;
      case 'r': case 'R': e.preventDefault(); markReviewed(); return;
      case 'n': case 'N': e.preventDefault(); nextVideo(); return;
      case 'k': case 'K': e.preventDefault(); document.getElementById('btn-toggle-skeleton')?.click(); return;
    }
    const reason = REASONS.find(r => r.key === e.key);
    if (reason) { e.preventDefault(); setDraftReason(reason.id); }
  });
}

function setupPanel() {
  const wrap = document.getElementById('reason-buttons');
  wrap.innerHTML = REASONS.map(r =>
    `<button type="button" class="reason-btn" data-reason="${r.id}" style="--reason:${r.color}" title="${escapeHtml(r.desc)}">` +
    `<span class="swatch"></span>${r.label} <kbd>${r.key}</kbd></button>`).join('');
  wrap.querySelectorAll('.reason-btn').forEach(b => b.addEventListener('click', () => setDraftReason(b.dataset.reason)));
  document.getElementById('btn-draft-start').addEventListener('click', setDraftStart);
  document.getElementById('btn-draft-end').addEventListener('click', setDraftEnd);
  document.getElementById('btn-reviewed').addEventListener('click', markReviewed);
  document.getElementById('btn-retire').addEventListener('click', retireVideo);
  renderDraft();
}

document.addEventListener('DOMContentLoaded', () => {
  setupPlayer();
  if (typeof setupVideoFolder === 'function') setupVideoFolder();
  setupPanel();
  setupDriveLink();
  setupVideoPicker();
  setupKeys();
  renderSpanList(); renderReview();
  Promise.all([fetchCatalog(), fetchReviewedAll(), fetchSkeletonStems()]).then(() => {
    if (window._renderPickerList) window._renderPickerList();
    // a link pasted before the catalogue arrived gets its name now
    if (state.videoLink && !state.pickedName) { const hit = state.catalog.find(v => v.key === state.videoLink); if (hit) state.pickedName = hit.name; }
  });
  const v = videoEl();
  v.addEventListener('loadedmetadata', () => { renderTimelineOverlay(); renderDraft(); });
});

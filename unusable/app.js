// ============================================================
// app.js — Unusable footage labeler
//
// Step 4 of the label review (cornerman-backend/ml/label_review/REVIEW_FLOW.md):
// after the check report is clean and the skeleton is extracted, before the
// rows are flipped to yes. The team works through the videos whose rows are
// still Reviewing in the labeling tabs, each with its BlazePose skeleton drawn
// on top, marking every stretch where that skeleton cannot be used — the boxer
// out of the picture, the tracker on someone else, a frozen skeleton, a camera
// move — as a span with a reason. A video done here is flipped to yes in the
// sheet by hand (step 5) and leaves the list.
//
// Shared pieces: the player, seek bar, minimap and zoom (../shared/player.js),
// the transport row, the timeline's scroll-zoom, the name field, the status
// chips and the shortcuts sheet (../shared/ui.js — the punch page's chrome),
// the identity store (../shared/labeler_name.js), the skeleton overlay from the
// extraction's .npy/_pts.npy/_meta.json triples (../punch/skeleton.js) and the
// connected-folder auto-load of the video + its skeleton files
// (../punch/video-folder.js) — the same ids, so a folder connected in the punch
// labeler is connected here too. The detectors' hints on the timeline (no
// skeleton, jumps — detectorHints(); where the picture cuts the boxer —
// framingHints()) are computed here from those same files.
//
// Sheet (apps_script/Code.js, doGetUnusable): two tabs in the labels workbook —
//   Unusable Spans     id | video_file | labeler | reason | start_sec | end_sec | span_uuid | ts
//   Unusable Reviewed  video_file | video_name | labeler | verdict | ts     (verdict: whole_video_unusable — retirements;
//                      the review mark itself is the sheet's Reviewing → yes flip)
// "Whole video unusable" (action retireVideo) moves every row of the video
// from Combined Data Archive and every labeler's tab to Skeleton Problems;
// listReviewingVideos reads the `reviewed` column of every person's tab.
// Times are source-video seconds, the same clock as the punch labels.
// ============================================================

// The team labels one thing (Mathe, 2026-09-29): the tracker on the wrong
// target — the stretch it sits there, and the jumps onto it and back. Where
// the picture cuts the boxer is computed (framingHints) and goes to training
// as a mask; the frozen skeleton has its rule; hidden and camera are not
// labeled.
const REASONS = [
  { id: 'other_person', label: 'Other person', key: '1', color: '#b48cff',
    desc: 'The skeleton sits on someone who is not the boxer — from the jump onto them to the jump back' },
  { id: 'other_thing',  label: 'Other thing',  key: '2', color: '#4cc9b0',
    desc: 'The skeleton sits on something that is not a person — a painting, a statue, the bag' },
  { id: 'jump',         label: 'Jump',         key: '3', color: '#ffcc4d',
    desc: 'The skeleton leaps onto someone or something else, or back to the boxer — mark the frame(s) of the leap (usually a yellow tick)' },
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
  reviewedAll: null,        // Map key -> [{labeler, verdict, ts, video_name}] — retirements
  reviewing: null,          // Map key -> {rows, tabs}: the videos whose rows are still Reviewing in the labeling tabs
  skeletonStems: null,      // Set of stems that have skeleton files (shared/videos.json)
  onlyUnreviewed: true,
  showFraming: readFlag('unusableShowFraming', true),   // the framing lane (F) — per browser
  review: readFlag('unusableReview', false),   // review mode: every lane, every labeler's spans, no skipping; labeling mode (default): only what to check
  inMoment: null,           // the index of the moment the playhead is in
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
// No name is needed here (Mathe, 2026-09-19): rows are filed under whatever
// name the punch labeler stored — Admin included — or under none.
function me() { return labelerId() || ''; }
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
function fetchReviewing() {
  return fetchJson(sheetUrl({ action: 'listReviewingVideos' }), FETCH_MS)
    .then(r => {
      if (!r || r.status !== 'ok' || !Array.isArray(r.videos)) throw new Error('no list');
      state.reviewing = new Map(r.videos.map(v => [normalizeDriveUrl(v.video_file), v]));
    })
    .catch(() => {});   // stays as it was (null = not known: the list then shows every video)
}
function fetchSkeletonStems() {
  return fetch('../shared/videos.json').then(r => r.json())
    .then(j => { state.skeletonStems = new Set((j.videos || []).map(v => stemOf(v.stem))); })
    .catch(() => { state.skeletonStems = null; });
}
// A retirement (verdict whole_video_unusable) is the only verdict this page
// writes; the review mark itself is the sheet's Reviewing → yes flip.
function reviewOf(key) {
  const rows = state.reviewedAll ? (state.reviewedAll.get(key) || []) : [];
  return rows.find(r => r.verdict === 'whole_video_unusable') || null;
}
// The list this pass works through: the videos whose rows are still Reviewing
// in the labeling tabs and that were not retired. Until that list has loaded
// (or when it could not be read), every video.
function catalogFiltered() {
  const all = state.catalog || [];
  if (!state.onlyUnreviewed || !state.reviewing) return all;
  return all.filter(v => state.reviewing.has(v.key) && !reviewOf(v.key));
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
    let t = '';
    const rw = state.reviewing && state.reviewing.get(v.key);
    if (rw) t += `<span class="vp-tag reviewing" title="${escapeHtml(Object.entries(rw.tabs || {}).map(([tab, n]) => `${n} in ${tab}`).join(', '))}">Reviewing · ${rw.rows} row${rw.rows === 1 ? '' : 's'}</span>`;
    const rv = reviewOf(v.key);
    if (rv) t += `<span class="vp-tag retired" title="${escapeHtml(rv.ts || '')}">${escapeHtml(VERDICT_TEXT[rv.verdict] || rv.verdict)}${rv.labeler ? ' · ' + escapeHtml(rv.labeler) : ''}</span>`;
    if (state.skeletonStems && !state.skeletonStems.has(stemOf(v.name))) t += '<span class="vp-tag noskel" title="No skeleton files on the shelf for this video">no skeleton</span>';
    return t;
  }
  function renderList() {
    if (!state.catalog) { list.innerHTML = '<div class="vp-loading">Loading videos…</div>'; return; }
    const q = search.value.trim().toLowerCase();
    const rows = catalogFiltered().filter(v => !q || v.name.toLowerCase().includes(q));
    count.textContent = `${rows.length} of ${state.catalog.length}`;
    if (!rows.length) {
      list.innerHTML = '<div class="vp-empty">' + (state.onlyUnreviewed && state.reviewing && !state.reviewing.size && !q
        ? 'Nothing is Reviewing in the sheet right now — run the label review check first (it marks the new rows), or untick the filter to see every video'
        : 'No videos to show') + '</div>';
      return;
    }
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
  document.getElementById('vp-refresh').addEventListener('click', e => {
    e.stopPropagation(); count.textContent = 'reading the sheet…';
    Promise.all([fetchReviewing(), fetchReviewedAll()]).then(() => { renderList(); renderReview(); });
  });
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
  renderSpanList(); renderReview(); renderCheckList(); renderTimelineOverlay();
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
  const rows = shownSpans();
  count.textContent = rows.length ? `(${rows.length})` : '';
  if (!rows.length) { el.innerHTML = `<div class="muted">${state.review ? 'None yet — this video may be clean.' : 'None of yours yet.'}</div>`; return; }
  const t = videoEl() ? videoEl().currentTime : -1;
  el.innerHTML = rows.map((s, i) => {
    const r = REASON_BY_ID[s.reason] || { label: s.reason, color: '#9aa0a6' };
    const own = ownSpan(s);
    const options = REASONS.map(x => `<option value="${x.id}"${x.id === s.reason ? ' selected' : ''}>${x.label}</option>`).join('');
    return `<div class="span-row${own ? '' : ' foreign'}${spanHolds(s, t) ? ' current' : ''}" data-i="${i}" style="--reason:${r.color}">` +
      `<span class="swatch"></span>` +
      `<span><span class="times">${spanTimes(s)}</span> · ${own ? `<select data-i="${i}">${options}</select>` : escapeHtml(r.label)}` +
      (s.labeler ? `<span class="who"> · ${escapeHtml(s.labeler)}</span>` : '') + '</span>' +
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
  const retire = document.getElementById('btn-retire');
  el.className = 'muted';
  if (!state.videoLink) { el.textContent = '—'; retire.disabled = true; return; }
  retire.disabled = false;
  const retired = reviewOf(state.videoLink) || (state.reviewed || []).find(r => r.verdict === 'whole_video_unusable');
  if (retired) { el.textContent = `whole video unusable — ${retired.labeler ? retired.labeler + ', ' : ''}${String(retired.ts || '').slice(0, 10)}`; el.className = 'retired'; retire.disabled = true; return; }
  const rw = state.reviewing && state.reviewing.get(state.videoLink);
  if (rw) { el.textContent = `Reviewing in the sheet — ${rw.rows} row${rw.rows === 1 ? '' : 's'} waiting for this pass`; el.className = 'reviewing'; return; }
  el.textContent = state.reviewing ? 'not under review — its rows are yes already, or not checked yet' : 'reading the sheet…';
}
function noteReviewed(row) {
  state.reviewed = [...state.reviewed.filter(r => r.labeler !== row.labeler), row];
  if (!state.reviewedAll) state.reviewedAll = new Map();
  const list = (state.reviewedAll.get(state.videoLink) || []).filter(r => r.labeler !== row.labeler);
  list.push(row); state.reviewedAll.set(state.videoLink, list);
  renderReview();
  if (window._renderPickerList) window._renderPickerList();
}
async function retireVideo() {
  if (!state.videoLink) return;
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
  if (!confirm(`Whole video unusable: ${name}\n\nMove ${total} row${total === 1 ? '' : 's'} to Skeleton Problems?\n${lines || '  (no rows found in the labeling tabs)'}\n\nIt then leaves the Reviewing list. Combined Data follows at the next rebuild.`)) return;
  setSync('moving rows…');
  try {
    const r = await fetchJson(sheetUrl({ action: 'retireVideo', video: state.videoLink, videoName: name, actor: me() }), 60000);
    if (!r || r.status !== 'ok') throw new Error((r && r.message) || 'no answer');
    const moved = Object.values(r.moved || {}).reduce((a, b) => a + b, 0);
    noteReviewed({ video_file: state.videoLink, video_name: name, labeler: me(), verdict: 'whole_video_unusable', ts: new Date().toISOString() });
    setSync('done'); setTimeout(() => setSync(''), 1500);
    showToast(`Moved ${moved} row${moved === 1 ? '' : 's'} to Skeleton Problems.`, 'success');
    nextVideo();
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
//                finite x, in a run of at least HINT_MIN_FRAMES frames — 1 here
//                (Mathe, 2026-09-19: every missing frame shows; a jump costs one
//                94 % of the time), where the backend's survey and model keep
//                the 3-frame floor of no_skeleton.py. The threshold for actual
//                use comes later; this lane is the visual check.
//   JUMP         between consecutive DETECTED frames (the frames without a
//                skeleton between them skipped) the core — the mean of the two
//                shoulders and the two hips — moves more than HINT_JUMP_TORSO
//                torsos within HINT_JUMP_MAX_DT_S seconds, one end in the round
// The other-person stretches and the frozen skeleton stay in the backend's
// lens: which of two skeletons is the boxer is the labeler's call here.
// ============================================================
const HINT_MIN_FRAMES = 1;
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

// ============================================================
// the framing lane — where the picture cuts the boxer, read off the same
// files: BlazePose keeps placing a joint whose body part has left the
// picture, its image-normalized x or y just runs past [0, 1]. The mirror of
// cornerman-backend's ml/research/skeleton_usability/framing.py — the same
// 13 joints (nose, shoulders, elbows, wrists, hips, knees, ankles), the same
// kinds and defaults; change them in both places or in neither.
//   LEGS CUT      some joint below the bottom edge; one past a side AND below
//                 (an extrapolated ankle in the corner) counts as below
//   PARTLY OUT    some joint past the left or right edge (and not below), or
//                 an upper-body joint (nose, shoulders, elbows, wrists) past
//                 the top — legs above the top are an upside-down skeleton
//   OUT OF FRAME  every upper-body joint outside the picture, or a run of
//                 frames without a skeleton against a partly-out stretch: he
//                 left (or came back) through the edge
// Each kind's mask is smoothed on its own — in-round gaps shorter than
// FRAMING_GAP_S between two stretches closed, then stretches shorter than
// FRAMING_MIN_S dropped — and a frame takes the most severe kind that holds
// it. Only frames inside the round are judged.
// ============================================================
const FRAMING_KINDS = ['legs_cut', 'partly_out', 'out_of_frame'];   // levels 1, 2, 3
const FRAMING_STYLE = {                   // the lane's own legend; red is the Out of frame reason's
  out_of_frame: { label: 'Out of frame', color: '#e85a5a' },
  partly_out:   { label: 'Partly out',   color: '#ff8fb1' },
  legs_cut:     { label: 'Legs cut off', color: '#c9a36b' },
};
const FRAMING_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const FRAMING_UPPER = 7;                  // the first 7 of FRAMING_JOINTS can leave through the top, and say he is gone
const FRAMING_MARGIN = 0.0;               // a joint is outside once it is this far past the border
const FRAMING_MIN_S = 0.5;
const FRAMING_GAP_S = 0.5;

function readFlag(key, dflt) {
  try { const v = localStorage.getItem(key); return v == null ? dflt : v === '1'; } catch (e) { return dflt; }
}
function writeFlag(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* the toggle still works for this page */ }
}
function toggleFraming() {
  if (!state.review) { showToast('The framing lane is part of review mode', 'info'); return; }
  state.showFraming = !state.showFraming;
  writeFlag('unusableShowFraming', state.showFraming);
  showToast(state.showFraming ? 'Framing lane on' : 'Framing lane off — F brings it back');
  renderTimelineOverlay();
}

function framingSmooth(mask, inr, minF, gapF) {
  const N = mask.length, m = Uint8Array.from(mask);
  for (let f = 0; f < N;) {                // close the in-round gaps shorter than gapF between two stretches
    if (m[f] || !inr[f]) { f++; continue; }
    let g = f;
    while (g < N && !m[g] && inr[g]) g++;
    if (g - f < gapF && f > 0 && g < N && m[f - 1] && m[g]) m.fill(1, f, g);
    f = g;
  }
  for (let f = 0; f < N;) {                // then drop the stretches shorter than minF
    if (!m[f]) { f++; continue; }
    let g = f;
    while (g < N && m[g]) g++;
    if (g - f < minF) m.fill(0, f, g);
    f = g;
  }
  return m;
}

function framingHints(r) {
  if (r._framing) return r._framing;
  const N = r.nFrames, J = r.nJoints, C = r.nChannels, pts = r.pts;
  const stretches = [];
  r._framing = stretches;
  if (J <= Math.max(...FRAMING_JOINTS)) return stretches;
  const at = (f, j, ch) => r.data[f * J * C + j * C + ch];
  const judged = Number.isFinite(r.startSec) && Number.isFinite(r.endSec);
  const M = FRAMING_MARGIN;
  const inr = new Uint8Array(N), legs = new Uint8Array(N), side = new Uint8Array(N), gone = new Uint8Array(N), none = new Uint8Array(N);
  for (let f = 0; f < N; f++) {
    inr[f] = !judged || (pts[f] >= r.startSec && pts[f] <= r.endSec) ? 1 : 0;
    if (!inr[f]) continue;
    let det = true, below = false, out = false, upperOut = true;
    for (let i = 0; i < FRAMING_JOINTS.length; i++) {
      const x = at(f, FRAMING_JOINTS[i], r.xIdx), y = at(f, FRAMING_JOINTS[i], r.yIdx);
      if (!Number.isFinite(x) || !Number.isFinite(y)) { det = false; break; }
      if (y > 1 + M) below = true;
      else if (x < -M || x > 1 + M) out = true;
      if (i < FRAMING_UPPER && y < -M) out = true;
      if (i < FRAMING_UPPER && !(y > 1 + M || y < -M || x < -M || x > 1 + M)) upperOut = false;
    }
    if (!det) { none[f] = 1; continue; }
    legs[f] = below ? 1 : 0;
    side[f] = out ? 1 : 0;
    gone[f] = upperOut ? 1 : 0;
  }
  const fps = r.fps > 0 ? r.fps : 30;
  const minF = Math.max(1, Math.round(FRAMING_MIN_S * fps)), gapF = Math.max(1, Math.round(FRAMING_GAP_S * fps));
  const legsS = framingSmooth(legs, inr, minF, gapF), sideS = framingSmooth(side, inr, minF, gapF);
  for (let f = 0; f < N;) {                // a gap against a partly-out stretch: he left through the edge
    if (!none[f]) { f++; continue; }
    let g = f;
    while (g < N && none[g]) g++;
    if ((f > 0 && sideS[f - 1]) || (g < N && sideS[g])) gone.fill(1, f, g);
    f = g;
  }
  const goneS = framingSmooth(gone, inr, minF, gapF);
  const level = new Uint8Array(N);
  for (let f = 0; f < N; f++) if (inr[f]) level[f] = goneS[f] ? 3 : sideS[f] ? 2 : legsS[f] ? 1 : 0;
  for (let f = 0; f < N;) {
    if (!level[f]) { f++; continue; }
    let g = f;
    while (g < N && level[g] === level[f]) g++;
    stretches.push({ kind: FRAMING_KINDS[level[f] - 1], s: pts[f], e: pts[g - 1], n: g - f, f0: f, f1: g - 1 });
    f = g;
  }
  return stretches;
}

// ============================================================
// what to check — the detected lane's hints grouped into moments: every jump
// and every run of frames without a skeleton, hints less than MOMENT_GAP_S
// apart merged, each shown with MOMENT_PAD_S either side. The one labeled
// sample (Heavy Bag Session 2, Admin's 19 other-thing spans, 2026-09-29):
// every span starts and ends inside a moment; jumps alone would miss 5 of the
// 19 starts. Over the shelf: ~1.7 moments per minute of round, 8.8 % of the
// footage. In labeling mode the timeline shows only these and your own spans,
// and playback skips from one moment to the next; review mode shows every
// lane and every labeler's spans. A moment the playhead leaves forward is
// checked (per video, in this browser).
// ============================================================
const MOMENT_GAP_S = 1.0;
const MOMENT_PAD_S = 1.0;
const MOMENT_TOL_S = 0.1;                 // a seek lands up to a frame early

function checkMoments() {
  const rounds = (state.skeleton && state.skeleton.rounds) || [];
  if (state._moments && state._moments.rounds === rounds) return state._moments.list;
  const hints = [];
  for (const r of rounds) {
    const h = detectorHints(r), frame = r.fps > 0 ? 1 / r.fps : 0;
    for (const m of h.missing) hints.push({ s: m.s, e: m.e + frame, jump: 0 });
    for (const j of h.jumps) hints.push({ s: j.s, e: j.e, jump: 1 });
  }
  hints.sort((a, b) => a.s - b.s);
  const list = [];
  for (const h of hints) {
    const last = list[list.length - 1];
    if (last && h.s - last.e <= MOMENT_GAP_S) { last.e = Math.max(last.e, h.e); last.jumps += h.jump; last.misses += 1 - h.jump; }
    else list.push({ s: h.s, e: h.e, jumps: h.jump, misses: 1 - h.jump });
  }
  for (const m of list) { m.from = Math.max(0, m.s - MOMENT_PAD_S); m.to = m.e + MOMENT_PAD_S; m.key = m.s.toFixed(2); }
  state._moments = { rounds, list };
  state.inMoment = null;
  return list;
}
// padded windows can overlap: the playhead is in the latest one to start
function momentAt(list, t) {
  for (let k = list.length - 1; k >= 0; k--) if (t >= list[k].from - MOMENT_TOL_S && t <= list[k].to) return k;
  return -1;
}

function checkedKey() { return 'unusableChecked:' + (state.videoLink || state.videoName || ''); }
function checkedSet() {
  const key = checkedKey();
  if (!state._checked || state._checked.key !== key) {
    let keys = [];
    try { keys = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { /* none stored */ }
    state._checked = { key, set: new Set(keys) };
  }
  return state._checked.set;
}
function markChecked(m) {
  const set = checkedSet();
  if (set.has(m.key)) return;
  set.add(m.key);
  try { localStorage.setItem(checkedKey(), JSON.stringify([...set])); } catch (e) { /* kept for this page */ }
  renderCheckList(); renderTimelineOverlay();
}

function setReview(on) {
  state.review = on;
  writeFlag('unusableReview', on);
  const box = document.getElementById('review-mode');
  if (box) box.checked = on;
  renderSpanList(); renderTimelineOverlay();
}
// labeling mode lists and draws only your own spans (nobody copies anybody); review mode every labeler's
function shownSpans() { return state.spans.filter(s => state.review || ownSpan(s)).sort((a, b) => a.start_sec - b.start_sec); }

// J / Shift+J: the next / the previous moment, from its first padded second
function gotoMoment(dir) {
  const list = checkMoments(), v = videoEl();
  if (!v || !v.duration) return;
  if (!list.length) { showToast('Nothing to check: no jumps and no missing frames in the loaded skeleton', 'info'); return; }
  const t = v.currentTime, cur = momentAt(list, t);
  const target = dir > 0
    ? list.find(m => m.from > t + MOMENT_TOL_S)
    : [...list].reverse().find(m => m.from < (cur >= 0 ? list[cur].from : t) - MOMENT_TOL_S);
  if (!target) { showToast(dir > 0 ? 'That was the last moment — N for the next video' : 'This is the first moment', 'info'); return; }
  if (dir > 0 && cur >= 0) markChecked(list[cur]);
  seekTo(target.from);
}
function seekTo(t) {
  const v = videoEl();
  v.currentTime = t;
  if (state.zoomLevel > 1) {
    const vp = getViewport(), norm = t / v.duration;
    if (norm < vp.start || norm > vp.end) { state.zoomCenter = norm; clampZoomCenter(); onZoomChanged(); }
  }
}

// every time update: which moment the playhead is in; the one it left forward
// (into a later moment, or past its end) is checked; and in labeling mode,
// playing past a moment goes on at the next
function followMoments(t) {
  const list = checkMoments();
  if (!list.length) return;
  const i = momentAt(list, t), prev = state.inMoment;
  if (prev != null && list[prev] && (i > prev || (i < 0 && t > list[prev].to))) markChecked(list[prev]);
  if (prev !== (i >= 0 ? i : null)) {
    state.inMoment = i >= 0 ? i : null;
    document.querySelectorAll('#check-list .check-row').forEach(row => row.classList.toggle('current', Number(row.dataset.i) === i));
  }
  const v = videoEl();
  if (!state.review && !v.paused && i < 0) {
    const next = list.find(m => m.from > t);
    if (next) seekTo(next.from);
    else { v.pause(); showToast('No more moments to check on this video — N for the next one', 'info'); }
  }
}

function renderCheckList() {
  const el = document.getElementById('check-list'), count = document.getElementById('check-count');
  if (!el) return;
  const rounds = (state.skeleton && state.skeleton.rounds) || [];
  if (!rounds.length) { el.innerHTML = '<div class="muted">No skeleton loaded.</div>'; if (count) count.textContent = ''; return; }
  const list = checkMoments(), set = checkedSet();
  if (count) count.textContent = `(${list.filter(m => set.has(m.key)).length} of ${list.length} checked)`;
  if (!list.length) { el.innerHTML = '<div class="muted">Nothing to check: no jumps and no missing frames.</div>'; return; }
  el.innerHTML = list.map((m, i) => {
    const what = [m.jumps ? `${m.jumps} jump${m.jumps === 1 ? '' : 's'}` : '', m.misses ? `no skeleton${m.misses > 1 ? ' ×' + m.misses : ''}` : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="check-row${set.has(m.key) ? ' checked' : ''}${i === state.inMoment ? ' current' : ''}" data-i="${i}">` +
      `<span class="check-mark">${set.has(m.key) ? '✓' : ''}</span><span class="check-time">${fmtSec(m.s)}</span><span class="check-what">${what}</span></button>`;
  }).join('');
  el.querySelectorAll('.check-row').forEach(row => row.addEventListener('click', () => { const m = list[Number(row.dataset.i)]; if (m) seekTo(m.from); }));
}
function checkChips(lane, duration, pct = timeToViewportPct) {
  const set = checkedSet(), mini = lane.id === 'minimap-segments';
  for (const m of checkMoments()) {
    const l = pct(m.from, duration), w = Math.max(0.15, pct(m.to, duration) - l);
    if (l + w < 0 || l > 100) continue;
    const chip = document.createElement('div');
    chip.className = 'check-chip' + (set.has(m.key) ? ' checked' : '');
    chip.style.cssText = `left:${Math.max(0, l)}%;width:${Math.min(100, l + w) - Math.max(0, l)}%`;
    chip.title = `to check · ${fmtSec(m.s)} · ${m.jumps} jump${m.jumps === 1 ? '' : 's'}, ${m.misses} without a skeleton${set.has(m.key) ? ' · checked' : ''}`;
    if (!mini) chip.addEventListener('click', e => { e.stopPropagation(); seekTo(m.from); });
    lane.appendChild(chip);
  }
}

// skeleton.js calls this after a load and after a reset: the skeleton lane
// and the hints follow the files, whichever of video and skeleton came last
function onSkeletonRoundsChanged() { renderCheckList(); renderTimelineOverlay(); }

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
      // the band covers the frames themselves: a stretch ends AT its last frame, which lasts one frame more
      const l = pct(m.s, duration), w = Math.max(0.15, pct(m.e + (r.fps > 0 ? 1 / r.fps : 0), duration) - l);
      if (l + w < 0 || l > 100) continue;
      const chip = document.createElement('div');
      chip.className = 'hint-chip missing';
      chip.style.cssText = `left:${Math.max(0, l)}%;width:${Math.min(100, l + w) - Math.max(0, l)}%`;
      chip.title = m.n === 1 ? `no skeleton · ${fmtSec(m.s)} · one frame` : `no skeleton · ${fmtSec(m.s)} – ${fmtSec(m.e)} · ${m.n} frames`;
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
function framingChips(lane, rounds, duration) {
  for (const r of rounds) {
    const frame = r.fps > 0 ? 1 / r.fps : 0;
    for (const s of framingHints(r)) {
      const k = FRAMING_STYLE[s.kind];
      const l = timeToViewportPct(s.s, duration), w = Math.max(0.15, timeToViewportPct(s.e + frame, duration) - l);
      if (l + w < 0 || l > 100) continue;
      const chip = document.createElement('div');
      chip.className = 'framing-chip';
      chip.style.cssText = `left:${Math.max(0, l)}%;width:${Math.min(100, l + w) - Math.max(0, l)}%;--reason:${k.color}`;
      chip.title = `${k.label} · ${fmtSec(s.s)} – ${fmtSec(s.e)} · ${(s.n / (r.fps > 0 ? r.fps : 30)).toFixed(1)} s`;
      chip.addEventListener('click', e => { e.stopPropagation(); const v = videoEl(); if (v && v.duration) v.currentTime = s.s; });
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
  const rounds = (state.skeleton && state.skeleton.rounds) || [];
  if (state.review) {             // review mode: the skeleton, detected and framing lanes
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
    if (rounds.length) {
      const lane = document.createElement('div');
      lane.className = 'seg-lane lane-hints'; lane.dataset.laneLabel = 'detected';
      const nJ = rounds.reduce((a, r) => a + detectorHints(r).jumps.length, 0);
      const nM = rounds.reduce((a, r) => a + detectorHints(r).missing.length, 0);
      lane.title = `Found in the skeleton files: ${nJ} jump${nJ === 1 ? '' : 's'} (yellow — the skeleton moves more than a torso within ¼ s) `
        + `and ${nM} stretch${nM === 1 ? '' : 'es'} without a skeleton (red — every frame without one). Hints to check on the footage, not labels; click one to go there.`;
      hintChips(lane, rounds, duration, timeToViewportPct);
      lanes.insertBefore(lane, playhead);
    }
    // where the picture cuts the boxer (F)
    if (rounds.length && state.showFraming) {
      const lane = document.createElement('div');
      lane.className = 'seg-lane lane-framing'; lane.dataset.laneLabel = 'framing';
      const secs = Object.fromEntries(FRAMING_KINDS.map(k => [k, 0]));
      for (const r of rounds) for (const s of framingHints(r)) secs[s.kind] += s.n / (r.fps > 0 ? r.fps : 30);
      lane.title = 'Where the picture cuts the boxer, read off the skeleton files: '
        + FRAMING_KINDS.slice().reverse().map(k => `${FRAMING_STYLE[k].label.toLowerCase()} ${Math.round(secs[k])} s`).join(', ')
        + '. Computed, not labeled; click one to go there. F hides this lane.';
      framingChips(lane, rounds, duration);
      lanes.insertBefore(lane, playhead);
    }
  }
  // the moments to check — in both modes, the only detector lane in labeling mode
  if (rounds.length) {
    const lane = document.createElement('div');
    lane.className = 'seg-lane lane-check'; lane.dataset.laneLabel = 'to check';
    lane.title = 'The moments to check: every jump and every stretch without a skeleton, a second either side. Grey once checked. J goes to the next.';
    checkChips(lane, duration);
    lanes.insertBefore(lane, playhead);
  }
  // one lane per labeler, yours first — in labeling mode only yours
  const byLabeler = new Map();
  for (const s of shownSpans()) { const k = s.labeler || ''; if (!byLabeler.has(k)) byLabeler.set(k, []); byLabeler.get(k).push(s); }   // '' groups with an unnamed you
  const mine = me();
  if (!byLabeler.has(mine)) byLabeler.set(mine, []);   // your lane exists even without a name
  const order = [...byLabeler.keys()].sort((a, b) => (a === mine ? -1 : b === mine ? 1 : a.localeCompare(b)));
  for (const who of order) {
    const lane = document.createElement('div');
    const own = who === mine;
    lane.className = 'seg-lane ' + (own ? 'lane-own' : 'lane-foreign'); lane.dataset.laneLabel = who || 'spans';
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
  if (mini) {
    if (state.review) hintChips(mini, rounds, duration, (t, d) => 100 * t / d);
    else checkChips(mini, duration, (t, d) => 100 * t / d);
    laneChips(mini, state.spans.filter(ownSpan), duration);
  }
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
  followMoments(v.currentTime);
  const cur = currentSpan(v.currentTime);
  document.querySelectorAll('#span-list .span-row').forEach(row => {
    row.classList.toggle('current', shownSpans()[Number(row.dataset.i)] === cur);
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
      case 'n': case 'N': e.preventDefault(); nextVideo(); return;
      case 'k': case 'K': e.preventDefault(); document.getElementById('btn-toggle-skeleton')?.click(); return;
      case 'f': case 'F': e.preventDefault(); toggleFraming(); return;
      case 'j': case 'J': e.preventDefault(); gotoMoment(e.shiftKey ? -1 : 1); return;
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
  document.getElementById('btn-retire').addEventListener('click', retireVideo);
  const review = document.getElementById('review-mode');
  review.checked = state.review;
  review.addEventListener('change', () => setReview(review.checked));
  renderDraft(); renderCheckList();
}

document.addEventListener('DOMContentLoaded', () => {
  setupPlayer();
  if (typeof setupVideoFolder === 'function') setupVideoFolder();
  setupPanel();
  setupDriveLink();
  setupVideoPicker();
  setupKeys();
  renderSpanList(); renderReview();
  Promise.all([fetchCatalog(), fetchReviewedAll(), fetchSkeletonStems(), fetchReviewing()]).then(() => {
    if (window._renderPickerList) window._renderPickerList();
    // a link pasted before the catalogue arrived gets its name now
    if (state.videoLink && !state.pickedName) { const hit = state.catalog.find(v => v.key === state.videoLink); if (hit) state.pickedName = hit.name; }
  });
  const v = videoEl();
  v.addEventListener('loadedmetadata', () => { renderTimelineOverlay(); renderDraft(); });
});

// ============================================================
// chin_tuck.js — chin-position labeler, one verdict per sampled frame
//
// Candidates come from chin_frames.json (baked by cornerman-backend's
// chin_sampler.py): random frames per video where BlazePose tracked the
// head + shoulders confidently. Each sample carries the normalized joint
// anchors; the chin crop box is computed here at display time from the
// video's true dimensions with the SAME formula as the Python side
// (chin_sampler.chin_box), and drawn over the frame so labeling doubles
// as a visual check of the crop the model will eventually see.
//
// Verdicts (provisional 3-way split until a coach weighs in):
//   tucked  chin down toward the chest
//   level   roughly even with the ground — neither tucked nor lifted
//   air     chin lifted / jaw pointing up
//
// Interaction: each sample seeks + pauses on its frame. 1/2/3 saves the
// verdict and advances. ←/→ peek at neighboring frames for motion context
// (the label still applies to the SAMPLED frame — the box goes dashed
// while peeking). S then 1/2/3 skips (occluded / unclear / bad box).
// U clears. Saved to the "Chin Labels" sheet via saveChinLabel /
// listChinLabels / deleteChinLabel, keyed by (labeler, video, round, frame).
//
// Reuses player.js for the video chrome, sheetUrl(), and shared `state`.
// ============================================================

// Fixed labeling queue ("for now"): the 10 amateur videos John critiqued,
// in order. No video picker — the page walks this list top to bottom,
// prompting for each file, and advances when every sample is labeled.
const PLAYLIST = [
  'Advice on my Shadow Boxing [KLX3xfCo9Cw]',
  'Pointers for a beginner on my bag work [T7Yw7FRqnp0]',
  'One round of shadowboxing (I promise I go to the body more in sparrin... [ktbuo8]',
  'Beginner shadowboxing - looking for honest critique [PMQpEkaf9h4]',
  'bagwork give critiques (months boxing) [Yn01ebDSzms]',
  'I got a lot of great feedback here. Time for another critique of my shadow boxing -- after 3 years [BSmTYUs5vdQ]',
  'Shadow boxing critique [Ry5z_nGOD0Y]',
  'This is my sand bag training, I started learning boxing from May 2025. [A2Xd55D6yTs]',
  'Can you guys give me some tips to improve my shadow boxing I have be... [c03ekbdds1241]',
  'Advice request on my bag work. [EglbwnGsod8]',
];

const VERDICTS = [
  { key: '1', verdict: 'tucked', label: 'tucked' },
  { key: '2', verdict: 'level',  label: 'level' },
  { key: '3', verdict: 'air',    label: 'in the air' },
];

const SKIP_REASONS = [
  { key: '1', reason: 'occluded', label: 'chin occluded' },
  { key: '2', reason: 'unclear',  label: 'unclear' },
  { key: '3', reason: 'bad_box',  label: 'box misses chin' },
];

Object.assign(state, {
  knownVideos: [],          // chin_frames.json videos — only source of samples
  boxScale: 1.3,            // overwritten from chin_frames.json params
  playlistIdx: 0,           // position in PLAYLIST
  currentStem: null,
  samples: [],              // sampled frames for the current video, chronological
  cursor: 0,
  doneKeys: new Set(),
  labelByKey: new Map(),    // key -> { verdict: string|null, skip_reason: string|null }
  coverageByKey: new Map(), // current video: sampleKey -> Set<labeler>
  videoLoaded: false,
  mode: 'scrub',            // 'scrub' | 'skipping'
  autoJumpOnSync: false,
});

function keyFor(s) {
  return s ? 's:' + s.round + ':' + s.frame : null;
}

function sampleFps(s) {
  const v = state.knownVideos.find(x => x.stem === state.currentStem);
  return (v && v.fps_by_round && v.fps_by_round[s.round]) || 30;
}

function formatChinLabel(v) {
  if (v === undefined) return 'unlabeled';
  if (v.skip_reason) return 'skip:' + v.skip_reason;
  return v.verdict;
}

// ─── zoom / pan (still-frame stage) ────────────────────────────────────────
// Ctrl+scroll (or trackpad pinch) zooms toward the cursor; click-drag pans;
// double-click resets. The transform sits on #zoom-stage so the crop box
// (positioned in stage coords) zooms and pans with the frame.
const ZOOM_MAX = 8;

Object.assign(state, { zoom: 1, panX: 0, panY: 0 });

function clampPan() {
  const stage = document.getElementById('zoom-stage');
  if (!stage) return;
  const w = stage.offsetWidth, h = stage.offsetHeight;
  state.panX = Math.min(0, Math.max(w * (1 - state.zoom), state.panX));
  state.panY = Math.min(0, Math.max(h * (1 - state.zoom), state.panY));
}

function applyZoomPan() {
  const stage = document.getElementById('zoom-stage');
  const viewport = document.getElementById('video-viewport');
  const box = document.getElementById('chin-box');
  if (!stage) return;
  clampPan();
  stage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  if (viewport) viewport.classList.toggle('zoomed', state.zoom > 1);
  // Counter-scale the border so it stays hairline at high zoom.
  if (box) box.style.borderWidth = Math.max(3 / state.zoom, 0.75) + 'px';
  updateHud();
}

function setZoomAt(newZoom, cx, cy) {
  // Keep the stage point under the cursor (cx, cy in viewport coords) fixed.
  const z0 = state.zoom;
  const z1 = Math.min(ZOOM_MAX, Math.max(1, newZoom));
  state.panX = cx - (cx - state.panX) * (z1 / z0);
  state.panY = cy - (cy - state.panY) * (z1 / z0);
  state.zoom = z1;
  applyZoomPan();
}

function resetZoom() {
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  applyZoomPan();
}

// While zoomed, center the viewport on the current sample's crop box so the
// labeler can stay zoomed in across samples.
function centerOnBox() {
  if (state.zoom <= 1) return;
  const stage = document.getElementById('zoom-stage');
  const rect = computeBoxRect();
  if (!stage || !rect) return;
  state.panX = stage.offsetWidth / 2 - (rect.left + rect.width / 2) * state.zoom;
  state.panY = stage.offsetHeight / 2 - (rect.top + rect.height / 2) * state.zoom;
  applyZoomPan();
}

function setupZoomPan() {
  const viewport = document.getElementById('video-viewport');
  if (!viewport) return;

  viewport.addEventListener('wheel', (e) => {
    // Ctrl+scroll, Cmd+scroll (Mac) or trackpad pinch (fires as ctrlKey).
    // Same feel as the debug viewer's zoom (exponential step, 0.0015).
    if (!e.ctrlKey && !e.metaKey) return;    // plain scroll keeps scrolling the page
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    setZoomAt(state.zoom * Math.exp(-e.deltaY * 0.0015),
              e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  let dragging = false, lastX = 0, lastY = 0;
  viewport.addEventListener('mousedown', (e) => {
    if (state.zoom <= 1) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    viewport.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    state.panX += e.clientX - lastX;
    state.panY += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    applyZoomPan();
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    viewport.classList.remove('dragging');
  });

  viewport.addEventListener('dblclick', (e) => { e.preventDefault(); resetZoom(); });
}

// ─── chin crop box — MUST mirror chin_sampler.chin_box() exactly ───────────
function chinBox(j, W, H, boxScale) {
  const px = (v) => [v[0] * W, v[1] * H];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const neck = mid(px(j.l_sh), px(j.r_sh));
  const mouth = mid(px(j.mouth_l), px(j.mouth_r));
  const n = px(j.nose);
  const d = Math.hypot(n[0] - neck[0], n[1] - neck[1]);
  const c = mid(mouth, neck);
  const side = boxScale * d;
  const x = Math.min(Math.max(c[0] - side / 2, 0), W - 1);
  const y = Math.min(Math.max(c[1] - side / 2, 0), H - 1);
  return { x, y, w: Math.min(side, W - x), h: Math.min(side, H - y) };
}

// ─── sheet sync (Chin Labels) ──────────────────────────────────────────────
async function fetchChinLabels(video, labeler) {
  const url = sheetUrl({ action: 'listChinLabels', video, labeler });
  const res = await fetch(url);
  if (!res.ok) throw new Error('listChinLabels HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('listChinLabels: ' + (body.message || 'unknown'));
  return body.rows;
}
async function saveChinLabel({ labeler, video, round, frame, pts_sec, verdict, skip_reason }) {
  const params = { action: 'saveChinLabel', labeler, video,
                   round: String(round), frame: String(frame), pts_sec: String(pts_sec) };
  params.verdict = verdict || '';
  params.skip_reason = skip_reason || '';
  const url = sheetUrl(params);
  const res = await fetch(url);
  if (!res.ok) throw new Error('saveChinLabel HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('saveChinLabel: ' + (body.message || 'unknown'));
  return body;
}
async function deleteChinLabel({ labeler, video, round, frame }) {
  const url = sheetUrl({ action: 'deleteChinLabel', labeler, video,
                         round: String(round), frame: String(frame) });
  const res = await fetch(url);
  if (!res.ok) throw new Error('deleteChinLabel HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('deleteChinLabel: ' + (body.message || 'unknown'));
  return body;
}

// ─── UI helpers ────────────────────────────────────────────────────────────
function setStatus(text, cls) {
  const el = document.getElementById('chin-status');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('ok', 'err');
  if (cls) el.classList.add(cls);
}
function setCurrentLine(text) {
  const el = document.getElementById('chin-current');
  if (el) el.textContent = text;
}
function setModeBadge(text) {
  const el = document.getElementById('video-mode');
  if (el) el.textContent = text;
}

function describeSample(s, totalLabel, labelTxt) {
  if (!s) return '';
  return `r${s.round} f${s.frame} · ${formatTime(s.pts)} · ${labelTxt} · ${totalLabel}`;
}

// ─── on-video chrome: crop box + HUD + banner ─────────────────────────────
// Peeking = the displayed frame is not the sampled frame (labeler stepped
// away for motion context). The box goes dashed and the HUD warns.
function isPeeking(s) {
  const video = document.getElementById('video-player');
  if (!video || !s) return false;
  const tol = 0.6 / sampleFps(s);
  return Math.abs(video.currentTime - s.pts) > tol;
}

// Crop box of the current sample in stage coords (pre-transform element px),
// or null when nothing to draw. Used by both the overlay and centerOnBox().
function computeBoxRect() {
  const video = document.getElementById('video-player');
  const s = state.samples[state.cursor];
  if (!video || !s || !state.videoLoaded || !video.videoWidth) return null;
  const b = chinBox(s.joints, video.videoWidth, video.videoHeight, state.boxScale);
  // object-fit: contain mapping — video pixels -> element pixels
  const scale = Math.min(video.clientWidth / video.videoWidth,
                         video.clientHeight / video.videoHeight);
  const offX = video.offsetLeft + (video.clientWidth - video.videoWidth * scale) / 2;
  const offY = video.offsetTop + (video.clientHeight - video.videoHeight * scale) / 2;
  return { left: offX + b.x * scale, top: offY + b.y * scale,
           width: b.w * scale, height: b.h * scale };
}

function updateChinBox() {
  const box = document.getElementById('chin-box');
  if (!box) return;
  const rect = computeBoxRect();
  if (!rect) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  box.style.left = rect.left + 'px';
  box.style.top = rect.top + 'px';
  box.style.width = rect.width + 'px';
  box.style.height = rect.height + 'px';
  box.classList.toggle('peeking', isPeeking(state.samples[state.cursor]));
}

function updateHud() {
  const hud = document.getElementById('chin-hud');
  if (!hud) return;
  const s = state.samples[state.cursor];
  if (!s) {
    hud.textContent = '— no sample —';
    return;
  }
  let base = `sample ${state.cursor + 1}/${state.samples.length} · r${s.round} f${s.frame}`;
  if (state.zoom > 1) base += ` · ${state.zoom.toFixed(1)}x`;
  hud.textContent = isPeeking(s)
    ? base + ' · PEEKING — 1/2/3 labels the sampled frame'
    : base;
}

function setBanner(text, cls) {
  const banner = document.getElementById('chin-banner');
  if (!banner) return;
  if (!text) {
    banner.className = 'hidden';
    banner.textContent = '';
    return;
  }
  banner.textContent = text;
  banner.className = cls || '';
}

function updateCapturePanel() {
  const el = document.getElementById('chin-state');
  if (!el) return;
  if (state.mode === 'skipping') {
    el.innerHTML = 'Skip reason: <b>1</b> occluded · <b>2</b> unclear · <b>3</b> box misses chin · <b>Esc</b> cancel';
  } else {
    const s = state.samples[state.cursor];
    const existing = s ? state.labelByKey.get(keyFor(s)) : undefined;
    if (existing !== undefined) {
      const isSkip = !!existing.skip_reason;
      setBanner(isSkip ? `SKIPPED: ${existing.skip_reason}` : `LABELED: ${existing.verdict}`,
                isSkip ? 'skipping' : 'captured');
      el.innerHTML = `Saved: <b class="${isSkip ? 'lbl-skip' : 'lbl-done'}">${formatChinLabel(existing)}</b>.<br>` +
        '<b>1/2/3</b> re-labels (overwrites) · <b>U</b> clears';
    } else {
      setBanner(null);
      el.innerHTML = s
        ? 'Judge the chin in the box: <b>1</b> tucked · <b>2</b> level · <b>3</b> in the air.<br>' +
          '<b>&larr;/&rarr;</b> peek for context — the label saves for the boxed frame.'
        : '—';
    }
  }
}

// player.js probes this hook on every time update.
function updateVideoOverlay() {
  updateHud();
  updateChinBox();
}

// ─── playlist flow ─────────────────────────────────────────────────────────
function playlistStem() {
  return PLAYLIST[state.playlistIdx];
}

function loadedFileStem() {
  return (state.videoName || '').replace(/\.[^.]+$/, '');
}

function renderPlaylistBar() {
  const pos = document.getElementById('playlist-pos');
  const vid = document.getElementById('playlist-video');
  if (pos) pos.textContent = (state.playlistIdx + 1) + '/' + PLAYLIST.length;
  if (vid) vid.textContent = playlistStem();
}

// Move to another playlist entry (auto-advance or the prev/next buttons).
function setPlaylistIdx(idx) {
  state.playlistIdx = Math.max(0, Math.min(PLAYLIST.length - 1, idx));
  state.samples = [];
  state.cursor = 0;
  state.doneKeys = new Set();
  state.labelByKey = new Map();
  state.coverageByKey = new Map();
  tryGenerateSamples();
}

// Every sample of the current video is saved — move on (or finish).
function advancePlaylist() {
  if (state.playlistIdx + 1 >= PLAYLIST.length) {
    setBanner('ALL VIDEOS COMPLETE', 'captured');
    setModeBadge('all done');
    setCurrentLine('All ' + PLAYLIST.length + ' videos fully labelled — you are done 🎉');
    return;
  }
  setPlaylistIdx(state.playlistIdx + 1);
  setBanner('VIDEO COMPLETE — NEXT ONE', 'captured');
}

// ─── candidate generation ────────────────────────────────────────────────
function tryGenerateSamples() {
  state.currentStem = playlistStem();
  renderPlaylistBar();

  // The right file must be open — prompt (or complain) until it is.
  if (!state.videoLoaded || loadedFileStem() !== state.currentStem) {
    setModeBadge('open file');
    setCurrentLine('Open the video file: "' + state.currentStem + '.mp4"');
    if (state.videoLoaded && loadedFileStem() !== state.currentStem) {
      setStatus('Loaded file is "' + loadedFileStem() + '" — this video needs "' +
                state.currentStem + '.mp4".', 'err');
    }
    state.samples = [];
    redrawProgress();
    updateCapturePanel();
    updateHud();
    updateChinBox();
    return;
  }

  const known = state.knownVideos.find(v => v.stem === state.currentStem);
  state.cursor = 0;
  state.doneKeys = new Set();
  state.labelByKey = new Map();
  state.coverageByKey = new Map();
  enterScrub();
  setStatus('—');

  state.samples = known ? known.samples : [];
  if (!state.samples.length) {
    setModeBadge('0 samples');
    setCurrentLine('No sampled frames for "' + state.currentStem + '".');
    redrawProgress();
    return;
  }
  setModeBadge(state.samples.length + ' samples');
  redrawProgress();
  state.cursor = 0;
  seekToCurrent();
  state.autoJumpOnSync = true;
  syncFromSheet();
}

async function syncFromSheet() {
  if (!state.currentStem || !state.samples.length) return;
  const labeler = document.getElementById('labeler-input').value.trim();
  if (!labeler) {
    setStatus('Type your name above before labelling.', 'err');
    return;
  }
  try {
    setStatus('Loading existing labels…');
    const rows = await fetchChinLabels(state.currentStem, '');
    state.doneKeys = new Set();
    state.labelByKey = new Map();
    state.coverageByKey = new Map();
    for (const r of rows) {
      const k = 's:' + r.round + ':' + r.frame;
      let who = state.coverageByKey.get(k);
      if (!who) { who = new Set(); state.coverageByKey.set(k, who); }
      who.add(r.labeler);
      if (r.labeler === labeler) {
        state.doneKeys.add(k);
        state.labelByKey.set(k, { verdict: r.verdict, skip_reason: r.skip_reason });
      }
    }
    setStatus(`Loaded ${state.doneKeys.size} of your label(s) · ${state.coverageByKey.size} labeled in total.`, 'ok');
    // Already fully labelled (e.g. reopening a finished video on load) —
    // roll straight on to the next playlist entry.
    if (state.autoJumpOnSync && state.doneKeys.size >= state.samples.length) {
      state.autoJumpOnSync = false;
      advancePlaylist();
      return;
    }
    if (state.autoJumpOnSync && state.mode === 'scrub') {
      const firstIdx = state.samples.findIndex(ss => !state.doneKeys.has(keyFor(ss)));
      if (firstIdx !== state.cursor) advanceToNextUnlabeled(0);
    }
    const s = state.samples[state.cursor];
    if (s) {
      const total = `${state.cursor + 1}/${state.samples.length}`;
      setCurrentLine(describeSample(s, total, formatChinLabel(state.labelByKey.get(keyFor(s)))));
    }
    updateCapturePanel();
    redrawProgress();
  } catch (e) {
    setStatus("Couldn't fetch labels: " + e.message, 'err');
  }
  state.autoJumpOnSync = false;
}

function advanceToNextUnlabeled(fromIdx) {
  const N = state.samples.length;
  if (N === 0) return;
  for (let i = 0; i < N; i++) {
    const idx = (fromIdx + i) % N;
    if (!state.doneKeys.has(keyFor(state.samples[idx]))) {
      state.cursor = idx;
      seekToCurrent();
      return;
    }
  }
  state.cursor = N;
  setCurrentLine('All samples labelled for this video — pick another, or use Prev to review.');
}

function enterScrub() {
  state.mode = 'scrub';
  setBanner(null);
  updateCapturePanel();
}

function seekToCurrent() {
  if (!state.samples.length) return;
  enterScrub();
  if (state.cursor >= state.samples.length) {
    updateHud();
    updateChinBox();
    return;
  }
  const s = state.samples[state.cursor];
  const video = document.getElementById('video-player');
  // Frame stepping (peek) converts to seconds with this — the manifest knows
  // each round's true fps, so don't rely on playback-based detection.
  state.frameDuration = 1 / sampleFps(s);
  if (video && !isNaN(video.duration) && video.duration > 0) {
    video.pause();
    // Seek a hair past the frame's PTS so the browser presents THAT frame.
    const eps = 0.3 / sampleFps(s);
    video.currentTime = Math.min(Math.max(0, s.pts + eps), video.duration);
  }
  centerOnBox();
  const label = state.labelByKey.get(keyFor(s));
  const total = `${state.cursor + 1}/${state.samples.length}`;
  setCurrentLine(describeSample(s, total, formatChinLabel(label)));
  updateCapturePanel();
  updateOverviewHighlight();
  updateHud();
  updateChinBox();
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

function labelWith(verdict) {
  state.autoJumpOnSync = false;
  if (!state.currentStem || !state.samples.length) {
    setStatus('Pick a video and load the file first.', 'err'); return;
  }
  const labeler = requireLabeler();
  if (!labeler) return;
  persistLabel(labeler, { verdict, skip_reason: null });
}

function beginSkip() {
  state.autoJumpOnSync = false;
  if (!state.currentStem || !state.samples.length) return;
  state.mode = 'skipping';
  setBanner('SKIP: [1] occluded · [2] unclear · [3] box misses chin · [Esc] cancel', 'skipping');
  updateCapturePanel();
}

function skipWith(reason) {
  if (!state.currentStem || !state.samples.length) return;
  const labeler = requireLabeler();
  if (!labeler) return;
  persistLabel(labeler, { verdict: null, skip_reason: reason });
}

function cancelToScrub() {
  enterScrub();
}

// Optimistic local update — advance immediately, save in the background,
// roll back on failure so the item resurfaces on the next sweep.
function persistLabel(labeler, label) {
  const s = state.samples[state.cursor];
  if (!s) return;
  const k = keyFor(s);
  state.mode = 'scrub';
  state.doneKeys.add(k);
  state.labelByKey.set(k, label);
  let who = state.coverageByKey.get(k);
  if (!who) { who = new Set(); state.coverageByKey.set(k, who); }
  who.add(labeler);
  state.pendingSaves = (state.pendingSaves || 0) + 1;
  redrawProgress();
  setStatus('saving ' + formatChinLabel(label) + '… (' + state.pendingSaves + ' pending)');

  const stemAtSave = state.currentStem;
  gotoNext();

  saveChinLabel({
    labeler,
    video: stemAtSave,
    round: s.round,
    frame: s.frame,
    pts_sec: s.pts,
    verdict: label.verdict,
    skip_reason: label.skip_reason,
  }).then(() => {
    state.pendingSaves = Math.max(0, (state.pendingSaves || 1) - 1);
    setStatus(state.pendingSaves === 0 ? 'Saved.'
      : state.pendingSaves + ' save' + (state.pendingSaves === 1 ? '' : 's') + ' pending…',
      state.pendingSaves === 0 ? 'ok' : null);
    // Whole video confirmed saved -> advance the playlist.
    if (state.pendingSaves === 0 && state.currentStem === stemAtSave &&
        state.samples.length > 0 && state.doneKeys.size >= state.samples.length) {
      advancePlaylist();
    }
  }).catch((e) => {
    state.pendingSaves = Math.max(0, (state.pendingSaves || 1) - 1);
    state.doneKeys.delete(k);
    state.labelByKey.delete(k);
    const who2 = state.coverageByKey.get(k);
    if (who2) { who2.delete(labeler); if (who2.size === 0) state.coverageByKey.delete(k); }
    redrawProgress();
    setStatus('Save failed for ' + k + ': ' + e.message, 'err');
  });
}

// Clear the saved label of the sample at `idx` (used by U and the overview ✕).
async function clearLabelAt(idx) {
  if (!state.currentStem) return;
  const labeler = document.getElementById('labeler-input').value.trim();
  if (!labeler) return;
  const s = state.samples[idx];
  if (!s) return;
  const k = keyFor(s);
  if (!state.doneKeys.has(k)) return;
  state.doneKeys.delete(k);
  state.labelByKey.delete(k);
  const who = state.coverageByKey.get(k);
  if (who) { who.delete(labeler); if (who.size === 0) state.coverageByKey.delete(k); }
  redrawProgress();
  if (idx === state.cursor) {
    updateCapturePanel();
    const total = `${idx + 1}/${state.samples.length}`;
    setCurrentLine(describeSample(s, total, 'unlabeled'));
  }
  try {
    await deleteChinLabel({ labeler, video: state.currentStem, round: s.round, frame: s.frame });
    setStatus("Cleared that sample's label — relabel it any time.", 'ok');
  } catch (e) {
    setStatus('Clear failed: ' + e.message, 'err');
  }
}

async function undoAction() {
  if (state.mode === 'skipping') {
    setStatus('Esc closes the skip menu.', null);
    return;
  }
  const s = state.samples[state.cursor];
  if (!s) return;
  if (!state.doneKeys.has(keyFor(s))) {
    setStatus('Nothing to undo on this sample.', null);
    return;
  }
  await clearLabelAt(state.cursor);
}

function gotoPrev() {
  state.autoJumpOnSync = false;
  if (!state.samples.length) return;
  state.cursor = Math.max(0, state.cursor - 1);
  seekToCurrent();
}

function gotoNext() {
  state.autoJumpOnSync = false;
  if (!state.samples.length) return;
  state.cursor = Math.min(state.samples.length - 1, state.cursor + 1);
  seekToCurrent();
}

function gotoFirst() {
  state.autoJumpOnSync = false;
  if (!state.samples.length) return;
  state.cursor = 0;
  seekToCurrent();
}

function gotoNextUnlabeled() {
  state.autoJumpOnSync = false;
  advanceToNextUnlabeled(state.cursor + 1);
}

function redrawProgress() {
  const N = state.samples.length;
  const labelled = state.doneKeys.size;
  const bar = document.getElementById('chin-bar');
  if (bar) bar.style.width = N ? (100 * labelled / N).toFixed(1) + '%' : '0%';
  const pt = document.getElementById('chin-progress-text');
  if (pt) pt.textContent = N ? labelled + ' / ' + N + ' labelled' : 'no samples';
  const counts = {};
  for (const v of state.labelByKey.values()) {
    const key = v.skip_reason ? 'skip:' + v.skip_reason : v.verdict;
    counts[key] = (counts[key] || 0) + 1;
  }
  const parts = [];
  for (const v of VERDICTS) if (counts[v.verdict]) parts.push(v.verdict + ': ' + counts[v.verdict]);
  for (const s of SKIP_REASONS) if (counts['skip:' + s.reason]) parts.push(s.reason + ': ' + counts['skip:' + s.reason]);
  document.getElementById('chin-dist').textContent = parts.length ? parts.join(' · ') : '—';
  rebuildOverview();
}

// ─── overview list — one row per sample, click to jump, ✕ to clear ─────────
function rebuildOverview() {
  const list = document.getElementById('chin-overview');
  if (!list) return;
  list.innerHTML = '';
  if (!state.samples.length) { list.textContent = '—'; return; }
  state.samples.forEach((s, idx) => {
    const row = document.createElement('div');
    row.className = 'ov-row';
    row.dataset.idx = String(idx);
    const v = state.labelByKey.get(keyFor(s));
    let labelTxt = '—', labelCls = 'none';
    if (v !== undefined) {
      if (v.skip_reason) { labelTxt = 'skip:' + v.skip_reason; labelCls = 'skip'; }
      else { labelTxt = v.verdict; labelCls = 'done'; }
    }
    row.innerHTML =
      `<span class="ov-idx">${idx + 1}</span>` +
      `<span class="ov-type">r${s.round} f${s.frame} · ${formatTime(s.pts)}</span>` +
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
  const list = document.getElementById('chin-overview');
  if (!list) return;
  let currentRow = null;
  for (const row of list.querySelectorAll('.ov-row')) {
    const is = Number(row.dataset.idx) === state.cursor;
    row.classList.toggle('current', is);
    if (is) currentRow = row;
  }
  if (currentRow) currentRow.scrollIntoView({ block: 'nearest' });
}

// ─── config / starting position ─────────────────────────────────────────────
async function loadChinConfig() {
  try {
    const res = await fetch('./chin_frames.json', { cache: 'no-cache' });
    if (!res.ok) return { params: {}, videos: [] };
    return await res.json();
  } catch {
    return { params: {}, videos: [] };
  }
}

// First playlist video this labeler hasn't finished — so reopening the page
// resumes where they left off. Falls back to 0 when the sheet is unreachable.
async function computeStartIdx(labeler) {
  if (!labeler) return 0;
  let doneByVideo = new Map();
  try {
    const rows = await fetchChinLabels('', labeler);
    for (const r of rows) {
      let s = doneByVideo.get(r.video);
      if (!s) { s = new Set(); doneByVideo.set(r.video, s); }
      s.add(r.round + ':' + r.frame);
    }
  } catch {
    return 0;
  }
  for (let i = 0; i < PLAYLIST.length; i++) {
    const known = state.knownVideos.find(v => v.stem === PLAYLIST[i]);
    const total = known ? known.samples.length : 0;
    const done = (doneByVideo.get(PLAYLIST[i]) || new Set()).size;
    if (done < total) return i;
  }
  return PLAYLIST.length - 1;   // everything done — land on the last video
}

// ─── wire-up ────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  setupPlayer();

  const labelerInput = document.getElementById('labeler-input');
  try { labelerInput.value = localStorage.getItem('orient_labeler_name') || ''; } catch {}
  labelerInput.addEventListener('change', async () => {
    try { localStorage.setItem('orient_labeler_name', labelerInput.value.trim()); } catch {}
    if (state.currentStem && state.samples.length) {
      syncFromSheet();
    } else {
      setPlaylistIdx(await computeStartIdx(labelerInput.value.trim()));
    }
  });

  const cfg = await loadChinConfig();
  state.knownVideos = cfg.videos || [];
  if (cfg.params && cfg.params.box_scale) state.boxScale = cfg.params.box_scale;
  const missing = PLAYLIST.filter(p => !state.knownVideos.some(v => v.stem === p));
  if (missing.length) setStatus('Playlist videos missing from chin_frames.json: ' + missing.join(' · '), 'err');

  document.getElementById('btn-video-prev').addEventListener('click', () => setPlaylistIdx(state.playlistIdx - 1));
  document.getElementById('btn-video-next').addEventListener('click', () => setPlaylistIdx(state.playlistIdx + 1));

  const video = document.getElementById('video-player');
  video.addEventListener('loadedmetadata', () => {
    state.videoLoaded = true;
    resetZoom();
    tryGenerateSamples();
  });
  video.addEventListener('seeked', () => { updateHud(); updateChinBox(); });
  window.addEventListener('resize', () => { updateChinBox(); applyZoomPan(); });
  setupZoomPan();

  document.getElementById('btn-tucked').addEventListener('click', () => labelWith('tucked'));
  document.getElementById('btn-level').addEventListener('click', () => labelWith('level'));
  document.getElementById('btn-air').addEventListener('click', () => labelWith('air'));
  document.getElementById('btn-undo').addEventListener('click', undoAction);
  document.getElementById('btn-skip-occluded').addEventListener('click', () => skipWith('occluded'));
  document.getElementById('btn-skip-unclear').addEventListener('click', () => skipWith('unclear'));
  document.getElementById('btn-skip-badbox').addEventListener('click', () => skipWith('bad_box'));
  document.getElementById('btn-first').addEventListener('click', gotoFirst);
  document.getElementById('btn-prev').addEventListener('click', gotoPrev);
  document.getElementById('btn-next').addEventListener('click', gotoNext);
  document.getElementById('btn-next-unlabeled').addEventListener('click', gotoNextUnlabeled);

  // Buttons keep focus after a click; blur them so keys keep driving the flow.
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('button');
    if (btn) btn.blur();
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (state.mode === 'skipping') {
      const m = SKIP_REASONS.find(s => s.key === e.key);
      if (m) { e.preventDefault(); skipWith(m.reason); return; }
      if (e.key === 'Escape' || e.key === 's' || e.key === 'S') { e.preventDefault(); cancelToScrub(); return; }
      return;
    }

    const v = VERDICTS.find(x => x.key === e.key);
    if (v) { e.preventDefault(); labelWith(v.verdict); return; }
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); toggleOverlay(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrames(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepFrames(1); return; }
    if (e.key === 'u' || e.key === 'U') { e.preventDefault(); undoAction(); return; }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); beginSkip(); return; }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); gotoNext(); return; }
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); gotoPrev(); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); gotoFirst(); return; }
    if (e.key === 'g' || e.key === 'G') { e.preventDefault(); gotoNextUnlabeled(); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); seekToCurrent(); return; }
  });

  setStatus('—');
  setPlaylistIdx(await computeStartIdx(labelerInput.value.trim()));
});

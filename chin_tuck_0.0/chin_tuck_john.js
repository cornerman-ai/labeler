// ============================================================
// chin_tuck_john.js — PRESERVED copy of the original single-verdict
// chin labeler (tucked / level / air), frozen for John's pass. Saves to
// the "Chin Labels" sheet. The live chin_tuck.html/.js (now chin_tuck_1.0)
// is the 3-question chin-vs-lead-shoulder labeler ("Chin Shoulder Labels").
//
// chin tuck 0.0 has no data of its own — it reads chin_tuck_1.0's
// chin_frames.json / chin_hosted.json / chin_excluded.json by relative
// path (same pattern 3.0 uses against 2.0's queue.json; deleting
// chin_tuck_1.0/ still breaks 0.0). The frame JPEGs themselves come from
// Firebase Storage now (moved 2026-08, same bucket every v1/v2/v3/v4 pool
// shares — see FRAME_PREFIX below), not a local copy: that was never
// about tidiness, a second 472MB frames directory for 0.0 alone was
// never worth the drift risk against 1.0's.
//
// Chin-position labeler, one verdict per sampled frame.
//
// Candidates come from chin_frames.json (baked by cornerman-backend's
// chin_tuck/chin_sampler.py): random frames per video where BlazePose tracked the
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

// Fixed labeling queue ("for now"): 10 professionally shot videos (the
// amateur critique clips were too low-res to judge the chin), 10 samples
// each, mixing shadowboxing and bagwork across different coaches/setups.
// No video picker — the page walks this list top to bottom and advances
// when every sample is labeled.
const PLAYLIST = [
  'Shadow Boxing Workout ｜ Let me coach you for 12 minutes',
  '20 Minute Boxing Footwork Heavy bag Workout - Follow along',
  'Beginner Shadow Boxing Workout In 5 Minutes ｜ Working The Jab (Follow Along)',
  '30 Minute Heavy Bag Boxing Workout at Home ｜ 10 Round Follow Along',
  '10 Min Complete Shadow Boxing Workout ｜ Become A Better Boxer',
  'Heavy Bag Workout ｜ Follow along Boxing Workout',
  '20 Minute Shadowboxing for Beginners ｜ Trainer of the Month Club ｜ Well+Good',
  'Beginner Heavy Bag Workout ｜ 15 Min Fat-Burning Boxing Follow Along With Igor Matejski',
  "Shadow Boxing Drill for Home ｜ Tom Yankello's Drill #1",
  '30 Days of Basic Boxing at Home for Beginners #DAY16  #HIENSUNDAY  #BoxingAtHome #HomeWorkout [pTNIAZADJzM]',
];

const VERDICTS = [
  { key: '1', verdict: 'tucked', label: 'tucked' },
  { key: '2', verdict: 'level',  label: 'level' },
  { key: '3', verdict: 'air',    label: 'in the air' },
];

// TEMP (John's pass): crop box hidden and the bad_box skip removed — the
// coach judges the chin naturally; box QA is a labeler job. Flip SHOW_BOX
// and re-add the bad_box row (key '3') to restore.
const SHOW_BOX = false;

const SKIP_REASONS = [
  { key: '1', reason: 'occluded', label: 'chin occluded' },
  { key: '2', reason: 'unclear',  label: 'unclear' },
];

Object.assign(state, {
  knownVideos: [],          // chin_frames.json videos — only source of samples
  boxScale: 1.3,            // overwritten from chin_frames.json params
  hostedStems: new Set(),   // chin_hosted.json — stems with server-side JPEGs
  excludedByStem: new Map(),// chin_excluded.json — triage-skipped frames, hidden from the queue
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
  manualNav: false,         // explicit prev/next click — pin, don't auto-advance
  syncSeq: 0,               // stale-response guard for syncFromSheet
});

function keyFor(s) {
  return s ? 's:' + s.round + ':' + s.frame : null;
}

// ─── hosted frames — server-side JPEGs instead of the local video ──────────
// Videos listed in chin_hosted.json have every sampled frame exported as
// frames/<stem>/r{round}_f{frame}.jpg (chin_export_frames.py), so remote
// labelers need no video files at all. Frame peeking is video-only.
function isHosted() {
  return state.hostedStems.has(state.currentStem);
}

// Windows forbids trailing dots/spaces in a path component, so the frames
// directory drops them — the stem itself stays canonical everywhere else
// (Sheet, chin_hosted.json). Mirrored in chin_export_frames.py; keep in sync.
function frameDir(stem) {
  return stem.replace(/[. ]+$/, '');
}

// Frames come from FIREBASE STORAGE (see the note at the top) — same
// bucket/prefix/token as chin_tuck.js (1.0), since 0.0 has no frame pool
// of its own.
const FRAME_BUCKET = 'mycorner-bee6a.firebasestorage.app';
const FRAME_PREFIX = 'labeler_media/chin_tuck/v1/frames';
const FRAME_TOKEN = '628dbeba-2969-4f45-b65e-5b295ef56fdc';

function frameUrl(stem, s) {
  return 'https://firebasestorage.googleapis.com/v0/b/' + FRAME_BUCKET + '/o/'
    + encodeURIComponent(FRAME_PREFIX + '/' + frameDir(stem) + '/r' + s.round + '_f' + s.frame + '.jpg')
    + '?alt=media&token=' + FRAME_TOKEN;
}

// Show the JPEG or the video element, never both.
function setActiveMedia(hosted) {
  const img = document.getElementById('frame-image');
  const video = document.getElementById('video-player');
  if (img) img.style.display = hosted ? 'block' : 'none';
  if (video) video.style.display = hosted ? 'none' : 'block';
}

// Dimensions of whatever is displaying the frame (0s until it has loaded).
function mediaDims() {
  if (isHosted()) {
    const img = document.getElementById('frame-image');
    return { el: img, w: img ? img.naturalWidth : 0, h: img ? img.naturalHeight : 0 };
  }
  const v = document.getElementById('video-player');
  return { el: v, w: (v && state.videoLoaded) ? v.videoWidth : 0, h: v ? v.videoHeight : 0 };
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
async function saveChinLabel({ labeler, video, round, frame, pts_sec, verdict, skip_reason, comment }) {
  const params = { action: 'saveChinLabel', labeler, video,
                   round: String(round), frame: String(frame), pts_sec: String(pts_sec) };
  params.verdict = verdict || '';
  params.skip_reason = skip_reason || '';
  params.comment = comment || '';
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
  if (isHosted()) return false;             // hosted JPEGs are the sample itself
  const video = document.getElementById('video-player');
  if (!video || !s) return false;
  const tol = 0.6 / sampleFps(s);
  return Math.abs(video.currentTime - s.pts) > tol;
}

// Crop box of the current sample in stage coords (pre-transform element px),
// or null when nothing to draw. Used by both the overlay and centerOnBox().
function computeBoxRect() {
  const s = state.samples[state.cursor];
  const { el, w, h } = mediaDims();
  if (!el || !s || !w || !h) return null;
  const b = chinBox(s.joints, w, h, state.boxScale);
  // object-fit: contain mapping — source pixels -> element pixels
  const scale = Math.min(el.clientWidth / w, el.clientHeight / h);
  const offX = el.offsetLeft + (el.clientWidth - w * scale) / 2;
  const offY = el.offsetTop + (el.clientHeight - h * scale) / 2;
  return { left: offX + b.x * scale, top: offY + b.y * scale,
           width: b.w * scale, height: b.h * scale };
}

function updateChinBox() {
  const box = document.getElementById('chin-box');
  if (!box) return;
  if (!SHOW_BOX) {
    box.style.display = 'none';
    return;
  }
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
    el.innerHTML = 'Skip reason: ' +
      SKIP_REASONS.map(s => `<b>${s.key}</b> ${s.label}`).join(' · ') +
      ' · <b>Esc</b> cancel';
  } else {
    const s = state.samples[state.cursor];
    const existing = s ? state.labelByKey.get(keyFor(s)) : undefined;
    if (existing !== undefined) {
      const isSkip = !!existing.skip_reason;
      setBanner(isSkip ? `SKIPPED: ${existing.skip_reason}` : `LABELED: ${existing.verdict}`,
                isSkip ? 'skipping' : 'captured');
      el.innerHTML = `Saved: <b class="${isSkip ? 'lbl-skip' : 'lbl-done'}">${formatChinLabel(existing)}</b>.` +
        (existing.comment ? `<br><span class="saved-comment">“${escapeHtml(existing.comment)}”</span>` : '') +
        '<br><b>1/2/3</b> re-labels (overwrites) · <b>U</b> clears';
    } else {
      setBanner(null);
      el.innerHTML = s
        ? 'Judge the chin: <b>1</b> tucked · <b>2</b> level · <b>3</b> in the air.'
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

// Samples for a stem minus the triage-excluded ones (chin_excluded.json —
// frames one labeler already marked occluded / unclear / bad_box, kept out
// of everyone else's queue so review time goes to judgeable frames only).
// rep>0 samples are the intra-rater repeats added for the three-question
// labeler (chin_tuck.js). This frozen page keys its sheet on round:frame with
// no rep, so a repeat here would silently overwrite the original — drop them.
function samplesFor(stem) {
  const known = state.knownVideos.find(v => v.stem === stem);
  if (!known) return [];
  const samples = known.samples.filter(s => !s.rep);
  const excluded = state.excludedByStem.get(stem);
  if (!excluded) return samples;
  return samples.filter(s => !excluded.has(s.round + ':' + s.frame));
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

// Move to another playlist entry. Auto flows (finishing a video, resuming
// on load) roll onward past fully-labeled videos; explicit prev/next clicks
// pass manual=true and stay on the chosen video — otherwise clicking prev
// with a fully-labeled history chains all the way to the end.
function setPlaylistIdx(idx, manual) {
  state.playlistIdx = Math.max(0, Math.min(PLAYLIST.length - 1, idx));
  state.manualNav = !!manual;
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
  setActiveMedia(isHosted());

  // Hosted videos need no file; otherwise the right file must be open —
  // prompt (or complain) until it is.
  if (!isHosted() && (!state.videoLoaded || loadedFileStem() !== state.currentStem)) {
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

  state.cursor = 0;
  state.doneKeys = new Set();
  state.labelByKey = new Map();
  state.coverageByKey = new Map();
  enterScrub();
  setStatus('—');

  state.samples = samplesFor(state.currentStem);
  const nExcluded = (state.excludedByStem.get(state.currentStem) || new Set()).size;
  if (!state.samples.length) {
    setModeBadge('0 samples');
    setCurrentLine('No sampled frames for "' + state.currentStem + '".');
    redrawProgress();
    return;
  }
  setModeBadge(state.samples.length + ' samples' + (nExcluded ? ' · ' + nExcluded + ' excluded' : ''));
  redrawProgress();
  state.cursor = 0;
  seekToCurrent();
  state.autoJumpOnSync = !state.manualNav;
  state.manualNav = false;
  syncFromSheet();
}

async function syncFromSheet() {
  if (!state.currentStem || !state.samples.length) return;
  const labeler = document.getElementById('labeler-input').value.trim();
  if (!labeler) {
    setStatus('Type your name above before labelling.', 'err');
    return;
  }
  // Sheet responses take a second or two and can land out of order when the
  // labeler navigates quickly (or during the auto-advance chain). Only the
  // newest sync may touch state — a stale response filtered against the
  // wrong video's queue would wipe the loaded labels ("Loaded 0").
  const stem = state.currentStem;
  const seq = ++state.syncSeq;
  try {
    setStatus('Loading existing labels…');
    const rows = await fetchChinLabels(stem, '');
    if (seq !== state.syncSeq || stem !== state.currentStem) return;
    state.doneKeys = new Set();
    state.labelByKey = new Map();
    state.coverageByKey = new Map();
    const inQueue = new Set(state.samples.map(keyFor));
    for (const r of rows) {
      const k = 's:' + r.round + ':' + r.frame;
      if (!inQueue.has(k)) continue;    // excluded or from an older sampling
      let who = state.coverageByKey.get(k);
      if (!who) { who = new Set(); state.coverageByKey.set(k, who); }
      who.add(r.labeler);
      if (r.labeler === labeler) {
        state.doneKeys.add(k);
        state.labelByKey.set(k, { verdict: r.verdict, skip_reason: r.skip_reason, comment: r.comment || '' });
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
      const label = state.labelByKey.get(keyFor(s));
      setCommentBox(label ? label.comment : '');
      const total = `${state.cursor + 1}/${state.samples.length}`;
      setCurrentLine(describeSample(s, total, formatChinLabel(label)));
    }
    updateCapturePanel();
    redrawProgress();
  } catch (e) {
    if (seq !== state.syncSeq) return;
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
  if (isHosted()) {
    const img = document.getElementById('frame-image');
    img.onload = () => { updateHud(); updateChinBox(); centerOnBox(); };
    img.src = frameUrl(state.currentStem, s);
    // Preload the next sample's frame so advancing feels instant.
    const nx = state.samples[state.cursor + 1];
    if (nx) { new Image().src = frameUrl(state.currentStem, nx); }
  } else {
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
  }
  const label = state.labelByKey.get(keyFor(s));
  setCommentBox(label ? label.comment : '');
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

function currentComment() {
  const el = document.getElementById('chin-comment');
  return el ? el.value.trim() : '';
}

function setCommentBox(text) {
  const el = document.getElementById('chin-comment');
  if (el) el.value = text || '';
}

function labelWith(verdict) {
  state.autoJumpOnSync = false;
  if (!state.currentStem || !state.samples.length) {
    setStatus('Pick a video and load the file first.', 'err'); return;
  }
  const labeler = requireLabeler();
  if (!labeler) return;
  persistLabel(labeler, { verdict, skip_reason: null, comment: currentComment() });
}

function beginSkip() {
  state.autoJumpOnSync = false;
  if (!state.currentStem || !state.samples.length) return;
  state.mode = 'skipping';
  setBanner('SKIP: ' + SKIP_REASONS.map(s => `[${s.key}] ${s.label}`).join(' · ') +
            ' · [Esc] cancel', 'skipping');
  updateCapturePanel();
}

function skipWith(reason) {
  if (!state.currentStem || !state.samples.length) return;
  const labeler = requireLabeler();
  if (!labeler) return;
  persistLabel(labeler, { verdict: null, skip_reason: reason, comment: currentComment() });
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
    comment: label.comment,
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
      if (v.comment) labelTxt += ' 💬';
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
    const res = await fetch('../chin_tuck_1.0/chin_frames.json', { cache: 'no-cache' });
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
    const samples = samplesFor(PLAYLIST[i]);
    const labeled = doneByVideo.get(PLAYLIST[i]) || new Set();
    if (samples.some(s => !labeled.has(s.round + ':' + s.frame))) return i;
  }
  return PLAYLIST.length - 1;   // everything done — land on the last video
}

// ─── wire-up ────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  setupPlayer();

  const labelerInput = document.getElementById('labeler-input');
  try {
    labelerInput.value = (window.CMLabeler && window.CMLabeler.get()) ||
      localStorage.getItem('orient_labeler_name') || '';
  } catch {}
  labelerInput.addEventListener('change', async () => {
    try { localStorage.setItem('orient_labeler_name', labelerInput.value.trim()); } catch {}
    if (window.CMLabeler) window.CMLabeler.set(labelerInput.value);
    if (state.currentStem && state.samples.length) {
      syncFromSheet();
    } else {
      setPlaylistIdx(await computeStartIdx(labelerInput.value.trim()));
    }
  });

  const cfg = await loadChinConfig();
  state.knownVideos = cfg.videos || [];
  if (cfg.params && cfg.params.box_scale) state.boxScale = cfg.params.box_scale;
  try {
    const res = await fetch('../chin_tuck_1.0/chin_hosted.json', { cache: 'no-cache' });
    if (res.ok) state.hostedStems = new Set((await res.json()).stems || []);
  } catch {}
  try {
    const res = await fetch('../chin_tuck_1.0/chin_excluded.json', { cache: 'no-cache' });
    if (res.ok) {
      for (const [stem, lst] of Object.entries((await res.json()).videos || {})) {
        state.excludedByStem.set(stem, new Set(lst.map(e => e.round + ':' + e.frame)));
      }
    }
  } catch {}
  const missing = PLAYLIST.filter(p => !state.knownVideos.some(v => v.stem === p));
  if (missing.length) setStatus('Playlist videos missing from chin_frames.json: ' + missing.join(' · '), 'err');

  document.getElementById('btn-video-prev').addEventListener('click', () => setPlaylistIdx(state.playlistIdx - 1, true));
  document.getElementById('btn-video-next').addEventListener('click', () => setPlaylistIdx(state.playlistIdx + 1, true));

  // Escape drops focus out of the comment box so 1/2/3 shortcuts work again.
  document.getElementById('chin-comment').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.target.blur(); }
  });

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
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (isHosted()) { setStatus('Frame peeking needs the local video file.', null); return; }
      stepFrames(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
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

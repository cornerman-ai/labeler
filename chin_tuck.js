// ============================================================
// chin_tuck.js — chin-vs-lead-shoulder labeler, THREE answers per sampled frame
//
// Candidates come from chin_frames.json (baked by cornerman-backend's
// chin_sampler.py): random frames per video where BlazePose tracked the
// head + shoulders confidently. Each sample carries the normalized joint
// anchors; the chin crop box is computed here at display time from the
// video's true dimensions with the SAME formula as the Python side
// (chin_sampler.chin_box), and drawn over the frame so labeling doubles
// as a visual check of the crop the model will eventually see.
//
// Every frame gets three answers, all judged against the LEAD shoulder:
//   chin_height  over / level / under   is the chin higher than, level
//                                       with, or lower than the shoulder?
//   chin_front   front / same / behind  is the chin in front of, even
//                                       with, or behind the shoulder?
//   kissing      yes / no               is the chin close enough to the
//                                       shoulder to (almost) kiss it?
//
// Interaction: each sample seeks + pauses on its frame. Keys 1/2/3 answer
// the ACTIVE question (the first unanswered one); answering the last
// question saves and advances — 3 keypresses per frame. Buttons can answer
// the questions in any order. Esc restarts the current frame's answers.
// ←/→ peek at neighboring frames for motion context (the label still
// applies to the SAMPLED frame). S then 1/2 skips (occluded / unclear).
// U clears. Saved to the "Chin Shoulder Labels" sheet via
// saveChinShoulderLabel / listChinShoulderLabels / deleteChinShoulderLabel,
// keyed by (labeler, video, round, frame).
//
// The original single-verdict labeler (tucked / level / air, "Chin Labels"
// sheet) is preserved as chin_tuck_john.html / chin_tuck_john.js.
//
// Reuses player.js for the video chrome, sheetUrl(), and shared `state`.
// ============================================================

// Labeling queue: EVERY hosted video (all sampled frames — a versatile
// dataset across the whole corpus, not a hand-picked subset). The 10
// professionally shot videos from the original pass come first (best image
// quality, frames already triaged); every other hosted video follows
// alphabetically. Built at load from chin_frames.json ∩ chin_hosted.json.
// No video picker — the page walks the list top to bottom and advances
// when every sample is labeled.
const PRIORITY_STEMS = [
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
let PLAYLIST = [];

// Hosted stems only — remote labelers have no video files, so a stem
// without server-side JPEGs would dead-end the queue. (Fallback to every
// manifest stem when chin_hosted.json is missing, e.g. local dev.)
function buildPlaylist() {
  const known = state.knownVideos.map(v => v.stem);
  const eligible = state.hostedStems.size
    ? known.filter(s => state.hostedStems.has(s))
    : known;
  const head = PRIORITY_STEMS.filter(s => eligible.includes(s));
  const rest = eligible.filter(s => !head.includes(s)).sort((a, b) => a.localeCompare(b));
  PLAYLIST = head.concat(rest);
}

// The three questions, answered in order via keys 1/2/3 (buttons work in
// any order). `id` doubles as the sheet column name. Options run GOOD →
// BAD (1 = the proper tucked position), so keys read like a grade.
const QUESTIONS = [
  { id: 'chin_height', num: 1, title: 'Height',
    options: [
      { key: '1', value: 'under', label: 'under' },
      { key: '2', value: 'level', label: 'level' },
      { key: '3', value: 'over',  label: 'over' },
    ] },
  { id: 'chin_front', num: 2, title: 'Front to back',
    options: [
      { key: '1', value: 'behind', label: 'behind' },
      { key: '2', value: 'same',   label: 'same' },
      { key: '3', value: 'front',  label: 'in front' },
    ] },
  { id: 'kissing', num: 3, title: 'Kissing',
    options: [
      { key: '1', value: 'yes', label: 'yes' },
      { key: '2', value: 'no',  label: 'no' },
    ] },
];
const ANSWER_FIELDS = QUESTIONS.map(q => q.id);

// Crop box hidden (as in the original page's John config) — the labeler
// judges the chin naturally; flip SHOW_BOX to restore the overlay.
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
  labelByKey: new Map(),    // key -> { chin_height, chin_front, kissing, skip_reason, comment }
  coverageByKey: new Map(), // current video: sampleKey -> Set<labeler>
  answers: {},              // in-progress answers for the CURRENT sample
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

function frameUrl(stem, s) {
  return './frames/' + encodeURIComponent(stem) + '/r' + s.round + '_f' + s.frame + '.jpg';
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

// Full form for the state panel; compact 3-letter form (e.g. "O·F·Y") for
// the overview rows.
function formatChinLabel(v, compact) {
  if (v === undefined) return 'unlabeled';
  if (v.skip_reason) return 'skip:' + v.skip_reason;
  if (compact) return ANSWER_FIELDS.map(f => String(v[f] || '?')[0].toUpperCase()).join('·');
  return v.chin_height + ' · ' + v.chin_front + ' · kiss:' + v.kissing;
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

// ─── hover guide cross ─────────────────────────────────────────────────────
// A horizontal + vertical line at the cursor — hover the shoulder to see
// how the chin lines up in height (horizontal) and front-to-back
// (vertical). The lines live in stage coords, so they track correctly at
// any zoom/pan; thickness is counter-scaled to stay hairline when zoomed.
function setupGuideLine() {
  const viewport = document.getElementById('video-viewport');
  const stage = document.getElementById('zoom-stage');
  const guideH = document.getElementById('chin-guide');
  const guideV = document.getElementById('chin-guide-v');
  if (!viewport || !stage || !guideH || !guideV) return;
  const hide = () => {
    guideH.style.display = 'none';
    guideV.style.display = 'none';
  };
  viewport.addEventListener('mousemove', (e) => {
    const r = viewport.getBoundingClientRect();
    // invert the stage transform
    const x = (e.clientX - r.left - state.panX) / state.zoom;
    const y = (e.clientY - r.top - state.panY) / state.zoom;
    if (x < 0 || x > stage.offsetWidth || y < 0 || y > stage.offsetHeight) {
      hide();
      return;
    }
    const w = Math.max(2 / state.zoom, 0.5) + 'px';
    guideH.style.display = 'block';
    guideH.style.top = y + 'px';
    guideH.style.borderTopWidth = w;
    guideV.style.display = 'block';
    guideV.style.left = x + 'px';
    guideV.style.borderLeftWidth = w;
  });
  viewport.addEventListener('mouseleave', hide);
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

// ─── sheet sync (Chin Shoulder Labels) ─────────────────────────────────────
async function fetchChinLabels(video, labeler) {
  const url = sheetUrl({ action: 'listChinShoulderLabels', video, labeler });
  const res = await fetch(url);
  if (!res.ok) throw new Error('listChinShoulderLabels HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('listChinShoulderLabels: ' + (body.message || 'unknown'));
  return body.rows;
}
async function saveChinShoulderLabel({ labeler, video, round, frame, pts_sec,
                                       chin_height, chin_front, kissing,
                                       skip_reason }) {
  const params = { action: 'saveChinShoulderLabel', labeler, video,
                   round: String(round), frame: String(frame), pts_sec: String(pts_sec) };
  params.chin_height = chin_height || '';
  params.chin_front = chin_front || '';
  params.kissing = kissing || '';
  params.skip_reason = skip_reason || '';
  const url = sheetUrl(params);
  const res = await fetch(url);
  if (!res.ok) throw new Error('saveChinShoulderLabel HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('saveChinShoulderLabel: ' + (body.message || 'unknown'));
  return body;
}
async function deleteChinShoulderLabel({ labeler, video, round, frame }) {
  const url = sheetUrl({ action: 'deleteChinShoulderLabel', labeler, video,
                         round: String(round), frame: String(frame) });
  const res = await fetch(url);
  if (!res.ok) throw new Error('deleteChinShoulderLabel HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('deleteChinShoulderLabel: ' + (body.message || 'unknown'));
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
    ? base + ' · PEEKING — answers label the sampled frame'
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

// First question without an in-progress answer, or null when all answered /
// no sample on screen.
function activeQuestion() {
  if (!state.samples.length || state.cursor >= state.samples.length) return null;
  return QUESTIONS.find(q => !state.answers[q.id]) || null;
}

// Revisit flow: pre-fill the buttons with the saved answers so they show
// green and a single changed click re-saves. Skips aren't pre-filled (they
// have no answers), and in-progress answers are never clobbered.
function prefillFromSaved(label) {
  if (!label || label.skip_reason) return;
  if (ANSWER_FIELDS.some(f => state.answers[f])) return;
  for (const f of ANSWER_FIELDS) state.answers[f] = label[f];
}

// Highlight the active question block + the selected option buttons.
function renderQuestions() {
  const active = state.mode === 'scrub' ? activeQuestion() : null;
  for (const q of QUESTIONS) {
    const div = document.querySelector(`.chin-q[data-q="${q.id}"]`);
    if (div) div.classList.toggle('active', !!active && active.id === q.id);
  }
  document.querySelectorAll('.q-opt').forEach(btn => {
    btn.classList.toggle('selected', state.answers[btn.dataset.q] === btn.dataset.v);
  });
}

function updateCapturePanel() {
  renderQuestions();
  const el = document.getElementById('chin-state');
  if (!el) return;
  if (state.mode === 'skipping') {
    el.innerHTML = 'Skip reason: ' +
      SKIP_REASONS.map(s => `<b>${s.key}</b> ${s.label}`).join(' · ') +
      ' · <b>Esc</b> cancel';
    return;
  }
  const s = state.samples[state.cursor];
  const existing = s ? state.labelByKey.get(keyFor(s)) : undefined;
  const started = ANSWER_FIELDS.some(f => state.answers[f]);
  const complete = ANSWER_FIELDS.every(f => state.answers[f]);
  // Saved view shows when the frame is untouched OR fully pre-filled from
  // the saved label (revisit) — a partial edit falls back to the Q prompt.
  if (existing !== undefined && (!started || complete)) {
    const isSkip = !!existing.skip_reason;
    setBanner(isSkip ? `SKIPPED: ${existing.skip_reason}` : `LABELED: ${formatChinLabel(existing)}`,
              isSkip ? 'skipping' : 'captured');
    el.innerHTML = `Saved: <b class="${isSkip ? 'lbl-skip' : 'lbl-done'}">${formatChinLabel(existing)}</b>.` +
      (isSkip
        ? '<br>Answer the 3 questions to replace the skip · <b>U</b> clears'
        : '<br>Click another option to change an answer — it re-saves &amp; moves on · <b>U</b> clears');
  } else if (s) {
    setBanner(null);
    const q = activeQuestion();
    if (q) {
      el.innerHTML = `Q${q.num}/3 — <b>${q.title}</b>: ` +
        q.options.map(o => `<b>${o.key}</b> ${o.label}`).join(' · ') +
        (started ? ' · <b>Esc</b> restart' : '');
    } else {
      el.innerHTML = '—';
    }
  } else {
    setBanner(null);
    el.innerHTML = '—';
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
function samplesFor(stem) {
  const known = state.knownVideos.find(v => v.stem === stem);
  if (!known) return [];
  const excluded = state.excludedByStem.get(stem);
  if (!excluded) return known.samples;
  return known.samples.filter(s => !excluded.has(s.round + ':' + s.frame));
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
  state.answers = {};
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
  state.answers = {};
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
        state.labelByKey.set(k, { chin_height: r.chin_height, chin_front: r.chin_front,
                                  kissing: r.kissing, skip_reason: r.skip_reason });
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
      prefillFromSaved(label);
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
  state.answers = {};
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
  prefillFromSaved(label);
  const total = `${state.cursor + 1}/${state.samples.length}`;
  setCurrentLine(describeSample(s, total, formatChinLabel(label)));
  updateCapturePanel();
  updateOverviewHighlight();
  updateHud();
  updateChinBox();
}

// ─── answers / skip / undo ─────────────────────────────────────────────────
function requireLabeler() {
  const labeler = document.getElementById('labeler-input').value.trim();
  if (!labeler) {
    setStatus('Type your name first.', 'err');
    document.getElementById('labeler-input').focus();
    return null;
  }
  return labeler;
}

// Record one answer; the third one completes the label and saves it.
function answerWith(qid, value) {
  state.autoJumpOnSync = false;
  if (!state.currentStem || !state.samples.length) {
    setStatus('Pick a video and load the file first.', 'err'); return;
  }
  if (state.cursor >= state.samples.length) return;
  state.answers[qid] = value;
  updateCapturePanel();
  if (!ANSWER_FIELDS.every(f => state.answers[f])) return;
  const labeler = requireLabeler();
  if (!labeler) return;    // answers stay — save fires once the name is set
  const a = state.answers;
  state.answers = {};
  persistLabel(labeler, { chin_height: a.chin_height, chin_front: a.chin_front,
                          kissing: a.kissing, skip_reason: null });
}

function resetAnswers() {
  if (!ANSWER_FIELDS.some(f => state.answers[f])) return;
  state.answers = {};
  updateCapturePanel();
  setStatus('Answers reset — start from question 1.', null);
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
  state.answers = {};
  persistLabel(labeler, { chin_height: null, chin_front: null, kissing: null,
                          skip_reason: reason });
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
  const wasDone = state.doneKeys.has(k);   // re-save of an edit, not new progress
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

  saveChinShoulderLabel({
    labeler,
    video: stemAtSave,
    round: s.round,
    frame: s.frame,
    pts_sec: s.pts,
    chin_height: label.chin_height,
    chin_front: label.chin_front,
    kissing: label.kissing,
    skip_reason: label.skip_reason,
  }).then(() => {
    state.pendingSaves = Math.max(0, (state.pendingSaves || 1) - 1);
    setStatus(state.pendingSaves === 0 ? 'Saved.'
      : state.pendingSaves + ' save' + (state.pendingSaves === 1 ? '' : 's') + ' pending…',
      state.pendingSaves === 0 ? 'ok' : null);
    // Whole video confirmed saved -> advance the playlist. Only when this
    // save was NEW progress — editing a frame of an already-complete video
    // (revisit flow) stays put.
    if (!wasDone && state.pendingSaves === 0 && state.currentStem === stemAtSave &&
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
    await deleteChinShoulderLabel({ labeler, video: state.currentStem, round: s.round, frame: s.frame });
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
  // Distribution, one line per question plus skips.
  const parts = [];
  for (const q of QUESTIONS) {
    const counts = {};
    for (const v of state.labelByKey.values()) {
      if (v.skip_reason || !v[q.id]) continue;
      counts[v[q.id]] = (counts[v[q.id]] || 0) + 1;
    }
    const qp = q.options.filter(o => counts[o.value])
                        .map(o => o.value + ':' + counts[o.value]);
    if (qp.length) parts.push(q.title + ' — ' + qp.join(' '));
  }
  const skipCounts = {};
  for (const v of state.labelByKey.values()) {
    if (v.skip_reason) skipCounts[v.skip_reason] = (skipCounts[v.skip_reason] || 0) + 1;
  }
  for (const s of SKIP_REASONS) {
    if (skipCounts[s.reason]) parts.push('skip:' + s.reason + ': ' + skipCounts[s.reason]);
  }
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
      else { labelTxt = formatChinLabel(v, true); labelCls = 'done'; }
    }
    row.innerHTML =
      `<span class="ov-idx">${idx + 1}</span>` +
      `<span class="ov-type">r${s.round} f${s.frame} · ${formatTime(s.pts)}</span>` +
      `<span class="ov-label ${labelCls}" title="${escapeHtml(formatChinLabel(v))}">${labelTxt}</span>`;
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
  try {
    const res = await fetch('./chin_hosted.json', { cache: 'no-cache' });
    if (res.ok) state.hostedStems = new Set((await res.json()).stems || []);
  } catch {}
  try {
    const res = await fetch('./chin_excluded.json', { cache: 'no-cache' });
    if (res.ok) {
      for (const [stem, lst] of Object.entries((await res.json()).videos || {})) {
        state.excludedByStem.set(stem, new Set(lst.map(e => e.round + ':' + e.frame)));
      }
    }
  } catch {}
  buildPlaylist();
  if (!PLAYLIST.length) setStatus('No videos to label — chin_frames.json / chin_hosted.json empty?', 'err');

  document.getElementById('btn-video-prev').addEventListener('click', () => setPlaylistIdx(state.playlistIdx - 1, true));
  document.getElementById('btn-video-next').addEventListener('click', () => setPlaylistIdx(state.playlistIdx + 1, true));

  const video = document.getElementById('video-player');
  video.addEventListener('loadedmetadata', () => {
    state.videoLoaded = true;
    resetZoom();
    tryGenerateSamples();
  });
  video.addEventListener('seeked', () => { updateHud(); updateChinBox(); });
  window.addEventListener('resize', () => { updateChinBox(); applyZoomPan(); });
  setupZoomPan();
  setupGuideLine();

  // Question buttons — clickable in any order; the third answer saves.
  document.querySelectorAll('.q-opt').forEach(btn => {
    btn.addEventListener('click', () => answerWith(btn.dataset.q, btn.dataset.v));
  });
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

    const q = activeQuestion();
    if (q) {
      const opt = q.options.find(o => o.key === e.key);
      if (opt) { e.preventDefault(); answerWith(q.id, opt.value); return; }
    }
    if (e.key === 'Escape') { e.preventDefault(); resetAnswers(); return; }
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

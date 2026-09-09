// ============================================================
// skeleton.js — BlazePose overlay for the punch labeler
//
// Reads the .npy/_pts.npy/_meta.json triples cornerman-backend's BlazePose
// extraction writes per round (see CLAUDE.md's skeleton_data note) straight
// from disk via <input type="file" multiple> — no upload, no backend call.
// Grouped by round number, drawn over the video synced by pts_sec (the
// meta's own clock, same seconds as video.currentTime — see the _meta.json
// "pts_sec_clock": "track_time" field).
//
// State lives on window.state (shared with player.js/app.js) under
// state.skeleton so nothing else has to know this file exists.
// ============================================================

Object.assign(state, {
  skeleton: { rounds: [], visible: false },
});

// Body edges (mediapipe POSE_CONNECTIONS) plus the nose (0) wired down to
// both shoulders for head position — the rest of the face mesh (eyes, eye
// corners, ears, mouth — joints 1-10) stays out as clutter BlazePose tracks
// less reliably anyway.
const SKELETON_EDGES = [
  [0, 11], [0, 12],
  [11, 12], [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];
// Joints drawn as dots — the nose, one wrist dot per hand (15/16 — the
// finer pinky/index/thumb landmarks (17-22) are dropped, they cluttered the
// hand into a messy blob without adding anything a labeler needs), and
// every other body landmark.
const SKELETON_DOT_JOINTS = [
  0,
  ...Array.from({ length: 22 }, (_, i) => i + 11).filter(j => ![17, 18, 19, 20, 21, 22].includes(j)),
];

// Total length of the vertical plumb-line guide (see
// drawSkeletonVerticalGuide()), as a fraction of the canvas's own height —
// not a measured height, just "reasonably taller than a person standing in
// frame" so it reads as a plumb line rather than a random mark.
const SKELETON_VERTICAL_GUIDE_HEIGHT_FRACTION = 0.7;

// A joint is ALWAYS drawn now, however unreliable BlazePose says the
// estimate is — hiding it entirely below a cutoff (the old
// VISIBILITY_THRESHOLD) meant a bad frame lost the joint completely, with
// nothing on screen to say why an arm suddenly had no elbow. Colour carries
// that instead: green only above the top band, then yellow / orange / red
// as the model's own confidence drops, checked fresh every frame (BlazePose
// visibility is per-frame, not a property of the joint) — the dot stays
// exactly where the data says, the colour is just honest about how much to
// trust it. Ordered high-to-low so SKELETON_JOINT_TIERS.find() below can
// just return the first band the value clears.
const SKELETON_JOINT_TIERS = [
  { min: 0.75, color: '#5CE65C' },   // confident — the "normal" colour
  { min: 0.50, color: '#F5D30A' },   // yellow — borderline
  { min: 0.25, color: '#F5A623' },   // orange — low confidence
  { min: -Infinity, color: '#E64545' },   // red — least confident, still shown
];
function skeletonJointColor(v) {
  return SKELETON_JOINT_TIERS.find(tier => v >= tier.min).color;
}

// ============================================================
// .npy reader — just enough of the format (v1.0/v2.0 header, the dtypes
// the BlazePose pipeline actually writes) to pull out shape + a typed array.
// No library: this all runs offline, off files picked from disk.
// ============================================================
function parseNpy(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x93 || String.fromCharCode(bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]) !== 'NUMPY') {
    throw new Error('not a .npy file');
  }
  const major = bytes[6];
  let headerLen, headerStart;
  if (major === 1) {
    headerLen = bytes[8] | (bytes[9] << 8);
    headerStart = 10;
  } else {
    headerLen = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
    headerStart = 12;
  }
  const header = new TextDecoder('ascii').decode(bytes.slice(headerStart, headerStart + headerLen));
  const descrMatch = header.match(/'descr':\s*'([^']+)'/);
  const shapeMatch = header.match(/'shape':\s*\(([^)]*)\)/);
  if (!descrMatch || !shapeMatch) throw new Error('unreadable .npy header');
  const descr = descrMatch[1];
  const shape = shapeMatch[1].split(',').map(s => s.trim()).filter(Boolean).map(Number);
  const dataBuffer = buffer.slice(headerStart + headerLen);
  let data;
  switch (descr) {
    case '<f8': data = new Float64Array(dataBuffer); break;
    case '<f4': data = new Float32Array(dataBuffer); break;
    case '<i8': data = new BigInt64Array(dataBuffer); break;
    case '<i4': data = new Int32Array(dataBuffer); break;
    case '<u1': case '|u1': case '|b1': data = new Uint8Array(dataBuffer); break;
    default: throw new Error('unsupported .npy dtype: ' + descr);
  }
  return { shape, data };
}

// ============================================================
// Loading — groups the picked files by round number. Whatever doesn't fit
// gets filtered out rather than aborting the whole batch, since a multi-file
// picker over a folder of hundreds of clips makes it easy to sweep in a
// stray file:
//   - a name that isn't any of the three blazepose suffixes at all (some
//     other video's export, or an unrelated file) — silently ignored, not
//     even counted as a mistake.
//   - a round missing one of its three files — counted as `incomplete`.
//   - a round whose files parse but don't agree with each other (corrupt
//     download, or two different videos' round-0s picked together) —
//     counted as `invalid`, and reported with the reason.
// A failure in one round never drops the rounds around it — each is parsed
// in its own try/catch.
// ============================================================
async function loadSkeletonFiles(fileList) {
  const groups = {}; // round number -> { main, pts, meta }
  for (const f of Array.from(fileList)) {
    let m;
    if ((m = f.name.match(/_blazepose_r(\d+)_meta\.json$/i))) {
      (groups[m[1]] = groups[m[1]] || {}).meta = f;
    } else if ((m = f.name.match(/_blazepose_r(\d+)_pts\.npy$/i))) {
      (groups[m[1]] = groups[m[1]] || {}).pts = f;
    } else if ((m = f.name.match(/_blazepose_r(\d+)\.npy$/i))) {
      (groups[m[1]] = groups[m[1]] || {}).main = f;
    }
    // Anything else (a video file, a different labeler's export, a stray
    // .DS_Store, ...) matches none of the three patterns and is dropped
    // right here — it never enters `groups` at all.
  }

  const rounds = [];
  let incomplete = 0;
  const invalidReasons = [];
  for (const [roundNum, g] of Object.entries(groups)) {
    if (!g.main || !g.pts || !g.meta) { incomplete++; continue; }
    try {
      const [mainBuf, ptsBuf, metaText] = await Promise.all([
        g.main.arrayBuffer(), g.pts.arrayBuffer(), g.meta.text(),
      ]);
      const meta = JSON.parse(metaText);
      const mainNpy = parseNpy(mainBuf);
      const ptsNpy = parseNpy(ptsBuf);
      const channels = meta.channels || [];
      const nFrames = meta.n_frames, nJoints = meta.n_joints, nChannels = meta.n_channels;
      const xIdx = channels.indexOf('x'), yIdx = channels.indexOf('y');
      if (!Number.isInteger(nFrames) || !Number.isInteger(nJoints) || !Number.isInteger(nChannels)) {
        throw new Error('meta.json missing n_frames/n_joints/n_channels');
      }
      if (xIdx < 0 || yIdx < 0) throw new Error('meta.json channels has no x/y');
      // The shapes the three files claim have to actually agree — this is
      // what catches "these three files aren't really a matched triple"
      // (wrong video, wrong round, truncated download) before it turns into
      // silently-wrong or out-of-bounds reads at draw time.
      if (mainNpy.shape.length !== 3 ||
          mainNpy.shape[0] !== nFrames || mainNpy.shape[1] !== nJoints || mainNpy.shape[2] !== nChannels) {
        throw new Error(`round ${roundNum}: main array is ${mainNpy.shape.join('x')}, `
          + `meta says ${nFrames}x${nJoints}x${nChannels}`);
      }
      if (ptsNpy.shape.length !== 1 || ptsNpy.shape[0] !== nFrames) {
        throw new Error(`round ${roundNum}: pts array has ${ptsNpy.data.length} entries, meta says ${nFrames} frames`);
      }
      rounds.push({
        round: Number(roundNum),
        nFrames, nJoints, nChannels,
        xIdx, yIdx, visIdx: channels.indexOf('visibility'),
        data: mainNpy.data,
        pts: ptsNpy.data,
      });
    } catch (err) {
      console.error(`Skeleton round ${roundNum} skipped:`, err);
      invalidReasons.push(String(err.message || err));
    }
  }
  rounds.sort((a, b) => a.round - b.round);
  return { rounds, incomplete, invalid: invalidReasons.length, invalidReasons };
}

// ============================================================
// Frame lookup — binary search on a round's pts array, then pick whichever
// round actually covers the requested time.
// ============================================================
function nearestFrameIndex(pts, t) {
  let lo = 0, hi = pts.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid] < t) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(pts[lo - 1] - t) < Math.abs(pts[lo] - t)) lo--;
  return lo;
}

// Rounds don't overlap, but there can be a gap between them (or before/after
// the first/last) where nothing was extracted — MAX_GAP_SEC keeps a stray
// nearest-frame match from snapping across a big silent stretch and drawing
// a skeleton that isn't really there.
const MAX_GAP_SEC = 1.5;

function findSkeletonFrame(t) {
  for (const r of state.skeleton.rounds) {
    if (!r.pts.length) continue;
    if (t < r.pts[0] - MAX_GAP_SEC || t > r.pts[r.pts.length - 1] + MAX_GAP_SEC) continue;
    const idx = nearestFrameIndex(r.pts, t);
    if (idx < 0 || Math.abs(r.pts[idx] - t) > MAX_GAP_SEC) continue;
    return { round: r, frame: idx };
  }
  return null;
}

// ============================================================
// Canvas positioning — reads #video-player's ACTUAL rendered box via
// getBoundingClientRect() rather than recomputing the "contain" fit by hand:
// the browser's own layout is the only thing guaranteed to match what's on
// screen, and the rect already reflects ui.js's pinch/wheel zoom transform
// (getBoundingClientRect() is post-transform), so there's no separate
// transform to mirror onto the canvas either.
// ============================================================
function positionSkeletonCanvas() {
  const canvas = document.getElementById('skeleton-canvas');
  const video = document.getElementById('video-player');
  const viewport = document.getElementById('video-viewport');
  if (!canvas || !video || !viewport || !video.videoWidth || !video.videoHeight) return;

  const vRect = video.getBoundingClientRect();
  const vpRect = viewport.getBoundingClientRect();
  if (!vRect.width || !vRect.height) return;
  const left = vRect.left - vpRect.left, top = vRect.top - vpRect.top;
  const w = vRect.width, h = vRect.height;

  canvas.style.left = left + 'px';
  canvas.style.top = top + 'px';
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  const dpr = window.devicePixelRatio || 1;
  const pxW = Math.round(w * dpr), pxH = Math.round(h * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }
}

// A barely-visible dashed vertical line through the hip midpoint (joints
// 23/24) — a plumb line, the reference a coach's eye already uses for
// "is the stance/balance actually vertical here", now on screen for every
// frame by default whenever the skeleton is on. Centered on the hips and
// drawn first, BEHIND the skeleton itself, so it reads as the backdrop
// grid it is rather than competing with the joints for attention.
function drawSkeletonVerticalGuide(ctx, px, nJoints, canvasH) {
  if (nJoints <= 24) return;   // no hip joints in this extraction — nothing to center on
  const [lx, ly] = px(23), [rx, ry] = px(24);
  const cx = (lx + rx) / 2, cy = (ly + ry) / 2;
  const half = (canvasH * SKELETON_VERTICAL_GUIDE_HEIGHT_FRACTION) / 2;

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = Math.max(1, canvasH / 700);
  ctx.setLineDash([canvasH / 90, canvasH / 60]);
  ctx.beginPath();
  ctx.moveTo(cx, cy - half);
  ctx.lineTo(cx, cy + half);
  ctx.stroke();
  ctx.restore();   // setLineDash is context state — undo it before the (solid) bones below
}

function drawSkeletonFrame(t) {
  const canvas = document.getElementById('skeleton-canvas');
  if (!canvas) return;
  positionSkeletonCanvas();
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.skeleton.visible || !canvas.width || !canvas.height) return;

  const hit = findSkeletonFrame(t);
  if (!hit) return;
  const { round: r, frame } = hit;
  const base = frame * r.nJoints * r.nChannels;
  const at = (joint, ch) => r.data[base + joint * r.nChannels + ch];

  const W = canvas.width, H = canvas.height;
  // No visibility channel at all (older extractions) reads as fully
  // confident — there's nothing to grade it against, same as the old
  // gate's default.
  const visibility = (j) => r.visIdx < 0 ? 1 : at(j, r.visIdx);
  const px = (j) => [at(j, r.xIdx) * W, at(j, r.yIdx) * H];

  drawSkeletonVerticalGuide(ctx, px, r.nJoints, H);

  // Thin light bones, bright filled joints — the same visual language a
  // pose-estimation demo uses: the SKELETON is a faint guide, the JOINTS
  // are what you actually read the pose off of, so they carry the weight
  // and the contrast. Every edge draws regardless of either endpoint's
  // confidence — a joint that's still shown (just recoloured, see below)
  // needs its bones too, or it reads as detached from the body.
  ctx.lineWidth = Math.max(1, W / 500);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineCap = 'round';
  for (const [a, b] of SKELETON_EDGES) {
    if (a >= r.nJoints || b >= r.nJoints) continue;
    const [ax, ay] = px(a), [bx, by] = px(b);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  const dotR = Math.max(3, W / 140);
  ctx.strokeStyle = 'rgba(0, 40, 0, 0.55)';
  ctx.lineWidth = Math.max(0.75, dotR / 4);
  for (const j of SKELETON_DOT_JOINTS) {
    if (j >= r.nJoints) continue;
    const [x, y] = px(j);
    ctx.fillStyle = skeletonJointColor(visibility(j));
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

// ============================================================
// UI wiring
// ============================================================
function setSkeletonStatus(kind, text) {
  const el = document.getElementById('skeleton-status');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  el.className = 'field-status' + (kind ? ' ' + kind : '');
  document.getElementById('skeleton-loader')?.classList.toggle('ok', kind === 'ok');
  document.getElementById('skeleton-loader')?.classList.toggle('err', kind === 'err');
}

function setSkeletonToggleLabel() {
  const btn = document.getElementById('btn-toggle-skeleton');
  if (!btn) return;
  btn.textContent = state.skeleton.visible ? 'Hide' : 'Show';
  btn.classList.toggle('speed-active', state.skeleton.visible);
}

function setupSkeletonLoader() {
  const input = document.getElementById('skeleton-files');
  const nameEl = document.getElementById('skeleton-name');
  const toggleBtn = document.getElementById('btn-toggle-skeleton');
  if (!input) return;

  input.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    setSkeletonStatus('syncing', 'Reading…');
    try {
      const { rounds, incomplete, invalid, invalidReasons } = await loadSkeletonFiles(files);
      state.skeleton.rounds = rounds;
      state.skeleton.visible = rounds.length > 0;
      const skipped = incomplete + invalid;
      if (!rounds.length) {
        if (nameEl) nameEl.textContent = 'No skeletons loaded';
        setSkeletonStatus('err', skipped
          ? `${skipped} round${skipped === 1 ? '' : 's'} skipped — ${
              invalidReasons.length ? invalidReasons[0] : 'need the .npy, _pts.npy and _meta.json together'}`
          : 'No matching files');
        if (toggleBtn) toggleBtn.hidden = true;
        return;
      }
      const roundList = rounds.map(r => r.round).join(', ');
      if (nameEl) nameEl.textContent = `${rounds.length} round${rounds.length === 1 ? '' : 's'} (r${roundList})`;
      setSkeletonStatus('ok', skipped ? `${skipped} skipped` : 'Loaded');
      if (toggleBtn) { toggleBtn.hidden = false; setSkeletonToggleLabel(); }
      drawSkeletonFrame(document.getElementById('video-player')?.currentTime || 0);
    } catch (err) {
      console.error('Skeleton load failed:', err);
      setSkeletonStatus('err', 'Could not read those files');
    }
  });

  toggleBtn?.addEventListener('click', () => {
    state.skeleton.visible = !state.skeleton.visible;
    setSkeletonToggleLabel();
    drawSkeletonFrame(document.getElementById('video-player')?.currentTime || 0);
  });

  window.addEventListener('resize', () => positionSkeletonCanvas());
}

// ============================================================
// Playback sync — updateVideoOverlay() (app.js) already calls
// drawSkeletonFrame() on every 'timeupdate', but browsers fire that only a
// handful of times a second, not once per rendered frame — fine for the
// list/minimap, but during playback the skeleton visibly trailed the
// picture (dead on when paused/seeked, since 'seeked' fires once with the
// exact time). requestVideoFrameCallback fires once per actual decoded
// frame with that frame's own presentation time, so redrawing there keeps
// the overlay locked to what's on screen instead of the timeupdate clock.
// Falls back to a plain rAF loop reading currentTime on browsers without it.
// ============================================================
function setupSkeletonPlaybackSync() {
  const video = document.getElementById('video-player');
  if (!video) return;
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const onFrame = (now, metadata) => {
      drawSkeletonFrame(metadata.mediaTime);
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  } else {
    const loop = () => {
      drawSkeletonFrame(video.currentTime);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupSkeletonLoader();
  setupSkeletonPlaybackSync();
});

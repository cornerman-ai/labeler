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

// Body-only BlazePose-33 edges (mediapipe POSE_CONNECTIONS minus the face
// landmarks 0-10) — a boxer's stance and guard read fine off the torso/limbs
// alone, and the face dots just added clutter at video scale.
const SKELETON_EDGES = [
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];
const VISIBILITY_THRESHOLD = 0.5;

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
  const visible = (j) => r.visIdx < 0 || at(j, r.visIdx) >= VISIBILITY_THRESHOLD;
  const px = (j) => [at(j, r.xIdx) * W, at(j, r.yIdx) * H];

  ctx.lineWidth = Math.max(2, W / 260);
  ctx.strokeStyle = 'rgba(56, 220, 140, 0.9)';
  ctx.fillStyle = 'rgba(56, 220, 140, 0.95)';
  for (const [a, b] of SKELETON_EDGES) {
    if (a >= r.nJoints || b >= r.nJoints || !visible(a) || !visible(b)) continue;
    const [ax, ay] = px(a), [bx, by] = px(b);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  const dotR = Math.max(2.5, W / 200);
  for (let j = 11; j < r.nJoints; j++) {
    if (!visible(j)) continue;
    const [x, y] = px(j);
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
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

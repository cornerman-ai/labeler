// ============================================================
// export-clip.js — "Export clip", admin only: a piece of the OPEN video —
// the highlighted label, or any typed begin → end — cut to a file and
// downloaded, for the reference set of what is and isn't a roll.
//
// The video is a local File playing in #video-player (player.js), so the
// cut is made from that element and nothing else: captureStream() hands
// out its decoded frames, MediaRecorder encodes them while the span plays
// back once at 1×, and the result downloads as one file. No server, no
// upload, no library. The price: an export takes as long as the span (a
// 3 s clip takes 3 s, you watch it play) and the frames are re-encoded —
// MP4/H.264 where the browser can write it (Chrome 126+), WebM otherwise.
// Chrome/Edge only, like the folder connects in video-folder.js.
//
// Files are named so a folder of them reads as a database:
//   <video stem>__<m-ss.mmm>-<m-ss.mmm>__<tag>.<mp4|webm>
// the tag being the label's type and owner when a label was exported
// (rear_roll_arianne), or whatever was typed for a free span (not_roll).
// The times in the name are the exported span, padding included.
//
// State lives on window.state (shared with player.js/app.js) under
// state.exportClip so nothing else has to know this file exists; app.js
// calls updateExportClipButton() when it decides the page is admin.
// ============================================================

Object.assign(state, {
  exportClip: { busy: false, lastBlob: null },
});

// First one the browser can write wins. MP4 first — it plays everywhere
// (QuickTime, Finder previews, phones); WebM is the fallback every
// Chromium has had for years.
const CLIP_MIME_CANDIDATES = [
  ['video/mp4;codecs=avc1', 'mp4'],
  ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm', 'webm'],
];
const CLIP_PAD_KEY = 'exportClipPadSeconds';
const CLIP_PAD_DEFAULT = 0.5;

function clipMimeChoice() {
  if (typeof MediaRecorder === 'undefined') return null;
  return CLIP_MIME_CANDIDATES.find(([m]) => MediaRecorder.isTypeSupported(m)) || null;
}

// ── the file ────────────────────────────────────────────────────────────
function clipFileName(begin, end, tag, ext) {
  const stem = String(state.videoName || 'video').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_');
  const t = (s) => formatTime(s).replace(':', '-');
  const safeTag = String(tag || '').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${stem}__${t(begin)}-${t(end)}${safeTag ? '__' + safeTag : ''}.${ext}`;
}

function downloadClipBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ── playing the span through the recorder ───────────────────────────────
function clipSeekTo(video, t) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-3 && video.readyState >= 2) return resolve();
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

// Resolves once the frame at (or past) `end` has been presented — per
// decoded frame where the browser offers that, so the cut lands within a
// frame of the asked time. The coarser timeupdate clock runs alongside,
// not instead: frame callbacks stop while the tab is hidden, and an admin
// who switches tabs mid-export would otherwise get a clip that runs on
// until they came back. Whichever clock reaches `end` first wins.
function clipPlayedUntil(video, end) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      video.removeEventListener('timeupdate', onTime);
      document.removeEventListener('visibilitychange', onHide);
      if (err) reject(err); else resolve();
    };
    const onTime = () => { if (video.currentTime >= end || video.ended) finish(); };
    // A hidden tab stops decoding a muted video outright, so the recorder
    // would sit on a frozen picture and this promise would never settle —
    // give up instead, with a message that says why.
    const onHide = () => { if (document.hidden) finish(new Error('the tab was hidden during the export — keep it visible and try again')); };
    video.addEventListener('timeupdate', onTime);
    document.addEventListener('visibilitychange', onHide);
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const tick = (now, meta) => {
        if (done) return;
        if (meta.mediaTime >= end || video.ended) finish();
        else video.requestVideoFrameCallback(tick);
      };
      video.requestVideoFrameCallback(tick);
    }
  });
}

async function exportClip(begin, end, tag) {
  const video = document.getElementById('video-player');
  if (!video || !video.duration) { showToast('Open the video first', 'error'); return false; }
  if (state.exportClip.busy) { showToast('An export is already running', 'error'); return false; }
  begin = Math.max(0, begin);
  end = Math.min(video.duration, end);
  if (!(end > begin)) { showToast('End must be after begin', 'error'); return false; }
  const choice = clipMimeChoice();
  if (!choice || typeof video.captureStream !== 'function') {
    showToast('This browser cannot export clips — use Chrome or Edge', 'error');
    return false;
  }
  const [mimeType, ext] = choice;
  if (document.hidden) { showToast('Keep this tab visible while a clip exports', 'error'); return false; }
  const rateBefore = video.playbackRate;
  state.exportClip.busy = true;
  document.body.classList.add('exporting-clip');
  let stream = null;
  try {
    video.pause();
    video.playbackRate = 1;                         // the recorder runs on the wall clock
    await clipSeekTo(video, begin);
    stream = video.captureStream();
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { rec.onstop = resolve; });
    rec.start(250);
    showToast(`Exporting ${formatTime(begin)} → ${formatTime(end)} — plays once at 1×`, 'info');
    await video.play();
    await clipPlayedUntil(video, end);
    video.pause();
    await new Promise((r) => setTimeout(r, 200));  // let the last frame reach the recorder
    rec.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
    state.exportClip.lastBlob = blob;
    const name = clipFileName(begin, end, tag, ext);
    downloadClipBlob(blob, name);
    showToast(`Saved ${name} (${(blob.size / 1e6).toFixed(1)} MB)`, 'success');
    return true;
  } catch (err) {
    console.error('Clip export failed:', err);
    showToast('Clip export failed: ' + (err && err.message || err), 'error');
    return false;
  } finally {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    video.playbackRate = rateBefore;
    state.exportClip.busy = false;
    document.body.classList.remove('exporting-clip');
  }
}

// ── the pop-up ──────────────────────────────────────────────────────────
function updateExportClipButton() {
  const seg = document.getElementById('export-clip-seg');
  if (seg) seg.hidden = !state.isAdmin;
}

// The label the pop-up offers: the highlighted row, if it's a move (a round
// or unusable marker has no span to cut).
function exportClipCandidateLabel() {
  const l = state.highlightedLabel;
  return l && !l.isRoundMarker && Number.isFinite(l.start) && Number.isFinite(l.end) ? l : null;
}

function exportClipTagFor(label) {
  const owner = label.foreign ? foreignOwnerName(label) : labelerId();
  return `${label.punch}_${owner}`.toLowerCase();
}

function fillExportClipFromLabel(label) {
  document.getElementById('ec-begin').value = formatTime(label.start);
  document.getElementById('ec-end').value = formatTime(label.end);
  document.getElementById('ec-tag').value = exportClipTagFor(label);
  document.getElementById('ec-from').textContent =
    `From the label: ${punchLabel(label.punch)} ${formatTime(label.start)} → ${formatTime(label.end)}`
    + (label.foreign ? ` · ${foreignOwnerName(label)}` : '');
}

function fillExportClipFromPlayhead() {
  const video = document.getElementById('video-player');
  const t = video ? video.currentTime : 0;
  document.getElementById('ec-begin').value = formatTime(t);
  document.getElementById('ec-end').value = formatTime(t + 1);
  document.getElementById('ec-from').textContent = 'From the playhead — type the span, or highlight a label first';
}

function openExportClipPop() {
  const pop = document.getElementById('export-clip-pop');
  const btn = document.getElementById('btn-export-clip');
  const label = exportClipCandidateLabel();
  if (label) fillExportClipFromLabel(label); else fillExportClipFromPlayhead();
  document.getElementById('ec-use-label').disabled = !label;
  pop.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  document.getElementById('ec-begin').focus();
}

function closeExportClipPop() {
  const pop = document.getElementById('export-clip-pop');
  const btn = document.getElementById('btn-export-clip');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
}

async function exportClipFromPop() {
  const begin = parseTime(document.getElementById('ec-begin').value);
  const end = parseTime(document.getElementById('ec-end').value);
  const pad = Math.max(0, parseFloat(document.getElementById('ec-pad').value) || 0);
  const tag = document.getElementById('ec-tag').value;
  if (isNaN(begin) || isNaN(end)) { showToast('Times must look like 5:47.134', 'error'); return; }
  try { localStorage.setItem(CLIP_PAD_KEY, String(pad)); } catch (_) {}
  closeExportClipPop();
  await exportClip(begin - pad, end + pad, tag);
}

function setupExportClip() {
  const seg = document.getElementById('export-clip-seg');
  const btn = document.getElementById('btn-export-clip');
  const pop = document.getElementById('export-clip-pop');
  if (!seg || !btn || !pop) return;
  updateExportClipButton();

  const padInput = document.getElementById('ec-pad');
  try {
    const saved = parseFloat(localStorage.getItem(CLIP_PAD_KEY));
    padInput.value = Number.isFinite(saved) ? saved : CLIP_PAD_DEFAULT;
  } catch (_) { padInput.value = CLIP_PAD_DEFAULT; }

  btn.addEventListener('click', () => { if (pop.hidden) openExportClipPop(); else closeExportClipPop(); });
  document.getElementById('ec-export').addEventListener('click', exportClipFromPop);
  document.getElementById('ec-use-label').addEventListener('click', () => {
    const label = exportClipCandidateLabel();
    if (label) fillExportClipFromLabel(label);
  });
  pop.querySelectorAll('.ec-now').forEach((b) => b.addEventListener('click', () => {
    const video = document.getElementById('video-player');
    document.getElementById(b.dataset.for).value = formatTime(video ? video.currentTime : 0);
  }));
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); exportClipFromPop(); }
    if (e.key === 'Escape') closeExportClipPop();
  });
  document.addEventListener('click', (e) => { if (!seg.contains(e.target)) closeExportClipPop(); });

  // While a span is being recorded the page's shortcuts (space, arrows,
  // the punch keys) would seek or pause the very playback being captured.
  window.addEventListener('keydown', (e) => {
    if (state.exportClip.busy) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

document.addEventListener('DOMContentLoaded', setupExportClip);

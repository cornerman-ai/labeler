// ============================================================
// roll_shoulders.js — the coach rates whether the shoulders rotate through the
// roll: Good / Bad / Can't tell (2026-10-24, Mathé). The third pass on the roll
// clips (same clips and Firebase folder as roll eyes and roll legs; its own
// queue, its own workbook "Roll shoulders ratings", doGetRollShoulders).
//
// The question, the hint, the ratings and the Can't tell reasons are the PASS
// block just below — the ONLY place to change them (buttons, colours, keys, help
// rows and examples follow; the Apps Script takes any lower_snake rating with
// the rank sent here). After a change, put an example clip per new rating in
// examples.json.
//
// Page code copied from ../roll_legs/roll_legs.js — keep the passes in step.
// queue.json and admin.json are built by cornerman-backend
// ml/research/roll_eyes/roll_rating/shoulders_pass.py (admin.json: roll_shoulders.py's
// shoulder turn, tilt, hip turn and separation against guard).
//
// Admin mode — the name `admin`: every roll once by video and time, Next roll /
// Next video, the skeleton measure, the shoulder and hip lines drawn on the
// clip, the shoulder line's apparent width and tilt plotted over it, and every
// rater's rating + comment.
// ============================================================

const PASS = {
  question: 'Do the shoulders rotate through the roll?',
  hint: 'Watch the shoulders from guard to the bottom of the roll and back up: do they turn with the roll? Type a ' +
        'comment first if you want one; one tap on a rating saves both and plays the next clip.',
  watch: 'Watch the <b>shoulders</b>',
  // r: what lands in the sheet (lower_snake), rank: rating_rank (a number, '' for none), key: the shortcut,
  // tone: the button's colour
  ratings: [
    { r: 'good',      key: '1', rank: 1,  tone: '#2fa36b', name: 'Good',
      desc: 'The shoulders turn with the roll and come through.' },
    { r: 'bad',       key: '2', rank: 0,  tone: '#d9473c', name: 'Bad',
      desc: 'The shoulders stay square or barely turn.' },
    { r: 'cant_tell', key: '0', rank: '', tone: '#8e8e93', name: 'Can’t tell', desc: 'Say why in the comment.' },
  ],
  reasons: ['Shoulders hidden', 'Body out of the picture', 'Too blurry / too small', 'Not a roll'],
};
const RATINGS = PASS.ratings;
const REASONS = PASS.reasons;
const BUCKET = 'mycorner-bee6a.firebasestorage.app';
const PREFIX = 'labeler_media/roll_eyes/v1/';    // the roll eyes clips: one clip set for both passes
const TOKEN = '628dbeba-2969-4f45-b65e-5b295ef56fdc';   // the shared labeler_media token
const mediaUrl = (path) => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/`
  + encodeURIComponent(PREFIX + path) + `?alt=media&token=${TOKEN}`;
const clipUrl = (id) => mediaUrl(`clips/${id}.mp4`);
const adminUrl = (id) => mediaUrl(`admin_body/${id}.json`);

const SPEED_KEY = 'rollEyesSpeed';     // shared with roll eyes: one speed preference for the roll clips
const OUTBOX_KEY = 'rollShouldersOutbox';   // saves the Sheet hasn't confirmed yet, per rater
const ACT = { list: 'listRollShoulders', save: 'saveRollShoulders' };

Object.assign(state, {
  clips: {},          // id -> clip facts
  queue: [],          // [{slot, id, rep}] — in admin mode every roll once, by video and time
  rateQueue: [],      // the raters' queue, kept while admin re-orders
  ratings: new Map(), // slot -> {rating, comment} (this rater)
  cursor: 0,
  shownAt: 0,
  rater: '',
  admin: false,
  model: null,        // admin.json
  allRows: [],        // admin: every rater's live rows
  examples: [],
  body: null,         // admin: the shown roll's per-frame joints and angles
  wantReason: false,  // Can't tell was pressed with no comment: a picked reason saves it
  loaded: false,
});

const $ = (id) => document.getElementById(id);
const videoEl = () => $('video-player');

function syncChip(text, err) {
  const el = $('sync-chip');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('err', !!err);
}

// ─── load ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupPlayer();
  setupVideo();
  buildButtons();
  setupComment();
  setupControls();
  setupKeys();
  setupFaceCanvas();
  setupPassText();
  try {
    const [q, ex] = await Promise.all([
      fetch('queue.json', { cache: 'no-cache' }).then(r => r.json()),
      fetch('examples.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { examples: [] }).catch(() => ({ examples: [] })),
    ]);
    state.clips = q.clips;
    state.examples = ex.examples || [];
    const exIds = new Set(state.examples.map(e => e.id));
    state.rateQueue = q.queue.map(([id, rep], slot) => ({ slot, id, rep })).filter(s => !exIds.has(s.id));
    state.queue = state.rateQueue;
  } catch (e) {
    $('watch').textContent = 'Could not load the clips: ' + e.message;
    return;
  }
  buildExamples();
  // ui.js commits the name on blur, which runs after this change event.
  $('labeler-input').addEventListener('change', () => setTimeout(loadRater, 0));
  await loadRater();
});

async function loadRater() {
  const name = (window.CMLabeler && window.CMLabeler.get()) || '';
  if (name === state.rater && state.loaded) return;
  state.rater = name;
  state.loaded = !!name;
  state.ratings = new Map();
  state.admin = name.trim().toLowerCase() === 'admin';
  document.body.classList.toggle('re-admin', state.admin);
  $('rate-card').hidden = state.admin;
  $('model-card').hidden = !state.admin;
  $('btn-next-video').hidden = !state.admin;
  $('face-canvas').hidden = !state.admin;
  if (state.admin) return loadAdmin();
  state.queue = state.rateQueue;
  if (!name) {
    showSlot(0);
    $('progress').textContent = 'Type your name at the top right to start.';
    return;
  }
  syncChip('Loading your ratings…');
  try {
    const res = await call({ action: ACT.list });
    for (const row of res.rows) state.ratings.set(row.slot, { rating: row.rating, comment: row.comment });
    syncChip('');
  } catch (e) {
    syncChip('Could not load your earlier ratings — ' + e.message, true);
  }
  for (const o of outbox()) state.ratings.set(Number(o.slot), { rating: o.rating, comment: o.comment });
  flushOutbox();
  showSlot(firstUnrated());
}

async function loadAdmin() {
  // every roll once, by video then time
  const ids = [...new Set(state.rateQueue.map(s => s.id))];
  ids.sort((a, b) => {
    const A = state.clips[a], B = state.clips[b];
    return A.video_name === B.video_name ? A.start_sec - B.start_sec : A.video_name.localeCompare(B.video_name);
  });
  state.queue = ids.map((id, i) => ({ slot: i, id, rep: 0 }));
  syncChip('Loading the model and the ratings…');
  try {
    const [model, res] = await Promise.all([
      fetch('admin.json', { cache: 'no-cache' }).then(r => r.json()),
      call({ action: ACT.list }),
    ]);
    state.model = model;
    state.allRows = res.rows;
    syncChip('');
  } catch (e) {
    syncChip('Could not load the admin data — ' + e.message, true);
  }
  showSlot(0);
}

function firstUnrated() {
  const i = state.queue.findIndex(s => !state.ratings.has(s.slot));
  return i === -1 ? state.queue.length : i;
}

// ─── the Apps Script ──────────────────────────────────────────────────────────
async function call(params) {
  const res = await fetch(sheetUrl(params));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const body = await res.json();
  // doGet answers unknown actions with a success shape; `re` says this handler ran.
  if (!body.re) throw new Error('the Apps Script is an older deployment');
  if (body.status !== 'ok') throw new Error(body.message || 'save failed');
  return body;
}

function outbox() {
  try { return (JSON.parse(localStorage.getItem(OUTBOX_KEY) || '{}')[state.rater]) || []; } catch { return []; }
}
function setOutbox(list) {
  try {
    const all = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '{}');
    all[state.rater] = list;
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(all));
  } catch {}
}

let flushing = false;
async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    let list = outbox();
    while (list.length) {
      const item = list[0];
      try {
        await call(item);
      } catch (e) {
        syncChip(`${list.length} not saved yet — retrying (${e.message})`, true);
        setTimeout(() => { flushing = false; flushOutbox(); }, 5000);
        return;
      }
      list = outbox().filter(o => !(o.slot === item.slot && o.ts_local === item.ts_local));
      setOutbox(list);
      syncChip(list.length ? `Saving… (${list.length})` : 'All saved');
    }
    syncChip('All saved');
  } finally {
    flushing = false;
  }
}

// ─── rating ─────────────────────────────────────────────────────────────────
function rate(rating) {
  if (state.admin) return;
  if (!state.rater) { showToast('Type your name at the top right first', 'error'); $('labeler-input').focus(); return; }
  const s = state.queue[state.cursor];
  if (!s) return;
  const comment = $('comment').value.trim();
  // Can't tell needs a reason: ask for it and save nothing until there is one.
  if (rating === 'cant_tell' && !comment) {
    state.wantReason = true;
    $('reasons').hidden = false;
    $('comment').classList.add('need');
    $('comment').placeholder = 'Why can’t you tell? Pick a reason below or type it';
    $('comment').focus();
    return;
  }
  state.wantReason = false;
  const c = state.clips[s.id];
  const btn = document.querySelector(`.rate[data-r="${rating}"]`);
  if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 120); }
  state.ratings.set(s.slot, { rating, comment });
  const dwell = Math.min(120, (performance.now() - state.shownAt) / 1000);
  // One pending save per slot: a re-rate before the first save went out replaces it.
  const list = outbox().filter(o => Number(o.slot) !== s.slot);
  list.push({
    action: ACT.save, slot: s.slot, rep: s.rep, rating, comment,
    rating_rank: RATINGS.find(x => x.r === rating)?.rank ?? '',
    clip_id: s.id, roll_id: s.id, video_name: c.video_name, side: c.side, stance: c.stance,
    training_type: c.training_type, roll_start: c.start_sec, roll_end: c.end_sec, bottom_sec: c.bottom_sec,
    clip_start: c.clip_start, clip_end: c.clip_end,
    speed: videoEl().playbackRate, dwell_sec: dwell.toFixed(1), ts_local: Date.now(),
  });
  setOutbox(list);
  syncChip('Saving…');
  flushOutbox();
  showSlot(Math.min(state.cursor + 1, firstUnrated()));
}

// ─── showing a clip ─────────────────────────────────────────────────────────
function showSlot(i) {
  state.cursor = Math.max(0, Math.min(i, state.queue.length));
  const total = state.queue.length;
  if (state.admin) {
    $('progress').textContent = total ? `roll ${(state.cursor + 1).toLocaleString()} of ${total.toLocaleString()} · by video` : '';
    $('progress-fill').style.width = total ? (100 * (state.cursor + 1) / total) + '%' : '0';
  } else {
    const done = state.ratings.size;
    $('progress').textContent = state.rater ? `${done.toLocaleString()} of ${total.toLocaleString()} rated` : '';
    $('progress-fill').style.width = total ? (100 * done / total) + '%' : '0';
  }
  const finished = state.cursor >= total;
  $('done').hidden = !finished || state.admin;
  $('buttons').hidden = finished;
  const v = videoEl();
  if (finished) {
    v.removeAttribute('src'); v.load();
    $('watch').textContent = '—'; $('clip-n').textContent = '';
    renderTimelineOverlay();
    return;
  }
  const s = state.queue[state.cursor];
  const c = state.clips[s.id];
  if (v.dataset.id !== s.id) {
    v.dataset.id = s.id;
    $('clip-loading').hidden = false;
    $('clip-loading').textContent = 'Loading…';
    v.src = clipUrl(s.id);
  } else {
    v.currentTime = 0;
  }
  v.play().catch(() => {});
  $('watch').innerHTML = state.admin
    ? `<b>${esc(c.video_name.replace(/\.[^.]+$/, ''))}</b> · ${c.start_sec.toFixed(1)} s · ${c.side.replace('_', ' ')} · ${s.id}`
    : `${PASS.watch} · ${c.side.replace('_', ' ')}`;
  $('clip-n').textContent = `#${(state.cursor + 1).toLocaleString()}`;
  const mine = state.ratings.get(s.slot);
  for (const b of document.querySelectorAll('.rate')) b.classList.toggle('chosen', b.dataset.r === mine?.rating);
  $('comment').value = mine?.comment || '';
  $('comment').classList.remove('need');
  $('comment').placeholder = 'Anything worth noting about this roll';
  $('reasons').hidden = mine?.rating !== 'cant_tell';
  state.wantReason = false;
  state.shownAt = performance.now();
  renderTimelineOverlay();
  if (state.admin) showModel(s.id);
  prefetch(state.cursor);
}

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

const prefetched = new Set();
function prefetch(i) {
  for (let k = i + 1; k <= i + 4 && k < state.queue.length; k++) {
    const id = state.queue[k].id;
    if (prefetched.has(id)) continue;
    prefetched.add(id);
    fetch(clipUrl(id)).catch(() => prefetched.delete(id));
  }
}

// ─── the player ──────────────────────────────────────────────────────────────
// player.js's setupVideoLoader() only wires these when the page has a file
// picker; this page has none, so they are wired here (as uppercut_drop.js does).
function setupVideo() {
  const v = videoEl();
  v.addEventListener('loadedmetadata', () => {
    state.frameDuration = 1 / 30;
    state.fpsDetected = false;
    detectFrameRateQuietly(v);
    setSpeed(savedSpeed());   // through setSpeed, so ui.js repaints the speed menu
    state.zoomLevel = 1; state.zoomCenter = 0.5;
    onZoomChanged();
  });
  v.addEventListener('loadeddata', () => { $('clip-loading').hidden = true; });
  v.addEventListener('error', () => {
    if (!v.getAttribute('src')) return;
    $('clip-loading').hidden = false;
    $('clip-loading').textContent = 'The clip failed to load — check the connection and reload the page';
  });
  v.addEventListener('timeupdate', () => updateTimeDisplay());
  v.addEventListener('seeked', _onSeeked);
  // timeupdate fires ~4x a second, coarse against a one-second clip: move the
  // playhead (and admin's face overlay) every frame.
  const tick = () => {
    if (!v.paused) updateTimeDisplay();
    if (state.admin) { drawBody(); drawPlot(); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// player.js's detectFrameRate(), minus its toast — this page loads a new clip
// every few seconds.
function detectFrameRateQuietly(v) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return;
  const times = [];
  const onFrame = (now, meta) => {
    times.push(meta.mediaTime);
    if (times.length < 6) { v.requestVideoFrameCallback(onFrame); return; }
    const d = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    const median = d[Math.floor(d.length / 2)];
    if (median > 0.001 && median < 0.5) { state.frameDuration = median; state.fpsDetected = true; updateTimeDisplay(); }
  };
  v.requestVideoFrameCallback(onFrame);
}

function savedSpeed() {
  try { return Number(localStorage.getItem(SPEED_KEY)) || 1; } catch { return 1; }
}
// Every speed change (the menu, S, the 0.5× button) goes through setSpeed:
// remember it there, synchronously — a new src resets playbackRate to
// defaultPlaybackRate before any ratechange event would arrive. ui.js wraps
// this again at load to repaint the menu.
const _playerSetSpeed = window.setSpeed;
window.setSpeed = function (rate) {
  _playerSetSpeed(rate);
  videoEl().defaultPlaybackRate = rate;
  try { localStorage.setItem(SPEED_KEY, String(rate)); } catch {}
  $('btn-half').classList.toggle('on', Math.abs(rate - 0.5) < 0.001);
};
const toggleHalf = () => setSpeed(Math.abs(videoEl().playbackRate - 0.5) < 0.001 ? 1 : 0.5);

// The roll lane: the guard before the roll, the roll, and its lowest point (the
// frame the model reads the angle at). Clip time = source time − clip_start.
function renderTimelineOverlay() {
  const v = videoEl(), lanes = $('seg-lanes');
  if (!v || !lanes) return;
  lanes.querySelectorAll('.seg-lane').forEach(n => n.remove());
  const mini = $('minimap-segments');
  if (mini) mini.innerHTML = '';
  const duration = v.duration || 0;
  const s = state.queue[state.cursor];
  const c = s && state.clips[s.id];
  const lane = document.createElement('div');
  lane.className = 'seg-lane lane-roll';
  lanes.insertBefore(lane, $('playhead'));
  if (!duration || !c) return;
  const t0 = Math.max(0, c.start_sec - c.clip_start), t1 = Math.min(duration, c.end_sec - c.clip_start);
  const band = (cls, a, b, label, title) => {
    const l = timeToViewportPct(a, duration), r = timeToViewportPct(b, duration);
    const el = document.createElement('div');
    el.className = 're-band ' + cls;
    el.style.left = Math.max(0, l) + '%';
    el.style.width = Math.max(0, Math.min(100, r) - Math.max(0, l)) + '%';
    el.textContent = label; el.title = title;
    lane.appendChild(el);
    if (mini) {
      const m = document.createElement('div');
      m.className = 're-band ' + cls;
      m.style.left = (100 * a / duration) + '%'; m.style.width = (100 * (b - a) / duration) + '%';
      mini.appendChild(m);
    }
  };
  band('guard', 0, t0, 'guard', 'guard, before the roll');
  band('roll', t0, t1, 'roll', 'the roll, as labeled');
  if (c.bottom_sec != null) {
    const mark = document.createElement('div');
    mark.className = 're-bottom';
    mark.style.left = timeToViewportPct(c.bottom_sec - c.clip_start, duration) + '%';
    mark.title = 'the lowest point of the roll (the head lowest in the picture)';
    lane.appendChild(mark);
  }
  if (typeof renderTimeTicks === 'function') renderTimeTicks();
  updateVideoOverlay();
}

function updateVideoOverlay() {
  const v = videoEl(), playhead = $('playhead');
  if (!playhead) return;
  if (!v.duration) { playhead.hidden = true; return; }
  const pct = timeToViewportPct(v.currentTime, v.duration);
  playhead.hidden = pct < 0 || pct > 100;
  playhead.style.left = pct + '%';
}

// ─── admin: the skeleton measure, its plot, the joints on the clip ──────────
const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const sgn = (v) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(0));
const RATING_NAME = Object.fromEntries(RATINGS.map(x => [x.r, x.name]));
const C_SH = '#ffd400', C_HIP = '#3ad9e0';

async function showModel(id) {
  const m = state.model?.[id] || {};
  const c = state.clips[id];
  $('model-nums').innerHTML = `
    <div class="mn-big"><span class="mn-val">${m.sh_turn_max == null ? '—' : fmt(m.sh_turn_max) + '° turn'}</span>
      <span class="muted">the shoulder line's largest turn from guard inside the roll (3D, either way)</span></div>
    <div class="mn-grid">
      <span>at the bottom</span><b>${fmt(m.sh_turn_bottom)}°</b>
      <span>shoulder dip</span><b>${fmt(m.sh_tilt_max)}°</b>
      <span>hips turn</span><b>${fmt(m.hip_turn_max)}°</b>
      <span>past the hips</span><b>${fmt(m.sep_max)}°</b>
    </div>
    <div class="muted" style="font-size:11px;margin-top:4px">${c.training_type || ''}</div>`;
  const rows = state.allRows.filter(r => r.clip_id === id);
  $('rater-rows').innerHTML = rows.length
    ? rows.map(r => `<div class="rr"><b>${esc(r.rater)}</b> · <span class="rr-${r.rating}">${RATING_NAME[r.rating] || esc(r.rating)}</span>${r.comment ? ` — ${esc(r.comment)}` : ''}</div>`).join('')
    : 'Not rated yet.';
  state.body = null;
  try {
    const body = await fetch(adminUrl(id)).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)));
    if (state.queue[state.cursor]?.id === id) state.body = body;
  } catch (e) {
    if (state.queue[state.cursor]?.id === id) $('rater-rows').insertAdjacentHTML('beforeend', `<div class="muted">skeleton data failed: ${esc(e.message)}</div>`);
  }
}

// The admin frame nearest the playhead, within half a frame.
function bodyNow() {
  const f = state.body?.frames;
  if (!f?.length) return null;
  const t = videoEl().currentTime;
  let best = null, bd = 1e9;
  for (const x of f) { const d = Math.abs(x.t - t); if (d < bd) { bd = d; best = x; } }
  return bd <= 0.02 ? best : null;
}

// The canvas sits on the video's on-screen box (zoom transform included) and draws in the picture's own
// normalised coordinates, letterboxed inside that box as object-fit: contain does.
function setupFaceCanvas() {
  window.addEventListener('resize', () => drawBody());
}

// joints in admin_body files: nose, L / R shoulder, L / R hip, L / R knee, L / R ankle (BlazePose 0, 11, 12, 23..28)
const BONES = [[1, 3], [2, 4], [3, 5], [5, 7], [4, 6], [6, 8]];
function drawBody() {
  const cv = $('face-canvas'), v = videoEl();
  if (!state.admin || !cv || !v.videoWidth) return;
  const vp = $('video-viewport').getBoundingClientRect(), r = v.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.style.left = (r.left - vp.left) + 'px'; cv.style.top = (r.top - vp.top) + 'px';
  cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  if (cv.width !== Math.round(r.width * dpr)) cv.width = Math.round(r.width * dpr);
  if (cv.height !== Math.round(r.height * dpr)) cv.height = Math.round(r.height * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, r.width, r.height);
  const f = bodyNow();
  if (!f) return;
  const k = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
  const w = v.videoWidth * k, h = v.videoHeight * k, ox = (r.width - w) / 2, oy = (r.height - h) / 2;
  const P = (p) => [ox + p[0] * w, oy + p[1] * h];
  const J = f.j;
  const seg = (a, b, col, lw) => {
    if (!J[a] || !J[b]) return;
    const [x0, y0] = P(J[a]), [x1, y1] = P(J[b]);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = lw + 2.5; g.stroke(); g.strokeStyle = col; g.lineWidth = lw; g.stroke();
  };
  g.lineCap = 'round';
  for (const [a, b] of BONES) seg(a, b, 'rgba(255,255,255,.8)', 1.5);
  seg(3, 4, C_HIP, 4);            // the hip line
  seg(1, 2, C_SH, 5);             // the shoulder line
  for (const p of J) { if (!p) continue; const [x, y] = P(p); g.beginPath(); g.arc(x, y, 3, 0, 7); g.fillStyle = '#fff'; g.fill(); }
}

// The shoulder line in the picture per frame: its apparent width (shoulder to shoulder over the torso — it narrows as
// the shoulders turn toward or away from the lens) and its tilt (deg, one shoulder dipping).
function shoulderSeries(frames) {
  const wh = [16, 9];
  return frames.map(f => {
    const J = f.j;
    if (!J[1] || !J[2] || !J[3] || !J[4]) return { t: f.t, wid: null, tilt: null };
    const dx = (J[2][0] - J[1][0]) * wh[0], dy = (J[2][1] - J[1][1]) * wh[1];
    const sh = [(J[1][0] + J[2][0]) / 2, (J[1][1] + J[2][1]) / 2], hp = [(J[3][0] + J[4][0]) / 2, (J[3][1] + J[4][1]) / 2];
    const torso = Math.hypot((sh[0] - hp[0]) * wh[0], (sh[1] - hp[1]) * wh[1]) || 1;
    return { t: f.t, wid: Math.hypot(dx, dy) / torso, tilt: Math.abs(Math.atan2(dy, Math.abs(dx) || 1e-6) * 180 / Math.PI) };
  });
}

// The shoulder line's apparent width and tilt per frame over the clip, the roll shaded, the playhead.
function drawPlot() {
  const cv = $('angle-plot');
  if (!cv || $('model-card').hidden) return;
  const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!W) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const s = state.queue[state.cursor], c = s && state.clips[s.id], v = videoEl();
  const dur = v.duration || (c ? c.clip_end - c.clip_start : 1);
  const S = state.body ? shoulderSeries(state.body.frames) : [];
  const X = t => (t / dur) * W;
  if (c) {
    g.fillStyle = 'rgba(127,127,127,.15)';
    g.fillRect(X(c.start_sec - c.clip_start), 0, X(c.end_sec - c.start_sec), H);
  }
  const line = (key, lo, hi, col) => {
    const Y = d => H - 6 - ((Math.min(hi, Math.max(lo, d)) - lo) / (hi - lo)) * (H - 12);
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); let on = false;
    for (const x of S) { if (x[key] == null) { on = false; continue; } on ? g.lineTo(X(x.t), Y(x[key])) : g.moveTo(X(x.t), Y(x[key])); on = true; }
    g.stroke();
  };
  line('wid', 0, 1.6, C_SH);       // width over torso
  line('tilt', 0, 60, C_HIP);      // tilt, deg
  g.font = '10px ui-monospace, Menlo, monospace'; g.fillStyle = C_SH; g.fillText('width', 4, 12); g.fillStyle = C_HIP; g.fillText('tilt', 44, 12);
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(X(v.currentTime), 0); g.lineTo(X(v.currentTime), H); g.stroke();
}

function nextVideo() {
  const s = state.queue[state.cursor];
  if (!s) return;
  const name = state.clips[s.id].video_name;
  const i = state.queue.findIndex((q, j) => j > state.cursor && state.clips[q.id].video_name !== name);
  if (i !== -1) showSlot(i);
}

// ─── panel ───────────────────────────────────────────────────────────────────
function buildButtons() {
  const wrap = $('buttons');
  for (const x of RATINGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rate';
    b.dataset.r = x.r;
    if (x.tone) b.style.setProperty('--tone', x.tone);
    b.innerHTML = `<span class="name">${x.name}</span><kbd>${x.key}</kbd><span class="desc">${x.desc}</span>`;
    b.addEventListener('click', () => { b.blur(); rate(x.r); });
    wrap.appendChild(b);
  }
}

// The question, the hint and the help rows come from PASS, so the HTML never needs editing for a new scale.
function setupPassText() {
  $('question').textContent = PASS.question;
  $('rate-hint').textContent = PASS.hint;
  $('help-ratings').innerHTML = RATINGS.map(x =>
    `<div class="sc-row"><span>${x.name} — ${x.desc}</span><span class="sc-keys"><kbd>${x.key}</kbd></span></div>`).join('');
}

function buildExamples() {
  const grid = $('ex-grid');
  grid.innerHTML = '';
  RATINGS.forEach((x) => {
    const e = state.examples.find(e => e.rating === x.r);
    if (!e) return;
    const f = document.createElement('figure');
    f.style.setProperty('--tone', x.tone || 'var(--cant)');
    f.innerHTML = `<video muted playsinline loop preload="none" data-src="${clipUrl(e.id)}"></video>
      <figcaption><b>${x.name}</b>${x.desc}</figcaption>`;
    grid.appendChild(f);
  });
  if (!grid.children.length) grid.textContent = 'No examples yet.';
}

function openExamples(open) {
  const dlg = $('ex-dialog');
  if (!open) { if (dlg.open) dlg.close(); return; }
  videoEl().pause();
  dlg.showModal();
  // the example clips load only once the sheet is opened
  for (const v of dlg.querySelectorAll('video')) {
    if (!v.getAttribute('src')) v.src = v.dataset.src;
    v.playbackRate = videoEl().playbackRate;
    v.play().catch(() => {});
  }
}

function setupComment() {
  const box = $('comment');
  // Enter finishes the comment (Shift+Enter for a new line) so the rating keys work again.
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); box.blur(); }
    if (e.key === 'Escape') box.blur();
  });
  box.addEventListener('input', () => { if (box.value.trim()) box.classList.remove('need'); });
  const chips = $('reason-chips');
  for (const t of REASONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = t;
    // a reason picked while Can't tell was waiting for one saves it right away
    b.addEventListener('click', () => {
      box.value = box.value.trim() ? `${box.value.trim()}; ${t}` : t;
      box.classList.remove('need');
      b.blur();
      if (state.wantReason) rate('cant_tell');
    });
    chips.appendChild(b);
  }
}

function setupControls() {
  $('btn-prev').onclick = () => showSlot(state.cursor - 1);
  $('btn-next').onclick = () => showSlot(state.admin ? state.cursor + 1 : Math.min(state.cursor + 1, firstUnrated()));
  $('btn-next-video').onclick = nextVideo;
  $('btn-examples').onclick = () => openExamples(true);
  $('ex-close').onclick = () => openExamples(false);
  const dlg = $('ex-dialog');
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    for (const v of dlg.querySelectorAll('video')) v.pause();
    videoEl().play().catch(() => {});
  });
  $('btn-half').onclick = toggleHalf;
}

function setupKeys() {
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ($('ex-dialog').open) {
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); openExamples(false); }
      return;                                   // Escape closes the dialog by itself
    }
    if (t && t.tagName === 'BUTTON') t.blur();
    const r = RATINGS.find(x => x.key === e.key);
    if (r && !state.admin) { e.preventDefault(); rate(r.r); return; }
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft':
        e.preventDefault();
        e.shiftKey ? showSlot(state.cursor - 1) : stepFrames(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        e.shiftKey ? $('btn-next').click() : stepFrames(1);
        break;
      case 's': case 'S': e.preventDefault(); toggleHalf(); break;
      case 'c': case 'C': if (!state.admin) { e.preventDefault(); $('comment').focus(); } break;
      case 'v': case 'V': if (state.admin) { e.preventDefault(); nextVideo(); } break;
      case 'e': case 'E': e.preventDefault(); openExamples(true); break;
    }
  });
}

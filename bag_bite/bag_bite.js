// ============================================================
// bag_bite.js — how well does a punch on the heavy bag snap? (2026-10-24, for
// rule 41 "punches stuck in the bag": its readings did not separate the
// punches Oleksandr marked, so the coach's eye decides what to measure.)
// 200 punches from the bag-work test videos, each once (no repeats); the first
// 100 are the ones of the first survey file, so the two can be compared.
// The scale: snapping / pushing, buttons only (Oleksandr, the same day; the
// first survey was bites / pushing). The only keys: ← → a frame, ⇧← ⇧→ the
// clip before / after.
//
// The question, the hint, the ratings and the Can't tell reasons are the PASS
// block just below — the ONLY place to change them: the page builds its
// buttons, keys and help rows from it, and the Apps Script (doGetBagBite)
// takes any lower_snake rating with the rank sent here.
//
// Page code copied from ../roll_legs/roll_legs.js (the roll eyes / uppercut
// hand-drop page on the steps / punch template), minus the examples sheet,
// plus the skeleton: on the clip (K hides it) and alone in the left panel with
// the facing model's angle as a compass. queue.json is built by
// cornerman-backend ml/research/bag_bite/rating/build.py, which keeps the key
// (which group each punch is from) — nothing on this page says it.
//
// Admin mode — the name `admin`: every clip once, and every rater's rating +
// comment on it.
// ============================================================

const PASS = {
  question: 'Does the punch snap or push?',
  hint: 'Watch the glove on the bag: does it hit and snap straight back, or rest on the bag, push it and drift ' +
        'back? Type a comment first if you want one; one click on a rating saves both and plays the next clip.',
  watch: 'Watch the <b>orange arm</b>',
  // r: what lands in the sheet (lower_snake), rank: rating_rank (a number, '' for none), tone: the button's colour.
  // No rating keys: the buttons only (Oleksandr, 2026-10-24).
  ratings: [
    { r: 'snapping', rank: 1, tone: '#2fa36b', name: 'Snapping',
      desc: 'Hits and snaps straight back, no pause on the bag.' },
    { r: 'pushing',  rank: 0, tone: '#d9473c', name: 'Pushing',
      desc: 'Rests on the bag, pushes it, drifts back.' },
  ],
  reasons: [],
};
const RATINGS = PASS.ratings;
const REASONS = PASS.reasons;
const BUCKET = 'mycorner-bee6a.firebasestorage.app';
const PREFIX = 'labeler_media/bag_bite/v1/';
const TOKEN = '628dbeba-2969-4f45-b65e-5b295ef56fdc';   // the shared labeler_media token
const mediaUrl = (path) => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/`
  + encodeURIComponent(PREFIX + path) + `?alt=media&token=${TOKEN}`;
const clipUrl = (id) => mediaUrl(`clips/${id}.mp4`);
const dataUrl = (id) => mediaUrl(`data/${id}.json`);

const SPEED_KEY = 'bagBiteSpeed';
const SKEL_KEY = 'bagBiteSkeleton';
const OUTBOX_KEY = 'bagBiteOutbox';    // saves the Sheet hasn't confirmed yet, per rater
const ACT = { list: 'listBagBite', save: 'saveBagBite' };

Object.assign(state, {
  clips: {},          // id -> {hand, type, n_frames, fps}
  queue: [],          // [{slot, id, rep}] — in admin mode every clip once
  rateQueue: [],      // the raters' queue, kept while admin re-orders
  ratings: new Map(), // slot -> {rating, comment} (this rater)
  cursor: 0,
  shownAt: 0,
  rater: '',
  admin: false,
  allRows: [],        // admin: every rater's live rows
  data: null,         // the shown clip's skeleton, facing and punches (data/<id>.json)
  skeletonOn: true,
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
  setupPassText();
  try { state.skeletonOn = localStorage.getItem(SKEL_KEY) !== '0'; } catch {}
  showSkeleton(state.skeletonOn);
  window.addEventListener('resize', () => drawOverlay());
  try {
    const q = await fetch('queue.json', { cache: 'no-cache' }).then(r => r.json());
    state.clips = q.clips;
    state.rateQueue = q.queue.map(([id, rep], slot) => ({ slot, id, rep }));
    state.queue = state.rateQueue;
  } catch (e) {
    $('watch').textContent = 'Could not load the clips: ' + e.message;
    return;
  }
  buildGrid();
  await loadRater();
});

// No name to type: every rating is filed under Stafford, unless the link says otherwise (?labeler=admin for the
// admin view, ?labeler=<name> for another rater).
const RATER = (new URLSearchParams(location.search).get('labeler') || '').trim() || 'Stafford';

async function loadRater() {
  const name = RATER;
  state.rater = name;
  state.loaded = !!name;
  state.ratings = new Map();
  state.admin = name.trim().toLowerCase() === 'admin';
  document.body.classList.toggle('re-admin', state.admin);
  $('rate-card').hidden = state.admin;
  $('model-card').hidden = !state.admin;
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
    // one row per clip (no repeats): back to the clip's slot in the queue
    const slotOf = new Map(state.queue.map(s => [s.id, s.slot]));
    for (const row of res.rows) if (slotOf.has(row.clip_id)) state.ratings.set(slotOf.get(row.clip_id), { rating: row.rating });
    syncChip('');
  } catch (e) {
    syncChip('Could not load your earlier ratings — ' + e.message, true);
  }
  for (const o of outbox()) state.ratings.set(Number(o.slot), { rating: o.rating, comment: o.comment });
  flushOutbox();
  showSlot(firstUnrated());
}

async function loadAdmin() {
  const ids = [...new Set(state.rateQueue.map(s => s.id))].sort();
  state.queue = ids.map((id, i) => ({ slot: i, id, rep: 0 }));
  syncChip('Loading the ratings…');
  try {
    state.allRows = (await call({ action: ACT.list })).rows;
    syncChip('');
  } catch (e) {
    syncChip('Could not load the ratings — ' + e.message, true);
  }
  showSlot(0);
}

function firstUnrated() {
  const i = state.queue.findIndex(s => !state.ratings.has(s.slot));
  return i === -1 ? state.queue.length : i;
}

// ─── the Apps Script ──────────────────────────────────────────────────────────
async function call(params) {
  const res = await fetch(sheetUrl({ ...params, labeler: state.rater }));
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
        const { slot, ts_local, ...params } = item;
        await call(params);
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
  // the sheet keeps clip_id | hand | punch_type | rating | rater (the rater is added by call());
  // slot / ts_local only key the outbox
  list.push({ action: ACT.save, slot: s.slot, clip_id: s.id, hand: c.hand, punch_type: c.type, rating, ts_local: Date.now() });
  setOutbox(list);
  syncChip('Saving…');
  flushOutbox();
  showSlot(state.cursor + 1);
}

// ─── showing a clip ─────────────────────────────────────────────────────────
const TYPE_NAME = { jab: 'jab', cross: 'cross', hook: 'hook', uppercut: 'uppercut', hook_or_uppercut: 'body shot' };
const typeName = (t) => TYPE_NAME[t] || String(t).replace(/_/g, ' ');

function showSlot(i) {
  state.cursor = Math.max(0, Math.min(i, state.queue.length));
  const total = state.queue.length;
  if (state.admin) {
    $('progress').textContent = total ? `punch ${(state.cursor + 1).toLocaleString()} of ${total.toLocaleString()}` : '';
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
    state.data = null;
    $('watch').textContent = '—'; $('clip-n').textContent = '';
    renderTimelineOverlay(); drawOverlay(); drawSkeletonCard(); paintGrid();
    return;
  }
  const s = state.queue[state.cursor];
  const c = state.clips[s.id];
  if (v.dataset.id !== s.id) {
    v.dataset.id = s.id;
    $('clip-loading').hidden = false;
    $('clip-loading').textContent = 'Loading…';
    v.src = clipUrl(s.id);
    loadData(s.id);
  } else {
    v.currentTime = 0;
  }
  v.play().catch(() => {});
  $('watch').innerHTML = `${PASS.watch} · ${c.hand} ${typeName(c.type)}` + (state.admin ? ` · ${s.id}` : '');
  $('clip-n').textContent = `#${(state.cursor + 1).toLocaleString()}`;
  const mine = state.ratings.get(s.slot);
  for (const b of document.querySelectorAll('.rate')) b.classList.toggle('chosen', b.dataset.r === mine?.rating);
  $('comment').value = mine?.comment || '';
  $('comment').classList.remove('need');
  $('comment').placeholder = 'Anything worth noting about this punch';
  $('reasons').hidden = mine?.rating !== 'cant_tell';
  state.wantReason = false;
  state.shownAt = performance.now();
  renderTimelineOverlay();
  if (state.admin) showRaters(s.id);
  prefetch(state.cursor);
  paintGrid();
}

const dataCache = new Map();   // id -> Promise of data/<id>.json
function fetchData(id) {
  if (!dataCache.has(id)) {
    const p = fetch(dataUrl(id)).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)));
    p.catch(() => dataCache.delete(id));
    dataCache.set(id, p);
  }
  return dataCache.get(id);
}

async function loadData(id) {
  state.data = null;
  try {
    const d = await fetchData(id);
    if (state.queue[state.cursor]?.id === id) { state.data = d; renderTimelineOverlay(); }
  } catch (e) {
    if (state.queue[state.cursor]?.id === id) showToast('The skeleton failed to load — ' + e.message, 'error');
  }
}

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

const prefetched = new Set();
function prefetch(i) {
  for (let k = i + 1; k <= i + 4 && k < state.queue.length; k++) {
    const id = state.queue[k].id;
    fetchData(id).catch(() => {});
    if (prefetched.has(id)) continue;
    prefetched.add(id);
    fetch(clipUrl(id)).catch(() => prefetched.delete(id));
  }
}

// ─── the player ──────────────────────────────────────────────────────────────
// player.js's setupVideoLoader() only wires these when the page has a file
// picker; this page has none, so they are wired here (as roll_legs.js does).
function setupVideo() {
  const v = videoEl();
  v.addEventListener('loadedmetadata', () => {
    const c = state.clips[v.dataset.id];
    state.frameDuration = c ? 1 / c.fps : 1 / 30;   // the clip's own frame rate, from the queue
    state.fpsDetected = !!c;
    setSpeed(savedSpeed());   // through setSpeed, so ui.js repaints the speed menu
    state.zoomLevel = 1; state.zoomCenter = 0.5;
    onZoomChanged();
  });
  v.addEventListener('loadeddata', () => { $('clip-loading').hidden = true; renderTimelineOverlay(); });
  v.addEventListener('error', () => {
    if (!v.getAttribute('src')) return;
    $('clip-loading').hidden = false;
    $('clip-loading').textContent = 'The clip failed to load — check the connection and reload the page';
  });
  v.addEventListener('timeupdate', () => updateTimeDisplay());
  v.addEventListener('seeked', _onSeeked);
  // timeupdate fires ~4x a second, coarse against a one-second punch: move the
  // playhead and the skeletons every frame.
  let lastK = null;
  const tick = () => {
    if (!v.paused) updateTimeDisplay();
    const k = frameIndex();
    const key = `${v.dataset.id}|${k}|${state.data ? 1 : 0}`;
    if (key !== lastK) { lastK = key; drawOverlay(); drawSkeletonCard(); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function savedSpeed() {
  try { return Number(localStorage.getItem(SPEED_KEY)) || 0.5; } catch { return 0.5; }
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

// The clip frame on screen: clip time × the clip's frame rate.
function frameIndex() {
  const d = state.data, v = videoEl();
  if (!d) return null;
  return Math.min(d.xy.length - 1, Math.max(0, Math.floor(v.currentTime * d.fps + 1e-3)));
}

// Two lanes: every punch on the clip, lead hand on top, rear below; the punch
// rated in orange. Clip time of a source frame = (frame − first) / (fps × step).
function renderTimelineOverlay() {
  const v = videoEl(), lanes = $('seg-lanes');
  if (!v || !lanes) return;
  lanes.querySelectorAll('.seg-lane').forEach(n => n.remove());
  const mini = $('minimap-segments');
  if (mini) mini.innerHTML = '';
  const duration = v.duration || 0;
  const d = state.data;
  const lane = {};
  for (const h of ['lead', 'rear']) {
    lane[h] = document.createElement('div');
    lane[h].className = 'seg-lane lane-punch';
    lane[h].innerHTML = `<span class="bb-hand">${h}</span>`;
    lanes.insertBefore(lane[h], $('playhead'));
  }
  if (!duration || !d) return;
  const T = (f) => (f - d.first) / (d.fps * d.step);
  for (const p of d.around) {
    const a = Math.max(0, T(p.s)), b = Math.min(duration, T(p.e + 1));
    if (b <= a) continue;
    const l = timeToViewportPct(a, duration), r = timeToViewportPct(b, duration);
    const el = document.createElement('div');
    el.className = 'bb-band' + (p.me ? ' me' : '');
    el.style.left = Math.max(0, l) + '%';
    el.style.width = Math.max(0, Math.min(100, r) - Math.max(0, l)) + '%';
    el.textContent = typeName(p.t);
    el.title = `${p.h} ${typeName(p.t)}${p.me ? ' — the punch to rate' : ''}`;
    (lane[p.h] || lane.lead).appendChild(el);
    if (mini) {
      const m = document.createElement('div');
      m.className = 'bb-band' + (p.me ? ' me' : '');
      m.style.left = (100 * a / duration) + '%'; m.style.width = (100 * (b - a) / duration) + '%';
      mini.appendChild(m);
    }
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

// ─── the skeleton: on the clip and alone ────────────────────────────────────
// BlazePose-33 bones (the arms to the index knuckle, the feet heel → toe); the
// punching arm is orange while it punches. xy is in the clip's square, 0..1000;
// a joint at −10000 was not found.
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [0, 11], [0, 12], [15, 19], [16, 20]];
const ARM = { lead: new Set(['11-13', '13-15', '15-19']), rear: new Set(['12-14', '14-16', '16-20']) };
const C_HOT = '#ff9f0a';

function drawBones(g, k, P, onVideo) {
  const d = state.data, xy = d.xy[k], vis = d.vis[k], arm = ARM[d.hand] || new Set();
  const f = d.first + k * d.step, inPunch = f >= d.start && f <= d.end;
  g.lineCap = 'round';
  for (const [a, b] of BONES) {
    if (xy[a][0] < -900 || xy[b][0] < -900) continue;
    const hot = inPunch && arm.has(`${a}-${b}`);
    const [x0, y0] = P(xy[a]), [x1, y1] = P(xy[b]);
    g.globalAlpha = Math.min(vis[a], vis[b]) < 50 ? 0.35 : 1;
    if (onVideo) {
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
      g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = hot ? 7 : 4.5; g.stroke();
    }
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
    g.strokeStyle = hot ? C_HOT : onVideo ? 'rgba(80,220,255,0.95)' : 'rgba(255,255,255,0.85)';
    g.lineWidth = hot ? (onVideo ? 4.5 : 6) : (onVideo ? 2.5 : 4);
    g.stroke();
  }
  g.globalAlpha = 1;
  return { f, inPunch };
}

function phaseLabel(g, f, x, y, px) {
  const d = state.data, inPunch = f >= d.start && f <= d.end;
  g.font = `600 ${px}px -apple-system, "Segoe UI", sans-serif`;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = inPunch ? C_HOT : '#d1d1d6';
  g.fillText(inPunch ? 'the punch' : f < d.start ? 'before' : 'after', x, y);
}

// The canvas sits on the video's on-screen box (zoom transform included); the
// clip is square, letterboxed inside that box as object-fit: contain does.
function drawOverlay() {
  const cv = $('face-canvas'), v = videoEl();
  if (!cv || cv.hidden) return;
  const vp = $('video-viewport').getBoundingClientRect(), r = v.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.style.left = (r.left - vp.left) + 'px'; cv.style.top = (r.top - vp.top) + 'px';
  cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  if (cv.width !== Math.round(r.width * dpr)) cv.width = Math.round(r.width * dpr);
  if (cv.height !== Math.round(r.height * dpr)) cv.height = Math.round(r.height * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, r.width, r.height);
  const k = frameIndex();
  if (k == null || !v.videoWidth) return;
  const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
  const w = v.videoWidth * s, h = v.videoHeight * s, ox = (r.width - w) / 2, oy = (r.height - h) / 2;
  drawBones(g, k, (p) => [ox + p[0] / 1000 * w, oy + p[1] / 1000 * h], true);
}

function drawSkeletonCard() {
  const cv = $('skel-canvas');
  if (!cv) return;
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#111'; g.fillRect(0, 0, 560, 560);
  const k = frameIndex();
  if (k == null) return;
  const { f } = drawBones(g, k, (p) => [p[0] * 0.56, p[1] * 0.56], false);
  phaseLabel(g, f, 18, 42, 30);
  compass(g, state.data.facing[k]);
}

// The facing model's angle seen from above, camera at the bottom: orange when
// side-on (|angle| within 25° of 90), blue facing the camera or away, grey between.
function compass(g, a) {
  const cx = 478, cy = 84, R = 58;
  g.save();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(cx - 14, cy + R + 8, 28, 14);
  g.font = '600 26px -apple-system, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#d1d1d6';
  if (a == null) { g.fillText('no angle', cx, cy + 8); g.restore(); return; }
  const r = a * Math.PI / 180, dx = Math.sin(r), dy = Math.cos(r);
  const side = Math.abs(Math.abs(a) - 90) <= 25, front = Math.abs(a) <= 25 || Math.abs(a) >= 155;
  g.strokeStyle = g.fillStyle = side ? C_HOT : front ? '#0a84ff' : '#d1d1d6';
  g.lineWidth = 7; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + dx * (R - 8), cy + dy * (R - 8)); g.stroke();
  g.beginPath(); g.arc(cx + dx * (R - 6), cy + dy * (R - 6), 9, 0, 7); g.fill();
  g.fillStyle = '#d1d1d6'; g.fillText(`${Math.round(a)}°`, cx, cy + R + 50);
  g.restore();
}

function showSkeleton(on) {
  state.skeletonOn = on;
  $('face-canvas').hidden = !on;
  $('btn-skel').classList.toggle('on', on);
  try { localStorage.setItem(SKEL_KEY, on ? '1' : '0'); } catch {}
  drawOverlay();
}

// ─── admin: every rater's answers ───────────────────────────────────────────
const RATING_NAME = Object.fromEntries(RATINGS.map(x => [x.r, x.name]));
function showRaters(id) {
  const rows = state.allRows.filter(r => r.clip_id === id);
  $('rater-rows').innerHTML = rows.length
    ? rows.map(r => `<div class="rr"><b>${esc(r.rater)}</b> · <span>${RATING_NAME[r.rating] || esc(r.rating)}</span>${r.comment ? ` — ${esc(r.comment)}` : ''}</div>`).join('')
    : 'Not rated yet.';
}

// ─── the progress grid: one square per clip, like GitHub's contribution graph ───
// Grey = not rated, green = snapping, red = pushing, outlined = the clip on screen; click a square (or type a
// number in Go to) to jump there.
function buildGrid() {
  const g = $('grid');
  g.innerHTML = '';
  state.queue.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell';
    b.title = `#${i + 1}`;
    b.addEventListener('click', () => { b.blur(); showSlot(i); });
    g.appendChild(b);
  });
  const go = $('goto');
  if (go.dataset.wired) return;
  go.dataset.wired = '1';
  go.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const n = parseInt(go.value, 10);
    if (n >= 1 && n <= state.queue.length) showSlot(n - 1);
    go.value = '';
    go.blur();
  });
}

function paintGrid() {
  const g = $('grid');
  if (!g) return;
  if (g.children.length !== state.queue.length) buildGrid();
  state.queue.forEach((s, i) => {
    const c = g.children[i];
    const r = state.admin ? null : state.ratings.get(s.slot)?.rating;
    c.className = 'cell' + (r ? ' r-' + r : '') + (i === state.cursor ? ' now' : '');
  });
  const done = state.admin ? 0 : state.queue.filter(s => state.ratings.has(s.slot)).length;
  $('grid-count').textContent = state.admin
    ? `#${Math.min(state.cursor + 1, state.queue.length)} of ${state.queue.length}`
    : `#${Math.min(state.cursor + 1, state.queue.length)} · ${done} of ${state.queue.length} rated`;
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
    b.innerHTML = `<span class="name">${x.name}</span>${x.key ? `<kbd>${x.key}</kbd>` : ''}<span class="desc">${x.desc}</span>`;
    b.addEventListener('click', () => { b.blur(); rate(x.r); });
    wrap.appendChild(b);
  }
}

// The question, the hint and the help rows come from PASS, so the HTML never needs editing for a new scale.
function setupPassText() {
  $('question').textContent = PASS.question;
  $('rate-hint').textContent = PASS.hint;
  $('help-ratings').innerHTML = RATINGS.map(x =>
    `<div class="sc-row"><span>${x.name} — ${x.desc}</span><span class="sc-keys">the button</span></div>`).join('');
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
  $('btn-next').onclick = () => showSlot(state.cursor + 1);
  $('btn-skel').onclick = () => { $('btn-skel').blur(); showSkeleton(!state.skeletonOn); };
  $('btn-half').onclick = toggleHalf;
}

// The only keys: a frame back / ahead (← →) and the clip before / after (⇧← ⇧→). Rating is by the buttons.
function setupKeys() {
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.shiftKey ? showSlot(state.cursor - 1) : stepFrames(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.shiftKey ? $('btn-next').click() : stepFrames(1);
    }
  });
}

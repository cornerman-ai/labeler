// ============================================================
// uppercut_drop.js — the coach rates how far the punching hand drops before
// each uppercut. One looping clip per labeled uppercut (0.5 s before the
// punch → just after it lands), one tap, next clip.
//
// The steps / punch labelers' template: shared/player.js drives the player,
// the seek bar, frame stepping and the timeline zoom; shared/ui.js (loaded
// last) the transport icons, the speed menu, the picture zoom, the time field,
// the name field and the shortcuts sheet. This file adds the clip queue, the
// punch lane and the ratings.
//
// queue.json (built by cornerman-backend
// ml/research/hand_drop/uppercut_rating/build.py — never edited) holds the
// clips and their fixed order, the same for every rater: ~10% of slots are a
// blind repeat (rep=1) of a clip seen 40–120 slots earlier, for the rater's
// self-consistency. A second rater types their own name and gets the same
// order, so both overlap on every clip both reached. A row is keyed by
// (rater, slot), never by clip — a repeat is its own row.
// examples.json: one example clip per rating, shown under Examples and kept
// out of the queue.
//
// Clips live on Firebase Storage (labeler_media/uppercut_drop/v1/clips/),
// rows in the "Uppercut hand drop" workbook via doGetUppercutDrop.
// ============================================================

const RATINGS = [
  { r: 'great',     key: '1', name: 'Great',     desc: 'Fires straight from guard, no visible drop.' },
  { r: 'good',      key: '2', name: 'Good',      desc: 'A small dip you wouldn’t correct.' },
  { r: 'bad',       key: '3', name: 'Bad',       desc: 'A clear drop you would mention.' },
  { r: 'very_bad',  key: '4', name: 'Very bad',  desc: 'The hand winds down toward the waist and telegraphs the punch.' },
  { r: 'cant_tell', key: '0', name: 'Can’t tell', desc: 'Hand hidden, bad angle, or not really an uppercut.' },
];
const BUCKET = 'mycorner-bee6a.firebasestorage.app';
const PREFIX = 'labeler_media/uppercut_drop/v1/clips/';
const TOKEN = '628dbeba-2969-4f45-b65e-5b295ef56fdc';   // the shared labeler_media token
const clipUrl = (id) => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/`
  + encodeURIComponent(PREFIX + id + '.mp4') + `?alt=media&token=${TOKEN}`;

const SPEED_KEY = 'uppercutDropSpeed';
const OUTBOX_KEY = 'uppercutDropOutbox';   // saves the Sheet hasn't confirmed yet, per rater

Object.assign(state, {
  clips: {},          // id -> clip facts
  queue: [],          // [{slot, id, rep}]
  examples: [],
  ratings: new Map(), // slot -> rating (this rater)
  cursor: 0,
  shownAt: 0,
  rater: '',
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
  setupControls();
  setupKeys();
  try {
    const [q, ex] = await Promise.all([
      fetch('queue.json', { cache: 'no-cache' }).then(r => r.json()),
      fetch('examples.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { examples: [] }).catch(() => ({ examples: [] })),
    ]);
    state.clips = q.clips;
    state.examples = ex.examples || [];
    const exIds = new Set(state.examples.map(e => e.id));
    state.queue = q.queue.map(([id, rep], slot) => ({ slot, id, rep })).filter(s => !exIds.has(s.id));
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
  if (!name) {
    showSlot(0);
    $('progress').textContent = 'Type your name at the top right to start.';
    return;
  }
  syncChip('Loading your ratings…');
  try {
    const res = await call({ action: 'listUppercutDrop' });
    for (const row of res.rows) state.ratings.set(row.slot, row.rating);
    syncChip('');
  } catch (e) {
    syncChip('Could not load your earlier ratings — ' + e.message, true);
  }
  for (const o of outbox()) state.ratings.set(Number(o.slot), o.rating);
  flushOutbox();
  showSlot(firstUnrated());
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
  // doGet answers unknown actions with a success shape; `ud` says this handler ran.
  if (!body.ud) throw new Error('the Apps Script is an older deployment');
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
  if (!state.rater) { showToast('Type your name at the top right first', 'error'); $('labeler-input').focus(); return; }
  const s = state.queue[state.cursor];
  if (!s) return;
  const c = state.clips[s.id];
  const btn = document.querySelector(`.rate[data-r="${rating}"]`);
  if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 120); }
  state.ratings.set(s.slot, rating);
  const dwell = Math.min(120, (performance.now() - state.shownAt) / 1000);
  // One pending save per slot: a re-rate before the first save went out replaces it.
  const list = outbox().filter(o => Number(o.slot) !== s.slot);
  list.push({
    action: 'saveUppercutDrop', slot: s.slot, rep: s.rep, rating,
    clip_id: s.id, punch_uuid: s.id, video_id: driveId(c.video_file), video_name: c.video_name,
    punch_type: c.punch_type, hand: c.hand, side: c.side, target: c.target, stance: c.stance,
    punch_sec: c.start_sec, impact_sec: c.impact_sec, impact_known: c.impact_known,
    clip_start: c.clip_start, clip_end: c.clip_end,
    speed: videoEl().playbackRate, dwell_sec: dwell.toFixed(1), ts_local: Date.now(),
  });
  setOutbox(list);
  syncChip('Saving…');
  flushOutbox();
  showSlot(Math.min(state.cursor + 1, firstUnrated()));
}

function driveId(url) {
  const m = String(url || '').match(/\/d\/([\w-]+)/);
  return m ? m[1] : String(url || '');
}

// ─── showing a clip ─────────────────────────────────────────────────────────
function showSlot(i) {
  state.cursor = Math.max(0, Math.min(i, state.queue.length));
  const done = state.ratings.size, total = state.queue.length;
  $('progress').textContent = state.rater ? `${done.toLocaleString()} of ${total.toLocaleString()} rated` : '';
  $('progress-fill').style.width = total ? (100 * done / total) + '%' : '0';
  const finished = state.cursor >= total;
  $('done').hidden = !finished;
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
  $('watch').innerHTML = `Watch the <b>${c.side} hand</b> · ${c.hand} ${c.target === 'body' ? 'body ' : ''}uppercut`;
  $('clip-n').textContent = `#${(state.cursor + 1).toLocaleString()}`;
  const mine = state.ratings.get(s.slot);
  for (const b of document.querySelectorAll('.rate')) b.classList.toggle('chosen', b.dataset.r === mine);
  state.shownAt = performance.now();
  renderTimelineOverlay();
  prefetch(state.cursor);
}

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
// picker; this page has none, so they are wired here (as bodyshot.js does).
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
  // playhead every frame while playing.
  const tick = () => { if (!v.paused) updateTimeDisplay(); requestAnimationFrame(tick); };
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

// The punch lane: the half second before the punch (where the drop happens),
// the punch up to impact, and the impact itself. Clip time = source time − clip_start.
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
  lane.className = 'seg-lane lane-punch';
  lanes.insertBefore(lane, $('playhead'));
  if (!duration || !c) return;
  const t0 = Math.max(0, c.start_sec - c.clip_start), t1 = Math.min(duration, c.impact_sec - c.clip_start);
  const band = (cls, a, b, label, title) => {
    const l = timeToViewportPct(a, duration), r = timeToViewportPct(b, duration);
    const el = document.createElement('div');
    el.className = 'ud-band ' + cls;
    el.style.left = Math.max(0, l) + '%';
    el.style.width = Math.max(0, Math.min(100, r) - Math.max(0, l)) + '%';
    el.textContent = label; el.title = title;
    lane.appendChild(el);
    if (mini) {
      const m = document.createElement('div');
      m.className = 'ud-band ' + cls;
      m.style.left = (100 * a / duration) + '%'; m.style.width = (100 * (b - a) / duration) + '%';
      mini.appendChild(m);
    }
  };
  band('before', 0, t0, 'before', 'the half second before the punch — where the drop happens');
  band('punch', t0, t1, 'punch', c.impact_known ? 'the punch, up to impact' : 'the punch, up to its estimated impact');
  const imp = document.createElement('div');
  imp.className = 'ud-impact';
  imp.style.left = timeToViewportPct(t1, duration) + '%';
  imp.title = c.impact_known ? 'impact' : 'impact (estimated: start + 0.30 s)';
  lane.appendChild(imp);
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

// ─── panel and sheets ────────────────────────────────────────────────────────
function buildButtons() {
  const wrap = $('buttons');
  for (const x of RATINGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rate';
    b.dataset.r = x.r;
    b.innerHTML = `<span class="name">${x.name}</span><kbd>${x.key}</kbd><span class="desc">${x.desc}</span>`;
    b.addEventListener('click', () => { b.blur(); rate(x.r); });
    wrap.appendChild(b);
  }
}

function buildExamples() {
  const grid = $('ex-grid');
  grid.innerHTML = '';
  const tone = { great: 'great', good: 'good', bad: 'bad', very_bad: 'very-bad', cant_tell: 'cant' };
  for (const x of RATINGS) {
    const e = state.examples.find(e => e.rating === x.r);
    if (!e) continue;
    const c = state.clips[e.id] || {};
    const f = document.createElement('figure');
    f.style.setProperty('--tone', `var(--${tone[x.r]})`);
    f.innerHTML = `<video muted playsinline loop preload="none" data-src="${clipUrl(e.id)}"></video>
      <figcaption><b>${x.name}</b>${x.desc}${c.side ? `<br>Watch the ${c.side} hand · ${c.hand} uppercut` : ''}</figcaption>`;
    grid.appendChild(f);
  }
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

function setupControls() {
  $('btn-examples').onclick = () => openExamples(true);
  $('ex-close').onclick = () => openExamples(false);
  const dlg = $('ex-dialog');
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    for (const v of dlg.querySelectorAll('video')) v.pause();
    videoEl().play().catch(() => {});
  });
  $('btn-prev').onclick = () => showSlot(state.cursor - 1);
  $('btn-next').onclick = () => showSlot(Math.min(state.cursor + 1, firstUnrated()));
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
    if (r) { e.preventDefault(); rate(r.r); return; }
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft':
        e.preventDefault();
        e.shiftKey ? showSlot(state.cursor - 1) : stepFrames(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        e.shiftKey ? showSlot(Math.min(state.cursor + 1, firstUnrated())) : stepFrames(1);
        break;
      case 's': case 'S': e.preventDefault(); toggleHalf(); break;
      case 'e': case 'E': e.preventDefault(); openExamples(true); break;
    }
  });
}

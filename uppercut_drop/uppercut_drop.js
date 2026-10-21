// ============================================================
// uppercut_drop.js — the coach rates how far the punching hand drops before
// each uppercut. One looping clip per labeled uppercut (0.5 s before the
// punch → just after it lands), one tap, next clip.
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
// Uses player.js for sheetUrl() / the Apps Script URL and labeler_name.js for
// the rater's name.
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

const ud = {
  clips: {},          // id -> clip facts
  queue: [],          // [{slot, id, rep}]
  examples: [],
  ratings: new Map(), // slot -> rating (this rater)
  cursor: 0,
  shownAt: 0,
  rater: '',
};

const $ = (id) => document.getElementById(id);
const video = () => $('clip');

function toast(msg, err) {
  const t = $('toast');
  t.textContent = msg;
  t.className = err ? 'err' : '';
  t.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.style.display = 'none'; }, 2600);
}

function saveState(text, err) {
  const el = $('save-state');
  el.textContent = text;
  el.classList.toggle('err', !!err);
}

// ─── load ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  buildButtons();
  wireControls();
  try {
    const [q, ex] = await Promise.all([
      fetch('queue.json', { cache: 'no-cache' }).then(r => r.json()),
      fetch('examples.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { examples: [] }).catch(() => ({ examples: [] })),
    ]);
    ud.clips = q.clips;
    ud.examples = ex.examples || [];
    const exIds = new Set(ud.examples.map(e => e.id));
    ud.queue = q.queue.map(([id, rep], slot) => ({ slot, id, rep })).filter(s => !exIds.has(s.id));
  } catch (e) {
    $('progress').textContent = 'Could not load the clips: ' + e.message;
    return;
  }
  buildExamples();
  // labeler_name.js keeps this hidden input in sync with the name bar.
  $('labeler-input').addEventListener('change', () => loadRater());
  await loadRater();
});

async function loadRater() {
  const name = (window.CMLabeler && window.CMLabeler.get()) || '';
  if (name === ud.rater && ud.loaded) return;
  ud.rater = name;
  ud.loaded = !!name;
  ud.ratings = new Map();
  if (!name) {
    $('progress').textContent = 'Type your name at the top to start';
    showSlot(0);
    return;
  }
  saveState('loading your ratings…');
  try {
    const res = await call({ action: 'listUppercutDrop' });
    for (const row of res.rows) ud.ratings.set(row.slot, row.rating);
    saveState('');
  } catch (e) {
    saveState('could not load your earlier ratings — ' + e.message, true);
  }
  for (const o of outbox()) ud.ratings.set(Number(o.slot), o.rating);
  flushOutbox();
  showSlot(firstUnrated());
}

function firstUnrated() {
  const i = ud.queue.findIndex(s => !ud.ratings.has(s.slot));
  return i === -1 ? ud.queue.length : i;
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
  try { return (JSON.parse(localStorage.getItem(OUTBOX_KEY) || '{}')[ud.rater]) || []; } catch { return []; }
}
function setOutbox(list) {
  try {
    const all = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '{}');
    all[ud.rater] = list;
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
        saveState(`${list.length} not saved yet — retrying (${e.message})`, true);
        setTimeout(() => { flushing = false; flushOutbox(); }, 5000);
        return;
      }
      list = outbox().filter(o => !(o.slot === item.slot && o.ts_local === item.ts_local));
      setOutbox(list);
    }
    saveState('all saved');
  } finally {
    flushing = false;
  }
}

// ─── rating ─────────────────────────────────────────────────────────────────
function rate(rating) {
  if (!ud.rater) { toast('Type your name at the top first', true); return; }
  const s = ud.queue[ud.cursor];
  if (!s) return;
  const c = ud.clips[s.id];
  const btn = document.querySelector(`.rate[data-r="${rating}"]`);
  if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 120); }
  ud.ratings.set(s.slot, rating);
  const dwell = Math.min(120, (performance.now() - ud.shownAt) / 1000);
  // One pending save per slot: a re-rate before the first save went out replaces it.
  const list = outbox().filter(o => Number(o.slot) !== s.slot);
  list.push({
    action: 'saveUppercutDrop', slot: s.slot, rep: s.rep, rating,
    clip_id: s.id, punch_uuid: s.id, video_id: driveId(c.video_file), video_name: c.video_name,
    punch_type: c.punch_type, hand: c.hand, side: c.side, target: c.target, stance: c.stance,
    punch_sec: c.start_sec, impact_sec: c.impact_sec, impact_known: c.impact_known,
    clip_start: c.clip_start, clip_end: c.clip_end,
    speed: video().playbackRate, dwell_sec: dwell.toFixed(1), ts_local: Date.now(),
  });
  setOutbox(list);
  saveState('saving…');
  flushOutbox();
  showSlot(ud.cursor + 1 <= firstUnrated() ? ud.cursor + 1 : firstUnrated());
}

function driveId(url) {
  const m = String(url || '').match(/\/d\/([\w-]+)/);
  return m ? m[1] : String(url || '');
}

// ─── showing a clip ─────────────────────────────────────────────────────────
function showSlot(i) {
  ud.cursor = Math.max(0, Math.min(i, ud.queue.length));
  const done = ud.ratings.size;
  const total = ud.queue.length;
  if (ud.rater) $('progress').textContent = `${done.toLocaleString()} of ${total.toLocaleString()} rated`;
  const finished = ud.cursor >= total;
  $('done').style.display = finished ? 'block' : 'none';
  $('buttons').style.display = finished ? 'none' : '';
  if (finished) { video().removeAttribute('src'); $('watch').textContent = '—'; return; }

  const s = ud.queue[ud.cursor];
  const c = ud.clips[s.id];
  const v = video();
  if (v.dataset.id !== s.id) {
    v.dataset.id = s.id;
    $('loading').textContent = 'loading…';
    v.src = clipUrl(s.id);
  } else {
    v.currentTime = 0;
  }
  v.playbackRate = speed();
  v.play().catch(() => {});
  setPaused(false);
  $('watch').innerHTML = `Watch the <b>${c.side} hand</b> · ${c.hand} ${c.target === 'body' ? 'body ' : ''}uppercut`;
  $('slot-label').textContent = `#${(ud.cursor + 1).toLocaleString()}`;
  const mine = ud.ratings.get(s.slot);
  for (const b of document.querySelectorAll('.rate')) b.classList.toggle('chosen', b.dataset.r === mine);
  ud.shownAt = performance.now();
  prefetch(ud.cursor);
}

const prefetched = new Set();
function prefetch(i) {
  for (let k = i + 1; k <= i + 4 && k < ud.queue.length; k++) {
    const id = ud.queue[k].id;
    if (prefetched.has(id)) continue;
    prefetched.add(id);
    fetch(clipUrl(id)).catch(() => prefetched.delete(id));
  }
}

function speed() {
  try { return Number(localStorage.getItem(SPEED_KEY)) || 1; } catch { return 1; }
}
function setSpeed(x) {
  try { localStorage.setItem(SPEED_KEY, String(x)); } catch {}
  video().playbackRate = x;
  for (const b of document.querySelectorAll('.speed')) b.classList.toggle('on', Number(b.dataset.speed) === x);
}

function setPaused(p) {
  const v = video();
  if (p) v.pause(); else v.play().catch(() => {});
  $('stage').classList.toggle('is-paused', p);
  $('btn-pause').textContent = p ? 'Play' : 'Pause';
}
const togglePause = () => setPaused(!video().paused);

// ─── UI ─────────────────────────────────────────────────────────────────────
function buildButtons() {
  const wrap = $('buttons');
  for (const x of RATINGS) {
    const b = document.createElement('button');
    b.className = 'rate';
    b.dataset.r = x.r;
    b.innerHTML = `<span class="key">${x.key}</span><span class="name">${x.name}</span><span class="desc">${x.desc}</span>`;
    b.addEventListener('click', () => rate(x.r));
    wrap.appendChild(b);
  }
}

function buildExamples() {
  const grid = $('ex-grid');
  grid.innerHTML = '';
  for (const x of RATINGS) {
    const e = ud.examples.find(e => e.rating === x.r);
    if (!e) continue;
    const c = ud.clips[e.id] || e.clip || {};
    const f = document.createElement('figure');
    f.innerHTML = `<video muted playsinline loop preload="none" data-src="${clipUrl(e.id)}"></video>
      <figcaption><b>${x.name}</b>${x.desc}<div class="watch">${c.side ? `Watch the ${c.side} hand · ${c.hand} uppercut` : ''}</div></figcaption>`;
    grid.appendChild(f);
  }
  if (!grid.children.length) grid.textContent = 'No examples yet.';
}

function openExamples(open) {
  $('ex').classList.toggle('open', open);
  for (const v of $('ex').querySelectorAll('video')) {
    if (open) {
      if (!v.src) v.src = v.dataset.src;
      v.playbackRate = speed();
      v.play().catch(() => {});
    } else v.pause();
  }
  if (open) video().pause(); else setPaused(false);
}

function wireControls() {
  $('btn-examples').onclick = () => openExamples(true);
  $('ex-close').onclick = () => openExamples(false);
  $('btn-pause').onclick = togglePause;
  $('stage').onclick = togglePause;
  $('btn-prev').onclick = () => showSlot(ud.cursor - 1);
  $('btn-next').onclick = () => showSlot(Math.min(ud.cursor + 1, firstUnrated()));
  for (const b of document.querySelectorAll('.speed')) b.onclick = () => setSpeed(Number(b.dataset.speed));
  setSpeed(speed());
  const v = video();
  v.addEventListener('loadeddata', () => { $('loading').textContent = ''; v.playbackRate = speed(); });
  v.addEventListener('error', () => { $('loading').textContent = 'clip failed to load — check the connection and reload the page'; });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.tagName === 'BUTTON') e.target.blur();
    if ($('ex').classList.contains('open')) {
      if (e.key === 'Escape' || e.key === 'e' || e.key === 'E') { e.preventDefault(); openExamples(false); }
      return;
    }
    const r = RATINGS.find(x => x.key === e.key);
    if (r) { e.preventDefault(); rate(r.r); return; }
    switch (e.key) {
      case ' ': e.preventDefault(); togglePause(); break;
      case 'ArrowLeft': case 'Backspace': e.preventDefault(); showSlot(ud.cursor - 1); break;
      case 'ArrowRight': e.preventDefault(); showSlot(Math.min(ud.cursor + 1, firstUnrated())); break;
      case 's': case 'S': e.preventDefault(); setSpeed(speed() === 1 ? 0.5 : 1); break;
      case 'e': case 'E': e.preventDefault(); openExamples(true); break;
    }
  });
}

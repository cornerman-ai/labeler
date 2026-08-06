/* Coaching review — watch-only page.
 *
 * Reads coach_review.json (10 Drive videos + per-video coach comments) and
 * renders: video list (left) | Drive player (center) | coaches > comment
 * titles > details (right). No saving, no Apps Script — pure reader.
 *
 * Adding a coach = append to `coaches` in coach_review.json with a
 * `comments` map keyed by video number.
 */

let DATA = null;
let currentVideo = null;

const $ = (id) => document.getElementById(id);

function setStatus(msg, cls) {
  const el = $('cr-status');
  el.textContent = msg;
  el.style.color = cls === 'err' ? '#e85a5a' : '#888';
}

/* ---------- left rail ---------- */

function renderVideoList() {
  const host = $('cr-video-list');
  host.innerHTML = '';
  DATA.videos.forEach((v) => {
    const n = coachesFor(v.n).reduce((a, c) => a + c.items.length, 0);
    const btn = document.createElement('button');
    btn.className = 'cr-vid';
    btn.dataset.n = v.n;
    btn.innerHTML =
      `<span class="cr-vid-n">Video ${v.n}:</span> ${esc(v.title)}` +
      `<span class="cr-vid-meta">${esc(v.mode)} · ${n} comment${n === 1 ? '' : 's'}</span>`;
    btn.addEventListener('click', () => selectVideo(v.n));
    host.appendChild(btn);
  });
}

/* Coaches that actually said something about this video. */
function coachesFor(videoN) {
  return DATA.coaches
    .map((c) => ({ name: c.name, items: (c.comments || {})[String(videoN)] || [] }))
    .filter((c) => c.items.length);
}

/* ---------- center ---------- */

function selectVideo(n) {
  currentVideo = n;
  const v = DATA.videos.find((x) => x.n === n);
  document.querySelectorAll('.cr-vid').forEach((el) => {
    el.classList.toggle('current', Number(el.dataset.n) === n);
  });

  $('cr-stage-title').textContent = `Video ${v.n}: ${v.title}`;
  const mode = $('cr-stage-mode');
  mode.textContent = v.mode;
  mode.style.display = '';
  const link = $('cr-open-drive');
  link.href = `https://drive.google.com/file/d/${v.driveId}/view`;
  link.style.display = '';
  $('cr-frame').src = `https://drive.google.com/file/d/${v.driveId}/preview`;

  renderFeedback(n);
}

/* Playback quality.
 *
 * The clips can only be played through Drive's own embedded player: the raw
 * file at drive.usercontent.google.com refuses cross-site requests
 * (cross-origin-resource-policy: same-site), so a native <video> can't touch
 * it, and there is no URL parameter that pins the embed's resolution.
 *
 * What the player DOES follow is its own pixel size — a squeezed embed gets a
 * low rendition. Hence the panel toggles and the fullscreen button: the more
 * room the player has, the higher the stream Drive sends. Fullscreen gets the
 * best available; the player's own gear menu can also force a resolution.
 */
function toggleClass(cls) {
  document.getElementById('app').classList.toggle(cls);
}

$('btn-toggle-videos').addEventListener('click', () => toggleClass('hide-videos'));
$('btn-toggle-feedback').addEventListener('click', () => toggleClass('hide-feedback'));
$('btn-fullscreen').addEventListener('click', () => {
  const el = $('cr-frame-wrap');
  if (document.fullscreenElement) document.exitFullscreen();
  else el.requestFullscreen();
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'v') toggleClass('hide-videos');
  else if (k === 'b') toggleClass('hide-feedback');
  else if (k === 'f') $('btn-fullscreen').click();
});

/* ---------- right panel ---------- */

function renderFeedback(videoN) {
  const host = $('cr-coach-list');
  host.innerHTML = '';
  const coaches = coachesFor(videoN);
  if (!coaches.length) {
    host.innerHTML = '<div id="cr-empty">No coach feedback for this video yet.</div>';
    return;
  }

  coaches.forEach((coach, ci) => {
    const wrap = document.createElement('div');
    wrap.className = 'cr-coach';

    const btn = document.createElement('button');
    btn.className = 'cr-coach-btn';
    btn.innerHTML =
      `<span class="cr-caret">▶</span>${esc(coach.name)}` +
      `<span class="cr-count">${coach.items.length}</span>`;
    btn.addEventListener('click', () => {
      wrap.classList.toggle('open');
      btn.querySelector('.cr-caret').textContent = wrap.classList.contains('open') ? '▼' : '▶';
    });
    wrap.appendChild(btn);

    const list = document.createElement('div');
    list.className = 'cr-comments';
    coach.items.forEach((item) => list.appendChild(renderItem(item)));
    wrap.appendChild(list);

    // One coach: open it — there's nothing to choose between.
    if (coaches.length === 1 && ci === 0) {
      wrap.classList.add('open');
      btn.querySelector('.cr-caret').textContent = '▼';
    }
    host.appendChild(wrap);
  });
}

function renderItem(item) {
  const wrap = document.createElement('div');
  wrap.className = 'cr-item';

  const btn = document.createElement('button');
  btn.className = 'cr-item-btn';
  btn.innerHTML = `<span class="cr-item-n">${item.n}.</span><span>${esc(item.title)}</span>`;
  btn.addEventListener('click', () => wrap.classList.toggle('open'));
  wrap.appendChild(btn);

  const detail = document.createElement('div');
  detail.className = 'cr-detail';
  let html = `<p>${esc(item.detail)}</p>`;
  if (item.why) {
    html += `<p class="cr-why"><span class="cr-lbl">Why it ranks here</span>${esc(item.why)}</p>`;
  }
  if (item.where) {
    html += `<p class="cr-where"><span class="cr-lbl">Where</span>${esc(item.where)}</p>`;
  }
  detail.innerHTML = html;
  wrap.appendChild(detail);
  return wrap;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

/* ---------- boot ---------- */

fetch('coach_review.json?v=3')
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .then((data) => {
    DATA = data;
    renderVideoList();
    const total = DATA.coaches.length;
    setStatus(`${DATA.videos.length} videos · ${total} coach${total === 1 ? '' : 'es'}`);
    if (DATA.videos.length) selectVideo(DATA.videos[0].n);
  })
  .catch((e) => setStatus(`could not load coach_review.json — ${e.message}`, 'err'));

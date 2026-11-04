// Workout review: every lesson and drill of AMBO's courses (workouts.json), and for each, did it work, was it clear,
// and a note, from everyone on the team.
//
// Saving: a note is the reviewer's own row per lesson or drill (doGetWorkoutReview in apps_script/Code.js), so two
// people never write over each other. Each change is kept in this browser first (localStorage, per name) with the
// time it was made (`at`), then sent by ONE sender, one note at a time, retried until the backend says ok; the
// backend ignores a note older than the one it has, so a retry or another tab landing late can't undo a newer one.
// Everyone's notes are read back every 45 s and when the tab comes back.
(function () {
  'use strict';

  const SCRIPT = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';
  const NAME_KEY = 'labelerName'; // the labelers' shared name (shared/labeler_name.js)
  const POLL_MS = 45000;
  const TYPE_MS = 700;

  const ANSWERS = {
    worked: { label: 'Did it work for you?', yes: 'Worked', partly: 'Partly', no: "Didn't work" },
    clear: { label: 'Was it clear what to do?', yes: 'Clear', partly: 'Somewhat', no: 'Confusing' },
  };
  const DETECT = {
    judged: ['Judged by the app', 'The app checks every rep on camera.'],
    part: ['Partly judged', 'The app checks some of it on camera.'],
    none: ['Not judged yet', 'The app runs it on the clock; nothing is checked on camera.'],
    watch: ['Watch and copy', 'A video to follow. Nothing to check.'],
  };

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked: the notes still go out from memory */ } },
  };

  let data = null;
  let me = normalize(store.get(NAME_KEY));
  /** Everyone's notes from the backend: item → reviewer → note. */
  let team = new Map();
  /** My notes, as typed here: item → {worked, clear, comment, at, dirty}. */
  let mine = {};
  const items = new Map(); // item → {course, lesson, drill, title}

  function normalize(s) { return (s || '').trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 40); }
  const mineKey = () => `workoutReview.mine.${me}`;
  function loadMine() { try { mine = JSON.parse(store.get(mineKey()) || '{}'); } catch { mine = {}; } }
  const saveMine = () => store.set(mineKey(), JSON.stringify(mine));
  const hasAnswer = (n) => !!(n && (n.worked || n.clear || (n.comment || '').trim()));

  // ── data ─────────────────────────────────────────
  async function loadData() {
    const r = await fetch('workouts.json', { cache: 'no-cache' });
    data = await r.json();
    for (const c of data.courses) {
      for (const l of c.lessons || []) {
        items.set(`${c.id}/${l.id}`, { course: c, lesson: l, title: l.name });
        for (const d of l.drills) items.set(`${c.id}/${l.id}/${d.id}`, { course: c, lesson: l, drill: d, title: d.title });
      }
    }
  }

  async function pull() {
    if (!me) return;
    try {
      const url = `${SCRIPT}?action=listWorkoutReview&labeler=${encodeURIComponent(me)}`;
      const j = await (await fetch(url)).json();
      if (j.status !== 'ok') throw new Error(j.message);
      const next = new Map();
      for (const row of j.rows) {
        if (!next.has(row.item)) next.set(row.item, new Map());
        next.get(row.item).set(row.reviewer, row);
        // My own note from another device or browser, newer than what's here.
        if (row.reviewer === me) {
          const here = mine[row.item];
          if (!here || (!here.dirty && row.at > (here.at || 0))) {
            mine[row.item] = { worked: row.worked, clear: row.clear, comment: row.comment, at: row.at };
            refreshOpenReview(row.item);
          }
        }
      }
      team = next;
      saveMine();
      online = true;
      refreshLive();
    } catch {
      online = false;
      setSync();
    }
  }

  // ── saving: one sender, one note at a time ──────
  let sending = false;
  let online = true;
  let retryMs = 0;
  let retryTimer = 0;
  const dirtyItems = () => Object.keys(mine).filter((k) => mine[k].dirty);

  async function pump() {
    if (sending || !me) return;
    const item = dirtyItems()[0];
    if (!item) return setSync();
    sending = true;
    setSync();
    const n = { ...mine[item] };
    const it = items.get(item);
    try {
      const url = `${SCRIPT}?action=saveWorkoutReview&labeler=${encodeURIComponent(me)}`;
      const body = {
        reviewer: me,
        item,
        course: it?.course.name || '',
        lesson: it?.lesson.name || '',
        title: it?.title || '',
        worked: n.worked || '',
        clear: n.clear || '',
        comment: n.comment || '',
        at: n.at,
      };
      const j = await (await fetch(url, { method: 'POST', body: JSON.stringify(body) })).json();
      if (j.status !== 'ok') throw new Error(j.message || 'not saved');
      // Saved as sent; a change made while it was out stays dirty and goes next.
      if (mine[item] && mine[item].at === n.at) mine[item].dirty = false;
      saveMine();
      if (!team.has(item)) team.set(item, new Map());
      team.get(item).set(me, { reviewer: me, item, worked: body.worked, clear: body.clear, comment: body.comment, at: n.at });
      online = true;
      retryMs = 0;
      sending = false;
      markSaved(item);
      refreshLive();
      pump();
    } catch {
      online = false;
      sending = false;
      retryMs = Math.min(30000, retryMs ? retryMs * 2 : 1500);
      setSync();
      clearTimeout(retryTimer);
      retryTimer = setTimeout(pump, retryMs);
    }
  }

  let typeTimer = 0;
  function change(item, patch, typing) {
    const n = { worked: '', clear: '', comment: '', ...mine[item], ...patch, at: Date.now(), dirty: true };
    mine[item] = n;
    saveMine();
    setSync();
    refreshLive();
    clearTimeout(typeTimer);
    if (typing) typeTimer = setTimeout(pump, TYPE_MS);
    else pump();
  }

  function setSync() {
    const el = $('#sync');
    const waiting = dirtyItems().length;
    el.className = 'sync';
    if (sending || (waiting && online)) { el.classList.add('saving'); el.textContent = 'Saving…'; }
    else if (waiting) { el.classList.add('offline'); el.textContent = `Offline · ${waiting} waiting`; }
    else if (savedOnce) { el.classList.add('saved'); el.textContent = 'All saved'; }
    else el.textContent = '';
    if (!online) {
      document.querySelectorAll('.saved-note').forEach((s) => {
        if (mine[s.dataset.item]?.dirty) { s.textContent = 'Kept on this device. It goes out as soon as you’re back online.'; s.classList.remove('ok'); }
      });
    }
  }
  let savedOnce = false;
  function markSaved(item) {
    savedOnce = true;
    setSync();
    const s = document.querySelector(`.saved-note[data-item="${CSS.escape(item)}"]`);
    if (s && !mine[item]?.dirty) { s.textContent = 'Saved'; s.classList.add('ok'); }
  }

  addEventListener('beforeunload', (e) => {
    if (dirtyItems().length) { e.preventDefault(); e.returnValue = ''; }
  });
  addEventListener('online', () => { retryMs = 0; pump(); pull(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pull(); pump(); } });
  setInterval(() => { if (!document.hidden) pull(); }, POLL_MS);

  // ── helpers for views ────────────────────────────
  const CHEV = '<svg class="chev" viewBox="0 0 8 14"><path d="M1.5 1.5 6.5 7l-5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const BACK = '<svg viewBox="0 0 10 17"><path d="M8.5 1.5 1.5 8.5l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const fmtDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  function fmtLength(d) {
    if (d.reps) return `${d.reps} reps`;
    const s = d.video?.seconds || d.seconds;
    return s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`;
  }
  function ago(at) {
    if (!at) return '';
    const s = (Date.now() - at) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function hue(name) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  const avatar = (name) => `<span class="av" style="background:hsl(${hue(name)} 42% 48%)">${esc((name[0] || '?').toUpperCase())}</span>`;

  /** The notes on an item, mine as typed here and everyone else's. */
  function notesOn(item) {
    const out = [];
    for (const [who, n] of team.get(item) || []) if (who !== me && hasAnswer(n)) out.push(n);
    if (hasAnswer(mine[item])) out.push({ ...mine[item], reviewer: me });
    return out;
  }
  function tallyHtml(item) {
    const ns = notesOn(item);
    if (!ns.length) return '';
    const c = { yes: 0, partly: 0, no: 0 };
    for (const n of ns) if (c[n.worked] !== undefined) c[n.worked]++;
    const parts = ['yes', 'partly', 'no'].filter((k) => c[k]).map((k) => `<b class="${k}" title="${ANSWERS.worked[k]}">${c[k]}</b>`);
    const comments = ns.filter((n) => (n.comment || '').trim()).length;
    if (comments) parts.push(`<b class="notes">${comments} note${comments > 1 ? 's' : ''}</b>`);
    return `<span class="tally">${parts.join('')}</span>`;
  }
  function idxClass(item) {
    const n = mine[item];
    if (!hasAnswer(n)) return '';
    return n.worked || 'seen';
  }
  function ring(done, total) {
    const r = 12, c = 2 * Math.PI * r, off = c * (1 - (total ? done / total : 0));
    return `<svg class="ring" viewBox="0 0 30 30" aria-label="${done} of ${total} reviewed"><circle class="track" cx="15" cy="15" r="${r}"/><circle class="fill" cx="15" cy="15" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg>`;
  }
  function lessonItems(c, l) { return [`${c.id}/${l.id}`, ...l.drills.map((d) => `${c.id}/${l.id}/${d.id}`)]; }
  function reviewedCount(list) { return list.filter((k) => hasAnswer(mine[k])).length; }
  const allItems = () => [...items.keys()];

  // ── views ────────────────────────────────────────
  const view = $('#view');
  let current = { name: '' };

  function homeView() {
    const all = allItems();
    const done = reviewedCount(all);
    const pct = all.length ? (100 * done) / all.length : 0;
    const course = data.courses.find((c) => c.lessons);
    const cards = data.courses.map((c, i) => {
      const n = c.lessons ? c.lessons.length : c.planned.length;
      const foot = c.lessons
        ? `<span>${n} lessons</span><span>${reviewedCount(c.lessons.flatMap((l) => lessonItems(c, l)))} of ${c.lessons.reduce((a, l) => a + 1 + l.drills.length, 0)} reviewed</span>`
        : `<span>Coming ${fmtDate(c.on)}</span><span>${n} lessons</span>`;
      return `<a class="course${c.lessons ? '' : ' soon'}" href="#c/${c.id}">
        <img src="img/${c.id}.jpg" alt="" loading="${i < 2 ? 'eager' : 'lazy'}">
        <div class="c-in"><div class="c-num">Course ${i + 1}</div><div class="c-name">${esc(c.name)}</div><div class="c-line">${esc(c.line)}</div></div>
        <div class="c-foot">${foot}</div>
      </a>`;
    }).join('');
    return `<div class="view">
      <section class="hero">
        <p class="eyebrow">Workout review</p>
        <h1>Every workout.<br>Your honest take.</h1>
        <p class="lede">Go through each lesson and workout in AMBO. Say <b>if it worked</b>, <b>if it was clear</b>, and anything else on your mind. Your notes save as you go, and everyone sees them.</p>
        <div class="progress-line"><div class="bar"><i style="width:${pct}%"></i></div><span>${done} of ${all.length} reviewed</span></div>
      </section>
      <div class="courses">${cards}</div>
      ${course ? lessonsList(course) : ''}
      <p class="foot">Courses as of ${esc(data.generated)}, from the app's own data.</p>
    </div>`;
  }

  function lessonsList(c) {
    const groups = [];
    for (const l of c.lessons) {
      const label = l.section || 'Offense';
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, lessons: [] });
      groups[groups.length - 1].lessons.push(l);
    }
    let n = 0;
    const html = groups.map((g) => `<div class="group-label">${esc(g.label)}</div><div class="group">${g.lessons.map((l) => {
      n++;
      const its = lessonItems(c, l);
      const done = reviewedCount(its);
      return `<a class="row" href="#l/${c.id}/${l.id}" data-live="lesson" data-course="${c.id}" data-lesson="${l.id}">
        <span class="idx ${done === its.length ? 'yes' : ''}">${n}</span>
        <span class="body"><span class="t">${esc(l.name)}</span><span class="s" style="display:block">${l.drills.length} workouts · ${done ? `${done} of ${its.length} reviewed` : 'Not started'}</span></span>
        <span class="end">${ring(done, its.length)}${CHEV}</span>
      </a>`;
    }).join('')}</div>`).join('');
    return `<h2 class="section">${esc(c.name)}</h2><p class="section-sub">${c.lessons.length} lessons, in the app's order.</p>${html}`;
  }

  function courseView(c) {
    if (c.lessons) return `<div class="view"><button class="back" data-href="#">${BACK} All courses</button>${lessonsList(c)}</div>`;
    const i = data.courses.indexOf(c);
    return `<div class="view">
      <button class="back" data-href="#">${BACK} All courses</button>
      <div class="lesson-head"><p class="eyebrow">Course ${i + 1} · Coming ${fmtDate(c.on)}</p><h1 class="page-title">${esc(c.name)}</h1><p>${esc(c.line)} Not in the app yet: its lessons are planned, so there's nothing to review here until it's built.</p></div>
      <div class="group-label">Planned lessons</div>
      <div class="group">${c.planned.map((t, k) => `<div class="row disabled"><span class="idx">${k + 1}</span><span class="body"><span class="t">${esc(t)}</span></span><span class="end"><span class="pill k">Coming</span></span></div>`).join('')}</div>
    </div>`;
  }

  function lessonView(c, l) {
    const li = c.lessons.indexOf(l);
    const item = `${c.id}/${l.id}`;
    const rows = l.drills.map((d, k) => {
      const it = `${item}/${d.id}`;
      return `<a class="row" href="#d/${c.id}/${l.id}/${d.id}" data-live="drill" data-item="${it}">
        <span class="idx ${idxClass(it)}">${k + 1}</span>
        <span class="body"><span class="t">${esc(d.title)}</span><span class="s" style="display:block">${d.kind} · ${fmtLength(d)}</span></span>
        <span class="end">${tallyHtml(it)}${CHEV}</span>
      </a>`;
    }).join('');
    const watch = l.drills.filter((d) => d.kind === 'Watch').length;
    return `<div class="view">
      <button class="back" data-href="#c/${c.id}">${BACK} ${esc(c.name)}</button>
      <div class="lesson-head">
        <p class="eyebrow">Lesson ${li + 1}${l.section ? ` · ${esc(l.section)}` : ''}</p>
        <h1 class="page-title">${esc(l.name)}</h1>
        <p>${esc(l.about)}</p>
        <div class="facts">
          <div class="fact"><b>${l.drills.length}</b>workouts</div>
          <div class="fact"><b>${watch}</b>to watch</div>
          <div class="fact"><b>${l.drills.length - watch}</b>to do</div>
        </div>
      </div>
      <div class="group-label">Workouts</div>
      <div class="group">${rows}</div>
      <div class="group-label">The lesson as a whole</div>
      <div class="card">${reviewHtml(item, 'Your take on the lesson', 'How it went from start to finish: the order, the length, anything missing.')}</div>
    </div>`;
  }

  function reviewHtml(item, title, sub) {
    const n = mine[item] || {};
    const seg = (key) => {
      const a = ANSWERS[key];
      const on = ['yes', 'partly', 'no'].indexOf(n[key]);
      return `<div class="q"><div class="q-label">${a.label}</div>
        <div class="seg" data-key="${key}" ${on >= 0 ? 'data-on' : ''} style="--i:${Math.max(on, 0)}">
          <span class="thumb"></span>
          ${['yes', 'partly', 'no'].map((v) => `<button type="button" class="${v}" data-v="${v}" aria-pressed="${n[key] === v}">${a[v]}</button>`).join('')}
        </div></div>`;
    };
    return `<section class="review" data-item="${esc(item)}">
      <h3>${esc(title)}</h3><p class="sub">${esc(sub)}</p>
      ${seg('worked')}${seg('clear')}
      <div class="q"><div class="q-label">Notes</div>
        <textarea class="notes" rows="3" placeholder="What happened, what felt off, what you'd change…">${esc(n.comment || '')}</textarea>
        <div class="saved-note" data-item="${esc(item)}">${n.dirty ? 'Saving…' : hasAnswer(n) ? 'Saved' : ''}</div>
      </div>
      <div class="team" data-team="${esc(item)}">${teamHtml(item)}</div>
    </section>`;
  }

  function teamHtml(item) {
    const others = [...(team.get(item) || []).values()].filter((x) => x.reviewer !== me && hasAnswer(x)).sort((a, b) => b.at - a.at);
    return `<h4>From the team</h4>${others.length ? others.map(noteHtml).join('') : '<div class="empty">No one else has said anything here yet.</div>'}`;
  }
  function noteHtml(n, where) {
    const pills = ['worked', 'clear'].filter((k) => n[k]).map((k) => `<span class="pill ${n[k]}">${ANSWERS[k][n[k]]}</span>`).join('');
    return `<div class="note">${avatar(n.reviewer)}<div style="min-width:0;flex:1">
      <div class="who">${esc(n.reviewer)} ${pills} <span class="when">${ago(n.at)}</span></div>
      ${where || ''}
      ${(n.comment || '').trim() ? `<div class="txt">${esc(n.comment)}</div>` : ''}
    </div></div>`;
  }

  function drillSheet(c, l, d) {
    const k = l.drills.indexOf(d);
    const item = `${c.id}/${l.id}/${d.id}`;
    const det = DETECT[d.detect.status];
    const video = d.video ? `<video src="${esc(d.video.url)}" controls playsinline preload="metadata"></video>` : '';
    const list = (title, xs, tag = 'ul') => (xs && xs.length ? `<div class="block"><h4>${title}</h4><${tag}>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</${tag}></div>` : '');
    return `<div class="sheet-bar"><span class="grip"></span>
        <span class="pos">${esc(l.name)} · ${k + 1} of ${l.drills.length}</span>
        <span class="nav-btns">
          <button class="icon-btn" data-step="-1" ${k === 0 ? 'disabled' : ''} aria-label="Previous workout"><svg width="10" height="16" viewBox="0 0 10 17"><path d="M8.5 1.5 1.5 8.5l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="icon-btn" data-step="1" ${k === l.drills.length - 1 ? 'disabled' : ''} aria-label="Next workout"><svg width="10" height="16" viewBox="0 0 10 17"><path d="M1.5 1.5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="icon-btn" data-close aria-label="Close"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M1.5 1.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </span>
      </div>
      <div class="sheet-body">
        <div class="k-row"><span class="pill k">${d.kind}</span><span class="pill k">${fmtLength(d)}</span>${d.pass ? `<span class="pill k">Pass at ${Math.round(d.pass * 100)}%</span>` : ''}</div>
        <h2 id="sheet-title">${esc(d.title)}</h2>
        <p class="line">${esc(d.line)}</p>
        ${video}
        ${d.calls.length ? `<div class="block"><h4>What AMBO calls</h4><div class="calls">${d.calls.map((x) => `<span>${esc(x)}</span>`).join('')}</div></div>` : ''}
        ${list('How it goes', d.how, 'ol')}
        ${list('Mistakes to watch for', d.mistakes)}
        ${d.moveOn ? `<div class="block"><h4>Done when</h4><p style="margin:0;font-size:16px">${esc(d.moveOn)}</p></div>` : ''}
        <div class="block"><h4>On camera</h4><div class="detect"><span class="pill ${d.detect.status}">${det[0]}</span><p>${esc(d.detect.what)}</p></div></div>
      </div>
      <div class="card">${reviewHtml(item, 'Your take', 'Did it do what it says? Did the app hear you right?')}</div>`;
  }

  function teamView() {
    const all = [];
    for (const [item, byWho] of team) for (const n of byWho.values()) if (hasAnswer(n)) all.push(n);
    for (const [item, n] of Object.entries(mine)) {
      if (n.dirty && hasAnswer(n) && !all.some((x) => x.item === item && x.reviewer === me)) all.push({ ...n, item, reviewer: me });
    }
    all.sort((a, b) => b.at - a.at);
    const people = [...new Set(all.map((n) => n.reviewer))].sort();
    const f = teamFilter;
    const shown = all.filter((n) => (!f.who || n.reviewer === f.who) && (!f.worked || n.worked === f.worked));
    const chip = (key, val, label) => `<button class="chip" data-f="${key}" data-v="${esc(val)}" aria-pressed="${(f[key] || '') === val}">${esc(label)}</button>`;
    const where = (n) => {
      const it = items.get(n.item);
      if (!it) return `<div class="where">${esc(n.item)}</div>`;
      const href = it.drill ? `#d/${it.course.id}/${it.lesson.id}/${it.drill.id}` : `#l/${it.course.id}/${it.lesson.id}`;
      return `<a class="where" href="${href}">${esc(it.lesson.name)}${it.drill ? ` › ${esc(it.drill.title)}` : ' · the lesson'}</a>`;
    };
    return `<div class="view">
      <section class="hero"><p class="eyebrow">Team notes</p><h1>What everyone said.</h1>
      <p class="lede">${all.length} note${all.length === 1 ? '' : 's'} from ${people.length} ${people.length === 1 ? 'person' : 'people'}, newest first.</p></section>
      <div class="filters">${chip('who', '', 'Everyone')}${people.map((p) => chip('who', p, p)).join('')}</div>
      <div class="filters">${chip('worked', '', 'Any')}${chip('worked', 'no', "Didn't work")}${chip('worked', 'partly', 'Partly')}${chip('worked', 'yes', 'Worked')}</div>
      <div class="group feed">${shown.length ? shown.map((n) => noteHtml(n, where(n))).join('') : '<div class="note"><div class="empty" style="color:var(--text-3)">Nothing here yet.</div></div>'}</div>
    </div>`;
  }
  const teamFilter = { who: '', worked: '' };

  // ── routing ──────────────────────────────────────
  function route() {
    if (!data) return;
    const parts = location.hash.replace(/^#/, '').split('/');
    const course = (id) => data.courses.find((c) => c.id === id);
    let next = { name: 'home' };
    if (parts[0] === 'team') next = { name: 'team' };
    else if (parts[0] === 'c' && course(parts[1])) next = { name: 'course', c: course(parts[1]) };
    else if ((parts[0] === 'l' || parts[0] === 'd') && course(parts[1])?.lessons) {
      const c = course(parts[1]);
      const l = c.lessons.find((x) => x.id === parts[2]);
      if (l) {
        next = { name: 'lesson', c, l };
        if (parts[0] === 'd') {
          const d = l.drills.find((x) => x.id === parts[3]);
          if (d) next.d = d;
        }
      }
    }
    // The page under the sheet stays as it is when only the sheet changes.
    const page = `${next.name}/${next.c?.id || ''}/${next.l?.id || ''}`;
    const was = `${current.name}/${current.c?.id || ''}/${current.l?.id || ''}`;
    if (page !== was) {
      view.innerHTML = next.name === 'home' ? homeView() : next.name === 'team' ? teamView() : next.name === 'course' ? courseView(next.c) : lessonView(next.c, next.l);
      if (!next.d) scrollTo({ top: 0, behavior: 'instant' });
      bindReviews(view);
      document.title = next.l ? `${next.l.name} · AMBO Review` : next.name === 'team' ? 'Team notes · AMBO Review' : 'AMBO Workout Review';
    }
    current = next;
    if (next.d) openSheet(next.c, next.l, next.d);
    else closeSheet();
  }
  addEventListener('hashchange', route);

  // ── the sheet ────────────────────────────────────
  const sheetWrap = $('#sheet');
  const sheet = $('.sheet', sheetWrap);
  function openSheet(c, l, d) {
    sheetWrap.classList.remove('closing');
    const fresh = sheetWrap.hidden;
    sheetWrap.hidden = false;
    document.body.classList.add('locked');
    sheet.innerHTML = drillSheet(c, l, d);
    sheet.scrollTop = 0;
    if (!fresh) sheet.animate([{ opacity: 0.4, transform: 'translateX(10px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.22,.8,.24,1)' });
    bindReviews(sheet);
    sheet.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => step(+b.dataset.step)));
  }
  function closeSheet() {
    if (sheetWrap.hidden) return;
    sheet.querySelectorAll('video').forEach((v) => v.pause());
    sheetWrap.classList.add('closing');
    setTimeout(() => {
      if (!sheetWrap.classList.contains('closing')) return;
      sheetWrap.hidden = true;
      sheetWrap.classList.remove('closing');
      sheet.innerHTML = '';
      document.body.classList.remove('locked');
    }, 300);
    refreshLive();
  }
  function step(by) {
    const { c, l, d } = current;
    if (!d) return;
    const next = l.drills[l.drills.indexOf(d) + by];
    if (next) location.replace(`#d/${c.id}/${l.id}/${next.id}`);
  }
  sheetWrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) location.hash = `l/${current.c.id}/${current.l.id}`;
  });
  addEventListener('keydown', (e) => {
    if (!current.d) return;
    if (e.key === 'Escape') location.hash = `l/${current.c.id}/${current.l.id}`;
    if (e.target.closest('textarea, input')) return;
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });

  // ── review controls ──────────────────────────────
  function grow(t) { t.style.height = 'auto'; t.style.height = `${Math.max(110, t.scrollHeight + 2)}px`; }
  function bindReviews(root) {
    root.querySelectorAll('.review').forEach((sec) => {
      const item = sec.dataset.item;
      sec.querySelectorAll('.seg').forEach((seg) => {
        seg.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          const key = seg.dataset.key;
          const v = mine[item]?.[key] === b.dataset.v ? '' : b.dataset.v; // tap again to clear
          seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
          const i = ['yes', 'partly', 'no'].indexOf(v);
          if (i >= 0) { seg.style.setProperty('--i', i); seg.setAttribute('data-on', ''); } else seg.removeAttribute('data-on');
          savingNote(item);
          change(item, { [key]: v }, false);
        });
      });
      const t = $('textarea', sec);
      grow(t);
      t.addEventListener('input', () => { grow(t); savingNote(item); change(item, { comment: t.value }, true); });
      t.addEventListener('blur', () => { clearTimeout(typeTimer); pump(); });
    });
    root.querySelectorAll('[data-href]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.href; }));
    root.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      teamFilter[b.dataset.f] = b.dataset.v;
      view.innerHTML = teamView();
      bindReviews(view);
    }));
  }
  function savingNote(item) {
    document.querySelectorAll(`.saved-note[data-item="${CSS.escape(item)}"]`).forEach((s) => { s.textContent = 'Saving…'; s.classList.remove('ok'); });
  }
  /** My note changed elsewhere (another device): the open form shows it, unless it's being typed in. */
  function refreshOpenReview(item) {
    document.querySelectorAll(`.review[data-item="${CSS.escape(item)}"]`).forEach((sec) => {
      const n = mine[item] || {};
      const t = $('textarea', sec);
      if (document.activeElement !== t) { t.value = n.comment || ''; grow(t); }
      sec.querySelectorAll('.seg').forEach((seg) => {
        const v = n[seg.dataset.key] || '';
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
        const i = ['yes', 'partly', 'no'].indexOf(v);
        if (i >= 0) { seg.style.setProperty('--i', i); seg.setAttribute('data-on', ''); } else seg.removeAttribute('data-on');
      });
    });
  }

  /** What changes as notes come and go, without touching what's being typed: badges, tallies, the team's notes. */
  function refreshLive() {
    document.querySelectorAll('[data-live="drill"]').forEach((row) => {
      const item = row.dataset.item;
      $('.idx', row).className = `idx ${idxClass(item)}`;
      const end = $('.end', row);
      end.innerHTML = tallyHtml(item) + CHEV;
    });
    document.querySelectorAll('[data-live="lesson"]').forEach((row) => {
      const c = data.courses.find((x) => x.id === row.dataset.course);
      const l = c.lessons.find((x) => x.id === row.dataset.lesson);
      const its = lessonItems(c, l);
      const done = reviewedCount(its);
      $('.idx', row).className = `idx ${done === its.length ? 'yes' : ''}`;
      $('.s', row).textContent = `${l.drills.length} workouts · ${done ? `${done} of ${its.length} reviewed` : 'Not started'}`;
      $('.end', row).innerHTML = ring(done, its.length) + CHEV;
    });
    document.querySelectorAll('[data-team]').forEach((el) => { el.innerHTML = teamHtml(el.dataset.team); });
    const bar = $('.progress-line');
    if (bar) {
      const all = allItems();
      const done = reviewedCount(all);
      $('i', bar).style.width = `${(100 * done) / all.length}%`;
      $('span', bar).textContent = `${done} of ${all.length} reviewed`;
    }
    setSync();
  }

  // ── name ─────────────────────────────────────────
  const modal = $('#name-modal');
  function showMe() {
    const b = $('#me');
    b.innerHTML = me ? `${avatar(me)}<span class="nm">${esc(me)}</span>` : 'Your name';
  }
  function askName() {
    modal.hidden = false;
    $('#name-hint').textContent = 'Your name goes next to your notes, so the team knows who said what.';
    const input = $('#name-input');
    input.value = me || '';
    setTimeout(() => input.focus(), 50);
  }
  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = normalize($('#name-input').value);
    if (!n) return;
    if (n !== me && dirtyItems().length) {
      // Notes still on their way go out under the name they were written as: wait for them.
      $('#name-hint').textContent = 'Your last notes are still saving. Try again in a moment.';
      pump();
      return;
    }
    me = n;
    store.set(NAME_KEY, me);
    modal.hidden = true;
    loadMine();
    showMe();
    current = { name: '' };
    route();
    pull();
    pump();
  });
  $('#me').addEventListener('click', askName);
  modal.addEventListener('click', (e) => { if (e.target === modal && me) modal.hidden = true; });

  // ── start ────────────────────────────────────────
  (async function start() {
    view.innerHTML = '<div class="loading">Loading the courses…</div>';
    showMe();
    try {
      await loadData();
    } catch {
      view.innerHTML = '<div class="loading">The courses didn\'t load. Check your connection and reload.</div>';
      return;
    }
    if (me) loadMine();
    route();
    if (!me) askName();
    else { pull(); pump(); }
  })();
})();

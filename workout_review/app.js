// Workout review: every workout of the courses on the site (workouts.json), and two questions on each for everyone on
// the team: was everything clear, did everything work well, and what wasn't or didn't when the answer is no. Nothing
// of the workout itself is shown; it's all checked in the app (Oleksandr, 2026-11-04). The courses are a menu as in
// the app: a course's card opens its lessons, a lesson its workouts, each with its questions right there.
//
// Saving: an answer is the reviewer's own row per workout (doGetWorkoutReview in apps_script/Code.js), so two people
// never write over each other. Each change is kept in this browser first (localStorage, per name) with the time it
// was made (`at`), then sent by ONE sender, one workout at a time, retried until the backend says ok; the backend
// ignores an answer older than the one it has, so a retry or another tab landing late can't undo a newer one.
// Everyone's answers are read back every 45 s and when the tab comes back.
(function () {
  'use strict';

  const SCRIPT = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';
  const NAME_KEY = 'labelerName'; // the labelers' shared name (shared/labeler_name.js)
  const POLL_MS = 45000;
  const TYPE_MS = 700;

  /** The two questions on every workout, in this order, and how an answer reads on the team's page. */
  const QUESTIONS = [
    { key: 'clear', text: 'Was everything clear?', ask: 'What wasn’t clear?', label: { yes: 'Clear', partly: 'Partly clear', no: 'Not clear' } },
    { key: 'worked', text: 'Did everything work well?', ask: 'What didn’t work?', label: { yes: 'Worked', partly: 'Partly worked', no: 'Didn’t work' } },
  ];

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked: the answers still go out from memory */ } },
  };

  let data = null;
  let me = normalize(store.get(NAME_KEY));
  /** Everyone's answers from the backend: item → reviewer → answer. */
  let team = new Map();
  /** My answers, as given here: item → {clear, worked, comment, at, dirty}. */
  let mine = {};
  const items = new Map(); // course/lesson/workout → {course, lesson, drill}

  function normalize(s) { return (s || '').trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 40); }
  const mineKey = () => `workoutReview.mine.${me}`;
  function loadMine() { try { mine = JSON.parse(store.get(mineKey()) || '{}'); } catch { mine = {}; } }
  const saveMine = () => store.set(mineKey(), JSON.stringify(mine));
  const hasAnswer = (n) => !!(n && (n.worked || n.clear || (n.comment || '').trim()));
  /** Reviewed: both questions answered. */
  const answered = (n) => !!(n && n.clear && n.worked);

  // ── data ─────────────────────────────────────────
  async function loadData() {
    const r = await fetch('workouts.json', { cache: 'no-cache' });
    data = await r.json();
    for (const c of data.courses) {
      for (const l of c.lessons) for (const d of l.drills) items.set(`${c.id}/${l.id}/${d.id}`, { course: c, lesson: l, drill: d });
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
        // My own answer from another device or browser, newer than what's here.
        if (row.reviewer === me) {
          const here = mine[row.item];
          if (!here || (!here.dirty && row.at > (here.at || 0))) {
            mine[row.item] = { worked: row.worked, clear: row.clear, comment: row.comment, at: row.at };
            refreshWorkout(row.item);
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

  // ── saving: one sender, one workout at a time ───
  let sending = false;
  let online = true;
  let savedOnce = false;
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
        title: it?.drill.title || '',
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
      savedOnce = true;
      retryMs = 0;
      sending = false;
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
    mine[item] = { worked: '', clear: '', comment: '', ...mine[item], ...patch, at: Date.now(), dirty: true };
    saveMine();
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
  function ring(done, total) {
    const r = 12, c = 2 * Math.PI * r, off = c * (1 - (total ? done / total : 0));
    return `<svg class="ring" viewBox="0 0 30 30" aria-label="${done} of ${total} reviewed"><circle class="track" cx="15" cy="15" r="${r}"/><circle class="fill" cx="15" cy="15" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg>`;
  }
  const lessonItems = (c, l) => l.drills.map((d) => `${c.id}/${l.id}/${d.id}`);
  const reviewedCount = (list) => list.filter((k) => answered(mine[k])).length;
  function courseDone(c) {
    const its = c.lessons.flatMap((l) => lessonItems(c, l));
    return `${reviewedCount(its)} of ${its.length} reviewed`;
  }
  const lessonSub = (l, done) => `${l.drills.length} workouts${done ? ` · ${done} reviewed` : ''}`;
  /** A workout's number: red once anything is a no, green once both are yes. */
  function idxClass(item) {
    const n = mine[item];
    if (!n) return '';
    if (n.clear === 'no' || n.worked === 'no') return 'no';
    if (n.clear === 'yes' && n.worked === 'yes') return 'yes';
    return n.clear || n.worked ? 'seen' : '';
  }
  /** The note asks what wasn't clear or didn't work, once either is a no (and stays while it has text). */
  const showNote = (n) => n.clear === 'no' || n.worked === 'no' || !!(n.comment || '').trim();
  function notePrompt(n) {
    const asks = QUESTIONS.filter((q) => n[q.key] === 'no').map((q) => q.ask);
    return asks.length === 2 ? 'What wasn’t clear, and what didn’t work?' : asks[0] || 'Note';
  }

  // ── views ────────────────────────────────────────
  const view = $('#view');

  function homeView() {
    const cards = data.courses.map((c, i) => `<a class="course" href="#c/${c.id}">
        <img src="img/${c.id}.jpg" alt="" loading="${i < 2 ? 'eager' : 'lazy'}">
        <div class="c-in"><div class="c-num">Course ${i + 1}</div><div class="c-name">${esc(c.name)}</div><div class="c-line">${esc(c.line)}</div></div>
        <div class="c-foot"><span>${c.lessons.length} lessons</span><span data-live="course" data-course="${c.id}">${courseDone(c)}</span></div>
      </a>`).join('');
    return `<div class="view"><div class="courses">${cards}</div></div>`;
  }

  function courseView(c) {
    const groups = [];
    for (const l of c.lessons) {
      const label = l.section || 'Offense';
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, lessons: [] });
      groups[groups.length - 1].lessons.push(l);
    }
    let n = 0;
    const list = groups.map((g) => `<div class="group-label">${esc(g.label)}</div><div class="group">${g.lessons.map((l) => {
      n++;
      const its = lessonItems(c, l);
      const done = reviewedCount(its);
      return `<a class="row" href="#l/${c.id}/${l.id}" data-live="lesson" data-course="${c.id}" data-lesson="${l.id}">
        <span class="idx ${done === its.length ? 'yes' : ''}">${n}</span>
        <span class="body"><span class="t">${esc(l.name)}</span><span class="s">${lessonSub(l, done)}</span></span>
        <span class="end">${ring(done, its.length)}${CHEV}</span>
      </a>`;
    }).join('')}</div>`).join('');
    return `<div class="view"><button class="back" data-href="#">${BACK} Courses</button><h1 class="page-title">${esc(c.name)}</h1>${list}</div>`;
  }

  function lessonView(c, l) {
    const li = c.lessons.indexOf(l);
    const next = c.lessons[li + 1];
    return `<div class="view">
      <button class="back" data-href="#c/${c.id}">${BACK} ${esc(c.name)}</button>
      <p class="eyebrow">Lesson ${li + 1}</p>
      <h1 class="page-title">${esc(l.name)}</h1>
      <div class="group workouts">${l.drills.map((d, k) => workoutHtml(`${c.id}/${l.id}/${d.id}`, d, k)).join('')}</div>
      ${next ? `<a class="next" href="#l/${c.id}/${next.id}">Next: ${esc(next.name)} ${CHEV}</a>` : ''}
    </div>`;
  }

  function workoutHtml(item, d, k) {
    const n = mine[item] || {};
    const toggle = (q) => `<div class="q"><span class="q-text">${q.text}</span>
        <div class="seg" role="group" aria-label="${q.text}" data-key="${q.key}"${n[q.key] === 'yes' || n[q.key] === 'no' ? ' data-on' : ''} style="--i:${n[q.key] === 'no' ? 1 : 0}">
          <span class="thumb"></span>
          <button type="button" class="yes" data-v="yes" aria-pressed="${n[q.key] === 'yes'}">Yes</button>
          <button type="button" class="no" data-v="no" aria-pressed="${n[q.key] === 'no'}">No</button>
        </div></div>`;
    return `<section class="workout" id="w-${esc(d.id)}" data-item="${esc(item)}">
      <div class="w-head"><span class="idx ${idxClass(item)}">${k + 1}</span><span class="w-title">${esc(d.title)}</span></div>
      <div class="w-qs">${QUESTIONS.map(toggle).join('')}
        <textarea class="notes" rows="1" placeholder="${notePrompt(n)}" aria-label="${notePrompt(n)}"${showNote(n) ? '' : ' hidden'}>${esc(n.comment || '')}</textarea>
      </div>
    </section>`;
  }

  function noteHtml(n, where) {
    const pills = QUESTIONS.filter((q) => n[q.key]).map((q) => `<span class="pill ${n[q.key]}">${q.label[n[q.key]] || esc(n[q.key])}</span>`).join('');
    return `<div class="note">${avatar(n.reviewer)}<div style="min-width:0;flex:1">
      <div class="who">${esc(n.reviewer)} ${pills} <span class="when">${ago(n.at)}</span></div>
      ${where || ''}
      ${(n.comment || '').trim() ? `<div class="txt">${esc(n.comment)}</div>` : ''}
    </div></div>`;
  }

  const teamFilter = { who: '', issue: '' };
  function teamView() {
    const all = [];
    for (const byWho of team.values()) for (const n of byWho.values()) if (hasAnswer(n)) all.push(n);
    for (const [item, n] of Object.entries(mine)) {
      if (n.dirty && hasAnswer(n) && !all.some((x) => x.item === item && x.reviewer === me)) all.push({ ...n, item, reviewer: me });
    }
    all.sort((a, b) => b.at - a.at);
    const people = [...new Set(all.map((n) => n.reviewer))].sort();
    const f = teamFilter;
    const shown = all.filter((n) => (!f.who || n.reviewer === f.who) && (!f.issue || n[f.issue] === 'no'));
    const chip = (key, val, label) => `<button class="chip" data-f="${key}" data-v="${esc(val)}" aria-pressed="${(f[key] || '') === val}">${esc(label)}</button>`;
    const where = (n) => {
      const it = items.get(n.item);
      if (!it) return `<div class="where">${esc(n.item)}</div>`;
      return `<a class="where" href="#l/${it.course.id}/${it.lesson.id}/${it.drill.id}">${esc(it.lesson.name)} › ${esc(it.drill.title)}</a>`;
    };
    return `<div class="view">
      <h1 class="page-title">Team notes</h1>
      <p class="meta">${all.length} answer${all.length === 1 ? '' : 's'} · ${people.length} ${people.length === 1 ? 'person' : 'people'}</p>
      <div class="filters">${chip('who', '', 'Everyone')}${people.map((p) => chip('who', p, p)).join('')}</div>
      <div class="filters">${chip('issue', '', 'All')}${chip('issue', 'clear', 'Not clear')}${chip('issue', 'worked', 'Didn’t work')}</div>
      <div class="group feed">${shown.length ? shown.map((n) => noteHtml(n, where(n))).join('') : '<div class="note"><div class="empty">Nothing yet.</div></div>'}</div>
    </div>`;
  }

  // ── routing ──────────────────────────────────────
  //   #c/<course>                     a course's lessons
  //   #l/<course>/<lesson>[/<workout>] a lesson's workouts (scrolled to one, from the team's page)
  function route() {
    if (!data) return;
    const parts = location.hash.replace(/^#/, '').split('/');
    const course = (id) => data.courses.find((c) => c.id === id);
    let next = { name: 'home' };
    if (parts[0] === 'team') next = { name: 'team' };
    else if (parts[0] === 'c' && course(parts[1])) next = { name: 'course', c: course(parts[1]) };
    // `d` was a workout's own page, before the questions moved onto the lesson's.
    else if ((parts[0] === 'l' || parts[0] === 'd') && course(parts[1])) {
      const c = course(parts[1]);
      const l = c.lessons.find((x) => x.id === parts[2]);
      if (l) next = { name: 'lesson', c, l, to: parts[3] };
    }
    view.innerHTML = next.name === 'home' ? homeView() : next.name === 'team' ? teamView() : next.name === 'course' ? courseView(next.c) : lessonView(next.c, next.l);
    bind(view);
    document.title = next.l ? `${next.l.name} · AMBO Review` : next.c ? `${next.c.name} · AMBO Review` : next.name === 'team' ? 'Team notes · AMBO Review' : 'AMBO Review';
    const to = next.to && document.getElementById(`w-${next.to}`);
    if (to) {
      to.scrollIntoView({ block: 'center' });
      to.classList.add('flash');
    } else scrollTo({ top: 0, behavior: 'instant' });
  }
  addEventListener('hashchange', route);

  // ── answering ────────────────────────────────────
  function grow(t) { t.style.height = 'auto'; t.style.height = `${Math.max(40, t.scrollHeight + 2)}px`; }
  function paintSeg(seg, v) {
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
    if (v === 'yes' || v === 'no') { seg.style.setProperty('--i', v === 'no' ? 1 : 0); seg.setAttribute('data-on', ''); } else seg.removeAttribute('data-on');
  }
  /** A workout's answers as they are now: its toggles, its number, its note (shown or not, unless it's being typed in). */
  function paintWorkout(w) {
    const n = mine[w.dataset.item] || {};
    w.querySelectorAll('.seg').forEach((seg) => paintSeg(seg, n[seg.dataset.key] || ''));
    $('.idx', w).className = `idx ${idxClass(w.dataset.item)}`;
    const t = $('textarea', w);
    t.placeholder = notePrompt(n);
    t.setAttribute('aria-label', notePrompt(n));
    if (document.activeElement !== t) {
      t.value = n.comment || '';
      t.hidden = !showNote(n);
    }
    if (!t.hidden) grow(t);
  }
  function refreshWorkout(item) {
    const w = document.querySelector(`.workout[data-item="${CSS.escape(item)}"]`);
    if (w) paintWorkout(w);
  }
  function bind(root) {
    root.querySelectorAll('.workout').forEach((w) => {
      const item = w.dataset.item;
      const t = $('textarea', w);
      w.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const key = seg.dataset.key;
        const v = mine[item]?.[key] === b.dataset.v ? '' : b.dataset.v; // tap again to clear
        change(item, { [key]: v }, false);
        paintWorkout(w);
      }));
      if (!t.hidden) grow(t);
      t.addEventListener('input', () => { grow(t); change(item, { comment: t.value }, true); });
      t.addEventListener('blur', () => { clearTimeout(typeTimer); pump(); paintWorkout(w); });
    });
    root.querySelectorAll('[data-href]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.href; }));
    root.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      teamFilter[b.dataset.f] = b.dataset.v;
      view.innerHTML = teamView();
      bind(view);
    }));
  }

  /** What changes as answers come and go, without touching what's being typed: numbers, progress. */
  function refreshLive() {
    document.querySelectorAll('.workout').forEach((w) => { $('.idx', w).className = `idx ${idxClass(w.dataset.item)}`; });
    document.querySelectorAll('[data-live="lesson"]').forEach((row) => {
      const c = data.courses.find((x) => x.id === row.dataset.course);
      const l = c.lessons.find((x) => x.id === row.dataset.lesson);
      const its = lessonItems(c, l);
      const done = reviewedCount(its);
      $('.idx', row).className = `idx ${done === its.length ? 'yes' : ''}`;
      $('.s', row).textContent = lessonSub(l, done);
      $('.end', row).innerHTML = ring(done, its.length) + CHEV;
    });
    document.querySelectorAll('[data-live="course"]').forEach((el) => {
      el.textContent = courseDone(data.courses.find((x) => x.id === el.dataset.course));
    });
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
    $('#name-hint').textContent = '';
    const input = $('#name-input');
    input.value = me || '';
    setTimeout(() => input.focus(), 50);
  }
  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = normalize($('#name-input').value);
    if (!n) return;
    if (n !== me && dirtyItems().length) {
      // Answers still on their way go out under the name they were given as: wait for them.
      $('#name-hint').textContent = 'Your last answers are still saving. Try again in a moment.';
      pump();
      return;
    }
    me = n;
    store.set(NAME_KEY, me);
    modal.hidden = true;
    loadMine();
    showMe();
    route();
    pull();
    pump();
  });
  $('#me').addEventListener('click', askName);
  modal.addEventListener('click', (e) => { if (e.target === modal && me) modal.hidden = true; });

  // ── start ────────────────────────────────────────
  (async function start() {
    view.innerHTML = '<div class="loading">Loading…</div>';
    showMe();
    try {
      await loadData();
    } catch {
      view.innerHTML = '<div class="loading">Didn\'t load. Check your connection and reload.</div>';
      return;
    }
    if (me) loadMine();
    route();
    if (!me) askName();
    else { pull(); pump(); }
  })();
})();

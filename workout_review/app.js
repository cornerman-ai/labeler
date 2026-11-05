// Workout review: every drill of the courses on the site (workouts.json), and two questions on each for everyone on
// the team: was everything clear, did everything work well; and a comment on each, always there (2026-11-05), which
// asks what wasn't clear or didn't work when an answer is no. Nothing of the drill itself is shown; it's all checked
// in the app (Oleksandr, 2026-11-04).
//
// The menu (Oleksandr, 2026-11-04): Your notes, Team notes, Profile. Your notes and Team notes are the same courses →
// lessons → drills as in the app: in Your notes each drill has its two questions right there, in Team notes everyone's
// answers on it.
//
// Saving: an answer is the reviewer's own row per drill (doGetWorkoutReview in apps_script/Code.js), so two people
// never write over each other. Each change is kept in this browser first (localStorage, per name) with the time it
// was made (`at`), then sent by ONE sender, one drill at a time, retried until the backend says ok; the backend
// ignores an answer older than the one it has, so a retry or another tab landing late can't undo a newer one.
// Everyone's answers are read back every 45 s and when the tab comes back.
(function () {
  'use strict';

  const SCRIPT = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';
  const NAME_KEY = 'labelerName'; // the labelers' shared name (shared/labeler_name.js)
  const POLL_MS = 45000;
  const TYPE_MS = 700;
  /**
   * An answer tapped this soon after the name dialog closes is ignored: it's the dialog's own Continue landing on the
   * toggle under it (2026-11-05: Continue answered "Was everything clear?" on the drill under the button).
   */
  const NAMED_GUARD_MS = 500;
  let namedAt = 0;

  /** The two questions on every drill, in this order, and how an answer reads in Team notes. */
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
  const items = new Map(); // course/lesson/drill → {course, lesson, drill}

  function normalize(s) { return (s || '').trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 40); }
  const mineKey = () => `workoutReview.mine.${me}`;
  function loadMine() { try { mine = JSON.parse(store.get(mineKey()) || '{}'); } catch { mine = {}; } }
  const saveMine = () => store.set(mineKey(), JSON.stringify(mine));
  const hasAnswer = (n) => !!(n && (n.worked || n.clear || (n.comment || '').trim()));
  /** Reviewed: both questions answered. */
  const answered = (n) => !!(n && n.clear && n.worked);
  /** An answer as a whole: a no if either is a no, a yes once both are. */
  const verdict = (n) => (n.clear === 'no' || n.worked === 'no' ? 'no' : n.clear === 'yes' && n.worked === 'yes' ? 'yes' : 'seen');

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
            refreshDrill(row.item);
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

  // ── saving: one sender, one drill at a time ─────
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

  /** The save state, as a pill at the bottom: Saving…, then Saved for a moment; Offline while answers wait. */
  let syncState = 'idle';
  let syncTimer = 0;
  function setSync() {
    const el = $('#sync');
    const waiting = dirtyItems().length;
    const next = sending || (waiting && online) ? 'saving' : waiting ? 'offline' : syncState === 'saving' || syncState === 'offline' ? 'saved' : syncState;
    if (next === 'offline') el.textContent = `Offline · ${waiting} waiting`;
    if (next === syncState) return;
    syncState = next;
    clearTimeout(syncTimer);
    if (next === 'idle') return el.classList.remove('show');
    el.className = `sync show ${next}`;
    if (next === 'saving') el.textContent = 'Saving…';
    if (next === 'saved') {
      el.textContent = 'Saved';
      syncTimer = setTimeout(() => { syncState = 'idle'; el.classList.remove('show'); }, 1400);
    }
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
  const avatar = (name, big) => `<span class="av${big ? ' big' : ''}" style="background:hsl(${hue(name)} 42% 48%)">${esc((name[0] || '?').toUpperCase())}</span>`;
  function ring(done, total) {
    const r = 12, c = 2 * Math.PI * r, off = c * (1 - (total ? done / total : 0));
    return `<svg class="ring" viewBox="0 0 30 30" aria-label="${done} of ${total} reviewed"><circle class="track" cx="15" cy="15" r="${r}"/><circle class="fill" cx="15" cy="15" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg>`;
  }
  const courseById = (id) => data.courses.find((c) => c.id === id);
  const lessonItems = (c, l) => l.drills.map((d) => `${c.id}/${l.id}/${d.id}`);
  const reviewedCount = (list) => list.filter((k) => answered(mine[k])).length;
  function courseDone(c) {
    const its = c.lessons.flatMap((l) => lessonItems(c, l));
    return `${reviewedCount(its)} of ${its.length} reviewed`;
  }
  /** A drill's number in Your notes: red once anything is a no, green once both are yes. */
  function idxClass(item) {
    const n = mine[item];
    return n && hasAnswer(n) ? verdict(n) : '';
  }
  /**
   * Every drill's comment box, always there (Oleksandr, 2026-11-05: "for every workout lesson part it should be possible
   * to write a comment"), saved under the reviewer's name; once either answer is a no, it asks what wasn't clear or
   * didn't work.
   */
  function notePrompt(n) {
    const asks = QUESTIONS.filter((q) => n[q.key] === 'no').map((q) => q.ask);
    return asks.length === 2 ? 'What wasn’t clear, and what didn’t work?' : asks[0] || (me ? `Comment as ${me}` : 'Comment');
  }

  /** Everyone's answers on a drill, mine as given here, newest first. */
  function answersOn(item) {
    const out = [];
    for (const [who, n] of team.get(item) || []) if (who !== me && hasAnswer(n)) out.push(n);
    if (hasAnswer(mine[item])) out.push({ ...mine[item], reviewer: me });
    return out.sort((a, b) => b.at - a.at);
  }
  /** Everyone's answers on these drills: how many, how many all yes, how many with a no. */
  function tally(list) {
    const t = { all: 0, yes: 0, no: 0 };
    for (const item of list) {
      for (const n of answersOn(item)) {
        t.all++;
        const v = verdict(n);
        if (v === 'yes' || v === 'no') t[v]++;
      }
    }
    return t;
  }
  const tallyHtml = (t) => `<span class="tally">${t.yes ? `<b class="yes" title="All yes">${t.yes}</b>` : ''}${t.no ? `<b class="no" title="With a no">${t.no}</b>` : ''}</span>`;
  const answersCount = (n) => `${n} answer${n === 1 ? '' : 's'}`;
  const teamCourseDone = (c) => answersCount(tally(c.lessons.flatMap((l) => lessonItems(c, l))).all);
  /** A drill's number in Team notes: red if anyone said no, green once everyone who answered said yes to both. */
  function teamIdx(item) {
    const ns = answersOn(item);
    if (!ns.length) return '';
    if (ns.some((n) => verdict(n) === 'no')) return 'no';
    return ns.every((n) => verdict(n) === 'yes') ? 'yes' : 'seen';
  }
  const pills = (n) => QUESTIONS.filter((q) => n[q.key]).map((q) => `<span class="pill ${n[q.key]}">${q.label[n[q.key]] || esc(n[q.key])}</span>`).join('');

  // ── views: Your notes and Team notes, the same menu ──
  const view = $('#view');
  const base = (isTeam) => (isTeam ? '#team/' : '#');

  function coursesView(isTeam) {
    const cards = data.courses.map((c, i) => `<a class="course" href="${base(isTeam)}c/${c.id}">
        <img src="img/${c.id}.jpg" alt="" loading="${i < 2 ? 'eager' : 'lazy'}">
        <div class="c-in"><div class="c-num">Course ${i + 1}</div><div class="c-name">${esc(c.name)}</div><div class="c-line">${esc(c.line)}</div></div>
        <div class="c-foot"><span>${c.lessons.length} lessons</span><span data-live="${isTeam ? 'team-course' : 'course'}" data-course="${c.id}">${isTeam ? teamCourseDone(c) : courseDone(c)}</span></div>
      </a>`).join('');
    return `<div class="view"><div class="courses">${cards}</div></div>`;
  }

  function lessonRow(c, l, n) {
    const its = lessonItems(c, l);
    const done = reviewedCount(its);
    return `<span class="idx ${done === its.length ? 'yes' : ''}">${n}</span>
      <span class="body"><span class="t">${esc(l.name)}</span><span class="s">${l.drills.length} drills${done ? ` · ${done} reviewed` : ''}</span></span>
      <span class="end">${ring(done, its.length)}${CHEV}</span>`;
  }
  function teamLessonRow(c, l, n) {
    const t = tally(lessonItems(c, l));
    return `<span class="idx">${n}</span>
      <span class="body"><span class="t">${esc(l.name)}</span><span class="s">${l.drills.length} drills${t.all ? ` · ${answersCount(t.all)}` : ''}</span></span>
      <span class="end">${tallyHtml(t)}${CHEV}</span>`;
  }
  function courseView(c, isTeam) {
    const groups = [];
    // Fundamentals' lessons come in parts (Basics, Offense, Defense) as in the app; a course in one part (Footwork) has
    // no part's name over it.
    const parted = c.lessons.some((l) => l.section);
    for (const l of c.lessons) {
      const label = parted ? l.section || 'Offense' : '';
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, lessons: [] });
      groups[groups.length - 1].lessons.push(l);
    }
    let n = 0;
    const list = groups.map((g) => `${g.label ? `<div class="group-label">${esc(g.label)}</div>` : ''}<div class="group">${g.lessons.map((l) => {
      n++;
      return `<a class="row" href="${base(isTeam)}l/${c.id}/${l.id}" data-live="${isTeam ? 'team-lesson' : 'lesson'}" data-course="${c.id}" data-lesson="${l.id}" data-n="${n}">${isTeam ? teamLessonRow(c, l, n) : lessonRow(c, l, n)}</a>`;
    }).join('')}</div>`).join('');
    return `<div class="view"><button class="back" data-href="${base(isTeam)}">${BACK} Courses</button><h1 class="page-title">${esc(c.name)}</h1>${list}</div>`;
  }

  function lessonView(c, l, isTeam) {
    const li = c.lessons.indexOf(l);
    const next = c.lessons[li + 1];
    const drill = isTeam ? teamDrillHtml : drillHtml;
    return `<div class="view">
      <button class="back" data-href="${base(isTeam)}c/${c.id}">${BACK} ${esc(c.name)}</button>
      <p class="eyebrow">Lesson ${li + 1}</p>
      <h1 class="page-title">${esc(l.name)}</h1>
      <div class="group drills">${l.drills.map((d, k) => drill(`${c.id}/${l.id}/${d.id}`, d, k)).join('')}</div>
      ${next ? `<a class="next" href="${base(isTeam)}l/${c.id}/${next.id}">Next: ${esc(next.name)} ${CHEV}</a>` : ''}
    </div>`;
  }

  /** A drill in Your notes: its two questions and its comment. */
  function drillHtml(item, d, k) {
    const n = mine[item] || {};
    const toggle = (q) => `<div class="q"><span class="q-text">${q.text}</span>
        <div class="seg" role="group" aria-label="${q.text}" data-key="${q.key}"${n[q.key] === 'yes' || n[q.key] === 'no' ? ' data-on' : ''} style="--i:${n[q.key] === 'no' ? 1 : 0}">
          <span class="thumb"></span>
          <button type="button" class="yes" data-v="yes" aria-pressed="${n[q.key] === 'yes'}">Yes</button>
          <button type="button" class="no" data-v="no" aria-pressed="${n[q.key] === 'no'}">No</button>
        </div></div>`;
    return `<section class="drill" id="w-${esc(d.id)}" data-item="${esc(item)}">
      <div class="d-head"><span class="idx ${idxClass(item)}">${k + 1}</span><span class="d-title">${esc(d.title)}</span></div>
      <div class="d-body">${QUESTIONS.map(toggle).join('')}
        <textarea class="notes" rows="1" placeholder="${esc(notePrompt(n))}" aria-label="${esc(notePrompt(n))}">${esc(n.comment || '')}</textarea>
      </div>
    </section>`;
  }

  /** A drill in Team notes: who answered what. */
  function teamDrillHtml(item, d, k) {
    return `<section class="drill" id="w-${esc(d.id)}">
      <div class="d-head"><span class="idx ${teamIdx(item)}" data-team-idx="${esc(item)}">${k + 1}</span><span class="d-title">${esc(d.title)}</span></div>
      <div class="d-body" data-answers="${esc(item)}">${answersHtml(item)}</div>
    </section>`;
  }
  function answersHtml(item) {
    const ns = answersOn(item);
    if (!ns.length) return '<div class="none">No answers yet</div>';
    return ns.map((n) => `<div class="ans">${avatar(n.reviewer)}<div class="ans-body">
        <div class="who">${esc(n.reviewer)} ${pills(n)} <span class="when">${ago(n.at)}</span></div>
        ${(n.comment || '').trim() ? `<div class="txt">${esc(n.comment)}</div>` : ''}
      </div></div>`).join('');
  }

  function profileView() {
    const all = [...items.keys()];
    return `<div class="view">
      <div class="p-head">${avatar(me || '?', true)}<div><h1 class="page-title">${esc(me || 'Your name')}</h1><p class="meta" id="p-done">${reviewedCount(all)} of ${all.length} drills reviewed</p></div></div>
      <form class="p-name" id="p-form">
        <div class="group-label">Name</div>
        <div class="p-row"><input id="p-input" value="${esc(me)}" maxlength="40" autocomplete="name" required aria-label="Name"><button class="btn" type="submit">Save</button></div>
        <p class="p-hint" id="p-hint"></p>
      </form>
    </div>`;
  }

  // ── routing ──────────────────────────────────────
  //   #c/<course>                         your notes: a course's lessons
  //   #l/<course>/<lesson>[/<drill>]      your notes: a lesson's drills (scrolled to one)
  //   #team, #team/c/…, #team/l/…         the same, with everyone's answers
  //   #profile
  function route() {
    if (!data) return;
    const parts = location.hash.replace(/^#/, '').split('/');
    const isTeam = parts[0] === 'team';
    const p = isTeam ? parts.slice(1) : parts;
    const next = { tab: parts[0] === 'profile' ? 'profile' : isTeam ? 'team' : 'mine' };
    if (next.tab !== 'profile' && p[0] === 'c' && courseById(p[1])) next.c = courseById(p[1]);
    // `d` was a drill's own page, before the questions moved onto the lesson's.
    else if (next.tab !== 'profile' && (p[0] === 'l' || p[0] === 'd') && courseById(p[1])) {
      const c = courseById(p[1]);
      const l = c.lessons.find((x) => x.id === p[2]);
      if (l) Object.assign(next, { c, l, to: p[3] });
    }
    view.innerHTML = next.tab === 'profile' ? profileView() : next.l ? lessonView(next.c, next.l, isTeam) : next.c ? courseView(next.c, isTeam) : coursesView(isTeam);
    bind(view);
    document.querySelectorAll('.tabs a').forEach((a) => {
      if (a.dataset.tab === next.tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const where = next.l?.name || next.c?.name || { mine: 'Your notes', team: 'Team notes', profile: 'Profile' }[next.tab];
    document.title = `${where} · AMBO Review`;
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
  /** A drill's answers as they are now: its toggles, its number, its comment (unless it's being typed in). */
  function paintDrill(w) {
    const n = mine[w.dataset.item] || {};
    w.querySelectorAll('.seg').forEach((seg) => paintSeg(seg, n[seg.dataset.key] || ''));
    $('.idx', w).className = `idx ${idxClass(w.dataset.item)}`;
    const t = $('textarea', w);
    t.placeholder = notePrompt(n);
    t.setAttribute('aria-label', notePrompt(n));
    if (document.activeElement !== t) t.value = n.comment || '';
    grow(t);
  }
  function refreshDrill(item) {
    const w = document.querySelector(`.drill[data-item="${CSS.escape(item)}"]`);
    if (w) paintDrill(w);
  }
  function bind(root) {
    root.querySelectorAll('.drill[data-item]').forEach((w) => {
      const item = w.dataset.item;
      const t = $('textarea', w);
      w.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || Date.now() - namedAt < NAMED_GUARD_MS) return;
        const key = seg.dataset.key;
        const v = mine[item]?.[key] === b.dataset.v ? '' : b.dataset.v; // tap again to clear
        change(item, { [key]: v }, false);
        paintDrill(w);
      }));
      grow(t);
      t.addEventListener('input', () => { grow(t); change(item, { comment: t.value }, true); });
      t.addEventListener('blur', () => { clearTimeout(typeTimer); pump(); paintDrill(w); });
    });
    root.querySelectorAll('[data-href]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.href; }));
    const form = $('#p-form', root);
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); setName($('#p-input').value, $('#p-hint')); });
  }

  /** What changes as answers come and go, without touching what's being typed. */
  function refreshLive() {
    document.querySelectorAll('.drill[data-item]').forEach((w) => { $('.idx', w).className = `idx ${idxClass(w.dataset.item)}`; });
    document.querySelectorAll('[data-live="lesson"], [data-live="team-lesson"]').forEach((row) => {
      const c = courseById(row.dataset.course);
      const l = c.lessons.find((x) => x.id === row.dataset.lesson);
      row.innerHTML = (row.dataset.live === 'lesson' ? lessonRow : teamLessonRow)(c, l, +row.dataset.n);
    });
    document.querySelectorAll('[data-live="course"]').forEach((el) => { el.textContent = courseDone(courseById(el.dataset.course)); });
    document.querySelectorAll('[data-live="team-course"]').forEach((el) => { el.textContent = teamCourseDone(courseById(el.dataset.course)); });
    document.querySelectorAll('[data-answers]').forEach((el) => { el.innerHTML = answersHtml(el.dataset.answers); });
    document.querySelectorAll('[data-team-idx]').forEach((el) => { el.className = `idx ${teamIdx(el.dataset.teamIdx)}`; });
    const done = $('#p-done');
    if (done) done.textContent = `${reviewedCount([...items.keys()])} of ${items.size} drills reviewed`;
    setSync();
  }

  // ── name ─────────────────────────────────────────
  /** Answers still on their way go out under the name they were given as: a new name waits for them. */
  function setName(value, hint) {
    const n = normalize(value);
    if (!n) return false;
    if (n !== me && dirtyItems().length) {
      hint.textContent = 'Your last answers are still saving. Try again in a moment.';
      pump();
      return false;
    }
    me = n;
    store.set(NAME_KEY, me);
    loadMine();
    route();
    pull();
    pump();
    return true;
  }
  const modal = $('#name-modal');
  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (setName($('#name-input').value, $('#name-hint'))) {
      modal.hidden = true;
      namedAt = Date.now();
    }
  });

  // ── start ────────────────────────────────────────
  (async function start() {
    view.innerHTML = '<div class="loading">Loading…</div>';
    try {
      await loadData();
    } catch {
      view.innerHTML = '<div class="loading">Didn\'t load. Check your connection and reload.</div>';
      return;
    }
    if (me) loadMine();
    route();
    if (!me) {
      modal.hidden = false;
      setTimeout(() => $('#name-input').focus(), 50);
    } else { pull(); pump(); }
  })();
})();

// ============================================================
// problems.js — real-time timing-problem popups + a backend audit log
//
// computeProblems() (app.js) is the pure detection: a move outside every
// round, an absurdly long move, two of the same owner's rounds overlapping,
// or a duplicate move. This file is the only consumer of it. Every render,
// checkProblems() diffs the current detection against what was open a
// moment ago — a genuinely NEW problem pops a dialog immediately and is
// written to the backend right away (one small row, no reason to hold it
// back). A problem that stops reproducing is NOT synced back immediately —
// see sweepResolvedProblems() — editing a label already writes to ITS OWN
// sheet on every change; also pinging the Problems sheet on every keystroke
// just in case something got fixed would double that traffic for nothing
// anyone would notice. A periodic sweep confirms it's really gone instead.
//
// See doGetProblems() in apps_script/Code.js for the backend half.
// ============================================================

Object.assign(state, {
  // key (punch_uuid + '|' + type) -> the problem object, for whatever is
  // currently believed OPEN — both "already popped up" and "already told
  // the backend about". A key leaving this map is the trigger to queue a
  // resolve; a key arriving that wasn't here before is the trigger to pop
  // up and addProblem.
  knownProblems: new Map(),
  // key -> {punch_uuid, type, labelerParam} — problems that stopped
  // reproducing on a recent render, awaiting the next sweep. Reappearing
  // before the sweep runs cancels the entry (see checkProblems()) rather
  // than round-tripping the backend for a one-render flicker.
  pendingResolveProblems: new Map(),
});

const PROBLEM_SWEEP_MS = 45000;   // "a reasonable amount of time" between resolve pings

function problemKey(p) {
  return (p.label.punch_uuid || '') + '|' + p.type;
}

// A problem on a FOREIGN row (admin reviewing someone else's video) has to
// be filed under the ROW'S OWNER, not admin's own identity — same
// owner-redirect every other admin write already does (see
// foreignOwnerLabelerParam() in app.js) — otherwise the same problem would
// show up twice under two different names, or admin's identity would be
// credited with someone else's timing mistake.
function problemLabelerParam(label) {
  if (!label.foreign) return labelerId();
  const owner = typeof foreignOwnerLabelerParam === 'function' ? foreignOwnerLabelerParam(label) : null;
  return owner || labelerId();
}

function postProblem(action, params) {
  if (!state.scriptUrl) return;
  fetchJson(sheetUrl(Object.assign({ action }, params))).catch((e) => {
    console.error('Problem ' + action + ' failed:', e);
  });
}

function postAddProblem(p) {
  postProblem('addProblem', {
    labeler: problemLabelerParam(p.label),
    punch_uuid: p.label.punch_uuid || '',
    type: p.type,
    video: p.label.videoName || state.videoName || '',
    detail: p.text,
    start_sec: String(p.label.start),
  });
}

// `info` is exactly what checkProblems() queued in pendingResolveProblems —
// {punch_uuid, type, labeler} already resolved to the right owner at queue
// time, so this never has to re-derive anything from a label (the label
// may not even exist any more — e.g. the row was deleted, which is itself
// a perfectly good reason for a problem to resolve).
function postResolveProblem(info) {
  postProblem('resolveProblem', {
    labeler: info.labeler,
    punch_uuid: info.punch_uuid,
    type: info.type,
  });
}

// ============================================================
// Detection diff — real-time, called after every render.
// ============================================================
function checkProblems() {
  if (typeof computeProblems !== 'function') return;
  const current = computeProblems();
  const currentKeys = new Set(current.map(problemKey));

  const newlyAppeared = [];
  for (const p of current) {
    const key = problemKey(p);
    if (!state.knownProblems.has(key)) {
      newlyAppeared.push(p);
      postAddProblem(p);
    }
    state.knownProblems.set(key, p);
    // Reappeared before the sweep confirmed it gone — not a real
    // resolution, cancel the pending one.
    state.pendingResolveProblems.delete(key);
  }

  const goneKeys = [];
  for (const key of state.knownProblems.keys()) {
    if (!currentKeys.has(key)) goneKeys.push(key);
  }
  for (const key of goneKeys) {
    const p = state.knownProblems.get(key);
    state.knownProblems.delete(key);
    state.pendingResolveProblems.set(key, {
      punch_uuid: p.label.punch_uuid || '',
      type: p.type,
      labeler: problemLabelerParam(p.label),
    });
  }

  updateProblemsButton(current.length);
  if (newlyAppeared.length) showProblemPopup(newlyAppeared);
}

function updateProblemsButton(count) {
  const badge = document.getElementById('problems-count');
  if (!badge) return;
  badge.hidden = count === 0;
  badge.textContent = String(count);
}

// ============================================================
// Periodic resolve sweep — the delayed half. Whatever is STILL pending
// (i.e. survived every checkProblems() call since it went missing, with no
// reappearance) gets told to the backend now.
// ============================================================
function sweepResolvedProblems() {
  if (!state.pendingResolveProblems.size) return;
  for (const [key, info] of state.pendingResolveProblems) {
    postResolveProblem(info);
    state.pendingResolveProblems.delete(key);
  }
}

// ============================================================
// UI — a popup for what just appeared, and a "View all" list of every
// problem currently open (recomputed live off computeProblems(), not a
// fetch — it's exactly the same detection the popup itself just ran).
// ============================================================
function showProblemPopup(newProblems) {
  const dlg = document.getElementById('problem-popup-dialog');
  const title = document.getElementById('problem-popup-title');
  const body = document.getElementById('problem-popup-body');
  if (!dlg || !title || !body) return;

  if (newProblems.length === 1) {
    title.textContent = 'Timing problem';
    body.innerHTML = `<p class="pred-name-note">${newProblems[0].text}</p>`;
  } else {
    title.textContent = `${newProblems.length} new timing problems`;
    body.innerHTML = '<div class="fvd-rows">' + newProblems.map(p =>
      `<div class="fvd-row"><span class="fvd-name">${p.text}</span></div>`
    ).join('') + '</div>';
  }
  // showModal() throws on an already-open dialog — same guard every other
  // popup in this app uses.
  if (!dlg.open) dlg.showModal();
}

function renderProblemList() {
  const body = document.getElementById('problem-list-body');
  const countEl = document.getElementById('problem-list-count');
  if (!body || typeof computeProblems !== 'function') return;

  const problems = computeProblems().sort((a, b) => a.label.start - b.label.start);
  if (countEl) countEl.textContent = `(${problems.length})`;
  if (!problems.length) {
    body.innerHTML = '<p class="fvd-lede">No open timing problems.</p>';
    return;
  }
  body.innerHTML = '<div class="fvd-rows">' + problems.map((p, i) =>
    `<div class="fvd-row problem-list-row" data-i="${i}"><span class="fvd-name">` +
    `<strong>${formatTime(p.label.start)}</strong><span class="fvd-split"><span>${p.text}</span></span>` +
    `</span></div>`
  ).join('') + '</div>';

  body.querySelectorAll('.problem-list-row').forEach((row) => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      const p = problems[+row.dataset.i];
      if (typeof highlightLabel === 'function') highlightLabel(p.label);
      const video = document.getElementById('video-player');
      if (video) video.currentTime = p.label.start;
      document.getElementById('problem-list-dialog')?.close();
    });
  });
}

function openProblemList() {
  const listDlg = document.getElementById('problem-list-dialog');
  if (!listDlg) return;
  renderProblemList();
  if (!listDlg.open) listDlg.showModal();
}

function setupProblemDialogs() {
  const popup = document.getElementById('problem-popup-dialog');
  const listDlg = document.getElementById('problem-list-dialog');
  if (!popup || !listDlg) return;

  const closePopup = () => popup.close();
  document.getElementById('problem-popup-close')?.addEventListener('click', closePopup);
  document.getElementById('problem-popup-close-x')?.addEventListener('click', closePopup);
  popup.addEventListener('click', (e) => { if (e.target === popup) closePopup(); });

  document.getElementById('problem-popup-viewall')?.addEventListener('click', () => {
    closePopup();
    openProblemList();
  });

  // Standing entry point in the nav bar — same list, reachable any time,
  // not just right after a popup. See #btn-problems in index.html.
  document.getElementById('btn-problems')?.addEventListener('click', openProblemList);

  const closeList = () => listDlg.close();
  document.getElementById('problem-list-close-x')?.addEventListener('click', closeList);
  listDlg.addEventListener('click', (e) => { if (e.target === listDlg) closeList(); });
}

document.addEventListener('DOMContentLoaded', () => {
  setupProblemDialogs();
  setInterval(sweepResolvedProblems, PROBLEM_SWEEP_MS);
});

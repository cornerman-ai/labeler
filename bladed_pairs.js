// ============================================================
// bladed_pairs.js — pairwise bladedness labeler, shared by both passes
//
// Two frames, one question: which boxer is turned the most? Keys 1 / 2, or
// click. The page that loads this file sets window.BP_MANIFEST and asks the
// question in its own words:
//
//   shoulder_bladedness.html -> shoulder_bladedness.json -> "Bladed Pairs Shoulders"
//   hip_bladedness.html      -> hip_bladedness.json      -> "Bladed Pairs Hips"
//
// ONE ATTRIBUTE PER PASS. Shoulders and hips are asked separately, over
// separate pair lists. Both questions on the same pair would invite a halo
// effect — a single global "looks bladed" impression answering both — which
// would manufacture the very shoulder/hip agreement we are running this to
// measure. The manifest's `attribute` field says which question this build is,
// and the page renders it as a badge so it cannot be mistaken.
// S records "cannot read this frame", U undoes the last answer.
//
// S IS NOT A TIE BUTTON. Bradley-Terry has no tie term here, so a skip is a
// discarded comparison — and near-ties are the most informative pairs in the
// set, because they are what fixes the scale's spacing. A coin-flip guess on a
// genuine near-tie costs almost nothing: the errors cancel across judges, and
// the 50/50 split is itself the signal that the two frames are close. So S is
// reserved for frames that cannot be judged at all — blur, occlusion, the
// boxer out of stance — which is a property of the image, not of the pair.
//
// WHY PAIRWISE RATHER THAN A RATING SCALE. Judging how far a torso is rotated
// away from you in a single image is a task humans are measurably bad at —
// perceived slant runs about 0.56 of the true value, so an angle-bucket scale
// would record a compressed version of the labeler's visual bias rather than
// the stance. Visual posture rating from photographs tops out around kappa
// 0.5 between raters. Comparative judgement asks only for a local ordering,
// which people are reliable at, and reaches scale reliability of roughly
// 0.85-0.9. The scores come out of a Bradley-Terry fit run offline.
//
// Pairs come baked into the manifest (cornerman-backend's
// build_pair_labeler.py / build_hip_pair_labeler.py). They are FIXED and
// seeded so that every labeler answers the same comparisons — that is the only
// way inter-rater agreement is computable, and inter-rater agreement is the
// ceiling on what any metric can score against these labels. Some pairs are
// hidden repeats of an earlier comparison, left/right swapped; the page must
// stay unaware of them, so it treats `_repeat_of` like any other `_` key.
//
// Nothing on this page reveals a metric value. The manifest carries them for
// the offline join, prefixed with `_`, and they are never rendered — a labeler
// who saw them would be anchored by them.
//
// Saved to the "Bladed Pairs <Attribute>" sheet (one sheet per attribute) via
// saveBladedPair / listBladedPairs,
// keyed by (labeler, pair_id). A re-answer supersedes (soft deleted=1).
// ============================================================

// Set by the page. No default on purpose: a page that forgot it would quietly
// serve the OTHER pass's comparisons, which is worse than not loading.
const MANIFEST = window.BP_MANIFEST;

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';

const S = {
  items: [], pairs: [],
  queue: [],          // pair indices still to answer
  cursor: 0,
  answered: 0,
  history: [],        // {pairIdx, winner} for undo
  labeler: '', attribute: '',        // attribute comes from the manifest
  // pairId -> {winner, skip_reason}. The queue holds EVERY pair now, not only
  // the unanswered ones, so the arrows can walk back into work already done —
  // and landing on an answered pair has to show what you picked.
  picked: new Map(),
  startedAt: null,
  busy: false,      // only guards undo, which is rare and does block
  outbox: [],       // answers accepted by the UI, not yet in the sheet
  sending: false,
  failing: 0,       // consecutive failed send cycles
};

// ─── sheet plumbing ────────────────────────────────────────────────────────
// Apps Script's /exec intermittently 404s or serves an HTML error page under
// quick successive requests, which is exactly a labeler's normal pace. Retry
// transport failures with backoff; a JSON-level error is a real answer from
// the backend and is never retried. (Same approach as chin_tuck.js.)
function sheetUrl(params) {
  const url = new URL(SCRIPT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function fetchSheetJson(url, what, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise(r => setTimeout(r, 800 * 2 ** (i - 1)));
    let res;
    try { res = await fetch(url); } catch (e) { lastErr = e; continue; }
    if (!res.ok) { lastErr = new Error(what + ' HTTP ' + res.status); continue; }
    let body;
    try { body = await res.json(); } catch { lastErr = new Error(what + ': non-JSON'); continue; }
    if (body.status !== 'ok') throw new Error(what + ': ' + (body.message || 'unknown'));
    return body;
  }
  throw lastErr;
}

// Progress is per (labeler, attribute) — answering the shoulder pass must not
// mark the hip pass done.
const listPairs = (labeler, attribute) =>
  fetchSheetJson(sheetUrl({ action: 'listBladedPairs', labeler, attribute }), 'listBladedPairs')
    .then(b => b.rows);

const savePair = ({ labeler, attribute, pair_id, left, right, winner, skip_reason }) =>
  fetchSheetJson(sheetUrl({
    action: 'saveBladedPair', labeler, attribute,
    pair_id: String(pair_id),
    left_video: left.video, left_round: String(left.round), left_frame: String(left.frame),
    right_video: right.video, right_round: String(right.round), right_frame: String(right.frame),
    winner: winner || '', skip_reason: skip_reason || '',
  }), 'saveBladedPair');

const deletePair = ({ labeler, attribute, pair_id }) =>
  fetchSheetJson(sheetUrl({ action: 'deleteBladedPair', labeler, attribute,
                            pair_id: String(pair_id) }), 'deleteBladedPair');

// ─── ui ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function setStatus(text, cls) {
  const el = $('bp-status');
  el.textContent = text;
  el.className = cls || '';
}

function paint() {
  if (S.cursor >= S.queue.length) return finish();
  const p = S.pairs[S.queue[S.cursor]];
  $('bp-img-l').src = S.items[p.l].img;
  $('bp-img-r').src = S.items[p.r].img;

  // Re-answering supersedes, so an already-answered pair shows its pick rather
  // than looking blank — otherwise walking back reads as "my answer is gone".
  const prev = S.picked.get(p.id);
  $('bp-left').classList.toggle('picked', prev?.winner === 'left');
  $('bp-right').classList.toggle('picked', prev?.winner === 'right');
  $('bp-seen').classList.toggle('hidden', !prev);
  if (prev) {
    $('bp-seen').textContent = prev.winner
      ? `answered: ${prev.winner} — answer again to change it`
      : 'marked unreadable — answer again to change it';
  }
  $('bp-prev').disabled = S.cursor === 0;
  $('bp-next').disabled = S.cursor >= S.queue.length - 1;

  const total = S.pairs.length;
  const done = S.answered;
  $('bp-pos').textContent = `#${S.cursor + 1}`;
  $('bp-count').textContent = `${done} / ${total}`;
  $('bp-progress-fill').style.width = (done / total * 100) + '%';

  // Pace shown only after a few answers, when it means something.
  if (S.startedAt && done > 5) {
    const perSec = (Date.now() - S.startedAt) / 1000 / (done - S.startedAtDone);
    const left = Math.round((total - done) * perSec / 60);
    $('bp-rate').textContent = `~${perSec.toFixed(1)}s each · ~${left} min left`;
  }
  preloadNext();
}

// Move without answering. Deliberately does NOT skip over answered pairs: the
// arrows exist to go back and look at a call you are second-guessing, and
// silently landing somewhere else would defeat that.
function go(delta) {
  const next = S.cursor + delta;
  if (next < 0 || next >= S.queue.length) return;
  S.cursor = next;
  paint();
}

// Preload the next two pairs' images. The answer now advances instantly, so a
// cold image fetch is the only remaining stall — and a stalled labeler starts
// guessing. Two ahead covers a fast burst of easy calls.
function preloadNext() {
  for (const step of [1, 2]) {
    const nx = S.queue[S.cursor + step];
    if (nx === undefined) return;
    const p = S.pairs[nx];
    for (const i of [p.l, p.r]) { const im = new Image(); im.src = S.items[i].img; }
  }
}

// ANSWERING IS OPTIMISTIC. The Apps Script round trip is ~1.5-3s; blocking the
// next pair on it would add half an hour of dead time across 1000 judgements,
// and a labeler kept waiting mid-rhythm gets worse, not just slower. So the UI
// advances immediately and the answer goes into an outbox that drains in the
// background. Nothing is dropped: a send that fails is retried, stays in the
// outbox until it succeeds, and the tab warns before closing with work pending.
function answer(winner, skipReason) {
  if (S.cursor >= S.queue.length) return;
  if (!S.labeler) { setStatus('enter your name first', 'err'); $('bp-labeler').focus(); return; }
  const pairIdx = S.queue[S.cursor];
  const p = S.pairs[pairIdx];

  S.outbox.push({
    kind: 'save', pairId: p.id,
    payload: {
      labeler: S.labeler, attribute: S.attribute, pair_id: p.id,
      left: S.items[p.l], right: S.items[p.r],
      winner, skip_reason: skipReason,
    },
  });
  S.history.push({ pairIdx });
  if (!S.picked.has(p.id)) S.answered++;      // re-answering supersedes, not adds
  S.picked.set(p.id, { winner, skip_reason: skipReason });
  if (S.startedAt === null) { S.startedAt = Date.now(); S.startedAtDone = S.answered; }

  // Forward one. At the end, fall back to the first pair still unanswered —
  // browsing back and answering out of order must not strand the gaps.
  if (S.cursor < S.queue.length - 1) {
    S.cursor++;
  } else {
    const gap = S.queue.findIndex(i => !S.picked.has(S.pairs[i].id));
    if (gap === -1) return finish(), pump();
    S.cursor = gap;
  }
  paint();
  pump();
}

// Undo is optimistic too, and queues rather than races.
//
// If the save is still waiting its turn, the sheet never saw it — drop it and
// no round trip happens at all. If it is already in flight or written, a delete
// goes into the SAME queue, behind it. Ordering matters: a delete overtaking
// its own save would leave the undone answer sitting in the sheet.
function undo() {
  if (!S.history.length) return;
  const last = S.history.pop();
  const p = S.pairs[last.pairIdx];

  const q = S.outbox.findIndex(o => o.kind === 'save' && o.pairId === p.id && !o.sending);
  if (q !== -1) {
    S.outbox.splice(q, 1);
  } else {
    S.outbox.push({
      kind: 'delete', pairId: p.id,
      payload: { labeler: S.labeler, attribute: S.attribute, pair_id: p.id },
    });
  }

  if (S.picked.delete(p.id)) S.answered = Math.max(0, S.answered - 1);
  S.cursor = S.queue.indexOf(last.pairIdx);
  $('bp-done').classList.add('hidden');
  $('bp-stage').classList.remove('hidden');
  paint();
  showQueue('undone');
  pump();
}

// Drains the outbox strictly in order, one at a time — the sheet handler
// appends and soft-deletes by (labeler, pair_id), so concurrent writes would
// race on the same rows, and a delete must never pass its own save.
async function pump() {
  if (S.sending) return;
  S.sending = true;
  try {
    while (S.outbox.length) {
      const job = S.outbox[0];
      job.sending = true;                 // undo must not splice this from under us
      try {
        await (job.kind === 'delete' ? deletePair(job.payload) : savePair(job.payload));
        // Remove by identity: undo may have spliced other jobs meanwhile, so
        // index 0 is not guaranteed to still be this job.
        const i = S.outbox.indexOf(job);
        if (i !== -1) S.outbox.splice(i, 1);
        S.failing = 0;
        showQueue();
      } catch (e) {
        // fetchSheetJson already retried with backoff. Keep the job and say so —
        // an answer silently on the floor is the one outcome that would quietly
        // corrupt the dataset.
        job.sending = false;
        S.failing++;
        setStatus(`not saved (${S.outbox.length} pending) — ${e.message || e}`, 'err');
        await new Promise(r => setTimeout(r, Math.min(30000, 3000 * S.failing)));
      }
    }
  } finally {
    S.sending = false;
  }
}

function showQueue(prefix) {
  const p = prefix ? prefix + ' · ' : '';
  if (S.outbox.length) setStatus(`${p}saving ${S.outbox.length}…`);
  else setStatus(p ? prefix : 'saved', 'ok');
}

function finish() {
  $('bp-stage').classList.add('hidden');
  $('bp-foot').classList.add('hidden');
  $('bp-question').classList.add('hidden');
  $('bp-hint').classList.add('hidden');
  $('bp-done').classList.remove('hidden');
  $('bp-done-detail').textContent = S.outbox.length
    ? `${S.answered} ${S.attribute} comparisons as "${S.labeler}" — ${S.outbox.length} still uploading, keep this tab open.`
    : `${S.answered} ${S.attribute} comparisons saved as "${S.labeler}".`;
}

// ─── boot ──────────────────────────────────────────────────────────────────
async function rebuildQueue() {
  S.labeler = $('bp-labeler').value.trim();
  localStorage.setItem('bp_labeler', S.labeler);
  if (!S.labeler) { setStatus('enter your name to start', 'err'); return; }

  setStatus('loading your progress…');
  S.picked = new Map();
  try {
    const rows = await listPairs(S.labeler, S.attribute);
    for (const r of rows) {
      S.picked.set(Number(r.pair_id), { winner: r.winner, skip_reason: r.skip_reason });
    }
  } catch (e) {
    // Offline or backend down: start from the top rather than blocking. A
    // duplicate answer supersedes the old row, so re-answering is harmless.
    setStatus('could not read progress — starting from the top', 'err');
  }
  // Every pair, in order — the arrows need the answered ones to still be there.
  S.queue = S.pairs.map((_, i) => i);
  S.answered = S.picked.size;
  const gap = S.queue.findIndex(i => !S.picked.has(S.pairs[i].id));
  S.cursor = gap === -1 ? S.queue.length : gap;
  S.history = [];
  S.outbox = [];
  S.startedAt = null;
  $('bp-done').classList.add('hidden');
  $('bp-stage').classList.remove('hidden');
  $('bp-foot').classList.remove('hidden');
  $('bp-question').classList.remove('hidden');
  $('bp-hint').classList.remove('hidden');
  if (S.cursor >= S.queue.length) return finish();
  setStatus(S.answered ? `resuming — ${S.answered} already done` : 'ready', 'ok');
  paint();
}

async function boot() {
  if (!MANIFEST) { setStatus('page bug: window.BP_MANIFEST is not set', 'err'); return; }
  const res = await fetch(MANIFEST, { cache: 'no-cache' });
  const data = await res.json();
  S.items = data.items;
  S.pairs = data.pairs;
  S.attribute = data.attribute;
  document.getElementById('bp-attr').textContent = S.attribute;

  const saved = localStorage.getItem('bp_labeler');
  if (saved) $('bp-labeler').value = saved;

  $('bp-labeler').addEventListener('change', rebuildQueue);
  $('bp-left').addEventListener('click', () => answer('left'));
  $('bp-right').addEventListener('click', () => answer('right'));
  $('bp-skip').addEventListener('click', () => answer('', 'unreadable'));
  $('bp-undo').addEventListener('click', undo);
  $('bp-prev').addEventListener('click', () => go(-1));
  $('bp-next').addEventListener('click', () => go(1));

  document.addEventListener('keydown', e => {
    if (document.activeElement === $('bp-labeler')) return;
    if (e.key === '1') { e.preventDefault(); answer('left'); }
    else if (e.key === '2') { e.preventDefault(); answer('right'); }
    else if (e.key.toLowerCase() === 's') { e.preventDefault(); answer('', 'unreadable'); }
    else if (e.key.toLowerCase() === 'u') { e.preventDefault(); undo(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });

  window.addEventListener('beforeunload', e => {
    if (!S.outbox.length) return;
    e.preventDefault();
    e.returnValue = '';
  });

  if (saved) rebuildQueue();
  else setStatus('enter your name to start');
}

boot();

// ============================================================
// shoulder_bladedness.js — pairwise SHOULDER-bladedness labeler
//
// Two frames, one question: which boxer's SHOULDERS are turned the most?
// Keys 1 / 2, or click.
//
// ONE ATTRIBUTE PER PASS. Hips are asked separately, over a separate pair list.
// Both questions on the same pair would invite a halo effect — a single global
// "looks bladed" impression answering both — which would manufacture the very
// shoulder/hip agreement we are running this to measure. The manifest's
// `attribute` field says which question this build is, and the page renders it
// as a badge so it cannot be mistaken.
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
// Pairs come baked into shoulder_bladedness.json (cornerman-backend's
// build_pair_labeler.py). They are FIXED and seeded so that every labeler
// answers the same comparisons — that is the only way inter-rater agreement
// is computable, and inter-rater agreement is the ceiling on what any metric
// can score against these labels.
//
// Nothing on this page reveals a metric value. The manifest carries them for
// the offline join, prefixed with `_`, and they are never rendered — a labeler
// who saw them would be anchored by them.
//
// Saved to the "Bladed Pairs Shoulders" sheet (one sheet per attribute) via
// saveBladedPair / listBladedPairs,
// keyed by (labeler, pair_id). A re-answer supersedes (soft deleted=1).
// ============================================================

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';

const S = {
  items: [], pairs: [],
  queue: [],          // pair indices still to answer
  cursor: 0,
  answered: 0,
  history: [],        // {pairIdx, winner} for undo
  labeler: '', attribute: 'shoulders',
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
  $('bp-left').classList.remove('picked');
  $('bp-right').classList.remove('picked');

  const total = S.pairs.length;
  const done = S.answered;
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
  S.answered++;
  S.cursor++;
  if (S.startedAt === null) { S.startedAt = Date.now(); S.startedAtDone = S.answered; }
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

  S.answered = Math.max(0, S.answered - 1);
  S.cursor = Math.max(0, S.cursor - 1);
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
  let done = new Set();
  try {
    const rows = await listPairs(S.labeler, S.attribute);
    for (const r of rows) done.add(Number(r.pair_id));
  } catch (e) {
    // Offline or backend down: start from the top rather than blocking. A
    // duplicate answer supersedes the old row, so re-answering is harmless.
    setStatus('could not read progress — starting from the top', 'err');
  }
  S.queue = S.pairs.map((_, i) => i).filter(i => !done.has(S.pairs[i].id));
  S.answered = done.size;
  S.cursor = 0;
  S.history = [];
  S.outbox = [];
  S.startedAt = null;
  $('bp-done').classList.add('hidden');
  $('bp-stage').classList.remove('hidden');
  $('bp-foot').classList.remove('hidden');
  $('bp-question').classList.remove('hidden');
  $('bp-hint').classList.remove('hidden');
  if (!S.queue.length) return finish();
  setStatus(done.size ? `resuming — ${done.size} already done` : 'ready', 'ok');
  paint();
}

async function boot() {
  const res = await fetch('./shoulder_bladedness.json', { cache: 'no-cache' });
  const data = await res.json();
  S.items = data.items;
  S.pairs = data.pairs;
  S.attribute = data.attribute || 'shoulders';
  document.getElementById('bp-attr').textContent = S.attribute;

  const saved = localStorage.getItem('bp_labeler');
  if (saved) $('bp-labeler').value = saved;

  $('bp-labeler').addEventListener('change', rebuildQueue);
  $('bp-left').addEventListener('click', () => answer('left'));
  $('bp-right').addEventListener('click', () => answer('right'));
  $('bp-skip').addEventListener('click', () => answer('', 'unreadable'));
  $('bp-undo').addEventListener('click', undo);

  document.addEventListener('keydown', e => {
    if (document.activeElement === $('bp-labeler')) return;
    if (e.key === '1') { e.preventDefault(); answer('left'); }
    else if (e.key === '2') { e.preventDefault(); answer('right'); }
    else if (e.key.toLowerCase() === 's') { e.preventDefault(); answer('', 'unreadable'); }
    else if (e.key.toLowerCase() === 'u') { e.preventDefault(); undo(); }
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

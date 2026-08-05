// ============================================================
// bladed_pairs.js — pairwise bladedness labeler
//
// Two frames, one question: which boxer is more bladed? Keys 1 / 2, or click.
// S records "too close to call", U undoes the last answer.
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
// Pairs come baked into bladed_pairs.json (cornerman-backend's
// build_pair_labeler.py). They are FIXED and seeded so that every labeler
// answers the same comparisons — that is the only way inter-rater agreement
// is computable, and inter-rater agreement is the ceiling on what any metric
// can score against these labels.
//
// Nothing on this page reveals a metric value. The manifest carries them for
// the offline join, prefixed with `_`, and they are never rendered — a labeler
// who saw them would be anchored by them.
//
// Saved to the "Bladed Pairs" sheet via saveBladedPair / listBladedPairs,
// keyed by (labeler, pair_id). A re-answer supersedes (soft deleted=1).
// ============================================================

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';

const S = {
  items: [], pairs: [],
  queue: [],          // pair indices still to answer
  cursor: 0,
  answered: 0,
  history: [],        // {pairIdx, winner} for undo
  labeler: '',
  startedAt: null,
  busy: false,
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

const listPairs = labeler =>
  fetchSheetJson(sheetUrl({ action: 'listBladedPairs', labeler }), 'listBladedPairs')
    .then(b => b.rows);

const savePair = ({ labeler, pair_id, left, right, winner, skip_reason }) =>
  fetchSheetJson(sheetUrl({
    action: 'saveBladedPair', labeler,
    pair_id: String(pair_id),
    left_video: left.video, left_round: String(left.round), left_frame: String(left.frame),
    right_video: right.video, right_round: String(right.round), right_frame: String(right.frame),
    winner: winner || '', skip_reason: skip_reason || '',
  }), 'saveBladedPair');

const deletePair = ({ labeler, pair_id }) =>
  fetchSheetJson(sheetUrl({ action: 'deleteBladedPair', labeler, pair_id: String(pair_id) }),
                 'deleteBladedPair');

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

// Preload the next pair's images. At ~4s per judgement a cold image fetch is a
// visible stall, and a stalled labeler starts guessing.
function preloadNext() {
  const nx = S.queue[S.cursor + 1];
  if (nx === undefined) return;
  const p = S.pairs[nx];
  for (const i of [p.l, p.r]) { const im = new Image(); im.src = S.items[i].img; }
}

async function answer(winner, skipReason) {
  if (S.busy || S.cursor >= S.queue.length) return;
  if (!S.labeler) { setStatus('enter your name first', 'err'); $('bp-labeler').focus(); return; }
  const pairIdx = S.queue[S.cursor];
  const p = S.pairs[pairIdx];
  if (winner) $(winner === 'left' ? 'bp-left' : 'bp-right').classList.add('picked');

  S.busy = true;
  setStatus('saving…');
  try {
    await savePair({
      labeler: S.labeler, pair_id: p.id,
      left: S.items[p.l], right: S.items[p.r],
      winner, skip_reason: skipReason,
    });
    S.history.push({ pairIdx });
    S.answered++;
    S.cursor++;
    if (S.startedAt === null) { S.startedAt = Date.now(); S.startedAtDone = S.answered; }
    setStatus('saved', 'ok');
    paint();
  } catch (e) {
    // Do NOT advance on a failed save — a silently dropped judgement would
    // leave a hole that only shows up as a missing comparison much later.
    setStatus(String(e.message || e), 'err');
    $('bp-left').classList.remove('picked');
    $('bp-right').classList.remove('picked');
  } finally {
    S.busy = false;
  }
}

async function undo() {
  if (S.busy || !S.history.length) return;
  const last = S.history.pop();
  const p = S.pairs[last.pairIdx];
  S.busy = true;
  setStatus('undoing…');
  try {
    await deletePair({ labeler: S.labeler, pair_id: p.id });
    S.answered = Math.max(0, S.answered - 1);
    S.cursor = Math.max(0, S.cursor - 1);
    $('bp-done').classList.add('hidden');
    $('bp-stage').classList.remove('hidden');
    setStatus('undone', 'ok');
    paint();
  } catch (e) {
    S.history.push(last);
    setStatus(String(e.message || e), 'err');
  } finally { S.busy = false; }
}

function finish() {
  $('bp-stage').classList.add('hidden');
  $('bp-foot').classList.add('hidden');
  $('bp-question').classList.add('hidden');
  $('bp-hint').classList.add('hidden');
  $('bp-done').classList.remove('hidden');
  $('bp-done-detail').textContent =
    `${S.answered} comparisons saved as "${S.labeler}".`;
}

// ─── boot ──────────────────────────────────────────────────────────────────
async function rebuildQueue() {
  S.labeler = $('bp-labeler').value.trim();
  localStorage.setItem('bp_labeler', S.labeler);
  if (!S.labeler) { setStatus('enter your name to start', 'err'); return; }

  setStatus('loading your progress…');
  let done = new Set();
  try {
    const rows = await listPairs(S.labeler);
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
  const res = await fetch('./bladed_pairs.json', { cache: 'no-cache' });
  const data = await res.json();
  S.items = data.items;
  S.pairs = data.pairs;

  const saved = localStorage.getItem('bp_labeler');
  if (saved) $('bp-labeler').value = saved;

  $('bp-labeler').addEventListener('change', rebuildQueue);
  $('bp-left').addEventListener('click', () => answer('left'));
  $('bp-right').addEventListener('click', () => answer('right'));
  $('bp-skip').addEventListener('click', () => answer('', 'too_close'));
  $('bp-undo').addEventListener('click', undo);

  document.addEventListener('keydown', e => {
    if (document.activeElement === $('bp-labeler')) return;
    if (e.key === '1') { e.preventDefault(); answer('left'); }
    else if (e.key === '2') { e.preventDefault(); answer('right'); }
    else if (e.key.toLowerCase() === 's') { e.preventDefault(); answer('', 'too_close'); }
    else if (e.key.toLowerCase() === 'u') { e.preventDefault(); undo(); }
  });

  if (saved) rebuildQueue();
  else setStatus('enter your name to start');
}

boot();

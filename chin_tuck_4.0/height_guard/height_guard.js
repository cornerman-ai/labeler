// height_guard.js — chin-point labeler 4.0.
//
// GEOMETRY, not a verdict. 1.0–3.0 asked for judgements (over/level/under,
// four questions, one question) and the inter-rater runs kept coming back
// below trainable — and because the output was a category, WHY two people
// disagreed was invisible. 4.0 stores what the labeler can actually be
// precise about: click the chin tip, click the top of the lead shoulder.
// Over/level/under is DERIVED downstream from the two points; disagreement
// becomes a distance in pixels, diagnosable per point; and the clicks
// double as calibration for the pipeline (human shoulder vs BlazePose's,
// human chin vs the nose→mouth extrapolation).
//
// The frames are NON-PUNCH by construction (chin_sampler_v3.py: every frame
// sits >0.5s from every labeled punch, in a round that has punch labels).
// So the shoulder to mark is always the stance-lead shoulder, in guard —
// "top of the deltoid" means one thing on every frame in this queue.
//
// Frames come from FIREBASE STORAGE, not this repo — 2.0's 724MB of JPEGs
// left no Pages budget for another generation, so 4.0's images live in the
// project bucket behind a shared download token and git carries only code
// and height_guard_queue.json. See cornerman-backend ml/research/chin_tuck/v3/.
//
// NOTHING on this page shows a labeler anyone else's WORK. Not the
// pipeline's points (BlazePose shoulders, extrapolated chin), not the other
// labelers' placements — no answer, no click, is ever visible to anybody
// but the person who made it. Whoever can see another answer anchors on
// it, and an anchored click is not a second opinion — it is the first one,
// copied.
//
// "Everyone's progress" (the foldable panel, ported from 3.0 in 2026-08 —
// see loadRoster()/renderTeamPanel()) is the one exception to "not how far
// along anybody is," and deliberately a narrow one: it shows a count and
// WHICH queue positions somebody has touched, never what they answered
// there. A frame's dot on the shared bar carries no colour, no verdict —
// just "done" or not — so there is nothing in it for a click to anchor on.
//

// PARTIAL SAVES (2026-08): a row can carry the chin alone, the shoulder
// alone, both, or (a skip) neither — the backend no longer requires the
// pair. Partial is provisional by design, meant to be overwritten once the
// second point lands, so it never counts toward "done" (isResolved/
// hasPoints still require the full pair) — it just gets its own colour on
// the overview (see 'part' in renderOverview()) instead of being invisible
// until finished. Leaving a frame with ZERO points and no explicit skip
// writes NOTHING (commitCurrent()) — just passing through a frame must not
// cost a row, so it stays exactly as unlabeled as it was before.
//
// REPEATS: ~10% of queue slots are the same frame planted again (rep=1),
// blind, ≥200 slots downstream. rep is part of the row identity end to end
// — key(), the sheet, the backend — so the pair measures the labeler's own
// click scatter instead of collapsing into one row.
//
// The backend OVERWRITES IN PLACE (saveChinPoint), same as 2.0/3.0: a save
// for a (video,round,frame,rep) that already has a row replaces it, and only
// a new identity appends. A re-label is not kept as separate history.
//
// Position resumes from your own saved rows, never from this browser.
//
// Not ported from 3.0: reviewer mode + disagreement jump, pairwise
// agreement panel, comparison grid, exclude-video, lead-everyone. "Lead
// everyone" stays out of the normal page for the usual reason (every
// labeler getting write access to the whole team's sheet is an admin
// capability, not a progress-panel feature) — but admin mode has no
// version of it either here (#lead-row/#lead-mask are styled in the
// stylesheet from an earlier plan but nothing renders or wires them; see
// the note where the normal page's team panel omits it, below).

'use strict';

// Last-resort safety net (2026-08). Two labelers — most plausibly two
// people both in admin mode at once, editing the same teammate's row from
// two tabs — hitting the exact same moment in a way this file's explicit
// try/catch blocks don't anticipate must show up as a visible message the
// labeler can act on, never a silently frozen page. Deliberately does not
// try to keep going: state may be inconsistent after an uncaught error, so
// this only says so, pointing at a reload, rather than pretending nothing
// happened.
function reportUncaught(err) {
  try {
    const msg = (err && err.message) || String(err);
    status(`Something went wrong (${msg}) — reload the page.`, 'err');
  } catch (e) { /* the DOM itself is what's broken; nothing left to do */ }
}
window.addEventListener('error', (e) => reportUncaught(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportUncaught(e.reason));

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';

// Row identity fields — mirrors CS4_FIELDS in apps_script/Code.js.
const FIELDS = ['chin_x', 'chin_y', 'sh_x', 'sh_y'];
const PREFETCH = 4;

// Overview grid geometry — same numbers as 3.0's BATCH/BATCH_COLS, so the
// two generations' progress bars lay out identically: a batch is 100 frames
// as five rows of 20.
const BATCH = 100;
const BATCH_COLS = 20;

// Where the frames live. Path + one shared token — every object carries the
// same firebaseStorageDownloadTokens value, stamped at upload
// (chin_upload_frames.py). Rotating the token means re-stamping every
// object AND shipping this constant.
const FRAME_BUCKET = 'mycorner-bee6a.firebasestorage.app';
const FRAME_PREFIX = 'labeler_media/chin_tuck/v4/height_guard_v4_frames/frames';
const FRAME_TOKEN = '628dbeba-2969-4f45-b65e-5b295ef56fdc';

const MIN_ZOOM = 1 / 3;
const MAX_ZOOM = 12;
// Past this many DEVICE pixels per SOURCE pixel the frame is drawn
// pixel-for-pixel instead of smoothed — see #stage.sharp. Measured in device
// pixels so a retina laptop and a 1080p monitor agree, and against the frame's
// own resolution so a 360x640 clip and a 1080p clip are judged by how far each
// is really being stretched, not by the zoom number on top of it.
const SHARP_MAG = 1.5;
// ...and only for sources with this many pixels on the short side. Below HD
// the grid is as coarse as the anatomy being clicked (a 360x640 clip is a
// fifth of the queue's frames), and the smooth gradient says more about where
// the jaw edge lies than a field of flat squares does. A property of the
// FRAME, not of the screen: every labeler must see the same frame the same
// way, whatever monitor they are on.
const SHARP_MIN_SOURCE = 720;
const ZOOM_SPEED = 0.0018;
// A click is a click if the mouse moved less than this many screen px
// between down and up; anything longer is a pan (or a point drag).
const CLICK_SLOP_PX = 4;
// Grab an existing point when the mousedown lands within this many SCREEN
// px of it — screen, not image: at 12x a labeler aiming at a dot should not
// need 12x the precision to pick it back up.
const GRAB_PX = 10;

const DWELL_CAP_SEC = 120;

// Short forms of the skip reasons, for the button once a frame is skipped.
// 'unmarked' is never offered in the K popover and commitCurrent() no
// longer writes it (2026-08) — kept here only so rows saved before that
// change still render a label instead of a raw enum value.
const SKIP_LABELS = {
  not_visible: "can't see the points", no_stance: 'not in stance',
  unmarked: 'left blank',
};

// ── everyone's progress ────────────────────────────────────────────────
// Ported from 3.0's #team panel — see the file header for why 4.0's
// original no-peers stance was reversed for this one panel. Shows
// aggregate counts and each labeler's frame ranges, never an actual
// answer, so it does not reopen the anchoring risk the peers panel and
// per-frame overlay were removed for.
const HIDE_KEY = 'cs4_hidden';        // localStorage: names hidden from MY OWN team list
const RANGE_KEY = 'cs4_ranges';       // localStorage: cached per-labeler frame ranges
const RANGE_FRESH_MS = 60000;         // don't re-read a labeler's full tab more often than this
// localStorage: admin's chosen agreement threshold, chin and shoulder
// separately (percent, 1-50) — two independent landmarks, no reason a
// single dial should have to fit both.
const THRESH_KEY_CHIN = 'cs4_agree_thresh_chin';
const THRESH_KEY_SH = 'cs4_agree_thresh_sh';
// localStorage: which of the three metric grids are folded shut — a
// per-device view preference (like HIDE_KEY above), never anything that
// reaches the sheet.
const FOLD_KEY = 'cs4_metric_folded';
const EYE_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.6 8s2.3-3.8 6.4-3.8S14.4 8 14.4 8s-2.3 3.8-6.4 3.8S1.6 8 1.6 8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.7" stroke="currentColor" stroke-width="1.3"/></svg>';
const CHEV_SVG = '<svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2.5 4 5 6.5 7.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ── admin mode ──────────────────────────────────────────────────────────
// Reached by logging in as the literal name "admin" (any case — see
// state.isAdmin, set in start()). Shows every labeler's points at once and
// saves corrections under THAT labeler's identity via the same
// saveChinPoint action everyone else uses — it already accepts an
// arbitrary `labeler` param with no ownership check. Every admin-only
// function below checks state.isAdmin itself (or is only ever called from
// a call site that does), so a normal login never runs any of this.
//
// ADMIN CAN CORRECT, NEVER CREATE (2026-08). Placing a brand-new point is
// the ACT of being a labeler — a click+popover flow that answers "did you
// see it" as if admin were the one looking — and admin's whole job is
// reviewing and correcting that work from outside, never impersonating
// it. So admin has no "own" identity at all: activeLabeler() returns null
// for it unconditionally, which makes commitCurrent()/save() (the
// single-identity placement path everyone else uses) permanently inert —
// see their own comments. Every roster member's EXISTING points, and only
// those, are what admin can touch: drag on canvas (grabbableTeammatePoint)
// or the switch on their own "Points — Name" card (setAdminVis), both
// saving IMMEDIATELY via saveTeammateRow() — there is no single "leaving
// frame" identity left to hang a deferred commit off when several
// teammates could be mid-correction at once. The two tool-rows, the K/G/C/
// S shortcuts, Save & Next, Skip — everything that would place, answer, or
// skip AS a labeler — stay hidden and inert for admin; see body.admin in
// the stylesheet and the keydown handler in bind().
const TEAM_COLOR_COUNT = 8;          // matches the --team-color-N custom properties
// Roster (who/how-far-along) is polled in BOTH modes — a labeler working
// concurrently in another tab should move on the progress panel without a
// reload. The much heavier per-labeler row data (admin's state.teamRows)
// is NOT polled — an admin session is minutes long, and re-fetching
// everyone's full history on a timer would cost far more than it buys.
// Matches 3.0's TEAM_POLL_MS.
const TEAM_POLL_MS = 45000;
// The overview's disagreement gradient AND the agreement card below both
// compare exactly this pair — nobody else, not "whoever's in the roster."
// A frame either of these two labelers didn't answer simply isn't part of
// either computation, even if a third labeler placed points on it.
// Changeable mid-session (the two selects in #agree-pair-picker,
// setAgreePair() below) — state.agreePair is the live value everything
// reads; DEFAULT_AGREE_PAIR is only the starting point for a labeler who
// has never picked one on this device.
const DEFAULT_AGREE_PAIR = ['Arianne', 'John'];
const AGREE_PAIR_KEY = 'cs4_agree_pair';

function loadAgreePair() {
  try {
    const raw = JSON.parse(localStorage.getItem(AGREE_PAIR_KEY) || 'null');
    if (Array.isArray(raw) && raw.length === 2) return [String(raw[0] || ''), String(raw[1] || '')];
  } catch (e) {}
  return [...DEFAULT_AGREE_PAIR];
}

function saveAgreePair(pair) {
  try { localStorage.setItem(AGREE_PAIR_KEY, JSON.stringify(pair)); } catch (e) {}
}
// 'euclid' is the main, default measure — full 2D distance. 'height'/
// 'width' isolate just the vertical/horizontal component (raw |y1-y2| or
// |x1-x2|, torso-normalized, same as the euclidean version minus the
// other axis) — different labeling tasks need different disagreement
// lenses: a systematic camera-angle skew shows up as a WIDTH problem, a
// stance-height difference shows up as HEIGHT, and euclid alone can't
// tell them apart. Order matters — it's also grid build/render order.
const AGREE_METRICS = ['euclid', 'height', 'width'];
// A grid folded shut still builds and repaints normally underneath —
// folding is purely a display:none on its wrapper (see applyMetricFold())
// — so there's no separate "don't bother computing this one" path to keep
// in sync with the other two.
function loadFoldedMetrics() {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLD_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((m) => AGREE_METRICS.includes(m)) : []);
  } catch (e) { return new Set(); }
}
// Admin-adjustable, chin and shoulder independently (see #agree-thresh-chin
// / #agree-thresh-sh in bind()) — each a fraction, e.g. 0.05 for 5%.
// PCK-style: a point "agrees" when both raters' clicks land within its
// point's own fraction of torso height of each other. Both default to 5%,
// a standard-ish PCK cutoff, but neither is validated — they're dials, not
// statistics, so the admin can try a wider chin tolerance than shoulder
// and see what changes. Persisted so a reload keeps whatever was chosen.
const DEFAULT_AGREE_THRESH_PCT = 5;
function loadAgreeThresh(storageKey) {
  const raw = Number(localStorage.getItem(storageKey));
  return Number.isFinite(raw) && raw >= 1 && raw <= 50 ? raw / 100 : DEFAULT_AGREE_THRESH_PCT / 100;
}
const CONFLICT_RING = 'dconflict';   // deliberately not .cb (camera_bad) — unrelated facts

const state = {
  frames: [],              // height_guard_queue.json order (originals + planted repeats)
  index: new Map(),        // key -> queue position
  labels: new Map(),       // key -> latest saved row (mine)
  i: 0,
  pts: { chin: null, sh: null },   // in-progress points, [x,y] normalized
  // COCO's v-flags in words, per point: 'visible' = seen and clicked,
  // 'inferred' = occluded (gloved chin), placed where the anatomy must be.
  // The v=0 case is the not_visible SKIP. Chin-proxy calibration must be
  // able to exclude the guesses, so the flag rides every save.
  // null = placed but not yet qualified — the popover is open on it, and a
  // save is refused until it is answered. There is no default: an unanswered
  // point silently saved as 'visible' is exactly the guess-as-observation
  // the flag exists to prevent.
  vis: { chin: null, sh: null },
  arm: 'chin',             // which point the next stage click places
  pop: null,               // open popover: {kind:'point', name} | {kind:'skip'}
  skipped: false,
  skipReason: null,        // 'not_visible' | 'no_stance' when skipped
  zoom: 1, panX: 0, panY: 0,
  drag: null,              // pan drag: {x, y, px, py}
  ptDrag: null,            // point drag: 'chin' | 'sh'
  down: null,              // mousedown screen pos, for click-vs-drag
  active: null,            // 'chin' | 'sh' — last-pressed point; what Del acts on
  ctxFor: null,            // point the right-click menu is currently open for
  loadingFor: null,
  loadedFor: null,
  loadToken: 0,
  inflight: new Set(),
  chains: new Map(),
  failed: new Map(),
  ready: false,
  camBad: false,           // camera shot too low/high for THIS frame
  shownAt: 0,
  // Overview divs, built once — normal mode only ever uses .euclid (#ov4,
  // the only grid it shows); admin mode uses all three.
  ovDots: { euclid: null, height: null, width: null },
  // metric -> [{g,a,r}] per batch — the three count spans under each
  // batch number, built once (buildOneGrid()) and updated in place
  // (paintBatchCounts()) rather than rebuilt, same node-stability rule as
  // the dots themselves.
  ovGutters: { euclid: null, height: null, width: null },

  // ── everyone's progress (both modes) ──
  // roster/teamColor/rosterPoll are shared with admin mode below — one
  // fetch and one poll serve both panels, they just render differently.
  roster: [],              // [{labeler,n,skipped,last_ts,last}] from statsChinPoint
  teamColor: new Map(),    // labeler -> 'var(--team-color-N)' (admin canvas only)
  rosterPoll: null,        // setInterval id for the roster poll
  teamOpen: false,         // the everyone's-progress list is expanded (normal mode)
  hidden: new Set(),       // lowercased labeler names hidden from MY OWN list — a view
                           // preference, localStorage-only, never reaches the sheet
  openRanges: new Set(),   // team rows unfolded to show their frame ranges
  rangeCache: new Map(),   // labeler -> {n, ranges, at} | {..., error} — see loadRanges()
  rangePending: new Map(), // labeler -> in-flight promise, so two asks are one read
  rangesWarmed: false,     // one unprompted prefetch per session, panel open or not
  teamTimer: null,         // debounce for the post-save roster refresh

  // ── admin mode ──
  isAdmin: false,
  teamRows: new Map(),     // labeler -> Map(slotKey -> row) — this labeler's own "state.labels"
  teamBundles: new Map(),  // labeler -> {failed, inflight, chains} — this labeler's own save bookkeeping
  // metric -> Map(slotKey -> {kind, level}) — one full set per AGREE_METRICS
  // entry, all kept live simultaneously (all three grids are always on
  // screen at once, not just whichever one is "selected").
  disagreeByMetric: { euclid: new Map(), height: new Map(), width: new Map() },
  agreeMetric: 'euclid',   // which metric the agreement card is currently showing
  foldedMetrics: loadFoldedMetrics(), // Set of metric names folded shut — a view preference
  agreeThreshChin: loadAgreeThresh(THRESH_KEY_CHIN), // fraction (e.g. 0.05) — see bind()
  agreeThreshSh: loadAgreeThresh(THRESH_KEY_SH),
  agreePair: loadAgreePair(), // [labelerA, labelerB] — see setAgreePair()
  // A teammate's OWN existing dot, directly draggable on canvas — separate
  // from ptDrag/ctxFor, which stay scoped to the normal-mode self (admin
  // has no "own" point path at all any more — see activeLabeler()).
  // null | {labeler, point}.
  tmDrag: null,
  tmCtxFor: null,          // same shape, for the right-click menu
};

const $ = (id) => document.getElementById(id);

function restoreName() {
  const el = $('labeler-input');
  if (!el || el.value.trim()) return;
  let saved = null;
  try { saved = window.CMLabeler && window.CMLabeler.get && window.CMLabeler.get(); } catch (e) {}
  if (saved) el.value = saved;
}

// rep is part of the identity: the planted repeat of a frame is a different
// queue slot, a different sheet row, and a different label.
const key = (f) => JSON.stringify([f.stem, f.round, f.frame, f.rep || 0]);
const rowKey = (r) => JSON.stringify([r.video, r.round, r.frame, r.rep || 0]);

// Mirrors chin_export_frames.frame_dir() — Windows strips trailing dots and
// spaces from directory names, so the exporter sanitized them and the
// uploader inherited its layout.
const frameDir = (stem) => stem.replace(/[. ]+$/, '');

const imgSrc = (f) => 'https://firebasestorage.googleapis.com/v0/b/'
  + FRAME_BUCKET + '/o/'
  + encodeURIComponent(`${FRAME_PREFIX}/${frameDir(f.stem)}/r${f.round}_f${f.frame}.jpg`)
  + `?alt=media&token=${FRAME_TOKEN}`;

// ── backend ────────────────────────────────────────────────────────────────
function who() { return ($('labeler-input').value || '').trim(); }

// Admin has no "own" identity to act as (2026-08) — every point admin
// touches is an existing one, corrected via saveTeammateRow()/setAdminVis()
// under THAT labeler's name, never under a "currently active" one of
// admin's own. null here is what makes commitCurrent()/save() (the
// single-identity placement path) permanently inert for admin — see the
// admin-mode header comment further up.
function activeLabeler() { return state.isAdmin ? null : who(); }

function api(params) {
  const url = new URL(SCRIPT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// One retry for cold-start blips; the v4cb marker refuses a deployment that
// predates these endpoints (doGet answers unknown actions with a success
// shape, so without the marker a save could "succeed" writing nothing).
async function call(params, what) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    let body;
    try {
      const res = await fetch(api(params), { redirect: 'follow' });
      body = await res.json();
    } catch (e) { last = e; continue; }
    if (body.status !== 'ok') {
      last = new Error(body.message || 'unknown error');
      continue;
    }
    if (body.v4cb !== true) {
      throw new Error('Apps Script is out of date — redeploy it '
                      + `(${params.action} fell through to the default handler)`);
    }
    return body;
  }
  throw new Error(`${what}: ${last && last.message}`);
}

// ── labels ─────────────────────────────────────────────────────────────────
// The full pair. A partial row (see hasAnyPoint) fails this even though the
// backend now accepts it — partial is provisional by design, not a lesser
// measurement, so it must not read as "done" anywhere this is used.
function hasPoints(row) {
  return !!row && FIELDS.every((f) => row[f] !== null && row[f] !== undefined);
}

// Either point alone is enough to be worth a dot on the overview — see
// the 'part' class in renderOverview().
function hasAnyPoint(row) {
  return !!row && (row.chin_x !== null && row.chin_x !== undefined
                 || row.sh_x !== null && row.sh_x !== undefined);
}

// Resolved = a complete point pair, or a deliberate skip. A partial row is
// neither — it is the one state you still have to come back to, so
// counting it as progress would overstate how much is left.
function isResolved(row) {
  return !!row && (row.skipped === 1 || hasPoints(row));
}

function myRowsInQueue() {
  const out = [];
  for (const [k, row] of state.labels) if (state.index.has(k)) out.push(row);
  return out;
}

async function loadLabels() {
  const name = who();
  state.labels = new Map();
  state.failed = new Map();
  state.camBad = false;
  // Only the PREVIOUS labeler's own entry in the range cache is name-
  // relative (it was computed live from state.labels rather than fetched);
  // everybody else's is a fact about their tab and survives, which is what
  // makes a reload or a name change instant instead of another round of
  // reads. Reloaded from localStorage rather than just filtered in place,
  // since a name change is exactly when a stale in-memory cache (from a
  // rebuilt queue, say) should be dropped too.
  state.rangeCache = loadRangeCache();
  state.rangePending = new Map();
  for (const k of [...state.rangeCache.keys()]) {
    if (k.toLowerCase() === name.toLowerCase()) state.rangeCache.delete(k);
  }
  if (!name) return;
  const body = await call({ action: 'listChinPoint', labeler: name }, 'load labels');
  for (const r of (body.rows || [])) state.labels.set(rowKey(r), r);
}

function dwellFor(k) {
  const prior = state.labels.get(k);
  const before = (prior && Number(prior.dwell_sec)) || 0;
  const seg = state.shownAt ? (Date.now() - state.shownAt) / 1000 : 0;
  return Math.round((before + Math.min(Math.max(seg, 0), DWELL_CAP_SEC)) * 10) / 10;
}

// ── team data (both modes) ──────────────────────────────────────────────────
// The roster: who has ever saved a row, and how far along they are —
// filtered to n>0 same as every other labeler-picker on this site, and
// 'admin' itself never appears (filtered server-side too, in doGetChinPoint).
async function loadRoster() {
  const body = await call({ action: 'statsChinPoint' }, 'load team');
  state.roster = (body.labelers || []).filter((l) => l.n > 0);
  [...state.roster].map((l) => l.labeler).sort()
    .forEach((nm, i) => state.teamColor.set(nm, `var(--team-color-${i % TEAM_COLOR_COUNT})`));
}

// Starts the shared roster poll once, however many times either mode asks
// for it — the callback re-checks state.isAdmin on every tick rather than
// being fixed at setup time, so retyping the name field into or out of
// "admin" mid-session (no reload) is picked up without tearing the
// interval down and rebuilding it.
function startRosterPoll() {
  if (state.rosterPoll) return;
  state.rosterPoll = setInterval(async () => {
    try {
      await loadRoster();
      if (state.isAdmin) { renderTeamProgress(); renderAdminPicker(); }
      else { renderTeamPanel(); }
    } catch (e) { /* keep the stale roster over losing it */ }
  }, TEAM_POLL_MS);
}

// Nothing reports presence, so "where someone is" is derived from the frame
// they saved most recently — a last-known position, not a live cursor.
function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// ── everyone's progress: hide-from-my-list preference ──────────────────────
// A VIEW preference, so it lives in localStorage and never reaches the
// sheet — one person tidying their own list must not change what anybody
// else sees. Scoped to this list and nothing else on the page.
function loadHidden() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDE_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map((s) => String(s).toLowerCase()) : []);
  } catch (e) { return new Set(); }
}

function saveHidden() {
  try { localStorage.setItem(HIDE_KEY, JSON.stringify([...state.hidden])); } catch (e) {}
}

function setNameHidden(name, hidden) {
  const k = String(name).toLowerCase();
  if (hidden) state.hidden.add(k); else state.hidden.delete(k);
  saveHidden();
  renderTeamPanel();
}

// ── everyone's progress: frame ranges ───────────────────────────────────────
// Consecutive queue positions collapse into one run, so "1-100, 401-1100" is
// three facts rather than eleven hundred.
function frameRuns(indices) {
  const s = [...indices].sort((a, b) => a - b);
  const out = [];
  let start = null, prev = null;
  for (const i of s) {
    if (start === null) { start = prev = i; continue; }
    if (i === prev) continue;              // a duplicate row for one frame
    if (i === prev + 1) { prev = i; continue; }
    out.push([start, prev]);
    start = prev = i;
  }
  if (start !== null) out.push([start, prev]);
  return out;
}

// Interval notation, closed on both sides — every number printed is a frame
// the labeler actually did. 1-based, matching the overview and go-to box.
function fmtRanges(runs) {
  return runs.map(([a, b]) => `[${a + 1}, ${b + 1}]`).join('  ·  ');
}

// Ranges are positions in the CURRENT queue, so a rebuilt queue makes every
// stored entry meaningless — the length is carried as a cheap version stamp
// and a mismatch drops the lot. Errors are never stored: a fetch that failed
// once is worth retrying next session, unlike an answer that is merely stale.
function loadRangeCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(RANGE_KEY) || 'null');
    if (!raw || !state.frames.length || raw.q !== state.frames.length) return new Map();
    return new Map(Object.entries(raw.by || {}));
  } catch (e) { return new Map(); }
}

function saveRangeCache() {
  try {
    const by = {};
    for (const [k, v] of state.rangeCache) if (!v.error) by[k] = v;
    localStorage.setItem(RANGE_KEY, JSON.stringify({ q: state.frames.length, by: by }));
  } catch (e) {}                                 // quota — the cache is a luxury
}

// Warm every visible row at once. The reads are independent and Apps Script
// serves them in parallel, so the whole team costs about what one labeler
// does; doing it when the panel OPENS rather than when a name is clicked is
// what turns a multi-second wait into none. Only rows with nothing cached at
// all — a stale entry is already on screen and revalidates on its own
// schedule (see the `due` check in renderTeamPanel()).
function prefetchRanges(force) {
  if ((!state.teamOpen && !force) || !state.frames.length) return;
  const me = (who() || '').toLowerCase();
  for (const r of state.roster) {
    const k = r.labeler.toLowerCase();
    if (k !== me && state.hidden.has(k)) continue;
    if (state.rangeCache.has(r.labeler)) continue;
    loadRanges(r.labeler, r.n).then(() => renderTeamPanel());
  }
}

// Fetched only for rows the panel is actually showing — this is a full read
// of one labeler's tab, far too much to pull on the roster poll.
async function loadRanges(labeler, n) {
  const inflight = state.rangePending.get(labeler);
  if (inflight) return inflight;                 // a click during a prefetch
  const p = fetchRanges(labeler, n).finally(() => state.rangePending.delete(labeler));
  state.rangePending.set(labeler, p);
  return p;
}

async function fetchRanges(labeler, n) {
  let rows;
  try {
    if (labeler.toLowerCase() === (who() || '').toLowerCase()) {
      rows = myRowsInQueue();                    // already in hand, no request
    } else {
      const body = await call({ action: 'listChinPoint', labeler }, 'frames');
      rows = body.rows || [];
    }
  } catch (e) {
    // An error must never overwrite ranges already on screen — but the
    // ATTEMPT is always stamped, on the old entry if there is one.
    const had = state.rangeCache.get(labeler);
    state.rangeCache.set(labeler, had
      ? Object.assign({}, had, { at: Date.now() })
      : { n, ranges: [], at: Date.now(), error: e.message });
    return;
  }
  const idx = [];
  for (const r of rows) {
    if (!isResolved(r)) continue;                // same set the count is over
    const i = state.index.get(rowKey(r));
    if (i !== undefined) idx.push(i);             // rows outside the queue are not shown
  }
  state.rangeCache.set(labeler, { n, ranges: frameRuns(idx), at: Date.now() });
  saveRangeCache();
}

// ── everyone's progress: panel ──────────────────────────────────────────────
// Folded like a disclosure pill: it answers a question asked between
// stretches of labeling, not one watched continuously. The button carries
// the head count so "how many of us are on this" needs no click at all.
function setTeamOpen(open) {
  state.teamOpen = !!open;
  $('team').classList.toggle('on', state.teamOpen);
  $('team-btn').setAttribute('aria-expanded', String(state.teamOpen));
  renderTeamLabel();
  if (state.teamOpen) prefetchRanges();
}

function renderTeamLabel() {
  const n = state.roster.length;
  $('team-label').textContent = state.teamOpen
    ? 'Hide progress'
    : (n ? `Everyone’s progress (${n})` : 'Everyone’s progress');
}

// Deliberately NOT the admin picture: name, count, a bar of WHERE in the
// queue those frames fall. Never another labeler's actual answer — that
// overlay (and this whole panel) was removed from 4.0 once already for
// anchoring; see the file header. This shows only what somebody has done,
// not what they said.
function renderTeamPanel() {
  const rows = state.roster;
  renderTeamLabel();
  const el = $('team');
  if (!rows || !rows.length) {
    el.innerHTML = '<div id="team-empty">No labels saved yet</div>';
    return;
  }
  const me = who().toLowerCase();
  const n = state.frames.length;

  // You can never hide yourself — your own progress is the one row that is
  // always relevant. Counted over PRESENT rows only, so a name hidden long
  // ago that has since stopped labeling does not inflate the tally.
  const isMe = (r) => r.labeler.toLowerCase() === me;
  const shown = rows.filter((r) => isMe(r) || !state.hidden.has(r.labeler.toLowerCase()));
  const hiddenNow = rows.length - shown.length;

  // #team is the grid, so each labeler contributes cells directly to it
  // rather than a wrapper — a wrapper would become the grid item and the
  // columns would stop lining up between labelers.
  const cells = [];
  const add = (cls, html) => {
    const s = document.createElement('span');
    s.className = cls;
    s.innerHTML = html;
    cells.push(s);
    return s;
  };

  shown.forEach((r) => {
    const mine = isMe(r);
    const m = mine ? ' who-me' : '';
    const pct = n ? (r.n / n) * 100 : 0;

    const name = add('who-n' + m, '');
    const open = state.openRanges.has(r.labeler);
    if (open) name.classList.add('open');
    const text = document.createElement('button');
    text.className = 'who-t';
    text.textContent = r.labeler;
    text.title = 'Show which frames ' + r.labeler + ' has done';
    text.setAttribute('aria-expanded', String(open));
    text.onclick = () => {
      if (state.openRanges.has(r.labeler)) state.openRanges.delete(r.labeler);
      else state.openRanges.add(r.labeler);
      renderTeamPanel();
    };
    const chev = document.createElement('i');
    chev.className = 'who-chev';
    chev.innerHTML = CHEV_SVG;
    name.append(text, chev);
    if (!mine) {
      const eye = document.createElement('button');
      eye.className = 'who-eye';
      eye.innerHTML = EYE_SVG;
      eye.title = `Hide ${r.labeler} from this list`;
      eye.setAttribute('aria-label', eye.title);
      eye.onclick = (e) => { e.stopPropagation(); setNameHidden(r.labeler, true); };
      name.appendChild(eye);
    }
    add('who-c' + m, `${r.n.toLocaleString()}<s> / ${n.toLocaleString()}</s>`);

    const bar = add('who-bar' + m, '');
    // The runs the panel already fetches, drawn in place — same cache, so
    // the bar and the "[1, 100] · [401, 1,100]" under an unfolded row
    // cannot disagree about what somebody has done.
    const runs = state.rangeCache.get(r.labeler);
    if (runs && !runs.error && runs.ranges.length && n) {
      for (const [from, to] of runs.ranges.slice(0, 400)) {
        const seg = document.createElement('i');
        seg.style.left = `${(from / n) * 100}%`;
        seg.style.width = `${((to - from + 1) / n) * 100}%`;
        bar.appendChild(seg);
      }
    } else if (r.n) {
      // No runs yet. Fall back to the old proportional fill rather than an
      // empty track: an empty bar beside "802 / 3,791" reads as nothing done.
      bar.classList.add('approx');
      const fill = document.createElement('i');
      fill.style.left = '0';
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
    }

    // Position IS still worth knowing — it just is not worth a column.
    // `last` from stats carries no rep, so this assumes rep 0 (the common
    // case — only ~10% of frames are planted repeats); worst case the
    // tooltip's "at #N" is off for a repeat frame, which is the one thing
    // here that is a hint rather than a fact anybody acts on.
    const at = r.last
      ? state.index.get(JSON.stringify([r.last.video, r.last.round, r.last.frame, 0]))
      : undefined;
    const detail = [`${r.n.toLocaleString()} of ${n.toLocaleString()} (${pct.toFixed(1)}%)`];
    if (r.skipped) detail.push(`${r.skipped} skipped`);
    if (at !== undefined) detail.push(`at #${at + 1}`);
    if (r.last_ts) detail.push(ago(r.last_ts));
    const tip = detail.join(' · ');
    bar.title = tip + (bar.classList.contains('approx')
      ? ' · bar shows the amount; the positions are still loading'
      : ' · the bar shows where in the queue');
    cells[cells.length - 2].title = tip;            // the count cell

    if (open) {
      const box = add('who-ranges' + m, '');
      const got = state.rangeCache.get(r.labeler);
      // Whatever we have goes up straight away. Only a row we have NEVER
      // read shows a spinner-equivalent; anything else shows its last
      // known ranges while the refresh runs underneath, so the panel never
      // blanks what it just said.
      box.textContent = !got ? 'Loading…'
        : got.error ? got.error
        : got.ranges.length ? fmtRanges(got.ranges)
        : 'nothing in the current queue';
      if (got && got.n !== r.n) box.classList.add('stale');
      const due = !got || (got.n !== r.n && Date.now() - (got.at || 0) > RANGE_FRESH_MS);
      if (due) loadRanges(r.labeler, r.n).then(() => renderTeamPanel());
    }
  });

  // Deliberately no "Lead everyone" footer here — every labeler getting
  // write access to the whole team's sheet is not something a normal
  // labeler session should ever offer. Admin mode has no built version of
  // it either (see the file header comment) — this is not "go find it
  // there instead."

  if (hiddenNow) {
    const foot = document.createElement('div');
    foot.className = 'who-hidden';
    const lbl = document.createElement('span');
    lbl.textContent = `${hiddenNow} hidden`;
    const all = document.createElement('button');
    all.className = 'who-show-all';
    all.textContent = 'Show all';
    all.onclick = () => { state.hidden.clear(); saveHidden(); renderTeamPanel(); };
    foot.append(lbl, all);
    cells.push(foot);
  }

  el.replaceChildren(...cells);
}

// Your own row moves the instant you save, so it never waits for the next
// poll. Admin-guarded: "admin" itself never appears in the roster (filtered
// server-side), and admin's saves land under the SELECTED labeler's
// identity, not admin's own — see activeLabeler().
function bumpMyTeamRow() {
  if (state.isAdmin) return;
  const me = who();
  if (!me) return;
  let mine = state.roster.find((r) => r.labeler.toLowerCase() === me.toLowerCase());
  if (!mine) { mine = { labeler: me, n: 0, skipped: 0, last_ts: '', last: null }; state.roster.push(mine); }
  const mineRows = myRowsInQueue();
  mine.n = mineRows.filter(isResolved).length;
  mine.skipped = mineRows.filter((r) => r.skipped).length;
  mine.last_ts = new Date().toISOString();
  const f = state.frames[state.i];
  if (f) mine.last = { video: f.stem, round: f.round, frame: f.frame };
  state.roster.sort((a, b) => b.n - a.n);
  renderTeamPanel();
}

// One real refresh after a burst of saves, not one per save: the stats call
// reads every labeler sheet, and firing it per frame is what made saving
// slow in the first place. Debounced rather than immediate.
function scheduleTeamRefresh() {
  clearTimeout(state.teamTimer);
  state.teamTimer = setTimeout(async () => {
    try {
      await loadRoster();
      renderTeamPanel();
      prefetchRanges();
    } catch (e) { /* keep the stale roster over losing it */ }
  }, 4000);
}

// One listChinPoint call per roster labeler — every row they have, the same
// pattern the deleted review.html used for its whole-corpus stats. Needed up
// front because the disagreement gradient scores EVERY queue slot, not just
// the one on screen — see computeAllDisagree(). Each labeler also gets their
// own save bookkeeping bundle (teamBundles), mirroring state.failed/
// inflight/chains for a normal single-labeler session.
async function loadTeamRows() {
  state.teamRows = new Map();
  state.teamBundles = new Map();
  const results = await Promise.allSettled(state.roster.map(async (l) => {
    const body = await call({ action: 'listChinPoint', labeler: l.labeler }, `load ${l.labeler}`);
    const rows = new Map();
    for (const r of (body.rows || [])) rows.set(rowKey(r), r);
    state.teamRows.set(l.labeler, rows);
    state.teamBundles.set(l.labeler, { failed: new Map(), inflight: new Set(), chains: new Map() });
  }));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    status(`${failed.length} labeler(s) failed to load — ${failed[0].reason.message}`, 'err');
  }
}

// Disagreement, per QUEUE SLOT (a planted repeat is scored on its own — the
// overview grid already treats one dot as one slot, not one distinct
// picture), for ONE metric ('euclid' | 'height' | 'width' — see
// AGREE_METRICS). `kind` explains WHY a slot reads the way it does; `level`
// is what renderOverview() paints — 0/0.5/1 are the only values a 'scored'
// slot ever carries now (see below), so the dot is always exactly green,
// amber, or red, never a blended in-between colour. Computed only from
// CONFIRMED rows in state.teamRows — see patchDisagree() — never from an
// in-progress drag, so the grid can't flicker a colour for a save that
// hasn't landed yet. Scoped to state.agreePair only (see its comment) — a
// third labeler's row on this frame, even a fully-placed one, does not
// enter the comparison.
function disagreeForSlot(f, metric) {
  const k = key(f);
  const rows = [];
  for (const name of state.agreePair) {
    const r = state.teamRows.get(name)?.get(k);
    if (r) rows.push(r);
  }
  if (rows.length === 0) return { kind: 'none', level: null };
  if (rows.length === 1) return { kind: 'solo', level: null };

  const placed = rows.filter(hasPoints);
  const skipped = rows.filter((r) => r.skipped === 1);

  // A disagreement about whether the frame can be judged AT ALL is more
  // fundamental than any numeric gap between placed points — one labeler
  // skipping while the other placed points is red BY DEFINITION, no matter
  // how close the points end up being to anything, on ANY metric.
  if (placed.length && skipped.length) return { kind: 'conflict', level: 1 };

  if (placed.length === 0) {
    // Everyone skipped. Agreeing it's unlabelable IS agreement — unless they
    // disagree about WHY, which is real information a flat "they agree"
    // would absorb. Metric-independent — a skip has no coordinates to
    // measure.
    const reasons = new Set(skipped.map((r) => r.skip_reason || 'unspecified'));
    return reasons.size <= 1 ? { kind: 'skip-agree', level: 0 } : { kind: 'skip-mixed', level: 0.4 };
  }

  // Everyone placed both points. Chin and shoulder scored SEPARATELY
  // against the same per-point PCK threshold the agreement card uses
  // (frameAgreement()) — both agreeing is a different, better fact than
  // "the average gap is small," which a blended spread number could show
  // even when one landmark is badly off and the other happens to cancel it
  // out.
  if (!f.torso_h) return { kind: 'solo', level: null };
  const chinOk = frameAgreement(f, 'chin', 'chin_x', 'chin_y', metric).state === 'agree';
  const shOk = frameAgreement(f, 'sh', 'sh_x', 'sh_y', metric).state === 'agree';
  const agreeCount = (chinOk ? 1 : 0) + (shOk ? 1 : 0);
  return {
    kind: 'scored',
    level: agreeCount === 2 ? 0 : agreeCount === 1 ? 0.5 : 1,
    chinOk, shOk,
  };
}

// All three metrics, kept live simultaneously — every grid is on screen at
// once, not just whichever one the agreement card currently shows.
function computeAllDisagree() {
  state.disagreeByMetric = { euclid: new Map(), height: new Map(), width: new Map() };
  for (const f of state.frames) {
    const k = key(f);
    for (const m of AGREE_METRICS) state.disagreeByMetric[m].set(k, disagreeForSlot(f, m));
  }
}

// Called only after a save has been CONFIRMED (save()'s success callback) —
// recomputing from an in-flight drag would show a colour for data that
// isn't actually saved yet.
function patchDisagree(f) {
  const k = key(f);
  for (const m of AGREE_METRICS) state.disagreeByMetric[m].set(k, disagreeForSlot(f, m));
  renderOverview();
  renderAgreementCard();
  renderGlobalAgreement();
}

// PCK-style agreement between state.agreePair on ONE point, on ONE frame,
// for ONE metric — not an aggregate. The admin is looking at a specific
// frame; "82% agreement over the whole queue" doesn't say whether THIS one
// is one of the disagreements, which is the thing a per-frame card is for.
// 'euclid' = full 2D distance; 'height'/'width' isolate just that axis
// (raw |y1-y2| or |x1-x2|), same torso-height normalization either way.
// "Agree" = the distance is within THAT POINT's own threshold
// (state.agreeThreshChin / state.agreeThreshSh) — admin-adjustable
// independently per point, and shared across all three metrics: the
// tolerance for "how far apart is too far" doesn't change depending on
// which axis you're measuring it along.
function frameAgreement(f, point, xk, yk, metric) {
  const [a, b] = state.agreePair;
  const k = key(f);
  const ra = state.teamRows.get(a)?.get(k);
  const rb = state.teamRows.get(b)?.get(k);
  const hasA = ra && ra[xk] != null && ra[yk] != null;
  const hasB = rb && rb[xk] != null && rb[yk] != null;
  if (!hasA && !hasB) return { state: 'none' };
  if (!hasA) return { state: 'missing', who: b };
  if (!hasB) return { state: 'missing', who: a };
  if (!f.torso_h) return { state: 'none' };
  const dx = ra[xk] - rb[xk], dy = ra[yk] - rb[yk];
  const dist = metric === 'height' ? Math.abs(dy) / f.torso_h
    : metric === 'width' ? Math.abs(dx) / f.torso_h
    : Math.hypot(dx, dy) / f.torso_h;
  const thresh = point === 'chin' ? state.agreeThreshChin : state.agreeThreshSh;
  return { state: dist <= thresh ? 'agree' : 'disagree', dist };
}

// Rebuilt every render() — same as the other per-frame admin cards
// (renderAdminPicker(), renderAdminPointsList()) — so it always reflects
// whatever frame is currently on screen, not a snapshot from login.
const METRIC_LABELS = { euclid: 'Euclidean', height: 'Height', width: 'Width' };
// Longer form, matching the .metric-label text above each grid exactly —
// used for the card's own eyebrow suffix, where "Euclidean" alone would
// read as cut off next to "Height disagreement"/"Width disagreement".
const METRIC_SUFFIX_LABELS = {
  euclid: 'Euclidean distance', height: 'Height disagreement', width: 'Width disagreement',
};

// Picks which metric the card and the whole-queue stats below show, and
// repaints both — the shared entry point for the three overview grids'
// click handlers (see buildOneGrid()).
function setAgreeMetric(metric) {
  if (state.agreeMetric === metric) return;
  state.agreeMetric = metric;
  renderAgreementCard();
  renderGlobalAgreement();
  renderMetricLabels();
}

// Bolds whichever of the three labels above the grids matches the metric
// the agreement card is currently showing — the only visual cue, besides
// the card itself, of which of the three the labeler is looking at.
function renderMetricLabels() {
  for (const m of AGREE_METRICS) {
    const el = $(`metric-label-${m}`);
    if (el) el.classList.toggle('active', state.agreeMetric === m);
  }
}

const METRIC_WRAP_IDS = { euclid: 'ov4-wrap', height: 'ov-height-wrap', width: 'ov-width-wrap' };

function toggleMetricFold(metric) {
  if (state.foldedMetrics.has(metric)) state.foldedMetrics.delete(metric);
  else state.foldedMetrics.add(metric);
  try { localStorage.setItem(FOLD_KEY, JSON.stringify([...state.foldedMetrics])); } catch (e) {}
  applyMetricFold(metric);
}

// Inline style, not a CSS class: the wrapper's default visibility already
// comes from a body.admin selector (see #ov-height-wrap in the
// stylesheet), and an inline style is the one thing guaranteed to beat
// that regardless of how the two rules' specificity compares.
function applyMetricFold(metric) {
  const folded = state.foldedMetrics.has(metric);
  const btn = $(`metric-label-${metric}`);
  const wrap = $(METRIC_WRAP_IDS[metric]);
  if (btn) btn.setAttribute('aria-expanded', String(!folded));
  if (wrap) wrap.style.display = folded ? 'none' : '';
}

function applyAllMetricFolds() {
  for (const m of AGREE_METRICS) applyMetricFold(m);
}

function renderAgreementCard() {
  if (!state.isAdmin) return;
  const box = $('agree-list');
  if (!box) return;
  const suffix = $('agree-metric-suffix');
  if (suffix) suffix.textContent = ` · ${METRIC_SUFFIX_LABELS[state.agreeMetric]}`;
  box.textContent = '';
  const f = state.frames[state.i];
  if (!f) return;
  for (const [label, point, xk, yk] of [['Chin', 'chin', 'chin_x', 'chin_y'], ['Shoulder', 'sh', 'sh_x', 'sh_y']]) {
    const r = frameAgreement(f, point, xk, yk, state.agreeMetric);

    const row = document.createElement('div');
    row.className = 'agree-row';
    const nm = document.createElement('span');
    nm.className = 'agree-row-label';
    nm.textContent = label;

    const pill = document.createElement('span');
    if (r.state === 'none') { pill.className = 'agree-pill muted'; pill.textContent = 'Neither placed'; }
    else if (r.state === 'missing') { pill.className = 'agree-pill muted'; pill.textContent = `Only ${r.who}`; }
    else {
      pill.className = `agree-pill ${r.state}`;
      pill.textContent = `${(r.dist * 100).toFixed(1)}% · ${r.state === 'agree' ? 'Agree' : 'Disagree'}`;
    }

    row.append(nm, pill);
    box.appendChild(row);
  }
}

// Raw distances across the WHOLE queue, per point, for ONE metric — not
// thresholded, since these are descriptive stats about the distribution,
// independent of wherever either threshold currently sits. Same gate as
// frameAgreement(): a frame counts only where BOTH named labelers placed
// that specific point.
function computeGlobalAgreement(metric) {
  const [a, b] = state.agreePair;
  const rowsA = state.teamRows.get(a);
  const rowsB = state.teamRows.get(b);
  const out = { chin: [], sh: [] };
  if (!rowsA || !rowsB) return out;
  for (const f of state.frames) {
    if (!f.torso_h) continue;
    const k = key(f);
    const ra = rowsA.get(k), rb = rowsB.get(k);
    if (!ra || !rb) continue;
    for (const [p, xk, yk] of [['chin', 'chin_x', 'chin_y'], ['sh', 'sh_x', 'sh_y']]) {
      if (ra[xk] == null || ra[yk] == null || rb[xk] == null || rb[yk] == null) continue;
      const dx = ra[xk] - rb[xk], dy = ra[yk] - rb[yk];
      const dist = metric === 'height' ? Math.abs(dy) / f.torso_h
        : metric === 'width' ? Math.abs(dx) / f.torso_h
        : Math.hypot(dx, dy) / f.torso_h;
      out[p].push(dist);
    }
  }
  return out;
}

// Avg and median only — min/max dropped by request: a single planted
// outlier isn't informative on its own the way the centre of the
// distribution is.
function distStats(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((x, y) => x - y);
  const n = sorted.length;
  const mid = n >> 1;
  return {
    n,
    avg: arr.reduce((s, v) => s + v, 0) / n,
    median: n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
  };
}

// Not rebuilt on every render() like renderAgreementCard() above — the
// whole-queue distribution doesn't change when the labeler pages to a
// different frame, only when a save actually lands (patchDisagree()) or at
// login (start()), so recomputing it on every arrow-key press would be
// pure waste.
function renderGlobalAgreement() {
  if (!state.isAdmin) return;
  const box = $('agree-global');
  if (!box) return;
  box.textContent = '';
  const dists = computeGlobalAgreement(state.agreeMetric);
  for (const [label, p] of [['Chin', 'chin'], ['Shoulder', 'sh']]) {
    const s = distStats(dists[p]);

    const row = document.createElement('div');
    row.className = 'agree-row';
    const nm = document.createElement('span');
    nm.className = 'agree-row-label';
    nm.textContent = label;

    const val = document.createElement('span');
    val.className = 'agree-stat-value';
    val.textContent = s
      ? `avg ${(s.avg * 100).toFixed(1)}% · median ${(s.median * 100).toFixed(1)}% · n=${s.n}`
      : 'no shared frames yet';

    row.append(nm, val);
    box.appendChild(row);
  }
}

// ── admin mode: editing a TEAMMATE's existing points ────────────────────
// Every roster member's points — the ONLY points admin ever touches, see
// the admin-mode header comment — are directly draggable and correctable
// on canvas. There is no single "leaving frame" identity to hang a
// deferred commit off when several teammates could be mid-edit at once,
// so every mutation here saves IMMEDIATELY rather than waiting on a
// commit.

function setTeammateDragging({ labeler, point }, on) {
  const el = document.querySelector(`#marks .tm.${point}[data-who="${CSS.escape(labeler)}"]`);
  if (el) el.classList.toggle('dragging', on);
}

// Called on every mousemove while state.tmDrag is set — touches only the
// ONE dot (and its connecting line, if the other point exists) rather
// than rebuilding the whole marks layer on every frame of the drag.
function updateTeammatePointLive({ labeler, point }, p) {
  const row = state.teamRows.get(labeler)?.get(key(state.frames[state.i]));
  if (!row) return;
  if (point === 'chin') { row.chin_x = p[0]; row.chin_y = p[1]; }
  else { row.sh_x = p[0]; row.sh_y = p[1]; }
  const el = document.querySelector(`#marks .tm.${point}[data-who="${CSS.escape(labeler)}"]`);
  if (el) { el.style.left = `${p[0] * 100}%`; el.style.top = `${p[1] * 100}%`; }
  const line = document.querySelector(`#tm-links line[data-who="${CSS.escape(labeler)}"]`);
  if (line) {
    if (point === 'chin') { line.setAttribute('x1', p[0]); line.setAttribute('y1', p[1]); }
    else { line.setAttribute('x2', p[0]); line.setAttribute('y2', p[1]); }
  }
  updateAdminPointCard(labeler, point);
}

// Live x/y in that labeler's Points card — split out of the full
// renderAdminPointsList() rebuild for the same reason placeMarks()/
// updateToolCoord() are split: a full sidebar rebuild on every mousemove
// of a drag is wasteful when only two numbers actually changed.
function updateAdminPointCard(labeler, point) {
  const row = state.teamRows.get(labeler)?.get(key(state.frames[state.i]));
  if (!row) return;
  const card = document.querySelector(`.admin-pt-card[data-labeler="${CSS.escape(labeler)}"]`);
  if (!card) return;
  const rowEl = card.querySelector(`.admin-tool-row[data-p="${point}"]`);
  if (!rowEl) return;
  const x = point === 'chin' ? row.chin_x : row.sh_x;
  const y = point === 'chin' ? row.chin_y : row.sh_y;
  rowEl.querySelector('.trc-x').textContent = (x !== null && x !== undefined) ? x.toFixed(3) : '—';
  rowEl.querySelector('.trc-y').textContent = (y !== null && y !== undefined) ? y.toFixed(3) : '—';
}

// Deletes ONE point from a teammate's row and saves immediately.
function deleteTeammatePoint(labeler, point) {
  const k = key(state.frames[state.i]);
  const row = state.teamRows.get(labeler)?.get(k);
  if (!row) return;
  if (point === 'chin') { row.chin_x = null; row.chin_y = null; row.chin_vis = null; }
  else { row.sh_x = null; row.sh_y = null; row.sh_vis = null; }
  renderTeamMarks();
  renderAdminPointsList();
  saveTeammateRow(labeler);
}

// Updates just the ONE point's dot/switch after a vis change — not a full
// renderTeamMarks()/renderAdminPointsList() rebuild. Those tear down and
// recreate EVERY dot for EVERY labeler, and .dot.set's pop animation (see
// the stylesheet) plays on any element that's freshly created already
// wearing the class — so a full rebuild for one person's answer replayed
// the pop on every already-placed point on screen. classList.toggle here
// touches only the one element that actually changed, same fix as the
// no-replay-on-every-render() rule the solo target's own dot already
// follows.
function updateTeammateVisUI(labeler, point, vis) {
  const el = document.querySelector(`#marks .tm.${point}[data-who="${CSS.escape(labeler)}"]`);
  if (el) el.classList.toggle('inferred', vis === 'inferred');
  const card = document.querySelector(`.admin-pt-card[data-labeler="${CSS.escape(labeler)}"]`);
  const rowEl = card && card.querySelector(`.admin-tool-row[data-p="${point}"]`);
  if (!rowEl) return;
  rowEl.querySelector('.dot').classList.toggle('inferred', vis === 'inferred');
  for (const seg of rowEl.querySelectorAll('.vis-seg')) {
    seg.setAttribute('aria-pressed', String(seg.dataset.v === vis));
  }
}

// Sets ONE point's seen/occluded answer and saves immediately — correcting
// an existing point is unambiguous no matter how many teammates are shown,
// unlike placing a brand-new one, which admin can never do at all.
function setAdminVis(labeler, point, v) {
  const k = key(state.frames[state.i]);
  const row = state.teamRows.get(labeler)?.get(k);
  if (!row || row[point === 'chin' ? 'chin_vis' : 'sh_vis'] === v) return;
  row[point === 'chin' ? 'chin_vis' : 'sh_vis'] = v;
  updateTeammateVisUI(labeler, point, v);
  saveTeammateRow(labeler);
}

// Writes a teammate's WHOLE current row (both points, whichever exist).
// Clearing the last point down to zero (deleteTeammatePoint()) is not
// treated as a skip — same "writes nothing to invent, just the facts as
// they stand" rule commitCurrent() applies for the active identity — it
// saves as an ordinary unskipped, pointless row, which the backend already
// accepts (see PARTIAL SAVES above).
function saveTeammateRow(labeler) {
  const f = state.frames[state.i];
  const k = key(f);
  const row = state.teamRows.get(labeler)?.get(k);
  const bundle = state.teamBundles.get(labeler);
  if (!row || !bundle) return;
  const hasChin = row.chin_x !== null && row.chin_x !== undefined;
  const hasSh = row.sh_x !== null && row.sh_x !== undefined;
  const params = {
    action: 'saveChinPoint', labeler,
    video: f.stem, round: String(f.round), frame: String(f.frame), rep: String(f.rep || 0),
    frame_sec: String(f.pts), stance: f.stance, shoulder_used: f.shoulder,
    skipped: row.skipped === 1 ? '1' : '0',
    skip_reason: row.skipped === 1 ? (row.skip_reason || '') : '',
    camera_bad: row.camera_bad ? '1' : '0',
    dwell_sec: String(row.dwell_sec || 0),
  };
  if (row.skipped !== 1 && hasChin) {
    params.chin_x = row.chin_x.toFixed(5);
    params.chin_y = row.chin_y.toFixed(5);
    params.chin_vis = row.chin_vis || 'visible';
  }
  if (row.skipped !== 1 && hasSh) {
    params.sh_x = row.sh_x.toFixed(5);
    params.sh_y = row.sh_y.toFixed(5);
    params.sh_vis = row.sh_vis || 'visible';
  }
  bundle.failed.delete(k);
  bundle.inflight.add(k);
  renderAdminPicker();
  const chain = (bundle.chains.get(k) || Promise.resolve())
    .then(() => call(params, 'save'))
    .then(() => {
      bundle.inflight.delete(k);
      patchDisagree(f);
      renderAdminPicker();
    })
    .catch((e) => {
      bundle.inflight.delete(k);
      bundle.failed.set(k, e.message);
      status(`${labeler}'s point did not save — ${e.message}`, 'err');
      renderAdminPicker();
    })
    .finally(() => { if (bundle.chains.get(k) === chain) bundle.chains.delete(k); });
  bundle.chains.set(k, chain);
}

// --no (#ff3b30) at level=1, --yes (#34c759) at level=0 — a direct RGB lerp,
// not buckets, so "gradient from red to green" is literal.
function lerpColor(level) {
  const no = [0xff, 0x3b, 0x30], yes = [0x34, 0xc7, 0x59];
  const t = Math.max(0, Math.min(1, level));
  const mix = no.map((c, i) => Math.round(yes[i] + (c - yes[i]) * t));
  return `rgb(${mix.join(',')})`;
}

// Optimistic, chained per frame — same machinery as 3.0: the local row is
// recorded and the labeler moves on; a failure rolls the row back, paints
// the dot red and names the frame in the status line.
// `skip` is null for a point pair, or the REASON ('not_visible' /
// 'no_stance') — a skip is a statement about why the frame cannot be
// measured, and the reason is the data: it is what says whether the
// sampling window is still letting non-stance frames through.
//
// `labelsMap`/`failedMap`/`inflightSet`/`chainsMap` are captured HERE,
// synchronously, rather than read off `state` again inside the async
// callbacks below — normal mode never repoints those fields mid-save, but
// capturing them costs nothing and keeps this function honest about what
// it's actually writing into.
//
// ADMIN MODE never reaches past the guard below: activeLabeler() always
// returns null for admin (see its own comment) — admin has no "own"
// identity to place a NEW point as, only existing ones to correct via
// saveTeammateRow()/setAdminVis(), which don't go through this function
// at all.
function save({ skip = null } = {}) {
  if (!state.ready) return false;
  const name = activeLabeler();
  if (!name) {
    if (state.isAdmin) status('Admin cannot place points — drag or right-click an existing one instead', 'err');
    else { status('Enter your name first', 'err'); $('labeler-input').focus(); }
    return false;
  }
  // Partial is allowed — a row can carry the chin alone, the shoulder
  // alone, both, or (skip) neither. What it can't carry is a point that
  // was placed but never qualified: an unanswered point is provisional in
  // a way even a partial row isn't, since there's no v-flag to store yet.
  if (!skip) {
    if (state.pts.chin && !state.vis.chin) {
      status('Answer seen or inferred for the chin first', 'err');
      return false;
    }
    if (state.pts.sh && !state.vis.sh) {
      status('Answer seen or inferred for the shoulder first', 'err');
      return false;
    }
  }
  const labelsMap = state.labels, failedMap = state.failed,
        inflightSet = state.inflight, chainsMap = state.chains;
  const f = state.frames[state.i];
  const k = key(f);
  const prev = labelsMap.get(k);
  // Admin is correcting someone else's frame; the clock that matters for
  // dwell_sec is THEIR labeling pace, not admin's inspection time, so the
  // stored value passes through unchanged instead of accumulating more.
  const dwell = state.isAdmin ? ((prev && Number(prev.dwell_sec)) || 0) : dwellFor(k);
  state.shownAt = Date.now();
  const params = {
    action: 'saveChinPoint', labeler: name,
    video: f.stem, round: String(f.round), frame: String(f.frame),
    rep: String(f.rep || 0),
    frame_sec: String(f.pts), stance: f.stance,
    shoulder_used: f.shoulder,
    skipped: skip ? '1' : '0',
    skip_reason: skip || '',
    camera_bad: state.camBad ? '1' : '0',
    dwell_sec: String(dwell),
  };
  // Each point rides on the row independently — sent only when IT is
  // present, never defaulted from the other one's state.
  const sendChin = !skip && !!state.pts.chin;
  const sendSh = !skip && !!state.pts.sh;
  if (sendChin) {
    params.chin_x = state.pts.chin[0].toFixed(5);
    params.chin_y = state.pts.chin[1].toFixed(5);
    params.chin_vis = state.vis.chin;
  }
  if (sendSh) {
    params.sh_x = state.pts.sh[0].toFixed(5);
    params.sh_y = state.pts.sh[1].toFixed(5);
    params.sh_vis = state.vis.sh;
  }

  const row = {
    video: f.stem, round: f.round, frame: f.frame, rep: f.rep || 0,
    skipped: skip ? 1 : 0,
    skip_reason: skip || null,
    camera_bad: state.camBad ? 1 : 0,
    dwell_sec: dwell,
    chin_x: sendChin ? Number(params.chin_x) : null,
    chin_y: sendChin ? Number(params.chin_y) : null,
    sh_x: sendSh ? Number(params.sh_x) : null,
    sh_y: sendSh ? Number(params.sh_y) : null,
    chin_vis: sendChin ? state.vis.chin : null,
    sh_vis: sendSh ? state.vis.sh : null,
  };
  labelsMap.set(k, row);
  failedMap.delete(k);
  inflightSet.add(k);
  showQueueState();
  if (!state.isAdmin) bumpMyTeamRow();     // your own row moves NOW, not on the next poll

  const chain = (chainsMap.get(k) || Promise.resolve())
    .then(() => call(params, 'save'))
    .then(() => {
      inflightSet.delete(k);
      showQueueState();
      if (state.isAdmin) patchDisagree(f);
      else scheduleTeamRefresh();
    })
    .catch((e) => {
      inflightSet.delete(k);
      if (prev) labelsMap.set(k, prev); else labelsMap.delete(k);
      failedMap.set(k, e.message);
      if (!state.isAdmin) bumpMyTeamRow();  // the row was rolled back — the count must follow
      const at = state.index.get(k);
      status(`Frame #${at === undefined ? '?' : at + 1} did not save — ${e.message}`, 'err');
      render();
    })
    .finally(() => { if (chainsMap.get(k) === chain) chainsMap.delete(k); });
  chainsMap.set(k, chain);
  return true;
}

// Has anything changed since the row this frame already has? Skips the
// write when nothing did — a save now overwrites the row in place, so an
// identical re-write would just cost a lock/write round trip for no new
// information, and with commit-on-leave a labeler walking back through
// their work with the arrow keys would otherwise trigger one every step.
//
// Per-point, not per-pair, now that a row can be partial: a saved row that
// already has the chin and nothing else is NOT dirty just because the
// shoulder is still empty on screen too — "empty here, empty there" is
// agreement, not a change to write.
function isDirty(k) {
  const saved = state.labels.get(k);
  if (!saved || saved.skipped === 1) return true;
  const samePoint = (pt, xk, yk, visKey, savedVis) => {
    if (!pt) return saved[xk] === null && saved[yk] === null;
    return Number(pt[0].toFixed(5)) === Number(saved[xk])
        && Number(pt[1].toFixed(5)) === Number(saved[yk])
        && state.vis[visKey] === savedVis;
  };
  return !samePoint(state.pts.chin, 'chin_x', 'chin_y', 'chin', saved.chin_vis)
      || !samePoint(state.pts.sh, 'sh_x', 'sh_y', 'sh', saved.sh_vis)
      || (state.camBad ? 1 : 0) !== (saved.camera_bad ? 1 : 0);
}

// The save. There is no save button: whatever points exist are written by
// moving on, because "I'm done here for now" and "next frame" are the same
// decision, and making them two gestures means the second one gets
// forgotten and the first one's work is lost.
//
// Returns false only when the frame is holding the labeler there — a point
// placed but not yet qualified as seen/inferred. Everything else (nothing
// placed at all, already skipped, nothing changed) is a legitimate way to
// leave a frame.
//
// Zero points and not skipped writes NOTHING (2026-08 — used to auto-write
// a skip with reason 'unmarked' so the frame wouldn't "silently vanish back
// into the unlabeled pool"; the team found that worse than just leaving it
// unlabeled, since a frame nobody has actually looked at hard enough to
// place or skip is exactly what "unlabeled" already means). Passing through
// without placing anything is a legitimate way to preview a frame — it must
// not cost a row. SKIP_LABELS below still maps 'unmarked' to a display
// string for the rows that already carry it from before this changed.
//
// ADMIN NEVER REACHES ANY OF THIS: admin has no "own" in-progress point to
// commit — every edit it makes is to an EXISTING point, saved immediately
// by saveTeammateRow()/setAdminVis() at the moment it happens, not
// deferred to "leaving the frame." An explicit early return, not an
// implicit one via activeLabeler() always being null: relying on that
// alone would still let the zero-point branch below run for admin (state.
// pts stays empty for the whole session) and try to act on whatever frame
// is current on every single navigation — silently "doing something as
// admin" is exactly what this function must never do.
function commitCurrent() {
  if (!state.ready || !state.frames.length) return true;
  if (state.isAdmin) return true;
  if (state.skipped) return true;
  if (state.pts.chin && !state.vis.chin) {
    status('Answer seen or inferred for the chin first', 'err');
    return false;
  }
  if (state.pts.sh && !state.vis.sh) {
    status('Answer seen or inferred for the shoulder first', 'err');
    return false;
  }
  const k = key(state.frames[state.i]);
  if (!state.pts.chin && !state.pts.sh) return true;
  if (!isDirty(k)) return true;
  return save({});
}

function setReady(on, note, isError) {
  state.ready = !!on;
  renderNameState();
  document.body.classList.toggle('ready', state.ready);
  $('q-lock').textContent = note || '';
  $('q-lock').classList.toggle('err', !!isError);
  $('q-lock').style.display = note ? 'block' : 'none';
}

function showQueueState() {
  if (state.failed.size) {
    status(`${state.failed.size} frame(s) failed to save`, 'err');
  } else if (state.inflight.size) {
    status(`saving ${state.inflight.size}…`);
  } else {
    status('');
  }
  renderOverview();
  // The picker's per-labeler status chip shows saving/failed too — the
  // capture fix in save() means a save can land after admin has already
  // switched away from that labeler, so this is the one place that state
  // stays visible instead of silently resolving off-screen.
  if (state.isAdmin) renderAdminPicker();
}

// ── navigation ─────────────────────────────────────────────────────────────
function firstUnlabeled(from = 0) {
  for (let i = from; i < state.frames.length; i++) {
    if (!state.labels.has(key(state.frames[i]))) return i;
  }
  return -1;
}

// Populate the in-progress editing state from a saved row (or reset to
// empty if there isn't one) — used when arriving at a frame (go()).
// Admin's state.labels is permanently the inert empty Map (see start()),
// so this always resets to nothing for admin — there is no "own" row to
// restore, only existing teammates' points, which never touch state.pts.
function applySavedRow(saved) {
  state.skipped = !!(saved && saved.skipped);
  state.skipReason = (saved && saved.skip_reason) || null;
  state.camBad = !!(saved && saved.camera_bad);
  // Per point, not per pair — a partial row (chin saved, shoulder still
  // empty) comes back with the chin editable and the shoulder still
  // unplaced, not wiped back to nothing just because the PAIR isn't whole.
  // A saved point comes back editable either way: drag a dot, save again —
  // the backend overwrites the row in place, no history kept.
  const chinSaved = !!(saved && saved.chin_x !== null && saved.chin_x !== undefined);
  const shSaved = !!(saved && saved.sh_x !== null && saved.sh_x !== undefined);
  state.pts = {
    chin: chinSaved ? [saved.chin_x, saved.chin_y] : null,
    sh: shSaved ? [saved.sh_x, saved.sh_y] : null,
  };
  state.vis = {
    chin: chinSaved ? (saved.chin_vis || 'visible') : null,
    sh: shSaved ? (saved.sh_vis || 'visible') : null,
  };
  // Arms whichever point is still missing — coming back to a partial row
  // means finishing it, and the natural next click is the point that
  // isn't there yet. Both present (or both absent) arms nothing / chin,
  // same as before.
  state.arm = !chinSaved ? 'chin' : (!shSaved ? 'sh' : null);
}

// `initial: true` marks the very first landing of a session — start()'s own
// go(0)/go(n) calls, not a real navigation away from a frame the labeler
// was actually looking at. commitCurrent()'s zero-point branch now WRITES
// (an auto-skip), so treating that first call as a departure would record
// a decision about frame 0 nobody made. Admin doesn't need this — its own
// commitCurrent() call is a permanent no-op — but a normal login's is a
// real risk without it.
function go(i, { initial = false } = {}) {
  // Leaving a finished frame is what saves it — see commitCurrent(). A frame
  // that cannot be committed keeps the labeler where they are.
  if (!initial && !commitCurrent()) { render(); return; }
  state.i = Math.max(0, Math.min(state.frames.length - 1, i));
  state.active = null;
  closePop();
  closeCtx();
  resetZoom();
  const f = state.frames[state.i];
  applySavedRow(state.labels.get(key(f)));
  state.shownAt = Date.now();
  render();
  prefetch();
}

function advance() {
  if (state.i < state.frames.length - 1) { go(state.i + 1); return; }
  // Nowhere to move, but the work still has to land: the last frame in the
  // queue is saved by pressing Next on it, not lost for being last.
  if (commitCurrent()) status('End of queue');
  render();
}

// Admin-only. Every teammate edit already writes the instant it's made
// (see saveTeammateRow()) — this button doesn't commit anything new, it
// re-sends whatever the current frame's rows hold right now, for the
// "did that actually land" moment after a run of edits, or to retry one
// that failed. Skips labelers with no row here rather than sending an
// empty save for everyone on every click.
function adminManualSave() {
  if (!state.ready || !state.isAdmin) return;
  const f = state.frames[state.i];
  if (!f) return;
  const k = key(f);
  let any = false;
  for (const l of state.roster) {
    if (state.teamRows.get(l.labeler)?.get(k)) { saveTeammateRow(l.labeler); any = true; }
  }
  status(any ? 'Saved' : 'Nothing to save on this frame', 'ok');
}

function prefetch() {
  for (let n = 1; n <= PREFETCH; n++) {
    const f = state.frames[state.i + n];
    if (f) new Image().src = imgSrc(f);
  }
}

// ── rendering ──────────────────────────────────────────────────────────────
function render() {
  const n = state.frames.length;
  if (!n) return;
  const f = state.frames[state.i];

  $('count').innerHTML = `${state.i + 1}<small> / ${n}</small>`;
  const resolved = myRowsInQueue().filter(isResolved).length;
  $('done').textContent = `${resolved} done`;

  $('id-video').textContent = f.stem;
  $('id-round').textContent = f.round;
  $('id-frame').textContent = f.frame;

  const img = $('frame');
  if (img.dataset.k !== key(f)) { img.dataset.k = key(f); img.src = imgSrc(f); }

  for (const row of document.querySelectorAll('.tool-row')) {
    const p = row.dataset.p === 'chin' ? 'chin' : 'sh';
    row.setAttribute('aria-pressed', String(state.arm === row.dataset.p));
    const pt = state.pts[p];
    // The dot fills the instant a point exists — independent of whether its
    // seen/inferred answer has landed yet, so a click gets a colour change
    // before the popover even opens. classList.toggle no-ops when the value
    // is unchanged, which is what keeps the pop animation from replaying on
    // every render() rather than only the frame a point is actually placed.
    const dot = row.querySelector('.dot');
    dot.classList.toggle('set', !!pt);
    dot.classList.toggle('inferred', state.vis[p] === 'inferred');
    updateToolCoord(p, row);
    // The switch stays on screen at all times now — disabled (not hidden)
    // until the point has an answer, since before that the popover is the
    // only way to give one and a control that does nothing should look
    // inert rather than vanish.
    for (const seg of row.querySelectorAll('.vis-seg')) {
      seg.disabled = !pt || !state.vis[p];
      seg.setAttribute('aria-pressed', String(seg.dataset.v === state.vis[p]));
    }
  }
  // Both points placed AND answered — live in-progress state, not the
  // saved row, so the badge lands the moment the second vis answer does
  // rather than waiting on a save that may not happen for seconds.
  const complete = !!(state.pts.chin && state.vis.chin && state.pts.sh && state.vis.sh);
  $('q-card').classList.toggle('complete', complete);
  $('pts-complete').hidden = !complete;
  // The guide cross wears the armed point's colour — see #stage-card.arm-sh.
  $('stage-card').classList.toggle('arm-sh', state.arm === 'sh');
  const skipb = $('skip-btn');
  skipb.setAttribute('aria-pressed', String(state.skipped));
  skipb.firstChild.nodeValue = state.skipped
    ? `Skipped — ${SKIP_LABELS[state.skipReason] || state.skipReason} `
    : 'Skip frame ';
  renderCam();

  placeMarks();
  renderTeamMarks();
  renderAdminPicker();
  renderAdminPointsList();
  renderAgreementCard();
  renderOverview();
}

// Normalized 0..1, matching what actually gets sent on save — not a
// screen-pixel value that would mean something different on every
// monitor. Split out from render() so a drag can call it on every
// mousemove without paying for a full render() (dot classes, switch
// state, overview, team marks…) on every frame of the drag.
function updateToolCoord(name, row) {
  row = row || document.querySelector(`.tool-row[data-p="${name}"]`);
  if (!row) return;
  const pt = state.pts[name];
  row.querySelector('.trc-x').textContent = pt ? pt[0].toFixed(3) : '—';
  row.querySelector('.trc-y').textContent = pt ? pt[1].toFixed(3) : '—';
}

function placeMarks() {
  const pct = (p) => ({ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` });
  for (const [name, el] of [['chin', $('hp-chin')], ['sh', $('hp-sh')]]) {
    const p = state.pts[name];
    el.classList.toggle('set', !!p);
    el.classList.toggle('inferred', state.vis[name] === 'inferred');
    el.classList.toggle('active', state.active === name);
    if (p) Object.assign(el.style, pct(p));
  }
  const img = $('frame');
  if (img.naturalWidth && img.naturalHeight) {
    $('stage').style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  }
}

// The label is the same either way — the fact it reports does not change with
// the answer, only whether it is true, which the pressed state says.
//
// Disabled until both points are placed: "too low/high" is a claim about
// where the chin sits relative to the shoulder, which isn't a judgement
// there's anything to make yet on a frame with zero or one point down.
function renderCam() {
  $('cam-btn').setAttribute('aria-pressed', String(!!state.camBad));
  $('cam-btn').disabled = !(state.pts.chin && state.pts.sh);
}

function renderNameState() {
  $('name-go').disabled = !who();
}

// ── admin mode: rendering ───────────────────────────────────────────────────
// Hovering a name (in the picker or on a mark itself) brings that
// labeler's marks to full strength and dims the rest — twelve dots on one
// jaw is unreadable otherwise. Same move the deleted review.html used for
// the identical problem.
function setTeamHover(name) {
  for (const el of document.querySelectorAll('#marks .tm, #tm-links line')) {
    el.classList.toggle('dim', !!name && el.dataset.who !== name);
  }
}

// Corpus-wide, not per-frame — called after loadRoster() and on the 45s
// poll, NOT from render(), so a frame change doesn't rebuild it for no
// reason.
function renderTeamProgress() {
  if (!state.isAdmin) return;
  const box = $('team-progress');
  box.textContent = '';
  const total = state.frames.length;
  for (const l of [...state.roster].sort((a, b) => b.n - a.n)) {
    const color = state.teamColor.get(l.labeler) || 'var(--ink-dim)';
    const row = document.createElement('div');
    row.className = 'team-n';
    row.style.setProperty('--tm-color', color);
    const sw = document.createElement('span');
    sw.className = 'sw';
    const nm = document.createElement('span');
    nm.textContent = l.labeler;
    row.append(sw, nm);
    const pct = total ? Math.round((l.n / total) * 100) : 0;
    const ct = document.createElement('div');
    ct.className = 'team-c';
    ct.textContent = `${l.n} / ${total} · ${pct}%`;
    const bar = document.createElement('div');
    bar.className = 'team-bar';
    bar.style.setProperty('--tm-color', color);
    const fill = document.createElement('i');
    fill.style.width = `${Math.min(100, pct)}%`;
    bar.appendChild(fill);
    box.append(row, ct, bar);
  }
  renderAgreePairPicker();
}

// Populates the two "who to compare" selects from the current roster,
// preserving state.agreePair's current names even if the roster hasn't
// caught up to them yet (a brand-new pair with zero saved rows). Disables
// each select's OWN current pick inside the OTHER select — comparing
// someone against themselves is not a comparison. Called wherever the
// roster refreshes (see renderTeamProgress(), just above), not on every
// frame render — the roster doesn't change that often.
function renderAgreePairPicker() {
  if (!state.isAdmin) return;
  const selA = $('agree-a'), selB = $('agree-b');
  if (!selA || !selB) return;
  const names = new Set(state.roster.map((l) => l.labeler));
  names.add(state.agreePair[0]);
  names.add(state.agreePair[1]);
  names.delete('');
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  for (const [sel, own, other] of [[selA, state.agreePair[0], state.agreePair[1]],
                                    [selB, state.agreePair[1], state.agreePair[0]]]) {
    sel.textContent = '';
    for (const nm of sorted) {
      const opt = document.createElement('option');
      opt.value = nm;
      opt.textContent = nm;
      opt.disabled = nm === other && nm !== own;
      sel.appendChild(opt);
    }
    sel.value = own;
  }
}

// Changes one side of the pair being compared — mid-session, admin-only.
// Recomputes everything that reads state.agreePair: the per-frame
// agreement card, the whole-queue stats below it, AND the three progress
// grids' disagreement colouring (computeAllDisagree() -> renderOverview()).
function setAgreePair(idx, name) {
  if (!name || state.agreePair[idx] === name) return;
  const next = [...state.agreePair];
  const otherIdx = idx === 0 ? 1 : 0;
  // The disabled <option> in the OTHER select already stops this through
  // the UI, but a disabled option still accepts a scripted .value
  // assignment — swap rather than allow both slots to end up on the same
  // name, since picking the other slot's name is an unambiguous "swap
  // them" gesture, not a mistake to silently drop.
  if (next[otherIdx] === name) next[otherIdx] = next[idx];
  next[idx] = name;
  state.agreePair = next;
  saveAgreePair(next);
  computeAllDisagree();
  renderAgreePairPicker();
  renderAgreementCard();
  renderGlobalAgreement();
  renderOverview();
}

// One row per roster labeler for THIS frame — a read-only status list
// (2026-08: no more click-to-select, admin has nothing to arm any more).
// Hovering still highlights that person's dots on canvas, same as always.
// Rebuilt every render(); the DOM is small (labelers, not frames) so
// there's no need to diff it.
function renderAdminPicker() {
  if (!state.isAdmin) return;
  const box = $('admin-picker');
  box.textContent = '';
  const f = state.frames[state.i];
  if (!f) return;
  const k = key(f);
  for (const l of [...state.roster].sort((a, b) => a.labeler.localeCompare(b.labeler))) {
    const bundle = state.teamBundles.get(l.labeler);
    const r = state.teamRows.get(l.labeler)?.get(k);
    const row = document.createElement('div');
    row.className = 'admin-picker-row';
    row.style.setProperty('--tm-color', state.teamColor.get(l.labeler) || 'var(--ink-dim)');
    const sw = document.createElement('span');
    sw.className = 'sw';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = l.labeler;
    const st = document.createElement('span');
    if (bundle && bundle.inflight.has(k)) { st.className = 'st'; st.textContent = 'saving…'; }
    else if (bundle && bundle.failed.has(k)) { st.className = 'st sk'; st.textContent = 'failed'; }
    else if (r && r.skipped === 1) {
      st.className = 'st sk';
      st.textContent = `skip: ${SKIP_LABELS[r.skip_reason] || r.skip_reason || '?'}`;
    } else if (r && hasPoints(r)) { st.className = 'st dn'; st.textContent = 'placed'; }
    else if (r && hasAnyPoint(r)) { st.className = 'st'; st.textContent = 'partial'; }
    else { st.className = 'st'; st.textContent = '—'; }
    row.append(sw, nm, st);
    row.onmouseenter = () => setTeamHover(l.labeler);
    row.onmouseleave = () => setTeamHover(null);
    box.appendChild(row);
  }
}

// One "Points — Name" card per roster member with ACTUAL point data on
// this frame — the only Points display admin ever sees, since it has no
// "own" identity to give a #q-card-style special treatment to (see the
// admin-mode header comment). Same dot/coord/switch language, reused via
// a LOCAL --hp-color per card rather than new colour CSS (see the
// stylesheet note on #admin-points-card). The switch answers a correction
// immediately (setAdminVis()); dragging the dot on the canvas is the only
// way to MOVE one — these cards show state, they never arm a placement. A
// skip earns no card — hasAnyPoint() is the same gate the canvas uses, so
// a frame nobody has placed anything on shows nothing here either.
// Rebuilt every render(); the DOM is small (labelers, not frames) so
// there's no need to diff it.
function renderAdminPointsList() {
  const box = $('admin-points-list');
  if (!box) return;
  box.textContent = '';
  if (!state.isAdmin) return;
  const f = state.frames[state.i];
  if (!f) return;
  const k = key(f);
  for (const l of [...state.roster].sort((a, b) => a.labeler.localeCompare(b.labeler))) {
    const name = l.labeler;
    const row = state.teamRows.get(name)?.get(k);
    if (!row || !hasAnyPoint(row)) continue;
    const card = document.createElement('div');
    card.className = 'card admin-pt-card';
    card.dataset.labeler = name;
    card.style.setProperty('--hp-color', state.teamColor.get(name) || 'var(--ink-dim)');
    const eyebrow = document.createElement('p');
    eyebrow.className = 'card-eyebrow';
    eyebrow.textContent = `Points — ${name}`;
    card.appendChild(eyebrow);
    card.appendChild(buildAdminToolRow(name, 'chin', 'Chin tip', row));
    card.appendChild(buildAdminToolRow(name, 'sh', 'Shoulder top', row));
    box.appendChild(card);
  }
}

function buildAdminToolRow(labeler, p, label, row) {
  const xKey = p === 'chin' ? 'chin_x' : 'sh_x', yKey = p === 'chin' ? 'chin_y' : 'sh_y';
  const visKey = p === 'chin' ? 'chin_vis' : 'sh_vis';
  const has = row[xKey] !== null && row[xKey] !== undefined;
  const vis = row[visKey];

  const wrap = document.createElement('div');
  wrap.className = 'tool-row admin-tool-row';
  wrap.dataset.p = p;

  const head = document.createElement('div');
  head.className = 'tool-row-head';
  const dot = document.createElement('span');
  dot.className = 'dot' + (has ? ' set' : '') + (vis === 'inferred' ? ' inferred' : '');
  const lbl = document.createElement('span');
  lbl.className = 'tool-row-label';
  lbl.textContent = label;
  head.append(dot, lbl);

  const coord = document.createElement('div');
  coord.className = 'tool-row-coord';
  const xSpan = document.createElement('span');
  xSpan.innerHTML = '<b>x</b><span class="trc-x"></span>';
  xSpan.querySelector('.trc-x').textContent = has ? row[xKey].toFixed(3) : '—';
  const ySpan = document.createElement('span');
  ySpan.innerHTML = '<b>y</b><span class="trc-y"></span>';
  ySpan.querySelector('.trc-y').textContent = has ? row[yKey].toFixed(3) : '—';
  coord.append(xSpan, ySpan);

  const sw = document.createElement('div');
  sw.className = 'vis-switch';
  for (const v of ['visible', 'inferred']) {
    const seg = document.createElement('button');
    seg.type = 'button';
    seg.className = 'vis-seg';
    seg.dataset.v = v;
    seg.textContent = v === 'visible' ? 'Seen' : 'Occluded';
    seg.disabled = !has;
    seg.setAttribute('aria-pressed', String(vis === v));
    seg.onclick = () => setAdminVis(labeler, p, v);
    sw.appendChild(seg);
  }

  wrap.append(head, coord, sw);
  return wrap;
}

// Every roster member's saved points for the current slot — everyone,
// always (2026-08): admin has no "own" point path any more (see the
// admin-mode header comment), so there's no target left to exclude and
// nothing left to disambiguate a click against. Every dot here is directly
// draggable — see grabbableTeammatePoint() and the canvas mousedown/
// mousemove/mouseup wiring. Round = chin, square = shoulder, ring =
// inferred, a thin connecting line when both points exist. A partial row
// (one point, not both — see the 2026-08 partial-save work) draws its one
// dot with no line.
function renderTeamMarks() {
  const box = $('marks');
  for (const el of box.querySelectorAll('.tm')) el.remove();
  const links = $('tm-links');
  links.textContent = '';
  if (!state.isAdmin) return;
  const f = state.frames[state.i];
  if (!f) return;
  const k = key(f);
  for (const l of state.roster) {
    const name = l.labeler;
    const r = state.teamRows.get(name)?.get(k);
    if (!r) continue;
    const color = state.teamColor.get(name) || 'var(--ink-dim)';
    const chin = (r.chin_x !== null && r.chin_x !== undefined) ? [r.chin_x, r.chin_y] : null;
    const sh = (r.sh_x !== null && r.sh_x !== undefined) ? [r.sh_x, r.sh_y] : null;
    for (const [which, xy, vis] of [['chin', chin, r.chin_vis], ['sh', sh, r.sh_vis]]) {
      if (!xy) continue;
      const d = document.createElement('div');
      d.className = `tm ${which}${vis === 'inferred' ? ' inferred' : ''}`;
      d.dataset.who = name;
      d.style.setProperty('--tm-color', color);
      d.style.left = `${xy[0] * 100}%`;
      d.style.top = `${xy[1] * 100}%`;
      d.title = `${name} — ${which === 'chin' ? 'chin' : 'shoulder'} — drag to move, right-click for options`;
      d.onmouseenter = () => setTeamHover(name);
      d.onmouseleave = () => setTeamHover(null);
      box.appendChild(d);
    }
    if (!chin || !sh) continue;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', chin[0]); line.setAttribute('y1', chin[1]);
    line.setAttribute('x2', sh[0]);   line.setAttribute('y2', sh[1]);
    line.setAttribute('stroke', color);
    line.dataset.who = name;
    links.appendChild(line);
  }
}

// ── overview grid ──────────────────────────────────────────────────────────
// One grid per AGREE_METRICS entry, all three built identically — same
// batch-number gutter, same geometry — so they read as three views of one
// object rather than a main grid and two lesser afterthoughts. Clicking
// any dot does what #ov4 always did (go to that frame) AND picks which
// metric the agreement card below is showing — see setAgreeMetric().
function buildOverview() {
  buildOneGrid('ov4', 'euclid', true);
  buildOneGrid('ov-height', 'height', true);
  buildOneGrid('ov-width', 'width', true);
}

function buildOneGrid(containerId, metric, withGutter) {
  const ov = $(containerId);
  if (!ov) return;
  ov.textContent = '';
  const dots = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < state.frames.length; i++) {
    const d = document.createElement('div');
    d.className = 'd4';
    d.title = `#${i + 1}`;
    // The marker goes on the first row of each new batch — same technique
    // as 3.0's #ov i[data-batch] — and never on the very first batch.
    if (i >= BATCH && i % BATCH < BATCH_COLS) d.dataset.batch = '1';
    frag.appendChild(d);
    dots.push(d);
  }
  ov.appendChild(frag);
  state.ovDots[metric] = dots;
  ov.onclick = (e) => {
    const at = dots.indexOf(e.target);
    if (at < 0) return;
    setAgreeMetric(metric);
    go(at);
  };
  if (!withGutter) return;

  // Batch-number gutter, plus three count spans per batch (green/amber/red
  // — filled in by paintBatchCounts(), which runs whenever the disagree
  // maps do) — same geometry as 3.0's numbers() so a label never drifts
  // out of step with the batch it names.
  const gutter = ov.parentElement.querySelector('.ovn');
  if (!gutter) return;
  const col = document.createDocumentFragment();
  const gutterEls = [];
  for (let b = 0; b * BATCH < state.frames.length; b++) {
    const count = Math.min(BATCH, state.frames.length - b * BATCH);
    const rows = Math.ceil(count / BATCH_COLS);
    const n = document.createElement('b');
    const num = document.createElement('span');
    num.textContent = b + 1;
    const g = document.createElement('span');
    g.className = 'ovn-g';
    const a = document.createElement('span');
    a.className = 'ovn-a';
    const r = document.createElement('span');
    r.className = 'ovn-r';
    n.append(num, g, a, r);
    n.style.height = `${rows * 9 + (rows - 1) * 3}px`;
    n.style.lineHeight = '9px';
    if (b) n.style.marginTop = '10px';
    n.title = `frames ${b * BATCH + 1}–${b * BATCH + count}`;
    col.appendChild(n);
    gutterEls.push({ g, a, r });
  }
  gutter.replaceChildren(col);
  state.ovGutters[metric] = gutterEls;
}

// Text for each disagreement kind, admin mode only — the tooltip carries
// the same information the colour does, so the grid isn't hue-only (a real
// accessibility gap for red/green colour-blind readers, and cheap to close).
function disagreeTitle(i, dg, metric) {
  const n = `#${i + 1}`;
  switch (dg.kind) {
    case 'none': return `${n} — not labeled`;
    case 'solo': return `${n} — only one opinion so far`;
    case 'conflict': return `${n} — skip conflict: someone placed points, someone else skipped`;
    case 'skip-mixed': return `${n} — everyone skipped, but for different reasons`;
    case 'skip-agree': return `${n} — everyone agrees: can't be labeled`;
    default: {
      const parts = [dg.chinOk ? 'chin agrees' : 'chin disagrees', dg.shOk ? 'shoulder agrees' : 'shoulder disagrees'];
      return `${n} — ${METRIC_LABELS[metric]}: ${parts.join(', ')}`;
    }
  }
}

// #ov4 (euclid) paints in both modes — it's the only grid normal mode
// shows, with its own done/skip/partial colouring below. The two
// secondary grids (height/width) are admin-only visualizations of a
// disagreement TYPE, meaningless without a second labeler to compare
// against, so they're skipped entirely in normal mode.
function renderOverview() {
  paintOneGrid('euclid');
  if (!state.isAdmin) return;
  paintBatchCounts('euclid');
  paintOneGrid('height');
  paintBatchCounts('height');
  paintOneGrid('width');
  paintBatchCounts('width');
}

// Green/amber/red tally per batch, under that batch's number — admin-only,
// same colour meaning as the dots beside it. A PARTIAL breakdown, not a
// full accounting: only 'scored' and the two kinds that render one of the
// three clean colours exactly ('skip-agree' -> green, 'conflict' -> red)
// count. 'skip-mixed' (a blended amber-ish tone) and 'solo'/'none' aren't
// any of the three, so they're left out rather than force-fit — the three
// numbers do NOT have to sum to the batch size. Updates the spans
// buildOneGrid() already created rather than rebuilding them, so this can
// run on every disagree-map change without replaying anything.
function paintBatchCounts(metric) {
  const gutterEls = state.ovGutters[metric];
  const map = state.disagreeByMetric[metric];
  if (!gutterEls || !map) return;
  for (let b = 0; b < gutterEls.length; b++) {
    let g = 0, a = 0, r = 0;
    const start = b * BATCH, end = Math.min(start + BATCH, state.frames.length);
    for (let i = start; i < end; i++) {
      const dg = map.get(key(state.frames[i]));
      if (!dg) continue;
      if (dg.kind === 'skip-agree' || (dg.kind === 'scored' && dg.level === 0)) g++;
      else if (dg.kind === 'scored' && dg.level === 0.5) a++;
      else if (dg.kind === 'conflict' || (dg.kind === 'scored' && dg.level === 1)) r++;
    }
    const els = gutterEls[b];
    els.g.textContent = g || '';
    els.a.textContent = a || '';
    els.r.textContent = r || '';
  }
}

function paintOneGrid(metric) {
  const dots = state.ovDots[metric];
  if (!dots) return;
  for (let i = 0; i < state.frames.length; i++) {
    const k = key(state.frames[i]);
    const d = dots[i];
    if (state.isAdmin) {
      const dg = state.disagreeByMetric[metric].get(k) || { kind: 'none', level: null };
      let cls = 'd4';
      d.style.background = '';
      if (dg.kind === 'solo') cls += ' solo';
      else if (dg.kind === 'scored') {
        // Discrete, not a gradient: exactly one of three colours, matching
        // the three possible outcomes (both landmarks agree / one does /
        // neither does) rather than a blended shade that could mean
        // several different things.
        d.style.background = dg.level === 0 ? 'var(--yes)' : dg.level === 1 ? 'var(--no)' : 'var(--maybe)';
      } else if (dg.kind !== 'none') {
        d.style.background = lerpColor(dg.level);
        if (dg.kind === 'conflict') cls += ` ${CONFLICT_RING}`;
      }
      if (i === state.i) cls += ' cur';
      d.title = disagreeTitle(i, dg, metric);
      if (d.className !== cls) d.className = cls;
      continue;
    }
    // Cheap insurance against a stray leftover from a prior admin-mode
    // render in this same tab (e.g. testing by retyping the name field) —
    // both are no-ops on a dot that was never touched. Only 'euclid' ever
    // reaches here — see the isAdmin guard in renderOverview() above.
    d.style.background = '';
    d.title = `#${i + 1}`;
    const row = state.labels.get(k);
    let cls = 'd4';
    if (row && row.skipped) cls += ' sk';
    else if (hasPoints(row)) cls += ' dn';
    // Amber: one point down, the other still to come — provisional, not
    // done, but a real dot rather than indistinguishable from untouched.
    else if (hasAnyPoint(row)) cls += ' part';
    if (row && row.camera_bad) cls += ' cb';
    if (i === state.i) cls += ' cur';
    if (d.className !== cls) d.className = cls;
  }
}

// ── copy buttons / status ──────────────────────────────────────────────────
function wireCopyButtons() {
  for (const b of document.querySelectorAll('.idc')) {
    b.onclick = async () => {
      const text = $(b.dataset.copy).textContent;
      try { await navigator.clipboard.writeText(text); } catch (e) { return; }
      b.classList.add('copied');
      setTimeout(() => b.classList.remove('copied'), 900);
    };
  }
}

function status(msg, cls) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = cls || '';
}

// ── zoom / pan — verbatim from 3.0 ─────────────────────────────────────────
function applyTransform() {
  const stage = $('stage');
  stage.style.transform =
    `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  stage.style.setProperty('--inv', String(1 / state.zoom));
  stage.classList.toggle('zoomed', !isFitted());
  const mag = magnification();
  stage.classList.toggle('sharp',
    !!mag && mag.hd && mag.now >= SHARP_MAG);
  // Zooming in to check a placement is exactly when the question is open.
  if (state.pop && state.pop.kind === 'point') positionPointPop(state.pop.name);
}
// Device pixels per source pixel: `fit` is what displaying the frame at all
// costs (stage width vs the JPEG's own width), `now` folds in the zoom on top,
// and `hd` is whether the source has the resolution to be worth drawing
// pixel-exactly. null until the image reports its size — the frame's own
// resolution is half the input, so there is nothing to decide before it loads.
function magnification() {
  const w = $('stage').offsetWidth;          // layout width, pre-transform
  const img = $('frame');
  if (!w || !img.naturalWidth) return null;
  const fit = (w * (window.devicePixelRatio || 1)) / img.naturalWidth;
  return {
    fit,
    now: fit * state.zoom,
    hd: Math.min(img.naturalWidth, img.naturalHeight) >= SHARP_MIN_SOURCE,
  };
}
function isFitted() {
  return state.zoom === 1 && state.panX === 0 && state.panY === 0;
}
function resetZoom() {
  state.zoom = 1; state.panX = 0; state.panY = 0;
  applyTransform();
}
function zoomAt(px, clientX, clientY) {
  const before = state.zoom;
  let after = before * Math.exp(-px * ZOOM_SPEED);
  after = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, after));
  if ((before - 1) * (after - 1) < 0) after = 1;
  if (after === before) return;
  const r = $('stage').getBoundingClientRect();
  const k = 1 - after / before;
  state.zoom = after;
  state.panX += (clientX - r.left) * k;
  state.panY += (clientY - r.top) * k;
  if (Math.abs(state.panX) < 0.5) state.panX = 0;
  if (Math.abs(state.panY) < 0.5) state.panY = 0;
  applyTransform();
}

// ── point placement ────────────────────────────────────────────────────────
// Screen position -> image-normalized. getBoundingClientRect returns the
// stage's post-transform box, so zoom and pan are already inside it.
function stageNorm(clientX, clientY) {
  const r = $('stage').getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return [Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
          Math.min(1, Math.max(0, (clientY - r.top) / r.height))];
}

function screenPxOf(p) {
  const r = $('stage').getBoundingClientRect();
  return [r.left + p[0] * r.width, r.top + p[1] * r.height];
}

// The point whose dot sits within GRAB_PX of the cursor, nearest first.
function grabbablePoint(clientX, clientY) {
  let best = null, bestD = GRAB_PX;
  for (const name of ['chin', 'sh']) {
    const p = state.pts[name];
    if (!p) continue;
    const [sx, sy] = screenPxOf(p);
    const d = Math.hypot(clientX - sx, clientY - sy);
    if (d <= bestD) { best = name; bestD = d; }
  }
  return best;
}

// The teammate DOT within GRAB_PX of the cursor — every .tm on screen is
// fair game, since admin never has an "own" point (.hp) to exclude any
// more. Reads ACTUAL rendered position (getBoundingClientRect), same as
// grabbablePoint(), so this stays correct under zoom/pan without
// duplicating that math.
function grabbableTeammatePoint(clientX, clientY) {
  let best = null, bestD = GRAB_PX;
  for (const el of document.querySelectorAll('#marks .tm')) {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
    if (d <= bestD) {
      best = { labeler: el.dataset.who, point: el.classList.contains('chin') ? 'chin' : 'sh' };
      bestD = d;
    }
  }
  return best;
}

function placeAt(name, clientX, clientY) {
  const p = stageNorm(clientX, clientY);
  if (!p) return;
  state.pts[name] = p;
  state.vis[name] = null;            // unanswered until the popover is answered
  state.skipped = false;
  state.skipReason = null;
  state.arm = null;                  // the popover owns the next click
  render();
  openPointPop(name);
}

// A correction, not a new placement: the visibility answer already given
// stands and is not asked again, and a popover still open on this point
// follows the dot instead.
function movePoint(name, clientX, clientY) {
  const p = stageNorm(clientX, clientY);
  if (!p) return;
  state.pts[name] = p;
  render();
  if (state.pop && state.pop.kind === 'point' && state.pop.name === name) {
    positionPointPop(name);
  }
}

// ── popovers ───────────────────────────────────────────────────────────────
// One at a time: both are a question about the click that just happened, and
// two open at once would mean two different things Enter could answer.
function closePop() {
  state.pop = null;
  $('pt-pop').hidden = true;
  $('skip-pop').hidden = true;
}

// The right-click menu is not a popover: it doesn't own the keyboard, and
// asks nothing — it OFFERS two actions rather than asking a question, for
// the labeler with no Del key (a touchpad-only laptop), no memory for
// Shift+C/Shift+S, or who just prefers a click. Opening it selects the
// point the same way pressing it does, so the highlight matches what a
// following Del (or the menu's own Delete item) would also act on.
function closeCtx() {
  $('pt-ctx').hidden = true;
  state.ctxFor = null;
  state.tmCtxFor = null;
}

// Shared positioning for both openCtx() (the active identity's own point)
// and openTmCtx() (a teammate's) — the menu, its anchor card and the
// clamping math are the same regardless of whose point it's about.
function positionCtxMenu(clientX, clientY) {
  const menu = $('pt-ctx');
  const card = $('stage-card').getBoundingClientRect();
  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(card.width - w - 8, clientX - card.left))}px`;
  menu.style.top = `${Math.max(8, Math.min(card.height - h - 8, clientY - card.top))}px`;
}

function openCtx(name, clientX, clientY) {
  state.ctxFor = name;
  state.tmCtxFor = null;
  state.active = name;
  placeMarks();
  // Names the ACTION, not the current state — same convention as the cam
  // button's own label. Unanswered (state.vis[name] === null, the point
  // was just placed and the popover hasn't been answered yet) reads the
  // same as 'visible' here: the natural first offer is "mark it occluded",
  // matching toggleVis()'s own default direction.
  const nextVis = state.vis[name] === 'inferred' ? 'visible' : 'inferred';
  $('pt-ctx-vis').textContent = nextVis === 'inferred' ? 'Mark as Occluded' : 'Mark as Seen';
  positionCtxMenu(clientX, clientY);
}

// The same menu, opened on a TEAMMATE's dot (admin mode only) — reuses the
// exact positioning and both actions, since flipping seen/occluded or
// deleting an existing point is unambiguous no matter whose it is.
function openTmCtx(tm, clientX, clientY) {
  state.tmCtxFor = tm;
  state.ctxFor = null;
  const row = state.teamRows.get(tm.labeler)?.get(key(state.frames[state.i]));
  const curVis = row ? (tm.point === 'chin' ? row.chin_vis : row.sh_vis) : null;
  const nextVis = curVis === 'inferred' ? 'visible' : 'inferred';
  $('pt-ctx-vis').textContent = nextVis === 'inferred' ? 'Mark as Occluded' : 'Mark as Seen';
  positionCtxMenu(clientX, clientY);
}

function openPointPop(name) {
  if (!state.pts[name]) return;      // nothing placed, nothing to qualify
  state.pop = { kind: 'point', name };
  $('skip-pop').hidden = true;
  const pop = $('pt-pop');
  $('pt-pop-t').textContent = name === 'chin'
    ? 'The chin tip — could you see it?'
    : 'The shoulder top — could you see it?';
  pop.hidden = false;
  positionPointPop(name);
}

// Beside the point, inside the card: the labeler has to be able to look from
// the question to the pixels it is about without hunting for either.
function positionPointPop(name) {
  const pop = $('pt-pop');
  const card = $('stage-card').getBoundingClientRect();
  const [sx, sy] = screenPxOf(state.pts[name]);
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const GAP = 16;
  let left = sx - card.left + GAP;
  if (left + w > card.width - 8) left = sx - card.left - GAP - w;
  let top = sy - card.top - h / 2;
  pop.style.left = `${Math.max(8, Math.min(card.width - w - 8, left))}px`;
  pop.style.top = `${Math.max(8, Math.min(card.height - h - 8, top))}px`;
}

function choosePointVis(name, v) {
  if (!state.pts[name]) return;
  state.vis[name] = v;
  // Only closes a popover that is asking about THIS point — every existing
  // caller (the popover's own buttons, the 1/2 keys) already only ever
  // passes state.pop.name, so this is a no-op change for them. It matters
  // for the right-click menu, which can name a point OTHER than the one a
  // still-open popover is asking about, and must not swat that one shut.
  if (state.pop && state.pop.kind === 'point' && state.pop.name === name) closePop();
  // Answering the chin arms the shoulder; answering the shoulder disarms. A
  // labeler doing frame after frame never touches the tool rows: click chin,
  // answer, click shoulder, answer, Enter.
  state.arm = (name === 'chin' && !state.pts.sh) ? 'sh' : null;
  render();
}

// Changing your mind about an answer already given, rather than re-opening
// the question: the switch already SHOWS which answer this point carries, so
// the thing to do with it is pick the other one — re-asking a yes/no you can
// already see is a dialog for a decision that has no third option. The
// popover is for the moment a point lands with no answer at all; these are
// for every moment after.
//
// Does not force a save — same as dragging a point, it just updates local
// state and lets commitCurrent()'s isDirty() check pick it up on the normal
// path (advance, skip, leaving the frame).
function setVis(name, v) {
  if (!state.pts[name] || !state.vis[name]) return;   // unplaced, or still being asked
  state.vis[name] = v;
  render();
}

// Shift+C / Shift+S flip whichever answer is showing, without naming one.
function toggleVis(name) {
  if (!state.pts[name] || !state.vis[name]) return;   // unplaced, or still being asked
  setVis(name, state.vis[name] === 'inferred' ? 'visible' : 'inferred');
}

// Esc on the point popover undoes the placement rather than leaving a point
// with no answer behind: the click and its qualification are one act.
function cancelPoint(name) {
  state.pts[name] = null;
  state.vis[name] = null;
  if (state.active === name) state.active = null;
  state.arm = name;
  closePop();
  render();
}

// Del on the active point, or the right-click menu's own option: remove one
// point outright. Unlike cancelPoint (Esc mid-popover), this can also strip
// an answer already given — the point is being redone, not un-placed.
function deletePoint(name) {
  if (!state.pts[name]) return;
  state.pts[name] = null;
  state.vis[name] = null;
  if (state.active === name) state.active = null;
  if (state.pop && state.pop.kind === 'point' && state.pop.name === name) closePop();
  state.arm = name;
  render();
}

function openSkipPop() {
  state.pop = { kind: 'skip' };
  $('pt-pop').hidden = true;
  $('skip-pop').hidden = false;
}

function doSkip(reason) {
  closePop();
  closeCtx();
  state.pts = { chin: null, sh: null };
  state.vis = { chin: null, sh: null };
  state.active = null;
  state.skipped = true;
  state.skipReason = reason;
  if (save({ skip: reason })) advance(); else render();
}

function clearPoints() {
  closePop();
  closeCtx();
  state.pts = { chin: null, sh: null };
  state.vis = { chin: null, sh: null };
  state.active = null;
  state.arm = 'chin';
  state.skipped = false;
  state.skipReason = null;
  render();
}

// ── wiring ─────────────────────────────────────────────────────────────────
function bind() {
  for (const row of document.querySelectorAll('.tool-row')) {
    row.onclick = () => {
      // Re-arming behind an open question would leave the point it is about
      // unanswered and the popover pointing at nothing. Answer it first.
      if (state.pop) return;
      state.arm = row.dataset.p;
      render();
    };
  }
  // The switch sits right under a row whose click re-arms — stop the bubble
  // so picking an answer doesn't also re-arm the point above it.
  for (const seg of document.querySelectorAll('.vis-seg')) {
    seg.onclick = (e) => { e.stopPropagation(); setVis(seg.dataset.p, seg.dataset.v); };
  }

  // Save on a blank frame is refused, not converted to a skip: a skip now
  // carries a REASON, and "you pressed Enter without placing points" is not
  // one — save() puts the why in the status line.
  $('save-next').onclick = advance;
  $('save-btn').onclick = adminManualSave;
  // Skip asks WHY before it writes anything: the reason is the data, and a
  // frame is never skipped without one.
  $('skip-btn').onclick = () => {
    if (state.pop && state.pop.kind === 'skip') closePop(); else openSkipPop();
  };
  for (const b of $('skip-pop').querySelectorAll('.pop-opt')) {
    b.onclick = () => doSkip(b.dataset.reason);
  }
  for (const b of $('pt-pop').querySelectorAll('.pop-opt')) {
    b.onclick = () => {
      if (state.pop && state.pop.kind === 'point') choosePointVis(state.pop.name, b.dataset.v);
    };
  }
  // Flips seen/occluded. For the active identity (state.ctxFor) this is a
  // correction like Shift+C/Shift+S — it does not force a save; the normal
  // commit path picks it up via isDirty(), same as dragging a point does.
  // For a TEAMMATE (state.tmCtxFor) it saves immediately — see
  // setAdminVis() for why.
  $('pt-ctx-vis').onclick = () => {
    if (state.tmCtxFor) {
      const { labeler, point } = state.tmCtxFor;
      const row = state.teamRows.get(labeler)?.get(key(state.frames[state.i]));
      closeCtx();
      if (row) {
        const cur = point === 'chin' ? row.chin_vis : row.sh_vis;
        setAdminVis(labeler, point, cur === 'inferred' ? 'visible' : 'inferred');
      }
      return;
    }
    const name = state.ctxFor;
    closeCtx();
    if (name && state.pts[name]) {
      choosePointVis(name, state.vis[name] === 'inferred' ? 'visible' : 'inferred');
    }
  };
  $('pt-ctx-del').onclick = () => {
    if (state.tmCtxFor) {
      const { labeler, point } = state.tmCtxFor;
      closeCtx();
      deleteTeammatePoint(labeler, point);
      return;
    }
    const name = state.ctxFor;
    closeCtx();
    if (name) deletePoint(name);
  };
  // Any click outside the menu dismisses it, same as any other transient
  // popup — the delete option is the only thing on it worth a dedicated
  // Esc handler for.
  window.addEventListener('mousedown', (e) => {
    if (!$('pt-ctx').hidden && !$('pt-ctx').contains(e.target)) closeCtx();
  });

  const gotoFrame = () => {
    const el = $('goto-n');
    const n = parseInt(el.value, 10);
    if (!isFinite(n) || !state.frames.length) return;
    go(Math.max(0, Math.min(state.frames.length - 1, n - 1)));
    el.blur();
  };
  $('goto-go').onclick = gotoFrame;
  $('goto-n').onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') gotoFrame();
  };

  // Applies immediately — recompute + repaint both the overview grid and
  // the current frame's agreement card — and persists, so a bad value
  // typed mid-digit (e.g. the "1" on the way to "15") never lingers past
  // the next keystroke, and a good one survives a reload. Chin and
  // shoulder are wired identically but independently — one changing never
  // touches the other's stored value or input.
  const wireThresh = (elId, storageKey, field) => {
    const el = $(elId);
    el.value = String(Math.round(state[field] * 100));
    el.oninput = () => {
      const n = Math.round(Number(el.value));
      if (!Number.isFinite(n) || n < 1 || n > 50) return;
      state[field] = n / 100;
      try { localStorage.setItem(storageKey, String(n)); } catch (e) {}
      if (state.isAdmin) {
        computeAllDisagree();
        renderOverview();
        renderAgreementCard();
      }
    };
    el.onkeydown = (e) => e.stopPropagation();
  };
  wireThresh('agree-thresh-chin', THRESH_KEY_CHIN, 'agreeThreshChin');
  wireThresh('agree-thresh-sh', THRESH_KEY_SH, 'agreeThreshSh');

  // Which two labelers state.agreePair compares — see setAgreePair().
  $('agree-a').onchange = (e) => setAgreePair(0, e.target.value);
  $('agree-b').onchange = (e) => setAgreePair(1, e.target.value);

  // Each of the three metric labels doubles as a fold/unfold button — see
  // toggleMetricFold(). Independent of setAgreeMetric(): folding a grid
  // away doesn't change which one the agreement card is showing, and
  // clicking a dot in a grid never folds it. The fold state itself is only
  // APPLIED once admin mode is confirmed (start()'s admin branch) — #ov4
  // is shared with normal mode, and applying a persisted "euclid folded"
  // here, before login, would hide a normal labeler's only progress grid.
  for (const m of AGREE_METRICS) {
    const btn = $(`metric-label-${m}`);
    if (btn) btn.onclick = () => toggleMetricFold(m);
  }

  $('prev').onclick = () => go(state.i - 1);
  $('next').onclick = () => go(state.i + 1);

  const syncGo = () => { renderNameState(); };
  const commitName = () => {
    if (!who()) return;
    window.CMLabeler && window.CMLabeler.set && window.CMLabeler.set(who());
    syncGo();
    start();
  };
  $('labeler-input').oninput = syncGo;
  $('labeler-input').onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commitName();
  };
  $('name-go').onclick = commitName;
  $('team-btn').onclick = () => setTeamOpen(!state.teamOpen);
  // Local toggle only — no save here. Saving is leaving: the flag rides
  // along on whatever save Next/Prev/Skip (or their keyboard equivalents)
  // triggers next, same as any other in-progress edit. isDirty() already
  // diffs camera_bad against the saved row, so a correction on an already-
  // saved frame is still picked up on the next departure.
  $('cam-btn').onclick = () => {
    state.camBad = !state.camBad;
    renderCam();
    renderOverview();
  };
  wireCopyButtons();

  const stage = $('stage');
  const card = $('stage-card');
  stage.onmouseenter = () => card.classList.add('guide');
  stage.onmouseleave = () => card.classList.remove('guide');
  stage.onmousemove = (e) => {
    const r = card.getBoundingClientRect();
    $('gx').style.top = `${e.clientY - r.top}px`;
    $('gy').style.left = `${e.clientX - r.left}px`;
    if (state.ptDrag) {
      const p = stageNorm(e.clientX, e.clientY);
      if (p) {
        state.pts[state.ptDrag] = p;
        placeMarks();
        updateToolCoord(state.ptDrag);   // live x/y in the sidebar while dragging
        // Nudging a point before answering its question is normal; the
        // question has to travel with it.
        if (state.pop && state.pop.kind === 'point' && state.pop.name === state.ptDrag) {
          positionPointPop(state.ptDrag);
        }
      }
      return;
    }
    if (state.tmDrag) {
      const p = stageNorm(e.clientX, e.clientY);
      if (p) updateTeammatePointLive(state.tmDrag, p);
      return;
    }
    if (state.drag) {
      state.panX = state.drag.px + (e.clientX - state.drag.x);
      state.panY = state.drag.py + (e.clientY - state.drag.y);
      applyTransform();
    }
  };
  stage.onmousedown = (e) => {
    // Right button is the context menu's, not the drag's — without this a
    // right-click also grabbed the point under it before oncontextmenu ever
    // saw the click.
    if (!state.ready || e.button !== 0) return;
    state.down = { x: e.clientX, y: e.clientY };
    // grabbablePoint() reads state.pts, which stays empty for the entire
    // admin session (nothing ever populates it — see activeLabeler()), so
    // this always falls straight through to the teammate check below in
    // admin mode at zero cost.
    const grab = grabbablePoint(e.clientX, e.clientY);
    if (!grab && state.isAdmin) {
      // A teammate's OWN dot is the only thing on this canvas admin can
      // ever interact with — no placement, ever (see the admin-mode
      // header comment). Anywhere else on the stage falls through to
      // panning below, same as normal mode.
      const tmGrab = grabbableTeammatePoint(e.clientX, e.clientY);
      if (tmGrab) {
        state.tmDrag = tmGrab;
        state.active = null;
        setTeammateDragging(tmGrab, true);
        e.preventDefault();
        return;
      }
    }
    if (grab) {
      state.ptDrag = grab;
      state.active = grab;
      $(grab === 'chin' ? 'hp-chin' : 'hp-sh').classList.add('dragging');
      placeMarks();
      e.preventDefault();
      return;
    }
    if (state.active) { state.active = null; placeMarks(); }
    if (!isFitted()) {
      state.drag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
      stage.classList.add('panning');
    }
    e.preventDefault();
  };
  // Right-click a placed point for the same delete Del gives it — for a
  // touchpad with no Del key, or a labeler who'd rather click than reach for
  // one. Works on any teammate's point too, admin mode only. Anywhere else
  // on the stage keeps the browser's own menu.
  stage.oncontextmenu = (e) => {
    if (!state.ready) return;
    const grab = grabbablePoint(e.clientX, e.clientY);
    if (grab) { e.preventDefault(); openCtx(grab, e.clientX, e.clientY); return; }
    if (state.isAdmin) {
      const tmGrab = grabbableTeammatePoint(e.clientX, e.clientY);
      if (tmGrab) { e.preventDefault(); openTmCtx(tmGrab, e.clientX, e.clientY); return; }
    }
  };
  window.addEventListener('mouseup', (e) => {
    const wasPtDrag = state.ptDrag;
    const wasTmDrag = state.tmDrag;
    if (state.ptDrag) {
      $('hp-chin').classList.remove('dragging');
      $('hp-sh').classList.remove('dragging');
      state.ptDrag = null;
      state.skipped = false;
      render();                    // sync tool rows + save button
    }
    if (state.tmDrag) {
      setTeammateDragging(state.tmDrag, false);
      state.tmDrag = null;
    }
    const startedOnStage = !!state.down;
    const moved = state.down
      && Math.hypot(e.clientX - state.down.x, e.clientY - state.down.y) > CLICK_SLOP_PX;
    state.drag = null;
    state.down = null;
    stage.classList.remove('panning');
    if (!startedOnStage) return;
    if (wasTmDrag) {
      // Live mousemove updates already moved the dot; a real drag just
      // needs the save fired here. A stationary click re-confirms the
      // SAME position and does nothing else.
      if (moved) saveTeammateRow(wasTmDrag.labeler);
      return;
    }
    if (moved) return;      // a real drag on the active identity's own point — mousemove already handled it
    if (!state.ready) return;
    // A stationary click that landed on an existing dot always selects and
    // repositions THAT dot — never places a new one there, arm or no arm.
    // It used to be swallowed as a zero-length drag, so a 3px correction
    // moved nothing and the dots read as snapping to a grid; an armed point
    // used to win outright, so a click within GRAB_PX of an existing point
    // could still stack a second point on top of it. With one point placed
    // this fired on nearly every click, since the other slot is armed by
    // default the moment its neighbour is answered.
    if (wasPtDrag) {
      movePoint(wasPtDrag, e.clientX, e.clientY);
      return;
    }
    // A plain click on the stage places the armed point. With nothing
    // armed it does nothing — points move by drag, not by surprise. Nothing
    // is armed while a popover is open, so a stray click cannot move the
    // point the open question is about. Admin never has anything armed —
    // state.arm only ever moves for the normal-mode self — but the
    // explicit isAdmin check stays as a hard stop, not an implicit one.
    if (!state.ready || !state.arm) return;
    if (state.isAdmin) return;
    placeAt(state.arm, e.clientX, e.clientY);
  });
  stage.ondblclick = resetZoom;
  const DELTA_PX = { 0: 1, 1: 16, 2: 400 };
  $('stage-card').addEventListener('wheel', (e) => {
    e.preventDefault();
    const px = e.deltaY * (DELTA_PX[e.deltaMode] || 1);
    zoomAt(Math.max(-200, Math.min(200, px)), e.clientX, e.clientY);
  }, { passive: false });

  // applyTransform, not just placeMarks: the new frame's own resolution is
  // half of the sharp/smooth decision, and it is only known once it loads.
  $('frame').onload = () => {
    $('frame').classList.remove('broken');
    placeMarks();
    applyTransform();
  };
  $('frame').onerror = () => {
    $('frame').classList.add('broken');
    status('Frame image did not load — check your connection', 'err');
  };

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!state.ready) return;
    // The right-click menu isn't a popover — it doesn't own the rest of the
    // keyboard — but Esc dismissing it is expected regardless.
    if (!$('pt-ctx').hidden) {
      if (e.key === 'Escape') { closeCtx(); e.preventDefault(); }
      return;
    }
    const k = e.key.toLowerCase();
    // An open popover owns the keyboard: 1/2 answer it, Esc backs out, and
    // everything else is swallowed so a reflex C or Enter cannot skip past
    // an unanswered question.
    if (state.pop) {
      if (state.pop.kind === 'point') {
        if (k === '1') choosePointVis(state.pop.name, 'visible');
        else if (k === '2') choosePointVis(state.pop.name, 'inferred');
        else if (e.key === 'Escape') cancelPoint(state.pop.name);
      } else {
        if (k === '1') doSkip('not_visible');
        else if (k === '2') doSkip('no_stance');
        else if (e.key === 'Escape') closePop();
      }
      e.preventDefault();
      return;
    }
    // Shift+C / Shift+S flip an answer already given — checked before the
    // plain keys, which the shifted ones must not also fire. All four
    // (place/re-place/re-answer) are the "own point" vocabulary admin
    // doesn't have — see the admin-mode header comment — so they're
    // no-ops there, same as the hidden C/S rows and switch already are.
    // Navigation (arrows, Enter) stays live for admin either way.
    if (!state.isAdmin && e.shiftKey && k === 'c') toggleVis('chin');
    else if (!state.isAdmin && e.shiftKey && k === 's') toggleVis('sh');
    else if (!state.isAdmin && k === 'c') { state.arm = 'chin'; render(); }
    else if (!state.isAdmin && k === 's') { state.arm = 'sh'; render(); }
    else if (e.key === 'Enter') advance();
    else if (!state.isAdmin && k === 'k') openSkipPop();
    else if (e.key === 'ArrowLeft') go(state.i - 1);
    else if (e.key === 'ArrowRight') go(state.i + 1);
    else if (!state.isAdmin && k === 'g') $('cam-btn').click();
    else if (!state.isAdmin && e.key === 'Delete' && state.active) deletePoint(state.active);
    else if (!state.isAdmin && e.key === 'Escape') clearPoints();
    else return;
    e.preventDefault();
  });
}

async function start() {
  const name = who();
  // Recomputed on every call, not cached — retyping the name field into or
  // out of "admin" mid-session (no reload) has to re-gate immediately.
  state.isAdmin = name.trim().toLowerCase() === 'admin';
  document.body.classList.toggle('admin', state.isAdmin);
  if (!name) {
    state.loadedFor = null;
    setReady(false, 'Enter your name and press Start.');
    status('');
    render();
    return;
  }
  if (state.loadingFor === name) return;
  if (state.loadedFor === name && state.ready) return;

  const token = ++state.loadToken;
  state.loadingFor = name;
  setReady(false, state.isAdmin
    ? 'Loading the team…  this can take a moment.'
    : 'Loading your saved progress…  this can take up to 30 seconds.');
  status(state.isAdmin ? 'Loading the team…' : 'Loading your labels…');

  // Fired now, not awaited: the progress panel is background information
  // that costs about as much as the label read, so queueing it behind
  // that read would make the panel land at roughly double the wait for no
  // reason — nothing in it depends on the label list. Admin fetches its
  // own roster inside the try block below instead, since its whole page
  // depends on having it before anything can render.
  if (!state.isAdmin) {
    loadRoster().then(() => {
      renderTeamPanel();
      prefetchRanges();
      // One unprompted warm per session, whether or not the panel is
      // open — the first open of the day is otherwise the one that still
      // waits, and the disk cache makes every open after it free.
      if (!state.rangesWarmed) {
        state.rangesWarmed = true;
        setTimeout(() => prefetchRanges(true), 8000);
      }
    }).catch((e) => {
      // Never an error banner — the panel is background information and a
      // failed poll must not sit on top of the labeler's status line.
      $('team').innerHTML = '<div id="team-empty"></div>';
      $('team').firstElementChild.textContent = e.message;
    });
  }

  try {
    if (state.isAdmin) {
      await loadRoster();
      await loadTeamRows();
      computeAllDisagree();
    } else {
      await loadLabels();
    }
  } catch (e) {
    if (token === state.loadToken) {
      state.loadingFor = null;
      renderNameState();
      status(e.message, 'err');
      setReady(false, 'Could not load. Press Start to try again.', true);
    }
    return;
  }
  if (token !== state.loadToken) return;
  state.loadingFor = null;
  state.loadedFor = name;
  renderNameState();
  setReady(true);

  if (state.isAdmin) {
    // Admin has no "own" identity — see activeLabeler() and the admin-mode
    // header comment — so these stay the permanently-inert placeholders
    // for the whole session, never bound to anyone's real data. Reset
    // explicitly rather than trusting the initial state object: a prior
    // NORMAL login in this same tab (retyping the name field to "admin",
    // no reload) would otherwise leave that person's real rows sitting
    // here, one retype away from being touched by something that reads
    // state.labels expecting it to mean "mine."
    state.labels = new Map();
    state.failed = new Map();
    state.inflight = new Set();
    state.chains = new Map();
    document.body.style.removeProperty('--hp-color');
    renderTeamProgress();
    renderAgreementCard();
    renderGlobalAgreement();
    renderMetricLabels();
    applyAllMetricFolds();
    startRosterPoll();
    go(0, { initial: true });
    status('');
    return;
  }

  startRosterPoll();
  // A normal login has one labeler, so its own points just need --accent —
  // clear any stale --hp-color a PRIOR admin session left on this tab.
  document.body.style.removeProperty('--hp-color');
  // Same reasoning: a prior admin session in this tab may have folded #ov4
  // shut via an inline style, which normal mode has no button to undo —
  // #ov4 is the only progress grid it has, so it must never start hidden.
  const ov4Wrap = $(METRIC_WRAP_IDS.euclid);
  if (ov4Wrap) ov4Wrap.style.display = '';
  const n = firstUnlabeled(0);
  go(n < 0 ? state.frames.length - 1 : n, { initial: true });
  status(n < 0 ? 'All frames labeled' : '');
  // The team read fired above may have landed while `ready` was still
  // false, which skips the own-row overlay — apply it now that the count
  // (myRowsInQueue) is known.
  bumpMyTeamRow();
}

(async function init() {
  state.hidden = loadHidden();
  bind();
  try {
    const res = await fetch('height_guard_queue.json?v=2');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const q = await res.json();
    state.frames = q.frames || [];
  } catch (e) {
    const viaFile = location.protocol === 'file:';
    const msg = viaFile
      ? 'Open this page over http (the hosted site or a local server) — not by double-clicking the file.'
      : 'Could not load height_guard_queue.json (' + e.message + ').';
    setReady(false, msg, true);
    status(msg, 'err');
    return;
  }
  if (!state.frames.length) {
    setReady(false, 'height_guard_queue.json loaded but contains no frames.', true);
    status('height_guard_queue.json is empty', 'err');
    return;
  }
  setReady(false, 'Loading…');
  state.frames.forEach((f, i) => state.index.set(key(f), i));
  buildOverview();
  restoreName();
  render();
  await start();
})();

// ============================================================
// app-rounds.js — the AMBO app's TestFlight rounds, straight from the QA site
//
// The video picker's "App rounds" tab (app.js's setupVideoPicker()) lists
// every round a TestFlight build of the app uploaded that called punches,
// and every final check, newest first — no script, Drive copy or commit in
// between (Mathé, 2026-11-10: rounds weren't reaching the labeler until
// beginner_queue.py was run by hand). The list, footage and skeleton come
// from the QA site's API (qa-tool's api/sessions.js and api/session.js),
// which only answers a Google account on its TEAM_EMAILS, so this tab asks
// for a Google sign-in through the app's Firebase project.
//
// A round's link is its QA page, https://ambo-qa.vercel.app/#/s/<round id>:
// that's what fills the link box and what labels are filed under (the
// sheet's video_file), and pasting one by hand opens the round too.
// The footage plays from a signed Storage URL that lasts an hour; the
// skeleton is the app's own, drawn as round 0 on the footage's clock.
//
// Run the page against the QA site's made-up recordings with
// ?qa=http://localhost:4173 (qa-tool's `npm run dev`); no sign-in there.
// ============================================================

const APP_QA = new URLSearchParams(location.search).get('qa') || 'https://ambo-qa.vercel.app';
const APP_QA_LOCAL = /^http:\/\/localhost[:/]/.test(APP_QA);
// The app's EAS channels whose builds go out through TestFlight (ambo's eas.json).
const APP_TESTFLIGHT_CHANNELS = ['testflight', 'guided-beta', 'defense-beta'];
// Rounds listed whatever build filmed them, picked by hand: a beginner's whole
// first demo session, 3 rounds of 2 min, filmed on a dev build (2026-11-08;
// Mathé, 2026-11-10: moved here from the beginner queue).
const APP_ADDED_ROUNDS = ['20261108T100059-d743920b', '20261108T100408-1f0cfcdd', '20261108T100718-9400f8e6'];
const APP_LINK_RE = /^https:\/\/ambo-qa\.vercel\.app\/#\/s\/([\w-]+)/;

let _appAuth = null;          // firebase-auth module + auth instance, once loaded
let _appUser = null;
let _appRounds = null;        // null = not fetched yet
let _appRoundsPromise = null;
// The open round's callouts, [{t, show}] on the footage's clock, in time
// order — what the app called and when, for the timeline's Called ribbon.
let _appCallouts = [];

// Firebase's modular SDK is ES modules only; this page's scripts are classic,
// so it comes in through import() the first time it's needed.
async function appAuth() {
  if (_appAuth) return _appAuth;
  const [{ initializeApp }, mod] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js'),
  ]);
  // The project's web app config (public identifiers, not secrets) — the same as qa-tool's auth.js.
  const auth = mod.getAuth(initializeApp({ apiKey: 'AIzaSyC6B7rqq7ACJllABmPD8K6dEmYl2B3X3uY', authDomain: 'mycorner-bee6a.firebaseapp.com', projectId: 'mycorner-bee6a' }));
  await auth.authStateReady();
  _appUser = auth.currentUser;
  _appAuth = { mod, auth };
  return _appAuth;
}

async function appSignedIn() {
  if (APP_QA_LOCAL) return true;
  return !!(await appAuth()).auth.currentUser;
}

async function appSignIn() {
  const { mod, auth } = await appAuth();
  _appUser = (await mod.signInWithPopup(auth, new mod.GoogleAuthProvider())).user;
  _appRounds = null;
  _appRoundsPromise = null;
}

async function appApi(path) {
  const headers = {};
  if (!APP_QA_LOCAL) {
    const { auth } = await appAuth();
    if (!auth.currentUser) throw new Error('Sign in with Google first');
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  const resp = await fetch(APP_QA + path, { headers });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.error || `QA site answered ${resp.status}`);
  return body;
}

// The rounds worth labeling: a TestFlight build's (or one added by hand, see
// APP_ADDED_ROUNDS), with footage, that called punches — or a final check,
// which is scored on the punches thrown whatever was called (Mathé, 2026-11-10).
function appRoundWanted(s) {
  return (APP_TESTFLIGHT_CHANNELS.includes(s.channel) || APP_ADDED_ROUNDS.includes(s.id)) && s.hasVideo && (s.called > 0 || s.kind === 'check');
}

function appRoundName(s) {
  const what = s.kind === 'session' ? 'guided session' : s.kind === 'check' ? 'final check' : (s.drill || s.kind || '').replace(/^.*--/, '').replace(/-/g, ' ');
  return `${s.id} · ${what}${s.endedEarly ? ' (ended early)' : ''}`;
}

// {name, owner, link, n, called, detected} rows for the picker (detected: punches the app's classifier found,
// null on a round from before it saved them), grouped per boxer: the boxer with the newest round first, each
// boxer's rounds newest first (the API's order). Throws when not signed in.
function fetchAppRounds() {
  if (_appRoundsPromise) return _appRoundsPromise;
  _appRoundsPromise = appApi('/api/sessions').then(({ sessions }) => {
    const byOwner = new Map();
    for (const s of sessions.filter(appRoundWanted)) {
      const owner = s.owner || 'anonymous';
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner).push({
        name: appRoundName(s), owner, link: `https://ambo-qa.vercel.app/#/s/${s.id}`, called: s.called, detected: s.detected,
      });
    }
    _appRounds = [...byOwner.values()].flat();
    _appRounds.forEach((v, i) => { v.n = i + 1; });
    return _appRounds;
  }).catch((err) => { _appRoundsPromise = null; throw err; });
  return _appRoundsPromise;
}

// A video the AMBO app recorded — an App rounds link. One round, start to
// end: see app.js's wholeVideoIsRound().
function isAppVideo(link) {
  return !!appRoundId(link);
}

// The round id behind an App rounds link, or null for any other link.
function appRoundId(link) {
  return APP_LINK_RE.exec(String(link || '').trim())?.[1] || null;
}

// The QA site's lean skeleton (qa-tool's api/_store.js lean()) back to the
// layout skeleton.js draws: x, y and visibility per joint, on the footage's
// clock (a skeleton time t is at t - videoT0 in the video).
function appSkeletonRound(r) {
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const xy = new DataView(bytes(r.xy_b64).buffer);
  const vis = bytes(r.vis_b64);
  const times = new Float64Array(bytes(r.times_b64).buffer);
  const n = r.frames, J = r.joints;
  const data = new Float32Array(n * J * 3);
  const unq = (q) => (q === 65535 ? NaN : (q / 65534) * 2 - 0.5);
  for (let i = 0; i < n * J; i++) {
    data[i * 3] = unq(xy.getUint16(i * 4, true));
    data[i * 3 + 1] = unq(xy.getUint16(i * 4 + 2, true));
    data[i * 3 + 2] = vis[i] / 255;
  }
  const pts = new Float32Array(n);
  for (let f = 0; f < n; f++) pts[f] = times[f] - (r.videoT0 || 0);
  const round = {
    round: 0, nFrames: n, nJoints: J, nChannels: 3, xIdx: 0, yIdx: 1, visIdx: 2, data, pts,
    startSec: 0, endSec: n ? pts[n - 1] : 0, fps: r.fps,
  };
  round.dip = computeNoseDip(round);
  return round;
}

// Opens an App rounds link: its footage in the player, its skeleton over it,
// and the stance the boxer set in the app.
async function loadAppRound(id) {
  setSkeletonStatus('syncing', 'Loading the app round…');
  let s;
  try {
    s = await appApi(`/api/session?id=${encodeURIComponent(id)}`);
  } catch (err) {
    setSkeletonStatus('err', 'Could not load');
    showToast(`App round ${id}: ${err.message}`, 'error');
    return false;
  }
  if (appRoundId(document.getElementById('drive-link').value) !== id) return false;  // another video was opened meanwhile
  const video = document.getElementById('video-player');
  const thumbVideo = document.getElementById('thumb-video');
  const url = new URL(s.video, APP_QA).href;
  state.videoName = `${id}.mp4`;
  const nameEl = document.getElementById('video-name');
  if (nameEl) nameEl.textContent = state.videoName;
  resetSkeletonState();
  video.src = url;
  video.load();
  if (thumbVideo) { thumbVideo.src = url; thumbVideo.load(); }
  applySkeletonLoadResult({ rounds: [appSkeletonRound(s.round)], incomplete: 0, invalid: 0, invalidReasons: [] });
  // Callouts are on the skeleton's clock, like its frames (see appSkeletonRound()).
  _appCallouts = (s.round.callouts || [])
    .filter((c) => Number.isFinite(c.t) && c.show)
    .map((c) => ({ t: c.t - (s.round.videoT0 || 0), show: String(c.show) }))
    .sort((a, b) => a.t - b.t);
  if (typeof renderTimelineOverlay === 'function') renderTimelineOverlay();
  const stance = document.getElementById('stance-select');
  const appStance = { orthodox: 'Orthodox', southpaw: 'Southpaw' }[s.round.stance];
  if (stance && appStance && stance.value !== appStance) {
    stance.value = appStance;
    stance.dispatchEvent(new Event('change'));
  }
  showToast(`Loaded app round ${id}`, 'success');
  return true;
}

// Called by app.js's resetVideoForNewLink(): the callouts belong to the round
// that was open.
function resetAppCallouts() {
  _appCallouts = [];
  // Emptied here too: with no video open the timeline has no length yet and
  // renderTimelineOverlay() stops before it reaches the ribbons.
  const layer = document.getElementById('callout-markers');
  if (layer) { layer.innerHTML = ''; layer.hidden = true; }
}

// The Called ribbon, on top of the timeline's rounds: one mark per callout,
// from when it was called to the next one, so a labeler sees which punches
// to expect where (Mathé, 2026-11-10). Read-only; a click goes to the call.
// Called by app.js's renderTimelineOverlay(), which rebuilds every ribbon.
function renderCalloutStrip(duration, video) {
  const layer = document.getElementById('callout-markers');
  if (!layer) return;
  layer.innerHTML = '';
  layer.hidden = !_appCallouts.length;
  _appCallouts.forEach((c, i) => {
    const next = i + 1 < _appCallouts.length ? _appCallouts[i + 1].t : duration;
    const l = timeToViewportPct(c.t, duration);
    const r = timeToViewportPct(Math.max(next, c.t), duration);
    if (r < 0 || l > 100) return;
    const span = document.createElement('div');
    span.className = 'callout-span';
    span.style.left = Math.max(0, l) + '%';
    span.style.width = Math.max(Math.min(100, r) - Math.max(0, l), 0.4) + '%';
    span.title = `Called ${c.show} at ${formatTime(c.t)}`;
    span.textContent = c.show;
    span.addEventListener('click', (e) => { e.stopPropagation(); video.currentTime = Math.max(0, c.t); });
    layer.appendChild(span);
  });
}

// ── Labeling done ───────────────────────────────────────────────────────
// The app rounds aren't on the tracking sheet, so nothing said a round was
// already labeled (Mathé, 2026-11-10). The button under the link box marks
// the open round as labeled by this labeler (the punch workbook's "App
// Rounds Done" tab, Code.js's doGetAppRoundsDone()); the picker's App rounds
// tab then lists it green with a checkmark. Clicking again takes it back.
let _appDone = null;          // {round link: [labeler, …]}, null = not fetched yet
let _appDonePromise = null;

function appDoneApply(result) {
  // `appDone` is the script's marker: an older deployment answers an action
  // it doesn't know with a success shape.
  if (!result || result.status !== 'ok' || result.appDone !== 1) {
    throw new Error((result && result.message) || 'the sheet script has no app rounds done yet');
  }
  _appDone = {};
  for (const r of result.done || []) (_appDone[r.video_file] = _appDone[r.video_file] || []).push(r.labeler);
}

// `fresh` asks again: another labeler may have marked a round since.
function fetchAppDone(fresh) {
  if (_appDonePromise && !fresh) return _appDonePromise;
  _appDonePromise = fetchJson(sheetUrl({ action: 'listAppRoundsDone' }), 20000)
    .then(appDoneApply)
    .catch((err) => { _appDonePromise = null; throw err; });
  return _appDonePromise;
}

// Who marked this round as labeled.
function appDoneNames(link) {
  return (_appDone && _appDone[normalizeDriveUrl(link)]) || [];
}

// Shown only on an app round, and not to Admin or Analyst, who don't label.
function refreshAppDoneButton() {
  const btn = document.getElementById('btn-app-done');
  if (!btn) return;
  const link = document.getElementById('drive-link').value.trim();
  btn.hidden = !appRoundId(link) || state.isAdmin || state.isAnalyst;
  if (btn.hidden) return;
  const done = appDoneNames(link).includes(labelerId());
  btn.classList.toggle('done', done);
  btn.textContent = done ? '✓ Labeling done' : 'Mark labeling done';
  btn.title = done ? 'You marked this round as labeled. Click to take it back.'
                   : 'Mark this round as labeled, so nobody labels it again.';
  if (!_appDone) fetchAppDone().then(refreshAppDoneButton, () => {});
}

async function toggleAppDone() {
  const btn = document.getElementById('btn-app-done');
  const link = document.getElementById('drive-link').value.trim();
  if (!appRoundId(link)) return;
  if (!labelerId()) { showToast('Enter your name first.', 'error'); return; }
  const done = !appDoneNames(link).includes(labelerId());
  btn.disabled = true;
  try {
    appDoneApply(await fetchJson(sheetUrl({ action: 'setAppRoundDone', video: normalizeDriveUrl(link), done: done ? 1 : 0 }), 30000));
    showToast(done ? 'Marked as labeled.' : 'No longer marked as labeled.', 'success');
  } catch (err) {
    showToast(`Could not save the mark: ${err.name === 'AbortError' ? 'timed out' : err.message}`, 'error');
  } finally {
    btn.disabled = false;
    refreshAppDoneButton();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-app-done');
  const input = document.getElementById('drive-link');
  if (!btn || !input) return;
  btn.addEventListener('click', toggleAppDone);
  input.addEventListener('input', refreshAppDoneButton);
  // After app.js's own DOMContentLoaded, which is what sets Admin / Analyst.
  setTimeout(refreshAppDoneButton, 0);
});

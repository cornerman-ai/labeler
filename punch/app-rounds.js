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
const APP_LINK_RE = /^https:\/\/ambo-qa\.vercel\.app\/#\/s\/([\w-]+)/;

let _appAuth = null;          // firebase-auth module + auth instance, once loaded
let _appUser = null;
let _appRounds = null;        // null = not fetched yet
let _appRoundsPromise = null;

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

// The rounds worth labeling: a TestFlight build's, with footage, that called
// punches — or a final check, which is scored on the punches thrown whatever
// was called (Mathé, 2026-11-10).
function appRoundWanted(s) {
  return APP_TESTFLIGHT_CHANNELS.includes(s.channel) && s.hasVideo && (s.called > 0 || s.kind === 'check');
}

function appRoundName(s) {
  const what = s.kind === 'session' ? 'guided session' : s.kind === 'check' ? 'final check' : (s.drill || s.kind || '').replace(/^.*--/, '').replace(/-/g, ' ');
  return `${s.id} · ${what}${s.endedEarly ? ' (ended early)' : ''} · ${s.owner}`;
}

// {name, link, n, called, detected} rows for the picker (detected: punches the app's classifier found, null on
// a round from before it saved them), newest first (the API's order). Throws when not signed in.
function fetchAppRounds() {
  if (_appRoundsPromise) return _appRoundsPromise;
  _appRoundsPromise = appApi('/api/sessions').then(({ sessions }) => {
    _appRounds = sessions.filter(appRoundWanted).map((s, i) => ({
      name: appRoundName(s), link: `https://ambo-qa.vercel.app/#/s/${s.id}`, n: i + 1, called: s.called, detected: s.detected,
    }));
    return _appRounds;
  }).catch((err) => { _appRoundsPromise = null; throw err; });
  return _appRoundsPromise;
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
  const stance = document.getElementById('stance-select');
  const appStance = { orthodox: 'Orthodox', southpaw: 'Southpaw' }[s.round.stance];
  if (stance && appStance && stance.value !== appStance) {
    stance.value = appStance;
    stance.dispatchEvent(new Event('change'));
  }
  showToast(`Loaded app round ${id}`, 'success');
  return true;
}

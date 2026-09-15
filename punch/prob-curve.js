// ============================================================
// prob-curve.js — the roll detector's per-frame p(roll), drawn as a row under
// the labeler lanes. Read-only; nothing is written anywhere.
//
// Source: the debug viewer's "Rolls GT vs Pred (Mathe)" lens data, written by
// cornerman-backend's evaluate_roll_detector_mathe.py --lens-out. index.json
// maps a video stem to its rounds; each round file carries probs[n] sampled at
// t0 + i·dt in source-video seconds (the same clock as video.currentTime) and
// the fold's decode threshold. Every curve is HELD-OUT: the fold that scored a
// video never trained on it.
// ============================================================

const PROB_DATA_URL = 'https://cornerman-ai.github.io/debug-viewer/lens_data/roll_detector_mathe/';
const PROB_COLLAPSED_H = 14;
const PROB_DEFAULT_H = 64;
const PROB_MIN_H = 36;
const PROB_MAX_H = 240;
const PROB_CAPTION_H = 15;

const prob = {
  index: null,
  indexPromise: null,
  key: null,          // what the loaded curve was resolved for
  token: 0,
  stem: null,
  rounds: [],         // [{t0, dt, n, probs, thr, t1}] sorted by t0
  hoverT: null,
  collapsed: false,
  height: PROB_DEFAULT_H,
};

try {
  prob.collapsed = localStorage.getItem('probCurveCollapsed') === 'true';
  const h = parseInt(localStorage.getItem('probCurveHeight'), 10);
  if (Number.isFinite(h)) prob.height = Math.max(PROB_MIN_H, Math.min(PROB_MAX_H, h));
} catch (_) { /* storage blocked: defaults */ }

function probNormName(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/\.(mp4|mov|mkv|webm|m4v|avi)$/, '').replace(/_h264$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function probLoadIndex() {
  if (!prob.indexPromise) {
    prob.indexPromise = fetch(PROB_DATA_URL + 'index.json?v=' + Date.now(), { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(j => {
        prob.index = j;
        prob.stemByNorm = new Map(Object.keys(j.videos || {}).map(k => [probNormName(k), k]));
        return j;
      })
      .catch(err => { console.warn('Roll probability index unavailable:', err); prob.index = null; return null; });
  }
  return prob.indexPromise;
}

// The open video's names, most trusted first: the tracker's name for the
// pasted Drive link (what the backend's stems are), then the local file.
function probCandidateNames() {
  const names = [];
  const link = normalizeDriveUrl(document.getElementById('drive-link')?.value.trim() || '');
  if (link && Array.isArray(_videoCatalog)) {
    for (const v of _videoCatalog) if (normalizeDriveUrl(v.link) === link) names.push(v.name);
  }
  if (state.videoName) names.push(state.videoName);
  return { link, names };
}

function probCanShow() {
  return (state.isAdmin || state.isAnalyst) && visibleBuckets().includes('defense');
}

function probEnsureLoaded() {
  const { link, names } = probCandidateNames();
  const catalogReady = Array.isArray(_videoCatalog);
  const key = link + '|' + (state.videoName || '') + '|' + catalogReady;
  if (key === prob.key) return;
  prob.key = key;
  const token = ++prob.token;
  prob.stem = null;
  prob.rounds = [];
  if (!link && !state.videoName) return;
  if (link && !catalogReady && typeof fetchVideoCatalog === 'function') {
    fetchVideoCatalog().then(() => { if (token === prob.token) renderProbCurve(); });
  }
  probLoadIndex().then(async (index) => {
    if (!index || token !== prob.token) return;
    const stem = names.map(n => prob.stemByNorm.get(probNormName(n))).find(Boolean);
    if (!stem) { if (token === prob.token) renderProbCurve(); return; }
    const v = encodeURIComponent(index.generated || '');
    const files = Object.values(index.videos[stem]).map(e => e.file);
    try {
      const docs = await Promise.all(files.map(f =>
        fetch(PROB_DATA_URL + f + '?v=' + v).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })));
      if (token !== prob.token) return;
      prob.stem = stem;
      const rounds = docs
        .filter(d => Array.isArray(d.probs) && d.probs.length && d.dt > 0)
        .map(d => ({ ri: d.ri, t0: d.t0, dt: d.dt, n: d.probs.length, probs: d.probs,
                     thr: d.decode?.threshold ?? 0.5, t1: d.t0 + d.probs.length * d.dt }))
        .sort((a, b) => a.t0 - b.t0);
      // Round files share the video's clock but can overlap: a round's
      // pre-buffer runs into the previous round's tail, and a mis-cut cache
      // can nest one round inside another. Each moment is drawn once, from
      // the earliest round covering it — the later file's head there is
      // pre-buffer with a cold context, not round footage.
      let covered = -Infinity;
      prob.rounds = [];
      for (const r of rounds) {
        r.from = Math.max(r.t0, covered);
        if (r.t1 - r.from > r.dt / 2) prob.rounds.push(r);
        covered = Math.max(covered, r.t1);
      }
    } catch (err) {
      console.warn('Roll probability rounds unavailable for', stem, err);
      if (token === prob.token) prob.rounds = [];
    }
    if (token === prob.token) renderProbCurve();
  });
}

function probValueAt(t) {
  for (const r of prob.rounds) {
    if (t < r.from || t >= r.t1) continue;
    const i = Math.min(r.n - 1, Math.max(0, Math.round((t - r.t0) / r.dt)));
    return { v: r.probs[i], thr: r.thr };
  }
  return null;
}

// ── DOM ────────────────────────────────────────────────────────────────────
function probEls() {
  const lane = document.getElementById('prob-lane');
  if (!lane) return null;
  return {
    lane,
    canvas: lane.querySelector('canvas'),
    fold: lane.querySelector('.prob-fold'),
    model: lane.querySelector('.prob-model'),
    readout: lane.querySelector('.prob-readout'),
    dot: lane.querySelector('.prob-dot'),
    grabber: lane.querySelector('.prob-grabber'),
  };
}

function probPlotBox(h) {
  return prob.collapsed ? { top: 2, bottom: h - 1.5 } : { top: PROB_CAPTION_H + 2, bottom: h - 4 };
}

function probApplyLayout(els) {
  els.lane.classList.toggle('collapsed', prob.collapsed);
  els.lane.style.height = (prob.collapsed ? PROB_COLLAPSED_H : prob.height) + 'px';
  els.fold.setAttribute('aria-expanded', String(!prob.collapsed));
}

// Canvas can't resolve var()/color-mix itself; the lane's computed colours can.
function probColors(els) {
  const cs = getComputedStyle(els.lane);
  const rgb = (s) => (s.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  return { accent: rgb(cs.color), dim: rgb(getComputedStyle(els.readout).color) };
}
const probRgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function renderProbCurve() {
  const els = probEls();
  if (!els) return;
  probEnsureLoaded();
  const duration = getTimelineDuration();
  const show = probCanShow() && prob.rounds.length > 0 && duration > 0;
  els.lane.hidden = !show;
  if (!show) return;

  probApplyLayout(els);
  if (prob.index) {
    els.model.textContent = prob.index.run || '';
    els.lane.title = `Roll detector (Mathe) · run ${prob.index.run} · held-out (5-fold by video)` +
      `\n${prob.stem}\nGenerated ${String(prob.index.generated || '').replace('T', ' ')}`;
  }

  const W = els.lane.clientWidth, H = els.lane.clientHeight;
  if (!W || !H) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  if (els.canvas.width !== Math.round(W * dpr)) els.canvas.width = Math.round(W * dpr);
  if (els.canvas.height !== Math.round(H * dpr)) els.canvas.height = Math.round(H * dpr);
  const ctx = els.canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const { accent, dim } = probColors(els);
  const { top, bottom } = probPlotBox(H);
  const yOf = (v) => bottom - Math.max(0, Math.min(1, v)) * (bottom - top);
  const xOf = (t) => timeToViewportPct(t, duration) / 100 * W;
  const tLeft = viewportPctToTime(0, duration), tRight = viewportPctToTime(100, duration);

  for (const r of prob.rounds) {
    if (r.t1 < tLeft || r.from > tRight) continue;
    const iFrom = Math.max(0, Math.ceil((r.from - r.t0) / r.dt - 1e-6));
    const i0 = Math.max(iFrom, Math.floor((tLeft - r.t0) / r.dt) - 1);
    const i1 = Math.min(r.n - 1, Math.ceil((tRight - r.t0) / r.dt) + 1);
    // One point per device column (its max), so a 30-minute zoom-out still
    // shows every spike instead of whichever sample a column happened to hit.
    const pts = [];
    let col = null, best = -1, bestX = 0;
    for (let i = i0; i <= i1; i++) {
      const x = xOf(r.t0 + i * r.dt), v = r.probs[i];
      const c = Math.floor(x * dpr);
      if (c !== col) {
        if (col !== null) pts.push([bestX, best]);
        col = c; best = v; bestX = x;
      } else if (v > best) { best = v; bestX = x; }
    }
    if (col !== null) pts.push([bestX, best]);
    if (pts.length < 2) continue;

    const area = new Path2D();
    area.moveTo(pts[0][0], bottom);
    for (const [x, v] of pts) area.lineTo(x, yOf(v));
    area.lineTo(pts[pts.length - 1][0], bottom);
    area.closePath();

    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, probRgba(accent, 0.30));
    grad.addColorStop(1, probRgba(accent, 0.03));
    ctx.fillStyle = grad;
    ctx.fill(area);

    // Above the fold's threshold is what the decoder would call a roll.
    const yThr = yOf(r.thr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(pts[0][0], 0, pts[pts.length - 1][0] - pts[0][0], yThr);
    ctx.clip();
    ctx.fillStyle = probRgba(accent, prob.collapsed ? 0.55 : 0.38);
    ctx.fill(area);
    ctx.restore();

    ctx.beginPath();
    pts.forEach(([x, v], k) => (k ? ctx.lineTo(x, yOf(v)) : ctx.moveTo(x, yOf(v))));
    ctx.strokeStyle = probRgba(accent, 0.95);
    ctx.lineWidth = prob.collapsed ? 1 : 1.25;
    ctx.lineJoin = 'round';
    ctx.stroke();

    if (!prob.collapsed) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = probRgba(dim, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const ty = Math.round(yThr) + 0.5;
      ctx.moveTo(Math.max(0, xOf(r.from)), ty);
      ctx.lineTo(Math.min(W, xOf(r.t1)), ty);
      ctx.stroke();
      ctx.restore();
    }
  }
  updateProbReadout();
}

function updateProbReadout(tPlay) {
  const els = probEls();
  if (!els || els.lane.hidden) return;
  const video = document.getElementById('video-player');
  const hovering = prob.hoverT != null;
  const t = hovering ? prob.hoverT : (tPlay ?? video?.currentTime ?? 0);
  const hit = probValueAt(t);
  const text = hit ? hit.v.toFixed(2) + (hovering ? '  ·  ' + formatTime(t) : '') : (hovering ? formatTime(t) : '—');
  if (els.readout.textContent !== text) els.readout.textContent = text;
  els.readout.classList.toggle('above', !!hit && hit.v >= hit.thr);

  if (!hovering || !hit) { els.dot.hidden = true; return; }
  const duration = getTimelineDuration();
  const { top, bottom } = probPlotBox(els.lane.clientHeight);
  els.dot.hidden = false;
  els.dot.style.left = (timeToViewportPct(t, duration)) + '%';
  els.dot.style.top = (bottom - hit.v * (bottom - top)) + 'px';
}

function setupProbCurve() {
  const els = probEls();
  if (!els) return;
  probApplyLayout(els);

  els.fold.addEventListener('click', () => {
    prob.collapsed = !prob.collapsed;
    try { localStorage.setItem('probCurveCollapsed', String(prob.collapsed)); } catch (_) {}
    renderProbCurve();
  });

  els.lane.addEventListener('mousemove', (e) => {
    if (e.target.closest('.prob-no-seek')) { prob.hoverT = null; updateProbReadout(); return; }
    const r = els.lane.getBoundingClientRect();
    prob.hoverT = viewportPctToTime(((e.clientX - r.left) / r.width) * 100, getTimelineDuration());
    updateProbReadout();
  });
  els.lane.addEventListener('mouseleave', () => { prob.hoverT = null; updateProbReadout(); });

  let resize = null;
  els.grabber.addEventListener('pointerdown', (e) => {
    if (prob.collapsed || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { els.grabber.setPointerCapture(e.pointerId); } catch (_) {}
    resize = { y: e.clientY, h: prob.height };
    els.lane.classList.add('resizing');
  });
  els.grabber.addEventListener('pointermove', (e) => {
    if (!resize) return;
    prob.height = Math.round(Math.max(PROB_MIN_H, Math.min(PROB_MAX_H, resize.h + e.clientY - resize.y)));
    renderProbCurve();
  });
  const endResize = () => {
    if (!resize) return;
    resize = null;
    els.lane.classList.remove('resizing');
    try { localStorage.setItem('probCurveHeight', String(prob.height)); } catch (_) {}
  };
  els.grabber.addEventListener('pointerup', endResize);
  els.grabber.addEventListener('pointercancel', endResize);
  els.grabber.addEventListener('dblclick', () => {
    prob.height = PROB_DEFAULT_H;
    try { localStorage.setItem('probCurveHeight', String(prob.height)); } catch (_) {}
    renderProbCurve();
  });

  if (window.ResizeObserver) {
    let lastW = 0;
    new ResizeObserver(() => {
      const w = els.lane.clientWidth;
      if (w !== lastW) { lastW = w; renderProbCurve(); }
    }).observe(els.lane);
  }
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', renderProbCurve);
  probLoadIndex();
}

document.addEventListener('DOMContentLoaded', setupProbCurve);

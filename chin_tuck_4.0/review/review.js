// Chin/shoulder review — our estimates against the labelers' clicks, on any
// variant.
//
// Pick the grid: axis (height / depth) x frames (guard / impact) x point
// (chin / shoulder). The marks:
//
//   ◯ red        the labelers' median click — ground truth, optional
//   · faint red  each individual click, so their own spread is visible
//   ● purple     chin = nose + 2.25*(mouth_mid - nose), the shipped proxy
//   ● orange     chin = nose + 1.47*(...), the x-axis refit (depth only)
//   ● cyan       chin from the face pipeline (SCRFD + 2d106)
//   ● yellow     shoulder = the BlazePose lead-shoulder keypoint
//   ● green      shoulder = keypoint + d*0.1006*torso, the deltoid constant
//                (depth only)
//
// WHERE THE DATA COMES FROM, and why it splits the way it does. This page
// follows the same rule as the labeling pages: bake only what a browser
// cannot compute, read the rest live.
//   - `data/<variant>.json` — the MODEL points. They need the Drive pose
//     caches and the boxer_facing_angle MLP, so the backend freezes them
//     (ml/research/chin_tuck/lens/chin_shoulder_lens_data.py).
//   - the CLICKS come live from the Apps Script, same actions the labeling
//     pages use, so new labels appear without regenerating anything.
//
// Marks land within a few pixels of each other on a good frame, which is
// exactly when you most want to tell them apart — hence the magnifier: it
// copies the pixels around the active point before the marks go down and
// redraws them enlarged in the corner.

const FRAME_BUCKET = 'mycorner-bee6a.firebasestorage.app';
const FRAME_TOKEN = '628dbeba-2969-4f45-b65e-5b295ef56fdc';
const PREFIX_ROOT = 'labeler_media/chin_tuck/v4';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec';

const VARIANTS = {
  height_guard:  { label: 'height · guard',  action: 'ChinPoint',            axis: 'height' },
  height_impact: { label: 'height · impact', action: 'ChinPointImpact',      axis: 'height' },
  depth_guard:   { label: 'depth · guard',   action: 'ChinPointDepth',       axis: 'depth'  },
  depth_impact:  { label: 'depth · impact',  action: 'ChinPointDepthImpact', axis: 'depth'  },
};

// One hue per source, none adjacent — at 2px a mark is its colour.
const C = {
  gt: '#ff2f45', gtFaint: 'rgba(255,47,69,0.45)',
  chin_proxy: '#b45cff', chin_proxy_x: '#ffb347', chin_face: '#3ad9e0',
  sh_kp: '#ffd93d', sh_corr: '#7adf7a',
};
const SRC_LABEL = {
  chin_proxy: 'proxy 2.25', chin_proxy_x: 'proxy 1.47 (x refit)',
  chin_face: 'face pipeline', sh_kp: 'keypoint', sh_corr: 'keypoint + deltoid',
};
const CHIN_SRC = ['chin_proxy', 'chin_proxy_x', 'chin_face'];
const SH_SRC = ['sh_kp', 'sh_corr'];

const $ = (id) => document.getElementById(id);
const state = {
  variant: 'depth_guard', point: 'both', showGt: true, showAll: false,
  data: null, clicks: null, stem: null, i: 0, zoom: 6, img: null, loading: false,
};

const frameDir = (stem) => stem.replace(/[. ]+$/, '');
const imgSrc = (stem, r, f) =>
  `https://firebasestorage.googleapis.com/v0/b/${FRAME_BUCKET}/o/` +
  encodeURIComponent(`${PREFIX_ROOT}/${state.variant}_v4_frames/frames/${frameDir(stem)}/r${r}_f${f}.jpg`) +
  `?alt=media&token=${FRAME_TOKEN}`;

const api = (params) => {
  const u = new URL(SCRIPT_URL);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
};

// ---------------------------------------------------------------- loading
async function loadVariant(v) {
  state.loading = true; render();
  state.variant = v; state.data = null; state.clicks = null; state.stem = null; state.i = 0;
  try {
    const r = await fetch(`data/${v}.json?v=1`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    state.data = await r.json();
    const stems = Object.keys(state.data.videos || {});
    state.stem = stems[0] || null;
  } catch (e) {
    state.data = { error: String(e), videos: {} };
  }
  loadClicks(v).catch(() => {});
  state.loading = false; render();
}

// Clicks, live — one list call per labeler, keyed by (video, round, frame).
async function loadClicks(v) {
  const action = VARIANTS[v].action;
  const out = new Map();
  try {
    const st = await (await fetch(api({ action: `stats${action}` }))).json();
    const roster = (st.labelers || []).map(e => e.labeler).filter(n => n && n !== 'Test');
    for (const who of roster) {
      const body = await (await fetch(api({ action: `list${action}`, labeler: who }))).json();
      for (const row of body.rows || []) {
        if (row.skipped || row.camera_bad) continue;
        const k = `${row.video}|${row.round}|${row.frame}`;
        if (!out.has(k)) out.set(k, []);
        out.get(k).push({
          who,
          chin: row.chin_x == null ? null : [+row.chin_x, +row.chin_y],
          sh: row.sh_x == null ? null : [+row.sh_x, +row.sh_y],
          chin_vis: row.chin_vis || 'visible', sh_vis: row.sh_vis || 'visible',
        });
      }
    }
  } catch (e) { /* GT is optional — the model points still draw */ }
  if (state.variant === v) { state.clicks = out; render(); }
}

// ---------------------------------------------------------------- helpers
function entries() {
  const v = state.data?.videos || {};
  return (state.stem && v[state.stem]) || [];
}
function cur() { return entries()[state.i] || null; }

function clicksFor(e) {
  if (!e || !state.clicks) return [];
  return state.clicks.get(`${state.stem}|${e.r}|${e.f}`) || [];
}

function medianPt(pts) {
  if (!pts.length) return null;
  const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return [med(pts.map(p => p[0])), med(pts.map(p => p[1]))];
}

function gtFor(e, kind) {
  const cl = clicksFor(e);
  const vis = cl.filter(c => c[kind] && c[`${kind}_vis`] === 'visible').map(c => c[kind]);
  const any = cl.filter(c => c[kind]).map(c => c[kind]);
  return medianPt(vis.length ? vis : any);
}

function sourcesFor() {
  const axis = state.data?.axis || VARIANTS[state.variant].axis;
  const out = [];
  if (state.point !== 'shoulder') out.push(...CHIN_SRC.filter(s => axis === 'depth' || s !== 'chin_proxy_x'));
  if (state.point !== 'chin') out.push(...SH_SRC.filter(s => axis === 'depth' || s !== 'sh_corr'));
  return out;
}

// error in px and in % of torso, the two units the backend reports
function errOf(e, srcKey) {
  const kind = srcKey.startsWith('sh') ? 'sh' : 'chin';
  const gt = gtFor(e, kind), p = e.model?.[srcKey];
  if (!gt || !p || !e.wh) return null;
  const dx = (p[0] - gt[0]) * e.wh[0], dy = (p[1] - gt[1]) * e.wh[1];
  const d = Math.hypot(dx, dy);
  return { px: d, torso: e.torso_px ? d / e.torso_px : NaN,
           xtorso: e.torso_px ? Math.abs(dx) / e.torso_px : NaN };
}

// ---------------------------------------------------------------- drawing
function drawScene() {
  const cv = $('stage'), ctx = cv.getContext('2d');
  const e = cur();
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!e) return;
  const img = state.img;
  if (!img || !img.complete || !img.naturalWidth) return;

  // fit the frame into the canvas
  const scale = Math.min(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  const ox = (cv.width - w) / 2, oy = (cv.height - h) / 2;
  ctx.drawImage(img, ox, oy, w, h);
  const P = (p) => [ox + p[0] * w, oy + p[1] * h];

  // the magnifier: copy pixels around the active point BEFORE marks go down
  const anchorKind = state.point === 'shoulder' ? 'sh' : 'chin';
  const anchor = gtFor(e, anchorKind)
    || e.model?.[anchorKind === 'sh' ? 'sh_kp' : 'chin_proxy'];
  const INSET = 220, Z = state.zoom;
  if (anchor) {
    const [ax, ay] = P(anchor);
    const src = INSET / Z;
    ctx.save();
    ctx.beginPath(); ctx.rect(cv.width - INSET - 8, 8, INSET, INSET); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, ax - src / 2, ay - src / 2, src, src,
                  cv.width - INSET - 8, 8, INSET, INSET);
    ctx.restore();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
    ctx.strokeRect(cv.width - INSET - 8.5, 7.5, INSET + 1, INSET + 1);
    // marks again, inside the magnifier
    const Q = (p) => {
      const [px, py] = P(p);
      return [cv.width - INSET - 8 + (px - (ax - src / 2)) * Z,
              8 + (py - (ay - src / 2)) * Z];
    };
    ctx.save();
    ctx.beginPath(); ctx.rect(cv.width - INSET - 8, 8, INSET, INSET); ctx.clip();
    paintMarks(ctx, e, Q, 2.2);
    ctx.restore();
  }
  paintMarks(ctx, e, P, 1);
}

function paintMarks(ctx, e, P, k) {
  const dot = (p, color, r) => {
    const [x, y] = P(p);
    ctx.beginPath(); ctx.arc(x, y, r * k, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.6 * k; ctx.stroke();
  };
  for (const s of sourcesFor()) {
    const p = e.model?.[s];
    if (p) dot(p, C[s], 2.0);
  }
  if (!state.showGt) return;
  for (const kind of (state.point === 'both' ? ['chin', 'sh']
                      : state.point === 'chin' ? ['chin'] : ['sh'])) {
    if (state.showAll) {
      for (const c of clicksFor(e)) if (c[kind]) dot(c[kind], C.gtFaint, 1.2);
    }
    const gt = gtFor(e, kind);
    if (!gt) continue;
    const [x, y] = P(gt);
    ctx.beginPath(); ctx.arc(x, y, 4.0 * k, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2.0 * k; ctx.stroke();
    ctx.strokeStyle = C.gt; ctx.lineWidth = 1.3 * k; ctx.stroke();
    dot(gt, C.gt, 0.8);
  }
}

function loadImage() {
  const e = cur();
  if (!e || !state.stem) { state.img = null; drawScene(); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { if (cur() === e) { state.img = img; drawScene(); renderHud(); } };
  img.onerror = () => { state.img = null; drawScene(); };
  img.src = imgSrc(state.stem, e.r, e.f);
}

// ---------------------------------------------------------------- render
function render() {
  const vids = Object.keys(state.data?.videos || {});
  $('variant').innerHTML = Object.entries(VARIANTS)
    .map(([k, v]) => `<option value="${k}" ${k === state.variant ? 'selected' : ''}>${v.label}</option>`).join('');
  $('video').innerHTML = vids.length
    ? vids.map(s => `<option value="${s}" ${s === state.stem ? 'selected' : ''}>${s}</option>`).join('')
    : '<option>— no data —</option>';
  $('point').value = state.point;
  $('gt').checked = state.showGt;
  $('all').checked = state.showAll;
  $('zoom').value = state.zoom;
  $('legend').innerHTML = sourcesFor()
    .map(s => `<span class="chip"><i style="background:${C[s]}"></i>${SRC_LABEL[s]}</span>`).join('')
    + (state.showGt ? `<span class="chip"><i style="background:${C.gt}"></i>labelers</span>` : '');
  loadImage();
  renderHud();
}

function renderHud() {
  const e = cur(), n = entries().length;
  $('pos').textContent = n ? `${state.i + 1} / ${n}` : '—';
  if (!e) { $('hud').innerHTML = state.data?.error
      ? `<span class="err">data/${state.variant}.json failed: ${state.data.error}</span>`
      : '<span class="muted">no labeled frames for this video</span>'; return; }
  const rows = sourcesFor().map(s => {
    const er = errOf(e, s);
    return `<tr><td><i style="background:${C[s]}"></i>${SRC_LABEL[s]}</td>
      <td>${e.model?.[s] ? (er ? er.px.toFixed(1) : '—') : '<span class="muted">absent</span>'}</td>
      <td>${er && isFinite(er.torso) ? er.torso.toFixed(3) : '—'}</td>
      <td>${er && isFinite(er.xtorso) ? er.xtorso.toFixed(3) : '—'}</td></tr>`;
  }).join('');
  const nCl = clicksFor(e).length;
  $('hud').innerHTML = `
    <div class="small muted">r${e.r} f${e.f} · t=${e.t}s · lead ${e.lead || '—'} ·
      facing ${e.d > 0 ? 'image-right' : e.d < 0 ? 'image-left' : '—'} ·
      torso ${e.torso_px?.toFixed(0)}px ·
      ${nCl ? `${nCl} click${nCl > 1 ? 's' : ''}` : (state.clicks ? 'no clicks' : 'loading clicks…')}
      ${e.score != null ? ` · SCRFD ${e.score}` : ''}</div>
    <table class="small">
      <tr><th>source</th><th>err px</th><th>err/torso</th><th>|dx|/torso</th></tr>
      ${rows}
    </table>`;
}

function step(d) {
  const n = entries().length;
  if (!n) return;
  state.i = Math.max(0, Math.min(n - 1, state.i + d));
  loadImage(); renderHud();
}

// ---------------------------------------------------------------- wire up
function init() {
  $('variant').onchange = (ev) => loadVariant(ev.target.value);
  $('video').onchange = (ev) => { state.stem = ev.target.value; state.i = 0; loadImage(); renderHud(); };
  $('point').onchange = (ev) => { state.point = ev.target.value; render(); };
  $('gt').onchange = (ev) => { state.showGt = ev.target.checked; render(); };
  $('all').onchange = (ev) => { state.showAll = ev.target.checked; drawScene(); };
  $('zoom').oninput = (ev) => { state.zoom = +ev.target.value; $('zoomv').textContent = state.zoom + '×'; drawScene(); };
  $('prev').onclick = () => step(-1);
  $('next').onclick = () => step(1);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') step(-1);
    if (ev.key === 'ArrowRight') step(1);
  });
  loadVariant(state.variant);
}
init();

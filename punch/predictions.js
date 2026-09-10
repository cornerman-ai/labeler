// ============================================================
// predictions.js — model-prediction overlay for the punch labeler
//
// Reads an .xlsx file shaped like a "Labeled Data X" sheet tab (see
// CLAUDE.md's Sheet Columns section) — video_file | punch_type | start_sec |
// end_sec, plus training_type/stance/fighter/angle if present — straight
// from disk via SheetJS (../shared/xlsx.full.min.js, vendored so this keeps
// working with no network dependency). No upload, no backend call, never
// written anywhere: this is purely a local, read-only overlay.
//
// Matched rows are folded into state.labels as permanently read-only
// "foreign" rows — see isForeignLabel()/foreignOwnerName() in app.js,
// where `isPrediction` is checked ahead of the admin bypass so a
// prediction can't be edited by ANYONE, unlike a real foreign labeler's
// row. Riding that same flag is what gets a model its own timeline lane,
// its own color, a row in the Labels list, and the existing Others
// show/hide controls for free.
// ============================================================

Object.assign(state, {
  // Every loaded model's FULL parsed file, never filtered by video —
  // re-matched against whatever video is open every time
  // applyPredictionsToLabels() runs. One entry per model, in load order:
  // [{modelName, rows: [{video, punch, start, end, angle, stance,
  // trainingType, fighter}]}, ...]. Picking a file whose name matches an
  // already-loaded model REPLACES that entry (see setupPredictionsLoader());
  // any other name is just added, so several models can be on screen at
  // once, each in their own timeline lane/colour exactly like a real
  // labeler — foreignOwnerName()/labelerColor() (app.js) never knew there
  // was only ever one before.
  predictionModels: [],
});

// Deliberately does NOT fall back to a default the way app.js's own
// mapPunchType() does for sheet rows (jab_head, with a console.warn) — a
// silent default would misrepresent what the model actually predicted.
// An unrecognized punch_type here is a reason to skip the row, not guess.
function mapPredictionPunchType(raw) {
  if (!raw) return null;
  const p = String(raw).toLowerCase().trim();
  const exact = PUNCH_TYPES.find(t => t.id === p && !t.retired);
  if (exact) return exact.id;
  const byLabel = PUNCH_TYPES.find(t => t.label.toLowerCase() === p && !t.retired);
  if (byLabel) return byLabel.id;
  const underscored = p.replace(/\s+/g, '_');
  const bySlug = PUNCH_TYPES.find(t => t.id === underscored && !t.retired);
  return bySlug ? bySlug.id : null;
}

// xlsx numeric cells already come back as JS numbers; a time column
// exported as text ("1:23.456") goes through player.js's own M:SS(.mmm)/
// seconds parser so both forms work.
function parsePredictionTime(v) {
  if (typeof v === 'number') return v;
  if (!v && v !== 0) return NaN;
  return parseTime(String(v));
}

function findPredictionColumn(headerRow, ...candidates) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s_]+/g, '');
  const wanted = candidates.map(norm);
  for (let i = 0; i < headerRow.length; i++) {
    if (wanted.includes(norm(headerRow[i]))) return i;
  }
  return -1;
}

// ============================================================
// Loading
// ============================================================
async function loadPredictionsFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets');
  const rows2d = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
  if (!rows2d.length) return { rows: [], skipped: 0, modelName: '' };

  const header = rows2d[0];
  const videoCol = findPredictionColumn(header, 'video_file', 'video_name', 'video');
  const punchCol = findPredictionColumn(header, 'punch_type', 'punch', 'label');
  const startCol = findPredictionColumn(header, 'start_sec', 'start', 'start_time');
  const endCol = findPredictionColumn(header, 'end_sec', 'end', 'end_time');
  const angleCol = findPredictionColumn(header, 'angle');
  const stanceCol = findPredictionColumn(header, 'stance');
  const trainingCol = findPredictionColumn(header, 'training_type');
  const fighterCol = findPredictionColumn(header, 'fighter');

  if (videoCol < 0 || punchCol < 0 || startCol < 0 || endCol < 0) {
    throw new Error('Missing column(s) — need video_file, punch_type, start_sec, end_sec');
  }

  const modelName = file.name.replace(/\.[^.]+$/, '');
  const rows = [];
  let skipped = 0;
  for (let i = 1; i < rows2d.length; i++) {
    const r = rows2d[i];
    if (!r || r.every(c => c === '' || c == null)) continue;   // blank row
    const punch = mapPredictionPunchType(r[punchCol]);
    const start = parsePredictionTime(r[startCol]);
    const end = parsePredictionTime(r[endCol]);
    const video = String(r[videoCol] || '').trim();
    if (!punch || !video || !Number.isFinite(start) || !Number.isFinite(end)) { skipped++; continue; }
    rows.push({
      video, punch, start, end,
      angle: angleCol >= 0 ? String(r[angleCol] || '') : '',
      stance: stanceCol >= 0 ? String(r[stanceCol] || '') : '',
      trainingType: trainingCol >= 0 ? String(r[trainingCol] || '') : '',
      fighter: fighterCol >= 0 ? String(r[fighterCol] || '') : '',
    });
  }
  return { rows, skipped, modelName };
}

// ============================================================
// Matching to the currently open video — tries the Drive link first
// (same identity every real label is keyed on), then falls back to a
// filename match, since a model's export more plausibly names the video
// by its file than by a Drive URL it may never have seen.
// ============================================================
function predictionMatchesOpenVideo(rowVideo) {
  if (!rowVideo) return false;
  const driveLink = normalizeDriveUrl(document.getElementById('drive-link')?.value.trim() || '');
  if (driveLink && normalizeDriveUrl(rowVideo) === driveLink) return true;
  const baseName = (s) => String(s).replace(/\.[^./\\]+$/, '').split(/[\\/]/).pop().toLowerCase().trim();
  const openName = state.videoName ? baseName(state.videoName) : '';
  return !!openName && baseName(rowVideo) === openName;
}

// Re-derives which of EVERY loaded model's rows apply to whatever video is
// open right now, and folds them into state.labels. Safe to call anytime
// (a file just loaded or removed, video switched, a fresh sheet fetch just
// replaced the foreign rows out from under these) — it always starts by
// dropping any prediction rows already in state.labels, so it never
// double-injects.
function applyPredictionsToLabels() {
  state.labels = state.labels.filter(l => !l.isPrediction);
  let matched = 0;
  for (const { modelName, rows } of state.predictionModels) {
    for (const r of rows) {
      if (!predictionMatchesOpenVideo(r.video)) continue;
      state.labels.push({
        id: null, punch_uuid: '', punch: r.punch, angle: r.angle,
        start: r.start, end: r.end, videoName: r.video,
        foreign: true, isPrediction: true, predictionModel: modelName,
        sheetName: null, fromSheet: false, isRoundMarker: false,
      });
      matched++;
    }
  }
  renderLabels();
  return matched;
}

// How many of one model's rows matched the currently open video — derived
// from state.labels rather than kept as a separate tally, so it's always
// exactly what applyPredictionsToLabels() last computed and can never go
// stale relative to what the chip is describing.
function countMatchedPredictionRows(modelName) {
  return state.labels.filter(l => l.isPrediction && l.predictionModel === modelName).length;
}

// ============================================================
// UI wiring
// ============================================================
function setPredictionsStatus(kind, text) {
  const el = document.getElementById('predictions-status');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  el.className = 'field-status' + (kind ? ' ' + kind : '');
  document.getElementById('predictions-loader')?.classList.toggle('ok', kind === 'ok');
  document.getElementById('predictions-loader')?.classList.toggle('err', kind === 'err');
}

// Drops every loaded model — called from app.js's setupDriveLink() the
// moment a NEW drive link is pasted. applyPredictionsToLabels() already
// only folds in rows that match whatever video is actually open, so a
// carried-over model was never going to mislabel the new one — this is
// about the row itself no longer claiming to have predictions loaded for a
// video that isn't open any more, same as the video file and skeleton rows
// beside it reset on a new link.
function resetPredictionsState() {
  state.predictionModels = [];
  applyPredictionsToLabels();
  renderPredictionsList();
  setPredictionsStatus(null, '');
}

// In-app modal instead of window.prompt() — this page never uses the
// browser's own dialog chrome for anything else, and the native prompt()
// read as a jarring one-off next to every other popup here. Resolves to
// the name to use; Cancel/Escape/closing resolves to `fallback` rather
// than aborting the load, matching prompt()'s old Cancel behaviour.
function askPredictionName(fallback) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('pred-name-dialog');
    const input = document.getElementById('pred-name-input');
    const okBtn = document.getElementById('pred-name-ok');
    const cancelBtn = document.getElementById('pred-name-cancel');
    const closeBtn = document.getElementById('pred-name-close-x');
    if (!dlg || !input || !okBtn || !cancelBtn) { resolve(fallback); return; }

    input.value = fallback;
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn?.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
      dlg.removeEventListener('cancel', onDialogCancel);
      if (dlg.open) dlg.close();
      resolve(value);
    }
    const onOk = () => finish(input.value.trim() || fallback);
    const onCancel = () => finish(fallback);
    // The dialog's native 'cancel' event — fired by Escape — so that path
    // resolves the promise too instead of leaving it hanging forever.
    const onDialogCancel = (e) => { e.preventDefault(); onCancel(); };
    const onKeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); onOk(); } };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn?.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
    dlg.addEventListener('cancel', onDialogCancel);

    if (!dlg.open) dlg.showModal();
    input.focus();
    input.select();
  });
}

// Bare-minimum escaping for the one piece of free text here that's
// entirely the labeler's own typing (askPredictionName) rather than
// something already trusted elsewhere in the app — the chips below build
// their markup with innerHTML, so this keeps a name like `<b>x` inert.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// The compact "No predictions loaded" / "N models loaded" line above the
// chip list — the chips themselves already carry each model's own name and
// count, so this only has to say how many there are.
function updatePredictionsSummary() {
  const el = document.getElementById('predictions-name');
  const addBtn = document.getElementById('btn-add-more-predictions');
  if (!el) return;
  const models = state.predictionModels;
  if (!models.length) {
    el.textContent = 'No predictions loaded';
  } else if (models.length === 1) {
    const n = countMatchedPredictionRows(models[0].modelName);
    el.textContent = `${models[0].modelName} — ${n} row${n === 1 ? '' : 's'}`;
  } else {
    el.textContent = `${models.length} models loaded`;
  }
  // Only worth showing once there's something to add TO — see the button's
  // own comment in index.html.
  if (addBtn) addBtn.hidden = models.length === 0;
}

// One chip per loaded model — name, its row count ON THIS VIDEO, a
// Hide/Show (rides the SAME per-owner mute the Others menu already has:
// toggleLabelerHidden()/isLabelerHidden() in app.js don't know or care
// whether "who" is a real labeler or a model, so hiding "Rolly" here and
// from the Others menu is literally the same toggle either way) and a
// remove ×. Rebuilt from scratch on every call — same trade as every other
// list in this app (renderLabels(), the Others/Types menus): simpler than
// diffing, and this list is never more than a handful of rows.
function renderPredictionsList() {
  const container = document.getElementById('predictions-list');
  if (!container) return;
  container.innerHTML = '';
  container.hidden = state.predictionModels.length === 0;
  for (const { modelName } of state.predictionModels) {
    const count = countMatchedPredictionRows(modelName);
    const hidden = !!(state.hiddenLabelers && state.hiddenLabelers.has(modelName));
    const chip = document.createElement('span');
    chip.className = 'pred-chip' + (hidden ? ' pred-hidden' : '');
    chip.style.setProperty('--who', typeof labelerColor === 'function' ? labelerColor(modelName) : '');
    chip.innerHTML = `
      <span class="pred-chip-name">${escapeHtml(modelName)}</span>
      <span class="pred-chip-count">${count}</span>
      <button type="button" class="pred-chip-toggle" title="${hidden ? 'Show' : 'Hide'} ${escapeHtml(modelName)}">${hidden ? 'Show' : 'Hide'}</button>
      <button type="button" class="pred-chip-remove" title="Remove ${escapeHtml(modelName)}">&times;</button>
    `;
    chip.querySelector('.pred-chip-toggle').onclick = () => {
      if (typeof toggleLabelerHidden === 'function') toggleLabelerHidden(modelName);
      renderPredictionsList();
    };
    chip.querySelector('.pred-chip-remove').onclick = () => {
      state.predictionModels = state.predictionModels.filter(m => m.modelName !== modelName);
      applyPredictionsToLabels();
      renderPredictionsList();
      updatePredictionsSummary();
      // setPredictionsStatus() otherwise only ever runs from a fresh file
      // pick — removing the last model via a chip's × left the row green
      // with a stale "N on this video" from whatever was last loaded.
      // Empty goes back to plain/grey; still having models re-totals the
      // count across what's left, same reasoning.
      if (!state.predictionModels.length) {
        setPredictionsStatus(null, '');
      } else {
        const total = state.predictionModels.reduce((n, m) => n + countMatchedPredictionRows(m.modelName), 0);
        setPredictionsStatus('ok', `${total} on this video`);
      }
    };
    container.appendChild(chip);
  }
  updatePredictionsSummary();
}

// Reads and names ONE file, folding it into state.predictionModels — does
// NOT re-derive state.labels or repaint, so the caller can run this over a
// whole multi-file pick and pay applyPredictionsToLabels()/
// renderPredictionsList() only once at the end.
async function loadOnePredictionsFile(file) {
  try {
    const { rows, skipped, modelName: fileModelName } = await loadPredictionsFile(file);
    // The file name is only a STARTING guess — export naming conventions
    // vary ("Rolly_predicted_rolls_v3.xlsx"), and whatever's confirmed here
    // is what shows EVERYWHERE (lane, badge, tooltip, the Others menu), so
    // it has to be something the labeler actually wants to see, not
    // whatever the file happened to be called.
    const modelName = await askPredictionName(fileModelName);
    if (!modelName) return null;
    // A name that matches an already-loaded model REPLACES its rows in
    // place — "reload this model's predictions", not "load a second copy
    // of the same model". Anything else is just added.
    const existing = state.predictionModels.find(m => m.modelName === modelName);
    if (existing) existing.rows = rows;
    else state.predictionModels.push({ modelName, rows });
    // A freshly (re)loaded model starts unhidden — otherwise re-picking one
    // whose old name you'd hidden would silently stay invisible with no
    // visible reason why.
    if (state.hiddenLabelers) state.hiddenLabelers.delete(modelName);
    return { modelName, skipped };
  } catch (err) {
    console.error('Predictions load failed:', file.name, err);
    setPredictionsStatus('err', `${file.name}: ${err.message || 'could not be read'}`);
    return null;
  }
}

function setupPredictionsLoader() {
  const input = document.getElementById('predictions-file');
  if (!input) return;

  // multiple: picking several .xlsx at once loads them as separate,
  // independently named models in one go — see loadOnePredictionsFile()
  // above, run once per file in sequence (so each gets its own naming
  // prompt, one at a time, the same prompt a single pick has always used).
  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    input.value = '';   // lets the same file(s) be re-picked later without a no-op change event
    if (!files.length) return;
    setPredictionsStatus('syncing', files.length > 1 ? `Reading ${files.length} files…` : 'Reading…');
    const loaded = [];
    for (const file of files) {
      const result = await loadOnePredictionsFile(file);
      if (result) loaded.push(result);
    }
    applyPredictionsToLabels();
    renderPredictionsList();
    if (!loaded.length) {
      if (!state.predictionModels.length) setPredictionsStatus('err', 'Could not read that file');
      return;
    }
    const skipped = loaded.reduce((sum, r) => sum + r.skipped, 0);
    setPredictionsStatus('ok', loaded.length > 1
      ? `${loaded.length} models loaded${skipped ? `, ${skipped} rows skipped` : ''}`
      : `${countMatchedPredictionRows(loaded[0].modelName)} on this video${loaded[0].skipped ? `, ${loaded[0].skipped} skipped` : ''}`);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupPredictionsLoader();
  // Re-match whenever a new local video is opened (filename match). Hooked
  // on 'loadedmetadata' rather than #video-file's own 'change' on purpose:
  // player.js's video loader sets state.videoName synchronously inside ITS
  // 'change' handler, but which of two 'change' listeners on the same
  // element fires first depends on attachment order across files/scripts —
  // fragile to depend on. 'loadedmetadata' only ever fires once state.
  // videoName is already set, no matter the script load order.
  document.getElementById('video-player')?.addEventListener('loadedmetadata', () => {
    applyPredictionsToLabels();
    renderPredictionsList();   // per-model counts are per-video — repaint the chips too
  });
});

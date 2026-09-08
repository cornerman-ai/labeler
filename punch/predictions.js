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
  // The FULL parsed file, never filtered by video — re-matched against
  // whatever video is open every time applyPredictionsToLabels() runs.
  // {modelName, rows: [{video, punch, start, end, angle, stance,
  // trainingType, fighter}]}
  predictions: { modelName: null, rows: [] },
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

// Re-derives which of the loaded model's rows apply to whatever video is
// open right now, and folds them into state.labels. Safe to call anytime
// (new file loaded, video switched, a fresh sheet fetch just replaced the
// foreign rows out from under these) — it always starts by dropping any
// prediction rows already in state.labels, so it never double-injects.
function applyPredictionsToLabels() {
  state.labels = state.labels.filter(l => !l.isPrediction);
  const { modelName, rows } = state.predictions;
  if (!modelName || !rows.length) { renderLabels(); return 0; }
  let matched = 0;
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
  renderLabels();
  return matched;
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

function setupPredictionsLoader() {
  const input = document.getElementById('predictions-file');
  const nameEl = document.getElementById('predictions-name');
  if (!input) return;

  input.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setPredictionsStatus('syncing', 'Reading…');
    try {
      const { rows, skipped, modelName: fileModelName } = await loadPredictionsFile(file);
      // The file name is only a STARTING guess — export naming conventions
      // vary ("Rolly_predicted_rolls_v3.xlsx"), and whatever shows here is
      // what shows EVERYWHERE (lane, badge, tooltip, the Others menu), so
      // it has to be something the labeler actually wants to see, not
      // whatever the file happened to be called.
      const modelName = await askPredictionName(fileModelName);
      state.predictions = { modelName, rows };
      if (nameEl) nameEl.textContent = modelName ? `${modelName} — ${rows.length} row${rows.length === 1 ? '' : 's'}` : 'No predictions loaded';
      const matched = applyPredictionsToLabels();
      setPredictionsStatus('ok', skipped
        ? `${matched} on this video, ${skipped} skipped`
        : `${matched} on this video`);
    } catch (err) {
      console.error('Predictions load failed:', err);
      state.predictions = { modelName: null, rows: [] };
      applyPredictionsToLabels();
      if (nameEl) nameEl.textContent = 'No predictions loaded';
      setPredictionsStatus('err', err.message || 'Could not read that file');
    }
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
  document.getElementById('video-player')?.addEventListener('loadedmetadata', () => applyPredictionsToLabels());
});

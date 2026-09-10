// Auto-load videos from a local raw-footage folder, so picking a video from
// the tracking-sheet dropdown (app.js's setupVideoPicker()) opens it
// immediately instead of the labeler having to also manually "Open Video"
// the matching file.
//
// Same idea as cornerman-debug-viewer's js/drive-folder.js: this only works
// because the team's raw-video folder is synced locally (Drive for Desktop
// or similar), so the browser's File System Access API can read it as an
// ordinary local directory — no Drive OAuth, no Google Cloud project, no
// consent screen, nothing ever leaves the machine. One-time directory pick,
// the handle is stashed in IndexedDB, and later visits restore it (browsers
// typically re-grant read permission to a handle already used on this
// origin without re-prompting).
//
// Chrome/Edge only — isSupported() gates everything below; on Safari/
// Firefox the connect row hides itself and "Open Video" remains the only
// path, same as before this file existed.

const VF_DB_NAME = 'punch-video-folder';
const VF_DB_VERSION = 1;
const VF_STORE_NAME = 'handles';
const VF_HANDLE_KEY = 'video-folder';
const VF_VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm)$/i;

function vfOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VF_DB_NAME, VF_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VF_STORE_NAME)) db.createObjectStore(VF_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function vfPutHandle(handle) {
  const db = await vfOpenDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(VF_STORE_NAME, 'readwrite');
    tx.objectStore(VF_STORE_NAME).put(handle, VF_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function vfGetHandle() {
  const db = await vfOpenDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(VF_STORE_NAME, 'readonly');
      const req = tx.objectStore(VF_STORE_NAME).get(VF_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function vfDeleteHandle() {
  const db = await vfOpenDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(VF_STORE_NAME, 'readwrite');
    tx.objectStore(VF_STORE_NAME).delete(VF_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function vfIsSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// Strip a video's extension (if any) for name comparison — tracking-sheet
// names and on-disk filenames don't always agree on whether one is present.
function vfStem(name) {
  return String(name || '').replace(VF_VIDEO_EXT_RE, '').trim().toLowerCase();
}

// Recursively walk the folder looking for a video whose (extension-stripped)
// name matches `target`. Exact stem match wins; otherwise the first file
// whose stem contains the target (or vice versa) — handles the tracking
// sheet's name being a truncated/annotated version of the real filename.
// Bails out early once an exact match is found.
async function vfFindVideoHandle(rootHandle, target) {
  const targetStem = vfStem(target);
  if (!targetStem) return null;
  let partial = null;

  async function visit(dirHandle) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory') {
        const found = await visit(entry);
        if (found) return found;
        continue;
      }
      if (!VF_VIDEO_EXT_RE.test(entry.name)) continue;
      const stem = vfStem(entry.name);
      if (stem === targetStem) return entry;
      if (!partial && (stem.includes(targetStem) || targetStem.includes(stem))) partial = entry;
    }
    return null;
  }

  const exact = await visit(rootHandle);
  return exact || partial;
}

// ── Connect-row UI + state ───────────────────────────────────────────────
let _vfRootHandle = null;

function vfPaint(state_) {
  const row = document.getElementById('video-folder-loader');
  const nameEl = document.getElementById('video-folder-name');
  const statusEl = document.getElementById('video-folder-status');
  const connectBtn = document.getElementById('btn-connect-folder');
  const forgetBtn = document.getElementById('btn-forget-folder');
  if (!row) return;

  if (state_ === 'unsupported') {
    row.hidden = true;
    return;
  }
  row.hidden = false;

  if (state_ === 'connected') {
    row.classList.add('ok');
    connectBtn.textContent = '';
    connectBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M1.5 3.5a1 1 0 0 1 1-1h2.6l1.1 1.3h5.3a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg> Change';
    if (nameEl) nameEl.textContent = _vfRootHandle ? _vfRootHandle.name : 'Video folder connected';
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.innerHTML = '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.4 6.3 4.7 8.6 9.6 3.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Connected</span>';
    }
    if (forgetBtn) forgetBtn.hidden = false;
  } else if (state_ === 'needs-permission') {
    row.classList.remove('ok');
    connectBtn.textContent = 'Reconnect video folder';
    if (nameEl) nameEl.textContent = (_vfRootHandle && _vfRootHandle.name) || 'Video folder needs permission again';
    if (statusEl) { statusEl.hidden = true; statusEl.innerHTML = ''; }
    if (forgetBtn) forgetBtn.hidden = false;
  } else {
    row.classList.remove('ok');
    connectBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M1.5 3.5a1 1 0 0 1 1-1h2.6l1.1 1.3h5.3a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg> Connect Video Folder';
    if (nameEl) nameEl.textContent = 'Pick a folder once (raw videos, BlazePose exports, or both) and picking a video from the list will load its video and skeletons automatically.';
    if (statusEl) { statusEl.hidden = true; statusEl.innerHTML = ''; }
    if (forgetBtn) forgetBtn.hidden = true;
  }
}

async function vfConnect() {
  try {
    const handle = await window.showDirectoryPicker({ id: 'punch-video-folder', mode: 'read' });
    await vfPutHandle(handle);
    _vfRootHandle = handle;
    vfPaint('connected');
    showToast('Video folder connected.', 'success');
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user cancelled the picker
    console.warn('Video folder connect failed:', err);
    showToast('Could not connect that folder.', 'error');
  }
}

async function vfForget() {
  await vfDeleteHandle();
  _vfRootHandle = null;
  vfPaint('disconnected');
}

function setupVideoFolder() {
  if (!vfIsSupported()) { vfPaint('unsupported'); return; }

  const connectBtn = document.getElementById('btn-connect-folder');
  const forgetBtn = document.getElementById('btn-forget-folder');
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      if (_vfRootHandle) {
        const perm = await _vfRootHandle.queryPermission({ mode: 'read' }).catch(() => 'prompt');
        if (perm !== 'granted') {
          const granted = await _vfRootHandle.requestPermission({ mode: 'read' }).catch(() => 'denied');
          if (granted === 'granted') { vfPaint('connected'); showToast('Video folder reconnected.', 'success'); return; }
        }
      }
      vfConnect();
    });
  }
  if (forgetBtn) forgetBtn.addEventListener('click', vfForget);

  (async () => {
    let handle;
    try { handle = await vfGetHandle(); } catch { handle = null; }
    if (!handle) { vfPaint('disconnected'); return; }
    _vfRootHandle = handle;
    let perm;
    try { perm = await handle.queryPermission({ mode: 'read' }); } catch { perm = 'denied'; }
    vfPaint(perm === 'granted' ? 'connected' : 'needs-permission');
  })();
}

// Matches skeleton.js's own filename convention (see CLAUDE.md and
// loadSkeletonFiles() in skeleton.js): one <stem>_blazepose_r<N>.npy +
// _pts.npy + _meta.json triple per round, all living flat alongside every
// other video's triples — so unlike the video search above, there's no
// directory structure grouping them and a whole video's rounds have to be
// found by stem match across however many _blazepose_r<N> files exist.
const VF_SKELETON_MAIN_RE = /^(.*)_blazepose_r\d+(?:_pts)?\.npy$/i;
const VF_SKELETON_META_RE = /^(.*)_blazepose_r\d+_meta\.json$/i;

async function vfFindSkeletonHandles(rootHandle, target) {
  const targetStem = vfStem(target);
  if (!targetStem) return [];
  const exact = [];
  const partial = [];

  async function visit(dirHandle) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory') { await visit(entry); continue; }
      const m = entry.name.match(VF_SKELETON_MAIN_RE) || entry.name.match(VF_SKELETON_META_RE);
      if (!m) continue;
      const stem = vfStem(m[1]);
      if (stem === targetStem) exact.push(entry);
      else if (stem.includes(targetStem) || targetStem.includes(stem)) partial.push(entry);
    }
  }

  await visit(rootHandle);
  return exact.length ? exact : partial;
}

// Called alongside autoLoadVideoFromFolder() below — same folder, same
// video, but a completely different naming convention (flat triples, not a
// video-extension file), so it gets its own search rather than reusing
// vfFindVideoHandle(). Silent no-op when nothing's connected/found; the
// manual "Open Skeletons" picker is always still there as a fallback.
async function autoLoadSkeletonsFromFolder(name) {
  if (!_vfRootHandle) return false;
  let perm;
  try { perm = await _vfRootHandle.queryPermission({ mode: 'read' }); } catch { perm = 'denied'; }
  if (perm !== 'granted') return false;
  if (typeof loadSkeletonFiles !== 'function' || typeof applySkeletonLoadResult !== 'function') return false;

  let entries;
  try { entries = await vfFindSkeletonHandles(_vfRootHandle, name); } catch (err) {
    console.warn('Skeleton folder search failed:', err);
    return false;
  }
  if (!entries.length) return false;

  const files = await Promise.all(entries.map((e) => e.getFile()));
  const result = await loadSkeletonFiles(files);
  const ok = applySkeletonLoadResult(result);
  if (ok) showToast('Skeletons loaded from video folder.', 'success');
  return ok;
}

// Called by app.js's video picker once a video is chosen from the tracking
// sheet. Silent no-op when no folder is connected (or permission has
// lapsed) — the manual "Open Video" button is always still there.
async function autoLoadVideoFromFolder(name) {
  if (!_vfRootHandle) return false;
  let perm;
  try { perm = await _vfRootHandle.queryPermission({ mode: 'read' }); } catch { perm = 'denied'; }
  if (perm !== 'granted') { vfPaint('needs-permission'); return false; }

  let entry;
  try { entry = await vfFindVideoHandle(_vfRootHandle, name); } catch (err) {
    console.warn('Video folder search failed:', err);
    return false;
  }
  if (!entry) {
    showToast('Video not found in the connected folder — open it manually.', 'info');
    return false;
  }
  const file = await entry.getFile();
  loadVideoFileIntoPlayer(file);
  showToast('Loaded from video folder.', 'success');
  return true;
}

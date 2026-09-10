// Auto-load a video's file AND its BlazePose skeletons from two separately-
// connected local folders, so picking a video from the tracking-sheet
// dropdown (app.js's setupVideoPicker()) opens everything immediately
// instead of the labeler having to also manually "Open Video" / "Open
// Skeletons" the matching files. Two connections, not one, because the raw
// videos and the skeleton exports don't have to live in (or even be synced
// to) the same place.
//
// Same idea as cornerman-debug-viewer's js/drive-folder.js: this only works
// because each folder is synced locally (Drive for Desktop or similar), so
// the browser's File System Access API can read it as an ordinary local
// directory — no Drive OAuth, no Google Cloud project, no consent screen,
// nothing ever leaves the machine. One-time directory pick per slot, the
// handle is stashed in IndexedDB, and later visits restore it (browsers
// typically re-grant read permission to a handle already used on this
// origin without re-prompting).
//
// Chrome/Edge only — isSupported() gates everything below; on Safari/
// Firefox both connect rows hide themselves and "Open Video"/"Open
// Skeletons" remain the only path, same as before this file existed.

const VF_DB_NAME = 'punch-video-folder';
const VF_DB_VERSION = 1;
const VF_STORE_NAME = 'handles';
const VF_VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm)$/i;

// One entry per connect row — everything that differs between the video
// slot and the skeleton slot lives here, so the logic below (IndexedDB key,
// DOM ids, copy) is written once and parameterized by `slot`.
const VF_SLOTS = {
  video: {
    dbKey: 'video-folder',
    rowId: 'video-folder-loader',
    nameId: 'video-folder-name',
    statusId: 'video-folder-status',
    connectBtnId: 'btn-connect-video-folder',
    forgetBtnId: 'btn-forget-video-folder',
    connectLabel: 'Connect Video Folder',
    emptyHint: 'Pick the folder with the raw videos once, and picking a video from the list will open it automatically.',
    connectedToast: 'Video folder connected.',
    reconnectedToast: 'Video folder reconnected.',
  },
  skeleton: {
    dbKey: 'skeleton-folder',
    rowId: 'skeleton-folder-loader',
    nameId: 'skeleton-folder-name',
    statusId: 'skeleton-folder-status',
    connectBtnId: 'btn-connect-skeleton-folder',
    forgetBtnId: 'btn-forget-skeleton-folder',
    connectLabel: 'Connect Skeleton Folder',
    emptyHint: 'Pick the folder with the BlazePose exports once, and picking a video from the list will load its skeletons automatically.',
    connectedToast: 'Skeleton folder connected.',
    reconnectedToast: 'Skeleton folder reconnected.',
  },
};

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

async function vfPutHandle(dbKey, handle) {
  const db = await vfOpenDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(VF_STORE_NAME, 'readwrite');
    tx.objectStore(VF_STORE_NAME).put(handle, dbKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function vfGetHandle(dbKey) {
  const db = await vfOpenDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(VF_STORE_NAME, 'readonly');
      const req = tx.objectStore(VF_STORE_NAME).get(dbKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function vfDeleteHandle(dbKey) {
  const db = await vfOpenDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(VF_STORE_NAME, 'readwrite');
    tx.objectStore(VF_STORE_NAME).delete(dbKey);
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

// ── Connect-row UI + state — one handle per slot ('video' / 'skeleton') ────
const _vfHandles = { video: null, skeleton: null };

function vfPaint(slot, state_) {
  const cfg = VF_SLOTS[slot];
  const row = document.getElementById(cfg.rowId);
  const nameEl = document.getElementById(cfg.nameId);
  const statusEl = document.getElementById(cfg.statusId);
  const connectBtn = document.getElementById(cfg.connectBtnId);
  const forgetBtn = document.getElementById(cfg.forgetBtnId);
  if (!row) return;

  if (state_ === 'unsupported') {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  const handle = _vfHandles[slot];

  if (state_ === 'connected') {
    row.classList.add('ok');
    connectBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M1.5 3.5a1 1 0 0 1 1-1h2.6l1.1 1.3h5.3a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg> Change';
    if (nameEl) nameEl.textContent = handle ? handle.name : 'Folder connected';
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.innerHTML = '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.4 6.3 4.7 8.6 9.6 3.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Connected</span>';
    }
    if (forgetBtn) forgetBtn.hidden = false;
  } else if (state_ === 'needs-permission') {
    row.classList.remove('ok');
    connectBtn.textContent = 'Reconnect';
    if (nameEl) nameEl.textContent = (handle && handle.name) || 'Needs permission again';
    if (statusEl) { statusEl.hidden = true; statusEl.innerHTML = ''; }
    if (forgetBtn) forgetBtn.hidden = false;
  } else {
    row.classList.remove('ok');
    connectBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M1.5 3.5a1 1 0 0 1 1-1h2.6l1.1 1.3h5.3a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg> ' + cfg.connectLabel;
    if (nameEl) nameEl.textContent = cfg.emptyHint;
    if (statusEl) { statusEl.hidden = true; statusEl.innerHTML = ''; }
    if (forgetBtn) forgetBtn.hidden = true;
  }
}

async function vfConnect(slot) {
  const cfg = VF_SLOTS[slot];
  try {
    const handle = await window.showDirectoryPicker({ id: 'punch-' + cfg.dbKey, mode: 'read' });
    await vfPutHandle(cfg.dbKey, handle);
    _vfHandles[slot] = handle;
    vfPaint(slot, 'connected');
    showToast(cfg.connectedToast, 'success');
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user cancelled the picker
    console.warn('Folder connect failed:', err);
    showToast('Could not connect that folder.', 'error');
  }
}

async function vfForget(slot) {
  await vfDeleteHandle(VF_SLOTS[slot].dbKey);
  _vfHandles[slot] = null;
  vfPaint(slot, 'disconnected');
}

function setupFolderSlot(slot) {
  const cfg = VF_SLOTS[slot];
  const connectBtn = document.getElementById(cfg.connectBtnId);
  const forgetBtn = document.getElementById(cfg.forgetBtnId);
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      const handle = _vfHandles[slot];
      if (handle) {
        const perm = await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt');
        if (perm !== 'granted') {
          const granted = await handle.requestPermission({ mode: 'read' }).catch(() => 'denied');
          if (granted === 'granted') { vfPaint(slot, 'connected'); showToast(cfg.reconnectedToast, 'success'); return; }
        }
      }
      vfConnect(slot);
    });
  }
  if (forgetBtn) forgetBtn.addEventListener('click', () => vfForget(slot));

  (async () => {
    let handle;
    try { handle = await vfGetHandle(cfg.dbKey); } catch { handle = null; }
    if (!handle) { vfPaint(slot, 'disconnected'); return; }
    _vfHandles[slot] = handle;
    let perm;
    try { perm = await handle.queryPermission({ mode: 'read' }); } catch { perm = 'denied'; }
    vfPaint(slot, perm === 'granted' ? 'connected' : 'needs-permission');
  })();
}

function setupVideoFolder() {
  if (!vfIsSupported()) { vfPaint('video', 'unsupported'); vfPaint('skeleton', 'unsupported'); return; }
  setupFolderSlot('video');
  setupFolderSlot('skeleton');
}

// Called alongside autoLoadVideoFromFolder() below, once a video is chosen
// from the tracking sheet — a completely separate connection (and naming
// convention: flat triples, not a video-extension file), so it gets its own
// search rather than reusing vfFindVideoHandle(). Silent no-op when
// nothing's connected/found; the manual "Open Skeletons" picker is always
// still there as a fallback.
async function autoLoadSkeletonsFromFolder(name) {
  const handle = _vfHandles.skeleton;
  if (!handle) return false;
  let perm;
  try { perm = await handle.queryPermission({ mode: 'read' }); } catch { perm = 'denied'; }
  if (perm !== 'granted') { vfPaint('skeleton', 'needs-permission'); return false; }
  if (typeof loadSkeletonFiles !== 'function' || typeof applySkeletonLoadResult !== 'function') return false;

  let entries;
  try { entries = await vfFindSkeletonHandles(handle, name); } catch (err) {
    console.warn('Skeleton folder search failed:', err);
    return false;
  }
  if (!entries.length) return false;

  const files = await Promise.all(entries.map((e) => e.getFile()));
  const result = await loadSkeletonFiles(files);
  const ok = applySkeletonLoadResult(result);
  if (ok) showToast('Skeletons loaded from skeleton folder.', 'success');
  return ok;
}

// Called by app.js's video picker once a video is chosen from the tracking
// sheet. Silent no-op when no folder is connected (or permission has
// lapsed) — the manual "Open Video" button is always still there.
async function autoLoadVideoFromFolder(name) {
  const handle = _vfHandles.video;
  if (!handle) return false;
  let perm;
  try { perm = await handle.queryPermission({ mode: 'read' }); } catch { perm = 'denied'; }
  if (perm !== 'granted') { vfPaint('video', 'needs-permission'); return false; }

  let entry;
  try { entry = await vfFindVideoHandle(handle, name); } catch (err) {
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

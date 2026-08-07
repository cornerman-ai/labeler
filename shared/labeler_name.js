// labeler_name.js — one identity mechanism for every labeler.
//
// The labeling team fills in their name ONCE per browser; it's stored in
// localStorage and sent as the `labeler` field with every save (the Apps
// Script already routes rows / sheet tabs by it). Replaces the old
// per-person `?labeler=` URLs — a URL param still works as a one-time seed
// so old links migrate themselves.
//
// Include BEFORE the page's main script:  <script src="../shared/labeler_name.js"></script>
// Read the name via  window.CMLabeler.get()  (player.js does this for you).
(function () {
  const KEY = 'labelerName';

  const normalize = (s) =>
    (s || '').trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 40);

  function seed() {
    let n = null;
    try { n = localStorage.getItem(KEY); } catch {}
    if (n) return n;
    // migrate: old per-person URL param, then the orientation labeler's key
    const fromUrl = normalize(new URLSearchParams(location.search).get('labeler'));
    let legacy = null;
    try {
      legacy = normalize(localStorage.getItem('orient_labeler_name')) ||
               normalize(localStorage.getItem('ol_labeler_name'));
    } catch {}
    const m = fromUrl || legacy;
    if (m) writeAll(m);
    return m || null;
  }

  // Write our key AND the legacy keys some pages still read (chin pages use
  // orient_labeler_name, the orientation labeler uses ol_labeler_name) so
  // every name input on every page stays in sync with one identity.
  function writeAll(n) {
    try {
      localStorage.setItem(KEY, n);
      localStorage.setItem('orient_labeler_name', n);
      localStorage.setItem('ol_labeler_name', n);
    } catch {}
  }

  // Push the name into any on-page name input (chin pages: #labeler-input,
  // bladedness pairs: #bp-labeler) and fire events so their handlers run.
  function syncInputs(n) {
    for (const el of document.querySelectorAll('#labeler-input, #bp-labeler')) {
      if (el.value === n) continue;
      el.value = n;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function set(name) {
    const n = normalize(name);
    if (!n) return null;
    writeAll(n);
    syncInputs(n);
    renderChip();
    return n;
  }

  function get() { return seed(); }

  // ── UI ────────────────────────────────────────────────────────────────
  let chipEl = null;

  function renderChip() {
    const name = get();
    if (!name) return;
    if (!chipEl) {
      chipEl = document.createElement('div');
      chipEl.id = 'cm-labeler-chip';
      chipEl.style.cssText =
        'position:fixed;right:10px;bottom:10px;z-index:9998;font:12px -apple-system,sans-serif;' +
        'background:rgba(20,24,34,.92);color:#dfe6f2;border:1px solid rgba(255,255,255,.18);' +
        'border-radius:14px;padding:5px 10px;display:flex;gap:8px;align-items:center;';
      document.body.appendChild(chipEl);
    }
    chipEl.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = '\u{1F464} ' + name;
    const change = document.createElement('a');
    change.textContent = 'change';
    change.href = '#';
    change.style.cssText = 'color:#8ab4ff;text-decoration:none;';
    change.onclick = (e) => { e.preventDefault(); askOverlay(true); };
    chipEl.append(label, change);
  }

  function askOverlay(isChange) {
    if (document.getElementById('cm-labeler-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'cm-labeler-overlay';
    ov.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:rgba(8,10,16,.78);' +
      'display:flex;align-items:center;justify-content:center;font:14px -apple-system,sans-serif;';
    const card = document.createElement('div');
    card.style.cssText =
      'background:#161b26;color:#dfe6f2;border:1px solid rgba(255,255,255,.15);' +
      'border-radius:12px;padding:22px 24px;min-width:280px;box-shadow:0 12px 40px rgba(0,0,0,.5);';
    card.innerHTML =
      '<div style="font-size:16px;font-weight:650;margin-bottom:4px;">Who’s labeling?</div>' +
      '<div style="opacity:.65;margin-bottom:12px;">Your name is saved with every label.</div>';
    const input = document.createElement('input');
    input.placeholder = 'e.g. John';
    input.value = isChange ? (get() || '') : '';
    input.style.cssText =
      'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;' +
      'border:1px solid rgba(255,255,255,.25);background:#0d111a;color:#fff;margin-bottom:12px;';
    const btn = document.createElement('button');
    btn.textContent = 'Start labeling';
    btn.style.cssText =
      'width:100%;padding:8px 10px;border-radius:8px;border:0;cursor:pointer;' +
      'background:#3b82f6;color:#fff;font-weight:600;';
    const submit = () => {
      if (!normalize(input.value)) { input.focus(); return; }
      set(input.value);
      ov.remove();
    };
    btn.onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    card.append(input, btn);
    ov.appendChild(card);
    document.body.appendChild(ov);
    input.focus();
  }

  window.CMLabeler = { get, set, normalize };

  document.addEventListener('DOMContentLoaded', () => {
    const n = get();
    if (n) { renderChip(); syncInputs(n); }
    else askOverlay(false);
  });
})();

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
    if (!hasNativeInput()) renderChip();
    return n;
  }

  function get() { return seed(); }

  // ── UI ────────────────────────────────────────────────────────────────
  // Pages that already have their own name input (#labeler-input on the chin
  // pages, #bp-labeler on the bladedness pairs) keep it as the only UI — we
  // just sync it. Every other page gets a small corner widget: an inline
  // input while unset, a name chip once set. Non-blocking by design.
  let box = null;

  function hasNativeInput() {
    return !!document.querySelector('#labeler-input, #bp-labeler');
  }

  function widget() {
    if (!box) {
      box = document.createElement('div');
      box.id = 'cm-labeler-chip';
      box.style.cssText =
        'position:fixed;left:10px;bottom:10px;z-index:9998;font:12px -apple-system,sans-serif;' +
        'background:rgba(20,24,34,.92);color:#dfe6f2;border:1px solid rgba(255,255,255,.18);' +
        'border-radius:14px;padding:5px 10px;display:flex;gap:7px;align-items:center;';
      document.body.appendChild(box);
    }
    box.innerHTML = '';
    return box;
  }

  function renderInput() {
    const b = widget();
    b.style.borderColor = '#e8b45a';
    const label = document.createElement('span');
    label.textContent = '\u{1F464} Your name:';
    const input = document.createElement('input');
    input.placeholder = 'e.g. John';
    input.style.cssText =
      'width:90px;padding:2px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.25);' +
      'background:#0d111a;color:#fff;font:12px -apple-system,sans-serif;';
    const commit = () => { if (normalize(input.value)) set(input.value); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    input.addEventListener('blur', commit);
    b.append(label, input);
  }

  function renderChip() {
    const name = get();
    if (!name) return renderInput();
    const b = widget();
    b.style.borderColor = 'rgba(255,255,255,.18)';
    const label = document.createElement('span');
    label.textContent = '\u{1F464} ' + name;
    const change = document.createElement('a');
    change.textContent = 'change';
    change.href = '#';
    change.style.cssText = 'color:#8ab4ff;text-decoration:none;';
    change.onclick = (e) => { e.preventDefault(); renderInput(); };
    b.append(label, change);
  }

  window.CMLabeler = { get, set, normalize };

  document.addEventListener('DOMContentLoaded', () => {
    const n = get();
    if (n) syncInputs(n);
    if (hasNativeInput()) return;      // page's own input is the UI
    if (n) renderChip();
    else renderInput();
  });
})();

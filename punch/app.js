// ============================================================
// app.js — Boxing Punch Labeler (page-specific)
//
// Handles punch-type catalogue, label workflow (start → pick type →
// end), round markers, Google Sheets sync, label list rendering,
// and the timeline overlay for punch segments + round shading.
//
// Shared video + seek-bar + minimap + zoom + playback + helpers
// live in player.js (loaded first). The shared `state` is defined
// there; this file extends it with page-specific keys.
// ============================================================

// ============================================================
// Punch catalogue
// ============================================================
const PUNCH_TYPES = [
  { id: 'jab_head',              label: 'Jab (Head)',          key: '1', group: 'offense',
    desc: 'Fast straight punch with the lead hand, to the head' },
  { id: 'cross_head',            label: 'Cross (Head)',        key: '2', group: 'offense',
    desc: 'Straight power punch with the rear hand, to the head' },
  { id: 'lead_hook_head',        label: 'Lead Hook',           key: '3', group: 'offense',
    desc: 'Circular punch with the lead hand, to the head' },
  { id: 'rear_hook_head',        label: 'Rear Hook',           key: '4', group: 'offense',
    desc: 'Circular punch with the rear hand, to the head' },
  { id: 'lead_uppercut_head',    label: 'Lead Uppercut',       key: '5', group: 'offense',
    desc: 'Rising punch with the lead hand, to the head' },
  { id: 'rear_uppercut_head',    label: 'Rear Uppercut',       key: '6', group: 'offense',
    desc: 'Rising punch with the rear hand, to the head' },
  { id: 'jab_body',              label: 'Jab (Body)',          key: '⇧1', group: 'offense',
    desc: 'Fast straight punch with the lead hand, to the body' },
  { id: 'cross_body',            label: 'Cross (Body)',        key: '⇧2', group: 'offense',
    desc: 'Straight power punch with the rear hand, to the body' },
  { id: 'lead_hook_body',        label: 'Lead Hook (Body)',    key: '⇧3', group: 'offense',
    desc: 'Circular punch with the lead hand, to the body' },
  { id: 'rear_hook_body',        label: 'Rear Hook (Body)',    key: '⇧4', group: 'offense',
    desc: 'Circular punch with the rear hand, to the body' },
  { id: 'lead_uppercut_body',    label: 'Lead Uppercut (Body)', key: '⇧5', group: 'offense',
    desc: 'Rising punch with the lead hand, to the body' },
  { id: 'rear_uppercut_body',    label: 'Rear Uppercut (Body)', key: '⇧6', group: 'offense',
    desc: 'Rising punch with the rear hand, to the body' },
  { id: 'lead_slip',             label: 'Lead Slip',           key: 'q', group: 'defense',
    desc: 'Head movement off the lead side to dodge a punch' },
  { id: 'rear_slip',             label: 'Rear Slip',           key: 'w', group: 'defense',
    desc: 'Head movement off the rear side to dodge a punch' },
  { id: 'lead_roll',             label: 'Lead Roll',           key: 'a', group: 'defense',
    desc: 'Duck under a hook and come up on the lead side' },
  { id: 'rear_roll',             label: 'Rear Roll',           key: 'd', group: 'defense',
    desc: 'Duck under a hook and come up on the rear side' },
  { id: 'pull_back',             label: 'Pull Back',           key: 'r', group: 'defense',
    desc: 'Lean back at the waist to pull the head out of range' },
  // step_back retired 2026-07-28: backward steps are mostly unintentional
  // footwork (detected kinematically by the step detector, not labeled).
  // Kept in the catalogue so the 800+ existing sheet rows still render
  // instead of falling back to jab_head.
  { id: 'step_back',             label: 'Step Back',           key: 'f', group: 'defense', retired: true,
    desc: 'Retreating step to create distance (retired — mostly unintentional footwork)' },
  { id: 'duck',                  label: 'Duck',                key: 'c', group: 'defense',
    desc: 'Bend the knees to drop the head under a punch' },
  { id: 'unsure',                label: 'Unsure',              key: 'u', group: 'other',
    desc: "Labeler couldn't confidently identify the move" },
];

// ============================================================
// Punch catalogue — translations
// ============================================================
// English lives on PUNCH_TYPES itself (label/desc above) and doubles as the
// fallback for anything missing here. Everything else — sheet columns,
// punch ids, PUNCH_COLORS keys — stays English regardless of state.lang;
// only what a labeler actually reads (button names, tooltips, the label
// list, the video overlay tags) changes. See punchLabel()/punchDesc().
const LANGUAGES = { en: 'English', ru: 'Русский', nl: 'Nederlands', tl: 'Filipino' };
const PUNCH_I18N = {
  ru: {
    jab_head:           { label: 'Джеб (голова)', desc: 'Быстрый прямой удар передней рукой в голову' },
    cross_head:         { label: 'Кросс (голова)', desc: 'Мощный прямой удар задней рукой в голову' },
    lead_hook_head:     { label: 'Передний хук', desc: 'Круговой удар передней рукой в голову' },
    rear_hook_head:      { label: 'Задний хук', desc: 'Круговой удар задней рукой в голову' },
    lead_uppercut_head: { label: 'Передний апперкот', desc: 'Восходящий удар передней рукой в голову' },
    rear_uppercut_head: { label: 'Задний апперкот', desc: 'Восходящий удар задней рукой в голову' },
    jab_body:           { label: 'Джеб (корпус)', desc: 'Быстрый прямой удар передней рукой в корпус' },
    cross_body:         { label: 'Кросс (корпус)', desc: 'Мощный прямой удар задней рукой в корпус' },
    lead_hook_body:     { label: 'Передний хук (корпус)', desc: 'Круговой удар передней рукой в корпус' },
    rear_hook_body:     { label: 'Задний хук (корпус)', desc: 'Круговой удар задней рукой в корпус' },
    lead_uppercut_body: { label: 'Передний апперкот (корпус)', desc: 'Восходящий удар передней рукой в корпус' },
    rear_uppercut_body: { label: 'Задний апперкот (корпус)', desc: 'Восходящий удар задней рукой в корпус' },
    lead_slip:          { label: 'Передний слип', desc: 'Уклон головой в сторону передней руки от удара' },
    rear_slip:          { label: 'Задний слип', desc: 'Уклон головой в сторону задней руки от удара' },
    lead_roll:          { label: 'Передний ролл', desc: 'Нырок под хук с выходом в сторону передней руки' },
    rear_roll:          { label: 'Задний ролл', desc: 'Нырок под хук с выходом в сторону задней руки' },
    pull_back:          { label: 'Отклон назад', desc: 'Наклон корпуса назад, чтобы вывести голову из зоны удара' },
    step_back:          { label: 'Шаг назад', desc: 'Отступающий шаг для увеличения дистанции (устарело — обычно непреднамеренная работа ног)' },
    duck:               { label: 'Нырок', desc: 'Сгибание ног, чтобы увести голову вниз от удара' },
    unsure:             { label: 'Не уверен', desc: 'Разметчик не смог точно определить движение' },
  },
  nl: {
    jab_head:           { label: 'Jab (Hoofd)', desc: 'Snelle rechte stoot met de voorste hand, naar het hoofd' },
    cross_head:         { label: 'Cross (Hoofd)', desc: 'Krachtige rechte stoot met de achterste hand, naar het hoofd' },
    lead_hook_head:     { label: 'Voorste Hoek', desc: 'Cirkelvormige stoot met de voorste hand, naar het hoofd' },
    rear_hook_head:     { label: 'Achterste Hoek', desc: 'Cirkelvormige stoot met de achterste hand, naar het hoofd' },
    lead_uppercut_head: { label: 'Voorste Uppercut', desc: 'Opwaartse stoot met de voorste hand, naar het hoofd' },
    rear_uppercut_head: { label: 'Achterste Uppercut', desc: 'Opwaartse stoot met de achterste hand, naar het hoofd' },
    jab_body:           { label: 'Jab (Lichaam)', desc: 'Snelle rechte stoot met de voorste hand, naar het lichaam' },
    cross_body:         { label: 'Cross (Lichaam)', desc: 'Krachtige rechte stoot met de achterste hand, naar het lichaam' },
    lead_hook_body:     { label: 'Voorste Hoek (Lichaam)', desc: 'Cirkelvormige stoot met de voorste hand, naar het lichaam' },
    rear_hook_body:     { label: 'Achterste Hoek (Lichaam)', desc: 'Cirkelvormige stoot met de achterste hand, naar het lichaam' },
    lead_uppercut_body: { label: 'Voorste Uppercut (Lichaam)', desc: 'Opwaartse stoot met de voorste hand, naar het lichaam' },
    rear_uppercut_body: { label: 'Achterste Uppercut (Lichaam)', desc: 'Opwaartse stoot met de achterste hand, naar het lichaam' },
    lead_slip:          { label: 'Voorste Slip', desc: 'Hoofdbeweging naar de voorste kant om een stoot te ontwijken' },
    rear_slip:          { label: 'Achterste Slip', desc: 'Hoofdbeweging naar de achterste kant om een stoot te ontwijken' },
    lead_roll:          { label: 'Voorste Rol', desc: 'Duiken onder een hoekstoot en opkomen aan de voorste kant' },
    rear_roll:          { label: 'Achterste Rol', desc: 'Duiken onder een hoekstoot en opkomen aan de achterste kant' },
    pull_back:          { label: 'Achteruitleunen', desc: 'Leun met de romp naar achteren om het hoofd buiten bereik te houden' },
    step_back:          { label: 'Stap Achteruit', desc: 'Achteruit stappen om afstand te creëren (verouderd — meestal onbedoeld voetenwerk)' },
    duck:               { label: 'Duiken', desc: 'Buig de knieën om het hoofd onder een stoot te laten zakken' },
    unsure:             { label: 'Niet zeker', desc: 'De labelaar kon de beweging niet met zekerheid herkennen' },
  },
  tl: {
    // Filipino boxing commentary keeps jab/cross/hook/uppercut/slip/roll as
    // English loanwords — only the descriptions (and the two that already
    // have no accepted loanword) are actually translated.
    jab_head:           { label: 'Jab (Ulo)', desc: 'Mabilis na deretsong suntok gamit ang unang kamay, sa ulo' },
    cross_head:         { label: 'Cross (Ulo)', desc: 'Malakas na deretsong suntok gamit ang likod na kamay, sa ulo' },
    lead_hook_head:     { desc: 'Pabilog na suntok gamit ang unang kamay, sa ulo' },
    rear_hook_head:     { desc: 'Pabilog na suntok gamit ang likod na kamay, sa ulo' },
    lead_uppercut_head: { desc: 'Pataas na suntok gamit ang unang kamay, sa ulo' },
    rear_uppercut_head: { desc: 'Pataas na suntok gamit ang likod na kamay, sa ulo' },
    jab_body:           { label: 'Jab (Katawan)', desc: 'Mabilis na deretsong suntok gamit ang unang kamay, sa katawan' },
    cross_body:         { label: 'Cross (Katawan)', desc: 'Malakas na deretsong suntok gamit ang likod na kamay, sa katawan' },
    lead_hook_body:     { label: 'Lead Hook (Katawan)', desc: 'Pabilog na suntok gamit ang unang kamay, sa katawan' },
    rear_hook_body:     { label: 'Rear Hook (Katawan)', desc: 'Pabilog na suntok gamit ang likod na kamay, sa katawan' },
    lead_uppercut_body: { label: 'Lead Uppercut (Katawan)', desc: 'Pataas na suntok gamit ang unang kamay, sa katawan' },
    rear_uppercut_body: { label: 'Rear Uppercut (Katawan)', desc: 'Pataas na suntok gamit ang likod na kamay, sa katawan' },
    lead_slip:          { desc: 'Pag-iwas ng ulo papunta sa unang kamay para makaiwas sa suntok' },
    rear_slip:          { desc: 'Pag-iwas ng ulo papunta sa likod na kamay para makaiwas sa suntok' },
    lead_roll:          { desc: 'Yuyukod sa ilalim ng hook at babangon sa gilid ng unang kamay' },
    rear_roll:          { desc: 'Yuyukod sa ilalim ng hook at babangon sa gilid ng likod na kamay' },
    pull_back:          { desc: 'Paghilig ng katawan pauwi para ilayo ang ulo sa saklaw ng suntok' },
    step_back:          { desc: 'Pag-atras para lumikha ng distansya (retired — kadalasang di-sinasadyang paggalaw ng paa)' },
    duck:               { desc: 'Pagbaluktot ng tuhod para ibaba ang ulo mula sa suntok' },
    unsure:             { label: 'Hindi sigurado', desc: 'Hindi sigurado ang lumagda kung anong galaw ito' },
  },
};

// Both fall back to the English PUNCH_TYPES entry — a missing translation
// (tl mostly relies on this for labels, since boxing loanwords stay
// English) reads in English rather than as a blank or an id.
function punchLabel(id) {
  const punch = PUNCH_TYPES.find(p => p.id === id);
  const t = PUNCH_I18N[state.lang]?.[id];
  return (t && t.label) || punch?.label || id;
}
function punchDesc(id) {
  const punch = PUNCH_TYPES.find(p => p.id === id);
  const t = PUNCH_I18N[state.lang]?.[id];
  return (t && t.desc) || punch?.desc || '';
}

// Only jab/cross carry a literal "(Head)" suffix on their label (hooks and
// uppercuts don't need one — "Lead Hook" is unambiguous on its own); the
// offense matrix's row-name column strips it per punchFamilyLabel() below,
// language-aware since the suffix text itself is translated.
const HEAD_SUFFIX_STRIP = {
  en: /\s*\(Head\)$/,
  ru: /\s*\(голова\)$/,
  nl: /\s*\(Hoofd\)$/,
  tl: /\s*\(Ulo\)$/,
};
function punchFamilyLabel(headId) {
  return punchLabel(headId).replace(HEAD_SUFFIX_STRIP[state.lang] || HEAD_SUFFIX_STRIP.en, '');
}

const PUNCH_COLORS = {
  // Offense — one hue per punch, shared between its head and body variant;
  // only the shade changes (dark = head, light = body), so a jab reads as
  // "the red one" on the timeline regardless of target.
  jab_head:           '#cc1133',
  jab_body:           '#ff8fa3',
  cross_head:         '#cc6600',
  cross_body:         '#ffc285',
  lead_hook_head:     '#b8960b',
  lead_hook_body:     '#ffe066',
  rear_hook_head:     '#aa0077',
  rear_hook_body:     '#ff8fd4',
  lead_uppercut_head: '#7722aa',
  lead_uppercut_body: '#d9a3ff',
  rear_uppercut_head: '#117777',
  rear_uppercut_body: '#7fe0e0',
  // Defense — same pairing rule as offense above: slip and roll each get
  // one hue, dark for lead and light for rear. Pull-back, step-back and
  // duck have no lead/rear split, so each keeps its own distinct color.
  lead_slip: '#118844',
  rear_slip: '#8fe6ae',
  lead_roll: '#1155cc',
  rear_roll: '#99c2ff',
  pull_back: '#aa66ff',
  step_back: '#ffff00',
  duck:      '#88ff00',
  // Other
  unsure:      '#999999',
  round_start: '#28a745',
  round_end:   '#666666',
};

function getPunchColor(punchId) {
  return PUNCH_COLORS[punchId] || '#533483';
}

// ============================================================
// Page-specific state (player.js owns the shared `state`; we extend it)
// ============================================================
Object.assign(state, {
  selectedPunch: null,
  mode: 'start',
  pendingStart: null,
  labels: [],
  roundActive: false,
  unsureFilter: false,
  // Other labelers' punch/defense rows are fetched every load (see
  // mergeForeignPunchLabels) but stay folded away by default — this is just
  // the visibility toggle, not what's in state.labels. Round markers are
  // unaffected; those have always shown regardless.
  showForeign: false,
  // Set when the labeler name field holds "Admin" (case-insensitive, same
  // convention as the "review" special-case below). Lets isForeignLabel()
  // wave through mutations of another labeler's row — see the comment on
  // that function.
  isAdmin: false,
  // Which bucket the Labels panel is showing.
  labelTab: 'offense',
  // Display language for punch/defense names + descriptions — see
  // PUNCH_I18N, punchLabel(), punchDesc(). Purely a display-layer choice:
  // the sheet always gets the English punch id regardless of this.
  lang: 'en',
  // True from the moment a video's initial fetchLabelsFromSheet(true) goes
  // out until it settles — see setLoadingLocked().
  labelsLoading: false,
  // Foreign owners individually folded away — see isLabelerHidden(). A
  // fresh Set per page load; not persisted, since who's labeling a given
  // video changes video to video and a stale hide would just be confusing.
  hiddenLabelers: new Set(),
});

// ============================================================
// Init
// ============================================================
// document, not window: 'DOMContentLoaded' targets document and bubbles to
// window, so a window-registered listener fires in the BUBBLE phase — after
// every document-registered one, regardless of script order. ui.js listens
// on document; with this on window, ui.js's setup ran BEFORE this one no
// matter what order the two <script> tags loaded in, which silently broke
// anything in ui.js that has to attach an override AFTER player.js's own
// setupSeekBar() (called from this handler) — its listener would always be
// registered second and win. document keeps this in the natural
// script-execution order both files were written assuming.
document.addEventListener('DOMContentLoaded', () => {
  // Restored before buildPunchButtons() (and anything else that reads
  // punchLabel()/punchDesc()) so the first paint is already in the right
  // language, not English-then-flip.
  const savedLang = localStorage.getItem('punchLang');
  if (savedLang && PUNCH_I18N[savedLang]) state.lang = savedLang;
  setupLangSelect();
  buildPunchButtons();
  setupPlayer();                 // video loader, seek bar, minimap — from player.js
  setupKeyboardShortcuts();
  updateTimestampButton();
  updateRoundIndicator();
  setupDriveLink();
  if (labelerId()) {
    const badge = document.getElementById('labeler-badge');
    const isName = !/^\d+$/.test(labelerId());
    const displayName = isName
      ? labelerId().charAt(0).toUpperCase() + labelerId().slice(1).toLowerCase()
      : labelerId();
    badge.textContent = isName ? displayName : 'Labeler ' + displayName;
    badge.style.display = 'inline';
    document.title = isName
      ? 'Boxing Punch Labeler — ' + displayName
      : 'Boxing Punch Labeler ' + displayName;
  }
  if (labelerId().toLowerCase() === 'review') {   // labeler_name.js capitalizes the stored name
    const btn = document.getElementById('btn-unsure-filter');
    if (btn) btn.style.display = 'inline-block';
    if (localStorage.getItem('unsureFilter') === 'true') {
      state.unsureFilter = true;
    }
    updateUnsureFilterButton();
  }
  if (labelerId().toLowerCase() === 'admin') {
    state.isAdmin = true;
    state.showForeign = true;   // no point being admin over a folded-away queue
    const badge = document.getElementById('labeler-badge');
    if (badge) badge.textContent += ' (admin)';
  }
  const savedTab = localStorage.getItem('labelTab');
  if (savedTab === 'defense' || savedTab === 'combined') {
    state.labelTab = savedTab;
  }
  updateLabelTabButtons();
  if (localStorage.getItem('showForeignLabels') === 'true') {
    state.showForeign = true;
  }
  updateForeignFilterButton();
  setupForeignFilterMenu();
  setupForeignVideoDialog();
});

// Wiring for the "already labeled by someone else" popup (maybeShowForeignVideoPopup
// fills #fvd-body and opens it) — same open/close pattern as #sc-dialog in ui.js.
function setupForeignVideoDialog() {
  const dlg = document.getElementById('fvd-dialog');
  if (!dlg) return;
  const close = () => dlg.close();
  document.getElementById('fvd-close')?.addEventListener('click', close);
  document.getElementById('fvd-close-x')?.addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.getElementById('fvd-show')?.addEventListener('click', () => {
    if (!state.showForeign) toggleForeignFilter();
    close();
  });
}

// Populates #lang-select from LANGUAGES, applies state.lang (already
// restored from localStorage by the time this runs — see DOMContentLoaded),
// and re-renders every surface that shows a punch/defense name on change.
// Group headers, buttons, dialogs etc. outside the punch catalogue stay
// English — this only ever touches punchLabel()/punchDesc() output.
function setupLangSelect() {
  const sel = document.getElementById('lang-select');
  if (!sel) return;
  sel.innerHTML = Object.entries(LANGUAGES)
    .map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
  sel.value = state.lang;
  sel.addEventListener('change', () => {
    state.lang = sel.value;
    localStorage.setItem('punchLang', state.lang);
    buildPunchButtons();
    renderLabels();
    updateVideoOverlay();
  });
}

function toggleForeignFilter() {
  state.showForeign = !state.showForeign;
  localStorage.setItem('showForeignLabels', String(state.showForeign));
  updateForeignFilterButton();
  renderLabels();
  updateVideoOverlay();
}

// Per-owner mute on top of the master switch above — see isLabelerHidden().
// Not persisted: who's labeling a given video changes video to video, and a
// stale hide carried over from a different video would just be confusing.
function toggleLabelerHidden(who) {
  if (state.hiddenLabelers.has(who)) state.hiddenLabelers.delete(who);
  else state.hiddenLabelers.add(who);
  updateForeignFilterButton();
  renderLabels();
  updateVideoOverlay();
}

function updateForeignFilterButton() {
  const label = document.getElementById('foreign-filter-label');
  const btn = document.getElementById('btn-foreign-filter');
  if (!label || !btn) return;
  const hiddenCount = state.hiddenLabelers.size;
  label.textContent = !state.showForeign ? 'Others: hidden'
    : hiddenCount > 0 ? `Others: ${hiddenCount} hidden`
    : 'Others: shown';
  btn.classList.toggle('on', state.showForeign && hiddenCount === 0);
}

// Master "Show others" row + one row per foreign owner currently on this
// video, each independently toggleable — same open/close pattern as
// ui.js's #speed-menu. Rebuilt fresh on every open (renderForeignFilterMenu)
// rather than kept live, so it's never stale as labelers come and go
// video to video.
function setupForeignFilterMenu() {
  const btn = document.getElementById('btn-foreign-filter');
  const menu = document.getElementById('foreign-filter-menu');
  if (!btn || !menu) return;

  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open = () => {
    renderForeignFilterMenu(menu);
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? open() : close();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) close();
  });
}

function renderForeignFilterMenu(menu) {
  const counts = {};
  for (const l of state.labels) {
    if (!l.foreign) continue;
    const who = foreignOwnerName(l);
    counts[who] = (counts[who] || 0) + 1;
  }
  const owners = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

  menu.innerHTML = '';

  const masterRow = document.createElement('button');
  masterRow.type = 'button';
  masterRow.className = 'ffm-row';
  masterRow.setAttribute('role', 'menuitemcheckbox');
  masterRow.setAttribute('aria-checked', String(state.showForeign));
  masterRow.innerHTML = '<span class="ffm-name">Show others</span>';
  masterRow.onclick = () => { toggleForeignFilter(); renderForeignFilterMenu(menu); };
  menu.appendChild(masterRow);

  if (!owners.length) {
    const empty = document.createElement('div');
    empty.className = 'ffm-empty';
    empty.textContent = 'No other labelers on this video yet';
    menu.appendChild(empty);
    return;
  }

  const sep = document.createElement('div');
  sep.className = 'ffm-sep';
  menu.appendChild(sep);

  for (const who of owners) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ffm-row';
    row.setAttribute('role', 'menuitemcheckbox');
    // Greyed out and inert while the master switch is off — an individual
    // hide has nothing to do until "Show others" is on (shouldHideByTab()
    // hides every foreign row on that switch alone, regardless of this).
    row.disabled = !state.showForeign;
    row.setAttribute('aria-checked', String(!state.hiddenLabelers.has(who)));
    row.innerHTML = `<span class="ffm-name">${who}</span><span class="ffm-count">${counts[who]}</span>`;
    row.onclick = () => { toggleLabelerHidden(who); renderForeignFilterMenu(menu); };
    menu.appendChild(row);
  }
}

function toggleUnsureFilter() {
  state.unsureFilter = !state.unsureFilter;
  localStorage.setItem('unsureFilter', String(state.unsureFilter));
  updateUnsureFilterButton();
  renderLabels();
  updateVideoOverlay();
}

function updateUnsureFilterButton() {
  const btn = document.getElementById('btn-unsure-filter');
  if (!btn) return;
  // Class, not an inline colour: the on/off look belongs to the stylesheet,
  // which is the only thing that knows the current appearance.
  btn.textContent = state.unsureFilter ? 'Unsure only: on' : 'Unsure only: off';
  btn.classList.toggle('on', state.unsureFilter);
}

// The one gate every mutation of a label passes through. `foreign` is set
// in mergeForeignRoundMarkers() / mergeForeignPunchLabels() — a row pulled
// read-only from ANOTHER labeler's sheet so this page can show what else is
// on a shared video without letting a second labeler edit, retime, or
// delete someone else's row. It is enforced HERE, at each function that
// actually mutates or saves a label, so that guarantee does not depend on
// every future call site remembering to check first — a console call, a
// keyboard shortcut, a drag handler, all hit the same wall.
//
// The one escape hatch is state.isAdmin (labeler name field = "Admin"):
// isForeignLabel() reports false for it, so every gate below waves the
// mutation through. `label.foreign` itself stays true either way — that's
// the flag rendering uses to show whose row it originally was — only the
// permission check changes. The save path (updateLabelInSheet /
// deleteLabelFromSheet) then re-points the request at the ROW'S OWNER via
// foreignOwnerLabelerParam(), so an admin edit lands directly in that
// person's own sheet, exactly as if they'd made it themselves — no separate
// "edited by admin" bookkeeping, no audit column.
function isForeignLabel(label) {
  return !!(label && label.foreign) && !state.isAdmin;
}
function refuseForeign(label) {
  if (!isForeignLabel(label)) return false;
  showToast('Read-only — added by another labeler', 'error');
  return true;
}

// "Labeled Data Software 3" -> "3", "Labeled Data John" -> "John". Null for
// anything that doesn't parse (e.g. the frozen Combined Data Archive, whose
// source sheet is long gone) — there's no live sheet to write back to, so
// admin edits on those rows have nowhere to land and must be refused same
// as for anyone else.
function foreignOwnerLabelerParam(label) {
  const name = label && label.sheetName;
  if (!name) return null;
  const sw = /^Labeled Data Software (\d+)$/.exec(name);
  if (sw) return sw[1];
  const nm = /^Labeled Data (.+)$/.exec(name);
  if (nm) return nm[1];
  return null;
}

// Display name for a foreign label's owner — "Labeled Data John" -> "John".
// Used everywhere a foreign row needs to say whose it is: the label log,
// the timeline tooltip, the "already labeled" popup, and the per-labeler
// show/hide list below.
function foreignOwnerName(label) {
  return String((label && label.sheetName) || '').replace(/^Labeled Data (Software )?/, '') || 'other labeler';
}

// Which foreign owners are individually hidden — see setupLabelerVisibilityMenu().
// Independent of state.showForeign: the master switch decides whether
// foreign rows show AT ALL, this decides which of THOSE owners are folded
// away once they do. Keyed by foreignOwnerName()'s display string, which is
// unique per sheet the way the app already treats labeler identity.
function isLabelerHidden(label) {
  return state.hiddenLabelers.has(foreignOwnerName(label));
}

// The "Unsure only" filter (review labeler only) — governs the tags floating
// over the video during playback and Shift+Arrow nav. The lanes and the
// minimap use shouldHideByTab()'s own copy of this same check instead, so
// that both stay in sync without sharing a function neither owns.
function shouldHideByUnsure(label) {
  if (label.isRoundMarker) return false;
  if (!state.unsureFilter) return false;
  return label.punch !== 'unsure';
}

// Which of the two Labels-panel tabs (and, since the same split now runs the
// timeline lanes, which of the two seg-lanes) a punch belongs in. 'unsure'
// (PUNCH_TYPES group 'other') falls into the offense bucket by default —
// there's no third lane or tab for it, and it's the one PUNCH_TYPES.group
// that isn't 'defense'.
function punchBucket(punchId) {
  const type = PUNCH_TYPES.find(p => p.id === punchId);
  return type && type.group === 'defense' ? 'defense' : 'offense';
}

// The Labels-panel list's own filter — bucketed by tab. Kept separate from
// shouldHideByUnsure() on purpose: that one still governs the timeline's
// video-side surfaces (the tags over the video, jumpToAdjacentLabel) exactly
// as before. The tabs are the one thing that decides what the list shows,
// and the Unsure-only filter is the one thing that decides what the video
// shows.
function shouldHideByTab(label) {
  // Round markers are exempt from the master "Others" switch — those have
  // always shown, as shared context — but an individually hidden labeler
  // (see isLabelerHidden) mutes them too.
  if (label.isRoundMarker) return isLabelerHidden(label);
  // Someone else's punch/defense row, folded away until "Others: shown" is
  // toggled on, or its owner is individually hidden.
  if (label.foreign && (!state.showForeign || isLabelerHidden(label))) return true;
  // 'combined' skips the bucket check entirely — every punch shows, same as
  // before the tabs existed. 'offense'/'defense' still filter by bucket.
  if (state.labelTab !== 'combined' && punchBucket(label.punch) !== state.labelTab) return true;
  if (!state.unsureFilter) return false;
  return label.punch !== 'unsure';
}

function setLabelTab(tab) {
  if (state.labelTab === tab) return;
  state.labelTab = tab;
  localStorage.setItem('labelTab', tab);
  updateLabelTabButtons();
  renderLabels();
}

function updateLabelTabButtons() {
  document.querySelectorAll('#label-tabs button').forEach((b) => {
    const on = b.dataset.tab === state.labelTab;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-selected', String(on));
  });
}

// ============================================================
// Punch Buttons
// ============================================================
// Presentation only — the buttons this builds are the same buttons as before
// (`.punch-btn` + `data-punch-id`, click → selectPunch), just laid out as the
// keyboard already describes them.
//
// The twelve offense entries are really SIX punches asked twice, head or body,
// which is exactly what 1–6 vs Shift+1–6 means. A flat list of twelve made you
// read every label to find one; a grid lets you read down for the punch and
// across for the target, and puts the shortcut in the cell you are already
// pointing at. Defense pairs off lead/rear the same way, so it gets the same
// two columns.
function buildPunchButtons() {
  const container = document.getElementById('punch-buttons');
  // Cleared up front: this used to only ever run once (on page load), but a
  // language switch now calls it again to re-render with new text, and
  // without this it would just keep appending a second, third... set.
  container.innerHTML = '';
  const live = PUNCH_TYPES.filter(p => !p.retired);

  const header = (text) => {
    const h = document.createElement('div');
    h.className = 'punch-group-header';
    h.textContent = text;
    container.appendChild(h);
  };

  const dot = (id) =>
    `<span class="dot" style="background:${getPunchColor(id)}"></span>`;
  const keycap = (punch) =>
    `<kbd class="shortcut">${punch.key.toUpperCase()}</kbd>`;

  // `named` carries the punch's own label; the matrix cells drop it because
  // the row name to their left already says it.
  const button = (punch, named) => {
    const btn = document.createElement('button');
    btn.className = named ? 'punch-btn' : 'punch-btn cell';
    btn.dataset.punchId = punch.id;
    btn.type = 'button';
    const label = punchLabel(punch.id), desc = punchDesc(punch.id);
    // The matrix cells carry no visible label (just a dot + keycap), so the
    // hover title is the only place the move's name shows up at all — the
    // description rides along either way, since neither form spells out
    // what a hook vs. a roll actually IS.
    btn.title = desc ? `${label} — ${desc}` : label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = named
      ? `${dot(punch.id)}<span class="pname">${label}</span>${keycap(punch)}`
      : `${dot(punch.id)}${keycap(punch)}`;
    btn.onclick = () => selectPunch(punch.id);
    return btn;
  };

  // --- Offense: name | head | body -------------------------------------
  const heads = live.filter(p => p.group === 'offense' && p.id.endsWith('_head'));
  if (heads.length) {
    header('Offense');
    const grid = document.createElement('div');
    grid.className = 'pmatrix';
    grid.innerHTML =
      '<span></span><span class="pmh">Head</span><span class="pmh">Body</span>';
    for (const head of heads) {
      const body = live.find(p => p.id === head.id.replace(/_head$/, '_body'));
      const name = document.createElement('span');
      name.className = 'prow-name';
      name.textContent = punchFamilyLabel(head.id);
      grid.appendChild(name);
      grid.appendChild(button(head, false));
      if (body) grid.appendChild(button(body, false));
      else grid.appendChild(document.createElement('span'));
    }
    container.appendChild(grid);
  }

  // --- Defense: two per row, lead beside rear ---------------------------
  const defense = live.filter(p => p.group === 'defense');
  if (defense.length) {
    header('Defense');
    const grid = document.createElement('div');
    grid.className = 'pgrid2';
    defense.forEach(p => grid.appendChild(button(p, true)));
    container.appendChild(grid);
  }

  // --- Anything else (currently just Unsure) ----------------------------
  const other = live.filter(p => p.group !== 'offense' && p.group !== 'defense');
  if (other.length) {
    header('Other');
    const grid = document.createElement('div');
    grid.className = 'pgrid1';
    other.forEach(p => grid.appendChild(button(p, true)));
    container.appendChild(grid);
  }

  // A language switch rebuilds every button from scratch mid-selection
  // (mode 'punch', waiting on a type before the end time) — carry the
  // selected look over, since selectPunch() itself only runs once per pick.
  if (state.selectedPunch) {
    container.querySelectorAll('.punch-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.punchId === state.selectedPunch);
    });
  }
}

function selectPunch(punchId) {
  state.selectedPunch = punchId;

  document.querySelectorAll('.punch-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.punchId === punchId);
  });

  if (state.mode === 'punch') {
    state.mode = 'end';
    document.getElementById('pending-label').textContent =
      `${punchLabel(punchId)} from ${formatTime(state.pendingStart)} — now set the end time`;
  }
  updateTimestampButton();
}

// ============================================================
// Timestamp / Labeling Workflow
// Workflow: Start time → Select punch → End time
// ============================================================
function updateTimestampButton() {
  const btn = document.getElementById('btn-timestamp');

  // Overrides everything below while the video's labels are still loading
  // — see setLoadingLocked(). Otherwise 'start' mode's own branch would
  // leave this clickable and let a label get started against a list that
  // hasn't finished coming in yet.
  if (state.labelsLoading) {
    btn.textContent = 'Loading…';
    btn.className = '';
    btn.disabled = true;
    return;
  }

  // The class on this button is also what the step pips in punch.css read
  // (via :has()) to show where you are in start → type → end. Keep 'ready' /
  // '' / 'end-mode' as the three states.
  if (state.mode === 'start') {
    btn.textContent = 'Set Start Time  ⏎';
    btn.className = 'ready';
    btn.disabled = false;
  } else if (state.mode === 'punch') {
    btn.textContent = 'Choose a move type';
    btn.className = '';
    btn.disabled = true;
  } else {
    if (!state.selectedPunch) {
      btn.textContent = 'Choose a move type';
      btn.className = '';
      btn.disabled = true;
    } else {
      btn.textContent = 'Set End Time  ⏎';
      btn.className = 'end-mode';
      btn.disabled = false;
    }
  }
}

function captureTimestamp() {
  const video = document.getElementById('video-player');
  const time = video.currentTime;

  if (state.mode === 'start') {
    state.pendingStart = time;
    state.mode = 'punch';
    state.selectedPunch = null;
    document.querySelectorAll('.punch-btn').forEach(btn => btn.classList.remove('selected'));
    document.getElementById('pending-label').textContent =
      `Started at ${formatTime(time)} — now choose the move type`;
    updateTimestampButton();
  } else if (state.mode === 'end' && state.selectedPunch) {
    const label = {
      id: null,
      // Stable identifier the punch keeps across edits. Used as the join
      // key by the rules labeler (Form Labels sheet) so form annotations
      // survive row/id reshuffles.
      punch_uuid: crypto.randomUUID(),
      punch: state.selectedPunch,
      angle: '',
      start: state.pendingStart,
      end: time,
      videoName: normalizeDriveUrl(document.getElementById('drive-link').value.trim()) || state.videoName,
      timestamp: new Date().toISOString(),
    };

    state.labels.push(label);
    state.mode = 'start';
    state.pendingStart = null;
    document.getElementById('pending-label').textContent = '';
    updateTimestampButton();
    renderLabels();

    pushLabelToSheet(label).then(() => fetchLabelsFromSheet());
    showToast(`Labeled: ${punchLabel(label.punch)} (${formatTime(label.start)} - ${formatTime(label.end)})`, 'success');
  }
}

// ============================================================
// Google Apps Script Push (no auth needed)
// ============================================================
async function pushLabelToSheet(label) {
  if (!state.scriptUrl) return;
  const punch = PUNCH_TYPES.find(p => p.id === label.punch);
  try {
    const url = sheetUrl({
      action: 'add',
      videoName: label.videoName,
      trainingType: document.getElementById('training-type').value,
      stance: document.getElementById('stance-select').value,
      punchId: punch.id,
      punchUuid: label.punch_uuid || '',
      angle: label.angle || '',
      startTime: formatTimeSheet(label.start),
      endTime: formatTimeSheet(label.end),
    });
    const resp = await fetch(url);
    const result = await resp.json();
    if (result.status === 'error') {
      console.error('Sheet push error:', result.message);
      showToast('Sheet save failed: ' + result.message, 'error');
    } else {
      if (result.id != null) label.id = result.id;
      // Server may have stamped its own UUID if our client-generated one was
      // missing (older builds). Adopt whatever the server persisted.
      if (result.punch_uuid) label.punch_uuid = result.punch_uuid;
      showToast('Saved to Google Sheet', 'info');
    }
  } catch (e) {
    console.error('Sheet push failed:', e);
    showToast('Sheet save failed: ' + e.message, 'error');
  }
}

function addRoundMarker(markerType) {
  const video = document.getElementById('video-player');
  const time = video.currentTime;
  const label = {
    id: null,
    // Round markers get UUIDs too so every row in the sheet has one —
    // simpler backend schema than conditionally stamping.
    punch_uuid: crypto.randomUUID(),
    punch: markerType,
    start: time,
    end: time,
    videoName: normalizeDriveUrl(document.getElementById('drive-link').value.trim()) || state.videoName,
    isRoundMarker: true,
    timestamp: new Date().toISOString(),
  };
  state.labels.push(label);
  renderLabels();
  pushRoundMarkerToSheet(label);
}

async function pushRoundMarkerToSheet(label) {
  if (!state.scriptUrl) return;
  const time = formatTimeSheet(label.start);
  try {
    const url = sheetUrl({
      action: 'add',
      videoName: label.videoName,
      trainingType: document.getElementById('training-type').value,
      stance: document.getElementById('stance-select').value,
      punchId: label.punch,
      punchUuid: label.punch_uuid || '',
      angle: '',
      startTime: time,
      endTime: time,
    });
    const resp = await fetch(url);
    const result = await resp.json();
    if (result.id != null) label.id = result.id;
    if (result.punch_uuid) label.punch_uuid = result.punch_uuid;
    showToast(`${label.punch} saved at ${formatTime(label.start)}`, 'success');
    fetchLabelsFromSheet();
  } catch (e) {
    console.error('Round marker push failed:', e);
    showToast('Round marker save failed: ' + e.message, 'error');
  }
}

// ============================================================
// Drive Link
// ============================================================
function setupDriveLink() {
  const input = document.getElementById('drive-link');
  const trainingType = document.getElementById('training-type');
  const stance = document.getElementById('stance-select');
  const copyBtn = document.getElementById('btn-copy-link');

  const prefix = labelerId() ? 'labeler_' + labelerId() + '_' : 'labeler_';
  const saved = localStorage.getItem(prefix + 'drive_link');
  if (saved) input.value = saved;
  if (copyBtn) {
    copyBtn.hidden = !input.value.trim();
    copyBtn.addEventListener('click', () => copyDriveLink(input, copyBtn));
  }

  const savedType = localStorage.getItem(prefix + 'training_type');
  const savedStance = localStorage.getItem(prefix + 'stance');
  if (savedType) trainingType.value = savedType;
  if (savedStance) stance.value = savedStance;

  trainingType.addEventListener('change', () => {
    localStorage.setItem(prefix + 'training_type', trainingType.value);
  });
  stance.addEventListener('change', () => {
    localStorage.setItem(prefix + 'stance', stance.value);
  });

  let debounceTimer;
  input.addEventListener('input', () => {
    localStorage.setItem(prefix + 'drive_link', normalizeDriveUrl(input.value.trim()));
    if (copyBtn) copyBtn.hidden = !input.value.trim();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (input.value.trim()) {
        state.labels = [];
        fetchLabelsFromSheet(true);
      }
    }, 500);
  });

  if (saved && saved.trim()) {
    fetchLabelsFromSheet(true);
  }
}

// One click on top of the field already being a real, selectable <input> —
// see the comment on #btn-copy-link. Clipboard API needs a secure context
// (https, or localhost); execCommand('copy') is the fallback for a plain
// http:// preview.
async function copyDriveLink(input, btn) {
  const text = input.value.trim();
  if (!text) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      input.select();
      document.execCommand('copy');
      input.setSelectionRange(0, 0);
    }
    btn.classList.add('copied');
    const prevTitle = btn.title;
    btn.title = 'Copied!';
    setTimeout(() => { btn.classList.remove('copied'); btn.title = prevTitle; }, 1200);
  } catch (e) {
    showToast('Copy failed — select the link and copy manually', 'error');
  }
}

// ============================================================
// Fetch existing labels from Google Sheet
// ============================================================
// The drive link's own status chip. ui.js owns the rendering; this is the only
// place that knows whether the sheet actually answered for that link, so it is
// the only place that can say so. Guarded, so app.js still runs without ui.js.
function linkStatus(kind, detail) {
  if (typeof window.setLinkStatus === 'function') window.setLinkStatus(kind, detail);
}

// `fetch` with a hard ceiling. Nothing on this page may wait forever: a
// hung request used to leave the move catalogue blocked behind its spinner
// with no way back. Rejects with an AbortError the callers translate into
// an honest "timed out".
async function fetchJson(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const resp = await fetch(url, { signal: ctl.signal });
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// Every load takes a ticket. Only the newest one may touch state or the UI,
// so an older response landing late (a slow first request finishing after
// the user has already pasted a different link) can neither overwrite the
// newer video's labels nor unlock/relock the panel out from under it. This
// is what the previous plain boolean got wrong in both directions: it
// unlocked while another request was still running, and could leave the
// spinner up after one finished out of order.
let _loadToken = 0;

// Loading a video's labels, in two phases against two endpoints:
//   1. `list`        — this labeler's OWN rows. One sheet, quick. The page
//                      renders and UNLOCKS on this.
//   2. `listForeign` — everyone else's rows. Walks every labeler sheet and
//                      is slow enough (~40s uncached) that making the page
//                      wait on it is what made it look permanently broken.
//                      Folded in whenever it arrives; failure here is not
//                      fatal, it just means others' rows aren't shown.
// See the matching split in apps_script/Code.js's doGet.
async function fetchLabelsFromSheet(isFreshLoad = false) {
  if (_pendingDeletes > 0) return;
  const driveLink = normalizeDriveUrl(document.getElementById('drive-link').value.trim());
  // Returns before any request goes out, so the chip must not be put into
  // 'syncing' above this — it would sit there spinning forever. It is cleared
  // instead: with no link there is nothing being filed, and leaving the last
  // "Saved" up would claim otherwise. (The _pendingDeletes guard above is
  // different — that link is still live, the lookup is just deferred.)
  if (!state.scriptUrl || !driveLink) { linkStatus('idle'); return; }

  const token = ++_loadToken;
  const current = () => token === _loadToken;

  linkStatus('syncing');
  // Locked only for the load that just opened this video — not for the
  // quiet re-fetch after this labeler's own add/edit/delete, which
  // shouldn't block anything the labeler is already mid-way through.
  if (isFreshLoad) setLoadingLocked(true);

  // ── phase 1: own rows ────────────────────────────────────────────────
  try {
    const result = await fetchJson(sheetUrl({ action: 'list', video: driveLink }), 30000);
    if (!current()) return;                    // superseded — drop it

    if (result.status === 'error') {
      console.error('Sheet fetch error:', result.message);
      showToast('Sheet error: ' + result.message, 'error');
      linkStatus('error', 'Sheet error');
      return;
    }

    // Own rows only; the foreign ones are replaced separately in phase 2 so
    // a failure there can't wipe what phase 1 just rendered.
    state.labels = state.labels.filter(l => !(l.fromSheet && !l.foreign));

    const sheetLabels = (result.labels || []).map(l => {
      const punch = mapPunchType(l.punch);
      const isRound = punch === 'round_start' || punch === 'round_end';
      return {
        id: l.id,
        punch_uuid: l.punch_uuid || '',
        punch: punch,
        angle: l.angle || '',
        start: typeof l.startTime === 'number' ? l.startTime : parseSheetTime(l.startTime),
        end: typeof l.endTime === 'number' ? l.endTime : parseSheetTime(l.endTime),
        videoName: l.videoName,
        fromSheet: true,
        sheetName: l.sheet,
        isRoundMarker: isRound,
      };
    });
    for (const sl of sheetLabels) {
      const isDuplicate = state.labels.some(ll =>
        ll.id === sl.id ||
        (ll.punch === sl.punch &&
         Math.abs(ll.start - sl.start) < 0.01 &&
         Math.abs(ll.end - sl.end) < 0.01)
      );
      if (!isDuplicate) state.labels.push(sl);
    }

    syncRoundActiveFromLabels();
    renderLabels();
    linkStatus('ok');
  } catch (e) {
    if (!current()) return;
    reportLoadFailure(e, 'labels');
    return;
  } finally {
    // Unlock as soon as the labeler's OWN rows are in — the slow half runs
    // in the background. Guarded on `current()` so a superseded load can
    // never unlock the newer one's spinner.
    if (isFreshLoad && current()) setLoadingLocked(false);
  }

  // ── phase 2: everyone else's rows, in the background ─────────────────
  // Deliberately not awaited by the caller's critical path and never
  // blocking: the page is already usable at this point.
  //
  // Skipped on the quiet re-fetch that follows this labeler's own
  // add/edit/delete. Nobody ELSE's rows changed because I saved one of
  // mine, and the save just invalidated this video's server-side cache
  // (see invalidateVideoRowCache in apps_script/Code.js) — so asking again
  // here would pay the full uncached ~17s walk after every single label.
  //
  // Admin is the exception and has to re-ask: it owns no sheet, so a row it
  // just created comes back as somebody else's FOREIGN row, and until that
  // arrives the optimistic local copy has no owner to write a later edit
  // back to. See mergeForeignPunchLabels(), which adopts it in place.
  if (!isFreshLoad && !state.isAdmin) return;

  try {
    const fgn = await fetchJson(sheetUrl({ action: 'listForeign', video: driveLink }), 60000);
    if (!current()) return;
    if (fgn.status === 'error') {
      console.error('Foreign fetch error:', fgn.message);
      return;
    }
    state.labels = state.labels.filter(l => !l.foreign);
    mergeForeignRoundMarkers(fgn, driveLink);
    mergeForeignPunchLabels(fgn, driveLink);
    syncRoundActiveFromLabels();
    renderLabels();
    updateForeignFilterButton();
    // Only the caller who just opened this video (a pasted link, or the one
    // restored on page load — see setupDriveLink()) asks for the popup; a
    // routine re-fetch after this labeler's own add/edit/delete stays quiet.
    if (isFreshLoad) maybeShowForeignVideoPopup();
  } catch (e) {
    if (!current()) return;
    // Non-fatal by design — the labeler's own rows are already on screen and
    // editable. Says so in the corner rather than taking the page down.
    console.error('Failed to load other labelers’ rows:', e);
    showToast(e.name === 'AbortError'
      ? 'Other labelers’ labels timed out — yours are loaded and safe to edit.'
      : 'Could not load other labelers’ labels — yours are loaded and safe to edit.', 'error');
  }
}

// One place that turns a thrown fetch into what the labeler sees, so the
// timeout and the offline case can't drift apart between call sites.
function reportLoadFailure(e, what) {
  if (e && e.name === 'AbortError') {
    console.error('Sheet fetch timed out:', what);
    showToast('Loading timed out — the sheet is slow right now. Press Retry.', 'error');
    linkStatus('error', 'Timed out');
  } else {
    console.error('Failed to fetch ' + what + ':', e);
    showToast('Could not reach the sheet. Press Retry.', 'error');
    linkStatus('error', 'Not reaching sheet');
  }
}

// Blocks starting a new label (the punch-type buttons and "Set Start Time")
// while a just-opened video's labels are still in flight — the fetch can
// take a few seconds against a cold Apps Script backend, and starting a
// label against a list that hasn't finished loading risks a duplicate a
// moment later when the real data lands. #punch-loading is the visible
// spinner over the move catalogue; updateTimestampButton() reads the flag
// too, since disabling the buttons alone still left the OTHER way to start
// a label (the Set Start Time button) live.
function setLoadingLocked(locked) {
  state.labelsLoading = locked;
  const overlay = document.getElementById('punch-loading');
  if (overlay) overlay.hidden = !locked;
  updateTimestampButton();
}

// "This video is already being labeled by someone else" — pops up the
// moment a video is opened (not on every incidental re-fetch) if any
// foreign rows came back for it. Counts by owner so the busiest labeler is
// obvious at a glance; for Admin specifically that's also who a brand-new
// label would be attributed to (see resolveMajorityLabelerSheet in
// apps_script/Code.js), so the note below spells that out.
function maybeShowForeignVideoPopup() {
  const counts = {};
  for (const l of state.labels) {
    if (!l.foreign) continue;
    const who = foreignOwnerName(l);
    counts[who] = (counts[who] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return;

  const dlg = document.getElementById('fvd-dialog');
  const body = document.getElementById('fvd-body');
  if (!dlg || !body) return;

  const rows = entries.map(([who, n]) =>
    `<div class="fvd-row"><strong>${who}</strong><span>${n} label${n === 1 ? '' : 's'}</span></div>`
  ).join('');
  const note = state.isAdmin
    ? `<p class="fvd-note">A new label you add here will be credited to <strong>${entries[0][0]}</strong> (most labels on this video) — editing an existing row instead writes back to whoever owns that row.</p>`
    : '';
  body.innerHTML = `<p class="fvd-lede">This video already has labels from:</p><div class="fvd-rows">${rows}</div>${note}`;
  // showModal() throws InvalidStateError on an already-open dialog — which
  // happens when a second video is opened before this popup is dismissed.
  // Thrown from inside phase 2's try, it would have surfaced as a bogus
  // "could not load other labelers' labels".
  if (!dlg.open) dlg.showModal();
}

// Round markers from OTHER labelers' sheets (list response
// `foreign_round_markers`). Read-only: they show the video's round
// structure so a second labeler doesn't re-mark rounds, but can't be
// edited or deleted from here. Own markers of the same type nearby win.
function mergeForeignRoundMarkers(result, driveLink) {
  if (!Array.isArray(result.foreign_round_markers)) return;
  for (const fm of result.foreign_round_markers) {
    const t = typeof fm.startTime === 'number' ? fm.startTime : parseSheetTime(fm.startTime);
    if (!Number.isFinite(t)) continue;
    // A row Admin just added (addRoundMarker(), attributed by the backend
    // to whoever labels this video most — see resolveMajorityLabelerSheet
    // in apps_script/Code.js) comes back HERE, not in `labels`: Admin's own
    // list is always empty. Adopt the still-local optimistic entry in place
    // instead of pushing a duplicate, so it picks up `foreign`/`sheetName`
    // and a later edit redirects to the right owner sheet
    // (foreignOwnerLabelerParam()) instead of hitting "Admin has no sheet".
    const existing = state.labels.find(l => l.isRoundMarker && !l.foreign &&
      (l.id != null && fm.id != null ? l.id === fm.id : l.punch === fm.punch && Math.abs(l.start - t) < 0.5));
    if (existing) {
      Object.assign(existing, { foreign: true, sheetName: fm.sheet, fromSheet: true, videoName: driveLink });
      if (fm.id != null) existing.id = fm.id;
      continue;
    }
    const dupe = state.labels.some(l =>
      l.isRoundMarker && l.punch === fm.punch && Math.abs(l.start - t) < 0.5);
    if (dupe) continue;
    state.labels.push({
      // `id` (and a real videoName, not null) only matter once an admin can
      // write back to this row — see updateLabelInSheet/deleteLabelFromSheet
      // and foreignOwnerLabelerParam(). Everyone else's UI never reads them.
      id: fm.id != null ? fm.id : null, punch_uuid: '', punch: fm.punch, start: t, end: t,
      videoName: driveLink, fromSheet: true, isRoundMarker: true,
      foreign: true, sheetName: fm.sheet,
    });
  }
}

// Punch/defense rows from OTHER labelers' sheets (list response
// `foreign_punch_labels`). Read-only for a normal labeler — shown so they
// can see what everyone else marked on a shared video, but
// isForeignLabel()/refuseForeign() (and ui.js's own checks) keep them
// un-draggable, un-editable, un-deletable from here. An admin caller gets
// isForeignLabel() === false instead, so these become editable — the `id`
// and `videoName` set below are what let the save round-trip find the row
// again in the OWNER's sheet.
function mergeForeignPunchLabels(result, driveLink) {
  if (!Array.isArray(result.foreign_punch_labels)) return;
  for (const fp of result.foreign_punch_labels) {
    const start = typeof fp.startTime === 'number' ? fp.startTime : parseSheetTime(fp.startTime);
    const end = typeof fp.endTime === 'number' ? fp.endTime : parseSheetTime(fp.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    // A row Admin just added (captureTimestamp(), attributed by the backend
    // to whoever labels this video most — see resolveMajorityLabelerSheet
    // in apps_script/Code.js) comes back HERE, not in `labels`: Admin's own
    // list is always empty. Adopt the still-local optimistic entry in place
    // instead of pushing a duplicate — same reasoning as
    // mergeForeignRoundMarkers() above.
    const existing = state.labels.find(l => !l.isRoundMarker && !l.foreign &&
      (l.id != null && fp.id != null
        ? l.id === fp.id
        : l.punch === mapPunchType(fp.punch) && Math.abs(l.start - start) < 0.01 && Math.abs(l.end - end) < 0.01));
    if (existing) {
      Object.assign(existing, { foreign: true, sheetName: fp.sheet, fromSheet: true, videoName: driveLink });
      if (fp.id != null) existing.id = fp.id;
      continue;
    }
    state.labels.push({
      id: fp.id != null ? fp.id : null, punch_uuid: '', punch: mapPunchType(fp.punch), start, end,
      videoName: driveLink, fromSheet: true, isRoundMarker: false,
      foreign: true, sheetName: fp.sheet,
    });
  }
}

// Map sheet punch types to our IDs
function mapPunchType(sheetPunch) {
  if (!sheetPunch) return 'jab_head';
  const p = String(sheetPunch).toLowerCase().trim();
  if (p === 'round_start' || p === 'round start') return 'round_start';
  if (p === 'round_end' || p === 'round end') return 'round_end';
  if (PUNCH_TYPES.find(t => t.id === p)) return p;
  const byLabel = PUNCH_TYPES.find(t => t.label.toLowerCase() === p);
  if (byLabel) return byLabel.id;
  const MAP = {
    'jab': 'jab_head', 'jab head': 'jab_head', 'jab (head)': 'jab_head',
    'jab body': 'jab_body', 'jab (body)': 'jab_body',
    'cross': 'cross_head', 'cross head': 'cross_head', 'cross (head)': 'cross_head',
    'cross body': 'cross_body', 'cross (body)': 'cross_body',
    'lead hook': 'lead_hook_head', 'lead hook head': 'lead_hook_head', 'lead hook (head)': 'lead_hook_head',
    'rear hook': 'rear_hook_head', 'rear hook head': 'rear_hook_head', 'rear hook (head)': 'rear_hook_head',
    'lead uppercut': 'lead_uppercut_head', 'lead uppercut head': 'lead_uppercut_head',
    'rear uppercut': 'rear_uppercut_head', 'rear uppercut head': 'rear_uppercut_head',
    'lead hook body': 'lead_hook_body', 'lead hook (body)': 'lead_hook_body',
    'rear hook body': 'rear_hook_body', 'rear hook (body)': 'rear_hook_body',
    'lead uppercut body': 'lead_uppercut_body', 'lead uppercut (body)': 'lead_uppercut_body',
    'rear uppercut body': 'rear_uppercut_body', 'rear uppercut (body)': 'rear_uppercut_body',
    'lead slip': 'lead_slip', 'rear slip': 'rear_slip',
    'lead roll': 'lead_roll', 'rear roll': 'rear_roll',
    'pull back': 'pull_back', 'pullback': 'pull_back',
    'step back': 'step_back', 'stepback': 'step_back',
    'round start': 'round_start', 'round end': 'round_end',
    'unsure': 'unsure', '?': 'unsure',
  };
  if (MAP[p]) return MAP[p];
  const underscored = p.replace(/\s+/g, '_');
  if (PUNCH_TYPES.find(t => t.id === underscored)) return underscored;
  console.warn('Unknown punch type from sheet:', sheetPunch, '→ defaulting to jab_head');
  return 'jab_head';
}

function parseSheetTime(timeStr) {
  if (typeof timeStr === 'number') return timeStr;
  if (!timeStr) return 0;
  let s = String(timeStr).replace(',', '.');
  const parts = s.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(s) || 0;
}

// ============================================================
// Labels Rendering & Storage
// ============================================================
function renderLabels() {
  const log = document.getElementById('label-log');
  const count = document.getElementById('label-count');
  const punchCount = state.labels.filter(l => !l.isRoundMarker && !shouldHideByTab(l)).length;
  count.textContent = `(${punchCount})`;

  // Capture open editors before wiping (keyed by array index —
  // unique within a render call, unlike label.id which can collide)
  const openEditors = {};
  log.querySelectorAll('.label-entry.editing').forEach(entry => {
    const idx = parseInt(entry.dataset.labelIdx);
    const label = state.labels[idx];
    if (!label) return;
    if (label.isRoundMarker) {
      const startInput = entry.querySelector('.edit-start');
      openEditors[idx] = { isRoundMarker: true, start: startInput ? startInput.value : null };
    } else {
      const punchSel = entry.querySelector('.edit-punch');
      const startInput = entry.querySelector('.edit-start');
      const endInput = entry.querySelector('.edit-end');
      openEditors[idx] = {
        isRoundMarker: false,
        punch: punchSel ? punchSel.value : null,
        start: startInput ? startInput.value : null,
        end: endInput ? endInput.value : null,
      };
    }
  });

  log.innerHTML = '';
  const sorted = state.labels.map((label, idx) => ({ label, idx }));
  sorted.sort((a, b) => b.label.start - a.label.start);
  sorted.forEach(({ label, idx }) => {
    if (shouldHideByTab(label)) return;
    const entry = document.createElement('div');

    if (label.isRoundMarker) {
      // rm-start/rm-end colour-code the row (green/blue, matching the
      // timeline's own round flags \u2014 see .round-mark in punch.css);
      // rm-foreign keeps it at the old muted, colourless look, since the
      // tint is reserved for a boundary this labeler can actually act on.
      const isStart = label.punch === 'round_start';
      const who = foreignOwnerName(label);
      entry.className = 'label-entry round-marker ' + (isStart ? 'rm-start' : 'rm-end') +
        (label.foreign && !state.isAdmin ? ' rm-foreign' : '');
      const icon = isStart ? '\u25B6' : '\u25A0';
      const text = isStart ? 'Round Start' : 'Round End';
      if (label.foreign && !state.isAdmin) {
        entry.innerHTML = `
          <span class="label-text">
            <strong>${icon} ${text}</strong>
            <small>${formatTime(label.start)} &middot; ${who} (read-only)</small>
          </span>
        `;
        entry.querySelector('.label-text').style.cursor = 'pointer';
        entry.querySelector('.label-text').onclick = () => {
          document.getElementById('video-player').currentTime = label.start;
        };
      } else {
        // label.foreign here (admin only) means this row belongs to `who`'s
        // sheet, not the admin's own \u2014 deleteLabel/saveEditRoundMarker still
        // write it there, via foreignOwnerLabelerParam().
        entry.innerHTML = `
          <span class="label-text">
            <small>#${label.id || '...'}</small> <strong>${icon} ${text}</strong>
            <small>${formatTime(label.start)}${label.foreign ? ' &middot; ' + who : ''}</small>
          </span>
          <button class="label-delete" onclick="event.stopPropagation(); deleteLabel(${idx})" title="Delete">&times;</button>
        `;
        entry.querySelector('.label-text').style.cursor = 'pointer';
        entry.querySelector('.label-text').onclick = () => openEditRoundMarker(idx);
      }
    } else if (label.foreign && !state.isAdmin) {
      // Read-only, same treatment as a foreign round marker: no edit pencil,
      // no delete — this row belongs to another labeler's sheet and
      // isForeignLabel()/refuseForeign() would refuse the mutation anyway.
      const who = foreignOwnerName(label);
      entry.className = 'label-entry label-foreign';
      entry.style.borderLeftColor = getPunchColor(label.punch);
      entry.innerHTML = `
        <span class="label-text">
          <strong>${punchLabel(label.punch)}</strong><br>
          <small>${formatTime(label.start)} &rarr; ${formatTime(label.end)} &middot; ${who} (read-only)</small>
        </span>
      `;
      entry.querySelector('.label-text').style.cursor = 'pointer';
      entry.querySelector('.label-text').onclick = () => {
        document.getElementById('video-player').currentTime = label.start;
      };
    } else {
      // label.foreign here means admin editing someone else's row (the
      // read-only branch above already handled every non-admin case) —
      // saveEditLabel/deleteLabel still write it into THEIR sheet, via
      // foreignOwnerLabelerParam().
      const who = label.foreign ? foreignOwnerName(label) : '';
      entry.className = 'label-entry';
      entry.style.borderLeftColor = getPunchColor(label.punch);
      // The pencil is the only thing that ever said these rows are editable.
      // Clicking anywhere on the row has always opened the editor; nothing on
      // screen admitted it, so the type and the times looked like a receipt.
      entry.innerHTML = `
        <span class="label-text">
          <small style="color:#555">#${label.id || '...'}</small> <strong>${punchLabel(label.punch)}</strong>${who ? ` <small>&middot; ${who}</small>` : ''}<br>
          ${formatTime(label.start)} &rarr; ${formatTime(label.end)}
        </span>
        <button class="label-edit" onclick="event.stopPropagation(); openEditLabel(${idx})" title="Edit type and times" aria-label="Edit"><svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9.1 2.4 11.6 4.9M2.2 11.8l.5-2.2 6.1-6.1 2.5 2.5-6.1 6.1-2.2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></button>
        <button class="label-delete" onclick="event.stopPropagation(); deleteLabel(${idx})" title="Delete">&times;</button>
      `;
      entry.querySelector('.label-text').style.cursor = 'pointer';
      entry.querySelector('.label-text').onclick = () => openEditLabel(idx);
    }

    entry.dataset.labelIdx = idx;
    log.appendChild(entry);
  });

  // Restore open editors with their unsaved values
  sorted.forEach(({ label, idx }) => {
    const saved = openEditors[idx];
    if (!saved) return;
    if (saved.isRoundMarker) {
      openEditRoundMarker(idx);
      const entry = log.querySelector(`[data-label-idx="${idx}"]`);
      if (entry && saved.start !== null) {
        entry.querySelector('.edit-start').value = saved.start;
      }
    } else {
      openEditLabel(idx);
      const entry = log.querySelector(`[data-label-idx="${idx}"]`);
      if (entry) {
        if (saved.punch !== null) entry.querySelector('.edit-punch').value = saved.punch;
        if (saved.start !== null) entry.querySelector('.edit-start').value = saved.start;
        if (saved.end !== null) entry.querySelector('.edit-end').value = saved.end;
      }
    }
  });

  renderTimelineOverlay();
}

function openEditLabel(idx) {
  const label = state.labels[idx];
  if (refuseForeign(label)) return;
  const log = document.getElementById('label-log');

  const entry = log.querySelector(`[data-label-idx="${idx}"]`);
  if (!entry || entry.classList.contains('editing')) return;

  entry.classList.add('editing');

  // Grouped, so a nineteen-item flat list stops being something to hunt
  // through. A retired type still shows if it is the row's current value —
  // otherwise reopening an old `step_back` row would silently retype it.
  const opt = (p) =>
    `<option value="${p.id}" ${p.id === label.punch ? 'selected' : ''}>${punchLabel(p.id)}</option>`;
  const group = (name, ps) => {
    const live = ps.filter(p => !p.retired || p.id === label.punch);
    return live.length ? `<optgroup label="${name}">${live.map(opt).join('')}</optgroup>` : '';
  };
  const inGroup = (g) => PUNCH_TYPES.filter(p => p.group === g);
  const punchOpts =
    group('Offense — head', inGroup('offense').filter(p => p.id.endsWith('_head'))) +
    group('Offense — body', inGroup('offense').filter(p => p.id.endsWith('_body'))) +
    group('Defense', inGroup('defense')) +
    group('Other', PUNCH_TYPES.filter(p => p.group !== 'offense' && p.group !== 'defense'));

  entry.innerHTML = `
    <div class="edit-form">
      <button class="label-delete" onclick="event.stopPropagation(); deleteLabel(${idx})" title="Delete">&times;</button>
      <label class="edit-lbl">Move</label>
      <div class="edit-row">
        <select class="edit-punch">${punchOpts}</select>
      </div>
      <label class="edit-lbl">Start &rarr; end</label>
      <div class="edit-row">
        <input type="text" class="edit-start" value="${formatTime(label.start)}" title="Start" spellcheck="false">
        <span class="edit-arrow">&rarr;</span>
        <input type="text" class="edit-end" value="${formatTime(label.end)}" title="End" spellcheck="false">
      </div>
      <div class="edit-row edit-actions">
        <button class="edit-seek" onclick="document.getElementById('video-player').currentTime=${label.start}">Seek</button>
        <button class="edit-cancel" onclick="cancelEdit(${idx})">Cancel</button>
        <button class="edit-save" onclick="saveEditLabel(${idx})">Save</button>
      </div>
    </div>
  `;
}

function openEditRoundMarker(idx) {
  const label = state.labels[idx];
  if (refuseForeign(label)) return;
  const log = document.getElementById('label-log');

  const entry = log.querySelector(`[data-label-idx="${idx}"]`);
  if (!entry || entry.classList.contains('editing')) return;

  entry.classList.add('editing');

  const text = label.punch === 'round_start' ? 'Round Start' : 'Round End';

  entry.innerHTML = `
    <div class="edit-form">
      <button class="label-delete" onclick="event.stopPropagation(); deleteLabel(${idx})" title="Delete">&times;</button>
      <div class="edit-row">
        <strong style="color:#888">${text}</strong>
      </div>
      <div class="edit-row">
        <label>Time:</label>
        <input type="text" class="edit-start" value="${formatTime(label.start)}">
      </div>
      <div class="edit-row">
        <button class="edit-save" onclick="saveEditRoundMarker(${idx})">Save</button>
        <button class="edit-cancel" onclick="cancelEdit(${idx})">Cancel</button>
        <button class="edit-seek" onclick="document.getElementById('video-player').currentTime=${label.start}">Seek</button>
      </div>
    </div>
  `;
}

function saveEditRoundMarker(idx) {
  const label = state.labels[idx];
  if (refuseForeign(label)) return;
  const log = document.getElementById('label-log');
  const entry = log.querySelector(`[data-label-idx="${idx}"]`);

  const start = parseTime(entry.querySelector('.edit-start').value);

  if (isNaN(start)) {
    showToast('Invalid time value', 'error');
    return;
  }

  label.start = start;

  entry.classList.remove('editing');
  renderLabels();
  showToast('Round marker updated, syncing...', 'success');
  updateLabelInSheet(label).then(() => {
    showToast(`Synced #${label.id} to sheet`, 'info');
  });
}

function saveEditLabel(idx) {
  const label = state.labels[idx];
  if (refuseForeign(label)) return;
  const log = document.getElementById('label-log');
  const entry = log.querySelector(`[data-label-idx="${idx}"]`);

  const punch = entry.querySelector('.edit-punch').value;
  const start = parseTime(entry.querySelector('.edit-start').value);
  const end = parseTime(entry.querySelector('.edit-end').value);

  if (isNaN(start) || isNaN(end)) {
    showToast('Invalid time values', 'error');
    return;
  }

  label.punch = punch;
  label.start = start;
  label.end = end;

  entry.classList.remove('editing');
  renderLabels();
  showToast('Label updated, syncing...', 'success');
  updateLabelInSheet(label).then(() => {
    showToast(`Synced #${label.id} to sheet`, 'info');
  });
}

function cancelEdit(idx) {
  const entry = document.querySelector(`#label-log [data-label-idx="${idx}"]`);
  if (entry) entry.classList.remove('editing');
  renderLabels();
}

function deleteLabel(idx) {
  const label = state.labels[idx];
  if (refuseForeign(label)) return;
  state.labels.splice(idx, 1);
  renderLabels();
  deleteLabelFromSheet(label);
}

// The right-click "Highlight" action on a timeline chip (ui.js's
// setupSegmentContextMenu) lands here: switch the Labels-panel tab if this
// punch's bucket is currently hidden, then scroll its row into view and
// flash it, so "which one did I just right-click" has an answer.
function highlightLabelInPanel(idx) {
  const label = state.labels[idx];
  if (!label || label.isRoundMarker) return;
  if (state.labelTab !== 'combined' && punchBucket(label.punch) !== state.labelTab) {
    setLabelTab(punchBucket(label.punch));
  }
  const entry = document.querySelector(`#label-log [data-label-idx="${idx}"]`);
  if (!entry) return;
  entry.scrollIntoView({ block: 'center', behavior: 'smooth' });
  entry.classList.remove('label-flash');
  void entry.offsetWidth;   // restart the animation if it's already mid-flash
  entry.classList.add('label-flash');
}

function undoLastLabel() {
  for (let i = state.labels.length - 1; i >= 0; i--) {
    if (isForeignLabel(state.labels[i])) continue;   // see refuseForeign() above
    const label = state.labels.splice(i, 1)[0];
    renderLabels();
    deleteLabelFromSheet(label);
    showToast('Undid last label', 'info');
    return;
  }
}

async function updateLabelInSheet(label) {
  if (!state.scriptUrl) { showToast('No script URL configured', 'error'); return; }
  if (!label.id) { showToast('Label has no ID, cannot update sheet', 'error'); return; }
  const params = {
    action: 'update',
    id: label.id,
    video: label.videoName,
    punchId: label.punch,
    angle: label.angle,
    startTime: formatTimeSheet(label.start),
    endTime: formatTimeSheet(label.end),
  };
  // Admin editing someone else's row: sheetUrl() defaults `labeler` to the
  // logged-in Admin identity, which would write this into "Labeled Data
  // Admin" — a sheet that isn't where the row lives. Overriding it here
  // sends the request to the ROW'S OWNER sheet instead, so the edit lands
  // exactly where it would have if that person had made it.
  if (label.foreign) {
    const owner = foreignOwnerLabelerParam(label);
    if (!owner) { showToast('Cannot resolve owner sheet for this row', 'error'); return; }
    params.labeler = owner;
  }
  try {
    const url = sheetUrl(params);
    const resp = await fetch(url);
    const result = await resp.json();
    console.log('Update response:', result);
    if (result.status === 'error') {
      showToast('Update failed: ' + result.message, 'error');
      return;
    }
    showToast(`Updated #${label.id} → sheet="${result.sheet}" row=${result.row} fields=[${result.updated}]`, 'info');
  } catch (e) {
    console.error('Sheet update failed:', e);
    showToast('Sheet update failed: ' + e.message, 'error');
  }
}

let _pendingDeletes = 0;

async function deleteLabelFromSheet(label) {
  if (!state.scriptUrl) { showToast('No script URL configured', 'error'); return; }
  if (!label.id) { showToast('Label has no ID, cannot delete from sheet', 'error'); return; }
  const params = { action: 'delete', id: label.id, video: label.videoName };
  // Same owner-redirect as updateLabelInSheet — see the comment there.
  if (label.foreign) {
    const owner = foreignOwnerLabelerParam(label);
    if (!owner) { showToast('Cannot resolve owner sheet for this row', 'error'); return; }
    params.labeler = owner;
  }
  _pendingDeletes++;
  try {
    const url = sheetUrl(params);
    console.log('Delete request:', url);
    const resp = await fetch(url);
    const text = await resp.text();
    console.log('Delete response:', text);
    const result = JSON.parse(text);
    if (result.status === 'error') {
      showToast('Delete failed: ' + result.message, 'error');
      return;
    }
    showToast(`Deleted #${label.id} from sheet`, 'info');
  } catch (e) {
    console.error('Sheet delete failed:', e);
    showToast('Sheet delete failed: ' + e.message, 'error');
  } finally {
    _pendingDeletes--;
    if (_pendingDeletes === 0) fetchLabelsFromSheet();
  }
}

// ============================================================
// Jump to adjacent label (Shift+Arrow nav)
// ============================================================
let _arrowHoldStart = null;
let _arrowHeldKey = null;

function jumpToAdjacentLabel(dir) {
  const video = document.getElementById('video-player');
  const now = video.currentTime;
  const EPS = 0.05;

  const times = state.labels
    .filter(l => !l.isRoundMarker && !shouldHideByUnsure(l))
    .map(l => l.start)
    .sort((a, b) => a - b);

  if (times.length === 0) return;

  let target = null;
  if (dir > 0) {
    target = times.find(t => t > now + EPS);
  } else {
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i] < now - EPS) { target = times[i]; break; }
    }
  }

  if (target !== null) {
    video.currentTime = target;
    updateTimeDisplay(target);
  }
}

// ============================================================
// Keyboard Shortcuts
// ============================================================
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') {
      e.target.blur();
    }

    switch (e.code) {
      case 'Escape':
        if (state.mode === 'punch' || state.mode === 'end') {
          e.preventDefault();
          state.mode = 'start';
          state.pendingStart = null;
          state.selectedPunch = null;
          document.querySelectorAll('.punch-btn').forEach(btn => btn.classList.remove('selected'));
          document.getElementById('pending-label').textContent = '';
          updateTimestampButton();
          showToast('Punch cancelled', 'info');
        }
        break;

      case 'Space':
        e.preventDefault();
        togglePlay();
        break;

      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const dir = e.code === 'ArrowLeft' ? -1 : 1;
        if (e.shiftKey) {
          jumpToAdjacentLabel(dir);
        } else {
          if (_arrowHeldKey !== e.code) {
            _arrowHeldKey = e.code;
            _arrowHoldStart = Date.now();
          }
          const held = Date.now() - _arrowHoldStart;
          const mult = held >= ACCEL_DELAY ? ACCEL_MULTIPLIER : 1;
          stepFrames(dir * mult);
        }
        break;
      }

      case 'Enter':
        e.preventDefault();
        captureTimestamp();
        break;

      case 'KeyS':
        e.preventDefault();
        if (state.roundActive) {
          showToast('Round already active — press E to end it first', 'error');
        } else {
          state.roundActive = true;
          localStorage.setItem('roundActive', 'true');
          updateRoundIndicator();
          addRoundMarker('round_start');
        }
        break;

      case 'KeyE':
        e.preventDefault();
        if (!state.roundActive) {
          showToast('No round in progress — press S to start one', 'error');
        } else {
          state.roundActive = false;
          localStorage.setItem('roundActive', 'false');
          updateRoundIndicator();
          addRoundMarker('round_end');
        }
        break;

      case 'Period':
      case 'Comma':
        if (e.shiftKey) {
          e.preventDefault();
          // ui.js owns the rate list (it builds the speed menu from it) and
          // publishes it here, so the keyboard steps through exactly the rates
          // the menu offers. The literal is the fallback for a page load where
          // ui.js has not run.
          const speeds = window.PUNCH_SPEEDS || [0.25, 0.5, 1, 2];
          const video = document.getElementById('video-player');
          // indexOf is exact-match on a float; nearest-rate keeps the cycle
          // working from a rate that is not on the list.
          let cur = 0, best = Infinity;
          speeds.forEach((s, i) => {
            const d = Math.abs(s - video.playbackRate);
            if (d < best) { best = d; cur = i; }
          });
          const next = e.code === 'Period'
            ? Math.min(cur + 1, speeds.length - 1)
            : Math.max(cur - 1, 0);
          setSpeed(speeds[next]);
          showToast(`Speed: ${speeds[next]}×`, 'info');
        }
        break;

      case 'Equal':
      case 'NumpadAdd':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomIn(); }
        break;
      case 'Minus':
      case 'NumpadSubtract':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomOut(); }
        break;
      // Number row: plain = head punch, Shift = body punch
      case 'Digit1': selectPunch(e.shiftKey ? 'jab_body' : 'jab_head'); break;
      case 'Digit2': selectPunch(e.shiftKey ? 'cross_body' : 'cross_head'); break;
      case 'Digit3': selectPunch(e.shiftKey ? 'lead_hook_body' : 'lead_hook_head'); break;
      case 'Digit4': selectPunch(e.shiftKey ? 'rear_hook_body' : 'rear_hook_head'); break;
      case 'Digit5': selectPunch(e.shiftKey ? 'lead_uppercut_body' : 'lead_uppercut_head'); break;
      case 'Digit6': selectPunch(e.shiftKey ? 'rear_uppercut_body' : 'rear_uppercut_head'); break;
      case 'Digit0':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomFit(); }
        break;

      case 'KeyZ':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          undoLastLabel();
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          undoLastLabel();
        }
        break;

      // Numpad: plain = head punch, Shift = body punch
      case 'Numpad1': selectPunch(e.shiftKey ? 'jab_body' : 'jab_head'); break;
      case 'Numpad2': selectPunch(e.shiftKey ? 'cross_body' : 'cross_head'); break;
      case 'Numpad3': selectPunch(e.shiftKey ? 'lead_hook_body' : 'lead_hook_head'); break;
      case 'Numpad4': selectPunch(e.shiftKey ? 'rear_hook_body' : 'rear_hook_head'); break;
      case 'Numpad5': selectPunch(e.shiftKey ? 'lead_uppercut_body' : 'lead_uppercut_head'); break;
      case 'Numpad6': selectPunch(e.shiftKey ? 'rear_uppercut_body' : 'rear_uppercut_head'); break;

      // Defense keys
      case 'KeyQ': selectPunch('lead_slip'); break;
      case 'KeyW': selectPunch('rear_slip'); break;
      case 'KeyA': selectPunch('lead_roll'); break;
      case 'KeyD': selectPunch('rear_roll'); break;
      case 'KeyR': selectPunch('pull_back'); break;
      case 'KeyC': selectPunch('duck'); break;
      case 'KeyU': selectPunch('unsure'); break;
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      _arrowHeldKey = null;
      _arrowHoldStart = null;
    }
  });
}

// ============================================================
// Round tracking
// ============================================================
function syncRoundActiveFromLabels() {
  const starts = state.labels.filter(l => l.punch === 'round_start').map(l => l.start).sort((a, b) => a - b);
  const ends = state.labels.filter(l => l.punch === 'round_end').map(l => l.start).sort((a, b) => a - b);
  let active = false;
  for (const s of starts) {
    if (!ends.some(e => e > s)) { active = true; break; }
  }
  state.roundActive = active;
  localStorage.setItem('roundActive', String(active));
  updateRoundIndicator();
}

function updateRoundIndicator() {
  const indicator = document.getElementById('round-indicator');
  if (!indicator) return;
  if (state.roundActive) {
    indicator.textContent = '\u25B6 Round Active — press E to end';
    indicator.className = 'round-active';
    indicator.onclick = () => {
      state.roundActive = false;
      updateRoundIndicator();
      addRoundMarker('round_end');
    };
  } else {
    indicator.textContent = 'Press S to start round';
    indicator.className = 'round-idle';
    indicator.onclick = () => {
      state.roundActive = true;
      updateRoundIndicator();
      addRoundMarker('round_start');
    };
  }
}

// ============================================================
// Timeline overlay — punch segments + round shading on seek bar,
// colored segments on minimap. Hook called by player.js.
// ============================================================
// The scrub track (#seek-bar-overlay + #seek-bar itself) is the one piece of
// the timeline that ui.js deliberately keeps UNZOOMED — see setupScrubOverview()
// there for why: it's the always-there "where am I in the whole video" line,
// and it stops being that the moment it can also show a five-second window.
// Every OTHER surface (ticks, both punch lanes, the round flags over them)
// keeps using timeToViewportPct()/state.zoomLevel as before. This is the
// plain, duration-only equivalent for anything drawn onto the scrub track.
function timeToScrubPct(time, duration) {
  return (time / duration) * 100;
}

function renderTimelineOverlay() {
  const overlay = document.getElementById('seek-bar-overlay');
  // Punch strips live in two lanes above the scrubber, offense over defense —
  // see the comment on #seg-lanes in index.html for why two. Falls back to
  // the overlay if a lane is missing, so an older page still renders.
  const laneOff = document.getElementById('seg-lane-off') || overlay;
  const laneDef = document.getElementById('seg-lane-def') || overlay;
  // Round-boundary flags are TWO layers, not one: #round-markers sits inside
  // #seg-lanes and zooms with it; #round-markers-scrub sits inside #scrub and
  // stays fixed to the always-full-range track. Same data, two coordinate
  // systems — see the timeToScrubPct() comment above.
  const markersLayer = document.getElementById('round-markers');
  const markersScrub = document.getElementById('round-markers-scrub');
  const video = document.getElementById('video-player');
  const duration = video.duration;
  overlay.innerHTML = '';
  if (laneOff !== overlay) laneOff.innerHTML = '';
  if (laneDef !== overlay && laneDef !== laneOff) laneDef.innerHTML = '';
  if (markersLayer) markersLayer.innerHTML = '';
  if (markersScrub) markersScrub.innerHTML = '';
  if (!duration || duration <= 0) return;

  const roundStarts = state.labels
    .filter(l => l.punch === 'round_start' || (l.isRoundMarker && l.punch?.includes?.('start')))
    .map(l => l.start)
    .sort((a, b) => a - b);
  const roundEnds = state.labels
    .filter(l => l.punch === 'round_end' || (l.isRoundMarker && l.punch?.includes?.('end')))
    .map(l => l.start)
    .sort((a, b) => a - b);

  const rounds = [];
  for (let i = 0; i < roundStarts.length; i++) {
    const rStart = roundStarts[i];
    const rEnd = roundEnds.find(e => e > rStart);
    rounds.push({ start: rStart, end: rEnd !== undefined ? rEnd : duration });
  }

  // Shade areas outside rounds — on the SCRUB track, which no longer zooms,
  // so this is plain duration math (timeToScrubPct), not the viewport-aware
  // timeToViewportPct the rest of the timeline still uses.
  if (rounds.length > 0) {
    let pos = 0;
    for (const r of rounds) {
      if (r.start > pos) {
        const seg = document.createElement('div');
        seg.className = 'seek-segment outside-round';
        seg.style.left = timeToScrubPct(pos, duration) + '%';
        seg.style.width = (timeToScrubPct(r.start, duration) - timeToScrubPct(pos, duration)) + '%';
        overlay.appendChild(seg);
      }
      pos = r.end;
    }
    if (pos < duration) {
      const seg = document.createElement('div');
      seg.className = 'seek-segment outside-round';
      seg.style.left = timeToScrubPct(pos, duration) + '%';
      seg.style.width = (100 - timeToScrubPct(pos, duration)) + '%';
      overlay.appendChild(seg);
    }
  }

  // Round-boundary flags — one per marker, own or foreign, independent of the
  // `rounds` pairing above: that array exists only to shade "outside round"
  // spans and drops which marker is whose. This walks state.labels directly
  // so every round_start/round_end gets a flag, each with its own seek
  // target and ownership. Built onto BOTH marker layers — the zoomed one over
  // the lanes and the always-full-range one over the scrub track — from the
  // same label, just two different left% calculations.
  if (markersLayer || markersScrub) {
    const seekFn = (label) => (e) => { e.stopPropagation(); video.currentTime = label.start; };
    state.labels.forEach((label) => {
      if (!label.isRoundMarker) return;
      // Round markers are otherwise exempt from state.showForeign (shared
      // context, shown regardless) — but an individually hidden labeler
      // (isLabelerHidden) is a stronger, per-person mute that DOES reach
      // round markers too.
      if (isLabelerHidden(label)) return;
      const isStart = label.punch === 'round_start' || label.punch?.includes?.('start');
      const cls = 'round-mark ' + (isStart ? 'rm-start' : 'rm-end') + (label.foreign && !state.isAdmin ? ' rm-foreign' : '');
      const title = (isStart ? 'Round start' : 'Round end') + ' — ' + formatTime(label.start) +
        (label.foreign ? (state.isAdmin ? ' (another labeler)' : ' (read-only, another labeler)') : '');

      if (markersLayer) {
        const pct = timeToViewportPct(label.start, duration);
        if (pct >= -1 && pct <= 101) {
          const mark = document.createElement('div');
          mark.className = cls;
          mark.style.left = Math.max(0, Math.min(100, pct)) + '%';
          mark.title = title;
          // stopPropagation matters here, not just tidiness: #seek-bar-wrapper
          // has its own click-to-seek listener (player.js), and without this
          // the click bubbles up to it and re-seeks from the click's pixel
          // position — approximately label.start, but not exactly, which
          // defeats the one thing this marker exists to give you.
          mark.addEventListener('click', seekFn(label));
          markersLayer.appendChild(mark);
        }
      }
      if (markersScrub) {
        const mark = document.createElement('div');
        mark.className = cls;
        mark.style.left = timeToScrubPct(label.start, duration) + '%';
        mark.title = title;
        mark.addEventListener('click', seekFn(label));
        markersScrub.appendChild(mark);
      }
    });
  }

  // Punch segments. Each strip carries the index of the label it draws, which
  // is what lets ui.js drag it: the lane is rebuilt on every render, so the
  // handler cannot hold a reference to the element — it looks the label back
  // up by index on each mousemove.
  state.labels.forEach((label, idx) => {
    if (label.isRoundMarker) return;
    if (label.foreign && (!state.showForeign || isLabelerHidden(label))) return;
    // Inlined rather than calling shouldHideByUnsure() — this loop runs
    // per-frame during drag, and only the unsure-filter half applies here;
    // offense/defense already have their own separate lanes.
    if (state.unsureFilter && label.punch !== 'unsure') return;
    const lPct = timeToViewportPct(label.start, duration);
    const rPct = timeToViewportPct(label.end, duration);
    if (rPct < 0 || lPct > 100) return;
    const seg = document.createElement('div');
    // rm-foreign-style muting for a strip pulled read-only from another
    // labeler's sheet — ui.js's own isForeignLabel() checks already keep it
    // undraggable; this just keeps it from looking like something you can
    // grab. Admin drags it like any other strip, so it skips the muting.
    seg.className = 'seek-segment' + (label.foreign && !state.isAdmin ? ' seg-foreign' : '');
    seg.dataset.labelIdx = idx;
    // Clipped at the viewport edges for DRAWING, but the untruncated times go
    // on the element too: a strip half off-screen at high zoom still has to
    // drag from its real start, not from where the paint happened to begin.
    seg.style.left = Math.max(0, lPct) + '%';
    seg.style.width = Math.max(Math.min(100, rPct) - Math.max(0, lPct), 0.15) + '%';
    seg.style.backgroundColor = getPunchColor(label.punch);
    const punchDescText = punchDesc(label.punch);
    const moveTitle = punchDescText ? `${punchLabel(label.punch)} — ${punchDescText}` : punchLabel(label.punch);
    if (label.foreign) {
      const who = foreignOwnerName(label);
      seg.title = moveTitle + '\n' + (state.isAdmin ? who : who + ' (read-only)');
    } else {
      seg.title = moveTitle;
    }
    (punchBucket(label.punch) === 'defense' ? laneDef : laneOff).appendChild(seg);
  });

  renderMinimap();
  updateMinimapChrome();
  renderTimeTicks();
}

function renderMinimap() {
  const video = document.getElementById('video-player');
  const duration = video.duration;
  const segContainer = document.getElementById('minimap-segments');
  segContainer.innerHTML = '';

  if (!duration || duration <= 0) return;

  for (const label of state.labels) {
    if (label.isRoundMarker) continue;
    if (label.foreign && (!state.showForeign || isLabelerHidden(label))) continue;
    // Same reasoning as the lane loop above: this overview strip should show
    // exactly what the lanes show, not fewer segments because of a toggle
    // that used to matter for a single combined lane and no longer does.
    if (state.unsureFilter && label.punch !== 'unsure') continue;
    const seg = document.createElement('div');
    seg.style.position = 'absolute';
    seg.style.top = '0';
    seg.style.height = '100%';
    seg.style.borderRadius = '1px';
    const leftPct = (label.start / duration) * 100;
    const widthPct = ((label.end - label.start) / duration) * 100;
    seg.style.left = leftPct + '%';
    seg.style.width = Math.max(widthPct, 0.3) + '%';
    seg.style.backgroundColor = getPunchColor(label.punch);
    seg.style.opacity = '0.7';
    segContainer.appendChild(seg);
  }
}

function updateVideoOverlay() {
  const overlay = document.getElementById('video-overlay');
  const video = document.getElementById('video-player');
  const t = video.currentTime;

  const roundStarts = state.labels
    .filter(l => l.punch === 'round_start' || (l.isRoundMarker && l.punch?.includes?.('start')))
    .map(l => l.start)
    .sort((a, b) => a - b);
  const roundEnds = state.labels
    .filter(l => l.punch === 'round_end' || (l.isRoundMarker && l.punch?.includes?.('end')))
    .map(l => l.start)
    .sort((a, b) => a - b);

  const rounds = [];
  for (let i = 0; i < roundStarts.length; i++) {
    const rStart = roundStarts[i];
    const rEnd = roundEnds.find(e => e > rStart);
    rounds.push({ start: rStart, end: rEnd });
  }

  let currentRound = null;
  let insideRound = false;
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    if (t >= r.start && (r.end === undefined || t <= r.end)) {
      currentRound = i + 1;
      insideRound = true;
      break;
    }
  }

  const activeLabels = state.labels.filter(l =>
    !l.isRoundMarker && (!l.foreign || (state.showForeign && !isLabelerHidden(l))) &&
    t >= l.start && t <= l.end && !shouldHideByUnsure(l)
  );

  const roundKey = currentRound ? 'R' + currentRound : 'out';
  const key = roundKey + '|' + activeLabels.map(l => l.id).join(',') + '|' + state.unsureFilter + '|' + state.showForeign;
  if (overlay.dataset.activeKey === key) return;
  overlay.dataset.activeKey = key;

  overlay.innerHTML = '';

  const dimOverlay = document.getElementById('video-dim-overlay');
  if (roundStarts.length > 0 && !insideRound) {
    if (!dimOverlay.classList.contains('active')) {
      dimOverlay.classList.add('active');
      dimOverlay.innerHTML = '<span class="dim-label">Outside Round</span>';
    }
  } else {
    dimOverlay.classList.remove('active');
    dimOverlay.innerHTML = '';
  }

  if (roundStarts.length > 0) {
    const tag = document.createElement('div');
    // Classes, not the two hardcoded hex values (#28a745, #e94560) this used
    // to carry — leftovers from the page's pre-redesign palette that no
    // longer matched anything else on screen. See .round-in/.round-out.
    tag.className = 'video-overlay-tag ' + (insideRound ? 'round-in' : 'round-out');
    tag.textContent = insideRound ? 'Round ' + currentRound : 'Outside Round';
    overlay.appendChild(tag);
  }

  for (const label of activeLabels) {
    const tag = document.createElement('div');
    tag.className = 'video-overlay-tag';
    tag.style.borderLeftColor = getPunchColor(label.punch);
    tag.style.cursor = 'pointer';
    tag.textContent = punchLabel(label.punch);
    const idx = state.labels.indexOf(label);
    tag.onclick = () => {
      openEditLabel(idx);
      const entry = document.querySelector(`#label-log [data-label-idx="${idx}"]`);
      if (entry) entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    overlay.appendChild(tag);
  }
}

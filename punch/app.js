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

// Six plain, far-apart hues for offense — red, blue, orange, purple, green,
// cyan — rather than the six neighbouring warm shades this used to be
// (red/orange/gold/pink sat within about 60° of each other and read as one
// smear on a 6px strip). Each punch keeps ONE hue across head and body so a
// jab is still "the red one"; the head/body split is carried by a large
// LIGHTNESS gap — a deep, saturated head against a distinctly pale body —
// which survives being 4px tall in a way a small shade difference did not.
// Defense sits in its own lane and gets four hues offense does not use
// (magenta, indigo, brown, olive), so a mis-routed strip is obvious.
// Enforced, not just intended: see the ΔE floors verified against this table.
const PUNCH_COLORS = {
  // Offense — dark = head, pale = body.
  jab_head:           '#d32020',   jab_body:           '#ffb0b0',  // red
  cross_head:         '#1259c9',   cross_body:         '#a8cbff',  // blue
  lead_hook_head:     '#e07000',   lead_hook_body:     '#ffd39b',  // orange
  rear_hook_head:     '#7b1fa2',   rear_hook_body:     '#e8a6e2',  // purple
  lead_uppercut_head: '#25822f',   lead_uppercut_body: '#a5dfa8',  // green
  rear_uppercut_head: '#006f78',   rear_uppercut_body: '#a8ecf4',  // cyan
  // Defense — same dark/pale rule for the lead/rear pairs. Pull-back and
  // duck have no counterpart, so each just takes its own hue.
  lead_slip: '#c2185b',   rear_slip: '#ffa8c8',                    // magenta
  lead_roll: '#3730a3',   rear_roll: '#b3b0e8',                    // indigo
  pull_back: '#6d4b34',                                            // brown
  duck:      '#8a8f1e',                                            // olive
  step_back: '#9aa0a6',   // retired; grey so old rows read as inactive
  // Other
  unsure:      '#8e8e93',
  round_start: '#1c7c33',
  round_end:   '#5a5a5f',
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
  // Lane order for other labelers — see foreignOwnersInOrder(). Same
  // reasoning as above for not persisting it.
  labelerOrder: [],
  // The row you last clicked, lit in the list AND on the timeline so the
  // two views point at the same thing. Held as the label OBJECT, not an
  // index: indices shift when a load rebuilds state.labels, which would
  // silently move the highlight onto some unrelated punch. Object identity
  // simply stops matching after a rebuild, which is the right behaviour.
  highlightedLabel: null,
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
  setupAgreement();
  setupAdminPresence();

  // Anything left queued from a previous session goes out now, and again
  // whenever the browser regains a connection. `online` alone isn't enough
  // (it doesn't fire for a server that was merely slow), which is why the
  // successful-save path drains too.
  updateOutboxChip();
  drainOutbox();
  window.addEventListener('online', () => drainOutbox({ quiet: false }));
  document.getElementById('outbox-chip')?.addEventListener('click',
    () => drainOutbox({ quiet: false }));
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
  // Listed in LANE order, not by count — the menu is also the reorder
  // control, so it has to show the order it edits.
  const owners = foreignOwnersInOrder().filter(n => counts[n]);

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

  owners.forEach((who, i) => {
    // A row, not a button: it holds the visibility toggle AND the two
    // reorder arrows, and a button can't contain buttons.
    const row = document.createElement('div');
    row.className = 'ffm-row';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ffm-toggle';
    toggle.setAttribute('role', 'menuitemcheckbox');
    // Greyed out and inert while the master switch is off — an individual
    // hide has nothing to do until "Show others" is on (shouldHideByTab()
    // hides every foreign row on that switch alone, regardless of this).
    toggle.disabled = !state.showForeign;
    toggle.setAttribute('aria-checked', String(!state.hiddenLabelers.has(who)));
    // The dot is this labeler's lane colour — the menu is where you learn
    // which colour on the timeline is whose.
    toggle.innerHTML =
      `<span class="ffm-dot" style="--who: ${labelerColor(who)}"></span>` +
      `<span class="ffm-name">${who}</span>` +
      `<span class="ffm-count">${counts[who]}</span>`;
    toggle.onclick = () => { toggleLabelerHidden(who); renderForeignFilterMenu(menu); };
    row.appendChild(toggle);

    // ▲▼ rather than drag-and-drop: four teammates at most, and a 28px menu
    // row sitting next to its own checkmark is a poor drop target.
    const arrows = document.createElement('span');
    arrows.className = 'ffm-arrows';
    [['▲', -1, i === 0], ['▼', 1, i === owners.length - 1]].forEach(([glyph, delta, atEnd]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ffm-arrow';
      b.textContent = glyph;
      b.title = delta < 0 ? 'Move up' : 'Move down';
      b.disabled = atEnd || !state.showForeign;
      b.onclick = (e) => { e.stopPropagation(); moveLabeler(who, delta); renderForeignFilterMenu(menu); };
      arrows.appendChild(b);
    });
    row.appendChild(arrows);
    menu.appendChild(row);
  });
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

// One stable colour per teammate, used by BOTH their timeline lane and the
// badge on their rows in the Labels list — so "whose mark is that" is
// answered the same way in both places. Hashed from the name rather than
// assigned in arrival order, so a person keeps their colour no matter who
// else happens to be on the video. Deliberately unrelated to PUNCH_COLORS:
// those say WHAT the move is, these say WHO logged it, and the two are read
// at different moments.
// Every one of these carries WHITE text on the .who-badge, so each is dark
// enough to clear 4.5:1 against white — the brighter versions of the orange,
// green, cyan and amber came in as low as 2.5:1 and were unreadable at the
// badge's 10px.
const LABELER_TINTS = [
  '#0071e3', '#c84d0a', '#7048e8', '#0a8560',
  '#d6336c', '#0d8091', '#aa6300', '#4263eb',
];
function labelerColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return LABELER_TINTS[Math.abs(h) % LABELER_TINTS.length];
}

// Every teammate with rows on this video, in display order. state.labelerOrder
// is the user's chosen order (moved with the arrows in the Others menu);
// anyone new is appended alphabetically, and anyone who's gone drops out.
function foreignOwnersInOrder() {
  const present = new Set();
  for (const l of state.labels) if (l.foreign) present.add(foreignOwnerName(l));
  const ordered = state.labelerOrder.filter(n => present.has(n));
  for (const n of [...present].sort()) if (!ordered.includes(n)) ordered.push(n);
  state.labelerOrder = ordered;
  return ordered;
}

// …of those, the ones actually being drawn right now.
function visibleForeignOwners() {
  if (!state.showForeign) return [];
  return foreignOwnersInOrder().filter(n => !state.hiddenLabelers.has(n));
}

// Move a teammate up or down the lane order. Used by the ▲▼ in the Others
// menu — buttons rather than drag-and-drop: the list is short, and a menu
// row is a poor drop target next to its own checkmark.
function moveLabeler(who, delta) {
  const order = foreignOwnersInOrder();
  const i = order.indexOf(who);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  order.splice(j, 0, order.splice(i, 1)[0]);
  state.labelerOrder = order;
  renderLabels();
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

// ============================================================
// Inter-rater agreement (admin only)
// ============================================================
// Two people labelling the same video is only worth the cost if you can
// say whether they AGREE — that is the whole point of the cross-labeler
// rows, and until now nothing measured it. Computed here in the browser
// from the rows already on screen: admin's listForeign pulls every
// labeler's punches for this video, so the answer needs no new endpoint
// and no round trip.
//
// Per-video by design. "Did these two people mark the same punches the
// same way in the clip I am looking at" is the question you ask while
// reviewing; a corpus-wide number would need a backend job over every
// sheet, which is a different (and much slower) thing.

// Overlap of two [start,end] intervals over their union. 1 = identical
// timing, 0 = no overlap at all.
function timeIoU(a, b) {
  const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (inter <= 0) return 0;
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return union > 0 ? inter / union : 0;
}

// Greedy best-first pairing: take the highest-IoU pair still available,
// then the next, and so on. Hungarian matching would be optimal, but on
// punches — which are short and rarely ambiguous about which one they are
// — greedy gives the same answer for far less machinery.
const AGREE_IOU_FLOOR = 0.3;
function matchPunchSets(A, B) {
  const cands = [];
  A.forEach((a, i) => B.forEach((b, j) => {
    const iou = timeIoU(a, b);
    if (iou >= AGREE_IOU_FLOOR) cands.push({ i, j, iou });
  }));
  cands.sort((x, y) => y.iou - x.iou);
  const usedA = new Set(), usedB = new Set(), pairs = [];
  for (const c of cands) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i); usedB.add(c.j);
    pairs.push({ a: A[c.i], b: B[c.j], iou: c.iou });
  }
  return {
    pairs,
    onlyA: A.filter((_, i) => !usedA.has(i)),
    onlyB: B.filter((_, j) => !usedB.has(j)),
  };
}

// Cohen's kappa over the matched pairs — how much the two agree on WHICH
// move it was, beyond what they'd hit by chance. A raw percentage flatters
// a set dominated by jabs: two people who both call everything a jab score
// 95% and have demonstrated nothing. Kappa divides that out, and is the
// number this kind of work is normally reported with.
// Undefined when one class accounts for everything (the chance term hits 1
// and the denominator vanishes) — reported as null rather than a fake 0.
function cohensKappa(pairs) {
  if (!pairs.length) return null;
  const po = pairs.filter(p => p.a.punch === p.b.punch).length / pairs.length;
  const fa = {}, fb = {};
  pairs.forEach(p => {
    fa[p.a.punch] = (fa[p.a.punch] || 0) + 1;
    fb[p.b.punch] = (fb[p.b.punch] || 0) + 1;
  });
  let pe = 0;
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    pe += ((fa[k] || 0) / pairs.length) * ((fb[k] || 0) / pairs.length);
  }
  if (pe > 0.9999) return null;
  return (po - pe) / (1 - pe);
}

// The usual plain-language bands for kappa, so the number doesn't need a
// stats background to act on.
function kappaBand(k) {
  if (k === null) return { word: '—', tone: 'na' };
  if (k < 0.2) return { word: 'poor', tone: 'bad' };
  if (k < 0.4) return { word: 'fair', tone: 'bad' };
  if (k < 0.6) return { word: 'moderate', tone: 'mid' };
  if (k < 0.8) return { word: 'good', tone: 'ok' };
  return { word: 'very good', tone: 'ok' };
}

// Spread, not just a mean. A mean IoU of 0.7 can be twenty tight pairs or
// ten perfect ones and ten scrapes past the 0.3 floor, and those call for
// different action — the second is a boundary convention that needs
// agreeing, the first is just noise. Median plus min/max says which.
function iouStats(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return {
    n: s.length,
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
    median: +mid.toFixed(2),
    min: +s[0].toFixed(2),
    max: +s[s.length - 1].toFixed(2),
  };
}

// Everything derivable from one set of matched pairs plus the two solo
// lists. Factored out because it is computed three times over — for the
// video as a whole, and again inside each round.
function pairStats(pairs, onlyA, onlyB) {
  const agreedPairs = pairs.filter(p => p.a.punch === p.b.punch);
  const kappa = cohensKappa(pairs);
  return {
    matched: pairs.length,
    typeAgree: agreedPairs.length,
    // Of the punches BOTH found, how often did they call it the same move.
    // Kept separate from the count because "we both saw a punch here" and
    // "we both think it was a jab" fail differently.
    typePct: pairs.length ? Math.round((agreedPairs.length / pairs.length) * 100) : null,
    // Timing spread over the pairs they AGREED on — averaging in a
    // jab-vs-cross pair would be measuring the wrong thing.
    iou: iouStats(agreedPairs.map(p => p.iou)),
    kappa: kappa === null ? null : +kappa.toFixed(2),
    kappaBand: kappaBand(kappa),
    // Signed, so it reads as a direction rather than a magnitude: a
    // consistent offset is a habit one of them can correct, which a mean
    // absolute error would have hidden.
    offsetMs: pairs.length
      ? Math.round((pairs.reduce((s, p) => s + (p.a.start - p.b.start), 0) / pairs.length) * 1000)
      : null,
    onlyA: onlyA.length,
    onlyB: onlyB.length,
    // Punches exactly one person marked. The headline number for coverage:
    // high here means the two are not even looking at the same events, which
    // no amount of type agreement makes up for.
    solo: onlyA.length + onlyB.length,
  };
}

// Per-move agreement. The single headline mean hides the thing you'd
// actually act on: a taxonomy usually fails on ONE distinction, and a
// timing problem is usually specific to one kind of move (uppercuts start
// ambiguously; jabs don't). A move counts toward `both` when EITHER labeler
// called it that, and toward `agreed` only when both did — so a move that
// one person always sees and the other never does shows up as a low
// percentage rather than silently vanishing. Solo punches are counted per
// move too, which is what answers "how many did just one of us catch".
function perMoveBreakdown(pairs, onlyA, onlyB) {
  const acc = {};
  const get = (id) => (acc[id] || (acc[id] = { move: id, both: 0, agreed: 0, ious: [], onlyA: 0, onlyB: 0 }));
  pairs.forEach(p => {
    if (p.a.punch === p.b.punch) {
      const r = get(p.a.punch);
      r.both++; r.agreed++; r.ious.push(p.iou);
    } else {
      get(p.a.punch).both++;
      get(p.b.punch).both++;
    }
  });
  onlyA.forEach(l => get(l.punch).onlyA++);
  onlyB.forEach(l => get(l.punch).onlyB++);
  return Object.values(acc)
    .map(r => ({
      ...r,
      label: punchLabel(r.move),
      total: r.both + r.onlyA + r.onlyB,
      pct: r.both ? Math.round((r.agreed / r.both) * 100) : null,
      iou: iouStats(r.ious),
    }))
    .sort((x, y) => y.total - x.total || x.label.localeCompare(y.label));
}

// Which round a moment falls in — index, or -1 for outside every round.
function roundIndexAt(t, spans) {
  for (let i = 0; i < spans.length; i++) {
    if (t >= spans[i].start && t <= spans[i].end) return i;
  }
  return -1;
}

// The same comparison, sliced per round. Rounds are the unit the pipeline
// actually consumes, and agreement is rarely uniform across them — the
// round where someone was still finding their feet is the one worth
// re-watching, and an average over the whole video buries it.
function perRoundBreakdown(pairs, onlyA, onlyB) {
  const spans = roundSpans();
  if (!spans.length) return [];
  const bucket = new Map();
  const slot = (i) => {
    if (!bucket.has(i)) bucket.set(i, { pairs: [], onlyA: [], onlyB: [] });
    return bucket.get(i);
  };
  // A matched pair is placed by the midpoint of the two starts, so a pair
  // straddling a boundary lands on one side rather than being dropped.
  pairs.forEach(p => slot(roundIndexAt((p.a.start + p.b.start) / 2, spans)).pairs.push(p));
  onlyA.forEach(l => slot(roundIndexAt(l.start, spans)).onlyA.push(l));
  onlyB.forEach(l => slot(roundIndexAt(l.start, spans)).onlyB.push(l));

  const out = [];
  for (let i = 0; i < spans.length; i++) {
    const b = bucket.get(i);
    if (!b) continue;
    out.push({ name: 'Round ' + (i + 1), outside: false, ...pairStats(b.pairs, b.onlyA, b.onlyB) });
  }
  const o = bucket.get(-1);
  // Punches outside every round are the ones the pipeline discards, so they
  // get their own row rather than being folded into a round they aren't in.
  if (o) out.push({ name: 'Outside rounds', outside: true, ...pairStats(o.pairs, o.onlyA, o.onlyB) });
  return out;
}

function computeAgreement() {
  const byOwner = new Map();
  for (const l of state.labels) {
    if (l.isRoundMarker) continue;
    const who = l.foreign ? foreignOwnerName(l) : (labelerId() || 'You');
    if (!byOwner.has(who)) byOwner.set(who, []);
    byOwner.get(who).push(l);
  }
  const names = [...byOwner.keys()].sort();
  const rows = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const A = byOwner.get(names[i]), B = byOwner.get(names[j]);
      const m = matchPunchSets(A, B);
      rows.push({
        a: names[i], b: names[j],
        aCount: A.length, bCount: B.length,
        ...pairStats(m.pairs, m.onlyA, m.onlyB),
        perMove: perMoveBreakdown(m.pairs, m.onlyA, m.onlyB),
        perRound: perRoundBreakdown(m.pairs, m.onlyA, m.onlyB),
        // Every move pair they disagreed on, commonest first — this is the
        // part that tells you WHICH distinction the taxonomy is failing.
        confusions: (() => {
          const c = {};
          m.pairs.filter(p => p.a.punch !== p.b.punch).forEach(p => {
            const k = [punchLabel(p.a.punch), punchLabel(p.b.punch)].join(' ↔ ');
            c[k] = (c[k] || 0) + 1;
          });
          return Object.entries(c).sort((x, y) => y[1] - x[1]);
        })(),
      });
    }
  }
  return { names, counts: names.map(n => byOwner.get(n).length), rows };
}

// ============================================================
// "Another admin is here" — presence heartbeat
// ============================================================
// Admin writes into OTHER people's sheets, so two admins are real
// concurrent writers on one sheet. The server-side lock (withPunchWriteLock
// in apps_script/Code.js) makes that SAFE — no more edits landing on the
// wrong row — but it cannot make it sensible: two people correcting the
// same video still overwrite each other's judgement calls without knowing.
// So say so, once, as soon as we know.
//
// Per TAB, not per browser: two admin tabs really are two writers, and
// sessionStorage is scoped exactly that way.
const ADMIN_PING_MS = 30000;
function adminClientId() {
  let id = null;
  try { id = sessionStorage.getItem('adminClientId'); } catch (e) {}
  if (!id) {
    id = 'a' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem('adminClientId', id); } catch (e) {}
  }
  return id;
}

let _adminSeen = 0;   // how many others we've already told them about
async function adminPing() {
  if (!state.isAdmin || !state.scriptUrl) return;
  try {
    const res = await fetchJson(sheetUrl({
      action: 'adminPing', client: adminClientId(), who: labelerId() || 'Admin',
    }), 15000);
    const others = (res && res.others) || [];
    updateAdminPresenceChip(others.length);
    // Announce only when the number GOES UP — a standing warning re-shown
    // every 30 seconds would be the thing people learn to dismiss blind.
    if (others.length > _adminSeen) showAdminPresenceDialog(others.length);
    _adminSeen = others.length;
  } catch (e) {
    // A missed heartbeat is not worth a word to the user; the next one
    // covers it, and admin work is not blocked by not knowing.
  }
}

function updateAdminPresenceChip(n) {
  const chip = document.getElementById('admin-presence');
  if (!chip) return;
  chip.hidden = !n;
  chip.textContent = n === 1 ? '1 other admin' : n + ' other admins';
}

function showAdminPresenceDialog(n) {
  const dlg = document.getElementById('adm-dialog');
  const body = document.getElementById('adm-body');
  if (!dlg || !body) return;
  body.innerHTML = `
    <p class="adm-lead">${n === 1
      ? 'Someone else is in admin mode right now.'
      : n + ' other people are in admin mode right now.'}</p>
    <p class="adm-note">Your edits are safe — saves are serialised, so nothing
      can land on the wrong label. But if you both correct the same punch, the
      later save wins and neither of you is told. Worth agreeing who takes
      which video.</p>`;
  if (!dlg.open) dlg.showModal();
}

function setupAdminPresence() {
  if (!state.isAdmin) return;
  adminPing();
  setInterval(adminPing, ADMIN_PING_MS);
  const dlg = document.getElementById('adm-dialog');
  document.getElementById('adm-close')?.addEventListener('click', () => dlg.close());
  dlg?.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

function setupAgreement() {
  const btn = document.getElementById('btn-agreement');
  const dlg = document.getElementById('agr-dialog');
  if (!btn || !dlg) return;
  btn.hidden = !state.isAdmin;      // review instrument, not a labelling one
  btn.addEventListener('click', () => { renderAgreement(); dlg.showModal(); });
  document.getElementById('agr-close')?.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

function renderAgreement() {
  const body = document.getElementById('agr-body');
  if (!body) return;
  const { names, counts, rows } = computeAgreement();

  if (rows.length === 0) {
    body.innerHTML = `<p class="agr-empty">${names.length < 2
      ? 'Only one labeler has punches on this video — nothing to compare yet.'
      : 'No punches on this video yet.'}</p>`;
    return;
  }

  // Which way the timing leans, in words — a signed number alone makes you
  // re-derive who "+" refers to every time. Silent when it's negligible.
  const offsetLine = (r) => {
    if (r.offsetMs === null || Math.abs(r.offsetMs) < 10) return '';
    return `${r.offsetMs > 0 ? r.a : r.b} marks ${Math.abs(r.offsetMs)} ms later`;
  };

  // Every explanation lives in a tooltip rather than on screen. The panel is
  // read repeatedly by the same person; prose they have already read is
  // just something to look past to reach the numbers.
  const cell = (value, label, hint, cls) =>
    `<div${cls ? ` class="${cls}"` : ''} title="${hint}"><b>${value}</b><span>${label}</span></div>`;
  const num = (v) => (v === null || v === undefined ? '—' : v);
  const iouCols = (s) => s
    ? `<td>${s.mean}</td><td>${s.median}</td><td class="agr-range">${s.min}–${s.max}</td>`
    : '<td>—</td><td>—</td><td class="agr-range">—</td>';

  body.innerHTML = rows.map(r => `
    <section class="agr-pair">
      <header class="agr-pair-head">
        <span class="agr-who" style="--who: ${labelerColor(r.a)}">${r.a} <b>${r.aCount}</b></span>
        <span class="agr-vs">vs</span>
        <span class="agr-who" style="--who: ${labelerColor(r.b)}">${r.b} <b>${r.bCount}</b></span>
        ${offsetLine(r) ? `<span class="agr-offset">${offsetLine(r)}</span>` : ''}
      </header>

      <div class="agr-stats">
        ${cell(r.matched, 'both found', `Punches both marked — paired when they overlap by at least ${Math.round(AGREE_IOU_FLOOR * 100)}%.`)}
        ${cell(r.typePct === null ? '—' : r.typePct + '%', 'agree on move', 'Of the punches both found, how often they called it the same move.')}
        ${cell(r.iou ? r.iou.mean : '—', 'mean IoU',
               'Timing overlap: intersection ÷ union. 1.0 = identical timing. Averaged over pairs they agreed the move of.')}
        ${cell(r.iou ? r.iou.median : '—', 'median IoU', 'The middle overlap — less swayed by one bad pair than the mean.')}
        ${cell(r.kappa === null ? 'n/a' : r.kappa, 'κ',
               r.kappa === null
                 ? 'Cohen\'s kappa is undefined here — only one move in common, so chance already explains all of it.'
                 : `Cohen's kappa — agreement on the move corrected for chance (${r.kappaBand.word}). A plain percentage flatters a video that is mostly jabs.`,
               'agr-k agr-tone-' + r.kappaBand.tone)}
        ${cell(r.solo, 'caught by one', `Punches exactly one of them marked: ${r.onlyA} only ${r.a}, ${r.onlyB} only ${r.b}.`,
               'agr-solo')}
      </div>

      ${r.perMove.length ? `
        <h3 class="agr-h">By move</h3>
        <table class="agr-table">
          <thead><tr>
            <th>Move</th>
            <th title="Marked by both, whether or not they agreed what it was">Both</th>
            <th title="Both called it this move">Agreed</th>
            <th colspan="3" class="agr-grp" title="Timing overlap across the pairs they agreed on">IoU</th>
            <th title="Marked by ${r.a} alone">${r.a}</th>
            <th title="Marked by ${r.b} alone">${r.b}</th>
          </tr><tr class="agr-sub">
            <th></th><th></th><th></th>
            <th>avg</th><th>med</th><th>min–max</th>
            <th class="agr-solo-h" colspan="2">caught alone</th>
          </tr></thead>
          <tbody>${r.perMove.map(m => `
            <tr class="${m.pct !== null && m.pct < 60 ? 'agr-weak' : ''}">
              <td><span class="agr-swatch" style="background:${getPunchColor(m.move)}"></span>${m.label}</td>
              <td>${m.both}</td>
              <td>${m.agreed}${m.pct === null ? '' : ` <i>${m.pct}%</i>`}</td>
              ${iouCols(m.iou)}
              <td class="agr-solo-c">${m.onlyA || '·'}</td>
              <td class="agr-solo-c">${m.onlyB || '·'}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : ''}

      ${r.perRound.length ? `
        <h3 class="agr-h">By round</h3>
        <table class="agr-table">
          <thead><tr>
            <th>Round</th><th>Both</th><th>Agree</th><th>κ</th>
            <th colspan="3" class="agr-grp">IoU</th>
            <th>${r.a}</th><th>${r.b}</th>
          </tr><tr class="agr-sub">
            <th></th><th></th><th></th><th></th>
            <th>avg</th><th>med</th><th>min–max</th>
            <th class="agr-solo-h" colspan="2">caught alone</th>
          </tr></thead>
          <tbody>${r.perRound.map(q => `
            <tr class="${q.outside ? 'agr-outside' : ''}">
              <td>${q.name}</td>
              <td>${q.matched}</td>
              <td>${q.typePct === null ? '—' : q.typePct + '%'}</td>
              <td>${q.kappa === null ? '—' : q.kappa}</td>
              ${iouCols(q.iou)}
              <td class="agr-solo-c">${q.onlyA || '·'}</td>
              <td class="agr-solo-c">${q.onlyB || '·'}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : ''}

      ${r.confusions.length ? `
        <h3 class="agr-h">Confused with</h3>
        <ul class="agr-conf">${
          r.confusions.map(([k, n]) => `<li><span>${k}</span><b>${n}</b></li>`).join('')
        }</ul>` : ''}
    </section>`).join('');
}

// Clicking a row in the Labels panel lights that row AND its strip on the
// timeline — including on another labeler's lane, so "which of these is the
// one I'm reading" is answerable in both directions. Clicking the same row
// again clears it.
function highlightLabel(label) {
  state.highlightedLabel = state.highlightedLabel === label ? null : label;
  renderLabels();
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

  // Admin reviews and corrects; it does not author. A new row would have no
  // honest owner — admin has no labelling sheet of its own, and silently
  // filing it under whoever happens to have the most rows on this video
  // (which is what the old admin-add path did) attributes work to someone
  // who didn't do it. Editing and deleting anyone's row stays allowed.
  if (state.isAdmin) {
    showToast('Admin can edit and delete any label, but not create new ones.', 'error');
    return;
  }

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
    // The move is finished, so nothing in the catalogue is "current" any
    // more. Leaving it lit made the panel claim a pick that no longer
    // applied to anything, and the next label starts by choosing a type
    // anyway (mode 'start' → 'punch' → pick).
    state.selectedPunch = null;
    document.querySelectorAll('.punch-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('pending-label').textContent = '';
    updateTimestampButton();
    renderLabels();

    pushLabelToSheet(label).then(() => fetchLabelsFromSheet());
    showToast(`Labeled: ${punchLabel(label.punch)} (${formatTime(label.start)} - ${formatTime(label.end)})`, 'success');
  }
}

// ============================================================
// Outbox — labels survive a failed save
// ============================================================
// A label used to exist ONLY in state.labels until the sheet confirmed it.
// A failed save showed a toast and moved on, so a flaky connection plus a
// reload silently threw the work away — and nothing but preferences was
// ever written to localStorage. Now every label is queued on disk the
// instant it is created, BEFORE the request goes out, and only leaves the
// queue once the server has given it an id.
//
// Keyed by labeler + video so two people (or two tabs on two videos) can't
// drain each other's work.
const OUTBOX_PREFIX = 'punchOutbox:';
function outboxKey() {
  const video = normalizeDriveUrl(document.getElementById('drive-link')?.value.trim() || '');
  return OUTBOX_PREFIX + (labelerId() || '?') + ':' + video;
}
function outboxRead(key) {
  try { return JSON.parse(localStorage.getItem(key || outboxKey()) || '[]'); } catch (e) { return []; }
}
function outboxWrite(entries, key) {
  try { localStorage.setItem(key || outboxKey(), JSON.stringify(entries)); } catch (e) {}
}
// punch_uuid is the identity: it is generated client-side before the first
// send, so a retry can never create a second row for the same label.
function outboxAdd(payload) {
  const entries = outboxRead();
  if (entries.some(e => e.punchUuid === payload.punchUuid)) return;
  entries.push(payload);
  outboxWrite(entries);
  updateOutboxChip();
}
function outboxRemove(punchUuid) {
  outboxWrite(outboxRead().filter(e => e.punchUuid !== punchUuid));
  updateOutboxChip();
}

// Every queue belonging to THIS labeler, across every video. The chip and
// the drain both work over all of them: a label queued on video A while the
// sheet was down would otherwise sit there unnoticed and undelivered as
// soon as the labeler moved on to video B, which defeats the whole point.
function outboxKeysForLabeler() {
  const prefix = OUTBOX_PREFIX + (labelerId() || '?') + ':';
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
  } catch (e) {}
  return keys;
}

function updateOutboxChip() {
  const chip = document.getElementById('outbox-chip');
  if (!chip) return;
  const n = outboxKeysForLabeler().reduce((s, k) => s + outboxRead(k).length, 0);
  chip.hidden = n === 0;
  chip.textContent = n === 1 ? '1 unsaved' : n + ' unsaved';
}

// One attempt at one queued label. Returns true once the server owns it.
async function sendQueued(payload) {
  const result = await fetchJson(sheetUrl(payload.params), 30000);
  if (result.status === 'error') throw new Error(result.message || 'sheet error');
  return result;
}

let _draining = false;
// Retries everything still queued for this labeler+video. Called after each
// save, on page load, and whenever the browser says it is back online.
async function drainOutbox({ quiet = true } = {}) {
  if (_draining || !state.scriptUrl) return;
  const keys = outboxKeysForLabeler();
  if (!keys.some(k => outboxRead(k).length)) { updateOutboxChip(); return; }
  _draining = true;
  let stopped = false;
  try {
    // Across every video this labeler has pending work for, not just the one
    // currently open — see outboxKeysForLabeler().
    for (const key of keys) {
      if (stopped) break;
      for (const entry of outboxRead(key)) {
        try {
          const result = await sendQueued(entry);
          // Adopt the server's id/uuid onto the in-memory label if it's still
          // on screen, so a later edit targets the right row.
          const live = state.labels.find(l => l.punch_uuid === entry.punchUuid);
          if (live) {
            if (result.id != null) live.id = result.id;
            if (result.punch_uuid) live.punch_uuid = result.punch_uuid;
          }
          outboxWrite(outboxRead(key).filter(e => e.punchUuid !== entry.punchUuid), key);
        } catch (e) {
          // Stop on the first failure — the rest are almost certainly going
          // to fail the same way, and hammering a slow Apps Script makes it
          // worse. Everything still queued stays queued.
          if (!quiet) showToast('Still cannot reach the sheet — your labels are saved locally.', 'error');
          stopped = true;
          break;
        }
      }
      // Drop the key once its queue is empty, so localStorage doesn't
      // accumulate one entry per video ever labelled.
      if (!outboxRead(key).length) { try { localStorage.removeItem(key); } catch (e) {} }
    }
  } finally {
    _draining = false;
    updateOutboxChip();
    renderLabels();
  }
}

async function pushLabelToSheet(label) {
  if (!state.scriptUrl) return;
  const punch = PUNCH_TYPES.find(p => p.id === label.punch);
  const params = {
    action: 'add',
    videoName: label.videoName,
    trainingType: document.getElementById('training-type').value,
    stance: document.getElementById('stance-select').value,
    punchId: punch.id,
    punchUuid: label.punch_uuid || '',
    angle: label.angle || '',
    startTime: formatTimeSheet(label.start),
    endTime: formatTimeSheet(label.end),
  };
  // Queued FIRST. If the tab dies between here and the response, the label
  // is still on disk and the next load will send it.
  outboxAdd({ punchUuid: label.punch_uuid, params });
  try {
    const result = await sendQueued({ params });
    if (result.id != null) label.id = result.id;
    // Server may have stamped its own UUID if our client-generated one was
    // missing (older builds). Adopt whatever the server persisted.
    if (result.punch_uuid) label.punch_uuid = result.punch_uuid;
    outboxRemove(params.punchUuid);
  } catch (e) {
    console.error('Sheet push failed:', e);
    showToast('Sheet is unreachable — label saved locally, will retry.', 'error');
    updateOutboxChip();
  }
}

function addRoundMarker(markerType) {
  // Same rule as captureTimestamp(): admin corrects, it does not author.
  if (state.isAdmin) {
    showToast('Admin can edit and delete any label, but not create new ones.', 'error');
    return;
  }
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

// Same outbox as pushLabelToSheet — a round boundary is as expensive to
// re-find as a punch, and the old version dropped it on any failure.
async function pushRoundMarkerToSheet(label) {
  if (!state.scriptUrl) return;
  const time = formatTimeSheet(label.start);
  const params = {
    action: 'add',
    videoName: label.videoName,
    trainingType: document.getElementById('training-type').value,
    stance: document.getElementById('stance-select').value,
    punchId: label.punch,
    punchUuid: label.punch_uuid || '',
    angle: '',
    startTime: time,
    endTime: time,
  };
  outboxAdd({ punchUuid: label.punch_uuid, params });
  try {
    const result = await sendQueued({ params });
    if (result.id != null) label.id = result.id;
    if (result.punch_uuid) label.punch_uuid = result.punch_uuid;
    outboxRemove(params.punchUuid);
    showToast(`${label.punch} saved at ${formatTime(label.start)}`, 'success');
    fetchLabelsFromSheet();
  } catch (e) {
    console.error('Round marker push failed:', e);
    showToast('Sheet is unreachable — round marker saved locally, will retry.', 'error');
    updateOutboxChip();
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

// One click on top of text that is already selectable on screen — the link
// row's <input> and the video row's file name both use this. Clipboard API
// needs a secure context (https, or localhost); the textarea + execCommand
// dance is the fallback for a plain http:// preview, and works for a plain
// string where input.select() would not.
//
// Exposed on window because ui.js (which owns the video row's wiring, and
// loads after this file) calls it too.
async function copyTextToClipboard(text, btn, what) {
  text = String(text || '').trim();
  if (!text) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      // Off-screen but focusable — a display:none node cannot be selected.
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    btn.classList.add('copied');
    const prevTitle = btn.title;
    btn.title = 'Copied!';
    setTimeout(() => { btn.classList.remove('copied'); btn.title = prevTitle; }, 1200);
  } catch (e) {
    showToast(`Copy failed — select the ${what || 'text'} and copy manually`, 'error');
  }
}
window.copyTextToClipboard = copyTextToClipboard;

function copyDriveLink(input, btn) {
  return copyTextToClipboard(input.value, btn, 'link');
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
  const visible = state.labels.filter(l => !l.isRoundMarker && !shouldHideByTab(l));
  count.textContent = `(${visible.length})`;

  // How many of those the pipeline would throw away — see isOutsideRound().
  const warn = document.getElementById('outside-round-warning');
  if (warn) {
    const n = visible.filter(isOutsideRound).length;
    warn.hidden = n === 0;
    warn.textContent = n === 1 ? '1 outside a round' : `${n} outside rounds`;
  }

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
        // The pencil is REQUIRED here, not decoration: clicking the row now
        // only highlights, so without it a round boundary could be deleted
        // and re-added but never retimed.
        entry.innerHTML = `
          <span class="label-text">
            <small>#${label.id || '...'}</small> <strong>${icon} ${text}</strong>
            <small>${formatTime(label.start)}${label.foreign ? ' &middot; ' + who : ''}</small>
          </span>
          <button class="label-edit" onclick="event.stopPropagation(); openEditRoundMarker(${idx})" title="Edit the time" aria-label="Edit"><svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9.1 2.4 11.6 4.9M2.2 11.8l.5-2.2 6.1-6.1 2.5 2.5-6.1 6.1-2.2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></button>
          <button class="label-delete" onclick="event.stopPropagation(); deleteLabel(${idx})" title="Delete">&times;</button>
        `;
        entry.querySelector('.label-text').style.cursor = 'pointer';
        entry.querySelector('.label-text').onclick = () => {
          highlightLabel(label);
          document.getElementById('video-player').currentTime = label.start;
        };
      }
    } else if (label.foreign && !state.isAdmin) {
      // Read-only, same treatment as a foreign round marker: no edit pencil,
      // no delete — this row belongs to another labeler's sheet and
      // isForeignLabel()/refuseForeign() would refuse the mutation anyway.
      const who = foreignOwnerName(label);
      entry.className = 'label-entry label-foreign';
      entry.style.borderLeftColor = getPunchColor(label.punch);
      // Whose row this is gets its own badge, in that labeler's colour and
      // on the same line as the move — it used to be dim grey text tacked
      // onto the end of the timestamps, which is where you look last. The
      // colour matches their timeline lane, so the two read together.
      entry.innerHTML = `
        <span class="label-text">
          <span class="label-head">
            <strong>${punchLabel(label.punch)}</strong>
            <span class="who-badge" style="--who: ${labelerColor(who)}">${who}</span>
          </span>
          <small>${formatTime(label.start)} &rarr; ${formatTime(label.end)}</small>
        </span>
      `;
      entry.querySelector('.label-text').style.cursor = 'pointer';
      entry.querySelector('.label-text').onclick = () => {
        highlightLabel(label);
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
          <span class="label-head">
            <strong>${punchLabel(label.punch)}</strong>
            ${who ? `<span class="who-badge" style="--who: ${labelerColor(who)}">${who}</span>` : ''}
          </span>
          <small>${formatTime(label.start)} &rarr; ${formatTime(label.end)}</small>
        </span>
        <button class="label-edit" onclick="event.stopPropagation(); openEditLabel(${idx})" title="Edit type and times" aria-label="Edit"><svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9.1 2.4 11.6 4.9M2.2 11.8l.5-2.2 6.1-6.1 2.5 2.5-6.1 6.1-2.2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></button>
        <button class="label-delete" onclick="event.stopPropagation(); deleteLabel(${idx})" title="Delete">&times;</button>
      `;
      entry.querySelector('.label-text').style.cursor = 'pointer';
      // Highlight and seek — NOT open the editor. Clicking a row is how you
      // find a punch on the timeline, which is a thing you do constantly
      // while scanning; opening an edit form every time you looked at one
      // meant half the list was a form you then had to dismiss. The pencil
      // is the way in to editing, and it is right there on the row.
      entry.querySelector('.label-text').onclick = () => {
        highlightLabel(label);
        document.getElementById('video-player').currentTime = label.start;
      };
    }

    if (label === state.highlightedLabel) entry.classList.add('label-selected');
    // Flagged, not blocked: a punch outside every round is one the pipeline
    // throws away, and the labeler is the only one who can decide whether
    // the punch is wrong or the round boundary is.
    if (isOutsideRound(label)) {
      entry.classList.add('label-outside');
      entry.title = 'Outside every round — the training pipeline discards this. '
                  + 'Move it, or fix the round boundary.';
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
    // Who is REALLY making this change. Without it the write is
    // indistinguishable from the owner editing their own row, since
    // `labeler` has just been rewritten to them. The server appends it to
    // the Admin Actions tab — see logAdminAction() in apps_script/Code.js.
    params.actor = labelerId();
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
    // Who is REALLY making this change. Without it the write is
    // indistinguishable from the owner editing their own row, since
    // `labeler` has just been rewritten to them. The server appends it to
    // the Admin Actions tab — see logAdminAction() in apps_script/Code.js.
    params.actor = labelerId();
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
// The rounds this video is currently showing, as [start, end) spans. One
// definition, used by the ribbon, the "outside round" shading and the
// warning below — these each used to re-derive it, and had already drifted
// once over whether a hidden labeler's boundaries still count (they don't).
// An unclosed round runs to Infinity; callers that need to draw it clamp to
// the duration.
function roundSpans() {
  const times = (which) => state.labels
    .filter(l => (l.punch === 'round_' + which || (l.isRoundMarker && l.punch?.includes?.(which)))
              && !isLabelerHidden(l))
    .map(l => l.start)
    .sort((a, b) => a - b);
  const starts = times('start'), ends = times('end');
  return starts.map(s => {
    const e = ends.find(x => x > s);
    return { start: s, end: e !== undefined ? e : Infinity };
  });
}

// A punch thrown outside every round is one the training pipeline DISCARDS.
// The timeline has always hatched those stretches, but nothing said so at
// the moment you logged one — so a labeler could spend a session on punches
// that never reach the model. Returns false when no rounds are marked at
// all: with nothing to be outside of, warning would be noise.
function isOutsideRound(label) {
  if (!label || label.isRoundMarker) return false;
  const spans = roundSpans();
  if (!spans.length) return false;
  return !spans.some(r => label.start >= r.start && label.start <= r.end);
}

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

// Rebuilds the lane stack: an Offense/Defense pair for YOU, then one pair
// per visible teammate, each tagged with their colour. Two people marking
// the same second used to land on the same two rows and cover each other;
// now every labeler owns their own rows and overlap is impossible.
// Returns a Map keyed "<owner>|<bucket>" ('' owner = yours) so the strip
// loop can route each label without re-querying the DOM.
function buildSegLanes(container, markersLayer, overlay) {
  if (!container) return null;
  const owners = visibleForeignOwners();
  // Detach before clearing: the rounds ribbon and the playhead are children
  // of this container and innerHTML='' would take them with the lanes.
  const playhead = document.getElementById('playhead');
  if (markersLayer && markersLayer.parentNode === container) markersLayer.remove();
  if (playhead && playhead.parentNode === container) playhead.remove();
  container.innerHTML = '';
  // Rounds ribbon first — it reads as a header over the lanes it spans.
  if (markersLayer) container.appendChild(markersLayer);

  const lanes = new Map();
  const addPair = (owner) => {
    for (const bucket of ['offense', 'defense']) {
      const lane = document.createElement('div');
      lane.className = 'seg-lane' + (owner ? ' lane-foreign' : ' lane-own');
      lane.dataset.bucket = bucket;
      const bucketName = bucket === 'offense' ? 'Offense' : 'Defense';
      if (owner) {
        lane.dataset.owner = owner;
        lane.style.setProperty('--lane-tint', labelerColor(owner));
        lane.dataset.laneLabel = owner + ' · ' + bucketName;
        lane.setAttribute('aria-label', owner + ' ' + bucketName);
      } else {
        // "You" only earns its place once somebody else has a lane too —
        // on a video only you have labeled it would be noise.
        lane.dataset.laneLabel = owners.length ? 'You · ' + bucketName : bucketName;
        lane.setAttribute('aria-label', bucketName);
      }
      container.appendChild(lane);
      lanes.set((owner || '') + '|' + bucket, lane);
    }
  };
  addPair(null);
  owners.forEach(addPair);
  // Playhead last so it sits over every lane.
  if (playhead) container.appendChild(playhead);
  return lanes;
}

// Where the playhead is, over the lane stack. A dark core between two light
// halves, so it stays legible whether it crosses an empty lane or a
// saturated strip — over a bright punch the old scrub thumb was simply
// lost. Hidden when the current time is outside the zoomed viewport, since
// a line pinned to the edge would claim a position that isn't shown.
function updatePlayhead() {
  const ph = document.getElementById('playhead');
  const video = document.getElementById('video-player');
  if (!ph || !video) return;
  const d = video.duration;
  if (!d || d <= 0) { ph.hidden = true; return; }
  const pct = timeToViewportPct(video.currentTime, d);
  if (pct < -0.5 || pct > 100.5) { ph.hidden = true; return; }
  ph.hidden = false;
  ph.style.left = Math.max(0, Math.min(100, pct)) + '%';
}

// Rounds as spans, in the ribbon above the lanes — see the call site for
// why they are no longer vertical rules. `rounds` is already paired and
// already excludes hidden labelers.
function renderRoundStrip(markersLayer, markersScrub, rounds, duration, video) {
  const seek = (t) => (e) => {
    // Same reason the old flags did this: #seek-bar-wrapper has its own
    // click-to-seek, and letting the click through would re-seek from the
    // pointer's pixel rather than the exact boundary.
    e.stopPropagation();
    video.currentTime = t;
  };

  if (markersLayer) {
    rounds.forEach((r, i) => {
      const l = timeToViewportPct(r.start, duration);
      const rt = timeToViewportPct(r.end, duration);
      if (rt < 0 || l > 100) return;
      const span = document.createElement('div');
      span.className = 'round-span';
      span.style.left = Math.max(0, l) + '%';
      span.style.width = Math.max(Math.min(100, rt) - Math.max(0, l), 0.4) + '%';
      span.title = `Round ${i + 1} — ${formatTime(r.start)} → ${formatTime(r.end)}`;
      span.innerHTML = `<span class="round-span-label">Round ${i + 1}</span>`;
      span.addEventListener('click', seek(r.start));
      markersLayer.appendChild(span);
    });
  }

  // The scrub track is 8px tall — no room for a labelled span, so rounds
  // stay as boundary ticks there. Short bottom-anchored stubs, not
  // full-height rules, so they can't be mistaken for the playhead either.
  if (markersScrub) {
    rounds.forEach((r, i) => {
      [['start', r.start], ['end', r.end]].forEach(([kind, t]) => {
        const tick = document.createElement('div');
        tick.className = 'round-tick rt-' + kind;
        tick.style.left = timeToScrubPct(t, duration) + '%';
        tick.title = `Round ${i + 1} ${kind} — ${formatTime(t)}`;
        tick.addEventListener('click', seek(t));
        markersScrub.appendChild(tick);
      });
    });
  }
}

function renderTimelineOverlay() {
  const overlay = document.getElementById('seek-bar-overlay');
  // Round-boundary flags are TWO layers, not one: #round-markers sits inside
  // #seg-lanes and zooms with it; #round-markers-scrub sits inside #scrub and
  // stays fixed to the always-full-range track. Same data, two coordinate
  // systems — see the timeToScrubPct() comment above.
  const markersLayer = document.getElementById('round-markers');
  const markersScrub = document.getElementById('round-markers-scrub');
  const video = document.getElementById('video-player');
  const duration = video.duration;
  overlay.innerHTML = '';
  // Rebuilt every repaint, same as the strips themselves — which owners are
  // visible can change between two of them (a hide, a reorder, phase 2 of a
  // load landing).
  const laneMap = buildSegLanes(document.getElementById('seg-lanes'), markersLayer, overlay);
  if (markersLayer) markersLayer.innerHTML = '';
  if (markersScrub) markersScrub.innerHTML = '';
  if (!duration || duration <= 0) return;

  // One shared definition — see roundSpans(). An unclosed round comes back
  // as Infinity; on screen it runs to the end of the video.
  const rounds = roundSpans().map(r => ({
    start: r.start,
    end: Number.isFinite(r.end) ? r.end : duration,
  }));

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

  // Rounds. Drawn as SPANS in their own ribbon above the lanes, not as
  // full-height rules through them: as vertical lines with a dot on top,
  // a round boundary was the same shape as a playhead, and the two were
  // being read for each other. A round is a stretch of time, so it now
  // looks like one — a labelled bar from its start to its end, with the
  // boundaries as its bracket ends.
  // The scrub track underneath keeps thin boundary ticks (it is only 8px
  // tall — there is no room for a labelled span there), but they are
  // bottom-anchored stubs now rather than a full-height line.
  renderRoundStrip(markersLayer, markersScrub, rounds, duration, video);

  updatePlayhead();

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
    seg.className = 'seek-segment'
      + (label.foreign && !state.isAdmin ? ' seg-foreign' : '')
      + (label === state.highlightedLabel ? ' seg-selected' : '');
    seg.dataset.labelIdx = idx;
    // Clipped at the viewport edges for DRAWING, but the untruncated times go
    // on the element too: a strip half off-screen at high zoom still has to
    // drag from its real start, not from where the paint happened to begin.
    seg.style.left = Math.max(0, lPct) + '%';
    seg.style.width = Math.max(Math.min(100, rPct) - Math.max(0, lPct), 0.15) + '%';
    seg.style.backgroundColor = getPunchColor(label.punch);
    const punchDescText = punchDesc(label.punch);
    const moveTitle = punchDescText ? `${punchLabel(label.punch)} — ${punchDescText}` : punchLabel(label.punch);
    const owner = label.foreign ? foreignOwnerName(label) : '';
    if (owner) {
      seg.title = moveTitle + '\n' + (state.isAdmin ? owner : owner + ' (read-only)');
    } else {
      seg.title = moveTitle;
    }
    // Each labeler's own pair of rows — see buildSegLanes(). The fallback
    // covers a label whose owner has no lane (shouldn't happen, since the
    // visibility test above already ran, but a missing lane must not throw
    // and silently stop painting the rest of the timeline).
    const lane = laneMap && (laneMap.get(owner + '|' + punchBucket(label.punch))
                          || laneMap.get('|' + punchBucket(label.punch)));
    if (lane) lane.appendChild(seg);
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

  // player.js calls this on every timeupdate, which is the only hook that
  // fires often enough to keep the playhead with the picture. Cheap: one
  // style write, no DOM building.
  updatePlayhead();

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

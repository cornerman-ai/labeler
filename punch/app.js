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
  // Undo history for this labeler's own mutations — add/delete/edit/drag,
  // for both punch labels and round markers. See pushUndo()/performUndo().
  // Not persisted and not shared: it only ever holds entries for actions
  // taken in THIS tab this session.
  undoStack: [],
  // Ctrl+C/Ctrl+X target — {punch, angle, duration}, not a label object:
  // pasting makes a genuinely new label (own id, own punch_uuid), not a
  // second reference to the one that was copied. See copyHighlightedLabel().
  clipboardLabel: null,
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
  // Set when the labeler name field holds "Analyst" — strictly view-only,
  // see the DOMContentLoaded block below and isForeignLabel(). Unlike
  // isAdmin there is no bypass anywhere: every mutation is refused.
  isAnalyst: false,
  // Which bucket the Labels panel is showing.
  labelTab: 'offense',
  // Admin only: the punch types picked in the Labels panel's "Types" menu.
  // Empty = off. Narrows every surface the tabs do — see shouldHideByType().
  typeFilter: new Set(),
  // Separate from the above — the Agreement dialog's own "Moves" filter
  // (see setupAgreementTypeFilterMenu()). Empty = show everything, same
  // convention as typeFilter. Deliberately its own Set, not shared with the
  // Labels-panel filter: a labeler narrowing the timeline to Rolls has
  // nothing to do with an admin narrowing an Agreement export to Rolls, and
  // conflating them would mean opening Agreement quietly changes what the
  // labeler sees on the timeline underneath it.
  agreementTypeFilter: new Set(),
  // All-videos view only — narrows which videos get a section by John's /
  // Arianne's tracking-sheet labeling_version (see
  // setupAgreementVersionFilterMenu()). Empty = show every version. Values
  // are whatever's actually in the sheet ("v0", "v1", ...) plus the literal
  // string 'none' standing in for "no version recorded".
  // Defaults to v1/v1 — the report is most useful once both have actually
  // relabeled a video, and a video someone hasn't gotten to yet just adds
  // noise. Still just a starting point: clearing either filter (pick "All
  // versions") shows everything, same as before, and the choice sticks for
  // the rest of the session like every other Agreement filter does.
  agreementVersionFilterJohn: new Set(['v1']),
  agreementVersionFilterArianne: new Set(['v1']),
  // Which move-type groups (Offense/Defense/Other) are folded away — see
  // buildPunchButtons()'s header()/wireMoveGroupFold(). One level in from
  // the panel-wide Move Type fold (#move-type-toggle in index.html, wired
  // by ui.js's setupFold() — that one isn't state, just localStorage, since
  // nothing else in JS needs to know it). Read synchronously here (not in
  // the DOMContentLoaded restore block below, unlike typeFilter) because
  // buildPunchButtons() runs before that block does and needs the real
  // answer on its very first call, not the default.
  collapsedMoveGroups: new Set(JSON.parse(localStorage.getItem('collapsedMoveGroups') || '[]')),
  // 'agree' | 'disagree' | null — see shouldHideByAgreement(). Not
  // persisted: which labelers have weighed in on THIS video changes video
  // to video, and a stale filter surviving a load would just show an empty
  // timeline with nothing on screen to explain why.
  agreementFilter: null,
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
  setupVideoPicker();
  if (typeof setupVideoFolder === 'function') setupVideoFolder();
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
  // Strictly view-only: sees everyone's rows (same listForeign pull as
  // admin — see fetchLabelsFromSheet()'s phase 2), same as admin, but with
  // no escape hatch at all. isForeignLabel() refuses every mutation
  // unconditionally for this labeler (own rows included — there never are
  // any, since captureTimestamp()/addRoundMarker()/pasteLabelAtPlayhead()/
  // selectPunch() all refuse to start one), and the 'analyst-mode' body
  // class dims the authoring surfaces (punch.css) so a control that can
  // never do anything doesn't sit there looking clickable.
  if (labelerId().toLowerCase() === 'analyst') {
    state.isAnalyst = true;
    state.showForeign = true;
    document.body.classList.add('analyst-mode');
    const badge = document.getElementById('labeler-badge');
    if (badge) badge.textContent += ' (view only)';
  }
  // The Types menu — narrow the list/lanes/minimap/video tags to a few
  // punch types — used to be admin-only ("reviewing is where 'just the
  // slips' pays"), but there's nothing admin-specific about wanting to
  // narrow your OWN view to a few move types either, so it's for everyone
  // now.
  {
    const tf = document.getElementById('type-filter');
    if (tf) tf.hidden = false;
    try {
      // Only ids the catalogue still knows — a stale one could otherwise hide
      // every row with nothing in the menu to explain it.
      for (const id of JSON.parse(localStorage.getItem('typeFilter') || '[]')) {
        if (PUNCH_TYPES.some(p => p.id === id)) state.typeFilter.add(id);
      }
    } catch (e) {}
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
  updateTypeFilterButton();
  setupTypeFilterMenu();
  setupForeignVideoDialog();
  setupLoadingDialog();
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

// Wiring for the "what the sheet had" popup (maybeShowForeignVideoPopup
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
  // predictions.js's own per-model chips are a second door onto this exact
  // same toggle — keep them in sync when the OTHER door (the Others menu)
  // is the one that got used.
  if (typeof renderPredictionsList === 'function') renderPredictionsList();
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

// ============================================================
// Type filter
// ============================================================
// "Types: all" beside the Others menu — the same pop-up, one checkmark row
// per catalogue entry. Pick rows and every surface narrows to those types:
// the list, the lanes (whole buckets drop out, as with the tabs), the
// minimap, the tags over the video and Shift+Arrow nav. A slip review is
// then two clicks (Lead Slip, Rear Slip) instead of a scroll past every jab
// from every labeler. Composes with the Offense/Defense tabs (AND) rather
// than replacing them — a tab click just switches buckets, picks stay put —
// so picking a defense-only type while on Offense empties the list rather
// than silently overriding the tab; switching tabs is the way out.
// Persisted like the other filters.
function shouldHideByType(label) {
  if (label.isRoundMarker) return false;
  if (state.typeFilter.size === 0) return false;
  return !state.typeFilter.has(label.punch);
}

function toggleTypeFilter(punchId) {
  if (!state.typeFilter.delete(punchId)) state.typeFilter.add(punchId);
  applyTypeFilter();
}

// Persist, repaint the button and the dimmed tabs, then re-render everything
// the filter reaches. renderLabels() redraws the lanes and the minimap too;
// the video tags are cached on their own key, hence the extra call (the key
// carries the filter — see updateVideoOverlay()).
function applyTypeFilter() {
  localStorage.setItem('typeFilter', JSON.stringify([...state.typeFilter]));
  updateTypeFilterButton();
  updateLabelTabButtons();
  renderLabels();
  updateVideoOverlay();
}

function updateTypeFilterButton() {
  const label = document.getElementById('type-filter-label');
  const btn = document.getElementById('btn-type-filter');
  if (!label || !btn) return;
  const n = state.typeFilter.size;
  label.textContent = n ? `Types: ${n}` : 'Types: all';
  btn.classList.toggle('on', n > 0);
}

// Same open/close pattern as setupForeignFilterMenu() above; rebuilt on
// every open so the per-type counts track the rows currently loaded.
function setupTypeFilterMenu() {
  const btn = document.getElementById('btn-type-filter');
  const menu = document.getElementById('type-filter-menu');
  if (!btn || !menu) return;

  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open = () => {
    renderTypeFilterMenu(menu);
    // Shown, then measured, then placed — same order as the right-click menu
    // in ui.js. position:fixed and placed by hand (unlike the Others menu,
    // which just hangs off its button) because at two columns this one is
    // wider than the panel, and #label-panel's overflow:hidden would clip
    // whatever hung past the panel's left edge. Capped to the room below so
    // the bottom rows scroll instead of running off a short screen.
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';
    menu.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 18) + 'px';
    btn.setAttribute('aria-expanded', 'true');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? open() : close();
  });
  document.addEventListener('click', (e) => {
    // composedPath(), not menu.contains(e.target): a row click re-renders
    // the menu, so by the time this runs the clicked row is no longer in
    // it, and contains() would close the menu after every single pick.
    if (!menu.hidden && !e.composedPath().includes(menu) && e.target !== btn) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) close();
  });
}

// Reading order of the Move Type panel itself: each move's Head cell next
// to its Body cell (Jab, Cross, Lead Hook, Rear Hook, Lead Uppercut, Rear
// Uppercut), then Defense, then Unsure. PUNCH_TYPES is NOT in this order —
// it groups all Head ids before all Body ids, which is what the keyboard
// digit-key layout wants (1-6 plain vs Shift+1-6) — so the Types menu below
// remaps through this list rather than iterating PUNCH_TYPES directly.
const TYPE_MENU_ORDER = [
  'jab_head', 'jab_body',
  'cross_head', 'cross_body',
  'lead_hook_head', 'lead_hook_body',
  'rear_hook_head', 'rear_hook_body',
  'lead_uppercut_head', 'lead_uppercut_body',
  'rear_uppercut_head', 'rear_uppercut_body',
  'lead_slip', 'rear_slip',
  'lead_roll', 'rear_roll',
  'pull_back', 'duck',
  'unsure',
];

function renderTypeFilterMenu(menu) {
  // Rows on THIS video per type, counting what the Others menu currently
  // lets through — each number is how many rows that pick would leave on
  // screen, so it reads as a preview of the pick, not a video-wide total.
  const counts = {};
  for (const l of state.labels) {
    if (l.isRoundMarker) continue;
    if (l.foreign && (!state.showForeign || isLabelerHidden(l))) continue;
    counts[l.punch] = (counts[l.punch] || 0) + 1;
  }

  menu.innerHTML = '';

  const allRow = document.createElement('button');
  allRow.type = 'button';
  allRow.className = 'ffm-row';
  allRow.setAttribute('role', 'menuitemcheckbox');
  allRow.setAttribute('aria-checked', String(state.typeFilter.size === 0));
  allRow.innerHTML = '<span class="ffm-name">All types</span>';
  allRow.onclick = () => {
    if (state.typeFilter.size) { state.typeFilter.clear(); applyTypeFilter(); }
    renderTypeFilterMenu(menu);
  };
  menu.appendChild(allRow);

  const sep = document.createElement('div');
  sep.className = 'ffm-sep';
  menu.appendChild(sep);

  // Two across in TYPE_MENU_ORDER, so each move's Head cell sits beside its
  // own Body cell — the same pairing the Move Type panel itself lays out —
  // rather than every Head before every Body. One column of nineteen ran
  // off the bottom of a laptop screen.
  const grid = document.createElement('div');
  grid.className = 'tfm-grid';
  const orderedTypes = TYPE_MENU_ORDER
    .map(id => PUNCH_TYPES.find(p => p.id === id))
    .filter(p => p && !p.retired);
  for (const p of orderedTypes) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ffm-row';
    row.setAttribute('role', 'menuitemcheckbox');
    row.setAttribute('aria-checked', String(state.typeFilter.has(p.id)));
    row.title = punchLabel(p.id);
    row.innerHTML =
      `<span class="ffm-dot" style="--who: ${getPunchColor(p.id)}"></span>` +
      `<span class="ffm-name">${punchLabel(p.id)}</span>` +
      `<span class="ffm-count">${counts[p.id] || 0}</span>`;
    row.onclick = () => { toggleTypeFilter(p.id); renderTypeFilterMenu(menu); };
    grid.appendChild(row);
  }
  menu.appendChild(grid);
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
//
// `label.isPrediction` (see predictions.js) has NO such escape hatch — a
// model's row lives only in this tab's memory, was never on any sheet to
// begin with, and isForeignLabel() refuses it for admin same as anyone
// else. Checked first, so the admin bypass below never even gets asked.
function isForeignLabel(label) {
  if (!label) return false;
  // Analyst has no escape hatch anywhere, unlike admin's isAdmin bypass
  // below — every row it sees refuses a mutation, own rows included (there
  // never are any — see the DOMContentLoaded block that sets isAnalyst).
  if (state.isAnalyst) return true;
  if (label.isPrediction) return true;
  return !!label.foreign && !state.isAdmin;
}
function refuseForeign(label) {
  if (!isForeignLabel(label)) return false;
  showToast(state.isAnalyst
    ? 'View only — Analyst mode cannot edit, delete, or drag labels'
    : (label.isPrediction
      ? 'Read-only — this is a model prediction, not a label'
      : 'Read-only — added by another labeler'), 'error');
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
// show/hide list below. A prediction has no sheet at all — its "owner" is
// just the model name predictions.js stamped on it from the file name,
// shown plain (just "Rolly") — same as any labeler's name everywhere else.
function foreignOwnerName(label) {
  if (label && label.isPrediction) return label.predictionModel || 'model';
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
  '#c92a2a', '#5c940d', '#9c36b5',
];
// Position in the CURRENT set of foreign owners (real labelers + any loaded
// prediction models — foreignOwnersInOrder() covers both, same list the
// Others menu and every lane already iterate), not a hash of the name.
// A hash can and did collide — with only 8-11 tints and enough labelers,
// two different people landing on the same colour was a matter of when,
// not if, and a colour collision is exactly the thing this palette exists
// to prevent. Indexing into who's actually on screen right now guarantees
// no two of THEM share a tint (as long as there are <= LABELER_TINTS.length
// of them); reusing tints only becomes unavoidable past that count, same
// as it always was.
function labelerColor(name) {
  const owners = typeof foreignOwnersInOrder === 'function' ? foreignOwnersInOrder() : [];
  const idx = owners.indexOf(name);
  if (idx >= 0) return LABELER_TINTS[idx % LABELER_TINTS.length];
  // Not a current owner (called before the list is populated, or for a
  // name outside that set) — fall back to the old hash so there's still
  // SOME deterministic colour rather than none.
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

// Same offense/defense split the offline agreement reports use (see
// cornerman-backend's ml/research/defense/agreement_report), for the
// "already labeled" popup specifically -- NOT punchBucket() above, which
// intentionally folds unsure/retired/unrecognized into offense for the
// Labels-panel tabs and must keep doing that. Here we want the opposite:
// step_back (retired), unsure (not a move), and any id from an old naming
// scheme the current catalogue doesn't recognize (e.g. legacy
// lead_bodyshot/rear_bodyshot rows) all return null, so the popup's counts
// match what a report run against the same sheet would show.
function reportBucket(punchId) {
  const type = PUNCH_TYPES.find(p => p.id === punchId);
  if (!type || type.retired) return null;
  if (type.group === 'offense' || type.group === 'defense') return type.group;
  return null;
}

// The Labels-panel list's own filter — bucketed by tab. Kept separate from
// shouldHideByUnsure() on purpose: that one still governs the timeline's
// video-side surfaces (the tags over the video, jumpToAdjacentLabel) exactly
// as before. The tabs — or admin's picked types, while there are any —
// decide what the list shows; the Unsure-only filter is the one thing that
// decides what the video shows.
function shouldHideByTab(label) {
  // Round markers are exempt from the master "Others" switch — those have
  // always shown, as shared context — but an individually hidden labeler
  // (see isLabelerHidden) mutes them too.
  if (label.isRoundMarker) return isLabelerHidden(label);
  // Someone else's punch/defense row, folded away until "Others: shown" is
  // toggled on, or its owner is individually hidden.
  if (label.foreign && (!state.showForeign || isLabelerHidden(label))) return true;
  // Picked types AND the tab both narrow the view now — they compose
  // (AND), rather than the types replacing the tab entirely. "Lead Slip"
  // picked under the Offense tab shows an empty list, same as it would if
  // you'd typed a search that matched nothing; switching to Defense is
  // exactly the way out, not a picks-clearing reset.
  if (shouldHideByType(label)) return true;
  // Same composing treatment as Types — see shouldHideByAgreement().
  if (shouldHideByAgreement(label)) return true;
  // 'combined' skips the bucket check entirely — every punch shows, same as
  // before the tabs existed. 'offense'/'defense' still filter by bucket.
  if (state.labelTab !== 'combined' && punchBucket(label.punch) !== state.labelTab) return true;
  if (!state.unsureFilter) return false;
  return label.punch !== 'unsure';
}

// The "Agreement only" / "Disagreement only" timeline filter — a per-label
// yes/no so it can gate the list/lanes/minimap like any other filter. A
// label "agrees" if some OTHER owner has a label of the SAME punch type
// overlapping it at over 40% IoU, matched greedily best-first per pair of
// owners. Predictions count as an owner here too.
//
// This is the ONE definition of "matched"/"agreement" in the whole tool —
// pairLabelsByIoU() below is the single place that decides whether two
// labels correspond to each other, and everything that needs that answer
// (this timeline filter, and the admin Agreement report's matched/unmatched
// counts in computeAgreementPanel()) calls it rather than approximating its
// own. There used to be a second, weaker definition in the Agreement report
// (matched = min(countA, countB), no timing involved at all) — replaced;
// see computeAgreementPanel()'s own comment for that history.
const TIMELINE_AGREE_IOU_FLOOR = 0.4;

// Greedy best-match-first, one-to-one: every (a, b) pair from the two
// arrays with the SAME punch type and IoU over the floor is a candidate;
// taken highest-IoU-first, and once either index is used it's out of the
// running for anything lower. Returns the matched INDEX sets (into
// labelsA/labelsB respectively) — callers turn those into whatever they
// actually need (a Set of label objects, a matched count, ...).
function pairLabelsByIoU(labelsA, labelsB) {
  const cands = [];
  labelsA.forEach((a, ai) => labelsB.forEach((b, bi) => {
    if (a.punch !== b.punch) return;
    const iou = timeIoU(a, b);
    if (iou > TIMELINE_AGREE_IOU_FLOOR) cands.push({ ai, bi, iou });
  }));
  cands.sort((x, y) => y.iou - x.iou);
  const usedA = new Set(), usedB = new Set();
  for (const c of cands) {
    if (usedA.has(c.ai) || usedB.has(c.bi)) continue;
    usedA.add(c.ai); usedB.add(c.bi);
  }
  return { usedA, usedB };
}

function computeAgreedLabelSet() {
  const byOwner = new Map();
  for (const l of state.labels) {
    if (l.isRoundMarker) continue;
    const who = l.foreign ? foreignOwnerName(l) : (labelerId() || 'You');
    if (!byOwner.has(who)) byOwner.set(who, []);
    byOwner.get(who).push(l);
  }
  const names = [...byOwner.keys()];
  const agreed = new Set();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const A = byOwner.get(names[i]), B = byOwner.get(names[j]);
      const { usedA, usedB } = pairLabelsByIoU(A, B);
      usedA.forEach(ai => agreed.add(A[ai]));
      usedB.forEach(bi => agreed.add(B[bi]));
    }
  }
  return agreed;
}

// Recomputed at the top of renderLabels()/renderTimelineOverlay() — whichever
// runs first for a given render — rather than kept as a standing cache that
// something has to remember to invalidate. Cheap relative to a render, and
// this way it can never go stale and silently disagree with what's drawn.
function refreshAgreedLabelCache() {
  state._agreedLabels = state.agreementFilter ? computeAgreedLabelSet() : null;
}

function shouldHideByAgreement(label) {
  if (!state.agreementFilter) return false;
  const agreed = !!(state._agreedLabels && state._agreedLabels.has(label));
  return state.agreementFilter === 'agree' ? !agreed : agreed;
}

function setAgreementFilter(mode) {
  state.agreementFilter = state.agreementFilter === mode ? null : mode;
  updateAgreementFilterButtons();
  renderLabels();
}

function updateAgreementFilterButtons() {
  const agreeBtn = document.getElementById('btn-agree-only');
  const disagreeBtn = document.getElementById('btn-disagree-only');
  if (agreeBtn) agreeBtn.setAttribute('aria-pressed', String(state.agreementFilter === 'agree'));
  if (disagreeBtn) disagreeBtn.setAttribute('aria-pressed', String(state.agreementFilter === 'disagree'));
}

function setLabelTab(tab) {
  if (state.labelTab === tab) return;
  state.labelTab = tab;
  localStorage.setItem('labelTab', tab);
  // Picked types are left alone on purpose — see shouldHideByTab(). A tab
  // click now just changes which bucket the (possibly still-narrowed) list
  // shows, the same way it always did before any types were picked.
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

  // A real <button>, not a <div> — each group (Offense/Defense/Other) folds
  // independently now, one level in from the panel-wide Move Type fold (see
  // index.html's #move-type-toggle). Returns the button so the caller can
  // wire it to whichever grid follows it — see wireMoveGroupFold() below.
  const header = (text) => {
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'punch-group-header fold-toggle';
    h.innerHTML = `<svg class="fold-chev" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${text}</span>`;
    container.appendChild(h);
    return h;
  };

  // Wires one header button to the grid element right after it: applies the
  // remembered collapsed state on this (re)build, then toggles + persists
  // on click. `key` is 'offense'/'defense'/'other' — stable across a
  // language switch (buildPunchButtons() rebuilds from scratch on one) so
  // the fold survives it, unlike anything keyed off the button's own text.
  const wireMoveGroupFold = (btn, grid, key) => {
    const collapsed = state.collapsedMoveGroups.has(key);
    grid.hidden = collapsed;
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.addEventListener('click', () => {
      const nowCollapsed = !grid.hidden;
      grid.hidden = nowCollapsed;
      btn.setAttribute('aria-expanded', String(!nowCollapsed));
      if (nowCollapsed) state.collapsedMoveGroups.add(key);
      else state.collapsedMoveGroups.delete(key);
      localStorage.setItem('collapsedMoveGroups', JSON.stringify([...state.collapsedMoveGroups]));
    });
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
    const h = header('Offense');
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
    wireMoveGroupFold(h, grid, 'offense');
  }

  // --- Defense: two per row, lead beside rear ---------------------------
  const defense = live.filter(p => p.group === 'defense');
  if (defense.length) {
    const h = header('Defense');
    const grid = document.createElement('div');
    grid.className = 'pgrid2';
    defense.forEach(p => grid.appendChild(button(p, true)));
    container.appendChild(grid);
    wireMoveGroupFold(h, grid, 'defense');
  }

  // --- Anything else (currently just Unsure) ----------------------------
  const other = live.filter(p => p.group !== 'offense' && p.group !== 'defense');
  if (other.length) {
    const h = header('Other');
    const grid = document.createElement('div');
    grid.className = 'pgrid1';
    other.forEach(p => grid.appendChild(button(p, true)));
    container.appendChild(grid);
    wireMoveGroupFold(h, grid, 'other');
  }

  // A language switch rebuilds every button from scratch mid-selection
  // (mode 'punch', waiting on a type before the end time) — carry the
  // selected look over, since selectPunch() itself only runs once per pick.
  if (state.selectedPunch) {
    container.querySelectorAll('.punch-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.punchId === state.selectedPunch);
    });
  }
  // Fresh buttons start with no `disabled` attribute of their own —
  // updateMoveButtonsEnabled() normally keeps that in sync with the
  // workflow, but a rebuild (a language switch, mainly) needs its own
  // re-apply since the OLD buttons it's replacing are what that sync last
  // touched.
  updateMoveButtonsEnabled();
}

// A move type is meaningless to pick before a start time exists for it to
// attach to — clicking one used to just set state.selectedPunch and sit
// there, with nothing to show for it until Start Time was pressed anyway.
// Disabled instead, so that's obvious without having to click to find out.
// Reached from updateTimestampButton() (every workflow-step change) and
// from buildPunchButtons() itself (a rebuild has fresh buttons with no
// disabled attribute of their own yet).
function updateMoveButtonsEnabled() {
  const enabled = !state.labelsLoading && state.mode !== 'start';
  document.querySelectorAll('.punch-btn').forEach((btn) => { btn.disabled = !enabled; });
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

// Two-level: a family header (lead+rear/head+body folded together, just
// visually — "Rolls" groups Lead Roll and Rear Roll under one heading) over
// still-separate counts per EXACT type, and every owner on this video gets
// a line for every type shown, zeroes included — no more "Arianne just
// isn't in the list" when she simply hasn't thrown one. Deliberately just a
// count — no matching, no IoU, no agree/disagree comparison. That lives on
// the timeline's own Agreement/Disagreement filter (computeAgreedLabelSet(),
// above) instead; this report answers a simpler question.
const MOVE_FAMILIES = [
  { key: 'jab', label: 'Jabs', ids: ['jab_head', 'jab_body'] },
  { key: 'cross', label: 'Crosses', ids: ['cross_head', 'cross_body'] },
  { key: 'lead_hook', label: 'Lead Hooks', ids: ['lead_hook_head', 'lead_hook_body'] },
  { key: 'rear_hook', label: 'Rear Hooks', ids: ['rear_hook_head', 'rear_hook_body'] },
  { key: 'lead_uppercut', label: 'Lead Uppercuts', ids: ['lead_uppercut_head', 'lead_uppercut_body'] },
  { key: 'rear_uppercut', label: 'Rear Uppercuts', ids: ['rear_uppercut_head', 'rear_uppercut_body'] },
  { key: 'slip', label: 'Slips', ids: ['lead_slip', 'rear_slip'] },
  { key: 'roll', label: 'Rolls', ids: ['lead_roll', 'rear_roll'] },
  { key: 'pull_back', label: 'Pull Backs', ids: ['pull_back'] },
  { key: 'duck', label: 'Ducks', ids: ['duck'] },
  { key: 'unsure', label: 'Unsure', ids: ['unsure'] },
];

// `byOwnerOverride` (Map<owner, label[]>, each label a { punch, start, end })
// lets the all-videos view (fetchAllVideosBreakdown() below) feed real
// per-label times through the exact same family/type/pairing logic a single
// video uses, instead of duplicating it. Omitted — the normal case — it's
// built fresh from state.labels, i.e. whatever's loaded for the current
// video.
function computeAgreementPanel(byOwnerOverride) {
  // owner -> label[]. Real label objects (or the all-videos view's
  // { punch, start, end } stand-ins — see fetchAllVideosBreakdown()), not
  // pre-aggregated counts, because "matched" means real time-IoU pairing
  // now (pairLabelsByIoU(), same definition the timeline's Agreement/
  // Disagreement filter uses) — a plain count has nowhere to keep the
  // timing a real match needs. This used to take counts and approximate
  // "matched" as min(countA, countB) with no timing involved at all;
  // replaced so there is exactly one definition of "matched" in the tool.
  let byOwner = byOwnerOverride;
  if (!byOwner) {
    byOwner = new Map();
    for (const l of state.labels) {
      if (l.isRoundMarker) continue;
      const who = l.foreign ? foreignOwnerName(l) : (labelerId() || 'You');
      // The frozen Combined Data Archive rides in as a "foreign" row same as
      // any real labeler's (see mergeForeignPunchLabels()), and shows up on
      // the timeline that way on purpose — but Agreement is specifically
      // about comparing the actual TEAM against each other, and the archive
      // isn't a person. Same exclusion as allVideosPunchLabels() in Code.js
      // for the all-videos view; this is the single-video side of it.
      if (who === 'Combined Data Archive') continue;
      if (!byOwner.has(who)) byOwner.set(who, []);
      byOwner.get(who).push(l);
    }
  }
  const owners = [...byOwner.keys()].sort();
  if (!owners.length) return [];
  const labelsFor = (who, id) => (byOwner.get(who) || []).filter(l => l.punch === id);
  const countFor = (who, id) => labelsFor(who, id).length;

  // Admin's "Moves" filter on the Agreement dialog — see
  // setupAgreementTypeFilterMenu(). Empty = the unfiltered behaviour below
  // (every type in any family with data). Non-empty overrides that
  // entirely: a family only shows if one of its SELECTED types has data,
  // and only the selected types render — this is what lets "Rolls" split
  // into just Rear Roll on its own, without dragging Lead Roll along for
  // the ride the way the always-show-the-whole-family rule normally would.
  const filter = state.agreementTypeFilter;
  const idsToShow = (fam) => filter.size ? fam.ids.filter(id => filter.has(id)) : fam.ids;

  // A family shows up at all only if SOMEONE logged one of its (shown)
  // types — an all-zero family (nobody ever threw an uppercut) stays
  // hidden, same as before. Once a family IS showing, though, it shows
  // EVERY one of its shown types, not just the ones somebody happened to
  // use — a Lead Slip video with zero Rear Slips still shows a Rear Slip
  // row (all zeroes) rather than silently dropping it, since it's the same
  // family and the question "did they slip the other way at all" has an
  // answer either way.
  return MOVE_FAMILIES
    .map(fam => {
      const shownIds = idsToShow(fam);
      if (!shownIds.length) return null;
      const familyHasAny = shownIds.some(id => owners.some(who => countFor(who, id) > 0));
      if (!familyHasAny) return null;
      return {
        family: fam,
        types: shownIds.map(id => {
          const rows = owners.map(who => ({ who, count: countFor(who, id) }));
          // Real time-IoU matching (pairLabelsByIoU()) between this type's
          // two owners' labels — "how many of these actually overlap the
          // other person's at >40% IoU", not just how many there are of
          // each. Only means anything for exactly two owners; with one or
          // three+ there's no single "the other person" to pair against,
          // so it's left off rather than guessed at. Unmatched is broken
          // out per owner (each owner's own count minus the shared matched
          // number) rather than one bare difference, so "who's over"
          // doesn't need re-deriving from the two counts above.
          let summary = null;
          if (rows.length === 2) {
            const [oa, ob] = owners;
            const A = labelsFor(oa, id), B = labelsFor(ob, id);
            const matched = pairLabelsByIoU(A, B).usedA.size;
            summary = { matched, unmatchedBy: [
              { who: oa, n: A.length - matched },
              { who: ob, n: B.length - matched },
            ] };
          }
          return { id, label: punchLabel(id), rows, summary };
        }),
      };
    })
    .filter(Boolean);
}

// ============================================================
// "Another admin is here" — presence heartbeat
// ============================================================
// Admin writes into OTHER people's sheets, so two admins are real
// concurrent writers on one sheet. The server-side lock (withPunchWriteLock
// in apps_script/Code.js) makes that SAFE — no more edits landing on the
// wrong row — but it cannot make it sensible: two people correcting the
// same video still overwrite each other's judgement calls without knowing.
// The nav bar's standing headcount chip (updateAdminPresenceChip()) is the
// whole of how this surfaces now — no popup interrupting the labeler every
// time someone joins or leaves, just the number updating quietly.
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

async function adminPing() {
  if (!state.isAdmin || !state.scriptUrl) return;
  try {
    const res = await fetchJson(sheetUrl({
      action: 'adminPing', client: adminClientId(), who: labelerId() || 'Admin',
    }), 15000);
    const others = (res && res.others) || [];
    updateAdminPresenceChip(others.length);
  } catch (e) {
    // A missed heartbeat is not worth a word to the user; the next one
    // covers it, and admin work is not blocked by not knowing.
  }
}

// Always on once in admin mode, not just once someone else shows up — a
// standing headcount rather than a warning that only appears at the moment
// it would already be too late to have planned around. `n` is OTHER admins
// (what adminPing gets back).
function updateAdminPresenceChip(n) {
  const chip = document.getElementById('admin-presence');
  if (!chip) return;
  chip.hidden = false;
  chip.textContent = n === 0 ? 'Just you here' : n === 1 ? '1 more person here' : n + ' more people here';
  // Green alone, amber for a couple more, red once it's crowded enough that
  // two people quietly overwriting each other's correction on the same
  // video is a real risk rather than a theoretical one.
  chip.classList.toggle('tone-solo', n === 0);
  chip.classList.toggle('tone-busy', n >= 4);
}

function setupAdminPresence() {
  if (!state.isAdmin) return;
  // Shows "Just you here" (green) immediately rather than leaving the chip
  // hidden until the first ping round-trips — that's right (nobody else is
  // confirmed yet) even before the network answers whether anyone else is
  // too.
  updateAdminPresenceChip(0);
  adminPing();
  setInterval(adminPing, ADMIN_PING_MS);
}

function setupAgreement() {
  const btn = document.getElementById('btn-agreement');
  const dlg = document.getElementById('agr-dialog');
  if (!btn || !dlg) return;
  btn.hidden = !state.isAdmin;      // review instrument, not a labelling one
  btn.addEventListener('click', () => {
    // A fresh open re-fetches the all-videos aggregate (if that's the mode
    // it opens into) rather than serving a stale one — see
    // fetchAllVideosByOwnerMap()'s cache.
    _agrAllVideosCache = null;
    renderAgreement();
    dlg.showModal();
  });
  document.getElementById('agr-close')?.addEventListener('click', () => dlg.close());
  document.getElementById('agr-export-pdf')?.addEventListener('click', exportAgreementPdf);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  setupAgreementTypeFilterMenu();
  setupAgreementVersionFilterMenu('john');
  setupAgreementVersionFilterMenu('arianne');
}

// True once nothing identifies a specific video — no pasted link, no local
// file open. That's the trigger for the Agreement dialog's all-videos
// overview: rendering the single-video view against an empty state.labels
// would just be a permanently-empty panel, which is worse than useless
// (looks broken, not "nothing to show here on purpose").
function noVideoSelected() {
  return !document.getElementById('drive-link')?.value.trim() && !state.videoName;
}

// Memoized per dialog-open (cleared in setupAgreement()'s click handler) so
// toggling the Moves filter re-renders instantly instead of re-fetching the
// whole sheet-wide scan on every checkbox click.
let _agrAllVideosCache = null;

// Server sends { videos: { videoUrl: { sheetName: [[start,end,punchIdx],...] } },
// punchTypes: [...] } (see allVideosPunchLabels() in Code.js) — real label
// times, not counts, so computeAgreementPanel() can run the exact same
// time-IoU matching (pairLabelsByIoU()) here that it does for a single
// video's state.labels; a bare count has nowhere to keep the timing a real
// match needs. Each [start, end, punchIdx] triple becomes a
// { punch, start, end } object — punchTypes[punchIdx] is the shared string
// table every triple across every video points into, so the id string
// isn't repeated per label over the wire.
// Owner names use the exact sheet-name -> display-name stripping
// foreignOwnerName() uses everywhere else. Display names come from the
// tracking-sheet video catalog (fetchVideoCatalog() — same one the video
// picker uses) by matching the normalized link; a video the catalog
// doesn't know about (deleted from the sheet, or never listed there) just
// falls back to showing its raw link, same as agreementVideoName() does
// for the single-video header.
// Ordered the same way the picker numbers its own list (the catalog's own
// `.n`, i.e. the tracking sheet's own row order) rather than alphabetically,
// so a video's position means the same thing in both places. Anything the
// catalog doesn't know about (no `.n`) sorts after everything that does.
async function fetchAllVideosBreakdown() {
  if (_agrAllVideosCache) return _agrAllVideosCache;
  const [result, catalog] = await Promise.all([
    fetchJson(sheetUrl({ action: 'agreementAllVideos' }), 90000),
    (typeof fetchVideoCatalog === 'function' ? fetchVideoCatalog() : Promise.resolve([])),
  ]);
  // Keyed by normalized link, not just name — carries the whole tracking-sheet
  // entry (status/version fields included) so each video's Agreement section
  // can show the exact same badges the picker does, not just its name.
  const catalogByLink = new Map();
  for (const v of catalog || []) {
    const key = normalizeDriveUrl(v.link);
    if (key) catalogByLink.set(key, v);
  }
  const punchTypes = (result && result.punchTypes) || [];
  const byVideo = (result && result.videos) || {};
  const entries = Object.entries(byVideo).map(([video, sheetLabels]) => {
    const byOwner = new Map();
    for (const [sheetName, triples] of Object.entries(sheetLabels)) {
      const who = String(sheetName).replace(/^Labeled Data (Software )?/, '') || 'other labeler';
      const labels = byOwner.get(who) || [];
      for (const [start, end, punchIdx] of triples) {
        labels.push({ punch: punchTypes[punchIdx], start, end });
      }
      byOwner.set(who, labels);
    }
    const cat = catalogByLink.get(video);
    return { video, displayName: (cat && cat.name) || video, catalog: cat || null, byOwner };
  });
  entries.sort((a, b) => {
    const an = a.catalog ? a.catalog.n : Infinity;
    const bn = b.catalog ? b.catalog.n : Infinity;
    if (an !== bn) return an - bn;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  });
  const unmatched = entries.filter((e) => !e.catalog);
  if (unmatched.length) {
    // Diagnostic, not a bug report — a video shows up here whenever its
    // labels' video_file link doesn't normalize to anything currently in
    // the tracking sheet's video_link column (re-uploaded under a new
    // Drive id since it was labeled, removed from the sheet, or never
    // added). Logged so a mismatch is checkable against the sheet instead
    // of just reading as "the number's missing, why."
    console.warn(`[agreement] ${unmatched.length} video(s) with labels but no tracking-sheet match:`,
      unmatched.map((e) => e.video));
  }
  _agrAllVideosCache = entries;
  return entries;
}

// ── Agreement dialog's own "Moves" filter ──────────────────────────────────
// Same checkbox-grid pop-up as the Labels panel's Types menu (renderTypeFilterMenu()
// above), same #ffm-row/#tfm-grid markup and CSS — but its own Set
// (state.agreementTypeFilter) and its own button/menu, so opening Agreement
// never quietly changes what the labeler sees on the timeline underneath it.
// Picking specific types is what lets a family like "Rolls" split apart —
// Rear Roll on its own, without Lead Roll tagging along — see
// computeAgreementPanel()'s idsToShow().
function updateAgreementTypeFilterButton() {
  const label = document.getElementById('agr-type-filter-label');
  const btn = document.getElementById('btn-agr-type-filter');
  if (!label || !btn) return;
  const n = state.agreementTypeFilter.size;
  label.textContent = n ? `Moves: ${n}` : 'Moves: all';
  btn.classList.toggle('on', n > 0);
}

function renderAgreementTypeFilterMenu(menu) {
  // Counts here are whole-video totals across every labeler (own + foreign),
  // matching what computeAgreementPanel() itself tallies — so the number
  // next to each row previews what picking it will actually show, not just
  // what's on this labeler's own lanes.
  const counts = {};
  for (const l of state.labels) {
    if (l.isRoundMarker) continue;
    counts[l.punch] = (counts[l.punch] || 0) + 1;
  }

  menu.innerHTML = '';

  const allRow = document.createElement('button');
  allRow.type = 'button';
  allRow.className = 'ffm-row';
  allRow.setAttribute('role', 'menuitemcheckbox');
  allRow.setAttribute('aria-checked', String(state.agreementTypeFilter.size === 0));
  allRow.innerHTML = '<span class="ffm-name">All moves</span>';
  allRow.onclick = () => {
    if (state.agreementTypeFilter.size) {
      state.agreementTypeFilter.clear();
      updateAgreementTypeFilterButton();
      renderAgreement();
    }
    renderAgreementTypeFilterMenu(menu);
  };
  menu.appendChild(allRow);

  const sep = document.createElement('div');
  sep.className = 'ffm-sep';
  menu.appendChild(sep);

  const grid = document.createElement('div');
  grid.className = 'tfm-grid';
  const orderedTypes = TYPE_MENU_ORDER
    .map(id => PUNCH_TYPES.find(p => p.id === id))
    .filter(p => p && !p.retired);
  for (const p of orderedTypes) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ffm-row';
    row.setAttribute('role', 'menuitemcheckbox');
    row.setAttribute('aria-checked', String(state.agreementTypeFilter.has(p.id)));
    row.title = punchLabel(p.id);
    row.innerHTML =
      `<span class="ffm-dot" style="--who: ${getPunchColor(p.id)}"></span>` +
      `<span class="ffm-name">${punchLabel(p.id)}</span>` +
      `<span class="ffm-count">${counts[p.id] || 0}</span>`;
    row.onclick = () => {
      if (!state.agreementTypeFilter.delete(p.id)) state.agreementTypeFilter.add(p.id);
      updateAgreementTypeFilterButton();
      renderAgreement();
      renderAgreementTypeFilterMenu(menu);
    };
    grid.appendChild(row);
  }
  menu.appendChild(grid);
}

function setupAgreementTypeFilterMenu() {
  const btn = document.getElementById('btn-agr-type-filter');
  const menu = document.getElementById('agr-type-filter-menu');
  if (!btn || !menu) return;

  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open = () => {
    renderAgreementTypeFilterMenu(menu);
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';
    menu.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 18) + 'px';
    btn.setAttribute('aria-expanded', 'true');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? open() : close();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.composedPath().includes(menu) && e.target !== btn) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) close();
  });
}

// ── Agreement dialog's John/Arianne version filters (all-videos only) ─────
// Same checkmark-pop-up idiom as the Moves filter above, but single-column
// (a handful of version values, not nineteen move types) and parameterized
// by which labeler ('john' / 'arianne') since the two are otherwise
// identical. Narrows which videos get a section in the all-videos view —
// meaningless for a single video, so these two buttons only show there
// (see renderAgreement()).
function agrVersionFilterSet(labelerKey) {
  return labelerKey === 'john' ? state.agreementVersionFilterJohn : state.agreementVersionFilterArianne;
}

// Shared by both loops that walk the all-videos breakdown (renderAgreement()
// and exportAgreementPdf()) so the live dialog and the PDF can never
// disagree about which videos the version filters let through. `catalog` is
// the video's tracking-sheet row (or null if unmatched — see
// fetchAllVideosBreakdown()'s console.warn for that case); an unmatched
// video has no version to check against a non-empty filter, so it's
// excluded rather than guessed into either bucket.
function agrVersionMatches(catalog) {
  const johnSet = state.agreementVersionFilterJohn;
  const ariSet = state.agreementVersionFilterArianne;
  if (!johnSet.size && !ariSet.size) return true;
  if (!catalog) return false;
  const vj = (catalog.versionJohn || '').trim() || 'none';
  const va = (catalog.versionArianne || '').trim() || 'none';
  if (johnSet.size && !johnSet.has(vj)) return false;
  if (ariSet.size && !ariSet.has(va)) return false;
  return true;
}

function updateAgreementVersionFilterButton(labelerKey) {
  const set = agrVersionFilterSet(labelerKey);
  const label = document.getElementById(`agr-version-${labelerKey}-label`);
  const btn = document.getElementById(`btn-agr-version-${labelerKey}`);
  if (!label || !btn) return;
  const name = labelerKey === 'john' ? 'John' : 'Arianne';
  const n = set.size;
  label.textContent = n ? `${name}: ${n}` : `${name}: all`;
  btn.classList.toggle('on', n > 0);
}

// Every distinct version value seen across the currently-fetched all-videos
// breakdown for this labeler — 'none' standing in for "no version recorded"
// (same convention statusBadges()/versionMeta() use), sorted with real
// versions numerically first and 'none' always last.
function agrDistinctVersions(labelerKey) {
  const field = labelerKey === 'john' ? 'versionJohn' : 'versionArianne';
  const values = new Set();
  for (const e of (_agrAllVideosCache || [])) {
    const raw = (e.catalog && e.catalog[field] || '').trim();
    values.add(raw || 'none');
  }
  return [...values].sort((a, b) => {
    if (a === 'none') return b === 'none' ? 0 : 1;
    if (b === 'none') return -1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function renderAgreementVersionFilterMenu(labelerKey, menu) {
  const set = agrVersionFilterSet(labelerKey);
  menu.innerHTML = '';

  const allRow = document.createElement('button');
  allRow.type = 'button';
  allRow.className = 'ffm-row';
  allRow.setAttribute('role', 'menuitemcheckbox');
  allRow.setAttribute('aria-checked', String(set.size === 0));
  allRow.innerHTML = '<span class="ffm-name">All versions</span>';
  allRow.onclick = () => {
    if (set.size) {
      set.clear();
      updateAgreementVersionFilterButton(labelerKey);
      renderAgreement();
    }
    renderAgreementVersionFilterMenu(labelerKey, menu);
  };
  menu.appendChild(allRow);

  const sep = document.createElement('div');
  sep.className = 'ffm-sep';
  menu.appendChild(sep);

  for (const v of agrDistinctVersions(labelerKey)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ffm-row';
    row.setAttribute('role', 'menuitemcheckbox');
    row.setAttribute('aria-checked', String(set.has(v)));
    row.innerHTML = `<span class="ffm-name">${escapeHtml(v)}</span>`;
    row.onclick = () => {
      if (!set.delete(v)) set.add(v);
      updateAgreementVersionFilterButton(labelerKey);
      renderAgreement();
      renderAgreementVersionFilterMenu(labelerKey, menu);
    };
    menu.appendChild(row);
  }
}

function setupAgreementVersionFilterMenu(labelerKey) {
  const btn = document.getElementById(`btn-agr-version-${labelerKey}`);
  const menu = document.getElementById(`agr-version-menu-${labelerKey}`);
  if (!btn || !menu) return;

  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open = () => {
    renderAgreementVersionFilterMenu(labelerKey, menu);
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';
    menu.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 18) + 'px';
    btn.setAttribute('aria-expanded', 'true');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? open() : close();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.composedPath().includes(menu) && e.target !== btn) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) close();
  });
}

// The video name each line is filed under — shared by the on-screen dialog
// and the PDF export, so the two can never say a different video.
function agreementVideoName() {
  return state.videoName || document.getElementById('drive-link')?.value.trim() || 'this video';
}

// Every owner sees the SAME matched count (it's min(A, B), not a per-owner
// number) but their OWN unmatched leftover — one of the two is always 0.
// Folded onto each owner's own line rather than a separate summary row
// underneath, so the count-only pairing stat rides along with whatever it's
// describing instead of needing its own row to hold it.
function agreementMatchSuffix(type, r) {
  if (!type.summary) return '';
  const unmatched = type.summary.unmatchedBy.find(u => u.who === r.who).n;
  return ` (${type.summary.matched} matched, ${unmatched} unmatched)`;
}

// Plain text, not HTML — what a copy button on one line puts on the
// clipboard, and also each row of the PDF export's own table (built fresh
// from the same computeAgreementPanel() data rather than scraped off the
// DOM, so it can't drift from what changing the video would show).
function agreementLineText(type, r) {
  return `${type.label} by ${r.who}: ${r.count}${agreementMatchSuffix(type, r)}`;
}

// Same dot getPunchColor() paints on this type's .punch-btn and its
// timeline strip — the PDF export uses its own version of this too, so the
// two read as the same report rather than a plain-text stand-in for a
// designed one. Shared by the single-video render and each per-video
// section of the all-videos view (see renderAgreement() below) — one
// video's headline + family/type breakdown, as both HTML and the flat line
// list its copy buttons need (matched up by DOM order, not a data
// attribute — see the copyBtn comment below for why).
// `catalogEntry` (a tracking-sheet row — see fetchVideoCatalog()) is
// optional: when given, its John/Arianne progress badges (same ones the
// video picker shows — statusBadges() above) render next to the headline,
// so a video's readiness is visible without leaving Agreement. Absent for
// a video the tracking sheet doesn't know about.
function agreementBlockHtml(headline, families, copyBtn, catalogEntry) {
  const lineHtml = (type, r) =>
    `<span class="agr-dot" style="background:${getPunchColor(type.id)}"></span>${type.label} by ${r.who}: <b>${r.count}</b>` +
    `<span class="agr-sub">${agreementMatchSuffix(type, r)}</span>`;
  const badges = catalogEntry ? `<span class="agr-video-badges">${statusBadges(catalogEntry)}</span>` : '';
  const html = `<p class="fvd-lede agr-video-line"><span class="agr-line">${headline}</span>${badges}${copyBtn}</p>` +
    families.map(({ family, types }) => `
      <h3 class="agr-h">${family.label}</h3>
      <div class="agr-family">
        ${types.map(type => `
          <div class="fvd-rows agr-type-group">
            ${type.rows.map(r => `<div class="fvd-row"><span class="agr-line">${lineHtml(type, r)}</span>${copyBtn}</div>`).join('')}
          </div>`).join('')}
      </div>`).join('');
  const lines = [headline];
  families.forEach(({ types }) => types.forEach(type => type.rows.forEach(r => lines.push(agreementLineText(type, r)))));
  return { html, lines };
}

async function renderAgreement() {
  const body = document.getElementById('agr-body');
  if (!body) return;

  const allVideos = noVideoSelected();
  const titleEl = document.getElementById('agr-title');
  if (titleEl) titleEl.textContent = allVideos ? 'Agreement across all videos' : 'Agreement on this video';
  // Version filters only mean anything with more than one video to filter.
  const johnFilterRow = document.getElementById('agr-version-filter-john');
  const arianneFilterRow = document.getElementById('agr-version-filter-arianne');
  if (johnFilterRow) johnFilterRow.hidden = !allVideos;
  if (arianneFilterRow) arianneFilterRow.hidden = !allVideos;
  if (allVideos) {
    // Button text otherwise only updates from inside the menu's own click
    // handlers — without this the "John: v1 default" filter is silently
    // active but the button still reads "John: all" until it's opened once.
    updateAgreementVersionFilterButton('john');
    updateAgreementVersionFilterButton('arianne');
  }

  // The copy icon markup, same one #btn-copy-link/#btn-copy-name already
  // use elsewhere in this page — click handlers are wired up below by DOM
  // position rather than embedding the line's text in an HTML attribute,
  // since a labeler name here is arbitrary sheet-derived text that has no
  // business being escaped into markup.
  const copyBtn = `<button type="button" class="agr-copy" title="Copy this line">
      <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M2.5 9V2.5A1 1 0 0 1 3.5 1.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
    </button>`;

  if (!allVideos) {
    const families = computeAgreementPanel();
    if (!families.length) {
      body.innerHTML = state.agreementTypeFilter.size
        ? '<p class="agr-empty">No data for the selected moves on this video.</p>'
        : '<p class="agr-empty">No punches on this video yet.</p>';
      return;
    }
    // Best-effort — the catalog may still be loading, or this video may not
    // be in the tracking sheet at all; either way agreementBlockHtml() just
    // skips the badges when there's nothing to match.
    const currentLink = normalizeDriveUrl(document.getElementById('drive-link')?.value.trim() || '');
    const catalogEntry = currentLink && Array.isArray(_videoCatalog)
      ? _videoCatalog.find((v) => normalizeDriveUrl(v.link) === currentLink)
      : null;
    const { html, lines } = agreementBlockHtml(`Video: ${agreementVideoName()}`, families, copyBtn, catalogEntry);
    body.innerHTML = html;
    body.querySelectorAll('.agr-copy').forEach((btn, i) => {
      btn.addEventListener('click', () => copyTextToClipboard(lines[i], btn, 'line'));
    });
    return;
  }

  // All-videos: one section per video, "Video: <name>" — not one grand
  // total, so a labeler can be spotted as behind (or ahead) on a SPECIFIC
  // video rather than only in aggregate. A video drops out entirely once
  // the Moves filter leaves it with nothing, rather than padding the page
  // with empty headers — there can be hundreds of these.
  body.innerHTML = '<p class="agr-empty">Loading counts across every video…</p>';
  let breakdown;
  try {
    breakdown = await fetchAllVideosBreakdown();
  } catch (err) {
    console.error('Agreement all-videos fetch failed:', err);
    body.innerHTML = '<p class="agr-empty">Could not load counts across all videos — try again.</p>';
    return;
  }

  const blocks = [];
  for (const { displayName, catalog, byOwner } of breakdown) {
    if (!agrVersionMatches(catalog)) continue;
    const families = computeAgreementPanel(byOwner);
    if (!families.length) continue;
    // Same number the picker shows for this video (catalog.n, its row in
    // the tracking sheet) — not a fresh recount of just what's visible
    // here, so "video #47" means the same thing in both places even once
    // the Moves filter has dropped some out.
    const numberPrefix = catalog ? `${catalog.n}. ` : '';
    blocks.push(agreementBlockHtml(`${numberPrefix}Video: ${displayName}`, families, copyBtn, catalog));
  }

  if (!blocks.length) {
    body.innerHTML = state.agreementTypeFilter.size
      ? '<p class="agr-empty">No data for the selected moves on any video.</p>'
      : '<p class="agr-empty">No punches logged anywhere yet.</p>';
    return;
  }

  body.innerHTML = blocks.map(b => `<div class="agr-video-block">${b.html}</div>`).join('');
  // Same DOM order the HTML was just built in, blocks back to back, so the
  // Nth button matches the Nth line across the whole concatenated list.
  const flatLines = blocks.flatMap(b => b.lines);
  body.querySelectorAll('.agr-copy').forEach((btn, i) => {
    btn.addEventListener('click', () => copyTextToClipboard(flatLines[i], btn, 'line'));
  });
}

// Opens a plain, print-styled copy of the report in a new tab and calls
// print() on it. The browser's own "Save as PDF" print destination is the
// export — there's no PDF library here, and one button doesn't earn adding
// one. Built fresh from computeAgreementPanel() (not innerHTML-scraped from
// #agr-body) so it can't inherit any of the dialog's own chrome.
async function exportAgreementPdf() {
  // Opened FIRST, synchronously, before any await — a popup blocker allows
  // window.open() called directly from a click handler, but not one called
  // after an awaited fetch has already yielded control back to the event
  // loop, which is why the all-videos branch below has to write a loading
  // placeholder into an already-open tab rather than opening it once the
  // data's ready.
  const win = window.open('', '_blank');
  if (!win) { showToast('Could not open the export tab — check your popup blocker.', 'error'); return; }

  const allVideos = noVideoSelected();
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // Same visual language as the dialog itself — light-grey pill rows on a
  // white card, a coloured dot per move (getPunchColor(), the exact same
  // colour its timeline strip and its .punch-btn dot use), an uppercase
  // eyebrow per family — rather than a bare HTML table that looks like it
  // came from a different tool entirely. Shared by the single-video export
  // and each per-video section of the all-videos one.
  const pdfMatchSuffix = (type, r) => {
    if (!type.summary) return '';
    const unmatched = type.summary.unmatchedBy.find(u => u.who === r.who).n;
    return `<span class="sub"> (${type.summary.matched} matched, ${unmatched} unmatched)</span>`;
  };
  const pdfSections = (families) => families.map(({ family, types }) => `
    <div class="fam">
      <h2>${esc(family.label)}</h2>
      <div class="type-group-wrap">
        ${types.map(type => `
          <div class="type-group">
            ${type.rows.map(r => `
              <div class="row">
                <span class="dot" style="background:${getPunchColor(type.id)}"></span>
                <span class="line">${esc(type.label)} by ${esc(r.who)}</span>
                <span class="count">${r.count}</span>
                ${pdfMatchSuffix(type, r)}
              </div>`).join('')}
          </div>`).join('')}
      </div>
    </div>`).join('');

  let bodyHtml, docTitle;
  if (!allVideos) {
    const families = computeAgreementPanel();
    if (!families.length) {
      win.close();
      showToast(state.agreementTypeFilter.size
        ? 'Nothing to export — no data for the selected moves on this video.'
        : 'Nothing to export — no punches on this video yet.', 'error');
      return;
    }
    docTitle = agreementVideoName();
    const currentLink = normalizeDriveUrl(document.getElementById('drive-link')?.value.trim() || '');
    const catalogEntry = currentLink && Array.isArray(_videoCatalog)
      ? _videoCatalog.find((v) => normalizeDriveUrl(v.link) === currentLink)
      : null;
    const badges = catalogEntry ? statusBadges(catalogEntry) : '';
    bodyHtml = `<p class="lede">Video: ${esc(agreementVideoName())}${badges}</p>${pdfSections(families)}`;
  } else {
    win.document.write('<!doctype html><meta charset="utf-8"><body style="font:14px -apple-system,sans-serif;padding:24px;color:#444">Loading…</body>');
    let breakdown;
    try {
      breakdown = await fetchAllVideosBreakdown();
    } catch (err) {
      console.error('Agreement all-videos fetch failed:', err);
      win.document.open();
      win.document.write('<!doctype html><meta charset="utf-8"><body style="font:14px -apple-system,sans-serif;padding:24px;color:#c00">Could not load counts across all videos.</body>');
      win.document.close();
      showToast('Could not export — try again.', 'error');
      return;
    }
    // One "Video: X" sub-section per video with data, same drop-empty-videos
    // rule as the live dialog — there can be hundreds of these, and an empty
    // header for each one that didn't have the selected move(s) is just noise.
    const videoBlocks = [];
    for (const { displayName, catalog, byOwner } of breakdown) {
      if (!agrVersionMatches(catalog)) continue;
      const families = computeAgreementPanel(byOwner);
      if (families.length) {
        const badges = catalog ? statusBadges(catalog) : '';
        const numberPrefix = catalog ? `${catalog.n}. ` : '';
        videoBlocks.push(`<div class="video-block"><p class="video-name">${numberPrefix}${esc(displayName)}${badges}</p>${pdfSections(families)}</div>`);
      }
    }
    if (!videoBlocks.length) {
      win.close();
      showToast(state.agreementTypeFilter.size
        ? 'Nothing to export — no data for the selected moves on any video.'
        : 'Nothing to export — no punches logged anywhere yet.', 'error');
      return;
    }
    docTitle = 'All videos';
    bodyHtml = videoBlocks.join('');
  }
  // Fresh document, not appending to the loading placeholder above.
  win.document.open();

  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Agreement — ${esc(docTitle)}</title>
    <style>
      :root { color-scheme: light; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body {
        font-family: -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
        background: #f5f5f7; color: #1d1d1f; margin: 0; padding: 28px;
      }
      .card {
        max-width: 640px; margin: 0 auto; background: #fff; border-radius: 16px;
        box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.06);
        padding: 24px 28px 28px;
      }
      .head { border-bottom: 1px solid rgba(0,0,0,.10); padding-bottom: 14px; margin-bottom: 4px; }
      h1 { font-size: 18px; font-weight: 640; letter-spacing: -.02em; margin: 0 0 4px; }
      .lede { font-size: 13px; color: #6e6e73; margin: 0; }
      /* John/Arianne progress badges next to a "Video: X" line — same
         statusBadges() markup the app itself uses, restyled here since this
         standalone document can't reach the app's CSS custom properties. */
      .video-name .vp-slot, .lede .vp-slot { display: inline-flex; }
      .vp-ver {
        display: inline-flex; align-items: center; margin-left: 5px;
        font-size: 10px; font-weight: 650; letter-spacing: .02em;
        padding: 1px 5px; border-radius: 5px;
      }
      .vp-v-v1    { background: #d1f2dd; color: #146c2e; }
      .vp-v-v0    { background: #fbe8c6; color: #8a5200; }
      .vp-v-empty { background: #ffe1df; color: #b42318; }
      .vp-v-other { background: rgba(120,120,128,.12); color: #6e6e73; }
      h2 {
        font-size: 10.5px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase;
        color: #6e6e73; margin: 18px 0 8px;
      }
      .fam:first-of-type h2 { margin-top: 16px; }
      .type-group-wrap { display: flex; flex-direction: column; gap: 8px; }
      .type-group { display: flex; flex-direction: column; gap: 4px; }
      .row {
        display: flex; align-items: center; gap: 8px;
        background: rgba(120,120,128,.12); border-radius: 8px; padding: 8px 10px;
        font-size: 13px; page-break-inside: avoid;
      }
      .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; box-shadow: 0 0 0 1px rgba(0,0,0,.12); }
      .line { flex: 1; min-width: 0; }
      .count { font-weight: 650; font-variant-numeric: tabular-nums; }
      .sub { color: #6e6e73; font-size: 11.5px; font-weight: 400; }
      /* Each video's own sub-section in the all-videos export — a hairline
         above every one after the first marks where a new video starts,
         same idea as .agr-video-block does in the live dialog. */
      .video-block {
        padding-top: 14px; margin-top: 14px; border-top: 1px solid rgba(0,0,0,.10);
        /* Keep a video's own header glued to at least its first line of
           content — without this a page break can land between
           .video-name and the rows under it, so the printed page starts
           mid-video with no name in sight and the previous page ends on an
           orphaned heading. Doesn't guarantee the WHOLE block stays on one
           page (a video with dozens of rows still has to split somewhere),
           just that it never splits at that one worst spot. */
        break-inside: avoid-page; page-break-inside: avoid;
      }
      .video-name {
        font-size: 14px; font-weight: 620; margin: 0 0 2px;
        break-after: avoid-page; page-break-after: avoid;
      }
      @media print {
        body { background: #fff; padding: 0; }
        .card { box-shadow: none; border-radius: 0; max-width: none; padding: 0; }
      }
    </style></head><body>
    <div class="card">
      <div class="head">
        <h1>Agreement ${allVideos ? 'across all videos' : 'on this video'}</h1>
        ${state.agreementTypeFilter.size ? `<p class="lede">Filtered to: ${esc([...state.agreementTypeFilter].map(punchLabel).join(', '))}</p>` : ''}
      </div>
      ${bodyHtml}
    </div>
    </body></html>`);
  win.document.close();
  win.focus();
  // The print dialog needs the page actually painted first — onload alone
  // can fire before layout settles on some browsers for a document.write()
  // page, so this waits one frame rather than calling print() synchronously.
  win.requestAnimationFrame(() => win.print());
}

// Clicking a row in the Labels panel lights that row AND its strip on the
// timeline — including on another labeler's lane, so "which of these is the
// one I'm reading" is answerable in both directions. Clicking the same row
// again clears it. The reverse direction — clicking a move's strip ON the
// timeline (ui.js's setupSegmentEditing click handler) — also lands here,
// which is what makes that scroll the Labels panel to match: same "which of
// these is the one I'm looking at" question, just asked from the other side.
function highlightLabel(label) {
  const turningOn = state.highlightedLabel !== label;
  state.highlightedLabel = turningOn ? label : null;
  renderLabels();
  // Scroll-to only on the way IN — toggling a highlight off shouldn't yank
  // the panel's scroll position back to wherever that row happened to be.
  if (!turningOn) return;
  const idx = state.labels.indexOf(label);
  if (idx === -1) return;
  const entry = document.querySelector(`#label-log [data-label-idx="${idx}"]`);
  if (!entry) return;
  entry.scrollIntoView({ block: 'center', behavior: 'smooth' });
  entry.classList.remove('label-flash');
  void entry.offsetWidth;    // restart the animation if it's already mid-flash
  entry.classList.add('label-flash');
}

// ============================================================
// Copy / cut / paste — Ctrl+C / Ctrl+X / Ctrl+V on the highlighted label.
// Round markers are excluded: a boundary isn't a "move" to duplicate, and
// two round_start rows at different times has no sensible meaning the way
// two jabs does. Scoped the same way undo is — see the comment above
// pushUndo() — to what's actually a labeling action.
// ============================================================
function copyHighlightedLabel() {
  const label = state.highlightedLabel;
  if (!label || label.isRoundMarker) return;
  state.clipboardLabel = { punch: label.punch, angle: label.angle, duration: label.end - label.start };
  showToast(`Copied: ${punchLabel(label.punch)}`, 'info');
}

function cutHighlightedLabel() {
  const label = state.highlightedLabel;
  if (!label || label.isRoundMarker) return;
  if (refuseForeign(label)) return;
  copyHighlightedLabel();
  const idx = state.labels.indexOf(label);
  if (idx === -1) return;
  state.highlightedLabel = null;   // the row it referred to is about to be gone
  deleteLabel(idx);                // handles its own undo entry + sheet delete
}

// Pastes at the CURRENT playhead — not at the copied label's original time,
// since "paste" here means "make another one of these, now", the same way
// captureTimestamp() makes a fresh one from wherever the video is paused.
// Duration is preserved from the copy so a repeated combo keeps its shape.
function pasteLabelAtPlayhead() {
  if (state.isAdmin) {
    showToast('Admin can edit and delete any label, but not create new ones.', 'error');
    return;
  }
  if (state.isAnalyst) {
    showToast('View only — Analyst mode cannot add labels', 'error');
    return;
  }
  const clip = state.clipboardLabel;
  if (!clip) return;
  const video = document.getElementById('video-player');
  const start = video.currentTime;
  const label = {
    id: null,
    punch_uuid: crypto.randomUUID(),
    punch: clip.punch,
    angle: clip.angle || '',
    start,
    end: start + clip.duration,
    videoName: normalizeDriveUrl(document.getElementById('drive-link').value.trim()) || state.videoName,
    timestamp: new Date().toISOString(),
  };
  state.labels.push(label);
  pushUndo({
    label,
    desc: 'Undid paste: ' + punchLabel(label.punch),
    undo: () => {
      const i = state.labels.indexOf(label);
      if (i === -1) return;
      state.labels.splice(i, 1);
      renderLabels();
      if (label.id != null) deleteLabelFromSheet(label);
      else label._pendingCancel = true;
    },
  });
  renderLabels();
  pushLabelToSheet(label).then(() => fetchLabelsFromSheet());
  showToast(`Pasted: ${punchLabel(label.punch)} at ${formatTime(label.start)}`, 'success');
}

function selectPunch(punchId) {
  // Reached via the move-type buttons AND the digit/letter keyboard
  // shortcuts alike — this is the one funnel both go through, so it's the
  // right place to refuse for Analyst rather than guarding every caller.
  // A no-op here is enough: with captureTimestamp() also refusing to start
  // a label, there is never a pending workflow for this to be a step of.
  if (state.isAnalyst) return;
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
    updateMoveButtonsEnabled();
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
  updateMoveButtonsEnabled();
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
  if (state.isAnalyst) {
    showToast('View only — Analyst mode cannot add labels', 'error');
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
    pushUndo({
      label,
      desc: 'Undid: ' + punchLabel(label.punch),
      undo: () => {
        const i = state.labels.indexOf(label);
        if (i === -1) return;
        state.labels.splice(i, 1);
        renderLabels();
        // The add may still be in flight — if it hasn't got an id back yet,
        // there's no row to delete. Flag it instead; pushLabelToSheet()
        // checks the flag the moment the id lands and deletes it then.
        if (label.id != null) deleteLabelFromSheet(label);
        else label._pendingCancel = true;
      },
    });
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
    // Ctrl+Z landed on this label while the add was still in flight — there
    // was no id yet for its undo entry to delete, so it just flagged this
    // instead. Now there is one.
    if (label._pendingCancel) deleteLabelFromSheet(label);
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
  if (state.isAnalyst) {
    showToast('View only — Analyst mode cannot add round markers', 'error');
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
  pushUndo({
    label,
    desc: 'Undid: ' + (markerType === 'round_start' ? 'Round Start' : 'Round End'),
    undo: () => {
      const i = state.labels.indexOf(label);
      if (i === -1) return;
      state.labels.splice(i, 1);
      // S/E flip state.roundActive BEFORE calling this — undoing the
      // marker has to undo that flip too, or S would refuse a moment later
      // claiming a round is already active that no longer has a start.
      state.roundActive = markerType !== 'round_start';
      localStorage.setItem('roundActive', String(state.roundActive));
      updateRoundIndicator();
      renderLabels();
      if (label.id != null) deleteLabelFromSheet(label);
      else label._pendingCancel = true;
    },
  });
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
    if (label._pendingCancel) { deleteLabelFromSheet(label); return; }
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
    if (copyBtn) copyBtn.hidden = !input.value.trim();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (input.value.trim()) {
        state.labels = [];
        // A fresh video means a fresh set of rows — an undo entry pointing
        // at a label from whatever was open before would be meaningless
        // (and its `idx` would land who-knows-where in the new list).
        state.undoStack = [];
        resetVideoForNewLink();
        fetchLabelsFromSheet(true);
        // Set by the video picker (see setupVideoPicker()'s pick()) right
        // before it dispatches this same 'input' event — has to run AFTER
        // resetVideoForNewLink() above, which would otherwise immediately
        // wipe out the file it's about to load.
        if (_pendingAutoLoadName) {
          const name = _pendingAutoLoadName;
          // Sequential, not parallel: loadVideoFileIntoPlayer() (inside the
          // video search below) calls resetSkeletonState() as a side effect
          // of opening a "new" video — running the skeleton search
          // concurrently raced that reset and could get wiped out by it
          // depending on which search resolved first.
          (async () => {
            if (typeof autoLoadVideoFromFolder === 'function') await autoLoadVideoFromFolder(name);
            if (typeof autoLoadSkeletonsFromFolder === 'function') await autoLoadSkeletonsFromFolder(name);
          })();
        }
        _pendingAutoLoadName = null;
      }
    }, 500);
  });
}

// A new link means a new video is coming — the locally opened file, any
// skeleton data, and any loaded prediction models all belonged to whatever
// was open before and would just sit there stale (or actively misleading)
// once the link changes. Local-video half mirrors ui.js's setupVideoName()
// paint(false) by hand rather than calling it — that closure is private to
// ui.js's own IIFE. The other two halves are resetSkeletonState()
// (skeleton.js) and resetPredictionsState() (predictions.js), guarded the
// same way every other optional cross-file call in this app is.
function resetVideoForNewLink() {
  const video = document.getElementById('video-player');
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  const thumbVideo = document.getElementById('thumb-video');
  if (thumbVideo) { thumbVideo.removeAttribute('src'); thumbVideo.load(); }
  const fileInput = document.getElementById('video-file');
  if (fileInput) fileInput.value = '';
  state.videoName = null;
  const nameEl = document.getElementById('video-name');
  if (nameEl) nameEl.classList.remove('loaded');
  if (nameEl) nameEl.textContent = 'No video loaded';
  const field = document.getElementById('video-loader');
  if (field) { field.classList.remove('ok'); field.title = 'No video open yet.'; }
  const statusEl = document.getElementById('video-status');
  if (statusEl) { statusEl.hidden = true; statusEl.innerHTML = ''; }
  const copyNameBtn = document.getElementById('btn-copy-name');
  if (copyNameBtn) copyNameBtn.hidden = true;

  if (typeof resetSkeletonState === 'function') resetSkeletonState();
  if (typeof resetPredictionsState === 'function') resetPredictionsState();
}

// ============================================================
// Video picker (tracking sheet)
// ============================================================
// Lets a labeler pick a video by name instead of hand-copying its link out
// of the team's tracking spreadsheet — Code.js's listTrackingVideos reads
// that sheet's "progress" tab and returns {name, link} pairs in its own row
// order, which this keeps as-is: the search box narrows that list, it never
// re-sorts it.
let _videoCatalog = null;          // null = not fetched yet, [] = fetched empty
let _videoCatalogPromise = null;
// Name of the video just picked from the list, consumed by setupDriveLink()'s
// debounce callback once resetVideoForNewLink() has run — see the comment
// there for why the ordering matters.
let _pendingAutoLoadName = null;

function fetchVideoCatalog() {
  if (_videoCatalogPromise) return _videoCatalogPromise;
  _videoCatalogPromise = fetchJson(sheetUrl({ action: 'listTrackingVideos' }), 20000)
    .then((result) => {
      _videoCatalog = Array.isArray(result && result.videos) ? result.videos : [];
      // Fixed 1-based number per video, tied to its row in the tracking
      // sheet — so it stays the same video's number whether or not a
      // search is narrowing the list, and matches what someone would count
      // scrolling down that sheet by hand.
      _videoCatalog.forEach((v, i) => { v.n = i + 1; });
      return _videoCatalog;
    })
    .catch(() => { _videoCatalog = []; return _videoCatalog; });
  return _videoCatalogPromise;
}

// From the tracking sheet's John_progress/Arianne_progress and
// labeling_version_John/labeling_version_Arianne columns (Code.js's
// doGetTrackingVideos()) — blank status reads as "not started" (the sheet
// leaves early rows genuinely empty rather than writing the word out).
// Shared by the video picker (setupVideoPicker() below) and the Agreement
// dialog's all-videos view (renderAgreement()), so a video's status badges
// look and mean the same thing in both places.
// Color and text are driven by the VERSION itself, not the progress status
// text — v1 is green, v0 is yellow, anything else non-empty falls back to a
// neutral tag showing its own text (v2, v3, ...), and no version at all is
// red "none". The raw status still rides along in the tooltip since it's
// useful context, just not what decides the badge's look anymore.
// `bothEmpty` downgrades the red "empty" look to the same neutral grey
// "other" gets — a video NEITHER labeler has started is just unassigned,
// not a problem. Red stays reserved for the actually-worth-noticing case:
// one of the two has a version and the other doesn't, a real gap between
// them on a video that's otherwise in progress.
function versionMeta(version, bothEmpty) {
  const v = (version || '').trim().toLowerCase();
  if (v === 'v1') return { cls: 'v1', text: 'v1' };
  if (v === 'v0') return { cls: 'v0', text: 'v0' };
  if (!v) return bothEmpty ? { cls: 'other', text: 'none' } : { cls: 'empty', text: 'none' };
  return { cls: 'other', text: version.trim() };
}
// Each labeler gets a fixed-width column (.vp-slot), always rendered —
// otherwise a video where only one of the two has a version pulls that
// badge into the OTHER one's position, and John's column stops being a
// column at all once there's a gap in it.
function statusBadges(v) {
  const bothEmpty = !(v.versionJohn || '').trim() && !(v.versionArianne || '').trim();
  const badge = (letter, version, status, wholeLabel) => {
    const meta = versionMeta(version, bothEmpty);
    const title = `${wholeLabel}: ${status || 'not started'}${version ? `, version ${version}` : ''}`;
    return `<span class="vp-slot"><span class="vp-ver vp-v-${meta.cls}" title="${escapeHtml(title)}">${letter} ${escapeHtml(meta.text)}</span></span>`;
  };
  return badge('J', v.versionJohn, v.statusJohn, 'John') + badge('A', v.versionArianne, v.statusArianne, 'Arianne');
}

function setupVideoPicker() {
  const btn = document.getElementById('btn-pick-video');
  const panel = document.getElementById('video-picker-panel');
  const search = document.getElementById('video-picker-search');
  const list = document.getElementById('video-picker-list');
  const input = document.getElementById('drive-link');
  if (!btn || !panel || !search || !list || !input) return;

  function renderList(filter) {
    if (!_videoCatalog) { list.innerHTML = '<div class="vp-loading">Loading videos…</div>'; return; }
    const q = filter.trim().toLowerCase();
    const rows = q ? _videoCatalog.filter((v) => v.name.toLowerCase().includes(q)) : _videoCatalog;
    if (!rows.length) { list.innerHTML = '<div class="vp-empty">No matches</div>'; return; }
    list.innerHTML = rows.map((v, i) =>
      `<button type="button" class="vp-row" data-idx="${i}"><span class="vp-n">${v.n}.</span><span class="vp-name">${escapeHtml(v.name)}</span>${statusBadges(v)}</button>`
    ).join('');
    Array.from(list.querySelectorAll('.vp-row')).forEach((el, i) => {
      el.addEventListener('click', () => pick(rows[i]));
    });
  }

  function pick(video) {
    _pendingAutoLoadName = video.name;
    input.value = video.link;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    closePanel();
  }

  function openPanel() {
    panel.hidden = false;
    btn.classList.add('open');
    search.value = '';
    renderList('');
    search.focus();
    if (!_videoCatalog) fetchVideoCatalog().then(() => renderList(search.value));
  }

  function closePanel() {
    panel.hidden = true;
    btn.classList.remove('open');
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (panel.hidden) openPanel(); else closePanel();
  });
  search.addEventListener('input', () => renderList(search.value));
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) closePanel();
  });

  // Warm the cache in the background so the first open isn't a blank spinner.
  fetchVideoCatalog();
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
  if (isFreshLoad) { setLoadingLocked(true); showLoadingDialog(); }
  // Suppresses checkProblems() (problems.js) until BOTH phases below have
  // landed. Phase 1 alone is always an incomplete picture — literally empty
  // for admin/Analyst (who own no rows), just this labeler's own for
  // everyone else — so diffing against it produced a popup for whatever
  // happened to be detectable at that half-loaded moment, which visibly
  // disagreed with the full count the badge and "View all" show a moment
  // later once phase 2's foreign rows land. Also drops any problems left
  // over from whatever video was open before — their keys are scoped by
  // punch_uuid only, not by video, so a stale entry surviving a video
  // switch could wrongly tell the backend an still-open problem on the
  // OLD video just resolved.
  if (isFreshLoad) {
    state.problemsLoadPending = true;
    state.knownProblems.clear();
    state.pendingResolveProblems.clear();
    if (typeof updateProblemsButton === 'function') updateProblemsButton(0);
  }

  // ── phase 1: own rows ────────────────────────────────────────────────
  // Tracked, because the dialog must only advance to "loading others" if
  // this half actually succeeded — on a failure or a supersede it has to
  // come down instead, or it would sit there claiming to load something
  // that is no longer being loaded.
  let phase1ok = false;
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
    // predictions.js is optional — reapplies whatever model file is loaded
    // against THIS video now that state.labels was just rebuilt from
    // scratch above (the filter a few lines up drops everything that
    // isn't a fresh own-row, predictions included).
    if (typeof applyPredictionsToLabels === 'function') applyPredictionsToLabels();
    linkStatus('ok');
    phase1ok = true;
  } catch (e) {
    if (!current()) return;
    reportLoadFailure(e, 'labels');
    return;
  } finally {
    // Unlock as soon as the labeler's OWN rows are in — the slow half runs
    // in the background. Guarded on `current()` so a superseded load can
    // never unlock the newer one's spinner.
    if (isFreshLoad && current()) {
      setLoadingLocked(false);
      // Advance the dialog only if there is a second half still coming.
      // Anything else — an error, a supersede — takes it down, so it can
      // never sit there loading something nobody is loading.
      if (phase1ok) setLoadingStage('foreign');
      else hideLoadingDialog();
      // Phase 2 (and the seedProblemsBaseline() call that un-suppresses)
      // only runs below when phase 1 actually succeeded — on a failure this
      // is the only place left to clear the flag, or it would stay
      // suppressed for the rest of the session.
      if (!phase1ok) {
        state.problemsLoadPending = false;
        if (typeof seedProblemsBaseline === 'function') seedProblemsBaseline();
      }
    }
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
    // Same reapply as phase 1 — the filter just above dropped predictions
    // again (they carry `foreign: true` too, same as any real foreign row).
    if (typeof applyPredictionsToLabels === 'function') applyPredictionsToLabels();
    else renderLabels();
    updateForeignFilterButton();
    // Down BEFORE the "already labeled" popup — otherwise the two stack,
    // and the one that matters ends up behind the one that doesn't.
    if (isFreshLoad) hideLoadingDialog();
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
  } finally {
    // Whatever happened above — success, refusal, timeout — the load is
    // over, so the dialog goes. Never left hanging on a failed second half.
    if (isFreshLoad && current()) hideLoadingDialog();
    // Un-suppress now that both phases have settled (whatever the outcome)
    // — see the comment where problemsLoadPending is set, above. Seeds the
    // baseline silently (seedProblemsBaseline(), problems.js) rather than
    // running checkProblems(): whatever's already open when the page
    // finishes loading was never "new" the way a problem an edit just
    // caused is, so it gets no popup — only real-time detection from here
    // on does. Guarded on current() the same way hideLoadingDialog() is
    // just above: a superseded load must not clear the flag the NEWER load
    // just set for itself.
    if (isFreshLoad && current()) {
      state.problemsLoadPending = false;
      if (typeof seedProblemsBaseline === 'function') seedProblemsBaseline();
    }
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

// ============================================================
// Loading dialog
// ============================================================
// Raised for the whole of a fresh video load. The catalogue overlay
// (#punch-loading) is the GUARD — it is what actually stops a label being
// started against a half-loaded list — but it is a corner of one panel, and
// on a 500-label video the load runs long enough that the page looked idle
// rather than busy. This says what is happening, in the middle of the
// screen, and names which half it is on.
//
// It does NOT trap you for the full load: the two halves are not equally
// important. Your OWN rows must be in before you label (a duplicate is the
// cost of getting that wrong). Everybody else's are read-only context, so
// once phase 1 lands the dialog offers a way straight past it.
function showLoadingDialog() {
  const dlg = document.getElementById('ldg-dialog');
  if (!dlg) return;
  setLoadingStage('own');
  if (!dlg.open) dlg.showModal();
}

function setLoadingStage(stage) {
  const title = document.getElementById('ldg-title');
  const note = document.getElementById('ldg-note');
  if (!title) return;
  if (stage === 'own') {
    title.textContent = 'Loading your labels…';
    note.textContent = 'Fetching what you have already marked on this video.';
  } else {
    title.textContent = 'Loading other labelers…';
    note.textContent = 'Your own labels are in — waiting for everyone else’s '
                     + 'to appear on the timeline.';
  }
}

function hideLoadingDialog() {
  const dlg = document.getElementById('ldg-dialog');
  if (dlg && dlg.open) dlg.close();
}

function setupLoadingDialog() {
  // Deliberately no backdrop-click, no close button and no skip-ahead
  // button: phase 1 has nothing useful to do behind it yet, and phase 2
  // closes itself the moment the foreign fetch lands (see
  // fetchLabelsFromSheet). Escape still works — the dialog's own default —
  // and isn't worth fighting.
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

// "Here's what came back from the sheet" — pops up every time a video
// finishes its fresh load (not on every incidental re-fetch), whether or
// not anyone else has touched it, so pasting a link always confirms what
// got pulled in instead of the labeler having to trust a silent fetch.
// Counts by owner so the busiest labeler is obvious at a glance; for Admin
// specifically that's also who a brand-new label would be attributed to
// (see resolveMajorityLabelerSheet in apps_script/Code.js), so the note
// below spells that out.
function countLabelBucket(labels) {
  // Split per labeler/bucket, because "273 labels" answers almost nothing —
  // 273 punches and 2 slips is a different video from 140 and 130, and which
  // of the two you are looking at changes whether it is worth re-labelling.
  // Round markers are counted apart: they are structure, not moves, and
  // folding them into either bucket would overstate it.
  const c = { total: 0, offense: 0, defense: 0, rounds: 0, other: 0 };
  for (const l of labels) {
    c.total++;
    if (l.isRoundMarker) {
      c.rounds++;
      continue;
    }
    const bucket = reportBucket(l.punch);
    if (bucket === 'offense') c.offense++;
    else if (bucket === 'defense') c.defense++;
    // step_back, unsure, or a legacy id the current catalogue doesn't
    // recognize -- counted in total (it's a real row) but not in either
    // bucket, same as the offline reports.
    else c.other++;
  }
  return c;
}

function fvdRow(who, c, strong) {
  const parts = [`<span class="fvd-off">${c.offense} offense</span>`,
                 `<span class="fvd-def">${c.defense} defense</span>`];
  if (c.rounds) parts.push(`<span class="fvd-rnd">${c.rounds} round mark${c.rounds === 1 ? '' : 's'}</span>`);
  if (c.other) parts.push(`<span class="fvd-oth">${c.other} other</span>`);
  const name = strong ? `<strong>${who}</strong>` : who;
  return `<div class="fvd-row">
    <span class="fvd-name">${name}<span class="fvd-split">${parts.join('')}</span></span>
    <span class="fvd-total">${c.total}</span>
  </div>`;
}

function maybeShowForeignVideoPopup() {
  const own = countLabelBucket(state.labels.filter(l => !l.foreign));

  const foreignByOwner = {};
  for (const l of state.labels) {
    if (!l.foreign) continue;
    const who = foreignOwnerName(l);
    (foreignByOwner[who] = foreignByOwner[who] || []).push(l);
  }
  const foreignEntries = Object.entries(foreignByOwner)
    .map(([who, labels]) => [who, countLabelBucket(labels)])
    .sort((a, b) => b[1].total - a[1].total);

  const dlg = document.getElementById('fvd-dialog');
  const body = document.getElementById('fvd-body');
  const title = document.getElementById('fvd-title');
  const showBtn = document.getElementById('fvd-show');
  if (!dlg || !body) return;

  // Analyst owns no rows either — same reason as admin, just with no
  // editing on top.
  const ownsNoRows = state.isAdmin || state.isAnalyst;
  const ownRow = fvdRow(ownsNoRows ? 'Everyone (foreign)' : 'You', own, false);
  const foreignRows = foreignEntries.map(([who, c]) => fvdRow(who, c, true)).join('');
  const hasForeign = foreignEntries.length > 0;

  if (title) title.textContent = hasForeign ? 'Already labeled by someone else' : 'Loaded from the sheet';
  if (showBtn) showBtn.hidden = !hasForeign;

  // Admin can no longer create labels at all — this used to say a new one
  // would be credited to whoever had the most rows, which is no longer true
  // and would now be actively misleading.
  const note = hasForeign && state.isAdmin
    ? `<p class="fvd-note">As admin you can edit or delete any of these — each change writes back to whoever owns that row. You cannot add new labels.</p>`
    : hasForeign && state.isAnalyst
    ? `<p class="fvd-note">View only — Analyst mode cannot add, edit, delete, or drag any label.</p>`
    : '';
  const lede = hasForeign ? 'This video already has labels from:' : 'What was loaded from the sheet:';
  // Own row is always zero for admin/Analyst (neither owns rows) and just
  // clutters this popup, which already spells "Everyone (foreign)" above.
  const rows = ownsNoRows ? foreignRows : `${ownRow}${foreignRows}`;
  body.innerHTML = `<p class="fvd-lede">${lede}</p><div class="fvd-rows">${rows}</div>${note}`;
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
  refreshAgreedLabelCache();
  const log = document.getElementById('label-log');
  const count = document.getElementById('label-count');
  const visible = state.labels.filter(l => !l.isRoundMarker && !shouldHideByTab(l));
  count.textContent = `(${visible.length})`;

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
    } else if (label.isPrediction || (label.foreign && !state.isAdmin)) {
      // Read-only, same treatment as a foreign round marker: no edit pencil,
      // no delete — this row belongs to another labeler's sheet (or is a
      // model prediction, which is read-only for EVERYONE, admin included —
      // see isForeignLabel()) and isForeignLabel()/refuseForeign() would
      // refuse the mutation anyway.
      const who = foreignOwnerName(label);
      entry.className = 'label-entry label-foreign';
      entry.style.borderLeftColor = getPunchColor(label.punch);
      // Whose row this is gets its own badge, in that labeler's colour and
      // on the same line as the move — it used to be dim grey text tacked
      // onto the end of the timestamps, which is where you look last. The
      // colour matches their timeline lane, so the two read together. A
      // model's row (label.isPrediction) uses this exact same treatment —
      // just its name, same as any labeler's.
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
    // "Outside every round" used to also flag the row right here (a class
    // plus a tooltip) — removed because it duplicated the Problems card
    // with a DIFFERENT scope (every visible row, foreign included, vs.
    // Problems' "rows this labeler can actually act on"), which could
    // disagree with it. That's now the ONE place this shows.
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
  // problems.js is optional — real-time timing-problem detection off the
  // labels this render just drew. Guarded the same way skeleton.js/
  // predictions.js are everywhere else they're called from app.js.
  if (typeof checkProblems === 'function') checkProblems();
}

// ============================================================
// Problems — pure detection (computeProblems()); problems.js is the
// consumer, popping a toast the moment a NEW one appears and persisting it
// to the backend in the background (see doGetProblems() in Code.js).
// Detects timing issues on rows THIS labeler can actually act on — a move
// outside every round, a move whose duration is absurd (a stuck end time —
// "the whole video" is the extreme case), two of the SAME owner's rounds
// overlapping, or a duplicate move (same type, same start AND end within
// DUPLICATE_EPSILON — a double-save, not a real second rep).
//
// Deliberately NOT flagging two DIFFERENT punches overlapping — a slip
// thrown mid-combo, a counter into an opponent's punch, is normal and
// expected, and treating it as a problem would just be noise on every real
// session.
//
// "Actionable" is !isForeignLabel(l), NOT !l.foreign — those differ
// exactly for admin, who owns no rows of their own (every row admin sees
// is `foreign: true`) but CAN edit any of them in place. Scoping to
// `!l.foreign` made this card permanently empty for admin, which is
// backwards: admin reviewing everyone else's timing is the main reason to
// have it. A model's prediction is never actionable either way — see
// isForeignLabel(). Round overlaps still group by OWNER even for admin: two
// DIFFERENT people's rounds crossing is normal (independent tracks), only
// the SAME owner's own two rounds stepping on each other is a problem.
// ============================================================
const PROBLEM_MAX_MOVE_DURATION = 8;   // seconds — no real punch/defense move gets anywhere close

// Pairs round_start/round_end markers within one already-filtered list —
// used per-owner below so an overlap check never crosses between two
// different people's independent round tracks.
function pairRoundSpans(labels) {
  const starts = labels.filter(l => l.punch === 'round_start' || (l.isRoundMarker && l.punch?.includes?.('start')))
    .sort((a, b) => a.start - b.start);
  const ends = labels.filter(l => l.punch === 'round_end' || (l.isRoundMarker && l.punch?.includes?.('end')))
    .sort((a, b) => a.start - b.start);
  return starts.map(s => {
    const e = ends.find(x => x.start > s.start);
    return { start: s.start, end: e ? e.start : Infinity, startLabel: s };
  });
}

// Two of the SAME owner's rows, same punch type, start AND end within
// DUPLICATE_EPSILON of each other — a double-click or a re-save landing
// twice, not two genuinely different reps (which are never this close on
// both ends at once; overlap alone is normal — see the header comment).
const DUPLICATE_EPSILON = 0.05;   // seconds

function computeProblems() {
  const problems = [];
  const video = document.getElementById('video-player');
  const duration = video && video.duration ? video.duration : 0;
  const isActionable = (l) => !isForeignLabel(l);
  const ownerOf = (l) => l.foreign ? foreignOwnerName(l) : '';
  const suffix = (l) => l.foreign ? ` (${ownerOf(l)})` : '';

  const moves = state.labels.filter(l => !l.isRoundMarker && isActionable(l));
  for (const l of moves) {
    if (isOutsideRound(l)) {
      problems.push({ label: l, type: 'outside-round', text: `${punchLabel(l.punch)} is outside every round${suffix(l)}` });
    }
    const dur = l.end - l.start;
    // Absolute AND relative-to-video checks: an 8s+ punch is wrong no
    // matter how long the video is, but a shorter video can also produce a
    // "takes the whole video" mistake well under that absolute floor.
    if (dur > PROBLEM_MAX_MOVE_DURATION || (duration > 0 && dur > duration * 0.5)) {
      problems.push({ label: l, type: 'too-long', text: `${punchLabel(l.punch)} lasts ${dur.toFixed(1)}s — looks like a stuck end time${suffix(l)}` });
    }
  }

  // Duplicates, grouped by owner+punch so the O(n²) pair scan only ever
  // compares rows that could plausibly be the same mistake, not the whole
  // video's worth of labels against each other.
  const byOwnerPunch = new Map();
  for (const l of moves) {
    const key = ownerOf(l) + '|' + l.punch;
    if (!byOwnerPunch.has(key)) byOwnerPunch.set(key, []);
    byOwnerPunch.get(key).push(l);
  }
  for (const group of byOwnerPunch.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (Math.abs(a.start - b.start) < DUPLICATE_EPSILON && Math.abs(a.end - b.end) < DUPLICATE_EPSILON) {
          problems.push({ label: b, type: 'duplicate-move', text: `${punchLabel(b.punch)} duplicates the one at ${formatTime(a.start)}${suffix(b)}` });
        }
      }
    }
  }

  const rounds = state.labels.filter(l => l.isRoundMarker && isActionable(l));
  const byOwner = new Map();
  for (const l of rounds) {
    const owner = ownerOf(l);
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(l);
  }
  for (const [owner, ownerLabels] of byOwner) {
    const spans = pairRoundSpans(ownerLabels);
    for (let i = 0; i < spans.length - 1; i++) {
      const a = spans[i], b = spans[i + 1];
      if (a.end > b.start) {
        problems.push({
          label: b.startLabel,
          type: 'round-overlap',
          text: `Round ${i + 1} and Round ${i + 2} overlap (${formatTime(a.end)} vs ${formatTime(b.start)})${owner ? ` (${owner})` : ''}`,
        });
      }
    }
  }

  return problems;
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

  const before = { start: label.start, end: label.end };
  pushUndo({
    label,
    desc: 'Undid edit: ' + (label.punch === 'round_start' ? 'Round Start' : 'Round End'),
    undo: () => {
      Object.assign(label, before);
      renderLabels();
      updateLabelInSheet(label);
    },
  });

  label.start = start;
  label.end = start;

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

  const before = { punch: label.punch, start: label.start, end: label.end };
  pushUndo({
    label,
    desc: 'Undid edit: ' + punchLabel(before.punch),
    undo: () => {
      Object.assign(label, before);
      renderLabels();
      updateLabelInSheet(label);
    },
  });

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
  pushUndo({
    label,
    desc: 'Restored: ' + (label.isRoundMarker
      ? (label.punch === 'round_start' ? 'Round Start' : 'Round End')
      : punchLabel(label.punch)),
    undo: () => {
      // The sheet delete below is a hard row-delete (see doGet's `delete`
      // action) — there's no row left to resurrect, so undo re-creates it
      // the same way the original label was made, and gets a fresh id.
      label.id = null;
      state.labels.splice(idx, 0, label);
      renderLabels();
      if (label.isRoundMarker) pushRoundMarkerToSheet(label);
      else pushLabelToSheet(label).then(() => fetchLabelsFromSheet());
    },
  });
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

// ============================================================
// Undo — Ctrl+Z (and plain Z, same as before), for every mutation this
// labeler makes: adding, deleting, editing or dragging a punch label OR a
// round marker. Each mutator below pushes ONE entry right when it commits
// the change, carrying enough of a snapshot to put it back and re-sync the
// sheet — there's no single global "state before" snapshot, since replaying
// one action at a time (rather than rewinding the whole label set) is what
// lets undo interleave correctly with the outbox/async saves already in
// flight for OTHER labels.
//
// Deliberately scoped to labeling, not general page state (filters, tabs,
// zoom, the labeler name field, ...) — those aren't "did I get this right"
// mistakes the way a label's time or type is, and undoing them would just
// make Ctrl+Z unpredictable for the thing it's actually for.
const UNDO_STACK_LIMIT = 50;

function pushUndo(entry) {
  state.undoStack.push(entry);
  if (state.undoStack.length > UNDO_STACK_LIMIT) state.undoStack.shift();
}

function performUndo() {
  while (state.undoStack.length) {
    const entry = state.undoStack.pop();
    // Guards the same way every other mutation does — see isForeignLabel().
    // Can only fire if admin flips their own identity mid-session (the name
    // field), since undo entries are otherwise always this labeler's own.
    if (isForeignLabel(entry.label)) continue;
    entry.undo();
    showToast(entry.desc, 'info');
    return;
  }
  showToast('Nothing to undo', 'info');
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
    .filter(l => !l.isRoundMarker && !shouldHideByUnsure(l) && !shouldHideByType(l))
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
        if (!e.altKey) {
          e.preventDefault();
          performUndo();
        }
        break;

      // Copy/cut/paste act on whichever label is currently highlighted —
      // the same "selection" a click on a strip or a Labels-panel row
      // already sets (see highlightLabel()). Only intercepted with a
      // modifier held: plain 'C' stays the Duck shortcut below, and with
      // nothing highlighted the browser's own copy/cut for a text
      // selection elsewhere on the page is left alone.
      case 'KeyC':
        if (e.ctrlKey || e.metaKey) {
          if (!state.highlightedLabel || state.highlightedLabel.isRoundMarker) break;
          e.preventDefault();
          copyHighlightedLabel();
        } else {
          selectPunch('duck');
        }
        break;
      case 'KeyX':
        if (e.ctrlKey || e.metaKey) {
          if (!state.highlightedLabel || state.highlightedLabel.isRoundMarker) break;
          e.preventDefault();
          cutHighlightedLabel();
        }
        break;
      case 'KeyV':
        if (e.ctrlKey || e.metaKey) {
          if (!state.clipboardLabel) break;
          e.preventDefault();
          pasteLabelAtPlayhead();
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
      // 'KeyC' (Duck, unmodified) is handled above, merged with the
      // Ctrl+C/copy branch — a switch can't have two cases for the same key.
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
// Same pairing as roundSpans() below, but keeping each boundary's index into
// state.labels — renderRoundStrip needs that to wire up dragging (see
// setupRoundSpanDragging() in ui.js): a round span isn't one row, it's two
// separate round_start/round_end markers, and moving an edge means mutating
// and saving whichever one of those it actually is.
function roundSpansWithIdx() {
  const marks = (which) => state.labels
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => (l.punch === 'round_' + which || (l.isRoundMarker && l.punch?.includes?.(which)))
                     && !isLabelerHidden(l))
    .sort((a, b) => a.l.start - b.l.start);
  const starts = marks('start'), ends = marks('end');
  return starts.map(s => {
    const e = ends.find(x => x.l.start > s.l.start);
    return { start: s.l.start, end: e ? e.l.start : Infinity, startIdx: s.idx, endIdx: e ? e.idx : null };
  });
}

function roundSpans() {
  return roundSpansWithIdx().map(({ start, end }) => ({ start, end }));
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

// Which buckets get a lane, given the Labels-panel tab. The tab is the one
// filter for what you are looking at, so it governs the timeline as well as
// the list: on Defense you get the defensive rows only, and the stack is
// half as tall instead of half empty.
function visibleBuckets() {
  const tabBuckets = state.labelTab === 'combined' ? ['offense', 'defense'] : [state.labelTab];
  // Picked types compose with the tab (see shouldHideByTab): a lane only
  // survives if its bucket is BOTH what the tab shows AND has a picked
  // type in it. On the Offense tab with only "Rear Slip" picked, that's
  // zero lanes — the type and the tab genuinely disagree, same as it would
  // for the list itself.
  if (!state.typeFilter.size) return tabBuckets;
  const picked = new Set([...state.typeFilter].map(punchBucket));
  return tabBuckets.filter(b => picked.has(b));
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
  const buckets = visibleBuckets();
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
    for (const bucket of buckets) {
      const lane = document.createElement('div');
      lane.className = 'seg-lane' + (owner ? ' lane-foreign' : ' lane-own');
      lane.dataset.bucket = bucket;
      const bucketName = bucket === 'offense' ? 'Offense' : 'Defense';
      // With one bucket on screen the tab already says which it is, so the
      // rows are named by WHO — repeating "· Defense" down every lane just
      // costs the width the names need.
      const suffix = buckets.length > 1 ? ' · ' + bucketName : '';
      if (owner) {
        lane.dataset.owner = owner;
        lane.style.setProperty('--lane-tint', labelerColor(owner));
        lane.dataset.laneLabel = owner + suffix;
        lane.setAttribute('aria-label', owner + ' ' + bucketName);
      } else {
        // "You" only earns its place once somebody else has a lane too —
        // on a video only you have labeled it would be noise.
        lane.dataset.laneLabel = owners.length ? 'You' + suffix : bucketName;
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
      // Read by setupRoundSpanDragging() in ui.js — a round span is really
      // two separate round_start/round_end rows, not one, so dragging an
      // edge needs to know which state.labels index that edge actually is.
      // '' (not omitted) when there's no closing/opening marker, so the
      // dataset key is never left pointing at a stale index from a
      // previous render.
      span.dataset.startIdx = r.startIdx != null ? r.startIdx : '';
      span.dataset.endIdx = r.endIdx != null ? r.endIdx : '';
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

// The lanes/minimap need SOME duration to turn a label's start/end into a
// percentage — normally video.duration. But the sheet answers as soon as a
// Drive link is pasted, well before a local video file is picked (the two
// are separate steps now — see the reorder in index.html), and the labels
// it returns are worth seeing immediately rather than waiting on a file
// dialog. So: fall back to the furthest label end when there's no real
// video yet. Real video.duration takes over the moment loadedmetadata fires
// (player.js calls renderTimelineOverlay() there) and every position is
// redrawn to scale, so the fallback only ever matters for this in-between
// window.
function getTimelineDuration() {
  const video = document.getElementById('video-player');
  if (video.duration && video.duration > 0) return video.duration;
  let maxEnd = 0;
  for (const l of state.labels) {
    const end = Number.isFinite(l.end) ? l.end : l.start;
    if (Number.isFinite(end) && end > maxEnd) maxEnd = end;
  }
  // Cosmetic headroom so the last strip isn't flush against the right edge.
  return maxEnd > 0 ? maxEnd * 1.02 : 0;
}

function renderTimelineOverlay() {
  refreshAgreedLabelCache();
  const overlay = document.getElementById('seek-bar-overlay');
  // Round-boundary flags are TWO layers, not one: #round-markers sits inside
  // #seg-lanes and zooms with it; #round-markers-scrub sits inside #scrub and
  // stays fixed to the always-full-range track. Same data, two coordinate
  // systems — see the timeToScrubPct() comment above.
  const markersLayer = document.getElementById('round-markers');
  const markersScrub = document.getElementById('round-markers-scrub');
  const video = document.getElementById('video-player');
  const duration = getTimelineDuration();
  overlay.innerHTML = '';
  // Rebuilt every repaint, same as the strips themselves — which owners are
  // visible can change between two of them (a hide, a reorder, phase 2 of a
  // load landing).
  const laneMap = buildSegLanes(document.getElementById('seg-lanes'), markersLayer, overlay);
  if (markersLayer) markersLayer.innerHTML = '';
  if (markersScrub) markersScrub.innerHTML = '';
  if (!duration || duration <= 0) return;

  // One shared definition — see roundSpansWithIdx(). An unclosed round comes
  // back as Infinity; on screen it runs to the end of the video.
  const rounds = roundSpansWithIdx().map(r => ({
    start: r.start,
    end: Number.isFinite(r.end) ? r.end : duration,
    startIdx: r.startIdx,
    endIdx: r.endIdx,
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
    // per-frame during drag, and only the unsure-filter half applies here.
    if (state.unsureFilter && label.punch !== 'unsure') return;
    // Picked types, inlined for the same reason — composes with the tab
    // check below rather than replacing it (see shouldHideByTab()).
    if (state.typeFilter.size && !state.typeFilter.has(label.punch)) return;
    // Agreement filter, same composing treatment as Types above.
    if (shouldHideByAgreement(label)) return;
    // The Labels tab hides whole lanes (see visibleBuckets); without this
    // the strips for the hidden bucket would fall through to the fallback
    // lookup below and land in the wrong lane.
    if (state.labelTab !== 'combined' && punchBucket(label.punch) !== state.labelTab) return;
    const lPct = timeToViewportPct(label.start, duration);
    const rPct = timeToViewportPct(label.end, duration);
    if (rPct < 0 || lPct > 100) return;
    const seg = document.createElement('div');
    // rm-foreign-style muting for a strip pulled read-only from another
    // labeler's sheet — ui.js's own isForeignLabel() checks already keep it
    // undraggable; this just keeps it from looking like something you can
    // grab. Admin drags it like any other strip, so it skips the muting —
    // except a prediction, which stays muted for admin too (isPrediction
    // has no admin bypass — see isForeignLabel()).
    seg.className = 'seek-segment'
      + (label.isPrediction || (label.foreign && !state.isAdmin) ? ' seg-foreign' : '')
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
      const readOnly = label.isPrediction || !state.isAdmin;
      seg.title = moveTitle + '\n' + (readOnly ? owner + ' (read-only)' : owner);
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

  // Count each lane's own strips AFTER the filtering above already ran —
  // this is what's actually drawn on THAT row right now, not a video-wide
  // total, so a Types pick or the Unsure filter narrows the number here
  // exactly as it narrows the strips themselves. lane.children are only
  // ever the .seek-segment divs just appended, so its own length is the
  // count — no separate tally needed. Appended to the label ::before
  // already reads via attr(data-lane-label) — see .seg-lane::before.
  if (laneMap) {
    for (const lane of laneMap.values()) {
      lane.dataset.laneLabel += ` (${lane.children.length})`;
    }
  }

  renderMinimap();
  updateMinimapChrome();
  renderTimeTicks();
}

function renderMinimap() {
  const duration = getTimelineDuration();
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
    if (state.typeFilter.size && !state.typeFilter.has(label.punch)) continue;
    if (shouldHideByAgreement(label)) continue;
    if (state.labelTab !== 'combined' && punchBucket(label.punch) !== state.labelTab) continue;
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

  // skeleton.js is optional (loads after player.js, before this file) —
  // guarded so a stale cache or a future page without it still works.
  if (typeof drawSkeletonFrame === 'function') drawSkeletonFrame(t);

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
    t >= l.start && t <= l.end && !shouldHideByUnsure(l) && !shouldHideByType(l)
  );

  const roundKey = currentRound ? 'R' + currentRound : 'out';
  const key = roundKey + '|' + activeLabels.map(l => l.id).join(',') + '|' + state.unsureFilter + '|' + state.showForeign +
    '|' + [...state.typeFilter].join(',');
  if (overlay.dataset.activeKey === key) return;
  overlay.dataset.activeKey = key;

  highlightActiveMoveButtons(activeLabels);

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

// Lights up whichever Move Type button(s) match what's playing right now —
// a jab crossing the playhead highlights Jab in the catalogue the same way
// the video-overlay tag above already calls it out over the picture, just
// on the OTHER side of the screen where the catalogue lives. Cell buttons
// (the offense matrix's Head/Body pair) share .punch-btn + data-punch-id
// with the named ones, so this reaches both without knowing which kind a
// given punch id renders as.
function highlightActiveMoveButtons(activeLabels) {
  const activeIds = new Set(activeLabels.map(l => l.punch));
  document.querySelectorAll('.punch-btn').forEach((btn) => {
    const isActive = activeIds.has(btn.dataset.punchId);
    btn.classList.toggle('playing-now', isActive);
    if (isActive) btn.style.setProperty('--play-color', getPunchColor(btn.dataset.punchId));
  });
}

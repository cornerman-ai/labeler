// ============================================================
// ui.js — the chrome every labeler page with a video shares: the transport
// row's icons, the volume pop-up and the speed menu, the timeline's
// scroll-to-zoom (and ⌘+ / ⌘− / ⌘0), its always-full scrub track and
// click-to-seek, the picture zoom, the collapsible video-source rows, the
// click-to-type time, the link and video status chips, the name field and
// the shortcuts sheet. Moved out of punch/ui.js on 2026-09-19 so the
// unusable-footage labeler runs the same code instead of a copy; punch/ui.js
// keeps what only the punch page has (dragging strips, round spans, the
// strip's context menu).
//
// Everything in here is presentation over shared/player.js's globals —
// nothing touches a page's labels or its Apps Script. Every setup returns
// when its elements are missing, so a page opts in by carrying the markup
// (the ids are the punch page's). Loaded LAST — after the page's app.js and,
// on the punch page, after punch/ui.js: setupZoomedClickToSeek() has to
// register its capture-phase click listener after setupSegmentEditing()'s
// (same element, same phase — registration order decides), and the setups
// that read a page's restored state need that page's own DOMContentLoaded
// handler to have run.
// ============================================================

(function () {
  const $ = (id) => document.getElementById(id);

  // Status glyphs for the two .src-field rows — the video file's "Loaded"
  // and the link's "Saved" / "Checking…" / error. Shared so the two rows
  // can't drift apart visually.
  const GLYPH = {
    ok:   '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.4 6.3 4.7 8.6 9.6 3.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    err:  '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 1.4 11.4 10.6H.6L6 1.4Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 5v2.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="6" cy="8.8" r=".75" fill="currentColor"/></svg>',
    sync: '<svg class="spin" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="4.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="20 7"/></svg>',
  };

  // Replace a global from player.js with a version that also repaints our
  // chrome. player.js declares these with `function`, so they live on window
  // and every caller — app.js's keyboard handler, the inline onclick
  // attributes — resolves them through it at CALL time and gets the wrapper.
  // Cheaper than forking shared/player.js, which eight other pages still use.
  function wrap(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function (...args) { const r = orig.apply(this, args); after(...args); return r; };
  }

  const ICON = {
    play:  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.2 3.4a.6.6 0 0 1 .92-.5l6 4.1a.6.6 0 0 1 0 1l-6 4.1a.6.6 0 0 1-.92-.5V3.4Z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4.3" y="3.3" width="2.7" height="9.4" rx=".9"/><rect x="9" y="3.3" width="2.7" height="9.4" rx=".9"/></svg>',
    sound: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8.3 2.9 5.2 5.4H2.9v5.2h2.3l3.1 2.5V2.9Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M10.8 5.8a3 3 0 0 1 0 4.4M12.6 3.9a5.6 5.6 0 0 1 0 8.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    muted: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8.3 2.9 5.2 5.4H2.9v5.2h2.3l3.1 2.5V2.9Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="m11 6.2 3.1 3.6M14.1 6.2 11 9.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  };

  // ── transport icons ───────────────────────────────────────────────────
  // player.js writes the WORDS "Play"/"Pause" into #btn-play and a speaker
  // emoji into #btn-mute. Both are the wrong register beside a row of stroked
  // SVG icons, and the word swap makes the button change width mid-press. We
  // let it write, then paint over it in the same frame (via wrap(), so there
  // is no flash) and again on the video's own play/pause events, which also
  // fire when stepFrames() pauses playback behind our back.
  // Hoisted so the volume slider can drive the speaker glyph too — dragging to
  // zero has to look muted, not just sound muted.
  let paintMute = () => {};

  function setupTransportIcons() {
    const video = $('video-player'), play = $('btn-play'), mute = $('btn-mute');
    if (!video) return;

    const paintPlay = () => {
      if (!play) return;
      const playing = !video.paused && !video.ended;
      play.innerHTML = playing ? ICON.pause : ICON.play;
      play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    };
    paintMute = () => {
      if (!mute) return;
      const silent = video.muted || video.volume === 0;
      mute.innerHTML = silent ? ICON.muted : ICON.sound;
      mute.setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
      // The tooltip is where the volume control announces itself — the slider
      // only appears on hover, so something has to say it is there.
      mute.title = silent
        ? 'Muted — click to unmute'
        : 'Volume ' + Math.round(video.volume * 100) + '% — click to mute';
    };

    wrap('togglePlay', paintPlay);
    wrap('toggleMute', paintMute);
    wrap('stepFrames', paintPlay);          // stepFrames() pauses the video
    video.addEventListener('play', paintPlay);
    video.addEventListener('pause', paintPlay);
    video.addEventListener('ended', paintPlay);
    paintPlay(); paintMute();
  }

  // ── volume ────────────────────────────────────────────────────────────
  // 0–100 on a slider, the way every other piece of software does it. Kept in
  // localStorage because a volume you set once should not come back at 100 on
  // the next video — the tool is used for hours at a stretch.
  const VOL_KEY = 'punch_volume';

  function setupVolume() {
    const video = $('video-player'), range = $('vol-range'), val = $('vol-val');
    if (!video || !range) return;

    const paint = () => {
      const pct = Math.round((video.muted ? 0 : video.volume) * 100);
      range.value = pct;
      if (val) val.textContent = pct;
      // Drives the track's filled portion — the fill is the reading.
      range.style.setProperty('--pct', pct + '%');
      range.setAttribute('aria-valuetext', pct + '%');
      paintMute();
    };

    const setVolume = (v, fromSlider) => {
      v = Math.min(1, Math.max(0, v));
      video.volume = v;
      // Dragging to zero IS muting, and nudging up from a muted state is
      // unmuting — otherwise the slider and the speaker button disagree about
      // whether anything is audible.
      video.muted = v === 0;
      // Only remember a level worth restoring: reopening the tool at 0 would
      // look like broken audio.
      if (v > 0) { try { localStorage.setItem(VOL_KEY, String(v)); } catch {} }
      paint();
      if (!fromSlider) showToast('Volume ' + Math.round(v * 100) + '%', 'info');
    };

    range.addEventListener('input', () => setVolume(+range.value / 100, true));

    // Unmuting with the button should restore the level you had, not leave the
    // slider sitting at whatever volume happened to be underneath a 0.
    wrap('toggleMute', () => {
      if (!video.muted && video.volume === 0) video.volume = restored() || 1;
      paint();
    });

    function restored() {
      const s = parseFloat(localStorage.getItem(VOL_KEY) || '');
      return Number.isFinite(s) && s > 0 ? s : 0;
    }

    // Up / Down are free — app.js's keyboard handler only claims Left/Right.
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
      const t = e.target;
      // Let the slider (and any text field) keep its own native arrow handling.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      setVolume(video.volume + (e.code === 'ArrowUp' ? 0.05 : -0.05));
    });

    video.volume = restored() || 1;
    paint();
  }

  // ── playback speed ────────────────────────────────────────────────────
  // Six rates behind a pop-up menu instead of four permanent buttons. This
  // list is the single source of truth: the menu is built from it, and app.js
  // reads it for the Shift+< / Shift+> cycle, so the keyboard and the menu
  // step through exactly the same values.
  // 0.1× is below the rate at which browsers keep audio going (they mute under
  // ~0.25), which is fine — this is frame-hunting speed for finding the exact
  // start of a punch, and nobody is listening at that point.
  const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 5];
  const fmt = (r) => r + '×';

  function setupSpeed() {
    const btn = $('speed-btn'), menu = $('speed-menu'), val = $('speed-val');
    const video = $('video-player');
    if (!btn || !menu || !video) return;
    window.PUNCH_SPEEDS = SPEEDS;   // app.js's Shift+</> cycle reads this

    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    const paint = () => {
      const r = video.playbackRate;
      val.textContent = fmt(r);
      // Off the default rate the button tints, so a 2x pass left running is
      // visible without reading the number.
      btn.classList.toggle('off-normal', Math.abs(r - 1) > 0.001);
      for (const b of menu.children) {
        b.setAttribute('aria-checked', String(Math.abs(+b.dataset.rate - r) < 0.001));
      }
    };

    for (const r of SPEEDS) {
      const b = document.createElement('button');
      b.type = 'button'; b.role = 'menuitemradio'; b.dataset.rate = String(r);
      b.textContent = fmt(r);
      b.onclick = () => { setSpeed(r); close(); };   // wrapped below → repaints
      menu.appendChild(b);
    }

    // The menu is anchored to the TOP of the button and grows upward, so what
    // bounds it is the gap between the window's top edge and the button — not
    // the window height, and not anything CSS can express. Nine coarse-pointer
    // rows are 410px; a short window has less room than that above the
    // transport row, and without this the first rates scroll off the top with
    // no way to reach them.
    const open = () => {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      menu.style.maxHeight = Math.max(132, btn.getBoundingClientRect().top - 12) + 'px';
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden ? open() : close();
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) close();
    });

    // Covers the menu, the keyboard cycle and anything else that calls it.
    wrap('setSpeed', paint);
    paint();
  }

  // ── video zoom ────────────────────────────────────────────────────────
  // Scroll to magnify the picture at the pointer, drag to pan, double-click to
  // reset. Not a canvas — a CSS transform on the <video> itself, which costs
  // nothing, keeps playback and every existing control working untouched, and
  // leaves the HUD overlays (siblings of the video, pinned to the viewport)
  // sitting still while the picture moves under them.
  // ── timeline zoom without Alt ──────────────────────────────────────────
  // player.js's own #seek-bar-wrapper wheel handler (shared/player.js, never
  // edited here) only zooms on Alt+scroll; a plain scroll does nothing until
  // the timeline is already zoomed in, at which point it pans. That's an
  // undiscoverable first step — nobody finds Alt+scroll on their own — and
  // it's the one gesture that already works differently just one element
  // over, on the video (plain scroll zooms there, no modifier).
  // This makes plain scroll zoom here too, over the WHOLE wrapper — ticks,
  // both punch lanes, and the scrub track together, in one call, which is
  // what keeps them synchronized: there is only one state.zoomLevel /
  // zoomCenter, shared by everything renderTimelineOverlay() draws, so
  // "zoom the lanes" and "zoom the ticks and scrub" were never two things
  // that could drift apart — they just had no shared way to be TRIGGERED
  // without Alt. Shift+scroll keeps panning available now that plain scroll
  // means zoom instead (same job the old zoomed-in plain-scroll did).
  // Registered on the CAPTURE phase specifically so it runs and calls
  // stopImmediatePropagation() before player.js's own bubble-phase listener
  // (also on this element) gets a turn — otherwise both would fire on the
  // same scroll and zoom twice, or fight over zoom vs. pan.
  // shared/player.js caps timeline zoom at 32x, which is plenty for most
  // punches but not enough to see individual FRAMES on a multi-minute clip —
  // on a 3-minute video, 32x still shows ~5.6s per screen; getting down to
  // where a single frame reads as a real width on screen takes something
  // over 100x. Full replacement (not a wrap()-after) because the cap is
  // enforced INSIDE the original function's own math, before anything a
  // wrap could repaint over; every caller (zoomIn()/zoomOut(), both wheel
  // handlers, this page's own) resolves `setZoom` by name at call time, so
  // reassigning the global here is enough — nothing needs to know it moved.
  function setupBiggerTimelineZoom() {
    const MAX = 300;
    window.setZoom = function (newLevel, anchorNormalized) {
      const oldVp = getViewport();
      const oldSpan = oldVp.end - oldVp.start;
      const anchorFrac = oldSpan > 0 ? (anchorNormalized - oldVp.start) / oldSpan : 0.5;
      state.zoomLevel = Math.max(1, Math.min(MAX, newLevel));
      const newHalfSpan = 0.5 / state.zoomLevel;
      state.zoomCenter = anchorNormalized - (anchorFrac - 0.5) * 2 * newHalfSpan;
      clampZoomCenter();
    };
  }

  // ── the scrub track: always start-to-end, never zoomed ────────────────
  // shared/player.js drives the scrub bar's thumb position, click-to-seek,
  // native drag and wheel-zoom all off the SAME zoomed viewport the punch
  // lanes use (state.zoomLevel/zoomCenter, via
  // getViewport()) — never edited here, but this page wants the two
  // decoupled: the lanes are the zoomed detail view, the scrub track is the
  // one thing that ALWAYS shows the whole video, so there is always one
  // reliable "where am I in the whole thing" line no matter how far zoomed
  // in the lanes above are. app.js's renderTimelineOverlay() already paints
  // the round-shading and round-flags onto it with plain duration math
  // (timeToScrubPct) to match; this is the interactive half of the same
  // idea — everything a person can click, drag, or hover on the track.
  //
  // #scrub is a genuine DESCENDANT of #seek-bar-wrapper, which is where
  // player.js's click/mousemove listeners live — so a capture-phase listener
  // registered here on #scrub legitimately runs first (capture travels root
  // → wrapper → scrub → target, before the wrapper's own bubble-phase
  // listener ever gets a turn), and stopImmediatePropagation() there stops
  // player.js's version from firing at all. #seek-bar's own 'input' event is
  // the one exception: that listener is on the SAME element as player.js's,
  // not an ancestor, and same-target listeners fire in registration order
  // regardless of the capture flag — so mine (added after, at page load)
  // runs SECOND and just overwrites video.currentTime with the correct
  // value. Both listeners running synchronously in the same tick means the
  // wrong intermediate value never reaches a paint — no flicker, no visible
  // double-seek, nothing to gain from fighting the ordering.
  // ── click the zoomed region (ticks or lanes) to jump there ─────────────
  // The ruler used to be pointer-events:none — decoration naming the current
  // zoomed window, nothing you could act on. It sits right above the punch
  // lanes and shows exactly the same (zoomed) time scale they do, so a click
  // there — or on the lanes themselves — seeks using the SAME
  // viewportPctToTime math the timeline is drawn with, not the always-full-
  // range math #scrub uses (see setupScrubOverview() below).
  //
  // This has to intercept before player.js's own #seek-bar-wrapper click
  // listener runs, not just duplicate its math: that listener sets
  // video.currentTime correctly (it already calls viewportPctToTime()) but
  // then also does `seekBar.value = (x / rect.width) * 1000` — the click's
  // raw pixel fraction of the wrapper, treated as if it were a fraction of
  // the WHOLE video. At any zoom above 1x those are different numbers, so
  // the scrub thumb below jumped to the pixel-fraction spot first and only
  // reached the right one a tick later, when the next timeupdate repainted
  // it correctly — a visible flash-then-correct for however long that gap
  // was. Running in the capture phase, ahead of player.js's own bubble-
  // phase listener, and setting seekBar.value from the SAME correct time
  // this listener just computed removes the wrong intermediate value
  // entirely rather than racing to overwrite it.
  //
  // Must run AFTER setupSegmentEditing() registers its own capture-phase
  // click listener on this same element: same-target listeners fire in
  // registration order regardless of the capture flag, and that one is what
  // suppresses the click a drag-release fires — if this one ran first it
  // would re-seek right through that suppression. #scrub (unzoomed, handled
  // entirely by setupScrubOverview()) and the round controls (which seek to
  // their own exact boundary, not wherever was clicked) are left alone so
  // their own, already-correct listeners still run.
  function setupZoomedClickToSeek() {
    const wrapper = $('seek-bar-wrapper'), seekBar = $('seek-bar'), video = $('video-player');
    if (!wrapper || !seekBar || !video) return;
    wrapper.addEventListener('click', (e) => {
      if (!video.duration) return;
      // .round-span / .round-tick replaced the old .round-mark flags when
      // rounds became spans in their own ribbon — see renderRoundStrip().
      if (e.target.closest('#scrub') || e.target.closest('.prob-no-seek') ||
          e.target.closest('.round-span') || e.target.closest('.round-tick')) return;
      e.stopImmediatePropagation();
      const rect = seekBar.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const pct = (x / rect.width) * 100;
      const time = Math.max(0, Math.min(video.duration, viewportPctToTime(pct, video.duration)));
      video.currentTime = time;
      seekBar.value = (time / video.duration) * 1000;
    }, { capture: true });
  }

  function setupScrubOverview() {
    const scrub = $('scrub'), seekBar = $('seek-bar'), video = $('video-player');
    if (!scrub || !seekBar || !video) return;

    seekBar.addEventListener('input', () => {
      if (!video.duration) return;
      video.currentTime = (seekBar.value / 1000) * video.duration;
    });

    scrub.addEventListener('click', (e) => {
      if (!video.duration) return;
      e.stopImmediatePropagation();
      const rect = seekBar.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const pct = x / rect.width;
      video.currentTime = Math.max(0, Math.min(video.duration, pct * video.duration));
      seekBar.value = pct * 1000;
    }, { capture: true });

    // The slider thumb's resting position: player.js's updateTimeDisplay()
    // sets seekBar.value from the zoomed viewport on every timeupdate;
    // repaint it immediately after with the plain full-video fraction instead.
    wrap('updateTimeDisplay', () => {
      if (!video.duration) return;
      seekBar.value = (video.currentTime / video.duration) * 1000;
    });
  }

  function setupTimelineWheelZoom() {
    const wrapper = $('seek-bar-wrapper'), seekBar = $('seek-bar'), video = $('video-player');
    if (!wrapper || !seekBar || !video) return;

    wrapper.addEventListener('wheel', (e) => {
      if (!video.duration) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      const rect = seekBar.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const pct = x / rect.width;

      if (e.shiftKey && state.zoomLevel > 1) {
        const panAmount = (e.deltaY > 0 ? 0.15 : -0.15) / state.zoomLevel;
        state.zoomCenter += panAmount;
        clampZoomCenter();
        onZoomChanged();
        return;
      }

      const vp = getViewport();
      const anchorNorm = vp.start + pct * (vp.end - vp.start);
      const factor = e.deltaY < 0 ? 1.4 : 1 / 1.4;
      setZoom(state.zoomLevel * factor, anchorNorm);
      onZoomChanged();
    }, { capture: true, passive: false });
  }

  function setupVideoZoom() {
    const viewport = $('video-viewport'), video = $('video-player');
    const badge = $('video-zoom-badge');
    if (!viewport || !video) return;

    const MIN = 1, MAX = 12, SHARP_AT = 4;
    let z = 1, tx = 0, ty = 0;

    // The scaled picture must always cover the box the unscaled picture had:
    // tx <= 0 keeps its left edge from sliding inward, and tx >= w*(1-z) keeps
    // its right edge from doing the same. So the letterbox bars stay exactly
    // where they were and no blank ever opens up inside the frame.
    const clamp = () => {
      const w = video.offsetWidth, h = video.offsetHeight;
      tx = Math.min(0, Math.max(w * (1 - z), tx));
      ty = Math.min(0, Math.max(h * (1 - z), ty));
    };

    const apply = () => {
      clamp();
      video.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
      const on = z > 1.001;
      video.classList.toggle('sharp', z >= SHARP_AT);
      viewport.classList.toggle('zoomed', on);
      if (badge) { badge.hidden = !on; badge.textContent = z.toFixed(1) + '×'; }
      // skeleton.js's canvas tracks #video-player's rendered box, but it
      // only repositions from a video 'timeupdate'/requestVideoFrameCallback
      // — neither of which fires from a zoom while paused. Without this the
      // overlay stayed put wherever it last drew and the picture zoomed out
      // from under it. drawSkeletonFrame() re-measures the box AND redraws
      // in one call, so this is enough even while playing.
      if (typeof drawSkeletonFrame === 'function') drawSkeletonFrame(video.currentTime);
    };

    const reset = () => { z = 1; tx = 0; ty = 0; apply(); };

    // Zoom about the pointer: find the picture-local point under it, then pick
    // the offset that puts that same point back under it at the new scale.
    const zoomAt = (clientX, clientY, factor) => {
      const before = z;
      z = Math.min(MAX, Math.max(MIN, z * factor));
      if (z === before) return false;
      const box = viewport.getBoundingClientRect();
      const cx = clientX - box.left - video.offsetLeft;
      const cy = clientY - box.top - video.offsetTop;
      const px = (cx - tx) / before, py = (cy - ty) / before;
      tx = cx - px * z;
      ty = cy - py * z;
      apply();
      return true;
    };

    viewport.addEventListener('wheel', (e) => {
      if (!video.videoWidth) return;
      // preventDefault ONLY when the zoom actually moved. At 1x scrolling out
      // is a no-op, and swallowing it there would trap the page scroll under
      // the video in the stacked narrow layout.
      if (zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.2 : 1 / 1.2)) e.preventDefault();
    }, { passive: false });

    let panning = false, panMoved = false, lastX = 0, lastY = 0;
    viewport.addEventListener('mousedown', (e) => {
      if (z <= 1.001 || e.button !== 0 || e.target === badge) return;
      panning = true; panMoved = false; lastX = e.clientX; lastY = e.clientY;
      viewport.classList.add('panning');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!panning) return;
      panMoved = true;
      tx += e.clientX - lastX; ty += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      apply();
    });
    window.addEventListener('mouseup', () => {
      panning = false; viewport.classList.remove('panning');
    });

    // Click the video to play/pause — a drag still fires a native 'click' on
    // release, so a pan that actually moved suppresses the one click right
    // after it (once); a plain click while zoomed, with no drag, still toggles.
    video.addEventListener('click', () => {
      if (panMoved) { panMoved = false; return; }
      togglePlay();
    });

    viewport.addEventListener('dblclick', (e) => { e.preventDefault(); reset(); });
    if (badge) badge.addEventListener('click', reset);
    // A new file is a new picture; carrying 8x into it would look like a bug.
    video.addEventListener('loadedmetadata', reset);
    // The video is centred by flex, so its offsetLeft/Top move when the window
    // does — re-clamping keeps a panned picture from drifting off its own box.
    window.addEventListener('resize', apply);
  }

  // ── fold the drive-link/video/skeletons/predictions rows away ──────────
  // Four rows is a lot of permanent vertical space once they're all set up
  // and nothing in them needs another look. One toggle for the whole
  // block (not per-row — the four rows together answer one question, "what
  // video is this and what's overlaid on it"), collapsing to just the
  // header line. Remembered in localStorage, same as everything else here
  // that shouldn't reset on every reload.
  function setupVideoSourceFold() {
    const btn = $('video-source-toggle'), rows = $('video-source-rows');
    if (!btn || !rows) return;
    const KEY = 'videoSourceCollapsed';
    const apply = (collapsed) => {
      rows.hidden = collapsed;
      btn.setAttribute('aria-expanded', String(!collapsed));
    };
    apply(localStorage.getItem(KEY) === 'true');
    btn.addEventListener('click', () => {
      const collapsed = !rows.hidden;
      apply(collapsed);
      localStorage.setItem(KEY, String(collapsed));
    });
  }

  // Generic version of the same collapse-and-remember pattern above, for the
  // move catalogue sidebar's own two panel-wide folds (Move Type, Session —
  // see #move-type-toggle/#session-toggle in index.html). One level IN from
  // these — Offense/Defense/Other, each folding independently — is state
  // (state.collapsedMoveGroups), not just localStorage, because
  // buildPunchButtons() (app.js) rebuilds those from scratch on every
  // language switch and has to know their collapsed state to reapply it;
  // these two never rebuild, so plain localStorage is enough.
  function setupFold(btnId, contentId, storageKey) {
    const btn = $(btnId), content = $(contentId);
    if (!btn || !content) return;
    const apply = (collapsed) => {
      content.hidden = collapsed;
      btn.setAttribute('aria-expanded', String(!collapsed));
    };
    apply(localStorage.getItem(storageKey) === 'true');
    btn.addEventListener('click', () => {
      const collapsed = !content.hidden;
      apply(collapsed);
      localStorage.setItem(storageKey, String(collapsed));
    });
  }

  // ── click the timecode to jump to it ──────────────────────────────────
  // The transport row's time display used to be read-only, but it is the
  // most precise place on the page to name a moment — typing "1:23.5" beats
  // scrubbing for a punch you already know the rough time of.
  //
  // Swaps the readout span for a text input IN PLACE (the pill's own width
  // is fixed, so nothing else in the row moves). player.js's
  // updateTimeDisplay() writes to #time-display by id every timeupdate;
  // while editing we strip that id off the span so its own `if (display) …`
  // guard skips the write instead of overwriting the input mid-keystroke.
  function setupTimeEdit() {
    const wrap = $('time-wrap'), disp = $('time-display'), input = $('time-edit');
    const video = $('video-player');
    if (!wrap || !disp || !input || !video) return;

    const enter = () => {
      if (input.hidden === false) return;   // already editing
      input.value = formatTime(video.currentTime);
      disp.hidden = true;
      disp.removeAttribute('id');
      input.hidden = false;
      input.focus();
      input.select();
    };
    const exit = () => {
      input.hidden = true;
      disp.id = 'time-display';             // player.js resumes writing to it
      disp.hidden = false;
      updateTimeDisplay();                  // repaint immediately, don't wait for the next tick
    };
    // Returns whether the field held a usable time — the two callers (Enter,
    // blur) react to a bad value differently, so this only does the parsing.
    const trySeek = () => {
      const t = parseTime(input.value);     // from player.js — same parser the
      if (isNaN(t)) return false;           // side-panel start/end fields use
      if (video.duration) video.currentTime = Math.max(0, Math.min(video.duration, t));
      return true;
    };

    wrap.addEventListener('click', enter);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // A bad value on Enter stays open for correction, with the field
        // reselected — the same recoverable-error shape saveEditLabel() uses
        // for the side panel's own start/end inputs.
        if (trySeek()) exit();
        else { showToast('Invalid time — try M:SS.mmm or seconds', 'error'); input.select(); }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        exit();                              // no seek — this is a cancel
      }
      // app.js's document-level shortcuts already ignore INPUT targets; this
      // just keeps that contract from depending on every future listener
      // remembering to check it too.
      e.stopPropagation();
    });
    // Clicking away commits if the field happens to parse and silently drops
    // it otherwise — leaving with a bad value is not something to interrupt
    // for, unlike pressing Enter on one.
    input.addEventListener('blur', () => { trySeek(); exit(); });
  }

  // ── drive link status ─────────────────────────────────────────────────
  // The link is the KEY every label is filed under, and nothing on screen ever
  // said whether it had registered — you pasted a URL and hoped. app.js calls
  // in here from fetchLabelsFromSheet(), the one place that knows whether the
  // sheet actually answered for that link.
  //
  // This one is a STANDING state, not the 1.8s flash the name field gets: "is
  // my link being counted" is a question you can ask at any moment, so the
  // answer has to still be on screen when you look.
  function setupLinkStatus() {
    const input = $('drive-link');
    // .closest, NOT document.querySelector('.src-field'): the video row is
    // the same component and sits FIRST in the DOM, so a bare class lookup
    // would tint that row on every link status change.
    const field = input && input.closest('.src-field');
    const out = $('link-status');
    if (!field || !input || !out) return;

    window.setLinkStatus = (kind, detail) => {
      field.classList.remove('ok', 'err', 'syncing');
      if (!input.value.trim() || kind === 'idle') { out.hidden = true; out.textContent = ''; return; }
      out.hidden = false;
      if (kind === 'syncing') {
        field.classList.add('syncing');
        out.innerHTML = GLYPH.sync + '<span>Checking…</span>';
        field.title = 'Checking this link against the sheet…';
      } else if (kind === 'ok') {
        field.classList.add('ok');
        // Just "Saved". The row count that used to hang off it answered a
        // question nobody was asking here — the label list one panel over
        // already shows what is in the sheet — and it made the confirmation
        // something to read rather than something to glance at.
        out.innerHTML = GLYPH.ok + '<span>Saved</span>';
        field.title = 'Labels are being filed under this link.';
      } else {
        field.classList.add('err');
        // A dead end otherwise: the sheet being slow is usually transient,
        // and re-triggering the lookup used to mean editing the link to make
        // app.js's `input` debounce fire again.
        out.innerHTML = GLYPH.err + '<span>' + (detail || 'Not saved') +
          '</span><button type="button" class="link-retry">Retry</button>';
        field.title = 'This link did not reach the sheet — labels may not be filed.';
      }
    };

    // Delegated, because setLinkStatus() rewrites this subtree on every
    // state change. preventDefault matters: the chip lives inside the
    // <label for="drive-link">, so an unhandled click would just focus the
    // input instead.
    out.addEventListener('click', (e) => {
      const retry = e.target.closest('.link-retry');
      if (!retry) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof fetchLabelsFromSheet === 'function') fetchLabelsFromSheet(true);
    });

    // Typing invalidates whatever the chip last said. app.js debounces the
    // lookup by 500ms and will put it back into 'syncing' when it fires.
    input.addEventListener('input', () => window.setLinkStatus('idle'));
  }

  // ── labeler name ──────────────────────────────────────────────────────
  // labeler_name.js owns the store and hides its own strip on this page
  // (punch.css). Committing here writes through to that same store, so the
  // name stays shared with every other labeler in the suite.
  function setupName() {
    const field = $('name-field'), input = $('labeler-input');
    if (!field || !input) return;

    const current = () => (window.CMLabeler ? window.CMLabeler.get() : '') || '';

    // Green CONFIRMS a change; it is not a resting state. Painting the field
    // green on every load made the name the most saturated thing in the
    // navigation bar for as long as the tab was open, saying "just saved"
    // about something saved weeks ago. It now flashes for a moment after an
    // actual commit and then goes quiet.
    let savedTimer = null;
    const flashSaved = () => {
      field.classList.add('saved');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => field.classList.remove('saved'), 1800);
    };

    if (current()) input.value = current();

    const isAdminName = (n) => String(n || '').toLowerCase() === 'admin';

    const commit = () => {
      const v = input.value.trim();
      if (!v || !window.CMLabeler) return;
      if (v === current()) return;
      const wasAdmin = isAdminName(current());
      window.CMLabeler.set(v);
      input.value = current();
      // Admin-ness is decided once, at DOMContentLoaded: it gates what the
      // catalogue lets you do, which endpoints the page calls, and whether
      // the agreement panel exists. Switching into or out of it mid-session
      // left a page half-configured for the other role, so the identity
      // change is committed by reloading into it.
      if (wasAdmin !== isAdminName(current())) {
        if (typeof showToast === 'function') {
          showToast(isAdminName(current()) ? 'Entering admin mode…' : 'Leaving admin mode…', 'info');
        }
        setTimeout(() => location.reload(), 350);
        return;
      }
      flashSaved();
      if (typeof showToast === 'function') {
        showToast('Saving labels as ' + current(), 'success');
      }
    };

    input.addEventListener('input', () => {
      clearTimeout(savedTimer);
      field.classList.remove('saved');
    });
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
  }

  // ── shortcuts sheet ───────────────────────────────────────────────────
  // The bindings used to live in a permanent strip across the foot of the
  // page. They are reference material, not chrome: read once while learning
  // the tool and then never again, so they belong behind a key.
  function setupShortcuts() {
    const dlg = $('sc-dialog'), open = $('help-btn'), close = $('sc-close');
    if (!dlg) return;

    open && open.addEventListener('click', () => dlg.showModal());
    close && close.addEventListener('click', () => dlg.close());
    // Click the backdrop (i.e. outside the sheet's own box) to dismiss.
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

    // While the sheet is up, the page's global shortcuts must not fire —
    // Space would start the video behind it, S would open a round. app.js
    // listens on document in the BUBBLE phase, so a capture-phase listener on
    // the same node runs first and can halt the trip.
    // Three keys are let through: Escape (the dialog's own default action
    // closes it), Tab (focus has to keep moving inside the sheet) and '?',
    // which is the toggle that closes it — its handler is a bubble-phase
    // listener below, so swallowing it here would make the key one-way.
    document.addEventListener('keydown', (e) => {
      if (dlg.open && e.key !== 'Escape' && e.key !== 'Tab' && e.key !== '?') {
        e.stopPropagation();
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key !== '?') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      dlg.open ? dlg.close() : dlg.showModal();
    });
  }

  // ── cancel the half-built move ────────────────────────────────────────
  // Esc has always done this; nothing on screen said so. Rather than
  // duplicating app.js's cancel branch (and risking the two drifting), the
  // button hands the page the very keystroke it already handles.
  function setupCancel() {
    const btn = $('btn-cancel');
    if (!btn) return;
    btn.addEventListener('click', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Escape', key: 'Escape', bubbles: true,
      }));
    });
  }

  // ── loaded-video confirmation ─────────────────────────────────────────
  // player.js drops the file name into #video-name and otherwise leaves
  // "No video loaded" sitting there. This gives that row the same three
  // pieces of feedback the link row below it already had — the field tints
  // green, a checkmark chip names the state, and a copy button appears —
  // so the two read as one component in two states rather than two
  // different-looking things. setLinkStatus() is the equivalent for the link.
  function setupVideoName() {
    const video = $('video-player'), name = $('video-name');
    const field = $('video-loader'), out = $('video-status'), copy = $('btn-copy-name');
    if (!video || !name) return;

    const paint = (loaded) => {
      name.classList.toggle('loaded', loaded);
      if (field) {
        field.classList.toggle('ok', loaded);
        field.title = loaded ? 'This video is open. Click to copy its file name.'
                             : 'No video open yet.';
      }
      if (out) {
        out.hidden = !loaded;
        out.innerHTML = loaded ? GLYPH.ok + '<span>Loaded</span>' : '';
      }
      if (copy) copy.hidden = !loaded;
    };

    video.addEventListener('loadedmetadata', () => paint(true));
    video.addEventListener('error', () => paint(false));
    // The name is the file's, not the link's — that is what someone
    // cross-checking a clip against the sheet actually needs on the
    // clipboard. app.js owns the copy plumbing; see copyTextToClipboard().
    if (copy) {
      copy.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.copyTextToClipboard === 'function') {
          window.copyTextToClipboard(name.textContent, copy, 'file name');
        }
      });
    }
    paint(false);
  }

  // ── ⌘+ / ⌘− / ⌘0 — the keyboard half of the timeline zoom ─────────────
  // Was three cases of punch/app.js's own keydown switch; here so every page
  // with the timeline has them. The browser's page zoom on the same keys is
  // suppressed, as it was there.
  function setupTimelineZoomKeys() {
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const fn = { Equal: zoomIn, NumpadAdd: zoomIn, Minus: zoomOut, NumpadSubtract: zoomOut, Digit0: zoomFit }[e.code];
      if (!fn) return;
      e.preventDefault();
      fn();
    });
  }

  // punch/ui.js folds two of its own panels with this.
  window.setupFold = setupFold;

  document.addEventListener('DOMContentLoaded', () => {
    setupTransportIcons();
    setupVolume();      // after the icons: it repaints the speaker glyph
    setupSpeed();
    setupVideoZoom();
    setupBiggerTimelineZoom();
    setupScrubOverview();
    setupTimelineWheelZoom();
    setupTimelineZoomKeys();
    setupVideoSourceFold();
    setupZoomedClickToSeek();   // after punch/ui.js's setupSegmentEditing() — see the header
    setupTimeEdit();
    // Before setupName(): app.js's own DOMContentLoaded has already fired the
    // first lookup for a restored link, so window.setLinkStatus has to exist by
    // the time that request comes back.
    setupLinkStatus();
    setupName();
    setupShortcuts();
    setupCancel();
    setupVideoName();
  });
})();

// ============================================================
// ui.js — chrome for the punch / defense labeler.
//
// Everything in here is presentation: the segmented controls that stand in
// for two <select>s, the name field, the tools menu, the shortcuts sheet and
// the cancel button. NOTHING here touches the labeling workflow, the label
// list or the Apps Script — app.js still owns all of that, unchanged.
//
// Loaded AFTER app.js so its DOMContentLoaded handler (which restores the
// saved training type and stance into the selects) has already run by the
// time we read those values back out.
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

  // ── dragging punch strips on the timeline ─────────────────────────────
  // Grab the middle of a strip to slide the whole punch; grab within EDGE px
  // of either end to stretch just that end. The video seeks to the edge you
  // are moving as you move it, which is the point — you are choosing a frame,
  // so you should be looking at that frame while you choose it.
  //
  // Times snap to whole frames (state.frameDuration, detected by player.js),
  // because a start time between two frames is not a thing the pipeline can
  // use. Persisted on release through app.js's own updateLabelInSheet — the
  // same call the side panel's Save makes, so both paths write identically.
  function setupSegmentEditing() {
    // #seg-lanes is the wrapper around the two rows (offense, defense) — every
    // listener here is delegated on it rather than on either row, so a drag
    // that starts in one lane and a hover query for "which chip is this"
    // both work the same regardless of which of the two a strip is in.
    const lanes = $('seg-lanes'), video = $('video-player');
    const seekBar = $('seek-bar'), tip = $('seg-tip');
    if (!lanes || !video || !seekBar) return;

    const EDGE = 7;        // px at each end that grab that end
    const MIN_EDGES = 22;  // narrower than this and the whole strip just moves
    const MIN_DUR = 0.02;  // a punch may not be squashed to nothing
    let drag = null, moved = false;

    const timeAt = (clientX) => {
      const r = seekBar.getBoundingClientRect();
      return viewportPctToTime(((clientX - r.left) / r.width) * 100, video.duration);
    };
    const snap = (t) => {
      const f = state.frameDuration || 1 / 30;
      return Math.max(0, Math.min(video.duration || 0, Math.round(t / f) * f));
    };
    const labelOf = (el) => state.labels[+el.dataset.labelIdx];
    const zoneOf = (el, clientX) => {
      const r = el.getBoundingClientRect();
      if (r.width < MIN_EDGES) return 'move';
      if (clientX - r.left <= EDGE) return 'start';
      if (r.right - clientX <= EDGE) return 'end';
      return 'move';
    };

    const showTip = (el, label) => {
      if (!tip) return;
      const type = PUNCH_TYPES.find(p => p.id === label.punch);
      tip.innerHTML = '<b>' + (type ? type.label : label.punch) + '</b><span>' +
        formatTime(label.start) + ' → ' + formatTime(label.end) +
        '  (' + (label.end - label.start).toFixed(2) + 's)</span>';
      tip.hidden = false;
      // Clamped to the wrapper so a strip near either end does not push the
      // tooltip off the panel.
      const wrap = tip.parentElement.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const w = tip.getBoundingClientRect().width;
      let left = r.left + r.width / 2 - wrap.left - w / 2;
      tip.style.left = Math.max(0, Math.min(wrap.width - w, left)) + 'px';
    };
    const hideTip = () => { if (tip && !drag) tip.hidden = true; };

    // isForeignLabel() is app.js's — a round marker read in read-only from
    // ANOTHER labeler's sheet (see the long comment above it). Nothing in the
    // current data model ever routes one of those into a lane in the first
    // place (renderTimelineOverlay skips every round marker, foreign or not,
    // before a strip is ever drawn), so this can't fire today. It's here so
    // dragging stays impossible even if that ever changes — the same
    // ownership check app.js enforces at every OTHER place a label gets
    // mutated, checked here too rather than trusted to stay true upstream.
    lanes.addEventListener('mousemove', (e) => {
      const el = e.target.closest('.seek-segment');
      if (drag || !el) { if (!drag) hideTip(); return; }
      const label = labelOf(el);
      if (!label || isForeignLabel(label)) { hideTip(); return; }
      el.style.cursor = zoneOf(el, e.clientX) === 'move' ? 'grab' : 'ew-resize';
      showTip(el, label);
    });
    lanes.addEventListener('mouseleave', hideTip);

    lanes.addEventListener('mousedown', (e) => {
      const el = e.target.closest('.seek-segment');
      if (!el || e.button !== 0) return;
      const idx = +el.dataset.labelIdx, label = state.labels[idx];
      // No preventDefault/stopPropagation on this branch: a foreign strip
      // just isn't a drag handle, so the click falls through to the seek bar
      // underneath and behaves like clicking anywhere else on the timeline —
      // the same "can still look, can't touch" the read-only round-marker
      // rows give you in the side panel.
      if (!label || isForeignLabel(label)) return;
      const zone = zoneOf(el, e.clientX);
      drag = { idx, zone, grab: timeAt(e.clientX),
               start0: label.start, end0: label.end,
               startClientX: e.clientX, startClientY: e.clientY };
      // Admin Alt+drag: leave the original(s) where they are and drag a copy —
      // same lane or any labeler's lane. The copy is saved on drop, never
      // before, so letting go without moving leaves nothing behind. Grabbing
      // a label that's part of an active multi-selection duplicates the
      // WHOLE selection, moving together and landing together — see
      // isLabelSelected()/selectedLabels() in app.js.
      if (state.isAdmin && e.altKey && zone === 'move' && !label.isRoundMarker) {
        const group = (isLabelSelected(label) && state.multiSelected.size > 1)
          ? selectedLabels() : [label];
        const copies = group.map(l => ({
          id: null, punch_uuid: crypto.randomUUID(), punch: l.punch, angle: l.angle || '',
          start: l.start, end: l.end, videoName: l.videoName,
          foreign: l.foreign, sheetName: l.sheetName, isRoundMarker: false,
          timestamp: new Date().toISOString(),
        }));
        copies.forEach(c => state.labels.push(c));
        drag.idx = state.labels.indexOf(copies[group.indexOf(label)]);
        drag.duplicate = true;
        // The rest of the group, as an offset + duration from the grabbed
        // one — mousemove keeps them all moving together by that delta.
        drag.group = copies
          .map((c, i) => ({ idx: state.labels.indexOf(c), offset: group[i].start - label.start, duration: group[i].end - group[i].start }))
          .filter(g => g.idx !== drag.idx);
        lanes.classList.add('drag-copy');
        renderTimelineOverlay();
      }
      moved = false;
      (lanes.querySelector('.seek-segment[data-label-idx="' + drag.idx + '"]') || el).classList.add('dragging');
      e.preventDefault();     // no text selection, no native drag
      e.stopPropagation();    // and the wrapper must not seek out from under us
    });

    // Admin, whole-strip drags: the labeler lane the pointer is over, when a
    // drop there would change the row's owner (same offense/defense bucket,
    // a real labeler's sheet). Lanes clip their strips, so this is the only
    // sign during the drag of where it will land.
    const dropOwnerAt = (clientX, clientY, label) => {
      if (!state.isAdmin || !drag || drag.zone !== 'move' || !label) return null;
      // Rectangles, not elementFromPoint: a tooltip or popup over the lanes
      // must not swallow the drop.
      const laneEl = [...lanes.querySelectorAll('.seg-lane')].find(l => {
        const r = l.getBoundingClientRect();
        return clientX >= r.left && clientX <= r.right && clientY >= r.top - 1.5 && clientY <= r.bottom + 1.5;
      });
      if (!laneEl || !laneEl.dataset.owner || laneEl.dataset.bucket !== punchBucket(label.punch)) return null;
      const owner = writableLaneOwner(laneEl.dataset.owner);
      return owner && owner !== foreignOwnerName(label) ? owner : null;
    };
    const markDropLane = (owner, bucket) => {
      lanes.querySelectorAll('.seg-lane').forEach(l => l.classList.toggle('lane-drop',
        !!owner && l.dataset.owner === owner && l.dataset.bucket === bucket));
    };
    const removeCopy = () => {
      const idxs = new Set([drag.idx, ...(drag.group || []).map(g => g.idx)]);
      state.labels = state.labels.filter((l, k) => !(idxs.has(k) && l.id == null));
    };

    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const label = state.labels[drag.idx];
      if (!label) { drag = null; return; }
      const dt = timeAt(e.clientX) - drag.grab;
      // Vertical-only movement never changes `dt` (time only reads clientX),
      // but it's still what tells an admin's drop-on-another-lane apart from
      // a click — see the mouseup handler below.
      if (Math.abs(dt) > 1e-4 || Math.abs(e.clientY - drag.startClientY) > 2) moved = true;

      if (drag.zone === 'move') {
        const span = drag.end0 - drag.start0;
        let s = snap(drag.start0 + dt);
        s = Math.max(0, Math.min((video.duration || 0) - span, s));
        label.start = s; label.end = s + span;
      } else if (drag.zone === 'start') {
        label.start = Math.min(snap(drag.start0 + dt), label.end - MIN_DUR);
      } else {
        label.end = Math.max(snap(drag.end0 + dt), label.start + MIN_DUR);
      }
      // The rest of an alt-drag-duplicated group rides along with the
      // grabbed one, keeping the offsets recorded at mousedown.
      if (drag.group) {
        drag.group.forEach(g => {
          const other = state.labels[g.idx];
          if (!other) return;
          other.start = label.start + g.offset;
          other.end = other.start + g.duration;
        });
      }
      // Show the frame being chosen.
      video.currentTime = drag.zone === 'end' ? label.end : label.start;
      renderTimelineOverlay();
      const el = lanes.querySelector('.seek-segment[data-label-idx="' + drag.idx + '"]');
      if (el) { el.classList.add('dragging'); showTip(el, label); }
      const bucket = punchBucket(label.punch), target = dropOwnerAt(e.clientX, e.clientY, label);
      markDropLane(target, bucket);
      // The strip follows the pointer into that lane now, so time and lane are
      // chosen in one motion; the row itself changes owner only on drop.
      const targetLane = target && lanes.querySelector(`.seg-lane[data-owner="${CSS.escape(target)}"][data-bucket="${bucket}"]`);
      if (el && targetLane) targetLane.appendChild(el);
      // The rest of an alt-drag-duplicated group previews into the same
      // target owner too — each into its own bucket's lane — so the whole
      // selection visibly moves together instead of just the strip actually
      // under the pointer, which used to read as "the others got left behind".
      if (drag.group && target) {
        drag.group.forEach(g => {
          const other = state.labels[g.idx];
          const otherEl = lanes.querySelector('.seek-segment[data-label-idx="' + g.idx + '"]');
          if (!other || !otherEl) return;
          const otherLane = lanes.querySelector(`.seg-lane[data-owner="${CSS.escape(target)}"][data-bucket="${punchBucket(other.punch)}"]`);
          if (otherLane) otherLane.appendChild(otherEl);
        });
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!drag) return;
      const label = state.labels[drag.idx];
      const { start0, end0 } = drag;
      const changed = moved && label && (label.start !== start0 || label.end !== end0);

      // Admin-only: dropping a foreign strip onto a DIFFERENT owner's lane
      // in the SAME bucket (offense/defense) reassigns which labeler's
      // sheet the move lives on — see reassignLabelOwner() in app.js. Only
      // a plain "move" drag counts, not a start/end resize. Detected by
      // where the pointer actually IS at release, not by which lane the
      // strip is drawn in — a lane clips its own strips (.seg-lane overflow:
      // hidden), so the strip never visually leaves its row while dragging;
      // this is the only signal a cross-lane drop has.
      const targetOwner = moved ? dropOwnerAt(e.clientX, e.clientY, label) : null;
      const duplicate = !!drag.duplicate;
      const group = drag.group;

      if (duplicate && !moved) removeCopy();
      drag = null;
      lanes.classList.remove('drag-copy');
      lanes.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
      markDropLane(null);
      hideTip();

      if (duplicate) {
        if (!moved) { renderTimelineOverlay(); return; }
        // Everything duplicated together lands together: same target owner
        // for the whole group, regardless of each one's own bucket — a
        // sheet assignment isn't bucket-specific, only which lane a row
        // renders in is (see punchBucket()).
        const dupes = [label, ...(group || []).map(g => state.labels[g.idx]).filter(Boolean)];
        if (targetOwner) {
          const sheetName = sheetNameForOwner(targetOwner);
          dupes.forEach(l => { l.sheetName = sheetName; l.foreign = true; });
        }
        const many = dupes.length > 1;
        pushUndo({
          label: dupes[0],
          desc: many ? `Undid duplicate: ${dupes.length} moves` : 'Undid duplicate: ' + punchLabel(label.punch),
          undo: () => {
            dupes.forEach(l => {
              const i = state.labels.indexOf(l);
              if (i === -1) return;
              state.labels.splice(i, 1);
              if (l.id != null) deleteLabelFromSheet(l);
              else l._pendingCancel = true;
            });
            renderLabels();
          },
        });
        renderLabels();
        Promise.all(dupes.map(l => pushLabelToSheet(l))).then(() => fetchLabelsFromSheet());
        const onto = targetOwner ? ` onto ${foreignOwnerName(label)}’s timeline` : '';
        showToast(many
          ? `Duplicated ${dupes.length} moves${onto} at ${formatTime(label.start)}`
          : `Duplicated ${punchLabel(label.punch)}${onto} at ${formatTime(label.start)}`, 'success');
        return;
      }

      if (targetOwner) {
        // The drag's own retiming (if any) is already baked into
        // label.start/end — reassignLabelOwner() pushes the row as-is, so
        // this both moves the time AND changes the owner in one drop.
        reassignLabelOwner(label, targetOwner);
        return;
      }

      if (!changed) return;
      if (typeof pushUndo === 'function') {
        pushUndo({
          label,
          desc: 'Undid move: ' + punchLabel(label.punch),
          undo: () => {
            label.start = start0; label.end = end0;
            renderLabels();
            updateLabelInSheet(label);
          },
        });
      }
      renderLabels();
      showToast('Moved to ' + formatTime(label.start) + ' → ' + formatTime(label.end), 'success');
      updateLabelInSheet(label);
    });

    // A click always follows a drag; without this the seek-bar wrapper would
    // jump the playhead to wherever the drag happened to end.
    //
    // The same handler is where a genuine (undragged) click on a strip is
    // turned into a highlight, because `moved` is the only thing that can
    // tell the two apart, and it lives here. Capture phase, so this runs
    // before setupZoomedClickToSeek's own listener on the same element —
    // clicking a punch should go to THAT punch's start, not to whatever
    // pixel the pointer happened to land on.
    $('seek-bar-wrapper').addEventListener('click', (e) => {
      if (moved) { moved = false; e.stopPropagation(); e.preventDefault(); return; }
      const el = e.target.closest('.seek-segment');
      if (!el) return;
      const label = state.labels[+el.dataset.labelIdx];
      if (!label) return;
      // stopImmediatePropagation, not stopPropagation: setupZoomedClickToSeek
      // listens on THIS SAME element, and plain stopPropagation does not stop
      // a listener on the node you are already at. It would then re-seek to
      // whatever pixel was clicked, overwriting the punch's own start a
      // moment later. (highlightLabel re-renders, which detaches the strip
      // mid-dispatch and collapses the event path onto the wrapper, so the
      // two listeners end up same-target regardless.)
      e.stopImmediatePropagation();
      e.preventDefault();
      // Shift+click adds to the selection instead — see toggleMultiSelect().
      if (typeof isMultiSelectEvent === 'function' && isMultiSelectEvent(e)) { toggleMultiSelect(label); return; }
      // Seek BEFORE re-rendering, so this write is the last one either way.
      const video = $('video-player');
      if (video && video.duration) video.currentTime = label.start;
      if (typeof highlightLabel === 'function') highlightLabel(label);
    }, true);

    // Bail out mid-drag and put the punch back where it was.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !drag) return;
      const label = state.labels[drag.idx];
      if (drag.duplicate) removeCopy();
      else if (label) { label.start = drag.start0; label.end = drag.end0; }
      drag = null; moved = false;
      lanes.classList.remove('drag-copy');
      markDropLane(null);
      lanes.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
      hideTip(); renderLabels();
      e.stopPropagation();   // and do not also cancel a half-built label
    }, true);

    // ── marquee (click-drag) select ───────────────────────────────────────
    // Left-drag starting on empty space — not on a strip, a round/unusable
    // span, or the roll-probability lane — draws a selection box; every move
    // whose strip intersects it joins the multi-selection on release, the
    // same set shift-click builds (see app.js's toggleMultiSelect()). Round/
    // unusable markers can never be caught by it — renderTimelineOverlay()
    // never draws one as a `.seek-segment` strip in the first place. Shift
    // held at mousedown adds to whatever was already selected; a plain drag
    // replaces it (see app.js's setMultiSelection()). Reuses `moved`, the
    // same flag a strip drag sets, so the click this drag's mouseup would
    // otherwise fire (and re-seek the video) gets suppressed the same way.
    let marquee = null;
    const marqueeBox = document.createElement('div');
    marqueeBox.className = 'marquee-select';
    marqueeBox.hidden = true;
    document.body.appendChild(marqueeBox);
    const MARQUEE_EXCLUDE = '.seek-segment, .round-span, .prob-no-seek';

    lanes.addEventListener('mousedown', (e) => {
      if (drag || marquee || e.button !== 0 || e.target.closest(MARQUEE_EXCLUDE)) return;
      marquee = { startX: e.clientX, startY: e.clientY, moved: false, additive: e.shiftKey };
    });

    // Strips currently under a box (viewport coords, same shape as `marquee`
    // after a move) — shared by the live preview and the final commit so
    // they can never disagree about what's "in" the box.
    const stripsInBox = (box) => [...lanes.querySelectorAll('.seek-segment[data-label-idx]')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.left < box.x1 && r.right > box.x0 && r.top < box.y1 && r.bottom > box.y0;
      });

    window.addEventListener('mousemove', (e) => {
      if (!marquee) return;
      if (!marquee.moved && Math.hypot(e.clientX - marquee.startX, e.clientY - marquee.startY) < 4) return;
      marquee.moved = true;
      moved = true;
      marquee.x0 = Math.min(marquee.startX, e.clientX); marquee.x1 = Math.max(marquee.startX, e.clientX);
      marquee.y0 = Math.min(marquee.startY, e.clientY); marquee.y1 = Math.max(marquee.startY, e.clientY);
      marqueeBox.hidden = false;
      marqueeBox.style.left = marquee.x0 + 'px'; marqueeBox.style.top = marquee.y0 + 'px';
      marqueeBox.style.width = (marquee.x1 - marquee.x0) + 'px'; marqueeBox.style.height = (marquee.y1 - marquee.y0) + 'px';
      // Live preview: mark every strip the box currently covers with its own
      // class (not .seg-selected — that one's driven by state and must stay
      // that way) so an additive drag keeps showing the prior selection too,
      // untouched, alongside whatever the box is over right now. The next
      // renderLabels() (on mouseup) throws these elements away regardless,
      // so nothing here needs cleaning up beyond "no longer under the box".
      const hits = new Set(stripsInBox(marquee));
      lanes.querySelectorAll('.seek-segment.marquee-hit').forEach(el => { if (!hits.has(el)) el.classList.remove('marquee-hit'); });
      hits.forEach(el => el.classList.add('marquee-hit'));
    });

    window.addEventListener('mouseup', () => {
      if (!marquee) return;
      const box = marquee;
      marquee = null;
      marqueeBox.hidden = true;
      if (!box.moved) {
        // A plain click on empty space — not a drag — clears whatever was
        // selected, the same way clicking a strip already does via
        // highlightLabel(). Shift+click on empty space is left alone: it
        // isn't a drag and it isn't a strip, so there's nothing to add.
        const hadSelection = state.multiSelected.size || state.highlightedLabel;
        if (!box.additive && hadSelection && typeof setMultiSelection === 'function') setMultiSelection([], false);
        return;
      }
      const caught = stripsInBox(box).map(el => state.labels[+el.dataset.labelIdx]).filter(Boolean);
      if (typeof setMultiSelection === 'function') setMultiSelection(caught, box.additive);
    });
  }

  // ── dragging round boundaries on the ribbon ─────────────────────────────
  // A round span is really TWO separate rows (round_start, round_end), not
  // one — so unlike a punch strip there's no "move the whole thing", only
  // "retime this edge". Grab within EDGE px of a round-span's left or right
  // border to drag that boundary; the middle stays a plain click-to-seek
  // (app.js's renderRoundStrip already wires that). Same admin-over-foreign
  // rule as everywhere else: isForeignLabel()/refuseForeign() (app.js) are
  // the actual gate, so an admin can retime a boundary that belongs to
  // someone else's sheet exactly like they can already edit one via the
  // pencil in the Labels list — this just adds the drag as a second way in,
  // matching how a regular label can be dragged OR edited from the list.
  // Works on both ribbons: rounds and unusable spans (same markup, same rows).
  function setupRoundSpanDragging() {
    const layers = [$('round-markers'), $('unusable-markers')].filter(Boolean);
    const video = $('video-player'), seekBar = $('seek-bar');
    if (!layers.length || !video || !seekBar) return;

    const EDGE = 7;
    let drag = null, moved = false;

    const timeAt = (clientX) => {
      const r = seekBar.getBoundingClientRect();
      return viewportPctToTime(((clientX - r.left) / r.width) * 100, video.duration);
    };
    const snap = (t) => {
      const f = state.frameDuration || 1 / 30;
      return Math.max(0, Math.min(video.duration || 0, Math.round(t / f) * f));
    };
    // null in the middle: that's the span's own click-to-seek territory,
    // not a resize — same "narrower than EDGE*2 just isn't grabbable at
    // either end" tradeoff setupSegmentEditing() makes for punch strips.
    const zoneOf = (el, clientX) => {
      const r = el.getBoundingClientRect();
      if (clientX - r.left <= EDGE) return 'start';
      if (r.right - clientX <= EDGE) return 'end';
      return null;
    };
    const idxFor = (el, zone) => {
      const raw = zone === 'start' ? el.dataset.startIdx : el.dataset.endIdx;
      return raw === '' || raw === undefined ? null : +raw;
    };

    for (const layer of layers) {
      layer.addEventListener('mousemove', (e) => {
        const el = e.target.closest('.round-span');
        if (drag || !el) return;
        el.style.cursor = zoneOf(el, e.clientX) ? 'ew-resize' : '';
      });
      layer.addEventListener('mouseleave', (e) => {
        const el = e.target.closest && e.target.closest('.round-span');
        if (el) el.style.cursor = '';
      });

      layer.addEventListener('mousedown', (e) => {
        const el = e.target.closest('.round-span');
        if (!el || e.button !== 0 || !video.duration) return;   // no video: timeAt() is NaN
        const zone = zoneOf(el, e.clientX);
        if (!zone) return;   // middle — let the span's own click-to-seek run
        const idx = idxFor(el, zone);
        const label = idx != null ? state.labels[idx] : null;
        // Same silent fall-through as setupSegmentEditing()'s own mousedown
        // guard: a foreign boundary (non-admin) just isn't a drag handle, so
        // the click behaves like clicking anywhere else on the span instead
        // of popping a toast for what looked like an ordinary click.
        if (!label || (typeof isForeignLabel === 'function' && isForeignLabel(label))) return;
        drag = { idx, grab: timeAt(e.clientX), start0: label.start };
        moved = false;
        el.classList.add('dragging-round');
        e.preventDefault();
        e.stopPropagation();
      });
    }

    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const label = state.labels[drag.idx];
      if (!label) { drag = null; return; }
      const dt = timeAt(e.clientX) - drag.grab;
      if (Math.abs(dt) > 1e-4) moved = true;
      label.start = snap(drag.start0 + dt);
      // Round markers are instant flags (start === end at creation — see
      // mergeForeignRoundMarkers()/addRoundMarker() in app.js); keep that
      // invariant true after a drag too, same as any other reader of this
      // row would expect.
      label.end = label.start;
      video.currentTime = label.start;
      if (typeof renderTimelineOverlay === 'function') renderTimelineOverlay();
    });

    window.addEventListener('mouseup', () => {
      if (!drag) return;
      const label = state.labels[drag.idx];
      const { start0 } = drag;
      const changed = moved && label && label.start !== start0;
      drag = null;
      document.querySelectorAll('.round-span.dragging-round').forEach(el => el.classList.remove('dragging-round'));
      if (!changed) return;
      if (typeof pushUndo === 'function') {
        pushUndo({
          label,
          desc: 'Undid moving ' + markerText(label.punch),
          undo: () => {
            label.start = start0; label.end = start0;
            renderLabels();
            updateLabelInSheet(label);
          },
        });
      }
      renderLabels();
      showToast(markerText(label.punch) + ' moved to ' + formatTime(label.start), 'success');
      updateLabelInSheet(label);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !drag) return;
      const label = state.labels[drag.idx];
      if (label) { label.start = drag.start0; label.end = drag.start0; }
      drag = null; moved = false;
      document.querySelectorAll('.round-span.dragging-round').forEach(el => el.classList.remove('dragging-round'));
      renderLabels();
      e.stopPropagation();
    }, true);
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

  // ── right-click a strip: highlight it in the panel, or delete it ───────
  // Two actions worth their own menu — Highlight jumps the Labels panel to
  // (and flashes) this exact chip's row without hunting a scrolled list;
  // Delete calls the same deleteLabel() the row's own × does. Delegated on
  // #seg-lanes for the same reason setupSegmentEditing() is. Foreign strips
  // get no menu at all — same "look, don't touch" rule as dragging, and the
  // browser's own context menu shows instead.
  // Rebuilt on every open: what it offers depends on the row (yours, a
  // teammate's, a prediction), on who you are, and on what's been copied.
  // A strip gets Highlight / Copy / Move to… / Delete; an empty spot on a lane
  // gets "Paste here" at the time under the pointer.
  function setupSegmentContextMenu() {
    const lanes = $('seg-lanes'), menu = $('seg-context-menu'), seekBar = $('seek-bar');
    if (!lanes || !menu) return;
    let ctx = null;

    const close = () => { menu.hidden = true; ctx = null; };
    const item = (action, text, extra = {}) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item' + (extra.danger ? ' menu-item-danger' : '');
      b.setAttribute('role', 'menuitem');
      b.dataset.action = action;
      if (extra.owner) b.dataset.owner = extra.owner;
      b.textContent = text;
      return b;
    };
    const sep = () => { const s = document.createElement('div'); s.className = 'ctx-sep'; s.setAttribute('role', 'separator'); return s; };

    // Admin also clicks a lane to pick where Ctrl+V lands.
    lanes.addEventListener('mousedown', (e) => {
      if (!state.isAdmin || e.button !== 0) return;
      const lane = e.target.closest('.seg-lane');
      if (lane) setActiveLaneOwner(lane.dataset.owner || null);
    });

    lanes.addEventListener('contextmenu', (e) => {
      close();
      if (state.isAnalyst) return;
      const lane = e.target.closest('.seg-lane');
      if (!lane) return;
      const rows = [];
      const el = e.target.closest('.seek-segment');

      if (el) {
        const idx = +el.dataset.labelIdx, label = state.labels[idx];
        if (!label) return;
        const locked = isForeignLabel(label);
        ctx = { idx, label };
        rows.push(item('highlight', 'Highlight in Labels panel'));
        if (!label.isRoundMarker) rows.push(item('copy', 'Copy'));
        const owner = label.foreign ? foreignOwnerName(label) : null;
        if (state.isAdmin && !locked && owner && !label.isRoundMarker) {
          const targets = visibleForeignOwners().filter(o => o !== owner && writableLaneOwner(o));
          if (targets.length) {
            rows.push(sep());
            targets.forEach(o => rows.push(item('move', `Move to ${o}’s timeline`, { owner: o })));
          }
        }
        if (!locked) { rows.push(sep()); rows.push(item('delete', 'Delete', { danger: true })); }
      } else {
        const clip = state.clipboardLabel;
        const duration = getTimelineDuration();
        if (!clip || !duration) return;
        const owner = lane.dataset.owner || null;
        const ok = state.isAdmin ? writableLaneOwner(owner) : lane.classList.contains('lane-own');
        if (!ok) return;
        const r = seekBar.getBoundingClientRect();
        const time = Math.max(0, Math.min(duration,
          viewportPctToTime(((e.clientX - r.left) / r.width) * 100, duration)));
        ctx = { owner, time };
        if (state.isAdmin) setActiveLaneOwner(owner);
        rows.push(item('paste', `Paste ${punchLabel(clip.punch)} here${state.isAdmin ? ` — ${owner}’s timeline` : ''}`));
      }

      e.preventDefault();
      menu.replaceChildren(...rows);
      // Shown then measured then placed, all before the next paint — same
      // order setupSpeed()'s open() uses for the same reason: no flicker at
      // the wrong spot first.
      menu.hidden = false;
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      menu.style.left = Math.max(4, Math.min(e.clientX, window.innerWidth - mw - 8)) + 'px';
      menu.style.top = Math.max(4, Math.min(e.clientY, window.innerHeight - mh - 8)) + 'px';
    });

    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b || !ctx) return;
      const c = ctx;
      close();
      if (b.dataset.action === 'paste') { pasteLabelAtPlayhead({ time: c.time, owner: c.owner }); return; }
      if (b.dataset.action === 'copy') { copyLabel(c.label); return; }
      // A sheet refresh may have landed while the menu was open; act on the
      // row only if it is still there, at wherever it now sits.
      const idx = state.labels.indexOf(c.label);
      if (idx === -1) { showToast('That label was just refreshed — right-click it again', 'error'); return; }
      if (b.dataset.action === 'highlight') highlightLabelInPanel(idx);
      else if (b.dataset.action === 'move') reassignLabelOwner(c.label, b.dataset.owner);
      else if (b.dataset.action === 'delete') deleteLabel(idx);
    });

    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target)) close();
    });
    // A right-click elsewhere opens the BROWSER's menu on top of ours — that
    // one closing again fires no event we'd see, so without this ours would
    // just sit there under it. The lanes are exempt: their listener above
    // has already rebuilt or closed this menu by the time this one runs
    // (bubble order puts #seg-lanes first).
    document.addEventListener('contextmenu', (e) => {
      if (!menu.hidden && !e.target.closest('#seg-lanes')) close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) close();
    });
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
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

  document.addEventListener('DOMContentLoaded', () => {
    setupTransportIcons();
    setupVolume();      // after the icons: it repaints the speaker glyph
    setupSpeed();
    setupVideoZoom();
    setupBiggerTimelineZoom();
    setupScrubOverview();
    setupTimelineWheelZoom();
    setupSegmentEditing();
    setupRoundSpanDragging();
    setupVideoSourceFold();
    setupFold('move-type-toggle', 'punch-catalogue', 'moveTypeCollapsed');
    setupFold('session-toggle', 'session-rows', 'sessionCollapsed');
    setupZoomedClickToSeek();
    setupSegmentContextMenu();
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

// ============================================================
// ui.js — chrome only the punch / defense labeler has: dragging a strip or
// one of its edges on the timeline, dragging round spans, and the strip's
// right-click menu. Everything a page with a video shares — the transport
// icons, volume, speed, the timeline and picture zoom, the folds, the time
// edit, the status chips, the name field, the shortcuts sheet — lives in
// shared/ui.js since 2026-09-19 and is loaded after this file.
//
// NOTHING here touches the labeling workflow, the label list or the Apps
// Script — app.js still owns all of that, unchanged. Loaded AFTER app.js so
// its DOMContentLoaded handler (which restores the saved training type and
// stance into the selects) has already run by the time we read those values
// back out.
// ============================================================

(function () {
  const $ = (id) => document.getElementById(id);

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
        const adds = dupes.map(l => pushLabelToSheet(l));
        if (many && typeof withBulkSave === 'function') withBulkSave(`Duplicating ${dupes.length} moves…`, adds);
        Promise.all(adds).then(() => fetchLabelsFromSheet());
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

  document.addEventListener('DOMContentLoaded', () => {
    setupSegmentEditing();
    setupRoundSpanDragging();
    setupFold('move-type-toggle', 'punch-catalogue', 'moveTypeCollapsed');   // shared/ui.js's
    setupFold('session-toggle', 'session-rows', 'sessionCollapsed');
    setupSegmentContextMenu();
  });
})();

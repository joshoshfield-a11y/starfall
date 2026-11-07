/* STARFALL Phase 2 — builder.js
 * Drag-and-drop ship builder (DOM overlay + canvas grid).
 * Opened from the station for the ACTIVE ship. Touch + mouse via Pointer Events.
 * Enforces: fit in hull grid, no overlaps, power budget, engine+reactor required.
 */
window.SF = window.SF || {};

SF.Builder = (function () {
  var built = false;
  var el = {};
  var canvas, ctx;
  var cell = 36;
  var W = null; // working state: { shipIndex, parts, selected }

  function $(id) { return document.getElementById(id); }

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

  /* ---------- DOM construction ---------- */

  function buildDom() {
    if (built) return;
    built = true;
    var ov = document.createElement('div');
    ov.id = 'overlay-builder';
    ov.className = 'overlay hidden';
    ov.innerHTML =
      '<div class="panel wide">' +
        '<h2 id="builder-title">🔧 SHIP BUILDER</h2>' +
        '<div id="builder-main">' +
          '<div id="builder-grid-wrap">' +
            '<canvas id="builder-canvas"></canvas>' +
            '<div id="builder-power"></div>' +
            '<div id="builder-valid"></div>' +
            '<div id="builder-setbonus"></div>' +
          '</div>' +
          /* builder-drag-fix: the side column is a flex stack — stats,
           * tools and the part inspector sit ABOVE the palette; the palette
           * is the primary independently scrolling region; compare, coach,
           * ship identity, presets and A/B compare live in a secondary
           * scroll region (#builder-extras) below it. The tools bar moved
           * here from the grid column so the pinned grid column is only as
           * tall as the grid itself. Ship identity moved here from above
           * #builder-main (it ate ~220px of panel height and pushed the
           * grid off the bottom of phone screens). */
          '<div id="builder-side">' +
            '<div id="builder-stats" class="builder-box"></div>' +
            /* shipwright-expansion-1: builder tools bar (undo/redo, mirror,
             * cluster stamp, flip, clear) */
            '<div id="builder-tools" class="builder-box"></div>' +
            '<div id="builder-selected" class="builder-box"></div>' +
            '<div class="store-head">PARTS INVENTORY <span id="builder-arm-hint" class="dim"></span></div>' +
            '<div id="builder-palette" class="builder-box"></div>' +
            '<div id="builder-extras">' +
              /* builder-stat-compare: side-by-side stat delta panel */
              '<div id="builder-compare" class="builder-box"></div>' +
              /* shipwright-expansion-1: advisory build-validation coach */
              '<div class="store-head">BUILD COACH</div>' +
              '<div id="builder-coach" class="builder-box"></div>' +
              identityHTML() +
              /* builder-presets: saved build presets (list/save/apply/export/import). */
              '<div class="store-head">BUILD PRESETS</div>' +
              '<div id="builder-presets" class="builder-box"></div>' +
              /* shipwright-expansion-1: layout A/B compare (draft vs preset) */
              '<div class="store-head">LAYOUT A/B COMPARE</div>' +
              '<div id="builder-abcompare" class="builder-box"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="builder-actions">' +
          '<button id="builder-launch" class="btn big ui-block">💾 SAVE & LAUNCH</button>' +
          '<button id="builder-close" class="btn big ui-block">CLOSE</button>' +
        '</div>' +
        '<div id="builder-ghost" class="hidden"></div>' +
        /* builder-drag-fix: in-builder modal — the Android shell sets no
         * WebChromeClient, so window.confirm/prompt/alert are dead on
         * device (confirm() always false, prompt() always null). Every
         * builder dialog routes through this DOM modal instead. */
        '<div id="builder-modal" class="hidden">' +
          '<div class="bm-box">' +
            '<div id="bm-msg"></div>' +
            '<input id="bm-input" class="ui-block" autocomplete="off" spellcheck="false">' +
            '<textarea id="bm-text" class="ui-block" readonly rows="3"></textarea>' +
            '<div class="bm-btns">' +
              '<button id="bm-cancel" class="btn small ui-block">CANCEL</button>' +
              '<button id="bm-ok" class="btn small ui-block">OK</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ['overlay-builder', 'builder-canvas', 'builder-power', 'builder-valid', 'builder-setbonus',
     'builder-stats', 'builder-compare', 'builder-main', 'builder-side', 'builder-extras',
     'builder-palette', 'builder-selected', 'builder-launch', 'builder-close',
     'builder-presets', 'builder-ghost', 'builder-title', 'builder-grid-wrap',
     'builder-arm-hint',
     /* builder-drag-fix: in-builder modal */
     'builder-modal', 'bm-msg', 'bm-input', 'bm-text', 'bm-ok', 'bm-cancel',
     /* shipwright-expansion-1: tools bar / coach / layout A/B compare */
     'builder-tools', 'builder-coach', 'builder-abcompare',
     /* ship-rename-transponder: identity section */
     'builder-identity', 'shipname-input', 'flag-picker', 'identity-hint', 'decal-preview'
    ].forEach(function (id) { el[id] = $(id); });
    canvas = el['builder-canvas'];
    ctx = canvas.getContext('2d');

    el['builder-close'].addEventListener('click', function () { SF.Audio.ui(); close(); });
    el['builder-launch'].addEventListener('click', function () { saveAndLaunch(); });

    /* ship-rename-transponder: name input + flag picker */
    buildFlagPicker();
    el['shipname-input'].addEventListener('input', function (ev) {
      if (!W) return;
      W.shipName = liveName(ev.target.value);
      updateTitle();
      renderIdentity();
    });

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', onCanvasDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    /* builder-drag-fix: pointercancel is NOT a drop. The browser fires it
     * when it takes a gesture over (e.g. a scroll) — routing it into
     * onPointerUp placed parts the user never dropped and, worse, REMOVED
     * fitted parts dragged off-grid by an interrupted gesture. A cancel
     * discards the gesture with zero side effects. */
    window.addEventListener('pointercancel', onPointerCancel);

    /* builder-drag-fix: rotation / viewport changes re-fit the grid cell
     * size to the (CSS-locked) panel while the builder is open. */
    window.addEventListener('resize', function () {
      if (!isOpen()) return;
      layout();
      drawGrid(null);
    });

    /* shipwright-expansion-1: cluster stamp ghost follows the pointer */
    canvas.addEventListener('pointermove', function (ev) {
      if (!W) return;
      W.hoverCell = canvasCell(ev.clientX, ev.clientY);
      if (W.cluster && !W.drag && !W.clusterDrag) drawGrid(null);
      /* builder-drag-fix: armed tap-to-place shows the same drop highlight
       * a drag would, so mouse users can aim before they click. */
      if (W.armed && !W.drag && !W.clusterDrag && W.hoverCell) {
        drawGrid({ gx: W.hoverCell.gx, gy: W.hoverCell.gy });
      }
    });

    /* builder-drag-fix: modal buttons (the modal itself is built in
     * buildDom; showBuilderModal wires the pending callbacks). */
    el['bm-ok'].addEventListener('click', function () { settleModal(true); });
    el['bm-cancel'].addEventListener('click', function () { settleModal(false); });

    /* shipwright-expansion-1: Ctrl/Cmd+Z undo, Ctrl+Shift+Z / Ctrl+Y redo.
     * Only while the builder is open, and never while typing in a field.
     * builder-drag-fix: Escape disarms tap-to-place / cancels the cluster
     * tool / dismisses the modal, in that order. */
    document.addEventListener('keydown', function (ev) {
      if (!isOpen()) return;
      if (ev.key === 'Escape') {
        if (modalState) { settleModal(false); return; }
        if (W.armed) { disarmPart(); SF.Audio.ui(); return; }
        if (W.cluster || W.clusterArmed) { cancelCluster(); renderTools(); return; }
        return;
      }
      var tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      var mod = ev.ctrlKey || ev.metaKey;
      if (!mod) return;
      var k = (ev.key || '').toLowerCase();
      if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); undoLayout(); }
      else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); redoLayout(); }
    });
  }

  /* ---------- working state ---------- */

  function open() {
    buildDom();
    var p = SF.Player;
    var shipRec = p.ships[p.activeShip];
    W = {
      shipIndex: p.activeShip,
      parts: JSON.parse(JSON.stringify(p.ships[p.activeShip].parts)),
      selected: null,
      comparePartId: null, /* builder-stat-compare: hovered inventory part id */
      /* ship-rename-transponder: identity draft (committed on save/close) */
      shipName: shipNameOf(shipRec),
      shipFlag: shipFlagOf(shipRec),
      /* shipwright-expansion-1: tools state — undo/redo hold full draft
       * snapshots (fitted parts + loose inventory) so a step restores both
       * sides of every take/return; stacks reset each time the builder
       * opens, and scrapping a part clears them (credits were paid out). */
      undoStack: [], redoStack: [],
      mirror: false,          // symmetry placement for palette drops
      cluster: null,          // captured cluster {specs,w,h} ready to stamp
      clusterArmed: false,    // next canvas drag selects a cluster rectangle
      clusterDrag: null,      // live selection rectangle {x0,y0,x1,y1}
      hoverCell: null,        // canvas cell under the pointer (stamp ghost)
      presetFilter: 'all',    // layout library filter: 'all' | 'this'
      abPreset: null,         // preset name shown in the A/B compare panel
      drag: null, // { partId, fromIndex, gx, gy, rotated, stars, px, py, moved, t0, palette }
      /* builder-drag-fix: tap-to-place — the palette part id armed for
       * placement (tap palette part -> tap grid cell). Null = not armed. */
      armed: null
    };
    /* builder-drag-fix: unhide BEFORE layout() — layout() measures the
     * flex-sized #builder-main, which is 0 while the overlay is hidden. */
    el['overlay-builder'].classList.remove('hidden');
    layout();
    renderAll();
    SF.Audio.ui();
  }

  function close() {
    /* ship-rename-transponder: identity is cosmetic, commit on close too */
    commitIdentity(true);
    /* builder-drag-fix: never leave the modal (or its callbacks) behind */
    if (modalState) { modalState = null; el['builder-modal'].classList.add('hidden'); }
    el['overlay-builder'].classList.add('hidden');
    hideGhost();
    W = null;
  }

  function isOpen() { return !!(W && !el['overlay-builder'].classList.contains('hidden')); }

  function shipClass() { return SF.SHIP_CLASS_BY_ID[SF.Player.ships[W.shipIndex].classId]; }

  /* builder-drag-fix: stacked mode must match the CSS breakpoint exactly
   * (@media (max-width: 900px) and (orientation: portrait)): portrait
   * phones stack; landscape phones — including the S25 at ~800 CSS px
   * wide — stay side-by-side, where width is plentiful and height is not. */
  function isStacked() {
    return window.innerWidth <= 900 && window.innerHeight >= window.innerWidth;
  }

  function layout() {
    var cls = shipClass();
    var stacked = isStacked();
    /* The panel is viewport-locked by CSS, so #builder-main has a definite
     * height: size the grid to FIT it instead of the old fixed 360px cap
     * (a 4x3 fighter grid ballooned to 480x360 and hung off the bottom of
     * a 390px-tall phone screen). GRID_EXTRAS budgets the power/valid/
     * set-bonus lines that live under the canvas in the grid column. */
    var GRID_EXTRAS = 110;
    var main = el['builder-main'];
    var mainH = main ? main.clientHeight : 0;
    var mainW = main ? main.clientWidth : 0;
    if (!mainH) mainH = Math.max(160, window.innerHeight - 150);
    if (!mainW) mainW = window.innerWidth - 40;
    var maxW, maxH;
    if (stacked) {
      maxW = Math.min(520, mainW);
      /* grid column takes at most ~52% of main; the side column (stats,
       * tools, palette, extras) keeps the rest */
      maxH = Math.max(72, Math.floor(mainH * 0.52) - GRID_EXTRAS);
    } else {
      maxW = 300;
      maxH = Math.max(72, mainH - GRID_EXTRAS);
    }
    cell = Math.max(12, Math.floor(Math.min(maxW / cls.gridW, maxH / cls.gridH)));
    canvas.width = cls.gridW * cell;
    canvas.height = cls.gridH * cell;
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
    /* ship-rename-transponder: title shows the ship's personality name */
    updateTitle();
  }

  /* ---------- rendering ---------- */

  function drawGrid(hover) {
    var cls = shipClass();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#070d1d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(80,130,200,0.28)';
    ctx.lineWidth = 1;
    for (var x = 0; x <= cls.gridW; x++) {
      ctx.beginPath(); ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, canvas.height); ctx.stroke();
    }
    for (var y = 0; y <= cls.gridH; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(canvas.width, y * cell + 0.5); ctx.stroke();
    }
    // placed parts
    for (var i = 0; i < W.parts.length; i++) {
      if (W.drag && W.drag.fromIndex === i) continue; // dragged part drawn as ghost
      drawPart(W.parts[i], i === W.selected);
    }
    // drop highlight — for a live drag, or (builder-drag-fix) for the
    // armed tap-to-place part hovering a cell.
    var hd = W.drag || (W.armed ? { partId: W.armed, fromIndex: null, rotated: false, stars: 1, palette: true } : null);
    if (hover && hd) {
      var ok = canDropAt(hover.gx, hover.gy, hd);
      ctx.fillStyle = ok ? 'rgba(61,220,95,0.3)' : 'rgba(255,94,58,0.3)';
      var d = dragDims(hd);
      ctx.fillRect(hover.gx * cell, hover.gy * cell, d.w * cell, d.h * cell);
      /* shipwright-expansion-1: mirror ghost — where the symmetric copy
       * would land for a palette drop with mirror mode on. Green only when
       * it fits AND a second copy is actually in the loose inventory. */
      if (W.mirror && hd.palette) {
        var mgx = cls.gridW - hover.gx - d.w;
        if (mgx !== hover.gx) {
          var mfp = { partId: hd.partId, gx: mgx, gy: hover.gy, rotated: hd.rotated, stars: hd.stars };
          var mok = SF.Parts.canPlace(cls, W.parts, mfp, -1) &&
            ((SF.Player.partInventory[hd.partId] || 0) >= 2);
          ctx.fillStyle = mok ? 'rgba(61,220,95,0.22)' : 'rgba(255,94,58,0.22)';
          ctx.fillRect(mgx * cell, hover.gy * cell, d.w * cell, d.h * cell);
          ctx.strokeStyle = mok ? 'rgba(61,220,95,0.8)' : 'rgba(255,94,58,0.8)';
          ctx.lineWidth = 1;
          ctx.strokeRect(mgx * cell + 0.5, hover.gy * cell + 0.5, d.w * cell - 1, d.h * cell - 1);
        }
      }
    }
    /* shipwright-expansion-1: cluster selection rectangle (live drag) */
    if (W.clusterDrag) {
      var cd = W.clusterDrag;
      var rx = Math.min(cd.x0, cd.x1), ry = Math.min(cd.y0, cd.y1);
      var rw = Math.abs(cd.x1 - cd.x0) + 1, rh = Math.abs(cd.y1 - cd.y0) + 1;
      ctx.fillStyle = 'rgba(255,210,63,0.16)';
      ctx.fillRect(rx * cell, ry * cell, rw * cell, rh * cell);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx * cell + 1, ry * cell + 1, rw * cell - 2, rh * cell - 2);
    }
    /* shipwright-expansion-1: cluster stamp ghost at the hovered cell */
    if (W.cluster && W.hoverCell && !W.drag) {
      ctx.fillStyle = 'rgba(77,227,255,0.14)';
      ctx.fillRect(W.hoverCell.gx * cell, W.hoverCell.gy * cell,
        W.cluster.w * cell, W.cluster.h * cell);
      ctx.strokeStyle = 'rgba(77,227,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(W.hoverCell.gx * cell + 1, W.hoverCell.gy * cell + 1,
        W.cluster.w * cell - 2, W.cluster.h * cell - 2);
    }
  }

  function drawPart(fp, selected) {
    var p = SF.PART_BY_ID[fp.partId];
    if (!p) return;
    var d = SF.Parts.dims(fp);
    var x = fp.gx * cell, y = fp.gy * cell;
    ctx.fillStyle = 'rgba(20,32,58,0.9)';
    ctx.fillRect(x + 1, y + 1, d.w * cell - 2, d.h * cell - 2);
    ctx.strokeStyle = SF.TIERS[p.tier];
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.strokeRect(x + 1.5, y + 1.5, d.w * cell - 3, d.h * cell - 3);
    ctx.fillStyle = '#dfe8ff';
    ctx.font = Math.max(9, Math.min(13, cell * 0.32)) + 'px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var label = p.name.split(' ')[0];
    ctx.fillText(label, x + d.w * cell / 2, y + d.h * cell / 2 - 6);
    ctx.fillStyle = '#ffd23f';
    ctx.font = Math.max(8, Math.min(11, cell * 0.28)) + 'px monospace';
    ctx.fillText(SF.Upgrade.starsText(fp.stars || 1), x + d.w * cell / 2, y + d.h * cell / 2 + 9);
  }

  function dragDims(drag) {
    var p = SF.PART_BY_ID[drag.partId];
    var rotated = drag.rotated;
    return rotated ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
  }

  function canDropAt(gx, gy, drag) {
    var cls = shipClass();
    var fp = { partId: drag.partId, gx: gx, gy: gy, rotated: drag.rotated, stars: drag.stars };
    var ignore = (drag.fromIndex === null || drag.fromIndex === undefined) ? -1 : drag.fromIndex;
    return SF.Parts.canPlace(cls, W.parts, fp, ignore);
  }

  function renderStats() {
    var ship = SF.Player.ships[W.shipIndex];
    var s = SF.Parts.derive(ship.classId, W.parts);
    var h = '<div class="bstat-row"><span>Hull</span><b>' + fmt(s.hull) + '</b></div>' +
      '<div class="bstat-row"><span>Shield</span><b>' + fmt(s.shield) + '</b></div>' +
      '<div class="bstat-row"><span>Speed</span><b>' + fmt(s.speed) + '</b></div>' +
      '<div class="bstat-row"><span>Cargo</span><b>' + fmt(s.cargo) + '</b></div>' +
      '<div class="bstat-row"><span>Crew cap</span><b>' + fmt(s.crewCap) + '</b></div>' +
      '<div class="bstat-row"><span>Weapon slots</span><b>' + fmt(s.slots) + '</b></div>';
    /* shipwright-expansion-1: live-effect rows for the new part families —
     * shown only when fitted, worded as what the part actually does. */
    if (s.drones > 0) h += '<div class="bstat-row"><span>🤖 Drones</span><b>' +
      Math.floor(s.drones) + ' × ' + s.droneDmg + ' dmg</b></div>';
    if (s.pd > 0) h += '<div class="bstat-row"><span>🛡️ Point-defense</span><b>' +
      Math.floor(s.pd) + ' mount' + (Math.floor(s.pd) > 1 ? 's' : '') + ' · ' + s.pdRange + 'u</b></div>';
    if (s.ecm > 0) h += '<div class="bstat-row"><span>📡 ECM jam</span><b>' +
      Math.round(s.ecm * 100) + '% aim blur</b></div>';
    if (s.sensor > 0) h += '<div class="bstat-row"><span>🔭 Sensor</span><b>+' +
      Math.round(s.sensor * 100) + '% ping reach</b></div>';
    if (s.mining > 0) h += '<div class="bstat-row"><span>⛏️ Mining</span><b>+' +
      Math.round(s.mining * 100) + '% ore · +' + Math.round(s.miningDmg * 100) + '% rock dmg</b></div>';
    if (s.cloak > 0) h += '<div class="bstat-row"><span>👻 Cloak</span><b>' +
      s.cloakRadius + 'u no-fire bubble</b></div>';
    /* builder-drag-fix: two-column stat grid (side column is height-starved) */
    el['builder-stats'].innerHTML = '<div class="bstat-grid">' + h + '</div>';

    // power meter
    var total = Math.max(1, s.powerGen);
    var usePct = Math.min(100, s.powerUse / total * 100);
    el['builder-power'].innerHTML =
      '<div class="power-line"><span>⚡ ' + fmt(s.powerGen) + ' gen</span>' +
      '<span>−' + fmt(s.powerUse) + ' use</span>' +
      '<span class="' + (s.powerNet >= 0 ? 'ok' : 'bad') + '">net ' +
      (s.powerNet >= 0 ? '+' : '') + fmt(s.powerNet) + '</span></div>' +
      '<div class="power-bar"><div class="power-use" style="width:' + usePct + '%"></div></div>';

    el['builder-valid'].innerHTML = s.valid
      ? '<span class="ok">✓ FLIGHT READY</span>'
      : '<span class="bad">✗ ' + s.reasons.join(' · ') + '</span>';
    el['builder-launch'].disabled = !s.valid;

    /* builder-badge-wiring: render set bonuses for the CURRENT DRAFT (W.parts),
     * so badges update live while fitting parts. Pure view; save-neutral. */
    el['builder-setbonus'].innerHTML =
      '<div class="store-head">SET BONUSES</div>' +
      SF.Player.setBonusBadgeHTML(ship.classId, W.parts);
  }

  function partStatsText(p, stars) {
    var m = SF.Parts.starMult(stars || 1);
    var bits = [];
    if (p.power > 0) bits.push('+' + Math.round(p.power * m) + ' power');
    if (p.power < 0) bits.push(p.power + ' power');
    Object.keys(p.stats).forEach(function (k) {
      bits.push('+' + Math.round(p.stats[k] * m) + ' ' + k);
    });
    /* builder-badge-wiring: name the maker line so players can chase sets. */
    if (p.maker && window.SF && SF.SET_LINES && SF.SET_LINES[p.maker]) {
      var line = SF.SET_LINES[p.maker];
      bits.push('<span style="color:' + line.color + '">' + line.name + '</span>');
    }
    return bits.join(' · ');
  }

  function renderPalette() {
    var inv = SF.Player.partInventory;
    /* builder-drag-fix: the inventory head carries the armed-state hint so
     * tap-to-place is discoverable without reading a manual. */
    var ah = el['builder-arm-hint'];
    if (ah) {
      ah.textContent = (W && W.armed && SF.PART_BY_ID[W.armed])
        ? ' — ▶ ' + SF.PART_BY_ID[W.armed].name + ' ARMED · tap a grid cell to place · tap part again to cancel'
        : '';
    }
    el['builder-palette'].innerHTML = '';
    var ids = Object.keys(inv).filter(function (id) { return inv[id] > 0 && SF.PART_BY_ID[id]; });
    if (!ids.length) {
      el['builder-palette'].innerHTML = '<div class="dim">No loose parts. Buy parts at the station.</div>';
      return;
    }
    // group by type
    var byType = {};
    ids.forEach(function (id) {
      var t = SF.PART_BY_ID[id].type;
      (byType[t] = byType[t] || []).push(id);
    });
    Object.keys(byType).sort().forEach(function (t) {
      var th = document.createElement('div');
      th.className = 'pal-type'; th.textContent = t.toUpperCase();
      el['builder-palette'].appendChild(th);
      byType[t].forEach(function (id) {
        var p = SF.PART_BY_ID[id];
        var d = document.createElement('div');
        d.className = 'pal-item';
        /* builder-drag-fix: armed tap-to-place part is visibly marked */
        if (W && W.armed === id) d.classList.add('armed');
        d.setAttribute('data-part-id', id);
        d.innerHTML = '<span class="tier-dot" style="background:' + SF.TIERS[p.tier] + '"></span>' +
          '<span class="pal-name">' + p.name + ' <span class="dim">' + p.w + '×' + p.h + '</span></span>' +
          '<span class="pal-count">×' + inv[id] + '</span>';
        d.addEventListener('pointerdown', function (ev) {
          ev.preventDefault();
          startDrag({ partId: id, fromIndex: null, rotated: false, stars: 1, palette: true },
            ev.clientX, ev.clientY);
        });
        /* builder-stat-compare: hovering a palette part highlights it as the
         * compare candidate against the fitted part of the same type. */
        (function (pid) {
          d.addEventListener('mouseenter', function () {
            if (W) { W.comparePartId = pid; renderCompare(); }
          });
          d.addEventListener('mouseleave', function () {
            if (W && W.comparePartId === pid) { W.comparePartId = null; renderCompare(); }
          });
        })(id);
        el['builder-palette'].appendChild(d);
      });
    });
  }

  function renderSelected() {
    var box = el['builder-selected'];
    box.innerHTML = '';
    /* builder-drag-fix: the side column rebalances around an active
     * inspector (CSS: #builder-side.has-selected …) */
    var hasSel = !(W.selected === null || W.selected === undefined || !W.parts[W.selected]);
    if (el['builder-side']) el['builder-side'].classList.toggle('has-selected', hasSel);
    if (!hasSel) {
      box.innerHTML = '<div class="dim">Tap a palette part, then tap the grid to place it.</div>';
      return;
    }
    var fp = W.parts[W.selected];
    var p = SF.PART_BY_ID[fp.partId];
    if (!p) { W.selected = null; renderSelected(); return; }
    var stars = fp.stars || 1;
    var upCost = stars < 5 ? SF.Upgrade.partCost(p.id, stars + 1) : null;

    var h = document.createElement('div');
    h.innerHTML =
      '<div class="sel-head"><span class="tier-dot" style="background:' + SF.TIERS[p.tier] + '"></span>' +
      '<b>' + p.name + '</b> <span class="dim">' + p.type + ' · ' + p.w + '×' + p.h + '</span></div>' +
      '<div class="sel-stars">' + SF.Upgrade.starsText(stars) + '</div>' +
      '<div class="dim">' + partStatsText(p, stars) + '</div>' +
      '<div class="dim">' + p.desc + '</div>';
    box.appendChild(h);

    var btnRow = document.createElement('div');
    btnRow.className = 'sel-btns';

    var rot = document.createElement('button');
    rot.className = 'btn small ui-block'; rot.textContent = '⟳ ROTATE';
    rot.addEventListener('click', function () {
      var cls = shipClass();
      var trial = { partId: fp.partId, gx: fp.gx, gy: fp.gy, rotated: !fp.rotated, stars: fp.stars };
      if (SF.Parts.canPlace(cls, W.parts, trial, W.selected)) {
        pushUndo(); /* shipwright-expansion-1 */
        fp.rotated = !fp.rotated;
        SF.Audio.ui(); renderAll();
      } else SF.Audio.deny();
    });
    btnRow.appendChild(rot);

    var up = document.createElement('button');
    up.className = 'btn small ui-block';
    if (stars >= 5) { up.textContent = '★ MAX'; up.disabled = true; }
    else {
      up.textContent = '⬆ ★' + (stars + 1) + ' · ' + SF.Upgrade.costText(upCost);
      up.disabled = !SF.Upgrade.canAfford(upCost);
      up.addEventListener('click', function () {
        if (SF.Upgrade.upgradePart(fp)) {
          /* builder-drag-fix (audit): a star upgrade spends credits+ore,
           * but undo snapshots taken BEFORE the purchase still hold the
           * part's old star count — undoing any earlier step silently
           * reverted the upgrade while keeping the payment (found by
           * exercising undo-after-upgrade at phone size). A purchase
           * invalidates layout history, exactly like scrap does: clear
           * both stacks so no snapshot can resurrect pre-purchase state. */
          W.undoStack.length = 0;
          W.redoStack.length = 0;
          SF.Audio.buy(); renderAll();
        }
        else SF.Audio.deny();
      });
    }
    btnRow.appendChild(up);

    var rem = document.createElement('button');
    rem.className = 'btn small ui-block'; rem.textContent = '✕ REMOVE';
    rem.addEventListener('click', function () {
      pushUndo(); /* shipwright-expansion-1 */
      SF.Player.addPart(fp.partId, 1);
      W.parts.splice(W.selected, 1);
      W.selected = null;
      SF.Audio.ui(); renderAll();
    });
    btnRow.appendChild(rem);

    /* shipwright-expansion-1: partial scrap refund — the part is DESTROYED
     * (not returned to inventory) for 20% of its star-scaled value. Pays out
     * credits, so it also clears the undo/redo stacks: an undo must never
     * resurrect a part whose value was already cashed in. */
    var scrap = document.createElement('button');
    scrap.className = 'btn small ui-block';
    scrap.textContent = '♻ SCRAP +' + fmt(partScrapValue(fp)) + 'cr';
    scrap.title = 'Destroy this part for 20% of its value (does NOT return to inventory)';
    scrap.addEventListener('click', function () {
      var val = partScrapValue(fp);
      var idx = W.selected, pid = fp.partId;
      /* builder-drag-fix: in-builder modal — window.confirm() is dead in
       * the Android shell (no WebChromeClient), which made SCRAP a no-op
       * button on device. Index + part id are captured and re-validated
       * when the user confirms, so a stale selection can't scrap the
       * wrong part. */
      builderConfirm('Scrap ' + p.name + ' ' + SF.Upgrade.starsText(stars) +
        ' for ' + fmt(val) + ' credits?\nThe part is destroyed — it does NOT go back to your inventory.',
        function () {
          if (W && W.parts[idx] && W.parts[idx].partId === pid) scrapPartAt(idx);
        });
    });
    btnRow.appendChild(scrap);
    box.appendChild(btnRow);
  }

  /* ========== builder-stat-compare: side-by-side stat deltas ==========
   * QoL: hovering a part in the PARTS INVENTORY list shows a delta panel
   * comparing the candidate (inventory, always 1 star) against the fitted
   * part of the same type on the draft grid. Stats: damage, rate, shield,
   * speed, power — each rendered current -> candidate with a green/red
   * +/- delta. Save-neutral (runtime UI only); drag-and-drop untouched.
   * The statVector engine also accepts weapon entries and literal stat bags,
   * so weapons and mods compare through the same code path. */

  var CMP_STATS = [
    { key: 'damage', label: 'Damage' },
    { key: 'rate',   label: 'Rate' },
    { key: 'shield', label: 'Shield' },
    { key: 'speed',  label: 'Speed' },
    { key: 'power',  label: 'Power' }
  ];

  /* Stat vector for a comparable source:
   *   { partId, stars }          — ship part (stars default 1)
   *   { weaponId, stars, entry } — weapon entry; entry.mods feeds SF.Mods
   *   { stats: {damage,rate,shield,speed,power} } — literal passthrough
   * Power is SIGNED (+generation / -draw), mirroring SF.Parts.derive exactly:
   * generation scales with stars, consumption does not. For every stat,
   * higher is better, so delta = candidate - current colors uniformly. */
  function statVector(src) {
    var v = { damage: 0, rate: 0, shield: 0, speed: 0, power: 0 };
    if (!src) return v;
    var i;
    if (src.stats) {
      for (i = 0; i < CMP_STATS.length; i++) {
        var k = CMP_STATS[i].key;
        if (src.stats[k]) v[k] = src.stats[k];
      }
      return v;
    }
    if (src.partId) {
      var p = SF.PART_BY_ID[src.partId];
      if (!p) return v;
      var m = SF.Parts.starMult(src.stars || 1);
      if (p.stats.shield) v.shield = Math.round(p.stats.shield * m);
      if (p.stats.speed)  v.speed  = Math.round(p.stats.speed  * m);
      v.power = p.power > 0 ? Math.round(p.power * m) : p.power;
      return v;
    }
    if (src.weaponId) {
      var wcfg = SF.CONFIG.weapons[src.weaponId];
      if (!wcfg) return v;
      var sm = SF.Parts.starMult(src.stars || 1);
      var entry = src.entry || null;
      var dmgM = (window.SF && SF.Mods) ? SF.Mods.damageMul(entry) : 1;
      var rateM = (window.SF && SF.Mods) ? SF.Mods.rateMul(entry) : 1;
      v.damage = wcfg.damage * sm * dmgM;
      v.rate = wcfg.fireRate * rateM;
      return v;
    }
    return v;
  }

  function fmtCmp(n) {
    var r = Math.round(n);
    if (Math.abs(n - r) < 1e-9) return String(r);
    return String(Math.round(n * 100) / 100);
  }

  /* power shows signed (+gen / -draw); rate keeps decimals; the rest ints */
  function fmtStatVal(key, val) {
    if (key === 'power') return (val < 0 ? '-' : '+') + fmtCmp(Math.abs(val));
    if (key === 'rate') return fmtCmp(Math.round(val * 100) / 100);
    return fmtCmp(Math.round(val));
  }

  /* Render the delta panel. curSrc null = nothing fitted of this type:
   * candidate values shown, no deltas, no crash. Pure function of the two
   * sources — the smoke test asserts its deltas against recomputed vectors. */
  function compareHTML(curSrc, candSrc, curLabel, candLabel) {
    var cv = statVector(curSrc), nv = statVector(candSrc);
    var h = '<div style="font-size:12px;font-weight:bold;color:#ffd23f;margin-bottom:2px">' +
      '⚖️ STAT COMPARE</div>';
    h += '<div class="dim" style="font-size:11px;margin-bottom:4px;line-height:1.4">' +
      escHtml(candLabel || 'candidate') +
      (curSrc
        ? ' <span style="color:#5a6b8a">vs</span> ' + escHtml(curLabel || 'fitted')
        : ' <span style="color:#5a6b8a">vs</span> <i>nothing fitted</i>') +
      '</div>';
    for (var i = 0; i < CMP_STATS.length; i++) {
      var s = CMP_STATS[i];
      var a = cv[s.key], b = nv[s.key];
      var rhs;
      if (a === 0 && b === 0) {
        rhs = '<span class="dim">—</span>';
      } else if (!curSrc) {
        rhs = '<b>' + fmtStatVal(s.key, b) + '</b>';
      } else {
        var d = b - a;
        var dc = d > 1e-9 ? '#3ddc5f' : (d < -1e-9 ? '#ff5e3a' : '#9db0cc');
        var dt = d > 1e-9 ? '+' + fmtCmp(d) : (d < -1e-9 ? '-' + fmtCmp(-d) : '±0');
        rhs = '<span class="dim">' + fmtStatVal(s.key, a) + '</span>' +
          ' <span style="color:#5a6b8a">→</span> ' +
          '<b>' + fmtStatVal(s.key, b) + '</b> ' +
          '<b style="color:' + dc + ';min-width:46px;display:inline-block;text-align:right">' +
          dt + '</b>';
      }
      h += '<div style="display:flex;justify-content:space-between;align-items:baseline;' +
        'font-size:12px;padding:2px 0;border-top:1px solid #1a2547">' +
        '<span style="color:#9db0cc">' + s.label + '</span><span>' + rhs + '</span></div>';
    }
    return h;
  }

  function renderCompare() {
    var box = el['builder-compare'];
    if (!box) return;
    var cid = W && W.comparePartId;
    var p = cid && SF.PART_BY_ID[cid];
    if (!p) {
      box.innerHTML = '<div class="dim" style="font-size:12px;line-height:1.5">' +
        '⚖️ Hover a part in the inventory to compare it against the ' +
        'fitted part of the same type.</div>';
      return;
    }
    /* current = first fitted part of the same type on the draft grid */
    var cur = null, curLabel = null;
    for (var i = 0; i < W.parts.length; i++) {
      var fp = W.parts[i], cp = SF.PART_BY_ID[fp.partId];
      if (cp && cp.type === p.type) {
        cur = { partId: fp.partId, stars: fp.stars || 1 };
        curLabel = cp.name + ' ★' + (fp.stars || 1) + ' (fitted)';
        break;
      }
    }
    box.innerHTML = compareHTML(cur, { partId: p.id, stars: 1 },
      curLabel, p.name + ' ★1 (inventory)');
  }

  /* test hook: drive the panel without synthetic hover events */
  function setComparePart(partId) {
    if (!W) return;
    W.comparePartId = (partId && SF.PART_BY_ID[partId]) ? partId : null;
    renderCompare();
  }

  function renderAll() {
    drawGrid(null);
    renderStats();
    renderPalette();
    renderSelected();
    renderPresets(); /* builder-presets: refresh the presets row */
    renderIdentity(); /* ship-rename-transponder: name/flag UI + decal preview */
    /* shipwright-expansion-1: tools bar + build coach + A/B panel */
    renderTools();
    renderCoach();
    renderABCompare();
    /* builder-stat-compare: draft changed -> the hover candidate is stale;
     * reset the panel to its hint. */
    if (W) W.comparePartId = null;
    renderCompare();
  }

  /* ---------- drag & drop (pointer events: touch + mouse) ---------- */

  function startDrag(spec, px, py) {
    W.drag = {
      partId: spec.partId, fromIndex: spec.fromIndex,
      rotated: !!spec.rotated, stars: spec.stars || 1,
      palette: !!spec.palette, px: px, py: py,
      moved: false, t0: Date.now()
    };
    W.selected = null;
    renderSelected();
    /* builder-stat-compare: dragging a palette part previews its stat deltas
     * against the fitted part of the same type (touch users get the panel
     * while dragging; the drop path's renderAll() clears it). */
    if (spec.palette && W) { W.comparePartId = spec.partId; renderCompare(); }
    var p = SF.PART_BY_ID[spec.partId];
    el['builder-ghost'].textContent = p.name + ' ' + p.w + '×' + p.h;
    el['builder-ghost'].classList.remove('hidden');
    moveGhost(px, py);
    /* builder-drag-fix: moveGhost() marks the drag moved, but the initial
     * ghost positioning is not a move — without this reset a palette tap
     * could never read as a tap (it always looked like a drag), which is
     * what made tap-to-place impossible. Canvas drags already reset it
     * in onCanvasDown; palette drags had no reset anywhere. */
    W.drag.moved = false;
    SF.Audio.ui();
  }

  function moveGhost(px, py) {
    if (!W || !W.drag) return;
    W.drag.px = px; W.drag.py = py;
    W.drag.moved = true;
    el['builder-ghost'].style.left = (px + 14) + 'px';
    el['builder-ghost'].style.top = (py - 10) + 'px';
    var r = canvas.getBoundingClientRect();
    if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
      var gx = Math.floor((px - r.left) / cell), gy = Math.floor((py - r.top) / cell);
      drawGrid({ gx: gx, gy: gy });
    } else {
      drawGrid(null);
    }
  }

  function hideGhost() { if (built) el['builder-ghost'].classList.add('hidden'); }

  function canvasCell(px, py) {
    var r = canvas.getBoundingClientRect();
    if (px < r.left || px > r.right || py < r.top || py > r.bottom) return null;
    return { gx: Math.floor((px - r.left) / cell), gy: Math.floor((py - r.top) / cell) };
  }

  function hitPart(px, py) {
    var c = canvasCell(px, py);
    if (!c) return -1;
    for (var i = W.parts.length - 1; i >= 0; i--) {
      var fp = W.parts[i], d = SF.Parts.dims(fp);
      if (c.gx >= fp.gx && c.gx < fp.gx + d.w && c.gy >= fp.gy && c.gy < fp.gy + d.h) return i;
    }
    return -1;
  }

  function onCanvasDown(ev) {
    if (!W || W.drag) return;
    ev.preventDefault();
    /* shipwright-expansion-1: cluster tool takes over canvas presses —
     * armed = start a selection rectangle; captured = stamp at the cell. */
    if (W.clusterArmed) {
      var c0 = canvasCell(ev.clientX, ev.clientY);
      if (c0) W.clusterDrag = { x0: c0.gx, y0: c0.gy, x1: c0.gx, y1: c0.gy };
      return;
    }
    if (W.cluster) {
      var c1 = canvasCell(ev.clientX, ev.clientY);
      if (c1) stampClusterAt(c1.gx, c1.gy);
      return;
    }
    /* builder-drag-fix: tap-to-place — with a palette part armed, a canvas
     * tap places it at that cell (top-left anchored, same as a drop).
     * Mutually exclusive with the cluster tool: arming a part cancels the
     * cluster, and arming the cluster disarms the part. */
    if (W.armed) {
      var c2 = canvasCell(ev.clientX, ev.clientY);
      if (c2) placeArmedAt(c2.gx, c2.gy);
      return;
    }
    var i = hitPart(ev.clientX, ev.clientY);
    if (i >= 0) {
      var fp = W.parts[i];
      startDrag({ partId: fp.partId, fromIndex: i, rotated: fp.rotated, stars: fp.stars || 1 },
        ev.clientX, ev.clientY);
      W.drag.t0 = Date.now(); W.drag.moved = false;
      W.drag.tapIndex = i;
    }
  }

  function onPointerMove(ev) {
    if (!W) return;
    /* shipwright-expansion-1: live cluster selection rectangle */
    if (W.clusterDrag) {
      var r = canvas.getBoundingClientRect();
      var cls = shipClass();
      var gx = Math.floor((ev.clientX - r.left) / cell);
      var gy = Math.floor((ev.clientY - r.top) / cell);
      W.clusterDrag.x1 = Math.max(0, Math.min(cls.gridW - 1, gx));
      W.clusterDrag.y1 = Math.max(0, Math.min(cls.gridH - 1, gy));
      drawGrid(null);
      return;
    }
    if (!W.drag) return;
    ev.preventDefault();
    if (Math.abs(ev.clientX - W.drag.px) + Math.abs(ev.clientY - W.drag.py) > 2) W.drag.moved = true;
    moveGhost(ev.clientX, ev.clientY);
  }

  function onPointerUp(ev) {
    if (!W) return;
    /* shipwright-expansion-1: finalize a cluster selection rectangle */
    if (W.clusterDrag) {
      var cd = W.clusterDrag;
      W.clusterDrag = null;
      var n = clusterSelectRect(Math.min(cd.x0, cd.x1), Math.min(cd.y0, cd.y1),
        Math.abs(cd.x1 - cd.x0) + 1, Math.abs(cd.y1 - cd.y0) + 1);
      W.clusterArmed = false;
      if (n > 0) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('◱ Cluster captured (' + n + ' parts) — tap the grid to stamp it');
        SF.Audio.ui();
      } else {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('◱ No fitted parts in that rectangle');
        SF.Audio.deny();
      }
      drawGrid(null); renderTools();
      return;
    }
    if (!W.drag) return;
    var drag = W.drag;
    W.drag = null;
    hideGhost();

    // tap (no real move) on a canvas part = select it
    if (!drag.moved && drag.tapIndex !== undefined && Date.now() - drag.t0 < 400) {
      W.selected = drag.tapIndex;
      renderSelected(); drawGrid(null);
      return;
    }

    /* builder-drag-fix: tap (no real move) on a PALETTE part = arm/disarm
     * tap-to-place. Touch users are never forced to drag: the palette
     * scrolls under a vertical pan (touch-action: pan-y), so a precise
     * drag out of a long scrolled list is the worst possible primary
     * interaction on a phone. Tapping the armed part again disarms. */
    if (!drag.moved && drag.palette) {
      if (W.armed === drag.partId) disarmPart();
      else armPart(drag.partId);
      SF.Audio.ui();
      return;
    }

    var c = canvasCell(ev.clientX, ev.clientY);
    if (!c) {
      // dropped off-grid: remove (only if it came from the grid)
      if (drag.fromIndex !== null && drag.fromIndex !== undefined) {
        pushUndo(); /* shipwright-expansion-1 */
        var fp = W.parts[drag.fromIndex];
        SF.Player.addPart(fp.partId, 1);
        W.parts.splice(drag.fromIndex, 1);
        SF.Audio.ui();
      }
      renderAll();
      return;
    }

    if (canDropAt(c.gx, c.gy, drag)) {
      if (drag.fromIndex !== null && drag.fromIndex !== undefined) {
        // move existing
        pushUndo(); /* shipwright-expansion-1 */
        var mfp = W.parts[drag.fromIndex];
        mfp.gx = c.gx; mfp.gy = c.gy; mfp.rotated = drag.rotated;
        SF.Audio.ui();
      } else {
        // place from palette (programmatic placement shared with the tools)
        if ((SF.Player.partInventory[drag.partId] || 0) <= 0) { SF.Audio.deny(); renderAll(); return; }
        pushUndo(); /* shipwright-expansion-1 */
        if (placeWithMirror(drag.partId, c.gx, c.gy, drag.rotated)) {
          SF.Audio.ui();
          /* builder-drag-fix: a completed drag supersedes tap-to-place */
          W.armed = null;
        } else {
          SF.Audio.deny();
        }
      }
    } else {
      SF.Audio.deny();
    }
    renderAll();
  }

  /* builder-drag-fix: the browser took the gesture over (scroll, etc.).
   * Discard the drag/cluster-drag with NO side effects — never place,
   * never remove, never select. */
  function onPointerCancel() {
    if (!W) return;
    W.clusterDrag = null;
    if (W.drag) { W.drag = null; hideGhost(); }
    drawGrid(null);
  }

  /* ========== builder-drag-fix: tap-to-place ==========
   * armPart(partId): mark a palette part as armed. The palette item gets
   * the .armed style, the inventory head shows the hint, the compare panel
   * previews the part (same as hover/drag), and the canvas draws the drop
   * highlight under the pointer. placeArmedAt() routes through the same
   * placeWithMirror() path as a drag-drop, so fit checks, inventory take,
   * mirror twin and the undo step behave identically. After a placement
   * the part STAYS armed while copies remain in inventory (fast repeat
   * placement); it disarms when the last copy is used, when the part is
   * tapped again, on Esc, or when the cluster tool is armed. */
  function armPart(partId) {
    if (!W || !SF.PART_BY_ID[partId]) return;
    if (W.cluster || W.clusterArmed) cancelCluster(); // mutually exclusive
    W.armed = partId;
    W.comparePartId = partId;
    renderCompare();
    renderPalette();
    drawGrid(null);
  }

  function disarmPart() {
    if (!W) return;
    W.armed = null;
    renderPalette();
    drawGrid(null);
  }

  function placeArmedAt(gx, gy) {
    var partId = W.armed;
    if (!partId) return;
    if ((SF.Player.partInventory[partId] || 0) <= 0) { SF.Audio.deny(); disarmPart(); return; }
    var trial = { partId: partId, gx: gx, gy: gy, rotated: false, stars: 1 };
    if (!SF.Parts.canPlace(shipClass(), W.parts, trial, -1)) { SF.Audio.deny(); drawGrid(null); return; }
    pushUndo();
    if (placeWithMirror(partId, gx, gy, false)) {
      SF.Audio.ui();
      if ((SF.Player.partInventory[partId] || 0) <= 0) W.armed = null;
    } else {
      SF.Audio.deny();
    }
    renderAll();
  }

  /* Place one palette part at a cell plus the mirror twin when mirror
   * mode is on. Shared by drag-drop and tap-to-place. Callers own the
   * undo step and the inventory sanity check. */
  function placeWithMirror(partId, gx, gy, rotated) {
    if (!placePartAt(partId, gx, gy, rotated)) return false;
    /* shipwright-expansion-1: mirror mode — drop the symmetric twin.
     * Needs a second loose copy; if it cannot fit or none is owned,
     * say so instead of silently placing a lone part. */
    if (W.mirror) {
      var clsM = shipClass();
      var ddM = dragDims({ partId: partId, rotated: rotated });
      var mgx = clsM.gridW - gx - ddM.w;
      if (mgx !== gx && !placePartAt(partId, mgx, gy, rotated)) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('🪞 Mirror copy did not fit (or no spare in inventory)');
      }
    }
    return true;
  }

  /* ========== shipwright-expansion-1: builder tools ==========
   * Mirror/symmetry placement, undo/redo, copy-cluster stamping, whole-
   * layout flip, clear-with-confirm, partial scrap refunds, a per-class
   * layout library (renderPresets grouping, above), layout A/B compare,
   * and an advisory build coach. Everything here is draft-side only:
   * no save-format change, and every mutation routes through pushUndo()
   * snapshots EXCEPT star upgrades (a purchase — undoing one would dupe
   * credits) and scrapping (pays credits out, so it clears the stacks). */

  var UNDO_MAX = 60;
  var SCRAP_RATE = 0.2; // partial scrap refund: 20% of star-scaled value

  /* --- undo/redo: full draft snapshots (fitted parts + loose inventory),
   * so a step restores both sides of every take/return pair. --- */
  function snapshotDraft() {
    return {
      parts: packParts(W.parts),
      inv: JSON.parse(JSON.stringify(SF.Player.partInventory || {}))
    };
  }

  function restoreSnapshot(snap) {
    W.parts = unpackParts(snap.parts);
    try { SF.Player.partInventory = JSON.parse(JSON.stringify(snap.inv)); }
    catch (e) { /* inventory restore is best-effort; parts are the draft */ }
    W.selected = null;
  }

  function pushUndo() {
    if (!W) return;
    W.undoStack.push(snapshotDraft());
    if (W.undoStack.length > UNDO_MAX) W.undoStack.shift();
    W.redoStack.length = 0;
  }

  function undoLayout() {
    if (!W || !W.undoStack.length) { SF.Audio.deny(); return false; }
    W.redoStack.push(snapshotDraft());
    restoreSnapshot(W.undoStack.pop());
    SF.Audio.ui();
    renderAll();
    return true;
  }

  function redoLayout() {
    if (!W || !W.redoStack.length) { SF.Audio.deny(); return false; }
    W.undoStack.push(snapshotDraft());
    restoreSnapshot(W.redoStack.pop());
    SF.Audio.ui();
    renderAll();
    return true;
  }

  /* Programmatic palette placement shared by drag-drop, mirror mode,
   * cluster stamping and the tools API. Checks grid fit AND takes the
   * part from loose inventory, then re-renders so stats/validity are
   * never stale. Does not snapshot — callers own the undo step (one user
   * gesture = one step, mirror twin included). */
  function placePartAt(partId, gx, gy, rotated) {
    if (!W || !SF.PART_BY_ID[partId]) return false;
    var cls = shipClass();
    var fp = { partId: partId, gx: gx, gy: gy, rotated: !!rotated, stars: 1 };
    if (!SF.Parts.canPlace(cls, W.parts, fp, -1)) return false;
    if (!SF.Player.takePart(partId)) return false;
    W.parts.push(fp);
    renderAll();
    return true;
  }

  /* --- flip the whole layout (validated: a mirrored overlap is refused,
   * never half-applied) --- */
  function flipLayout(axis) {
    if (!W || !W.parts.length) { SF.Audio.deny(); return false; }
    var cls = shipClass();
    var cand = W.parts.map(function (fp) {
      var d = SF.Parts.dims(fp);
      var nf = { partId: fp.partId, gx: fp.gx, gy: fp.gy,
                 rotated: fp.rotated, stars: fp.stars || 1 };
      if (axis === 'h') nf.gx = cls.gridW - fp.gx - d.w;
      else nf.gy = cls.gridH - fp.gy - d.h;
      return nf;
    });
    var placed = [];
    for (var i = 0; i < cand.length; i++) {
      if (!SF.Parts.canPlace(cls, placed, cand[i], -1)) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Flip would overlap — layout unchanged');
        SF.Audio.deny();
        return false;
      }
      placed.push(cand[i]);
    }
    pushUndo();
    W.parts = cand;
    W.selected = null;
    SF.Audio.ui();
    renderAll();
    return true;
  }

  /* --- partial scrap refund --- */
  function partScrapValue(fp) {
    var p = fp && SF.PART_BY_ID[fp.partId];
    if (!p) return 0;
    return Math.floor(p.price * SF.Parts.starMult(fp.stars || 1) * SCRAP_RATE);
  }

  function scrapPartAt(index) {
    if (!W || !W.parts[index]) return 0;
    var fp = W.parts[index];
    var val = partScrapValue(fp);
    SF.Player.credits += val;
    W.parts.splice(index, 1);
    if (W.selected === index) W.selected = null;
    /* credits were paid out: history must not resurrect the part */
    W.undoStack.length = 0;
    W.redoStack.length = 0;
    if (SF.HUD && SF.HUD.toast) SF.HUD.toast('♻ Scrapped for ' + fmt(val) + ' credits');
    SF.Audio.buy();
    renderAll();
    return val;
  }

  /* --- copy-cluster: capture the fitted parts inside a rectangle, then
   * stamp copies of the group anywhere the group fits (loose inventory
   * pays for every copy — no free duplication). --- */
  function clusterSelectRect(gx, gy, w, h) {
    if (!W) return 0;
    var specs = [];
    W.parts.forEach(function (fp) {
      var d = SF.Parts.dims(fp);
      if (fp.gx < gx + w && fp.gx + d.w > gx && fp.gy < gy + h && fp.gy + d.h > gy) {
        specs.push({ partId: fp.partId, dx: fp.gx - gx, dy: fp.gy - gy,
                     rotated: !!fp.rotated, stars: fp.stars || 1 });
      }
    });
    W.cluster = specs.length ? { specs: specs, w: w, h: h } : null;
    return specs.length;
  }

  function stampClusterAt(gx, gy) {
    if (!W || !W.cluster) return false;
    var cls = shipClass();
    var specs = W.cluster.specs;
    var need = {};
    specs.forEach(function (sp) { need[sp.partId] = (need[sp.partId] || 0) + 1; });
    var inv = SF.Player.partInventory;
    var id;
    for (id in need) {
      if ((inv[id] || 0) < need[id]) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('◱ Not enough loose parts to stamp this cluster');
        SF.Audio.deny();
        return false;
      }
    }
    var placed = W.parts.slice();
    var news = [];
    for (var i = 0; i < specs.length; i++) {
      var sp = specs[i];
      var fp = { partId: sp.partId, gx: gx + sp.dx, gy: gy + sp.dy,
                 rotated: sp.rotated, stars: sp.stars };
      if (!SF.Parts.canPlace(cls, placed, fp, -1)) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('◱ Cluster does not fit there');
        SF.Audio.deny();
        return false;
      }
      placed.push(fp);
      news.push(fp);
    }
    pushUndo();
    news.forEach(function (nfp) { SF.Player.takePart(nfp.partId); W.parts.push(nfp); });
    SF.Audio.buy();
    renderAll();
    return true;
  }

  function cancelCluster() {
    if (!W) return;
    W.cluster = null;
    W.clusterArmed = false;
    W.clusterDrag = null;
    drawGrid(null);
    renderTools();
  }

  function clearDraftLayout() {
    if (!W) return;
    pushUndo(); /* clearing is one undoable step */
    W.parts.forEach(function (fp) { SF.Player.addPart(fp.partId, 1); });
    W.parts = [];
    W.selected = null;
    renderAll();
  }

  /* --- layout metrics + A/B compare --- */
  /* Set multiplier for one stat over an arbitrary part list — mirrors
   * ship.js setBonusesFor exactly (2+ pieces of a maker line, tiers 2/3/4). */
  function layoutSetMul(stat, parts) {
    if (!window.SF || !SF.SET_LINES) return 1;
    var counts = {};
    (parts || []).forEach(function (fp) {
      var p = SF.PART_BY_ID[fp.partId];
      if (p && p.maker && SF.SET_LINES[p.maker]) counts[p.maker] = (counts[p.maker] || 0) + 1;
    });
    var m = 1;
    Object.keys(SF.SET_LINES).forEach(function (lid) {
      var n = counts[lid] || 0;
      if (n < 2) return;
      var line = SF.SET_LINES[lid];
      var tier = n >= 4 ? 4 : (n >= 3 ? 3 : 2);
      var t = line.tiers && line.tiers[tier];
      if (t && line.stat === stat) m *= t.mul;
    });
    return m;
  }

  /* Headline numbers for a whole layout: power net, DPS of the weapons the
   * layout's slots can actually mount (owned weapons in order, set damage
   * multiplier applied), EHP (hull + set-scaled shield), speed, cargo,
   * slots. Build-vs-build only: temporary flight state (power profile,
   * subsystem damage) is deliberately excluded. */
  function layoutMetrics(classId, parts) {
    var s = SF.Parts.derive(classId, parts);
    var dps = 0;
    var owned = (SF.Player && SF.Player.weaponsOwned) || [];
    if (window.SF && SF.Mods && SF.Mods.dps) {
      var n = Math.min(Math.floor(s.slots), owned.length);
      for (var i = 0; i < n; i++) {
        var e = owned[i];
        var wid = e && (e.id || e.weaponId);
        if (wid) dps += SF.Mods.dps(wid, e.stars || 1, e);
      }
      dps *= layoutSetMul('dmg', parts);
    }
    return {
      powerNet: s.powerNet,
      dps: Math.round(dps * 10) / 10,
      ehp: s.hull + Math.round(s.shield * layoutSetMul('shield', parts)),
      speed: Math.round(s.speed * layoutSetMul('speed', parts)),
      cargo: s.cargo,
      slots: Math.floor(s.slots)
    };
  }

  var AB_ROWS = [
    { key: 'powerNet', label: 'Power net' },
    { key: 'dps',      label: 'DPS (mounted weapons)' },
    { key: 'ehp',      label: 'EHP (hull + shield)' },
    { key: 'speed',    label: 'Speed' },
    { key: 'cargo',    label: 'Cargo' },
    { key: 'slots',    label: 'Weapon slots' }
  ];

  function abCompare(name) {
    var rep = { ok: false, name: name, reason: '', rows: [] };
    if (!W) { rep.reason = 'builder closed'; return rep; }
    var pr = presetByName(name);
    if (!pr) { rep.reason = 'preset not found'; return rep; }
    var ship = SF.Player.ships[W.shipIndex];
    if (pr.classId !== ship.classId) { rep.reason = 'preset is for another hull class'; return rep; }
    var cur = layoutMetrics(ship.classId, W.parts);
    var alt = layoutMetrics(ship.classId, unpackParts(pr.parts));
    rep.rows = AB_ROWS.map(function (r) {
      return { key: r.key, label: r.label, cur: cur[r.key], alt: alt[r.key],
               delta: Math.round((alt[r.key] - cur[r.key]) * 10) / 10 };
    });
    rep.ok = true;
    W.abPreset = name;
    renderABCompare();
    return rep;
  }

  function renderABCompare() {
    if (!built || !W) return;
    var box = el['builder-abcompare'];
    if (!box) return;
    var hint = '<div class="dim" style="font-size:12px;line-height:1.5">' +
      'Pick ⚖ A/B on a saved layout for this hull to compare it against the ' +
      'current draft — power, DPS, EHP, speed, cargo, slots.</div>';
    var name = W.abPreset;
    var pr = name ? presetByName(name) : null;
    if (!pr) { box.innerHTML = hint; return; }
    var ship = SF.Player.ships[W.shipIndex];
    if (pr.classId !== ship.classId) { box.innerHTML = hint; return; }
    var cur = layoutMetrics(ship.classId, W.parts);
    var alt = layoutMetrics(ship.classId, unpackParts(pr.parts));
    var h = '<div style="font-size:12px;font-weight:bold;color:#ffd23f;margin-bottom:2px">' +
      '⚖️ LAYOUT A/B</div>' +
      '<div class="dim" style="font-size:11px;margin-bottom:4px">current draft → ' +
      '<b style="color:#dfe8ff">' + escHtml(name) + '</b></div>';
    AB_ROWS.forEach(function (r) {
      var a = cur[r.key], b = alt[r.key], d = Math.round((b - a) * 10) / 10;
      var dc = d > 0 ? '#3ddc5f' : (d < 0 ? '#ff5e3a' : '#9db0cc');
      var dt = d > 0 ? '+' + fmtCmp(d) : (d < 0 ? '-' + fmtCmp(-d) : '±0');
      h += '<div style="display:flex;justify-content:space-between;align-items:baseline;' +
        'font-size:12px;padding:2px 0;border-top:1px solid #1a2547">' +
        '<span style="color:#9db0cc">' + r.label + '</span><span>' +
        '<span class="dim">' + fmtCmp(a) + '</span> <span style="color:#5a6b8a">→</span> ' +
        '<b>' + fmtCmp(b) + '</b> ' +
        '<b style="color:' + dc + ';min-width:46px;display:inline-block;text-align:right">' +
        dt + '</b></span></div>';
    });
    box.innerHTML = h;
  }

  /* --- build validation coach: ADVISORY ONLY. These never block a save;
   * derive().valid (engine/reactor/power) stays the only hard gate. --- */
  function coachWarnings() {
    if (!W) return [];
    var ship = SF.Player.ships[W.shipIndex];
    var cls = SF.SHIP_CLASS_BY_ID[ship.classId];
    var s = SF.Parts.derive(ship.classId, W.parts);
    var w = [];
    if (Math.floor(s.slots) === 0)
      w.push('No weapon mounts fitted — this ship cannot fight back.');
    if (!s.pd)
      w.push('No point-defense — missiles and ramming drones get a free run at your hull.');
    if (!s.sensor && !s.ecm)
      w.push('No sensor/ECM suite — survey pings stay at standard reach and enemy fire flies unjammed.');
    if ((cls.cargoBonus || 0) >= 40 && s.cargo <= (cls.cargoBonus || 0))
      w.push('Trader hull with no cargo fitted — you are flying an empty barge.');
    if (s.mining > 0 && s.cargo < 60)
      w.push('Mining rig fitted but cargo is tight — ore will back up fast.');
    if (s.cloak > 0 && s.valid && s.powerNet < s.powerGen * 0.15)
      w.push('Cloak fitted on a thin power margin — one more consumer tips you into deficit.');
    if (s.drones > 0 && Math.floor(s.slots) === 0)
      w.push('Drone bay fitted with no gun mounts — the swarm fights, you watch.');
    return w;
  }

  function renderCoach() {
    if (!built || !W) return;
    var box = el['builder-coach'];
    if (!box) return;
    var w = coachWarnings();
    if (!w.length) {
      box.innerHTML = '<div style="font-size:12px;color:#3ddc5f">✓ No advisories — sane build.</div>';
      return;
    }
    var h = '<div style="font-size:12px;line-height:1.55">';
    w.forEach(function (t) {
      h += '<div style="padding:2px 0;border-top:1px solid #1a2547">' +
        '<span style="color:#ffd23f">⚠</span> ' + escHtml(t) + '</div>';
    });
    h += '<div class="dim" style="margin-top:4px">Advice only — the build still flies.</div></div>';
    box.innerHTML = h;
  }

  /* --- tools bar --- */
  function renderTools() {
    if (!built || !W) return;
    var box = el['builder-tools'];
    if (!box) return;
    box.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'store-head';
    head.textContent = 'BUILD TOOLS';
    box.appendChild(head);
    var row = document.createElement('div');
    /* builder-drag-fix: class-driven (media queries restyle it) */
    row.className = 'tools-row';
    box.appendChild(row);
    var mk = function (label, title, fn, opts) {
      opts = opts || {};
      var b = document.createElement('button');
      b.className = 'btn small ui-block';
      b.textContent = label;
      b.title = title;
      if (opts.disabled) b.disabled = true;
      if (opts.active) b.style.cssText = 'background:#2c4a7c;color:#fff';
      b.addEventListener('click', fn);
      row.appendChild(b);
      return b;
    };
    mk('↩ UNDO' + (W.undoStack.length ? ' (' + W.undoStack.length + ')' : ''),
      'Undo the last layout change (Ctrl+Z)', function () { undoLayout(); },
      { disabled: !W.undoStack.length });
    mk('↪ REDO' + (W.redoStack.length ? ' (' + W.redoStack.length + ')' : ''),
      'Redo (Ctrl+Shift+Z / Ctrl+Y)', function () { redoLayout(); },
      { disabled: !W.redoStack.length });
    mk('🪞 MIRROR', 'Mirror mode: palette drops also place the symmetric twin (needs a spare copy)',
      function () {
        W.mirror = !W.mirror;
        SF.Audio.ui();
        renderTools();
      }, { active: W.mirror });
    mk(W.cluster ? '◱ STAMP ✕' : (W.clusterArmed ? '◱ SELECTING…' : '◱ CLUSTER'),
      'Copy-cluster: drag a rectangle over fitted parts to capture them, then tap the grid to stamp copies',
      function () {
        if (W.cluster) { cancelCluster(); SF.Audio.ui(); return; }
        /* builder-drag-fix: cluster and tap-to-place are exclusive modes */
        if (!W.clusterArmed && W.armed) { W.armed = null; renderPalette(); }
        W.clusterArmed = !W.clusterArmed;
        if (W.clusterArmed && SF.HUD && SF.HUD.toast)
          SF.HUD.toast('◱ Drag a rectangle over fitted parts to capture a cluster');
        SF.Audio.ui();
        renderTools();
      }, { active: W.clusterArmed || !!W.cluster });
    mk('↔ FLIP H', 'Flip the whole layout left-right', function () { flipLayout('h'); });
    mk('↕ FLIP V', 'Flip the whole layout top-bottom', function () { flipLayout('v'); });
    mk('🗑 CLEAR', 'Return every fitted part to inventory (undoable)',
      function () {
        if (!W.parts.length) { SF.Audio.deny(); return; }
        /* builder-drag-fix: modal, not window.confirm (dead on device) */
        builderConfirm('Clear the whole grid? Every fitted part goes back to your inventory. (Undoable)',
          function () { clearDraftLayout(); });
      });
    var hint = document.createElement('div');
    hint.className = 'dim tools-hint';
    hint.style.marginTop = '6px';
    hint.textContent = W.cluster
      ? 'Cluster captured — tap the grid to stamp copies (each copy comes out of loose inventory).'
      : (W.clusterArmed
        ? 'Drag a rectangle over fitted parts to capture a cluster.'
        : 'Mirror drops place a symmetric twin · Cluster stamps a captured group · Scrap (in part inspector) pays 20%.');
    box.appendChild(hint);
  }

  /* ========== builder-drag-fix: in-builder modal ==========
   * The Android shell (MainActivity) installs a WebViewClient but NO
   * WebChromeClient, so on device window.alert() is a silent no-op,
   * window.confirm() always returns false and window.prompt() always
   * returns null. That made every dialog-gated builder action a dead
   * button on the phone: CLEAR, SCRAP, preset delete, preset import,
   * preset rename, the export-code fallback, and apply-failure alerts.
   * All of them route through this DOM modal instead. One modal at a
   * time; the pending callback fires exactly once via settleModal(). */
  var modalState = null; // { onOk, onCancel, input }

  function showBuilderModal(opts) {
    if (!built) return;
    modalState = { onOk: opts.onOk || null, onCancel: opts.onCancel || null, input: !!opts.input };
    el['bm-msg'].textContent = opts.msg || '';
    el['bm-input'].classList.toggle('hidden', !opts.input);
    el['bm-text'].classList.toggle('hidden', !opts.text);
    if (opts.input) el['bm-input'].value = opts.value || '';
    if (opts.text) el['bm-text'].value = opts.text;
    el['bm-ok'].textContent = opts.okLabel || 'OK';
    el['bm-cancel'].classList.toggle('hidden', !!opts.noCancel);
    el['builder-modal'].classList.remove('hidden');
    if (opts.input) { try { el['bm-input'].focus(); el['bm-input'].select(); } catch (e) { /* focus is a nicety */ } }
  }

  function settleModal(ok) {
    if (!modalState) return;
    var st = modalState;
    modalState = null;
    el['builder-modal'].classList.add('hidden');
    if (ok) { if (st.onOk) st.onOk(st.input ? el['bm-input'].value : undefined); }
    else if (st.onCancel) st.onCancel();
  }

  function builderConfirm(msg, onYes) {
    showBuilderModal({ msg: msg, okLabel: 'CONFIRM', onOk: function () { onYes(); } });
  }

  function builderAlert(msg) {
    showBuilderModal({ msg: msg, okLabel: 'OK', noCancel: true });
  }

  function builderPrompt(msg, value, onOk) {
    showBuilderModal({ msg: msg, input: true, value: value, okLabel: 'OK',
      onOk: function (v) { onOk(v); } });
  }

  /* ---------- build presets (builder-presets phase) ----------
   * Named 24-part loadout templates stored in localStorage (NOT in the save
   * blob — save-neutral, SF.SAVE_VERSION untouched). Applying a preset
   * validates owned parts + grid placement + power budget and reports misses.
   * Export/import codes are short base64url strings of the preset JSON. */
  var PRESET_KEY = 'starfall_builder_presets_v1';
  var PRESET_MAX = 24;
  var lastPresetReport = null;

  function loadPresets() {
    try {
      var raw = localStorage.getItem(PRESET_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (p) { return p && p.name && Array.isArray(p.parts); });
    } catch (e) { return []; }
  }

  function storePresets(arr) {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(arr)); } catch (e) { /* storage full/blocked */ }
  }

  function presetByName(name) {
    var list = loadPresets();
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }

  /* pack a fitted-part list into compact spec arrays [partId,gx,gy,rot,stars] */
  function packParts(parts) {
    return parts.map(function (fp) {
      return [fp.partId, fp.gx, fp.gy, fp.rotated ? 1 : 0, fp.stars || 1];
    });
  }

  function unpackParts(specs) {
    return specs.map(function (s) {
      return { partId: s[0], gx: s[1], gy: s[2], rotated: !!s[3], stars: s[4] || 1 };
    });
  }

  function savePreset(name) {
    if (!W) return null;
    name = (name || '').trim().slice(0, 32);
    if (!name) return null;
    var list = loadPresets();
    var ship = SF.Player.ships[W.shipIndex];
    var pr = {
      name: name,
      classId: ship.classId,
      parts: packParts(W.parts),
      savedAt: Date.now()
    };
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) { list[i] = pr; found = true; break; }
    }
    if (!found) list.push(pr);
    while (list.length > PRESET_MAX) list.shift();
    storePresets(list);
    SF.Audio.buy();
    if (SF.Audio && SF.Audio.sfx) SF.Audio.sfx('preset_save');
    renderPresets();
    return pr;
  }

  function deletePreset(name) {
    var list = loadPresets().filter(function (p) { return p.name !== name; });
    storePresets(list);
    SF.Audio.ui();
    renderPresets();
  }

  function renamePreset(oldName, newName) {
    newName = (newName || '').trim().slice(0, 32);
    if (!newName) return false;
    var list = loadPresets();
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === newName && newName !== oldName) return false; // collision
    }
    for (var j = 0; j < list.length; j++) {
      if (list[j].name === oldName) { list[j].name = newName; break; }
    }
    storePresets(list);
    SF.Audio.ui();
    renderPresets();
    return true;
  }

  function encodePreset(pr) {
    var payload = { v: 1, name: pr.name, classId: pr.classId, parts: pr.parts };
    return 'SFBP1.' + btoa(JSON.stringify(payload))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodePreset(code) {
    try {
      code = (code || '').trim();
      if (code.slice(0, 6) !== 'SFBP1.') return null;
      var json = atob(code.slice(6).replace(/-/g, '+').replace(/_/g, '/'));
      var o = JSON.parse(json);
      if (!o || o.v !== 1 || !Array.isArray(o.parts)) return null;
      for (var i = 0; i < o.parts.length; i++) {
        var s = o.parts[i];
        if (!s || !SF.PART_BY_ID[s[0]]) return null; // unknown part id
      }
      return o;
    } catch (e) { return null; }
  }

  function exportPreset(name) {
    var pr = presetByName(name);
    return pr ? encodePreset(pr) : null;
  }

  function importPreset(code, asName) {
    var o = decodePreset(code);
    if (!o) return null;
    var list = loadPresets();
    var name = (asName || o.name || 'imported').trim().slice(0, 32) || 'imported';
    var base = name, n = 2;
    while (presetByName(name) && list.some(function (p) { return p.name === name; })) {
      name = (base + ' ' + n).slice(0, 32); n++;
    }
    var pr = { name: name, classId: o.classId, parts: o.parts, savedAt: Date.now() };
    list.push(pr);
    while (list.length > PRESET_MAX) list.shift();
    storePresets(list);
    SF.Audio.buy();
    renderPresets();
    return pr;
  }

  /* Apply a preset transactionally: validate ownership (inventory + parts that
   * will be freed from the current draft), grid placement, then swap. */
  function applyPreset(name) {
    var rep = { ok: false, name: name, applied: 0, missing: [], unplaceable: [],
      classMismatch: false, powerNet: 0, valid: false, reasons: [] };
    if (!W) { lastPresetReport = rep; return rep; }
    var pr = presetByName(name);
    if (!pr) { rep.missing.push('preset not found: ' + name); lastPresetReport = rep; return rep; }
    var ship = SF.Player.ships[W.shipIndex];
    if (pr.classId !== ship.classId) {
      rep.classMismatch = true;
      var have = SF.SHIP_CLASS_BY_ID[ship.classId], want = SF.SHIP_CLASS_BY_ID[pr.classId];
      rep.missing.push('preset is for ' + (want ? want.name : pr.classId) +
        ', current ship is ' + (have ? have.name : ship.classId));
      lastPresetReport = rep;
      return rep;
    }
    var cls = shipClass();
    var parts = unpackParts(pr.parts);

    // availability: loose inventory + everything fitted in the current draft
    var avail = {};
    var inv = SF.Player.partInventory;
    Object.keys(inv).forEach(function (id) { avail[id] = inv[id] || 0; });
    W.parts.forEach(function (fp) { avail[fp.partId] = (avail[fp.partId] || 0) + 1; });
    parts.forEach(function (fp) {
      var p = SF.PART_BY_ID[fp.partId];
      if (!p) { rep.missing.push('unknown part: ' + fp.partId); return; }
      if ((avail[fp.partId] || 0) <= 0) rep.missing.push(p.name + ' (not owned)');
      else avail[fp.partId]--;
    });

    // placement check on an empty grid of this hull
    var placed = [];
    parts.forEach(function (fp) {
      if (SF.Parts.canPlace(cls, placed, fp, -1)) placed.push(fp);
      else {
        var p = SF.PART_BY_ID[fp.partId];
        rep.unplaceable.push((p ? p.name : fp.partId) + ' @' + fp.gx + ',' + fp.gy);
      }
    });

    if (rep.missing.length || rep.unplaceable.length) { lastPresetReport = rep; SF.Audio.deny(); return rep; }

    // transactional swap
    pushUndo(); /* shipwright-expansion-1: applying a preset is one undo step */
    W.parts.forEach(function (fp) { SF.Player.addPart(fp.partId, 1); });
    var took = true;
    parts.forEach(function (fp) { if (!SF.Player.takePart(fp.partId)) took = false; });
    if (!took) { // defensive: inventory changed mid-apply; restore draft state best-effort
      rep.missing.push('inventory changed during apply');
      lastPresetReport = rep; SF.Audio.deny(); return rep;
    }
    W.parts = parts;
    W.selected = null;
    var s = SF.Parts.derive(ship.classId, W.parts);
    rep.ok = true;
    rep.applied = parts.length;
    rep.powerNet = s.powerNet;
    rep.valid = s.valid;
    rep.reasons = s.reasons;
    SF.Audio.buy();
    if (SF.Audio && SF.Audio.sfx) SF.Audio.sfx('preset_apply');
    renderAll();
    lastPresetReport = rep;
    return rep;
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        var pr = navigator.clipboard.writeText(text);
        /* builder-drag-fix: swallow async rejection — an unhandled
         * rejection logs a console error and the toast already told the
         * user it copied; clipboard in the WebView is best-effort. */
        if (pr && pr.catch) pr.catch(function () { /* best-effort */ });
        return true;
      }
    } catch (e) { /* fall through */ }
    return false;
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderPresets() {
    if (!built || !W) return;
    var box = el['builder-presets'];
    box.innerHTML = '';
    var list = loadPresets();
    var ship = SF.Player.ships[W.shipIndex];
    var shipClsName = shipClass().name;

    var head = document.createElement('div');
    head.innerHTML = '<div class="dim" style="margin-bottom:6px">Save this ' + escHtml(shipClsName) +
      ' build (' + W.parts.length + ' parts), or apply a saved one.</div>';
    box.appendChild(head);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:8px';
    var nm = document.createElement('input');
    nm.id = 'preset-name-input';
    nm.placeholder = 'Preset name…';
    nm.maxLength = 32;
    nm.style.cssText = 'flex:1;background:#0b1330;border:1px solid #2c3d6b;color:#dfe8ff;padding:6px 8px;border-radius:6px';
    nm.className = 'ui-block';
    row.appendChild(nm);
    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn small ui-block'; saveBtn.textContent = '💾 SAVE';
    saveBtn.addEventListener('click', function () {
      var r = savePreset(nm.value);
      if (!r) SF.Audio.deny(); else nm.value = '';
      renderPresets();
    });
    row.appendChild(saveBtn);
    var impBtn = document.createElement('button');
    impBtn.className = 'btn small ui-block'; impBtn.textContent = '📥 IMPORT';
    impBtn.title = 'Import a preset code';
    impBtn.addEventListener('click', function () {
      /* builder-drag-fix: modal, not window.prompt (dead on device) */
      builderPrompt('Paste a preset code (SFBP1.…):', '', function (code) {
        if (!code) return;
        var pr = importPreset(code);
        if (!pr) { SF.Audio.deny(); builderAlert('Invalid preset code.'); }
        else builderAlert('Imported preset "' + pr.name + '".');
      });
    });
    row.appendChild(impBtn);
    box.appendChild(row);

    /* shipwright-expansion-1: the layout library — presets grouped by hull
     * class (this hull first), with an ALL / THIS HULL filter so a growing
     * library stays scannable in the Shipwright. */
    var filterRow = document.createElement('div');
    filterRow.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
    [['all', 'ALL BUILDS'], ['this', 'THIS HULL ONLY']].forEach(function (fv) {
      var fb = document.createElement('button');
      fb.className = 'btn small ui-block';
      fb.textContent = fv[1];
      if (W.presetFilter === fv[0]) fb.style.cssText = 'background:#2c4a7c;color:#fff';
      fb.addEventListener('click', function () {
        W.presetFilter = fv[0];
        SF.Audio.ui();
        renderPresets();
      });
      filterRow.appendChild(fb);
    });
    box.appendChild(filterRow);

    if (!list.length) {
      var d = document.createElement('div');
      d.className = 'dim';
      d.textContent = 'No presets yet. Fit a build and hit SAVE.';
      box.appendChild(d);
      return;
    }

    var renderPresetItem = function (pr) {
      var item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 4px;border-top:1px solid #22315c';
      var label = document.createElement('span');
      label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      var sameCls = pr.classId === ship.classId;
      label.innerHTML = '<b>' + escHtml(pr.name) + '</b> <span class="dim">' +
        pr.parts.length + ' parts' + (sameCls ? '' : ' · ⚠ ' + escHtml((SF.SHIP_CLASS_BY_ID[pr.classId] || {}).name || pr.classId)) + '</span>';
      item.appendChild(label);

      var mk = function (txt, title, fn) {
        var b = document.createElement('button');
        b.className = 'btn small ui-block'; b.textContent = txt; b.title = title;
        b.addEventListener('click', fn);
        item.appendChild(b);
        return b;
      };
      mk('▶ APPLY', 'Apply this preset to the current draft', function () {
        var rep = applyPreset(pr.name);
        if (!rep.ok) {
          var msg = rep.missing.concat(rep.unplaceable).join('\n');
          SF.Audio.deny();
          /* builder-drag-fix: modal, not window.alert (dead on device) */
          builderAlert('Cannot apply "' + pr.name + '":\n' + msg);
        } else if (!rep.valid) {
          builderAlert('Applied "' + pr.name + '", but it is NOT flight-ready:\n' + rep.reasons.join(' · '));
        }
        renderPresets();
      });
      /* shipwright-expansion-1: A/B compare against the current draft */
      if (sameCls) {
        mk('⚖ A/B', 'Compare this layout against the current draft', function () {
          W.abPreset = pr.name;
          SF.Audio.ui();
          renderABCompare();
        });
      }
      mk('⬆', 'Export as copy-paste code', function () {
        var code = exportPreset(pr.name);
        var copied = code && copyText(code);
        if (copied) SF.HUD.toast('Preset code copied to clipboard');
        /* builder-drag-fix: modal with a selectable code field, not
         * window.prompt (dead on device) */
        else showBuilderModal({ msg: 'Copy the preset code:', text: code || '', okLabel: 'DONE', noCancel: true });
      });
      mk('✎', 'Rename preset', function () {
        /* builder-drag-fix: modal, not window.prompt (dead on device) */
        builderPrompt('Rename "' + pr.name + '" to:', pr.name, function (nn) {
          if (nn && nn !== pr.name) {
            if (!renamePreset(pr.name, nn)) { SF.Audio.deny(); builderAlert('That name is already used.'); }
          }
        });
      });
      mk('✕', 'Delete preset', function () {
        /* builder-drag-fix: modal, not window.confirm (dead on device) */
        builderConfirm('Delete preset "' + pr.name + '"?', function () { deletePreset(pr.name); });
      });
      box.appendChild(item);
    };

    var sameList = list.filter(function (pr) { return pr.classId === ship.classId; });
    var otherList = list.filter(function (pr) { return pr.classId !== ship.classId; });
    var groupHead = function (txt) {
      var gh = document.createElement('div');
      gh.className = 'dim';
      gh.style.cssText = 'margin:6px 0 2px;font-size:11px;letter-spacing:1px';
      gh.textContent = txt;
      box.appendChild(gh);
    };
    if (sameList.length) {
      groupHead('— FOR THIS HULL (' + shipClsName.toUpperCase() + ') —');
      sameList.forEach(renderPresetItem);
    }
    if (W.presetFilter !== 'this' && otherList.length) {
      groupHead('— OTHER HULLS —');
      otherList.forEach(renderPresetItem);
    }
    if (W.presetFilter === 'this' && !sameList.length) {
      var none = document.createElement('div');
      none.className = 'dim';
      none.textContent = 'No layouts saved for this hull yet.';
      box.appendChild(none);
    }

    // last apply report line
    if (lastPresetReport && lastPresetReport.name) {
      var r = lastPresetReport;
      var rl = document.createElement('div');
      rl.className = 'dim';
      rl.style.marginTop = '6px';
      if (r.ok) {
        rl.innerHTML = '✓ "' + escHtml(r.name) + '" applied — ' + r.applied + ' parts' +
          (r.valid ? ', flight-ready.' : ' <span class="bad">NOT flight-ready: ' + escHtml(r.reasons.join(' · ')) + '</span>');
      } else {
        rl.innerHTML = '✗ "' + escHtml(r.name) + '" not applied: ' +
          escHtml(r.missing.concat(r.unplaceable).join(' · '));
      }
      box.appendChild(rl);
    }
  }

  /* ========== ship-rename-transponder: ship name + transponder flag ==========
   * Personality for the player's ship. The name (max 24 chars) lives on the
   * ship record as shipName; the transponder flag lives as shipFlag. Both are
   * additive on the existing ship/player blob and read defensively, so older
   * saves (and ships bought via buyShip, which never set these fields) fall
   * back to 'SS Starfall' / 'none' — save-neutral, NO SF.SAVE_VERSION bump,
   * no migrate function. Persistence + the in-flight decal ride on deferred
   * additive wraps of SF.Player.serialize / deserialize / draw (idempotent,
   * flag __renameXp, try/catch-guarded) so NO other module file is edited —
   * the same pattern the wingman-formations phase used for cross-file hooks.
   * NPC-scan broadcast: no target-info/scan panel exists in the game yet, so
   * SF.Builder.transponder() is the broadcast API a future hud.js/npcs.js
   * phase can render. Purely cosmetic + local identity: no gameplay effects. */
  var SHIP_NAME_MAX = 24;
  var SHIP_NAME_DEFAULT = 'SS Starfall';

  SF.SHIP_FLAGS = [
    { id: 'none',     name: 'No Transponder',  short: 'DARK', color: '#5a6b8a',
      hint: 'Fly dark — no flag on the transponder.' },
    { id: 'compact',  name: 'Solar Compact',   short: 'COM',  color: '#4da3ff',
      hint: 'Broadcast Solar Compact colors.' },
    { id: 'drifters', name: 'Free Drifters',   short: 'DFT',  color: '#3ddc5f',
      hint: 'Broadcast Free Drifter colors.' },
    { id: 'ember',    name: 'Ember Pact',      short: 'EMB',  color: '#ff5e3a',
      hint: 'Broadcast Ember Pact colors.' },
    { id: 'pirate',   name: 'Pirate Jack',     short: 'JACK', color: '#e8ecf5',
      hint: 'Fly the pirate jack. Intimidating. Maybe.' },
    { id: 'homebase', name: 'Homebase Colors', short: 'HOME', color: '#ffd23f',
      hint: 'Fly your homebase banner.' }
  ];
  var FLAG_BY_ID = {};
  SF.SHIP_FLAGS.forEach(function (f) { FLAG_BY_ID[f.id] = f; });

  function sanitizeName(s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, SHIP_NAME_MAX);
  }
  function liveName(s) { /* while typing: length-cap only, keep trailing spaces */
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, SHIP_NAME_MAX);
  }
  function shipNameOf(sh) {
    var n = sh ? sanitizeName(sh.shipName) : '';
    return n || SHIP_NAME_DEFAULT;
  }
  function flagDefOf(id) { return FLAG_BY_ID[id] || FLAG_BY_ID['none']; }
  function shipFlagOf(sh) { return flagDefOf(sh && sh.shipFlag).id; }

  /* Procedural flag icon, w x h at (x, y). Faction-flavored, zero assets. */
  function drawFlagIcon(ctx, flagId, x, y, w, h) {
    var def = flagDefOf(flagId);
    var id = def.id;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#0b1330'; ctx.fillRect(x, y, w, h);
    if (id === 'none') {
      ctx.setLineDash([Math.max(2, w / 12), Math.max(2, w / 12)]);
      ctx.strokeStyle = '#5a6b8a'; ctx.lineWidth = Math.max(1, h / 14);
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(90,107,138,0.7)';
      ctx.beginPath(); ctx.moveTo(x + 2, y + h - 2); ctx.lineTo(x + w - 2, y + 2); ctx.stroke();
    } else if (id === 'pirate') {
      ctx.fillStyle = '#101014'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#e8ecf5'; ctx.lineWidth = Math.max(1.5, h * 0.09);
      ctx.beginPath(); ctx.moveTo(x + w * 0.15, y + h * 0.82); ctx.lineTo(x + w * 0.85, y + h * 0.62); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w * 0.15, y + h * 0.62); ctx.lineTo(x + w * 0.85, y + h * 0.82); ctx.stroke();
      var cx = x + w / 2, cy = y + h * 0.42, r = h * 0.22;
      ctx.fillStyle = '#e8ecf5';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#101014';
      ctx.beginPath(); ctx.arc(cx - r * 0.38, cy - r * 0.1, r * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + r * 0.38, cy - r * 0.1, r * 0.28, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = def.color; ctx.fillRect(x, y, w, h);
      if (id === 'compact') {
        /* chevron stripe + roundel */
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.moveTo(x + w * 0.18, y + h * 0.12); ctx.lineTo(x + w * 0.42, y + h * 0.5);
        ctx.lineTo(x + w * 0.18, y + h * 0.88); ctx.lineTo(x + w * 0.18, y + h * 0.66);
        ctx.lineTo(x + w * 0.30, y + h * 0.5); ctx.lineTo(x + w * 0.18, y + h * 0.34);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(6,10,22,0.85)';
        ctx.beginPath(); ctx.arc(x + w * 0.62, y + h * 0.5, h * 0.16, 0, Math.PI * 2); ctx.fill();
      } else if (id === 'drifters') {
        /* drift ring */
        ctx.strokeStyle = 'rgba(6,10,22,0.85)'; ctx.lineWidth = Math.max(1.5, h * 0.1);
        ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, h * 0.26, 0, Math.PI * 2); ctx.stroke();
      } else if (id === 'ember') {
        /* flame triangle */
        ctx.fillStyle = 'rgba(6,10,22,0.85)';
        ctx.beginPath();
        ctx.moveTo(x + w * 0.5, y + h * 0.14);
        ctx.lineTo(x + w * 0.82, y + h * 0.86);
        ctx.lineTo(x + w * 0.18, y + h * 0.86);
        ctx.closePath(); ctx.fill();
      } else if (id === 'homebase') {
        /* house glyph */
        ctx.fillStyle = 'rgba(6,10,22,0.85)';
        var bx = x + w * 0.32, bw = w * 0.36, by = y + h * 0.42, bh = h * 0.44;
        ctx.fillRect(bx, by, bw, bh);
        ctx.beginPath();
        ctx.moveTo(x + w * 0.24, by); ctx.lineTo(x + w * 0.5, y + h * 0.14);
        ctx.lineTo(x + w * 0.76, by); ctx.closePath(); ctx.fill();
      }
    }
    ctx.strokeStyle = id === 'none' ? 'rgba(90,107,138,0.5)' : 'rgba(6,10,22,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  /* Hull decal label: flag icon + ship name. Drawn in world space under the
   * ship in flight, and centered on the builder's preview canvas. */
  function drawDecalLabel(ctx, x, y, ship, opts) {
    opts = opts || {};
    var name = shipNameOf(ship), flag = shipFlagOf(ship);
    var fontPx = opts.fontPx || 10;
    ctx.save();
    ctx.font = '600 ' + fontPx + 'px monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    var tw = ctx.measureText(name).width;
    var fw = opts.flagW || Math.round(fontPx * 1.6);
    var fh = opts.flagH || Math.round(fontPx * 1.05);
    var gap = 4;
    var hasFlag = flag !== 'none';
    var totalW = tw + (hasFlag ? fw + gap : 0);
    var x0 = Math.round(x - totalW / 2);
    var labelH = Math.max(fh, fontPx + 2);
    var px = 4, py = 2;
    ctx.fillStyle = opts.bg || 'rgba(6,10,22,0.62)';
    ctx.fillRect(x0 - px, y - py, totalW + px * 2, labelH + py * 2);
    var cx = x0;
    if (hasFlag) { drawFlagIcon(ctx, flag, cx, y, fw, fh); cx += fw + gap; }
    ctx.lineWidth = Math.max(2, fontPx / 4);
    ctx.strokeStyle = 'rgba(6,10,22,0.85)';
    ctx.strokeText(name, cx, y);
    ctx.fillStyle = opts.color || '#dfe8ff';
    ctx.fillText(name, cx, y);
    ctx.restore();
    return { x: x0 - px, y: y - py, w: totalW + px * 2, h: labelH + py * 2,
             name: name, flag: flag };
  }

  var lastDecal = null; /* test hook: last in-flight decal drawn (smoke asserts it) */
  function drawInFlightDecal(ctx) {
    if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return;
    var P = SF.Player;
    if (!P || !P.alive || !P.ships || !P.ships[P.activeShip]) return;
    var r = P.radius || 20;
    /* shop-launch: supporters fly a gold nameplate */
    var dOpts = {};
    if (window.SF && SF.Shop && SF.Shop.isSupporter && SF.Shop.isSupporter()) dOpts.color = '#ffd23f';
    lastDecal = drawDecalLabel(ctx, P.x, P.y + r + 10, P.ships[P.activeShip], dOpts);
  }

  /* ---------- identity DOM ---------- */

  var lastFlagRendered = null;

  function identityHTML() {
    return '<div id="builder-identity" class="builder-box">' +
      '<div class="store-head">🚀 SHIP IDENTITY</div>' +
      '<div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:210px">' +
          '<div class="dim" style="margin-bottom:4px">SHIP NAME · max ' + SHIP_NAME_MAX + ' chars</div>' +
          '<input id="shipname-input" class="ui-block" maxlength="' + SHIP_NAME_MAX +
            '" placeholder="' + SHIP_NAME_DEFAULT + '" autocomplete="off" spellcheck="false" ' +
            'style="width:100%;box-sizing:border-box;background:#0b1330;border:1px solid #2c3d6b;' +
            'color:#dfe8ff;padding:8px;border-radius:6px;font-size:15px">' +
          '<div class="dim" style="margin:8px 0 4px">TRANSPONDER FLAG · cosmetic only</div>' +
          '<div id="flag-picker" style="display:flex;gap:6px;flex-wrap:wrap"></div>' +
          '<div id="identity-hint" class="dim" style="margin-top:6px;min-height:16px"></div>' +
        '</div>' +
        '<div>' +
          '<div class="dim" style="margin-bottom:4px">HULL DECAL PREVIEW</div>' +
          '<canvas id="decal-preview" width="230" height="70" ' +
            'style="background:#05070f;border:1px solid #22315c;border-radius:6px;max-width:100%"></canvas>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function buildFlagPicker() {
    var box = el['flag-picker'];
    box.innerHTML = '';
    SF.SHIP_FLAGS.forEach(function (def) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-block';
      b.title = def.name + ' — ' + def.hint;
      b.setAttribute('aria-label', 'Transponder flag: ' + def.name);
      b.style.cssText = 'background:#0b1330;border:2px solid #22315c;border-radius:6px;' +
        'padding:4px;cursor:pointer;line-height:0';
      b.dataset.flag = def.id;
      var c = document.createElement('canvas');
      c.width = 54; c.height = 36;
      c.style.width = '54px'; c.style.height = '36px';
      b.appendChild(c);
      var lab = document.createElement('div');
      lab.textContent = def.short;
      lab.style.cssText = 'font-size:9px;color:#9db0cc;text-align:center;margin-top:2px;' +
        'line-height:1.2;font-family:monospace';
      b.appendChild(lab);
      b.addEventListener('click', function () {
        if (!W) return;
        W.shipFlag = def.id;
        lastFlagRendered = null; /* force picker refresh */
        if (window.SF && SF.Audio && SF.Audio.ui) SF.Audio.ui();
        renderIdentity();
      });
      box.appendChild(b);
      drawFlagIcon(c.getContext('2d'), def.id, 0, 0, 54, 36);
    });
  }

  function updateTitle() {
    if (!built || !W) return;
    var cls = shipClass();
    var name = (W.shipName && sanitizeName(W.shipName)) || SHIP_NAME_DEFAULT;
    el['builder-title'].textContent = '🔧 ' + name.toUpperCase() + ' — ' +
      cls.name.toUpperCase() + ' (' + cls.gridW + '×' + cls.gridH + ')';
  }

  function renderIdentity() {
    if (!built || !W) return;
    var input = el['shipname-input'];
    if (input && document.activeElement !== input) input.value = W.shipName || '';
    updateTitle();
    if (lastFlagRendered !== W.shipFlag) {
      lastFlagRendered = W.shipFlag;
      var box = el['flag-picker'];
      var kids = box ? box.children : [];
      for (var i = 0; i < kids.length; i++) {
        var sel = kids[i].dataset.flag === W.shipFlag;
        kids[i].style.borderColor = sel ? '#ffd23f' : '#22315c';
        kids[i].style.boxShadow = sel ? '0 0 8px rgba(255,210,63,0.5)' : 'none';
      }
      var def = flagDefOf(W.shipFlag);
      if (el['identity-hint']) el['identity-hint'].textContent = '⚑ ' + def.name + ' — ' + def.hint;
    }
    var pv = el['decal-preview'];
    if (pv) {
      var pctx = pv.getContext('2d');
      pctx.clearRect(0, 0, pv.width, pv.height);
      pctx.fillStyle = '#05070f'; pctx.fillRect(0, 0, pv.width, pv.height);
      pctx.fillStyle = 'rgba(160,190,235,0.5)';
      for (var s = 0; s < 24; s++) {
        pctx.fillRect((s * 47) % pv.width, (s * 89) % pv.height, 1, 1);
      }
      drawDecalLabel(pctx, pv.width / 2, 26,
        { shipName: W.shipName, shipFlag: W.shipFlag }, { fontPx: 13 });
    }
  }

  function commitIdentity(saveNow) {
    if (!W) return;
    var ship = SF.Player.ships[W.shipIndex];
    if (!ship) return;
    ship.shipName = sanitizeName(W.shipName) || SHIP_NAME_DEFAULT;
    ship.shipFlag = flagDefOf(W.shipFlag).id;
    if (saveNow && window.SF && SF.Save) SF.Save.save();
  }

  /* Deferred additive wraps: persistence + in-flight decal without editing
   * any other module's file. Idempotent (flag __renameXp), try/catch-guarded
   * so the decal or the field stamping can never break flight/save/load. */
  function installTransponderWraps(tries) {
    tries = tries || 0;
    var P = window.SF && SF.Player;
    var ready = P && typeof P.serialize === 'function' &&
      typeof P.deserialize === 'function' && typeof P.draw === 'function';
    if (ready) {
      if (!P.serialize.__renameXp) {
        var baseSer = P.serialize;
        var wSer = function () {
          var out = baseSer.call(this);
          try {
            var live = SF.Player.ships || [];
            if (out && out.ships) {
              for (var i = 0; i < out.ships.length && i < live.length; i++) {
                out.ships[i].shipName = shipNameOf(live[i]);
                out.ships[i].shipFlag = shipFlagOf(live[i]);
              }
            }
          } catch (e) { /* never break saving */ }
          return out;
        };
        wSer.__renameXp = true;
        P.serialize = wSer;
      }
      if (!P.deserialize.__renameXp) {
        var baseDes = P.deserialize;
        var wDes = function (d) {
          var r = baseDes.call(this, d);
          try {
            var raws = (d && d.ships) || [];
            var live = SF.Player.ships || [];
            for (var i = 0; i < raws.length && i < live.length; i++) {
              live[i].shipName = shipNameOf(raws[i]);
              live[i].shipFlag = shipFlagOf(raws[i]);
            }
          } catch (e) { /* never break loading */ }
          return r;
        };
        wDes.__renameXp = true;
        P.deserialize = wDes;
      }
      if (!P.draw.__renameXp) {
        var baseDraw = P.draw;
        var wDraw = function (ctx) {
          baseDraw.call(this, ctx);
          try { drawInFlightDecal(ctx); } catch (e) { /* decal never breaks flight */ }
        };
        wDraw.__renameXp = true;
        P.draw = wDraw;
      }
      return;
    }
    if (tries < 240) setTimeout(function () { installTransponderWraps(tries + 1); }, 500);
  }

  /* ---------- save ---------- */

  function saveAndLaunch() {
    var ship = SF.Player.ships[W.shipIndex];
    var s = SF.Parts.derive(ship.classId, W.parts);
    if (!s.valid) { SF.Audio.deny(); return; }
    ship.parts = W.parts;
    /* ship-rename-transponder: persist the identity draft on the record */
    commitIdentity(false);
    // clamp weapon index to new slot count
    var n = Math.min(s.slots, SF.Player.weaponsOwned.length);
    if (SF.Player.weaponIndex >= n) SF.Player.weaponIndex = 0;
    // refit hull/shield, keep damage proportion
    var p = SF.Player;
    var hullFrac = p.maxHull() > 0 ? p.hull / p.maxHull() : 1;
    p.hull = Math.round(SF.Player.maxHull() * hullFrac);
    p.shield = Math.min(p.shield, SF.Player.maxShield());
    SF.Save.save();
    SF.Audio.buy();
    SF.HUD.toast('Build saved — ' + ship.name + ' flight-ready');
    close();
    SF.Station.renderStore();
  }

  /* ship-rename-transponder: install the persistence/decal wraps at module
   * load (builder.js runs right after ship.js), NOT on first builder open —
   * saves and loads must carry shipName/shipFlag even if the player never
   * opens the builder this session. */
  installTransponderWraps(0);

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    /* builder-presets API (save-neutral, localStorage-backed) */
    savePreset: savePreset,
    applyPreset: applyPreset,
    renamePreset: renamePreset,
    deletePreset: deletePreset,
    exportPreset: exportPreset,
    importPreset: importPreset,
    decodePreset: decodePreset,
    listPresets: function () { return loadPresets().map(function (p) { return p.name; }); },
    presetReport: function () { return lastPresetReport; },
    draftJSON: function () { return W ? JSON.stringify(packParts(W.parts)) : null; },
    /* ship-rename-transponder API: ship name + transponder flag.
     * Cosmetic identity only, save-neutral (no SAVE_VERSION bump). Defensive
     * reads: missing fields fall back to 'SS Starfall' / 'none'. */
    shipNameOf: shipNameOf,
    shipFlagOf: shipFlagOf,
    setShipName: function (idx, name) {
      var sh = SF.Player.ships[idx];
      if (!sh) return null;
      sh.shipName = sanitizeName(name) || SHIP_NAME_DEFAULT;
      return sh.shipName;
    },
    setShipFlag: function (idx, id) {
      var sh = SF.Player.ships[idx];
      if (!sh) return null;
      sh.shipFlag = flagDefOf(id).id;
      return sh.shipFlag;
    },
    flagDefs: function () { return SF.SHIP_FLAGS.slice(); },
    flagDefOf: flagDefOf,
    drawFlagIcon: drawFlagIcon,
    drawDecalLabel: drawDecalLabel,
    /* NPC-scan broadcast payload. No target-info/scan panel exists in the
     * game yet — this is the API a future hud.js/npcs.js phase renders. */
    transponder: function (idx) {
      var i = (idx == null) ? SF.Player.activeShip : idx;
      var sh = SF.Player.ships[i];
      var def = flagDefOf(shipFlagOf(sh));
      return { name: shipNameOf(sh), flag: def.id, flagName: def.name, flagShort: def.short };
    },
    _lastDecal: function () { return lastDecal; }, /* smoke test hook */
    /* builder-stat-compare API: side-by-side stat deltas. statVector accepts
     * {partId,stars} | {weaponId,stars,entry} | {stats:{...}}; compareHTML
     * renders current -> candidate rows with green/red deltas. Save-neutral. */
    statVector: statVector,
    compareHTML: compareHTML,
    setCompare: setComparePart,
    clearDraft: function () {
      /* builder-presets: clear returns parts to inventory.
       * shipwright-expansion-1: now one undoable step via the tools. */
      clearDraftLayout();
    },
    /* shipwright-expansion-1: builder tools API. All draft-side, save-
     * neutral. placeAt does grid-fit + inventory take (no undo snapshot,
     * no render — UI gestures own their step); undo/redo restore fitted
     * parts AND loose inventory together; upgrades are never undoable
     * (they spend credits) and scrapping clears both stacks (it pays
     * credits out). flipLayout returns false instead of half-applying. */
    placeAt: placePartAt,
    undo: undoLayout,
    redo: redoLayout,
    canUndo: function () { return !!(W && W.undoStack.length); },
    canRedo: function () { return !!(W && W.redoStack.length); },
    setMirror: function (on) {
      if (W) { W.mirror = !!on; renderTools(); }
      return !!(W && W.mirror);
    },
    mirrorOn: function () { return !!(W && W.mirror); },
    flipLayout: flipLayout,
    scrapValue: partScrapValue,
    scrapSelected: function () {
      if (!W || W.selected === null || W.selected === undefined) return 0;
      return scrapPartAt(W.selected);
    },
    scrapPartAt: scrapPartAt,
    clusterSelect: clusterSelectRect,
    clusterStamp: stampClusterAt,
    clusterCancel: cancelCluster,
    clusterState: function () {
      if (!W) return null;
      return {
        armed: !!W.clusterArmed,
        captured: W.cluster ? W.cluster.specs.length : 0,
        w: W.cluster ? W.cluster.w : 0,
        h: W.cluster ? W.cluster.h : 0
      };
    },
    layoutMetrics: function (parts) {
      if (!W) return null;
      return layoutMetrics(SF.Player.ships[W.shipIndex].classId, parts || W.parts);
    },
    abCompare: abCompare,
    coachWarnings: coachWarnings,
    setPresetFilter: function (f) {
      if (W) { W.presetFilter = (f === 'this') ? 'this' : 'all'; renderPresets(); }
    },
    presetFilter: function () { return W ? W.presetFilter : 'all'; },
    /* builder-drag-fix: tap-to-place + modal state (save-neutral UI) */
    armedPart: function () { return W ? W.armed : null; },
    armPart: function (partId) { if (W) armPart(partId); return W ? W.armed : null; },
    disarmPart: function () { disarmPart(); },
    modalOpen: function () { return !!modalState; },
    toolsState: function () {
      if (!W) return null;
      return {
        mirror: !!W.mirror,
        undo: W.undoStack.length,
        redo: W.redoStack.length,
        clusterArmed: !!W.clusterArmed,
        clusterCaptured: W.cluster ? W.cluster.specs.length : 0,
        abPreset: W.abPreset,
        presetFilter: W.presetFilter
      };
    }
  };
})();

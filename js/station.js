/* STARFALL Phase 1 — station.js
 * Haven Dock (Solace): dock prompt when close, DOM store UI.
 * Buys: 3 weapons, Engine Tuning, Shield Cell. Repair hull. Sell ore + components.
 * Quest board: stub, disabled ("coming in Phase 4").
 */
window.SF = window.SF || {};

SF.Station = (function () {
  var hireRoster = []; // Phase 3: rotating hire candidates, refreshed each dock
  var dockedSt = null; // Phase 5: station object the player is currently docked at

  function getStation(systemId) {
    var sys = SF.SYSTEM_BY_ID[systemId];
    return sys ? sys.station : null;
  }

  /* Phase 5: multi-station support. Every entry is {name, x, y, kind}. */
  /* station-sprites-4-wiring: each system with a main station also hosts 4
   * specialty stations (fixed offsets, deterministic — no save fields). */
  var SPECIAL_LAYOUT = [
    { kind: 'scrapyard', label: 'Scrapyard',  dx: 980,   dy: -560 },
    { kind: 'prison',    label: 'Prison Hulk', dx: -1020, dy: -520 },
    { kind: 'casino',    label: 'Casino Spire', dx: 940, dy: 640 },
    { kind: 'memorial',  label: 'Memorial Beacon', dx: -980, dy: 600 }
  ];
  function allStations(systemId) {
    var list = [];
    var st = getStation(systemId);
    if (st) {
      list.push({ name: st.name, x: st.x, y: st.y, kind: 'dock' });
      // station-sprites-4-wiring: specialty stations ride fixed offsets
      var sys = SF.SYSTEM_BY_ID ? SF.SYSTEM_BY_ID[systemId] : null;
      var prefix = sys ? sys.name + ' ' : '';
      SPECIAL_LAYOUT.forEach(function (sp) {
        list.push({ name: prefix + sp.label, x: st.x + sp.dx, y: st.y + sp.dy, kind: sp.kind });
      });
    }
    // planets-facilities: dockable planets + faction HQ capitals
    if (window.SF && SF.Planets) SF.Planets.list(systemId).forEach(function (pl) {
      list.push({ name: pl.name, x: pl.x, y: pl.y, kind: 'planet', ref: pl });
    });
    if (window.SF && SF.HQ) SF.HQ.list(systemId).forEach(function (hq) {
      list.push({ name: hq.name, x: hq.x, y: hq.y, kind: 'hq', ref: hq });
    });
    if (window.SF && SF.Homebase) {
      var hb = SF.Homebase.get();
      if (hb && hb.systemId === systemId)
        list.push({ name: hb.name, x: hb.x, y: hb.y, kind: 'homebase' });
    }
    return list;
  }

  function nearStation(player, systemId) {
    var best = null;
    allStations(systemId).forEach(function (st) {
      var dx = player.x - st.x, dy = player.y - st.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var pr = SF.CONFIG.station.promptRadius;
      if (d <= pr && (!best || d < best.dist)) best = { st: st, dist: d };
    });
    return best;
  }

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

  /* station-sprites-wiring: sprite id per station kind ('dock' = Haven Dock).
   * station-sprites-4-wiring: the 4 landmark sprites wired the same way.
   * SF.Sprites.get returns the image once decoded, null before that or when
   * missing — callers always keep their canvas-drawn fallback. */
  var STATION_SPRITE = {
    dock: 'haven', homebase: 'homebase',
    scrapyard: 'salvage_yard', prison: 'prison_hulk',
    casino: 'casino_spire', memorial: 'memorial_beacon'
  };
  var PLANET_IDS = ['verdant', 'rustanch', 'kestrel', 'shatters', 'cinder', 'deadlight'];
  var _spritesPreloaded = false;
  function preloadSprites() {
    if (_spritesPreloaded || !(window.SF && SF.Sprites)) return;
    _spritesPreloaded = true;
    SF.Sprites.preload('stations', ['haven', 'homebase', 'aegis', 'karavan', 'ashen',
      'salvage_yard', 'prison_hulk', 'casino_spire', 'memorial_beacon']);
    // b3-environment: station ambient-glow sprite (see drawOne).
    SF.Sprites.preload('fx/effects', ['shield-glow']);
    SF.Sprites.preload('planets', PLANET_IDS);
  }

  /* Human-readable part stats at 1 star (used in store rows). */
  function partStatsText(pt) {
    var bits = [];
    if (pt.power > 0) bits.push('+' + pt.power + ' power');
    if (pt.power < 0) bits.push(pt.power + ' power');
    Object.keys(pt.stats).forEach(function (k) { bits.push('+' + pt.stats[k] + ' ' + k); });
    return bits.join(' · ');
  }

  /* Owned weapon row: star pips + upgrade button + mods button (weapons-arsenal). */
  function weaponOwnedRow(w, entry) {
    var div = document.createElement('div');
    div.className = 'store-row';
    var dot = '<span class="tier-dot" style="background:' + SF.TIERS[w.tier] + '"></span>';
    var info = document.createElement('div');
    info.className = 'store-info';
    var dps = (window.SF && SF.Mods) ? SF.Mods.dps(w.id, entry.stars, entry) : 0;
    info.innerHTML = dot + storeIcon('w_' + w.id) + '<div><div class="store-name">' + w.name +
      ' <span style="color:#ffd23f">' + SF.Upgrade.starsText(entry.stars) + '</span></div>' +
      '<div class="store-desc">' + w.desc + ' · damage ×' +
      SF.Upgrade.starMult(entry.stars).toFixed(2) +
      ' · <b>' + Math.round(dps) + ' DPS</b></div></div>';
    div.appendChild(info);
    var btn = document.createElement('button');
    btn.className = 'btn store-btn';
    if (entry.stars >= SF.Upgrade.maxStars) {
      btn.textContent = '★ MAX';
      btn.disabled = true;
    } else {
      var cost = SF.Upgrade.weaponCost(w.id, entry.stars + 1);
      btn.textContent = '⬆ ★' + (entry.stars + 1) + ' · ' + SF.Upgrade.costText(cost);
      if (SF.Upgrade.canAfford(cost)) {
        btn.addEventListener('click', function () {
          if (SF.Upgrade.upgradeWeapon(entry)) { SF.Audio.buy(); render(); }
          else { SF.Audio.deny(); }
        });
      } else {
        btn.disabled = true;
        btn.addEventListener('click', function () { SF.Audio.deny(); });
      }
    }
    div.appendChild(btn);
    // weapons-arsenal: MODS button opens the mod fitter for this weapon
    if (window.SF && SF.Mods) {
      var mb = document.createElement('button');
      mb.className = 'btn store-btn';
      var fitted = (entry.mods || []).filter(function (m) { return !!m; }).length;
      mb.textContent = '⚙ MODS ' + fitted + '/' + (w.modSlots || 1);
      mb.addEventListener('click', function () { SF.Mods.open(w.id); });
      div.appendChild(mb);
    }
    return div;
  }

  /* b4-sprite-lighting: UI icon wiring. Icons live under assets/ui/icons/
   * and are resolved through the existing SF.Sprites loader (get() warms
   * its cache, urlFor() supplies the <img> src), so a missing icon degrades
   * to text-only via onerror instead of a broken image. b_settings/b_play
   * stay CSS-only (style.css:720-721) and are never duplicated here. */
  function storeIcon(iconId, size) {
    var px = size || 28, url = '';
    try {
      if (window.SF && SF.Sprites) {
        SF.Sprites.get('ui', 'icons/' + iconId);
        url = SF.Sprites.urlFor('ui', 'icons/' + iconId);
      }
    } catch (e) {}
    if (!url) url = 'assets/ui/icons/' + iconId + '.png';
    return '<img class="store-icon" src="' + url + '" alt="" ' +
      'style="width:' + px + 'px;height:' + px + 'px;object-fit:contain;flex:none" ' +
      'onerror="this.style.display=\'none\'">';
  }

  function row(name, desc, price, owned, canAfford, actionLabel, onBuy, tier, icon) {
    var div = document.createElement('div');
    div.className = 'store-row';
    var dot = tier ? '<span class="tier-dot" style="background:' + SF.TIERS[tier] + '"></span>' : '';
    div.innerHTML =
      '<div class="store-info">' + dot + (icon ? storeIcon(icon) : '') +
      '<div><div class="store-name">' + name + '</div>' +
      '<div class="store-desc">' + desc + '</div></div></div>' +
      '<button class="btn store-btn"' + (owned || !canAfford ? ' disabled' : '') + '>' +
      (owned ? 'OWNED' : actionLabel + ' · ' + fmt(price) + 'c') + '</button>';
    if (!owned && canAfford) {
      div.querySelector('button').addEventListener('click', function () {
        if (onBuy()) { SF.Audio.buy(); render(); }
        else { SF.Audio.deny(); }
      });
    } else if (!owned) {
      div.querySelector('button').addEventListener('click', function () { SF.Audio.deny(); });
    }
    return div;
  }

  /* ================= defense-grid-1: Defense Office =================
   * STATION DEFENSE store section (Workbench & Services district).
   * Pad-map UI: a top-down schematic of the station's pad ring — tap a
   * pad, then build / upgrade / repair / sell in the sheet below it.
   * All rules (pads, reactor power, costs, targeting) live in SF.Raids;
   * this is presentation + wiring only. Selected pad is session UI
   * state, never saved. Owned-station (homebase) grids persist via
   * SF.Raids.serializeDefense; NPC-station grids are session-only. */
  var defPad = null;       // selected pad index (null = none)
  var defPadStation = '';  // 'sys:name' the selection belongs to

  function renderDefense(body) {
    if (!(window.SF && SF.Raids)) return;
    var sys = SF.Game.systemId;
    var cur = dockedSt || { name: 'Haven Dock', kind: 'dock' };
    var sst = SF.Raids.stState(sys, cur);
    var p = SF.Player;
    var gi = SF.Raids.gridInfo(sys, sst.name);
    var TYPES = SF.Raids.turretTypes;

    var h = document.createElement('div');
    h.className = 'store-head'; h.textContent = 'STATION DEFENSE — DEFENSE OFFICE';
    body.appendChild(h);

    var hl = document.createElement('div');
    hl.className = 'dim'; hl.style.marginBottom = '4px';
    var hf = Math.max(0, sst.hull / sst.maxHull);
    var hcol = hf > 0.5 ? '#3ddc5f' : (hf > 0.25 ? '#ffcf5e' : '#ff5e3a');
    hl.innerHTML = 'Station hull: <b style="color:' + hcol + '">' +
      Math.ceil(Math.max(0, sst.hull)) + '/' + sst.maxHull + '</b>' +
      (gi.maxShield > 0 ? ' · Shield: <b style="color:#7dffce">' + gi.shield + '/' + gi.maxShield + '</b>' : '') +
      ' · ⚡ Reactor: <b style="color:' + (gi.powerUsed > gi.power ? '#ff5e3a' : '#8ef7ff') + '">' +
      gi.powerUsed + '/' + gi.power + '</b>' +
      ' · Pads: <b>' + gi.turrets.length + '/' + gi.pads + '</b>' +
      '<br>Defense Turret Grid: tap a pad on the schematic to build, upgrade, repair or sell. ' +
      'Every turret draws reactor power — the reactor caps what the ring can run. ' +
      'Turrets auto-fire on hostiles, take damage, and can be destroyed. ' +
      (cur.kind === 'homebase'
        ? 'This is YOUR station: its grid is permanent and saved.'
        : 'Grids at stations you do not own are refit when you leave the system.') + ' ' +
      'If raiders bring the hull to zero, all services go offline until repaired.';
    body.appendChild(hl);

    var rs = SF.Raids.status();
    if (rs && rs.key === sys + ':' + sst.name) {
      var rl = document.createElement('div');
      rl.style.marginBottom = '4px';
      rl.innerHTML = rs.state === 'warn'
        ? '⚠ <b style="color:#ffcf5e">RAID INBOUND</b> — raiders hit in ' +
          rs.secsLeft + 's. Undock to defend!'
        : '⚠ <b style="color:#ff5e3a">RAID IN PROGRESS</b> — wave ' +
          rs.wave + '/' + rs.waves + '. Undock to defend!';
      body.appendChild(rl);
    }

    /* ---- pad map: top-down schematic of the pad ring ---- */
    var skey = sys + ':' + sst.name;
    if (defPadStation !== skey) { defPadStation = skey; defPad = null; }
    var map = document.createElement('div');
    map.id = 'def-padmap';
    map.style.cssText = 'position:relative;height:172px;margin:6px 0;border:1px solid #2a3350;' +
      'background:radial-gradient(circle at 50% 50%, #141b31 0%, #0a0e1d 70%);border-radius:8px;';
    var core = document.createElement('div');
    core.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'width:54px;height:54px;border-radius:50%;border:2px solid #5a6b8f;background:#1a2338;' +
      'color:#cfe3ff;font-size:22px;display:flex;align-items:center;justify-content:center;';
    core.textContent = '🛰';
    core.title = sst.name;
    map.appendChild(core);
    var byPad = {};
    gi.turrets.forEach(function (t) { byPad[t.pad] = t; });
    for (var pad = 0; pad < gi.pads; pad++) {
      (function (padIdx) {
        var tur = byPad[padIdx];
        var TT = tur ? TYPES[tur.type] : null;
        var ang = -Math.PI / 2 + (padIdx / gi.pads) * Math.PI * 2;
        var b = document.createElement('button');
        b.id = 'def-pad-' + padIdx;
        b.className = 'def-pad';
        var left = 50 + 40 * Math.cos(ang), top = 50 + 40 * Math.sin(ang);
        b.style.cssText = 'position:absolute;left:' + left + '%;top:' + top + '%;' +
          'transform:translate(-50%,-50%);width:46px;height:46px;border-radius:50%;cursor:pointer;' +
          'font-size:10px;font-family:monospace;line-height:1.15;padding:0;' +
          (tur
            ? 'border:2px solid ' + TT.color + ';background:#141d33;color:#eaf6ff;'
            : 'border:2px dashed #44557c;background:rgba(20,29,51,.55);color:#7d90b5;') +
          (defPad === padIdx ? 'box-shadow:0 0 0 3px #ffd23f,0 0 12px #ffd23f;' : '');
        b.innerHTML = tur
          ? '<b>' + TT.code + '</b><br>' + SF.Upgrade.starsText(tur.stars) +
            '<br><span style="color:' + (tur.hp < tur.maxHp ? '#ffcf5e' : '#6f819f') + '">' +
            Math.ceil(100 * tur.hp / tur.maxHp) + '%</span>'
          : '+ PAD<br>' + (padIdx + 1);
        b.addEventListener('click', function () {
          defPad = padIdx;
          if (window.SF && SF.Audio) SF.Audio.ui();
          render();
        });
        map.appendChild(b);
      })(pad);
    }
    body.appendChild(map);

    /* ---- pad sheet ---- */
    var sheet = document.createElement('div');
    sheet.id = 'def-sheet';
    body.appendChild(sheet);

    function actionBtn(id, label, enabled, fn) {
      var btn = document.createElement('button');
      btn.className = 'btn store-btn';
      btn.id = id;
      btn.textContent = label;
      if (!enabled) btn.disabled = true;
      btn.addEventListener('click', function () {
        if (!enabled) { SF.Audio.deny(); return; }
        if (fn()) { SF.Audio.buy(); render(); }
        else { SF.Audio.deny(); if (window.SF && SF.HUD) SF.HUD.toast(SF.Raids.gridError() || 'Cannot do that.'); render(); }
      });
      return btn;
    }

    if (defPad === null || defPad >= gi.pads) {
      var hint = document.createElement('div');
      hint.className = 'dim';
      hint.textContent = 'No pad selected — tap a pad above. Filled pads show type, stars and hull.';
      sheet.appendChild(hint);
    } else if (!byPad[defPad]) {
      var eh = document.createElement('div');
      eh.className = 'store-head'; eh.style.fontSize = '13px';
      eh.textContent = 'PAD ' + (defPad + 1) + ' — EMPTY · pick a turret';
      sheet.appendChild(eh);
      SF.Raids.typeOrder.forEach(function (typeId) {
        var TT = TYPES[typeId], cost = SF.Raids.installCost(typeId);
        var draw = Math.round(TT.power);
        var overPower = gi.powerUsed + draw > gi.power;
        var statBits = TT.dmg
          ? TT.dmg + ' dmg · ' + TT.range + ' rng · ' + (Math.round(10 * TT.dmg / TT.interval) / 10) + '/s cycle'
          : 'shield +' + TT.shieldPool + ' · regen ' + TT.shieldRegen + '/s';
        var div = document.createElement('div');
        div.className = 'store-row';
        div.innerHTML = '<div class="store-info"><span class="tier-dot" style="background:' +
          SF.TIERS[TT.tier] + '"></span><div><div class="store-name">' + TT.name +
          ' <span class="dim">⚡' + draw + '</span></div>' +
          '<div class="store-desc">' + TT.desc + '<br>' + statBits + ' · hull ' + TT.hp +
          (overPower ? '<br><b style="color:#ff5e3a">⚡ Reactor at capacity — no power for this turret.</b>' : '') +
          '</div></div></div>';
        div.appendChild(actionBtn('def-build-' + typeId,
          'INSTALL · ' + SF.Raids.costText(cost),
          !overPower && p.credits >= cost.credits && p.ore >= cost.ore,
          function () { return SF.Raids.installTurret(sys, sst.name, defPad, typeId); }));
        sheet.appendChild(div);
      });
    } else {
      var tur2 = byPad[defPad], TT2 = TYPES[tur2.type];
      var oh = document.createElement('div');
      oh.className = 'store-head'; oh.style.fontSize = '13px';
      oh.innerHTML = 'PAD ' + (defPad + 1) + ' — <span style="color:' + TT2.color + '">' + TT2.name + '</span> ' +
        SF.Upgrade.starsText(tur2.stars);
      sheet.appendChild(oh);
      var od = document.createElement('div');
      od.className = 'dim'; od.style.marginBottom = '4px';
      od.innerHTML = TT2.desc + '<br>Hull: <b>' + tur2.hp + '/' + tur2.maxHp + '</b>' +
        (TT2.dmg ? ' · Damage: <b>' + tur2.dmg + '</b>/shot · Range ' + TT2.range : ' · Shield pool contribution active') +
        ' · ⚡ draw <b>' + tur2.draw + '</b>' +
        ' · Invested: ' + tur2.invested.credits.toLocaleString('en-US') + 'c' +
        (tur2.invested.ore ? ' + ' + tur2.invested.ore + ' ore' : '');
      sheet.appendChild(od);
      var btnRow = document.createElement('div');
      btnRow.className = 'store-row';
      var info = document.createElement('div'); info.className = 'store-info';
      info.innerHTML = '<div><div class="store-name">Pad actions</div>' +
        '<div class="store-desc">Upgrade raises damage and hull (and power draw). ' +
        'Sell-back refunds ' + Math.round(SF.Raids.grid.sellRefund * 100) + '% of invested credits and ore.</div></div>';
      btnRow.appendChild(info);
      if (tur2.stars < 5) {
        var uc = SF.Raids.upgradeCost(tur2);
        btnRow.appendChild(actionBtn('def-upgrade',
          '⬆ ★' + (tur2.stars + 1) + ' · ' + SF.Raids.costText(uc),
          p.credits >= uc.credits && p.ore >= uc.ore,
          function () { return SF.Raids.upgradeTurretPad(sys, sst.name, defPad); }));
      } else {
        var mx = document.createElement('button');
        mx.className = 'btn store-btn'; mx.id = 'def-upgrade'; mx.disabled = true; mx.textContent = '★ MAX';
        btnRow.appendChild(mx);
      }
      if (tur2.hp < tur2.maxHp) {
        var rc2 = Math.ceil((tur2.maxHp - tur2.hp) * SF.Raids.grid.repairPerHp);
        btnRow.appendChild(actionBtn('def-repair-turret',
          '🔧 REPAIR · ' + rc2.toLocaleString('en-US') + 'c',
          p.credits >= rc2,
          function () { return SF.Raids.repairTurret(sys, sst.name, defPad); }));
      }
      /* beta2-sellfriendly: SELL BACK used to show no payout on the
       * button (only "refunds 50% of invested" in the sheet text) and
       * destroyed the turret in one blind tap. The button now carries
       * the live refund (same sellTurret formula) and the tap confirms
       * it first; sellTurret itself still toasts the receipt. */
      (function () {
        var rc = Math.floor(tur2.invested.credits * SF.Raids.grid.sellRefund);
        var ro = Math.floor(tur2.invested.ore * SF.Raids.grid.sellRefund);
        var refundTxt = '+' + rc.toLocaleString('en-US') + 'c' + (ro ? ' +' + ro + ' ore' : '');
        var sb = document.createElement('button');
        sb.className = 'btn store-btn';
        sb.id = 'def-sell';
        sb.textContent = 'SELL BACK · ' + refundTxt;
        sb.addEventListener('click', function () {
          SF.Dialog.confirm('Sell back this turret for ' + refundTxt + '?', function () {
            if (SF.Raids.sellTurret(sys, sst.name, defPad)) { SF.Audio.buy(); render(); }
            else { SF.Audio.deny(); }
          });
        });
        btnRow.appendChild(sb);
      })();
      sheet.appendChild(btnRow);
    }

    var missing = sst.maxHull - sst.hull;
    if (missing > 0.5) {
      var rcost = Math.ceil(missing * 2);
      body.appendChild(row('Repair Station Hull',
        'Restore ' + Math.ceil(missing) + ' station hull.',
        rcost, false, p.credits >= rcost, 'REPAIR', function () {
          return SF.Raids.repairHull(sys, sst.name);
        }, null));
    }
  }

  /* ================= station-districts-1: district hub =================
   * IA/navigation ONLY (user direction 2026-10-22): docking used to show
   * every station service in one long scroll. Now the full-store path
   * lands on a HUB of selectable districts; each district renders exactly
   * the sections that used to be stacked (see renderers below render()).
   * Reachability: dock -> hub (landing) -> district (1 tap) -> service
   * (2nd tap). Back returns to the hub; LAUNCH undocks from anywhere.
   * View state is session-only module state — NEVER saved (v11 stands).
   * The last district per station is remembered for the session and its
   * hub tile is flagged 'last visit'. */
  var view = 'hub';        // 'hub' or a district id
  var lastDistrict = {};   // station name -> district id, session only

  /* Pirate den gate (js/factions.js state): blackmarket.js itself prices
   * karma >= 15 as "you look like a cop" — at that reputation the
   * undercity does not show you the door at all. Below 15 the den is
   * open. Read live from SF.Factions.karma() at every render. */
  function denUnlocked() {
    var k = (window.SF && SF.Factions) ? SF.Factions.karma() : 0;
    return k < 15;
  }

  var DISTRICTS = [
    { id: 'commerce', icon: '\uD83D\uDED2', name: 'COMMERCE',
      flavor: 'Parts, weapons and the exchange floor.',
      chip: function (ctx) { var p = ctx.p; return '\u26CF ' + p.ore + ' ore \u00B7 cargo ' + p.cargoUsed() + '/' + p.cargoSpace() + 't'; } },
    { id: 'bar', icon: '\uD83C\uDF78', name: 'THE BAR',
      flavor: 'Crew for hire, wingmen, rumors and the wire.',
      chip: function () { return hireRoster.length ? hireRoster.length + ' looking for work' : 'the usual crowd'; } },
    { id: 'shipwright', icon: '\uD83D\uDD27', name: 'SHIPWRIGHT',
      flavor: 'Builder, hulls, hangar, installs and repairs.',
      chip: function (ctx) { var p = ctx.p; return p.ships.length + (p.ships.length === 1 ? ' ship' : ' ships') + ' \u00B7 flying ' + p.ships[p.activeShip].name; } },
    { id: 'missions', icon: '\uD83D\uDCDC', name: 'MISSION BOARD',
      flavor: 'Contracts and bounties, fresh off the board.',
      chip: function () {
        var n = 0;
        try { if (window.SF && SF.Quests) n += SF.Quests.offers().length; } catch (e) {}
        try { if (window.SF && SF.Bounty) n += SF.Bounty.offers().length; } catch (e) {}
        return n + ' open contracts';
      } },
    { id: 'workbench', icon: '\uD83D\uDEE0', name: 'WORKBENCH & SERVICES',
      flavor: 'Crafting, the defense office and station works.',
      chip: function (ctx) {
        if (window.SF && SF.Raids) {
          try {
            var gi = SF.Raids.gridInfo(SF.Game.systemId, ctx.curSt.name);
            if (gi) return '\uD83D\uDEE1 ' + gi.turrets.length + '/' + gi.pads +
              ' turrets \u00B7 hull ' + Math.round(100 * Math.max(0, gi.hull) / gi.maxHull) + '%' +
              (gi.maxShield > 0 ? ' \u00B7 shield ' + gi.shield + '/' + gi.maxShield : '');
          } catch (e) {}
        }
        return 'services open';
      } },
    { id: 'den', icon: '\uD83D\uDD76', name: 'PIRATE DEN',
      flavor: 'No names, no manifests.',
      chip: function () {
        var k = (window.SF && SF.Factions) ? SF.Factions.karma() : 0;
        return k <= -30 ? 'the fences know your name' : 'the undercity is listening';
      } }
  ];
  function districtById(id) {
    for (var i = 0; i < DISTRICTS.length; i++) if (DISTRICTS[i].id === id) return DISTRICTS[i];
    return null;
  }
  function goDistrict(id) {
    if (!districtById(id)) return;
    if (id === 'den' && !denUnlocked()) { if (window.SF && SF.Audio) SF.Audio.deny(); return; }
    view = id;
    if (dockedSt) lastDistrict[dockedSt.name] = id;
    if (window.SF && SF.Audio) SF.Audio.ui();
    render();
  }
  /* c-hud-polish: jump to a district AND land on a named tab (used by
   * the Shipwright -> Commerce parts cross-link). districtTab is declared
   * below (var hoisting); this only runs on tap, long after module init,
   * and renderTabbed falls back to the first tab if the id is stale. */
  function goDistrictTab(id, tab) {
    districtTab[id] = tab;
    goDistrict(id);
  }
  function goHub() {
    view = 'hub';
    if (window.SF && SF.Audio) SF.Audio.ui();
    render();
  }

  /* ================= c-hud-polish: hub quick actions =================
   * One-tap errands ON the hub tiles (never inside a district):
   *   Shipwright tile -> "Repair all" (hull + subsystems)
   *   Commerce tile   -> "Sell junk"  (ore + held components)
   * Both reuse the EXACT price formulas of the in-district rows they
   * mirror (Repairs tab hull/subsystem rows; Sell tab ore/component
   * rows, including the karma/standing multiplier pm). No price or
   * outcome changes anywhere. Confirmation is always SF.Dialog
   * (never native confirm(): the APK WebView returns false for it).
   * Repair-all applies hull FIRST, then subsystems, exactly as tapping
   * the two Repairs rows in order would: the Okafor shipwright
   * discount (if live) prices the hull row and is consumed by it, so
   * the subsystem row is then priced at the post-discount rate. The
   * action is atomic: if credits cannot cover the full sequential
   * total, nothing is repaired (the player can still repair one row
   * at a time in the Repairs tab) and the note says so honestly.
   * Sell-junk's "junk" is defined as the Sell tab's whole sellable
   * set — ore plus every held component — because the Sell tab has
   * no narrower junk category; the confirm dialog itemises ore vs
   * components so the sale is never a surprise. Both actions are
   * no-ops with an honest toast when there is nothing to do. */

  /* twelve-hour-wave3 (B2): Engineering repair-discount seam for every
   * player-ship repair price in this file (hub repair-all + Repairs tab).
   * Guarded: missing skills = 1.0. Defense-grid turret/station repairs
   * are station property, not the player's ship — deliberately excluded. */
  function skillRepairMul() {
    try {
      if (window.SF && SF.Skills && SF.Skills.repairCostMul) return SF.Skills.repairCostMul();
    } catch (e) {}
    return 1;
  }

  function repairQuote(p, eco, pm) {
    var missing = p.maxHull() - p.hull;
    /* twelve-hour-wave3 (B2): Engineering repair discount. A permanent
     * skill, not the one-time Okafor shipwright discount: it prices BOTH
     * the hull row and the subsystem row, and is never consumed. */
    var skillM = skillRepairMul();
    var hullCost = missing > 0
      ? Math.ceil(missing * eco.repairPerHp * p.shipwrightDiscount * pm * skillM) : 0;
    var discountAfter = missing > 0 ? 1 : p.shipwrightDiscount;
    var smissing = (p.subsystemMissing) ? p.subsystemMissing() : 0;
    var perPt = (window.SF && SF.SUBSYS_REPAIR_PER_PT) || 3;
    var subCost = smissing > 0
      ? Math.ceil(smissing * perPt * discountAfter * pm * skillM) : 0;
    return { missing: missing, hullCost: hullCost, smissing: smissing,
      subCost: subCost, total: hullCost + subCost };
  }
  function doRepairAll(p, eco, pm) {
    var q = repairQuote(p, eco, pm);
    if (q.total <= 0) return null;
    if (p.credits < q.total) return null;
    if (q.missing > 0) {
      p.credits -= q.hullCost; p.heal(q.missing); p.shipwrightDiscount = 1;
    }
    if (q.smissing > 0) {
      p.credits -= q.subCost; p.repairSubsystems(); p.shipwrightDiscount = 1;
    }
    return q;
  }
  function sellJunkQuote(p, eco, pm) {
    var oreValue = Math.floor(p.ore * eco.orePrice / pm);
    var lots = [], compValue = 0, inv = p.inventory || {};
    Object.keys(inv).forEach(function (id) {
      if (!(inv[id] > 0)) return;
      var item = SF.ITEM_BY_ID ? SF.ITEM_BY_ID[id] : null;
      if (!item) return; // unknown id: Sell tab would throw; hub skips it
      var val = Math.floor(item.price * inv[id] / pm);
      lots.push({ id: id, name: item.name, n: inv[id], val: val });
      compValue += val;
    });
    return { ore: p.ore, oreValue: oreValue, lots: lots,
      compValue: compValue, total: oreValue + compValue,
      hasAny: p.ore > 0 || lots.length > 0 };
  }
  function doSellJunk(p, eco, pm) {
    var q = sellJunkQuote(p, eco, pm);
    if (!q.hasAny) return null;
    p.credits += q.total; p.ore = 0; // total = ore value + component values
    q.lots.forEach(function (l) { p.inventory[l.id] = 0; });
    return q;
  }
  function toastDeny(msg) {
    if (window.SF && SF.Audio) SF.Audio.deny();
    if (window.SF && SF.HUD) SF.HUD.toast(msg);
  }
  function quickRepair(p, eco, pm) {
    var q = repairQuote(p, eco, pm);
    if (q.total <= 0) {
      toastDeny('Nothing to repair — hull and subsystems are already at 100%.');
      return;
    }
    if (p.credits < q.total) {
      toastDeny('Not enough credits for a full repair — need ' + fmt(q.total) +
        'c, have ' + fmt(p.credits) + 'c. Repair one row at a time in the Shipwright Repairs tab.');
      return;
    }
    var bits = [];
    if (q.missing > 0) bits.push('hull +' + Math.ceil(q.missing) + ' hp (' + fmt(q.hullCost) + 'c)');
    if (q.smissing > 0) bits.push('subsystems +' + q.smissing + ' integrity (' + fmt(q.subCost) + 'c)');
    SF.Dialog.confirm('Repair all for ' + fmt(q.total) + 'c? ' + bits.join(' · '), function () {
      var done = doRepairAll(p, eco, pm);
      if (!done) { toastDeny('Repair no longer possible — state changed.'); render(); return; }
      if (window.SF && SF.Audio) SF.Audio.buy();
      if (window.SF && SF.HUD) SF.HUD.toast('🔧 Repaired: ' + bits.join(' · ') + ' — ' + fmt(done.total) + 'c.');
      render();
    });
  }
  function quickSellJunk(p, eco, pm) {
    var q = sellJunkQuote(p, eco, pm);
    if (!q.hasAny) {
      toastDeny('Nothing to sell — no ore or components in cargo.');
      return;
    }
    var bits = [];
    /* beta2-sellfriendly: the junk confirm itemised the ore total but
     * not the per-unit price — the same gap the ore row had. State it
     * (exact when it divides evenly, else "about"), same formula. */
    if (q.ore > 0) {
      var oreUnit = (q.oreValue % q.ore === 0) ? fmt(q.oreValue / q.ore) + 'c each'
        : 'about ' + (q.oreValue / q.ore).toFixed(1) + 'c each';
      bits.push('ore ' + fmt(q.ore) + ' (' + fmt(q.oreValue) + 'c · ' + oreUnit + ')');
    }
    if (q.lots.length) bits.push(q.lots.length + ' component lot' + (q.lots.length === 1 ? '' : 's') +
      ' (' + fmt(q.compValue) + 'c)');
    SF.Dialog.confirm('Sell junk for +' + fmt(q.total) + 'c? ' + bits.join(' · '), function () {
      var done = doSellJunk(p, eco, pm);
      if (!done) { toastDeny('Nothing to sell — cargo changed.'); render(); return; }
      if (window.SF && SF.Audio) SF.Audio.buy();
      if (window.SF && SF.HUD) SF.HUD.toast('💰 Sold junk: +' + fmt(done.total) + 'c.');
      render();
    });
  }

  function districtTile(d, ctx) {
    var b = document.createElement('button');
    if (d.id === 'den' && !denUnlocked()) {
      b.className = 'district-tile locked';
      b.id = 'tile-den-locked';
      b.innerHTML = '<div class="district-name">\u2753 ???</div>' +
        '<div class="district-flavor">Aft maintenance deck. Nobody meets your eye.</div>' +
        '<div class="district-chip">\u00B7 \u00B7 \u00B7</div>';
      b.addEventListener('click', function () {
        if (window.SF && SF.Audio) SF.Audio.deny();
        if (window.SF && SF.HUD) SF.HUD.toast('The locals size you up and look away. Word is your reputation runs too clean.');
      });
      return b;
    }
    /* c-hud-polish: the tile is a <div>, not a <button>, so the quick-
     * action button below can nest inside it (a <button> in a <button>
     * is invalid HTML and browsers close the outer one). The body div
     * carries the old tile click; only the action button acts, and it
     * stopPropagation()s so it never also opens the district. Id,
     * classes, chip and last-visit flag are unchanged, so existing
     * tile selectors (#tile-commerce, #tile-shipwright, ...) still work. */
    var wrap = document.createElement('div');
    var isLast = !!(dockedSt && lastDistrict[dockedSt.name] === d.id);
    wrap.className = 'district-tile' + (isLast ? ' last' : '');
    wrap.id = 'tile-' + d.id;
    var chip = '';
    try { chip = d.chip(ctx) || ''; } catch (e) { chip = ''; }
    if (isLast) chip = '\u21A9 last visit' + (chip ? ' \u00B7 ' + chip : '');
    var tileBody = document.createElement('div');
    tileBody.className = 'district-tile-body';
    tileBody.innerHTML = '<div class="district-name">' + d.icon + ' ' + d.name + '</div>' +
      '<div class="district-flavor">' + d.flavor + '</div>' +
      (chip ? '<div class="district-chip">' + chip + '</div>' : '');
    tileBody.addEventListener('click', function () { goDistrict(d.id); });
    wrap.appendChild(tileBody);
    var action = null;
    if (d.id === 'shipwright') {
      action = document.createElement('button');
      action.className = 'btn store-btn district-tile-action';
      action.id = 'tile-action-shipwright-repair';
      action.textContent = '🔧 REPAIR ALL';
      action.addEventListener('click', function (ev) {
        ev.stopPropagation();
        quickRepair(ctx.p, ctx.eco, ctx.pm);
      });
    } else if (d.id === 'commerce') {
      action = document.createElement('button');
      action.className = 'btn store-btn district-tile-action';
      action.id = 'tile-action-commerce-sell';
      /* beta2-sellfriendly: the hub button used to read just SELL JUNK
       * with no payout anywhere on the row — a player with a full hold
       * could not tell what the tap was worth before the dialog. The
       * button now carries the live total (same sellJunkQuote formula
       * the confirm dialog already itemised); the dialog itself is
       * unchanged. No payout, price or formula changed. */
      var jq = sellJunkQuote(ctx.p, ctx.eco, ctx.pm);
      action.textContent = jq.hasAny ? '💰 SELL JUNK · +' + fmt(jq.total) + 'c' : '💰 SELL JUNK';
      action.addEventListener('click', function (ev) {
        ev.stopPropagation();
        quickSellJunk(ctx.p, ctx.eco, ctx.pm);
      });
    }
    if (action) wrap.appendChild(action);
    return wrap;
  }

  function renderHub(body, ctx) {
    var h = document.createElement('div');
    h.className = 'store-head'; h.textContent = 'STATION DISTRICTS';
    body.appendChild(h);
    var hint = document.createElement('div');
    hint.className = 'dim'; hint.style.marginBottom = '8px';
    hint.textContent = 'Six decks, one station. Pick a district — every service is two taps from the dock. Shipwright and Commerce tiles also carry one-tap Repair all / Sell junk.';
    body.appendChild(hint);
    /* beta2-sellfriendly FINDABILITY: every dock lands on this hub, so
     * this is where a player fresh from mining looks first. When ore is
     * aboard, say so with its live station value and offer one tap
     * straight onto the Commerce Sell tab (goDistrictTab is the
     * existing cross-link pattern, cf. Shipwright -> Commerce parts).
     * No new station, currency or mechanic; the Sell tab only exists
     * while something is sellable, and ore > 0 guarantees it. */
    if (ctx.p.ore > 0) {
      var hubOreVal = Math.floor(ctx.p.ore * ctx.eco.orePrice / ctx.pm);
      var banner = document.createElement('div');
      banner.id = 'hub-sell-ore-banner';
      banner.style.marginBottom = '8px';
      banner.innerHTML = '<span>💰 Ore aboard: ' + fmt(ctx.p.ore) + ' ore — worth ' +
        fmt(hubOreVal) + 'c here. </span>';
      var bannerBtn = document.createElement('button');
      bannerBtn.className = 'btn store-btn';
      bannerBtn.id = 'hub-sell-ore';
      bannerBtn.textContent = '💰 SELL ORE →';
      bannerBtn.addEventListener('click', function () { goDistrictTab('commerce', 'sell'); });
      banner.appendChild(bannerBtn);
      body.appendChild(banner);
    }
    var grid = document.createElement('div');
    grid.className = 'district-grid';
    grid.id = 'district-grid';
    DISTRICTS.forEach(function (d) { grid.appendChild(districtTile(d, ctx)); });
    body.appendChild(grid);
  }

  function render() {
    var body = document.getElementById('store-body');
    body.innerHTML = '';
    var p = SF.Player, eco = SF.CONFIG.economy;

    // station-defense: offline stations show only the repair panel
    var curSt0 = dockedSt || { name: 'Haven Dock', kind: 'dock' };
    // interiors-wiring: station backdrop on the store panel
    // (HQ views return early below and get their own backdrop from SF.HQ.render).
    // interiors-wiring-2: per-station key — the homebase gets the command-deck
    // scene; unmapped stations keep the legacy 'hangar' backdrop (fallback).
    if (curSt0.kind !== 'hq' && window.SF && SF.Interiors) {
      SF.Interiors.applyBackdrop(body, SF.Interiors.stationKey(curSt0));
    }
    if (window.SF && SF.Raids && SF.Raids.isOffline(SF.Game.systemId, curSt0.name)) {
      var stTitle0 = document.getElementById('store-title');
      if (stTitle0) stTitle0.innerHTML = '✕ ' + curSt0.name.toUpperCase() +
        ' <span class="dim">— OFFLINE</span>';
      body.appendChild(creditsLine());
      var op = document.createElement('div');
      op.className = 'store-row';
      op.style.cssText = 'border:1px solid #ff5e3a;background:rgba(255,94,58,.08);margin-bottom:8px;';
      var fee = SF.Raids.repairFee(SF.Game.systemId, curSt0.name);
      op.innerHTML = '<div class="store-info"><div>' +
        '<div class="store-name">✕ STATION OFFLINE</div>' +
        '<div class="store-desc">Pirates sacked this station. Docks, markets and ' +
        'services are down until the hull is repaired.</div></div></div>';
      var rb = document.createElement('button');
      rb.className = 'btn store-btn';
      rb.textContent = 'REPAIR · ' + fmt(fee) + 'c';
      if (p.credits < fee) rb.disabled = true;
      rb.addEventListener('click', function () {
        if (SF.Raids.payRepair(SF.Game.systemId, curSt0.name)) { SF.Audio.buy(); render(); }
        else SF.Audio.deny();
      });
      op.appendChild(rb);
      body.appendChild(op);
      body.appendChild(creditsLine());
      return;
    }

    // Phase 4: karma/standing price multiplier at this (Compact) station
    var pm = (window.SF && SF.Factions) ? SF.Factions.priceMul('compact') : 1;
    function pr(base) { return Math.ceil(base * pm); }

    function creditsLine() {
      var el = document.createElement('div');
      el.className = 'store-credits';
      var note = '';
      if (pm > 1) note = ' <span class="dim">· prices ×' + pm.toFixed(2) + ' (the Compact distrusts you)</span>';
      else if (pm < 1) note = ' <span class="dim">· prices ×' + pm.toFixed(2) + ' (standing discount)</span>';
      el.innerHTML = 'Credits: <b>' + fmt(p.credits) + '</b> &nbsp;·&nbsp; Ore: <b>' + fmt(p.ore) + '</b>' +
        ' &nbsp;·&nbsp; Cargo: <b>' + p.cargoUsed() + '/' + p.cargoSpace() + '</b>t' + note;
      return el;
    }
    body.appendChild(creditsLine());

    // Phase 5: station title follows the docked station
    var curSt = dockedSt || { name: 'Haven Dock', kind: 'dock' };
    var stTitle = document.getElementById('store-title');
    if (stTitle) {
      var sysNow = SF.SYSTEM_BY_ID[SF.Game.systemId];
      var icon = curSt.kind === 'hq' ? '🏛 ' : '🛰 ';
      stTitle.innerHTML = icon + curSt.name.toUpperCase() +
        ' <span class="dim">— ' + (sysNow ? sysNow.name : '') + '</span>';
    }
    // planets-facilities: faction HQs get their own requisition store
    // hud-dup-fix: no leading creditsLine() here — render() already
    // appended the top wallet line unconditionally above, so the
    // branch's own first append stacked a second identical
    // "Credits · Ore · Cargo" line directly beneath it (casino-open
    // glitch, user recording 2026-10-23). Trailing line stays: the
    // top+bottom wallet pattern matches every other render path.
    if (curSt.kind === 'hq' && window.SF && SF.HQ) {
      SF.HQ.render(body, curSt.ref);
      body.appendChild(creditsLine());
      return;
    }

    // station-sprites-4-wiring: track the docked kind for the prison-hulk
    // bounty bonus wrap (read by SF.StationViews).
    if (window.SF && SF.StationViews) SF.StationViews.currentKind = curSt.kind;
    // station-sprites-4-wiring: specialty stations get thin views (sprite
    // backdrop + one core interaction) instead of the full store.
    if ((curSt.kind === 'scrapyard' || curSt.kind === 'prison' ||
         curSt.kind === 'casino' || curSt.kind === 'memorial') &&
        window.SF && SF.StationViews) {
      // hud-dup-fix: leading creditsLine() removed — see the HQ branch
      // note above; the top wallet line already came from render()'s
      // unconditional append.
      SF.StationViews.render(body, curSt);
      body.appendChild(creditsLine());
      return;
    }

    // ---- station-districts-1: hub / district dispatch ----
    // The full-store path no longer stacks every section into one long
    // scroll: it renders the district HUB, or the one district the player
    // picked. HQ and specialty-station views returned early above and are
    // unchanged; the offline repair panel returned earlier still.
    var dctx = { p: p, eco: eco, pm: pm, pr: pr, curSt: curSt };
    if (view !== 'hub' && !districtById(view)) view = 'hub';
    if (view === 'den' && !denUnlocked()) view = 'hub';
    if (view === 'hub') renderHub(body, dctx);
    else renderDistrict(body, dctx);
    body.appendChild(creditsLine());
    if (window.SF && SF.Customs) SF.Customs.renderPanel();
  }

  /* ================= station-districts-1: district renderers ======
   * Every block below moved VERBATIM from the old single-scroll
   * render() — same calls, same order within the district, same
   * prices and outcomes. Only the heads noted inline changed. */

  /* SHIPWRIGHT — builder entry, hangar, hull purchases, one-time
   * installs, hull + subsystem repairs. */
  function renderShipwright(body, ctx) {
    var p = ctx.p, eco = ctx.eco, pm = ctx.pm, pr = ctx.pr, curSt = ctx.curSt;
    var h;
    // ---- Phase 2: ship builder ----
    var bb = document.createElement('button');
    bb.className = 'btn big ui-block';
    var actSh = p.ships[p.activeShip];
    var actCls = SF.SHIP_CLASS_BY_ID[actSh.classId];
    bb.textContent = '🔧 SHIP BUILDER — ' + actSh.name + ' (' + actCls.name + ')';
    bb.addEventListener('click', function () { SF.Builder.open(); });
    body.appendChild(bb);
    /* c-hud-polish (parts-vs-installs dedupe): Commerce is the single
     * buy source for parts. The Shipwright never had a second purchase
     * button for a Commerce part (its installs are the Builder fitting
     * owned inventory, and the Upgrades tab's Engine Tuning / Shield
     * Cell, which are not SF.PARTS and are not sold in Commerce), so
     * nothing is removed here — instead this cross-link is the one
     * route from Shipwright to the buy source. */
    var partsLink = document.createElement('button');
    partsLink.className = 'btn ui-block';
    partsLink.id = 'shipwright-parts-link';
    partsLink.textContent = '🛒 NEED PARTS? BUY THEM IN COMMERCE ›';
    partsLink.addEventListener('click', function () { goDistrictTab('commerce', 'parts'); });
    body.appendChild(partsLink);
    renderTabbed(body, 'shipwright', [
      { id: 'ships', label: 'Ships', build: function (body) {
    // ---- Phase 2: owned ships ----
    h = document.createElement('div'); h.className = 'store-head'; h.textContent = 'YOUR SHIPS';
    body.appendChild(h);
    p.ships.forEach(function (sh, i) {
      var cls = SF.SHIP_CLASS_BY_ID[sh.classId];
      var st = SF.Parts.derive(sh.classId, sh.parts);
      var isActive = i === p.activeShip;
      var div = document.createElement('div');
      div.className = 'store-row';
      div.innerHTML = '<div class="store-info"><span class="tier-dot" style="background:' + cls.color + '"></span>' +
        '<div><div class="store-name">' + sh.name + (isActive ? ' · ACTIVE' : '') + '</div>' +
        '<div class="store-desc">' + cls.name + ' · ' + cls.gridW + '×' + cls.gridH +
        ' · Hull ' + fmt(st.hull) + ' · Shield ' + fmt(st.shield) + ' · Spd ' + fmt(st.speed) +
        ' · Slots ' + st.slots + ' · 👥 ' + (sh.crew ? sh.crew.length : 0) + '/' + st.crewCap + '</div></div></div>';
      var ab = document.createElement('button');
      ab.className = 'btn store-btn';
      ab.textContent = isActive ? 'ACTIVE' : 'SET ACTIVE';
      ab.disabled = isActive;
      if (!isActive) {
        ab.addEventListener('click', function () {
          p.setActiveShip(i); SF.Save.save(); SF.Audio.ui(); render();
          SF.HUD.toast('Active ship: ' + sh.name);
        });
      }
      div.appendChild(ab);
      body.appendChild(div);
    });
      } },
      { id: 'shipyard', label: 'Shipyard', build: function (body) {
    // ---- Phase 2: shipyard (buy hulls) ----
    h = document.createElement('div'); h.className = 'store-head'; h.innerHTML = storeIcon('s_shipyard', 20) + 'SHIPYARD';
    body.appendChild(h);
    SF.SHIP_CLASSES.forEach(function (cls) {
      if (cls.id === 'fighter') return; // starter hull, not sold
      body.appendChild(row(cls.name + ' Hull', cls.desc + ' Grid ' + cls.gridW + '×' + cls.gridH +
        ' · Base hull ' + cls.hull + ' · shield ' + cls.shield + ' · speed ' + cls.speed +
        ' · crew req ' + cls.crewReq,
        pr(cls.price), false, p.credits >= pr(cls.price), 'BUY', function () {
          return p.buyShip(cls.id, pr(cls.price));
        }, null));
    });
      } },
      { id: 'upgrades', label: 'Upgrades', build: function (body) {
    // upgrades
    h = document.createElement('div'); h.className = 'store-head'; h.textContent = 'SHIP UPGRADES';
    body.appendChild(h);
    /* c-hud-polish (empty-category hiding): when BOTH one-time installs
     * are owned, the section would otherwise be two dead OWNED rows, so
     * it collapses to one honest line. Partial ownership keeps the old
     * rows (the unowned row is still actionable). */
    if (p.upgrades.engine && p.upgrades.shield) {
      var allMax = document.createElement('div');
      allMax.className = 'dim';
      allMax.id = 'upgrades-all-maxed';
      allMax.textContent = 'All upgrades installed — Engine Tuning ✓ · Shield Cell ✓.';
      body.appendChild(allMax);
    } else {
    body.appendChild(row('Engine Tuning', '+' + Math.round((eco.engineSpeedMul - 1) * 100) + '% engine speed. One-time install.',
      pr(eco.enginePrice), p.upgrades.engine, p.credits >= pr(eco.enginePrice), 'BUY', function () {
        if (p.credits < pr(eco.enginePrice) || p.upgrades.engine) return false;
        p.credits -= pr(eco.enginePrice); p.upgrades.engine = true;
        return true;
      }, 'blue'));
    body.appendChild(row('Shield Cell', '+' + eco.shieldBonus + ' max shield. One-time install.',
      pr(eco.shieldPrice), p.upgrades.shield, p.credits >= pr(eco.shieldPrice), 'BUY', function () {
        if (p.credits < pr(eco.shieldPrice) || p.upgrades.shield) return false;
        p.credits -= pr(eco.shieldPrice); p.upgrades.shield = true;
        p.shield = p.maxShield();
        return true;
      }, 'blue'));
    }
      } },
      { id: 'repairs', label: 'Repairs', build: function (body) {
    // services
    h = document.createElement('div'); h.className = 'store-head'; h.textContent = 'REPAIRS';
    body.appendChild(h);
    var missing = p.maxHull() - p.hull;
    // Phase 4: shipwright discount (one-time) + karma/standing price shift
    // twelve-hour-wave3 (B2): + Engineering repair discount (permanent skill)
    var repairCost = Math.ceil(missing * eco.repairPerHp * p.shipwrightDiscount * pm * skillRepairMul());
    body.appendChild(row('Repair Hull', missing <= 0 ? 'Hull at 100%. Fly safe.' : 'Restore ' + Math.ceil(missing) + ' hull.' +
      (p.shipwrightDiscount < 1 ? ' <span style="color:#3ddc5f">(Okafor discount applied!)</span>' : ''),
      repairCost, missing <= 0, p.credits >= repairCost && missing > 0, 'REPAIR', function () {
        if (missing <= 0 || p.credits < repairCost) return false;
        p.credits -= repairCost; p.heal(missing);
        p.shipwrightDiscount = 1; // discount consumed
        return true;
      }, null));
    // subsystem-damage-repair: subsystem repair (session-scoped integrity).
    // Cost scales to total missing integrity; the row shows a live readout.
    (function () {
      var smissing = (p.subsystemMissing) ? p.subsystemMissing() : 0;
      var perPt = (window.SF && SF.SUBSYS_REPAIR_PER_PT) || 3;
      // twelve-hour-wave3 (B2): Engineering repair discount (permanent skill)
      var scost = Math.ceil(smissing * perPt * p.shipwrightDiscount * pm * skillRepairMul());
      var line = '';
      if (window.SF && SF.SUBSYSTEMS && p.subsystems) {
        var subs = p.subsystems();
        if (subs) {
          line = '<br>' + SF.SUBSYSTEMS.map(function (d) {
            var v = Math.round(subs[d.id]);
            var col = v >= 50 ? '#3ddc5f' : '#ff5e3a';
            return '<span style="color:' + col + '">' + d.icon + ' ' + d.name + ' ' + v + '%</span>';
          }).join(' · ');
        }
      }
      body.appendChild(row('Repair Subsystems',
        smissing <= 0 ? 'All subsystems at 100%.' + line
          : 'Restore ' + smissing + ' integrity points.' +
            (p.shipwrightDiscount < 1 ? ' <span style="color:#3ddc5f">(Okafor discount applied!)</span>' : '') +
            line,
        scost, smissing <= 0, p.credits >= scost && smissing > 0, 'REPAIR', function () {
          if (smissing <= 0 || p.credits < scost) return false;
          p.credits -= scost;
          p.repairSubsystems();
          p.shipwrightDiscount = 1; // discount consumed
          return true;
        }, null, 's_repair'));
    })();
      } }
    ]);
  }
  /* COMMERCE — parts store, weapons store, sell side, trading exchange. */
  function renderCommerce(body, ctx) {
    var p = ctx.p, eco = ctx.eco, pm = ctx.pm, pr = ctx.pr, curSt = ctx.curSt;
    var h;
    /* c-hud-polish (empty-category hiding): the Sell tab exists only
     * while something is sellable (ore > 0 or a held component) — the
     * same conditional-tab pattern district-tabs-1 already uses for
     * Arena / Fence / Personal Station. A district with everything
     * empty never happens here (Parts / Weapons / Market always
     * render), and renderTabbed falls back to the first tab if the
     * remembered tab was Sell. When the tab IS present, a zero-ore
     * line next to held components is a one-line honest state, not
     * an empty list, and is kept. */
    var sellable = p.ore > 0 ||
      Object.keys(p.inventory || {}).some(function (id) { return p.inventory[id] > 0; });
    var commerceTabs = [
      { id: 'parts', label: 'Parts', build: function (body) {
    // ---- Phase 2: parts ----
    h = document.createElement('div'); h.className = 'store-head'; h.textContent = 'SHIP PARTS';
    body.appendChild(h);
    var byType = {};
    SF.PARTS.forEach(function (pt) {
      if (pt.craftOnly) return; // Phase 5: workbench-only parts are never sold
      if (pt.hqOnly) return; // planets-facilities: HQ-requisition only
      (byType[pt.type] = byType[pt.type] || []).push(pt);
    });
    Object.keys(byType).sort().forEach(function (t) {
      var th = document.createElement('div');
      th.className = 'store-desc';
      th.style.cssText = 'margin:8px 0 2px;letter-spacing:2px;';
      th.textContent = '— ' + t.toUpperCase() + ' —';
      body.appendChild(th);
      byType[t].forEach(function (pt) {
        // b4-sprite-lighting: exact part-type icon matches only.
        // Wave 4 completed the set: mount/cargo/quarters/armor icons
        // drawn locally (phases twelve-hour-wave4/gen-icons.py), so
        // every part type now has a depicting s_* icon.
        var ptIcon = pt.type === 'engine' ? 's_engine' :
          pt.type === 'reactor' ? 's_reactor' :
          pt.type === 'shield' ? 's_shield' :
          pt.type === 'mount' ? 's_mount' :
          pt.type === 'cargo' ? 's_cargo' :
          pt.type === 'quarters' ? 's_quarters' :
          pt.type === 'armor' ? 's_armor' : null;
        /* c-hud-polish (parts-vs-installs dedupe): Commerce stays the
         * single buy source, but its rows now read owned/installed
         * state honestly — loose inventory plus parts fitted on any
         * owned ship — so the state agrees with the Shipwright side. */
        var loose = (p.partInventory || {})[pt.id] || 0;
        var fitted = 0;
        (p.ships || []).forEach(function (sh) {
          (sh.parts || []).forEach(function (fp) { if (fp.partId === pt.id) fitted++; });
        });
        var ownedNote = (loose || fitted)
          ? ' · Owned ×' + loose + ' loose' + (fitted ? ' · Fitted ×' + fitted : '') +
            ' — fit more in the Ship Builder.'
          : '';
        body.appendChild(row(pt.name + ' <span class="dim">' + pt.w + '×' + pt.h + '</span>',
          partStatsText(pt) + ' · ' + pt.desc + ownedNote, pr(pt.price), false, p.credits >= pr(pt.price), 'BUY', function () {
            if (p.credits < pr(pt.price)) return false;
            p.credits -= pr(pt.price); p.addPart(pt.id, 1);
            return true;
          }, pt.tier, ptIcon));
      });
    });
      } },
      { id: 'weapons', label: 'Weapons', build: function (body) {
    // weapons (Phase 2: weapon slots + star upgrades)
    h = document.createElement('div'); h.className = 'store-head'; h.textContent = 'WEAPONS';
    body.appendChild(h);
    var slotLine = document.createElement('div');
    slotLine.className = 'dim';
    slotLine.style.marginBottom = '4px';
    slotLine.textContent = 'Hardpoints: ' + p.weaponsOwned.length + ' / ' + p.weaponSlots() +
      ' used — fit more weapon mounts in the Ship Builder.';
    body.appendChild(slotLine);
    SF.WEAPONS.forEach(function (w) {
      var entry = p.weaponEntry(w.id);
      if (!entry) {
        if (w.craftOnly) return; // Phase 5: workbench-only weapons are never sold
        if (w.hqOnly) return; // planets-facilities: HQ-requisition only
        var freeSlot = p.weaponsOwned.length < p.weaponSlots();
        var dps1 = (window.SF && SF.Mods) ? Math.round(SF.Mods.dps(w.id, 1, null)) : 0;
        body.appendChild(row(w.name + (freeSlot ? '' : ' <span class="dim">(no free hardpoint)</span>'),
          w.desc + (dps1 ? ' · <b>' + dps1 + ' DPS</b>' : ''), pr(w.price), false, p.credits >= pr(w.price) && freeSlot, 'BUY', function () {
            if (p.credits < pr(w.price) || p.weaponsOwned.length >= p.weaponSlots()) return false;
            p.credits -= pr(w.price); p.addWeapon(w.id);
            return true;
          }, w.tier, 'w_' + w.id));
      } else {
        body.appendChild(weaponOwnedRow(w, entry));
      }
    });
      } },
    ];
    if (sellable) commerceTabs.push(
      { id: 'sell', label: 'Sell', build: function (body) {
    h = document.createElement('div'); h.className = 'store-head'; h.innerHTML = storeIcon('s_sell', 20) + 'SELL';
    body.appendChild(h);
    var oreValue = Math.floor(p.ore * eco.orePrice / pm); // Phase 4: evil gets less
    /* beta2-ore: the Sell Ore row used to pass price 0 into row(), so
     * its button read "SELL · 0c" while the desc said the true total —
     * the whole stack then vanished in one tap with no confirm and no
     * receipt toast, which is exactly the "sold my stack for 0 credits"
     * report. The payment formula is unchanged (floor(ore × 5 / pm));
     * only the presentation is fixed: the button now carries the true
     * total, the desc states the per-unit price, the sale confirms
     * through SF.Dialog (never native confirm(), which the APK WebView
     * rejects), and the sale toasts its receipt. A custom row replaces
     * the row() call because row() fires onBuy() immediately with no
     * confirm step — row() itself is untouched, so every buy/repair
     * row keeps its exact behaviour. */
    (function () {
      var oreDiv = document.createElement('div');
      oreDiv.className = 'store-row';
      var unitTxt = (p.ore > 0 && oreValue % p.ore === 0)
        ? fmt(oreValue / p.ore) + 'c each'
        : 'about ' + (p.ore > 0 ? (oreValue / p.ore).toFixed(1) : fmt(eco.orePrice)) + 'c each';
      var oreDesc = p.ore <= 0 ? 'No ore in cargo.'
        : 'Sell ' + fmt(p.ore) + ' ore for ' + fmt(oreValue) + 'c (' + unitTxt + ').';
      oreDiv.innerHTML =
        '<div class="store-info">' + storeIcon('g_ore') +
        '<div><div class="store-name">Sell Ore</div>' +
        '<div class="store-desc">' + oreDesc + '</div></div></div>';
      var oreBtn = document.createElement('button');
      oreBtn.className = 'btn store-btn';
      if (p.ore <= 0) { oreBtn.disabled = true; oreBtn.textContent = 'NO ORE'; }
      else {
        oreBtn.textContent = 'SELL · ' + fmt(oreValue) + 'c';
        oreBtn.addEventListener('click', function () {
          var n = p.ore;
          var v = Math.floor(n * eco.orePrice / pm);
          var u = (n > 0 && v % n === 0) ? fmt(v / n) + 'c each'
            : 'about ' + (n > 0 ? (v / n).toFixed(1) : fmt(eco.orePrice)) + 'c each';
          SF.Dialog.confirm('Sell ' + fmt(n) + ' ore for +' + fmt(v) + 'c? (' + u + ')', function () {
            if (p.ore <= 0) return;
            var n2 = p.ore, v2 = Math.floor(n2 * eco.orePrice / pm);
            p.credits += v2; p.ore = 0;
            if (window.SF && SF.Audio) SF.Audio.buy();
            if (window.SF && SF.HUD) SF.HUD.toast('💰 Sold ore: +' + fmt(v2) + 'c.');
            render();
          });
        });
      }
      oreDiv.appendChild(oreBtn);
      body.appendChild(oreDiv);
    })();

    // components
    var inv = p.inventory;
    var ids = Object.keys(inv).filter(function (id) { return inv[id] > 0; });
    if (ids.length > 0) {
      h = document.createElement('div'); h.className = 'store-head'; h.textContent = 'SELL COMPONENTS';
      body.appendChild(h);
      ids.forEach(function (id) {
        var item = SF.ITEM_BY_ID[id];
        var val = Math.floor(item.price * inv[id] / pm); // Phase 4: evil gets less
        /* beta2-ore: same 0c-button bug as Sell Ore (price 0 passed to
         * row() produced "SELL +70c · 0c"). Button now carries the true
         * total; payment formula unchanged.
         * beta2-sellfriendly: row() fires onBuy() immediately, so this
         * lot still sold in one blind tap with no confirm and no
         * receipt. Same custom-row treatment as Sell Ore: the button
         * keeps the true total, the click opens SF.Dialog.confirm
         * itemising the lot, nothing moves until CONFIRM, and
         * confirming toasts the receipt. Formula unchanged. */
        (function () {
          var cDiv = document.createElement('div');
          cDiv.className = 'store-row';
          var dot = item.tier ? '<span class="tier-dot" style="background:' + SF.TIERS[item.tier] + '"></span>' : '';
          cDiv.innerHTML = '<div class="store-info">' + dot +
            '<div><div class="store-name">' + item.name + ' ×' + inv[id] + '</div>' +
            '<div class="store-desc">' + item.desc + '</div></div></div>';
          var cBtn = document.createElement('button');
          cBtn.className = 'btn store-btn';
          cBtn.textContent = 'SELL · ' + fmt(val) + 'c';
          cBtn.addEventListener('click', function () {
            var n = inv[id], v = Math.floor(item.price * n / pm);
            SF.Dialog.confirm('Sell ' + item.name + ' ×' + fmt(n) + ' for +' + fmt(v) + 'c?', function () {
              if (!(inv[id] > 0)) return;
              var n2 = inv[id], v2 = Math.floor(item.price * n2 / pm);
              p.credits += v2; inv[id] = 0;
              if (window.SF && SF.Audio) SF.Audio.buy();
              if (window.SF && SF.HUD) SF.HUD.toast('💰 Sold ' + item.name + ': +' + fmt(v2) + 'c.');
              render();
            });
          });
          cDiv.appendChild(cBtn);
          body.appendChild(cDiv);
        })();
      });
    }
      } });
    commerceTabs.push(
      { id: 'market', label: 'Market', build: function (body) {
    // interiors-wiring-2: trading market card with the cargo-hold backdrop.
    // renderMarket renders into the wrapper exactly as before.
    if (window.SF && SF.Trading) {
      var mkt = document.createElement('div');
      mkt.id = 'trading-market';
      SF.Trading.renderMarket(mkt, curSt);
      body.appendChild(mkt);
      if (window.SF && SF.Interiors && SF.Interiors.id('cargo'))
        SF.Interiors.applyBackdropTo(mkt, 'cargo');
    }
      } });
    renderTabbed(body, 'commerce', commerceTabs);
  }
  /* THE BAR — crew hiring, wingmen, cantina, arena pit, news wire. */
  function renderBar(body, ctx) {
    var p = ctx.p, eco = ctx.eco, pm = ctx.pm, pr = ctx.pr, curSt = ctx.curSt;
    var h;    var tabs = [
      { id: 'crew', label: 'Crew', build: function (body) {
    // ---- Phase 3: hire crew ----
    h = document.createElement('div'); h.className = 'store-head'; h.innerHTML = storeIcon('s_crew', 20) + 'HIRE CREW';
    body.appendChild(h);
    var crewNote = document.createElement('div');
    crewNote.className = 'dim';
    crewNote.style.marginBottom = '4px';
    crewNote.textContent = 'Crew dies when your hull takes damage (marines last). Marines fight double in boarding assaults.';
    body.appendChild(crewNote);
    /* c-hud-polish (empty-category hiding): when every candidate on
     * this roster is already hired, the hire list would otherwise be
     * all dead HIRED rows, so it collapses to one honest line. The
     * YOUR CREW section and CREW ROSTER button below are actionable
     * and stay untouched; partial rosters render exactly as before. */
    var unhired = hireRoster.filter(function (c) { return !c.hired; });
    if (!unhired.length) {
      var noHire = document.createElement('div');
      noHire.className = 'dim';
      noHire.id = 'crew-none-to-hire';
      noHire.textContent = hireRoster.length
        ? 'Everyone on this roster is already aboard — fresh candidates arrive next time you dock.'
        : 'No crew looking for work right now — fresh candidates arrive next time you dock.';
      body.appendChild(noHire);
    }
    if (unhired.length) hireRoster.forEach(function (c) {
      var cost = pr(SF.Crew.hireCost(c.stars)); // Phase 4: karma/standing price shift
      var div = document.createElement('div');
      div.className = 'store-row';
      var info = document.createElement('div');
      info.className = 'store-info';
      info.innerHTML = '<span class="tier-dot" style="background:' + SF.Crew.roleColor(c.role) + '"></span>' +
        '<div><div class="store-name">' + c.name +
        ' <span style="color:#ffd23f">' + SF.Upgrade.starsText(c.stars) + '</span></div>' +
        '<div class="store-desc">' + SF.Crew.roleName(c.role) + ' · boarding power ' +
        Math.round(SF.Crew.power(c)) + '</div></div>';
      div.appendChild(info);
      var btn = document.createElement('button');
      btn.className = 'btn store-btn';
      if (c.hired) {
        btn.textContent = 'HIRED';
        btn.disabled = true;
      } else {
        var si = p.bestCrewShip();
        var noRoom = si < 0;
        btn.textContent = noRoom ? 'NO BUNKS' : ('HIRE · ' + fmt(cost) + 'c');
        if (p.credits < cost || noRoom) btn.disabled = true;
        btn.addEventListener('click', function () {
          var s2 = p.bestCrewShip();
          if (p.credits < cost || s2 < 0) { SF.Audio.deny(); return; }
          p.credits -= cost;
          if (p.hireToShip(c, s2)) {
            c.hired = true;
            // crew-depth-wiring: recompute shipboard perks after the roster changes
            if (window.SF && SF.Crew && SF.Crew.recalcPerks) SF.Crew.recalcPerks(p.ships[s2]);
            SF.Audio.buy(); SF.Save.save(); render();
            SF.HUD.toast(c.name + ' joined ' + p.ships[s2].name);
          } else { SF.Audio.deny(); }
        });
      }
      div.appendChild(btn);
      body.appendChild(div);
    });

    // ---- crew-depth-wiring: your crew with morale bars (renderRowHTML) ----
    // Additive section; the hire list above is untouched.
    if (window.SF && SF.Crew && SF.Crew.renderRowHTML) {
      h = document.createElement('div'); h.className = 'store-head'; h.textContent = 'YOUR CREW';
      body.appendChild(h);
      var cdAsh = p.ships[p.activeShip];
      var cdHtml = '';
      (cdAsh.crew || []).forEach(function (m) { cdHtml += SF.Crew.renderRowHTML(m); });
      var cdDiv = document.createElement('div');
      cdDiv.id = 'crew-depth-station-list';
      cdDiv.innerHTML = cdHtml || '<div class="dim">No crew aboard — hire above.</div>';
      body.appendChild(cdDiv);
      var cdPk = document.createElement('div');
      cdPk.className = 'dim'; cdPk.style.marginBottom = '4px';
      cdPk.textContent = SF.Crew.perkSummary(cdAsh);
      body.appendChild(cdPk);
      var cdRb = document.createElement('button');
      cdRb.className = 'btn store-btn'; cdRb.style.marginTop = '4px';
      cdRb.textContent = '👥 CREW ROSTER';
      cdRb.addEventListener('click', function () { SF.Crew.showRosterPanel(cdAsh); });
      body.appendChild(cdRb);
    }
      } },
      { id: 'wingmen', label: 'Wingmen', build: function (body) {
    if (window.SF && SF.Companions) SF.Companions.renderHire(body);      } },
      { id: 'cantina', label: 'Cantina', build: function (body) {
    // interiors-wiring-2: cantina card with the bar backdrop (the 'bar' key was
    // reserved by interiors-wiring-retry for exactly this view).
    if (window.SF && SF.NPCs) {
      var cantina = document.createElement('div');
      cantina.id = 'cantina-card';
      SF.NPCs.renderCantina(cantina);
      body.appendChild(cantina);
      if (window.SF && SF.Interiors && SF.Interiors.id('bar'))
        SF.Interiors.applyBackdropTo(cantina, 'bar');
    }
      } }
    ];
    // arena-mode: the arena section only exists at Haven Dock
    // (SF.Arena.renderSection no-ops elsewhere) — no Arena tab off-site.
    if (curSt.kind === 'dock' && curSt.name === 'Haven Dock')
      tabs.push({ id: 'arena', label: 'Arena', build: function (body) {
          // arena-mode: combat gauntlets (Haven Dock only)
          if (window.SF && SF.Arena) SF.Arena.renderSection(body, curSt);
          // interiors-wiring-2: gladiatorial-pit backdrop on the arena section card.
          if (window.SF && SF.Interiors && SF.Interiors.id('arena')) {
            var arenaSec = document.getElementById('arena-section');
            if (arenaSec) SF.Interiors.applyBackdropTo(arenaSec, 'arena');
          }
            } });
    tabs.push({ id: 'wire', label: 'Wire', build: function (body) {
        // station-districts-1: the galactic wire hangs in the bar — latest
        // headlines read-only via SF.News.latest; the full wire stays the
        // existing overlay (OPEN THE WIRE calls SF.News.open, unchanged).
        if (window.SF && SF.News) {
          h = document.createElement('div'); h.className = 'store-head'; h.textContent = 'GALACTIC WIRE';
          body.appendChild(h);
          var wire = [];
          try { wire = SF.News.latest(3); } catch (e) { wire = []; }
          if (!wire.length) {
            var nw = document.createElement('div'); nw.className = 'dim';
            nw.textContent = 'The wire is quiet. Fly, fight, trade — make some news.';
            body.appendChild(nw);
          }
          wire.forEach(function (e) {
            var wr = document.createElement('div');
            wr.className = 'store-desc';
            wr.style.marginBottom = '3px';
            wr.textContent = '\uD83D\uDCF0 ' + e.text;
            body.appendChild(wr);
          });
          var wb = document.createElement('button');
          wb.className = 'btn store-btn';
          wb.textContent = '\uD83D\uDCF0 OPEN THE WIRE';
          wb.addEventListener('click', function () { SF.News.open(); });
          body.appendChild(wb);
        }
          } });
    renderTabbed(body, 'bar', tabs);
  }
  /* MISSION BOARD — quest + bounty contract boards. */
  function renderMissions(body, ctx) {
    // district-tabs-1: the old single contract-hub wrapper held both
    // boards under one shared backdrop. Each board now gets its own
    // tab (and its own backdrop); the Quests wrapper keeps the old
    // 'contract-boards' id. Tabs exist only for modules that exist.
    var tabs = [];
    if (window.SF && SF.Quests) tabs.push({ id: 'contracts', label: 'Contracts', build: function (body) {
      var boards = document.createElement('div');
      boards.id = 'contract-boards';
      SF.Quests.renderBoard(boards);
      body.appendChild(boards);
      if (window.SF && SF.Interiors && SF.Interiors.id('contracts'))
        SF.Interiors.applyBackdropTo(boards, 'contracts');
    } });
    if (window.SF && SF.Bounty) tabs.push({ id: 'bounties', label: 'Bounties', build: function (body) {
      var boards = document.createElement('div');
      boards.id = 'contract-boards-bounty';
      SF.Bounty.renderBoard(boards);
      body.appendChild(boards);
      if (window.SF && SF.Interiors && SF.Interiors.id('contracts'))
        SF.Interiors.applyBackdropTo(boards, 'contracts');
    } });
    renderTabbed(body, 'missions', tabs);
  }

  /* WORKBENCH & SERVICES — crafting, defense office (SF.Raids store
   * section), personal-station works. */
  function renderWorkbench(body, ctx) {
    var p = ctx.p, eco = ctx.eco, pm = ctx.pm, pr = ctx.pr, curSt = ctx.curSt;
    var h;    var tabs = [
      { id: 'crafting', label: 'Crafting', build: function (body) {
    // ---- Phase 5: crafting workbench, trading, homebase ----
    if (window.SF && SF.Crafting) SF.Crafting.renderWorkbench(body);      } },
      { id: 'defense', label: 'Defense', build: function (body) {
    // station-defense: hull status + turret install/upgrade + hull repair
    renderDefense(body);
      } }
    ];
    // Personal Station renders only as a purchase block (no
    // homebase yet) or as the panel (docked at the homebase) —
    // otherwise the tab is omitted, matching the old render.
    if (window.SF && SF.Homebase && (!SF.Homebase.exists() || curSt.kind === 'homebase'))
      tabs.push({ id: 'personal', label: 'Personal Station', build: function (body) {
          if (window.SF && SF.Homebase) {
            if (!SF.Homebase.exists()) {
              h = document.createElement('div'); h.className = 'store-head'; h.textContent = 'PERSONAL STATION';
              body.appendChild(h);
              SF.Homebase.renderPurchase(body);
            } else if (curSt.kind === 'homebase') {
              SF.Homebase.renderPanel(body);
            }
          }
            } });
    renderTabbed(body, 'workbench', tabs);
    // station-districts-1: hull/subsystem repair rows live at the
    // SHIPWRIGHT (brief map); this is the quick-action jump so they stay
    // one tap from the workbench too.
    var qb = document.createElement('button');
    qb.className = 'btn big ui-block';
    qb.textContent = '\uD83D\uDD27 HULL & SUBSYSTEM REPAIRS — AT THE SHIPWRIGHT \u203A';
    qb.addEventListener('click', function () { goDistrict('shipwright'); });
    body.appendChild(qb);
  }
  /* PIRATE DEN — black market entry + contraband fence. Only ever
   * rendered when denUnlocked(); the hub shows a locked ??? tile
   * otherwise and render() force-returns the view to the hub. */
  function renderDen(body, ctx) {
    var p = ctx.p, eco = ctx.eco, pm = ctx.pm, pr = ctx.pr, curSt = ctx.curSt;
    var h;
    // district-tabs-1: the fence renders into a detached div first so
    // tab presence can depend on it holding anything (the old code
    // appended it only when it had children, and showed a note else).
    var fence = null;
    if (window.SF && SF.Trading) {
      fence = document.createElement('div');
      fence.id = 'contraband-fence';
      SF.Trading.renderFence(fence, curSt);
    }
    var tabs = [{ id: 'den', label: 'Den', build: function (body) {
    h = document.createElement('div'); h.className = 'store-head'; h.textContent = 'PIRATE DEN';
    body.appendChild(h);
    var dfl = document.createElement('div');
    dfl.className = 'dim'; dfl.style.marginBottom = '6px';
    dfl.textContent = 'Aft maintenance deck, third hatch, no insignia. What happens here has no manifest.';
    body.appendChild(dfl);
    if (window.SF && SF.BlackMarket) {
      var bmBtn = document.createElement('button');
      bmBtn.className = 'btn big ui-block';
      bmBtn.id = 'den-blackmarket-btn';
      bmBtn.textContent = '\uD83D\uDD76 BLACK MARKET';
      bmBtn.addEventListener('click', function () { SF.BlackMarket.open(curSt.name); });
      body.appendChild(bmBtn);
    }
      if (fence && !fence.children.length) {
        var fnote = document.createElement('div');
        fnote.className = 'dim';
        fnote.textContent = 'The fence has nothing to move right now — bring contraband and check back.';
        body.appendChild(fnote);
      }
    } }];
    if (fence && fence.children.length) tabs.push({ id: 'fence', label: 'Fence', build: function (body) {
      body.appendChild(fence);
      if (window.SF && SF.Interiors && SF.Interiors.id('bazaar'))
        SF.Interiors.applyBackdropTo(fence, 'bazaar');
    } });
    renderTabbed(body, 'den', tabs);
  }

  /* ================= district-tabs-1: tabs inside districts ==========
   * Each district renders a horizontal tab bar and exactly ONE service
   * section at a time. Tab choice is session-only module state (same
   * pattern as lastDistrict) and survives re-renders (buys, repairs),
   * so an interaction never kicks the player back to the first tab.
   * Conditional tabs (Arena, Fence, Personal Station) are simply absent
   * from the array when their section would not render. */
  var districtTab = {}; // district id -> tab id, session only
  function renderTabbed(body, districtId, tabs) {
    tabs = (tabs || []).filter(function (t) { return !!t; });
    if (!tabs.length) return;
    var active = districtTab[districtId];
    var found = false;
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === active) found = true;
    if (!found) active = tabs[0].id;
    var bar = document.createElement('div');
    bar.className = 'district-tabs';
    bar.setAttribute('role', 'tablist');
    tabs.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'district-tab' + (t.id === active ? ' active' : '');
      b.id = 'tab-' + districtId + '-' + t.id;
      b.setAttribute('role', 'tab');
      b.textContent = t.label;
      b.addEventListener('click', function () {
        districtTab[districtId] = t.id;
        if (window.SF && SF.Audio) SF.Audio.ui();
        render();
      });
      bar.appendChild(b);
    });
    body.appendChild(bar);
    var sec = document.createElement('div');
    sec.className = 'district-tab-panel';
    sec.id = 'tab-panel-' + districtId + '-' + active;
    body.appendChild(sec);
    for (var j = 0; j < tabs.length; j++) if (tabs[j].id === active) tabs[j].build(sec);
  }

  function renderDistrict(body, ctx) {
    var d = districtById(view);
    var bar = document.createElement('div');
    bar.className = 'district-bar';
    var back = document.createElement('button');
    back.className = 'btn small';
    back.id = 'district-back';
    back.textContent = '\u2039 HUB';
    back.addEventListener('click', goHub);
    bar.appendChild(back);
    var t = document.createElement('span');
    t.className = 'district-title';
    t.textContent = d.icon + ' ' + d.name;
    bar.appendChild(t);
    body.appendChild(bar);
    if (view === 'commerce') renderCommerce(body, ctx);
    else if (view === 'bar') renderBar(body, ctx);
    else if (view === 'shipwright') renderShipwright(body, ctx);
    else if (view === 'missions') renderMissions(body, ctx);
    else if (view === 'workbench') renderWorkbench(body, ctx);
    else if (view === 'den') renderDen(body, ctx);
  }

  return {
    nearStation: nearStation,
    getStation: getStation,
    allStations: allStations, // Phase 5: multi-station support

    stationPos: function (systemId) {
      var st = getStation(systemId);
      return st ? { x: st.x, y: st.y } : null;
    },

    dock: function (st) {
      st = st || { name: 'Haven Dock', kind: 'dock' };
      dockedSt = st;
      view = 'hub'; // station-districts-1: every dock lands on the hub
      // planets-facilities: landing on a planet goes to the surface view
      if (st.kind === 'planet' && window.SF && SF.Planets) { SF.Planets.land(st.ref || st); return; }
      SF.Audio.dock();
      SF.Game.dockedAt = st.name; // Phase 4: quest turn-in identity
      if (st.kind === 'dock' || st.kind === 'homebase') {
        hireRoster = SF.Crew.rollRoster(SF.CONFIG.crew.rosterSize); // fresh candidates each visit
        if (window.SF && SF.Quests) SF.Quests.rollOffers(); // Phase 4: fresh contracts each dock
        // gameplay-depth: fresh bounties each dock
        if (window.SF && SF.Bounty) SF.Bounty.rollOffers();
        if (window.SF && SF.Trading) SF.Trading.drift(st); // Phase 5: markets move every visit
      }
      // station-sprites-4-wiring: fresh bounty offers at the prison hulk (its
      // turn-in desk is the point of the station); per-visit state resets
      // (casino loss ledger) for specialty stations.
      if (st.kind === 'prison' && window.SF && SF.Bounty) SF.Bounty.rollOffers();
      if (window.SF && SF.StationViews) SF.StationViews.onDock(st);
      if (window.SF && SF.Homebase && st.kind === 'homebase') SF.Homebase.refreshBoard();
      // planets-facilities: black-market prices move at black-market sites
      if (window.SF && SF.BlackMarket && (st.kind === 'hq' || st.kind === 'planet')) SF.BlackMarket.drift(st.name);
      render();
      // smuggling-runs: security scans contraband on dock at civilized stations
      if (window.SF && SF.Customs) SF.Customs.onDock(st);
      // station-defense: raid warning/in-progress panel
      if (window.SF && SF.Raids) SF.Raids.onDock(st);
      SF.Game.setState('DOCKED');
      if (window.SF && SF.News) SF.News.ambient(); // planets-facilities: ambient wire stories
      // twelve-hour-wave1 (B5): the old code toasted "progress saved"
      // unconditionally — a failed dock autosave was discovered only at
      // next launch. Save's return value now decides the toast.
      if (SF.Save.save()) {
        SF.HUD.toast('Docked at ' + st.name + ' — progress saved');
      } else {
        SF.HUD.toast('\u26A0\uFE0F Docked, but autosave FAILED — progress may not persist. Free up storage, then dock again.');
      }
    },

    undock: function () {
      SF.Audio.ui();
      if (window.SF && SF.Quests) SF.Quests.onUndock(); // Phase 4: escort ambush spawns
      // smuggling-runs: an unresolved customs scan runs as a plain submit on the way out
      if (window.SF && SF.Customs) SF.Customs.onUndock();
      // planets-facilities: customs sweep + black-market heat
      if (window.SF && SF.BlackMarket) SF.BlackMarket.onUndock();
      SF.Game.setState('PLAYING');
    },

    renderStore: render,
    // station-districts-1: session-only district state (test/debug hook)
    districtDebug: function () {
      return {
        view: view,
        lastDistrict: JSON.parse(JSON.stringify(lastDistrict)),
        districtTab: JSON.parse(JSON.stringify(districtTab)),
        denUnlocked: denUnlocked(),
        districts: DISTRICTS.map(function (d) { return d.id; })
      };
    },

    draw: function (ctx, systemId, time) {
      var self = this;
      preloadSprites(); // station-sprites-wiring: kick off sprite fetches on first paint
      // b3-environment: cull draws that are entirely off-canvas. The
      // camera eases toward player-centered (main.js, no clamping), the
      // viewport half-diagonal is ~500px at 915x412, and the largest
      // station-scene draw extends ~200px (planet sprite 148px + moon
      // orbit 165px + sprite half-size), so 1100px from the player leaves
      // ~400px of lag/shake slack. Off-canvas draws were invisible
      // anyway (canvas clips); this only saves their drawImage calls,
      // which pays for the dock halo below. Fallback: no player pos
      // means draw everything, exactly as before.
      var ppx = null, ppy = null;
      try {
        if (window.SF && SF.Player && typeof SF.Player.x === 'number') {
          ppx = SF.Player.x; ppy = SF.Player.y;
        }
      } catch (e) {}
      allStations(systemId).forEach(function (st) {
        if (ppx !== null) {
          var cdx = st.x - ppx, cdy = st.y - ppy;
          if (cdx * cdx + cdy * cdy > 1100 * 1100) return;
        }
        self.drawOne(ctx, st, time, systemId);
      });
      // v2-fx-wiring: station defense turret pads ring the station body
      if (window.SF && SF.Raids && SF.Raids.drawTurrets) SF.Raids.drawTurrets(ctx, systemId);
      // arena-mode: gauntlet tick + cordon zone visuals
      if (window.SF && SF.Arena) { SF.Arena.tick(time); SF.Arena.drawZone(ctx); }
    },

    drawOne: function (ctx, st, time, systemId) {
      // planets-facilities: planets + HQs render their own way
      if (st.kind === 'planet' && window.SF && SF.Planets) { SF.Planets.drawOne(ctx, st.ref, time); return; }
      if (st.kind === 'hq' && window.SF && SF.HQ) { SF.HQ.drawOne(ctx, st.ref, time); return; }
      // station-defense: sacked stations draw dark + OFFLINE tag
      if (window.SF && SF.Raids && SF.Raids.isOffline(systemId, st.name)) {
        ctx.save();
        ctx.translate(st.x, st.y);
        ctx.strokeStyle = '#5a5f6a'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#23262e';
        ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ff5e3a';
        ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
        ctx.fillText('✕ ' + st.name + ' — OFFLINE', st.x, st.y - 62);
        return;
      }
      // Phase 5: homebase draws gold, regular stations cyan
      var ring = st.kind === 'homebase' ? '#ffd23f' : '#39d5e8';
      var core = st.kind === 'homebase' ? '#7d6420' : '#1c6f7d';
      // station-sprites-wiring: hand-drawn sprite when decoded, procedural fallback otherwise
      var img = (window.SF && SF.Sprites) ? SF.Sprites.get('stations', STATION_SPRITE[st.kind] || 'haven') : null;
      ctx.save();
      ctx.translate(st.x, st.y);
      // b3-environment: station ambient glow — the shipped
      // fx/effects/shield-glow.png hexagon, painted faint (alpha 0.35)
      // and slow-turning (0.05 rad/s) BEHIND the main station sprite,
      // for the primary dock station only (kind 'dock'), and only while
      // the player is within 900px (on-screen at any viewport). One
      // drawImage, null-safe: a missing sprite simply means no halo.
      // The other station kinds keep their existing art untouched.
      try {
        if (st.kind === 'dock' && window.SF && SF.Sprites) {
          var halo = SF.Sprites.get('fx/effects', 'shield-glow');
          var hNear = true;
          try {
            if (window.SF && SF.Player && typeof SF.Player.x === 'number') {
              var hdx = st.x - SF.Player.x, hdy = st.y - SF.Player.y;
              hNear = (hdx * hdx + hdy * hdy <= 900 * 900);
            }
          } catch (e2) {}
          if (halo && hNear) {
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.rotate(time * 0.05);
            ctx.drawImage(halo, -110, -110, 220, 220);
            ctx.restore();
          }
        }
      } catch (e) {}
      if (img) {
        var sz = 150;
        ctx.rotate(time * 0.15); // keeps the old rotating-ring motion
        ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
        ctx.rotate(-time * 0.15);
      } else {
        // rotating ring station (original procedural fallback)
        ctx.rotate(time * 0.15);
        ctx.strokeStyle = ring; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.stroke();
        ctx.rotate(-time * 0.15);
        ctx.fillStyle = core;
        ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ring;
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      }
      // docking lights (blinkers read on top of either art style)
      for (var i = 0; i < 4; i++) {
        var a = time * 0.15 + i * Math.PI / 2;
        ctx.fillStyle = (Math.floor(time * 2 + i) % 2 === 0) ? '#ffd23f' : '#7a5a10';
        ctx.beginPath(); ctx.arc(Math.cos(a) * 46, Math.sin(a) * 46, 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = ring;
      ctx.font = '13px monospace'; ctx.textAlign = 'center';
      ctx.fillText(st.name, st.x, st.y - 62);
    }
  };
})();

/* ============================================================
 * STARFALL — smuggling-runs phase (2026-10-19): SF.Customs
 *
 * Dock security scans. Detection chance = contraband tons / hold size,
 * reduced by allied standing (>=50, x standCut), a fitted smuggler-hold
 * part (x 1-scanEvade), or bribing the inspector (x bribeMul, costs
 * credits). Caught = fine (credits) + standing hit with the local faction.
 * Save-neutral: no saved fields; pending scans live in memory. Tunables in
 * SF.CONFIG.customs (js/data.js). Test hook: SF.Customs.setRng(fn).
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function cfg() { return SF.CONFIG.customs; }
  function P() { return SF.Player; }

  var _rng = null; // test hook; defaults to Math.random

  function tons() {
    var inv = P().contraband || {}, t = 0;
    Object.keys(inv).forEach(function (k) { t += inv[k] || 0; });
    return Math.floor(t);
  }

  function localFaction() {
    var map = (SF.CONFIG.trading && SF.CONFIG.trading.systemFaction) || {};
    return map[SF.Game.systemId] || null;
  }

  /* Best scanEvade among fitted parts (0 if no shielded hold fitted). */
  function holdEvade() {
    var sh = P().ships[P().activeShip];
    var best = 0;
    ((sh && sh.parts) || []).forEach(function (fp) {
      var pd = SF.PART_BY_ID[fp.partId];
      if (pd && pd.scanEvade) best = Math.max(best, pd.scanEvade);
    });
    return best;
  }

  var Customs = {
    pending: null, // { stName } while an inspection is unresolved

    setRng: function (fn) { _rng = fn; },
    rng: function () { return _rng ? _rng() : Math.random(); },

    tons: tons,
    localFaction: localFaction,
    smugglerHoldFitted: function () { return holdEvade() > 0; },

    bribeCost: function () {
      var c = cfg();
      return c.bribeBase + c.bribePerTon * tons();
    },

    /* Detection chance with a full mitigation breakdown. */
    chance: function (bribed) {
      var c = cfg();
      var hold = P().cargoSpace();
      var t = tons();
      var base = hold > 0 ? Math.min(1, Math.max(0, t / hold)) : 0;
      var fid = localFaction();
      var allied = !!(fid && window.SF && SF.Factions && SF.Factions.standing(fid) >= c.standNeed);
      var ev = holdEvade();
      var ch = base;
      if (allied) ch *= c.standCut;
      if (ev > 0) ch *= (1 - ev);
      if (bribed) ch *= c.bribeMul;
      return {
        base: base, tons: t, hold: hold, allied: allied,
        holdEvade: ev, bribed: !!bribed,
        total: Math.min(1, Math.max(0, ch))
      };
    },

    /* Called from SF.Station.dock after the store renders. */
    onDock: function (st) {
      if (!st || (st.kind !== 'dock' && st.kind !== 'homebase')) return;
      if (tons() <= 0) { this.pending = null; return; }
      this.pending = { stName: st.name };
      this.renderPanel();
    },

    /* Prepends the inspection panel to the store body while a scan is pending. */
    renderPanel: function () {
      var body = document.getElementById('store-body');
      if (!body || !this.pending) return null;
      if (tons() <= 0) { this.pending = null; return null; }
      var c = cfg(), ch = this.chance(false), self = this;
      var old = document.getElementById('customs-panel');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var wrap = document.createElement('div');
      wrap.id = 'customs-panel';
      wrap.className = 'store-row';
      wrap.style.cssText = 'border:1px solid #e8b339;background:rgba(232,179,57,.08);margin-bottom:8px;';
      var pct = Math.round(ch.total * 100);
      var brk = ch.base.toFixed(2) + ' base (' + ch.tons + 't/' + ch.hold + 't hold)' +
        (ch.allied ? ' ×' + c.standCut + ' allied standing' : '') +
        (ch.holdEvade > 0 ? ' ×' + (1 - ch.holdEvade).toFixed(2) + ' smuggler hold' : '') +
        '<br>Bribe: cuts detection to <b>' + Math.round(ch.total * c.bribeMul * 100) + '%</b>.';
      wrap.innerHTML = '<div class="store-info"><div>' +
        '<div class="store-name">🔍 CUSTOMS INSPECTION — detection risk <b>' + pct + '%</b></div>' +
        '<div class="store-desc">' + brk + '<br>Smuggling is a crime, captain. The inspector is waiting.</div>' +
        '</div></div>';
      var sub = document.createElement('button');
      sub.className = 'btn store-btn';
      sub.id = 'customs-submit';
      sub.textContent = 'SUBMIT TO SCAN';
      sub.addEventListener('click', function () { self.resolve(false); });
      wrap.appendChild(sub);
      var bc = this.bribeCost();
      var br = document.createElement('button');
      br.className = 'btn store-btn';
      br.id = 'customs-bribe';
      br.textContent = 'BRIBE INSPECTOR · ' + bc + 'c';
      if (P().credits < bc) br.disabled = true;
      br.addEventListener('click', function () { self.resolve(true); });
      wrap.appendChild(br);
      body.insertBefore(wrap, body.firstChild);
      // interiors-wiring-2: scanner-arch backdrop on the inspection card.
      if (window.SF && SF.Interiors && SF.Interiors.id('customs'))
        SF.Interiors.applyBackdropTo(wrap, 'customs');
      return wrap;
    },

    /* Resolve the pending scan. bribed: pay first, roll at reduced chance. */
    resolve: function (bribed) {
      if (!this.pending) return null;
      var c = cfg(), ch = this.chance(bribed);
      if (bribed) {
        var cost = this.bribeCost();
        if (P().credits < cost) { if (window.SF && SF.Audio) SF.Audio.deny(); return null; }
        P().credits -= cost;
      }
      this.pending = null;
      var roll = this.rng();
      var caught = roll < ch.total;
      var out = { caught: caught, roll: roll, chance: ch.total, bribed: bribed, tons: ch.tons };
      if (caught) {
        var fine = Math.min(P().credits, c.fineBase + c.finePerTon * ch.tons);
        P().credits -= fine;
        var fid = localFaction();
        if (window.SF && SF.Factions) {
          if (fid) SF.Factions.shift(fid, -c.standHit);
          SF.Factions.shiftKarma(-c.karmaHit);
        }
        if (window.SF && SF.News) SF.News.push('🚔 Customs nailed a smuggler with ' + ch.tons +
          't of contraband at ' + (SF.Game.dockedAt || 'a station') + ' — fined ' + Math.floor(fine) + 'c.');
        if (window.SF && SF.Audio) SF.Audio.deny();
        if (window.SF && SF.Audio && SF.Audio.sfx) SF.Audio.sfx('contraband_found');
        if (window.SF && SF.HUD) SF.HUD.toast('🚔 CAUGHT! Contraband found — fined ' + Math.floor(fine) + 'c' +
          (fid ? ', standing -' + c.standHit + ' with ' + fid : '') + '.');
        out.fine = fine;
        out.standingHit = fid ? c.standHit : 0;
      } else {
        if (window.SF && SF.Audio) SF.Audio.buy();
        if (window.SF && SF.HUD) SF.HUD.toast(bribed ?
          'The inspector pockets the credits and looks the other way.' :
          'Clean scan. The inspector nods and moves on.');
      }
      if (window.SF && SF.Save) SF.Save.save();
      if (window.SF && SF.Station) SF.Station.renderStore();
      return out;
    },

    /* Undocking with an unresolved scan = the scan runs as a plain submit. */
    onUndock: function () {
      if (this.pending) this.resolve(false);
    }
  };

  SF.Customs = Customs;
})();
/* ================= station-defense phase (2026-10-19) =================
 * SF.Raids: pirate raid events on stations.
 *
 * While PLAYING near an eligible station (kind 'dock' or 'homebase'), a raid
 * may trigger: the alert SFX sounds, a warning banner counts down (~18s),
 * then 2-4 waves of raiders (scaled by system danger: Solace 2, Drift 3,
 * Ember 4) besiege the station. Raid enemies (e.raidSt, see js/enemies.js)
 * orbit the station and fire real hostile bolts at its hull.
 *
 * Stations have hull (900) + buyable/upgradeable defense turrets (station UI,
 * STATION DEFENSE section). Raiders destroyed -> credits + local-faction
 * standing; clearing a wave pays a bonus; victory pays a larger bonus.
 * Station hull at zero -> station OFFLINE: the store shows only a repair
 * panel until the repair fee is paid.
 *
 * Runtime model: driven from SF.Enemies.update (PLAYING only), so raids
 * pause while docked / in menus / on system jump (jump aborts the raid
 * silently; enterSystem clears the enemy list).
 *
 * defense-grid-1 (2026-10-22): the abstract turret list is now a real
 * tower-defense GRID. Eligible stations (dock / homebase) have fixed pad
 * slots ringing the hull; the player installs one of five typed turrets
 * (pulse / flak / missile / rail / shield projector) per pad from the
 * Defense Office (Workbench district), upgrades each 1-5 stars, and can
 * sell or repair them. A station REACTOR POWER budget caps total turret
 * draw, so a full ring of heavy guns is impossible — placement is a
 * choice. Hostile bolts that cross the pad ring can hit and destroy
 * turrets; shield projectors pool a regenerating station shield that
 * absorbs damage (bolts and rams) before the hull.
 * PERSISTENCE: the OWNED station's (homebase) grid — layout, turret
 * types/stars/hp, hull, shield, offline flag — persists via the save
 * blob (save v12, `defense` field; see js/save.js migrateV12 note).
 * NPC-station grids stay session-only, exactly like the old turret list.
 * Planet ORBITAL slots exist as data-layer scaffolding only
 * (SF.Raids.planetSlots) — planets are faction-held and no player
 * planet-control mechanic exists yet, so nothing builds there in v1.
 *
 * Test hooks: SF.Raids.tuning, .status(), .stState(sys, entry),
 * .debugTrigger(sys, name), .debugSkipWarning(), .debugCooldown(ms),
 * .damageStation(sys, name, dmg, x, y), .isOffline(sys, name).
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var RC = {
    triggerRadius: 1700,   // player must be this close to a station to roll
    warnSecs: 18,          // warning countdown before wave 1 (wall clock)
    cooldown: [420, 720],  // seconds between raids
    chancePerSec: 0.0028,  // trigger roll while in radius (x danger mult)
    dockWarnChance: 0.30,  // chance of a warning roll on dock
    waveSize: [2, 3],      // base raiders per wave (+wave idx +danger)
    spawnDist: [950, 1150],
    breatherSecs: 6,
    stationHull: 900,
    stationRadius: 52,     // visual body radius for rams
    boltHitRadius: 50,     // hostile bolts land inside this radius
    stationRepairPerHp: 2, // credits per hull point for manual repairs
    repairFeeMul: 0.6,     // offline repair fee = maxHull * this
    turret: {
      max: 3,
      install: [1200, 2200, 3600], // cost per turret slot
      upgrade: { 2: 1500, 3: 2800 }, // cost to reach level
      maxLvl: 3,
      dmg: [0, 14, 24, 36], // index by level
      range: 780,
      interval: 0.85,
      boltSpeed: 640
    },
    waveReward: { credits: [120, 220], standing: 3 },
    killStanding: 2,       // local-faction standing per raider destroyed
    victory: { credits: [400, 700], standing: 6, karma: 2 }
  };

  var DANGER = { solace: 0, drift: 1, ember: 2 };
  function dangerIdx(sys) { return DANGER[sys] || 0; }

  function randMs(lo, hi) { return (lo + Math.random() * (hi - lo)) * 1000; }
  function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  function localFaction(sys) {
    var map = (SF.CONFIG.trading && SF.CONFIG.trading.systemFaction) || {};
    return map[sys || SF.Game.systemId] || null;
  }

  /* ================= defense-grid-1: turret types + grid model ==========
   * Five turret types, each with an item tier (global rarity rule) and
   * 1-5 star upgrades (global rule). Stat scaling mirrors the part/weapon
   * upgrade family in js/upgrade.js: stats x SF.Upgrade.starMult(stars),
   * costs = base * creditMul * toStar^2 * SF.TIER_MUL[tier] credits and
   * round(base / oreDiv * toStar) ore (SF.CONFIG.upgrades). */
  var TURRET_TYPES = {
    pulse:   { name: 'Pulse Turret',     tier: 'white',  base: 900,  power: 15,
               range: 780, interval: 0.85, dmg: 14, boltSpeed: 640, boltLife: 2.2,
               hp: 120, color: '#7df9ff', sprite: 'laser', code: 'PLS',
               desc: 'Balanced all-rounder — the evolved auto-turret.' },
    flak:    { name: 'Flak Cannon',      tier: 'green',  base: 1100, power: 10,
               range: 520, interval: 0.30, dmg: 6, boltSpeed: 780, boltLife: 1.2,
               hp: 100, color: '#ffd23f', sprite: 'laser', code: 'FLK',
               prefer: 'drone', bigMul: 0.5,
               desc: 'Short-range shredder. Melts drones and fighters; half damage vs gunships and capitals.' },
    missile: { name: 'Missile Turret',   tier: 'blue',   base: 2400, power: 25,
               range: 900, interval: 2.3, dmg: 36, boltSpeed: 430, boltLife: 3.4,
               hp: 140, color: '#ff9d5e', sprite: 'plasma', code: 'MSL',
               prefer: 'gunship', blast: 95, homing: true,
               desc: 'Homing splash missiles. Slow cycle; hunts gunships and capitals first.' },
    rail:    { name: 'Rail Lance',       tier: 'purple', base: 3400, power: 30,
               range: 1250, interval: 2.6, dmg: 58, boltSpeed: 1500, boltLife: 1.4,
               hp: 110, color: '#c9a7ff', sprite: 'railgun', code: 'RAL',
               desc: 'Extreme range, armor-piercing. Slow cycle; targets the biggest hull in reach.' },
    shield:  { name: 'Shield Projector', tier: 'orange', base: 3000, power: 20,
               hp: 130, color: '#7dffce', sprite: null, code: 'SHD',
               shieldPool: 150, shieldRegen: 6,
               desc: 'No guns. Projects a station shield that absorbs fire and rams, then regenerates.' }
  };
  var TYPE_ORDER = ['pulse', 'flak', 'missile', 'rail', 'shield'];

  var GRID = {
    pads:  { dock: 6, homebase: 8, planet: 4 },     // planet = orbital scaffolding
    power: { dock: 110, homebase: 150, planet: 60 },
    padRing: 52,          // world units — the ring the fx pads already draw on
    planetRing: 96,       // orbital slot ring radius for planets (scaffolding)
    padHitRadius: 16,     // hostile bolts this close to a pad hit the turret
    sellRefund: 0.5,      // fraction of invested credits + ore returned on sell
    repairPerHp: 1.2,     // credits per turret hull point at the Defense Office
    starPowerMul: 0.10,   // +10% reactor draw per star above 1
    starHpMul: 0.15       // +15% turret hull per star above 1
  };

  function padsFor(kind) { return GRID.pads[kind] || 0; }
  function powerBudget(kind) { return GRID.power[kind] || 0; }
  function padAngle(pad, count) { return -Math.PI / 2 + (pad / Math.max(1, count)) * Math.PI * 2; }
  function padPos(sst, pad) {
    var a = padAngle(pad, padsFor(sst.kind));
    return { x: sst.x + Math.cos(a) * GRID.padRing, y: sst.y + Math.sin(a) * GRID.padRing };
  }
  function turretAt(sst, pad) {
    for (var i = 0; i < sst.turrets.length; i++) if (sst.turrets[i].pad === pad) return sst.turrets[i];
    return null;
  }
  function turretMaxHp(typeId, stars) {
    var T = TURRET_TYPES[typeId]; if (!T) return 1;
    return Math.round(T.hp * (1 + GRID.starHpMul * (stars - 1)));
  }
  function turretDmg(tur) {
    var T = TURRET_TYPES[tur.type]; if (!T || !T.dmg) return 0;
    var sm = (window.SF && SF.Upgrade) ? SF.Upgrade.starMult(tur.stars) : 1 + 0.25 * (tur.stars - 1);
    return Math.round(T.dmg * sm);
  }
  function turretDraw(tur) {
    var T = TURRET_TYPES[tur.type]; if (!T) return 0;
    return Math.round(T.power * (1 + GRID.starPowerMul * (tur.stars - 1)));
  }
  function powerUsed(sst) {
    var n = 0;
    for (var i = 0; i < sst.turrets.length; i++) n += turretDraw(sst.turrets[i]);
    return n;
  }
  function maxShield(sst) {
    var sm = (window.SF && SF.Upgrade) ? SF.Upgrade.starMult : function (s) { return 1 + 0.25 * (s - 1); };
    var n = 0;
    for (var i = 0; i < sst.turrets.length; i++) {
      var tur = sst.turrets[i], T = TURRET_TYPES[tur.type];
      if (T && T.shieldPool) n += Math.round(T.shieldPool * sm(tur.stars));
    }
    return n;
  }
  function shieldRegenRate(sst) {
    var sm = (window.SF && SF.Upgrade) ? SF.Upgrade.starMult : function (s) { return 1 + 0.25 * (s - 1); };
    var n = 0;
    for (var i = 0; i < sst.turrets.length; i++) {
      var tur = sst.turrets[i], T = TURRET_TYPES[tur.type];
      if (T && T.shieldRegen) n += T.shieldRegen * sm(tur.stars);
    }
    return n;
  }

  /* cost family — mirrors SF.Upgrade.costFor (js/upgrade.js) */
  function installCost(typeId) {
    var T = TURRET_TYPES[typeId]; if (!T) return null;
    var U = SF.CONFIG.upgrades;
    return { credits: Math.round(T.base * ((SF.TIER_MUL && SF.TIER_MUL[T.tier]) || 1)),
             ore: Math.round(T.base / U.oreDiv) };
  }
  function upgradeCost(tur) {
    var T = TURRET_TYPES[tur.type]; if (!T || tur.stars >= 5) return null;
    var U = SF.CONFIG.upgrades, toStar = tur.stars + 1;
    return { credits: Math.round(T.base * U.partCreditMul * toStar * toStar * ((SF.TIER_MUL && SF.TIER_MUL[T.tier]) || 1)),
             ore: Math.round(T.base / U.oreDiv * toStar) };
  }
  function canAffordCost(c) {
    return !!c && SF.Player.credits >= c.credits && SF.Player.ore >= c.ore;
  }
  function payCost(c) {
    if (!canAffordCost(c)) return false;
    SF.Player.credits -= c.credits; SF.Player.ore -= c.ore;
    return true;
  }
  function costText(c) {
    if (!c) return '';
    return Math.floor(c.credits).toLocaleString('en-US') + 'c' +
      (c.ore > 0 ? ' + ' + c.ore + ' ore' : '');
  }
  /* owned-station structural changes ride the normal save (dock autosave
   * also covers them; this just keeps a bought grid safe if the app dies
   * before the next dock). */
  function persistIfOwned(sst) {
    if (sst && sst.kind === 'homebase' && window.SF && SF.Save) SF.Save.save();
  }

  /* ---- per-station runtime state ---- */
  var states = {}; // key 'sys:name' -> {sys,name,x,y,kind,hull,maxHull,shield,turrets,offline}
  function key(sys, name) { return sys + ':' + name; }

  function stState(sys, entry) {
    var k = key(sys, entry.name);
    var s = states[k];
    if (!s) {
      s = states[k] = {
        sys: sys, name: entry.name, x: entry.x, y: entry.y, kind: entry.kind,
        hull: RC.stationHull, maxHull: RC.stationHull,
        shield: 0, // defense-grid-1: pooled station shield (projectors)
        turrets: [], // defense-grid-1: [{type, stars, pad, t, hp, maxHp, invested:{credits,ore}}]
        offline: false
      };
    }
    return s;
  }

  function eligible(st) { return st && (st.kind === 'dock' || st.kind === 'homebase'); }

  /* ---- raid lifecycle ---- */
  var raid = null; // {sys,key,name,x,y,state:'warn'|'active',warnUntil,wave,waves,breatherUntil,kills,alertT}
  var cooldownUntil = 0;
  var lastSys = null;

  function abortSilent() {
    raid = null;
    if (window.SF && SF.RaidBar) SF.RaidBar.hide();
  }

  function nearestStation(player, sys) {
    var best = null, bd = RC.triggerRadius;
    SF.Station.allStations(sys).forEach(function (st) {
      if (!eligible(st)) return;
      var d = Math.hypot(player.x - st.x, player.y - st.y);
      if (d <= bd) { bd = d; best = st; }
    });
    return best;
  }

  function scheduler(dt, player, sys) {
    if (Date.now() < cooldownUntil) return;
    if (SF.Enemies.list.length > 36) return; // don't pile onto chaos
    var st = nearestStation(player, sys);
    if (!st) return;
    if (stState(sys, st).offline) return;
    var danger = dangerIdx(sys);
    if (Math.random() < RC.chancePerSec * (1 + danger * 0.7) * dt) {
      trigger(sys, st);
    }
  }

  function trigger(sys, st) {
    /* hud-declutter-2, fix 3 (coordinator addendum, 2026-10-22): rookie
     * gate — no station raids while the player is in the rookie window
     * (the user's first-session deaths included a Haven Dock raid).
     * SF.Enemies.rookieFactor(sys) -> {active, ...} ships with the
     * difficulty phase, which merges separately; this staging tree does
     * NOT have it, so the lookup is fully defensive: absent, malformed,
     * or throwing all mean "no gate" and the raid path is unchanged.
     * Postpone, never consume: trigger() sets no raid and no cooldown,
     * so the per-tick scheduler simply rolls again next tick and a raid
     * can still start the moment the rookie window closes. */
    var rf = null;
    try {
      rf = (window.SF && SF.Enemies && typeof SF.Enemies.rookieFactor === 'function')
        ? SF.Enemies.rookieFactor(sys) : null;
    } catch (e) { rf = null; }
    if (rf && rf.active) return;
    var danger = dangerIdx(sys);
    var sst = stState(sys, st);
    raid = {
      sys: sys, key: key(sys, st.name), name: st.name, x: st.x, y: st.y,
      state: 'warn', warnUntil: Date.now() + RC.warnSecs * 1000,
      wave: 0, waves: 2 + danger, breatherUntil: 0, kills: 0, alertT: 0
    };
    if (window.SF && SF.Audio) SF.Audio.alert();
    if (window.SF && SF.HUD) SF.HUD.toast('⚠ RAID WARNING — pirates inbound to ' + st.name + '!');
    if (window.SF && SF.News) SF.News.push('⚠ Raid warning: pirate fleet converging on ' + st.name + '.');
  }

  function warnTick(dt) {
    raid.alertT -= dt;
    if (raid.alertT <= 0) {
      raid.alertT = 6; // re-sound the alert while the warning runs
      if (window.SF && SF.Audio) SF.Audio.alert();
    }
    if (Date.now() >= raid.warnUntil) {
      raid.state = 'active';
      spawnWave();
    }
  }

  function pickType(danger) {
    var r = Math.random();
    if (danger <= 0) return r < 0.7 ? 'raider' : 'drone';
    if (danger === 1) return r < 0.6 ? 'raider' : (r < 0.85 ? 'drone' : 'gunship');
    return r < 0.5 ? 'raider' : 'gunship';
  }

  function spawnWave() {
    raid.wave++;
    var danger = dangerIdx(raid.sys);
    var sys = SF.SYSTEM_BY_ID[raid.sys];
    var mul = sys ? sys.enemyMul : 1;
    var n = RC.waveSize[0] + randInt(0, RC.waveSize[1] - RC.waveSize[0]) +
      (raid.wave - 1) + danger;
    var ws = SF.CONFIG.worldSize;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var d = RC.spawnDist[0] + Math.random() * (RC.spawnDist[1] - RC.spawnDist[0]);
      var x = Math.max(60, Math.min(ws - 60, raid.x + Math.cos(a) * d));
      var y = Math.max(60, Math.min(ws - 60, raid.y + Math.sin(a) * d));
      SF.Enemies.spawn(pickType(danger), x, y, mul,
        { raidSt: { sys: raid.sys, name: raid.name, x: raid.x, y: raid.y } });
    }
    if (window.SF && SF.Audio) SF.Audio.alert();
    if (window.SF && SF.HUD) SF.HUD.toast('⚠ WAVE ' + raid.wave + '/' + raid.waves +
      ' — ' + n + ' raiders attacking ' + raid.name + '!');
  }

  function raidAlive() {
    var n = 0, l = SF.Enemies.list;
    for (var i = 0; i < l.length; i++) {
      var e = l[i];
      if (!e.raidSt || e.raidSt.sys !== raid.sys || e.raidSt.name !== raid.name) continue;
      /* defense-grid-1: a raider that has fled beyond 1500u has ROUTED —
       * it no longer besieges the station, so it stops counting toward
       * the siege. (A defense grid cannot chase a routed ship down;
       * without this, one crippled raider at the map edge would hold
       * the raid open forever against a grid-only defense. The ship
       * itself stays in the world as a normal fleeing enemy.) */
      if (e.state === 'flee') {
        var dx = e.x - raid.x, dy = e.y - raid.y;
        if (dx * dx + dy * dy > 1500 * 1500) continue;
      }
      /* defense-grid-1: an ADRIFT raider is dead in the water — no AI,
       * no weapons (js/enemies.js Phase 3) — so it is not besieging
       * anything either. Turret fire regularly crew-wipes a raider
       * into a derelict instead of killing it; turrets correctly never
       * target derelicts (they are the player's to board/salvage), so
       * counting one here would hold the raid open forever. The hulk
       * stays in the world, boardable, after the raid resolves. */
      if (e.adrift) continue;
      n++;
    }
    return n;
  }

  function combatTick() {
    if (raidAlive() > 0) { raid.breatherUntil = 0; return; }
    if (raid.wave >= raid.waves) { victory(); return; }
    var now = Date.now();
    if (!raid.breatherUntil) raid.breatherUntil = now + RC.breatherSecs * 1000;
    if (now >= raid.breatherUntil) {
      raid.breatherUntil = 0;
      waveReward();
      spawnWave();
    }
  }

  function waveReward() {
    var w = RC.waveReward;
    var cr = randInt(w.credits[0], w.credits[1]);
    SF.Player.credits += cr;
    var fid = localFaction(raid.sys), fn = '';
    if (fid && window.SF && SF.Factions) {
      SF.Factions.shift(fid, w.standing);
      fn = ', ' + SF.FACTION_BY_ID[fid].name + ' +' + w.standing;
    }
    if (window.SF && SF.HUD) SF.HUD.toast('Wave ' + raid.wave + ' cleared! +' + cr + 'c' + fn);
  }

  function victory() {
    var v = RC.victory;
    var cr = randInt(v.credits[0], v.credits[1]);
    SF.Player.credits += cr;
    var fid = localFaction(raid.sys), fn = '';
    if (fid && window.SF && SF.Factions) {
      SF.Factions.shift(fid, v.standing);
      SF.Factions.shiftKarma(v.karma);
      fn = ', ' + SF.FACTION_BY_ID[fid].name + ' +' + v.standing;
    }
    if (window.SF && SF.HUD) SF.HUD.toast('✓ RAID REPELLED — ' + raid.name + ' holds! +' +
      cr + 'c' + fn + ' (' + raid.kills + ' raiders down)');
    if (window.SF && SF.News) SF.News.push('✓ ' + raid.name + ' repelled a pirate raid (' +
      raid.kills + ' raiders destroyed).');
    if (window.SF && SF.Audio) SF.Audio.buy();
    cooldownUntil = Date.now() + randMs(RC.cooldown[0], RC.cooldown[1]);
    raid = null;
  }

  function fail(sst) {
    sst.offline = true; sst.hull = 0;
    var l = SF.Enemies.list;
    for (var i = l.length - 1; i >= 0; i--) {
      var e = l[i];
      if (e.raidSt && e.raidSt.sys === raid.sys && e.raidSt.name === raid.name) l.splice(i, 1);
    }
    if (window.SF && SF.HUD) SF.HUD.toast('✕ ' + raid.name +
      ' HAS FALLEN — services offline. Pay the repair fee to restore.');
    if (window.SF && SF.News) SF.News.push('✕ Pirates sacked ' + raid.name +
      ' — station services offline until repaired.');
    if (window.SF && SF.Audio) SF.Audio.explosion(true);
    cooldownUntil = Date.now() + randMs(RC.cooldown[0], RC.cooldown[1]);
    raid = null;
  }

  /* ---- station damage ---- */
  function damageStation(sys, stName, dmg, sx, sy) {
    var sst = states[key(sys, stName)];
    if (!sst || sst.offline) return;
    // defense-grid-1: shield projectors absorb damage (bolts AND rams —
    // every damage path into the station funnels through here) first.
    if (sst.shield > 0) {
      var absorbed = Math.min(sst.shield, dmg);
      sst.shield -= absorbed; dmg -= absorbed;
      if (window.SF && SF.Particles) SF.Particles.burst(sx, sy, '#7dffce', 3, 130, 0.25, 2);
      if (dmg <= 0) return;
    }
    sst.hull -= dmg;
    if (window.SF && SF.Particles) SF.Particles.burst(sx, sy, '#ff9d5e', 3, 150, 0.3, 2);
    if (sst.hull <= 0) {
      sst.hull = 0;
      if (raid && raid.key === key(sys, stName) && raid.state === 'active') fail(sst);
      else sst.offline = true;
    }
  }

  /* defense-grid-1: a turret on a pad takes a hit. Destroyed turrets are
   * removed (pad freed, power freed); the wreck is gone, not a husk. */
  function damageTurret(sst, tur, dmg, sx, sy) {
    tur.hp -= dmg;
    if (window.SF && SF.Particles) SF.Particles.burst(sx, sy, '#ffb35e', 3, 140, 0.3, 2);
    if (tur.hp > 0) return;
    var idx = sst.turrets.indexOf(tur);
    if (idx >= 0) sst.turrets.splice(idx, 1);
    var ms = maxShield(sst);
    if (sst.shield > ms) sst.shield = ms;
    if (window.SF && SF.Particles) SF.Particles.explosion(sx, sy, 0.5, false);
    if (window.SF && SF.HUD) SF.HUD.toast('✕ ' + (TURRET_TYPES[tur.type] ? TURRET_TYPES[tur.type].name : 'Turret') +
      ' destroyed at ' + sst.name + '!');
    if (window.SF && SF.Audio) SF.Audio.explosion(false);
    persistIfOwned(sst);
  }

  /* hostile bolts that reach a station hull land here (called from tick).
   * defense-grid-1: bolts cross the pad ring (radius 52) before the hull
   * radius (50) — a bolt passing within padHitRadius of an occupied pad
   * hits THAT TURRET instead. Pads thus genuinely body-block for the
   * station along their arc, and raiders chew through the grid. */
  function boltHits(sys) {
    var pool = SF.Projectiles.pool;
    var ks = Object.keys(states);
    if (!ks.length) return;
    for (var i = 0; i < pool.length; i++) {
      var pr = pool[i];
      if (!pr.active || pr.friendly) continue;
      for (var j = 0; j < ks.length; j++) {
        var sst = states[ks[j]];
        if (sst.sys !== sys || sst.offline || !eligible(sst)) continue;
        var hit = false;
        for (var t = 0; t < sst.turrets.length; t++) {
          var tur = sst.turrets[t];
          var pp = padPos(sst, tur.pad);
          var pdx = pr.x - pp.x, pdy = pr.y - pp.y;
          var prr = GRID.padHitRadius + pr.radius;
          if (pdx * pdx + pdy * pdy < prr * prr) {
            pr.active = false;
            damageTurret(sst, tur, pr.dmg, pr.x, pr.y);
            hit = true;
            break;
          }
        }
        if (hit) break;
        var dx = pr.x - sst.x, dy = pr.y - sst.y;
        var rr = RC.boltHitRadius + pr.radius;
        if (dx * dx + dy * dy < rr * rr) {
          pr.active = false;
          damageStation(sys, sst.name, pr.dmg, pr.x, pr.y);
          break;
        }
      }
    }
  }

  /* ---- defense turrets (defense-grid-1: typed grid) ---- */
  function nearestHostile(x, y, range) {
    var best = null, bd = range * range, l = SF.Enemies.list;
    for (var i = 0; i < l.length; i++) {
      var e = l[i];
      if (e.faction || e.trader || e.boss || e.adrift) continue;
      var dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }

  /* Per-type target rules. Legacy eligibility (no faction friendlies, no
   * traders, no adrift) is kept for every type; bosses join the target
   * pool only for missile/rail (their brief: anti-capital). */
  function pickTarget(sst, tur) {
    var T = TURRET_TYPES[tur.type];
    var l = SF.Enemies.list, range = T.range;
    var best = null, bd = range * range;
    var bestPref = null, bdPref = range * range, prefHp = -1;
    for (var i = 0; i < l.length; i++) {
      var e = l[i];
      if (e.faction || e.trader || e.adrift) continue;
      if (e.boss && tur.type !== 'missile' && tur.type !== 'rail') continue;
      if (e.hp <= 0) continue;
      var dx = e.x - sst.x, dy = e.y - sst.y, d2 = dx * dx + dy * dy;
      if (d2 > bd && d2 > bdPref) continue;
      if (T.prefer && e.type === T.prefer) {
        if (d2 < bdPref) { bdPref = d2; bestPref = e; }
      } else if (tur.type === 'rail') {
        // rail hunts the biggest hull in reach, range as tiebreak
        if (e.hp > prefHp || (e.hp === prefHp && d2 < bd)) { prefHp = e.hp; bd = d2; best = e; }
      } else if (d2 < bd) { bd = d2; best = e; }
    }
    return bestPref || best;
  }

  function turretsTick(dt, sys) {
    var ks = Object.keys(states);
    for (var i = 0; i < ks.length; i++) {
      var sst = states[ks[i]];
      if (sst.sys !== sys || sst.offline || !sst.turrets.length) continue;
      // shield projectors: pooled shield regenerates while any projector lives
      var ms = maxShield(sst);
      if (ms > 0 && sst.shield < ms) {
        sst.shield = Math.min(ms, sst.shield + shieldRegenRate(sst) * dt);
      }
      for (var t = 0; t < sst.turrets.length; t++) {
        var tur = sst.turrets[t];
        var T = TURRET_TYPES[tur.type];
        if (!T || !T.dmg) continue; // shield projector: no gun to fire
        tur.t -= dt;
        if (tur.t > 0) continue;
        var tgt = pickTarget(sst, tur);
        if (!tgt) continue;
        tur.t = T.interval;
        var pp = padPos(sst, tur.pad);
        var a = Math.atan2(tgt.y - pp.y, tgt.x - pp.x) + (Math.random() - 0.5) * 0.1;
        var dmg = turretDmg(tur);
        if (T.bigMul && (tgt.type === 'gunship' || tgt.boss)) dmg = Math.max(1, Math.round(dmg * T.bigMul));
        var opts = { radius: T.blast ? 6 : 4, life: T.boltLife };
        if (T.blast) { opts.blast = T.blast; opts.kind = 'missile'; }
        if (T.homing) { opts.homing = true; opts.turn = 2.4; opts.target = tgt; }
        SF.Projectiles.spawn(pp.x, pp.y, a, T.boltSpeed, dmg, true, T.color, opts);
        if (window.SF && SF.Particles) SF.Particles.burst(pp.x, pp.y, T.color, 2, 90, 0.15, 2);
        if (window.SF && SF.Audio) SF.Audio.laser();
      }
    }
  }

  /* ---- per-frame driver (called from SF.Enemies.update, PLAYING only) ---- */
  function tick(dt, player, worldSize) {
    var sys = SF.Game.systemId;
    if (sys !== lastSys) { lastSys = sys; abortSilent(); }
    if (window.SF && SF.RaidBar) SF.RaidBar.update();
    turretsTick(dt, sys);
    boltHits(sys);
    if (!raid) { scheduler(dt, player, sys); return; }
    if (raid.sys !== sys) { abortSilent(); return; }
    if (raid.state === 'warn') warnTick(dt);
    else if (raid.state === 'active') combatTick();
  }

  /* ---- store UI: raid panel while docked ---- */
  function onDock(st) {
    if (!raid || !st || !eligible(st)) return;
    if (raid.key !== key(SF.Game.systemId, st.name)) return;
    var body = document.getElementById('store-body');
    if (!body) return;
    var old = document.getElementById('raid-panel');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var wrap = document.createElement('div');
    wrap.id = 'raid-panel';
    wrap.className = 'store-row';
    wrap.style.cssText = 'border:1px solid #ff5e3a;background:rgba(255,94,58,.10);margin-bottom:8px;';
    var sst = states[raid.key];
    var hullPct = sst ? Math.max(0, Math.round(sst.hull / sst.maxHull * 100)) : 100;
    var inner = raid.state === 'warn'
      ? '<div class="store-name">⚠ RAID INBOUND — ' +
        Math.max(0, Math.ceil((raid.warnUntil - Date.now()) / 1000)) + 's</div>' +
        '<div class="store-desc">Pirates are converging on ' + st.name +
        '. Buy turrets below, then undock to defend.</div>'
      : '<div class="store-name">⚠ RAID IN PROGRESS — wave ' + raid.wave + '/' + raid.waves + '</div>' +
        '<div class="store-desc">' + st.name + ' hull at ' + hullPct +
        '%. Undock now to defend it!</div>';
    wrap.innerHTML = '<div class="store-info"><div>' + inner + '</div></div>';
    body.insertBefore(wrap, body.firstChild);
  }

  /* ---- v2-fx-wiring + defense-grid-1: station defense pads ----
   * Pads ring the station at radius 52 — the same ring turretsTick fires
   * from. defense-grid-1: pads are FIXED slots (pad index -> angle), so
   * empty pads draw as faint sockets and installed turrets draw at their
   * own pad, sprite by turret TYPE (pulse laser, missile plasma, rail
   * railgun; flak reuses the laser hull with its amber ring, the shield
   * projector is a dome with a shield ring). Loader-null draws a plain
   * dome pad, so a missing sprite never hides a turret the player paid
   * for. Damaged turrets get a small hp arc so losses read at a glance. */
  var TURRET_SPRITE_BY_LVL = { 1: 'laser', 2: 'plasma', 3: 'railgun' }; // legacy shim
  var turretSpritesWarmed = false;

  function drawTurrets(ctx, sys) {
    if (!turretSpritesWarmed) {
      turretSpritesWarmed = true;
      if (window.SF && SF.Sprites) SF.Sprites.preload('fx/turrets', ['laser', 'plasma', 'railgun']);
    }
    if (!(window.SF && SF.Station)) return;
    var list = SF.Station.allStations(sys);
    for (var s = 0; s < list.length; s++) {
      var st = list[s];
      if (!eligible(st)) continue;
      var sst = states[key(sys, st.name)];
      if (sst && sst.offline) continue;
      var n = padsFor(st.kind);
      for (var pad = 0; pad < n; pad++) {
        var a = padAngle(pad, n);
        var mx = st.x + Math.cos(a) * GRID.padRing, my = st.y + Math.sin(a) * GRID.padRing;
        var tur = sst ? turretAt(sst, pad) : null;
        if (!tur) {
          // empty socket: faint ring so the slot reads as buildable space
          ctx.save();
          ctx.globalAlpha = 0.4;
          ctx.strokeStyle = '#5a6b8f'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          continue;
        }
        var T = TURRET_TYPES[tur.type];
        var img = (T && T.sprite && window.SF && SF.Sprites)
          ? SF.Sprites.get('fx/turrets', T.sprite) : null;
        if (img) {
          ctx.drawImage(img, mx - 15, my - 15, 30, 30);
        } else {
          ctx.save();
          ctx.fillStyle = '#5a6b8f';
          ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = T ? T.color : '#7df9ff'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.restore();
        }
        if (T && !T.sprite) { // shield projector: pulsing shield ring
          ctx.save();
          ctx.globalAlpha = 0.5 + 0.2 * Math.sin(Date.now() / 300 + pad);
          ctx.strokeStyle = T.color; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(mx, my, 11, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        if (tur.hp < tur.maxHp) { // damage arc
          ctx.save();
          ctx.strokeStyle = tur.hp / tur.maxHp > 0.4 ? '#ffcf5e' : '#ff5e3a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(mx, my, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, tur.hp / tur.maxHp));
          ctx.stroke();
          ctx.restore();
        }
      }
      // station shield bubble while the pool has charge — b4-sprite-lighting:
      // sprite-first (shipped ring-teal, the teal of the old #7dffce stroke;
      // preloaded by particles.js b1 SHIELD_IDS), plain stroke fallback.
      // This is the one persistent procedural shield ring left in flight:
      // the player bubble is already ring-blue (ship.js) and enemies carry
      // no shield rings (their rings are faction identity / elite / enrage
      // state markers, not shields — left procedural, see REPORT.md).
      if (sst && sst.shield > 0.5) {
        ctx.save();
        ctx.globalAlpha = 0.16 + 0.1 * (sst.shield / Math.max(1, maxShield(sst)));
        var sbImg = (window.SF && SF.Sprites) ? SF.Sprites.get('fx/shield', 'ring-teal') : null;
        if (sbImg) {
          var sbS = (GRID.padRing + 16) * 2;
          ctx.drawImage(sbImg, st.x - sbS / 2, st.y - sbS / 2, sbS, sbS);
        } else {
          ctx.strokeStyle = '#7dffce'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(st.x, st.y, GRID.padRing + 16, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  /* ================= defense-grid-1: grid API internals ================= */
  var gridError = '';

  function stateFor(sys, name) {
    var sst = states[key(sys, name)];
    if (sst) return sst;
    var entry = null;
    if (window.SF && SF.Station) {
      SF.Station.allStations(sys).forEach(function (s) { if (s.name === name) entry = s; });
    }
    if (!entry) return null;
    return stState(sys, entry);
  }

  function installTurret(sys, name, pad, typeId) {
    var T = TURRET_TYPES[typeId];
    if (!T) { gridError = 'Unknown turret type.'; return false; }
    var sst = stateFor(sys, name);
    if (!sst) { gridError = 'Station not found.'; return false; }
    if (!eligible(sst)) { gridError = 'No defense grid at this station.'; return false; }
    if (sst.offline) { gridError = 'Station is offline — repair the hull first.'; return false; }
    if (pad < 0 || pad >= padsFor(sst.kind)) { gridError = 'No such pad.'; return false; }
    if (turretAt(sst, pad)) { gridError = 'Pad ' + (pad + 1) + ' is occupied.'; return false; }
    var draw = turretDraw({ type: typeId, stars: 1 });
    if (powerUsed(sst) + draw > powerBudget(sst.kind)) {
      gridError = 'Not enough reactor power (' + (powerUsed(sst) + draw) + '/' +
        powerBudget(sst.kind) + '). Sell or pick a lighter turret.';
      return false;
    }
    var cost = installCost(typeId);
    if (!canAffordCost(cost)) { gridError = 'Cannot afford (' + costText(cost) + ').'; return false; }
    payCost(cost);
    var maxHp = turretMaxHp(typeId, 1);
    sst.turrets.push({ type: typeId, stars: 1, pad: pad, t: Math.random() * 0.5,
      hp: maxHp, maxHp: maxHp, invested: { credits: cost.credits, ore: cost.ore } });
    gridError = '';
    if (window.SF && SF.HUD) SF.HUD.toast(T.name + ' installed at ' + name + ' (pad ' + (pad + 1) + ').');
    if (window.SF && SF.Audio && SF.Audio.sfx) SF.Audio.sfx('turret_buy');
    persistIfOwned(sst);
    return true;
  }

  function upgradeTurretPad(sys, name, pad) {
    var sst = stateFor(sys, name);
    if (!sst) { gridError = 'Station not found.'; return false; }
    var tur = turretAt(sst, pad);
    if (!tur) { gridError = 'Pad is empty.'; return false; }
    if (tur.stars >= 5) { gridError = 'Already at ★5.'; return false; }
    var cost = upgradeCost(tur);
    var newDraw = turretDraw({ type: tur.type, stars: tur.stars + 1 });
    if (powerUsed(sst) - turretDraw(tur) + newDraw > powerBudget(sst.kind)) {
      gridError = 'Not enough reactor power to run ★' + (tur.stars + 1) + '.';
      return false;
    }
    if (!canAffordCost(cost)) { gridError = 'Cannot afford (' + costText(cost) + ').'; return false; }
    payCost(cost);
    tur.stars++;
    tur.invested.credits += cost.credits; tur.invested.ore += cost.ore;
    var newMax = turretMaxHp(tur.type, tur.stars);
    tur.hp += newMax - tur.maxHp; tur.maxHp = newMax;
    gridError = '';
    if (window.SF && SF.HUD) SF.HUD.toast(TURRET_TYPES[tur.type].name + ' upgraded to ★' + tur.stars + '.');
    persistIfOwned(sst);
    return true;
  }

  function sellTurret(sys, name, pad) {
    var sst = stateFor(sys, name);
    if (!sst) { gridError = 'Station not found.'; return false; }
    var tur = turretAt(sst, pad);
    if (!tur) { gridError = 'Pad is empty.'; return false; }
    var refund = { credits: Math.floor(tur.invested.credits * GRID.sellRefund),
                   ore: Math.floor(tur.invested.ore * GRID.sellRefund) };
    sst.turrets.splice(sst.turrets.indexOf(tur), 1);
    SF.Player.credits += refund.credits; SF.Player.ore += refund.ore;
    var ms = maxShield(sst);
    if (sst.shield > ms) sst.shield = ms;
    gridError = '';
    if (window.SF && SF.HUD) SF.HUD.toast(TURRET_TYPES[tur.type].name + ' sold back ( +' +
      refund.credits.toLocaleString('en-US') + 'c' + (refund.ore ? ', +' + refund.ore + ' ore' : '') + ').');
    if (window.SF && SF.Audio && SF.Audio.sfx) SF.Audio.sfx('turret_buy');
    persistIfOwned(sst);
    return true;
  }

  function repairTurret(sys, name, pad) {
    var sst = stateFor(sys, name);
    if (!sst) { gridError = 'Station not found.'; return false; }
    var tur = turretAt(sst, pad);
    if (!tur) { gridError = 'Pad is empty.'; return false; }
    var missing = tur.maxHp - tur.hp;
    if (missing <= 0.5) { gridError = 'Turret already at full hull.'; return false; }
    var cost = Math.ceil(missing * GRID.repairPerHp);
    if (SF.Player.credits < cost) { gridError = 'Cannot afford (' + cost + 'c).'; return false; }
    SF.Player.credits -= cost;
    tur.hp = tur.maxHp;
    gridError = '';
    if (window.SF && SF.HUD) SF.HUD.toast(TURRET_TYPES[tur.type].name + ' repaired.');
    persistIfOwned(sst);
    return true;
  }

  function gridInfo(sys, name) {
    var sst = stateFor(sys, name);
    if (!sst) return null;
    return {
      sys: sst.sys, name: sst.name, kind: sst.kind, eligible: eligible(sst),
      pads: padsFor(sst.kind), power: powerBudget(sst.kind), powerUsed: powerUsed(sst),
      hull: Math.round(sst.hull), maxHull: sst.maxHull, offline: sst.offline,
      shield: Math.round(sst.shield), maxShield: maxShield(sst),
      turrets: sst.turrets.map(function (t) {
        return { type: t.type, stars: t.stars, pad: t.pad, hp: Math.round(t.hp), maxHp: t.maxHp,
          dmg: turretDmg(t), draw: turretDraw(t),
          invested: { credits: t.invested.credits, ore: t.invested.ore } };
      })
    };
  }

  /* Planet orbital slots — SCAFFOLDING ONLY (defense-grid-1 brief):
   * the slot model is shared with stations, but planets are held by NPC
   * factions and no player planet-control mechanic exists in code yet,
   * so buildable stays false until a claim/conquest phase lands. */
  function planetSlots(entry) {
    if (!entry) return null;
    var n = GRID.pads.planet, slots = [];
    for (var i = 0; i < n; i++) {
      var a = padAngle(i, n);
      slots.push({ pad: i, x: Math.round(entry.x + Math.cos(a) * GRID.planetRing),
                   y: Math.round(entry.y + Math.sin(a) * GRID.planetRing) });
    }
    return { name: entry.name, kind: 'planet', pads: n, power: GRID.power.planet,
      ring: GRID.planetRing, slots: slots, buildable: false,
      note: 'Orbital slots surveyed. Construction awaits a planet-control mechanic.' };
  }

  /* Owned-station persistence (save v12 `defense` blob, js/save.js).
   * Only the homebase grid is exported; NPC-station grids are session
   * state by design (brief decision). */
  function serializeDefense() {
    var hb = (window.SF && SF.Homebase) ? SF.Homebase.get() : null;
    if (!hb) return null;
    var sst = states[key(hb.systemId, hb.name)];
    if (!sst || sst.kind !== 'homebase') return null;
    return {
      v: 1, sys: sst.sys, name: sst.name,
      hull: Math.round(sst.hull), maxHull: sst.maxHull,
      offline: !!sst.offline, shield: Math.round(sst.shield),
      turrets: sst.turrets.map(function (t) {
        return { type: t.type, stars: t.stars, pad: t.pad, hp: Math.round(t.hp),
          invested: { credits: t.invested.credits, ore: t.invested.ore } };
      })
    };
  }

  function restoreDefense(blob) {
    if (!blob || blob.v !== 1 || !blob.sys || !blob.name) return false;
    var entry = null;
    if (window.SF && SF.Station) {
      SF.Station.allStations(blob.sys).forEach(function (s) {
        if (s.name === blob.name && s.kind === 'homebase') entry = s;
      });
    }
    if (!entry) return false;
    var sst = stState(blob.sys, entry);
    sst.maxHull = RC.stationHull;
    sst.hull = Math.max(0, Math.min(sst.maxHull, +blob.hull || 0));
    sst.offline = !!blob.offline;
    sst.turrets = [];
    var seenPad = {};
    (blob.turrets || []).forEach(function (b) {
      if (!b || !TURRET_TYPES[b.type]) return;
      var pad = b.pad | 0;
      if (pad < 0 || pad >= padsFor('homebase') || seenPad[pad]) return;
      seenPad[pad] = true;
      var stars = Math.max(1, Math.min(5, b.stars | 0 || 1));
      var maxHp = turretMaxHp(b.type, stars);
      sst.turrets.push({ type: b.type, stars: stars, pad: pad, t: Math.random() * 0.5,
        maxHp: maxHp, hp: Math.max(1, Math.min(maxHp, +b.hp || maxHp)),
        invested: { credits: Math.max(0, (b.invested && b.invested.credits) | 0),
                    ore: Math.max(0, (b.invested && b.invested.ore) | 0) } });
    });
    sst.shield = Math.max(0, Math.min(maxShield(sst), +blob.shield || 0));
    return true;
  }

  var Raids = {
    tuning: RC,
    tick: tick,
    onDock: onDock,
    damageStation: damageStation,
    stState: stState,
    drawTurrets: drawTurrets,
    turretSpriteForLvl: function (lvl) { return TURRET_SPRITE_BY_LVL[lvl] || 'laser'; },
    /* defense-grid-1 API */
    turretTypes: TURRET_TYPES,
    typeOrder: TYPE_ORDER,
    grid: GRID,
    installCost: installCost,
    upgradeCost: upgradeCost,
    costText: costText,
    gridError: function () { return gridError; },
    installTurret: installTurret,
    upgradeTurretPad: upgradeTurretPad,
    sellTurret: sellTurret,
    repairTurret: repairTurret,
    gridInfo: gridInfo,
    planetSlots: planetSlots,
    serializeDefense: serializeDefense,
    restoreDefense: restoreDefense,

    status: function () {
      if (!raid) return null;
      var sst = states[raid.key];
      return {
        sys: raid.sys, key: raid.key, name: raid.name, state: raid.state,
        wave: raid.wave, waves: raid.waves, kills: raid.kills,
        secsLeft: raid.state === 'warn'
          ? Math.max(0, Math.ceil((raid.warnUntil - Date.now()) / 1000)) : 0,
        hullPct: sst ? Math.max(0, Math.round(sst.hull / sst.maxHull * 100)) : 100
      };
    },

    isOffline: function (sys, name) {
      var sst = states[key(sys, name)];
      return !!(sst && sst.offline);
    },

    /* legacy wrappers (pre-grid callers): buyTurret installs a pulse
     * turret on the first free pad; upgradeTurret upgrades the idx-th
     * turret in array order. New code uses installTurret /
     * upgradeTurretPad with explicit pads and types. */
    buyTurret: function (sys, name) {
      var sst = stateFor(sys, name);
      if (!sst) return false;
      for (var pad = 0; pad < padsFor(sst.kind); pad++) {
        if (!turretAt(sst, pad)) return installTurret(sys, name, pad, 'pulse');
      }
      gridError = 'All pads occupied.';
      return false;
    },

    upgradeTurret: function (sys, name, idx) {
      var sst = states[key(sys, name)];
      if (!sst || !sst.turrets[idx]) return false;
      return upgradeTurretPad(sys, name, sst.turrets[idx].pad);
    },

    repairHull: function (sys, name) {
      var sst = states[key(sys, name)];
      if (!sst || sst.offline) return false;
      var missing = sst.maxHull - sst.hull;
      if (missing <= 0.5) return false;
      var cost = Math.ceil(missing * RC.stationRepairPerHp);
      if (SF.Player.credits < cost) return false;
      SF.Player.credits -= cost;
      sst.hull = sst.maxHull;
      if (window.SF && SF.HUD) SF.HUD.toast('Station hull restored.');
      return true;
    },

    repairFee: function (sys, name) {
      var sst = states[key(sys, name)];
      var maxH = sst ? sst.maxHull : RC.stationHull;
      return Math.ceil(maxH * RC.repairFeeMul);
    },

    payRepair: function (sys, name) {
      var sst = states[key(sys, name)];
      if (!sst || !sst.offline) return false;
      var fee = this.repairFee(sys, name);
      if (SF.Player.credits < fee) return false;
      SF.Player.credits -= fee;
      sst.offline = false;
      sst.hull = sst.maxHull;
      if (window.SF && SF.HUD) SF.HUD.toast('✓ ' + name + ' repaired — services restored.');
      if (window.SF && SF.News) SF.News.push('✓ ' + name + ' repaired and back in service.');
      if (window.SF && SF.Save) SF.Save.save();
      return true;
    },

    /* called from SF.Enemies.kill for raid enemies */
    onRaiderKilled: function (e) {
      if (!raid || !e.raidSt) return;
      if (e.raidSt.sys !== raid.sys || e.raidSt.name !== raid.name) return;
      raid.kills++;
      var fid = localFaction(raid.sys);
      if (fid && window.SF && SF.Factions) SF.Factions.shift(fid, RC.killStanding);
    },

    /* test hooks */
    debugTrigger: function (sys, name) {
      var found = null;
      SF.Station.allStations(sys).forEach(function (s) {
        if (s.name === name && eligible(s)) found = s;
      });
      if (!found) return false;
      if (stState(sys, found).offline) return false;
      cooldownUntil = 0;
      trigger(sys, found);
      return true;
    },
    debugSkipWarning: function () {
      if (raid && raid.state === 'warn') { raid.warnUntil = 0; return true; }
      return false;
    },
    debugCooldown: function (ms) { cooldownUntil = Date.now() + ms; }
  };

  SF.Raids = Raids;

  /* ---- SF.RaidBar: warning / raid progress bar (runtime DOM, BossBar pattern).
   * Driven from SF.Raids.tick (PLAYING only). Shown while a raid is live in
   * the current system. index.html is untouched (out of scope).
   *
   * hud-declutter-2 (2026-10-22): the bar had the boss bar's old disease —
   * z-index 9000 painted it over the SHIP LOST modal and every overlay,
   * and because Raids.tick only runs in PLAYING, a bar left visible at
   * death was never repainted away. Fixes, mirroring hud-declutter-1's
   * SF.BossBar treatment:
   *  - z-index 24: inside the HUD layer (overlays sit at z-50), so a
   *    modal always covers the bar even if it were somehow visible.
   *  - fixed slot: top calc(88px + safe-area) — the agreed raid slot in
   *    the center stack (reactor tabs 64-95 left/right of it, tracker at
   *    178, boss bar at 216). Compact rows (12px label / 10px sub / 8px
   *    track, 2px gaps) keep the whole bar ~88-126px tall, clear of the
   *    tracker slot by ~50px.
   *  - state hook: wraps SF.Game.setState and SF.HUD.showHud (guarded,
   *    deferred install — main.js and hud.js both load AFTER station.js;
   *    internal main.js transitions all funnel through showHud(false)
   *    for every non-PLAYING state) and hides the bar the moment the
   *    game leaves PLAYING, whichever door it leaves by. ---- */
  SF.RaidBar = (function () {
    var bar = null, fill = null, label = null, sub = null;
    var SLOT_TOP = 88;   // CSS px; agreed raid slot (see SF.HudDeclutter.slots)
    var Z_INDEX = 24;    // HUD layer (21-26 range); overlays are z-50

    function build() {
      if (bar) return;
      var css = document.createElement('style');
      css.id = 'raidbar-css';
      css.textContent =
        '#raid-bar{position:fixed;top:calc(88px + env(safe-area-inset-top));' +
        'left:50%;transform:translateX(-50%);' +
        'width:min(520px,70vw);z-index:24;pointer-events:none}' +
        '#raid-bar .rlabel{text-align:center;font:bold 12px monospace;color:#ffb3a3;' +
        'letter-spacing:2px;text-shadow:0 0 8px #000;margin-bottom:2px}' +
        '#raid-bar .rsub{text-align:center;font:10px monospace;color:#ffd23f;' +
        'text-shadow:0 0 8px #000;margin-bottom:2px}' +
        '#raid-bar .rtrack{height:8px;background:rgba(10,4,4,.75);' +
        'border:1px solid #ff5e3a;border-radius:4px;overflow:hidden}' +
        '#raid-bar .rfill{height:100%;width:100%;' +
        'background:linear-gradient(90deg,#39d5e8,#7df9ff);transform-origin:left center}';
      document.head.appendChild(css);
      bar = document.createElement('div');
      bar.id = 'raid-bar';
      bar.className = 'hidden';
      bar.innerHTML = '<div class="rlabel"></div><div class="rsub"></div>' +
        '<div class="rtrack"><div class="rfill"></div></div>';
      document.body.appendChild(bar);
      label = bar.querySelector('.rlabel');
      sub = bar.querySelector('.rsub');
      fill = bar.querySelector('.rfill');
    }

    function hideBar() { if (bar) bar.classList.add('hidden'); }

    /* State-transition hook (deferred, guarded, chain-safe: distinct
     * _raidDeclutterWrapped flags, so this composes with hud.js's
     * _drawerWrapped and hud-declutter-1's _declutterWrapped wraps in
     * any install order). */
    var gameWrapped = false, hudWrapped = false;
    function installStateHook() {
      if (window.SF && SF.Game && typeof SF.Game.setState === 'function' &&
          !SF.Game.setState._raidDeclutterWrapped && !gameWrapped) {
        var origState = SF.Game.setState;
        var wState = function (s) {
          var r = origState.apply(this, arguments);
          if (s !== 'PLAYING') hideBar();
          return r;
        };
        wState._raidDeclutterWrapped = true;
        SF.Game.setState = wState;
        gameWrapped = true;
      }
      if (window.SF && SF.HUD && typeof SF.HUD.showHud === 'function' &&
          !SF.HUD.showHud._raidDeclutterWrapped && !hudWrapped) {
        var origHud = SF.HUD.showHud;
        var wHud = function (v) {
          if (!v) hideBar();
          return origHud.apply(this, arguments);
        };
        wHud._raidDeclutterWrapped = true;
        SF.HUD.showHud = wHud;
        hudWrapped = true;
      }
      return gameWrapped && hudWrapped;
    }
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { installStateHook(); });
      } else { installStateHook(); }
    }
    if (typeof setInterval !== 'undefined') {
      var hookTries = 0;
      var hookIv = setInterval(function () {
        if (installStateHook() || ++hookTries > 40) clearInterval(hookIv);
      }, 500);
    }

    return {
      SLOT_TOP: SLOT_TOP,
      Z_INDEX: Z_INDEX,
      installStateHook: installStateHook,
      wrapped: function () { return { game: gameWrapped, hud: hudWrapped }; },
      isVisible: function () {
        build();
        return !bar.classList.contains('hidden');
      },
      rect: function () {
        build();
        if (bar.classList.contains('hidden')) return null;
        var r = bar.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right,
                 width: r.width, height: r.height };
      },
      update: function () {
        build();
        var rs = (window.SF && SF.Raids) ? SF.Raids.status() : null;
        if (!rs || SF.Game.state !== 'PLAYING' || SF.Game.systemId !== rs.sys) {
          bar.classList.add('hidden');
          return;
        }
        bar.classList.remove('hidden');
        var f = Math.max(0, Math.min(1, rs.hullPct / 100));
        fill.style.transform = 'scaleX(' + f.toFixed(3) + ')';
        if (rs.state === 'warn') {
          label.textContent = '⚠ RAID INBOUND — ' + rs.name;
          sub.textContent = 'raiders hit in ' + rs.secsLeft + 's — defend ' + rs.name + '!';
        } else {
          label.textContent = '⚠ RAID — ' + rs.name + ' — WAVE ' + rs.wave + '/' + rs.waves;
          sub.textContent = rs.kills + ' raiders destroyed · station hull ' + rs.hullPct + '%';
        }
      },
      hide: function () {
        build();
        bar.classList.add('hidden');
      }
    };
  })();
})();
/* ================= arena-mode phase (2026-10-19) =================
 * SF.Arena: combat gauntlets at Haven Dock.
 *
 * While docked at Haven Dock, the store shows a COMBAT ARENA section with
 * four league tiers (arena-leagues): BRONZE 5 / SILVER 10 / GOLD 15 waves,
 * buy-ins 500 / 2000 / 5000cr, plus OBSIDIAN: 20 waves + a boss round vs the
 * system's capital-ship boss (boss-encounters), buy-in 15000cr. Leagues
 * unlock in order: clearing a tier unlocks the next (tracked via the
 * leaderboard's fastestMs records — save-neutral, no save bump). Buying a
 * tier undocks the player into a cordoned arena zone near the station and
 * spawns escalating waves of remote-piloted combat hulls (real enemies via
 * SF.Enemies.spawn — enemies.js itself is untouched). The Obsidian boss is
 * spawned through SF.Bosses.spawnFor and tagged with the gauntlet gid, so
 * the kill-suppression wraps treat it as an arena kill: no real-boss drops,
 * no standing shifts, no 10-minute respawn timer, no news entry.
 *
 * Rules:
 *  - Waves scale with system danger (gameplay-depth difficulty tables).
 *  - Clear all waves: purse = buy-in x (1 + waves/2).
 *  - Death / forfeit: consolation = buy-in x 10% x waves cleared.
 *  - Arena kills are consequence-free: faction standing/karma shifts,
 *    quest/bounty kill hooks and ALL loot drops are suppressed for kills
 *    of arena-tagged enemies only (wraps on kill/pickups/boss-onKill,
 *    restored after).
 *  - Leaderboard in localStorage 'starfall_arena_v1' (best waves per tier,
 *    fastest clear, plus the OBSIDIAN CHAMPION record) — no save blob
 *    fields, SAVE_VERSION untouched.
 *  - RUNTIME-ONLY, SAVE-NEUTRAL. Driven from SF.Station.draw (the only
 *    per-frame hook inside this phase's js/station.js scope).
 *
 * Test hooks: SF.Arena.buy/info/active/abort/tiers/payoutFor/
 * consolationFor/leaderboard/killArena/isUnlocked/tierCleared.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var TIERS = [
    { name: 'BRONZE', waves: 5, buyin: 500 },
    { name: 'SILVER', waves: 10, buyin: 2000 },
    { name: 'GOLD', waves: 15, buyin: 5000 },
    { name: 'OBSIDIAN', waves: 20, buyin: 15000, boss: true }
  ];
  var LEAGUE_COLORS = {
    BRONZE: '#cd7f32', SILVER: '#c0c0c0', GOLD: '#ffd700', OBSIDIAN: '#9d4edd'
  };
  var BREATHER_S = 4;      // breather between waves, in game seconds
  var ARENA_DIST = 1500;   // arena center offset from the station (px)
  var ARENA_R = 750;       // cordon radius (px)
  var MAX_WAVE_SIZE = 14;
  var DANGER = { solace: 0, drift: 1, ember: 2 };
  var LS_KEY = 'starfall_arena_v1';

  var gauntlet = null; // {gid,tierIdx,waves,buyin,wave,state,sys,cx,cy,t0,breatherUntil}
  var seq = 0;
  var orig = null; // installed suppression wraps

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }
  function dangerIdx(sys) { return DANGER[sys] || 0; }

  function payoutFor(t) { var T = TIERS[t]; return T.buyin * (1 + T.waves / 2); }
  function consolationFor(t, wavesCleared) {
    return Math.floor(TIERS[t].buyin * 0.1 * wavesCleared);
  }

  /* ---------- leaderboard: localStorage only, save-neutral ---------- */
  function loadBoard() {
    try {
      var b = JSON.parse(localStorage.getItem(LS_KEY));
      if (b && b.tiers) return b;
    } catch (e) { /* corrupted board: start fresh */ }
    return { tiers: {} };
  }
  function saveBoard(b) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(b)); } catch (e) { /* ignore */ }
  }
  function recordResult(tierIdx, wavesCleared, cleared, ms) {
    if (!cleared && wavesCleared <= 0) return loadBoard(); // nothing worth recording
    var b = loadBoard(), k = String(TIERS[tierIdx].waves);
    var rec = b.tiers[k] || { best: 0, fastestMs: null };
    if (wavesCleared > rec.best) rec.best = wavesCleared;
    if (cleared && (rec.fastestMs === null || ms < rec.fastestMs)) rec.fastestMs = ms;
    b.tiers[k] = rec;
    saveBoard(b);
    return b;
  }
  function fmtTime(ms) {
    if (ms === null || ms === undefined) return '—';
    var s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  /* ---------- league unlocks: clear a tier to unlock the next ----------
   * A tier counts as cleared when the leaderboard holds a fastestMs for it
   * (recordResult only writes fastestMs on a full clear). Bronze (tier 0)
   * is always open. Save-neutral: derived from localStorage, no save fields. */
  function tierCleared(i) {
    var rec = loadBoard().tiers[String(TIERS[i].waves)];
    return !!(rec && rec.fastestMs !== null && rec.fastestMs !== undefined);
  }
  function isUnlocked(i) { return i <= 0 || tierCleared(i - 1); }

  /* ---------- kill-suppression wraps (arena kills only) ----------
   * installWraps swaps the shared kill path while a gauntlet runs:
   * SF.Enemies.kill sets SF.Arena.killArena for the duration of one kill,
   * and the Factions/Quests/Bounty/Pickups hooks no-op while it is set.
   * Non-arena kills during a gauntlet behave exactly as normal. All
   * originals are restored by removeWraps(). */
  function installWraps() {
    if (orig) return;
    var A = SF.Arena;
    orig = {
      kill: SF.Enemies.kill,
      act: (window.SF && SF.Factions) ? SF.Factions.act : null,
      qKill: (window.SF && SF.Quests) ? SF.Quests.onKill : null,
      bKill: (window.SF && SF.Bounty) ? SF.Bounty.onKill : null,
      bossKill: (window.SF && SF.Bosses) ? SF.Bosses.onKill : null,
      pCredits: SF.Pickups.spawnCredits,
      pOre: SF.Pickups.spawnOre,
      pItem: SF.Pickups.spawnItem,
      pPart: SF.Pickups.spawnPart,
      pWeapon: SF.Pickups.spawnWeapon,
      pMod: SF.Pickups.spawnMod
    };
    SF.Enemies.kill = function (e) {
      var prev = A.killArena;
      A.killArena = !!(e && e.arena);
      try { return orig.kill.call(SF.Enemies, e); }
      finally { A.killArena = prev; }
    };
    if (orig.act) SF.Factions.act = function (kind, fid) {
      if (A.killArena && (kind === 'killPirate' || kind === 'destroyPatrol')) return;
      return orig.act.call(SF.Factions, kind, fid);
    };
    if (orig.qKill) SF.Quests.onKill = function (e) {
      if (A.killArena) return;
      return orig.qKill.call(SF.Quests, e);
    };
    if (orig.bKill) SF.Bounty.onKill = function (e) {
      if (A.killArena) return;
      return orig.bKill.call(SF.Bounty, e);
    };
    if (orig.bossKill) SF.Bosses.onKill = function (e) {
      // arena-leagues: the Obsidian boss round. An arena-tagged boss kill is
      // spectacle only — the real boss's drops, standing shifts, 10-minute
      // no-respawn timer and news entry must NOT fire for a remote-piloted hull.
      if (A.killArena && e && gauntlet && e.arena === gauntlet.gid) {
        if (window.SF && SF.Particles) SF.Particles.explosion(e.x, e.y, 3.0);
        if (window.SF && SF.FX) SF.FX.shake(16);
        if (window.SF && SF.Audio) SF.Audio.explosion(true);
        if (window.SF && SF.HUD) SF.HUD.toast('\u{1F480} ARENA BOSS DOWN — the crowd goes wild!');
        return;
      }
      return orig.bossKill.call(SF.Bosses, e);
    };
    function lootGate(fn) {
      if (typeof fn !== 'function') return fn;
      return function () {
        if (A.killArena) return;
        return fn.apply(SF.Pickups, arguments);
      };
    }
    SF.Pickups.spawnCredits = lootGate(orig.pCredits);
    SF.Pickups.spawnOre = lootGate(orig.pOre);
    SF.Pickups.spawnItem = lootGate(orig.pItem);
    SF.Pickups.spawnPart = lootGate(orig.pPart);
    SF.Pickups.spawnWeapon = lootGate(orig.pWeapon);
    SF.Pickups.spawnMod = lootGate(orig.pMod);
  }

  function removeWraps() {
    if (!orig) return;
    SF.Enemies.kill = orig.kill;
    if (orig.act) SF.Factions.act = orig.act;
    if (orig.qKill) SF.Quests.onKill = orig.qKill;
    if (orig.bKill) SF.Bounty.onKill = orig.bKill;
    if (orig.bossKill) SF.Bosses.onKill = orig.bossKill;
    SF.Pickups.spawnCredits = orig.pCredits;
    SF.Pickups.spawnOre = orig.pOre;
    SF.Pickups.spawnItem = orig.pItem;
    SF.Pickups.spawnPart = orig.pPart;
    SF.Pickups.spawnWeapon = orig.pWeapon;
    SF.Pickups.spawnMod = orig.pMod;
    orig = null;
    SF.Arena.killArena = false;
  }

  /* ---------- wave spawning (gameplay-depth danger tables) ---------- */
  function pickType(danger) {
    var r = Math.random();
    if (danger <= 0) return r < 0.7 ? 'raider' : 'drone';
    if (danger === 1) return r < 0.6 ? 'raider' : (r < 0.85 ? 'drone' : 'gunship');
    return r < 0.5 ? 'raider' : 'gunship';
  }

  function spawnWave() {
    var g = gauntlet;
    var danger = dangerIdx(g.sys);
    var sys = SF.SYSTEM_BY_ID[g.sys];
    var mul = sys ? sys.enemyMul : 1;
    var n = Math.min(MAX_WAVE_SIZE, 3 + (g.wave - 1) + danger);
    var ws = SF.CONFIG.worldSize;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var d = 420 + Math.random() * 160;
      var x = Math.max(60, Math.min(ws - 60, g.cx + Math.cos(a) * d));
      var y = Math.max(60, Math.min(ws - 60, g.cy + Math.sin(a) * d));
      var e = SF.Enemies.spawn(pickType(danger), x, y, mul);
      e.arena = g.gid;
      // arena hulls are remote-piloted: no crew, never adrift or boardable
      e.automated = true;
      e.crew = 0;
    }
    if (window.SF && SF.HUD) SF.HUD.toast('⚔ WAVE ' + g.wave + '/' + g.waves +
      ' — ' + n + ' hostiles inbound!');
    if (window.SF && SF.Audio && SF.Audio.alert) SF.Audio.alert();
    // arena-announcer-voice-wiring-retry: round calls — wave 1 delayed 2.6s so
    // the buy intro lands first (gid-guarded), halfway + final wave immediate.
    if (window.SF && SF.ArenaVoice) {
      (function (gid, wave, waves) {
        var id = SF.ArenaVoice.roundLine(wave, waves);
        if (!id) return;
        if (wave === 1) {
          setTimeout(function () {
            if (gauntlet && gauntlet.gid === gid && window.SF && SF.ArenaVoice)
              SF.ArenaVoice.play(id);
          }, 2600);
        } else {
          SF.ArenaVoice.play(id);
        }
      })(g.gid, g.wave, g.waves);
    }
  }

  /* ---------- Obsidian boss round (arena-leagues) ----------
   * After the 20th wave of an Obsidian gauntlet, the league fields the
   * system's capital-ship boss (boss-encounters) as a remote-piloted hull.
   * Spawned through the existing SF.Bosses.spawnFor hook and tagged with the
   * gauntlet gid so the kill-suppression wraps treat it as an arena kill:
   * no real-boss drops, no standing shifts, no respawn timer. */
  function spawnBossRound() {
    var g = gauntlet;
    var b = null;
    try {
      if (window.SF && SF.Bosses && SF.Bosses.spawnFor)
        b = SF.Bosses.spawnFor(g.sys, g.cx, g.cy - 260);
    } catch (e) { b = null; }
    if (!b) { settle(true); return; } // no boss module: the 20 waves are the clear
    b.arena = g.gid;
    b.automated = true; // remote-piloted: nothing to board (also the spawn default)
    b.crew = 0;
    var nm = (b.bossDef && (b.bossDef.title || b.bossDef.name)) || 'capital ship';
    if (window.SF && SF.HUD) SF.HUD.toast('\u{1F480} OBSIDIAN BOSS — ' + nm + ' — kill it!');
    if (window.SF && SF.Audio && SF.Audio.alert) SF.Audio.alert();
    if (window.SF && SF.Audio && SF.Audio.sfx) SF.Audio.sfx('boss_phase_shift_1');
  }

  function arenaCenter(st) {
    var ws = SF.CONFIG.worldSize;
    var cx = st.x + ARENA_DIST, cy = st.y;
    if (cx > ws - 900) cx = st.x - ARENA_DIST; // station near the east edge
    cx = Math.max(900, Math.min(ws - 900, cx));
    cy = Math.max(900, Math.min(ws - 900, cy));
    return { x: cx, y: cy };
  }

  /* ---------- gauntlet lifecycle ---------- */
  function buy(tierIdx) {
    tierIdx = tierIdx | 0;
    if (tierIdx < 0 || tierIdx >= TIERS.length) return false;
    if (gauntlet) { if (window.SF && SF.Audio) SF.Audio.deny(); return false; }
    if (!SF.Game || SF.Game.state !== 'DOCKED') return false;
    // arena-leagues: leagues unlock in order — clear a tier to open the next
    if (!isUnlocked(tierIdx)) { if (window.SF && SF.Audio) SF.Audio.deny(); return false; }
    var T = TIERS[tierIdx], p = SF.Player;
    if (p.credits < T.buyin) { if (window.SF && SF.Audio) SF.Audio.deny(); return false; }
    var st = SF.Station.getStation(SF.Game.systemId);
    if (!st) return false;
    p.credits -= T.buyin;
    if (window.SF && SF.Save) SF.Save.save();
    var c = arenaCenter(st);
    gauntlet = {
      gid: ++seq, tierIdx: tierIdx, waves: T.waves, buyin: T.buyin,
      wave: 1, state: 'fight', sys: SF.Game.systemId,
      cx: c.x, cy: c.y, t0: Date.now(), breatherUntil: 0,
      bossTier: !!T.boss, bossSpawned: false
    };
    installWraps();
    SF.Station.undock(); // onUndock hooks run, state -> PLAYING
    p.x = c.x; p.y = c.y; p.vx = 0; p.vy = 0;
    spawnWave();
    if (window.SF && SF.HUD) SF.HUD.toast('⚔ ' + T.name + ' GAUNTLET — ' + T.waves + ' waves · buy-in ' +
      fmt(T.buyin) + 'c · purse ' + fmt(payoutFor(tierIdx)) + 'c on clear' +
      (T.boss ? ' · \u{1F480} boss round' : ''));
    if (window.SF && SF.Audio && SF.Audio.sfx) { SF.Audio.sfx('arena_crowd'); SF.Audio.sfx('arena_horn'); }
    // arena-announcer-voice-wiring-retry: league-flavored announcer intro on buy
    if (window.SF && SF.ArenaVoice)
      SF.ArenaVoice.play(SF.ArenaVoice.introLine(tierIdx));
    return true;
  }

  function arenaAlive() {
    if (!gauntlet) return 0;
    var n = 0, l = SF.Enemies.list;
    for (var i = 0; i < l.length; i++) if (l[i].arena === gauntlet.gid) n++;
    return n;
  }

  function clearArenaEnemies() {
    var l = SF.Enemies.list, g = gauntlet;
    for (var i = l.length - 1; i >= 0; i--) if (l[i].arena === g.gid) l.splice(i, 1);
  }

  /* settle(cleared, why): victory pays the purse; death/forfeit pays consolation
   * for fully-cleared waves. Always restores wraps and clears the field.
   * `why` (arena-announcer-voice-wiring-retry): 'forfeit' | 'death' | 'jump' |
   * undefined — picks the defeat line; internal only, public API unchanged. */
  function settle(cleared, why) {
    var g = gauntlet;
    if (!g) return null;
    var wavesCleared = cleared ? g.waves : Math.max(0, g.wave - 1);
    var ms = Date.now() - g.t0;
    var delta, msg, newRecord = false;
    if (cleared) {
      delta = payoutFor(g.tierIdx);
      SF.Player.credits += delta;
      msg = '🏆 ' + TIERS[g.tierIdx].name + ' GAUNTLET CLEAR — +' + fmt(delta) + 'c purse!';
      // arena-leagues: clearing Obsidian crowns the champion (localStorage,
      // save-neutral). Fastest champion clear is the title line's record.
      if (TIERS[g.tierIdx].boss) {
        var cb = loadBoard();
        newRecord = !cb.champion || ms < cb.champion.ms;
        if (newRecord) cb.champion = { ms: ms, at: Date.now() };
        saveBoard(cb);
        msg += ' 👑 OBSIDIAN CHAMPION!';
      }
    } else {
      delta = consolationFor(g.tierIdx, wavesCleared);
      if (delta > 0) SF.Player.credits += delta;
      msg = '⚔ Gauntlet over — reached wave ' + g.wave + '/' + g.waves +
        (delta > 0 ? ' · consolation +' + fmt(delta) + 'c' : ' · no consolation');
    }
    // arena-announcer-voice-wiring-retry: champion victory for Obsidian clears
    // (a new fastest-clear record gets the record line), defeat lines for
    // forfeit/death; a system jump ends silently.
    if (window.SF && SF.ArenaVoice) {
      if (cleared) {
        SF.ArenaVoice.play((TIERS[g.tierIdx].boss && newRecord) ?
          'arena_announcer_08' : 'arena_announcer_06');
      } else if (why === 'forfeit') {
        SF.ArenaVoice.play('arena_announcer_09');
      } else if (why === 'death') {
        SF.ArenaVoice.play('arena_announcer_07');
      }
    }
    recordResult(g.tierIdx, wavesCleared, cleared, ms);
    clearArenaEnemies();
    removeWraps();
    gauntlet = null;
    if (window.SF && SF.HUD) SF.HUD.toast(msg);
    if (window.SF && SF.News) SF.News.push(msg + ' (' + TIERS[g.tierIdx].name +
      ' league, ' + TIERS[g.tierIdx].waves + '-wave gauntlet at Haven Dock)');
    if (window.SF && SF.Audio && cleared && SF.Audio.buy) SF.Audio.buy();
    if (window.SF && SF.Audio && cleared && SF.Audio.sfx) SF.Audio.sfx('arena_win');
    if (window.SF && SF.Save) SF.Save.save();
    return { cleared: cleared, wavesCleared: wavesCleared, delta: delta, ms: ms };
  }

  /* Per-frame driver — called from SF.Station.draw (the per-frame hook in
   * this phase's scope). Uses the game clock so pause/hidden freezes it. */
  function tick(time) {
    if (!gauntlet) return;
    var g = gauntlet;
    // system jump (enterSystem clears the field) mid-gauntlet: forfeit
    if (g.sys !== SF.Game.systemId) { settle(false, 'jump'); return; }
    // player death settles consolation at the GAMEOVER screen, before respawn
    if (SF.Game.state === 'GAMEOVER') { settle(false, 'death'); return; }
    if (SF.Game.state !== 'PLAYING') return;
    var p = SF.Player;
    // cordon: soft wall at ARENA_R (+40px grace), kills outward velocity
    var dx = p.x - g.cx, dy = p.y - g.cy;
    var d = Math.sqrt(dx * dx + dy * dy), maxD = ARENA_R + 40;
    if (d > maxD) {
      var s = maxD / d;
      p.x = g.cx + dx * s; p.y = g.cy + dy * s;
      var nx = dx / d, ny = dy / d, dot = p.vx * nx + p.vy * ny;
      if (dot > 0) { p.vx -= nx * dot; p.vy -= ny * dot; }
      if (window.SF && SF.HUD) SF.HUD.toast('⚔ The cordon holds — stay in the arena!');
    }
    if (g.state === 'breather') {
      if (time >= g.breatherUntil) {
        g.wave++; g.state = 'fight';
        spawnWave();
      }
      return;
    }
    if (arenaAlive() === 0) {
      if (g.state === 'boss') { settle(true); return; } // boss killed -> clear
      if (g.wave >= g.waves) {
        // arena-leagues: Obsidian ends with a boss round, not a settle
        if (g.bossTier && !g.bossSpawned) {
          g.bossSpawned = true; g.state = 'boss'; spawnBossRound(); return;
        }
        settle(true); return;
      }
      else { g.state = 'breather'; g.breatherUntil = time + BREATHER_S; }
    }
  }

  /* Cordon ring + wave banner, drawn in world space by SF.Station.draw. */
  function drawZone(ctx) {
    var g = gauntlet;
    if (!g || g.sys !== SF.Game.systemId) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,157,94,0.55)';
    ctx.setLineDash([18, 12]);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(g.cx, g.cy, ARENA_R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ff9d5e';
    var n = arenaAlive();
    var label = g.state === 'boss'
      ? '\u{1F480} BOSS ROUND — kill it!'
      : g.state === 'breather'
      ? '⚔ NEXT WAVE INCOMING'
      : '⚔ WAVE ' + g.wave + '/' + g.waves + ' · ' + n + ' HOSTILE' + (n === 1 ? '' : 'S');
    // status rides above the player (always on screen); the ring marks the cordon
    var px = SF.Player.x, py = SF.Player.y;
    ctx.fillText(label, px, py - 110);
    ctx.restore();
  }

  /* ---------- store UI: COMBAT ARENA section (Haven Dock only) ----------
   * arena-leagues: each tier gets a league banner (name + color), locked
   * tiers show their unlock condition, and an Obsidian champion title line
   * appears once the boss round has been cleared. */
  function renderSection(body, curSt) {
    if (!curSt || curSt.kind !== 'dock' || curSt.name !== 'Haven Dock') return;
    var p = SF.Player;
    var sec = document.createElement('div');
    sec.id = 'arena-section';
    var h = document.createElement('div');
    h.className = 'store-head'; h.textContent = '⚔ COMBAT ARENA';
    sec.appendChild(h);
    var note = document.createElement('div');
    note.className = 'dim'; note.style.marginBottom = '4px';
    note.textContent = 'Remote-piloted combat hulls in a cordoned zone near the dock. ' +
      'No standing changes, no loot — just the purse. Clear a league to unlock the next.';
    sec.appendChild(note);
    var board = loadBoard();
    // champion title line
    if (board.champion && board.champion.ms) {
      var ch = document.createElement('div');
      ch.className = 'store-desc'; ch.style.marginBottom = '4px';
      ch.style.color = '#ffd700'; ch.style.fontWeight = 'bold';
      ch.textContent = '👑 OBSIDIAN CHAMPION — best clear ' + fmtTime(board.champion.ms);
      sec.appendChild(ch);
    }
    var bl = document.createElement('div');
    bl.className = 'store-desc'; bl.style.marginBottom = '4px';
    var bits = TIERS.map(function (T, i) {
      var rec = board.tiers[String(T.waves)];
      return T.name + ': ' + (rec
        ? ('best ' + rec.best + '/' + T.waves + ' · ⏱ ' + fmtTime(rec.fastestMs))
        : '—');
    });
    bl.innerHTML = '🏅 Records — ' + bits.join(' &nbsp;·&nbsp; ');
    sec.appendChild(bl);
    TIERS.forEach(function (T, i) {
      // league banner
      var banner = document.createElement('div');
      banner.className = 'store-desc';
      banner.style.margin = '6px 0 2px 0';
      banner.style.fontWeight = 'bold';
      banner.style.color = LEAGUE_COLORS[T.name] || '#fff';
      banner.textContent = (T.boss ? '\u{1F480} ' : '⚔ ') + T.name + ' LEAGUE' +
        (T.boss ? ' — 20 WAVES + BOSS ROUND' : '');
      sec.appendChild(banner);
      var div = document.createElement('div');
      div.className = 'store-row';
      var info = document.createElement('div');
      info.className = 'store-info';
      info.innerHTML = '<div><div class="store-name">' + T.name + ' GAUNTLET · ' + T.waves + ' WAVES</div>' +
        '<div class="store-desc">Buy-in ' + fmt(T.buyin) + 'c · purse ' + fmt(payoutFor(i)) +
        'c on clear · consolation ' + fmt(Math.floor(T.buyin * 0.1)) + 'c per wave cleared</div></div>';
      div.appendChild(info);
      var btn = document.createElement('button');
      btn.className = 'btn store-btn';
      btn.id = 'arena-enter-' + i;
      var unlocked = isUnlocked(i);
      if (!unlocked) {
        btn.disabled = true;
        btn.textContent = '🔒 CLEAR ' + TIERS[i - 1].name;
        btn.title = 'Clear the ' + TIERS[i - 1].name + ' league to unlock';
        btn.addEventListener('click', function () { if (window.SF && SF.Audio) SF.Audio.deny(); });
      } else if (p.credits < T.buyin) {
        btn.disabled = true;
        btn.textContent = 'ENTER · ' + fmt(T.buyin) + 'c';
        btn.addEventListener('click', function () { if (window.SF && SF.Audio) SF.Audio.deny(); });
      } else {
        btn.textContent = 'ENTER · ' + fmt(T.buyin) + 'c';
        btn.addEventListener('click', function () {
          if (buy(i)) { if (window.SF && SF.Audio) SF.Audio.buy(); }
          else if (window.SF && SF.Audio) SF.Audio.deny();
        });
      }
      div.appendChild(btn);
      sec.appendChild(div);
    });
    body.appendChild(sec);
  }

  SF.Arena = {
    killArena: false, // wrap flag: the kill() currently running is an arena kill
    tiers: TIERS,
    buy: buy,
    active: function () { return !!gauntlet; },
    payoutFor: payoutFor,
    consolationFor: consolationFor,
    leaderboard: loadBoard,
    renderSection: renderSection,
    tick: tick,
    drawZone: drawZone,
    isUnlocked: isUnlocked, // arena-leagues: league unlock rule
    tierCleared: tierCleared,
    info: function () { // test/debug
      if (!gauntlet) return null;
      return {
        gid: gauntlet.gid, tier: gauntlet.tierIdx, waves: gauntlet.waves,
        wave: gauntlet.wave, state: gauntlet.state, alive: arenaAlive(),
        cx: gauntlet.cx, cy: gauntlet.cy,
        bossTier: !!gauntlet.bossTier, bossSpawned: !!gauntlet.bossSpawned
      };
    },
    abort: function () { return settle(false, 'forfeit'); } // test/debug forfeit
  };
})();
/* ============================================================
 * arena-announcer-voice-wiring-retry (2026-10-21): SF.ArenaVoice
 *
 * Wires voice-pack-4's arena announcer lines into the gauntlet lifecycle
 * (ids + durations per phases/voice-pack-4/VOICE-MANIFEST-4.md,
 * transcripts from phases/voice-pack-4/gen/lines.csv):
 *  - gauntlet start (buy): league-flavored intro — _01 BRONZE,
 *    _02 SILVER/GOLD, _10 OBSIDIAN
 *  - round calls (spawnWave): wave 1 -> _03, halfway -> _04,
 *    final wave -> _05
 *  - settle: clear -> _06 (champion), Obsidian + new fastest-clear
 *    record -> _08; forfeit -> _09, death -> _07; system jump silent
 *
 * Playback: guarded SF.Audio.voice(id) + a subtitle caption on this
 * phase's OWN element (#sf-arena-voice-caption, data-sf-voice-caption).
 * Never throws. Save-neutral: no persisted state, no SF.SAVE_VERSION bump.
 *
 * Public surface: SF.ArenaVoice { play, introLine, roundLine, ids }.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.__arenaVoiceWiring) return; // no double install
  SF.__arenaVoiceWiring = true;

  var SPK = 'ARENA ANNOUNCER', COLOR = '#ffd94a';
  // id -> {spk, color, dur (s from VOICE-MANIFEST-4.md), text (from gen/lines.csv)}
  var LINES = {
    arena_announcer_01: { spk: SPK, color: COLOR, dur: 26.7, text: 'Welcome, pilots, to the Haven Dock Combat Arena! Place your bets, or better yet, your hulls!' },
    arena_announcer_02: { spk: SPK, color: COLOR, dur: 35.9, text: 'The gauntlet begins! Three waves of remote-piloted combat hulls. Survive them all and the purse is yours!' },
    arena_announcer_03: { spk: SPK, color: COLOR, dur: 24.8, text: 'Wave one! They are fast, they are automated, and they do not miss twice!' },
    arena_announcer_04: { spk: SPK, color: COLOR, dur: 25.0, text: 'Halfway there! The hulls are getting meaner. Show them what a real pilot looks like!' },
    arena_announcer_05: { spk: SPK, color: COLOR, dur: 24.2, text: 'Final wave! One more stand between you and a fortune. Make it count!' },
    arena_announcer_06: { spk: SPK, color: COLOR, dur: 27.6, text: 'Gauntlet complete! A champion is crowned! The crowd roars your name, pilot!' },
    arena_announcer_07: { spk: SPK, color: COLOR, dur: 29.1, text: 'Hull down! The arena claims another one. Medics to the field, scavengers to the wreckage!' },
    arena_announcer_08: { spk: SPK, color: COLOR, dur: 35.2, text: 'A new record! Fastest clear we have ever seen. Somebody check that pilot for aftermarket reflexes!' },
    arena_announcer_09: { spk: SPK, color: COLOR, dur: 34.3, text: 'Forfeit! The pilot stands down. Consolation credits, a round of drinks, and no shame in surviving!' },
    arena_announcer_10: { spk: SPK, color: COLOR, dur: 32.4, text: 'Five-wave gauntlet, best seats in the Drift! Ten and fifteen waves for the brave, the rich, or the soon-to-be-dead!' }
  };
  var IDS = [];
  for (var k in LINES) if (LINES.hasOwnProperty(k)) IDS.push(k);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var capTimer = null;
  function caption(id) {
    var L = LINES[id];
    if (!L || typeof document === 'undefined') return;
    var el = document.getElementById('sf-arena-voice-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sf-arena-voice-caption';
      el.setAttribute('data-sf-voice-caption', 'arena');
      el.style.cssText = 'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);' +
        'max-width:82%;padding:8px 16px;background:rgba(5,8,16,0.85);' +
        'border:1px solid #ffd94a;border-radius:8px;color:#fff;' +
        'font:14px/1.35 sans-serif;text-align:center;pointer-events:none;z-index:9000;display:none;';
      if (!document.body) return;
      document.body.appendChild(el);
    }
    el.setAttribute('data-sf-voice-line', id);
    el.innerHTML = '<span style="color:' + L.color + ';font-weight:bold">' +
      esc(L.spk) + '</span><br>' + esc(L.text);
    el.style.display = 'block';
    if (capTimer) { try { clearTimeout(capTimer); } catch (e) {} }
    var ms = Math.round((L.dur || 3) * 1000);
    capTimer = setTimeout(function () { try { el.style.display = 'none'; } catch (e) {} }, ms);
  }

  /* Guarded voice call: audio is a bonus, captions always show. */
  function play(id) {
    if (!LINES[id]) return false;
    if (window.SF && SF.Audio && SF.Audio.voice) {
      try { SF.Audio.voice(id); } catch (e) {}
    }
    try { caption(id); } catch (e) {}
    return true;
  }

  /* League-flavored intro for a gauntlet buy (tierIdx: 0 BRONZE .. 3 OBSIDIAN). */
  function introLine(tierIdx) {
    tierIdx = tierIdx | 0;
    if (tierIdx >= 3) return 'arena_announcer_10';
    if (tierIdx >= 1) return 'arena_announcer_02';
    return 'arena_announcer_01';
  }

  /* Round call for wave spawn; null when no line fits this wave. */
  function roundLine(wave, waves) {
    wave = wave | 0; waves = waves | 0;
    if (wave === 1) return 'arena_announcer_03';
    if (waves > 0 && wave === waves) return 'arena_announcer_05';
    if (waves > 0 && wave === Math.ceil(waves / 2)) return 'arena_announcer_04';
    return null;
  }

  SF.ArenaVoice = { play: play, introLine: introLine, roundLine: roundLine, ids: IDS };
})();

/* ============================================================
 * station-sprites-4-wiring (2026-10-21): SF.StationViews
 *
 * Wires station-sprites-4's 4 landmark sprites into thin station views
 * via SF.Sprites.get('stations', id) with the canvas-drawn fallback
 * intact (fallback = a procedurally drawn canvas panel; never assume
 * the sprite is decoded).
 *
 *  salvage_yard -> scrapyard: sell spare parts at a 75% premium
 *     (workbench pays 40%); components at the standard station rate.
 *  prison_hulk  -> prison: bounty board + +3 standing with the local
 *     faction on every collected bounty (wrap on SF.Bounty.turnIn, only
 *     when docked at the prison hulk).
 *  casino_spire -> casino: double-or-nothing wagering, 47% win chance,
 *     losses capped at 2000cr per visit (in-memory ledger, save-neutral).
 *  memorial_beacon -> memorial: fallen-pilots honor roll from SF.Legacy
 *     (wrecks/deaths); a static roll when no pilot has died yet.
 *
 * Save-neutral: no save fields added, no version bump (v11 stays).
 * The specialty stations themselves are registered in SF.Station's
 * allStations() (SPECIAL_LAYOUT) at fixed offsets from the system
 * station. Views are thin: sprite backdrop + one core interaction.
 * ============================================================ */
SF.StationViews = (function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var SPECIAL = {
    scrapyard: { sprite: 'salvage_yard',   tint: '#8fd18f' },
    prison:    { sprite: 'prison_hulk',     tint: '#b45cff' },
    casino:    { sprite: 'casino_spire',    tint: '#ffd23f' },
    memorial:  { sprite: 'memorial_beacon', tint: '#9db8d8' }
  };
  var SCRAP_RATE = 0.75;  // vs the workbench's 40%
  var PRISON_STANDING_BONUS = 3;
  var CASINO_LOSS_CAP = 2000, CASINO_WIN_P = 0.47;
  var BETS = [25, 50, 100, 250, 500];

  var visit = { lost: 0, won: 0, plays: 0, bet: 50, lastResult: null }; // casino ledger, per dock
  var candles = 0; // memorial: candles lit this session

  var VIEW_META = {
    scrapyard: { title: '⚙ RUSTBONE SCRAPYARD',
      sub: 'Spare parts bought at 75% of value — the workbench only pays 40%.' },
    prison: { title: '⛓ IRONSIDE PRISON HULK',
      sub: 'Bounty turn-in desk. Every collected bounty pays +' +
        PRISON_STANDING_BONUS + ' standing with the local faction.' },
    casino: { title: '🪙 GILT SPIRE CASINO',
      sub: 'Double-or-nothing. Losses capped at ' + fmt(CASINO_LOSS_CAP) + 'cr per visit.' },
    memorial: { title: '🕯 BEACON OF THE FALLEN',
      sub: 'They flew so others could dock.' }
  };

  /* ---- minimal styles (kept in js/station.js scope; no css/ edits) ---- */
  var _styled = false;
  function ensureStyle() {
    if (_styled || !document.head) return;
    _styled = true;
    var st = document.createElement('style');
    st.textContent =
      '.station-sprite-view{margin:0 0 10px;border:1px solid #2a3a55;background:#0b1220;}' +
      '.station-sprite-art{position:relative;height:150px;overflow:hidden;background:#05080f;}' +
      '.station-sprite-art img{height:150px;display:block;margin:0 auto;}' +
      '.station-sprite-fallback{display:block;width:100%;height:150px;}' +
      '.station-sprite-title{position:absolute;left:0;right:0;bottom:0;padding:22px 12px 8px;' +
      'background:linear-gradient(transparent,rgba(3,6,12,.92));}' +
      '.station-sprite-title .t{font:bold 18px monospace;letter-spacing:3px;}' +
      '.station-sprite-title .s{font:11px monospace;color:#8fa3bf;margin-top:2px;}';
    document.head.appendChild(st);
  }

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

  /* Backdrop: decoded sprite when available, canvas-drawn fallback when not.
   * Never assumes SF.Sprites.get returns non-null. Returns the view root;
   * all view content must be appended to it (keeps the view self-contained). */
  function backdrop(body, kind) {
    ensureStyle();
    var spec = SPECIAL[kind], meta = VIEW_META[kind];
    var wrap = document.createElement('div');
    wrap.className = 'station-sprite-view';
    wrap.id = 'station-view-' + kind;
    var art = document.createElement('div');
    art.className = 'station-sprite-art';
    var img = (window.SF && SF.Sprites) ? SF.Sprites.get('stations', spec.sprite) : null;
    if (img && img.naturalWidth > 0) {
      var el = document.createElement('img');
      el.src = img.src; el.alt = meta.title;
      el.className = 'station-sprite-img';
      art.appendChild(el);
    } else {
      // canvas-drawn fallback: procedural emblem in the station's tint
      var cv = document.createElement('canvas');
      cv.width = 640; cv.height = 150;
      cv.className = 'station-sprite-fallback';
      var cx = cv.getContext('2d');
      var g = cx.createLinearGradient(0, 0, 0, 150);
      g.addColorStop(0, '#0a1020'); g.addColorStop(1, '#05080f');
      cx.fillStyle = g; cx.fillRect(0, 0, 640, 150);
      cx.strokeStyle = spec.tint; cx.lineWidth = 3;
      cx.beginPath(); cx.arc(320, 75, 52, 0, Math.PI * 2); cx.stroke();
      cx.globalAlpha = 0.45; cx.lineWidth = 1.5;
      cx.beginPath(); cx.arc(320, 75, 66, 0, Math.PI * 2); cx.stroke();
      cx.globalAlpha = 1;
      cx.fillStyle = spec.tint; cx.font = 'bold 15px monospace'; cx.textAlign = 'center';
      cx.fillText(kind.toUpperCase(), 320, 80);
      art.appendChild(cv);
    }
    var cap = document.createElement('div');
    cap.className = 'station-sprite-title';
    cap.innerHTML = '<div class="t" style="color:' + spec.tint + '">' + meta.title + '</div>' +
      '<div class="s">' + meta.sub + '</div>';
    art.appendChild(cap);
    wrap.appendChild(art);
    body.appendChild(wrap);
    return wrap;
  }

  /* Thin store row for the specialty views (base render()'s row() is a
   * closure we can't reach from here). */
  function srow(body, name, desc, label, disabled, onClick, tierColor, rowId) {
    var div = document.createElement('div');
    div.className = 'store-row';
    if (rowId) div.id = rowId;
    div.innerHTML = '<div class="store-info">' +
      (tierColor ? '<span class="tier-dot" style="background:' + tierColor + '"></span>' : '') +
      '<div><div class="store-name">' + name + '</div>' +
      '<div class="store-desc">' + desc + '</div></div></div>';
    var b = document.createElement('button');
    b.className = 'btn store-btn';
    b.textContent = label;
    if (disabled) b.disabled = true;
    b.addEventListener('click', function () {
      if (onClick()) {
        if (window.SF && SF.Audio && SF.Audio.buy) SF.Audio.buy();
        if (window.SF && SF.Save) SF.Save.save();
        if (window.SF && SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      } else {
        if (window.SF && SF.Audio && SF.Audio.deny) SF.Audio.deny();
      }
    });
    div.appendChild(b);
    body.appendChild(div);
    return b;
  }

  /* beta2-sellfriendly: srow fires onClick() immediately, so a sale row
   * built with it can never confirm first — and returning false from
   * onClick only plays the deny sound. srowConfirm builds the identical
   * markup but routes the click through SF.Dialog.confirm; nothing
   * moves until CONFIRM. srow itself is untouched, so every other
   * specialty row keeps its exact behaviour. */
  function srowConfirm(body, name, desc, label, tierColor, rowId, confirmMsg, onConfirm) {
    var div = document.createElement('div');
    div.className = 'store-row';
    if (rowId) div.id = rowId;
    div.innerHTML = '<div class="store-info">' +
      (tierColor ? '<span class="tier-dot" style="background:' + tierColor + '"></span>' : '') +
      '<div><div class="store-name">' + name + '</div>' +
      '<div class="store-desc">' + desc + '</div></div></div>';
    var b = document.createElement('button');
    b.className = 'btn store-btn';
    b.textContent = label;
    b.addEventListener('click', function () { SF.Dialog.confirm(confirmMsg, onConfirm); });
    div.appendChild(b);
    body.appendChild(div);
    return b;
  }

  function head(body, text) {
    var h = document.createElement('div');
    h.className = 'store-head'; h.textContent = text;
    body.appendChild(h);
  }

  /* ------------------------------ scrapyard ------------------------------ */
  function partRows(body) {
    var p = SF.Player;
    var out = [];
    var inv = p.partInventory || {};
    Object.keys(inv).forEach(function (id) {
      var n = inv[id] || 0;
      if (n <= 0) return;
      var pt = SF.PART_BY_ID ? SF.PART_BY_ID[id] : null;
      if (!pt) return;
      out.push({ id: id, name: pt.name, n: n,
        each: Math.floor(pt.price * SCRAP_RATE), tier: pt.tier, kind: 'part' });
    });
    var cinv = p.inventory || {};
    Object.keys(cinv).forEach(function (id) {
      var n = cinv[id] || 0;
      if (n <= 0) return;
      var it = SF.ITEM_BY_ID ? SF.ITEM_BY_ID[id] : null;
      if (!it) return;
      // components: standard station rate (matches Haven Dock SELL COMPONENTS)
      var pm = (window.SF && SF.Factions) ? SF.Factions.priceMul('compact') : 1;
      out.push({ id: id, name: it.name, n: n,
        each: Math.floor(it.price / pm), tier: it.tier, kind: 'comp', std: true });
    });
    return out;
  }

  function sellSalvage(id, kind) {
    var p = SF.Player;
    if (kind === 'part') {
      var pt = SF.PART_BY_ID[id];
      var n = (p.partInventory[id] || 0);
      if (!pt || n <= 0) return false;
      p.partInventory[id] = 0;
      p.credits += Math.floor(pt.price * SCRAP_RATE) * n;
      return true;
    }
    var it = SF.ITEM_BY_ID[id];
    var n2 = (p.inventory[id] || 0);
    if (!it || n2 <= 0) return false;
    var pm = (window.SF && SF.Factions) ? SF.Factions.priceMul('compact') : 1;
    p.inventory[id] = 0;
    p.credits += Math.floor(it.price / pm) * n2;
    return true;
  }

  function renderScrapyard(body, curSt) {
    var wrap = backdrop(body, 'scrapyard');
    head(wrap, 'SELL SALVAGE');
    /* beta2-ore: the yard buys salvage, never ore — say so plainly when
     * the player is carrying ore, instead of leaving them to hunt for an
     * ore sale that does not exist here. No new sale is offered. */
    if (SF.Player.ore > 0) {
      var oreNote = document.createElement('div');
      oreNote.className = 'dim';
      oreNote.style.marginBottom = '4px';
      oreNote.textContent = 'Ore is not bought here — this yard buys salvage only. ' +
        'Sell ore from the Commerce Sell tab at a full station.';
      wrap.appendChild(oreNote);
    }
    var rows = partRows(wrap);
    if (!rows.length) {
      var none = document.createElement('div');
      none.className = 'dim';
      none.textContent = 'No salvage in the hold. Strip wrecks and derelicts, then come back.';
      wrap.appendChild(none);
      return;
    }
    var total = 0;
    rows.forEach(function (r) { total += r.each * r.n; });
    /* beta2-sellfriendly: payout was shown ("total +70c") but the tap
     * sold every lot blind, with the toast only after the fact. Now
     * the click confirms the lot count + total first; payment is
     * recomputed from live cargo at CONFIRM, same formulas. */
    srowConfirm(wrap, 'SELL ALL SALVAGE', rows.length + ' lots · total +' + fmt(total) + 'c',
      'SELL +' + fmt(total) + 'c', null, 'scrapyard-sell-all',
      'Sell all ' + rows.length + ' salvage lot' + (rows.length === 1 ? '' : 's') +
        ' for +' + fmt(total) + 'c?',
      function () {
        var ok = false, paid = 0;
        partRows().forEach(function (r) {
          var before = SF.Player.credits;
          if (sellSalvage(r.id, r.kind)) { ok = true; paid += SF.Player.credits - before; }
        });
        if (!ok) { if (window.SF && SF.Audio) SF.Audio.deny(); return; }
        if (window.SF && SF.Audio && SF.Audio.buy) SF.Audio.buy();
        if (window.SF && SF.Save) SF.Save.save();
        if (window.SF && SF.HUD) SF.HUD.toast('⚙ Scrap sold: +' + fmt(paid) + 'cr');
        if (window.SF && SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      });
    rows.forEach(function (r) {
      /* beta2-sellfriendly: same blind whole-lot tap as SELL ALL (the
       * row already showed the per-unit price in its desc). Now
       * confirms the lot + total first; formula unchanged. */
      srowConfirm(wrap, r.name + ' ×' + r.n,
        (r.kind === 'part' ? 'Spare part · premium 75% = ' : 'Component · standard rate = ') +
        fmt(r.each) + 'c each',
        'SELL +' + fmt(r.each * r.n) + 'c', r.tier, null,
        'Sell ' + r.name + ' ×' + r.n + ' for +' + fmt(r.each * r.n) + 'c?',
        function () {
          if (!sellSalvage(r.id, r.kind)) { if (window.SF && SF.Audio) SF.Audio.deny(); return; }
          if (window.SF && SF.Audio && SF.Audio.buy) SF.Audio.buy();
          if (window.SF && SF.Save) SF.Save.save();
          if (window.SF && SF.HUD) SF.HUD.toast('⚙ Sold ' + r.name + ': +' + fmt(r.each * r.n) + 'cr');
          if (window.SF && SF.Station && SF.Station.renderStore) SF.Station.renderStore();
        });
    });
  }

  /* ------------------------------- prison -------------------------------- */
  function renderPrison(body, curSt) {
    var wrap = backdrop(body, 'prison');
    head(wrap, '☠ BOUNTY TURN-IN');
    if (window.SF && SF.Bounty) SF.Bounty.renderBoard(wrap);
    else {
      var d = document.createElement('div');
      d.className = 'dim'; d.textContent = 'Bounty board offline.';
      wrap.appendChild(d);
    }
  }

  /* prison-hulk standing bonus: wrap SF.Bounty.turnIn once (gameplay.js loads
   * before station.js, so SF.Bounty exists here). Applies only while the
   * player is docked at the prison hulk. */
  (function () {
    if (!(window.SF && SF.Bounty && SF.Bounty.turnIn) || SF.Bounty.turnIn._ss4w) return;
    var orig = SF.Bounty.turnIn;
    var wrapped = function () {
      var b = SF.Bounty.active();
      var ok = orig.call(SF.Bounty);
      if (ok && b && SF.StationViews && SF.StationViews.currentKind === 'prison') {
        var sys = (window.SF && SF.Game) ? SF.Game.systemId : null;
        var fac = (sys && SF.CONFIG.trading && SF.CONFIG.trading.systemFaction)
          ? SF.CONFIG.trading.systemFaction[sys] : null;
        if (fac && window.SF && SF.Factions && SF.FACTION_BY_ID && SF.FACTION_BY_ID[fac]) {
          SF.Factions.shift(fac, PRISON_STANDING_BONUS);
          if (SF.HUD && SF.HUD.toast)
            SF.HUD.toast('⚖ Prison-hulk bonus: +' + PRISON_STANDING_BONUS + ' ' +
              SF.FACTION_BY_ID[fac].name + ' standing');
        }
      }
      return ok;
    };
    wrapped._ss4w = true;
    SF.Bounty.turnIn = wrapped;
  })();

  /* ------------------------------- casino -------------------------------- */
  function casinoResult(msg) {
    var el = document.getElementById('casino-result');
    if (el) el.textContent = msg;
  }

  function wager() {
    var p = SF.Player;
    if (visit.lost >= CASINO_LOSS_CAP) return false;
    var bet = visit.bet;
    if (p.credits < bet) {
      casinoResult('Not enough credits for a ' + fmt(bet) + 'c bet.');
      return false;
    }
    visit.plays++;
    if (Math.random() < CASINO_WIN_P) {
      p.credits += bet; visit.won += bet;
      visit.lastResult = '🎲 WIN — +' + fmt(bet) + 'c';
      if (window.SF && SF.Audio && SF.Audio.credit) SF.Audio.credit();
    } else {
      p.credits -= bet; visit.lost += bet;
      visit.lastResult = '🎲 LOSS — −' + fmt(bet) + 'c' +
        (visit.lost >= CASINO_LOSS_CAP ? ' — the pit boss cuts you off for this visit.' : '');
      if (window.SF && SF.Audio && SF.Audio.ui) SF.Audio.ui();
    }
    casinoResult(visit.lastResult);
    return true;
  }

  function renderCasino(body, curSt) {
    var wrap = backdrop(body, 'casino');
    head(wrap, 'DOUBLE OR NOTHING');
    var cutOff = visit.lost >= CASINO_LOSS_CAP;
    var betRow = document.createElement('div');
    betRow.className = 'store-row';
    betRow.innerHTML = '<div class="store-info"><div><div class="store-name">Bet size</div>' +
      '<div class="store-desc">Win doubles your stake. House edge ~6%.</div></div></div>';
    var sel = document.createElement('div');
    sel.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    BETS.forEach(function (b) {
      var bb = document.createElement('button');
      bb.className = 'btn store-btn' + (visit.bet === b ? ' active' : '');
      bb.textContent = b + 'c';
      bb.addEventListener('click', function () {
        visit.bet = b;
        if (window.SF && SF.Audio && SF.Audio.ui) SF.Audio.ui();
        if (window.SF && SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      });
      sel.appendChild(bb);
    });
    betRow.appendChild(sel);
    wrap.appendChild(betRow);
    var res = document.createElement('div');
    res.id = 'casino-result';
    res.className = 'store-desc';
    res.style.cssText = 'margin:6px 0;font-size:15px;min-height:20px;';
    res.textContent = cutOff ? 'The pit boss has cut you off — loss cap reached for this visit.'
      : (visit.lastResult || 'Place your bet, pilot.');
    wrap.appendChild(res);
    srow(wrap, '🎲 DOUBLE OR NOTHING — ' + fmt(visit.bet) + 'c',
      cutOff ? 'Loss cap reached (' + fmt(CASINO_LOSS_CAP) + 'c). Come back next visit.'
             : 'Visit ledger: +' + fmt(visit.won) + 'c won · −' + fmt(visit.lost) + 'c lost · ' +
               visit.plays + ' plays',
      'PLAY', cutOff, function () {
        var ok = wager();
        if (ok && window.SF && SF.HUD)
          SF.HUD.toast('Gilt Spire: ledger −' + fmt(visit.lost) + 'c / +' + fmt(visit.won) + 'c');
        return ok;
      }, null, 'casino-wager');
    var led = document.createElement('div');
    led.className = 'dim';
    led.textContent = 'Loss cap per visit: ' + fmt(CASINO_LOSS_CAP) + 'c (save-neutral, resets when you dock).';
    wrap.appendChild(led);
  }

  /* ------------------------------- memorial ------------------------------ */
  var STATIC_ROLL = [
    ['CMDR. ILSE VANE', 'held the Drift gate so the convoys could run · 2287'],
    ['LT. DORIAN KESS', 'last transmission: "tell the yard I tried" · 2289'],
    ['ENS. MARA OKONKWO', 'mapped the Ember rim and never came home · 2291'],
    ['THE KESTREL DAWN', 'fourteen souls, lost with all hands · 2293']
  ];

  function sysName(id) {
    var s = SF.SYSTEM_BY_ID ? SF.SYSTEM_BY_ID[id] : null;
    return s ? s.name : id;
  }

  function renderMemorial(body, curSt) {
    var wrap = backdrop(body, 'memorial');
    head(wrap, 'HONOR ROLL');
    var deaths = (window.SF && SF.Legacy) ? SF.Legacy.deaths() : 0;
    if (deaths > 0) {
      var sub = document.createElement('div');
      sub.className = 'store-desc';
      sub.style.marginBottom = '4px';
      sub.textContent = deaths + (deaths === 1 ? ' pilot' : ' pilots') + ' remembered across your voyages.';
      wrap.appendChild(sub);
      var wrecks = (window.SF && SF.Legacy) ? SF.Legacy.wrecks() : [];
      wrecks.slice().reverse().forEach(function (w, i) {
        var dt = '';
        try { dt = new Date(w.ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
        catch (e) { dt = 'date unknown'; }
        var div = document.createElement('div');
        div.className = 'store-row';
        div.innerHTML = '<div class="store-info"><div>' +
          '<div class="store-name">🕯 PILOT — lost ' + dt + '</div>' +
          '<div class="store-desc">' + sysName(w.systemId) + ' · wreck held ' +
          fmt(w.credits) + 'cr + ' + fmt(w.ore) + ' ore</div></div></div>';
        wrap.appendChild(div);
      });
    } else {
      var note = document.createElement('div');
      note.className = 'store-desc';
      note.style.marginBottom = '4px';
      note.textContent = 'No pilot of yours has fallen yet. The beacon keeps the old names:';
      wrap.appendChild(note);
      STATIC_ROLL.forEach(function (r) {
        var div = document.createElement('div');
        div.className = 'store-row';
        div.innerHTML = '<div class="store-info"><div>' +
          '<div class="store-name">🕯 ' + r[0] + '</div>' +
          '<div class="store-desc">' + r[1] + '</div></div></div>';
        wrap.appendChild(div);
      });
    }
    srow(wrap, '🕯 PAY RESPECTS',
      candles > 0 ? candles + (candles === 1 ? ' candle' : ' candles') + ' lit' : 'Light a candle for the fallen.',
      'LIGHT', false, function () {
        candles++;
        if (window.SF && SF.HUD) SF.HUD.toast('🕯 A candle burns for the fallen.');
        if (window.SF && SF.Audio && SF.Audio.ui) SF.Audio.ui();
        return true;
      }, null, 'memorial-respects');
  }

  /* ------------------------------- dispatch ------------------------------ */
  function render(body, curSt) {
    switch (curSt.kind) {
      case 'scrapyard': renderScrapyard(body, curSt); break;
      case 'prison': renderPrison(body, curSt); break;
      case 'casino': renderCasino(body, curSt); break;
      case 'memorial': renderMemorial(body, curSt); break;
    }
  }

  function onDock(st) {
    if (st && st.kind === 'casino') visit = { lost: 0, won: 0, plays: 0, bet: 50, lastResult: null };
  }

  return {
    render: render,
    onDock: onDock,
    currentKind: null, // station-sprites-4-wiring: set by SF.Station.render()
    /* test hooks */
    _test: {
      kinds: function () { return Object.keys(SPECIAL); },
      spriteFor: function (kind) { return SPECIAL[kind] ? SPECIAL[kind].sprite : null; },
      casino: function () { return { visit: visit, lossCap: CASINO_LOSS_CAP, winP: CASINO_WIN_P }; },
      setCasinoVisit: function (v) { visit = v; },
      scrapRate: function () { return SCRAP_RATE; },
      prisonBonus: function () { return PRISON_STANDING_BONUS; }
    }
  };
})();
